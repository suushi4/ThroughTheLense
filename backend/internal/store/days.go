package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type DaySummary struct {
	ID      string
	Summary json.RawMessage
}

func (s *Store) ListDays(ctx context.Context, userID string) ([]DaySummary, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, summary FROM days WHERE user_id = ?", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DaySummary
	for rows.Next() {
		var d DaySummary
		var summary string
		if err := rows.Scan(&d.ID, &summary); err != nil {
			return nil, err
		}
		d.Summary = json.RawMessage(summary)
		out = append(out, d)
	}
	return out, rows.Err()
}

// DayRevision returns the revision holding the day's copy.
func (s *Store) DayRevision(ctx context.Context, userID, id string) (string, error) {
	var rev string
	err := s.db.QueryRowContext(ctx, "SELECT revision FROM days WHERE user_id = ? AND id = ?", userID, id).Scan(&rev)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return rev, err
}

// InsertDay creates a day. It never replaces an existing one: inserted is
// false when the id is already taken by this owner.
func (s *Store) InsertDay(ctx context.Context, userID, id, summary, rev string) (inserted bool, err error) {
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx,
		"INSERT INTO days (user_id, id, summary, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) "+
			"ON CONFLICT (user_id, id) DO NOTHING", userID, id, summary, rev, now, now)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// UpdateDay points an existing day at a new summary and revision and returns
// the revision it replaced. ErrNotFound means the day was deleted meanwhile.
func (s *Store) UpdateDay(ctx context.Context, userID, id, summary, rev string) (old string, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, "SELECT revision FROM days WHERE user_id = ? AND id = ?", userID, id).Scan(&old)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE days SET summary = ?, revision = ?, updated_at = ? WHERE user_id = ? AND id = ?",
		summary, rev, time.Now().Unix(), userID, id); err != nil {
		return "", err
	}
	return old, tx.Commit()
}

// DeleteDay removes a day and returns its revision ("" if there was none).
func (s *Store) DeleteDay(ctx context.Context, userID, id string) (string, error) {
	var rev string
	err := s.db.QueryRowContext(ctx, "DELETE FROM days WHERE user_id = ? AND id = ? RETURNING revision", userID, id).Scan(&rev)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return rev, err
}

// HasRevision reports whether any day still uses rev.
func (s *Store) HasRevision(ctx context.Context, rev string) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx, "SELECT 1 FROM days WHERE revision = ?", rev).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
