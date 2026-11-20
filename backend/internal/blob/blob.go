// Package blob stores media files under random, unguessable keys.
package blob

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

var ErrNotFound = errors.New("blob not found")

var keyPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// ValidKey reports whether key could have been produced by a Store.
func ValidKey(key string) bool { return keyPattern.MatchString(key) }

// Pending is a file being uploaded. It is invisible until Commit.
type Pending interface {
	io.Writer
	io.ReaderAt
	Key() string
	Size() int64
	Commit() error
	Abort()
}

type Object interface {
	io.ReadSeekCloser
	ModTime() time.Time
}

type Store interface {
	Begin() (Pending, error)
	Open(key string) (Object, error)
	Delete(key string) error
}

// FS keeps blobs in dir/xx/key with temporary uploads in dir/tmp.
type FS struct{ dir string }

func NewFS(dir string) (*FS, error) {
	if err := os.MkdirAll(filepath.Join(dir, "tmp"), 0o755); err != nil {
		return nil, err
	}
	return &FS{dir: dir}, nil
}

func (s *FS) path(key string) string { return filepath.Join(s.dir, key[:2], key) }

func newKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *FS) Begin() (Pending, error) {
	key, err := newKey()
	if err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(filepath.Join(s.dir, "tmp"), key+"-*")
	if err != nil {
		return nil, err
	}
	return &pending{store: s, key: key, f: f}, nil
}

func (s *FS) Open(key string) (Object, error) {
	if !ValidKey(key) {
		return nil, ErrNotFound
	}
	f, err := os.Open(s.path(key))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return object{File: f, mod: st.ModTime()}, nil
}

func (s *FS) Delete(key string) error {
	if !ValidKey(key) {
		return ErrNotFound
	}
	err := os.Remove(s.path(key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

type object struct {
	*os.File
	mod time.Time
}

func (o object) ModTime() time.Time { return o.mod }

type pending struct {
	store *FS
	key   string
	f     *os.File
	size  int64
	done  bool
}

func (p *pending) Write(b []byte) (int, error) {
	n, err := p.f.Write(b)
	p.size += int64(n)
	return n, err
}
func (p *pending) ReadAt(b []byte, off int64) (int, error) { return p.f.ReadAt(b, off) }
func (p *pending) Key() string                             { return p.key }
func (p *pending) Size() int64                             { return p.size }

func (p *pending) Commit() error {
	if p.done {
		return errors.New("blob already finished")
	}
	p.done = true
	tmp := p.f.Name()
	err := p.f.Sync()
	if cerr := p.f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.MkdirAll(filepath.Dir(p.store.path(p.key)), 0o755)
	}
	if err == nil {
		err = os.Rename(tmp, p.store.path(p.key))
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

func (p *pending) Abort() {
	if p.done {
		return
	}
	p.done = true
	p.f.Close()
	os.Remove(p.f.Name())
}
