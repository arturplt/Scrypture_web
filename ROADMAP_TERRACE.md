# Terraced "Hills" world: improvements and optimisations

Follow-up work for the Godus-style terraced world (`kind: 'terraced'`). Each task stands on its own. Do them in the order given unless noted. Keep the code style of the files you touch:
- long one-line statements;
- comments in plain British English that explain *why*;
- no new dependencies.

## How it works today (read first)
- **`src/domain/terrace.ts`**: the whole height field.
  - `elevation(x, y, seed)` returns elevation in layer units (below 0 = sea). It is split into `lowAt` (the slow noise: warp, continent, big hills, big rolls) and `detailAt` (the quick noise).
  - `terraceH(e)` turns elevation into stepped height in tiles. The constants are `TERRACE_STEP = 0.45` tiles per layer and `W = 0.3`, the share of each layer that is ledge.
  - `TerraceField` caches one grid per chunk: `TERRACE_G² = 33²` points at half-tile spacing (`TERRACE_SUB = 2`). The slow noise is worked out on a coarse lattice (`COARSE = 4` points) and blended. `heightAt` is a bilinear lookup on the grid; `layerAt` / `elevationAt` read tile centres; `layerDirect` reads uncached noise, for the maps.
  - `terraceSpawn`, `terraceMoist`, `bandTint` (layer → grass tint).
  - `terraceFarMesh` is a generator that builds far LOD meshes (sizes in `TERRACE_FAR_LODS`).
- **`src/domain/worldgen.ts`**:
  - `generateTerraceChunk` makes the tiles from layers. `LEDGE_BIT` (0x80) in the biome grid marks ledge tiles, and nothing stands on them.
  - `terraceBiome(layer, moist)` picks the biome.
  - `World.field`, `World.hilly` (has height), `World.realMap` (the Lake District only), `heightAt` / `groundZAt` / `metresAt` / `layerAt` / `mapLayer`.
