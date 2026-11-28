# Scrypture — Terraced World Generator Roadmap (v2)

> Implementation brief for Claude Code (Sonnet). It merges the first brief with `SCRYPTURE_WORLD_GENERATOR_SONNET_ROADMAP.md` (the "consolidated spec"). **Where they disagree, this file wins.** Section 10 lists each deviation and why. The consolidated spec stays useful as a checklist of later ideas (§13 there, P2).
>
> Work one milestone at a time. Stop at every exit gate and report using the template in §11. Begin with **Milestone 0 only**.

## 1. Goal and fixed decisions

A **world generator** screen for Paperplane:
- shows the whole terraced planet, and lets you orbit and zoom close
- has sliders for the terrain and the climate
- has a raise/lower sculpt brush
- has **Create and fly**, which opens a real game world built from exactly those settings

Decided with the user; do not reopen these without asking:
1. **Real worlds.** The settings and the sculpt change the game's own terrain formula (`src/domain/terrace.ts`) and are saved with the world.
2. **No geometry LOD.** The whole-planet mesh has one resolution, chosen by a **detail** setting. Orbit and zoom never rebuild terrain. A coarse mesh shown *while a slider is dragged* is an interaction preview, not LOD; the selected detail is rebuilt on release.
3. **Sculpt = raise/lower only**, with radius, strength and undo.
4. **A separate small renderer** (`PlanetGL`). Share terrain *maths* with the game, not `WorldGL`, which is built around the flight camera, chunks and LOD rings.
5. **The globe is an approximation and is labelled as one.** At detail 64 a sample is about 52 tiles apart, against 0.5 tile in the game. Exact close-up detail comes from an explicit **Inspect region** view built from the game's own chunk pipeline (Milestone 6). That view is a separate mode, not LOD.

## 2. Rules

- **Before editing**, read `CLAUDE.md` (if present), the `package.json` scripts and `git status`.
  - The tree holds **uncommitted earlier work**: profiling (`src/screens/glprofile.ts`, `perfpanel.ts`), far-terrain culling (`src/domain/facetiles.ts`), `scripts/bench-perf.mjs`, `BENCHMARKS.md` and the roadmap docs.
  - `src/data/cloud.ts` and `src/data/items.ts` were modified by the user.
  - Do not revert, reformat or commit any of this.
- **No commits, pushes, PRs or destructive git commands** unless the user asks.
- Line numbers here date from 2026-11-27. **Find code by symbol and verify it before editing.**
- **Existing worlds must not change**: terrain, lakes, biomes, collision, saves. Every new setting defaults to the identity, and Milestone 0's signature proves it.
- **Commands:**
  - typecheck: `npx tsc -b`
  - tests: `npx vitest run`, about 40 s for the full suite; run single files while iterating
  - there is no lint script
- **UI** uses Press Start 2P at about 0.6× sizes, follows the `.pf` frame rules in `src/ui/ui.css`, and adds every i18n key to en, pl and la.
- **WebGL testing:** the built-in browser pane has **no WebGL**. Use headless Chromium over CDP with the `scripts/bench-perf.mjs` pattern (onboarding, dev server, `BENCH_EVAL`, `BENCH_READ`, `BENCH_SHOT`).
  - The real-GPU flags are `--use-gl=angle --use-angle=gl --enable-webgl-draft-extensions`. **Check the renderer string; do not assume acceleration.**
  - The dev machine has an Intel UHD 630. The user's target is an Intel HD 400, which is far slower and **not available here**. Say which GPU every number came from.
- Never invent measurements. If a measurement can't be taken, say so.

## 3. What already exists (reuse it)

