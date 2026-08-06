#!/usr/bin/env bash
# walkthrough-video.sh — convert the Playwright walkthrough recording to a web-ready MP4.
#
# Playwright records VP8/WebM, and the ffmpeg it bundles is a stripped screencast build with no
# H.264 encoder and no MP4 muxer, so the conversion needs a real ffmpeg. Safari's VP8 support is
# partial, which matters for a phone-first product — hence H.264 rather than shipping the WebM.
#
#   WALKTHROUGH_VIDEO=1 npx playwright test e2e/walkthrough.spec.ts --no-deps --project=mobile-chromium
#   bash scripts/walkthrough-video.sh
#
# Writes walkthrough-frames/walkthrough.mp4 (full pace) and walkthrough-frames/walkthrough-fast.mp4
# (1.6×, for a hero loop where 95 seconds is too long).
set -euo pipefail

# Located rather than hardcoded: Playwright derives the directory from the test title, so renaming
# the test silently broke a fixed path. Newest recording wins.
SRC="$(find test-results -name '*.webm' -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)"
OUT_DIR="walkthrough-frames"

# PATH first (a new shell after `winget install` has it); fall back to the winget package path,
# which is where the binary lives before the shell is restarted.
if command -v ffmpeg >/dev/null 2>&1; then
  FF="ffmpeg"
else
  FF="$LOCALAPPDATA/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe"
fi

if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "No .webm under test-results/ — run the spec with WALKTHROUGH_VIDEO=1 first." >&2
  exit 1
fi
echo "Source: $SRC"

# crf 14 / preset veryslow: near-transparent re-encode. The source is already a lossy VP8
# screencast, so the goal is to add no further loss rather than to compress — hence the low CRF
# despite the file size. yuv420p + faststart is the combination every browser and iOS plays inline.
"$FF" -hide_banner -loglevel error -y -i "$SRC" \
  -c:v libx264 -preset veryslow -crf 14 -pix_fmt yuv420p -movflags +faststart -an \
  "$OUT_DIR/walkthrough.mp4"

# setpts speeds the video up without touching the encode quality.
"$FF" -hide_banner -loglevel error -y -i "$SRC" \
  -filter:v "setpts=PTS/1.6" -r 30 \
  -c:v libx264 -preset veryslow -crf 14 -pix_fmt yuv420p -movflags +faststart -an \
  "$OUT_DIR/walkthrough-fast.mp4"

echo "Wrote:"
ls -la "$OUT_DIR"/walkthrough*.mp4
