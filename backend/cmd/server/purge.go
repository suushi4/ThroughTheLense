package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"throughthelense/backend/internal/copies"
	"throughthelense/backend/internal/store"
)

// purge removes test accounts by email suffix. It runs either as
//
//	server purge-users --email-suffix @example.org [--apply]
//
// or once at start-up when TTL_PURGE_EMAIL_SUFFIX is set (TTL_PURGE_APPLY=1
// to delete), which is how it runs on Railway where the image has no shell.
// Without apply it only reports what would be deleted.
func purge(ctx context.Context, st *store.Store, cp *copies.Dir, suffix string, apply bool) error {
	r, err := st.PurgeUsers(ctx, suffix, apply)
	if err != nil {
		return err
	}
	verb := "would delete"
	if apply {
		verb = "deleted"
		for _, rev := range r.Revisions {
			cp.Remove(rev) // leftovers are collected by the sweep
		}
	}
	log.Printf("purge: %s %d accounts ending in %s and %d days", verb, len(r.Emails), suffix, r.Days)
	if len(r.Emails) > 0 {
		log.Printf("purge: accounts: %s", strings.Join(r.Emails, ", "))
	}
	if !apply {
		log.Printf("purge: dry run, nothing changed (set TTL_PURGE_APPLY=1 or pass --apply)")
	}
	return nil
}

// purgeCommand handles the purge-users subcommand against DATA_DIR.
func purgeCommand(args []string, open func() (*store.Store, *copies.Dir, error)) error {
	fs := flag.NewFlagSet("purge-users", flag.ContinueOnError)
	suffix := fs.String("email-suffix", "", "delete accounts whose email ends with this, e.g. @example.org")
	apply := fs.Bool("apply", false, "actually delete (default: dry run)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *suffix == "" {
		fs.Usage()
		return fmt.Errorf("--email-suffix is required")
	}
	st, cp, err := open()
	if err != nil {
		return err
	}
	defer st.Close()
	return purge(context.Background(), st, cp, *suffix, *apply)
}

func purgeAtStart(st *store.Store, cp *copies.Dir) error {
	suffix := os.Getenv("TTL_PURGE_EMAIL_SUFFIX")
	if suffix == "" {
		return nil
	}
	return purge(context.Background(), st, cp, suffix, os.Getenv("TTL_PURGE_APPLY") == "1")
}
