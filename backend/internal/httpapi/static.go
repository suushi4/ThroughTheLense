package httpapi

import (
	"bytes"
	"html"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func init() {
	// The Windows registry may map .mjs to something browsers refuse as a module.
	mime.AddExtensionType(".mjs", "text/javascript; charset=utf-8")
	mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".wav", "audio/wav")
}

// static serves web/ like serve.py: code and pages are never cached so the
// frontend's own versioning keeps working.
func static(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/" || p == "/index.html" {
			w.Header().Set("Cache-Control", "no-store")
		}
		switch path.Ext(p) {
		case ".html", ".js", ".mjs", ".css":
			w.Header().Set("Cache-Control", "no-store")
		case "":
		default:
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	})
}

// sharePage serves index.html for /d/{slug}. <base href="/"> lets the page's
// relative module and media paths resolve from the site root.
func (s *Server) sharePage(w http.ResponseWriter, r *http.Request) {
	page, err := os.ReadFile(filepath.Join(s.opts.WebDir, "index.html"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	head := `<base href="/">`
	if d, err := s.days.Public(r.Context(), r.PathValue("slug")); err == nil {
		base := s.publicURL(r)
		head += `<meta property="og:type" content="website">` +
			`<meta property="og:title" content="` + html.EscapeString(d.Title) + `">` +
			`<meta property="og:description" content="` + html.EscapeString("«"+d.Scene.Quote+"»") + `">` +
			`<meta property="og:image" content="` + html.EscapeString(base+"/media/"+d.Thumbnail.Key) + `">` +
			`<meta name="robots" content="noindex">`
	}
	page = bytes.Replace(page, []byte("<head>"), []byte("<head>"+head), 1)
	if !strings.Contains(string(page), head) {
		page = append([]byte(head), page...)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(page)
}
