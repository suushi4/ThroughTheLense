package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"throughthelense/backend/internal/config"
	"throughthelense/backend/internal/store"
)

func testWeb(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"index.html":   "<!doctype html><title>ThroughTheLense</title>",
		"404.html":     "<h1>Страница не найдена</h1>",
		"app.mjs":      "export {}",
		"media/a.wav":  strings.Repeat("x", 100),
		".env":         "SECRET=1",
		"sub/page.txt": "hi",
	}
	for name, body := range files {
		p := filepath.Join(dir, name)
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func newTestServer(t *testing.T, cfg config.Config) *Server {
	t.Helper()
	if cfg.WebDir == "" {
		cfg.WebDir = testWeb(t)
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	s, err := New(cfg, st)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func do(s http.Handler, method, target string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, nil)
	r.Host = "127.0.0.1:8080"
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestStaticFiles(t *testing.T) {
	s := newTestServer(t, config.Config{})
	w := do(s, "GET", "/", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "ThroughTheLense") {
		t.Fatalf("index: %d %q", w.Code, w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("headers: %v", w.Header())
	}
	w = do(s, "GET", "/app.mjs", nil)
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("mjs type %q", ct)
	}
	for _, p := range []string{"/missing", "/.env", "/sub/", "/sub", "/media/../../etc/passwd"} {
		w = do(s, "GET", p, nil)
		if w.Code != 404 || !strings.Contains(w.Body.String(), "Страница не найдена") {
			t.Errorf("%s: %d %q", p, w.Code, w.Body)
		}
	}
	if w := do(s, "POST", "/index.html", nil); w.Code != 405 {
		t.Errorf("POST static: %d", w.Code)
	}
}

func TestStaticRange(t *testing.T) {
	s := newTestServer(t, config.Config{})
	w := do(s, "GET", "/media/a.wav", map[string]string{"Range": "bytes=0-43"})
	if w.Code != 206 || w.Header().Get("Content-Range") != "bytes 0-43/100" || w.Body.Len() != 44 {
		t.Fatalf("range: %d %v %d", w.Code, w.Header(), w.Body.Len())
	}
	if w.Header().Get("Content-Type") != "audio/wav" {
		t.Errorf("wav type %q", w.Header().Get("Content-Type"))
	}
	if w := do(s, "GET", "/media/a.wav", map[string]string{"Range": "bytes=9999999-"}); w.Code != 416 {
		t.Fatalf("unsatisfiable range: %d", w.Code)
	}
}

func TestDiscoveryFiles(t *testing.T) {
	s := newTestServer(t, config.Config{})
	robots := do(s, "GET", "/robots.txt", nil).Body.String()
	if !strings.Contains(robots, "Disallow: /") || !strings.Contains(robots, "Sitemap: http://127.0.0.1:8080/sitemap.xml") {
		t.Fatalf("robots %q", robots)
	}
	sitemap := do(s, "GET", "/sitemap.xml", nil).Body.String()
	if !strings.Contains(sitemap, "http://127.0.0.1:8080/privacy.html") || strings.Contains(sitemap, "journal") {
		t.Fatalf("sitemap %q", sitemap)
	}

	pub := newTestServer(t, config.Config{PublicBaseURL: "https://ttl.example"})
	w := do(pub, "GET", "/sitemap.xml", nil)
	body, _ := io.ReadAll(w.Body)
	if !strings.Contains(string(body), "https://ttl.example/terms.html") {
		t.Fatalf("public sitemap %q", body)
	}
	if !strings.Contains(do(pub, "GET", "/robots.txt", nil).Body.String(), "Allow: /") {
		t.Fatal("public robots should allow")
	}
	if do(pub, "GET", "/", nil).Header().Get("Strict-Transport-Security") == "" {
		t.Fatal("https deploy should send HSTS")
	}
}
