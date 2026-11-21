package copycheck

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"throughthelense/backend/internal/fixture"
	"throughthelense/backend/internal/mediacheck"
)

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

// Valid returns a copy that passes Check; tests elsewhere reuse it.
func valid() map[string]any {
	return map[string]any{
		"format": "ThroughTheLense/day", "version": 1, "dayDate": "2026-11-17",
		"title": "Прогулка", "text": "Мы вышли на улицу после дождя.", "audioName": "Маршрут",
		"quote": "после дождя", "coverIndex": 1,
		"photos": []any{
			map[string]any{"name": "a.jpg", "type": "image/jpeg", "data": b64(fixture.JPEG())},
			map[string]any{"name": "b.png", "type": "image/png", "data": b64(fixture.PNG())},
		},
		"audio": map[string]any{"name": "t.wav", "type": "audio/wav", "data": b64(fixture.WAV(4))},
		"cues":  map[string]any{"quoteAtSec": 1.5, "returnAtSec": 3},
	}
}

func check(t *testing.T, c map[string]any) error {
	t.Helper()
	raw, _ := json.Marshal(c)
	_, err := Check(raw)
	return err
}

func TestValid(t *testing.T) {
	raw, _ := json.Marshal(valid())
	meta, err := Check(raw)
	if err != nil || meta.Title != "Прогулка" || meta.Quote != "после дождя" {
		t.Fatalf("%v %v", meta, err)
	}
	mp3 := valid()
	mp3["audio"] = map[string]any{"name": "t.mp3", "type": "audio/mpeg", "data": b64(fixture.MP3(10, true, false))}
	if err := check(t, mp3); err != nil {
		t.Fatalf("mp3: %v", err)
	}
	sounds := valid()
	sounds["ambience"] = []any{map[string]any{"id": "rain", "gain": 0.5}, map[string]any{"id": "future-sound", "gain": 0}}
	if err := check(t, sounds); err != nil {
		t.Fatalf("ambience: %v", err)
	}
	alias := valid()
	alias["audio"].(map[string]any)["type"] = "audio/x-wav"
	if err := check(t, alias); err != nil {
		t.Fatalf("wav alias: %v", err)
	}
}

func TestRejects(t *testing.T) {
	cases := map[string]func(c map[string]any){
		"format":       func(c map[string]any) { c["format"] = "x" },
		"version":      func(c map[string]any) { c["version"] = 2 },
		"date":         func(c map[string]any) { c["dayDate"] = "2026-02-30" },
		"blank title":  func(c map[string]any) { c["title"] = "   " },
		"long title":   func(c map[string]any) { c["title"] = strings.Repeat("😀", 61) }, // 122 UTF-16 units
		"quote absent": func(c map[string]any) { c["quote"] = "не из текста" },
		"quote punct":  func(c map[string]any) { c["quote"] = "."; c["text"] = "." },
		"no photos":    func(c map[string]any) { c["photos"] = []any{} },
		"cover range":  func(c map[string]any) { c["coverIndex"] = 2 },
		"cover float":  func(c map[string]any) { c["coverIndex"] = 0.5 },
		"html as jpeg": func(c map[string]any) {
			c["photos"].([]any)[0].(map[string]any)["data"] = b64([]byte("<html><script>alert(1)</script></html>"))
		},
		"png as jpeg": func(c map[string]any) {
			c["photos"].([]any)[1].(map[string]any)["type"] = "image/jpeg"
		},
		"bad base64": func(c map[string]any) { c["photos"].([]any)[0].(map[string]any)["data"] = "!!!" },
		"big photo": func(c map[string]any) {
			c["photos"].([]any)[0].(map[string]any)["data"] = b64(append(fixture.JPEG(), make([]byte, PhotoLimit)...))
		},
		"short audio": func(c map[string]any) { c["audio"].(map[string]any)["data"] = b64(fixture.WAV(1)) },
		"long audio":  func(c map[string]any) { c["audio"].(map[string]any)["data"] = b64(fixture.WAV(61)) },
		"audio is jpeg": func(c map[string]any) {
			c["audio"].(map[string]any)["data"] = b64(fixture.JPEG())
		},
		"wav as mp3":          func(c map[string]any) { c["audio"].(map[string]any)["type"] = "audio/mpeg" },
		"no audio":            func(c map[string]any) { delete(c, "audio") },
		"no name":             func(c map[string]any) { delete(c["audio"].(map[string]any), "name") },
		"ambience not a list": func(c map[string]any) { c["ambience"] = map[string]any{"id": "rain"} },
		"ambience gain":       func(c map[string]any) { c["ambience"] = []any{map[string]any{"id": "rain", "gain": 3}} },
		"ambience id":         func(c map[string]any) { c["ambience"] = []any{map[string]any{"id": "<script>", "gain": 0.5}} },
		"ambience too many": func(c map[string]any) {
			c["ambience"] = []any{map[string]any{"id": "a", "gain": 1}, map[string]any{"id": "b", "gain": 1}, map[string]any{"id": "c", "gain": 1}, map[string]any{"id": "d", "gain": 1}, map[string]any{"id": "e", "gain": 1}}
		},
	}
	for name, mutate := range cases {
		c := valid()
		mutate(c)
		var e *Error
		if err := check(t, c); !errors.As(err, &e) {
			t.Errorf("%s: accepted (%v)", name, err)
		}
	}
	if _, err := Check([]byte("{")); err == nil {
		t.Error("broken json accepted")
	}
}

// The demo materials the editor offers must be shareable.
func TestDemoMedia(t *testing.T) {
	dir := "../../../web/media/"
	for _, name := range []string{"street", "cocoa", "stage"} {
		photo, err1 := os.ReadFile(dir + name + ".jpg")
		audio, err2 := os.ReadFile(dir + name + ".wav")
		if err1 != nil || err2 != nil {
			t.Skipf("demo media missing: %v %v", err1, err2)
		}
		c := valid()
		c["photos"] = []any{map[string]any{"name": name + ".jpg", "type": "image/jpeg", "data": b64(photo)}}
		c["coverIndex"] = 0
		c["audio"] = map[string]any{"name": name + ".wav", "type": "audio/wav", "data": b64(audio)}
		if err := check(t, c); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// Every diary track must be shareable: MP3 recognised, duration in range.
func TestDiaryTracks(t *testing.T) {
	files, _ := filepath.Glob("../../../web/media/music/*.mp3")
	if len(files) == 0 {
		t.Skip("no diary tracks")
	}
	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		kind, seconds, err := mediacheck.Audio(bytes.NewReader(data), int64(len(data)))
		if err != nil || kind != "audio/mpeg" || seconds < 30 || seconds > 45 {
			t.Errorf("%s: %s %.1fs %v", filepath.Base(path), kind, seconds, err)
		}
		c := valid()
		c["audio"] = map[string]any{"name": filepath.Base(path), "type": "audio/mpeg", "data": b64(data)}
		if err := check(t, c); err != nil {
			t.Errorf("%s: %v", filepath.Base(path), err)
		}
	}
}
