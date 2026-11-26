# Scrypture (web)

Rebuild of the web version, ported from the Android app ("Scrypture: Grimoirium Vivendi"). Tasks and habits earn XP and Body/Mind/Soul points; Bóbr the beaver grows with you.
Live at **scrypture.app**. Open work: `BACKLOG.md` (finished items are in `BACKLOG_DONE.md`), in the order of `ROADMAP_APP.md`. World simulation: `ROADMAP.md`, `ROADMAP_BEAVERS.md`, `ROADMAP_TERRACE.md`.

## Run
- `./start.sh` — dev server on port **2137** over plain http, prints localhost + LAN links (open the LAN one on your phone)
- `./start_https.sh` — the same over https (self-signed certificate), which a phone needs for the camera in Pushups mode
- `./stop.sh` — stops whatever is listening on that port (safe to run when nothing is running)
- `npm test` — unit tests (game rules, storage, old-save fixtures, chat, i18n, the world models)
- `npm run e2e` — a new user's first minutes in headless Chromium on the built app (`npm run build` first); `E2E_SIZE=390x844 npm run e2e` runs it as a touch phone, `E2E_URL=…` tests another server (e.g. the LAN address). CI runs both sizes on every push
- `npm run soak` — runs the world ecosystem headless for an hour in five biomes and prints what drifts (see `ROADMAP.md`)
- `npm run build` — production build in `dist/` (includes the offline service worker); `npx vite preview --port 2137` to try it
- Dev-only pages: `/kit` (pixel UI kit), `/atlas` (every sprite, drag-and-drop to add new ones into `public/assets/sprites/`)
- `npm run frames` — crop Android 9-slice frames to 48x48 and build their mirrored/weathered wide-edge versions (`frames-mirror/`, `frames-random/`); also runs automatically on start/build and when a new `*.9.png` is added

## Phone testing gotcha
Opening `http://192.168.x.x:2137` on a phone is **not a secure context** (only `https` and `localhost` are). APIs such as `crypto.randomUUID`, service workers and the clipboard are missing there. Never call secure-only APIs unguarded (see `src/data/id.ts`), and test flows through the LAN address, not only `localhost`.

## Full screen
The app starts in full screen **on your first tap** (browsers never allow it without a tap) and Settings > Display has an Exit / Enter full screen button that also remembers the choice. iPhone Safari has no Fullscreen API, so there Settings explains "Add to Home Screen" instead. The manifest stays `standalone` on purpose: an installed app in `fullscreen` display mode could not be left from inside the page.

## Rock throwing (Dashboard > Games)
Ported from Android; the rules live in `src/domain/rockgame.ts` (pure functions, time and randomness injected, so it is unit tested).
- The field is a fixed 1080 x 1200 space drawn on a canvas and scaled to fit, so it plays the same everywhere. Drag on the field (up/down = angle, right = power) and let go to throw, or use the sliders and Shoot. Keyboard: arrows aim (Shift = bigger steps), Space throws.
- Arcade: 5 rocks per level, 4 hits per level number to advance. Practice: unlimited rocks, half the stat points, end it with Pause > Finish. Quitting without finishing saves nothing.
- Play Again / Restart cost 5 stone; rewards (XP, Body/Mind/Soul, bcoin/stone drops) and the 7 minigame achievements are paid when a game ends.
- Where it differs from Android (combo, distance and accuracy bonuses, achievements) is listed in `BACKLOG_DONE.md` ("Found while porting the rock-throwing game"). Every game started from Home or the pen costs 5 stone.

