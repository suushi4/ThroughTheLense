// Package config reads server settings from the environment.
package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Port    string
	Addr    string // listen address
	DataDir string
	WebDir  string
	// PublicBaseURL is the deployed origin such as https://ttl.fly.dev. When it
	// is empty the server behaves like serve.py: loopback only.
	PublicBaseURL string
	// TrustProxy makes rate limiting use the client address reported by the
	// platform proxy (Fly-Client-IP, X-Forwarded-For).
	TrustProxy  bool
	SupabaseURL string
	SupabaseKey string
	MaxUploads  int
}

func Load() (Config, error) {
	c := Config{
		Port:          env("PORT", "8080"),
		DataDir:       env("DATA_DIR", "data"),
		WebDir:        env("WEB_DIR", defaultWebDir()),
		PublicBaseURL: strings.TrimRight(env("PUBLIC_BASE_URL", ""), "/"),
		SupabaseURL:   env("SUPABASE_URL", ""),
		SupabaseKey:   env("SUPABASE_PUBLISHABLE_KEY", ""),
	}
	if _, err := strconv.Atoi(c.Port); err != nil {
		return c, fmt.Errorf("PORT must be a number")
	}
	var err error
	if c.TrustProxy, err = envBool("TRUST_PROXY", false); err != nil {
		return c, err
	}
	if c.MaxUploads, err = envInt("MAX_CONCURRENT_UPLOADS", 2); err != nil {
		return c, err
	}
	if c.PublicBaseURL != "" {
		u, err := url.Parse(c.PublicBaseURL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" ||
			u.Path != "" || u.RawQuery != "" || u.User != nil {
			return c, fmt.Errorf("PUBLIC_BASE_URL must be an origin like https://example.org")
		}
	}
	host := "127.0.0.1"
	if c.PublicBaseURL != "" {
		host = ""
	}
	c.Addr = env("ADDR", net.JoinHostPort(host, c.Port))
	if st, err := os.Stat(filepath.Join(c.WebDir, "index.html")); err != nil || st.IsDir() {
		return c, fmt.Errorf("WEB_DIR %q has no index.html (run npm run build)", c.WebDir)
	}
	return c, nil
}

// Secure reports whether the site is served over HTTPS.
func (c Config) Secure() bool { return strings.HasPrefix(c.PublicBaseURL, "https://") }

// defaultWebDir prefers the built dist/ and falls back to web/, from the repo
// root or from backend/.
func defaultWebDir() string {
	for _, dir := range []string{"dist", "web", filepath.Join("..", "dist"), filepath.Join("..", "web")} {
		if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
			return dir
		}
	}
	return "dist"
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) (bool, error) {
	switch strings.ToLower(env(key, "")) {
	case "":
		return fallback, nil
	case "1", "true", "on", "yes":
		return true, nil
	case "0", "false", "off", "no":
		return false, nil
	}
	return false, fmt.Errorf("%s must be 1 or 0", key)
}

func envInt(key string, fallback int) (int, error) {
	v := env(key, "")
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return n, nil
}
