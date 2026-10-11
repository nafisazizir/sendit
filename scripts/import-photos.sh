#!/bin/bash
# Converts raw HEIC photos into web-sized JPEGs under public/photos.
# Strips metadata (incl. GPS). Produces a 2000px "web" version and a 480px "thumb".
#
#   ./scripts/import-photos.sh            # convert everything listed below
#
# Mapping of raw file -> output name lives in scripts/photo-map.txt:
#   IMG_1942  jawa/jawa-f4-2026-10-11-anchor
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=raw-assets
OUT=public/photos
TMP=$(mktemp -d)
while read -r src name; do
  [ -z "$src" ] && continue
  case "$src" in \#*) continue;; esac
  in="$RAW/$src.HEIC"
  [ -f "$in" ] || { echo "missing $in"; continue; }
  sips -s format jpeg "$in" --out "$TMP/$src.jpg" >/dev/null
  mkdir -p "$OUT/$(dirname "$name")"
  ffmpeg -loglevel error -y -i "$TMP/$src.jpg" -map_metadata -1 -vf "scale='min(2000,iw)':-2" -q:v 4 "$OUT/$name.jpg"
  ffmpeg -loglevel error -y -i "$TMP/$src.jpg" -map_metadata -1 -vf "scale=480:-2" -q:v 6 "$OUT/$name.thumb.jpg"
  echo "$src -> $name ($(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT/$name.jpg"))"
done < scripts/photo-map.txt
rm -rf "$TMP"