## Paper plane (Bóbr World > Glide)
The default flight mode is a real glider (`src/domain/glider.ts`, pure and unit tested): lift, drag and gravity on a point mass flying through moving air. Keys: **W/S** pitch (W nose down like a stick, S nose up; "Invert pitch" in the menu flips it), **A/D** roll, **Q/E** yaw, **Space** throws it again from a 40 m ledge (a Throw button appears after landing). The touch stick gives pitch and roll.
- Thermals: warm ground (sand and desert most, water none) makes rising air, one trigger point per 60 x 60 tiles, 90-170 s life, core 15-25 tiles wide, peak updraft 6-13 m/s, pulsing core, a ring of sink around it. They show as a warm haze with rising motes and a small cumulus on top ("Thermal hints" in the menu hides them). Circle inside with ~30 degrees of bank and a gentle pull (slow flight = less sink, tighter circles). A day lasts a minute here, so the sun only dims thermals at night instead of switching them off. Wind and heat waves/cold snaps feed in.
- Space boosts in the air (about +5 m/s and 13 m of height, then a 4 s pause) and throws the plane again once landed. Gold hoops hang 25-58 m up: fly through one to count it and get the boost back. Hills worlds (terraced, with lakes, becks and tarns), the rocket stage, orbit with time warp and the curved planet are described in `BACKLOG.md`, `BACKLOG_DONE.md` and `ROADMAP_TERRACE.md`; a gamepad and a remappable 21-key pattern keyboard drive the flight patterns.
- Six instruments bottom right: airspeed (red = stall), attitude, altimeter, turn coordinator, heading, vertical speed (thin cyan needle = total energy, unaffected by pitching). Manual, Cruise and Off are the old Android modes and still work as before.

## Layout
- `src/domain` — pure game rules (XP, levels, streaks, achievements, chat state machine, Bóbr mood/trades)
- `src/data` — versioned `localStorage` store, export/import
- `src/workers`, `src/screens/chunkClient.ts`, `src/domain/chunkbuild.ts` — the Paperplane ground is built in Web Workers: chunk pictures, decorations and hill meshes by a worker holding a copy of the world's ground kept current by replaying its changes, the far terrain levels by a second one (the page builds for itself if a worker is missing or fails; `?noworker` forces that, `?perf` shows their state)
- `src/i18n` — English / Latin / Polish (Latin unlocks after 10 tasks); every key must exist in all three
- `src/ui` — pixel kit: CSS `border-image` on the Android frames, no canvas
- `src/screens` — dashboard, tasks, habits, achievements, chat, settings, onboarding, planner, apps (Pixelite, Sanctuary, mind map, notes, exercise, emoticons) and the Bóbr World / Paper plane

## Scaling model (read before touching CSS)
- **Never write `px` in app CSS.** Lengths are `calc(N * var(--u))`, where `--u` = 1px × `--ui`, the whole-number interface scale (automatic from the window size, or 1x/2x/3x in Settings). That keeps sprites, frames and spacing crisp and scaling together.
- **Text uses `rem`** (`var(--fs-xs … --fs-xl)`), so the browser/OS font size is respected, multiplied by `--ui` and the user's text-size setting (`--font-scale`).
- **Layouts** are set from the *logical* width (window / `--ui`) on `<html>`: `data-layout="compact|medium|wide"` (phone column / tablet / desktop) and `data-rail` (side navigation instead of the bottom bar). Rules live at the end of `src/app.css`. The pure rules are in `src/domain/look.ts` and unit-tested.
- Checking a change: run the device matrix idea from the history — 280..2560 px wide, at 100% and 200% text, no horizontal overflow, dialogs fully visible.

## Adding UI text
Add the key to `src/i18n/en.ts`, `la.ts` and `pl.ts` (TypeScript fails the build if one is missing), then use `useT()`.

## Deployment
Pushes to `main` run `.github/workflows/pages.yml`: type-check, unit tests, build, the end-to-end test at two sizes, then publish to GitHub Pages at the root of **scrypture.app** (`public/CNAME`). The app is served at the domain root, so absolute asset URLs are fine. Still to check there: a Lighthouse PWA run and an install hint (`BACKLOG.md`, Deployment).

A save from a newer app version is never overwritten (saving stops and a Reload notice shows), and a save from an older version is copied to `scrypture:state:v<n>` before it is migrated. Do not raise `CURRENT_VERSION` until installed apps have had time to update to a release with that guard; old saves are frozen in `src/data/fixtures/` and must keep loading.
