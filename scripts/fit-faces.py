#!/usr/bin/env python3
"""
Turn a COLMAP sparse model into face geometry for the block view.

  python3 scripts/fit-faces.py model/colmap/sparse-txt --pitch-px 100 --pitch-m 0.2 --out model/faces-fit.json

For every face: take the 3D points seen by its anchor photo inside the central part of the frame,
RANSAC-fit a plane, intersect neighbouring planes with the floor to get the footprint corners, and
project the resulting wall quad back into the anchor photo (normalised coordinates). Gravity comes
from the mean camera "down" axis (phones were held upright). Scale is set from the T-nut pitch
measured in pixels in one anchor photo.

Writes a JSON report; scripts/apply-fit.mjs merges it into src/data/jawa.json.
"""
import argparse, json, math, os, re, sys
import numpy as np

FACES = [f"jawa-f{i}" for i in range(1, 10)]
ANCHOR_RE = re.compile(r"jawa-f(\d)-.*-anchor\.jpg$")


def read_cameras(path):
    cams = {}
    for line in open(path):
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        cid, model, w, h = int(p[0]), p[1], int(p[2]), int(p[3])
        params = list(map(float, p[4:]))
        if model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL", "SIMPLE_RADIAL_FISHEYE", "RADIAL"):
            f, cx, cy = params[0], params[1], params[2]
            fx = fy = f
        elif model in ("PINHOLE", "OPENCV", "OPENCV_FISHEYE", "FULL_OPENCV"):
            fx, fy, cx, cy = params[0], params[1], params[2], params[3]
        else:
            raise SystemExit(f"unsupported camera model {model}")
        cams[cid] = dict(w=w, h=h, fx=fx, fy=fy, cx=cx, cy=cy, model=model)
    return cams


def qvec2rot(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * z * w, 2 * x * z + 2 * y * w],
        [2 * x * y + 2 * z * w, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * x * w],
        [2 * x * z - 2 * y * w, 2 * y * z + 2 * x * w, 1 - 2 * x * x - 2 * y * y],
    ])


def read_images(path):
    imgs = {}
    lines = [l for l in open(path) if not l.startswith("#") and l.strip()]
    for i in range(0, len(lines), 2):
        p = lines[i].split()
        iid = int(p[0])
        q = list(map(float, p[1:5]))
        t = np.array(list(map(float, p[5:8])))
        cid = int(p[8])
        name = p[9]
        R = qvec2rot(q)  # world -> camera
        pts = lines[i + 1].split()
        obs = []
        for j in range(0, len(pts), 3):
            pid = int(pts[j + 2])
            if pid >= 0:
                obs.append((float(pts[j]), float(pts[j + 1]), pid))
        imgs[iid] = dict(name=name, R=R, t=t, cam=cid, obs=obs, center=-R.T @ t)
    return imgs


def read_points(path):
    pts = {}
    for line in open(path):
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        pts[int(p[0])] = np.array(list(map(float, p[1:4])))
    return pts


def ransac_plane(P, iters=600, thresh=None, rng=np.random.default_rng(0)):
    n = len(P)
    if thresh is None:
        # relative to the spread of the cloud
        thresh = 0.01 * np.linalg.norm(P.max(0) - P.min(0))
    best = None
    best_in = None
    for _ in range(iters):
        idx = rng.choice(n, 3, replace=False)
        a, b, c = P[idx]
        nrm = np.cross(b - a, c - a)
        l = np.linalg.norm(nrm)
        if l < 1e-9:
            continue
        nrm /= l
        d = -nrm @ a
        dist = np.abs(P @ nrm + d)
        inl = dist < thresh
        if best is None or inl.sum() > best_in.sum():
            best, best_in = (nrm, d), inl
    # refine with SVD on inliers
    Q = P[best_in]
    c = Q.mean(0)
    u, s, vt = np.linalg.svd(Q - c)
    nrm = vt[2]
    d = -nrm @ c
    return nrm, d, best_in, thresh


