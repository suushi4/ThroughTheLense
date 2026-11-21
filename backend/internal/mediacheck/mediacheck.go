// Package mediacheck identifies uploads by their bytes, never by name or
// client-declared type, and measures audio duration.
package mediacheck

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
)

var (
	ErrUnsupported = errors.New("unsupported format")
	ErrDuration    = errors.New("duration unknown")
)

func head(r io.ReaderAt, size int64, n int) []byte {
	if int64(n) > size {
		n = int(size)
	}
	b := make([]byte, n)
	n, _ = r.ReadAt(b, 0)
	return b[:n]
}

// Image returns image/jpeg, image/png or image/webp.
func Image(r io.ReaderAt, size int64) (string, error) {
	switch t := http.DetectContentType(head(r, size, 512)); t {
	case "image/jpeg", "image/png", "image/webp":
		return t, nil
	}
	return "", ErrUnsupported
}

// Audio returns the MIME type and duration in seconds of a WAV or MP3 file.
func Audio(r io.ReaderAt, size int64) (string, float64, error) {
	h := head(r, size, 12)
	if len(h) == 12 && string(h[:4]) == "RIFF" && string(h[8:12]) == "WAVE" {
		d, err := wavDuration(r, size)
		return "audio/wav", d, err
	}
	data := make([]byte, size)
	if _, err := r.ReadAt(data, 0); err != nil && !errors.Is(err, io.EOF) {
		return "", 0, err
	}
	d, err := mp3Duration(data)
	if errors.Is(err, ErrUnsupported) {
		return "", 0, err
	}
	return "audio/mpeg", d, err
}

func wavDuration(r io.ReaderAt, size int64) (float64, error) {
	var byteRate uint32
	off := int64(12)
	hdr := make([]byte, 8)
	for off+8 <= size {
		if _, err := r.ReadAt(hdr, off); err != nil {
			return 0, ErrDuration
		}
		id, n := string(hdr[:4]), int64(binary.LittleEndian.Uint32(hdr[4:]))
		body := off + 8
		switch id {
		case "fmt ":
			f := make([]byte, 16)
			if n < 16 {
				return 0, ErrUnsupported
			}
			if _, err := r.ReadAt(f, body); err != nil {
				return 0, ErrDuration
			}
			byteRate = binary.LittleEndian.Uint32(f[8:12])
		case "data":
			if byteRate == 0 {
				return 0, ErrDuration
			}
			if n == 0xFFFFFFFF || body+n > size {
				n = size - body // streamed or truncated header
			}
			return float64(n) / float64(byteRate), nil
		}
		off = body + n + n%2
	}
	return 0, ErrDuration
}

var (
	// bitrates[version is MPEG1][layer index] in kbit/s; layer index 0=I,1=II,2=III.
	bitratesV1 = [3][16]int{
		{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448},
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384},
		{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320},
	}
	bitratesV2 = [3][16]int{
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256},
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160},
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160},
	}
	sampleRates = [4][3]int{{11025, 12000, 8000}, {}, {22050, 24000, 16000}, {44100, 48000, 32000}}
)

type frame struct {
	length, samples, rate int
	mpeg1, mono           bool
}

func parseFrame(b []byte) (frame, bool) {
	if len(b) < 4 || b[0] != 0xFF || b[1]&0xE0 != 0xE0 {
		return frame{}, false
	}
	version, layerBits := (b[1]>>3)&3, (b[1]>>1)&3
	brIdx, srIdx, pad := int(b[2]>>4), int((b[2]>>2)&3), int((b[2]>>1)&1)
	if version == 1 || layerBits == 0 || brIdx == 0 || brIdx == 15 || srIdx == 3 {
		return frame{}, false
	}
	layer := 3 - int(layerBits) // 0=I, 1=II, 2=III
	f := frame{rate: sampleRates[version][srIdx], mpeg1: version == 3, mono: b[3]>>6 == 3}
	br := bitratesV2[layer][brIdx]
	if f.mpeg1 {
		br = bitratesV1[layer][brIdx]
	}
	br *= 1000
	switch {
	case layer == 0:
		f.samples = 384
		f.length = (12*br/f.rate + pad) * 4
	case layer == 2 && !f.mpeg1:
		f.samples = 576
		f.length = 72*br/f.rate + pad
	default:
		f.samples = 1152
		f.length = 144*br/f.rate + pad
	}
	return f, f.length > 4
}

func mp3Duration(data []byte) (float64, error) {
	pos := 0
	if len(data) >= 10 && string(data[:3]) == "ID3" {
		size := int(data[6]&0x7F)<<21 | int(data[7]&0x7F)<<14 | int(data[8]&0x7F)<<7 | int(data[9]&0x7F)
		pos = 10 + size
		if data[5]&0x10 != 0 {
			pos += 10
		}
	}
	// Find the first frame whose successor is also a frame, to skip false syncs.
	limit, found := min(len(data), pos+64<<10), false
	for ; pos+4 <= limit; pos++ {
		if f, ok := parseFrame(data[pos:]); ok {
			next := pos + f.length
			if next+4 > len(data) {
				found = true
				break
			}
			if _, ok := parseFrame(data[next:]); ok {
				found = true
				break
			}
		}
	}
	if !found {
		return 0, ErrUnsupported
	}
	first, _ := parseFrame(data[pos:])
	if d, ok := vbrDuration(data[pos:], first); ok {
		return d, nil
	}
	var samples float64
	frames := 0
	for pos+4 <= len(data) {
		f, ok := parseFrame(data[pos:])
		if !ok {
			break
		}
		samples += float64(f.samples) / float64(f.rate)
		frames++
		pos += f.length
	}
	if frames < 2 {
		return 0, ErrDuration
	}
	return samples, nil
}

// vbrDuration reads the frame count from a Xing/Info or VBRI header.
func vbrDuration(b []byte, f frame) (float64, bool) {
	side := 32
	switch {
	case f.mpeg1 && f.mono:
		side = 17
	case !f.mpeg1 && f.mono:
		side = 9
	case !f.mpeg1:
		side = 17
	}
	frames := 0
	if x := 4 + side; len(b) >= x+12 && (bytes.Equal(b[x:x+4], []byte("Xing")) || bytes.Equal(b[x:x+4], []byte("Info"))) {
		if binary.BigEndian.Uint32(b[x+4:])&1 != 0 {
			frames = int(binary.BigEndian.Uint32(b[x+8:]))
		}
	} else if v := 36; len(b) >= v+18 && bytes.Equal(b[v:v+4], []byte("VBRI")) {
		frames = int(binary.BigEndian.Uint32(b[v+14:]))
	}
	if frames <= 0 {
		return 0, false
	}
	return float64(frames) * float64(f.samples) / float64(f.rate), true
}
