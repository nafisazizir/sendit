#!/usr/bin/env python3
"""
Turn a dense wall mesh (e.g. a photogrammetry OBJ of the Jawa block) into a clean low-poly panel model.

  python3 scripts/mesh-to-panels.py model/objcap/jawa-medium.obj [--up 0,1,0] [--scale 1] \
      [--dist 0.03] [--min-area 0.5] [--merge-deg 8] [--samples 200000] [--out-dir model]
  python3 scripts/make-test-block.py && python3 scripts/mesh-to-panels.py model/test-block.obj \
      && python3 scripts/make-test-block.py --check model/panels.json     # self-test

Approach
--------
1. Load the OBJ (`v` and `f` lines; `a`, `a/b`, `a/b/c`, `a//c` and negative indices; polygons are fan
   triangulated). Rotate so that `--up` becomes +y and multiply by `--scale`, so everything after this
   works in metres with y up (the same frame as docs/model.md and scripts/fit-faces.py).
2. Sample `--samples` points on the surface, proportional to triangle area. Each point carries its
   triangle's normal. Normals are compared unsigned, so inconsistent winding in the mesh does not matter.
3. Sequential RANSAC. Hypotheses are planes through three nearby points (localised sampling, so most
   hypotheses lie on a single face) scored on a random subset; a point is an inlier when it is within
   `--dist` of the plane AND its normal is within 25 deg of the plane normal (this drops the sides of
   hold bumps and the neighbouring face near a corner). The best plane is refined by least squares on
   its inliers and cut down to its largest connected patch (a coarse in-plane grid), so coplanar but
   separate bits of the scene don't join it. Its points leave the pool. Planes whose normal is more than
   60 deg from horizontal (floor, ceiling, top of the block) are discarded; vertical-ish ones with an
   area >= `--min-area` become panels. Stop when the best remaining plane is smaller than `--min-area`.
4. Merge panels whose outward normals differ by < `--merge-deg`, that are coplanar (each one's points lie
   within a few `--dist` of the other's plane) and whose point sets touch (closest points < `--adjacent`).
   This undoes a flat face being split in two by holds or a slight warp.
5. Per panel: outward normal (away from the centroid of all panel points), lean (degrees, + when the
   normal points down = overhang), and a rectangle in the plane spanned by the in-plane horizontal axis
   (`up x n`, i.e. the viewer's right when facing the wall from outside, the same as from->to in the data
   file) and the in-plane up axis. Its width is measured over the panel's solid core: in-plane columns
   (`--cell` wide) whose occupied height is at least `--fill` x the median column, so a thin wedge of a
   neighbouring face caught where it bends away or crosses the plane is cut off (rows get the same test
   at half the threshold). Within the core the extent is the 1st..99th percentile of the inlier
   coordinates, widened by 1/98 of the span on each side, which recovers the true edge for points
   spread evenly over a rectangle while still ignoring stray points.
6. Order panels counter-clockwise seen from above (the walking order of the data file) by the azimuth of
   their centroid about the overall centroid, starting from the +z direction, and write
   `<out-dir>/panels.json`, `<out-dir>/panels.obj` (two triangles per panel), and print a table.

Lengths in the output are metres; `area` is the surface area actually covered by inlier points (holes
from holds are not counted), `width`/`height` are the rectangle's sides (height is the slant height
along the wall; vertical height = height * cos(lean)).

Known weaknesses: a kinked face (vertical base, steeper top) comes out as two panels; the panels are
independent rectangles, so neighbouring panels neither meet exactly at corners nor close the volume;
faces narrower or smaller than `--min-area` (or mostly covered in volumes) are dropped.
"""
import argparse, json, math, os, time, warnings
import numpy as np

# numpy 2.0 with Apple Accelerate emits spurious overflow/divide warnings from matmul; results are fine
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*encountered in matmul")

NORMAL_TOL_DEG = 25.0      # inlier normal must be within this of the plane normal
VERTICAL_TOL_DEG = 60.0    # panel normal must be within this of horizontal


