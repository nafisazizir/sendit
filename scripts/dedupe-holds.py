#!/usr/bin/env python3
"""
NOTE: volumes are shared and belong to no problem, so after an --apply the dropped volumes were restored
(each face keeps its own outline of a volume it can see). Only holds of type "hold" should be deduplicated.

Find holds that were outlined twice on two neighbouring faces of Jawa, and merge them.

  python3 scripts/dedupe-holds.py            # dry run: print passes, clusters, known cases, checks
  python3 scripts/dedupe-holds.py --apply    # also write src/data/jawa.json and model/dedupe-report.json

Every hold is drawn in the normalised coordinates of its own face's anchor photo. The anchors overlap
at the face edges, so one physical hold can appear on two faces. To compare holds across faces we put
them all in the structure-from-motion frame:

  1. Fit the nine face planes exactly as scripts/fit-faces.py does (same functions, same RANSAC seed,
     same F5 region override), using the COLMAP text model in model/colmap/sparse-txt.
  2. For each hold, cast a ray from its anchor camera through its outline centroid (SIMPLE_RADIAL
     distortion undone by fixed-point iteration) and intersect it with the plane of the face the hold
     physically sits on: its own face, except `f5c-*` holds (outlined in F5's photo, on F6's plane).
     Unprojectable: hits behind the camera, more than 15 m away, or more than 1.6x deeper than the
     SfM points the anchor sees around that pixel (the plane does not pass there). The 3D point is
     also projected into every other anchor photo (recorded in the report).
  3. Candidates: holds on different faces, same colour class (white/grey/other are one class, every
     other colour only matches itself), same kind (volume vs not).
       pass 1: 3D distance < 0.30 m (volumes 0.60 m).
       pass 2 (only if a known duplicate was missed): 0.45 m between nearly coplanar neighbours
               (dihedral < 20 deg).
       pass 3 (only if one is still missed; holds, not volumes): the two anchor rays triangulate,
               i.e. pass within 5 cm of each other, at a point within 0.7 m of one of the two wall
               planes, and the plane points are < 1 m apart. This catches holds on volumes and holds
               outlined on the neighbour's plane, where a single-plane intersection is off by the
               protrusion. A random same-colour pair can only meet on the epipolar line, which the
               plane band rules out.
     In every pass a hold pair whose rays miss each other by > 10 cm is vetoed (inconsistent views).
     Each face pair is matched one-to-one, best ray agreement first. Clusters that would merge two
     holds of the same face are skipped and listed for review.
  4. Each cluster keeps one hold: the one whose centroid lies inside its own face's geometry.quad;
     if both or neither, the one nearer the centre of its anchor photo. Dropped ids are replaced by
     the kept id in every problem; notes are carried over.

Afterwards (both modes): the problems in MERGE_PROBLEMS are folded together (jawa-black-f1-a into
jawa-black-f9, and two that became identical/subset after the dedupe), and a consistency check
runs (unknown hold ids, a `hold` in more than one problem, volumes/downclimbs in problems). Volumes and
downclimbs are removed from problems; the rest is only reported.
"""
import argparse, importlib.util, json, math, os, sys
from collections import defaultdict
import numpy as np

np.seterr(all="ignore")  # fit-faces' RANSAC hits degenerate samples; harmless

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DATA = os.path.join(ROOT, "src/data/jawa.json")
MODEL = os.path.join(ROOT, "model/colmap/sparse-txt")
FIT = os.path.join(ROOT, "model/faces-fit.json")
REPORT = os.path.join(ROOT, "model/dedupe-report.json")

# same as scripts/model.sh
REGIONS = {"jawa-f5": (0.05, 0.15, 0.45, 0.85)}
INNER = 0.7

