# Scrypture — Terrain and WebGL Optimisation Roadmap

> Implementation brief for Claude Code. Treat this as a phased engineering plan, not an instruction to rewrite the engine in one pass.

## 1. Mission

Optimise the existing Godus-like terraced planetoid for browser play on integrated graphics (Intel UHD 620-class as an initial reference). Prioritise smooth frame pacing, low memory pressure, and terrain streaming without sacrificing the visual identity, accurate flight physics, terrain editing, water, or the living ecosystem.

**Keep the current cube-sphere, custom WebGL 2 renderer, TypeScript, Marching Triangles, deterministic terrain field, and Web Workers.** Do not migrate to Three.js, an icosphere, WebGPU, or WebAssembly unless a later measured bottleneck justifies it.

### Claude Code execution rules

- Inspect the actual repository, its `CLAUDE.md`, package scripts, existing tests and working-tree changes before editing. The uploaded snapshot is a reference, not necessarily the latest revision.
- Locate the files by name/symbol; do not assume paths. Verify all hypotheses and constants against the current source.
- Work on one milestone at a time, in small reviewable changes. Start with Phase 0. Do not automatically proceed through the entire roadmap or make unrelated refactors.
- Preserve existing APIs and save formats where practical; do not change unrelated gameplay or overwrite existing user changes.
- Retain current behaviour as the reference path when introducing experimental rendering changes. Use existing debug flags or narrowly scoped feature switches for A/B tests.
- Run the repository's existing typecheck, lint, test and build commands as appropriate. Add focused regression tests before changing geometry, worker protocols or water behaviour.
- Record baseline and after-change results, test commands, failures, remaining risks and affected files. Do not claim FPS improvements without measurement. If a browser or integrated-GPU machine is unavailable, state that explicitly and leave the benchmark procedure runnable.
- Stop at the end of each milestone with a concise implementation report and proposed next milestone.

## 2. Source map and current state

| File | Existing responsibility | Optimisation focus |
|---|---|---|
| `terrace.ts` | Elevation field, near terrace geometry, water sheets, far mesh generator and LOD constants | Allocation reduction, shared intersections, index widths, water and far geometry |
| `worldgl.ts` | Custom WebGL 2 renderer, cube projection, shaders, terrain/water passes, buffers, textures, sprites | GPU profiling, shader variants, overdraw, packing, uploads, resource budgets |
| `WorldMap.tsx` | Game loop, chunk demand, far LOD orchestration, camera, simulation, graphics settings | Streaming, visibility, quality governor, frame pacing |
| `chunkHost.ts` | Worker-side job queue, world replica, chunk and far mesh generation | Priorities, cancellation, versioning, transfer format |
| `chunk.worker.ts` | Thin worker entry point | Keep thin; adjust protocol wiring only if needed |

Related modules to inspect in the repository: `chunkClient.ts`, `chunkbuild.ts`, `cube.ts`, `worldgen.ts`, `dbg.ts`, terrain real-map modules, save and ecosystem modules. These were not part of the five-file audit in full.

### Verified snapshot observations

- `CHUNK = 16`, `TERRACE_SUB = 2`, `TERRACE_STEP = 0.45`. A near chunk starts with 33×33 grid vertices and 2,048 source triangles, before contour cuts and water.
- `terraceChunkMesh()` has a same-layer fast path, shared base grid vertices, separate cliff geometry, clipping and stacked inland water sheets. It already bounds the contour loop by triangle elevation extrema.
- Terrain is sampled on a cube-sphere using 3D noise; preserve face canonicalisation, the current source triangle diagonal and the collision interpolation rules.
- `terraceFarMesh()` is a generator with yield points. `ChunkHost.pump()` currently drains a far job to completion; it uses a FIFO queue.
- `WorldGL.ground()` draws a far underlay, clears depth, draws near terrain with stencil coverage, draws water, then restores far depth outside near coverage. This is a deliberate correctness mechanism, not dead work.
- The general shaders include cube projection, LOD stippling, fog/scattering and water/effect branches. `gpuWaitMs()` uses synchronous `readPixels()` as an opt-in diagnostic.
- `prepTerrain()` packs data for rendering on the main thread; `FLOATS = 9` implies a 36-byte vertex stride in the shared layout. Far uploads are sliced at 24,000 vertices in the audited snapshot.
- `WorldMap.tsx` already has frame timing, debug flags, worker clients, upload limits, adaptive resolution/density/draw distance, `NEAR_ALL`, and `MAX_REAL`.
- The existing renderer pools textures and shares far index buffers. Do not duplicate those systems.