# ---------------------------------------------------------------------------------------------- input

def load_obj(path):
    """Return (V [n,3] float, F [m,3] int) with polygons fan-triangulated."""
    verts, tris = [], []
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("f "):
                idx = []
                for tok in line.split()[1:]:
                    i = int(tok.split("/", 1)[0])
                    idx.append(i - 1 if i > 0 else len(verts) + i)
                for k in range(1, len(idx) - 1):
                    tris.append((idx[0], idx[k], idx[k + 1]))
    if not verts or not tris:
        raise SystemExit(f"{path}: no vertices/faces found")
    return np.asarray(verts, float), np.asarray(tris, np.int64)


def rotation_to_y(up):
    """Rotation matrix taking unit vector `up` to +y (Rodrigues)."""
    up = up / np.linalg.norm(up)
    y = np.array([0.0, 1.0, 0.0])
    v, c = np.cross(up, y), float(up @ y)
    if np.linalg.norm(v) < 1e-12:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))


def sample_surface(V, F, n, rng):
    """Area-weighted uniform samples: (points [n,3], unit normals [n,3], total area)."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    cr = np.cross(b - a, c - a)
    area2 = np.linalg.norm(cr, axis=1)
    ok = area2 > 1e-14
    a, b, c, cr, area2 = a[ok], b[ok], c[ok], cr[ok], area2[ok]
    pick = rng.choice(len(area2), size=n, p=area2 / area2.sum())
    r1, r2 = rng.random(n), rng.random(n)
    s = np.sqrt(r1)
    P = (1 - s)[:, None] * a[pick] + (s * (1 - r2))[:, None] * b[pick] + (s * r2)[:, None] * c[pick]
    N = cr[pick] / area2[pick, None]
    return P, N, float(area2.sum() / 2)


# ------------------------------------------------------------------------------------------- planes

def fit_plane(P):
    """Least-squares plane through P: (unit normal, d) with n.x + d = 0."""
    c = P.mean(0)
    n = np.linalg.svd(P - c, full_matrices=False)[2][-1]
    return n, -float(n @ c)


def inlier_mask(P, N, n, d, dist, cos_tol):
    return (np.abs(P @ n + d) < dist) & (np.abs(N @ n) > cos_tol)


def in_plane_axes(n, up):
    """Horizontal axis (viewer's right facing the wall from outside) and in-plane up axis."""
    h = np.cross(up, n)
    if np.linalg.norm(h) < 1e-9:          # horizontal plane: any axis will do
        h = np.cross(n, [1.0, 0, 0]) if abs(n[0]) < 0.9 else np.cross(n, [0, 0, 1.0])
    h /= np.linalg.norm(h)
    return h, np.cross(n, h)


def largest_component(P, n, cell):
    """Mask of the points in the largest 8-connected patch of an in-plane occupancy grid."""
    h, u = in_plane_axes(n, np.array([0.0, 1, 0]))
    ij = np.floor(np.stack([P @ h, P @ u], 1) / cell).astype(np.int64)
    cells, inv = np.unique(ij, axis=0, return_inverse=True)
    inv = inv.ravel()
    lookup = {tuple(c): k for k, c in enumerate(cells)}
    label = -np.ones(len(cells), np.int64)
    counts = np.bincount(inv, minlength=len(cells))
    best, best_n, cur = -1, -1, 0
    for start in range(len(cells)):
        if label[start] >= 0:
            continue
        stack, label[start], tot = [start], cur, 0
        while stack:
            k = stack.pop()
            tot += counts[k]
            ci, cj = cells[k]
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    m = lookup.get((ci + di, cj + dj))
                    if m is not None and label[m] < 0:
                        label[m] = cur
                        stack.append(m)
        if tot > best_n:
            best, best_n = cur, tot
        cur += 1
    return label[inv] == best


def ransac_plane(P, N, rng, dist, cos_tol, n_hyp=400, subset=30000, radius=0.6):
    """Best plane by inlier count on a random subset; hypotheses from 3 points within `radius`."""
    S = rng.choice(len(P), size=min(subset, len(P)), replace=False)
    PS, NS = P[S], N[S]
    seeds = rng.choice(len(S), size=min(n_hyp, len(S)), replace=False)
    best = (0, None)
    for chunk in np.array_split(seeds, max(1, len(seeds) // 100)):
        d2 = ((PS[chunk, None, :] - PS[None, :, :]) ** 2).sum(-1)
        planes = []
        for row, s in enumerate(chunk):
            near = np.nonzero(d2[row] < radius * radius)[0]
            if len(near) < 3:
                continue
            j, k = rng.choice(near, size=2, replace=False)
            a, b, c = PS[s], PS[j], PS[k]
            n = np.cross(b - a, c - a)
            ln = np.linalg.norm(n)
            if ln < 1e-6:
                continue
            n /= ln
            if min(abs(NS[s] @ n), abs(NS[j] @ n), abs(NS[k] @ n)) < cos_tol:
                continue
            planes.append(np.append(n, -n @ a))
        if not planes:
            continue
        H = np.array(planes)                                   # [h, 4]
        score = ((np.abs(PS @ H[:, :3].T + H[:, 3]) < dist) & (np.abs(NS @ H[:, :3].T) > cos_tol)).sum(0)
        i = int(score.argmax())
        if score[i] > best[0]:
            best = (int(score[i]), H[i])
    return best[1]


def extract_planes(P, N, area_per_pt, a, rng):
    up = np.array([0.0, 1, 0])
    cos_tol = math.cos(math.radians(NORMAL_TOL_DEG))
    max_up = math.sin(math.radians(VERTICAL_TOL_DEG))       # |n.up| allowed for a "vertical" panel
    min_pts = a.min_area / area_per_pt
    pool = np.arange(len(P))
    panels = []
    for it in range(60):
        if len(pool) < min_pts:
            break
        H = ransac_plane(P[pool], N[pool], rng, a.dist, cos_tol)
        if H is None:
            break
        n, d = H[:3], H[3]
        for _ in range(3):                                     # refine on the full pool
            m = inlier_mask(P[pool], N[pool], n, d, a.dist, cos_tol)
            if m.sum() < 3:
                break
            n, d = fit_plane(P[pool][m])
        m = inlier_mask(P[pool], N[pool], n, d, a.dist, cos_tol)
        idx = pool[m]
        keep = largest_component(P[idx], n, a.cell) if len(idx) else np.zeros(0, bool)
        idx = idx[keep]
        if len(idx) < min_pts:
            print(f"  plane {it}: largest patch {len(idx) * area_per_pt:.2f} m2 < min-area, stop")
            break
        n, d = fit_plane(P[idx])
        horiz = abs(n @ up) > max_up
        kind = "discarded (floor/ceiling)" if horiz else "panel"
        print(f"  plane {it}: {len(idx)} pts, {len(idx) * area_per_pt:.2f} m2, |n.up| {abs(n @ up):.2f} -> {kind}")
        if not horiz:
            panels.append(idx)
        pool = np.setdiff1d(pool, idx, assume_unique=True)
    return panels


# ------------------------------------------------------------------------------------------- panels

def min_dist(A, B, rng, cap=2000):
    if len(A) > cap:
        A = A[rng.choice(len(A), cap, replace=False)]
    if len(B) > cap:
        B = B[rng.choice(len(B), cap, replace=False)]
    best = np.inf
    for chunk in np.array_split(A, max(1, len(A) // 500)):
        best = min(best, float(((chunk[:, None, :] - B[None, :, :]) ** 2).sum(-1).min()))
    return math.sqrt(best)


def merge_panels(P, panels, centre, a, rng):
    """Union panels that are near-parallel, coplanar and touching; repeat until stable."""
    while True:
        fits = []
        for idx in panels:
            n, d = fit_plane(P[idx])
            if n @ (P[idx].mean(0) - centre) < 0:
                n, d = -n, -d
            fits.append((n, d))
        merged = False
        for i in range(len(panels)):
            for j in range(i + 1, len(panels)):
                (ni, di), (nj, dj) = fits[i], fits[j]
                ang = math.degrees(math.acos(float(np.clip(ni @ nj, -1, 1))))
                if ang >= a.merge_deg:
                    continue
                off = max(np.median(np.abs(P[panels[j]] @ ni + di)), np.median(np.abs(P[panels[i]] @ nj + dj)))
                if off > 3 * a.dist:
                    continue
                gap = min_dist(P[panels[i]], P[panels[j]], rng)
                if gap > a.adjacent:
                    continue
                print(f"  merge panels {i}+{j}: {ang:.1f} deg apart, offset {off:.3f} m, gap {gap:.2f} m")
                panels[i] = np.concatenate([panels[i], panels[j]])
                del panels[j]
                merged = True
                break
            if merged:
                break
        if not merged:
            return panels


def solid_range(x, y, cell, frac):
    """Range of x covered by the solid body of a panel.

    Bin x into columns of `cell`, count occupied `cell`-sized y bins in each, keep columns whose fill
    is >= `frac` x the median fill, and return the longest run of kept columns (1-column gaps allowed).
    Thin slivers of a neighbouring face caught near a bend or crossing fill only a few cells per
    column and are cut off; holes from holds lower every column alike and don't matter.
    """
    xi = np.floor((x - x.min()) / cell).astype(np.int64)
    yi = np.floor((y - y.min()) / cell).astype(np.int64)
    occ = np.zeros((xi.max() + 1, yi.max() + 1), bool)
    occ[xi, yi] = True
    fill = occ.sum(1)
    keep = fill >= frac * np.median(fill[fill > 0])
    runs, start, gap = [], None, 0
    for k, ok in enumerate(np.append(keep, [False, False])):
        if ok:
            start, gap = (k if start is None else start), 0
        elif start is not None:
            gap += 1
            if gap > 1:
                runs.append((start, k - gap))
                start, gap = None, 0
    lo, hi = max(runs, key=lambda r: r[1] - r[0])
    return (xi >= lo) & (xi <= hi)


def describe(Pi, centre, area_per_pt, a):
    up = np.array([0.0, 1, 0])
    n, d = fit_plane(Pi)
    c = Pi.mean(0)
    if n @ (c - centre) < 0:
        n = -n
    h, u = in_plane_axes(n, up)
    s, t = (Pi - c) @ h, (Pi - c) @ u
    # width over the solid columns, then height over the rows of those columns (rows only lose
    # sparse spikes: neighbour slivers sit at the sides, floor/ceiling were already rejected by normal)
    in_s = solid_range(s, t, a.cell, a.fill)
    in_t = solid_range(t[in_s], s[in_s], a.cell, a.fill / 2)
    s_core, t_core = s[in_s][in_t], t[in_s][in_t]
    pct = a.pct
    def span(x):
        lo, hi = np.percentile(x, pct), np.percentile(x, 100 - pct)
        pad = (hi - lo) * pct / (100 - 2 * pct)               # undo the percentile shrink for an even spread
        return lo - pad, hi + pad
    s0, s1 = span(s_core)
    t0, t1 = span(t_core)
    corner = lambda si, ti: c + si * h + ti * u
    corners = [corner(s0, t1), corner(s1, t1), corner(s1, t0), corner(s0, t0)]   # TL TR BR BL from outside
    lean = math.degrees(math.asin(float(np.clip(-(n @ up), -1, 1))))
    return dict(
        corners=[[round(float(v), 4) for v in p] for p in corners],
        normal=[round(float(v), 4) for v in n],
        lean=round(lean, 1),
        width=round(float(s1 - s0), 3),
        height=round(float(t1 - t0), 3),
        area=round(len(Pi) * area_per_pt, 2),
        inliers=int(len(Pi)),
        centroid=[round(float(v), 4) for v in c],
    )


def write_obj(path, panels):
    with open(path, "w") as fh:
        fh.write("# panels from scripts/mesh-to-panels.py; metres, y up\n")
        for k, p in enumerate(panels):
            fh.write(f"o panel_{k + 1}\n")
            for v in p["corners"]:
                fh.write("v {:.4f} {:.4f} {:.4f}\n".format(*v))
            fh.write("vn {:.4f} {:.4f} {:.4f}\n".format(*p["normal"]))
            b = 4 * k + 1                                        # TL, TR, BR, BL -> CCW from outside
            fh.write(f"f {b}//{k + 1} {b + 3}//{k + 1} {b + 2}//{k + 1}\n")
            fh.write(f"f {b}//{k + 1} {b + 2}//{k + 1} {b + 1}//{k + 1}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("obj")
    ap.add_argument("--up", default="0,1,0", help="up direction in mesh coordinates (default 0,1,0)")
    ap.add_argument("--scale", type=float, default=1.0, help="metres per mesh unit")
    ap.add_argument("--dist", type=float, default=0.03, help="plane inlier distance, m")
    ap.add_argument("--min-area", type=float, default=0.5, help="smallest panel kept, m2")
    ap.add_argument("--merge-deg", type=float, default=8.0, help="merge touching coplanar panels closer than this")
    ap.add_argument("--samples", type=int, default=200000, help="surface samples")
    ap.add_argument("--adjacent", type=float, default=0.25, help="max gap between point sets to merge, m")
    ap.add_argument("--cell", type=float, default=0.15, help="grid cell for the connected-patch test, m")
    ap.add_argument("--pct", type=float, default=1.0, help="percentile trimmed from each edge of a panel")
    ap.add_argument("--fill", type=float, default=0.6, help="column/row fill (x median) counted as solid panel")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out-dir", default="model")
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    t0 = time.time()

    V, F = load_obj(a.obj)
    up = np.array([float(x) for x in a.up.split(",")])
    V = (V @ rotation_to_y(up).T) * a.scale
    print(f"{a.obj}: {len(V)} vertices, {len(F)} triangles ({time.time() - t0:.1f} s)")
    P, N, total_area = sample_surface(V, F, a.samples, rng)
    area_per_pt = total_area / a.samples
    print(f"surface {total_area:.1f} m2, {a.samples} samples, {math.sqrt(area_per_pt) * 100:.1f} cm spacing")

    panels = extract_planes(P, N, area_per_pt, a, rng)
    if not panels:
        raise SystemExit("no vertical panels found")
    centre = P[np.concatenate(panels)].mean(0)
    panels = merge_panels(P, panels, centre, a, rng)
    centre = P[np.concatenate(panels)].mean(0)
    out = [describe(P[idx], centre, area_per_pt, a) for idx in panels]

    # counter-clockwise from above (y up): azimuth atan2(x, z) increases along the walking direction
    for p in out:
        r = np.array(p["centroid"]) - centre
        p["azimuth"] = round(math.degrees(math.atan2(r[0], r[2])) % 360, 1)
    out.sort(key=lambda p: p["azimuth"])

    os.makedirs(a.out_dir, exist_ok=True)
    jpath, opath = os.path.join(a.out_dir, "panels.json"), os.path.join(a.out_dir, "panels.obj")
    with open(jpath, "w") as fh:
        json.dump(out, fh, indent=1)
    write_obj(opath, out)

    print(f"\n{'#':>2} {'azim':>6} {'width':>6} {'height':>6} {'lean':>6} {'area':>6} {'inliers':>7}  normal")
    for k, p in enumerate(out, 1):
        print(f"{k:>2} {p['azimuth']:>6.1f} {p['width']:>6.2f} {p['height']:>6.2f} {p['lean']:>+6.1f} "
              f"{p['area']:>6.2f} {p['inliers']:>7}  {p['normal']}")
    print(f"\n{len(out)} panels -> {jpath}, {opath} ({time.time() - t0:.1f} s)")


if __name__ == "__main__":
    main()
