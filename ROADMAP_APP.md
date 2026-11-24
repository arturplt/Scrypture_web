# App roadmap: what is left to build

The order to work through what is still open in Scrypture-web, as of 2026-11-24. `BACKLOG.md` stays the full list of what is open (about 155 items: 118 unchecked boxes and 38 dated notes with leftovers, with the detail and the Android references); what is finished is in `BACKLOG_DONE.md`; this file groups them into phases and puts them in order. The world
simulation has its own roadmaps and is only summarised here: `ROADMAP.md` (ecosystem) and `ROADMAP_BEAVERS.md` (beavers).

Each phase leaves the app working, so work can stop after any of them. Sizes: S = under a day, M = a few days, L = a week or more.
Update the status table when a phase moves.

## Status

| # | Phase | Size | Status |
|---|---|---|---|
| 1 | Safety net and first release | M | Built but for one check: committed; CI type-checks, tests, builds, runs the end-to-end test (desktop and a 390x844 touch phone) and deploys to scrypture.app; old saves are tested; error and update toasts. Open: a Lighthouse check and an install hint |
| 2 | Real-device pass | M | Not started |
| 3 | Planner and Bóbr, second round | M-L | Mostly built: repeats, a 1/3/5/7-day board with hours, shortlist dragging, reminders (2026-11-24). Chat history, typing animation and the chat sparkle built 2026-11-24. Open: calendar sprite. "N days a week" habits are placed N times a week on the planner (2026-11-24) |
| 4 | Tasks and habits depth | M-L | Built 2026-11-17: habit XP/streaks/quick start/undo, several core attributes, sort modes, tags, task detail, quick-add and presets, Start Here filters, weekly/monthly habit rules and custom categories. Undo reaches back through the last 5 completions (2026-11-24). Open: nothing |
| 5 | Bóbr and Home life | M | Built 2026-11-17: EXCITED and MISCHIEVOUS moods, items from play, wandering. 2026-11-24: speech bubble, XP stars, stone hold, feeding count. Open: the sad+hungry animation, slots for the extra items, the ancient sprite (all need art or design) |
| 6 | Mind map, second round | M | Mostly built: tidy, collapse, link direction and flip, copy, picture (2026-11-24). Open: undo after closing, user frames for boxes |
| 7 | Exercise tracker | L | Built: first version 2026-11-17; kg/lb, rest length, editing finished workouts, progress charts 2026-11-24 |
| 8 | Sound and haptics | M | Built: sounds 2026-11-17, vibration 2026-11-24. Open: trying both on a real phone |
| 9 | Games and apps leftovers | S-M | Time Trial and the stone hold built. Open: trajectory arrows, throwing animation, Sanctuary link and game tie, Pixelite icon (needs art) |
| 10 | World simulation | L | See `ROADMAP.md` and `ROADMAP_BEAVERS.md` |
| 11 | Polish: themes, languages, accessibility, layouts | ongoing | Do alongside the other phases |

## Decisions

Made 2026-11-17:

- **Activities pay XP and stats** (5 XP, +1 per 15 minutes up to +15, and a point in their category). Built.
- **Habits pay XP and a stat point**, with an exponential streak multiplier and a quick-start bonus; habits can be undone. Built.
- **Sound: yes**, with the Settings volume row as the toggle. UI sounds built; haptics are still open.
- **Rock game:** a Time Trial mode (countdown, +3 s per hit, speed bonus) replaces Android's CHALLENGE. Built.
- **The exercise tracker is wanted.** First version built.

Still open, each blocks or shapes a phase:

- ~~**Where to publish**~~: decided, a custom domain at the root (scrypture.app on GitHub Pages).
- **Should Bóbr's items keep spawning while the app is closed** (phase 5)? Hunger already advances while away; items do not. Recommended: yes, with a cap.

## Phase 1: safety net and first release

Why (when this was written): the tests were run by hand, nothing was committed and nothing was published. Everything after this is safer once it is; it is live now, with 847 unit tests run on every push.

