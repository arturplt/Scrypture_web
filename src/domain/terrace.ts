/**
 * The terraced world ("Hills"): an infinite, seeded height field cut into flat layers, after the contour terraces of Godus.
 * Elevation is a smooth field in LAYER units (below 0 is the sea); `terraceH` turns it into stepped ground: each layer is a level shelf, and the
 * last sliver of every layer (`W`) rises steeply to the next, so the edges follow the noise's flowing contours.
 *
 * Everything is a pure function of (seed, x, y). Heights are read thousands of times a frame, so a chunk's heights are worked out once on a grid
 * of SUB points a tile (the same points the chunk's mesh is built on) and looked up from there, bilinearly, like the Lake District's corner grid.
 * Coordinates as the rest of the world: x east, y south, in tiles; heights in tiles (the renderer's unit).
 */

/** Tiles per chunk side (worldgen's CHUNK; repeated here so this file needs nothing from worldgen). */
const CHUNK = 16;
/** Height of one layer, in tiles. */
export const TERRACE_STEP = 0.45;
/** The share of each layer (of its elevation range) that is the ledge up to the next: the rest is the level shelf. */
const W = 0.3;
/** Grid points a tile for the height grid and the chunk mesh: 2 = every half tile, fine enough for the ledges to read as edges. */
export const TERRACE_SUB = 2;
/** Nominal real metres a layer stands for (for code that compares heights in metres, e.g. which side of a dam is uphill). */
export const TERRACE_LAYER_M = 30;
/** Layers from which the tops are bare (sand and rocks, no trees). */
export const TERRACE_BARE = 27;

// ---- noise (own copy of worldgen's hash and value noise, so the two files do not import each other) ---------------------------------

