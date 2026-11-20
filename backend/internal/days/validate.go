package days

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Limits mirror checkPhotos/checkAudio in web/scene.mjs.
const (
	MaxPhotos      = 5
	MaxPhotoBytes  = 8 << 20
	MaxAudioBytes  = 12 << 20
	MaxThumbBytes  = 1 << 20
	MaxMetaBytes   = 256 << 10
	MaxRequestBody = MaxPhotos*MaxPhotoBytes + MaxAudioBytes + MaxThumbBytes + MaxMetaBytes + 1<<20
	MinAudioSec    = 3.0
	MaxAudioSec    = 60.0
	maxTitle       = 120
	maxQuote       = 200
	maxText        = 50000
	maxName        = 255
)

var (
	idPattern      = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
	palettePattern = regexp.MustCompile(`^(rgb\(\d{1,3},\d{1,3},\d{1,3}\)|#[0-9a-fA-F]{6})$`)
)

// MediaRef points either at a multipart part with new bytes or at an
// existing media key of the same day.
type MediaRef struct {
	Part         string `json:"part,omitempty"`
	Ref          string `json:"ref,omitempty"`
	Name         string `json:"name,omitempty"`
	LastModified int64  `json:"lastModified,omitempty"`
}

// Meta is the "meta" multipart field of PUT /api/days/{id}.
type Meta struct {
	DayDate   string     `json:"dayDate"`
	Title     string     `json:"title"`
	Text      string     `json:"text"`
	AudioName string     `json:"audioName"`
	Scene     Scene      `json:"scene"`
	Photos    []MediaRef `json:"photos"`
	Audio     MediaRef   `json:"audio"`
	Thumbnail MediaRef   `json:"thumbnail"`
}

func ValidID(id string) bool { return idPattern.MatchString(id) }

func hasWord(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsNumber(r) }) >= 0
}

func validDate(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

func finite(xs ...float64) bool {
	for _, x := range xs {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return false
		}
	}
	return true
}

// ValidCues repeats validCues from web/scene.mjs.
func ValidCues(s Scene) bool {
	return finite(s.QuoteAtSec, s.ReturnAtSec, s.EndAtSec) &&
		s.QuoteAtSec >= 0.3 && s.ReturnAtSec-s.QuoteAtSec >= 0.599 && s.EndAtSec-s.ReturnAtSec >= 0.299
}

// ParseMeta decodes and checks everything that does not need the files.
func ParseMeta(raw []byte) (Meta, error) {
	var m Meta
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return m, fail(CodeInvalidMeta, "Не удалось прочитать данные дня.")
	}
	m.Title = strings.TrimSpace(m.Title)
	m.Scene.Quote = strings.TrimSpace(m.Scene.Quote)
	s := m.Scene
	switch {
	case !validDate(m.DayDate):
		return m, fail(CodeInvalidMeta, "Укажите дату дня.")
	case m.Title == "" || utf8.RuneCountInString(m.Title) > maxTitle:
		return m, fail(CodeInvalidMeta, "Введите название до 120 знаков.")
	case !hasWord(m.Text) || utf8.RuneCountInString(m.Text) > maxText:
		return m, fail(CodeInvalidMeta, "Напишите хотя бы одно слово о своём дне.")
	case utf8.RuneCountInString(m.AudioName) > maxName:
		return m, fail(CodeInvalidMeta, "Слишком длинное название песни.")
	case s.Version != 1:
		return m, fail(CodeInvalidMeta, "Версия сцены не поддерживается.")
	case !hasWord(s.Quote) || utf8.RuneCountInString(s.Quote) > maxQuote || !strings.Contains(m.Text, s.Quote):
		return m, fail(CodeInvalidMeta, "Выберите до 200 знаков, точно как в исходном тексте.")
	case !palettePattern.MatchString(s.Palette):
		return m, fail(CodeInvalidMeta, "Некорректная палитра сцены.")
	case !ValidCues(s) || s.EndAtSec > 12.001:
		return m, fail(CodeInvalidMeta, "Некорректные переходы сцены.")
	case len(m.Photos) < 1 || len(m.Photos) > MaxPhotos:
		return m, fail(CodeInvalidPhotoCount, "Выберите от одной до пяти фотографий.")
	case s.CoverPhotoIndex < 0 || s.CoverPhotoIndex >= len(m.Photos):
		return m, fail(CodeInvalidMeta, "Выберите обложку из снимков дня.")
	}
	parts := map[string]bool{}
	for _, r := range append(append([]MediaRef{}, m.Photos...), m.Audio, m.Thumbnail) {
		if (r.Part == "") == (r.Ref == "") || utf8.RuneCountInString(r.Name) > maxName {
			return m, fail(CodeInvalidMeta, "Некорректная ссылка на файл дня.")
		}
		if r.Part != "" {
			if r.Part == "meta" || parts[r.Part] {
				return m, fail(CodeInvalidMeta, "Некорректная ссылка на файл дня.")
			}
			parts[r.Part] = true
		}
	}
	return m, nil
}
