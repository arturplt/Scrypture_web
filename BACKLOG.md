# Backlog / To-do

Things that exist in the Android app (or its docs) but are **not implemented** in the web version yet.
Rule: whenever I run into something in Android that I leave out, it gets **appended to the end** of this list (never reordered), with where it was seen.
Mark done with `[x]` instead of deleting.

**The order to work through this list is in [ROADMAP_APP.md](ROADMAP_APP.md)** (11 phases, from the first release to polish).

**World map ecosystem work follows [ROADMAP.md](ROADMAP.md)** (phases 0-5: soak test, save cap, saving the living state, water balance, decay and biomes, dams). Read it before changing `ecosystem.ts`, and update its status table when a phase moves.

## Status (2026-11-17)
- Done locally, **not deployed**: scaffold + pixel kit, game rules, storage, onboarding, tasks (untick/undo), habits, achievements, Bóbr (items, feeding, trades), chat, settings, English/Latin/Polish, PWA/offline, accessibility (text + interface size), responsive layouts, and a large theming system (frames + edge styles, buttons, chips, bars, tick boxes, cards, dialogs).
- 499 unit tests pass (was 172); end-to-end flows are tested by scripts that live outside the repo (see "Found while fixing can't add task").
- Since the last status: Exercise Tracker, Planner, Apps (Pixelite, Sanctuary, Mind Map), rock game Time Trial, XP/stats for habits and activities, app-wide UI sounds, task sorting by created date / none, name editing in Settings.
- Biggest remaining areas: deployment (needs a target decision), real-device and Safari/Firefox testing, native-speaker review of web-only Latin/Polish strings, and the Tasks-slice leftovers (custom categories, tag management, quick presets, task detail screen).

## Big features (already planned as "Later")
- [x] Rock-throwing minigame (menu, Arcade + Practice + Time Trial, 12 target movements, combo, leaderboard, rewards/drops, all 7 achievements). CHALLENGE mode was never reachable in Android; see "Found while porting the rock-throwing game" at the end
- [x] Sanctuary isometric block builder (Apps > Sanctuary; see "Found while porting Sanctuary" at the end for what was left out)
- [x] Mind Map creator (Apps > Mind Map, or hold the Mind box on Home): saved maps, boxes sized to their text with typing straight into them, a description per box, curved links, branches that move together, drag to pan, pinch / wheel zoom, fit all, undo. See "Found while porting the mind map" at the end for what changed and what was left out
- [x] Exercise Tracker (workouts, exercise/workout libraries, Body points) — Android: long-press Body on dashboard (first version 2026-11-17)
- [x] Bóbr world map, first pass (Apps > Bóbr World): infinite biome terrain, paper plane, day/night, wind, clouds, rain, vegetation growth, minimap, saved worlds. Rivers and the 3rd-person camera done (see below). Still missing: nothing big from the Android map; see "Found while porting the Bóbr world map" at the end

