// Package copies stores full day copies (ThroughTheLense/day JSON) as files
// named by revision. A file is written completely and renamed into place
// before the database points at it, so readers never see a partial copy.
package copies

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var revisionPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

var ErrBadRevision = errors.New("bad revision")

type Dir struct{ path string }

func Open(path string) (*Dir, error) {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return nil, err
	}
	return &Dir{path: path}, nil
}

func (d *Dir) file(rev string) (string, error) {
	if !revisionPattern.MatchString(rev) {
		return "", ErrBadRevision
	}
	return filepath.Join(d.path, rev+".json"), nil
}

// Write stores data under a new random revision and returns it.
func (d *Dir) Write(data []byte) (string, error) {
	b := make([]byte, 16)
	rand.Read(b)
	rev := hex.EncodeToString(b)
	final, _ := d.file(rev)
	tmp, err := os.CreateTemp(d.path, ".tmp-"+rev+"-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), final); err != nil {
		return "", err
	}
	syncDir(d.path)
	return rev, nil
}

func syncDir(path string) {
	if dir, err := os.Open(path); err == nil {
		dir.Sync()
		dir.Close()
	}
}

// Open returns the copy for a revision.
func (d *Dir) Open(rev string) (*os.File, error) {
	name, err := d.file(rev)
	if err != nil {
		return nil, err
	}
	return os.Open(name)
}

// Remove deletes a revision; a missing file is not an error.
func (d *Dir) Remove(rev string) error {
	name, err := d.file(rev)
	if err != nil {
		return err
	}
	if err := os.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Sweep removes leftovers older than minAge: temporary files from
// interrupted writes and copies no row references (a crash between the
// rename and the database commit, or between commit and cleanup). The age
// guard keeps it from racing a save that has written but not yet committed.
func (d *Dir) Sweep(referenced func(rev string) bool, minAge time.Duration) (removed int, err error) {
	entries, err := os.ReadDir(d.path)
	if err != nil {
		return 0, err
	}
	cutoff := time.Now().Add(-minAge)
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || e.IsDir() || info.ModTime().After(cutoff) {
			continue
		}
		name := e.Name()
		stale := strings.HasPrefix(name, ".tmp-")
		if rev, ok := strings.CutSuffix(name, ".json"); ok && revisionPattern.MatchString(rev) {
			stale = !referenced(rev)
		}
		if stale && os.Remove(filepath.Join(d.path, name)) == nil {
			removed++
		}
	}
	return removed, nil
}

// Path is the directory holding the copies.
func (d *Dir) Path() string { return d.path }