function hash01(a: number, b: number, c = 0, d = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ Math.imul(d | 0, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
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
/** The elevation from the slow parts and the quick ones (smaller hills, crests, small rolls, the wiggle along the edges). */
function detailAt(x: number, y: number, s: number, lo: Float64Array | Float32Array, o: number): number {
  const wx = x + lo[o], wy = y + lo[o + 1], cont = lo[o + 2], h1 = lo[o + 3];
  const land = smooth(-0.1, 0.3, cont);
  const h2 = noise(wx * 0.027, wy * 0.027, s + 32);
  const rg = 1 - Math.abs(noise(wx * 0.045, wy * 0.045, s + 33));
  const hills = Math.max(0, (h1 * 0.65 + h2 * 0.3 + rg * rg * 0.35 - 0.05));   // 0..~1
  const roll = lo[o + 4] * 2.2 + noise(wx * 0.06, wy * 0.06, s + 52) * 0.8;   // rolling ground everywhere on land, so a shelf is tens of tiles, not hundreds
  const wig = 0.22 * noise(x * 0.12, y * 0.12, s + 41);
  return ((cont + 0.08) * 11 + Math.pow(hills, 1.5) * 26 * land + (roll + wig) * land) * 1.5;
}

/** How moist a terraced world's region is, 0..1 (below 0.2 it is dry country: sand). */
export const terraceMoist = (x: number, y: number, seed: number): number => (noise(x * 0.004, y * 0.004, (seed ^ 0xd00d) | 0) + 1) / 2;

/** Stepped ground height in tiles for an elevation: a level shelf per layer, a steep rounded ledge at its end; the sea is a flat sheet at 0. */
export function terraceH(e: number): number {
  if (e <= 0) return 0;
  const L = Math.floor(e), f = e - L;
  return TERRACE_STEP * (L + smooth(1 - W, 1, f));
}
/** The layer (shelf) of an elevation: -1 for the sea. */
export const layerOf = (e: number): number => (e < 0 ? -1 : Math.floor(e));

// ---- the band colours (shared by the maps and the far mesh; the shader has the same ramp) ---------------------------------------------

/** How a layer tints the grass: warm and yellow low down, rich green in the middle, paler on the tops; every other layer a little darker so the bands read apart. */
export function bandTint(layer: number): [number, number, number] {
  const S: [number, number, number, number][] = [[0, 1.32, 1.22, 0.78], [6, 1.12, 1.14, 0.84], [15, 0.92, 1.02, 0.96], [27, 1.18, 1.12, 1.06]];
  let r = S[S.length - 1][1], g = S[S.length - 1][2], b = S[S.length - 1][3];
  if (layer <= S[0][0]) { r = S[0][1]; g = S[0][2]; b = S[0][3]; }
  else for (let i = 0; i < S.length - 1; i++) if (layer < S[i + 1][0]) {
    const t = (layer - S[i][0]) / (S[i + 1][0] - S[i][0]);
    r = S[i][1] + (S[i + 1][1] - S[i][1]) * t; g = S[i][2] + (S[i + 1][2] - S[i][2]) * t; b = S[i][3] + (S[i + 1][3] - S[i][3]) * t; break;
  }
  const alt = (layer & 1) ? 0.93 : 1;
  return [r * alt, g * alt, b * alt];
}

// ---- the field: a seed and its cached chunk grids -----------------------------------------------------------------------------------

/** The grid side of a chunk: CHUNK x SUB cells, one more point to close it. */
export const TERRACE_G = CHUNK * TERRACE_SUB + 1;
interface Grid { h: Float32Array; e: Float32Array }
const GRID_MAX = 900;
/** The coarse lattice for the slow parts of the elevation, in grid points (4 = every 2 tiles); it must divide the grid's side. */
const COARSE = 4, LOW_GRID = new Float64Array(((CHUNK * TERRACE_SUB) / COARSE + 1) ** 2 * LOW_N), LOW_PT = new Float64Array(LOW_N);

export class TerraceField {
  readonly seed: number;
  private grids = new Map<number, Grid>();
  private lastKey = NaN; private last: Grid | null = null;
  constructor(seed: number) { this.seed = seed; }

  /** A chunk's grid: elevation and stepped height at every 1/SUB tile, TERRACE_G x TERRACE_G (row-major, y down). */
  grid(cx: number, cy: number): Grid {
    const key = (cx + 32768) * 65536 + (cy + 32768);
    if (key === this.lastKey) return this.last!;
    let g = this.grids.get(key);
    if (!g) {
      const n = TERRACE_G, h = new Float32Array(n * n), e = new Float32Array(n * n), x0 = cx * CHUNK, y0 = cy * CHUNK, s = (this.seed ^ 0x7e77ace) | 0;
      const C = COARSE, cn = (n - 1) / C + 1, lo = LOW_GRID, pt = LOW_PT;   // the slow parts on a coarse lattice (every C points), blended to each point
      for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) lowAt(x0 + (i * C) / TERRACE_SUB, y0 + (j * C) / TERRACE_SUB, s, lo, (j * cn + i) * LOW_N);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const ci = Math.min(cn - 2, Math.floor(i / C)), cj = Math.min(cn - 2, Math.floor(j / C)), tx = i / C - ci, ty = j / C - cj;
        const a = (cj * cn + ci) * LOW_N, b = a + LOW_N, c = a + cn * LOW_N, d = c + LOW_N;
        for (let q = 0; q < LOW_N; q++) pt[q] = (lo[a + q] + (lo[b + q] - lo[a + q]) * tx) * (1 - ty) + (lo[c + q] + (lo[d + q] - lo[c + q]) * tx) * ty;
        const v = detailAt(x0 + i / TERRACE_SUB, y0 + j / TERRACE_SUB, s, pt, 0);
        e[j * n + i] = v; h[j * n + i] = terraceH(v);
      }
      g = { h, e };
      this.grids.set(key, g);
      if (this.grids.size > GRID_MAX) this.grids.delete(this.grids.keys().next().value!);
    }
    this.lastKey = key; this.last = g;
    return g;
  }
  /** Ground height in tiles at a point: bilinear between the grid points, which is what the chunk mesh draws. */
  heightAt(px: number, py: number): number {
    const gx = px * TERRACE_SUB, gy = py * TERRACE_SUB, ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy;
    const span = CHUNK * TERRACE_SUB, cx = Math.floor(ix / span), cy = Math.floor(iy / span), g = this.grid(cx, cy).h;
    const li = ix - cx * span, lj = iy - cy * span, k = lj * TERRACE_G + li;
    const a = g[k], b = g[k + 1], c = g[k + TERRACE_G], d = g[k + TERRACE_G + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
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
      if (l >= 2 && l <= 10 && terraceMoist(x, y, seed) > 0.3 && !onLedge(lay, x, y) && !onLedge(lay, x + 1, y) && !onLedge(lay, x, y + 1) && !onLedge(lay, x - 1, y) && !onLedge(lay, x, y - 1)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

// ---- far view -------------------------------------------------------------------------------------------------------------------------

export interface TerraceFarMesh { cols: number; rows: number; step: number; cx: number; cy: number; pos: Float32Array; col: Float32Array; idx: Uint32Array }

/**
 * A coarse mesh for the far view, `step` tiles a vertex, `half` tiles each way from (cx, cy): heights from the smooth elevation (terraces are
 * finer than a vertex this far out), coloured by band and lit from the north-west. Built a few rows at a time (a generator), so building one
 * never stalls a frame; the last value it yields is the mesh.
 */
export function* terraceFarMesh(seed: number, cx: number, cy: number, step: number, half: number): Generator<null, TerraceFarMesh, void> {
  const cols = Math.floor((half * 2) / step) + 1, rows = cols, n = cols * rows, x0 = cx - half, y0 = cy - half;
  const ev = new Float32Array(n);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) ev[j * cols + i] = elevation(x0 + i * step, y0 + j * step, seed);
    if ((j & 7) === 7) yield null;
  }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const H = (i: number, j: number) => { const e = ev[Math.max(0, Math.min(rows - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))]; return e <= 0 ? 0 : e * TERRACE_STEP; };
  const L = [-0.55, -0.55, 0.63];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, e = ev[k], h = H(i, j);
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = y0 + j * step; pos[k * 3 + 2] = -h;
      let r: number, g: number, b: number;
      if (e < 0) { r = 0.06; g = 0.42; b = 0.55; }
      else {
        const lay = Math.floor(e);
        if (lay === 0 || lay >= TERRACE_BARE) { const a = (lay & 1) ? 0.93 : 1; r = 0.91 * a; g = 0.78 * a; b = 0.54 * a; }
        else { const t = bandTint(lay); r = 0.30 * t[0]; g = 0.46 * t[1]; b = 0.13 * t[2]; }
        const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), gy = (H(i, j + 1) - H(i, j - 1)) / (2 * step), nl = Math.hypot(gx, gy, 1);
        const sh = Math.max(0.55, Math.min(1.25, 0.5 + 0.9 * Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / nl)));
        r *= sh; g *= sh; b *= sh;
      }
      col[k * 3] = Math.min(1, r); col[k * 3 + 1] = Math.min(1, g); col[k * 3 + 2] = Math.min(1, b);
    }
    if ((j & 15) === 15) yield null;
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b2 = a + 1, c = a + cols, e = c + 1; idx.set([a, b2, e, a, e, c], (j * (cols - 1) + i) * 6); }
  return { cols, rows, step, cx, cy, pos, col, idx };
}
/** The far levels for a terraced world: fine, medium, coarse (step, half-size in tiles, and how far the eye may move before it is rebuilt). */
export const TERRACE_FAR_LODS = [{ step: 5, half: 1000, moveBy: 200 }, { step: 12, half: 2400, moveBy: 480 }, { step: 32, half: 4000, moveBy: 800 }] as const;
