/**
 * The terraced world ("Hills"): an infinite, seeded height field cut into flat layers, after the contour terraces of Godus.
 * Elevation is a smooth field in LAYER units (below 0 is the sea); `terraceH` turns it into stepped ground: each layer is a level shelf and the step
 * to the next is a vertical wall, standing exactly on the elevation's contour (`terraceChunkMesh` cuts the mesh along it), so the edges flow like the noise.
 *
 * Everything is a pure function of (seed, x, y). Heights are read thousands of times a frame, so a chunk's elevations are worked out once on a grid
 * of SUB points a tile (the same points the chunk's mesh is built on) and looked up from there, linearly in the grid's triangles (see `heightAt`).
 * Coordinates as the rest of the world: x east, y south, in tiles; heights in tiles (the renderer's unit).
 */

/** Tiles per chunk side (worldgen's CHUNK; repeated here so this file needs nothing from worldgen). */
const CHUNK = 16;
/** Height of one layer, in tiles. */
export const TERRACE_STEP = 0.45;
/** Grid points a tile for the height grid and the chunk mesh: 2 = every half tile, fine enough for the ledges to read as edges. */
export const TERRACE_SUB = 2;
/** Nominal real metres a layer stands for (for code that compares heights in metres, e.g. which side of a dam is uphill). */
export const TERRACE_LAYER_M = 30;
/** Layers from which the tops are bare (sand and rocks, no trees). */
export const TERRACE_BARE = 27;

// ---- noise (own copy of worldgen's hash and value noise, so the two files do not import each other) ---------------------------------

