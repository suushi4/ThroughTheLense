package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"throughthelense/backend/internal/blob"
	"throughthelense/backend/internal/days"
	"throughthelense/backend/internal/fixture"
	"throughthelense/backend/internal/httpapi"
	"throughthelense/backend/internal/store/sqlite"
)

const (
	alice = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	bob   = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

type env struct {
	t     *testing.T
	srv   *httptest.Server
	svc   *days.Service
	blobs string
}

func newEnv(t *testing.T, apiOn bool) *env {
	t.Helper()
	dir := t.TempDir()
	web := filepath.Join(dir, "web")
	os.MkdirAll(web, 0o755)
	os.WriteFile(filepath.Join(web, "index.html"), []byte("<!doctype html><html><head><title>ThroughTheLense</title></head><body></body></html>"), 0o644)
	os.WriteFile(filepath.Join(web, "app.mjs"), []byte("export {}"), 0o644)
	repo, err := sqlite.Open(filepath.ToSlash(filepath.Join(dir, "journal.db")))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { repo.Close() })
	blobDir := filepath.Join(dir, "blobs")
	blobs, err := blob.NewFS(blobDir)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := days.NewService(repo, blobs, log, 3)
	h := httpapi.New(svc, blobs, log, httpapi.Options{WebDir: web, APIEnabled: apiOn, MaxUploads: 2, Version: "test"})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &env{t: t, srv: srv, svc: svc, blobs: blobDir}
}

