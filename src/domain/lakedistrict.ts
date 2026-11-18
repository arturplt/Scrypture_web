/**
 * The Lake District as a world: a real elevation map and real water (see scripts/build-lakedistrict.py), 1 tile = 50 m, centred on tile (0, 0).
 * The image is read once (`setLakeData`, from the loader in screens/lakeLoader.ts) and everything here is a pure lookup into it.
 * Outside the map is sea. Heights are given in tiles (what the renderer draws) and in glider metres (what the plane flies in).
 */

export type WorldKind = 'procedural' | 'lakedistrict';

/** Which map a Lake District world plays on: the whole region at 50 m a tile, or a patch of it at 10 m (see LAKE_MAPS). */
export type LakeMapId = 'lakes' | 'coniston';
export interface LakeMapDef {
  id: LakeMapId; name: string; png: string; json: string;
  tileM: number;                        // metres a tile covers
  stretch: number;                      // real height x stretch / tileM = height in tiles (above 1 exaggerates the relief)
  grid: { w: number; h: number };       // size in tiles, used before the image has loaded
  affine: number[];                     // [a, b, c, d, e, f]: tile x = a lon + b lat + c, tile y = d lon + e lat + f (centred on the grid's middle, y south)
  spawn: { lon: number; lat: number; heading: number };
  waters: { name: string; pts: [number, number][] }[];
}
/** The affine of a map given by its lon/lat box (every tile the same size in degrees). */
const boxAffine = (w: number, e: number, s: number, n: number, gw: number, gh: number) => [gw / (e - w), 0, -w * gw / (e - w) - (gw >> 1), 0, -gh / (n - s), n * gh / (n - s) - (gh >> 1)];

/** The waters of the Lake District by name: a lake is a line of (lon, lat) points along its length (so a long lake like Windermere is near all of its shore). Positions are approximate. */
const LAKES_WATERS: { name: string; pts: [number, number][] }[] = [
  { name: 'Windermere', pts: [[-2.958, 54.435], [-2.935, 54.365], [-2.945, 54.27]] },
  { name: 'Coniston Water', pts: [[-3.075, 54.37], [-3.075, 54.32], [-3.07, 54.30]] },
  { name: 'Ullswater', pts: [[-2.95, 54.55], [-2.92, 54.575], [-2.89, 54.605]] },
  { name: 'Derwentwater', pts: [[-3.145, 54.58], [-3.14, 54.56]] },
  { name: 'Bassenthwaite Lake', pts: [[-3.23, 54.66], [-3.21, 54.63]] },
  { name: 'Thirlmere', pts: [[-3.07, 54.55], [-3.05, 54.52]] },
  { name: 'Haweswater', pts: [[-2.83, 54.495], [-2.77, 54.51]] },
  { name: 'Ennerdale Water', pts: [[-3.38, 54.52]] },
  { name: 'Crummock Water', pts: [[-3.31, 54.56]] },
  { name: 'Buttermere', pts: [[-3.28, 54.54]] },
  { name: 'Loweswater', pts: [[-3.36, 54.58]] },
  { name: 'Wast Water', pts: [[-3.31, 54.44], [-3.27, 54.45]] },
  { name: 'Grasmere', pts: [[-3.02, 54.45]] },
  { name: 'Rydal Water', pts: [[-3.0, 54.45]] },
  { name: 'Elterwater', pts: [[-3.04, 54.43]] },
  { name: 'Esthwaite Water', pts: [[-2.99, 54.36]] },
  { name: 'Brothers Water', pts: [[-2.92, 54.50]] },
  { name: 'Devoke Water', pts: [[-3.28, 54.35]] },
  { name: 'Tarn Hows', pts: [[-3.03, 54.38]] },
  { name: 'Morecambe Bay', pts: [[-2.85, 54.20]] },
  { name: 'Irish Sea', pts: [[-3.45, 54.30]] },
];
const CONISTON_WATERS: { name: string; pts: [number, number][] }[] = [
  { name: 'Coniston Water', pts: [[-3.075, 54.372], [-3.075, 54.33], [-3.06, 54.29]] },
  { name: 'Tarn Hows', pts: [[-3.0345, 54.3935]] },
  { name: 'Esthwaite Water', pts: [[-2.985, 54.365], [-2.99, 54.345]] },
  { name: 'Levers Water', pts: [[-3.1, 54.3685]] },
  { name: 'Low Water', pts: [[-3.1245, 54.3725]] },
  { name: 'Seathwaite Tarn', pts: [[-3.1585, 54.3555]] },
  { name: 'Goats Water', pts: [[-3.1275, 54.3705]] },
  { name: 'Blelham Tarn', pts: [[-2.9835, 54.3985]] },
  { name: 'Beacon Tarn', pts: [[-3.0975, 54.3055]] },
  { name: 'Yew Tree Tarn', pts: [[-3.0535, 54.3935]] },
];