### Geometry baseline (configuration, not measured GPU work)

For `TERRACE_FAR_LODS_HILLS` with `up = 1`, full-grid triangles = `2 * floor(2 * half / step)^2`.

| Step | Half extent (tiles) | Full-grid triangles |
|---:|---:|---:|
| 2 | 220 | 96,800 |
| 5 | 1,000 | 320,000 |
| 12 | 2,400 | 320,000 |
| 32 | 4,000 | 125,000 |
| 128 | 12,000 | 69,938 |
| 400 | 40,000 | 80,000 |
| **Total** | | **1,011,738** |

This is the theoretical sum of the six seeded-hills full grids, not the simultaneous visible or submitted triangle count for the cube planet. `WorldMap.tsx` selects only the rings that fit its chart margin and uses altitude-dependent selection plus planetary face meshes. Instrument actual active geometry before choosing a reduction target.

## 3. Priorities and implementation sequence

| Milestone | Priority | Scope | Risk |
|---|---|---|---|
| 0 | P0 | Profiling and reproducible baseline | Low |
| 1 | P0 | GPU quick wins: far depth shader, grid size, low shader variant, upload cap | Low–medium |
| 2 | P1 | Near mesh generation and vertex reuse | Medium |
| 3 | P0/P1 | Water geometry and transparency | Medium |
| 4 | P1 | Packed buffers, worker packing, resource budgets | Medium |
| 5 | P1 | Worker scheduling and streaming | Medium |
| 6 | P1 | Structural far LOD/clipmaps and visibility | High |
| 7 | P2 | Textures, sprite instances and ecosystem scheduling | Medium–high |
| 8 | P1 | Adaptive quality and integrated-GPU validation | Medium |

P0 = investigate first; P1 = high-value follow-up; P2 = only after profiling supports it. Reorder implementation if Phase 0 identifies a different bottleneck. Do not start the high-risk clipmap rewrite before simpler A/B experiments.

## Progress log (updated 2026-11-27)

Measured on one machine (Intel UHD 630, headless Chromium); results, method and caveats are in `BENCHMARKS.md`, raw rows in `bench-results/`, the benchmark run is `scripts/bench-perf.mjs`. Nothing below is committed yet.

| Phase | Status | What happened |
|---|---|---|
| 0 | **Done (partial)** | `?perf` extended (not replaced): frame p50/p95/p99/1% low, draws/triangles/passes/upload bytes, async GPU timer, worker latency, eco sub-step timing, `window.__perfLog` rows. Readout is now a folding, colour-coded DOM panel (`src/screens/perfpanel.ts`). Not done: fixed-seed camera routes, memory totals, cache hit/eviction rates, a per-pass GPU split (far/near/water/sprite/sky). |
| 1 | **Partly done** | Horizon culling of planet faces (−2 ms, −32% tris); far upload slice 844 → 216 KB; far-depth shader, grid size, low shader variant, back-face culling not done (see below). |
| 6 (early part) | **Started, pulled forward** | Tiled far geometry with per-tile culling: planet faces (−3.5 ms / −20% at 500 tiles up) and endless-world rings (−35% tris, −14% GPU). This is conservative visibility culling, not the clipmap rewrite. |
| 8 (early part) | **Started** | Governor floor lowered from 50% to 35% render scale on very slow GPUs (`WorldMap.tsx`). Not measured on slow hardware. |