- **`src/screens/worldgl.ts`**:
  - `prepTerrain` builds a hilly chunk mesh with `terrainSub` vertices per tile.
  - The `uTerrace` branch in `FS` draws band tints, earth walls (`cliff` from the normal's `-tn.z`), the lip and the foot crease.
  - `setFarLod(i, mesh)` replaces one far level.
- **`src/screens/WorldMap.tsx`**:
  - The far rebuild block (`farAt` / `farJob`, near the chunk-building loop).
  - `MiniCache.read` / `lay` and `terracePixel` for the minimap and the full-screen map (`drawMinimap`, `mapFrame`).
  - The walking rule (`s.world.field ? 2.6 : 1.0`).
- **Tests:** `src/domain/terrace.test.ts`.
- **Checking it visually:** the built-in browser pane has **no WebGL**, so it shows the flat 2D fallback only. Use headless Chromium with SwiftShader through CDP instead (`chromium --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --remote-debugging-port=…`).
  - A fresh profile needs onboarding: click the `Next` buttons.
  - Saves don't survive killing Chromium, so onboard, create the world and test in one run.
  - **Debug: lift +3 m/s** in the Controls menu makes the plane climb, for a view from above.
- **Commands:**
  - `npx tsc --noEmit -p .`
  - `npx vitest run` (currently 682 passing)
  - Micro-benchmarks: `npx vite-node <script>.mts`

---

## A. Optimisations

### A1. Cheaper noise (biggest win)
`noise()` in `terrace.ts` does 4 full `hash01` calls (each with 4 `Math.imul` mixes) per sample. A grid build is ~0.8 ms per chunk and `chunkDrawn` ~3.9 ms with grids built.
- Replace the lattice hash with a cheaper one: one `Math.imul` chain on `(xi * 0x27d4eb2d) ^ (yi * 0x165667b1) ^ seed`, then a single avalanche.
- Or use a 2D gradient/simplex noise with a seeded 256-entry permutation table. That is fine here because the warp hides any lattice.
- The world changes for a given seed, so do this **before** terraced worlds ship (they aren't committed yet).
- **Done when:** a grid takes ≤ 0.4 ms (bench: build 300 grids after warming up), and the terrace tests still pass, re-tuning test thresholds only if the distribution moves.

### A2. Don't build 9 grids for one chunk's tiles
`generateTerraceChunk` reads layers for a ring of 3 tiles past `MARGIN` (`R = 3`), which touches the 8 neighbouring chunk grids.
- Read the layers for the margin with `field.layerDirect`, or from a small dedicated edge strip, instead of building whole neighbour grids.
- Or lower `R` to 2: the beach check reaches 2 tiles, and the ledge test needs 1.
- **Done when:** a cold `chunkDrawn` on a new row of chunks is < 1.5 ms.

### A3. Build the mesh straight from the grid
`prepTerrain` calls `this.terrain(x, y)` 5 times per vertex (height plus 4 for the normal), each a bilinear lookup with a chunk-key check.
- Give `WorldGL` an optional `terrainGrid(cx, cy) => Float32Array | null` hook. For terraced worlds, return `field.grid(cx, cy).h` and read vertices and central differences straight from the array. Neighbour grids are needed only at the edge columns and rows.
- **Done when:** `prepTerrain` for a terraced chunk is ≤ 0.2 ms.

### A4. Time-slice chunk generation
`World.base()` (tiles and grids) runs inside the first step of `buildChunkGen` in one go, so a burst of new chunks can still spike a frame.
- Warm the grids ahead of time: add `TerraceField.prewarm(list, ms)`, called from the look-ahead block in `WorldMap.tsx` (`f.mode === 'glide' && useGL`) for chunks on the course wedge.
- **Done when:** `?perf` shows no `build` hitch lines when flying straight over new ground at full speed.

### A5. Far mesh build cost and uploads
`TERRACE_FAR_LODS` (fine: step 5, half 1000) is 401² = 160k vertices, about 5.8 MB per upload.
- Measure the build time over frames and the upload time.
- Options:
  - fine step 6, or a smaller half-size tied to `drawK`;
  - reuse the previous mesh's indices (they are identical for the same `cols`): add an index-buffer cache in `setFarLod`;
  - upload into an existing buffer with `bufferSubData` instead of creating new buffers.
- Index buffers per LOD never change size, so they can be created once.
- **Done when:** a far rebuild never adds more than ~2 ms to a frame (check with `?perf`).

### A6. Bound the grid cache by memory, and share it
`GRID_MAX = 900` grids × (33² × 2 floats × 4 B) ≈ 7.8 MB.
- Check that the cache is not thrashed by the maps: the minimap uses `MiniCache.read` → `world.layerAt`, which builds grids for every explored chunk it reads.
- Either make the map read layers with `layerDirect` (no grid), or keep a separate cache of 16×16 `Int8Array` layers per chunk for the maps.
- **Done when:** flying with the minimap open doesn't evict the grids of chunks on screen. Add a debug counter if needed.

### A7. Height lookups in the hot path
`TerraceField.heightAt` already has a one-entry fast path (`lastKey`). The camera, sprites (`board` / `flat`) and shadows each call it. Measure with `?perf` how many calls a frame makes; if it's in the tens of thousands, add a 2-entry cache or batch the sprite height lookups per chunk.

---

## B. Visual improvements

### B1. Smooth the ledge zigzag
Diagonal ledges show a sawtooth because the grid is axis-aligned and every quad is split the same way (`a, b, e2 / a, e2, d` in `prepTerrain`).
- Cheap fix: split each quad along the diagonal whose two corners are closer in height (adaptive triangulation). That needs a per-chunk index buffer instead of the shared `terrIbo`; store it on the chunk entry. Try this first.
- Fallback: `TERRACE_SUB = 3`, with 2.25× the vertices. Then `COARSE` must divide `16 × 3 = 48` (use 4 or 6), and the `Uint16` indices still fit (49² = 2401).
- **Done when:** a screenshot at low altitude over a diagonal ledge shows a continuous edge.

### B2. Make the walls more Godus-like
- Walls should read as pale, layered earth with a clear top edge. Tune in the `uTerrace` branch of `FS`:
  - the `wall` colour;
  - `cliff = 1 - smoothstep(0.84, 0.97, up)`;
  - the lip (`smoothstep(0.72, 0.9, fr)`) and the foot crease.
- Consider tinting walls by the layer **above** (`lay + 1`) so a wall matches the shelf it belongs to.
- Compare side by side with the Godus reference: warm sandy-cream walls, soft yellow-green shelves.

### B3. Fix the colour palette
Today's ground is the pixel-art grass tile multiplied by `bandTint`, which still reads as fairly saturated green.
- Godus low layers are pale yellow and cream. Consider a stronger tint ramp on low layers, plus slight desaturation.
- Keep the TS `bandTint` (`terrace.ts`), the GLSL ramp (`worldgl.ts`, `uTerrace` branch) and the far-mesh colours (`terraceFarMesh`) **in sync**. Better: generate the GLSL constants from `bandTint`'s stop table so there's one source of truth.

### B4. Far mesh: stepped, not smooth
`terraceFarMesh` uses smooth `e * STEP` heights, so distant hills lose their terraces and there's a visible change where the chunks end.
- Use `terraceH(e)` for the fine LOD at least, and give the far meshes the `uTerrace` treatment. Their vertex colours already carry the band tint, but they have no lips.
- Check for gaps at the hole edge (`drawFar` rings).

### B5. 2D-canvas fallback
Without WebGL (for example the built-in browser pane), terraced worlds draw flat and untinted.
- In `buildChunkGen` (`WorldMap.tsx`), when `!useGL && world.field`, multiply the band tint into the chunk pixels.
- Draw a 1-art-pixel dark contour where a pixel's layer differs from its north or west neighbour. Interpolate elevation from `field.grid(cx, cy).e` at 16 px per tile.

### B6. Map polish
- The full-screen map's contour relief (`terracePixel`) is subtle at large scales. Scale the light/dark factor with zoom.
- Draw every 5th layer as a stronger contour line, like a topographic map.

---

## C. Gameplay and world

### C1. Water that follows the terraces
The ecosystem treats terraced worlds as flat (`Ecosystem.hilly` is the Lake District only, in `ecosystem.ts` around line 485). That covers rain runoff, becks, tarns and beaver dam ponds.
- Generalise the hilly paths to use `world.metresAt` / `world.heightAt` instead of the Lake District's corner grid.
- `setPondSurface` (`lakedistrict.ts`) writes into the lake corner grid. Add an equivalent override map in `TerraceField`: tile → water level, applied in `grid()` and invalidating the cached grid and chunk mesh.
- Check `beavers.ts` (`eco.hilly` branches) and `hydrology.ts`.
- Big task: split it into runoff first, then ponds.

### C2. Inland lakes
Water only exists below sea level, so there are no tarns between hills.
- Add basins: where a low-frequency "lake" noise is high and the local elevation is a minimum, flatten the area to a water level above the sea, with a flat sheet like the Lake District's lakes.
- Must stay a pure function of (seed, x, y).

### C3. Start in the air
Hills worlds start landed, like flat ones. Consider opening them in the air like the Lake District (`LAKE_START_ALT`, the `throwPlane` call near the top of the `WorldMap.tsx` effect), so the first view shows the terraces from above.

### C4. Walking on ledges
The walker steps up one layer (rise ≤ 2.6). Check it feels right, and add a small hop animation, or snap the camera's ground smoothing, when stepping up a ledge.

### C5. Sculpting (the Godus mechanic; agreed as a later phase)
A tool that raises or lowers the layer under the cursor:
- Store per-tile layer deltas in the save (a new `SavedWorld.relief` field; sanitise it in `worldsave.ts`, cap its size like `MAX_CHANGES`).
- Apply them in `TerraceField.grid` (add the delta to `e`, with a smooth falloff so edges stay rounded).
- Invalidate the cached grid, chunk tiles (`World.cache`), chunk mesh (`ent.mesh` / `vao` in `WorldGL`) and the minimap's `MiniCache.lay` for the touched chunks.
- Hook it into the existing paint tool UI (`L.tool`).

---

## D. Housekeeping
- **D1.** Show the world kind in the world list (`src/screens/Worlds.tsx`): a small "Hills" or "Lake District" tag.
- **D2.** Make the "Terraced hills" and "Lake District" checkboxes a real three-way choice (Flat / Hills / Lake District), as the original plan intended.
- **D3.** Tests to add:
  - `generateTerraceChunk` gives sand on layer 0 and water below 0;
  - the far mesh matches `terraceH` / `elevation` within the expected error;
  - after A1 or B1, re-check the shelf, ledge and spawn tests.
- **D4.** Document the terraced world in `MAP_GENERATION_DOCUMENTATION.md` (or wherever world generation is described), and add a line to `BACKLOG.md` pointing at this file.

## Suggested order
1. A1, A2, A3: cheap and big.
2. B1, B2, B3: the look.
3. A4, A5, A6.
4. B4, B5, B6.
5. D1–D4.
6. C3, C4.
7. C2, then C1.
8. C5.
