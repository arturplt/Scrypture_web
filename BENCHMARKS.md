# Terrain / WebGL benchmarks

Phase 0 of `SCRYPTURE_TERRAIN_OPTIMISATION_ROADMAP.md`. Results go in `bench-results/` (JSON, one row per 2 s window); notes go below.

## How to measure

- **Live readout:** add `?perf` before the `#`. It is a panel of folding sections (Frame, GPU, CPU, Ecosystem worst, Streaming, Memory, Hitches; click a header to fold, kept in this browser). Labels are dim blue-grey; values are white, or green / amber / red by how bad they are (thresholds in `WorldMap.tsx`, `tone()` in `perfpanel.ts`), and a folded section still shows its key numbers. `window.__perfTxt` is the same content as plain text. The older line descriptions below still apply to the numbers (e.g. `http://localhost:5173/?perf#/games/paperplane`). New lines (worst-of-window values stay as before):
  - `frame p50/p95/p99/max ms, fps, 1%low` – frame *interval* (includes any fps cap and vsync; do not read a capped 30 fps as slow).
  - `draws / tris (ground …) / passes / up KB/f` – GL calls counted by `src/screens/glprofile.ts` (wraps the context only under `?perf`). `tris` is what is *submitted* in all passes (the far mesh is drawn twice for the depth restore), not visible triangles. `up` = bytes passed to `bufferData/bufferSubData/texImage2D/texSubImage2D`.
  - `gpu X ms avg / max` – asynchronous `EXT_disjoint_timer_query_webgl2` over `G.begin()…G.end()` (polled in later frames, disjoint samples dropped, ≤6 queries in flight). `gpu timer n/a` when the extension is missing (Firefox exposes it only in some builds; Chromium needs `--enable-webgl-draft-extensions` headless). The older `gpu` figure on line 1 is the synchronous `gpuWaitMs()` probe; `?perf=nogpu` removes it.
  - `canvas WxH scale auto` – actual drawing-buffer size and the quality governor's state.
  - `worker lat avg/max ms stale N` – post → result time of chunk builds (queue + build) and results that arrived already stale; `far lat` the last far level.
- **Machine-readable:** `window.__perfLog` (rows per 2 s, last 900) and `window.__perfTxt`.
- **Scripted run:** `node scripts/bench-perf.mjs` (see its header for `BENCH_SECS`, `BENCH_SIZE`, `BENCH_GPU=swiftshader`, `BENCH_FLAGS=<dbg switches>`, `BENCH_OUT`). It starts Vite, drives headless Chromium, starts a fresh random Hills world and cruises. Record browser, GPU renderer string (stored in the JSON), render size, preset, cold/warm.
- A/B switches that already exist: `?dbg=nolayer,nocycle,nofarsink,nostipple,nosea,nopond,nowalls,msaa,nosoftcam` (see `src/domain/dbg.ts`), `?noworker`.