/** A lattice hash, 0..1: one multiply-xor chain over the cell and the seed, then a single avalanche (noise() calls it four times a sample, thousands of samples a chunk, so it is kept short). */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ c;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function noise(x: number, y: number, seed: number): number {   // -1..1
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const a = hash01(xi, yi, seed), b = hash01(xi, yi + 1, seed), c = hash01(xi + 1, yi, seed), d = hash01(xi + 1, yi + 1, seed);
  const x1 = a + u * (c - a), x2 = b + u * (d - b);
  return (x1 + v * (x2 - x1)) * 2 - 1;
}
const smooth = (a: number, b: number, t: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * Elevation in layers at a point (below 0 = sea). A domain warp bends everything so the contours flow; a slow "continent" field makes the
 * coast and the open sea; hills (with a ridged octave for crests) stand on the land, more of them further inland. Small and wiggly
 * detail keeps the terrace edges from tracing the noise's lattice.
 */
export function elevation(x: number, y: number, seed: number): number {
  const s = (seed ^ 0x7e77ace) | 0;
  lowAt(x, y, s, LOW_TMP, 0);
  return detailAt(x, y, s, LOW_TMP, 0);
}
/** The slow parts of the elevation (they change over tens of tiles: a chunk's grid works them out every 2 tiles and blends between): the warp (2), the continent, the big hills, the big rolls. */
const LOW_N = 5, LOW_TMP = new Float64Array(LOW_N);
function lowAt(x: number, y: number, s: number, out: Float64Array | Float32Array, o: number) {
  const dx = 26 * noise(x * 0.006, y * 0.006, s + 11), dy = 26 * noise(x * 0.006 + 31.7, y * 0.006 - 17.3, s + 12), wx = x + dx, wy = y + dy;
  out[o] = dx; out[o + 1] = dy;
  out[o + 2] = (noise(wx * 0.0032, wy * 0.0032, s + 21) + 0.5 * noise(wx * 0.0081, wy * 0.0081, s + 22)) / 1.5;   // the continent, about -0.7..0.7
  out[o + 3] = noise(wx * 0.011, wy * 0.011, s + 31);
  out[o + 4] = noise(wx * 0.022, wy * 0.022, s + 51);
}
/** The elevation from the slow parts and the quick ones, with the inland lakes laid in: a lake is a level shelf (half a layer above its whole number) with a shore of level ground round it, and its water inset one step below that shore, which then blends into the land over a stretch, so it stands in a basin and the ground falls away in steps, not in a sheer drop. */
function detailAt(x: number, y: number, s: number, lo: Float64Array | Float32Array, o: number): number {
  const base = baseAt(x, y, s, lo, o);
  lakeProbe(x, y, s);
  if (lkW <= 0) return base;
  const w = lkW, level = lkLevel, depthIn = lkDepth, deep = lkDeep, sw = lkSw;
  // The edge of the water is a smooth curve: the ground eases from the shore (half a layer over the lake's layer) down to the bed (half under) across a tile's width, centred on the rim, so the
  // whole-layer line, where the mesh is cut into a wall, lies exactly on the rim and follows it like any contour. The bed then steps down towards the middle in rings (terraces like the hills',
  // but negative): it falls one layer every `sw` tiles in from the edge, a smooth slope cut along whole-layer lines, so each step is a wall in a smooth curve, down to `deep` layers below the shore.
  const bed = level - 0.5 - Math.min(deep - 1, Math.max(0, depthIn) / sw), shore = level + 0.5;
  const into = lkWater || depthIn > -0.6 ? smooth(0, 1, (depthIn + 0.6) / 1.2) : 0;   // 0 outside the rim, 1 inside it by more than 0.6 of a tile
  const target = shore + (bed - shore) * into;
  return base + (target - base) * w;
}

// ---- inland lakes ----------------------------------------------------------------------------------------------------------------------

/**
 * Lakes of three sizes, each on its own grid of coarse cells with at most one lake a cell: big ones (a hundred tiles or so across, now and then), middling ones, and small tarns. Every lake is
 * a rough disc wholly inside its own cell (with its shore and its blend), so a point looks at one cell a scale only; the bigger scale wins where they overlap. How many cells have a lake follows
 * a slow "wetness" noise, so they gather in some regions and leave others dry, instead of standing in rows.
 *
 * A lake fills a basin: its level is the lowest shelf of the ground all round it (where it would spill), so it is never perched above lower country, and a site is turned down where the ground
 * round it is steep or runs down to the sea. The water is a disc; round it is a shore of level ground (sand) SHORE tiles wide, and past that the elevation blends back into the land over a stretch
 * that grows with the lake, so the ground falls away in a run of terraces and there is always level ground before any drop.
 */
const LAKE_SCALES = [
  { cell: 192, odds: 0.9, rMin: 14, rSpan: 14 },
  { cell: 96, odds: 1.0, rMin: 7, rSpan: 6 },
  { cell: 56, odds: 0.95, rMin: 3, rSpan: 2.5 },
] as const;
/** How far, as a multiple of its radius, a lake's odd shape (stretched, and lobed) can reach from its centre. */
const LAKE_REACH = 1.9;
const LAKE_MIN_LEVEL = 3, LAKE_SHORE = 2.6, LAKE_MAX_SPREAD = 6;
interface Lake { x: number; y: number; r: number; level: number; blend: number; deep: number; sw: number; phi: number; sa: number; p2: number; p3: number; p5: number; a2: number; a3: number; a5: number }
const LAKE_TMP = new Float64Array(LOW_N), lakeCaches = new Map<number, Map<number, Lake | null>>();
const baseDirect = (x: number, y: number, s: number): number => { lowAt(x, y, s, LAKE_TMP, 0); return baseAt(x, y, s, LAKE_TMP, 0); };
/** The lake of a cell of one scale: whether there is one (odds raised or lowered by the region's wetness), its place and radius from hashes, and its level and blend. Remembered per seed and scale. */
function lakeOfCell(si: number, cx: number, cy: number, s: number): Lake | null {
  const ck = (s + si * 1000003) | 0;
  let cache = lakeCaches.get(ck); if (!cache) { if (lakeCaches.size > 24) lakeCaches.clear(); cache = new Map(); lakeCaches.set(ck, cache); }
  const key = (cx + 32768) * 65536 + (cy + 32768); let l = cache.get(key);
  if (l !== undefined) return l;
  l = null;
  const sc = LAKE_SCALES[si], wet = (noise((cx + 0.5) * sc.cell * 0.0035, (cy + 0.5) * sc.cell * 0.0035, s + 81) + 1) / 2;
  if (hash01(cx, cy, s + 71 + si * 10) < sc.odds * (0.15 + 1.7 * wet * wet * 1.6)) {
    const r = sc.rMin + hash01(cx, cy, s + 72 + si * 10) * sc.rSpan, blend = 6 + r * 0.4, edge = r * LAKE_REACH + LAKE_SHORE + blend + 1, room = sc.cell - 2 * edge;
    for (let t = 0; t < 6 && !l && room > 2; t++) {   // a few places in the cell are tried, and the first that is a basin (see above) takes the lake
      const x = cx * sc.cell + edge + hash01(cx, cy, s + 73 + si * 10 + t * 100) * room, y = cy * sc.cell + edge + hash01(cx, cy, s + 74 + si * 10 + t * 100) * room;
      let lo = Infinity, hi = -Infinity;   // the ground on a ring just outside the shore: the lake fills up to its lowest shelf, and the ground must not be steep or run down to the sea
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = r * 1.3 + LAKE_SHORE + 1, e = baseDirect(x + Math.cos(a) * rr, y + Math.sin(a) * rr, s); lo = Math.min(lo, e); hi = Math.max(hi, e); }
      const level = Math.floor(lo);
      if (level >= LAKE_MIN_LEVEL && hi - lo <= LAKE_MAX_SPREAD) {
        const deep = Math.max(1, Math.min(level - 1, r < 6 ? 1 : r < 12 ? 2 : r < 22 ? 3 : 4)), h = (k: number) => hash01(cx, cy, s + 75 + si * 10 + k * 7);
        // an odd shape: stretched along some direction (up to 1.8 to 1), and lobed by a few harmonics round its rim, each with its own phase and a strength of its own
        l = { x, y, r, level, blend, deep, sw: Math.max(1.5, (r - 1) / deep), phi: h(1) * Math.PI, sa: Math.sqrt(1 + h(2) * 0.8), p2: h(3) * 6.283, p3: h(4) * 6.283, p5: h(5) * 6.283, a2: 0.05 + h(6) * 0.13, a3: 0.04 + h(7) * 0.12, a5: 0.02 + h(8) * 0.08 };
      }
    }
  }
  if (cache.size > 4096) cache.clear();
  cache.set(key, l);
  return l;
}
/** What the last `lakeProbe` found: how much the lake's shelf replaces the ground here (1 on the water and its shore, easing to 0 across the blend), the shelf's layer, and whether this is water or shore. */
let lkW = 0, lkLevel = 0, lkWater = false, lkShore = false, lkDepth = -1e9, lkDeep = 1, lkSw = 3;
function lakeProbe(x: number, y: number, s: number) {
  lkW = 0; lkWater = false; lkShore = false; lkDepth = -1e9;
  for (let si = 0; si < LAKE_SCALES.length; si++) {
    const c = LAKE_SCALES[si].cell, l = lakeOfCell(si, Math.floor(x / c), Math.floor(y / c), s); if (!l) continue;
    const dx = x - l.x, dy = y - l.y, far = l.r * LAKE_REACH + LAKE_SHORE + l.blend + 4;
    if (dx * dx + dy * dy > far * far) continue;
    // the distance to the rim, in the lake's own odd shape: the point is turned to the lake's long axis and squeezed to make an ellipse, then the rim is pushed in and out by lobes (harmonics of the angle) and a slow wobble
    const cs = Math.cos(l.phi), sn = Math.sin(l.phi), u = (dx * cs + dy * sn) / l.sa, v = (-dx * sn + dy * cs) * l.sa, th = Math.atan2(v, u);
    const lobes = 1 + l.a2 * Math.cos(2 * th + l.p2) + l.a3 * Math.cos(3 * th + l.p3) + l.a5 * Math.cos(5 * th + l.p5);
    const d = Math.hypot(u, v) / lobes + Math.min(1.2, l.r * 0.1) * noise(x * 0.07, y * 0.07, s + 61 + si);
    const flat = l.r + LAKE_SHORE;
    const w = d <= flat ? 1 : d >= flat + l.blend ? 0 : 1 - smooth(0, 1, (d - flat) / l.blend);
    if (w <= lkW) continue;   // (where the blend of one lake meets the water of another, the lake with the most say wins; the bigger scale on a tie)
    lkW = w; lkLevel = l.level; lkWater = d < l.r; lkShore = !lkWater && d <= flat; lkDepth = l.r - d; lkDeep = l.deep; lkSw = l.sw;
    if (w >= 1) return;
  }
}
/** The layer of the surface of the inland lake at a point (its shore's own layer: the water is flush with it), or -1 if the point is not in a lake's water. */
export const terraceLakeTopAt = (x: number, y: number, seed: number): number => { lakeProbe(x, y, (seed ^ 0x7e77ace) | 0); return lkWater ? lkLevel : -1; };
/** The layer of the surface of the inland lake over a point if the point is over the lake's water or the first half tile of its rim (so a sheet piece cut along the rim is counted), or -1. */
export const terraceLakeSheetAt = (x: number, y: number, seed: number): number => { lakeProbe(x, y, (seed ^ 0x7e77ace) | 0); return lkW >= 1 && lkDepth > -0.5 ? lkLevel : -1; };
/** Is the point (a tile's centre, say) in an inland lake's water? */
export const terraceLakeAt = (x: number, y: number, seed: number): boolean => { lakeProbe(x, y, (seed ^ 0x7e77ace) | 0); return lkWater; };
/** Is the point on the sand shore of an inland lake (the first tile or two beside its water)? */
export const terraceLakeShoreAt = (x: number, y: number, seed: number): boolean => { lakeProbe(x, y, (seed ^ 0x7e77ace) | 0); return lkShore; };

