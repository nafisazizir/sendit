# First iteration: where the playground is and what is left

Written 11 Oct 2026, the same day as the photos. Phase 1 of `SPEC.md` is "one Jawa face, zoomable photo, hold outlines, tap a problem to highlight it, data in a JSON file, a rough editor". Exit condition: *you open it on your phone at the wall and it feels right*.

## What exists now

- All nine Jawa faces wired up with anchor and angle photos from the 11 Oct shoot (web-sized, metadata stripped).
- Three faces labelled with hold outlines: **F3** (18 holds), **F4** (18), **F8** (39). Outlines were estimated off the photos by eye and are rough; the editor is there to fix them.
- 12 problems grouped from hold colour, position and the START/FINISH tags visible in the photos. **All are marked unverified.** Two cross a corner (blue F3→F4, purple F5→F4), which exercises the hard data-model case.
- Viewer: pinch/wheel zoom, pan, double-tap zoom, problem spotlight with S/T badges, zoom-to-problem, cross-face jump chips, grade filter.
- Editor: draw outlines by tapping, drag corners, colour/type/note, assign to problem, start/top, new/delete problems, verified flag, set date. Draft kept in the browser; Save writes `src/data/jawa.json` through the dev server; Download as fallback.
- Block view: Jawa as a nine-face prism in three.js with the anchor photos projected on it and the same outlines drawn; tap a hold to spotlight its problem in 3D, tap a face to open it. Built to answer "do I want to *see the block* rather than page through faces?" — compare the two on your phone.
- Scripts: `npm run photos` (HEIC → web JPEG from a mapping file), `scripts/gen-initial-data.mjs` (the one-off that produced the first JSON; retire it once you edit in the app).

## Assumptions I made that you should check first

1. **Face numbering.** I numbered faces clockwise in the order you shot them: F1 = yellow slab (1936–37), F2 = 1938, F3 = 1939–40 (sparse face under the JAWA sign), F4 = 1941–43 (orange horn, green rails), F5 = 1944–46 (red arete), F6 = 1947–49, F7 = 1950–52, F8 = 1953–57 (steep face under the JAWA sign), F9 = 1958–60. This matches your "retake 1, 5, 6, 8, 9" note, which is why I trust it, but if your numbering differs, fix `scripts/photo-map.txt`, re-run `npm run photos`, and rename the face ids in the JSON.
2. **Problem groupings.** Every problem is a guess. The ones I am fairly confident about: green F4 (START tag on the lower rail, FINISH by the top crimp), green F8 (START by the low green pair), orange F4 (FINISH under the small orange). The black hold on F4 has a FINISH tag beside it, so the black line comes from F3 or F5. The two red lines on F8 are split arbitrarily.
3. **Yellow = downclimb, never a problem.** Encoded as a default in the editor (yellow holds become `downclimb` unless you change the type).
4. **Volumes are shared** and belong to no problem (grey, black and purple blocks). A purple volume with purple holds on it is still a volume here.
5. **Block geometry comes from photogrammetry, not a tape.** Superseded the first hand guess: `docs/model.md` has the pipeline, per-face confidence and the one assumption that sets the scale (20 cm T-nut pitch). Shape, angles and the photo quads are data-driven; absolute size is not yet.

## To do for phase 1 to be "done"

**At the gym (next visit)**

- [ ] Open the Network URL on your phone and stand at F4. Does the zoom feel right? Do highlighted holds read at arm's length? Is the dim-everything-else spotlight too dark for the photo? Note what annoys you; that list is the real output of phase 1.
- [ ] Switch to **Block** at the same spot. Which do you reach for to find a problem on the far side: orbiting the block, or ‹ › through faces? That answers the 3D-vs-photo question with real evidence instead of taste.
- [ ] Measure **one** thing to fix the block's scale: the T-nut pitch along a row (hole centre to hole centre) or the wall height. Widths along the mat edge for F4 and F6 would be a good cross-check. See `docs/model.md`.
- [ ] Verify the 12 problems against the wall. Tick "Checked at the wall" in the editor as you go. Fix the groupings that are wrong; I expect several.
- [ ] Read the tags I could not: F3 white hold, F3 green crimp, F8 red big (top-left), F8 orange on the pyramid, F8 red right. Put the tag text in the hold note.
- [ ] Retake straight-on anchors for F1, F5, F6, F8, F9 (already on the spec list). F3's anchor has a person in it too.
- [ ] Ask staff for the set-up date of the current Jawa set and put it in the editor ("Set went up").

**At home**

- [ ] Decide whether the editor should live on the phone (draft + Download) or the laptop (Save to repo). Right now both work; the phone path needs the JSON moved by hand.
- [ ] Decide what happens when you tap a hold that belongs to no problem: currently a toast. Fine for now, maybe not later.
- [ ] Try the mobile layout for real. I could only check the desktop layout in the browser here (the phone-width grid is written but untested).

## Known rough edges in the code

- The block view is *not* a 3D model of holds: it is nine flat quads with photos mapped onto them through a per-face homography. Holds on volumes and anything the photo saw at an angle sit slightly off the true surface, and F7–F9 have a kink the single plane ignores. Good enough to judge navigation, not beta. A real mesh is phase 8; the SfM model in `model/colmap/` is its starting point.
- Block textures are redrawn from the 2000 px photos at 1024 px wide on every selection change (nine canvases). Fine on a laptop; watch for jank on an older phone.

- Hold outlines are polygons in normalised photo coordinates. That is the right shape for v1; if you later move to a different anchor photo for the same face (retake), every outline on that face has to be re-drawn or warped. Phase 6 territory.
- Tap hit-testing picks the smallest polygon under the finger, so a hold on a volume wins over the volume. Nothing is done about holds that overlap each other.
- The dev-server save endpoint has no auth and only runs under `npm run dev`. Fine for phase 1 and 2; phase 3 replaces it.
- The editor has no undo beyond "Discard all". Save often.
- Zoom-to-problem is capped at 4× fit so a single crimp does not become a blurry square.
- The draft-restore notice can appear after a dev-server reload if the JSON file changed under an open editor (HMR swaps the module while the reducer keeps the old state). Harmless: Discard clears it.

## Suggested order for phase 2

1. Label F5 so the purple F5→F4 problem and the black line are complete. F5 is the arete and the hardest photo; an angled anchor may be enough for now.
2. Then F2, F1, F9, F6, F7. Time each face; the spec target is under 15 minutes.
3. Once a face is comfortably under 15 minutes, write down what slowed you down. That is the brief for the "proper editor" in phase 2.

## Open questions from the spec I could partly answer from the photos

- *What do the start tags show?* Plain "START" and "FINISH" text on small white tags next to holds, sometimes rotated. No number or setter visible at this resolution.
- *Is the top marked?* Yes, FINISH tags exist (F4 black, F4 orange, F4 green, F8 orange, F8 green).
- *Do two START tags on one hold mean both hands?* F4 has two START tags next to each other at the black/orange holds, which belong to different problems, so a double tag does not necessarily mean both hands.
