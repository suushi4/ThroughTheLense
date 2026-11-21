// Package store keeps accounts, sessions, day metadata and visit counts in
// SQLite (modernc.org/sqlite, no CGO).
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

//go:embed migrations/*.sql
var migrations embed.FS

var (
	ErrEmailTaken = errors.New("email already registered")
	ErrNotFound   = errors.New("not found")
)

type Store struct{ db *sql.DB }

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

func Open(path string) (*Store, error) {
	q := url.Values{}
	for _, p := range []string{"busy_timeout(8000)", "foreign_keys(1)", "journal_mode(WAL)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	// Write transactions take the lock up front so concurrent writers wait on
	// busy_timeout instead of failing mid-transaction.
	q.Set("_txlock", "immediate")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func migrate(db *sql.DB) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	for i, name := range names {
		if i < version {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func isUnique(err error) bool {
	var se *sqlite.Error
	return errors.As(err, &se) && (se.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE || se.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY)
}

func (s *Store) CreateUser(ctx context.Context, id, email, passwordHash string) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
		id, email, passwordHash, time.Now().Unix())
	if isUnique(err) {
		return ErrEmailTaken
	}
	return err
}

// UserByEmail returns the user and stored password hash.
func (s *Store) UserByEmail(ctx context.Context, email string) (User, string, error) {
	var u User
	var hash string
	err := s.db.QueryRowContext(ctx, "SELECT id, email, password_hash FROM users WHERE email = ?", email).
		Scan(&u.ID, &u.Email, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return u, "", ErrNotFound
	}
	return u, hash, err
}

// NewSession stores a session and, in the same transaction, drops expired
// sessions and the one this browser held before (replaced may be empty).
func (s *Store) NewSession(ctx context.Context, tokenHash, userID string, expires time.Time, replaced string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires <= ? OR token_hash = ?", time.Now().Unix(), replaced); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)",
		tokenHash, userID, expires.Unix()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SessionUser(ctx context.Context, tokenHash string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx,
		"SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id "+
			"WHERE token_hash = ? AND expires > ?", tokenHash, time.Now().Unix()).Scan(&u.ID, &u.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash = ?", tokenHash)
	return err
}

// CountVisit adds one home page view to the given local day (YYYY-MM-DD).
func (s *Store) CountVisit(ctx context.Context, day string) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO home_visits (day, visits) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET visits = visits + 1", day)
	return err
}

// Visits returns the counter for one day; used by tests and operators.
func (s *Store) Visits(ctx context.Context, day string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT visits FROM home_visits WHERE day = ?", day).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return n, err
}