/** The elevation without the lakes: the slow parts and the quick ones (smaller hills, crests, small rolls, the wiggle along the edges). */
function baseAt(x: number, y: number, s: number, lo: Float64Array | Float32Array, o: number): number {
  const wx = x + lo[o], wy = y + lo[o + 1], cont = lo[o + 2], h1 = lo[o + 3];
  const land = smooth(-0.1, 0.3, cont);
  const h2 = noise(wx * 0.027, wy * 0.027, s + 32);
  const rg = 1 - Math.abs(noise(wx * 0.045, wy * 0.045, s + 33));
  const hills = Math.max(0, (h1 * 0.65 + h2 * 0.3 + rg * rg * 0.35 - 0.05));   // 0..~1
  const roll = lo[o + 4] * 2.2 + noise(wx * 0.06, wy * 0.06, s + 52) * 0.8;   // rolling ground everywhere on land, so a shelf is tens of tiles, not hundreds
  const wig = 0.22 * noise(x * 0.12, y * 0.12, s + 41);
  return ((cont + 0.08) * 11 + Math.pow(hills, 1.5) * 26 * land + (roll + wig) * land) * 1.5;
}

/** A hash of two whole numbers, 0..1 (the tile dither of the biome edges). */
const dither = (x: number, y: number): number => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };

/**
 * How moist a terraced world's region is, 0..1 (below 0.2 it is dry country: sand). A few hundredths of dither is mixed in tile by tile, so where one biome gives way to the next the edge is
 * stippled (a mixed band some tiles wide, in pixel art's own way of blending) instead of a smooth line cut through the hills.
 */
export const terraceMoist = (x: number, y: number, seed: number): number => (noise(x * 0.004, y * 0.004, (seed ^ 0xd00d) | 0) + 1) / 2 + (dither(x, y) - 0.5) * 0.05;

/** Each shelf is a little wetter or drier than its region says (up to 0.04), by its own layer: where the biome changes it likes to change at a ledge, so the edge follows the lie of the land, in steps, instead of cutting across it. */
const layerMoist = (layer: number): number => (dither(layer, 17.3) - 0.5) * 0.08;

/** A terraced world's biome (index into BIOME_LIST) from a tile's layer and how moist its region is (0..1). */
export function terraceBiome(layer: number, moistRaw: number): number {
  if (layer < 0) return 5;
  if (layer >= TERRACE_BARE) return 3;               // bare tops
  const moist = moistRaw + layerMoist(layer);
  if (moist < 0.2) return 3;                         // dry country: sand
  if (layer <= 4) return moist > 0.62 ? 2 : 0;       // the low shelves: wet ground or meadows
  if (layer <= 18) return moist > 0.36 ? 1 : 0;      // the hillsides: woods
  return 0;                                          // the high shelves: open, bushes and rocks
}
/** Stepped ground height in tiles for an elevation: a level shelf a layer, whole steps, nothing between; the sea and the lowest shelf are one flat sheet at 0. */
export function terraceH(e: number): number { return e < 1 ? 0 : TERRACE_STEP * Math.floor(e); }
/** The layer (shelf) of an elevation: -1 for the sea. */
export const layerOf = (e: number): number => (e < 0 ? -1 : Math.floor(e));

// ---- the band colours (shared by the maps and the far mesh; the shader has the same ramp) ---------------------------------------------

/**
 * The grass tint's stops: [layer, r, g, b], blended linearly between them (and held past the ends). The one source of the colours: `bandTint` (the maps, the far mesh) reads it,
 * and the shader's ramp is written from it (`bandGlsl`), so the three cannot drift apart. Pale and creamy low down, soft yellow-green in the middle, paler again on the tops, after Godus.
 */
export const BAND_STOPS: readonly (readonly [number, number, number, number])[] = [[0, 1.85, 1.38, 2.2], [6, 1.5, 1.24, 1.7], [15, 1.02, 1.04, 1.0], [27, 1.25, 1.14, 1.35]];
/** Every other layer is a little darker, so the bands read apart. */
export const BAND_ALT = 0.93;
/** How a layer tints the grass (see BAND_STOPS). */
export function bandTint(layer: number): [number, number, number] {
  const S = BAND_STOPS, last = S[S.length - 1];
  let r = last[1], g = last[2], b = last[3];
  if (layer <= S[0][0]) { r = S[0][1]; g = S[0][2]; b = S[0][3]; }
  else for (let i = 0; i < S.length - 1; i++) if (layer < S[i + 1][0]) {
    const t = (layer - S[i][0]) / (S[i + 1][0] - S[i][0]);
    r = S[i][1] + (S[i + 1][1] - S[i][1]) * t; g = S[i][2] + (S[i + 1][2] - S[i][2]) * t; b = S[i][3] + (S[i + 1][3] - S[i][3]) * t; break;
  }
  const alt = (layer & 1) ? BAND_ALT : 1;
  return [r * alt, g * alt, b * alt];
}
/** The same ramp as a GLSL function `vec3 bandTint(float lay)` (without the every-other-layer darkening: the shader applies that itself). */
export function bandGlsl(): string {
  const f = (v: number) => v.toFixed(4), S = BAND_STOPS;
  let c = `vec3(${f(S[0][1])}, ${f(S[0][2])}, ${f(S[0][3])})`;
  for (let i = 0; i < S.length - 1; i++) c = `mix(${c}, vec3(${f(S[i + 1][1])}, ${f(S[i + 1][2])}, ${f(S[i + 1][3])}), clamp((lay - ${f(S[i][0])}) / ${f(S[i + 1][0] - S[i][0])}, 0.0, 1.0))`;
  return `vec3 bandTint(float lay) { return ${c}; }`;
}

// ---- the field: a seed and its cached chunk grids -----------------------------------------------------------------------------------

/** The grid side of a chunk: CHUNK x SUB cells, one more point to close it. */
export const TERRACE_G = CHUNK * TERRACE_SUB + 1;
/** `base`: the natural elevation, kept only for a chunk with water laid over it (then `e` is the field with the water's flat sheets in it). */
interface Grid { e: Float32Array; base?: Float32Array }
const GRID_MAX = 900;
/**
 * The grid is worked out on a margin of GRID_M points round the chunk, so that the elevation can be opened (and closed) with the neighbours' own values at the chunk's border: both
 * chunks work out the same points the same way, and so agree. The margin must reach 2 points for each 5 x 5 filter (4 for the opening alone, 8 with the closing) and be a multiple of COARSE.
 */
