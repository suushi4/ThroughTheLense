package days

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"throughthelense/backend/internal/blob"
	"throughthelense/backend/internal/mediacheck"
)

// Part is one multipart field; *multipart.Part satisfies it.
type Part interface {
	io.Reader
	FormName() string
}

type Service struct {
	repo      Repo
	blobs     blob.Store
	log       *slog.Logger
	maxDays   int
	mu        sync.Mutex // serialises the commit phase; uploads stream outside it
	now       func() time.Time
	afterBlob func() error // test hook: fails the save after blobs are committed
}

func NewService(repo Repo, blobs blob.Store, log *slog.Logger, maxDays int) *Service {
	return &Service{repo: repo, blobs: blobs, log: log, maxDays: maxDays, now: time.Now}
}

func (s *Service) Get(ctx context.Context, owner []byte, id string) (Day, error) {
	if !ValidID(id) {
		return Day{}, ErrNotFound
	}
	return s.repo.Get(ctx, owner, id)
}

func (s *Service) List(ctx context.Context, owner []byte) ([]Summary, error) {
	return s.repo.List(ctx, owner)
}

func (s *Service) Public(ctx context.Context, slug string) (Day, error) {
	if !slugPattern(slug) {
		return Day{}, ErrNotFound
	}
	return s.repo.GetBySlug(ctx, slug)
}

func (s *Service) MediaType(ctx context.Context, key string) (string, error) {
	if !blob.ValidKey(key) {
		return "", ErrNotFound
	}
	return s.repo.MediaType(ctx, key)
}

type upload struct {
	ref   *MediaRef
	kind  string
	media Media
	blob  blob.Pending
}