| Need | Existing code |
|---|---|
| Terrain formula | `terrace.ts`: `elevation`, `elevationBroad`, `lowAt`, `detailAt`, `detailCore`, `baseAt`, `baseRaw`, `cubeCont`, `rangeAtCube`/`rangeKind`/`RANGE_KINDS`, `peakOf`/`peakAt`/`PEAK_M`, `HILL_LAYERS`, `LK`, `terraceMoist`, `terraceBiome`, `bareFrom`/`TERRACE_BARE`, `layerOf`, `TERRACE_STEP` |
| Caches tied to terrain | `peakOf` (seed, `GN`), `lakeCaches` (key includes `GN`), `lakeOfCell` memo (`lastGN`), `TerraceField` grid cache, `OUTLETS` WeakMap |
| Chunk meshing (marching triangles with band clipping, same-layer fast path, separate cliffs, lake sheets) | `terraceChunkMesh(e, cx, cy, waterTop?, groundAt?)` |
| Exact local terrain | `new TerraceField(seed).grid(cx, cy)` → `terraceChunkMesh` (headless; see `scripts/bench-terrace.mts`) |
| Planet geometry | `cube.ts`: `CUBE_N = 3360`, `CUBE_SIZES`, `setCubeSize`/`GN` (**one global**), `netToDir`, `dirToNet`, `canonInto`, `cubeRadius`, `FACES`, `capAt`, `faceOverHorizon`, `FACE_CAP` |
| **Patch culling, already tested** | `facetiles.ts`: `tiledIndices`, `tileCaps` (bounding cap per tile), `capOverHorizon`, `sphereInView`, `tileShown`, plus brute-force tests in `facetiles.test.ts` |
| Colours | `ttgTint`/`TTG_STOPS`, `bandTint`; `globemap.ts`'s `globeColor` (layer and biome colours) |
| Saves and world | `SavedWorld`, `newSavedWorld`, sanitizers, `terracePlanetSpawn` (`worldsave.ts`); `World` (`worldgen.ts`, clamps size, calls `setCubeSize`); `actions.createWorld` (`store.ts`) |
| Workers | `ChunkHost` (pure) with the `chunk.worker.ts` adapter; `ChunkClient` / `FarClient` / `ChunkInit`; `chunkmirror.test.ts` (worker equals page) |
| Profiling | `GlProfile` (draws, triangles, uploads, async GPU timer), `summarize` (p50/p95/p99/1% low), `PerfPanel` (folding `?perf` panel) |
| UI | Hash router `src/router.ts`; routes and the `playing` list in `App.tsx`; `Worlds.tsx`; `PixelSlider`, `NudgeRange`, `PixelButton`, `PixelFrame`, `PixelCheckbox`, `Icon`; `seedFrom` |

**Watch out:** `createWorld(name, seed, 'terraced', 'lakes')` is **correct** for a seeded Hills planet. In `newSavedWorld`, `map === 'lakes'` means "no real map", and that branch is what sets `size: CUBE_N`. Do not "fix" it to another map ID.

## 4. Budgets

Base triangles = 12·N² for N cells per face side. Terracing adds walls and cuts; **measure the real counts**.

| Detail N | Base triangles | Sample spacing at 3360 tiles/face | Use |
|---:|---:|---:|---|
| 16 | 3k | 210 tiles | Drag preview (low) |
| 32 | 12k | 105 | Drag preview |
| **64** | **49k** | **52** | **Default** (sized for the HD 400) |
| 128 | 197k | 26 | High |
| 256 | 786k | 13 | Opt-in, guarded |

- **Limits.** Low preset: 100k emitted triangles. Balanced: 200k. GPU memory for the generator: 64–128 MiB, counting the old mesh still resident during a swap.
- **When a build would exceed its budget,** keep the last complete mesh and show a warning. Never truncate a mesh or leave a hole. Never silently lower the user's chosen detail.
- **Terrace visibility.** One game layer is 0.45 tile on a 2139-tile radius, so single layers are invisible at planet scale. The preview needs both:
  - **band spacing** of k layers per preview terrace (view-only, defaulted by detail)
  - **height exaggeration** (view-only, applied in the shader)

  Both are labelled view-only. Neither changes the saved world.

## 5. Architecture

