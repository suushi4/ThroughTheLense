package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"throughthelense/backend/internal/config"
)

func dayBody(title string, editing bool) string {
	copy := fmt.Sprintf(`{"format":"ThroughTheLense/day","version":1,"title":%q,"text":"a b","quote":"a",`+
		`"coverIndex":0,"photos":[{"name":"p.jpg","type":"image/jpeg","data":"/9j/"}],`+
		`"audio":{"name":"t.wav","type":"audio/wav","data":"UklGRg=="},"cues":{}}`, title)
	return fmt.Sprintf(`{"summary":{"dayDate":"2026-11-17","title":%q,"audioName":"t","photoCount":1,`+
		`"thumbnail":"data:image/jpeg;base64,AA==","duration":8,"id":"spoofed"},"copy":%s,"editing":%t}`, title, copy, editing)
}

func signedIn(t *testing.T, s *Server, email string) *client {
	c := newClient(t, s)
	c.ip = "192.0.2." + fmt.Sprint(len(email)) + ":1"
	expect(t, c.call("POST", "/api/register", `{"email":"`+email+`","password":"12345678"}`), 200, "")
	return c
}

func listTitles(t *testing.T, c *client) map[string]string {
	t.Helper()
	w := c.call("GET", "/api/days", "")
	expect(t, w, 200, "")
	var body struct{ Days []map[string]any }
	json.Unmarshal(w.Body.Bytes(), &body)
	out := map[string]string{}
	for _, d := range body.Days {
		out[d["id"].(string)] = d["title"].(string)
	}
	return out
}

func copyFiles(t *testing.T, s *Server) int {
	entries, _ := os.ReadDir(s.copies.Path())
	return len(entries)
}

func TestDayLifecycle(t *testing.T) {
	s := newTestServer(t, config.Config{})
	a := signedIn(t, s, "a@example.org")
	const id = "day-0001"

	expect(t, a.call("GET", "/api/days/"+id, ""), 404, "День не найден.")
	expect(t, a.call("PUT", "/api/days/"+id, dayBody("Первый", true)), 404, "День уже удалён.")
	if copyFiles(t, s) != 0 {
		t.Fatal("failed edit left a file")
	}
	expect(t, a.call("PUT", "/api/days/"+id, dayBody("Первый", false)), 200, "")
	if got := listTitles(t, a); got[id] != "Первый" || len(got) != 1 {
		t.Fatalf("list %v", got)
	}

	w := a.call("GET", "/api/days/"+id, "")
	expect(t, w, 200, "")
	var copy map[string]any
	json.Unmarshal(w.Body.Bytes(), &copy)
	if copy["format"] != "ThroughTheLense/day" || copy["title"] != "Первый" || copy["copy"] != nil {
		t.Fatalf("copy %v", copy)
	}

	// Creating again with the same id keeps the original.
	expect(t, a.call("PUT", "/api/days/"+id, dayBody("Дубликат", false)), 200, "")
	if listTitles(t, a)[id] != "Первый" || copyFiles(t, s) != 1 {
		t.Fatal("create overwrote an existing day")
	}
	expect(t, a.call("PUT", "/api/days/"+id, dayBody("Изменён", true)), 200, "")
	if listTitles(t, a)[id] != "Изменён" || copyFiles(t, s) != 1 {
		t.Fatal("edit did not replace the copy")
	}
	if !strings.Contains(a.call("GET", "/api/days/"+id, "").Body.String(), "Изменён") {
		t.Fatal("copy and summary disagree")
	}

	// Another account sees nothing and cannot touch the day.
	b := signedIn(t, s, "b@example.org")
	if len(listTitles(t, b)) != 0 {
		t.Fatal("days leaked across accounts")
	}
	expect(t, b.call("GET", "/api/days/"+id, ""), 404, "День не найден.")
	expect(t, b.call("PUT", "/api/days/"+id, dayBody("Чужой", true)), 404, "День уже удалён.")
	expect(t, b.call("DELETE", "/api/days/"+id, ""), 200, "")
	if listTitles(t, a)[id] != "Изменён" {
		t.Fatal("another account deleted the day")
	}
	// The same id in another account is a separate day.
	expect(t, b.call("PUT", "/api/days/"+id, dayBody("Свой", false)), 200, "")
	if listTitles(t, a)[id] != "Изменён" || listTitles(t, b)[id] != "Свой" {
		t.Fatal("ids collide across accounts")
	}

	expect(t, a.call("DELETE", "/api/days/"+id, ""), 200, "")
	expect(t, a.call("DELETE", "/api/days/"+id, ""), 200, "")
	expect(t, a.call("GET", "/api/days/"+id, ""), 404, "")
	if copyFiles(t, s) != 1 {
		t.Fatal("delete left the copy file")
	}
}

