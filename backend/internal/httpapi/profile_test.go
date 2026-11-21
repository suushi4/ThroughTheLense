package httpapi

import (
	"strings"
	"testing"

	"throughthelense/backend/internal/config"
)

func TestProfile(t *testing.T) {
	s := newTestServer(t, config.Config{})
	a := signedIn(t, s, "profile@example.org")

	// Without a profile the session keeps account_server.py's shape.
	w := a.call("GET", "/api/session", "")
	if strings.Contains(w.Body.String(), "name") || strings.Contains(w.Body.String(), "avatar") {
		t.Fatalf("empty profile leaks fields: %s", w.Body)
	}

	w = a.call("PATCH", "/api/profile", `{"name":"  Азат   Т.  ","avatar":"lens"}`)
	expect(t, w, 200, "")
	user := decode(t, w)["user"].(map[string]any)
	if user["name"] != "Азат Т." || user["avatar"] != "lens" || user["email"] != "profile@example.org" {
		t.Fatalf("profile %v", user)
	}
	if v := decode(t, a.call("GET", "/api/session", ""))["user"].(map[string]any); v["name"] != "Азат Т." || v["avatar"] != "lens" {
		t.Fatalf("session %v", v)
	}
	// Only the sent field changes; "" resets the avatar to the letter.
	expect(t, a.call("PATCH", "/api/profile", `{"avatar":""}`), 200, "")
	if v := decode(t, a.call("GET", "/api/session", ""))["user"].(map[string]any); v["name"] != "Азат Т." || v["avatar"] != nil {
		t.Fatalf("partial update %v", v)
	}
	// Login returns the profile too.
	other := newClient(t, s)
	other.ip = "192.0.2.200:1"
	if v := decode(t, other.call("POST", "/api/login", `{"email":"profile@example.org","password":"12345678"}`))["user"].(map[string]any); v["name"] != "Азат Т." {
		t.Fatalf("login user %v", v)
	}

	for body, message := range map[string]string{
		`{"name":"` + strings.Repeat("я", 41) + `"}`: "Имя — до 40 символов, без служебных знаков.",
		`{"name":"a\u0007b"}`:                        "Имя — до 40 символов, без служебных знаков.",
		`{"name":5}`:                                 "Имя должно быть строкой.",
		`{"avatar":"../../etc"}`:                     "Такого аватара нет.",
	} {
		expect(t, a.call("PATCH", "/api/profile", body), 400, message)
	}
	expect(t, a.call("PATCH", "/api/profile", `{"name":"x"}`, "X-Diary-Request", ""), 403, "")
	anon := newClient(t, s)
	expect(t, anon.call("PATCH", "/api/profile", `{"name":"x"}`), 401, "Войдите в аккаунт.")
	expect(t, a.call("GET", "/api/profile", ""), 404, "")
}

func TestChangePassword(t *testing.T) {
	s := newTestServer(t, config.Config{})
	a := signedIn(t, s, "pass@example.org")
	elsewhere := newClient(t, s)
	elsewhere.ip = "192.0.2.201:1"
	expect(t, elsewhere.call("POST", "/api/login", `{"email":"pass@example.org","password":"12345678"}`), 200, "")

	expect(t, a.call("POST", "/api/password", `{"current":"wrong-one","new":"new-password-1"}`), 400, "Текущий пароль не подходит.")
	expect(t, a.call("POST", "/api/password", `{"current":"12345678","new":"short"}`), 400, "Новый пароль — от 8 до 128 символов.")
	expect(t, a.call("POST", "/api/password", `{"current":"12345678"}`), 400, "Введите текущий и новый пароль.")
	expect(t, a.call("POST", "/api/password", `{"current":"12345678","new":"new-password-1"}`), 200, "")

	// This browser stays signed in, the other one is signed out.
	if decode(t, a.call("GET", "/api/session", ""))["user"] == nil {
		t.Fatal("current session ended")
	}
	if decode(t, elsewhere.call("GET", "/api/session", ""))["user"] != nil {
		t.Fatal("other session survived a password change")
	}
	fresh := newClient(t, s)
	fresh.ip = "192.0.2.202:1"
	expect(t, fresh.call("POST", "/api/login", `{"email":"pass@example.org","password":"12345678"}`), 401, "")
	expect(t, fresh.call("POST", "/api/login", `{"email":"pass@example.org","password":"new-password-1"}`), 200, "")

	for i := 0; i < 8; i++ {
		a.call("POST", "/api/password", `{"current":"guess","new":"whatever-123"}`)
	}
	expect(t, a.call("POST", "/api/password", `{"current":"guess","new":"whatever-123"}`), 429, "")
}
