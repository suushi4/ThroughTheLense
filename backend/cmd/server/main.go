// Command server runs the ThroughTheLense journal: web/ plus the days API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"throughthelense/backend/internal/blob"
	"throughthelense/backend/internal/config"
	"throughthelense/backend/internal/days"
	"throughthelense/backend/internal/httpapi"
	"throughthelense/backend/internal/store/sqlite"
)

var version = "dev"

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	repo, err := sqlite.Open(filepath.ToSlash(filepath.Join(cfg.DataDir, "journal.db")))
	if err != nil {
		return err
	}
	defer repo.Close()
	blobs, err := blob.NewFS(filepath.Join(cfg.DataDir, "blobs"))
	if err != nil {
		return err
	}
	svc := days.NewService(repo, blobs, log, cfg.MaxDaysPerOwner)
	handler := httpapi.New(svc, blobs, log, httpapi.Options{
		WebDir: cfg.WebDir, PublicBaseURL: cfg.PublicBaseURL, APIEnabled: cfg.APIEnabled,
		MaxUploads: cfg.MaxUploads, Version: version,
	})
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       10 * time.Minute, // 56 MiB uploads on a slow connection
		IdleTimeout:       2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", "http://localhost:"+cfg.Port, "web", cfg.WebDir, "data", cfg.DataDir, "api", cfg.APIEnabled, "version", version)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("shutting down")
		shut, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := srv.Shutdown(shut); err != nil {
			return err
		}
	}
	return nil
}
