// Package sqlite implements days.Repo on SQLite without CGO.
package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"throughthelense/backend/internal/days"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Repo struct{ db *sql.DB }

func Open(path string) (*Repo, error) {
	q := url.Values{}
	for _, p := range []string{"journal_mode(WAL)", "busy_timeout(5000)", "foreign_keys(1)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	// One connection: writes are rare and this rules out SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Repo{db: db}, nil
}

func (r *Repo) Close() error { return r.db.Close() }

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	for i, name := range files {
		if i < version {
			continue
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

const dayColumns = `id, slug, day_date, title, text, audio_name, scene_json, created_at, updated_at`

type scanner interface{ Scan(...any) error }

func scanDay(row scanner) (days.Day, error) {
	var d days.Day
	var slug sql.NullString
	var scene string
	err := row.Scan(&d.ID, &slug, &d.DayDate, &d.Title, &d.Text, &d.AudioName, &scene, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return d, days.ErrNotFound
	}
	if err != nil {
		return d, err
	}
	if slug.Valid {
		d.Slug = &slug.String
	}
	return d, json.Unmarshal([]byte(scene), &d.Scene)
}

func (r *Repo) withMedia(ctx context.Context, d days.Day, err error) (days.Day, error) {
	if err != nil {
		return d, err
	}
	rows, err := r.db.QueryContext(ctx, `SELECT key, kind, position, mime, size, name, last_modified
		FROM media WHERE day_id = ? ORDER BY kind, position`, d.ID)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	var list []days.Media
	for rows.Next() {
		var m days.Media
		if err := rows.Scan(&m.Key, &m.Kind, &m.Position, &m.Type, &m.Size, &m.Name, &m.LastModified); err != nil {
			return d, err
		}
		list = append(list, m)
	}
	d.SetMedia(list)
	return d, rows.Err()
}

func (r *Repo) Get(ctx context.Context, owner []byte, id string) (days.Day, error) {
	d, err := scanDay(r.db.QueryRowContext(ctx, `SELECT `+dayColumns+` FROM days WHERE id = ? AND owner_hash = ?`, id, owner))
	return r.withMedia(ctx, d, err)
}

func (r *Repo) GetBySlug(ctx context.Context, slug string) (days.Day, error) {
	d, err := scanDay(r.db.QueryRowContext(ctx, `SELECT `+dayColumns+` FROM days WHERE slug = ?`, slug))
	return r.withMedia(ctx, d, err)
}

func (r *Repo) List(ctx context.Context, owner []byte) ([]days.Summary, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT d.id, d.day_date, d.title, d.audio_name, d.scene_json,
			(SELECT count(*) FROM media p WHERE p.day_id = d.id AND p.kind = 'photo'),
			t.key, t.mime, t.size, t.name, t.last_modified
		FROM days d JOIN media t ON t.day_id = d.id AND t.kind = 'thumb'
		WHERE d.owner_hash = ? ORDER BY d.day_date DESC, d.id DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []days.Summary{}
	for rows.Next() {
		var s days.Summary
		var scene string
		t := &s.Thumbnail
		if err := rows.Scan(&s.ID, &s.DayDate, &s.Title, &s.AudioName, &scene, &s.PhotoCount,
			&t.Key, &t.Type, &t.Size, &t.Name, &t.LastModified); err != nil {
			return nil, err
		}
		var sc days.Scene
		if err := json.Unmarshal([]byte(scene), &sc); err != nil {
			return nil, err
		}
		s.Duration = sc.EndAtSec
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repo) Count(ctx context.Context, owner []byte) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM days WHERE owner_hash = ?`, owner).Scan(&n)
	return n, err
}

func (r *Repo) Save(ctx context.Context, owner []byte, d days.Day) ([]string, error) {
	scene, err := json.Marshal(d.Scene)
	if err != nil {
		return nil, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	res, err := tx.ExecContext(ctx, `INSERT INTO days (`+dayColumns+`, owner_hash)
		VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET day_date = excluded.day_date, title = excluded.title,
			text = excluded.text, audio_name = excluded.audio_name, scene_json = excluded.scene_json,
			updated_at = excluded.updated_at
		WHERE days.owner_hash = excluded.owner_hash`,
		d.ID, d.DayDate, d.Title, d.Text, d.AudioName, string(scene), now, now, owner)
	if err != nil {
		return nil, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return nil, err
	} else if n == 0 {
		return nil, days.ErrIDConflict
	}
	old, err := mediaKeys(ctx, tx, d.ID)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM media WHERE day_id = ?`, d.ID); err != nil {
		return nil, err
	}
	keep := map[string]bool{}
	for _, m := range d.MediaList() {
		keep[m.Key] = true
		if _, err := tx.ExecContext(ctx, `INSERT INTO media (key, day_id, kind, position, mime, size, name, last_modified)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, m.Key, d.ID, m.Kind, m.Position, m.Type, m.Size, m.Name, m.LastModified); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	var removed []string
	for _, k := range old {
		if !keep[k] {
			removed = append(removed, k)
		}
	}
	return removed, nil
}

func mediaKeys(ctx context.Context, tx *sql.Tx, id string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT key FROM media WHERE day_id = ?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (r *Repo) Delete(ctx context.Context, owner []byte, id string) ([]string, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	keys, err := mediaKeys(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM days WHERE id = ? AND owner_hash = ?`, id, owner)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, days.ErrNotFound
	}
	return keys, tx.Commit()
}

func (r *Repo) SetSlug(ctx context.Context, owner []byte, id string, slug *string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE days SET slug = ? WHERE id = ? AND owner_hash = ?`, slug, id, owner)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("slug collision: %w", err)
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return days.ErrNotFound
	}
	return nil
}

func (r *Repo) MediaType(ctx context.Context, key string) (string, error) {
	var t string
	err := r.db.QueryRowContext(ctx, `SELECT mime FROM media WHERE key = ?`, key).Scan(&t)
	if errors.Is(err, sql.ErrNoRows) {
		return "", days.ErrNotFound
	}
	return t, err
}
