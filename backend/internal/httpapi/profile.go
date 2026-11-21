package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"throughthelense/backend/internal/auth"
	"throughthelense/backend/internal/store"
)

// avatarPresets mirror web/avatar.mjs; "" is «буква на цвете».
var avatarPresets = map[string]bool{
	"": true, "lens": true, "note": true, "frame": true, "wave": true,
	"clock": true, "calendar": true, "stack": true, "folder": true,
}

// cleanName trims, collapses spaces and refuses control characters.
func cleanName(raw string) (string, bool) {
	if strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return "", false
	}
	name := strings.Join(strings.Fields(raw), " ")
	return name, utf8.RuneCountInString(name) <= 40
}

// profile handles PATCH /api/profile {name?, avatar?}.
func (s *Server) profile(w http.ResponseWriter, r *http.Request, user store.User) error {
	obj, err := readObject(r, 2048)
	if err != nil {
		return err
	}
	name, avatar := user.Name, user.Avatar
	if raw, ok := obj["name"]; ok {
		var value string
		if json.Unmarshal(raw, &value) != nil {
			return fail(http.StatusBadRequest, "Имя должно быть строкой.")
		}
		if name, ok = cleanName(value); !ok {
			return fail(http.StatusBadRequest, "Имя — до 40 символов, без служебных знаков.")
		}
	}
	if raw, ok := obj["avatar"]; ok {
		if json.Unmarshal(raw, &avatar) != nil || !avatarPresets[avatar] {
			return fail(http.StatusBadRequest, "Такого аватара нет.")
		}
	}
	updated, err := s.store.UpdateProfile(r.Context(), user.ID, name, avatar)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
	return nil
}

// changePassword handles POST /api/password {current, new}. Other sessions
// of the account end; this one stays.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request, user store.User) error {
	if !s.passwordLimit.Allow(s.clientIP(r)) {
		return fail(http.StatusTooManyRequests, "Слишком много запросов. Попробуйте через минуту.")
	}
	obj, err := readObject(r, 4096)
	if err != nil {
		return err
	}
	var current, next string
	if json.Unmarshal(obj["current"], &current) != nil || json.Unmarshal(obj["new"], &next) != nil {
		return fail(http.StatusBadRequest, "Введите текущий и новый пароль.")
	}
	if n := utf8.RuneCountInString(next); n < 8 || n > 128 {
		return fail(http.StatusBadRequest, "Новый пароль — от 8 до 128 символов.")
	}
	hash, err := s.store.PasswordHash(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if err := auth.VerifyPassword(current, hash); errors.Is(err, auth.ErrMismatch) {
		return fail(http.StatusBadRequest, "Текущий пароль не подходит.")
	} else if err != nil {
		return err
	}
	newHash, err := auth.HashPassword(next)
	if err != nil {
		return err
	}
	if err := s.store.ChangePassword(r.Context(), user.ID, newHash, s.sessionHash(r)); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}
