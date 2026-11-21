package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPurgeUsers(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "p.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := t.Context()
	emails := map[string]string{
		"t1": "ttl-1@example.org", "t2": "persist@example.org",
		// Look-alikes that must survive.
		"k1": "real@example.org.ru", "k2": "me@notexample.org", "k3": "example.org@gmail.com",
		"k4": "@example.org.person@mail.ru",
	}
	for id, email := range emails {
		if err := st.CreateUser(ctx, id, email, "x"); err != nil {
			t.Fatal(err)
		}
		if _, err := st.InsertDay(ctx, id, "day-"+id+"-01", "{}", "rev-"+id); err != nil {
			t.Fatal(err)
		}
		st.NewSession(ctx, "tok-"+id, id, time.Now().Add(time.Hour), "")
	}
	if _, err := st.CreateShare(ctx, "t1", "day-t1-01", "slug-t1-000000000000"); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"", "example.org", "@", "@%", "%@example.org", "@_xample.org", "@org", "@example.org;"} {
		if _, err := st.PurgeUsers(ctx, bad, true); err == nil {
			t.Errorf("suffix %q accepted", bad)
		}
	}

	dry, err := st.PurgeUsers(ctx, "@Example.ORG", false)
	if err != nil || len(dry.Emails) != 2 || dry.Days != 2 {
		t.Fatalf("dry run %+v %v", dry, err)
	}
	if _, _, err := st.UserByEmail(ctx, "persist@example.org"); err != nil {
		t.Fatal("dry run deleted an account")
	}

	r, err := st.PurgeUsers(ctx, "@example.org", true)
	if err != nil || len(r.Emails) != 2 || len(r.Revisions) != 2 {
		t.Fatalf("apply %+v %v", r, err)
	}
	for id, email := range emails {
		_, _, err := st.UserByEmail(ctx, email)
		_, dayErr := st.DayRevision(ctx, id, "day-"+id+"-01")
		_, sessErr := st.SessionUser(ctx, "tok-"+id)
		gone := id[0] == 't'
		if gone != (err == ErrNotFound) || gone != (dayErr == ErrNotFound) || gone != (sessErr == ErrNotFound) {
			t.Errorf("%s: account %v, day %v, session %v", email, err, dayErr, sessErr)
		}
	}
	if _, err := st.PublicDay(ctx, "slug-t1-000000000000"); err != ErrNotFound {
		t.Error("share link survived")
	}
	if again, _ := st.PurgeUsers(ctx, "@example.org", true); len(again.Emails) != 0 {
		t.Error("second purge found accounts")
	}
}