MAX_RANGE_M = 15.0
MAX_DEPTH_RATIO = 1.6     # plane hit vs local SfM depth
THRESH_HOLD_M = 0.30
THRESH_VOLUME_M = 0.60
THRESH_PASS2_M = 0.45
PASS2_MAX_DIHEDRAL = 20.0
TRI_GAP_M = 0.05          # pass 3: rays meet within this
TRI_PLANE_M = 1.0         # pass 3: plane points at most this far apart
TRI_BAND_M = 0.7          # pass 3: meeting point within this of a wall plane (volumes, kinked bases)
GAP_VETO_M = 0.10         # any pass: hold rays further apart than this are not the same hold

# Problems folded into another one after the dedupe: (source, into, why).
MERGE_PROBLEMS = [
    ("jawa-black-f1-a", "jawa-black-f9", "F9 labeller: the two F9/F1 arete blacks belong to the F9 black line"),
    ("jawa-orange-f2", "jawa-orange-f1", "same three holds once the F1/F2 duplicates are merged; both notes say the line crosses the corner"),
    ("jawa-blue-f7", "jawa-blue-f6", "both its holds are F6 blues seen from F7; note: part of a blue line on F6"),
]

# Known duplicates to report on: (label, ids on the first face, the other face).
KNOWN = [
    ("F7 green ring/sloper vs F8", ["f7-green-donut", "f7-green-long-sloper"], "jawa-f8"),
    ("F9 low white jug vs F1", ["f9-white-low"], "jawa-f1"),
    ("F1 orange on grey triangle vs F2", ["f1-orange-triangle-upper", "f1-orange-triangle-lower", "f1-orange-top"], "jawa-f2"),
    ("F6 right grey volume (+ holds) vs F7",
     ["f6-grey-volume-right", "f6-red-right", "f6-green-right", "f6-orange-right", "f6-white-right", "f6-white-right-low"], "jawa-f7"),
    ("F7 bottom-left purple volumes vs F6",
     ["f7-purple-vol-left", "f7-purple-vol-block", "f7-purple-vol-dome"], "jawa-f6"),
]


