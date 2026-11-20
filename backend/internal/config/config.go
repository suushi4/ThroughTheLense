// Package config reads server settings from the environment.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Port            string
	DataDir         string
	WebDir          string
	PublicBaseURL   string
	APIEnabled      bool
	MaxDaysPerOwner int
	MaxUploads      int
}

func Load() (Config, error) {
	c := Config{
		Port:          env("PORT", "8080"),
		DataDir:       env("DATA_DIR", "data"),
		WebDir:        env("WEB_DIR", defaultWebDir()),
		PublicBaseURL: strings.TrimRight(env("PUBLIC_BASE_URL", ""), "/"),
	}
	switch strings.ToLower(env("API", "on")) {
	case "on", "1", "true":
		c.APIEnabled = true
	case "off", "0", "false":
	default:
		return c, fmt.Errorf("API must be on or off")
	}
	var err error
	if c.MaxDaysPerOwner, err = envInt("MAX_DAYS_PER_OWNER", 50); err != nil {
		return c, err
	}
	if c.MaxUploads, err = envInt("MAX_CONCURRENT_UPLOADS", 4); err != nil {
		return c, err
	}
	if st, err := os.Stat(filepath.Join(c.WebDir, "index.html")); err != nil || st.IsDir() {
		return c, fmt.Errorf("WEB_DIR %q has no index.html", c.WebDir)
	}
	return c, nil
}

// defaultWebDir finds web/ whether the server runs from the repo root or backend/.
func defaultWebDir() string {
	for _, dir := range []string{"web", filepath.Join("..", "web")} {
		if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
			return dir
		}
	}
	return "web"
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
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