**Findings that change the plan**
- The frame is **GPU-bound on the planet** and **CPU-bound on some saved worlds**: a user readout from an Intel HD Graphics 400 (about 4 fps) showed a 48 ms/frame ecosystem step with 130–320 ms spikes, plus 20 ms of decoration work. GPU was not the limit there. Diagnosing that world needs the `eco worst ms` line; Phase 7's "separate rendering cadence from simulation" is the likely fix and should be pulled forward once the slow part is named.
- Far ground is ~45% of GPU time and ~70% of that is **vertex** work (the per-vertex planet projection), ~30% fragment. A dedicated depth-only fragment shader can save at most ~1.7 ms (restore pass fragment half), so it was **not built**. Cutting vertices drawn (culling, tiling) paid; shader micro-changes will not.
- Smaller face grids (`?faceup=1`, 4× fewer face triangles) gave no measurable GPU gain: dropped as an experiment (the switch stays for A/B).
- **Two world types render differently.** Cube planet (new Hills worlds): 2 rings + 6 faces. Endless worlds (older Hills saves, real maps): all six full-square rings, drawn twice. Benchmark both (`BENCH_WORLD=endless`); the roadmap's 1.01 M figure is the endless case.
- The rest of the frame (near chunks, water, sprites, post) is ~half the GPU time at low altitude and is **still unmeasured**: the next measurement before choosing between Phases 2, 3 and 7.

## Phase 0 — Establish a performance baseline

**Files:** `WorldMap.tsx`, `worldgl.ts`, `chunkHost.ts`, existing test/benchmark infrastructure.

- [x] Extend existing `?perf` / debug instrumentation; avoid creating a parallel profiler unnecessarily.
- [x] Record frame time median, p95, p99, FPS and 1% lows, not just average FPS.
- [x] Separate game logic, chunk demand, worker generation, upload CPU time, draw submission and GPU time. *(existing per-phase marks kept; eco sub-steps added)*
- [x] Implement asynchronous GPU timing with `EXT_disjoint_timer_query_webgl2` when available. Poll in later frames, discard disjoint samples, bound outstanding queries and delete them on cleanup. Keep unsupported timing as unavailable; do not substitute synchronous readback during normal gameplay.
- [x] Keep `gpuWaitMs()` only as an explicit diagnostic; avoid `readPixels`, `finish`, and blocking GPU queries in production hot paths.
- [~] Count draw calls, submitted triangles, render passes, allocated CPU/GPU bytes (estimated from formats), uploads in bytes/frame, worker queue latency, stale results and cache hit/eviction rates. *(done except allocated bytes and cache hit/eviction rates)*
- [~] Track near/far/planet-face/water/sprite/sky costs individually. *(far, faces and restore pass measured by A/B; near, water, sprites, sky not yet)*  Track actual internal framebuffer dimensions and graphics preset.
- [~] Create reproducible benchmark routes *(`scripts/bench-perf.mjs`: scripted headless run, interleaved A/B hooks; the world is still random, no fixed camera route)* using a fixed seed, camera path, graphics settings and simulation time where possible.

### Benchmark scenarios

1. Stationary woodland and a lake/dam scene.
2. Walking and terrain sculpting across terraces.
3. Low-altitude flight through steep hills.
4. Fast camera rotation and flight across cube-face boundaries, including corners.
5. Climb to orbit and rapid descent into near terrain.
6. High-speed streaming with cold and warm caches.
7. 30-minute exploration for cache stability and memory leaks.
8. Real-map and flat-world modes if affected by changes.

Record browser, OS, CPU/GPU, render size, preset, seed, cold/warm status and route duration. Compare identical scenarios and use multiple runs. Store results in a tracked benchmark note or machine-readable file consistent with repository conventions.

**Exit gate:** baseline captured (or explicitly blocked), all counters make sense, profiling itself does not materially distort ordinary gameplay, and the next bottleneck is identified. *(Met for the far ground; the near-terrain split is still open.)*

## Phase 1 — GPU quick wins

**Files:** `worldgl.ts`, `terrace.ts`, `WorldMap.tsx`.

