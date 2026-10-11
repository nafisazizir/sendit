#!/bin/bash
# Full photogrammetry pass for Jawa: frames -> SfM -> plane fit -> data. Re-run after new photos.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/sfm.py
python3 scripts/fit-faces.py model/colmap/sparse-txt --pitch-px 150 --pitch-m 0.2 --region jawa-f5=0.05,0.15,0.45,0.85 --snap-m 1.5 --out model/faces-fit.json
node scripts/apply-fit.mjs model/faces-fit.json
python3 scripts/draw-quads.py src/data/jawa.json model/check