def load_fit_module():
    spec = importlib.util.spec_from_file_location("fit_faces", os.path.join(ROOT, "scripts/fit-faces.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def radial_k(path):
    """SIMPLE_RADIAL / RADIAL first distortion coefficient per camera (fit-faces' reader drops it)."""
    ks = {}
    for line in open(path):
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        ks[int(p[0])] = float(p[7]) if p[1] in ("SIMPLE_RADIAL", "RADIAL") else 0.0
    return ks


def fit_planes(ff, cams, imgs, pts, anchors):
    """The seed plane fit of fit-faces.py main(): same order, same RNG, normals towards the camera."""
    planes = {}
    lo, hi = (1 - INNER) / 2, 1 - (1 - INNER) / 2
    for fid in ff.FACES:
        if fid not in anchors:
            continue
        im = imgs[anchors[fid]]
        cam = cams[im["cam"]]
        x0, y0, x1, y1 = REGIONS.get(fid, (lo, lo, hi, hi))
        sel = [pid for (u, v, pid) in im["obs"] if x0 < u / cam["w"] < x1 and y0 < v / cam["h"] < y1 and pid in pts]
        P = np.array([pts[p] for p in sel])
        if len(P) < 30:
            continue
        nrm, d, inl, _ = ff.ransac_plane(P)
        if nrm @ (im["center"] - P[inl].mean(0)) < 0:
            nrm, d = -nrm, -d
        planes[fid] = (nrm, d)
    return planes


def pixel_ray(im, cam, k, u, v):
    """World-space ray direction through pixel (u, v), undoing SIMPLE_RADIAL distortion."""
    xd, yd = (u - cam["cx"]) / cam["fx"], (v - cam["cy"]) / cam["fy"]
    x, y = xd, yd
    for _ in range(20):
        f = 1 + k * (x * x + y * y)
        x, y = xd / f, yd / f
    return im["R"].T @ np.array([x, y, 1.0])


def project_dist(im, cam, k, X):
    """Project a world point into a photo with distortion; normalised coords, or None if behind."""
    x = im["R"] @ X + im["t"]
    if x[2] <= 0:
        return None
    xn, yn = x[0] / x[2], x[1] / x[2]
    f = 1 + k * (xn * xn + yn * yn)
    return np.array([(cam["fx"] * xn * f + cam["cx"]) / cam["w"], (cam["fy"] * yn * f + cam["cy"]) / cam["h"]])


def centroid(outline, w, h):
    """Area centroid of a polygon given in normalised coords; returned normalised."""
    P = np.array(outline, float) * [w, h]
    x, y = P[:, 0], P[:, 1]
    x1, y1 = np.roll(x, -1), np.roll(y, -1)
    cr = x * y1 - x1 * y
    a = cr.sum() / 2
    if abs(a) < 1e-9:
        c = P.mean(0)
    else:
        c = np.array([((x + x1) * cr).sum(), ((y + y1) * cr).sum()]) / (6 * a)
    return c / [w, h]


def inside(pt, poly):
    x, y = pt
    n, ins = len(poly), False
    for i in range(n):
        (xa, ya), (xb, yb) = poly[i], poly[(i + 1) % n]
        if (ya > y) != (yb > y) and x < xa + (y - ya) * (xb - xa) / (yb - ya):
            ins = not ins
    return ins


def colour_class(c):
    return "white/grey/other" if c in ("white", "grey", "other") else c


def phys_face(h):
    return "jawa-f6" if h["id"].startswith("f5c-") else h["faceId"]


class UF:
    def __init__(self):
        self.p = {}

    def find(self, a):
        self.p.setdefault(a, a)
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        self.p[self.find(a)] = self.find(b)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="print what would change (default)")
    g.add_argument("--apply", action="store_true", help="write src/data/jawa.json and model/dedupe-report.json")
    a = ap.parse_args()

    ff = load_fit_module()
    cams = ff.read_cameras(os.path.join(MODEL, "cameras.txt"))
    ks = radial_k(os.path.join(MODEL, "cameras.txt"))
    imgs = ff.read_images(os.path.join(MODEL, "images.txt"))
    pts = ff.read_points(os.path.join(MODEL, "points3D.txt"))
    scale = json.load(open(FIT))["scale_m_per_unit"]
    anchors = {}
    for iid, im in imgs.items():
        m = ff.ANCHOR_RE.search(im["name"])
        if m:
            anchors[f"jawa-f{m.group(1)}"] = iid

    downs = np.array([im["R"].T @ np.array([0, 1, 0]) for im in imgs.values()])
    grav = downs.mean(0) / np.linalg.norm(downs.mean(0))
    planes = fit_planes(ff, cams, imgs, pts, anchors)
    print(f"{len(imgs)} images, {len(pts)} points, scale {scale:.4f} m/unit")
    print("planes (lean, should match model/faces-fit.json):",
          ", ".join(f"{f[5:]} {math.degrees(math.asin(float(np.clip(n @ grav, -1, 1)))):+.1f}" for f, (n, d) in planes.items()))
    dihedral = {}
    for f1 in planes:
        for f2 in planes:
            dihedral[(f1, f2)] = math.degrees(math.acos(float(np.clip(planes[f1][0] @ planes[f2][0], -1, 1))))

    doc = json.load(open(DATA))
    st = doc["sets"][0]
    holds = st["holds"]
    byid = {h["id"]: h for h in holds}
    quads = {f["id"]: f.get("geometry", {}).get("quad") for f in doc["faces"]}

    # --- 1. every hold into 3D
    def local_depth(im, cam, u, v, rad):
        """Median depth (SfM units) of the anchor's observed points within rad px of (u, v), else of all."""
        near, every = [], []
        for (x, y, pid) in im["obs"]:
            if pid in pts:
                z = (im["R"] @ pts[pid] + im["t"])[2]
                every.append(z)
                if math.hypot(x - u, y - v) < rad:
                    near.append(z)
        return float(np.median(near if near else every))

    info = {}
    unproj = []
    for h in holds:
        fid = h["faceId"]
        im = imgs[anchors[fid]]
        cam, k = cams[im["cam"]], ks[im["cam"]]
        c = centroid(h["outline"], cam["w"], cam["h"])
        ray = pixel_ray(im, cam, k, c[0] * cam["w"], c[1] * cam["h"])
        ray /= np.linalg.norm(ray)
        nrm, d = planes[phys_face(h)]
        den = nrm @ ray
        t = -(nrm @ im["center"] + d) / den if abs(den) > 1e-9 else -1.0
        zref = local_depth(im, cam, c[0] * cam["w"], c[1] * cam["h"], 0.04 * cam["w"])
        z = t * (im["R"] @ ray)[2]  # depth along the optical axis
        rec = dict(centroid=[round(float(c[0]), 4), round(float(c[1]), 4)], plane=phys_face(h),
                   in_quad=bool(quads.get(fid) and inside(c, quads[fid])),
                   centre_dist=float(math.hypot((c[0] - 0.5) * cam["w"], (c[1] - 0.5) * cam["h"]) / cam["w"]),
                   origin=im["center"], ray=ray, range_m=round(float(t * scale), 2),
                   sfm_depth_m=round(zref * scale, 2))
        if t <= 0 or t * scale > MAX_RANGE_M or z > MAX_DEPTH_RATIO * zref:
            rec["X"] = None
            unproj.append(h["id"])
        else:
            X = im["center"] + t * ray
            rec["X"] = X
            seen = {}
            for of, oi in anchors.items():
                if of == fid:
                    continue
                oim = imgs[oi]
                p = project_dist(oim, cams[oim["cam"]], ks[oim["cam"]], X)
                if p is not None and 0 <= p[0] <= 1 and 0 <= p[1] <= 1:
                    seen[of] = [round(float(p[0]), 4), round(float(p[1]), 4)]
            rec["seen_in"] = seen
        info[h["id"]] = rec
    if unproj:
        print("unprojectable (plane hit behind / > 15 m / far deeper than the SfM points there):")
        for hid in unproj:
            r = info[hid]
            print(f"  {hid}: plane range {r['range_m']} m, SfM depth around it {r['sfm_depth_m']} m")

    def compatible(hi, hj):
        return (hi["faceId"] != hj["faceId"] and colour_class(hi["colour"]) == colour_class(hj["colour"])
                and (hi["type"] == "volume") == (hj["type"] == "volume"))

    def measure(i, j):
        """Plane-point distance (m), ray gap (m), and where the rays meet relative to the walls."""
        ri, rj = info[i], info[j]
        if ri["X"] is None or rj["X"] is None:
            return None
        plane_d = float(np.linalg.norm(ri["X"] - rj["X"]) * scale)
        c1, r1, c2, r2 = ri["origin"], ri["ray"], rj["origin"], rj["ray"]
        w = c1 - c2
        A = np.array([[1.0, -(r1 @ r2)], [r1 @ r2, -1.0]])
        try:
            s1, s2 = np.linalg.solve(A, np.array([-(w @ r1), -(w @ r2)]))
        except np.linalg.LinAlgError:
            return dict(plane=plane_d, gap=float("inf"), band=float("inf"), front=False)
        p1, p2 = c1 + s1 * r1, c2 + s2 * r2
        P = (p1 + p2) / 2
        offs = [float((planes[f][0] @ P + planes[f][1]) * scale) for f in {phys_face(byid[i]), phys_face(byid[j])}]
        return dict(plane=plane_d, gap=float(np.linalg.norm(p1 - p2) * scale), band=min(abs(o) for o in offs),
                    front=bool(s1 > 0 and s2 > 0))

    def coplanar_neighbours(hi, hj):
        ni, nj = int(hi["faceId"][-1]), int(hj["faceId"][-1])
        return abs(ni - nj) in (1, 8) and dihedral[(phys_face(hi), phys_face(hj))] < PASS2_MAX_DIHEDRAL

    def accept(hi, hj, m, npass):
        """Which pass accepts this pair (1, 2, 3) or None."""
        vol = hi["type"] == "volume"
        if not vol and m["gap"] > GAP_VETO_M:
            return None
        if m["plane"] < (THRESH_VOLUME_M if vol else THRESH_HOLD_M):
            return 1
        if npass >= 2 and not vol and coplanar_neighbours(hi, hj) and m["plane"] < THRESH_PASS2_M:
            return 2
        if (npass >= 3 and not vol and m["front"] and m["gap"] < TRI_GAP_M and m["plane"] < TRI_PLANE_M
                and m["band"] < TRI_BAND_M):
            return 3
        return None

    measures = {}
    for i, hi in enumerate(holds):
        for hj in holds[i + 1:]:
            if compatible(hi, hj):
                m = measure(hi["id"], hj["id"])
                if m is not None:
                    measures[(hi["id"], hj["id"])] = m

    def find_pairs(npass):
        """One-to-one per face pair, best ray agreement first."""
        cand = []
        for (i, j), m in measures.items():
            by = accept(byid[i], byid[j], m, npass)
            if by:
                cand.append((m["gap"], m["plane"], i, j, by))
        cand.sort()
        used = set()  # (hold id, other face)
        pairs = []
        for gap, pd, i, j, by in cand:
            if (i, byid[j]["faceId"]) in used or (j, byid[i]["faceId"]) in used:
                continue
            used.add((i, byid[j]["faceId"]))
            used.add((j, byid[i]["faceId"]))
            pairs.append(dict(a=i, b=j, plane_m=round(pd, 3), gap_m=round(gap, 3), by=by))
        return pairs

    def clusters_of(pairs):
        uf = UF()
        for p in pairs:
            uf.union(p["a"], p["b"])
        cl = defaultdict(set)
        for p in pairs:
            cl[uf.find(p["a"])].update((p["a"], p["b"]))
        return uf, cl

    def check_known(pairs):
        uf, cl = clusters_of(pairs)
        missed, out = [], []
        for label, ids, other in KNOWN:
            print(f"  {label}")
            for hid in ids:
                if hid not in byid:
                    print(f"    {hid}: not in data")
                    continue
                mates = [m for m in cl.get(uf.find(hid), ()) if byid[m]["faceId"] == other] if hid in uf.p else []
                if mates:
                    j = mates[0]
                    m = measures.get((hid, j)) or measures.get((j, hid))
                    out.append(dict(case=label, hold=hid, caught=True, match=j, plane_m=round(m["plane"], 3) if m else None,
                                    gap_m=round(m["gap"], 3) if m else None))
                    print(f"    CAUGHT {hid} = {j}" + (f" (plane {m['plane']:.2f} m, rays {m['gap']:.2f} m)" if m else " (via a third face)"))
                    continue
                best = None  # nearest compatible hold on the other face, to judge the threshold
                for h2 in holds:
                    if h2["faceId"] == other and compatible(byid[hid], h2):
                        m = measures.get((hid, h2["id"])) or measures.get((h2["id"], hid))
                        if m and (best is None or m["plane"] < best[1]["plane"]):
                            best = (h2["id"], m)
                rec = dict(case=label, hold=hid, caught=False)
                if best:
                    j, m = best
                    rec.update(nearest=j, plane_m=round(m["plane"], 3), gap_m=round(m["gap"], 3),
                               X_m=[round(float(v) * scale, 3) for v in info[hid]["X"]],
                               nearest_X_m=[round(float(v) * scale, 3) for v in info[j]["X"]])
                    if m["plane"] < 1.0:
                        missed.append(rec)
                    print(f"    missed {hid}: nearest same-class on {other[5:]} is {j}, plane points {m['plane']:.2f} m apart "
                          f"(X {rec['X_m']} vs {rec['nearest_X_m']} m), rays {m['gap']:.2f} m apart")
                else:
                    print(f"    missed {hid}: nothing of its colour class (projectable) on {other[5:]}")
                out.append(rec)
        return missed, out

    # --- 2. passes, escalating only while a known duplicate is missed
    descr = {1: f"< {THRESH_HOLD_M} m, volumes < {THRESH_VOLUME_M} m",
             2: f"+ coplanar neighbours (dihedral < {PASS2_MAX_DIHEDRAL:.0f} deg) < {THRESH_PASS2_M} m",
             3: f"+ triangulated holds (rays < {TRI_GAP_M} m apart, within {TRI_BAND_M} m of a wall, plane points < {TRI_PLANE_M} m)"}
    npass, pairs = 1, find_pairs(1)
    while True:
        print(f"\npass {npass} ({descr[npass]}): {len(pairs)} pairs")
        if npass > 1:
            for p in pairs:
                if p["by"] == npass:
                    print(f"  new: {p['a']} = {p['b']} (plane {p['plane_m']:.2f} m, rays {p['gap_m']:.2f} m)")
        print(f"known cases after pass {npass}:")
        missed, known = check_known(pairs)
        if not missed or npass == 3:
            break
        npass += 1
        pairs = find_pairs(npass)

    # --- 3. clusters and the keeper
    _, clusters = clusters_of(pairs)
    pair_by = {frozenset((p["a"], p["b"])): p for p in pairs}

    def keep_key(hid):
        return (0 if info[hid]["in_quad"] else 1, info[hid]["centre_dist"])

    remap, results, skipped = {}, [], []
    print(f"\n{len(clusters)} clusters:")
    for members in sorted(clusters.values(), key=lambda m: sorted(m)):
        members = sorted(members)
        faces = [byid[m]["faceId"] for m in members]
        links = [pair_by[frozenset((x, y))] for x in members for y in members if x < y and frozenset((x, y)) in pair_by]
        if len(set(faces)) < len(faces):
            print(f"  SKIPPED (two holds of one face): {', '.join(members)}")
            skipped.append(dict(members=members, links=links))
            continue
        keep = min(members, key=keep_key)
        drop = [m for m in members if m != keep]
        for m in drop:
            remap[m] = keep
        why = "in own quad" if info[keep]["in_quad"] and not all(info[m]["in_quad"] for m in members) else "nearer photo centre"
        ls = ", ".join(f"{l['plane_m']:.2f}/{l['gap_m']:.2f}" + (f" p{l['by']}" if l["by"] > 1 else "") for l in links)
        print(f"  keep {keep:28s} drop {', '.join(drop):44s} [{byid[keep]['colour']}/{byid[keep]['type']}; plane/rays m: {ls}; {why}]")
        results.append(dict(keep=keep, drop=drop, links=links, reason=why, faces=sorted(set(faces))))

    per_pair = defaultdict(int)
    for r in results:
        for m in r["drop"]:
            per_pair["/".join(sorted({byid[r["keep"]]["faceId"][5:], byid[m]["faceId"][5:]}))] += 1
    print("dropped per face pair:", dict(sorted(per_pair.items())))

    # --- 4. apply to the document (in memory)
    for r in results:
        kh = byid[r["keep"]]
        for m in r["drop"]:
            note = (byid[m].get("note") or "").strip()
            if note and note not in (kh.get("note") or ""):
                kh["note"] = f"{kh['note']} · {note}" if kh.get("note") else note
    st["holds"] = [h for h in holds if h["id"] not in remap]

    def dedupe(xs):
        out = []
        for x in xs:
            if x not in out:
                out.append(x)
        return out

    for p in st["problems"]:
        p["holdIds"] = dedupe([remap.get(x, x) for x in p["holdIds"]])
        p["startHoldIds"] = dedupe([remap.get(x, x) for x in p.get("startHoldIds") or []])
        if p.get("finishHoldId"):
            p["finishHoldId"] = remap.get(p["finishHoldId"], p["finishHoldId"])

    # --- 5. problem merges (source, into, why)
    probs = {p["id"]: p for p in st["problems"]}
    merged = []
    for src_id, dst_id, why in MERGE_PROBLEMS:
        if src_id not in probs or dst_id not in probs:
            continue
        src, dst = probs[src_id], probs[dst_id]
        dst["holdIds"] = dedupe(dst["holdIds"] + src["holdIds"])
        dst["startHoldIds"] = dedupe(dst["startHoldIds"] + (src.get("startHoldIds") or []))
        if not dst.get("finishHoldId") and src.get("finishHoldId"):
            dst["finishHoldId"] = src["finishHoldId"]
        if src.get("note") and src["note"] not in (dst.get("note") or ""):
            dst["note"] = f"{dst['note']} · {src['note']}" if dst.get("note") else src["note"]
        st["problems"] = [p for p in st["problems"] if p["id"] != src_id]
        merged.append(dict(source=src_id, into=dst_id, holds=src["holdIds"], why=why))
        print(f"\nmerged {src_id} ({', '.join(src['holdIds'])}) into {dst_id}: {why}")

    # --- 6. consistency
    hb = {h["id"]: h for h in st["holds"]}
    violations, fixed = [], []
    for p in st["problems"]:
        for x in p["holdIds"] + p["startHoldIds"] + ([p["finishHoldId"]] if p.get("finishHoldId") else []):
            if x not in hb:
                violations.append(f"{p['id']}: unknown hold {x}")
        bad = [x for x in p["holdIds"] if x in hb and hb[x]["type"] in ("volume", "downclimb")]
        if bad:
            p["holdIds"] = [x for x in p["holdIds"] if x not in bad]
            p["startHoldIds"] = [x for x in p["startHoldIds"] if x not in bad]
            if p.get("finishHoldId") in bad:
                p["finishHoldId"] = None
            fixed.append(f"{p['id']}: removed " + ", ".join(f"{x} ({hb[x]['type']})" for x in bad))
        for x in p["startHoldIds"] + ([p["finishHoldId"]] if p.get("finishHoldId") else []):
            if x in hb and x not in p["holdIds"]:
                violations.append(f"{p['id']}: start/finish {x} not in holdIds")
    owners = defaultdict(list)
    for p in st["problems"]:
        for x in p["holdIds"]:
            if x in hb and hb[x]["type"] == "hold":
                owners[x].append(p["id"])
    for x, ps in owners.items():
        if len(ps) > 1:
            violations.append(f"{x} is in {len(ps)} problems: {', '.join(ps)}")
    print("\nconsistency:")
    for f in fixed:
        print("  fixed:", f)
    for v in violations:
        print("  VIOLATION:", v)
    if not fixed and not violations:
        print("  ok")
    print(f"\nholds {len(holds)} -> {len(st['holds'])}, problems {len(probs)} -> {len(st['problems'])}")

    if not a.apply:
        print("\ndry run; pass --apply to write")
        return
    with open(DATA, "w") as fh:
        fh.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    rep = dict(
        scale_m_per_unit=scale, passes_run=npass, passes={str(k): v for k, v in descr.items() if k <= npass},
        thresholds=dict(hold=THRESH_HOLD_M, volume=THRESH_VOLUME_M, pass2=THRESH_PASS2_M, tri_gap=TRI_GAP_M,
                        tri_plane=TRI_PLANE_M, tri_band=TRI_BAND_M, gap_veto=GAP_VETO_M, depth_ratio=MAX_DEPTH_RATIO),
        clusters=results, skipped_clusters=skipped, dropped_per_face_pair=per_pair, known_cases=known, merged_problem=merged,
        consistency=dict(fixed=fixed, violations=violations), unprojectable=unproj,
        counts=dict(holds_before=len(holds), holds_after=len(st["holds"]), problems_before=len(probs), problems_after=len(st["problems"])),
        holds={hid: dict({k: v for k, v in r.items() if k not in ("X", "origin", "ray")},
                         X_m=None if r["X"] is None else [round(float(v) * scale, 3) for v in r["X"]]) for hid, r in info.items()},
    )
    with open(REPORT, "w") as fh:
        json.dump(rep, fh, indent=2)
        fh.write("\n")
    print("wrote", os.path.relpath(DATA, ROOT), "and", os.path.relpath(REPORT, ROOT))


if __name__ == "__main__":
    main()
