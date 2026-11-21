package mediacheck

import (
	"bytes"
	"math"
	"testing"

	"throughthelense/backend/internal/fixture"
)

func TestImage(t *testing.T) {
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 20)...)
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"jpeg", fixture.JPEG(), "image/jpeg"},
		{"png", fixture.PNG(), "image/png"},
		{"webp", webp, "image/webp"},
		{"text named .jpg", []byte("hello, I am not a photo"), ""},
		{"exe", append([]byte("MZ\x90\x00"), make([]byte, 64)...), ""},
		{"gif", []byte("GIF89a\x01\x00\x01\x00"), ""},
		{"empty", nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Image(bytes.NewReader(c.data), int64(len(c.data)))
			if got != c.want || (c.want == "") != (err != nil) {
				t.Fatalf("Image() = %q, %v; want %q", got, err, c.want)
			}
		})
	}
}

func TestAudio(t *testing.T) {
	cases := []struct {
		name    string
		data    []byte
		mime    string
		seconds float64
		err     error
	}{
		{"wav 4s", fixture.WAV(4), "audio/wav", 4, nil},
		{"wav 60s", fixture.WAV(60), "audio/wav", 60, nil},
		{"mp3 cbr", fixture.MP3(5, false, false), "audio/mpeg", 5, nil},
		{"mp3 id3", fixture.MP3(5, true, false), "audio/mpeg", 5, nil},
		{"mp3 xing", fixture.MP3(10, true, true), "audio/mpeg", 10, nil},
		{"text", []byte("definitely not audio, just some words here"), "", 0, ErrUnsupported},
		{"jpeg", fixture.JPEG(), "", 0, ErrUnsupported},
		{"wav without data", fixture.WAV(1)[:36], "audio/wav", 0, ErrDuration},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mime, sec, err := Audio(bytes.NewReader(c.data), int64(len(c.data)))
			if err != c.err {
				t.Fatalf("err = %v, want %v", err, c.err)
			}
			if mime != c.mime {
				t.Fatalf("mime = %q, want %q", mime, c.mime)
			}
			if c.err == nil && math.Abs(sec-c.seconds) > 0.05 {
				t.Fatalf("duration = %.3f, want %.3f", sec, c.seconds)
			}
		})
	}
}