```
WorldGen.tsx (React, pixel UI; never re-renders at frame rate)
  ├─ GenParams (saved, authoritative) · view settings (band k, exaggeration, detail, overlay)
  ├─ PlanetClient → planet.worker.ts → PlanetHost (pure, testable)
  │     samples: direction table (per detail) → heights (per seed/size/params/sculpt rev) → moisture
  │     mesh: marching triangles per face patch → packed buffers (transferred)
  └─ PlanetGL (WebGL2): patches, culling via facetiles, orbit camera, picking, sea, render on demand
Inspect region (M6): TerraceField.grid + terraceChunkMesh around a picked point, same params
Save → World / TerraceField / chunk + far workers (same params, same sculpt)
```

**Invalidation.** Each change re-runs only what it has to:

| Change | Work |
|---|---|
| Camera, sun, brush ring | Redraw only |
| Exaggeration, overlay | Uniform only |
| Band spacing k | Rebuild mesh from cached samples |
| Moisture, cold | Recolour from cached samples; nothing else depends on them in the preview |
| Seed, size, sea, continents, mountains, peaks, hills | Resample heights, then rebuild |
| Detail | New direction table, resample, rebuild |
| Sculpt stroke | Resample affected patches and their neighbours, rebuild them |

## 6. Milestone 0 — Baseline and audit (no terrain edits)

- [ ] Inventory the code against §3 and report any discrepancy.
- [ ] Add `src/domain/genparams.test.ts` with `terrainSignature()`, on **unchanged** code:
  - Inputs: seeds 1, 7 and 42, on both the plane (`setCubeSize(0)`) and `CUBE_N`. About 240 spread points of `elevation`, `elevationBroad`, `terraceMoist` and `terraceBiome(layerOf(e), m)`.
  - Include points chosen to hit ocean, a range, a lake, a cube edge and a corner cap (find them with a scan; then hard-code them).
  - Add `TerraceField(seed).grid()` and `terraceChunkMesh` arrays and counts for 4 chunks.
  - Hash **two ways**: FNV-1a over values rounded to 1e-6 (portable), *and* FNV-1a over the raw Float64/Float32 bytes (exact within this runtime).
  - Restore the cube size in `finally`.
  - Paste both hashes as the expected values.
- [ ] Record a current generator-free baseline only if useful. The generator can't be benchmarked until its renderer exists.

**Exit gate:** both hashes are captured on untouched code; `tsc -b` and the full `vitest run` are green; findings are reported.

## 7. Milestone 1 — Generation settings (`GenParams`)

**`src/domain/genparams.ts`** defines a versioned schema with `DEFAULT_GEN`, `sanitizeGen` (finite numbers, clamped, unknown fields dropped, size-limited sparse sculpt) and `paramsKey(p)`, a short stable string used in cache keys.

| Param | Default | Meaning (verify each sign with a test) |
|---|---:|---|
| `sea` | 0 | Positive raises the sea, so there is less land. Subtract it from the continent offset: `cubeCont`'s `-0.04` and the plane formula's `+0.08`. |
| `continents` | 1 | Multiplier on the continent noise frequencies (higher means smaller and more numerous). |
| `mountains` | 1 | Range belt half-width `hw` and the `along` threshold. |
| `peaks` | 1 | Multiplier on `rangeKind` heights and on `PEAK_M`. |
| `hills` | 1 | Multiplier on `HILL_LAYERS` and the roll terms. |
| `moisture` | 0 | Bias added to moisture once, inside `terraceBiome`. |
| `cold` | 0 | Lowers `bareFrom()` by that many layers. |
| `sculpt` | absent | Sparse macro grid (Milestone 5). |

- **Pass the params as an explicit context where possible; keep any module global narrow.**
  - If a module global is used (like `GN`), every entry point that switches it saves and restores it in `finally`, and **never yields while foreign params are active**. Generators must restore before each `yield`.
  - Being in a separate worker does not make overlapping jobs in that worker safe.
