#!/usr/bin/env python3
"""
Copy an OBJ keeping only the faces whose vertices all lie inside an axis-aligned box.

  python3 scripts/clip-obj.py in.obj out.obj --box x0,x1,y0,y1,z0,z1

Box is in mesh units. Only `v` and `f` lines are written (texture coordinates, normals, materials and
groups are dropped); face tokens like `a/b/c` are reduced to the vertex index, negative indices are
resolved, and the kept vertices are renumbered. Numpy only.
"""
import argparse
import numpy as np


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--box", required=True, help="x0,x1,y0,y1,z0,z1 in mesh units")
    a = ap.parse_args()
    b = [float(t) for t in a.box.split(",")]
    if len(b) != 6:
        raise SystemExit("--box needs six numbers")
    lo, hi = np.array(b[0::2]), np.array(b[1::2])

    verts, faces = [], []
    with open(a.src, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("f "):
                idx = []
                for tok in line.split()[1:]:
                    i = int(tok.split("/", 1)[0])
                    idx.append(i - 1 if i > 0 else len(verts) + i)
                faces.append(idx)
    V = np.asarray(verts, float)
    inside = np.all((V >= lo) & (V <= hi), axis=1)
    kept = [f for f in faces if all(inside[i] for i in f)]
    used = np.zeros(len(V), bool)
    for f in kept:
        used[f] = True
    new_id = np.cumsum(used)  # 1-based for used vertices
    with open(a.dst, "w") as out:
        out.write(f"# clipped from {a.src} with box {a.box}\n")
        for v in V[used]:
            out.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for f in kept:
            out.write("f " + " ".join(str(new_id[i]) for i in f) + "\n")
    Vu = V[used]
    print(f"{a.src}: {len(V)} verts, {len(faces)} faces -> {used.sum()} verts, {len(kept)} faces")
    if len(Vu):
        print("kept bbox min", np.round(Vu.min(0), 3), "max", np.round(Vu.max(0), 3))


if __name__ == "__main__":
    main()