export const LAKE_MAPS: Record<LakeMapId, LakeMapDef> = {
  lakes: {
    id: 'lakes', name: 'Lake District', png: 'lakedistrict.png', json: 'meta.json', tileM: 50, stretch: 1.5, grid: { w: 1426, h: 1769 },
    affine: boxAffine(-3.70, -2.60, 54.00, 54.80, 1426, 1769), spawn: { lon: -3.1096, lat: 54.3708, heading: 0 }, waters: LAKES_WATERS,
  },
  coniston: {   // (the affine is the one the build script fitted: see public/assets/lakedistrict/coniston.json)
    id: 'coniston', name: 'Coniston', png: 'coniston.png', json: 'coniston.json', tileM: 10, stretch: 0.5, grid: { w: 1400, h: 1500 },
    affine: [6502.453579147299, 170.1256342602632, 10771.100286070534, 99.42546292999616, -11126.378197635024, 604826.7394639135], spawn: { lon: -3.0649, lat: 54.3620, heading: -Math.PI / 2 }, waters: CONISTON_WATERS,
  },
};
/** The Lake District map's real-metre scale, for code that only ever meets the big map (the tests). */
export const HEIGHT_STRETCH = LAKE_MAPS.lakes.stretch;
export const REAL_TILE_M = LAKE_MAPS.lakes.tileM;
/** The big map's size in tiles, used before the image has loaded. */
export const LAKE_GRID = LAKE_MAPS.lakes.grid;
/** The camera draws a glider metre as this many tiles (WorldMap's `gl.z * 0.18`), so ground height in glider metres is tiles / this. */
export const TILES_PER_GLIDER_M = 0.18;
/** Water classes in the map. */
export const LAKE_LAND = 0, LAKE_WATER = 1, LAKE_RIVER = 2;
/** Tiles to kilometres on the map that is loaded. */
export const tilesToKm = (tiles: number) => tiles * (data?.tileM ?? LAKE_MAPS.lakes.tileM) / 1000;

export interface LakeData { w: number; h: number; heightM: Float32Array; water: Uint8Array; corners: Float32Array; credits: string; map: LakeMapId; tileM: number; stretch: number }
let data: LakeData | null = null;

/** Every tile corner's height in real metres, worked out once (see cornerMetres): (w + 1) x (h + 1), corner (ix, iy) at index (iy + h/2) * (w + 1) + ix + w/2. The ground height lookup runs thousands of times a frame, so it only reads four of these. */
function cornerGrid(d: LakeData): Float32Array {
  const W = d.w + 1, H = d.h + 1, ox0 = d.w >> 1, oy0 = d.h >> 1, out = new Float32Array(W * H);
  const m = (x: number, y: number) => (x >= 0 && y >= 0 && x < d.w && y < d.h ? d.heightM[y * d.w + x] : 0);
  const wt = (x: number, y: number) => (x >= 0 && y >= 0 && x < d.w && y < d.h ? d.water[y * d.w + x] : LAKE_WATER);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sum = 0, lake = Infinity;
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const v = m(i + di, j + dj); sum += v;
      if (wt(i + di, j + dj) === LAKE_WATER && v < lake) lake = v;
    }
    out[j * W + i] = lake < Infinity ? lake : sum / 4;
  }
  void ox0; void oy0;
  return out;
}

/** Decode the RGB image (R,G = decimetres, B = water class) into the lookup grids. */
export function setLakeData(w: number, h: number, rgba: ArrayLike<number>, credits = '', map: LakeMapId = 'lakes'): LakeData {
  const heightM = new Float32Array(w * h), water = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { heightM[i] = (rgba[i * 4] * 256 + rgba[i * 4 + 1]) / 10; water[i] = rgba[i * 4 + 2]; }
  data = { w, h, heightM, water, corners: new Float32Array(0), credits, map, tileM: LAKE_MAPS[map].tileM, stretch: LAKE_MAPS[map].stretch };
  data.corners = cornerGrid(data);
  return data;
}
export const lakeData = (): LakeData | null => data;
export const lakeReady = (map?: LakeMapId): boolean => data !== null && (!map || data.map === map);
/** The map that is loaded (the big one before any has been). */
export const lakeMapId = (): LakeMapId => data?.map ?? 'lakes';

const ox = (d: LakeData) => d.w >> 1, oy = (d: LakeData) => d.h >> 1;
const inside = (d: LakeData, x: number, y: number) => x >= -ox(d) && y >= -oy(d) && x < d.w - ox(d) && y < d.h - oy(d);