/** Fill the little pits too (a closing after the opening)? It costs a wider margin: a grid takes ~1.0 ms instead of ~0.55. */
const FILL_PITS = true;
const COARSE = 4, GRID_M = FILL_PITS ? 8 : 4, GRID_W = TERRACE_G + GRID_M * 2;
/** The coarse lattice for the slow parts of the elevation, in grid points (4 = every 2 tiles); it must divide the grid's side and the margin. */
const LOW_GRID = new Float64Array(((GRID_W - 1) / COARSE + 1) ** 2 * LOW_N), LOW_PT = new Float64Array(LOW_N);
const RAW = new Float32Array(GRID_W * GRID_W), PASS = new Float32Array(GRID_W * GRID_W), PASS2 = new Float32Array(GRID_W * GRID_W);
/** A square min (erode) or max (dilate) filter of half-width 2 (a 5 x 5 window) over a GRID_W square, separably and unrolled; the window is cut short at the edges (the margin keeps that out of the chunk). */
function sweep(src: Float32Array, out: Float32Array, tmp: Float32Array, max: boolean) {
  const n = GRID_W, sg = max ? -1 : 1;   // (min of sg x value: one code for both)
  const f = (a: number, b: number) => (sg * a < sg * b ? a : b);
  for (let j = 0; j < n; j++) {
    const o = j * n;
    for (let i = 0; i < n; i++) tmp[o + i] = f(f(f(src[o + (i < 2 ? 0 : i - 2)], src[o + (i < 1 ? 0 : i - 1)]), f(src[o + i], src[o + (i > n - 2 ? n - 1 : i + 1)])), src[o + (i > n - 3 ? n - 1 : i + 2)]);
  }
  for (let j = 0; j < n; j++) {
    const o = j * n, o1 = (j < 1 ? 0 : j - 1) * n, o2 = (j < 2 ? 0 : j - 2) * n, p1 = (j > n - 2 ? n - 1 : j + 1) * n, p2 = (j > n - 3 ? n - 1 : j + 2) * n;
    for (let i = 0; i < n; i++) out[o + i] = f(f(f(tmp[o2 + i], tmp[o1 + i]), f(tmp[o + i], tmp[p1 + i])), tmp[p2 + i]);
  }
}

