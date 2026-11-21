#!/bin/sh
# Turn a field recording into a seamless, loudness-matched ambience loop.
#
#   scripts/make-ambience-loop.sh <input file or URL> <output.mp3> [start seconds]
#
# Takes LOOP seconds from the start offset plus FADE seconds more, folds the
# extra tail into the head with an equal-power crossfade (so the end flows
# into the beginning), normalises to -28 LUFS / -3 dBTP and writes 64 kbit/s
# stereo MP3 (about 230 KB for 28 s). Needs ffmpeg in PATH, and curl for URLs.
# For a URL, BYTES limits the download to the first BYTES bytes, which is
# enough for WAV, FLAC and Ogg sources as long as it covers start + 31 s.
set -eu
in=$1; out=$2; start=${3:-0}
LOOP=${LOOP:-28}; FADE=${FADE:-3}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
case "$in" in
  http://*|https://*)
    curl -fsSL -A 'ThroughTheLense/1.0 (ambience loops)' ${BYTES:+-r 0-$BYTES} -o "$tmp/source" "$in"
    in=$tmp/source ;;
esac

ffmpeg -nostdin -hide_banner -loglevel error -ss "$start" -t "$((LOOP + FADE))" -i "$in" \
  -ac 2 -ar 44100 -c:a pcm_s16le "$tmp/seg.wav"
ffmpeg -nostdin -hide_banner -loglevel error -i "$tmp/seg.wav" -filter_complex "
  [0]asplit=3[a][b][c];
  [a]atrim=0:$FADE,asetpts=PTS-STARTPTS,afade=t=in:d=$FADE:curve=qsin[head];
  [b]atrim=$LOOP:$((LOOP + FADE)),asetpts=PTS-STARTPTS,afade=t=out:d=$FADE:curve=qsin[tail];
  [head][tail]amix=inputs=2:normalize=0[joint];
  [c]atrim=$FADE:$LOOP,asetpts=PTS-STARTPTS[body];
  [joint][body]concat=n=2:v=0:a=1[loop]" -map '[loop]' -c:a pcm_s16le "$tmp/loop.wav"

# Two-pass loudness normalisation so every loop sits at the same level.
stats=$(ffmpeg -nostdin -hide_banner -i "$tmp/loop.wav" -af loudnorm=I=-28:TP=-3:LRA=7:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { printf '%s' "$stats" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
ffmpeg -nostdin -hide_banner -loglevel error -y -i "$tmp/loop.wav" \
  -af "loudnorm=I=-28:TP=-3:LRA=7:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" \
  -ar 44100 -c:a libmp3lame -b:a 64k -map_metadata -1 "$out"
printf '%s %s KB\n' "$out" "$(( $(wc -c < "$out") / 1024 ))"
