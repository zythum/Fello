#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_PNG="$ROOT_DIR/icons/fello.png"
ICONSET_DIR="$ROOT_DIR/icons/fello.iconset"
SCALED_PNG="$ROOT_DIR/icons/fello.scaled.png"
PADDED_PNG="$ROOT_DIR/icons/fello.padded.png"
OUT_ICNS="$ROOT_DIR/icons/fello.icns"

# The source icon already includes its intended safe area.
# You can tune this from workflow/local shell: MAC_ICON_CONTENT_SIZE=960 npm run prepare:icon:mac
CONTENT_SIZE="${MAC_ICON_CONTENT_SIZE:-1024}"

if [[ ! -f "$SRC_PNG" ]]; then
  echo "Missing source icon: $SRC_PNG" >&2
  exit 1
fi

rm -rf "$ICONSET_DIR" "$SCALED_PNG" "$PADDED_PNG"
mkdir -p "$ICONSET_DIR"

sips -z "$CONTENT_SIZE" "$CONTENT_SIZE" "$SRC_PNG" --out "$SCALED_PNG" >/dev/null
sips --padToHeightWidth 1024 1024 "$SCALED_PNG" --out "$PADDED_PNG" >/dev/null

sips -z 16 16 "$PADDED_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$PADDED_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$PADDED_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$PADDED_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$PADDED_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$PADDED_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$PADDED_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$PADDED_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$PADDED_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$PADDED_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"

rm -f "$SCALED_PNG" "$PADDED_PNG"
echo "Generated $OUT_ICNS with content size ${CONTENT_SIZE}px"