- ~~First commit, then an automatic build and test run on every push~~ (done: `.github/workflows/pages.yml`).
- ~~Put the end-to-end flow test (onboarding, add task and habit, chat, export and import) into the repo.~~ (built 2026-11-24: `npm run e2e`, run in CI; it found and now guards against a crash at the end of onboarding).
- ~~Start real storage migrations: the format is still version 1 and every new field is filled in by defaults.~~ (2026-11-24: old-save fixtures and tests, a backup before migrating, and newer saves left alone; the version stays 1 until a change cannot be defaulted).
- ~~Choose the publishing target~~ (scrypture.app at the root, so no relative URLs are needed).
- ~~"New version available, reload" toast for the service worker~~ (built 2026-11-17, untried on a production build).
- ~~"Something went wrong" message when an action fails~~ (built 2026-11-17).
- ~~Remove the unused Android sprites from `public/assets/raw`~~ (2026-11-24: 8 were unused; moved to `art/unused-sprites/`).
- Lighthouse PWA check and an "Add to home screen" hint on the published address (the only open item here).
- Done when: a push runs the tests, the app is installable from its public address, and an old save still opens after a format change.

## Phase 2: real-device pass

Why: almost everything was checked only in desktop Chromium and an emulated phone width. Touch has never been tried for real.

- Android phone, iPhone Safari and Firefox: layout (`100dvh`, side rail, frame crispness), install, full screen.
- Two-finger gestures that are written but untested: mind map, Sanctuary, world map joystick, rock-game aiming.
- Typing on a phone: the on-screen keyboard may cover a mind-map box or a form field.
- ~~The collapsing address bar flipping the automatic interface scale~~ (a dead zone built 2026-11-24, untried on a phone); tablet rotation still flips it between 2x portrait and 1x landscape.
- Frame rate of the world map and the rock game on a low-end phone.
- Done when: each screen has been used on a real phone and the problems found are either fixed or listed.

## Phase 3: Planner and Bóbr, second round

Why: the planner is new and is the part meant to tie the app together; the first version is deliberately small.

- ~~Repeating activities~~ (built) and ~~reminders through notifications~~ (built 2026-11-24, while the app is open or installed: there is no push server).
- ~~Week view, and a day shown as a timeline with hours~~ (built: the board).
- ~~Bóbr speaks first on Home~~ (built 2026-11-17).
- ~~Shortlist: reorder by dragging~~ (built; the shortlist holds 12).
- ~~Turn a mind-map box into a task or an activity~~ (built 2026-11-17); showing a ticked task on its box is open.
- ~~The completion sparkle~~: built for the Planner 2026-11-17 and for "What now?" in the chat 2026-11-24.
- A calendar sprite for the tile and the bar (needs art).
- ~~Chat leftovers that fit here: saved chat history, a typing animation~~ (built 2026-11-24). (The "favourite task" reply was built 2026-11-17.)
- Done when: a week can be planned ahead, Bóbr reminds you without being asked, and a mind map can feed the plan.

## Phase 4: tasks and habits depth

Why: these are the screens used every day, and several Android features are still missing from them.

- ~~Custom task categories~~ (built 2026-11-17: name and frame, manager, filter; they group tasks and do not change the stats).
- ~~Task form: several core attributes at once~~ (built 2026-11-17), ~~quick-create with presets~~ (built 2026-11-17).
- ~~Tags: manage them and filter by them~~ and ~~sort options~~ (built 2026-11-17).
- ~~Task detail screen~~ (built 2026-11-17: full description, "Done N times", previous and next).
- ~~Habits: real weekly and monthly rules~~ (built 2026-11-17: once per week or month, streak counts periods; "N times a week" targets built 2026-11-24). (The reward, streak multiplier, quick start and the 10-second undo were built 2026-11-17.)
- ~~Start Here: topic filter, easy-only filter, "add all easy ones"~~ (built 2026-11-17).
- Done when: the Android task and habit features are matched or deliberately dropped, each noted in `BACKLOG.md`.

## Phase 5: Bóbr and Home life

Why: Bóbr is the heart of the app and is simpler on the web than on Android.

