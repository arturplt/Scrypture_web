# Ecosystem roadmap (Bóbr world map)

What to build next in the world simulation (`src/domain/ecosystem.ts`, saved by `src/domain/worldsave.ts`).
Each phase leaves the game working and tested, so work can stop after any of them. Do them in order: phase 0 measures, and phases 3 and 4 are tuned against it.
Update the status table when a phase moves, and note here any ecosystem feature built outside this list (thunder and fire were, see below).

## Status (2026-11-15)

| Phase | What | Size | Status |
|---|---|---|---|
| 0 | Soak test | Small | Done (2026-11-15): `npm run soak`, baseline below; plus the in-game "Eco stats" window |
| 1 | Bound and fix the saved changes | Small | Not started |
| 2 | Save the living state | Small-medium | Not started |
| 3 | Balance the water cycle | Medium | Done (2026-11-15): lakes hold their place, see results |
| 4 | Vegetation decay and biome multipliers | Medium | About a quarter: fire is the first way vegetation goes back (needs a decision) |
| 5 | Bóbr dams | Large | First version built (2026-11-16): beaver pairs haul sticks and stones and dam narrow water; a finished dam grows a pond. Decay, breaking and kits are not built |

Done before the roadmap: clouds blown far out of the watched area come back in upwind (`CLOUD_MARGIN`), river channels that stop growing are given up (`STALL_TICKS`), lone water tiles get their river line planned once, old tree-growth times are pruned, corner tiles redraw the diagonal chunk, rain lands on the tile under the cloud, grass spread uses a fair shuffle.

Built outside the roadmap: thunder and fire (see BACKLOG.md and BACKLOG_DONE.md, "Thunder and fire"). It adds work to phase 2 (fires, charred and wet ground are not saved) and makes phase 0 more important (fire removes trees, rain adds them: nobody has checked which wins over a long run; `STRIKE_CHANCE`, `SPREAD_RATE` and burn times were set from short simulated runs).

## Phase 0: soak test

Why: there is no measure of what a world looks like after a long session, so balance changes cannot be judged.

- A test helper that steps a seeded world headless for 30-60 simulated minutes and records, once a simulated minute: water, sand, grass, flower, bush/tree tiles (and total tree scale), clouds, river tiles, tiles burning and charred.
- Run it over several seeds and biomes; keep the numbers out of the normal test run if it is slow (a separate script or a skipped-by-default test).
- Done when: it prints a table for 5 seeds and the current drift is written down here as the baseline (expected: water shrinks steadily).

### Phase 0 result: the tools

- `npm run soak` (or `SOAK=<minutes> npm run soak`, default 60): five 64x64 areas, one per biome (grassland, forest, wetland, desert, lake), found by `findBiome` on the seed "soak", stepped at 0.1 s with the game's 60 s day and natural wind. Prints a table every 5 minutes, the drift from first to last minute, and which rule turned land into water. About 60 s for an hour. Code: `src/domain/ecostats.ts` (`census`, `soak`, `soakTable`, `drift`, `findBiome`), report in `src/domain/ecostats.test.ts` (skipped in the normal test run).
- `Ecosystem.tally`: running totals (evaporated, rained on, became water / dried up, grew, bolts, caught fire, burnt out) and `toWaterBy`, the same split by rule.
- In the game: menu > "Eco stats" opens a window with the live census of the simulated area (a bar and a table with change per minute), a 6-minute chart of water / sand / grass / wood, the sky, fire, the totals and the "why land became water" split.

### Phase 0 result: the baseline (60 simulated minutes, deterministic)

| Biome | Water at 0 | at 5 min | at 60 min | Sand | Wood (bushes + trees) |
|---|---|---|---|---|---|
| grassland | 10% | 56% | 99% | 14% -> 0% | 3% -> 0% |
| forest | 31% | 88% | 98% | 28% -> 0% | 3% -> 0% |
| wetland | 34% | 93% | 100% | 37% -> 0% | 1% -> 0% |
| lake | 57% | 100% | 100% | 31% -> 0% | 0% |
| desert | 0% | 0% | 0% | unchanged | unchanged |

Land that became water over the hour, by rule:

