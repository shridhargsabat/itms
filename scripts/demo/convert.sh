#!/usr/bin/env bash
# WebM(raw) -> MP4(H.264+faststart, GitHub inline player) + GIF(palette, <=3MB).
# Per-clip GIF windows skip load heads and keep payoffs (see SHOTLIST beats).
# Budgets: GIF <=3MB (800w preview; MP4 carries fidelity), MP4 <=8MB, PNG <=400KB.
set -euo pipefail
RAW="$(dirname "$0")/../../docs/demo/raw"
OUT="$(dirname "$0")/../../docs/demo"
mkdir -p "$OUT"
export PATH="$PATH:/usr/sbin"
FF="${FFMPEG:-ffmpeg}"
# Fedora's ffmpeg strips libx264 — Hermes' toolchain build has it. Fall back
# to libopenh264 (still H.264, still plays inline on GitHub).
# (No grep -q on a live pipe: SIGPIPE + pipefail would false-negative.)
ENCODERS="$("$FF" -hide_banner -encoders 2>/dev/null)"
if grep -q "libx264 " <<<"$ENCODERS"; then
  VCODEC="libx264 -preset medium -crf 23"
else
  VCODEC="libopenh264 -b:v 2M"
  echo "note: libx264 missing, using libopenh264"
fi

# clip:gif_seek:gif_len (MP4s keep full length minus 0.5s head)
clips="hero-dashboard:1:8 theme-switch:5:9 tickets-flow:1:7 cmdb-impact:1:8 mobile-nav:2:8"

for spec in $clips; do
  c="${spec%%:*}"; rest="${spec#*:}"; ss="${rest%%:*}"; len="${rest##*:}"
  src="$RAW/$c.webm"
  [ -f "$src" ] || { echo "SKIP $c (no $src)"; continue; }
  # MP4: 1280w desktop (mobile 376w — H.264 needs even width), 30fps, faststart.
  if [ "$c" = "mobile-nav" ]; then SCALE=376; else SCALE=1280; fi
  # shellcheck disable=SC2086
  "$FF" -y -loglevel error -ss 0.5 -i "$src" -vf "scale=${SCALE}:-2" -c:v $VCODEC -pix_fmt yuv420p -movflags +faststart -an "$OUT/$c.mp4"
  # GIF: 10fps, 720w desktop (mobile 375w), 128-color palette, windowed,
  # gifsicle -O3 --lossy (aurora gradients are GIF-hostile; lossy halves bytes).
  if [ "$c" = "mobile-nav" ]; then GW=375; else GW=720; fi
  PAL="$(mktemp /tmp/pal-XXXXXX.png)"
  "$FF" -y -loglevel error -ss "$ss" -t "$len" -i "$src" -vf "fps=10,scale=${GW}:-1:flags=lanczos,palettegen=max_colors=128" "$PAL"
  "$FF" -y -loglevel error -ss "$ss" -t "$len" -i "$src" -i "$PAL" -lavfi "fps=10,scale=${GW}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" "$OUT/$c.gif"
  rm -f "$PAL"
  gifsicle -O3 --lossy=60 --colors 128 -o "$OUT/$c.gif" "$OUT/$c.gif"
  echo "OK $c: $(du -h "$OUT/$c.mp4" | cut -f1) mp4 / $(du -h "$OUT/$c.gif" | cut -f1) gif"
done
# PNG finals: downscale 2x captures to 1440w / 375w, then pngquant to budget.
for p in "$RAW"/*.png; do
  base="$(basename "$p")"
  case "$base" in mobile-*) W=375;; *) W=1440;; esac
  "$FF" -y -loglevel error -i "$p" -vf "scale=${W}:-1" "$OUT/$base"
  pngquant --quality 80-95 --speed 1 --strip --force --output "$OUT/$base" "$OUT/$base"
done
ls -lh "$OUT"
