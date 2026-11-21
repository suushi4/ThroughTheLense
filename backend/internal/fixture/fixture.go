// Package fixture builds small valid media files for tests.
package fixture

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
)

func img() image.Image {
	m := image.NewRGBA(image.Rect(0, 0, 4, 3))
	for i := range m.Pix {
		m.Pix[i] = byte(i * 7)
	}
	m.Set(0, 0, color.RGBA{200, 120, 40, 255})
	return m
}

func JPEG() []byte {
	var b bytes.Buffer
	jpeg.Encode(&b, img(), nil)
	return b.Bytes()
}

func PNG() []byte {
	var b bytes.Buffer
	png.Encode(&b, img())
	return b.Bytes()
}

// WAV returns 8 kHz mono 8-bit silence of the given length.
func WAV(seconds float64) []byte {
	const rate = 8000
	n := int(seconds * rate)
	var b bytes.Buffer
	w := func(v any) { binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	w(uint32(36 + n))
	b.WriteString("WAVEfmt ")
	w(uint32(16))
	w(uint16(1))    // PCM
	w(uint16(1))    // mono
	w(uint32(rate)) // sample rate
	w(uint32(rate)) // byte rate
	w(uint16(1))    // block align
	w(uint16(8))    // bits
	b.WriteString("data")
	w(uint32(n))
	b.Write(bytes.Repeat([]byte{128}, n))
	return b.Bytes()
}

// MP3 returns MPEG-1 Layer III 128 kbit/s 44.1 kHz stereo frames of silence,
// optionally behind an ID3v2 tag and with a Xing header frame.
func MP3(seconds float64, id3, xing bool) []byte {
	const frameLen = 417 // 144*128000/44100
	frames := int(seconds * 44100 / 1152)
	frame := func() []byte {
		f := make([]byte, frameLen)
		copy(f, []byte{0xFF, 0xFB, 0x90, 0x00})
		return f
	}
	var b bytes.Buffer
	if id3 {
		b.Write([]byte{'I', 'D', '3', 4, 0, 0, 0, 0, 0, 20})
		b.Write(make([]byte, 20))
	}
	if xing {
		f := frame()
		copy(f[36:], "Xing")
		binary.BigEndian.PutUint32(f[40:], 1)
		binary.BigEndian.PutUint32(f[44:], uint32(frames))
		b.Write(f)
	}
	for range frames {
		b.Write(frame())
	}
	return b.Bytes()
}