## Phase 5 / 6 (mostly done)
- [x] Bóbr chat (choice-based; history is in-memory like Android; QUICK_ACTION/SYSTEM message types are not used, see below)
- [x] Settings screen: Theme Hub (frame, buttons, chips, bars, tick box, cards, dialogs), data export/import/delete
- [x] Latin Mode (unlocks after 10 completed tasks; English/Latin/Polish from Android's `StringResourceProvider`)
- [x] PWA/offline (manifest, icons, service worker) and accessibility pass (text/interface size, dialog focus trap, touch targets)
- [x] Sound: the Settings volume row (Off / 30 / 70 / 100%) is the toggle, and it now also covers app-wide UI sounds (`src/audio/uiSound.ts`: click on buttons, blip when XP is paid, chime on level-up and achievements). Not heard on a real device
- [ ] Deploy (see Deployment section)

## Found while porting (in the order encountered)
- [ ] `gameover.9.png` frame (64x64, not the 50x50 format; skipped by the frame script) — Phase 1
- [x] Multi-language: English, Latin and Polish, with the language page as the first onboarding step (Latin is locked there until 10 tasks) — Phase 4 onboarding
- [x] Custom task categories (built 2026-11-17, differs from Android): a Categories manager on the Tasks screen (add, rename, change frame from 25 pixel-art frames, ornate ones first, delete; up to 12, names up to 16 characters); a task picks any number in its form (a task in several categories shows under each filter), its name shows on the card as a chip drawn in the category frame (the card itself stays under the theme manager), and Tasks can be filtered by it. A category only groups tasks: the stat a task trains still comes from Body / Mind / Soul and its extra attributes. Habits can use them too (built 2026-11-17: multi-select picker in the habit and task forms with a "+ Add category" to make one on the spot, name chip with its frame on the card, filter on Habits; deleting a category frees both). Not built: categories on the planner's habit blocks, categories in Start Here suggestions, per-category colours beyond the frame
- [x] Task form: choose several core attributes at once (done 2026-11-17: an "Also trains" row of Body/Mind/Soul toggles under the priority and difficulty rows; the reward preview lists them; editing reads them back from the stat rewards) (`StatRewards.fromAttributesAndCategory`; store already supports `coreAttributes`, the form doesn't) — Tasks slice
- [x] Quick-create and quick presets (done 2026-11-17, web design: an Add line at the top of Tasks makes a medium, difficulty-2 task in the chosen category; an AGAIN row puts back the chores you have finished most often with their latest settings). Android's own preset list was not looked at — Tasks slice
- [x] Tag management and filtering (done 2026-11-17: a TAG filter row on Tasks, and a Tags dialog to rename (an existing name merges) or remove a tag from every task) — Tasks slice. Left: tags are still typed as text in the form; no colours per tag. Tags can already be typed into the task form (comma-separated) and show as chips on the card; there is no list of tags, no rename/delete and no filter
- [x] Habit streak multiplier and quick-start bonus (web design, not verified in Android): XP = 5 x 1.1^(streak-1), capped at 3x, and the first habit ticked within 3 minutes of opening the app pays 1.5x (`habitReward` in `src/domain/habits.ts`; the bonus is per session, so reopening the app gives it again)
- [x] Weekly/monthly habits (built 2026-11-17, differs from Android): a weekly habit is done once per week (Monday to Sunday) and its streak counts weeks; a monthly one counts calendar months. Android counts days for every frequency. Streaks saved before this keep their old value. Not built: "3 times a week" style targets
- [x] Habits now give XP and one point in their category (5 XP base, see above); undoing within 10 s takes it back. Chat's "Done" on a habit pays too
- [x] StartHere screen (done: Daily/Weekly/Monthly tabs, suggested tasks per Body/Mind/Soul with a recommended next step, suggested habits, entry points from the dashboard, empty Tasks/Habits and the first-task tutorial) — Phase 4
- [x] Bóbr moods (done 2026-11-17: EXCITED for 20 s after a task or habit, MISCHIEVOUS for 60 s after a level-up or achievement when he is fed and content; the mixed SAD+HUNGRY animation is still missing). Original note: Android keeps mood as state with transitions; web derives it. Missing: EXCITED (after task completion) and MISCHIEVOUS triggers, mixed SAD+HUNGRY emoticon animation — Dashboard slice
- [ ] Beavers in the world (`beavers.ts`), later ideas: kits from the young/baby stills that grow up and found new colonies; dams that leak and break without upkeep, and the pond draining; the player breaking a dam for its sticks; work at dusk and night only; gnawing bushes and small trees into sticks when the ground runs out; fleeing fire into the burrow; female walk frames (she slides on her idle still); real burrow and dam pictures (stand-ins are heaps of the stick and stone items); beavers drawn by row with the trees in the 2D view
- [ ] Bóbr extras: wandering animation with facing direction, ancient stage sprite use, feeding-count UI — Dashboard slice
- [ ] Dashboard: XP particles, ambient particles, rotating motivational messages (every 30s, by level/name via `getMotivationalMessage`) — Dashboard slice
- [ ] Stone mechanics on dashboard (long-press shows "-5" cost, "not enough stone" popup) — Bóbr life slice
- [ ] Item rewards from gameplay (bcoin/stone/hay/stick drops from minigames); nothing gives items besides spawns — Bóbr life slice
- [ ] Item sprites for extra items (`res/drawable/Items/`: acorn, feather, firefly, honey, pinecone, plank, totem, ...) — copied to the atlas, unused
- [ ] Haptic feedback / vibration (Android uses it in the minigame and animations) — Phase 6
- [ ] Task-completion celebration animation (web has the "+XP" toast, the level-up/achievement dialogs and the Undo bar, but no particle/animation like Android) — Tasks slice
- [ ] Splash screen, crash reporting (Sentry planned in Android) — not needed for web unless wanted
- [x] Chat: "My Favourite Task" (done 2026-11-17: shows once any task was done; names the one done most, with count and last date; the strings are mine, not Android's) — tasks now have `completionCount` / `lastCompletedAt`, so only the chat option and its strings (already in Android) are missing — Chat slice
- [x] Uncomplete task (done: untick within 10 s refunds the rewards, later it just resets; completing again pays again) — Chat slice
- [ ] Chat leftovers: QUICK_ACTION/SYSTEM message types unused, no Bóbr "typing" animation, no `damProgress` stat line in the stats reply (the strings are translated now) — Chat slice
- [ ] Chat history is in-memory only (same as Android's current code); `chat` in the store/export is unused
- [ ] Theme Hub leftovers: Android groups themes (Standard/Metallic/Ornate/Blue/Special) and previews Normal vs Pressed side by side; web lists all frames flat (frames, buttons, bars, chips, tick box, cards and dialogs are all choosable) — Settings slice
- [x] Settings: name editing (done, a field under the title; the language selector and Latin Mode are done) — Settings slice
- [ ] Translated sprite labels: the Body/Mind/Soul stat icons are images with English text, so they stay English in Latin/Polish — i18n slice
- [ ] Native-speaker review of the web-only Latin/Polish strings I wrote (everything not copied from Android, incl. the 11 achievement titles/descriptions); Android's own Polish has "Starożytnym Bóbr" (should be "Starożytny Bóbr") — i18n slice
- [ ] Plurals: Polish needs 3 plural forms (1 / 2-4 / 5+); web uses the single "days" form like Android, and avoids plurals elsewhere — i18n slice
- [x] Android's `suggestedTask*` strings are reused (45 tasks, all three languages) by Start Here
- [ ] Locale-aware date/number formats for Latin (Intl has no Latin; uses en-GB) — i18n slice

## Deployment (deliberately NOT done yet — decide before publishing)
- [ ] Choose target (GitHub Pages repo + URL / custom domain; the old web app had a `CNAME` and `scripts/deploy.js`)
- [ ] Asset URLs are absolute (`/assets/...`, `/sw.js`, `/manifest.webmanifest`): fine at a domain root, breaks under a sub-path like `user.github.io/repo/` (needs Vite `base` + relative URLs)
- [ ] SPA/hash routing already works without server rewrites; check HTTPS (required for the service worker)
- [ ] Lighthouse PWA check on the deployed URL, install prompt UI ("Add to home screen" hint)

## Found while doing Phase 6
- [ ] Sound effects + sound toggle (Android has none in core flow; the old web app had a synthesizer, not ported)
- [ ] Crash screen (`src/ui/ErrorBoundary.tsx`) is English-only (it must work even when state/i18n is broken)
- [x] Update toast (done: when a new service worker takes over a page that already had one, a "new version is ready" notice with a Reload button appears; only testable on a production build, not tried)
- [ ] Keyboard-focus polish for the chat and task cards, full screen-reader pass on a real device
- [ ] `public/assets/raw` still ships ~120 unused Android drawables (the service worker skips the 9-slice sources); prune what the app never draws

## Found while adding appearance + accessibility settings
- [ ] Other Android button sprites not offered in the picker: `button_stone_gem`, `button_back`/`button_next` (arrow buttons), stone arrows; Android's Theme Hub also previews Normal vs Pressed side by side
- [ ] More accessibility: reduced-motion toggle (today only follows the OS setting), a high-contrast palette, larger-than-200% text, and per-user colour choices for the Body/Mind/Soul accents
- [ ] The 10-box meters scale to fit their card, so at some widths pixels are not exactly integer-sized (frames/bars/icons are)
- [ ] Segment bars have no per-colour track variants (they all sit on the same dark track); the XP/hunger/happiness choice is global, not per screen
- [ ] Onboarding does not offer text/interface size yet (only Settings does), so someone who needs big text must find Settings first

## Found while making the UI scale across devices
- [ ] Only tested in Chromium (headless). Safari/iOS and Firefox are untested: check `100dvh`, sticky side rail, `border-image` crispness and the PWA install on real devices
- [ ] Rotating a tablet flips the automatic scale (portrait 2x big-phone UI, landscape 1x desktop-like layout) — consider keeping one scale per device class, or an explicit "keep my size" option
- [ ] The browser's default font size (rem) scales text only; sprites/frames follow `--ui`, not that setting
- [ ] A mobile browser's collapsing URL bar changes the window height, which can flip the automatic scale near a threshold (needs hysteresis)
- [ ] Wide layouts only reflow the dashboard and the card lists; Settings, Chat, habit detail and the achievements header stay single-column (capped width)
- [ ] The dev-only `/kit` and `/atlas` pages are not checked on small/large screens
- [ ] A user who forces 2x on a phone gets a very narrow logical screen (195px); allowed on purpose (accessibility), but maybe warn

## Found while fixing "can't add task" on a phone
- [ ] Put the end-to-end flow test (onboarding, add task/habit, chat, export/import) into the repo (needs `playwright-core` as a dev dependency) and run it against both `localhost` and the LAN address; today it lives outside the project
- [x] Unexpected errors surface as a toast (`src/ui/Notices.tsx`: window `error` and `unhandledrejection`, 6 s, with OK); the page stays usable. The wording is generic and the error is only in the console

## Found while improving frame edges (stretch / repeat / mirror / random)
- [ ] The framed progress bars (48x16 frame + fill) still stretch their middle tile; they could use the same mirror trick
- [ ] "Repeat" styles clip the pattern at both ends of a side (the browser centres it), so a stone slab can be cut at a corner; fine in practice, but a "snap to whole tiles" mode would need non-pixel-perfect rounding
- [ ] "Random" only weathers richly textured frames (stone, wood); flat frames are identical to Mirror, and every card of one frame looks the same (variation is baked per frame, not per element)
- [ ] The Android `gameover.9.png` (64x64) is still not a frame (see earlier entry), so it has no wide-edge version either

## Found while giving inventory items their own boxes
- [ ] Slot style picker like the bars/buttons (Android has other box sprites: `box_wood`, `box_wood_gold`, `box_stone_empty`); today every slot uses `box_large`
- [ ] Inventory only shows the 4 core items (bcoin, stone, hay, stick); Android's extra items (acorn, feather, honey, ...) have no slots yet
- [x] On narrow screens the 4 slots wrapped 3+1 (fixed: they shrink to stay on one line, or wrap 2+2)
- [ ] Dashboard buttons (Chat / Trophies / Settings) still wrap onto two lines on phones; could be a single compact row like the stats
- [ ] Forced 2x on a phone wraps the 4 inventory slots as 2+2 (by design: below ~184 logical px they cannot stay on one line)

## Found while adding chip styles + collapsible theme rows
- [ ] Other plain controls still ignore the chip style: category pickers in the forms (Body/Mind/Soul icons), priority chips, difficulty numbers, the dashboard Chat/Trophies/Settings buttons
- [ ] Chip style names are not translated (like frame and bar names); only the setting labels are
- [ ] Rows with a button preview (Main/Secondary buttons) are taller than the others because the button sample uses a full frame
- [ ] Language and the Accessibility choices are still chip rows, not collapsible rows

## Found while making elements customisable (tick box, cards, dialogs)
- [ ] Not yet customisable: achievement cards, habit-detail stat cards, the XP/level card, event dialogs (level-up/achievement), chat bubbles, and the priority/difficulty chips (the navigation bar is done, see below)
- [ ] A "completed" look only swaps the frame; there is no option for the strikethrough/dimming
- [ ] Generated tick boxes reuse Android's tick shape; hand-drawn ticks per style would look better
- [ ] Element style names are not translated (like frame/bar/chip names)

## Found while making tasks untickable
- [x] Habits can be unticked within the 10-second window (already built; this entry was stale)
- [ ] Unlocked achievements stay unlocked after a refund (by design); Android has no refund at all, so there is no reference behaviour
- [ ] Undo only covers the most recent completion; ticking two tasks quickly leaves only the second undoable from the bar (the first can still be unticked from the list within 10 s)
- [ ] The refund window (10 s) is a constant (`UNDO_WINDOW_MS`); not user-configurable

## Found while adding the weathered frame centre
- [ ] The centre option only changes 5 frames (wood_tiger, stone_block, wood_steel, gold_ornate, wood_gold_gem); every other frame has a solid or 2-colour dithered centre and is deliberately left alone
- [ ] Weathering strength is fixed (centre 18%, edges 26% of eligible pixels); no slider. wood_gold_gem's dark centre looks grainier than the others
- [ ] The weathered centre exists only in the pre-built mirror/random images, so it is disabled for Stretch and Repeat edges (the row says so)
- [ ] Every card of a frame still shows the same weathering (baked per frame, not per element); 4 variant folders now ship (~650 KB total)

## Housekeeping found while updating this list (2026-11-10)
- [x] Task detail screen (done 2026-11-17: `/tasks/<id>`, opened from the target icon on an opened card; description, priority, difficulty, due date, rewards, "Done N times", last done, complete/untick, edit, previous/next). Left: difficulty is a chip, not Android's tinted `box_stone_empty`. Original note: Android has `TaskDetailScreen` (full description, "Done N times", difficulty shown in a `box_stone_empty` tinted by difficulty, previous/next task buttons); the web edits tasks only through the dialog. Task counts and last-completed date now exist to show there
- [x] Task sorting (done: "Created date" and "No sort" added): Android also offers "No sort" and "Created date" (`noSort`, `sortCreatedDate`); the web has New / Due / Prio / Diff
- [ ] Android chat labels not used by the web (note 2026-11-17: only `chatAllAchievementsStarted`/`Unlocked` exist in `src/i18n`; the rest named here are NOT in the dictionaries, so they would have to be written): `chatOverdueTasks`, `chatStrongHabits`, `chatAllAchievements`, `chatKeepBuilding`, `chatDoneToday`, `chatSticks`, `chatYoureStrong` (they exist in all three languages)
- [ ] New frames are not auto-registered: a `.9.png` dropped into `/atlas` gets its 48x48 and wide-edge versions, but `FRAME_THEMES` (accent colour) and `LIGHT_FRAMES` (dark button text) in `src/ui/themes.ts` are edited by hand; they could be derived at build time (`scripts/frame-luminance.mjs` already measures brightness)
- [ ] The Android string extractor and the i18n generator were one-off scripts outside the repo; `src/i18n/{en,la,pl}.ts` are now hand-maintained, so re-syncing with new Android strings has no tooling
- [ ] Storage format is still version 1 with an empty migration table; every field added since (task counters, settings, elements...) is filled by defaults in `normalize()`. Start real versioned migrations the first time a change cannot be defaulted
- [ ] The dev-only `/kit` page does not show the newer pieces (inventory slots, filter chips, tick boxes, Undo bar, collapsible rows) and is not translated
- [ ] No automatic build/test pipeline: `npm test` (114 unit tests) and the browser checks are run by hand
- [ ] Bóbr's items only spawn while the dashboard is open (Android behaviour); decide whether to catch up on time away, since hunger does advance while the app is closed

## Found while building Start Here
- [ ] The old web app had 66 starter tasks; only its 19 best tiny ones (difficulty 0-2) were brought over. Its harder rungs ("Exercise for 1 hour", "Write 500 words", "Run for 45 minutes", ...) are not in the catalogue
- [ ] The Latin/Polish for the 19 new starters and the 26 habit names is mine (Android's habit suggestions were hardcoded English), so they need the same native-speaker review as the other web-only strings
- [ ] Topics (Home, Garden, Free time, Career, Skills) are only shown as a chip; there is no topic filter, and the web has no custom categories to group by
- [ ] Suggestions are static: no hiding of tasks that are too hard for a beginner, no "add all easy ones" bulk action, and no personalisation by level
- [ ] "Added" means an open task from that suggestion exists; completed ones can be added again (shown with "Done ×N"). For true recurring chores, unticking the old task may be the better flow, and Start Here does not explain that
- [ ] Habit suggestions exist only for Body/Mind/Soul and the three periods (Android parity); the old web's extra categories have no habits
- [ ] The dashboard does not emphasise Start Here for brand-new users (it is just the first button in the row)
- [ ] Start Here stays a single narrow column on wide screens

## Found while customising the navigation bar
- [ ] Items can be chosen but not reordered (they follow a fixed order: Home, Tasks, Habits, Start Here, Chat, Trophies, Settings)
- [ ] Settings has no gear icon in Android's art, so it uses the green menu-lines sprite (`rearrange`); Start Here uses the target sprite
- [ ] With all 7 items, labels and 200% text on a small phone the bottom bar is over half the screen tall (it wraps into rows); the content area adapts, but a "compact" fallback (hide labels when it gets too tall) would be kinder
- [ ] On a landscape phone with many labelled items the side rail scrolls instead of fitting; no scroll hint is shown
- [ ] Active-tab style and label names (outline, glow, plate, underline, lift) are not translated, like the other style names
- [ ] Custom icons per nav item (choosing from the atlas) are not possible; icons are fixed per destination

## Found while making buttons smaller
- [ ] The frames with decorated corners that must keep a thick border (`stone_block`, `wood_gold_gem`, `wood_steel`, `gold_ornate`) are a hand-picked list (`DECORATED_FRAMES` in `src/domain/look.ts`); an automatic corner measurement failed because the frames are shaded across their edges, so a newly added decorated frame needs adding by hand
- [ ] Medium and Compact buttons always use the plain frame image, so the Frame edges / Frame center settings do not apply to them (only to Large buttons, cards, dialogs and the nav bar)
- [ ] The default button size is now Compact, so existing saves without the setting get it; there is no one-time notice
- [ ] Buttons that explicitly use scale 2 (big call-to-action buttons) scale with the size setting but stay twice as thick as the scale-1 ones
- [ ] The four dashboard buttons (Start Here, Chat, Trophies, Settings) still wrap to two rows on a phone even at Compact

## Found while adding full screen
- [ ] Full screen cannot start before the first tap (a browser rule), so the first screen is briefly windowed; only an installed app with `display: fullscreen` in the manifest could start fully immersive, but that mode cannot be exited from inside the page, so the manifest stays `standalone`
- [ ] iPhone Safari has no Fullscreen API; the only option there is Add to Home Screen (standalone), which the Settings text mentions but does not detect
- [ ] If you leave full screen with Esc/back, the preference stays on and the next visit goes full screen again on the first tap; there is no separate "don't ask me again" switch
- [ ] Full screen hides the system status bar and navigation bar, so the app does not show the time or battery; no in-app clock
- [ ] The Fullscreen API was only tested in headless Chromium (on localhost and over the LAN address), not on a real phone or in Safari/Firefox

## Found while porting the rock-throwing game
Rules that Android states but does not actually apply (changed here on purpose, so the game works as described):
- [x] Combo: Android reset it on every frame without a hit, so it only ever counted hits in the *same frame* and "10x combo" was unreachable. Here it counts consecutive hits across throws and resets when a thrown rock misses everything (`step` in `src/domain/rockgame.ts`)
- [x] Distance bonus: Android measured hit point to target centre (about 0), so it was always x1.0. Here it is thrower to target
- [x] Accuracy bonus: Android measured the contact point (always near the edge), so the x2 "perfect centre" tier was unreachable. Here it is the closest approach of the rock's flight path to the target centre (`closestApproach`)
- [x] Fast rocks could jump over small targets on a slow frame; the web steps the rock in 1/120 s sub-steps
- [x] The 7 minigame achievements were seeded with `rock_game_*` conditions but Android's checker looked for `minigame_*` ones, so none could unlock. All 7 are wired now; "Perfectionist" means a level finished without a missed throw (Android compared hits to the target list length, which dynamic spawning made meaningless); "Distance King" means hitting a target 900+ units from the thrower
- [x] `GameRect.height` was `right - left` in Android (so it equalled the width); the web uses the real height for the sine/figure-eight/pendulum sizes
- [x] Practice mode is documented as unlimited rocks but played exactly like Arcade; here it really is unlimited, and ends with the pause menu's Finish button (no rewards if you just Quit, as in Android)
Left out or different (still open):
- [ ] Starting by long-pressing the stone in the inventory (Android: costs 5 stone, then opens the game). The web starts from Dashboard > Games and is free; only Play Again / Restart cost 5 stone
- [x] Time Trial mode instead of Android's CHALLENGE (Games > Time Trial): 30 s countdown, unlimited rocks, every hit adds 3 s (max 99), a hit within 2 s of the last one (or the start) scores x2, within 4 s x1.5, within 7 s x1.2; 1.5x stat points; ends when time is out and the last rock has landed. Values untuned by playing; the HUD shows TIME in place of rocks, no on-screen hint for the speed bonus yet
- [ ] Haptics (`RockGameHaptics`) and any sound
- [ ] The off-screen trajectory indicators (arrows at the edge where the predicted path leaves the field), the score popup frame (`GameInfoFrame`) and the pause screen's leaderboard shortcut
- [ ] Android sizes the field to the real screen (and scales targets by device density); the web uses a fixed 1080x1200 field scaled to fit, so the game is identical on every device, but it is letterboxed on very wide or very short screens and the thrower is small on phones
- [ ] Android's `RockGameStats.accuracy` (hits / throws) is stored implicitly (totals) but not shown anywhere; the leaderboard shows the top 10 of the best 50 games kept (Android keeps every session)
- [ ] The aiming sensitivities (0.05 degree and 0.0025 power per logical pixel) are Android's, tuned for a ~360 dp wide phone; they have not been tried on a real touch screen, and there is no setting for them
- [ ] The game-over dialog ignores Escape and outside taps on purpose (an achievement popup can sit on top of it); there is no way to dismiss it except its two buttons
- [ ] Not tested on real phones (touch aiming, frame rate on low-end devices) or in Safari/Firefox; only headless Chromium on localhost and the LAN address
- [ ] The game uses the Bóbr sprite for the thrower at native size (about 37 px on a phone), no throwing animation

## Found while porting Pixelite
- [x] Apps screen (`/apps`, nav button + dashboard tile next to Settings) and Pixelite (`/apps/pixelite`): grid sampling, offset (sliders or drag), cell shading, palette, output presets/custom, zoom/pan, PNG export and copy
- [ ] Nav button for Apps is off by default (nav choices are saved per user); tick it under Settings > Theme > Navigation items
- [ ] Native-speaker review of the Latin/Polish Pixelite strings (written by me, not from Android)
- [ ] Pixelite leftovers: the original's "snap to grid" checkbox did nothing and was dropped; a dedicated Apps icon sprite (currently reuses the yellow pencil)

## Found while porting Sanctuary
- [ ] Android's Sanctuary was only reachable from the Bóbr pen; web has it under Apps (no link from the dashboard / pen yet)
- [ ] Left out on purpose: WebGL renderer, performance monitor/modal and grades, culling/batching/object pools (a 2D canvas is fast enough for the 24x24x8 grid), the spatial index, Q/E camera rotation and WASD pan
- [ ] Block rotation (R key) and per-block properties (walkable/climbable/interactable/destructible) are not ported: the sheet already has every direction as its own tile, and nothing in Android reads the properties
- [ ] Layers are 16 px apart (Android used 32, which left a visible gap between stacked cubes); Android's Z-level manager (named levels, lock/hide per layer) is reduced to one "current layer" with the layers above faded
- [ ] Android's height-map generator (Perlin octaves, gaussian blur, multi-level terrain, `MapGenerator` presets) is reduced to one seeded "New island" button; no size/seed/height controls
- [ ] Android's level library had description/author/templates; web saves named levels only (max 30) plus an auto-saved draft, both inside the normal export/import
- [ ] Sanctuary is not wired to the game (no stone/coin cost, no Bóbr walking around it, no achievements)
- [ ] Not tested on a real touch device (two-finger pinch/pan is written but only mouse/synthetic pointers were tried); not tested in Safari/Firefox

## Found while porting the Bóbr world map (Android: `ui/bobr/InfiniteMapScreen`, `EcosystemManager`, `ChunkLoader`, `BiomeRegion`)
Ported: biome regions (ocean/desert/grassland/forest/wetland/lake), sand beaches, Android's transition-tile tables, decorations (flowers, rocks, bushes, trees, water rocks), 16x16 chunks with cached bitmaps, minimap with explored memory, day/night (60 s day, sun, darkness), paper plane (joystick, keys, manual speed, cruise figure-eight, pitch -> 10 layers -> parallax/size), decorative sky clouds (off by default like Android), the water cycle (evaporation of lake shores -> 10 cloud layers -> wind -> rain downwind -> terrain change), vegetation ladder (sand -> grass -> flowers -> bush/tree -> growth to 4x), "3 water sides floods the tile", heat waves and cold snaps, wind on/off/strength/direction, terrain paint tool, saved worlds (seed + changed tiles).
- [x] Rivers (Android `connectWaterBodiesWithPathfinding`, `flowWaterAlongPaths`, `migrateSingleTileWaterBodies`, sand/river cloud attraction): puddles of 4-64 tiles link to the nearest within 20 tiles by a curved channel that fills one tile per 0.5 s; lone water tiles join the nearest river line (20) or lone tile (40) and walk towards rivers/sand/water leaving sand; river tiles flood 90% when rained on (1% elsewhere); clouds drift to sand (half of them) and river lines, wander a little and keep one per tile per layer. A "Rivers" button shows the lines (Android's debug overlay)
- [ ] Rivers left out: Android's river width rules (`enforceRiverChannelConstraints`, max width 1, curvature, widening to 3 in flow phase 2 which its own constant contradicts) and the "inland" cloud attraction (never called in Android); its path "smoothing" is skipped because it dropped tiles and left gaps the flow could not cross; paths are 4-connected so the channel is continuous
- [ ] Rivers are not saved (they are re-planned from the water that exists after reopening); the water they dug is
- [ ] Performance: river/sand attraction is O(clouds x river tiles); with 2000 river tiles and 65 clouds it is fine on desktop but not measured on a phone
- [x] 3rd-person camera and billboard trees: "3rd person" (the view eases ahead of the plane while it flies, "Look ahead" slider 0-12 tiles, the plane is drawn where it really is) and "Leaning trees" (billboards). Android only has these as plans (THIRD_PERSON_CAMERA_*.md, nothing in its code), so this follows the plan plus its review, with changes
- [ ] 3rd-person/billboard differences: the plan rotates each tree around its centre toward the camera (+90), which would spin trees; here they are sheared outward from their base (and stretched by how far above/below the middle they stand), more with distance, upright beyond 800 px; scale 1.0-1.35 instead of the plan's 0.3-2.0; the plan's layer parallax offset for billboards is dropped (it slides trees off their tiles), the layer only calms the lean; the plan's per-frame lerp 0.15 is made frame-rate independent; billboards are drawn for every visible tree, not only "3 chunks around the camera" (the view is that small already)
- [x] Tilted ground: "Tilt" slider 0-16 (0 = flat; step 8 is about 50 degrees, step 16 about 62, the most the perspective can fill without a huge canvas; with "Behind plane" at the top steps the canvas backing store drops to 0.35x, so it is blocky). The canvas is drawn flat but bigger than the stage (as much extra ground as the tip needs, reaching further up than down) and tipped back by the browser with CSS `perspective()` + `rotateX()` on the GPU, so it costs no more than drawing a ~1.2-1.7x bigger flat picture (an earlier version re-cut the picture in strips every frame and was slow). The whole picture tips (trees, clouds and the plane lie down with the ground, not stand up); the HUD text and wind dial are drawn on the tipped canvas, so they tip too; off while the paint tool is active; the preview here renders in software so a real phone is still untested
- [x] 3D view (WebGL 2, `src/screens/worldgl.ts`, button "3D view", on by default): while Tilt > 0 or "Behind plane" is on, the world is drawn through a real perspective camera instead of the tipped flat canvas. Ground = one mip-mapped texture per chunk (the existing chunk canvases), faded into the sky at a reach of about 3.3 camera heights, only the chunks in the camera's footprint are built/drawn and only ~32 tiles round the plane are simulated; trees, bushes, rocks, clouds, rain and dust are camera-facing sprites (they stand up at any tilt and turn), the plane is a flat sprite in the air that banks and pitches with the glider, shadows/haze/river dots are decals on the ground, clouds are depth-sorted translucent sprites far above the plane (4 + (10 - layer) x 1.4 tiles, never above the camera; the plane is at (11 - layer) x 0.6), the decorative sky puffs are fixed in the world at their layer's height (the perspective gives the parallax). The 2D canvas stays on top as an overlay (night tint, text, wind dial). The old tipped-canvas path is still there as the fallback (button off, or no WebGL 2). Measured in the software-rendered preview, chase + tilt 16 + sky clouds + rain: about 5 ms vs 13 ms of script time per frame. Not tried on a real GPU or phone; no sun/shading on trees; leaning-tree shear is not used in 3D (only their ground shadow); the paint tool uses the flat map; far ground is built a chunk at a time (6 ms budget) so it fills in at the horizon when moving fast; chunk edges might show faint seams far away
- [x] Bigger, stronger thermals (`glider.ts`): core radius 15-25 tiles (was 9-16), peak updraft 3.0-6.4 m/s capped at 7 (was 2.0-4.6, cap 5), a wider bell, one every 60 x 60 tiles (was 44), 85% of cells have one (was 72%), so about 0.65x as many per area but each much bigger, living 90-170 s (was 70-140). A good thermal now carries a plane from 60 m to the ceiling in about 30 s, so the skill is staying in the core and pulling a little (about 0.3) to fly slow: the glider test now checks that at 20 s, and a hard pull (0.8) climbs worse than hands-off. Not tuned by hand-flying it
- [x] Tilt / chase performance: the tipped and turned canvas is much bigger than the stage, so ground chunks, trees, clouds and the ecosystem's watched area are only handled where the stage's corners, taken back through the tip and turn, reach (`quad`/`vis` in `WorldMap.tsx`). Script time per frame in the preview: chase + tilt 16 about 10 ms -> 4 ms, tilt 8 about 5 -> 3 ms, flat about 2 ms. Still open: the canvas itself is filled at its full size (the 1.6 megapixel cap holds that down), and the preview cannot show real GPU cost
- [x] Tilt follows the plane's pitch: the slider is the base tilt (0 still means flat); nose up adds up to 3 steps (more tipped, you see ahead), nose down takes up to 3 away (nearly top-down), eased at 4/s; glide uses the real pitch, other modes the pitch slider. The canvas is sized for the largest tilt, so only the CSS transform changes per frame (`PITCH_TILT` in `WorldMap.tsx` is the amount; flip its sign to reverse the direction). No separate slider for the amount
- [x] "Behind plane" button (menu): the view turns (CSS rotate on the canvas, eased the short way round at 5/s) so the plane always points up the screen; with "3rd person" the plane sits low and the view looks ahead. The stick is read in screen directions (rotated back into the world for cruise/manual), trees/billboards and their lean stay upright on the screen, the text and wind dial are counter-rotated (the dial arrow turns with the world). Cost: the canvas must cover a circle round the plane, so it is up to ~3x the stage's area; its backing store is capped at ~1.6 megapixels (blockier when tilted too). Clouds (water-cycle clouds, rain drops, thermal cumulus and the decorative sky puffs) are drawn like banners: upright, facing the screen, with their height offset and rain fall screen-vertical (checked only for errors, no cloud was on screen when I looked). Known: the glide altitude offset of the plane and its shadow still turns with the world instead of staying screen-vertical; off while the paint tool is active; the preview only renders in software, so a real phone is untested
- [x] Leaning trees get a soft ground shadow (an ellipse at the base that stays on the tile while the tree leans); without "Leaning trees" they still have none
- [ ] Android's `EcosystemUI` panels beyond wind (temperature controls, event triggers, debug counters) are reduced to a clock/temperature/weather chip and a stats line
- [ ] Clouds, evaporation points and rain in progress are not saved (a reopened world starts with a clear sky); terrain changes, plane, time and wind are
- [ ] The standalone Wave Function Collapse module (`ui/bobr/wfc`) and the old fixed-size map/`BobrMapScreen` are not ported (Android itself no longer uses WFC for the pen)
- [ ] Tile test / transition verifier screens (`TileTestScreen`, `TileDisplayVerifier`) not ported
- [ ] Android's grass<->water diagonal-only corners (the 2x2 "inner" tiles for a pond corner touching diagonally) are never chosen by its transition rule; ported as is, so a tile touching water only at a corner keeps a hard edge
- [ ] Only checked in Chromium on desktop and an emulated phone width; touch joystick untested on a real device
- Android doc bugs noticed: the cloud layer capacities (1,2,3,5,8,13,8,21,3,1) add up to 65, not the documented 64; rain distance is documented as `wind x 10` tiles but drawn as `wind x 1`; the day/night `darkness()` has an `else 0` that makes its "just above horizon" smoothstep dead code
- Differences on purpose: terrain is a pure function of (seed, x, y) so chunks need no edge constraints and biomes are per tile (Android: per chunk, hence a visible block grid); noise never repeats (Android's wrapped every 256 cells); decorations come from a tile hash so rebuilding a chunk keeps them; the seven rain/cloud bugs from ECOSYSTEM_FLAWS_AND_FIXES.md are fixed by design; the ecosystem keeps running while flying (Android paused it); evaporation is sped up so lakes shrink while you watch
- [x] World map: full screen button (browser full screen when allowed, else a fixed layer; Esc leaves; the control cards move into a "Controls" drawer) and compact buttons (`PixelButton size="compact"` overrides the Settings button size). Not tried on iPhone Safari, which has no full screen API (the fixed layer is used)
- [x] World map UI redone to match the Android screen: full-screen view with floating pixel-art controls (close, biome banner, clock + sky-cloud eye, paint pencil + water/sand/grass tiles showing the brush size, minimap in a wooden frame with temperature and a menu button, rivers / wind buttons and a cloud counter bottom-left, flight mode button over the sprite joystick); everything else (full screen, pause, zoom, 3rd person, trees, flight/wind/paint sliders) is in the menu. On narrow phones the paint tools stack vertically. Android's exact buttons for its drop / cloud-rain / number boxes are guessed (drop = rivers, cloud = wind on/off, number = clouds)
- [x] World map performance pass (measured with a node benchmark on a 160x96-tile watched area, 65 clouds, ~1500 river tiles, 5-10k water tiles): ecosystem step 2.2 ms -> 0.25 ms average and 45 ms -> ~4 ms worst frame. What changed: water/sand/lone-tile sets are updated as tiles change instead of rescanning the area (a new area is scanned 8 rows per step); evaporation handles a quarter of the shore per call; water bodies are flood-filled on a flat grid and cached for 1 s; sand and river lines are summed per 8x8 / 4x4 block for the cloud pull (recomputed every 5th tick per cloud); river targets come from block lookups; lone-tile migration and shore flooding work on tracked candidates and rotating slices; rain-on-water shore growth is capped at 3 per cloud tick (a deliberate small behaviour change). Rendering: chunks are built by `chunkDrawn` from the chunk grid with cached biomes (about 5x faster, tested equal to `drawn`), the canvas pixel ratio is capped at 2, the minimap redraws at most 2.5 times a second, and the HUD numbers and joystick knob no longer re-render the screen
- [ ] Performance not measured on a real phone (the preview pane renders in software at 15-30 fps with ~0.7 ms of our own work per frame); a flat typed-array world instead of Maps would be the next step if it is still slow


- [x] World map defaults: 3D view on, 3rd person on, Behind plane on, Tilt 16 (the maximum). The old flat north-up view is one slider (Tilt 0) and two buttons away; the settings are not remembered between visits

- [x] Space = boost (glide mode): in the air it kicks the plane along its nose and up for 1.3 s (about +5 m/s of speed and 13 m of height gained; the wing eases off to carry 1 g during and 1.2 s after it, and a stall is eased too, because a harder kick made the plane zoom up vertically and be flung backwards: tested for every heading that it never goes backwards or climbs past about 60 degrees), then pauses 4 s; once landed Space (or the Throw button) throws the plane again as before. Shows "BOOST" while it lasts. `boostPlane` in `glider.ts`, tested. No cooldown meter on screen, no sound, no trail; values untuned by hand

- [x] 3D heights: the plane and the clouds share one height scale (layer 10 = 4 tiles .. layer 1 = 22; a glider is at 0.18 tiles per metre), never above the camera, so a high plane is clearly nearer the camera, bigger, and far above its shadow; the camera's target rises half way with the plane (ground shrinks as you climb, the plane stays in view). The visible-ground polygon now follows the whole stage border (16 points), which fixed straight-edged gaps at the horizon

- [x] Boost no longer sends the plane backwards even when you hold the stick: while a boost (and 1.2 s after) works, pulling back cannot add lift, and in glide mode the nose is always eased back past about 55 degrees of climb or dive, so a fast pull or push cannot loop the plane over the top and tail-first (it did, with a pull held, at the speed the boost gives). Tested for four headings x four stick settings. Side effect: a very hard pull at high speed now arcs over instead of climbing straight up

- [x] Thermals doubled again (`glider.ts`): peak updraft 6.0-12.8 m/s, capped at 14 (was 3.0-6.4, cap 7), because banking round in a thermal lost too much speed. In the simulation a plane circling in the best thermal (bank 0.3-0.6, a gentle pull or none) now climbs about 7-8 m/s and keeps 4-10 m/s of airspeed; it climbs far past the 120 m picture top (no ceiling, see above). Radius and spacing unchanged. Not hand-flown

- [x] Hoops (`src/domain/hoops.ts`, tested): upright gold discs hanging 4.5-10.5 tiles up (25-58 m for the glider), about one per two 36 x 36 tile cells, placed from the world's seed, each facing its own way. Fly through one from either side (the path since the last frame must cross the disc, 3.6 tiles across) and it turns faint green, "HOOP!" flashes, the counter at the top goes up and in glide mode the boost is ready again. In the 3D view they are translucent rings with a shadow on the ground; in the flat view they are a gold line across the way they face. Each shows its height in metres (the same scale as the plane's "xx m" label) in its middle, gold, or green once passed. The count is only for this visit (not saved), nothing is awarded in XP, the flat view cannot show height, and I have not flown through one by hand (the crossing test is covered by unit tests). Also: missing ground chunks are now built nearest first

- [x] 3D ground colour: the water colour is now added by the shader under every ground tile (`uBase` in `worldgl.ts`), so chunks built by an older version of the code (they survive a hot reload) can no longer show up brown among correct ones; the water background baked into new chunks stays

- [x] 3D ground colour swap: some chunks showed red and blue swapped (water brown, sand light blue, grass teal). Cause not reproduced here; the chunk textures are now uploaded as raw pixels (`getImageData`) instead of straight from the canvas, which avoids the browser's canvas-to-texture copy path that I suspect. If it still happens, the next suspect is the mip-map generation or the sheet's own colour profile

- [x] 3D performance pass (measured per frame in the software-rendered preview, script time, flying in the chase view at tilt 16): about 14.8 ms -> 10.7 ms. Chunk canvases are now memory-backed (`willReadFrequently`), so reading their pixels for the 3D texture no longer stalls on a GPU read (ground 5.4 -> 1.7 ms; the browser had been warning about this on every chunk); the night tint is done in the 3D shader instead of a full-screen 2D fill (it also darkens the sky); the ecosystem is only simulated within 26 tiles of the camera in 3D (was 32). What is left, by size: the ecosystem step (about 2.7 ms), chunk building (about 1.4 ms), the HUD/overlay (about 2 ms), sprites (about 1.3 ms). Not measured on a real GPU or phone. Ideas not done: build chunk textures straight from tile data without a canvas, texture atlases per chunk row, instanced sprites, a lower-resolution 3D canvas on slow devices

- [x] World map minimap on phones (<= 520 px wide): the minimap is smaller (54 units a step: 108 px standard, 162 px when double-tapped; was 78: 156 px) so it no longer hides the banner and the buttons, its wooden frame gets the full 16-unit border and corners (the phone layout had halved them to 8; a corner size chosen in Theme manager still wins), the wind dial is smaller (24 per step, was 30), and the banner is kept clear of the minimap. Desktop sizes are unchanged. Checked in an emulated 375 px phone only

- [x] 3D performance, second pass: the sprite queues are growing typed arrays written in place (no per-sprite arrays, no copy before upload, the translucent ones are sorted by index), and the 3D canvas now lowers its resolution by steps of 0.85 down to 0.5 when the smoothed frame time is over 30 ms, and raises it again (after 4 s) when under 18.5 ms; the 2D overlay (text, dial) stays sharp. In the software-rendered preview it settled at 0.61 (579 x 419 for a 942 x 682 stage). No manual switch for it and no number on screen yet. Not done: texture building without a canvas (chunk building is mostly terrain generation, so little to gain), instanced sprites

- [x] Thunder and fire (world map; not in Android, no written roadmap existed, so this is designed here; pictures in `public/assets/Fire`). `ecosystem.ts`, tested: a cloud that is raining hard throws a bolt now and then (more from a big cloud and on a hot day) into or just outside its rain; a bolt nearly always lights a bush or tree and seldom plain grass. Fire burns a tile for 2 s (grass) to 6-14 s (trees, longer the bigger they have grown), spreads to its 8 neighbours by how well they burn, much faster downwind, throws embers 2-4 tiles downwind in a wind, never crosses water or sand, and is hotter and faster by day and in a heat wave. Rain puts fire out and keeps tiles wet (unburnable) for 8 s. A burnt tile is bare grass, charred (drawn dark, cannot burn again) for 45 s; rain grows it back up the vegetation ladder; a burnt tree sometimes sends a small smoke cloud up. In the generated (sparse) forest a fire is a patch of some 20 tiles, in rain-grown thick forest it runs until it meets water, sand or rain. For the plane: the air over a fire rises (up to 6 m/s), a bolt flashes the view and thunders (louder when near). Menu button "Lightning" drops a bolt a few tiles ahead of the plane on the best fuel there
- [ ] Fire left out / not done: fires, charred ground and wet ground are not saved (only what burnt down is, as terrain changes); at most 400 tiles burn at once; fire further than 8 tiles outside the simulated area goes out; no smoke, sparks or crackle sound, and the fire's light does not fall on things round it; a bolt does not hurt the plane and flying through flames does nothing but lift; `flame1.png` is unused (three frames: flame2-4); no fire brush in the paint tool; nothing in the HUD counts fires. Ash as sand was tried and dropped: sand tiles dotted through grass let the first water that touched them flood the whole burnt patch (the "no grass between water and sand" rule)
- [ ] Not hand-tuned: strike rate (`STRIKE_CHANCE`), spread (`SPREAD_RATE`) and burn times were set from simulated runs, not from playing; the bolt is drawn as tall as its cloud is high, which is very big when you stand right under it. Only seen in the preview (Chromium), 3D and flat views
- A dev server that was already running when a new folder is added under `public/` does not serve it (it answers with the app page instead of the picture): restart it. That is why fire does not show until `npm run dev` is restarted after `public/assets/Fire` appeared

- [x] Ecosystem phase 0 (see ROADMAP.md): `npm run soak` runs five biomes headless for an hour and prints what drifts; `Ecosystem.tally` counts what the simulation did (and which rule turned land into water); menu > "Eco stats" is a live window with the census of the simulated area, a 6-minute chart, sky, fire and totals. Found: every world with water floods completely in 5-30 minutes (rain-on-water shore growth and the "settle" fill do it), and a world with no water never changes
- [ ] Eco stats window: not draggable, and its "/min" column is extrapolated from less than a minute right after opening; on a phone (375 px) it covers most of the view while open
- [x] Ecosystem phase 3 (see ROADMAP.md): the world no longer floods. The no-tile-art shore rule makes sand instead of water, each 32x32 region keeps roughly the water the seed gave it (rain only adds water to a region short of it, and evaporation slows there or speeds up in one with too much), rain outside the simulated area changes nothing, and a nearly empty sky gets a cloud blown in every 20 s. Lakes hold their place
- [ ] Phase 3 left: vegetation now grows unchecked under the steady rain (flowers several-fold up in an hour, deserts green over); that is phase 4. Tuned only by soak runs, not by playing. Water inside a region can still move a little; whole lakes do not wander


- [x] Low and slow: in glide mode below about 22 m and under about 13 m/s the 3D camera moves up to the plane's nose (the on-foot eye: `fpv` in `worldgl.ts`), blending in as the height and speed drop (full under about 5 m and 8 m/s), turning to where the plane points and pitching a little with it; the plane is hidden once it is close. On touching down the walking view is that same camera (the nose offset and the extra height fade to the on-foot values over the last 3 m), so landing does not change the view. The height label beside the plane is not drawn from the nose. Checked by screenshots of one flight and landing, not tuned by hand-flying; the 5-22 m and 8-13 m/s limits are in `lowSlow` in `WorldMap.tsx`

- [x] Throw camera: while you hold the plane up to aim, the 3D view stays in the on-foot eye and draws the path it will fly with the power and heading as they are right now (gold dots along a simulated flight with a ring where it comes down; recomputed every frame, 36 steps of 0.15 s, the wind included). On letting go the camera stays where the plane was held (it flies out of the lens; the model is hidden for its first 5 tiles) for 0.35 s, then swings in close behind it (6.5 tiles back, nearly level) and backs off over about 4 s to the normal distance and tilt (the look-ahead comes in with it), handing over at 5 s. In the flat view (3D off) nothing changes. Not done: the dots are plain (no ground ribbon), the aim path ignores rain and fire heat, and if the normal view is the flat map the launch camera still shows in 3D for those 5 s and then snaps back to it. Checked by screenshots (they lag, so the first half second after the release was not seen)

- [x] Look button ("LOOK" under the eye button, glide mode, in the air; hidden on foot where dragging already looks round): while it is on, dragging the view (mouse or finger) looks round instead of steering and keyboard flying still works; sideways turns the camera round the plane (in the nose view, the head), up and down tips it (the chase camera swings lower or higher, the nose view looks up and down). The view stays where you leave it until the button is turned off, then it eases back. Needs the 3D view; the flat map ignores it. Checked in one flight by dragging; not every combination (mouse flying, acro sticks) tried by hand

## Found while porting the mind map
Code: `src/domain/mindmap.ts` (rules, tested), `src/screens/MindMaps.tsx` (list), `src/screens/MindMapEditor.tsx` + `mindmap.css` (editor).

Changed on purpose (Android's boxes were too big to be useful on a phone):
- A box is as big as its text (a short label is 56x32 units; Android: fixed 200x50 dp that could only grow, in steps of 50). The handle on a selected box changes how wide it may get before the text wraps; it never cuts a word that fits on a line.
- The grid is 8 units (Android: 50 dp). Box borders are drawn at half width (8 units) so a small box is not mostly border.
- Zoom is continuous, 0.25x to 3x (pinch, wheel, + / - keys and buttons), with "fit all" on open and on the eye button (Android: 1.0 or 0.5 only). Boxes, text and links sit in one transformed layer, so they always scale together.
- Drag the background to pan and drag a box to move it: no joystick and no separate "move mode".
- Links can be selected and deleted (Android had the code but nothing called it), and two boxes can be linked only once.
- A link leaves a box straight out of its side (Android: an S-curve with a sideways offset).
- Every finished edit is saved, with up to 50 undo steps (Ctrl+Z or the button) while the map is open. No Save / Exit / Save-and-quit dialogs.
- You type straight into a box: "Add box", "Child", a double tap or Enter puts the cursor in it, the box grows as you type, Enter finishes, Esc takes it back, and Tab finishes and starts a child. A new box left empty goes away. If the text would be smaller than 12 px the view zooms in first. (The typing field is exactly as wide as the widest line and `wrapLabel` breaks lines by the browser's rule, so the text does not jump when typing ends.)
- A box can have a description (up to 500 characters, line breaks kept): "Edit" opens text, description and frame. A box with one shows a yellow corner mark, and the description appears above the buttons while the box is selected.
- Dragging a box (or moving it with the arrow keys) carries its whole branch: every box reached by following links away from it. Shift or Alt, or the hand button under Back, moves the one box alone.
- Links that share a side of a box are spread along it, in the order of the boxes they lead to, and are never drawn thinner than 1.5 px.
- "Child" adds a linked box to the right of the selected one: level with its middle, or under the children already there.
- Keyboard: Tab reaches the boxes, arrows move the selected one, Enter types in it, Delete removes, N adds, F fits, Esc deselects.

Left out or still to do:
- [ ] Not tested on a real touch screen: pinch zoom and two-finger pan are untested (the browser tools here have one pointer); mouse drag, wheel, taps and the keyboard are tested
- [ ] Android's curve types (straight, quadratic, cubic with stored control points) and link colour: Android never offered a way to choose them either
- [ ] Free box height (Android's extend-down arrow): a box is always as tall as its text
- [ ] Export a map as a picture, and copy / duplicate a map
- [ ] Typing on a phone: when the on-screen keyboard opens it may cover the box (the view does not know the keyboard's height); untested on a real device
- [ ] A link's direction decides what a branch is (parent to child). Links made with "Link" point from the box you started on; there is no way to see or flip a link's direction
- [x] Fold/Unfold a branch (not saved; a folded box shows +N) and To task / To plan buttons on a selected box (built 2026-11-17; a task or activity made this way does not show back on its box). Earlier: collapsing and turning a box into a task were suggested, not built. (Tidy button built 2026-11-17: tree layout left to right; not hand-tuned on big maps)
- [ ] Undo steps are lost when the map is closed
- [ ] Box frame names in the dialog are read to screen readers in English only (`green ornate`, ...)
- [ ] The eight box frames are Android's `NodeThemeManager` list; the user's own frames and colour variants are not offered
- [ ] Holding the Mind box on Home opens the list of maps, as on Android; nothing on screen tells you so (the Apps entry is the visible way in)

## Planner, shortlist and Bóbr's plan talk (web-only, 2026-11-16)
Code: `src/domain/planner.ts` (rules, tested), `src/screens/Planner.tsx` + `planner.css`, and the new replies in `src/domain/chat.ts`.

What it is:
- Planner (Home > Planner, `/plan`; it can also be put in the bottom bar from Settings): the shortlist on top, a month calendar, and the chosen day's activities, tasks due, late tasks and habits still to do.
- An activity is the one new kind of record: a title on a day, optionally with a time, a length, Body / Mind / Soul and a note. Ticking it gives no XP.
- The shortlist is up to 5 of your ordinary tasks, picked to do next. "Add" makes a quick task (medium priority, difficulty 2, due today) and lists it; "Pick from tasks" lists an existing one; a task ticked today stays on it, crossed out, until tomorrow.
- Everything is the same data as the rest of the app: ticking a task or habit in the Planner is ticking it in Tasks / Habits, and the reverse.
- Bóbr reads the same plan: his greeting adds a line about today, "What's on today?" lists it, and "What now?" offers one thing at a time (an activity that is on now or starts within 30 minutes, then late tasks, the shortlist, tasks due today, any-time activities, habits, other high-priority tasks). "Done" / "Complete Task" ticks it and goes straight to the next; "Something else" skips it.

Not done / to decide:
- [ ] No sprite for a calendar: the Planner tile and bar button use the ticked-box sprite (`box_checked`)
- [x] Activities now pay 5 XP + 1 per 15 minutes (up to +15) and a point in their category when ticked; unticking takes exactly that back, so it cannot be farmed (`eventReward`, `paid` on the event)
- [ ] Activities do not repeat (no "every Tuesday") and have no reminders or notifications
- [ ] No week view, and a day is a list, not a timeline with hours
- [x] The shortlist can be reordered with up/down buttons (2026-11-17). Its size (5) is still fixed
- [x] Sparkle when ticking a to-do on the Planner shortlist (built 2026-11-17; the board already had it). Still none for "What now?" in the chat
- [x] Bóbr nudge on Home (built 2026-11-17): a line under the pen when an activity is on or starts within 30 min, else when tasks are late; tap opens the Planner. Still open: a spoken line in the chat, and nudges while the app is closed (notifications)
- [ ] Week starts on Monday for every language
- [ ] Checked in the browser at phone width by reading the page (the preview pane was hidden for the last part): the two-column layout on wide screens and the look of the activity form were not looked at
- [x] Mind map boxes become tasks or activities with a button (built 2026-11-17); a ticked task is not shown on its box



- 2026-11-17: built Start Here topic filter, easy-only filter and "add all easy ones"; Settings reduce-motion switch; Time Trial speed multiplier shown in the HUD.

- 2026-11-17: built a Settings High contrast switch (brighter text, darker backgrounds, clearer borders; not checked against a screen reader or with real low-vision use) and a hint on Home about holding Body and Mind (shown until one is held, remembered on the device).
- 2026-11-17: the Home hold hint is now a hover/focus tip in a pixel-art box on the Body and Mind boxes (touch screens show none, since there is no hover; the boxes' long-press still works).
- 2026-11-17: Theme manager has three new elements: Bóbr's nudge card on Home, the Category and tag dialogs, and the hover tip (its frame is always drawn at 1x or larger, whatever corner size is picked). Category chips keep one frame per category, chosen in the category manager, so they have no Theme manager entry. The Notices toasts and the Planner are still not in the Theme manager.
- 2026-11-17: Theme manager also has Inventory slots (Classic slot sprite, or any frame drawn as a 1x backdrop) and three Planner elements: side cards (shortlist, month, habits done), the board, and an activity card. The Planner's day columns, blocks and chips, and the exercise tracker, are still not in the Theme manager.
- 2026-11-17: Planner shortlist: drag a to-do to reorder (a gold bar shows where it lands), or drop it on a day of the board, which dates it and takes it off the shortlist. The up/down buttons are gone. On touch the drag still starts from the grip. Dropping on the board was only tried through the store tests, not with a real drag.
- 2026-11-17: Planner: a habit that is not on the calendar yet can be dragged from the day's list onto a time slot (it then repeats from that day and time, like one added with + Habit); cards on the board are now drawn with their frame at 1x as a backdrop, so a 15-minute block (at least 32 units tall) shows its title over the frame with 2 units of padding instead of hiding it. The board no longer uses half-size frames. A 15-minute block is drawn taller than 15 minutes of grid, so blocks near each other can overlap more than before.
- 2026-11-17: Planner: saving an edit of a repeated activity asks "Just this one" or "All future ones" (a changed date shifts the later ones by the same number of days). Deleting and dragging already asked. Not asked: stretching a block to a new length (changes only that one), and editing a planned habit (its form changes the whole habit; only its place on the calendar has a per-turn choice, when it is dragged to another day).
- 2026-11-17: Planner: a closed block on the grid shows only its title, centred in the block (the time is where it sits, and shows when the block is opened); the tick's tap area is 24 units tall there instead of 40.
- 2026-11-17: Planner: a closed block keeps its title on one line; in a narrow column (5 or 7 days) the text steps down in whole pixels to 60% of its size, then is cut with an ellipsis. Text that small is hard to read and the pixel font is not designed for sizes off its 8-pixel grid; the 7-day view is the worst case.
- 2026-11-17: Planner habits: dragging a repeated habit to another time now asks "Just this one" or "All of them" (one turn can have a time of its own, `plan.times`); the habits that are not on the calendar yet are a folded group "Habits (N)" (remembered on the device) of one-line habit cards whose text shrinks to fit. Not built: "this and the following ones" for a time change (only one or all), and the other days' lanes show the group only on today (unplanned habits are only listed for today).
- 2026-11-17: Planner board: Daily / Weekly / Monthly buttons next to "Habits" in the bar hide or show habits by how often they repeat (planned ones and the folded group), remembered on the device. They only affect the board, not the habit counts on Home or in the day summary.
- 2026-11-17: Planner: tasks can be placed on the timeline. Dragging a task (from its day's lane, from another block, or from the shortlist) onto an hour grid gives it a time of day on its due date (`Task.scheduledTime`) and it shows as a block as long as its estimated minutes (30 if none); dropped in a top lane it loses the time. Not built: stretching a task block (set Estimated minutes in the task form), a time field in the task form, and a late task is shown only in the lane, not on the grid of its old day unless that day is on the board.
