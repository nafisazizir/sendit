# Urban Climb bouldering app: spec and roadmap

Oct 11, 2026 · @Nafis

An unofficial app for the Urban Climb West End boulder hall that shows every wall, the problems currently set on it, and an archive of past sets. Version 1 is a hand-built snapshot of one or two walls; automatic problem generation comes later, once there is labelled data to build it on.

## Scope of v1

Version 1 proves the viewer is worth using before any automation is built. You are the only user and the only person adding data.

**In v1**

- A top-down map of the boulder hall with named walls (Jawa, Stronach and so on).
- A face view per wall: one photo, with each problem tappable and its holds highlighted.
- Grade shown by hold colour, with yellow downclimb holds kept in their own bucket.
- A "set on" date per face, and set history kept from day one.
- Your own logging per problem: sent, project, attempts.
- An internal editor for marking holds, grouping them into problems, and marking starts and tops.

**Not in v1**

- Other users, accounts, or shared beta.
- In-app capture of a new face or reset.
- Automatic hold detection and problem generation.
- The 3D model of the hall.
- AI beta.

## Boulder hall reference

The app covers six walls in the boulder hall; the lead rope gym and the spray wall are out of scope.

**Walls in scope:** Jawa (first wall), Stronach, Latte, Atelier, Graceland, The Burrow.

**Out of scope:** The Garage (spray wall, already covered by Stōkt) and everything in the rope gym.

**Grade order, easiest to hardest:** yellow, blue, purple, green, orange, red, black, white. Holds that look pink are faded red, so red detection has to tolerate fading.

**The gym's printed map** is a guide to which wall is where, not a source of measurements. It is not to scale. Wall shapes and positions come from your own photos and, later, the scan. Redraw the floor plan as your own outline; do not reuse the gym's artwork.

## Build order

Build a playground of the real Jawa wall first, then the foundations, then features. The wall view is the product; brand, infrastructure and logging are only worth doing once the wall view feels right on a phone at the gym.

Why this order:

- The open risk is the experience of browsing a wall on a phone: how the zoom feels, whether highlighted problems read clearly, how a problem that wraps a corner is shown. Features do not reduce that risk.
- The playground forces the real decisions about the data shape (holds, faces, cross-face problems) before a database locks them in.
- You already have the photos and a first-pass problem list for Jawa, so the playground can start today.
- Brand and components are faster to design once there is a real screen to design for.

What the playground is: one page, one Jawa face, a zoomable photo with hold outlines drawn over it, and a list of problems that highlight when tapped. Data lives in a single JSON file in the repository. It has no accounts, no database and no styling beyond the basics.

## Roadmap

Each phase starts only when the one before it has met its exit condition. No dates are set, since this is a side project. Phases 1 to 5 are version 1.

| Phase | What it delivers | Done when |
| --- | --- | --- |
| 0. Capture | Hall map, grade order, 24 photos of Jawa (done); straight-on retakes of five faces (to do) | Every Jawa face has a clean anchor photo |
| 1. Playground | One Jawa face: zoomable photo, hold outlines, tap a problem to highlight it. Data in a JSON file. A rough editor mode to draw outlines | You open it on your phone at the wall and it feels right |
| 2. Editor and all of Jawa | Proper editor (outline, assign, mark start and finish). All nine faces. Problems that cross corners | Jawa is fully labelled, and a face takes under 15 minutes |
| 3. Foundations | Name and brand, design tokens and components, database and image storage, deployment, hall map | The app is live at its own address with Jawa loaded from the database |
| 4. Core features | Personal logging, grade filter, set dates and archive view | You have used it for two weeks of sessions |
| 5. Second wall and first reset | Stronach added. One wall relabelled after a reset, old set archived | The archive shows two sets for one wall |
| 6. Assisted labelling | Scripts that read the START and FINISH tags, detect holds and propose groupings to pre-fill the editor | A face is fixable in under ten taps and two minutes |
| 7. Capture flow | Guided in-app capture that queues a generation job | Someone other than you can add a reset |
| 8. 3D hall | One scan of the hall as a simplified mesh with face photos projected onto it | You can navigate the hall in 3D with current sets |
| 9. Beta | AI-suggested beta, then contributed beta | Decide once phases 1 to 7 are in use |

