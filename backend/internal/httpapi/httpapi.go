// Package httpapi exposes the journal over HTTP and serves web/.
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"regexp"
	"strings"
	"time"

	"throughthelense/backend/internal/blob"
	"throughthelense/backend/internal/days"
)

type Options struct {
	WebDir        string
	PublicBaseURL string
	APIEnabled    bool
	MaxUploads    int
	Version       string
}

type Server struct {
	days    *days.Service
	blobs   blob.Store
	log     *slog.Logger
	opts    Options
	uploads chan struct{}
}

func New(svc *days.Service, blobs blob.Store, log *slog.Logger, opts Options) http.Handler {
	s := &Server{days: svc, blobs: blobs, log: log, opts: opts, uploads: make(chan struct{}, max(1, opts.MaxUploads))}
	mux := http.NewServeMux()
	if opts.APIEnabled {
		mux.HandleFunc("GET /api/health", s.health)
		mux.HandleFunc("GET /api/days", s.listDays)
		mux.HandleFunc("GET /api/days/{id}", s.getDay)
		mux.HandleFunc("PUT /api/days/{id}", s.putDay)
		mux.HandleFunc("DELETE /api/days/{id}", s.deleteDay)
		mux.HandleFunc("POST /api/days/{id}/share", s.share)
		mux.HandleFunc("DELETE /api/days/{id}/share", s.unshare)
		mux.HandleFunc("GET /api/public/{slug}", s.publicDay)
		mux.HandleFunc("GET /media/{key}", s.media)
		mux.HandleFunc("GET /d/{slug}", s.sharePage)
	}
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, days.CodeNotFound, "Нет такого метода API.")
	})
	// "/" without a method: "GET /" would conflict with the method-less "/api/".
	staticFiles := static(opts.WebDir)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		staticFiles.ServeHTTP(w, r)
	})
	return logRequests(log, recoverPanics(log, mux))
}

// ---- responses

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var b errorBody
	b.Error.Code, b.Error.Message = code, message
	writeJSON(w, status, b)
}

var statusByCode = map[string]int{
	days.CodeUnauthorized:       http.StatusUnauthorized,
	days.CodeNotFound:           http.StatusNotFound,
	days.CodePreconditionFailed: http.StatusPreconditionFailed,
	days.CodeIDConflict:         http.StatusConflict,
	days.CodePayloadTooLarge:    http.StatusRequestEntityTooLarge,
	days.CodeQuotaExceeded:      http.StatusForbidden,
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *days.Error
	switch {
	case errors.As(err, &e):
		status, ok := statusByCode[e.Code]
		if !ok {
			status = http.StatusBadRequest
		}
		writeError(w, status, e.Code, e.Message)
	case errors.Is(err, days.ErrNotFound):
		writeError(w, http.StatusNotFound, days.CodeNotFound, "День не найден.")
	case errors.Is(err, context.Canceled):
		// client went away
	default:
		s.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Сервер не смог выполнить запрос. Попробуйте ещё раз.")
	}
}

// ---- media URLs in JSON

type mediaJSON struct {
	days.Media
	URL string `json:"url"`
}

func withURL(m days.Media) mediaJSON { return mediaJSON{Media: m, URL: "/media/" + m.Key} }

type dayJSON struct {
	days.Day
	Photos    []mediaJSON `json:"photos"`
	Audio     mediaJSON   `json:"audio"`
	Thumbnail mediaJSON   `json:"thumbnail"`
}

func toJSON(d days.Day) dayJSON {
	out := dayJSON{Day: d, Audio: withURL(d.Audio), Thumbnail: withURL(d.Thumbnail), Photos: []mediaJSON{}}
	for _, p := range d.Photos {
		out.Photos = append(out.Photos, withURL(p))
	}
	return out
}

// ---- owner token