- **Do not reorder floating-point expressions on the legacy path.** Multiply by an exact 1 or add an exact 0 at the same place in the expression. The raw-byte hash will catch any drift.
- Every cache key from §3 gains `paramsKey`.
- Real-map worlds (`REAL`) ignore params.
- **Plumbing:**
  - `SavedWorld.gen?`, `newSavedWorld(…, gen?)`, `actions.createWorld(…, gen?, size?)`
  - the `World` constructor sets the params next to `setCubeSize`
  - `ChunkInit` / the `'init'` message carry `gen`; the `'far'` job carries `gen` and restores it in `finally`
  - cloud sync carries the new field (check `src/data/cloud.ts` for a whitelist, without disturbing the user's edits there)
- **Spawn:** `terracePlanetSpawn` must find land for every allowed `sea` value. If no land is found, the generator disables Create and says why.

**Tests:**
- Both hashes unchanged with default params.
- Each param moves its statistic the right way on fixed samples: land share, maximum layer, forest/wetland share, bare share.
- Determinism, and **no cross-talk**: alternate two worlds with different params through the caches and compare with fresh runs.
- Worker equals page with non-default params (extend `chunkmirror.test.ts`).
- Save round-trip and sanitizer rejection cases.
- Spawn on land across the `sea` range.

**Exit gate:** the default terrain is bit-identical, all of the above pass, and no UI has been touched.

## 8. Milestone 2 — Planet mesh engine (`src/domain/planetmesh.ts`, pure)

- **Grid.** Six faces, each split into **4×4 fixed patches** (benchmark 2×2 against 4×4 later). The same detail N applies everywhere.
  - Samples sit on each face's net grid. **Seam rows and columns, and the three-face corners, use canonical samples computed once**, so neighbouring patches and faces agree exactly.
- **Heights.** `elevationBroad` for N ≤ 64 and full `elevation` above that; the mode is labelled in the UI.
  - The preview samples `elevation` directly, not `TerraceField.grid`, which adds morphological smoothing, relief and water fills.
  - The preview is compared against `elevation`. Exact game comparison belongs to the inspector (M6).
- **Terracing.** Port the per-triangle logic of `terraceChunkMesh` into a generic grid builder. Leave the game function untouched so the signature holds.
  - Work in face (u, v, height) space: compute crossings in (u, v) and map each vertex to the ball with `netToDir`.
  - Floors are flat at the band radius. **Emit only exposed shelves; never stack hidden floors.** Cliffs are radial quads emitted once per band boundary.
  - Uniform bands use integer `floor`. There is a same-band fast path, and the band loop is bounded by each triangle's min and max height.
- **Vertex reuse.** Crossing vertices are keyed numerically by canonical source edge plus band (no string keys, no position rounding). Cliffs get separate vertices for hard normals.
- **Vertex format.**
  - Floor normals are radial and cliff normals are horizontal tangents, and neither changes under radial scaling. So exaggeration can be applied **in the shader**, exactly, with no normal fix and no rebuild.
  - Each vertex carries `dir` (Float32×3) and `height` in layers (Float32), so the shader computes `R + height·STEP·exaggeration`. Add a normal (Int8×4 normalized) and a colour (Uint8×4) for **24 B per vertex**. Measure the actual stride.
- **Indices.** Per patch, Uint16 when the patch has at most 65,535 vertices (it will at N ≤ 256 with 4×4 patches); otherwise Uint32.
- **Output.** Per patch, return the buffers, counts, a bounding cap and min/max height. Pack in the worker and transfer, so the main thread does no repacking.
- **Allocation.** Reusable scratch buffers and growable typed arrays; no per-triangle objects or closures. Make it a generator that yields between rows, for cancellation.

**Tests:**
- finite values, in-range indices, no degenerate triangles, consistent winding
- every floor vertex exactly on its band radius
- **seam and triple-corner vertices identical between patches and faces**
- triangles cut by several bands, thresholds exactly at vertices, flat and steep synthetic fields, sea shore, no hidden floors
- deterministic bytes
- measured counts and build times at N = 16, 32, 64 and 128 (256 only if within budget)

Simplification (merging coplanar shelf interiors under locked contour, seam and coast edges) is **P1 after benchmarks**, kept behind a switch with the unsimplified path retained.

**Exit gate:** the pure tests pass, real counts and times are reported, and the default detail is confirmed (64 unless the measurements argue otherwise).

## 9. Milestones 3–7

### M3 — PlanetGL and the preview worker
- **`src/screens/planetgl.ts`:**
  - one terrain program (ambient + Lambert, optional rim, brush ring from uniforms)
  - an **opaque sea sphere** by default
  - a star background
  - no HDR, bloom or post-processing
- **Culling.** Per patch, with `facetiles.ts` (`capOverHorizon`, `sphereInView`, `tileShown` maths). The bounds must include the maximum height times the exaggeration. Back-face culling only after the winding test.
- **Render on demand.** rAF runs only while the camera moves, a buffer uploads or the brush is active. Pause when the page is hidden. Handle resize, context loss and full disposal (buffers, listeners, worker).
- **Camera.** Quaternion orbit; logarithmic wheel and pinch zoom from about 3R out to a few tiles above the ground. Near and far planes scale with altitude, and the camera is clamped above the exaggerated terrain.
- **Picking.** A CPU ray against the patch caps, then refined against that patch's triangles. Never read back from the GPU.
- **`PlanetHost` / `planet.worker.ts` / `PlanetClient`.**
  - Requests carry `{id, seed, size, gen, viewBand, detail, sculptRev}`, coalesced to the latest.
  - While dragging, build N = 16–32. After about 150 ms of quiet, build the selected N.
  - **Yield to the worker's event loop between batches** (`setTimeout`/`MessageChannel`): calling `.next()` alone never lets cancel messages in.
  - Tag results and drop stale ones before upload. Keep the last complete mesh until the next one is fully uploaded, then swap all at once.
- **`?perf`.** `GlProfile`, `summarize` and `PerfPanel`, showing submitted and resident triangles, culled patches, build, transfer and upload times, and frame percentiles.

**Exit gate:**
- screenshots of the whole globe and a close-up with no cracks
- a cancellation storm (fast slider scrubbing) leaves no stale meshes
- no rebuilds on camera moves, and idle frames stop
- resources are freed when leaving the screen
- frame times at N = 32, 64 and 128 on the UHD 630, labelled as such

### M4 — Generator screen and controls
- **Route and entry:** `src/screens/WorldGen.tsx` at `/games/paperplane/generate`; add it to the `App.tsx` routes and the `playing` list, and add a "World generator" button in `Worlds.tsx`.
- **Panel:** a folding `PixelFrame` panel with `PixelSlider`s:
  - **Planet:** seed (text + dice via `seedFrom`), sea, continents
  - **Terrain:** mountains, peaks, hills
  - **Climate:** moisture, cold
  - **View:** detail, band spacing, exaggeration (all labelled view-only)
  - Planet size is shown but disabled until M7.
- **Buttons:** Reset, Randomize, Back, **Create and fly**.
- **Status:** show build progress and budget warnings. Creating does not wait for the preview: it saves the authoritative params.
- **Rendering and input:** React updates only on control changes, never per frame. Sliders must not capture canvas gestures.
- **Slider ranges:** chosen by testing the endpoints (meaningful change, spawn still valid), not taken from illustrative percentages.
- **Later, not now:** presets and JSON import/export (as validated `GenParams` bundles); the height-distribution curve (consolidated spec §9.2), only after formula and hydrology tests and only as a saved game setting.

**Exit gate:** live preview responds to every control; Create and fly opens a world whose spawn area matches the preview; the i18n tests, typecheck and full tests are green; drag latency and final build time are measured.

### M5 — Macro sculpt
- **Grid:** 65×65 points per face, Int16 quarter-layers, saved sparse, clamped to ±120 layers.
  - **Seam and corner points are canonical**: one value per shared direction, so there is no double application.
  - Bilinear interpolation is then continuous across faces.
- **Brush:** radius in degrees (with tiles shown as well), strength in layers, smooth angular falloff. Dabs are spaced by angular travel, not by frame. Undo the last stroke with a bounded history.
- **Where it applies:** `elevation()` and `elevationBroad()` add the macro value **once**, before lakes and terracing and on top of the base formula. It therefore reaches chunks, far meshes, globe map, minimap, collision and the workers.
  - An empty sculpt is an exact identity, so the hashes hold.
  - Lake placement reads the sculpted ground. Test that lakes and outlets stay valid, and that no stale lake cache survives a `sculptRev` change.
- **Preview:** coarse patch rebuilds while the brush drags; the affected patches plus their neighbours are rebuilt at the selected N on release.

**Exit gate:**
- continuity across cube edges and corners
- undo and clamping work
- save round-trip
- the worker matches the page
- preview equals game `elevation` at grid points
- default hashes unchanged
- stroke response is measured

### M6 — Inspect region and overlays (P1)
- **Inspect region:** opens a local view of about 8×8 chunks around a picked point. It uses `TerraceField.grid` and `terraceChunkMesh` with the same params and sculpt, drawn by PlanetGL in a local frame, with a clear "back to globe" action.
  - This is the exact-detail path. It must match the game.
- **Overlays:** elevation, biome and moisture (uniform or colour buffer; geometry is reused), each with a legend.
- **Statistics:** land share and biome shares, weighted by **spherical cell area**, labelled "sampled at N".

### M7 — Planet sizes
- **Sizes:** `CUBE_SIZES` becomes 2240 / 3360 / 4480 (divisible by 32; the default stays 3360).
- **Check everything that depends on size:**
  - `FACE_STEP = round(size/105)`, `CUBE_RINGS`, the face tiling in `worldgl.ts`
  - `EXT_MARGIN`, the corner caps, `peakK`, the home radius in `cubeCont`
  - `setPlanetRadius`/orbit and the sky ladder (`skyway.ts`)
  - save sanitizing
- **Fly each size headless:** spawn, a face crossing, orbit and descent. Report game and generator performance separately.

## 10. Deviations from the consolidated spec (and why)

1. **Default detail is 64, not 128** (agrees with the spec). It is sized for the HD 400; 128 and above are options.
2. **Culling reuses `facetiles.ts`.** The spec asks for new conservative culling, but that maths already exists and is brute-force tested against the game shader. Adapt it rather than rewrite it.
3. **Exaggeration in the shader is exact here**, because floors are radial and cliffs tangent, so no normal fix is needed. The spec treats this as an open adjustment.
4. **The mesh builder ports `terraceChunkMesh`'s logic into a new generic builder** instead of refactoring the game function. The game path stays byte-identical, and the new code can be tested against the old on a chunk-shaped input.
5. **Preview heights come from `elevation`/`elevationBroad`, not `TerraceField.grid`.** Matching the grid's smoothing exactly is the inspector's job (M6). The spec mixes the two.
6. **`'lakes'` in `createWorld` is correct**: it means "no real map" (§3). The spec flags it as a possible bug.
7. **The consolidated spec's game capture** (19 fps, 53 ms median, 1.4M triangles) is a different session from the later ones the user posted. Those showed the game **CPU-bound** on that machine, with a 48 ms ecosystem step and 130–320 ms stalls. That issue belongs to the flight renderer and the ecosystem, not the generator. The generator screen must not start the ecosystem or the flight loop.
8. **Deferred to P2 (consolidated spec §9.1 "later" rows and §13):** presets, import/export, the height curve, custom terrace spacing, advanced noise controls, hydrology and ecosystem sliders, simplification. None of them ship as inert sliders.

## 11. Report template (every milestone)

```markdown
## Milestone report
- Scope and files changed:
- Existing code reused:
- Deviations from this roadmap (and why):
- Tests and commands run (actual results):
- Hardware / browser / renderer string / seed / detail / internal resolution:
- Measurements (frame p50/p95/p99, triangles, draws, memory, build/upload times):
- Visual checks (screenshots taken and what was checked):
- Not done / risks / unverified:
- Proposed next milestone:
```

Stop after each milestone. If an exit gate fails, report the failure plainly and do not route around the test.