The trigger for phase 6 is annoyance: when relabelling by hand after resets starts to feel like a chore, build the assistance. The faces labelled in phases 1 to 5 become the test set that phase 6 is scored against.

## Groundwork

This is the phase 3 work, listed here so the choices are made once. None of it blocks the playground. The interface and infrastructure start from scratch for this project, with nothing carried over from other work.

**Brand**

- Pick a working name that does not include "Urban Climb", and state "unofficial" in the app footer.
- Keep the interface monochrome. The hold colours carry the meaning, so the interface around them should stay neutral.
- Define eight grade colour tokens (yellow, blue, purple, green, orange, red, black, white) and use them nowhere else.
- Pair every grade colour with a text label, so the app works for colour-blind users and on photos with poor lighting.

**Interface components**

| Component | Used for |
| --- | --- |
| Photo canvas | Zoom and pan a face photo with hold outlines drawn over it. This is the core component |
| Face switcher | Move around a wall, face by face, in walking order |
| Problem sheet | List of problems on the wall with grade, start and finish; tapping one highlights it |
| Grade chip | Colour and label for a grade, also used as a filter |
| Log control | Mark a problem as sent or as a project, with attempts |
| Set timeline | Step back through earlier sets of a wall |
| Hall map | Pick a wall from your own redrawn floor plan |
| Editor tools | Outline a hold, assign it to a problem, mark start and finish, flag a volume |

**Infrastructure**

| Layer | Choice for v1 | Reason |
| --- | --- | --- |
| App | A web app that installs to the phone home screen | No app store, one codebase, quick to change |
| Hosting | Not chosen yet | Decide at phase 3; the app needs static hosting plus a small API |
| Data | JSON file in the repository for phases 1 and 2, a hosted Postgres database from phase 3 | The shape will change a lot early on; a file is easiest to reshape |
| Photos | Object storage, with a small and a full-size version of each photo | Full-resolution wall photos are too heavy to load on mobile data |
| Sign-in | None for viewing; a single passcode on the editor | You are the only user until phase 7 |
| Image processing | Scripts run on your own machine | Avoids paying for hosted compute until phase 7 needs a job queue |

Running cost for version 1 should be close to zero on free tiers; check current limits when you set up storage.

## Data model

The model separates what never changes (walls and faces) from what changes at every reset (sets, problems, holds). Sets are versioned from the start so a reset adds a record and never overwrites one.

| Entity | What it is | Key fields |
| --- | --- | --- |
| Wall | A named structure in the hall | name, position on the floor plan |
| Face | One side of a wall | wall, number in walking order, approximate angle (slab, vertical, overhang) |
| Set | Everything on a wall between two resets | wall, date up, date down (empty while current) |
| Face photo | A photo of one face for one set | set, face, role (anchor, angle, close-up) |
| Hold | One hold or volume in a set | set, face, outline on the anchor photo, colour, type (hold, shared volume, downclimb), close-up photo |
| Problem | One climb in a set; it can span several faces | set, grade colour, start holds, finish hold, member holds |
| Log entry | Your record against a problem | problem, date, status (sent, project), attempts, notes |

Jawa showed that at least five of its roughly 17 problems cross a corner, so a problem belongs to the wall's set and its holds can sit on different faces. START and FINISH tags on the wall define each problem's ends and are recorded on the holds they sit beside.

Rules the editor enforces:

- A shared volume belongs to the set, not to any problem, and any problem can use it.
- A yellow hold defaults to the downclimb type and is only added to a problem by hand.
- A hold can belong to at most one problem, apart from shared volumes.
- "Date down" is filled in by you when you notice a face has been reset.

## Non-coding to-do list

These are the things only you can do at the gym, roughly in order. The first five fit into one visit.

**At the gym**