const fillKey = (x: number, y: number) => (x + 1048576) * 2097152 + (y + 1048576);
/** The water the weather makes (see `TerraceField.setFill`) is blurred into a smooth field before it shapes the ground: the blur's sigma in tiles, where its edge lies, and how wide the ground eases across it. */
const FILL_SIGMA = 0.5, FILL_RIM = 0.3, FILL_EASE = 0.1;
/** The normal distribution's cumulative function (an Abramowitz and Stegun error function). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export class TerraceField {
  readonly seed: number;
  private grids = new Map<number, Grid>();
  private lastKey = NaN; private last: Grid | null = null;
  private readonly max: number;
  /** `max`: how many chunk grids to keep (the game's field keeps GRID_MAX; the maps' own field keeps a few, so reading the explored chunks never pushes out the grids the screen is drawn from). */
  constructor(seed: number, max = GRID_MAX) { this.seed = seed; this.max = max; }

  /**
   * A chunk's grid: the elevation at every 1/SUB tile, TERRACE_G x TERRACE_G (row-major, y down). It is the field's elevation *opened*: eroded and dilated with a 5 x 5 window, which takes
   * off every bump narrower than 5 points (2.5 tiles), then closed (the other way round), which fills the pits as narrow. Without that, wherever the smooth field only just rises over a layer's line it leaves a tiny plateau, a little brown
   * block standing on the shelf; the opening keeps every broad terrace exactly as it was and shaves those tops off (and the tiniest islands and spits of land with them).
   */
  grid(cx: number, cy: number): Grid {
    const key = (cx + 32768) * 65536 + (cy + 32768);
    if (key === this.lastKey) return this.last!;
    let g = this.grids.get(key);
    if (!g) {
      const W = GRID_W, M = GRID_M, raw = RAW, x0 = cx * CHUNK - M / TERRACE_SUB, y0 = cy * CHUNK - M / TERRACE_SUB, s = (this.seed ^ 0x7e77ace) | 0;
      const C = COARSE, cn = (W - 1) / C + 1, lo = LOW_GRID, pt = LOW_PT;   // the slow parts on a coarse lattice (every C points), blended to each point
      for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) lowAt(x0 + (i * C) / TERRACE_SUB, y0 + (j * C) / TERRACE_SUB, s, lo, (j * cn + i) * LOW_N);
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const ci = Math.min(cn - 2, Math.floor(i / C)), cj = Math.min(cn - 2, Math.floor(j / C)), tx = i / C - ci, ty = j / C - cj;
        const a = (cj * cn + ci) * LOW_N, b = a + LOW_N, c = a + cn * LOW_N, d = c + LOW_N;
        for (let q = 0; q < LOW_N; q++) pt[q] = (lo[a + q] + (lo[b + q] - lo[a + q]) * tx) * (1 - ty) + (lo[c + q] + (lo[d + q] - lo[c + q]) * tx) * ty;
        raw[j * W + i] = detailAt(x0 + i / TERRACE_SUB, y0 + j / TERRACE_SUB, s, pt, 0);
      }
      if (FILL_PITS) { sweep(raw, PASS2, PASS, true); sweep(PASS2, raw, PASS, false); }   // dilate, then erode: a closing (fills the little pits)
      sweep(raw, PASS2, PASS, false); sweep(PASS2, raw, PASS, true);   // erode, then dilate: an opening (takes off the little bumps); last, so it is the one that is guaranteed: no block narrower than the window is left
      const n = TERRACE_G, e = new Float32Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) e[j * n + i] = raw[(j + M) * W + i + M];
      g = { e };
      if (this.fills.size) this.layFills(g, cx, cy);
      this.grids.set(key, g);
      if (this.grids.size > this.max) this.grids.delete(this.grids.keys().next().value!);
    }
    this.lastKey = key; this.last = g;
    return g;
  }
  // ---- water laid over the ground (ponds, tarns) --------------------------------------------------------------------------------------
  /** Tiles with water standing on them: the shelf (layer class) their sheet lies at. A flooded tile is lifted to that shelf, so a pond is a flat sheet. Kept apart from the noise, so the natural ground is still there to ask about. */
  private fills = new Map<number, number>();
  /** The layer of the surface of the water on each filled tile (the shelf beside it): the sheets of water lie up to it, however deep the bed. */
  private tops = new Map<number, number>();
  /** Which filled tiles are a beaver's pond (the water is tinted differently): 1; the rest 0. */
  private kinds = new Map<number, number>();
  private dirty = new Set<number>();
  /** How many filled tiles each chunk holds: a point far from any is quickly known to be dry (`waterTopAt` is asked for every piece of ground the mesh is cut into). */
  private fillChunks = new Map<number, number>();
  private fillsNear(x: number, y: number): boolean {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.fillChunks.get((cx + dx + 32768) * 65536 + (cy + dy + 32768))) return true;
    return false;
  }
  /**
   * The water tiles blurred into one smooth field at a point: `s` is how much of the point's surroundings is water (a gaussian blur of the tiles, sigma half a tile, 0 to 1), and `bed` and `top` are the
   * bed's layer and the surface's layer averaged over the water tiles by the same weights. The rim of the water is where `s` crosses FILL_RIM, so a lone tile is a small round pool, a row of tiles
   * (a beck) one smooth channel, and tiles that touch run together, instead of square pits with straight walls.
   */
  private blurAt(px: number, py: number): { s: number; bed: number; top: number; kind: number } {
    const tx0 = Math.floor(px) - 2, ty0 = Math.floor(py) - 2, wx: number[] = [], wy: number[] = [];
    for (let k = 0; k < 5; k++) { wx.push(normCdf((tx0 + k + 1 - px) / FILL_SIGMA) - normCdf((tx0 + k - px) / FILL_SIGMA)); wy.push(normCdf((ty0 + k + 1 - py) / FILL_SIGMA) - normCdf((ty0 + k - py) / FILL_SIGMA)); }
    let s = 0, bed = 0, top = 0, kind = 0;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const key = fillKey(tx0 + i, ty0 + j), b = this.fills.get(key); if (b === undefined) continue;
      const w = wx[i] * wy[j]; s += w; bed += w * b; top += w * (this.tops.get(key) ?? b + 1); kind += w * (this.kinds.get(key) ?? 0);
    }
    return s > 0 ? { s, bed: bed / s, top: top / s, kind: kind / s } : { s: 0, bed: 0, top: 0, kind: 0 };
  }
  /** Lay the water over a chunk's grid, keeping the natural elevation in `base`: where the blurred water field is past the rim, the ground eases down to the bed (half a layer above the bed's layer); the whole-layer line, where the mesh becomes a wall, falls on the rim. */
  private layFills(g: Grid, cx: number, cy: number) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK, n = TERRACE_G; let any = false;
    if (g.base) g.e.set(g.base);
    const todo = new Set<number>();
    for (let ty = y0 - 3; ty <= y0 + CHUNK + 2; ty++) for (let tx = x0 - 3; tx <= x0 + CHUNK + 2; tx++) {
      if (!this.fills.has(fillKey(tx, ty))) continue;
      if (!any) { any = true; g.base ??= g.e.slice(); }
      for (let dj = -3; dj <= TERRACE_SUB + 3; dj++) for (let di = -3; di <= TERRACE_SUB + 3; di++) {   // the points within a tile and a half of it
        const i = (tx - x0) * TERRACE_SUB + di, j = (ty - y0) * TERRACE_SUB + dj;
        if (i >= 0 && i < n && j >= 0 && j < n) todo.add(j * n + i);
      }
    }
    for (const k of todo) {
      const i = k % n, j = (k - i) / n, f = this.blurAt(x0 + i / TERRACE_SUB, y0 + j / TERRACE_SUB);
      if (f.s <= FILL_RIM - FILL_EASE) continue;
      const ease = smooth(0, 1, (f.s - (FILL_RIM - FILL_EASE)) / (2 * FILL_EASE)), bed = f.bed + 0.5;
      g.e[k] += (bed - g.e[k]) * ease;
    }
    if (!any && g.base) { g.base = undefined; }
  }
  /**
   * Put water on these tiles at a shelf (a layer class: the sheet lies at that layer's height), or take it off (null). The chunks it touches are patched in place and noted as changed
   * (`takeDirty`), so the renderer builds their meshes again; `heightAt` follows at once.
   */
  setFill(tiles: readonly (readonly [number, number])[], cls: number | null, top?: number, kind = 0) {
    const touched = new Set<number>();
    for (const [x, y] of tiles) {
      const k = fillKey(x, y);
      const ck = (Math.floor(x / CHUNK) + 32768) * 65536 + (Math.floor(y / CHUNK) + 32768);
      if (cls === null) { if (!this.fills.delete(k)) continue; this.tops.delete(k); this.kinds.delete(k); this.fillChunks.set(ck, (this.fillChunks.get(ck) ?? 1) - 1); } else { if (!this.fills.has(k)) this.fillChunks.set(ck, (this.fillChunks.get(ck) ?? 0) + 1); const t = top ?? cls + 1; if (this.fills.get(k) === cls && this.tops.get(k) === t && (this.kinds.get(k) ?? 0) === kind) continue; this.fills.set(k, cls); this.tops.set(k, t); if (kind) this.kinds.set(k, kind); else this.kinds.delete(k); }
      for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) touched.add(((Math.floor((x + dx) / CHUNK) + 32768) * 65536) + (Math.floor((y + dy) / CHUNK) + 32768));   // (the blur reaches two tiles: every chunk within three)
    }
    for (const key of touched) {
      this.dirty.add(key);
      const g = this.grids.get(key); if (g) this.layFills(g, Math.floor(key / 65536) - 32768, (key % 65536) - 32768);
    }
    this.lastKey = NaN;
  }
  /** The chunks whose ground changed under water since the last call, as [cx, cy]. */
  takeDirty(): [number, number][] {
    const out = [...this.dirty].map(k => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768] as [number, number]);
    this.dirty.clear();
    return out;
  }
  /** The layer of the surface of inland water at a point (a lake, a beck, a tarn, a pond: the layer of the shore beside it), or -1 if there is none: where the renderer lays translucent sheets of water, down to the bed. */
  waterTopAt(x: number, y: number): number {
    if (this.fills.size && this.fillsNear(x, y)) { const f = this.blurAt(x, y); if (f.s >= FILL_RIM - 0.03) return Math.round(f.top); }
    return terraceLakeSheetAt(x, y, this.seed);
  }
  /** `waterTopAt`, plus a quarter if the water here is a beaver's pond (for the mesh, which tints those sheets). */
  waterSheetAt(x: number, y: number): number {
    if (this.fills.size && this.fillsNear(x, y)) { const f = this.blurAt(x, y); if (f.s >= FILL_RIM - 0.03) return Math.round(f.top) + (f.kind > 0.5 ? 0.5 : 0); }
    return terraceLakeSheetAt(x, y, this.seed);
  }
  /** The elevation at a tile's centre without any water over it: what a pond measures the ground by. */
  naturalAt(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), g = this.grid(cx, cy), a = g.base ?? g.e;
    return a[((y - cy * CHUNK) * TERRACE_SUB + 1) * TERRACE_G + (x - cx * CHUNK) * TERRACE_SUB + 1];
  }
  /** Is this chunk's grid cached? */
  has(cx: number, cy: number): boolean { return this.grids.has((cx + 32768) * 65536 + (cy + 32768)); }
  /** Build the grids of these chunks that are not cached yet, nearest first as given, for up to `ms`: worked out a little a frame ahead of the plane, so a new chunk's tiles and mesh find their grids (and its neighbours') already there. Returns how many it built. */
  prewarm(list: readonly (readonly [number, number])[], ms: number): number {
    const t0 = performance.now(); let n = 0;
    for (const [cx, cy] of list) { if (performance.now() - t0 >= ms) break; if (this.has(cx, cy)) continue; this.grid(cx, cy); n++; }
    return n;
  }
  /**
   * The elevation at a point: linear in the grid's triangles, each cell cut along its top-left to bottom-right diagonal (the same triangles `terraceChunkMesh` draws, so what you stand on
   * is what you see).
   */
  elevationNear(px: number, py: number): number {
    const gx = px * TERRACE_SUB, gy = py * TERRACE_SUB, ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy;
    const span = CHUNK * TERRACE_SUB, cx = Math.floor(ix / span), cy = Math.floor(iy / span), g = this.grid(cx, cy).e;
    const li = ix - cx * span, lj = iy - cy * span, k = lj * TERRACE_G + li;
    const a = g[k], b = g[k + 1], c = g[k + TERRACE_G], d = g[k + TERRACE_G + 1];
    return tx >= ty ? a + (b - a) * tx + (d - b) * ty : a + (d - c) * tx + (c - a) * ty;
  }
  /** How many times `heightAt` has been called (for the ?perf readout: how hard the hot path is hit). */
  calls = 0;
  /** Ground height in tiles at a point: the stepped height of the elevation there (a wall is a jump, not a slope). */
  heightAt(px: number, py: number): number { this.calls++; return terraceH(this.elevationNear(px, py)); }
  /** Elevation at a tile's centre, from the grid (the centre is a grid point). */
  elevationAt(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), g = this.grid(cx, cy).e;
    return g[((y - cy * CHUNK) * TERRACE_SUB + 1) * TERRACE_G + (x - cx * CHUNK) * TERRACE_SUB + 1];
  }
  /** The layer of a tile (-1 = sea). */
  layerAt(x: number, y: number): number { return layerOf(this.elevationAt(x, y)); }
  /** The layer of a tile straight from the noise, nothing cached: for maps that read far more tiles than the game keeps. */
  layerDirect(x: number, y: number): number { return layerOf(elevation(x + 0.5, y + 0.5, this.seed)); }
}