def project(img, cam, X):
    x = img["R"] @ X + img["t"]
    if x[2] <= 0:
        return None
    u = cam["fx"] * x[0] / x[2] + cam["cx"]
    v = cam["fy"] * x[1] / x[2] + cam["cy"]
    return np.array([u / cam["w"], v / cam["h"]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--pitch-px", type=float, help="T-nut pitch in pixels in the scale anchor photo")
    ap.add_argument("--pitch-m", type=float, default=0.2)
    ap.add_argument("--scale-face", default="jawa-f4")
    ap.add_argument("--out", default="model/faces-fit.json")
    ap.add_argument("--inner", type=float, default=0.7, help="fraction of the anchor frame (centred) used for the plane fit")
    ap.add_argument("--min-dihedral", type=float, default=25, help="deg between neighbour planes below which their intersection is not trusted")
    ap.add_argument("--snap-m", type=float, default=0.8, help="use a plane intersection only if it lies within this distance of the point-extent corner")
    ap.add_argument("--extent-pct", type=float, default=1.5, help="percentile trimming for point extents")
    ap.add_argument("--region", action="append", default=[], help="per-face fit region in the anchor, e.g. jawa-f5=0.05,0.15,0.45,0.85 (x0,y0,x1,y1)")
    ap.add_argument("--max-lateral-m", type=float, default=3.0, help="ignore plane points further than this from the fit region, sideways")
    ap.add_argument("--top-pct", type=float, default=20, help="percentile across per-face tops (low = higher wall; tops are negative along gravity)")
    ap.add_argument("--frame-margin", type=float, default=0.02, help="plane points must project inside the anchor frame minus this margin")
    a = ap.parse_args()

    cams = read_cameras(os.path.join(a.model, "cameras.txt"))
    imgs = read_images(os.path.join(a.model, "images.txt"))
    pts = read_points(os.path.join(a.model, "points3D.txt"))
    print(f"{len(imgs)} images, {len(pts)} points")

    anchors = {}
    for iid, im in imgs.items():
        m = ANCHOR_RE.search(im["name"])
        if m:
            anchors[f"jawa-f{m.group(1)}"] = iid
    missing = [f for f in FACES if f not in anchors]
    if missing:
        print("anchor photos NOT registered:", missing)

    # gravity: mean of camera +y axes (image down) in world coords
    downs = np.array([im["R"].T @ np.array([0, 1, 0]) for im in imgs.values()])
    g = downs.mean(0)
    g /= np.linalg.norm(g)
    print("gravity (down) =", np.round(g, 3), " spread:", np.round(np.degrees(np.arccos(np.clip(downs @ g, -1, 1))).std(), 1), "deg")

    regions = {}
    for r in a.region:
        fid, box = r.split("=")
        regions[fid] = tuple(map(float, box.split(",")))

    report = dict(faces={}, gravity=g.tolist(), notes=[], regions=regions)
    planes = {}
    face_pts = {}
    seed_centre = {}
    thresholds = {}
    for fid in FACES:
        if fid not in anchors:
            continue
        im = imgs[anchors[fid]]
        cam = cams[im["cam"]]
        lo, hi = (1 - a.inner) / 2, 1 - (1 - a.inner) / 2
        x0, y0, x1, y1 = regions.get(fid, (lo, lo, hi, hi))
        sel = [pid for (u, v, pid) in im["obs"] if x0 < u / cam["w"] < x1 and y0 < v / cam["h"] < y1 and pid in pts]
        P = np.array([pts[p] for p in sel])
        if len(P) < 30:
            report["notes"].append(f"{fid}: only {len(P)} points in anchor, skipped")
            print(fid, "too few points", len(P))
            continue
        nrm, d, inl, thr = ransac_plane(P)
        # orient normal towards the camera (outward from the wall)
        if nrm @ (im["center"] - P[inl].mean(0)) < 0:
            nrm, d = -nrm, -d
        planes[fid] = (nrm, d)
        face_pts[fid] = P[inl]
        seed_centre[fid] = P[inl].mean(0)
        thresholds[fid] = thr
        lean = math.degrees(math.asin(float(np.clip(nrm @ g, -1, 1))))  # + = normal points down = overhang
        print(f"{fid}: {len(P)} pts, {inl.sum()} inliers, lean {lean:+.1f} deg, thresh {thr:.3f}")
        report["faces"][fid] = dict(points=int(len(P)), inliers=int(inl.sum()), lean_deg=round(lean, 1))

    # scale first (needs only the scale face's plane), so the point gathering below can use metres
    scale = 1.0
    if a.pitch_px:
        im = imgs[anchors[a.scale_face]]
        cam = cams[im["cam"]]
        nrm, d = planes[a.scale_face]
        ray = im["R"].T @ np.array([0, 0, 1.0])
        c = im["center"]
        tdep = -(nrm @ c + d) / (nrm @ ray)
        px_per_unit = cam["fx"] / tdep
        unit_per_pitch = a.pitch_px / px_per_unit
        scale = a.pitch_m / unit_per_pitch
        print(f"scale: {a.pitch_px}px pitch at depth {tdep:.3f} -> {unit_per_pitch:.4f} units per pitch -> {scale:.4f} m/unit")

    # Gather every 3D point lying on each face's plane (from all images), limited sideways so a
    # neighbouring near-coplanar face does not get swallowed. These drive extents and heights.
    allpts = np.array(list(pts.values()))
    up = -g
    for fid, (nrm, d) in planes.items():
        thr = max(thresholds[fid], 0.015)
        lat = np.cross(up, nrm)
        lat /= np.linalg.norm(lat)
        on = np.abs(allpts @ nrm + d) < thr
        side = np.abs((allpts - seed_centre[fid]) @ lat) * scale < a.max_lateral_m
        # The anchor photo frames the face with a small margin (that is how faces were defined), so only
        # plane points that project inside the anchor frame count towards this face's extent.
        im = imgs[anchors[fid]]
        cam = cams[im["cam"]]
        Xc = (im["R"] @ allpts.T).T + im["t"]
        with np.errstate(divide="ignore", invalid="ignore"):
            u = (cam["fx"] * Xc[:, 0] / Xc[:, 2] + cam["cx"]) / cam["w"]
            v = (cam["fy"] * Xc[:, 1] / Xc[:, 2] + cam["cy"]) / cam["h"]
        m = a.frame_margin
        vis = (Xc[:, 2] > 0) & (u > m) & (u < 1 - m) & (v > m) & (v < 1 - m)
        Q = allpts[on & side & vis]
        print(f"{fid}: {len(face_pts[fid])} seed inliers -> {len(Q)} plane points")
        if len(Q) > len(face_pts[fid]):
            face_pts[fid] = Q
        report["faces"][fid]["plane_points"] = int(len(Q))

    # Floor and top are shared by the whole block: the mats are level and the top edge is level.
    # Per-face percentiles, then medians, so one face whose plane runs into the roof cannot drag the top up.
    floors = [np.percentile(P @ g, 99) for P in face_pts.values()]
    tops = [np.percentile(P @ g, a.extent_pct) for P in face_pts.values()]
    floor_h = float(np.median(floors))  # gravity points down, so the floor is the LARGEST value
    # Plain plywood near the top gives few points, so most faces under-report their top; take a high
    # percentile across faces (but not the max, which can be a roof beam on the plane's extension).
    top_h = float(np.percentile(tops, a.top_pct))
    print("per-face floor:", np.round(np.array(floors) * scale, 2), " top:", np.round(np.array(tops) * scale, 2))
    print("floor/top along g:", floor_h, top_h, "height:", round((floor_h - top_h) * scale, 2), "m")

    report["scale_m_per_unit"] = scale
    report["height_m"] = round(float((floor_h - top_h) * scale), 2)

    # Horizontal frame: x along the first face's base direction, z = up x x.
    n0 = planes[FACES[0]][0] if FACES[0] in planes else next(iter(planes.values()))[0]
    xaxis = np.cross(up, n0)
    xaxis /= np.linalg.norm(xaxis)
    zaxis = np.cross(xaxis, up)
    to2d = lambda X: [round(float(X @ xaxis * scale), 3), round(float(X @ zaxis * scale), 3)]

    def plane_corner(f1, f2):
        """Point where planes f1, f2 and the floor meet, or None if the planes are nearly parallel."""
        n1, d1 = planes[f1]
        n2, d2 = planes[f2]
        ang = math.degrees(math.acos(float(np.clip(n1 @ n2, -1, 1))))
        if ang < a.min_dihedral:
            return None, ang
        A = np.array([n1, n2, g])
        b = np.array([-d1, -d2, floor_h])
        try:
            return np.linalg.solve(A, b), ang
        except np.linalg.LinAlgError:
            return None, ang

    # Per-face lateral extent of its own inlier points, measured along the in-plane horizontal axis.
    extent = {}
    for fid, (nrm, d) in planes.items():
        lat = np.cross(up, nrm)
        lat /= np.linalg.norm(lat)
        P = face_pts[fid]
        s_ = P @ lat
        lo, hi = np.percentile(s_, a.extent_pct), np.percentile(s_, 100 - a.extent_pct)
        # a point on the plane at floor height, then slide along lat
        c = P.mean(0)
        base = c - ((c @ g) - floor_h) * g          # drop to floor along gravity (plane may lean; fix below)
        base = base - (nrm @ base + d) * nrm        # back onto the plane
        # move along lat to lo/hi
        e_lo = base + lat * (lo - base @ lat)
        e_hi = base + lat * (hi - base @ lat)
        # lat = up x n points to the viewer's right when facing the wall, so walking order (left -> right) is lo -> hi
        extent[fid] = (e_lo, e_hi, lat, top_h)

    for i, fid in enumerate(FACES):
        nxt = FACES[(i + 1) % len(FACES)]
        if fid in planes and nxt in planes:
            ang = math.degrees(math.acos(float(np.clip(planes[fid][0] @ planes[nxt][0], -1, 1))))
            print(f"dihedral {fid}/{nxt}: {ang:.1f} deg")
    geom = {}
    for i, fid in enumerate(FACES):
        if fid not in planes:
            report["notes"].append(f"{fid}: no plane")
            continue
        prev = FACES[i - 1]
        nxt = FACES[(i + 1) % len(FACES)]
        e_from, e_to, lat, top_f = extent[fid]
        src_from = src_to = "extent"
        # Near-coplanar neighbours share plane points, so never reach past the midpoint to the neighbour's centre.
        def clamp_to_mid(e, nb, side):
            if nb not in seed_centre:
                return e, "extent"
            mid = (seed_centre[fid] + seed_centre[nb]) / 2
            s_e, s_mid = e @ lat, mid @ lat
            if (side < 0 and s_e < s_mid) or (side > 0 and s_e > s_mid):
                return e + lat * (s_mid - s_e), "midpoint"
            return e, "extent"
        if prev in planes:
            c, ang = plane_corner(prev, fid)
            if c is not None and np.linalg.norm(c - e_from) * scale < a.snap_m:
                e_from, src_from = c, f"intersection({ang:.0f}deg)"
        if nxt in planes:
            c, ang = plane_corner(fid, nxt)
            if c is not None and np.linalg.norm(c - e_to) * scale < a.snap_m:
                e_to, src_to = c, f"intersection({ang:.0f}deg)"
        nrm, d = planes[fid]
        upw = up - (up @ nrm) * nrm
        upw /= np.linalg.norm(upw)
        Hf = (floor_h - top_f) / (upw @ up)
        t_from = e_from + upw * Hf
        t_to = e_to + upw * Hf
        im = imgs[anchors[fid]]
        cam = cams[im["cam"]]
        quad = [project(im, cam, X) for X in (t_from, t_to, e_to, e_from)]  # TL, TR, BR, BL in photo
        quad_n = None if any(q is None for q in quad) else [[round(float(q[0]), 4), round(float(q[1]), 4)] for q in quad]
        width = float(np.linalg.norm(e_to - e_from) * scale)
        geom[fid] = dict(
            from_=to2d(e_from), to=to2d(e_to), width_m=round(width, 2), lean=report["faces"][fid]["lean_deg"],
            height=round(float((floor_h - top_f) * scale), 2), quad=quad_n, corners=[src_from, src_to],
        )
        print(f"{fid}: width {width:.2f} m, height {(floor_h - top_f) * scale:.2f} m, corners {src_from}/{src_to}, quad {quad_n}")
    report["geometry"] = geom
    json.dump(report, open(a.out, "w"), indent=2)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
