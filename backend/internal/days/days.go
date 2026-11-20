// Package days holds the journal day model and the rules for saving it.
package days

import (
	"context"
	"errors"
)

// Scene matches entry.scene in web/journal.mjs; player.mjs reads it as-is.
type Scene struct {
	Version         int     `json:"version"`
	CoverPhotoIndex int     `json:"coverPhotoIndex"`
	Quote           string  `json:"quote"`
	Palette         string  `json:"palette"`
	QuoteAtSec      float64 `json:"quoteAtSec"`
	ReturnAtSec     float64 `json:"returnAtSec"`
	EndAtSec        float64 `json:"endAtSec"`
}

const (
	KindPhoto = "photo"
	KindAudio = "audio"
	KindThumb = "thumb"
)

type Media struct {
	Key          string `json:"key"`
	Kind         string `json:"-"`
	Position     int    `json:"-"`
	Type         string `json:"type"`
	Size         int64  `json:"size"`
	Name         string `json:"name"`
	LastModified int64  `json:"lastModified"`
}

type Day struct {
	ID        string  `json:"id"`
	Slug      *string `json:"slug"`
	DayDate   string  `json:"dayDate"`
	Title     string  `json:"title"`
	Text      string  `json:"text"`
	AudioName string  `json:"audioName"`
	Scene     Scene   `json:"scene"`
	Photos    []Media `json:"photos"`
	Audio     Media   `json:"audio"`
	Thumbnail Media   `json:"thumbnail"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt int64   `json:"updatedAt"`
}

// MediaList flattens the day's media into rows for storage.
func (d *Day) MediaList() []Media {
	out := make([]Media, 0, len(d.Photos)+2)
	for i, p := range d.Photos {
		p.Kind, p.Position = KindPhoto, i
		out = append(out, p)
	}
	a, t := d.Audio, d.Thumbnail
	a.Kind, t.Kind = KindAudio, KindThumb
	return append(out, a, t)
}

// SetMedia places stored rows back into the day.
func (d *Day) SetMedia(rows []Media) {
	d.Photos = nil
	for _, m := range rows {
		switch m.Kind {
		case KindPhoto:
			d.Photos = append(d.Photos, m)
		case KindAudio:
			d.Audio = m
		case KindThumb:
			d.Thumbnail = m
		}
	}
}

// Summary is one archive row, like the entries store in IndexedDB.
type Summary struct {
	ID         string  `json:"id"`
	DayDate    string  `json:"dayDate"`
	Title      string  `json:"title"`
	AudioName  string  `json:"audioName"`
	PhotoCount int     `json:"photoCount"`
	Duration   float64 `json:"duration"`
	Thumbnail  Media   `json:"thumbnail"`
}

var (
	ErrNotFound   = errors.New("day not found")
	ErrIDConflict = errors.New("day id belongs to another owner")
)

type Repo interface {
	Get(ctx context.Context, owner []byte, id string) (Day, error)
	GetBySlug(ctx context.Context, slug string) (Day, error)
	List(ctx context.Context, owner []byte) ([]Summary, error)
	Count(ctx context.Context, owner []byte) (int, error)
	// Save upserts the day and replaces its media rows in one transaction.
	// It returns the media keys that are no longer referenced.
	Save(ctx context.Context, owner []byte, d Day) (removed []string, err error)
	// Delete removes the day and returns its media keys.
	Delete(ctx context.Context, owner []byte, id string) (removed []string, err error)
	SetSlug(ctx context.Context, owner []byte, id string, slug *string) error
	MediaType(ctx context.Context, key string) (string, error)
}
