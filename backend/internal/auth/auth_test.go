package auth

import (
	"strings"
	"testing"
	"time"
)

func TestPassword(t *testing.T) {
	h, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("hash %q", h)
	}
	if VerifyPassword("correct horse", h) != nil {
		t.Fatal("right password rejected")
	}
	if VerifyPassword("correct horsE", h) == nil {
		t.Fatal("wrong password accepted")
	}
	if VerifyPassword("anything", "") == nil {
		t.Fatal("empty hash accepted")
	}
	if h2, _ := HashPassword("correct horse"); h2 == h {
		t.Fatal("salt not random")
	}
}

func TestToken(t *testing.T) {
	if tok := NewToken(); len(tok) != 43 || strings.ContainsAny(tok, "+/=") {
		t.Fatalf("token %q", tok)
	}
	if len(TokenHash("x")) != 64 || len(NewID()) != 32 {
		t.Fatal("bad lengths")
	}
}

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiter(2, time.Minute)
	l.now = func() time.Time { return now }
	// Two attempts fit the window, the third is refused.
	for i, want := range []bool{true, true, false} {
		if got := l.Allow("a"); got != want {
			t.Fatalf("attempt %d: allowed=%v, want %v", i+1, got, want)
		}
	}
	if !l.Allow("b") {
		t.Fatal("keys share a window")
	}
	now = now.Add(61 * time.Second)
	if !l.Allow("a") {
		t.Fatal("window did not slide")
	}
}
