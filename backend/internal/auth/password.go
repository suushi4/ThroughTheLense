// Package auth hashes passwords, issues session tokens and limits attempts.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// OWASP argon2id baseline: 19 MiB, 2 passes, 1 lane. Small enough for a
// shared-CPU VM, and the hashing semaphore bounds total memory.
const (
	memoryKiB = 19 * 1024
	passes    = 2
	lanes     = 1
	keyLen    = 32
	saltLen   = 16
)

var (
	ErrMismatch = errors.New("password mismatch")
	b64         = base64.RawStdEncoding
	hashing     = make(chan struct{}, 4)
	// dummy is verified for unknown addresses so login takes the same time
	// whether or not the account exists.
	dummy = mustHash("timing-equaliser-not-a-password")
)

func mustHash(p string) string {
	h, err := HashPassword(p)
	if err != nil {
		panic(err)
	}
	return h
}

func derive(password string, salt []byte, m uint32, t uint32, p uint8, n uint32) []byte {
	hashing <- struct{}{}
	defer func() { <-hashing }()
	return argon2.IDKey([]byte(password), salt, t, m, p, n)
}

// HashPassword returns a PHC string: $argon2id$v=19$m=…,t=…,p=…$salt$key.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := derive(password, salt, memoryKiB, passes, lanes, keyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memoryKiB, passes, lanes, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// VerifyPassword checks password against a PHC string. An empty encoded hash
// (unknown account) is checked against a dummy and always fails.
func VerifyPassword(password, encoded string) error {
	if encoded == "" {
		VerifyPassword(password, dummy)
		return ErrMismatch
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return fmt.Errorf("unsupported password hash")
	}
	var version int
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return fmt.Errorf("unsupported argon2 version")
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return fmt.Errorf("bad argon2 parameters")
	}
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return err
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil {
		return err
	}
	got := derive(password, salt, m, t, p, uint32(len(want)))
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return ErrMismatch
	}
	return nil
}

// NewToken returns a 43-character URL-safe session token (32 random bytes),
// the same shape secrets.token_urlsafe(32) produces in account_server.py.
func NewToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// TokenHash is what the database stores instead of the token.
func TokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// NewID returns 32 hex characters, like secrets.token_hex(16).
func NewID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
