// Package httpapi serves the site and the diary API with the same HTTP
// contract as account_server.py, so web/account.mjs and web/diary.mjs work
// unchanged.
package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"throughthelense/backend/internal/auth"
	"throughthelense/backend/internal/config"
	"throughthelense/backend/internal/copies"
	"throughthelense/backend/internal/store"
)

type Server struct {
	cfg     config.Config
	web     *os.Root
	store   *store.Store
	copies  *copies.Dir
	limits  map[string]*auth.Limiter
	uploads chan struct{}
	checked sync.Map // revision -> copycheck.Meta that passed the strict check
}

// postLimits mirrors POST_LIMITS in account_server.py (requests per minute).
var postLimits = map[string]int{"/api/login": 8, "/api/register": 6, "/api/analytics": 60}

func New(cfg config.Config, st *store.Store, cp *copies.Dir) (*Server, error) {
	web, err := os.OpenRoot(cfg.WebDir)
	if err != nil {
		return nil, err
	}
	uploads := max(cfg.MaxUploads, 1)
	s := &Server{cfg: cfg, web: web, store: st, copies: cp, limits: map[string]*auth.Limiter{}, uploads: make(chan struct{}, uploads)}
	for path, n := range postLimits {
		s.limits[path] = auth.NewLimiter(n, time.Minute)
	}
	return s, nil
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

var (
	errNotFound    = fail(http.StatusNotFound, "Адрес не найден.")
	errUnavailable = fail(http.StatusServiceUnavailable, "Дневник временно недоступен. Попробуйте снова.")
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, _ := json.Marshal(v)
	writeRaw(w, status, body)
}

func writeRaw(w http.ResponseWriter, status int, body []byte) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	if status == http.StatusTooManyRequests {
		h.Set("Retry-After", "60")
	}
	w.WriteHeader(status)
	w.Write(body)
}

func writeError(w http.ResponseWriter, r *http.Request, e *apiError) {
	if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
		// The body may be unread and oversized; do not keep the connection.
		w.Header().Set("Connection", "close")
	}
	writeJSON(w, e.status, map[string]string{"message": e.message})
}

type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// api reproduces JournalAPI.handle_api: host check, then the CSRF guard for
// every non-GET request, then rate limits, then routing.
func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	err := s.route(w, r)
	if err == nil {
		return
	}
	e, ok := err.(*apiError)
	if !ok {
		logError(r, err)
		e = errUnavailable
	}
	writeError(w, r, e)
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Path
	// Runtime config is public and session-free; platform health checks
	// (Railway uses Host: healthcheck.railway.app) must reach it.
	if p == "/api/runtime" && r.Method == http.MethodGet {
		return s.runtime(w, r)
	}
	if !s.allowedHost(r.Host) {
		return fail(http.StatusForbidden, "Сервер доступен только на этом компьютере.")
	}
	safe := r.Method == http.MethodGet || r.Method == http.MethodHead
	if !safe && (!s.allowedOrigin(r) || r.Header.Get("X-Diary-Request") != "1") {
		return fail(http.StatusForbidden, "Запрос отклонён.")
	}
	if limiter := s.limits[p]; limiter != nil && r.Method == http.MethodPost {
		if !limiter.Allow(s.clientIP(r)) {
			return fail(http.StatusTooManyRequests, "Слишком много запросов. Попробуйте через минуту.")
		}
	}
	switch {
	case p == "/api/analytics" && r.Method == http.MethodPost:
		return s.analytics(w, r)
	case (p == "/api/register" || p == "/api/login") && r.Method == http.MethodPost:
		return s.credentials(w, r, p == "/api/register")
	case p == "/api/logout" && r.Method == http.MethodPost:
		return s.logout(w, r)
	}
	if strings.HasPrefix(p, "/api/public/") {
		return s.public(w, r)
	}
	user, signedIn, err := s.sessionUser(r)
	if err != nil {
		return err
	}
	switch {
	case p == "/api/session" && r.Method == http.MethodGet:
		if !signedIn {
			writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		} else {
			writeJSON(w, http.StatusOK, map[string]any{"user": user})
		}
		return nil
	case strings.HasPrefix(p, "/api/days"):
		if !signedIn {
			return fail(http.StatusUnauthorized, "Войдите в аккаунт.")
		}
		return s.days(w, r, user)
	}
	return errNotFound
}

// allowedHost: loopback only like serve.py, or exactly the public host.
func (s *Server) allowedHost(host string) bool {
	if s.cfg.PublicBaseURL != "" {
		return host == strings.SplitN(s.cfg.PublicBaseURL, "://", 2)[1]
	}
	return host == "127.0.0.1:"+s.cfg.Port || host == "localhost:"+s.cfg.Port
}

func (s *Server) allowedOrigin(r *http.Request) bool {
	origin, sent := r.Header["Origin"]
	if !sent {
		return true
	}
	want := "http://" + r.Host
	if s.cfg.PublicBaseURL != "" {
		want = s.cfg.PublicBaseURL
	}
	return len(origin) == 1 && origin[0] == want
}

// clientIP keys rate limits. Proxy headers count only behind a trusted proxy.
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		// The platform proxy appends the address it saw; earlier entries
		// come from the client and can be forged.
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	return host
}

func logError(r *http.Request, err error) {
	log.Printf("error: %s %s: %v", r.Method, r.URL.Path, err)
}