- [x] Photograph the grade colour ladder on the pillar and write down the order from easiest to hardest.
- [x] Sketch a rough floor plan of the boulder hall: where each wall sits and its name from the sign.
- [x] Pick the first one or two walls. Jawa and Stronach are good candidates because they include the hard cases (purple holds on purple volumes, steep overhang).
- [x] Walk around each chosen wall clockwise and number its faces. Note which are slab, vertical or overhang.
- [ ] Retake straight-on, empty anchor shots of Jawa faces 1, 5, 6, 8 and 9. The first round of 24 photos covers the other faces and all the angle shots.
- [ ] Ask staff how often each wall is reset and whether there is a setting schedule.
- [ ] Ask staff when the current sets on your chosen walls went up, so the first "set on" dates are real.
- [ ] Tell staff what you are building and check they are comfortable with photos of the sets being used.

**At home**

- [ ] Rename and file the photos using the naming pattern below.
- [ ] For one face, write down from memory which holds make up each problem. This is your first ground truth and a check on how clear the photo is.
- [ ] Choose a working name that does not use the Urban Climb name or logo as its brand.

**Later**

- [ ] After the first reset on a chosen wall, re-shoot that face from the same spot and note the date.
- [ ] Before phase 6, find out whether your phone has a depth sensor for scanning, or borrow one that does.

## How to photograph the walls

Each face needs one anchor photo, two angle photos and a few close-ups, all taken with no people on the wall. The anchor photo matters most: it is the image the problems are drawn on.

**When to go**

- Opening time or late on a weekday, when the wall is empty.
- As soon as possible after a reset, before chalk and shoe rubber dull the hold colours.

**Camera settings**

- Use the main 1x lens. The 0.5x ultra-wide bends the wall and the bolt-hole grid.
- Shoot full resolution, no filters, no portrait mode, flash off.
- Shoot stills. Frames pulled from video are too soft for small footholds and tags.
- Tap the wall to set exposure so the strip lights do not darken it.

**The shots for each face**

| Shot | How to take it | What it is for |
| --- | --- | --- |
| Anchor | Stand centred on the face and far enough back to fit all of it with a small margin. Hold the phone at chest height, level, pointing straight at the face. | The canonical view that holds and problems are marked on |
| Left and right angle | Same distance, about 30 to 45 degrees to each side | Holds hidden behind volumes or around an arete |
| Lower wall | Step in and frame the bottom third | Start tags and small footholds |
| Close-ups | One per start tag, plus any hold whose shape or colour is unclear | Tag reading and the "see the grip" view |

**Keeping it repeatable**

- Note where you stood for each anchor shot, for example a mat seam or a pillar. Standing in the same place after each reset makes sets comparable and helps later alignment.
- On steep overhangs, stand further back instead of tilting the phone up sharply.
- If a face is too wide for one frame from the mat edge, split it into two faces. Do not switch to the ultra-wide lens.
- Check each anchor shot on the spot: the whole face is in frame, it is sharp when zoomed in, and nobody is in it.

**Naming the files**

Use wall, face number, date and shot type, for example `jawa-f2-2026-10-14-anchor.jpg` and `jawa-f2-2026-10-14-closeup-03.jpg`. The date is the day you shot it; record the set date separately.

**Privacy**

Do not keep or publish photos with recognisable people in them. Retake the shot or crop them out.

## Open questions

- How often is each wall reset? This sets how long a hand-labelled face stays current.
- Are any hold colours reserved for something other than grade (for example comps or kids' climbs)?
- What do the start tags show: only the start, or also a problem number or setter?
- Is the top of a problem marked, or is it always the top of the wall?
- Web app or native app? A web app is enough for the viewer; guided capture in phase 5 may be easier natively.
- Would staff be willing to share setting dates directly, which would remove the guesswork on "set on" and "taken down"?

* Is a wall reset all at once, or face by face? The data model assumes all at once.
* Do the small mint holds belong to green climbs, and are the round magenta holds purple grade?
* Do two START tags on one hold mean both hands start there?

