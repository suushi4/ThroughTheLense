package store

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

// suffixPattern only admits a whole domain such as "@example.org", so a
// typo cannot widen the match to every account.
var suffixPattern = regexp.MustCompile(`^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$`)

type PurgeResult struct {
	Emails    []string
	Days      int
	Revisions []string // copy files the caller should remove
}

// PurgeUsers finds accounts whose email ends exactly with suffix and, when
// apply is true, deletes them; sessions, days and share links go with them
// by cascade. Nothing else is touched.
func (s *Store) PurgeUsers(ctx context.Context, suffix string, apply bool) (PurgeResult, error) {
	var r PurgeResult
	suffix = strings.ToLower(strings.TrimSpace(suffix))
	if !suffixPattern.MatchString(suffix) {
		return r, fmt.Errorf("email suffix %q must look like @example.org", suffix)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return r, err
	}
	defer tx.Rollback()
	const match = "substr(email, -length(?1)) = ?1 AND length(email) > length(?1)"
	rows, err := tx.QueryContext(ctx, "SELECT email FROM users WHERE "+match+" ORDER BY email", suffix)
	if err != nil {
		return r, err
	}
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			rows.Close()
			return r, err
		}
		r.Emails = append(r.Emails, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return r, err
	}
	revs, err := tx.QueryContext(ctx, "SELECT revision FROM days WHERE user_id IN (SELECT id FROM users WHERE "+match+")", suffix)
	if err != nil {
		return r, err
	}
	for revs.Next() {
		var rev string
		if err := revs.Scan(&rev); err != nil {
			revs.Close()
			return r, err
		}
		r.Revisions = append(r.Revisions, rev)
	}
	revs.Close()
	if err := revs.Err(); err != nil {
		return r, err
	}
	r.Days = len(r.Revisions)
	if !apply {
		return r, nil
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM users WHERE "+match, suffix); err != nil {
		return r, err
	}
	return r, tx.Commit()
}