/** Is a tile on a ledge (a neighbour on another layer)? Trees and rocks keep off these: they would hang over the edge. */
export const onLedge = (layer: (x: number, y: number) => number, x: number, y: number): boolean => {
  const l = layer(x, y);
  return layer(x + 1, y) !== l || layer(x - 1, y) !== l || layer(x, y + 1) !== l || layer(x, y - 1) !== l;
};

/** Where a new terraced world starts: the nearest tile (spiralling out from the middle) on a low shelf, away from any ledge. */
export function terraceSpawn(seed: number): { x: number; y: number } {
  const f = new TerraceField(seed), lay = (x: number, y: number) => f.layerDirect(x, y);
  for (let r = 0; r < 4000; r += 4) {
    const n = Math.max(1, Math.floor(r * 0.8));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r), l = lay(x, y);
      if (l >= 2 && l <= 10 && !terraceLakeAt(x + 0.5, y + 0.5, seed) && terraceMoist(x, y, seed) > 0.3 && !onLedge(lay, x, y) && !onLedge(lay, x + 1, y) && !onLedge(lay, x, y + 1) && !onLedge(lay, x - 1, y) && !onLedge(lay, x, y - 1)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

// ---- the chunk mesh -------------------------------------------------------------------------------------------------------------------

/** A terraced chunk's ground: positions (z is minus the height, the renderer's axis), unit normals, and triangle indices. */
export interface TerraceMesh { pos: Float32Array; nrm: Float32Array; idx: Uint32Array; sub: Uint8Array; wpos: Float32Array; widx: Uint32Array; wkind: Uint8Array }
/** The most sheets of water stacked over one tile (one a layer from the bed to the surface): each is see-through, so the deeper the bed, the darker the water over it. */
export const WATER_SHEETS_MAX = 5;

/**
 * A chunk's ground as right-angled terraces. The elevation grid is a mesh of triangles over which the elevation is linear, so a contour (where it crosses a whole layer) is a straight
 * cut through a triangle, and the cuts of neighbouring triangles join into the smooth flowing edge of the noise. Each triangle is cut along the contours that cross it into level pieces,
 * every piece at its own layer's height, and a vertical wall is stood on each cut, from the shelf below to the shelf above. A triangle that no contour crosses is just two of the grid's own
 * vertices and a third, shared with the neighbours (the grid's points are the first TERRACE_G^2 vertices), so flat country costs next to nothing. Chunks join without a crack: they cut the
 * same edge of the same two grid points the same way.
 */
/** `waterTop(x, y)` gives the layer of the surface of inland water at a point (-1 for none), plus a quarter if it is a beaver's pond. */
export function terraceChunkMesh(e: Float32Array, cx: number, cy: number, waterTop?: (x: number, y: number) => number, groundAt?: (x: number, y: number) => number): TerraceMesh {
  const G = TERRACE_G, st = 1 / TERRACE_SUB, x0 = cx * CHUNK, y0 = cy * CHUNK;
  let pos = new Float32Array(G * G * 6 + 4096), nrm = new Float32Array(pos.length), sub = new Uint8Array(pos.length / 3), vn = 0;
  let idx = new Uint32Array(G * G * 6 + 4096), tn = 0;
  const vert = (x: number, y: number, h: number, nx: number, ny: number, nz: number, under = 0): number => {
    if ((vn + 1) * 3 > pos.length) { const p = new Float32Array(pos.length * 2), q = new Float32Array(pos.length * 2), u = new Uint8Array(pos.length * 2 / 3); p.set(pos); q.set(nrm); u.set(sub); pos = p; nrm = q; sub = u; }
    sub[vn] = under;
    pos[vn * 3] = x; pos[vn * 3 + 1] = y; pos[vn * 3 + 2] = -h; nrm[vn * 3] = nx; nrm[vn * 3 + 1] = ny; nrm[vn * 3 + 2] = nz;
    return vn++;
  };
  const tri = (a: number, b: number, c: number) => {
    if (tn + 3 > idx.length) { const q = new Uint32Array(idx.length * 2); q.set(idx); idx = q; }
    idx[tn++] = a; idx[tn++] = b; idx[tn++] = c;
  };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) vert(x0 + i * st, y0 + j * st, terraceH(e[j * G + i]), 0, 0, -1);
  const cls = (v: number) => (v < 1 ? 0 : Math.floor(v));
  // the sheets of inland water (a lake, a beck, a tarn, a pond): over each piece of ground that lies under water (the callback says, at the piece's middle, the layer of the surface there, or -1),
  // a copy at each layer from just over the piece up to the surface, so the water is flush with the ground beside it and, being see-through, shows the bed and the foot of the walls; the more
  // layers (the deeper the bed), the darker it is. The sheets are cut from the same pieces as the ground, so their edge is the smooth curve of the bed's own wall.
  const wp: number[] = [], wi: number[] = [], wk: number[] = [];
  let kindNow = 0;   // (what the last sheetTop found: 0 for a lake, a beck, a tarn; 1 for a beaver's pond, which is tinted differently)
  const sheetTop = (pts: number[][]): number => {
    if (!waterTop) return -1;
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; }
    const v = waterTop(mx / pts.length, my / pts.length), top = Math.floor(v + 1e-9);
    kindNow = v - top > 0.25 ? 1 : 0;
    return top;
  };
  const ground = groundAt ?? ((x: number, y: number): number => {   // the ground's height at a point, from this chunk's own grid when the caller gave none (clamped to the chunk: beyond it the nearest edge)
    const gx = Math.max(0, Math.min(G - 1 - 1e-6, (x - x0) / st)), gy = Math.max(0, Math.min(G - 1 - 1e-6, (y - y0) / st)), ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy, k = iy * G + ix;
    const ea = e[k], eb = e[k + 1], ec = e[k + G], ed = e[k + G + 1];
    return terraceH(tx >= ty ? ea + (eb - ea) * tx + (ed - eb) * ty : ea + (ed - ec) * tx + (ec - ea) * ty);
  });
  /** The open sides of a sheet: along each edge of a piece of water where the water beside it (or, with none, the ground) lies lower than this surface, a curtain of falling water hangs from the one down to the other, facing outward. It does not depend on a wall standing there: on level ground the water's edge simply ends. */
  const falls = (pts: number[][], top: number) => {
    let cxm = 0, cym = 0; for (const p of pts) { cxm += p[0]; cym += p[1]; } cxm /= pts.length; cym /= pts.length;
    const surf = TERRACE_STEP * top;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1e-4) continue;
      let nx = dy / len, ny = -dx / len; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (nx * (mx - cxm) + ny * (my - cym) < 0) { nx = -nx; ny = -ny; }   // (outward: away from the piece's middle)
      const ox = mx + nx * 0.08, oy = my + ny * 0.08, v = waterTop!(ox, oy), tp = v < 0 ? -1 : Math.floor(v + 1e-9);
      if (tp === top) continue;   // (the same water on the other side: nothing falls)
      const g = ground(ox, oy), low = tp >= 0 && g < TERRACE_STEP * tp - 1e-6 ? TERRACE_STEP * tp : g;
      if (low >= surf - 1e-6) continue;   // (the water beside it is as high, or a bank stands as high: it is held)
      const o = 0.02, ex = dx / len * 0.03, ey = dy / len * 0.03, b0 = wp.length / 3;
      const ax = a[0] - ex + nx * o, ay = a[1] - ey + ny * o, bx = b[0] + ex + nx * o, by = b[1] + ey + ny * o;   // (a hair outward of the edge, and a hair longer at each end, so neighbouring curtains overlap round a bend)
      wp.push(ax, ay, -low, bx, by, -low, bx, by, -surf, ax, ay, -surf);
      const dir = 2 + Math.round((Math.atan2(ny, nx) + Math.PI) / (2 * Math.PI) * 250);   // (kind 2 and up marks a curtain, and says which way it faces in 250 steps of the compass: the renderer draws it only to a viewer in front of it)
      wk.push(dir, dir, dir, dir); wi.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
  };
  const sheets = (pts: number[][], bed: number, top: number) => {
    if (top === 0) {   // water on the beach shelf, which cannot be sunk below the sea: a thin film just over the ground
      const b = wp.length / 3;
      for (const p of pts) { wp.push(p[0], p[1], -TERRACE_STEP * 0.18); wk.push(kindNow); }
      for (let k = 2; k < pts.length; k++) wi.push(b, b + k - 1, b + k);
      return;
    }
    for (let L = Math.max(bed + 1, top - WATER_SHEETS_MAX + 1); L <= top; L++) {
      const b = wp.length / 3;
      for (const p of pts) { wp.push(p[0], p[1], -TERRACE_STEP * L); wk.push(kindNow); }
      for (let k = 2; k < pts.length; k++) wi.push(b, b + k - 1, b + k);
    }
    if (waterTop) falls(pts, top);
  };
  // the polygon being cut: x, y, e of each corner (at most 3 + one per cut)
  type P = [number, number, number][];
  const clip = (poly: P, t: number, above: boolean): P => {   // keep the part with e >= t (above) or e < t
    const out: P = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length], pin = above ? p[2] >= t : p[2] < t, qin = above ? q[2] >= t : q[2] < t;
      if (pin) out.push(p);
      if (pin !== qin) { const s = (t - p[2]) / (q[2] - p[2]); out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, t]); }
    }
    return out;
  };
  const cut = (x1: number, y1: number, e1: number, x2: number, y2: number, e2: number, x3: number, y3: number, e3: number) => {
    const lo = Math.min(e1, e2, e3), hi = Math.max(e1, e2, e3), tMin = lo < 1 ? 1 : Math.floor(lo) + 1, tMax = Math.floor(hi);
    const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(det) < 1e-12) return;
    const gx = ((e2 - e1) * (y3 - y1) - (e3 - e1) * (y2 - y1)) / det, gy = ((e3 - e1) * (x2 - x1) - (e2 - e1) * (x3 - x1)) / det, gl = Math.hypot(gx, gy) || 1;
    const wx = -gx / gl, wy = -gy / gl;   // a wall faces downhill
    const T = tMax - tMin + 1;   // the contours that cross this triangle: tMin .. tMax
    for (let m = 0; m <= T; m++) {   // the pieces: below tMin, between each pair of contours, from tMax up
      let poly: P = [[x1, y1, e1], [x2, y2, e2], [x3, y3, e3]];
      if (m > 0) poly = clip(poly, tMin + m - 1, true);
      if (m < T && poly.length) poly = clip(poly, tMin + m, false);
      if (poly.length < 3) continue;
      let area = 0; for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
      if (Math.abs(area) < 1e-9) continue;
      const h = m === 0 ? terraceH(lo) : TERRACE_STEP * (tMin + m - 1), bedL = Math.round(h / TERRACE_STEP), top = sheetTop(poly), under = top >= 0 && (bedL < top || top === 0) ? 1 : 0, v0 = vert(poly[0][0], poly[0][1], h, 0, 0, -1, under);
      let prev = vert(poly[1][0], poly[1][1], h, 0, 0, -1, under);
      for (let k = 2; k < poly.length; k++) { const cur = vert(poly[k][0], poly[k][1], h, 0, 0, -1, under); tri(v0, prev, cur); prev = cur; }
      if (under) sheets(poly, bedL, top);
    }
    for (let t = tMin; t <= tMax; t++) {   // a wall on each contour: the two points where it leaves the triangle
      const q: number[] = [], xs = [x1, x2, x3], ys = [y1, y2, y3], es = [e1, e2, e3];
      for (let k = 0; k < 3; k++) {
        const a = k, b = (k + 1) % 3;
        if ((es[a] < t) !== (es[b] < t)) { const s = (t - es[a]) / (es[b] - es[a]); q.push(xs[a] + (xs[b] - xs[a]) * s, ys[a] + (ys[b] - ys[a]) * s); }
      }
      if (q.length < 4 || Math.hypot(q[0] - q[2], q[1] - q[3]) < 1e-6) continue;
      const top = TERRACE_STEP * t, bot = t === 1 ? 0 : TERRACE_STEP * (t - 1);
      const a = vert(q[0], q[1], bot, wx, wy, 0), b = vert(q[2], q[3], bot, wx, wy, 0), c = vert(q[2], q[3], top, wx, wy, 0), d = vert(q[0], q[1], top, wx, wy, 0);
      tri(a, b, c); tri(a, c, d);
    }
  };
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
    const a = j * G + i, b = a + 1, c = a + G, d = c + 1;
    for (let half = 0; half < 2; half++) {   // (a, b, d) and (a, d, c): the triangles `elevationNear` reads
      const p = half === 0 ? [a, b, d] : [a, d, c], e1 = e[p[0]], e2 = e[p[1]], e3 = e[p[2]];
      const xy = (k: number) => [x0 + (k % G) * st, y0 + Math.floor(k / G) * st];
      if (cls(e1) === cls(e2) && cls(e2) === cls(e3)) {
        tri(p[0], p[1], p[2]);
        if (waterTop) { const pts = [xy(p[0]), xy(p[1]), xy(p[2])], top = sheetTop(pts), bedL = cls(e1); if (top >= 0 && (bedL < top || top === 0)) { sub[p[0]] = sub[p[1]] = sub[p[2]] = 1; sheets(pts, bedL, top); } }
        continue;
      }
      const [xa, ya] = xy(p[0]), [xb, yb] = xy(p[1]), [xc, yc] = xy(p[2]);
      cut(xa, ya, e1, xb, yb, e2, xc, yc, e3);
    }
  }
  return { pos: pos.slice(0, vn * 3), nrm: nrm.slice(0, vn * 3), idx: idx.slice(0, tn), sub: sub.slice(0, vn), wpos: new Float32Array(wp), widx: new Uint32Array(wi), wkind: new Uint8Array(wk) };
}

