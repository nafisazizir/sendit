#!/usr/bin/env python3
"""
Build a synthetic test mesh of the Jawa block for scripts/mesh-to-panels.py, and check its result.

  python3 scripts/make-test-block.py                      # writes model/test-block.obj
  python3 scripts/mesh-to-panels.py model/test-block.obj
  python3 scripts/make-test-block.py --check model/panels.json   # input vs recovered table

The block is made from the real `faces[].geometry` in src/data/jawa.json (metres, y up, footprint
[x, z]): each face is a rectangle standing on its `from`->`to` floor segment, `height` tall, its top
pushed outward by height * tan(lean). Faces are independent quads, exactly as the data describes them,
so where the data's footprints overlap or leave gaps (F4/F5, F6/F7/F8) the test block does too.
Each wall is tessellated into ~10 cm triangles, displaced outward by random Gaussian "hold" bumps
5-15 cm high, and every vertex gets ~5 mm of noise. A tessellated floor disc surrounds the block.
"""
import argparse, json, math, os
import numpy as np

UP = np.array([0.0, 1.0, 0.0])


def faces_from_data(path):
    data = json.load(open(path))
    out = []
    for f in data["faces"]:
        g = f["geometry"]
        a = np.array([g["from"][0], 0.0, g["from"][1]])
        b = np.array([g["to"][0], 0.0, g["to"][1]])
        lat = (b - a) / np.linalg.norm(b - a)
        n_h = np.cross(lat, UP)                       # outward horizontal normal (lat = up x n)
        out.append(dict(id=f["id"], a=a, b=b, lat=lat, n_h=n_h, height=g["height"], lean=g["lean"],
                        width=float(np.linalg.norm(b - a))))
    return out


def wall_mesh(f, rng, step, bumps_per_m2):
    H, lean = f["height"], math.radians(f["lean"])
    top_off = f["n_h"] * H * math.tan(lean) + UP * H
    slant = H / math.cos(lean)
    nu, nv = max(2, math.ceil(f["width"] / step) + 1), max(2, math.ceil(slant / step) + 1)
    s, t = np.meshgrid(np.linspace(0, 1, nu), np.linspace(0, 1, nv), indexing="ij")
    V = f["a"] + s[..., None] * (f["b"] - f["a"]) + t[..., None] * top_off      # [nu, nv, 3]
    # outward plane normal of the leaning wall
    n = np.cross(f["b"] - f["a"], top_off)
    n /= np.linalg.norm(n)
    if n @ f["n_h"] < 0:
        n = -n
    # hold bumps: Gaussian blobs in wall coordinates (metres along width, along slant)
    k = rng.poisson(bumps_per_m2 * f["width"] * slant)
    cu, cv = rng.uniform(0, f["width"], k), rng.uniform(0, slant, k)
    hgt, rad = rng.uniform(0.05, 0.15, k), rng.uniform(0.06, 0.12, k)
    su, sv = s * f["width"], t * slant
    disp = np.zeros_like(s)
    for i in range(k):
        disp += hgt[i] * np.exp(-((su - cu[i]) ** 2 + (sv - cv[i]) ** 2) / (2 * rad[i] ** 2))
    V = V + disp[..., None] * n
    idx = np.arange(nu * nv).reshape(nu, nv)
    q = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
    T = np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]])
    return V.reshape(-1, 3), T


def floor_disc(centre, radius, step):
    V, T = [centre.copy()], []
    prev = [0]
    rings = math.ceil(radius / step)
    for r_i in range(1, rings + 1):
        r = radius * r_i / rings
        m = max(6, math.ceil(2 * math.pi * r / step))
        ang = np.linspace(0, 2 * math.pi, m, endpoint=False)
        start = len(V)
        V.extend(centre + np.stack([r * np.cos(ang), np.zeros(m), r * np.sin(ang)], 1))
        cur = list(range(start, start + m))
        # stitch ring prev -> cur by walking both by angle
        i = j = 0
        np_, nc = len(prev), len(cur)
        while i < np_ or j < nc:
            if j < nc and (i >= np_ or (j + 1) / nc <= (i + 1) / np_):
                T.append((prev[i % np_], cur[(j + 1) % nc], cur[j]))
                j += 1
            else:
                T.append((prev[i % np_], prev[(i + 1) % np_], cur[j % nc]))
                i += 1
        prev = cur
    return np.array(V), np.array(T)


def build(a):
    rng = np.random.default_rng(a.seed)
    faces = faces_from_data(a.data)
    Vs, Ts, off = [], [], 0
    for f in faces:
        V, T = wall_mesh(f, rng, a.step, a.bumps)
        Vs.append(V); Ts.append(T + off); off += len(V)
    foot = np.array([p for f in faces for p in (f["a"], f["b"])])
    c = foot.mean(0)
    R = float(np.linalg.norm(foot - c, axis=1).max()) + 1.0
    V, T = floor_disc(c, R, a.step * 2)
    Vs.append(V); Ts.append(T + off)
    V, T = np.concatenate(Vs), np.concatenate(Ts)
    V = V + rng.normal(0, a.noise, V.shape)
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as fh:
        fh.write("# synthetic Jawa test block from scripts/make-test-block.py; metres, y up\n")
        fh.write("".join("v %.4f %.4f %.4f\n" % tuple(v) for v in V))
        fh.write("".join("f %d %d %d\n" % tuple(t + 1) for t in T))
    print(f"{a.out}: {len(V)} vertices, {len(T)} triangles, {len(faces)} walls, floor disc r={R:.1f} m")


def check(a):
    faces = faces_from_data(a.data)
    panels = json.load(open(a.check))
    print(f"{len(panels)} panels recovered for {len(faces)} faces\n")
    print(f"{'face':<8} {'width in':>8} {'out':>6} {'err':>6}   {'lean in':>7} {'out':>6} {'err':>5}   panel")
    used = set()
    for f in faces:
        n_true = f["n_h"] * math.cos(math.radians(f["lean"])) - UP * math.sin(math.radians(f["lean"]))
        mid = (f["a"] + f["b"]) / 2 + UP * f["height"] / 2
        best = min(range(len(panels)), key=lambda k: (np.degrees(np.arccos(np.clip(np.array(panels[k]["normal"]) @ n_true, -1, 1)))
                                                     + 10 * np.linalg.norm(np.array(panels[k]["centroid"]) - mid)))
        p = panels[best]
        ang = np.degrees(np.arccos(np.clip(np.array(p["normal"]) @ n_true, -1, 1)))
        if ang > 15:
            print(f"{f['id']:<8} {f['width']:>8.2f}   (no matching panel)")
            continue
        used.add(best)
        we = (p["width"] - f["width"]) / f["width"] * 100
        print(f"{f['id']:<8} {f['width']:>8.2f} {p['width']:>6.2f} {we:>+5.1f}%   {f['lean']:>+7.1f} {p['lean']:>+6.1f} "
              f"{p['lean'] - f['lean']:>+5.1f}   #{best + 1}")
    extra = [k + 1 for k in range(len(panels)) if k not in used]
    if extra:
        print(f"unmatched panels: {extra}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", default="src/data/jawa.json")
    ap.add_argument("--out", default="model/test-block.obj")
    ap.add_argument("--step", type=float, default=0.10, help="triangle size, m")
    ap.add_argument("--bumps", type=float, default=4.0, help="holds per m2")
    ap.add_argument("--noise", type=float, default=0.005, help="vertex noise sigma, m")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--check", metavar="PANELS_JSON", help="compare a panels.json against the input faces instead")
    a = ap.parse_args()
    check(a) if a.check else build(a)


if __name__ == "__main__":
    main()
