package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"throughthelense/backend/internal/config"
)

type client struct {
	t      *testing.T
	s      http.Handler
	host   string
	origin string
	cookie string
	ip     string
}

func newClient(t *testing.T, s http.Handler) *client {
	return &client{t: t, s: s, host: "127.0.0.1:8080", ip: "192.0.2.1:1234"}
}

// call sends a request the way web/account.mjs does: X-Diary-Request on
// every call, cookie from the previous response.
func (c *client) call(method, path, body string, header ...string) *httptest.ResponseRecorder {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	r.Host = c.host
	r.RemoteAddr = c.ip
	r.Header.Set("X-Diary-Request", "1")
	if c.origin != "" {
		r.Header.Set("Origin", c.origin)
	}
	if c.cookie != "" {
		r.Header.Set("Cookie", c.cookie)
	}
	for i := 0; i+1 < len(header); i += 2 {
		if header[i+1] == "" {
			r.Header.Del(header[i])
		} else {
			r.Header.Set(header[i], header[i+1])
		}
	}
	w := httptest.NewRecorder()
	c.s.ServeHTTP(w, r)
	if set := w.Header().Get("Set-Cookie"); set != "" {
		c.cookie = strings.SplitN(set, ";", 2)[0]
		if c.cookie == cookieName+"=" {
			c.cookie = ""
		}
	}
	return w
}

func expect(t *testing.T, w *httptest.ResponseRecorder, status int, message string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d, want %d: %s", w.Code, status, w.Body)
	}
	if message != "" {
		var body map[string]any
		json.Unmarshal(w.Body.Bytes(), &body)
		if body["message"] != message {
			t.Fatalf("message %q, want %q", body["message"], message)
		}
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content type %q", ct)
	}
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("bad json %q", w.Body)
	}
	return v
}

const creds = `{"email":" Person@Example.org ","password":"ThroughThe-Lense-26"}`

func TestRuntime(t *testing.T) {
	c := newClient(t, newTestServer(t, config.Config{}))
	w := c.call("GET", "/api/runtime", "")
	expect(t, w, 200, "")
	if strings.TrimSpace(w.Body.String()) != `{"analytics":"local","mode":"local"}` {
		t.Fatalf("runtime %s", w.Body)
	}
	sb := newClient(t, newTestServer(t, config.Config{SupabaseURL: "https://x.supabase.co", SupabaseKey: "sb_publishable_k"}))
	if v := decode(t, sb.call("GET", "/api/runtime", "")); v["mode"] != "supabase" || v["key"] != "sb_publishable_k" {
		t.Fatalf("supabase runtime %v", v)
	}
	secret := newClient(t, newTestServer(t, config.Config{SupabaseURL: "https://x.supabase.co", SupabaseKey: "sb_secret_k"}))
	if v := decode(t, secret.call("GET", "/api/runtime", "")); v["mode"] != "local" {
		t.Fatalf("secret key must never reach the browser: %v", v)
	}
}

