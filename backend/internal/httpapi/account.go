package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"throughthelense/backend/internal/auth"
	"throughthelense/backend/internal/store"
)

const (
	cookieName     = "ttl_session"
	sessionSeconds = 14 * 24 * 60 * 60
)

var (
	// Python's \s is Unicode-aware; \p{Z} plus the C0/C1 separators covers it.
	emailPattern = regexp.MustCompile(`^[^\s\p{Z}\x{1c}-\x{1f}\x{85}@]+@[^\s\p{Z}\x{1c}-\x{1f}\x{85}@]+\.[^\s\p{Z}\x{1c}-\x{1f}\x{85}@]+$`)
	tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	errTooLarge  = fail(http.StatusRequestEntityTooLarge, "Файл или запрос слишком большой.")
	errBadBody   = fail(http.StatusBadRequest, "Не удалось прочитать запрос.")
)

// readBody follows JournalAPI.body: a declared length in (0, limit], else 413.
func readBody(r *http.Request, limit int64) ([]byte, error) {
	if r.ContentLength <= 0 || r.ContentLength > limit {
		return nil, errTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, r.ContentLength))
	if err != nil || int64(len(data)) != r.ContentLength {
		return nil, errBadBody
	}
	return data, nil
}

// readObject reads a JSON object body.
func readObject(r *http.Request, limit int64) (map[string]json.RawMessage, error) {
	data, err := readBody(r, limit)
	if err != nil {
		return nil, err
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(data, &obj) != nil || obj == nil || !utf8.Valid(data) {
		return nil, errBadBody
	}
	return obj, nil
}

func (s *Server) runtime(w http.ResponseWriter, r *http.Request) error {
	// share advertises /api/days/{id}/share. Only this server has it, and only
	// for days it stores itself, so Supabase mode leaves it out.
	mode := map[string]any{"mode": "local", "analytics": "local", "share": true}
	if s.tagger != nil {
		mode["ambience"] = "vision"
	}
	if s.cfg.SupabaseURL != "" && strings.HasPrefix(s.cfg.SupabaseKey, "sb_publishable_") {
		mode = map[string]any{"mode": "supabase", "analytics": "local", "url": s.cfg.SupabaseURL, "key": s.cfg.SupabaseKey}
	}
	writeJSON(w, http.StatusOK, mode)
	return nil
}

func (s *Server) analytics(w http.ResponseWriter, r *http.Request) error {
	obj, err := readObject(r, 128)
	if err != nil {
		return err
	}
	var event string
	if len(obj) != 1 || json.Unmarshal(obj["event"], &event) != nil || event != "home_view" {
		return fail(http.StatusBadRequest, "Неизвестное событие.")
	}
	if err := s.store.CountVisit(r.Context(), time.Now().Format("2006-01-02")); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

func (s *Server) credentials(w http.ResponseWriter, r *http.Request, register bool) error {
	obj, err := readObject(r, 4096)
	if err != nil {
		return err
	}
	var email, password string
	if json.Unmarshal(obj["email"], &email) != nil || json.Unmarshal(obj["password"], &password) != nil ||
		obj["email"] == nil || obj["password"] == nil {
		return fail(http.StatusBadRequest, "Введите почту и пароль.")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	passwordLen := utf8.RuneCountInString(password)
	if utf8.RuneCountInString(email) > 254 || !emailPattern.MatchString(email) || passwordLen < 1 || passwordLen > 128 {
		return fail(http.StatusBadRequest, "Проверьте почту и пароль.")
	}
	var user store.User
	if register {
		if passwordLen < 8 {
			return fail(http.StatusBadRequest, "Пароль должен содержать не менее 8 символов.")
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		user = store.User{ID: auth.NewID(), Email: email}
		if err := s.store.CreateUser(r.Context(), user.ID, email, hash); errors.Is(err, store.ErrEmailTaken) {
			return fail(http.StatusConflict, "Этот адрес уже зарегистрирован.")
		} else if err != nil {
			return err
		}
	} else {
		found, hash, err := s.store.UserByEmail(r.Context(), email)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if auth.VerifyPassword(password, hash) != nil {
			return fail(http.StatusUnauthorized, "Неверная почта или пароль.")
		}
		user = found
	}
	token := auth.NewToken()
	if err := s.store.NewSession(r.Context(), auth.TokenHash(token), user.ID,
		time.Now().Add(sessionSeconds*time.Second), s.sessionHash(r)); err != nil {
		return err
	}
	s.setCookie(w, token)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
	return nil
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteSession(r.Context(), s.sessionHash(r)); err != nil {
		return err
	}
	s.setCookie(w, "")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// setCookie writes the exact cookie account_server.py sends; an empty token
// clears it.
func (s *Server) setCookie(w http.ResponseWriter, token string) {
	age := sessionSeconds
	if token == "" {
		age = 0
	}
	c := cookieName + "=" + token + "; Path=/api; HttpOnly; SameSite=Strict; Max-Age=" + strconv.Itoa(age)
	if s.cfg.Secure() {
		c += "; Secure"
	}
	w.Header().Add("Set-Cookie", c)
}

// sessionHash is the stored hash of a well-formed session cookie, or "".
func (s *Server) sessionHash(r *http.Request) string {
	c, err := r.Cookie(cookieName)
	if err != nil || !tokenPattern.MatchString(c.Value) {
		return ""
	}
	return auth.TokenHash(c.Value)
}

func (s *Server) sessionUser(r *http.Request) (store.User, bool, error) {
	hash := s.sessionHash(r)
	if hash == "" {
		return store.User{}, false, nil
	}
	u, err := s.store.SessionUser(r.Context(), hash)
	if errors.Is(err, store.ErrNotFound) {
		return u, false, nil
	}
	return u, err == nil, err
}
