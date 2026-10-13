# sendit app: roadmap to v1

Oct 13, 2026 · @Nafis

What gets built, in what order. `docs/app-spec.md` says what the app is. This file changes more often. No dates are set, since this is a side project; each step has a condition for being done instead.

There are no throwaway spikes. The playground already tested zooming a wall photo and marking holds on the web. The riskier pieces are built properly, first, inside milestone 1.

## 0. Setup

Mostly accounts and admin; little of it is code.

- [ ] Enrol in the Apple Developer Program (US$99 a year). Approval can take days and TestFlight is blocked until it's through, so start now.
- [ ] Google Play developer account, if any friends are on Android.
- [ ] Buy a placeholder domain and point DNS at Cloudflare.
- [ ] Create accounts: Fly.io, Neon (Sydney), Cloudflare R2, Resend (verify the sending domain), Vercel, Sentry, Expo/EAS.
- [ ] Turn this repo into the monorepo: move the playground to `apps/playground/` unchanged and check it still runs, then set up `apps/mobile`, `apps/api`, `apps/web` and `packages/shared`.
- [ ] CI running typecheck and lint.
- [ ] Talk to gym staff: are they OK with photos of their sets in an app, how often is each wall reset (all at once or face by face), and when did the current sets go up? This doesn't block building. It does block inviting friends.

Brand guidelines run in parallel the whole way and block nothing in v1.

**Done when:** the empty app runs on your phone from an EAS dev build, the API answers a health check from Sydney, and the playground still runs.

## 1. Explorer and setting up problems

No accounts yet beyond you as admin. The add-problem flow comes first because nothing can be viewed until there are problems, and it's where the main risk is: setting up a problem has to take under a minute.

1. Database schema (walls, faces, problems, marks) with migrations; walls, faces and Jawa's face photos loaded in from the playground's data.
2. Tokens file and the base set of components, unbranded.
3. Problem photo view: pinch, pan and zoom with rings drawn in Skia. This is the core interaction, so get it smooth on your own phone before moving on.
4. Add-problem flow: photo, tap to ring, resize, mark start and top, grade, location on the face, publish. Photos resized on the phone and uploaded to R2 through a signed upload link. Problems queued and uploaded later if there's no signal.
5. Hall map, wall page (face photos with problem dots, list, grade filter) and problem page.
6. First TestFlight build to one friend, early, so any trouble with distribution shows up now and not at launch.

**Done when:** Jawa's current problems are all in, each added in under a minute at the wall.

## 2. Accounts and logging

1. Better Auth in the API: email one-time code through Resend, Google, Sign in with Apple. Admin and climber roles.
2. Invites: invite codes, and invite links on the web app that open the app (Apple and Android app-link files on the domain). A holding page at `/`.
3. One-tap logging (attempt, sent, flash, undo), stored as timestamped events and saved offline first.
4. Statuses on the wall page and problem page, "sent by" friends, the Me page.
5. Sentry in the app and the API.

**Done when:** you and two friends log a real session, including a stretch with no signal.

## 3. The whole hall and resets

1. The other five walls: face photos, outlines on the hall map, then their problems.
2. Archiving: one problem at a time, and "reset wall" to archive everything current on a wall.
3. Archive view per wall, with logs still attached.

**Done when:** one real reset is handled with everyone's logs intact.

## 4. Dogfood

A month of real use. Only fix what annoys people.

**v1 is done when:** friends open it at the gym without being reminded, for a month.

## After v1

In rough order:

1. **Sessions and stats,** worked out from the log events already stored: time climbed, sends, tries, flashes.
2. **The share card,** on the real brand, with a share page on the web app behind each card.
3. **Comments.**
4. **Admin web** (`/admin`) once doing desk work on the phone gets annoying. This could come earlier if needed.
5. **More admins,** then App Store release. Before release: a privacy policy and in-app account deletion, which Apple requires for any app with sign-up.

## Risk to watch: keeping problems up to date

You are the only one adding problems. Six walls at roughly 20 problems each is about 120 problems, plus every reset after that. If keeping the app current becomes a chore, it falls behind the wall, and an out-of-date app loses friends fast. Watch the time it takes to add a problem from milestone 1 onwards. If the upkeep turns out heavy, bring in a second admin earlier than planned, possibly a friend.
