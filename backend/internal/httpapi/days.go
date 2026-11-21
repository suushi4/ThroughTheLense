package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"unicode/utf8"

	"throughthelense/backend/internal/store"
)

const (
	dayLimit     = 76 * 1024 * 1024
	summaryLimit = 360_000
	photoLimit   = 8 * 1024 * 1024
	audioLimit   = 12 * 1024 * 1024
)

var (
	dayPath      = regexp.MustCompile(`^/api/days/([A-Za-z0-9_-]{8,64})$`)
	errDayFormat = fail(http.StatusBadRequest, "Копия дня не распознана.")
)

func (s *Server) days(w http.ResponseWriter, r *http.Request, user store.User) error {
	if r.URL.Path == "/api/days" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		return s.listDays(w, r, user)
	}
	if m := sharePath.FindStringSubmatch(r.URL.Path); m != nil {
		return s.share(w, r, user, m[1])
	}
	m := dayPath.FindStringSubmatch(r.URL.Path)
	if m == nil {
		return errNotFound
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		return s.getDay(w, r, user, m[1])
	case http.MethodDelete:
		return s.deleteDay(w, r, user, m[1])
	case http.MethodPut:
		return s.putDay(w, r, user, m[1])
	}
	return fail(http.StatusMethodNotAllowed, "Метод недоступен.")
}

func (s *Server) listDays(w http.ResponseWriter, r *http.Request, user store.User) error {
	rows, err := s.store.ListDays(r.Context(), user.ID)
	if err != nil {
		return err
	}
	days := make([]map[string]json.RawMessage, 0, len(rows))
	for _, row := range rows {
		var summary map[string]json.RawMessage
		if err := json.Unmarshal(row.Summary, &summary); err != nil {
			return err
		}
		id, _ := json.Marshal(row.ID)
		summary["id"] = id // the key wins over anything stored in the summary
		days = append(days, summary)
	}
	writeJSON(w, http.StatusOK, map[string]any{"days": days})
	return nil
}

func (s *Server) getDay(w http.ResponseWriter, r *http.Request, user store.User, id string) error {
	// A concurrent edit may remove the file between reading the row and
	// opening it; the next attempt sees the new revision.
	for attempt := 0; attempt < 3; attempt++ {
		rev, err := s.store.DayRevision(r.Context(), user.ID, id)
		if errors.Is(err, store.ErrNotFound) {
			return fail(http.StatusNotFound, "День не найден.")
		} else if err != nil {
			return err
		}
		f, err := s.copies.Open(rev)
		if errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		defer f.Close()
		return sendCopy(w, f)
	}
	return errUnavailable
}

func sendCopy(w http.ResponseWriter, f *os.File) error {
	st, err := f.Stat()
	if err != nil {
		return err
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.WriteHeader(http.StatusOK)
	io.Copy(w, f)
	return nil
}

func (s *Server) deleteDay(w http.ResponseWriter, r *http.Request, user store.User, id string) error {
	rev, err := s.store.DeleteDay(r.Context(), user.ID, id)
	if err != nil {
		return err
	}
	if rev != "" {
		s.copies.Remove(rev) // a leftover file is collected by the sweep
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// dayCopy holds the fields the server checks on save. The check is the one
// web/transfer.mjs importDay applies to sizes, so the server never refuses a
// day the browser could open; stricter checks run before a day is shared.
type dayCopy struct {
	Format  string          `json:"format"`
	Version json.RawMessage `json:"version"`
	Photos  []struct {
		Data string `json:"data"`
	} `json:"photos"`
	Audio *struct {
		Data string `json:"data"`
	} `json:"audio"`
}

func encodedLimit(n int) int { return (n + 2) / 3 * 4 }

func checkCopy(raw json.RawMessage) bool {
	var c dayCopy
	if raw = bytes.TrimSpace(raw); len(raw) == 0 || raw[0] != '{' || json.Unmarshal(raw, &c) != nil {
		return false
	}
	var version float64
	if c.Format != "ThroughTheLense/day" || json.Unmarshal(c.Version, &version) != nil || version != 1 {
		return false
	}
	if len(c.Photos) < 1 || len(c.Photos) > 5 || c.Audio == nil || len(c.Audio.Data) > encodedLimit(audioLimit) {
		return false
	}
	for _, p := range c.Photos {
		if len(p.Data) > encodedLimit(photoLimit) {
			return false
		}
	}
	return true
}

func (s *Server) putDay(w http.ResponseWriter, r *http.Request, user store.User, id string) error {
	// Each save holds its body in memory; bound how many run at once.
	select {
	case s.uploads <- struct{}{}:
		defer func() { <-s.uploads }()
	case <-r.Context().Done():
		return r.Context().Err()
	}
	data, err := readBody(r, dayLimit)
	if err != nil {
		return err
	}
	var body struct {
		Summary json.RawMessage `json:"summary"`
		Copy    json.RawMessage `json:"copy"`
		Editing json.RawMessage `json:"editing"`
	}
	if json.Unmarshal(data, &body) != nil || !utf8.Valid(data) {
		return errBadBody
	}
	data = nil
	var summary map[string]json.RawMessage
	if len(body.Summary) == 0 || body.Summary[0] != '{' || json.Unmarshal(body.Summary, &summary) != nil ||
		!checkCopy(body.Copy) {
		return errDayFormat
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, body.Summary); err != nil {
		return errDayFormat
	}
	if utf8.RuneCount(compact.Bytes()) > summaryLimit {
		return fail(http.StatusRequestEntityTooLarge, "Обложка слишком большая.")
	}
	editing := string(bytes.TrimSpace(body.Editing)) == "true"

	ctx := r.Context()
	if !editing {
		// Creating never overwrites; skip writing the file when the id exists.
		if _, err := s.store.DayRevision(ctx, user.ID, id); err == nil {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return nil
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
	}
	rev, err := s.copies.Write(body.Copy)
	if err != nil {
		return err
	}
	if editing {
		old, err := s.store.UpdateDay(ctx, user.ID, id, compact.String(), rev)
		if err != nil {
			s.copies.Remove(rev)
			if errors.Is(err, store.ErrNotFound) {
				return fail(http.StatusNotFound, "День уже удалён.")
			}
			return err
		}
		s.copies.Remove(old)
	} else {
		inserted, err := s.store.InsertDay(ctx, user.ID, id, compact.String(), rev)
		if err != nil || !inserted {
			s.copies.Remove(rev)
		}
		if err != nil {
			return err
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}