var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32,128}$`)

func owner(r *http.Request) ([]byte, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || !tokenPattern.MatchString(token) {
		return nil, false
	}
	sum := sha256.Sum256([]byte(token))
	return sum[:], true
}

func (s *Server) authed(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	o, ok := owner(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, days.CodeUnauthorized, "Нет ключа архива.")
	}
	return o, ok
}

// ---- handlers

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": s.opts.Version})
}

func (s *Server) listDays(w http.ResponseWriter, r *http.Request) {
	o, ok := s.authed(w, r)
	if !ok {
		return
	}
	list, err := s.days.List(r.Context(), o)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	type row struct {
		days.Summary
		Thumbnail mediaJSON `json:"thumbnail"`
	}
	out := make([]row, len(list))
	for i, d := range list {
		out[i] = row{Summary: d, Thumbnail: withURL(d.Thumbnail)}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getDay(w http.ResponseWriter, r *http.Request) {
	o, ok := s.authed(w, r)
	if !ok {
		return
	}
	d, err := s.days.Get(r.Context(), o, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toJSON(d))
}

func (s *Server) putDay(w http.ResponseWriter, r *http.Request) {
	o, ok := s.authed(w, r)
	if !ok {
		return
	}
	select {
	case s.uploads <- struct{}{}:
		defer func() { <-s.uploads }()
	case <-r.Context().Done():
		return
	case <-time.After(30 * time.Second):
		writeError(w, http.StatusServiceUnavailable, "busy", "Сервер занят, попробуйте через минуту.")
		return
	}
	ct, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || ct != "multipart/form-data" || params["boundary"] == "" {
		writeError(w, http.StatusUnsupportedMediaType, days.CodeInvalidMeta, "Ожидается multipart/form-data.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, days.MaxRequestBody)
	mr := multipart.NewReader(r.Body, params["boundary"])
	next := func() (days.Part, error) {
		p, err := mr.NextPart()
		if err != nil {
			return nil, err
		}
		return p, nil
	}
	mustExist := r.Header.Get("If-Match") == "*"
	d, err := s.days.Save(r.Context(), o, r.PathValue("id"), mustExist, next)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toJSON(d))
}

func (s *Server) deleteDay(w http.ResponseWriter, r *http.Request) {
	o, ok := s.authed(w, r)
	if !ok {
		return
	}
	if err := s.days.Delete(r.Context(), o, r.PathValue("id")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) share(w http.ResponseWriter, r *http.Request) {
	o, ok := s.authed(w, r)
	if !ok {
		return
	}
	slug, err := s.days.Share(r.Context(), o, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"slug": slug, "url": s.publicURL(r) + "/d/" + slug})
}

func (s *Server) unshare(w http.ResponseWriter, r *http.Request) {
	o, ok := s.authed(w, r)
	if !ok {
		return
	}
	if err := s.days.Unshare(r.Context(), o, r.PathValue("id")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) publicURL(r *http.Request) string {
	if s.opts.PublicBaseURL != "" {
		return s.opts.PublicBaseURL
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *Server) publicDay(w http.ResponseWriter, r *http.Request) {
	d, err := s.days.Public(r.Context(), r.PathValue("slug"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toJSON(d))
}

func (s *Server) media(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	typ, err := s.days.MediaType(r.Context(), key)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	f, err := s.blobs.Open(key)
	if errors.Is(err, blob.ErrNotFound) {
		s.fail(w, r, days.ErrNotFound)
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", typ)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, "", f.ModTime(), f)
}

// ---- middleware

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func requestID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func logRequests(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start, id := time.Now(), requestID()
		w.Header().Set("X-Request-Id", id)
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/d/") || sw.status >= 400 {
			log.Info("http", "id", id, "method", r.Method, "path", r.URL.Path, "status", sw.status,
				"bytes", sw.bytes, "ms", time.Since(start).Milliseconds())
		}
	})
}

func recoverPanics(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				log.Error("panic", "path", r.URL.Path, "value", v)
				writeError(w, http.StatusInternalServerError, "internal", "Сервер не смог выполнить запрос.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