- [x] A/B test smaller far grids. *(`?faceup=1`, face grid 4× smaller: no measurable gain; ring grids not tried: the ring cost was cut by tiling instead.)* Start with 65×65 and 129×129 candidates while holding world coverage constant by adjusting sample spacing; retain near terrace accuracy. A six-level full 129-grid configuration would have 196,608 base triangles before cutouts, extra faces and passes. This is a comparison, not a proposed guaranteed FPS gain.
- [ ] ~~Add a dedicated far-depth-only shader~~ *(not built: restore-pass fragment cost is ≤ ~1.7 ms and the vertex half cannot be removed by a second program; revisit only after vertex work is cut further)*. Original: Add a dedicated far-depth-only shader for the stencil restoration pass, preserving position, coverage/discard semantics, LOD transitions and depth precision. Avoid unnecessary texture reads, lighting and scattering in this pass.
- [ ] Add a lightweight terrain shader variant with simple fog, inexpensive palette shading and no optional expensive effects. Keep full-quality rendering available. Compile at setup or controlled quality changes, not per frame.
- [ ] A/B test back-face culling after checking triangle winding, cube projection and camera morphing. Do not enable globally for billboards, water curtains or double-sided surfaces.
- [~] Cap internal render dimensions for integrated-GPU presets; *(the governor floor now goes to 35% when frames stay above 70 ms; no resolution cap preset yet)*  preserve crisp nearest-neighbour scaling and existing texture mipmap behaviour.
- [~] Introduce a byte/time upload budget *(far slice 24,000 → 6,144 vertices = 216 KB: quiet-time peaks 1.1–2.4 MB → 0.22 MB; chunk-upload peaks of 1.2–1.5 MB while flying over new ground unchanged, kept time-bounded to avoid holes)* and test smaller far upload slices. At 36 bytes/vertex, 24,000 vertices is about 844 KiB per slice. Start with 128–256 KiB far slices, 256–512 KiB/frame steady-state total, 2–4 MiB during loading, and a 1–2 ms CPU upload target. Permit measured exceptions for critical chunks; avoid starvation.
- [ ] Preserve the coarse fallback while a near chunk has not reached the GPU. Do not remove the depth/stencil fix until replacement coverage and occlusion are proven.

- [x] *(added)* Cull planet faces wholly over the horizon (`faceOverHorizon`, `?dbg=nofacecull`): −2.0 ms, −32% submitted triangles interleaved; brute-force tested conservative.

**Exit gate:** lower measured GPU cost or frame spikes in repeatable scenarios, no flicker, holes, incorrect sprite occlusion or shader regressions. Revert experiments that do not help. *(Met for the items done; low-shader variant and back-face culling still open and unmeasured.)*

## Phase 2 — Optimise Marching Triangles

**File:** `terrace.ts`, relevant geometry tests.

### 2.1 Preserve existing fast paths and correctness

- [ ] Retain same-layer grid vertex reuse and threshold bounds (`tMin`, `tMax`). Do not scan every possible elevation layer for every triangle.
- [ ] Preserve the source diagonal used by height interpolation, sea-depth clamping, exact-threshold classification and degenerate polygon checks.
- [ ] Test flat triangles, one/two vertices above a threshold, multiple crossed thresholds, exactly-on-threshold vertices, sea, steep terrain and shared chunk/cube-face edges.

### 2.2 Reuse contour intersections and output vertices

- [ ] Compute a contour crossing once per canonical source edge and threshold. Key by stable endpoint IDs in canonical order plus threshold; avoid string-key allocation if profiling supports a packed numeric key or direct table.
- [ ] Reuse the same crossing coordinates for shelf clipping and wall construction. Ensure deterministic interpolation order at chunk boundaries.
- [ ] Deduplicate final vertices only when all required render attributes match: position, shelf elevation, normals, submerged classification and material/UV data. Preserve hard normals at cliff edges; do not weld incompatible wall segments.
- [ ] Avoid global contour stitching or global polygon triangulation; retain local per-triangle generation for dirty-chunk rebuilds.
- [ ] Compare output geometry spatially and visually against the reference rather than relying solely on identical index order. Measure vertex/index counts and build time by terrain type.

### 2.3 Remove hot-path allocations

- [ ] Replace temporary arrays in `cut()`, `clip()`, `sheetTop()`, `sheets()` and the triangle loop where profiling confirms pressure. Use reusable scratch buffers and explicit counts, with bounded capacity and assertions.
- [ ] Precompute grid coordinate/index topology where beneficial. Avoid object/array creation per triangle or intersection.
- [ ] Reuse growable typed-array builders; return only active ranges and account for capacity in memory metrics.
- [ ] Use 16-bit indices when maximum referenced index is <= 65,535, with 32-bit fallback. Update mesh type, transfer path, renderer draw type and tests together. A 16-bit index buffer uses 6 bytes/triangle instead of 12.

### 2.4 Optional flat-area merging

- [ ] Prototype merging large same-layer coplanar regions only after deduplication. Retain sufficient subdivision for cube-sphere curvature, UVs and seams; do not merge across incompatible water/material attributes.
- [ ] Keep collision data authoritative and independent of simplification. Drop this experiment if complexity or visible errors outweigh gains.