func TestAccountLifecycle(t *testing.T) {
	c := newClient(t, newTestServer(t, config.Config{}))
	if v := decode(t, c.call("GET", "/api/session", "")); v["user"] != nil {
		t.Fatalf("anonymous session %v", v)
	}
	w := c.call("POST", "/api/register", creds)
	expect(t, w, 200, "")
	set := w.Header().Get("Set-Cookie")
	if !strings.HasSuffix(set, "; Path=/api; HttpOnly; SameSite=Strict; Max-Age=1209600") ||
		len(strings.TrimPrefix(strings.SplitN(set, ";", 2)[0], "ttl_session=")) != 43 {
		t.Fatalf("cookie %q", set)
	}
	user := decode(t, w)["user"].(map[string]any)
	if user["email"] != "person@example.org" || len(user["id"].(string)) != 32 {
		t.Fatalf("user %v", user)
	}
	if v := decode(t, c.call("GET", "/api/session", "")); v["user"].(map[string]any)["id"] != user["id"] {
		t.Fatalf("session %v", v)
	}

	other := newClient(t, c.s)
	expect(t, other.call("POST", "/api/register", `{"email":"PERSON@example.ORG","password":"another-password"}`), 409, "Этот адрес уже зарегистрирован.")
	expect(t, other.call("POST", "/api/login", `{"email":"person@example.org","password":"wrong password"}`), 401, "Неверная почта или пароль.")
	expect(t, other.call("POST", "/api/login", `{"email":"nobody@example.org","password":"ThroughThe-Lense-26"}`), 401, "Неверная почта или пароль.")
	w = other.call("POST", "/api/login", creds)
	expect(t, w, 200, "")
	if decode(t, w)["user"].(map[string]any)["id"] != user["id"] {
		t.Fatal("login returned another user")
	}

	w = c.call("POST", "/api/logout", "")
	expect(t, w, 200, "")
	if w.Header().Get("Set-Cookie") != "ttl_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0" {
		t.Fatalf("logout cookie %q", w.Header().Get("Set-Cookie"))
	}
	if v := decode(t, c.call("GET", "/api/session", "")); v["user"] != nil {
		t.Fatal("logged out session still valid")
	}
	// Logging out one browser leaves the other signed in.
	if v := decode(t, other.call("GET", "/api/session", "")); v["user"] == nil {
		t.Fatal("other session was dropped")
	}
	expect(t, c.call("GET", "/api/days", ""), 401, "Войдите в аккаунт.")
	// A forged cookie of the right shape is just anonymous.
	c.cookie = "ttl_session=" + strings.Repeat("A", 43)
	if v := decode(t, c.call("GET", "/api/session", "")); v["user"] != nil {
		t.Fatal("forged cookie accepted")
	}
}

func TestCredentialValidation(t *testing.T) {
	c := newClient(t, newTestServer(t, config.Config{}))
	cases := []struct{ body, message string }{
		{`{"email":"a@b.co"}`, "Введите почту и пароль."},
		{`{"email":1,"password":"12345678"}`, "Введите почту и пароль."},
		{`{"email":"not-an-email","password":"12345678"}`, "Проверьте почту и пароль."},
		{`{"email":"a b@c.de","password":"12345678"}`, "Проверьте почту и пароль."},
		{`{"email":"a@b.co","password":"` + strings.Repeat("я", 129) + `"}`, "Проверьте почту и пароль."},
		{`{"email":"a@b.co","password":"short"}`, "Пароль должен содержать не менее 8 символов."},
		{`[1,2]`, "Не удалось прочитать запрос."},
		{`{bad`, "Не удалось прочитать запрос."},
	}
	for i, tc := range cases {
		c.ip = fmt.Sprintf("192.0.2.%d:1", i) // stay under the per-address limit
		expect(t, c.call("POST", "/api/register", tc.body), 400, tc.message)
	}
	big := `{"email":"a@b.co","password":"` + strings.Repeat("x", 5000) + `"}`
	expect(t, c.call("POST", "/api/login", big), 413, "Файл или запрос слишком большой.")
	// 128 Cyrillic characters is within the limit even though it is 256 bytes.
	expect(t, c.call("POST", "/api/register", `{"email":"u@b.co","password":"`+strings.Repeat("я", 128)+`"}`), 200, "")
}

func TestGuard(t *testing.T) {
	s := newTestServer(t, config.Config{})
	c := newClient(t, s)
	expect(t, c.call("POST", "/api/logout", "", "X-Diary-Request", ""), 403, "Запрос отклонён.")
	expect(t, c.call("DELETE", "/api/days/abcdefgh", "", "X-Diary-Request", ""), 403, "Запрос отклонён.")
	expect(t, c.call("POST", "/api/login", creds, "Origin", "https://evil.example"), 403, "Запрос отклонён.")
	expect(t, c.call("POST", "/api/register", creds, "Origin", "http://127.0.0.1:8080"), 200, "")
	c.host = "evil.example:8080"
	expect(t, c.call("GET", "/api/session", ""), 403, "Сервер доступен только на этом компьютере.")
	c.host = "localhost:8080"
	expect(t, c.call("GET", "/api/session", ""), 200, "")
	expect(t, c.call("GET", "/api/nothing", ""), 404, "Адрес не найден.")
	expect(t, c.call("GET", "/api/login", ""), 404, "Адрес не найден.")
}

