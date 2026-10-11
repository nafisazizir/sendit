#!/usr/bin/env python3
"""
Draw each face's photo quad onto its anchor photo for eyeballing (no PIL needed: ffmpeg does the JPEG work).

  python3 scripts/draw-quads.py model/faces-fit.json model/check     # from a fit report
  python3 scripts/draw-quads.py src/data/jawa.json model/check        # from the app data (faces[].geometry.quad)
"""
import json, os, subprocess, sys
import numpy as np

fit_path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
doc = json.load(open(fit_path))
if "geometry" in doc:  # fit report
    quads = {fid: g.get("quad") for fid, g in doc["geometry"].items()}
    labels = {fid: f"{g.get('width_m')} m x {g.get('height')} m, lean {g.get('lean')}" for fid, g in doc["geometry"].items()}
else:  # app data
    quads = {f["id"]: (f.get("geometry") or {}).get("quad") for f in doc["faces"]}
    labels = {f["id"]: str((f.get("geometry") or {}).get("source")) for f in doc["faces"]}

W = 800  # working width


def load(path):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    w, h = map(int, probe.split(","))
    H = int(round(h * W / w))
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).copy()


def save(img, path):
    H, W_, _ = img.shape
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W_}x{H}", "-i", "-", "-q:v", "4", path], input=img.tobytes())


def line(img, p, q, colour, t=3):
    H, W_, _ = img.shape
    n = int(max(abs(q[0] - p[0]), abs(q[1] - p[1]))) + 1
    for i in range(n + 1):
        x = p[0] + (q[0] - p[0]) * i / n
        y = p[1] + (q[1] - p[1]) * i / n
        x0, x1 = int(max(0, x - t)), int(min(W_, x + t + 1))
        y0, y1 = int(max(0, y - t)), int(min(H, y + t + 1))
        if x1 > x0 and y1 > y0:
            img[y0:y1, x0:x1] = colour


for fid, quad in quads.items():
    n = fid.split("-f")[1]
    src = f"public/photos/jawa/jawa-f{n}-2026-10-11-anchor.jpg"
    if not os.path.exists(src):
        continue
    img = load(src)
    H, W_, _ = img.shape
    if quad:
        pts = [(x * W_, y * H) for x, y in quad]
        for i in range(4):
            line(img, pts[i], pts[(i + 1) % 4], (255, 230, 0))
        # mark TL with a red blob so orientation is visible
        x, y = pts[0]
        line(img, (x, y), (x, y), (255, 40, 40), t=9)
    out = os.path.join(out_dir, f"{fid}.jpg")
    save(img, out)
    print(fid, labels.get(fid), "->", out, "" if quad else "(no quad)")