**Exit gate:** reduced mesh allocation and/or vertex count with equivalent geometry, stable seams, unchanged height/collision semantics, and measured build-time results. No NaNs, out-of-range indices or degenerate wall regressions.

## Phase 3 — Water geometry

**Files:** `terrace.ts`, `worldgl.ts`.

The snapshot generates up to multiple inland sheets for depth tint plus waterfall curtains; ocean already has a single-sheet fast path in some cases. Verify `WATER_SHEETS_MAX` and effective alpha in the current revision.

- [ ] Instrument water triangles, draw calls, fragment cost and `waterTop`/ground callbacks in dry, ocean, lake, river and beaver-pond chunks.
- [ ] Prototype a single visible water surface per local surface elevation. Encode depth using existing bed classification or an explicit attribute. Preserve the visual difference between shallow/deep water and beaver ponds.
- [ ] Retain exposed waterfall curtains at actual water-level discontinuities; avoid internal duplicate curtains and preserve outward-facing behaviour.
- [ ] Cache water classifications or skip dry chunks only if the cache cannot omit narrow streams, flooded edits or dam water. Invalidate neighbouring chunks where needed.
- [ ] Consider opaque ocean and lightweight river/lake shading on low preset only if visuals and occlusion remain acceptable.
- [ ] Validate changing dam levels, painted terrain, waterfalls, submerged cliffs, shores, transparency ordering and far/near water transitions.

**Exit gate:** fewer water triangles or lower GPU time without water holes, wrong elevations, incorrect dam flooding or loss of required appearance. Retain fallback until validated.

## Phase 4 — Mesh packing, transfer and GPU resource budgets

**Files:** `terrace.ts`, `chunkHost.ts`, `chunkClient.ts`, `worldgl.ts`.

### 4.1 Worker-ready buffers

- [ ] Move near terrain interleaving from `prepTerrain()` into the generation worker where feasible. Preserve the main-thread fallback and flat/real-map paths.
- [ ] Version the worker message format and validate buffer lengths, vertex format and index type. Transfer ownership of disposable buffers; do not detach arrays needed by the worker's world/heightfield cache.
- [ ] Transfer `encodeDecos()` output too if it is currently structured-cloned and not retained by the worker. Measure before expanding the protocol.
- [ ] Avoid repacking far vertex arrays on the main thread; treat far and near formats separately.

### 4.2 Compact vertex layouts

Prototype a 16-byte near terrain format: chunk-local float32 position (12), normal as normalized signed bytes (3), submerged/material classification byte (1), derived UV. Current shared layout is 36 bytes/vertex; 16 bytes would reduce its vertex storage by 55.6%, before any required extra attributes.

- [ ] Audit every consumer of `aPos`, `aUv`, `aCol` and current encoded attributes. Retain additional attributes if necessary; 16 bytes is a candidate, not a requirement.
- [ ] Use correct alignment, `vertexAttribPointer`/`vertexAttribIPointer` semantics and VAO layouts. Recover world coordinates with chunk origin. Preserve UVs and water/cliff shading.
- [ ] Prototype precomputed sphere-space directions for static vertices if vertex projection is a measured bottleneck. Balance extra bandwidth against saved shader arithmetic. Keep chart mapping, morphing and camera-relative precision correct.
- [ ] Use 16-bit far index templates where possible (129² vertices fit; 257² do not fit as one mesh). Share templates by topology and index type.

### 4.3 Resource lifecycle

- [ ] Track CPU and GPU bytes separately: source arrays, grid cache, packed arrays, texture mipmaps, pooled textures/buffers, framebuffers and atlases.
- [ ] Add size-class buffer pools only if allocation churn is measured. Bound pool bytes and avoid overwriting in-flight buffers; use safe replacement/orphaning strategies.
- [ ] Ensure eviction/disposal/context restoration and world changes release resources. Preserve a safe rebuild path.
- [ ] Budget upload count, bytes and CPU time; prioritise missing nearby geometry without starving far fallback.

**Exit gate:** reduced main-thread packing time, transferred/allocated bytes and upload spikes with no worker buffer ownership errors, GL errors or memory growth.

## Phase 5 — Worker scheduling and chunk streaming

**Files:** `chunkHost.ts`, `chunk.worker.ts`, `chunkClient.ts`, `WorldMap.tsx`.

