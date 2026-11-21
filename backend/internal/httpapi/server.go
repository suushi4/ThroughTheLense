// Package httpapi serves the site and the diary API with the same HTTP
// contract as account_server.py, so web/account.mjs and web/diary.mjs work
// unchanged.
package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"throughthelense/backend/internal/config"
)

type Server struct {
	cfg config.Config
	web *os.Root
}

func New(cfg config.Config) (*Server, error) {
	web, err := os.OpenRoot(cfg.WebDir)
	if err != nil {
		return nil, err
	}
	return &Server{cfg: cfg, web: web}, nil
}

func (s *Server) Close() error { return s.web.Close() }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	if s.cfg.Secure() {
		h.Set("Strict-Transport-Security", "max-age=31536000")
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.api(w, r)
		return
	}
	s.static(w, r)
}

// apiError is the {"message": …} shape every API failure uses.
type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }

func fail(status int, message string) *apiError { return &apiError{status, message} }

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, _ := json.Marshal(v)
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	if status == http.StatusTooManyRequests {
		h.Set("Retry-After", "60")
	}
	w.WriteHeader(status)
	w.Write(body)
}

func writeError(w http.ResponseWriter, e *apiError) {
	writeJSON(w, e.status, map[string]string{"message": e.message})
}

func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	writeError(w, fail(http.StatusNotFound, "Адрес не найден."))
}