/** The water class of a tile (LAKE_LAND, LAKE_WATER or LAKE_RIVER); sea beyond the map. */
export function lakeWaterAt(x: number, y: number): number {
  const d = data; if (!d) return LAKE_WATER;
  return inside(d, x, y) ? d.water[(y + oy(d)) * d.w + x + ox(d)] : LAKE_WATER;
}
/** Real ground height in metres at a tile's centre (0 beyond the map). */
export function lakeMetresAt(x: number, y: number): number {
  const d = data; if (!d) return 0;
  return inside(d, x, y) ? d.heightM[(y + oy(d)) * d.w + x + ox(d)] : 0;
}
/** The height (real metres) at a tile corner: the mean of the four tiles round it, but a corner touching a lake or the sea is at the water's level, so every lake is a flat sheet. */
export function cornerMetres(ix: number, iy: number): number {
  let sum = 0, lake = Infinity;
  for (let j = -1; j <= 0; j++) for (let i = -1; i <= 0; i++) {
    const m = lakeMetresAt(ix + i, iy + j);
    sum += m;
    if (lakeWaterAt(ix + i, iy + j) === LAKE_WATER && m < lake) lake = m;
  }
  return lake < Infinity ? lake : sum / 4;
}
/**
 * Ground height in tiles at a point: the corners of the tile grid are the heights (see cornerMetres) and between them it is interpolated, which is what a chunk's
 * mesh draws, so the walker's feet, the camera and the plane agree with what is on screen.
 */
export function groundTiles(px: number, py: number): number {
  const d = data; if (!d) return 0;
  const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0, W = d.w + 1, ix = x0 + (d.w >> 1), iy = y0 + (d.h >> 1);
  if (ix < 0 || iy < 0 || ix >= d.w || iy >= d.h) {      // off the map: sea level, flattened (the edge cells blend down to it)
    const a = cornerMetres(x0, y0), b = cornerMetres(x0 + 1, y0), c = cornerMetres(x0, y0 + 1), e = cornerMetres(x0 + 1, y0 + 1);
    return ((a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty) / d.tileM * d.stretch;
  }
  const k = iy * W + ix, c = d.corners, a = c[k], b = c[k + 1], cc = c[k + W], e = c[k + W + 1];
  return ((a + (b - a) * tx) * (1 - ty) + (cc + (e - cc) * tx) * ty) / d.tileM * d.stretch;
}
/** Ground height in glider metres (the plane's z axis). */
export const groundZ = (px: number, py: number): number => groundTiles(px, py) / TILES_PER_GLIDER_M;
/** Ground slope (rise over run, in tiles) at a point. */
export function groundSlope(px: number, py: number): number {
  const e = 0.5, dx = groundTiles(px + e, py) - groundTiles(px - e, py), dy = groundTiles(px, py + e) - groundTiles(px, py - e);
  return Math.hypot(dx, dy) / (2 * e);
}

/** Which biome (index into BIOME_LIST in worldgen: 0 grassland, 1 forest, 2 wetland, 3 desert, 4 lake, 5 ocean) a Lake District tile reads as. */
export function lakeBiomeIndex(x: number, y: number): number {
  const m = lakeMetresAt(x, y);
  if (lakeWaterAt(x, y) !== LAKE_LAND) return 5;
  if (m > 600) return 3;           // bare tops (sand tiles, rocks)
  if (m > 350) return 0;           // open fell: grass, bushes, a few rocks, no trees
  if (m < 40) return 2;            // the low wet ground by the coast and the lakes
  return 1;                        // wooded valleys
}

/** A point (lon, lat) as tile coordinates on a map (x east, y south, centred as the rest of this file): the loaded map by default. */
export function lakeTileOf(lon: number, lat: number, map: LakeMapId = lakeMapId()): { x: number; y: number } {
  const [a, b, c, d, e, f] = LAKE_MAPS[map].affine;
  return { x: a * lon + b * lat + c, y: d * lon + e * lat + f };
}
export interface LakePlace { name: string; tiles: number; dx: number; dy: number }
/** Every named water of the loaded map with its distance (in tiles) and direction from a point, nearest first. */
export function lakeWatersFrom(x: number, y: number): LakePlace[] {
  return LAKE_MAPS[lakeMapId()].waters.map(wt => {
    const p = wt.pts.map(q => lakeTileOf(q[0], q[1]));
    let best = Infinity, bx = 0, by = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[Math.min(i + 1, p.length - 1)], vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2)) : 0, cx = a.x + vx * t, cy = a.y + vy * t, dd = Math.hypot(cx - x, cy - y);
      if (dd < best) { best = dd; bx = cx - x; by = cy - y; }
    }
    return { name: wt.name, tiles: best, dx: bx, dy: by };
  }).sort((a, b) => a.tiles - b.tiles);
}
/** 8-point compass letters for a direction in map tiles (y south). */
export const compass = (dx: number, dy: number): string => ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];

