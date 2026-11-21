package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"

	"throughthelense/backend/internal/config"
	"throughthelense/backend/internal/fixture"
	"throughthelense/backend/internal/vision"
)

// fakeClaude answers Messages requests with the given text, or a status.
func fakeClaude(t *testing.T, status int, text string, delay time.Duration, seen *atomic.Value, calls *atomic.Int32) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		body, _ := io.ReadAll(r.Body)
		seen.Store(map[string]string{"path": r.URL.Path, "key": r.Header.Get("Authorization"), "beta": r.Header.Get("Anthropic-Beta"), "body": string(body)})
		time.Sleep(delay)
		w.Header().Set("Content-Type", "application/json")
		if status != 200 {
			w.WriteHeader(status)
			w.Write([]byte(`{"type":"error","error":{"type":"api_error","message":"boom"}}`))
			return
		}
		reply, _ := json.Marshal(map[string]any{
			"id": "msg_1", "type": "message", "role": "assistant", "model": vision.Model,
			"content":     []any{map[string]any{"type": "text", "text": text}},
			"stop_reason": "end_turn", "usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
		w.Write(reply)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func postImage(c *client, body []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/ambience/suggest", bytes.NewReader(body))
	r.Host = c.host
	r.RemoteAddr = c.ip
	r.Header.Set("X-Diary-Request", "1")
	r.Header.Set("Content-Type", "image/jpeg")
	w := httptest.NewRecorder()
	c.s.ServeHTTP(w, r)
	return w
}

func TestAmbienceWithoutKey(t *testing.T) {
	s := newTestServer(t, config.Config{})
	c := newClient(t, s)
	if v := decode(t, c.call("GET", "/api/runtime", "")); v["ambience"] != nil {
		t.Fatalf("runtime offers vision without a key: %v", v)
	}
	expect(t, postImage(c, fixture.JPEG()), 503, "Подбор звуков по фото недоступен.")
}

func TestAmbienceSuggest(t *testing.T) {
	var seen atomic.Value
	var calls atomic.Int32
	fake := fakeClaude(t, 200, `{"tags":[{"id":"rain","confidence":0.9},{"id":"lasers","confidence":1},{"id":"rain","confidence":0.2},{"id":"cafe","confidence":1.7}]}`, 0, &seen, &calls)
	s := newTestServer(t, config.Config{})
	s.tagger = vision.New("test-key", 2*time.Second, option.WithBaseURL(fake.URL))
	c := newClient(t, s)
	if v := decode(t, c.call("GET", "/api/runtime", "")); v["ambience"] != "vision" {
		t.Fatalf("runtime %v", v)
	}
	w := postImage(c, fixture.JPEG())
	expect(t, w, 200, "")
	var got struct{ Tags []vision.Tag }
	json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Tags) != 2 || got.Tags[0] != (vision.Tag{ID: "rain", Confidence: 0.9}) || got.Tags[1] != (vision.Tag{ID: "cafe", Confidence: 1}) {
		t.Fatalf("tags %+v", got.Tags)
	}
	req := seen.Load().(map[string]string)
	if req["path"] != "/v1/messages" || req["key"] != "Bearer test-key" || !strings.Contains(req["beta"], "server-side-fallback-2026-07-01") {
		t.Fatalf("request %v", req)
	}
	var body map[string]any
	json.Unmarshal([]byte(req["body"]), &body)
	if body["model"] != vision.Model || body["fallbacks"] != "default" {
		t.Fatalf("model/fallbacks %v %v", body["model"], body["fallbacks"])
	}
	oc := body["output_config"].(map[string]any)
	if oc["effort"] != "low" || oc["format"].(map[string]any)["type"] != "json_schema" {
		t.Fatalf("output_config %v", oc)
	}
	if !strings.Contains(req["body"], `"media_type":"image/jpeg"`) || !strings.Contains(req["body"], `"enum":["rain"`) {
		t.Fatalf("image or schema missing: %.300s", req["body"])
	}

	// Guard, validation and per-visitor limit.
	expect(t, c.call("POST", "/api/ambience/suggest", "x", "X-Diary-Request", ""), 403, "")
	expect(t, postImage(c, []byte("<html>not a photo</html>")), 400, "Нужна фотография JPEG, PNG или WebP.")
	expect(t, postImage(c, make([]byte, coverLimit+1)), 413, "")
	for i := 0; i < 10; i++ {
		postImage(c, fixture.JPEG())
	}
	expect(t, postImage(c, fixture.JPEG()), 429, "")
}

func TestAmbienceFailures(t *testing.T) {
	var seen atomic.Value
	var calls atomic.Int32
	broken := fakeClaude(t, 500, "", 0, &seen, &calls)
	s := newTestServer(t, config.Config{})
	s.tagger = vision.New("k", 2*time.Second, option.WithBaseURL(broken.URL))
	c := newClient(t, s)
	expect(t, postImage(c, fixture.JPEG()), 503, "Не удалось подобрать звуки по фото.")
	if calls.Load() != 1 {
		t.Fatalf("retried %d times; the editor falls back instead", calls.Load())
	}

	slow := fakeClaude(t, 200, `{"tags":[]}`, 2*time.Second, &seen, &calls)
	s.tagger = vision.New("k", 300*time.Millisecond, option.WithBaseURL(slow.URL))
	c.ip = "192.0.2.77:1"
	started := time.Now()
	expect(t, postImage(c, fixture.JPEG()), 503, "")
	if took := time.Since(started); took > time.Second {
		t.Fatalf("timeout not applied: %v", took)
	}

	garbled := fakeClaude(t, 200, `not json`, 0, &seen, &calls)
	s.tagger = vision.New("k", 2*time.Second, option.WithBaseURL(garbled.URL))
	c.ip = "192.0.2.78:1"
	expect(t, postImage(c, fixture.JPEG()), 503, "")
}
