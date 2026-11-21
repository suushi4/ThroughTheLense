// Package copycheck verifies a ThroughTheLense/day copy before anyone other
// than its owner may see it: media types by their bytes, sizes, audio
// duration, and the same text rules as web/transfer.mjs importDay.
package copycheck

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"throughthelense/backend/internal/mediacheck"
)

const (
	PhotoLimit = 8 * 1024 * 1024
	AudioLimit = 12 * 1024 * 1024
	// The browser measures duration by decoding; frame-count estimates for
	// MP3 can differ slightly, so allow half a second either way.
	minSeconds, maxSeconds, slack = 3, 60, 0.5
)

// Error is a reason shown to the owner, in Russian like the rest of the UI.
type Error struct{ Reason string }

func (e *Error) Error() string { return e.Reason }

func reject(reason string) error { return &Error{reason} }

// Meta is what the public page needs from a verified copy.
type Meta struct {
	Title string
	Quote string
}

type media struct {
	Name *string `json:"name"`
	Type *string `json:"type"`
	Data *string `json:"data"`
}

type dayCopy struct {
	Format     string          `json:"format"`
	Version    json.RawMessage `json:"version"`
	DayDate    *string         `json:"dayDate"`
	Title      *string         `json:"title"`
	Text       *string         `json:"text"`
	AudioName  *string         `json:"audioName"`
	Quote      *string         `json:"quote"`
	CoverIndex json.RawMessage `json:"coverIndex"`
	Photos     []media         `json:"photos"`
	Audio      *media          `json:"audio"`
	Ambience   json.RawMessage `json:"ambience"`
}

var ambienceID = regexp.MustCompile(`^[a-z][a-z-]{0,39}$`)

// validAmbience accepts an absent field or up to four {id, gain} entries.
// Ids are not matched against the library: the page drops unknown ones.
func validAmbience(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	var items []struct {
		ID   *string  `json:"id"`
		Gain *float64 `json:"gain"`
	}
	if json.Unmarshal(raw, &items) != nil || len(items) > 4 {
		return false
	}
	for _, item := range items {
		if item.ID == nil || !ambienceID.MatchString(*item.ID) || item.Gain == nil || *item.Gain < 0 || *item.Gain > 1 {
			return false
		}
	}
	return true
}

// jsLen is String.prototype.length: UTF-16 code units.
func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

func hasWord(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// Check verifies raw copy JSON and returns its title and quote.
func Check(raw []byte) (Meta, error) {
	var c dayCopy
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&c); err != nil {
		return Meta{}, reject("Копия дня повреждена.")
	}
	var version float64
	if c.Format != "ThroughTheLense/day" || json.Unmarshal(c.Version, &version) != nil || version != 1 {
		return Meta{}, reject("Формат копии дня не поддерживается.")
	}
	if c.DayDate == nil || !validDate(*c.DayDate) || c.Title == nil || strings.TrimSpace(*c.Title) == "" ||
		jsLen(*c.Title) > 120 || c.AudioName == nil || c.Text == nil || c.Quote == nil || *c.Quote == "" ||
		jsLen(*c.Quote) > 200 || !hasWord(*c.Quote) || !strings.Contains(*c.Text, *c.Quote) {
		return Meta{}, reject("В копии дня не хватает данных: дата, название или дословная фраза из текста.")
	}
	if len(c.Photos) < 1 || len(c.Photos) > 5 {
		return Meta{}, reject("Нужно от одной до пяти фотографий.")
	}
	var cover int
	if json.Unmarshal(c.CoverIndex, &cover) != nil || cover < 0 || cover >= len(c.Photos) {
		return Meta{}, reject("Обложка не указана.")
	}
	for _, p := range c.Photos {
		data, err := decode(p, PhotoLimit, "Каждая фотография должна весить до 8 МиБ.")
		if err != nil {
			return Meta{}, err
		}
		kind, err := mediacheck.Image(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return Meta{}, reject("Фотография не похожа на JPEG, PNG или WebP.")
		}
		if t := *p.Type; t != "" && t != kind {
			return Meta{}, reject("Тип фотографии не совпадает с её содержимым.")
		}
	}
	if c.Audio == nil {
		return Meta{}, reject("В копии дня нет музыки.")
	}
	data, err := decode(*c.Audio, AudioLimit, "Трек должен весить до 12 МиБ.")
	if err != nil {
		return Meta{}, err
	}
	kind, seconds, err := mediacheck.Audio(bytes.NewReader(data), int64(len(data)))
	if errors.Is(err, mediacheck.ErrUnsupported) {
		return Meta{}, reject("Музыка не похожа на MP3 или WAV.")
	} else if err != nil {
		return Meta{}, reject("Не удалось определить длительность трека.")
	}
	if seconds < minSeconds-slack || seconds > maxSeconds+slack {
		return Meta{}, reject("Трек должен длиться от 3 до 60 секунд.")
	}
	if !audioType(*c.Audio.Type, kind) {
		return Meta{}, reject("Тип трека не совпадает с его содержимым.")
	}
	if !validAmbience(c.Ambience) {
		return Meta{}, reject("Звуки места в копии повреждены.")
	}
	return Meta{Title: *c.Title, Quote: *c.Quote}, nil
}

func validDate(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

func decode(m media, limit int, tooLarge string) ([]byte, error) {
	if m.Data == nil || m.Name == nil || m.Type == nil {
		return nil, reject("Файл в копии дня повреждён.")
	}
	if base64.StdEncoding.DecodedLen(len(*m.Data)) > limit+2 {
		return nil, reject(tooLarge)
	}
	data, err := base64.StdEncoding.DecodeString(*m.Data)
	if err != nil {
		return nil, reject("Файл в копии дня повреждён.")
	}
	if len(data) > limit {
		return nil, reject(tooLarge)
	}
	return data, nil
}

// audioType accepts the declared types web/scene.mjs checkAudio allows,
// as long as they name the format the bytes actually are.
func audioType(declared, kind string) bool {
	switch strings.ToLower(declared) {
	case "":
		return true
	case "audio/mpeg", "audio/mp3":
		return kind == "audio/mpeg"
	case "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave":
		return kind == "audio/wav"
	}
	return false
}
