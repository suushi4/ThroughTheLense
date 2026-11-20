package days_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"path/filepath"
	"testing"

	"throughthelense/backend/internal/blob"
	"throughthelense/backend/internal/days"
	"throughthelense/backend/internal/fixture"
	"throughthelense/backend/internal/store/sqlite"
)

type part struct {
	name string
	io.Reader
}

func (p part) FormName() string { return p.name }

func parts(list ...part) func() (days.Part, error) {
	return func() (days.Part, error) {
		if len(list) == 0 {
			return nil, io.EOF
		}
		p := list[0]
		list = list[1:]
		return p, nil
	}
}

func TestRollbackWhenDatabaseFails(t *testing.T) {
	dir := t.TempDir()
	repo, err := sqlite.Open(filepath.ToSlash(filepath.Join(dir, "journal.db")))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	blobs, _ := blob.NewFS(filepath.Join(dir, "blobs"))
	svc := days.NewService(repo, blobs, slog.New(slog.NewTextHandler(io.Discard, nil)), 10)
	days.FailAfterBlobs(svc, errors.New("disk full"))

	meta, _ := json.Marshal(map[string]any{
		"dayDate": "2026-11-21", "title": "День", "audioName": "", "text": "Один день. Мы шли домой.",
		"scene":  map[string]any{"version": 1, "coverPhotoIndex": 0, "quote": "Мы шли домой.", "palette": "rgb(1,2,3)", "quoteAtSec": 1, "returnAtSec": 2, "endAtSec": 3},
		"photos": []any{map[string]any{"part": "p"}}, "audio": map[string]any{"part": "a"}, "thumbnail": map[string]any{"part": "t"},
	})
	owner := []byte("owner-hash")
	_, err = svc.Save(context.Background(), owner, "day-1", false, parts(
		part{"meta", bytes.NewReader(meta)},
		part{"p", bytes.NewReader(fixture.JPEG())},
		part{"a", bytes.NewReader(fixture.WAV(3.5))},
		part{"t", bytes.NewReader(fixture.JPEG())},
	))
	if err == nil || err.Error() != "disk full" {
		t.Fatalf("Save() error = %v, want disk full", err)
	}
	files := 0
	filepath.WalkDir(filepath.Join(dir, "blobs"), func(_ string, d fs.DirEntry, _ error) error {
		if d != nil && !d.IsDir() {
			files++
		}
		return nil
	})
	if files != 0 {
		t.Fatalf("%d orphan files after failed save", files)
	}
	if _, err := svc.Get(context.Background(), owner, "day-1"); !errors.Is(err, days.ErrNotFound) {
		t.Fatalf("failed day is visible: %v", err)
	}
}
