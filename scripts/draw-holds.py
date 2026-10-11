#!/usr/bin/env python3
"""
Draw hold outlines onto an anchor photo so a labelling pass can be checked by eye.

  python3 scripts/draw-holds.py model/labels/jawa-f5.json model/check/holds-f5.jpg
  python3 scripts/draw-holds.py src/data/jawa.json model/check/holds-f4.jpg --face jawa-f4

Input is either a label fragment ({"faceId", "holds": [...], "problems": [...]}) or the app data file
(with --face). Outlines are drawn in their grade colour; start holds get an S, the top a T; the hold
index is printed next to each outline so it can be referred to in notes. No PIL: ffmpeg does the JPEG work.
"""
import json, os, subprocess, sys
import numpy as np

COL = {
    "yellow": (242, 213, 30), "blue": (59, 130, 246), "purple": (168, 85, 247), "green": (34, 197, 94),
    "orange": (251, 146, 60), "red": (239, 68, 68), "black": (20, 20, 20), "white": (245, 245, 245),
    "grey": (138, 138, 138), "other": (192, 132, 87),
}
W = 1000

args = sys.argv[1:]
face_opt = None
if "--face" in args:
    i = args.index("--face")
    face_opt = args[i + 1]
    del args[i : i + 2]
src_json, out = args[0], args[1]
doc = json.load(open(src_json))
if "sets" in doc:
    fid = face_opt
    s = doc["sets"][0]
    holds = [h for h in s["holds"] if h["faceId"] == fid]
    problems = s["problems"]
    photo = next(p for p in s["photos"] if p["faceId"] == fid and p["role"] == "anchor")["src"]
else:
    fid = doc["faceId"]
    holds = doc["holds"]
    problems = doc.get("problems", [])
    n = fid.split("-f")[1]
    photo = f"/photos/jawa/jawa-f{n}-2026-10-11-anchor.jpg"
path = "public" + photo


def load(p):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip()
    w, h = map(int, probe.split(","))
    H = int(round(h * W / w))
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", p, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).copy()


def save(img, p):
    H, W_, _ = img.shape
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W_}x{H}", "-i", "-", "-q:v", "4", p], input=img.tobytes())


def line(img, p, q, colour, t=2):
    H, W_, _ = img.shape
    n = int(max(abs(q[0] - p[0]), abs(q[1] - p[1]))) + 1
    for i in range(n + 1):
        x = p[0] + (q[0] - p[0]) * i / n
        y = p[1] + (q[1] - p[1]) * i / n
        x0, x1 = int(max(0, x - t)), int(min(W_, x + t + 1))
        y0, y1 = int(max(0, y - t)), int(min(H, y + t + 1))
        if x1 > x0 and y1 > y0:
            img[y0:y1, x0:x1] = colour


# 5x7 bitmap digits/letters for tiny labels
GLYPH = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
}


def text(img, x, y, s, colour=(255, 255, 255), bg=(0, 0, 0), k=2):
    H, W_, _ = img.shape
    x = int(x); y = int(y)
    w = len(s) * 6 * k + 2 * k
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W_, x + w), min(H, y + 9 * k)
    if x1 > x0 and y1 > y0:
        img[y0:y1, x0:x1] = bg
    for ci, ch in enumerate(s):
        g = GLYPH.get(ch)
        if not g:
            continue
        for r, row in enumerate(g):
            for c, bit in enumerate(row):
                if bit == "1":
                    px, py = x + k + (ci * 6 + c) * k, y + k + r * k
                    if 0 <= px < W_ - k and 0 <= py < H - k:
                        img[py : py + k, px : px + k] = colour


img = load(path)
H, W_, _ = img.shape
owner = {}
for p in problems:
    for hid in p["holdIds"]:
        owner[hid] = p
for i, h in enumerate(holds):
    col = COL.get(h["colour"], (255, 0, 255))
    pts = [(x * W_, y * H) for x, y in h["outline"]]
    halo = (255, 255, 255) if h["colour"] == "black" else (0, 0, 0)
    for j in range(len(pts)):
        line(img, pts[j], pts[(j + 1) % len(pts)], halo, t=3)
    for j in range(len(pts)):
        line(img, pts[j], pts[(j + 1) % len(pts)], col, t=1)
    cx = sum(p[0] for p in pts) / len(pts)
    cy = min(p[1] for p in pts)
    tag = str(i)
    p = owner.get(h["id"])
    if p:
        if h["id"] in p["startHoldIds"]:
            tag += "S"
        if p["finishHoldId"] == h["id"]:
            tag += "T"
    text(img, cx - 6, cy - 22, tag)
save(img, out)
print(f"{fid}: {len(holds)} holds, {len([p for p in problems if any(owner.get(hid) is p for hid in p['holdIds'])])} problems -> {out}")
