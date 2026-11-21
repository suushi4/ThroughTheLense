// Command server runs ThroughTheLense: static site plus the diary API.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"throughthelense/backend/internal/config"
	"throughthelense/backend/internal/copies"
	"throughthelense/backend/internal/httpapi"
	"throughthelense/backend/internal/store"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "purge-users" {
		if err := purgeCommand(os.Args[2:], func() (*store.Store, *copies.Dir, error) { return openData(config.DataDir()) }); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func openData(dir string) (*store.Store, *copies.Dir, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, nil, err
	}
	st, err := store.Open(filepath.Join(dir, "journal.sqlite"))
	if err != nil {
		return nil, nil, err
	}
	cp, err := copies.Open(filepath.Join(dir, "copies"))
	if err != nil {
		st.Close()
		return nil, nil, err
	}
	return st, cp, nil
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	st, cp, err := openData(cfg.DataDir)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := purgeAtStart(st, cp); err != nil {
		return err
	}
	handler, err := httpapi.New(cfg, st, cp)
	if err != nil {
		return err
	}
	defer handler.Close()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		// A 76 MiB day over a slow uplink needs minutes, not seconds.
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go sweep(ctx, st, cp)
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Printf("ThroughTheLense on %s (web %s, data %s)", cfg.Addr, cfg.WebDir, cfg.DataDir)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// sweep removes copy files left behind by interrupted saves, at start and
// then hourly.
func sweep(ctx context.Context, st *store.Store, cp *copies.Dir) {
	for {
		n, err := cp.Sweep(func(rev string) bool {
			used, err := st.HasRevision(ctx, rev)
			return used || err != nil // keep the file when unsure
		}, 10*time.Minute)
		if err != nil {
			log.Printf("sweep: %v", err)
		} else if n > 0 {
			log.Printf("sweep: removed %d stale copy files", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}
