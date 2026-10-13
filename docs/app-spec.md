# sendit app: v1 spec

Oct 13, 2026 · @Nafis

The real app, built from scratch. The playground in this repo (`SPEC.md`, `src/`) stays as it is and is no longer the product. It answered how to label and browse a wall, and some of its parts (the hall map, the face photos) are reused here as reference.

## What v1 is

An invite-only app for you and your friends at Urban Climb West End. You can find any current problem in the boulder hall, see exactly which holds are in it, and log your attempts and sends. You set up every problem yourself. Nobody else edits in v1.

The core loop:

**Hall map** → **wall** → **problem** (its own photo, holds ringed) → **log** (one tap)

**In v1**

- Hall map with the six in-scope walls, each tappable.
- A wall page that lists current problems by grade and shows where each one is on the wall.
- A problem page: one photo of the whole problem with every hold ringed, start and top marked.
- One-tap logging: attempt, send, flash. Your status on every problem.
- Friends' sends on each problem ("sent by"), within the invited group.
- An admin flow for adding a problem on your phone at the wall in under a minute.
- Archiving problems when a wall is reset, with everyone's logs kept.
- A simple personal log: what you've sent, counts by grade.

**Not in v1**

- Sessions, session stats and the share card (v2, built on the brand guidelines).
- Comments (first candidate after v1).
- Public sign-up, or admin roles for anyone other than you.
- Automatic hold detection, 3D views, beta videos.

## Users and roles

| Role | Who | Can |
| --- | --- | --- |
| Climber | Friends you invite | Browse, log, see others' sends |
| Admin | You | Everything a climber can, plus add, edit and archive problems |

Accounts exist from day one because friends log their own climbs. Sign-up is by invite only. One group: everyone invited sees everyone else's sends. Roles are stored per user so more admins can be added later without a migration.

## Screens

**Hall map.** Your redrawn floor plan (not the gym's artwork) with the six walls. Each wall shows how many current problems it has and, once you're signed in, how many you've sent.

**Wall page.** The wall's faces as photos, with a dot for each problem at its rough location, plus the list of problems underneath. A grade filter, and your status on each problem (untried, project, sent, flashed). Tapping a dot or a list row opens the problem.

The location photos are of the wall itself, not of a set, so they don't need retaking after a reset. The face photos you already have for Jawa work for this.

**Problem page.**

- The problem photo: zoom and pan, with holds ringed.
- Start holds and the top have their own marks (for example "S" and a flag).
- Grade chip with a text label, the face, and the date it was set.
- Log buttons, your own history on the problem, and friends who've sent it.

**Me.** Your sends and flashes, counts by grade, and current projects. Kept plain; making stats look good is v2.

**Admin: add a problem.**

1. Tap **Add problem** on the wall page.
2. Take a photo with the whole problem in frame.
3. Tap each hold to drop a ring, and drag to resize it.
4. Long-press a ring to make it a start or the top.
5. Pick the grade colour.
6. Tap its rough location on the face photo.
7. Publish.

Photos are resized on the phone before upload. If the signal at the gym is bad, the problem is queued and uploads later.

**Admin: reset.** You can archive a single problem, or tap "reset wall" to archive every current problem on a wall at once. This works whether the gym resets a whole wall or a face at a time.

**Archive.** Past problems on each wall, grouped by the month they came down, with your logs still attached.

## Logging

Logging has to be fast enough to do between attempts, or nobody will do it.

- **Attempt**: +1 for each tap.
- **Sent**: closes out the problem for today. You can log repeat sends.
- **Flash**: only offered when you have no earlier attempts on that problem.
- **Undo** reverses the last tap, since you'll mis-tap with chalky hands.

Your status on a problem is worked out from your logs: no logs means untried, attempts with no send means project, a first-attempt send means flashed, any other send means sent.

Every tap is stored as its own timestamped event, not as a running total. That costs nothing now and is what v2 needs. Sessions (first log to last log, ending after roughly 90 minutes with no logs), time climbed, tries per send and the share card can all be worked out from those events, including for climbs logged before v2 exists.

## Data model

Problems carry their own dates instead of belonging to a "set". The playground's set model assumed a whole wall is reset at once, and that is still unknown.

| Entity | What it is | Key fields |
| --- | --- | --- |
| Wall | A named structure in the hall | name, outline on the hall map, order |
| Face | One side of a wall, used for locating problems | wall, number in walking order, angle, location photo |
| Problem | One climb | wall, face, location point on the face photo, grade colour, photo, date set, date removed (empty while current), optional name or note |
| Mark | A ring on a problem's photo | problem, centre, radius, role (hold, start, top) |
| User | You or a friend | name, avatar, role (climber, admin) |
| Log event | One tap | user, problem, type (attempt, send, flash), timestamp |
| Invite | A way in | code or link, created by, used by |

Rules:

- A problem with a "date removed" is archived. Its logs are never deleted.
- Flash is only valid as a user's first log event on that problem.
- Grade colours are the eight from the gym's ladder (yellow, blue, purple, green, orange, red, black, white), defined once. Each is always paired with a text label.

## Brand

v1 is built on design tokens with a neutral placeholder theme, so your brand guidelines can be dropped in when they're ready without reworking screens. The hold colours carry the meaning in v1 screens, so the UI around them should stay quiet whatever the brand turns out to be. The share card in v2 is where the brand gets to be loud.

## Milestones

| Milestone | Delivers | Done when |
| --- | --- | --- |
| 0. Before code | Talk to staff (photos of sets, reset rhythm, set dates); brand guidelines underway | Staff are OK with it |
| 1. Explorer and setting | Hall map, wall page, problem page, admin add-problem flow. No accounts yet | Jawa's current problems are in, each added in under a minute at the wall |
| 2. Accounts and logging | Invites, sign-in, one-tap logging, statuses, "sent by", Me page | You and two friends log a real session |
| 3. Whole hall and resets | All six walls, archive, reset flow | One reset handled with everyone's logs intact |
| v1 done | | Friends open it at the gym without being reminded, for a month |
| v2 | Sessions, stats, share card on the real brand, comments | |

## Decisions still open

- **Web app or native.** A web app installed to the home screen covers all of v1, including the camera in the admin flow. The v2 share card is the deciding factor: saving an image and posting it works from the web, but posting straight into an Instagram story (background, stickers) needs a native app. Decide before milestone 1. Moving from web to native later means rebuilding the front end, not changing the backend.
- **Sign-in method.** Email magic link, or Apple and Google sign-in.
- **Stack.** Postgres, auth and image storage from one provider keeps it small; pick at milestone 1.
- **Name.** Must not use "Urban Climb"; the footer says "unofficial".

## Carried over from the playground's open questions

- How often is each wall reset, and is it all at once or face by face? (The data model now handles both.)
- Are any hold colours reserved for something other than grade, such as comps or kids' climbs?
- Do the mint holds belong to green climbs, and are the round magenta holds purple?