- [ ] Replace unbounded FIFO demand with a bounded priority queue if current client scheduling is insufficient. Deduplicate pending requests by world/chunk/job type/revision.
- [ ] Priorities: collision-critical height data; missing visible near terrain; edited visible chunks; predicted flight path; visible peripheral chunks; far LOD; background prefetch. Add aging/fairness and retain coarse fallback.
- [ ] Attach world generation and terrain revision identifiers to requests/results. Preserve ordered world operations and existing field epoch checks. Never install a stale result after an edit or world change.
- [ ] Coalesce outdated far jobs and discard obsolete results before expensive upload. Distinguish cancellation of queued jobs from cooperative cancellation of running work.
- [ ] Use `terraceFarMesh()` yield points to schedule bounded work slices between messages. A generator drained synchronously does not permit cancellation mid-job. Because cube size is module-global, restore it around each resumed slice or isolate far jobs in a dedicated worker; never allow interleaved jobs to corrupt this state.
- [ ] Check whether far generators and real-map data rely on additional shared mutable state before enabling interleaving.
- [ ] Preserve `ChunkHost` as a testable, environment-independent class and keep `chunk.worker.ts` as a thin adapter.
- [ ] Measure worker count and contention on integrated-GPU hardware; start from the existing arrangement rather than adding workers indiscriminately.
- [ ] Separate dirty flags for texture, geometry, water, decoration and collision where safe. Classify dependencies of sculpting, paint, vegetation, fire, flooding and dam construction. Inspect `meshSig`, `sameBytes`, and related existing logic before duplicating it.

**Exit gate:** fewer stale/duplicate jobs, bounded queue latency, stable terrain during rapid movement and edits, correct world-operation ordering and no loss of authoritative collision data.

## Phase 6 — Structural far LOD and visibility

**Files:** `terrace.ts`, `WorldMap.tsx`, `worldgl.ts`, `cube.ts` as needed.

This is the major architectural optimisation. Implement only if measured far rendering or generation remains expensive after Phase 1.

