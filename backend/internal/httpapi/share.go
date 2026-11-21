package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"os"
	"regexp"

	"throughthelense/backend/internal/copycheck"
	"throughthelense/backend/internal/mediacheck"
	"throughthelense/backend/internal/store"
)

var (
	sharePath     = regexp.MustCompile(`^/api/days/([A-Za-z0-9_-]{8,64})/share$`)
	publicPath    = regexp.MustCompile(`^/api/public/([A-Za-z0-9_-]{22})(/cover)?$`)
	sharePagePath = regexp.MustCompile(`^/d/([A-Za-z0-9_-]{22})$`)
	thumbnailURL  = regexp.MustCompile(`^data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$`)
	errNoShare    = fail(http.StatusNotFound, "Ссылка не найдена или отозвана.")
)

func newSlug() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Server) shareURL(slug string) string { return s.origin() + "/d/" + slug }

// verified runs the strict check once per revision; a revision never
// changes content, so the result can be remembered.
func (s *Server) verified(ctx context.Context, rev string) (copycheck.Meta, error) {
	if m, ok := s.checked.Load(rev); ok {
		return m.(copycheck.Meta), nil
	}
	f, err := s.copies.Open(rev)
	if err != nil {
		return copycheck.Meta{}, err
	}
	defer f.Close()
	raw, err := io.ReadAll(f)
	if err != nil {
		return copycheck.Meta{}, err
	}
	meta, err := copycheck.Check(raw)
	if err != nil {
		return meta, err
	}
	s.checked.Store(rev, meta)
	return meta, nil
}

// share handles GET/POST/DELETE /api/days/{id}/share for the owner.
func (s *Server) share(w http.ResponseWriter, r *http.Request, user store.User, id string) error {
	ctx := r.Context()
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		slug, err := s.store.ShareSlug(ctx, user.ID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"slug": nil, "url": nil})
			return nil
		} else if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]string{"slug": slug, "url": s.shareURL(slug)})
		return nil
	case http.MethodDelete:
		if err := s.store.DeleteShare(ctx, user.ID, id); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return nil
	case http.MethodPost:
	default:
		return fail(http.StatusMethodNotAllowed, "Метод недоступен.")
	}
	rev, err := s.store.DayRevision(ctx, user.ID, id)
	if errors.Is(err, store.ErrNotFound) {
		return fail(http.StatusNotFound, "День не найден.")
	} else if err != nil {
		return err
	}
	var reason *copycheck.Error
	if _, err := s.verified(ctx, rev); errors.As(err, &reason) {
		return fail(http.StatusUnprocessableEntity, "Этот день нельзя опубликовать. "+reason.Reason)
	} else if err != nil {
		return err
	}
	slug, err := s.store.CreateShare(ctx, user.ID, id, newSlug())
	if errors.Is(err, store.ErrNotFound) {
		return fail(http.StatusNotFound, "День не найден.")
	} else if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"slug": slug, "url": s.shareURL(slug)})
	return nil
}

// publicDay resolves a slug to a day whose current copy passes the strict
// check. A day edited into something unverifiable stays unpublished.
func (s *Server) publicDay(ctx context.Context, slug string) (store.PublicDay, copycheck.Meta, error) {
	d, err := s.store.PublicDay(ctx, slug)
	if errors.Is(err, store.ErrNotFound) {
		return d, copycheck.Meta{}, errNoShare
	} else if err != nil {
		return d, copycheck.Meta{}, err
	}
	meta, err := s.verified(ctx, d.Revision)
	var reason *copycheck.Error
	if errors.As(err, &reason) || errors.Is(err, os.ErrNotExist) {
		return d, meta, errNoShare
	}
	return d, meta, err
}

// public serves GET /api/public/{slug} (the day copy) and
// /api/public/{slug}/cover (the archive thumbnail) without a session.
func (s *Server) public(w http.ResponseWriter, r *http.Request) error {
	m := publicPath.FindStringSubmatch(r.URL.Path)
	if m == nil {
		return errNotFound
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return fail(http.StatusMethodNotAllowed, "Метод недоступен.")
	}
	d, _, err := s.publicDay(r.Context(), m[1])
	if err != nil {
		return err
	}
	w.Header().Set("X-Robots-Tag", "noindex")
	if m[2] == "/cover" {
		return sendCover(w, d.Summary)
	}
	f, err := s.copies.Open(d.Revision)
	if errors.Is(err, os.ErrNotExist) {
		return errNoShare // edited or deleted a moment ago
	} else if err != nil {
		return err
	}
	defer f.Close()
	return sendCopy(w, f)
}

func sendCover(w http.ResponseWriter, summary json.RawMessage) error {
	var sum struct {
		Thumbnail string `json:"thumbnail"`
	}
	json.Unmarshal(summary, &sum)
	match := thumbnailURL.FindStringSubmatch(sum.Thumbnail)
	if match == nil {
		return errNoShare
	}
	img, err := base64.StdEncoding.DecodeString(match[1])
	if err != nil {
		return errNoShare
	}
	kind, err := mediacheck.Image(bytes.NewReader(img), int64(len(img)))
	if err != nil {
		return errNoShare
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	w.Write(img)
	return nil
}

// sharePage serves shared.html for /d/{slug} with social preview tags. The
// page itself fetches /api/public/{slug} and plays the day.
func (s *Server) sharePage(w http.ResponseWriter, r *http.Request, slug string) {
	_, meta, err := s.publicDay(r.Context(), slug)
	if err != nil {
		if _, ok := err.(*apiError); !ok {
			logError(r, err)
		}
		s.notFound(w, r)
		return
	}
	page, err := s.web.ReadFile("shared.html")
	if err != nil {
		s.notFound(w, r)
		return
	}
	esc := html.EscapeString
	head := `<base href="/"><meta name="robots" content="noindex">` +
		`<meta property="og:type" content="website">` +
		`<meta property="og:title" content="` + esc(meta.Title) + `">` +
		`<meta property="og:description" content="` + esc("«"+meta.Quote+"»") + `">` +
		`<meta property="og:url" content="` + esc(s.shareURL(slug)) + `">` +
		`<meta property="og:image" content="` + esc(s.origin()+"/api/public/"+slug+"/cover") + `">` +
		`<meta name="twitter:card" content="summary_large_image">`
	if i := bytes.Index(page, []byte("<head>")); i >= 0 {
		page = append(page[:i+6:i+6], append([]byte(head), page[i+6:]...)...)
	} else {
		page = append([]byte(head), page...)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	if r.Method != http.MethodHead {
		w.Write(page)
	}
}