Not yet covered: seeded fixed camera routes (the script uses the sim's own cruise on a random world), CPU/GPU memory totals beyond `texCount`/heap, cache hit/eviction rates, per-pass GPU split (far/near/water/sprites/sky).

## Baseline (Phase 0, 2026-11-27)

`bench-results/baseline-phase0-uhd630-2026-11-27.json` — headless Chromium, ANGLE/Mesa Intel UHD 630, 1280×720 window, 20 s cruise over a fresh Hills world, cold cache, one run (the governor had already dropped `glScale` to 0.5, so the drawing buffer was 640×360). Steady-state windows (after ~12 s):

| Metric | Value |
|---|---|
| GPU time per frame (timer query) | 26–31 ms avg (max 32–52) |
| Draw calls / render passes | ~166 / 7 |
| Submitted triangles per frame | ~1.8 M, of which ground (far + near + water) 99.8 % |
| Upload | ~280–600 KB/frame average, bursts 1.2–1.7 MB |
| Chunk worker latency | 46–180 ms avg |
| Frame interval p50 / p99 | 50–83 / ~200 ms (headless rAF is paced, not representative of GPU-bound fps) |

Reading: on this GPU the frame is GPU-bound, submitted geometry (1.8 M) is ~9× the roadmap's 200 k target, and it is almost all terrain. That supports doing Phase 1 (far grid size, far depth-only shader, upload budget) before anything else. Draw calls (166) are over the 100 target but not the obvious cost. Single run on one machine: repeat before drawing conclusions.

## Phase 1 (2026-11-27): what was measured and changed

Method: `ab.sh`-style interleaving inside one session (variant switched every 8 s on the same world, first 4 s of each segment dropped), since separate runs on random worlds differ by several ms. Same machine (UHD 630, 640x360 drawing buffer). `BENCH_EVAL` / `BENCH_READ` in `scripts/bench-perf.mjs` run the page-side snippets.

| Experiment | GPU ms / frame | Submitted tris | Verdict |
|---|---|---|---|
| Baseline (all far levels, restore pass on) | 24-30 | ~1.85 M | - |
| Skip the whole far ground | 14 | 0.33 M | far ground = ~10-13 ms, 80% of the triangles |
| Skip the six planet faces | 27.6 -> 21.9 | 1.63 M -> 0.97 M | faces = ~5.7 ms |
| Skip the depth-restore pass | 32.1 -> 28.8 | 1.79 M -> 1.34 M | pass = ~3.4 ms (10%) |
| **Horizon-cull planet faces** (`?dbg=nofacecull` = off) | 29.5 -> 27.5 | 1.77 M -> 1.21 M | **-2.0 ms, -32% triangles; kept** |
| Face grid 1 cell per step instead of 2 (`?faceup=1`) | 19.2/20.1 -> 22.2/23.5 | -125 k | no measurable gain (noise); default stays 2 |
| Far upload slice 24000 -> 6144 vertices (844 -> 216 KB) | n/a | n/a | quiet-time upload peaks 1.1-2.4 MB -> ~0.22 MB; peaks while flying over new ground (chunk textures/meshes, up to 1.2-1.5 MB) unchanged; **kept** |

Not done / not supported by data: a dedicated depth-only shader program (the restore pass already exits right after the discards; its cost is probably the vertex work, which a second program does not remove, and it needs every uniform duplicated) - measure vertex vs fragment share first; low shader variant; back-face culling; internal resolution cap (the governor already floors at 0.5); a byte budget for chunk uploads (risk of holes; the 1-per-frame minimum and 3 ms limit are kept).

### Vertex vs fragment split of the far ground (2026-11-27, after face culling)

Interleaved on one world with `RASTERIZER_DISCARD` around the far draws (vertex work only, no fragments), one variant per 8 s, ~9 windows each (noise about ±1 ms):

| Variant | GPU ms |
|---|---|
| Normal | 18.4 |
| Far + restore, vertex only | 16.6 |
| No far ground | 11.9 |
| Restore pass, vertex only | 16.7 |
| No restore pass | 15.0 |

Far ground total 6.5 ms = vertex ~4.7 ms (72%) + fragment/raster ~1.9 ms (28%). The restore pass is 3.4 ms: ~1.7 ms vertex (the planet projection runs again) and ~1.7 ms fragment. So a depth-only fragment program can win at most ~1.7 ms, and only if the restore pass's fragment cost is the early-out shader; the larger lever is vertex work (Phase 4 precomputed sphere directions, fewer far vertices, or not running the far vertices twice).

### Planet faces in tiles (2026-11-27)

The vertex cost of the far ground is mostly the per-vertex planet projection (~1.8 of ~2.9 ms vertex-only in one run; ~1.1 ms is fetch/setup), and no cheap shader change removes it, so the work went into drawing fewer vertices: each face's triangles are regrouped in 5 x 5 tiles (`src/domain/facetiles.ts`), and a tile over the horizon or wholly outside the view is skipped, in both far passes (`?dbg=notilecull` draws faces whole).

Interleaved A/B on one world, tiles on vs whole faces:

| Plane height | GPU ms | Submitted tris |
|---|---|---|
| ~12 tiles (after horizon culling only one face is left) | 23.9 vs 22.9 | 935 k vs 984 k: no measurable gain |
| ~500 tiles | **13.7 vs 17.2 (-3.5 ms, -20%)** | 578 k vs 927 k |

Tests: same triangles as the plain grid; no tile that has an on-screen, un-occluded vertex is ever skipped (100 random eyes/cameras x 6 faces x 25 tiles, with the vertex shader's own ball maths); sphere/frustum maths. Screenshot at 500 tiles: no holes. Not checked visually: cube edges and corners at low altitude, orbit.

### Endless worlds (older Hills saves, real maps): the far rings (2026-11-27)

A user report on an Intel HD Graphics 400 (about 4 fps, readout: 2.1 M submitted triangles, 2.13 M of them ground, no cube planet, `far from 72/80`) is an endless Hills world: all six far rings, each a full square of cells, drawn twice. Reproduce with `BENCH_WORLD=endless node scripts/bench-perf.mjs` (makes a Hills world, strips its planet size from the save, reopens it; same readout shape as the report).

Split on the UHD 630 in that world: far ground ~6.4 of 14 ms (vertex ~4.5, fragment ~1.9), restore pass ~1.7 ms; six far draws of 48-125 k triangles each, twice per frame.

Change: the rings' triangles are regrouped in 8 x 8 tiles (`gridTileBounds`, `ringTileShown`), and a tile wholly inside the level's hole, beyond its reach, or outside the view is skipped (the old code only cropped whole rows). Interleaved A/B vs the old row crop: **submitted triangles 1527 k -> 999 k (-35%), GPU 27.7 -> 23.8 ms (-14%)**. `?dbg=notilecull` restores the old path. Brute-force test: no tile with an in-ring, on-screen vertex is skipped (vertex shader's drop by `curveC`, sink included).

Also: the resolution governor's floor was 0.5 (and the report's machine was at it, still at 4 fps). When the frame time stays above 70 ms it may now go to 0.35, and returns to 0.5 under 45 ms. Not measured on slow hardware: HD 400 numbers are the user's, not reproduced here.