- [ ] Prototype reusable annular grid/index templates or geometry clipmaps with a small transition band. Reduce full overlapping squares and fragment `discard` work.
- [ ] Preserve coverage at missing near chunks, moving ring boundaries, cube-face edges/corners and all altitudes. Keep a coarse underlay where needed; actual cube planet uses a subset of rings plus face meshes.
- [ ] Snap LOD origins to sample intervals, retain previous height samples, generate newly exposed strips and update only modified GPU ranges. Recompute filter/derivative halos affected by shifting rows/columns; `openGrid`, slopes and optional upsampling require neighbourhoods.
- [ ] Use shared sampling coordinates, seam stitching or compatible edge topology between levels. Maintain correct coastline, terrain shading and visual terrace contours. Avoid cracks, z-fighting and abrupt popping.
- [~] Introduce conservative face/group/chunk frustum and horizon culling, accounting for maximum elevation and the existing chart-to-sphere morph. Avoid false culling. *(Done early, in `src/domain/facetiles.ts`: planet faces in 5×5 tiles with horizon + frustum culling (view test only beyond 0.4 R, where the shader's chart blend is finished); endless-world rings in 8×8 tiles, skipped when inside the hole, beyond the reach or out of view, curve drop and sink included. Brute-force tests against the shaders' own maths; `?dbg=nolod` turns all of it off. Not done: near chunks, cube edges/corners and orbit not checked visually.)*
- [ ] Separate physics, render, prefetch, retention and simulation ranges. A loaded chunk need not be rendered, and a culled chunk may still need height data.
- [ ] Cache candidate lists across small camera movements, but keep final visibility responsive. Retain hysteresis to avoid repeated eviction/rebuild.
- [ ] Replace fixed cache counts with byte-budgeted eviction while protecting collision-critical and active render resources. Avoid requesting more fine chunks than the retention budget can hold.
- [ ] Test whether coverage-aware LOD geometry can eliminate the second far depth pass. Do not remove it merely because near geometry normally covers the far mesh.

**Exit gate:** measured reduction in far geometry, overdraw or rebuild/upload cost; no terrain holes, cube-face cracks, horizon popping or bad occlusion during fast ascent/descent and chart transitions.

## Phase 7 — Texture, sprite and simulation optimisations

**Files:** `worldgl.ts`, `WorldMap.tsx`, `chunkbuild.ts`, ecosystem modules.

### Texture storage

- [ ] Audit current mipmapped chunk texture cache and pool. At 256×256 RGBA8, full mip chains use approximately 1/3 MiB per texture; 200 resident + 48 pooled would be ~82.7 MiB before CPU copies or other GPU allocations. Verify actual dimensions, pool limits and residency.
- [ ] Introduce byte caps and trim spare resources before changing texture architecture.
- [ ] Consider paged `TEXTURE_2D_ARRAY` storage if texture binds are a measured cost. Texture arrays alone do not eliminate draw calls; batching needs geometry submission changes.
- [ ] Prototype tile-ID data textures sampled from the atlas if texture memory remains problematic. A 16×16 R8 ID grid is 256 bytes versus 256 KiB for 256×256 RGBA8 base pixels, but IDs alone cannot encode all overlays/autotile state. Preserve mipmapping, atlas gutters, texture filtering, season/paint effects and anti-shimmer behaviour. Benchmark shader cost against the existing chunk images.

### Sprites and simulation

- [ ] Keep the existing shared sprite atlas/batching. Profile per-frame sprite construction, sorting, uploads and overdraw before switching to instancing.
- [ ] Store static tree/rock/bush instances persistently by chunk; update only on state changes. Use instanced quads and vertex-shader billboarding where compatible with depth and transparent ordering.
- [ ] Cull or reduce distant decorative density while preserving gameplay-relevant entities.
- [ ] Separate rendering cadence from simulation. Candidate rates: nearby movement 20 Hz, steering 10 Hz, AI 5 Hz, weather 2 Hz, resources 1 Hz, plants 0.1 Hz, distant ecosystem 0.05 Hz. These are experiments, not mandated changes.
- [ ] Keep flight physics on its existing validated timestep/substep logic; verify frame-rate independence and interpolation before adjusting anything. Preserve real-time/sim-time semantics under time warp.
- [ ] Keep deterministic ecosystem progression, save compatibility and UI responsiveness. Profile React updates and minimap generation independently.

**Exit gate:** lower per-frame CPU/transfer cost or memory usage with no visible sprite regressions or gameplay/simulation drift.

## Phase 8 — Adaptive quality and final validation

**File:** `WorldMap.tsx`, renderer and profiler.

- [ ] Extend existing `autoK`, `autoDraw`, `glScale`, `frameEma` governor rather than replace it blindly.
- [ ] Use selected FPS cap to determine target frame duration (16.67 ms for 60, 33.33 ms for 30). Do not interpret an intentional frame cap or background tab throttling as a performance bottleneck.
- [ ] Distinguish GPU-bound workloads (render scale, effects, overdraw, geometry) from CPU-bound workloads (simulation, queue work, allocations, submissions). If GPU timing is unsupported, use conservative controlled experiments rather than guessing.
- [~] Use hysteresis, cooldown, fast degradation and slow recovery. *(35% floor added with 70 ms down / 45 ms up thresholds; a possible flip-flop between 50% and 35% costing buffer resizes is unchecked: watch `canvas WxH` in `?perf`.)* Keep minimum collision-critical coverage and avoid LOD churn.
- [ ] Benchmark every preset on actual integrated hardware and browser combinations when available.

### Candidate quality presets (tune from measured results)

| Parameter | Potato | Integrated | High |
|---|---:|---:|---:|
| FPS target | 30 | 60 | 60+ |
| Render scale | 50% | 65–85% | 100% |
| Internal resolution cap | 960×540 | 1280×720 | Native |
| Far grid candidate | 65² | 129² | 257² |
| Far LOD levels | 4 | 5–6 | 6 |
| Near visual subdivisions | 1–2* | 2 | 2 |
| Decoration density | 25% | 60% | 100% |
| Water surfaces | Single where validated | Single where validated | Single where validated |
| Scattering | Off/simple | Simplified | Full |
| Post-processing | Off | Off | Optional existing effects |
| GPU resource budget | 96 MiB | 128 MiB | 256 MiB |

*Visual mesh detail only; never lower authoritative collision/heightfield resolution or change terrain layers with graphics settings. Coarser near geometry requires seam and collision visual tests. Preserve required features rather than removing them by default.

## 4. Performance acceptance criteria

Proposed initial engineering targets, not promises. Revise after the baseline and actual hardware testing.

| Metric | Initial target |
|---|---|
| Integrated preset | 60 FPS where feasible; p95 frame time near target |
| Minimum preset | Stable 30 FPS; minimise p99 spikes |
| Visible terrain triangles | <100,000 initially |
| Submitted total triangles (all passes) | <200,000/frame initially |
| Draw calls | <100/frame initially |
| Low-preset texture allocation | <64 MiB if feasible |
| Main-thread upload CPU time | <2 ms/frame typical gameplay |
| Main-thread terrain generation | Near zero in steady state; retain safe fallback |
| Blocking GPU readbacks | None in normal gameplay |
| Memory over extended exploration | Stable after warm-up; bounded caches |
| Geometry correctness | No visible holes/cracks; no invalid indices/NaNs |
| Collision / sculpting / saves | Unchanged semantics and determinism |

Do not chase triangle or draw-call budgets at the cost of visual correctness; GPU time and frame pacing are the actual outcomes. Measure memory as a tracked estimate unless a reliable hardware metric exists.

### Required regression matrix

- [ ] Seed determinism and exact threshold behaviour.
- [ ] Shared-edge agreement, negative coordinates and cube-face/corner traversal.
- [ ] Flat worlds, procedural hills and real-map terrain where affected.
- [ ] Missing chunks, stale results, rapid edits, world switch and context restoration.
- [ ] Lake/sea/river/dam water, waterfalls and underwater shading.
- [ ] Near/far terrain occlusion, sprite depth, stipple transitions and fast descent.
- [ ] Flight, landing, walking, terrain editing and collision at 30/60 FPS.
- [ ] Long exploration, worker errors, memory eviction and quality transitions.

## 5. Reference architecture (incremental, not a mandatory directory rewrite)

```text
Terrain core: cube-sphere → elevation/relief → marching triangles → shelf/cliff/water mesh
Streaming: demand → priority/revision queue → workers → transferable packed buffers
LOD: near chunks + far rings + planet faces → coverage/seams → conservative culling
WebGL: resource budgets/pools → upload scheduler → specialised terrain/water/sprite/sky passes
Simulation: authoritative collision + flight + ecosystem → independent update cadence
Diagnostics: CPU/GPU profiler → benchmark runner → adaptive quality
```

Prefer extracting focused modules only when it improves testability or makes an optimisation safer. Do not create empty abstractions or reorganise the entire codebase to match this diagram.

## 6. External technical references

These are user-supplied starting references; inspect them if network access is available and relevant to a specific implementation.

- Icospheric, Making Terraced Terrain: https://icospheric.com/blog/2016/07/17/making-terraced-terrain/
- Lazy Squirrel Labs, TTG: https://github.com/lazysquirrellabs/TTG#samples
- TTG performance article: https://blog.lslabs.dev/posts/ttg_performance

Use TTG's local contour extraction and vertex reuse as inspiration. Do not port Unity architecture wholesale. Verify the licence and preserve required notices if copying code. Published Unity results are not browser performance measurements.

## 7. First task to execute

**Start with Phase 0 only.** Inspect the repository and existing diagnostics, then implement the smallest useful baseline instrumentation change. Identify active far triangle counts and draw passes, near mesh/water counts, worker latency, upload bytes and CPU/GPU frame time. Add a repeatable benchmark route or documented reproduction procedure. Run available checks and report the results before modifying terrain topology or graphics quality.

Use the following report format at every milestone:

```markdown
## Milestone report
- Scope and files changed:
- Hypothesis tested:
- Baseline / after measurements (hardware, browser, scenario):
- Tests and commands run:
- Visual and gameplay regressions checked:
- Remaining risks or blockers:
- Recommendation for next milestone:
```

## 8. Audit limitations

*Update 2026-11-27: Phase 0–1 numbers are now measured on a UHD 630 (see the progress log and `BENCHMARKS.md`); everything else here is still a hypothesis. No run on the user's Intel HD 400 exists.*


This roadmap is based on the provided five-file snapshot and the preceding optimisation review. The complete application, related imported modules and actual integrated-GPU performance were not tested. Numerical budgets, priority order and proposed layouts are hypotheses to validate, not guaranteed improvements. Do not change terrain topology, water or saved-world semantics based solely on this document.