| Biome | rain | shore | surrounded | settle | river | walk |
|---|---|---|---|---|---|---|
| grassland | 90 | 5115 | 210 | 8996 | 20 | 2081 |
| forest | 87 | 4966 | 250 | 3476 | 163 | 35 |
| wetland | 119 | 5427 | 262 | 4847 | 38 | 509 |
| lake | 93 | 3384 | 298 | 2005 | 63 | 38 |

What it means:
- **The world floods; it does not dry out** (the roadmap's first guess was wrong). Any area with water becomes all water in 5-30 minutes, then the vegetation, fire and rivers have nothing left to act on. Evaporation (1,100-8,400 tiles an hour) is far behind what turns to water (5,900-16,500).
- **Two rules do almost all of it.** `shore`: rain falling on water turns the nearest sand or grass within 10 tiles into water, up to 3 times per cloud tick, and every raining cloud over a lake does this. `settle`: a land tile between water and the other land type (no tile art for that) is filled with water, and the fill repeats round every filled tile, so each new water tile can pull a strip of shore with it. The 1% rain flood itself is minor (about 90 tiles an hour).
- `walk` matters in grassland: lone water tiles walking to rivers leave sand, which then sits between water and grass and gets filled by `settle`.
- **A world with no water never changes**: no water, no evaporation, no clouds, no rain. The desert is frozen.
- The live game shows the same: in a forest world, "Edge filled" made 55% of the new water and water grew by about 280 tiles a minute.
- Caveat: the soak keeps the area fixed; in the game it moves with the plane, so the player keeps reaching fresh land. The trend is the same, only slower to notice.

## Phase 1: bound and fix the saved changes

Why: `encodeChanges` keeps the first `MAX_CHANGES` (60,000) changed tiles, so in a long-lived world the newest changes, usually the ones round the player, are the ones lost.

- When over the cap, keep the changes nearest the plane and the explored chunks; drop the oldest and farthest first.
- Drop overrides that are cheap to lose (plain grass far from anywhere explored).
- Done when: a test fills the map past the cap and the tiles round the plane survive save and reload.

## Phase 2: save the living state

Why: a reopened world starts with a clear sky, no river lines, no fires; it does not feel continuous.

- Add an optional `eco` field to `SavedWorld`: clouds (position, layer, water, size, raining), river tiles, open channels, weather (kind, time left), burning, charred and wet tiles with their timers.
- Sanitise it like the other fields, with caps; old saves without it load as now.
- Done when: save and reload gives the same cloud count, river lines and fires, and a test round-trips it through `sanitizeWorlds`.

## Phase 3: balance the water cycle

Why: the phase 0 baseline shows the world floods: rain on lakes grows their shores (`shore`) and the no-tile-art rule fills the shore behind it (`settle`), far faster than evaporation takes water away. (The first guess, that it dries out, was wrong.)

Decision taken (2026-11-15): lakes hold their place. Each 32x32 region aims for the water the seed's generator put there; inside a region a lake may still shrink, grow or move a little.

What changed (`src/domain/ecosystem.ts`):
- `settle` (the no-tile-art rule) makes sand, not water: a grass tile between water and sand becomes sand, and so does grass behind a shore sand tile, giving a 2-tile beach like the generator's (whose shores are always sand, never touching grass). An evaporating tile on a grass-only shore dries to grass, so a grass-shored lake does not grow a beach all round.
- Water budget per region (`REGION` 32, `budgetPull`): `target` = generated water, `cur` = water now (counted once, then kept by `put`). The pull is +-1 at a shortage (or surplus) of 3% of the region's tiles (`BUDGET_SPAN`) or a quarter of its own target, whichever is less.
  - Rain adds water only to a region short of it: the 1% (river line 90%) flood chance, shore growth from rain on water (`SHORE_CHANCE` 0.3) and, new, rain on land running off into the nearest lake within 8 tiles (`REFILL_CHANCE` 0.1) are all multiplied by the pull.
  - Evaporation runs at `1 - pull` (down to 5%) in a region short of water and up to 3x in one over its target.
- Rain outside the watched area changes no tiles (the cloud still spends its water): nothing evaporates there, so water used to pile up out of sight while the watched area dried.
- Dry areas get weather: every 20 s, while fewer than 6 clouds are up, a cloud blows in from upwind straight into a rain layer (`importCloud`, counted as `tally.imported`). Clouds born from evaporation start at the top and only sink to a rain layer when the layers below are full, which a few clouds never do.

Results (`npm run soak`, 60 simulated minutes, seeds "soak", "alpha", "beta", "gamma", "delta"; water as a share of the 64x64 area, start -> end):

| Biome | soak | alpha | beta | gamma | delta |
|---|---|---|---|---|---|
| grassland | 10 -> 9% | 13 -> 13% | 13 -> 13% | 3 -> 3% | 7 -> 7% |
| forest | 31 -> 30% | 27 -> 25% | 4 -> 4% (-19%) | 29 -> 28% | 9 -> 6% (-28%) |
| wetland | 34 -> 33% | 22 -> 22% | 26 -> 26% | 32 -> 39% (+21%) | 34 -> 36% |
| desert | 0 -> 0% | 4 -> 3% (-19%) | under 1% -> 0% (-60%) | 8 -> 8% | 6 -> 4% (-26%) |
| lake | 57 -> 55% | 56 -> 55% | 60 -> 59% | 39 -> 37% | 66 -> 66% |

- 24 of 25 areas stay within 70-130% of their starting water (the phase's bar); every area with lakes or wetland within +-21%. The one miss is beta's desert, which starts with a handful of water tiles; losing a few of them is -60%.
- Before phase 3 the same runs ended at 98-100% water everywhere there was any.
- What turns land into water now (soak seed): rain flooding, shore growth, the 3-water-sides rule and rivers each give a sizeable share; the no-tile-art rule adds none.
- Cost: the ecosystem step on a game-sized area (128x112, 60 steps a second, natural wind) averages 0.14-0.25 ms; the worst step in 5 minutes is 4.5-9.2 ms (the lake case), close to before.
- Not done: tuned by soak runs only, not by playing; the in-game "Eco stats" window shows the same numbers live.

## Phase 4: vegetation decay and biome multipliers

Why: apart from fire, the vegetation ladder only climbs, so a long-lived world ends as a forest of full-size trees; and every biome behaves the same.

More urgent since phase 3: with the land no longer drowned, an hour of rain multiplies the flowers 2-38x and bushes/trees 1.5-8x in every biome, and deserts green over under the clouds that now blow in (desert sand 77% -> about 40% in an hour on the soak seed). Use the phase 0 soak to tune decay against this.

- During a heat wave, tiles not rained on for a while step down: flowers to grass, grass to sand; trees shrink before they go.
- Per-biome multipliers for evaporation, flood chance, growth and fire (desert evaporates fast and grows slowly, wetland floods easily and hardly burns).
- Done when: in the soak test deserts stay mostly sand, forests mostly trees, and no biome ends at 100% of one tile type.
- Decision needed: can trees die of drought, or only by fire?

## Phase 5: Bóbr dams

Why: there are rivers and a beaver but no dams; this ties the simulation to the character and gives sticks and stones a use.

- Design pass first: where a dam can go (on a river line), what it costs (sticks, stones), who builds it (Bóbr or the player), what it does upstream (holds water, a pond grows) and downstream (dries), whether it is saved and can break.
- Start only after phase 3, since dams need rivers that last.

Design decisions (2026-11-16), built in `src/domain/beavers.ts`:

- Who builds: wild beaver pairs. Colonies come from the seed (one chance per 48 x 48 cell) and settle only where there is water to dam. The player can hand a stick or stone to a dam they stand by.
- Where: across a straight run of 1 to 6 water tiles with land at both ends and water on both sides; river lines are preferred.
- Cost: 2 sticks and 1 stone per dam tile, taken from the same sticks and stones the player picks up (what a beaver takes is gone for the player).
- What it does: a finished dam adds 40 tiles to its region's water target (`Ecosystem.addWaterTarget`) and a pond grows beside it, one tile every 4 s (`growPond`, cause `dam` in the tally). Nothing dries downstream: the simulation has no flow direction.
- Saved: the dam tiles (`SavedWorld.beavers`). Beavers and burrows come back from the seed.
- Not built yet: dams breaking or decaying, the pond draining, kits and new colonies. Not yet checked: the long soak with beavers in it (the soak run does not create a `BeaversManager`).

## Housekeeping (do while touching each part, not as its own phase)

- Split `ecosystem.ts` (now about 800 lines, one class) into water tracking, clouds/rain, rivers and fire modules as each phase touches them.