// Save creates or replaces a day from a multipart body whose first part is
// "meta". Nothing is visible unless every file is valid and the row commits.
func (s *Service) Save(ctx context.Context, owner []byte, id string, mustExist bool, next func() (Part, error)) (Day, error) {
	if !ValidID(id) {
		return Day{}, fail(CodeInvalidMeta, "Некорректный идентификатор дня.")
	}
	p, err := next()
	if err != nil || p.FormName() != "meta" {
		return Day{}, partError(err, "Первым полем запроса должно быть meta.")
	}
	raw, err := io.ReadAll(io.LimitReader(p, MaxMetaBytes+1))
	if err != nil {
		return Day{}, partError(err, "Не удалось прочитать данные дня.")
	}
	if len(raw) > MaxMetaBytes {
		return Day{}, fail(CodePayloadTooLarge, "Данные дня слишком большие.")
	}
	meta, err := ParseMeta(raw)
	if err != nil {
		return Day{}, err
	}

	want := map[string]*upload{}
	for i := range meta.Photos {
		if meta.Photos[i].Part != "" {
			want[meta.Photos[i].Part] = &upload{ref: &meta.Photos[i], kind: KindPhoto}
		}
	}
	if meta.Audio.Part != "" {
		want[meta.Audio.Part] = &upload{ref: &meta.Audio, kind: KindAudio}
	}
	if meta.Thumbnail.Part != "" {
		want[meta.Thumbnail.Part] = &upload{ref: &meta.Thumbnail, kind: KindThumb}
	}

	var uploads []*upload
	committed := false
	defer func() {
		for _, u := range uploads {
			if committed {
				continue
			}
			if u.blob != nil {
				u.blob.Abort()
			}
		}
	}()
	audioSec := -1.0
	for {
		p, err := next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Day{}, partError(err, "Не удалось прочитать файлы дня.")
		}
		u := want[p.FormName()]
		if u == nil || u.blob != nil {
			return Day{}, fail(CodeInvalidMeta, "Лишний файл в запросе: %q.", p.FormName())
		}
		if u.blob, err = s.blobs.Begin(); err != nil {
			return Day{}, err
		}
		uploads = append(uploads, u)
		if sec, err := s.receive(u, p); err != nil {
			return Day{}, err
		} else if u.kind == KindAudio {
			audioSec = sec
		}
	}
	if len(uploads) != len(want) {
		return Day{}, fail(CodeInvalidMeta, "В запросе не хватает файлов дня.")
	}
	if audioSec >= 0 && meta.Scene.EndAtSec > audioSec+0.1 {
		return Day{}, fail(CodeInvalidMeta, "Сцена длиннее трека.")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.repo.Get(ctx, owner, id)
	exists := err == nil
	if err != nil && !errors.Is(err, ErrNotFound) {
		return Day{}, err
	}
	if mustExist && !exists {
		return Day{}, fail(CodePreconditionFailed, "Этот день уже удалён.")
	}
	if !exists {
		if n, err := s.repo.Count(ctx, owner); err != nil {
			return Day{}, err
		} else if n >= s.maxDays {
			return Day{}, fail(CodeQuotaExceeded, "В архиве уже %d дней. Удалите старые, чтобы добавить новый.", n)
		}
	}
	old := map[string]Media{}
	for _, m := range existing.MediaList() {
		old[m.Key] = m
	}
	resolve := func(r *MediaRef, kind string) (Media, error) {
		if r.Part != "" {
			return want[r.Part].media, nil
		}
		m, ok := old[r.Ref]
		if !ok || (kind == KindAudio) != (m.Kind == KindAudio) {
			return Media{}, fail(CodeInvalidMeta, "Файл дня не найден, загрузите его заново.")
		}
		return m, nil
	}
	day := Day{ID: id, DayDate: meta.DayDate, Title: meta.Title, Text: meta.Text, AudioName: meta.AudioName, Scene: meta.Scene}
	for i := range meta.Photos {
		m, err := resolve(&meta.Photos[i], KindPhoto)
		if err != nil {
			return Day{}, err
		}
		if m.Type == "image/jpeg" || m.Type == "image/png" || m.Type == "image/webp" {
			day.Photos = append(day.Photos, m)
		} else {
			return Day{}, fail(CodeInvalidMeta, "Файл дня не найден, загрузите его заново.")
		}
	}
	if day.Audio, err = resolve(&meta.Audio, KindAudio); err != nil {
		return Day{}, err
	}
	if day.Thumbnail, err = resolve(&meta.Thumbnail, KindThumb); err != nil {
		return Day{}, err
	}

	var fresh []string
	for _, u := range uploads {
		if err := u.blob.Commit(); err != nil {
			s.drop(fresh)
			committed = true // remaining pendings are aborted below
			for _, v := range uploads {
				v.blob.Abort()
			}
			return Day{}, err
		}
		fresh = append(fresh, u.blob.Key())
	}
	committed = true
	if s.afterBlob != nil {
		if err := s.afterBlob(); err != nil {
			s.drop(fresh)
			return Day{}, err
		}
	}
	removed, err := s.repo.Save(ctx, owner, day)
	if err != nil {
		s.drop(fresh)
		if errors.Is(err, ErrIDConflict) {
			return Day{}, fail(CodeIDConflict, "Не удалось сохранить день, попробуйте ещё раз.")
		}
		return Day{}, err
	}
	s.drop(removed)
	return s.repo.Get(ctx, owner, id)
}