func TestDayValidation(t *testing.T) {
	s := newTestServer(t, config.Config{})
	a := signedIn(t, s, "v@example.org")
	put := func(body string) (int, string) {
		w := a.call("PUT", "/api/days/day-0002", body)
		var m map[string]string
		json.Unmarshal(w.Body.Bytes(), &m)
		return w.Code, m["message"]
	}
	good := dayBody("x", false)
	bad := []string{
		strings.Replace(good, `"format":"ThroughTheLense/day"`, `"format":"other"`, 1),
		strings.Replace(good, `"version":1`, `"version":2`, 1),
		strings.Replace(good, `"summary":{`, `"summary":"text","other":{`, 1),
		strings.Replace(good, `"photos":[{"name":"p.jpg","type":"image/jpeg","data":"/9j/"}]`, `"photos":[]`, 1),
		strings.Replace(good, `"data":"/9j/"`, `"data":"`+strings.Repeat("A", encodedLimit(photoLimit)+4)+`"`, 1),
		`{"summary":{},"editing":false}`,
	}
	for i, body := range bad {
		if code, msg := put(body); code != 400 || msg != "Копия дня не распознана." {
			t.Errorf("case %d: %d %s", i, code, msg)
		}
	}
	huge := strings.Replace(good, `"thumbnail":"data:image/jpeg;base64,AA=="`, `"thumbnail":"`+strings.Repeat("A", summaryLimit)+`"`, 1)
	if code, msg := put(huge); code != 413 || msg != "Обложка слишком большая." {
		t.Errorf("summary limit: %d %s", code, msg)
	}
	if code, msg := put("{"); code != 400 || msg != "Не удалось прочитать запрос." {
		t.Errorf("broken json: %d %s", code, msg)
	}
	expect(t, a.call("PUT", "/api/days/short", good), 404, "Адрес не найден.")
	expect(t, a.call("POST", "/api/days/day-0002", good), 405, "Метод недоступен.")
	expect(t, a.call("PUT", "/api/days", good), 404, "Адрес не найден.")
	if copyFiles(t, s) != 0 {
		t.Fatal("rejected saves left files")
	}
	// The stored summary id never overrides the key.
	expect(t, a.call("PUT", "/api/days/day-0002", good), 200, "")
	if _, ok := listTitles(t, a)["day-0002"]; !ok {
		t.Fatal("summary id overrode the key")
	}
}

func TestSweep(t *testing.T) {
	s := newTestServer(t, config.Config{})
	a := signedIn(t, s, "s@example.org")
	expect(t, a.call("PUT", "/api/days/day-0003", dayBody("keep", false)), 200, "")
	orphan, err := s.copies.Write([]byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	tmp := s.copies.Path() + "/.tmp-crashed"
	os.WriteFile(tmp, []byte("partial"), 0o600)
	old := time.Now().Add(-time.Hour)
	entries, _ := os.ReadDir(s.copies.Path())
	for _, e := range entries {
		os.Chtimes(s.copies.Path()+"/"+e.Name(), old, old)
	}
	used := func(rev string) bool { ok, _ := s.store.HasRevision(t.Context(), rev); return ok }
	if n, err := s.copies.Sweep(used, 10*time.Minute); err != nil || n != 2 {
		t.Fatalf("sweep removed %d (%v), want orphan and tmp", n, err)
	}
	if _, err := os.Stat(s.copies.Path() + "/" + orphan + ".json"); !os.IsNotExist(err) {
		t.Fatal("orphan kept")
	}
	expect(t, a.call("GET", "/api/days/day-0003", ""), 200, "")
}
