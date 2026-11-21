package httpapi

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

func init() {
	// System mime tables differ (the Windows registry may map .mjs to
	// something browsers refuse as a module), so pin what the site uses.
	for ext, typ := range map[string]string{
		".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
		".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
		".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg",
		".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
		".xml": "application/xml; charset=utf-8", ".json": "application/json; charset=utf-8",
	} {
		mime.AddExtensionType(ext, typ)
	}
}

var publicPages = []string{"/", "/privacy.html", "/terms.html"}

// static serves WEB_DIR like serve.py: no directory listings, 404.html for
// missing files, byte ranges for media, and no caching of code and pages so
// the frontend's own ?v= versioning keeps working.
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Метод недоступен.", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	switch p {
	case "/robots.txt":
		s.robots(w, r)
		return
	case "/sitemap.xml":
		s.sitemap(w, r)
		return
	}
	if m := sharePagePath.FindStringSubmatch(p); m != nil {
		s.sharePage(w, r, m[1])
		return
	}
	name, ok := filePath(p)
	if !ok {
		s.notFound(w, r)
		return
	}
	f, err := s.web.Open(name)
	if err != nil {
		s.notFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		s.notFound(w, r)
		return
	}
	cacheHeaders(w, name)
	// ServeContent handles HEAD, Range (206/416) and conditional requests.
	http.ServeContent(w, r, name, st.ModTime(), f)
}

// filePath maps a URL path to a name inside WEB_DIR. Hidden segments are
// refused; os.Root already refuses escapes and symlinks out of the tree.
func filePath(p string) (string, bool) {
	if !strings.HasPrefix(p, "/") || strings.Contains(p, "\x00") {
		return "", false
	}
	if strings.HasSuffix(p, "/") {
		p += "index.html"
	}
	clean := path.Clean(p)
	for _, seg := range strings.Split(clean, "/") {
		if strings.HasPrefix(seg, ".") {
			return "", false
		}
	}
	name := strings.TrimPrefix(clean, "/")
	return name, fs.ValidPath(name) && name != "."
}

func cacheHeaders(w http.ResponseWriter, name string) {
	switch path.Ext(name) {
	case ".html", ".js", ".mjs", ".css":
		w.Header().Set("Cache-Control", "no-store")
	default:
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	page, err := s.web.ReadFile("404.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		w.Write(page)
	}
}

// origin is the address used in robots.txt and sitemap.xml. Locally it
// matches serve.py, which always names 127.0.0.1.
func (s *Server) origin() string {
	if s.cfg.PublicBaseURL != "" {
		return s.cfg.PublicBaseURL
	}
	return "http://127.0.0.1:" + s.cfg.Port
}

func (s *Server) robots(w http.ResponseWriter, r *http.Request) {
	rule := "Disallow: /\n"
	if s.cfg.PublicBaseURL != "" {
		rule = "Allow: /\n"
	}
	textReply(w, r, "text/plain; charset=utf-8", "User-agent: *\n"+rule+"Sitemap: "+s.origin()+"/sitemap.xml\n")
}

func (s *Server) sitemap(w http.ResponseWriter, r *http.Request) {
	var b strings.Builder
	b.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n")
	for _, route := range publicPages {
		b.WriteString("  <url><loc>" + s.origin() + route + "</loc></url>\n")
	}
	b.WriteString("</urlset>\n")
	textReply(w, r, "application/xml; charset=utf-8", b.String())
}

func textReply(w http.ResponseWriter, r *http.Request, typ, body string) {
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodHead {
		w.Write([]byte(body))
	}
}
