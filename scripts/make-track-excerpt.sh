#!/bin/sh
# Cut a diary track from a longer recording.
#
#   scripts/make-track-excerpt.sh <input> <output.mp3> [start seconds] [length seconds]
#
# 40 s by default, 0.3 s fade-in, 2 s fade-out, loudness -18 LUFS like the
# demo tracks, constant 128 kbit/s MP3 (the server measures duration from
# the frames before a day is shared). Needs ffmpeg in PATH.
set -eu
in=$1; out=$2; start=${3:-0}; length=${4:-40}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
ffmpeg -nostdin -hide_banner -loglevel error -ss "$start" -t "$length" -i "$in" -ac 2 -ar 44100 \
  -af "afade=t=in:d=0.3,afade=t=out:st=$((length - 2)):d=2" -c:a pcm_s16le "$tmp/cut.wav"
stats=$(ffmpeg -nostdin -hide_banner -i "$tmp/cut.wav" -af loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { printf '%s' "$stats" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
ffmpeg -nostdin -hide_banner -loglevel error -y -i "$tmp/cut.wav" \
  -af "loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" \
  -ar 44100 -c:a libmp3lame -b:a 128k -map_metadata -1 "$out"
printf '%s %s KB\n' "$out" "$(( $(wc -c < "$out") / 1024 ))"
