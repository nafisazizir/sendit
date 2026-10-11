# Jawa block model: how the geometry was made and how much to trust it

Made 11 Oct 2026 from the same 27 photos and the 52-second walk-around video used for labelling. No tape measure was involved. Everything here is the input to the block view (`faces[].geometry` in `src/data/jawa.json`) and will be corrected by ten minutes with a tape at the gym.

## Pipeline

`scripts/model.sh` runs the whole thing; the pieces:

1. `scripts/sfm.py` — sparse structure-from-motion with **pycolmap 3.13** on CPU. Input: the 25 web-sized Jawa photos plus 103 frames pulled from the video at 2 fps (`model/images/`, not in git). Result: **126 of 128 images registered in one model, 26 138 points, all nine anchor photos included**, in ~80 s on the M4 Max. Output in `model/colmap/sparse-txt/` (cameras, poses, points as text; 34 MB, ignored by git — `scripts/model.sh` regenerates it in about two minutes). The fit report `model/faces-fit.json` and the check images are small and kept.
2. `scripts/fit-faces.py` — for each face: take the 3D points its anchor photo sees in the central 70 % of the frame, RANSAC-fit a plane, then collect every point in the model lying on that plane *and* projecting inside the anchor frame (the anchor defines the face). Gravity is the mean "down" axis of all 126 cameras (phones held upright; spread 2.5°). Floor = median of per-face lowest points; top = a high percentile across faces. Footprint corners come from the intersection of neighbouring planes with the floor where the dihedral angle is ≥ 25° and the intersection is near the point extent, otherwise from the point extent. The wall quad (four 3D corners) is projected back into the anchor photo with COLMAP's camera to give `geometry.quad`.
3. `scripts/apply-fit.mjs` — writes `from`, `to`, `height`, `lean`, `quad`, `source: "sfm"` into the data file.
4. `scripts/draw-quads.py` — draws each quad on its anchor photo into `model/check/` so the fit can be eyeballed. Look at these first if anything in the block view seems off.

## Scale

SfM has no units. Scale was set from the **T-nut grid in the F4 anchor: 150 px between holes in a row at the photo centre, assumed to be 0.20 m** (a staggered 200 mm grid, which is what the 2:1 row/column pattern in the photo looks like). If the real pitch is different, every length below scales by the same factor; the shape, angles and photo quads do not change. **Measure one T-nut pitch (hole centre to hole centre along a row) or the wall height at the gym and I'll rescale.**

## Results

| Face | Width | Lean | Corners | Confidence |
| --- | --- | --- | --- | --- |
| F1 | 1.44 m | +7° | both from plane intersections (41°, 44°) | good; F1 is the narrow yellow slab, the right half of its photo is F2 |
| F2 | 2.40 m | −3° | intersections (44°, 48°) | good |
| F3 | 2.57 m | +4° | intersections (48°, 40°) | good; sparse points (plain plywood) but a clean plane |
| F4 | 2.38 m | −1° | intersection (40°) / point extent | good; right end is where the wall visibly bends (9.5° to F5) |
| F5 | 2.44 m | +1° | point extent / intersection (111°) | fair; its anchor is centred on the arete, fit uses the left 45 % of the frame |
| F6 | 4.44 m | +1° | intersection (111°) / point extent | fair; wide face, right end limited by the anchor frame |
| F7 | 2.44 m | +15° | point extents | fair; 16° / 9° to its neighbours so corners are soft |
| F8 | 2.32 m | +20° | point extent / intersection (62°) | good; white holds on the right are on F9's plane, as the problem notes guessed |
| F9 | 1.36 m | +20° | intersections (62°, 41°) | good; narrow arete face |

Lean is positive when the face overhangs. Perimeter 21.8 m. Height 3.34 m everywhere (one shared top). Gaps of a few tens of centimetres between F6→F7 and F7→F8 are expected: those corners are soft bends, not edges.

## Known limitations

- **Single plane per face.** F7, F8 and F9 kink: a vertical base and a steeper upper section. The fit takes the upper section (where the holds and chalk are), so the lower metre of those faces is extrapolated in front of the true base by up to ~0.4 m. The photo texture still lands right because the quad is projected through the real camera, but the floor footprint there is approximate.
- **Height is underestimated** if anything: the plain plywood near the top gives few points. A tape measurement replaces it in one number.
- **Scale assumption** as above.
- The arete face F5's anchor should be re-shot centred on the face itself (already on the retake list).
- F1 and F2 share one photo region in the fit (the F1 anchor contains both). Good enough; a retake of F1 fixes it.

## When you have measurements

Put them straight into `faces[].geometry` (metres, `from`/`to` on the floor, `height`, `lean` in degrees) and set `source: "measured"`. Keep `quad` from the fit — it is the photo-space mapping and does not depend on the metric scale. If only the T-nut pitch or the height is measured, re-run `scripts/model.sh` with the new `--pitch-m` (or tell me the number).

## Object Capture experiment (11 Oct 2026)

Apple Object Capture, medium detail, same photos. `scripts/clip-obj.py --box=-1,0.9,0.05,1.0,-1.05,1.05` (lower 60 %), then `scripts/mesh-to-panels.py --scale 2.6 --dist 0.065 --min-area 0.68 --adjacent 0.33 --cell 0.2` → `model/panels.json`.

**Mesh: rough.** Lower 60 % good; top third blobby with a junk sheet; floor and room included; HEIC-only input gives a C-shape. Azimuths match the SfM frame to ~2°.

| Face | SfM width, lean | Mesh (units), lean | Result |
| --- | --- | --- | --- |
| F1 | 1.44 m, +7° | 0.58, +6° | match |
| F2 | 2.40, −3° | 0.79, −4° | match (kink splits it at finer settings) |
| F3 | 2.57, +4° | 0.52, +2° | match |
| F4 | 2.38, −1° | 0.84, −1° | match |
| F5 | 2.44, +1° | — | missing |
| — | — | 0.37, −1° | extra face between F5 and F6 |
| F6 | 4.44, +1° | 1.28, +2° | match (+ a junk volume panel) |
| F7 | 2.44, +15° | 0.67, +37° | lower part, lean off |
| F8 | 2.32, +20° | 0.28, +23° | upper part, tentative |
| F9 | 1.36, +20° | 0.35, +19° | match |

**Scale** (relative to the SfM's assumed T-nut pitch): perimeter 5.7 units by panels, 4.7 by mid-height outline → 3.8–4.6 m/unit; wall top ~1.3 units → 2.6 m/unit. These disagree, so the SfM footprint and height are inconsistent. Tape needed.

**Purpose-shot recipe (iPhone 13):** 120–200 photos every 10–15°, 70–80 % overlap; two rings (chest height; held high, tilted down); AE/AF locked; no people; ideally during a strip.