// receive streams one part into its pending blob and checks its bytes.
func (s *Service) receive(u *upload, p Part) (float64, error) {
	limit, tooLarge := int64(MaxPhotoBytes), fail(CodePhotoTooLarge, "Каждая фотография должна весить до 8 МиБ.")
	switch u.kind {
	case KindAudio:
		limit, tooLarge = MaxAudioBytes, fail(CodeAudioTooLarge, "Выберите трек размером до 12 МиБ.")
	case KindThumb:
		limit, tooLarge = MaxThumbBytes, fail(CodeInvalidMeta, "Миниатюра слишком большая.")
	}
	w := &trackWriter{w: u.blob}
	n, err := io.Copy(w, io.LimitReader(p, limit+1))
	if w.err != nil {
		return 0, w.err // disk failure, not the client's fault
	}
	if err != nil {
		return 0, partError(err, "Не удалось получить файл.")
	}
	if n > limit {
		return 0, tooLarge
	}
	if n == 0 {
		return 0, fail(CodeInvalidMeta, "Пустой файл в запросе.")
	}
	name := strings.TrimSpace(u.ref.Name)
	if name == "" {
		name = u.ref.Part
	}
	lm := u.ref.LastModified
	if lm <= 0 {
		lm = s.now().UnixMilli()
	}
	u.media = Media{Key: u.blob.Key(), Size: n, Name: name, LastModified: lm}
	sec := -1.0
	switch u.kind {
	case KindPhoto:
		if u.media.Type, err = mediacheck.Image(u.blob, n); err != nil {
			return 0, fail(CodeUnsupportedPhoto, "Подойдут фотографии JPEG, PNG и WebP.")
		}
	case KindThumb:
		if t, err := mediacheck.Image(u.blob, n); err != nil || t != "image/jpeg" {
			return 0, fail(CodeInvalidMeta, "Миниатюра должна быть JPEG.")
		}
		u.media.Type = "image/jpeg"
	case KindAudio:
		u.media.Type, sec, err = mediacheck.Audio(u.blob, n)
		switch {
		case errors.Is(err, mediacheck.ErrUnsupported):
			return 0, fail(CodeUnsupportedAudio, "Выберите файл MP3 или WAV.")
		case err != nil:
			return 0, fail(CodeUnsupportedAudio, "Не удалось прочитать песню. Выберите другой MP3 или WAV.")
		case sec < MinAudioSec-0.05 || sec > MaxAudioSec+0.05:
			return 0, fail(CodeAudioDuration, "Нужен фрагмент длительностью от 3 до 60 секунд.")
		}
	}
	return sec, nil
}

func (s *Service) drop(keys []string) {
	for _, k := range keys {
		if err := s.blobs.Delete(k); err != nil {
			s.log.Warn("blob delete failed", "key", k, "err", err)
		}
	}
}

// Delete is idempotent: a missing day is not an error.
func (s *Service) Delete(ctx context.Context, owner []byte, id string) error {
	if !ValidID(id) {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	removed, err := s.repo.Delete(ctx, owner, id)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	s.drop(removed)
	return nil
}

const slugAlphabet = "abcdefghijkmnpqrstuvwxyz23456789"

func slugPattern(s string) bool {
	if len(s) != 10 {
		return false
	}
	for _, r := range s {
		if !strings.ContainsRune(slugAlphabet, r) {
			return false
		}
	}
	return true
}

func newSlug() (string, error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = slugAlphabet[int(b[i])%len(slugAlphabet)]
	}
	return string(b), nil
}

// Share returns the day's public slug, creating one on first use.
func (s *Service) Share(ctx context.Context, owner []byte, id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, owner, id)
	if err != nil {
		return "", err
	}
	if d.Slug != nil {
		return *d.Slug, nil
	}
	slug, err := newSlug()
	if err != nil {
		return "", err
	}
	return slug, s.repo.SetSlug(ctx, owner, id, &slug)
}

func (s *Service) Unshare(ctx context.Context, owner []byte, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !ValidID(id) {
		return nil
	}
	err := s.repo.SetSlug(ctx, owner, id, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

type trackWriter struct {
	w   io.Writer
	err error
}

func (t *trackWriter) Write(b []byte) (int, error) {
	n, err := t.w.Write(b)
	if err != nil {
		t.err = err
	}
	return n, err
}

// partError turns a failure to read the request body into a client error.
func partError(err error, message string) error {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return fail(CodePayloadTooLarge, "Материалы дня слишком большие.")
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return fail(CodeInvalidMeta, message)
}
