package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// ShareSlug returns the public slug of a day, or ErrNotFound.
func (s *Store) ShareSlug(ctx context.Context, userID, dayID string) (string, error) {
	var slug string
	err := s.db.QueryRowContext(ctx, "SELECT slug FROM shares WHERE user_id = ? AND day_id = ?", userID, dayID).Scan(&slug)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return slug, err
}

// CreateShare links a day under slug unless it already has a link, and
// returns the slug in effect. ErrNotFound means the day does not exist.
func (s *Store) CreateShare(ctx context.Context, userID, dayID, slug string) (string, error) {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO shares (slug, user_id, day_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, day_id) DO NOTHING",
		slug, userID, dayID, time.Now().Unix())
	var se *sqlite.Error
	if errors.As(err, &se) && se.Code() == sqlite3.SQLITE_CONSTRAINT_FOREIGNKEY {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	return s.ShareSlug(ctx, userID, dayID)
}

func (s *Store) DeleteShare(ctx context.Context, userID, dayID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM shares WHERE user_id = ? AND day_id = ?", userID, dayID)
	return err
}

// PublicDay is a shared day as the public routes see it: no owner, no id.
type PublicDay struct {
	Summary  json.RawMessage
	Revision string
}

func (s *Store) PublicDay(ctx context.Context, slug string) (PublicDay, error) {
	var d PublicDay
	var summary string
	err := s.db.QueryRowContext(ctx,
		"SELECT days.summary, days.revision FROM shares JOIN days ON days.user_id = shares.user_id AND days.id = shares.day_id "+
			"WHERE shares.slug = ?", slug).Scan(&summary, &d.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return d, ErrNotFound
	}
	d.Summary = json.RawMessage(summary)
	return d, err
}