func (e *env) do(method, path, token string, body io.Reader, header map[string]string) (*http.Response, []byte) {
	e.t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

// blobCount counts committed and temporary files under the blob store.
func (e *env) blobCount() int {
	n := 0
	filepath.WalkDir(e.blobs, func(_ string, d fs.DirEntry, _ error) error {
		if d != nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

type file struct {
	part string
	data []byte
}

func validMeta() map[string]any {
	return map[string]any{
		"dayDate": "2026-11-21", "title": "Домой без спешки", "audioName": "Вечерний маршрут",
		"text": "После сдачи проекта мы вышли на улицу. Мы впервые за неделю шли домой без спешки.",
		"scene": map[string]any{"version": 1, "coverPhotoIndex": 0, "quote": "Мы впервые за неделю шли домой без спешки.",
			"palette": "rgb(214,207,196)", "quoteAtSec": 1.2, "returnAtSec": 2.6, "endAtSec": 4},
		"photos":    []any{map[string]any{"part": "photo0", "name": "street.jpg", "lastModified": 1700000000000}},
		"audio":     map[string]any{"part": "audio", "name": "track.wav"},
		"thumbnail": map[string]any{"part": "thumbnail"},
	}
}

func validFiles() []file {
	return []file{{"photo0", fixture.JPEG()}, {"audio", fixture.WAV(4)}, {"thumbnail", fixture.JPEG()}}
}

func form(meta map[string]any, files []file) (io.Reader, string) {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	raw, _ := json.Marshal(meta)
	w.WriteField("meta", string(raw))
	for _, f := range files {
		p, _ := w.CreateFormFile(f.part, f.part+".bin")
		p.Write(f.data)
	}
	w.Close()
	return &b, w.FormDataContentType()
}

func (e *env) put(token, id string, meta map[string]any, files []file, header map[string]string) (*http.Response, map[string]any) {
	body, ct := form(meta, files)
	h := map[string]string{"Content-Type": ct}
	for k, v := range header {
		h[k] = v
	}
	res, raw := e.do("PUT", "/api/days/"+id, token, body, h)
	var out map[string]any
	json.Unmarshal(raw, &out)
	return res, out
}

func errCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

func TestHealthAndStatic(t *testing.T) {
	e := newEnv(t, true)
	res, body := e.do("GET", "/api/health", "", nil, nil)
	if res.StatusCode != 200 || !strings.Contains(string(body), `"ok":true`) {
		t.Fatalf("health: %d %s", res.StatusCode, body)
	}
	res, _ = e.do("GET", "/app.mjs", "", nil, nil)
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("app.mjs served as %q, cache %q", ct, res.Header.Get("Cache-Control"))
	}
	res, body = e.do("GET", "/api/nope", "", nil, nil)
	if res.StatusCode != 404 || !strings.Contains(string(body), `"not_found"`) {
		t.Fatalf("unknown api: %d %s", res.StatusCode, body)
	}
	res, _ = e.do("GET", "/../journal.db", "", nil, nil)
	if res.StatusCode == 200 {
		t.Fatal("path traversal served a file outside web/")
	}
}

func TestAPIOffFallsBackToBrowserStorage(t *testing.T) {
	e := newEnv(t, false)
	if res, _ := e.do("GET", "/api/health", "", nil, nil); res.StatusCode != 404 {
		t.Fatalf("health with API=off: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/", "", nil, nil); res.StatusCode != 200 {
		t.Fatalf("index with API=off: %d", res.StatusCode)
	}
}

func TestDayLifecycle(t *testing.T) {
	e := newEnv(t, true)
	res, day := e.put(alice, "day-1", validMeta(), validFiles(), nil)
	if res.StatusCode != 200 {
		t.Fatalf("create: %d %v", res.StatusCode, day)
	}
	photos := day["photos"].([]any)
	photo := photos[0].(map[string]any)
	if photo["type"] != "image/jpeg" || photo["name"] != "street.jpg" || photo["lastModified"] != float64(1700000000000) {
		t.Fatalf("photo metadata: %v", photo)
	}
	if day["scene"].(map[string]any)["quoteAtSec"] != 1.2 {
		t.Fatalf("scene changed: %v", day["scene"])
	}

	res, raw := e.do("GET", "/api/days", alice, nil, nil)
	var list []map[string]any
	json.Unmarshal(raw, &list)
	if res.StatusCode != 200 || len(list) != 1 || list[0]["photoCount"] != float64(1) || list[0]["duration"] != float64(4) {
		t.Fatalf("list: %d %s", res.StatusCode, raw)
	}
	if res, raw := e.do("GET", "/api/days", bob, nil, nil); string(bytes.TrimSpace(raw)) != "[]" {
		t.Fatalf("bob sees alice's days: %d %s", res.StatusCode, raw)
	}
	if res, _ := e.do("GET", "/api/days/day-1", bob, nil, nil); res.StatusCode != 404 {
		t.Fatalf("bob reads alice's day: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/api/days", "", nil, nil); res.StatusCode != 401 {
		t.Fatalf("no token: %d", res.StatusCode)
	}

	// Range request on the audio, as the player does when seeking.
	audioURL := day["audio"].(map[string]any)["url"].(string)
	res, raw = e.do("GET", audioURL, "", nil, map[string]string{"Range": "bytes=10-19"})
	if res.StatusCode != 206 || len(raw) != 10 || res.Header.Get("Content-Type") != "audio/wav" || res.Header.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("range: %d len=%d type=%q", res.StatusCode, len(raw), res.Header.Get("Content-Type"))
	}
	if res, _ := e.do("GET", "/media/../../journal.db", "", nil, nil); res.StatusCode == 200 {
		t.Fatal("media path traversal")
	}

	if res, _ := e.do("DELETE", "/api/days/day-1", bob, nil, nil); res.StatusCode != 204 {
		t.Fatalf("bob delete: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/api/days/day-1", alice, nil, nil); res.StatusCode != 200 {
		t.Fatal("bob's delete removed alice's day")
	}
	if res, _ := e.do("DELETE", "/api/days/day-1", alice, nil, nil); res.StatusCode != 204 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	if res, _ := e.do("DELETE", "/api/days/day-1", alice, nil, nil); res.StatusCode != 204 {
		t.Fatalf("repeated delete: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", audioURL, "", nil, nil); res.StatusCode != 404 {
		t.Fatalf("media survives delete: %d", res.StatusCode)
	}
	if n := e.blobCount(); n != 0 {
		t.Fatalf("%d blobs left after delete", n)
	}
}

func TestSaveIsIdempotentAndEditsReuseMedia(t *testing.T) {
	e := newEnv(t, true)
	for i := range 2 { // a double click or a retry after a timeout
		if res, body := e.put(alice, "day-1", validMeta(), validFiles(), nil); res.StatusCode != 200 {
			t.Fatalf("save %d: %d %v", i, res.StatusCode, body)
		}
	}
	if n := e.blobCount(); n != 3 {
		t.Fatalf("after two saves of one day: %d blobs, want 3", n)
	}
	_, day := e.put(alice, "day-1", validMeta(), validFiles(), nil)
	photoKey := day["photos"].([]any)[0].(map[string]any)["key"].(string)
	audioKey := day["audio"].(map[string]any)["key"].(string)

	meta := validMeta()
	meta["title"] = "Новое название"
	meta["photos"] = []any{map[string]any{"ref": photoKey}, map[string]any{"part": "photo1", "name": "rain.png"}}
	meta["audio"] = map[string]any{"ref": audioKey}
	res, edited := e.put(alice, "day-1", meta, []file{{"photo1", fixture.PNG()}, {"thumbnail", fixture.JPEG()}}, map[string]string{"If-Match": "*"})
	if res.StatusCode != 200 {
		t.Fatalf("edit: %d %v", res.StatusCode, edited)
	}
	ph := edited["photos"].([]any)
	if len(ph) != 2 || ph[0].(map[string]any)["key"] != photoKey || ph[1].(map[string]any)["type"] != "image/png" || edited["title"] != "Новое название" {
		t.Fatalf("edited day: %v", edited)
	}
	if n := e.blobCount(); n != 4 { // photo, png, audio, new thumbnail
		t.Fatalf("after edit: %d blobs, want 4", n)
	}

	// A ref must belong to this day.
	_, other := e.put(alice, "day-2", validMeta(), validFiles(), nil)
	meta = validMeta()
	meta["photos"] = []any{map[string]any{"ref": other["photos"].([]any)[0].(map[string]any)["key"]}}
	if res, body := e.put(alice, "day-1", meta, []file{{"audio", fixture.WAV(4)}, {"thumbnail", fixture.JPEG()}}, nil); res.StatusCode != 400 || errCode(body) != "invalid_meta" {
		t.Fatalf("foreign ref: %d %v", res.StatusCode, body)
	}
}

func TestEditOfDeletedDayAndForeignID(t *testing.T) {
	e := newEnv(t, true)
	if res, body := e.put(alice, "gone", validMeta(), validFiles(), map[string]string{"If-Match": "*"}); res.StatusCode != 412 || errCode(body) != "precondition_failed" {
		t.Fatalf("edit of missing day: %d %v", res.StatusCode, body)
	}
	e.put(alice, "day-1", validMeta(), validFiles(), nil)
	if res, body := e.put(bob, "day-1", validMeta(), validFiles(), nil); res.StatusCode != 409 {
		t.Fatalf("bob overwrites alice's id: %d %v", res.StatusCode, body)
	}
	if n := e.blobCount(); n != 3 {
		t.Fatalf("rejected saves left files: %d blobs, want 3", n)
	}
}

func TestValidationLeavesNothingBehind(t *testing.T) {
	six := []any{}
	var sixFiles []file
	for i := range 6 {
		ref := map[string]any{"part": "p" + string(rune('0'+i))}
		six = append(six, ref)
		sixFiles = append(sixFiles, file{"p" + string(rune('0'+i)), fixture.JPEG()})
	}
	with := func(edit func(m map[string]any)) map[string]any { m := validMeta(); edit(m); return m }
	replace := func(part string, data []byte) []file {
		fs := validFiles()
		for i := range fs {
			if fs[i].part == part {
				fs[i].data = data
			}
		}
		return fs
	}
	cases := []struct {
		name  string
		meta  map[string]any
		files []file
		code  string
	}{
		{"text pretending to be a photo", validMeta(), replace("photo0", []byte("<?php echo 1; ?> not a jpeg")), "unsupported_photo"},
		{"oversized photo", validMeta(), replace("photo0", append(fixture.JPEG(), make([]byte, days.MaxPhotoBytes)...)), "photo_too_large"},
		{"too many photos", with(func(m map[string]any) { m["photos"] = six }), append(sixFiles, validFiles()[1:]...), "invalid_photo_count"},
		{"jpeg as audio", validMeta(), replace("audio", fixture.JPEG()), "unsupported_audio"},
		{"track too short", validMeta(), replace("audio", fixture.WAV(1.5)), "audio_duration"},
		{"track too long", validMeta(), replace("audio", fixture.WAV(61)), "audio_duration"},
		{"png thumbnail", validMeta(), replace("thumbnail", fixture.PNG()), "invalid_meta"},
		{"quote not in text", with(func(m map[string]any) { m["scene"].(map[string]any)["quote"] = "Чужие слова." }), validFiles(), "invalid_meta"},
		{"bad date", with(func(m map[string]any) { m["dayDate"] = "2026-02-30" }), validFiles(), "invalid_meta"},
		{"cues too close", with(func(m map[string]any) { m["scene"].(map[string]any)["returnAtSec"] = 1.5 }), validFiles(), "invalid_meta"},
		{"cover out of range", with(func(m map[string]any) { m["scene"].(map[string]any)["coverPhotoIndex"] = 3 }), validFiles(), "invalid_meta"},
		{"missing file", validMeta(), validFiles()[:2], "invalid_meta"},
		{"unexpected file", validMeta(), append(validFiles(), file{"extra", fixture.JPEG()}), "invalid_meta"},
		{"scene longer than track", with(func(m map[string]any) { m["scene"].(map[string]any)["endAtSec"] = 12 }), validFiles(), "invalid_meta"},
		{"unknown field", with(func(m map[string]any) { m["owner"] = "x" }), validFiles(), "invalid_meta"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t, true)
			res, body := e.put(alice, "day-1", c.meta, c.files, nil)
			if res.StatusCode < 400 || res.StatusCode >= 500 || errCode(body) != c.code {
				t.Fatalf("got %d %v, want code %s", res.StatusCode, body, c.code)
			}
			if n := e.blobCount(); n != 0 {
				t.Fatalf("%d files left after rejected save", n)
			}
			if res, _ := e.do("GET", "/api/days/day-1", alice, nil, nil); res.StatusCode != 404 {
				t.Fatal("rejected day is visible")
			}
		})
	}
}

func TestMetaMustComeFirstAndBodyIsLimited(t *testing.T) {
	e := newEnv(t, true)
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	p, _ := w.CreateFormFile("photo0", "a.jpg")
	p.Write(fixture.JPEG())
	w.Close()
	res, raw := e.do("PUT", "/api/days/x", alice, &b, map[string]string{"Content-Type": w.FormDataContentType()})
	if res.StatusCode != 400 || !strings.Contains(string(raw), "invalid_meta") {
		t.Fatalf("meta not first: %d %s", res.StatusCode, raw)
	}
	res, _ = e.do("PUT", "/api/days/x", alice, strings.NewReader("{}"), map[string]string{"Content-Type": "application/json"})
	if res.StatusCode != 415 {
		t.Fatalf("json body: %d", res.StatusCode)
	}
	res, _ = e.do("PUT", "/api/days/bad%20id", alice, strings.NewReader(""), map[string]string{"Content-Type": "multipart/form-data; boundary=x"})
	if res.StatusCode != 400 {
		t.Fatalf("bad id: %d", res.StatusCode)
	}
}

func TestQuota(t *testing.T) {
	e := newEnv(t, true) // limit is 3 days per owner
	for _, id := range []string{"a", "b", "c"} {
		if res, _ := e.put(alice, id, validMeta(), validFiles(), nil); res.StatusCode != 200 {
			t.Fatalf("day %s: %d", id, res.StatusCode)
		}
	}
	if res, body := e.put(alice, "d", validMeta(), validFiles(), nil); res.StatusCode != 403 || errCode(body) != "quota_exceeded" {
		t.Fatalf("over quota: %d %v", res.StatusCode, body)
	}
	if res, _ := e.put(alice, "a", validMeta(), validFiles(), nil); res.StatusCode != 200 {
		t.Fatal("editing must work at the quota")
	}
}

func TestShare(t *testing.T) {
	e := newEnv(t, true)
	e.put(alice, "day-1", validMeta(), validFiles(), nil)
	if res, _ := e.do("POST", "/api/days/day-1/share", bob, nil, nil); res.StatusCode != 404 {
		t.Fatalf("bob shares alice's day: %d", res.StatusCode)
	}
	res, raw := e.do("POST", "/api/days/day-1/share", alice, nil, nil)
	var share map[string]string
	json.Unmarshal(raw, &share)
	if res.StatusCode != 200 || len(share["slug"]) != 10 || !strings.HasSuffix(share["url"], "/d/"+share["slug"]) {
		t.Fatalf("share: %d %s", res.StatusCode, raw)
	}
	_, again := e.do("POST", "/api/days/day-1/share", alice, nil, nil)
	if !strings.Contains(string(again), share["slug"]) {
		t.Fatal("sharing twice changed the slug")
	}
	res, raw = e.do("GET", "/api/public/"+share["slug"], "", nil, nil)
	if res.StatusCode != 200 || !strings.Contains(string(raw), "Домой без спешки") {
		t.Fatalf("public day: %d %s", res.StatusCode, raw)
	}
	res, raw = e.do("GET", "/d/"+share["slug"], "", nil, nil)
	page := string(raw)
	if res.StatusCode != 200 || !strings.Contains(page, `<base href="/">`) || !strings.Contains(page, `og:title" content="Домой без спешки"`) {
		t.Fatalf("share page: %d %s", res.StatusCode, page)
	}
	e.do("DELETE", "/api/days/day-1/share", alice, nil, nil)
	if res, _ := e.do("GET", "/api/public/"+share["slug"], "", nil, nil); res.StatusCode != 404 {
		t.Fatalf("revoked link still works: %d", res.StatusCode)
	}
}
