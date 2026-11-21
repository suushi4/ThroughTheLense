package store

import (
	"context"
	"database/sql"
	"errors"
)

// UpdateProfile sets the display name and avatar and returns the user.
func (s *Store) UpdateProfile(ctx context.Context, userID, name, avatar string) (User, error) {
	if _, err := s.db.ExecContext(ctx, "UPDATE users SET display_name = ?, avatar = ? WHERE id = ?", name, avatar, userID); err != nil {
		return User{}, err
	}
	var u User
	err := s.db.QueryRowContext(ctx, "SELECT id, email, display_name, avatar FROM users WHERE id = ?", userID).
		Scan(&u.ID, &u.Email, &u.Name, &u.Avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

// PasswordHash returns the stored hash of a user's password.
func (s *Store) PasswordHash(ctx context.Context, userID string) (string, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, "SELECT password_hash FROM users WHERE id = ?", userID).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return hash, err
}

// ChangePassword stores a new hash and ends every other session of the user.
func (s *Store) ChangePassword(ctx context.Context, userID, hash, keepSession string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "UPDATE users SET password_hash = ? WHERE id = ?", hash, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", userID, keepSession); err != nil {
		return err
	}
	return tx.Commit()
}