// ---- far view -------------------------------------------------------------------------------------------------------------------------

/** The far view's base colour of grass by biome (index into BIOME_LIST): grassland, forest, wetland; the tint of the layer is multiplied in. */
const BIOME_FAR: [number, number, number][] = [[0.30, 0.46, 0.13], [0.13, 0.31, 0.11], [0.22, 0.40, 0.25]];

export interface TerraceFarMesh { cols: number; rows: number; step: number; cx: number; cy: number; pos: Float32Array; col: Float32Array; idx: Uint32Array }

/**
 * A coarse mesh for the far view, `step` tiles a vertex, `half` tiles each way from (cx, cy), coloured by band and lit from the north-west. With `stepped` the heights are the
 * terraces' own (`terraceH`), so near hills keep their shelves and ledges and meet the real chunks without a change of shape; without it they are the smooth elevation
 * (past a few hundred tiles the terraces are finer than a vertex). Built a few rows at a time (a generator), so building one never stalls a frame; the last value it yields is the mesh.
 */
export function* terraceFarMesh(seed: number, cx: number, cy: number, step: number, half: number, stepped = false): Generator<null, TerraceFarMesh, void> {
  const cols = Math.floor((half * 2) / step) + 1, rows = cols, n = cols * rows, x0 = cx - half, y0 = cy - half;
  const ev = new Float32Array(n);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) ev[j * cols + i] = elevation(x0 + i * step, y0 + j * step, seed);
    if ((j & 1) === 1) yield null;
  }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const H = (i: number, j: number) => { const e = ev[Math.max(0, Math.min(rows - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))]; return e <= 0 ? 0 : stepped ? terraceH(e) : e * TERRACE_STEP; };
  const L = [-0.55, -0.55, 0.63];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, e = ev[k], h = H(i, j);
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = y0 + j * step; pos[k * 3 + 2] = -h;
      let r: number, g: number, b: number;
      if (e < 0 || terraceLakeAt(x0 + i * step, y0 + j * step, seed)) { r = 0.06; g = 0.42; b = 0.55; }
      else {
        const lay = Math.floor(e), bio = terraceBiome(lay, terraceMoist(x0 + i * step, y0 + j * step, seed));   // (the biome of the land here, so the far hills carry the colour of the woods, the wetland and the dry country, as the near ground does)
        if (lay === 0 || bio === 3) { const a = (lay & 1) ? 0.93 : 1; r = 0.91 * a; g = 0.78 * a; b = 0.54 * a; }
        else { const t = bandTint(lay), c = BIOME_FAR[bio] ?? BIOME_FAR[0]; r = c[0] * t[0]; g = c[1] * t[1]; b = c[2] * t[2]; }
        const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), gy = (H(i, j + 1) - H(i, j - 1)) / (2 * step), nl = Math.hypot(gx, gy, 1);
        const sh = Math.max(0.55, Math.min(1.25, 0.5 + 0.9 * Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / nl)));
        r *= sh; g *= sh; b *= sh;
      }
      col[k * 3] = Math.min(1, r); col[k * 3 + 1] = Math.min(1, g); col[k * 3 + 2] = Math.min(1, b);
    }
    if ((j & 3) === 3) yield null;
  }
  return { cols, rows, step, cx, cy, pos, col, idx: farIndices(cols) };
}
/** The triangle indices of a cols x cols far mesh: the same for every mesh of that size, so they are made once and shared (the renderer keeps one GPU buffer for them too). */
const IDX_CACHE = new Map<number, Uint32Array>();
function farIndices(cols: number): Uint32Array {
  let idx = IDX_CACHE.get(cols);
  if (!idx) {
    idx = new Uint32Array((cols - 1) * (cols - 1) * 6);
    for (let j = 0; j < cols - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b2 = a + 1, c = a + cols, e = c + 1; idx.set([a, b2, e, a, e, c], (j * (cols - 1) + i) * 6); }
    IDX_CACHE.set(cols, idx);
  }
  return idx;
}
/** The far levels for a terraced world: fine, medium, coarse (step, half-size in tiles, and how far the eye may move before it is rebuilt). */
export const TERRACE_FAR_LODS = [{ step: 5, half: 1000, moveBy: 200, stepped: true }, { step: 12, half: 2400, moveBy: 480, stepped: false }, { step: 32, half: 4000, moveBy: 800, stepped: false }] as const;