func TestPublicDeployment(t *testing.T) {
	s := newTestServer(t, config.Config{PublicBaseURL: "https://ttl.example", TrustProxy: true})
	c := newClient(t, s)
	c.host = "ttl.example"
	expect(t, c.call("POST", "/api/register", creds, "Origin", "http://ttl.example"), 403, "Запрос отклонён.")
	w := c.call("POST", "/api/register", creds, "Origin", "https://ttl.example")
	expect(t, w, 200, "")
	if !strings.HasSuffix(w.Header().Get("Set-Cookie"), "; Secure") {
		t.Fatalf("cookie must be Secure over https: %q", w.Header().Get("Set-Cookie"))
	}
	c.host = "127.0.0.1:8080"
	expect(t, c.call("GET", "/api/session", ""), 403, "")
	c.host = "healthcheck.railway.app"
	expect(t, c.call("GET", "/api/runtime", ""), 200, "")
	expect(t, c.call("POST", "/api/runtime", ""), 403, "")

	// Behind the proxy each visitor gets their own window.
	c.host = "ttl.example"
	for i := 0; i < 8; i++ {
		c.call("POST", "/api/login", creds, "X-Forwarded-For", "203.0.113.7, 198.51.100.1")
	}
	expect(t, c.call("POST", "/api/login", creds, "X-Forwarded-For", "203.0.113.7, 198.51.100.1"), 429, "")
	expect(t, c.call("POST", "/api/login", creds, "X-Forwarded-For", "203.0.113.7, 198.51.100.2"), 200, "")
}

func TestRateLimit(t *testing.T) {
	c := newClient(t, newTestServer(t, config.Config{}))
	bad := `{"email":"x@y.zz","password":"invalid password"}`
	for i := 0; i < 8; i++ {
		expect(t, c.call("POST", "/api/login", bad), 401, "")
	}
	w := c.call("POST", "/api/login", bad)
	expect(t, w, 429, "Слишком много запросов. Попробуйте через минуту.")
	if w.Header().Get("Retry-After") != "60" {
		t.Fatalf("Retry-After %q", w.Header().Get("Retry-After"))
	}
	// Without a trusted proxy, spoofed headers do not open a new window.
	expect(t, c.call("POST", "/api/login", bad, "X-Forwarded-For", "203.0.113.9"), 429, "")
	for i := 0; i < 6; i++ {
		c.call("POST", "/api/register", `{"email":"r`+string(rune('a'+i))+`@y.zz","password":"12345678"}`)
	}
	expect(t, c.call("POST", "/api/register", `{"email":"last@y.zz","password":"12345678"}`), 429, "")
}

func TestAnalytics(t *testing.T) {
	s := newTestServer(t, config.Config{})
	c := newClient(t, s)
	expect(t, c.call("POST", "/api/analytics", `{"event":"home_view"}`), 200, "")
	expect(t, c.call("POST", "/api/analytics", `{ "event" : "home_view" }`), 200, "")
	expect(t, c.call("POST", "/api/analytics", `{"event":"other"}`), 400, "Неизвестное событие.")
	expect(t, c.call("POST", "/api/analytics", `{"event":"home_view","email":"a@b.c"}`), 400, "Неизвестное событие.")
	expect(t, c.call("POST", "/api/analytics", `{"event":"`+strings.Repeat("x", 200)+`"}`), 413, "")
}
