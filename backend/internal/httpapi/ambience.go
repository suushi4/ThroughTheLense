package httpapi

import (
	"bytes"
	"io"
	"net/http"

	"throughthelense/backend/internal/mediacheck"
)

const coverLimit = 700 * 1024

// suggestAmbience handles POST /api/ambience/suggest: a reduced cover image
// in the body, {"tags": [{id, confidence}]} back. The image is passed to
// the model and dropped; nothing is stored or logged.
func (s *Server) suggestAmbience(w http.ResponseWriter, r *http.Request) error {
	if s.tagger == nil {
		return fail(http.StatusServiceUnavailable, "Подбор звуков по фото недоступен.")
	}
	if !s.tagLimit.Allow(s.clientIP(r)) || !s.tagBudget.Allow("all") {
		return fail(http.StatusTooManyRequests, "Слишком много запросов. Попробуйте через минуту.")
	}
	if r.ContentLength <= 0 || r.ContentLength > coverLimit {
		return errTooLarge
	}
	image, err := io.ReadAll(io.LimitReader(r.Body, coverLimit+1))
	if err != nil || len(image) > coverLimit {
		return errTooLarge
	}
	kind, err := mediacheck.Image(bytes.NewReader(image), int64(len(image)))
	if err != nil {
		return fail(http.StatusBadRequest, "Нужна фотография JPEG, PNG или WebP.")
	}
	tags, err := s.tagger.Tags(r.Context(), image, kind)
	if err != nil {
		logError(r, err)
		return fail(http.StatusServiceUnavailable, "Не удалось подобрать звуки по фото.")
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
	return nil
}
