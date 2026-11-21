package httpapi

import (
	"net/http"

	"throughthelense/backend/internal/store"
)

func (s *Server) days(w http.ResponseWriter, r *http.Request, user store.User) error {
	return errNotFound
}