- Mood as a state machine: ~~the EXCITED and MISCHIEVOUS moods~~ (built 2026-11-17); the mixed sad-and-hungry animation is missing (needs art).
- ~~Items from play~~ (built 2026-11-17): the rock game drops coin (score 1000, level 10), stone (level 5), hay (level 3), a stick (15 hits) and, in Time Trial, a berry (level 4). Drop levels are untuned; the other minigames have no scored result to hang drops on.
- The extra items (acorn, feather, honey and others): sprites are in the atlas but have no slots or use.
- ~~Stone cost on Home (long-press shows the price, "not enough stone")~~ (built 2026-11-24).
- ~~Home: XP particles, ambient particles, rotating motivational messages~~ (built 2026-11-24: XP stars fly into the level bar, Bóbr's speech bubble every 30 s; the ambient pollen and leaves were already there).
- ~~Wandering with a facing direction~~ (built 2026-11-17) and ~~the feeding count~~ (built 2026-11-24); the ancient-stage sprite is open.
- Done when: Bóbr's mood changes visibly with what you do, and playing a game earns something he can use.

## Phase 6: mind map, second round

- ~~Tidy button~~ (built 2026-11-17); ~~collapsing a branch~~ (built 2026-11-17).
- ~~Show and flip a link's direction~~ (built 2026-11-24).
- ~~Export a map as a picture; duplicate a map~~ (built 2026-11-24).
- Keep undo steps after the map is closed; offer the user's own frames and colour variants for boxes.
- ~~A visible hint that holding the Mind box on Home opens the maps~~ (built 2026-11-17).
- Done when: a 50-box map can be kept tidy without placing every box by hand.

## Phase 7: exercise tracker

Built 2026-11-17 (`domain/exercise.ts`, `screens/Exercise.tsx`): opens by holding Body on Home, or from Apps. Start an empty workout or one of the 7
presets, add exercises (common list, ones you logged before, or your own name), log each set (reps, kg, seconds, defaulting from the last 10 workouts, with PR and
AVG), a rest timer (30 s to 3 min since 2026-11-24), pause, finish (pays Body points by Android's formula), Quick Log, history with delete, exercise library.

Differences from Android: the clock leaves out paused time and survives a reload (Android loses the pause); all of a set's values are entered in one dialog
instead of three steps; an exercise can be removed and a running workout discarded; the history keeps at most 500 workouts. Built 2026-11-24: a kg/lb switch, editing a finished workout's sets and name, a progress chart per
exercise, the rest length. Still open: adding or removing sets in a finished workout.

## Phase 8: sound and haptics

- ~~Sound toggle and UI sounds~~ (built 2026-11-17: click on buttons, XP blip, level-up and achievement chimes; the world map keeps its own sound).
- ~~Rock game sounds~~ (built) and ~~vibration~~ (built 2026-11-24: rock game, task ticks, level-ups, reminders). Still open: a richer task-complete sound, and trying all of it on a real device.
- Done when: the rock game has sound too, and haptics work on a phone.

## Phase 9: games and apps leftovers

- Rock game: ~~start by holding the stone in the inventory for 5 stone~~ (built 2026-11-24); off-screen trajectory arrows; a throwing animation; tune Time Trial by playing. (Its speed bonus is shown in the HUD since 2026-11-17.) (Time Trial replaced CHALLENGE and was built 2026-11-17.)
- Sanctuary: a link from Home or the pen, and a tie to the game (cost, Bóbr walking in it, achievements).
- Pixelite: its own Apps icon.

## Phase 10: world simulation

Kept in its own files. In short, what is open there:

- `ROADMAP.md`: phase 1 (keep the newest saved changes when over the cap) and phase 2 (save clouds, rivers and fires) are not started; phase 4 (vegetation decay) is about a quarter done; splitting `ecosystem.ts` is housekeeping.
- `ROADMAP_BEAVERS.md`: B1 to B5 are built with small leftovers (winter store, longer dams, flood); B6 is waiting on sprites; B7 has the start-point colony and steering open.

## Phase 11: polish (alongside the others)

Small items to pick up while touching a screen; the detail is in `BACKLOG.md`.

- **Themes:** more elements customisable (achievement cards, chat bubbles, event dialogs), translated style names, an inventory slot picker, the `gameover` frame.
- **Languages:** ~~Polish plural forms~~ (built 2026-11-24), a native-speaker review of the Latin and Polish written for the web, translated labels on the Body / Mind / Soul sprites.
- **Accessibility:** ~~a reduced-motion switch~~ (built 2026-11-17), ~~a high-contrast palette~~ (built 2026-11-17), ~~text and interface size in onboarding~~ (built 2026-11-24), a screen-reader pass on a real device.
- **Layouts:** Settings, Chat, habit detail and Start Here stay one narrow column on wide screens.
- **Settings:** ~~reordering navigation items~~ (built 2026-11-24); the bottom bar drops its labels by itself when they would wrap it into three rows (2026-11-24). (Name editing was built 2026-11-17.)
- **Crash screen:** ~~English only~~ translated 2026-11-24 (Latin and Polish unreviewed).
- **Notes:** search built 2026-11-24.
- **Developer pages:** `/kit` does not show the newer pieces.

## Suggested order

Phase 1 is nearly done (only the Lighthouse check is left). Phase 2 next, since a real phone may change how the later ones are built. After that,
phase 3 if the planner is what you use most, otherwise phase 4. Phases 5 to 9 can go in any order; phase 7 only after the
decision above. Phase 11 never gets its own turn.
