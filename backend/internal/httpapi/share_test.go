package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"throughthelense/backend/internal/config"
	"throughthelense/backend/internal/fixture"
)

// shareableBody is a PUT body whose copy passes the strict check.
func shareableBody(title string, editing bool) string {
	b64 := base64.StdEncoding.EncodeToString
	copy := map[string]any{
		"format": "ThroughTheLense/day", "version": 1, "dayDate": "2026-11-17",
		"title": title, "text": "Мы вышли на улицу после дождя.", "audioName": "Маршрут",
		"quote": "после дождя", "coverIndex": 0,
		"photos": []any{map[string]any{"name": "a.jpg", "type": "image/jpeg", "data": b64(fixture.JPEG())}},
		"audio":  map[string]any{"name": "t.wav", "type": "audio/wav", "data": b64(fixture.WAV(4))},
		"cues":   map[string]any{},
	}
	body, _ := json.Marshal(map[string]any{
		"summary": map[string]any{"dayDate": "2026-11-17", "title": title, "audioName": "Маршрут", "photoCount": 1,
			"thumbnail": "data:image/jpeg;base64," + b64(fixture.JPEG()), "duration": 4},
		"copy": copy, "editing": editing,
	})
	return string(body)
}

func TestShareLifecycle(t *testing.T) {
	s := newTestServer(t, config.Config{})
	owner := signedIn(t, s, "owner@example.org")
	anon := newClient(t, s)
	const id = "share-0001"

	expect(t, owner.call("POST", "/api/days/"+id+"/share", ""), 404, "День не найден.")
	expect(t, owner.call("PUT", "/api/days/"+id, shareableBody(`Прогулка <script>`, false)), 200, "")
	if v := decode(t, owner.call("GET", "/api/days/"+id+"/share", "")); v["slug"] != nil {
		t.Fatalf("unshared day has a slug: %v", v)
	}
	w := owner.call("POST", "/api/days/"+id+"/share", "")
	expect(t, w, 200, "")
	link := decode(t, w)
	slug := link["slug"].(string)
	if len(slug) != 22 || link["url"] != "http://127.0.0.1:8080/d/"+slug {
		t.Fatalf("link %v", link)
	}
	if again := decode(t, owner.call("POST", "/api/days/"+id+"/share", "")); again["slug"] != slug {
		t.Fatal("sharing twice made a second link")
	}
	if v := decode(t, owner.call("GET", "/api/days/"+id+"/share", "")); v["slug"] != slug {
		t.Fatalf("share state %v", v)
	}

	// Anyone with the link sees the day, nothing else.
	w = anon.call("GET", "/api/public/"+slug, "")
	expect(t, w, 200, "")
	if w.Header().Get("X-Robots-Tag") != "noindex" || !strings.Contains(w.Body.String(), `"quote":"после дождя"`) {
		t.Fatalf("public copy %v %.80s", w.Header(), w.Body)
	}
	if strings.Contains(w.Body.String(), "owner@example.org") || strings.Contains(w.Body.String(), id) {
		t.Fatal("public copy leaks owner or id")
	}
	cover := anon.call("GET", "/api/public/"+slug+"/cover", "")
	if cover.Code != 200 || cover.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("cover %d %v", cover.Code, cover.Header())
	}
	page := do(s, "GET", "/d/"+slug, nil)
	body := page.Body.String()
	if page.Code != 200 || !strings.Contains(body, `<meta property="og:title" content="Прогулка &lt;script&gt;">`) ||
		!strings.Contains(body, `content="http://127.0.0.1:8080/api/public/`+slug+`/cover"`) || strings.Contains(body, "<script>") {
		t.Fatalf("share page %d %s", page.Code, body)
	}
	expect(t, anon.call("POST", "/api/public/"+slug, ""), 405, "")
	expect(t, anon.call("GET", "/api/public/short", ""), 404, "Адрес не найден.")
	expect(t, anon.call("GET", "/api/public/"+strings.Repeat("A", 22), ""), 404, "Ссылка не найдена или отозвана.")
	if do(s, "GET", "/d/"+strings.Repeat("A", 22), nil).Code != 404 {
		t.Fatal("unknown share page should be 404")
	}

	// Another account can neither share nor revoke the owner's day.
	other := signedIn(t, s, "other@example.org")
	expect(t, other.call("POST", "/api/days/"+id+"/share", ""), 404, "День не найден.")
	expect(t, other.call("DELETE", "/api/days/"+id+"/share", ""), 200, "")
	expect(t, anon.call("GET", "/api/public/"+slug, ""), 200, "")
	// Sharing needs the CSRF guard like every other change.
	expect(t, owner.call("DELETE", "/api/days/"+id+"/share", "", "X-Diary-Request", ""), 403, "")

	// An edit that no longer passes the strict check unpublishes the day;
	// fixing it brings the same link back.
	expect(t, owner.call("PUT", "/api/days/"+id, dayBody("Сломан", true)), 200, "")
	expect(t, anon.call("GET", "/api/public/"+slug, ""), 404, "Ссылка не найдена или отозвана.")
	if do(s, "GET", "/d/"+slug, nil).Code != 404 {
		t.Fatal("unverified edit still has a page")
	}
	expect(t, owner.call("PUT", "/api/days/"+id, shareableBody("Исправлен", true)), 200, "")
	if !strings.Contains(anon.call("GET", "/api/public/"+slug, "").Body.String(), "Исправлен") {
		t.Fatal("fixed edit not served under the same link")
	}

	expect(t, owner.call("DELETE", "/api/days/"+id+"/share", ""), 200, "")
	expect(t, anon.call("GET", "/api/public/"+slug, ""), 404, "Ссылка не найдена или отозвана.")
	expect(t, anon.call("GET", "/api/public/"+slug+"/cover", ""), 404, "")

	// Deleting the day drops its link.
	slug = decode(t, owner.call("POST", "/api/days/"+id+"/share", ""))["slug"].(string)
	expect(t, owner.call("DELETE", "/api/days/"+id, ""), 200, "")
	expect(t, anon.call("GET", "/api/public/"+slug, ""), 404, "")
	if v := decode(t, owner.call("GET", "/api/days/"+id+"/share", "")); v["slug"] != nil {
		t.Fatal("link survived deleting the day")
	}
}

func TestShareRejectsUnverifiedCopy(t *testing.T) {
	s := newTestServer(t, config.Config{})
	owner := signedIn(t, s, "strict@example.org")
	// dayBody's media are a few placeholder bytes: fine to store, not to publish.
	expect(t, owner.call("PUT", "/api/days/strict-01", dayBody("Заглушка", false)), 200, "")
	w := owner.call("POST", "/api/days/strict-01/share", "")
	expect(t, w, 422, "")
	if msg := decode(t, w)["message"].(string); !strings.HasPrefix(msg, "Этот день нельзя опубликовать. ") {
		t.Fatalf("message %q", msg)
	}
	if v := decode(t, owner.call("GET", "/api/days/strict-01/share", "")); v["slug"] != nil {
		t.Fatal("rejected day got a link")
	}
}
