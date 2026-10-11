# sendit (working name)

Unofficial viewer for the Urban Climb West End boulder hall. See `SPEC.md` for the full plan.

This repo is currently the **phase 1 playground**: one wall (Jawa), nine faces, a zoomable photo per face with hold outlines, a list of problems that light up when tapped, a rough editor for drawing holds and grouping them into problems, and a "block" view that shows the whole wall as a low-poly 3D prism with the photos projected on it. Data lives in one JSON file. No accounts, no database.

## Run it

```sh
npm install
npm run dev
```

Vite prints a `Network:` address (e.g. `http://192.168.0.101:5173`). Open that on your phone while it is on the same wifi. Add it to the home screen for a full-screen feel.

`?face=4` in the URL opens a specific face.

## Use it

**Viewing**

- Pinch / scroll-wheel to zoom, drag to pan, double-tap to zoom in or back out.
- Tap a problem in the list: the photo dims except for its holds, start holds get an **S** badge, the top gets a **T**, and the view zooms to it.
- Tap a hold on the photo to select the problem it belongs to.
- Problems that cross a corner show **F3 / F4** chips; tap one to jump faces with the problem still selected.
- Grade dots at the top filter the list.

**Block view** (tap **Block**)

- Jawa as a nine-sided prism with F1–F9 labels. Drag to orbit, pinch to zoom; ‹ › swings the camera to that face. Each face is its anchor photo (only the wall region, perspective-corrected) with the same hold outlines.
- Tap a hold to spotlight its problem on the block; tap a bare face to make it current; **Open face N ›** drops into the photo view of that face.
- The footprint, leans, height and the photo quads in `faces[].geometry` come from a structure-from-motion pass over the photos and video (`docs/model.md`, `scripts/model.sh`). Shape and angles are solid; absolute scale assumes a 20 cm T-nut pitch until something is measured. `?view=block` in the URL opens straight into it.

**Editing** (tap **Edit**)

- **Draw**: pick a colour and type, tap around a hold to outline it, then **Finish hold**. Yellow defaults to *downclimb*.
- **Select**: tap a hold to change colour, type, note, which problem it belongs to, and whether it is a **Start** or the **Top**. Drag the white corner handles to fix an outline. Delete it if it is wrong.
- Problems can be created from a hold (**+ New … problem**) or from the dropdown. Tick **Checked at the wall** once you have confirmed a problem in person.
- Every change is kept as a draft in the browser. **Save** writes it back to `src/data/jawa.json` through the dev server. **Download** gives you the JSON if the dev server is not reachable (e.g. editing at the gym, laptop at home). **Discard** throws the draft away.

## Data

`src/data/jawa.json` is the whole dataset. Shape (see `src/types.ts`):

- `walls` → `faces` (walking order, angle, rough 3D `geometry`) — things that never change.
- `sets` — one per reset of a wall. Each set owns its `photos`, `holds` and `problems`, so a reset adds a set and never overwrites one.
- A `hold` has an `outline` in normalised photo coordinates (0..1) on its face's anchor photo, a `colour` and a `type` (`hold`, shared `volume`, or `downclimb`).
- A `problem` is a list of hold ids on any face of the wall, plus `startHoldIds`, `finishHoldId`, and `verified`.

`scripts/gen-initial-data.mjs` is the script that produced the first version of the file from hand-estimated coordinates. Once you have edited the JSON in the app, stop using the script, or it will overwrite your work.

## Block model

`scripts/model.sh` rebuilds the 3D geometry from the photos: `sfm.py` (pycolmap, CPU) → `fit-faces.py` (plane per face, footprint, photo quads) → `apply-fit.mjs` (into the data file) → `draw-quads.py` (check images in `model/check/`). Needs `python3 -m pip install --user pycolmap numpy`. See `docs/model.md` for what it does and how far to trust it.

## Photos

Raw phone photos go in `raw-assets/` (ignored by git). `scripts/photo-map.txt` maps each raw file to a face and role; `npm run photos` converts them to web-sized JPEGs under `public/photos/` with metadata stripped.

## Layout

```
src/
  App.tsx                  state and wiring
  components/PhotoCanvas   pan / pinch / zoom, tap and handle-drag detection
  components/BlockView     three.js prism of the wall, photos mapped through per-face quads, tap → hold / face
  components/HoldLayer     outlines, spotlight mask, S/T badges, draft polygon
  components/ProblemSheet  problem list, grade filter, selected problem bar
  components/Editor        editor panel
  components/FaceSwitcher, GradeChip
  store.ts                 reducer, draft persistence, save / download
  grades.ts                the eight grade colours (defined here and nowhere else)
  geometry.ts              point-in-polygon, bounds, centroid
  data/jawa.json           the data
vite.config.ts             dev-only POST /api/save that writes the JSON
```