/** Where a Lake District world starts on a map: in the air over Coniston Water. Also where a world saved off the map comes back to. */
export function lakeSpawnFor(map: LakeMapId = 'lakes'): { x: number; y: number; heading: number; pitch: number } {
  const sp = LAKE_MAPS[map].spawn, t = lakeTileOf(sp.lon, sp.lat, map);
  return { x: Math.round(t.x), y: Math.round(t.y), heading: sp.heading, pitch: 0 };
}
/** Is the tile on the map, with a margin of `m` tiles to spare? */
export function lakeOnMap(x: number, y: number, m = 0): boolean { const d = data; return !d || (x >= -ox(d) + m && y >= -oy(d) + m && x < d.w - ox(d) - m && y < d.h - oy(d) - m); }

/** The whole map as one coarse mesh for the far view: a vertex every `step` tiles, each at the HIGHEST ground in its block (so the pikes keep their height), lakes flat, coloured by height and lit from a fixed side. */
export interface FarMesh { cols: number; rows: number; step: number; pos: Float32Array; col: Float32Array; idx: Uint32Array }
export function lakeFarMesh(step = 8): FarMesh | null {
  const d = data; if (!d) return null;
  const cols = Math.ceil(d.w / step) + 1, rows = Math.ceil(d.h / step) + 1, n = cols * rows, hgt = new Float32Array(n), wet = new Uint8Array(n);
  const px = (i: number) => i * step - ox(d), py = (j: number) => j * step - oy(d), half = step >> 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let land = 0, water = 0, level = Infinity, tot = 0;
    for (let y = py(j) - half; y < py(j) + half; y++) for (let x = px(i) - half; x < px(i) + half; x++) {
      tot++;
      if (x < -ox(d) || y < -oy(d) || x >= d.w - ox(d) || y >= d.h - oy(d)) { water++; level = 0; continue; }   // (beyond the map: sea)
      const q = (y + oy(d)) * d.w + x + ox(d);
      if (d.water[q] === LAKE_WATER) { water++; if (d.heightM[q] < level) level = d.heightM[q]; }
      else if (d.heightM[q] > land) land = d.heightM[q];
    }
    const k = j * cols + i;
    wet[k] = water * 2 > tot ? 1 : 0;
    hgt[k] = wet[k] ? (level === Infinity ? 0 : level) : land;
  }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const H = (i: number, j: number) => hgt[Math.max(0, Math.min(rows - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))] / d.tileM * d.stretch;
  const L = [-0.55, -0.55, 0.63];   // the light: from the north-west, well up
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, m = hgt[k], h = H(i, j);
    pos[k * 3] = px(i); pos[k * 3 + 1] = py(j); pos[k * 3 + 2] = -h;
    const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), gy = (H(i, j + 1) - H(i, j - 1)) / (2 * step), nl = Math.hypot(gx, gy, 1);
    const sh = Math.max(0.55, Math.min(1.25, 0.5 + 0.9 * Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / nl)));
    let r: number, g: number, b: number;
    if (wet[k]) { r = 0.06; g = 0.42; b = 0.55; }
    else if (m < 150) { r = 0.30; g = 0.46; b = 0.13; }
    else if (m < 450) { const t = (m - 150) / 300; r = lerp(0.30, 0.40, t); g = lerp(0.46, 0.44, t); b = lerp(0.13, 0.20, t); }
    else if (m < 750) { const t = (m - 450) / 300; r = lerp(0.40, 0.52, t); g = lerp(0.44, 0.47, t); b = lerp(0.20, 0.42, t); }
    else { r = 0.60; g = 0.60; b = 0.60; }
    const s = wet[k] ? 1 : sh;
    col[k * 3] = Math.min(1, r * s); col[k * 3 + 1] = Math.min(1, g * s); col[k * 3 + 2] = Math.min(1, b * s);
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b2 = a + 1, c = a + cols, e = c + 1; idx.set([a, b2, e, a, e, c], (j * (cols - 1) + i) * 6); }
  return { cols, rows, step, pos, col, idx };
}

/** The far view's levels of detail: a fine mesh for the middle distance, a medium one beyond it and a coarse one out to the edge of the map (each is drawn only in its own ring: see WorldGL.drawFar). */
export const FAR_LOD_STEPS = [4, 12, 32] as const;
export function lakeFarLods(): FarMesh[] { return FAR_LOD_STEPS.map(st => lakeFarMesh(st)).filter((m): m is FarMesh => !!m); }
