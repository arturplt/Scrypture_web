/**
 * Bóbr world map, part 1: infinite terrain. Ported from Android's `BiomeRegion`, `ChunkLoader`, `BiomeGenerator` and
 * `TerrainTransitionTiles` (docs: MAP_GENERATION_DOCUMENTATION.md).
 *
 * Differences from Android, on purpose (also listed in BACKLOG.md):
 *  - Android generated each 16x16 chunk on its own and then patched the borders with "edge constraints" copied from the loaded
 *    neighbours, and picked one biome per chunk (a visible square grid of biomes). Here every tile is a pure function of
 *    (seed, x, y): the biome is chosen per tile, and a chunk is built with a margin so beaches and transitions cross chunk
 *    borders without any constraints. Chunks can be thrown away and rebuilt exactly, in any order.
 *  - Android's value noise wrapped every 256 lattice cells (the world repeated after ~5000 tiles); this one hashes the lattice
 *    coordinates, so it never repeats.
 *  - Decorations are rolled from a hash of the tile, not from a per-chunk random sequence, so regenerating a chunk after the
 *    ecosystem changed a tile keeps every other decoration where it was.
 */

import { lakeBiomeIndex, lakeRoadAt, lakeWaterAt, lakeMetresAt, LAKE_LAND, groundTiles, groundZ, TILES_PER_GLIDER_M, type WorldKind } from './lakedistrict';
import { TerraceField, TERRACE_LAYER_M, terraceMoist, terraceBiome, terraceLakeAt, terraceLakeShoreAt } from './terrace';
export { terraceBiome };

export const CHUNK = 16;                       // tiles per chunk side
export const TILE_PX = 16;                     // tile size in the sheet
export const MARGIN = 2;                       // extra ring of tiles built around a chunk (transitions + coast distance)
export const SIDE = CHUNK + MARGIN * 2;

/** Terrain codes. */
export const WATER = 0, SAND = 1, GRASS = 2;
export type Terrain = 0 | 1 | 2;

export type DecoKind = 0 | 1 | 2 | 3;          // none | small bush | coniferous tree | deciduous tree
export const DECO_NONE: DecoKind = 0, DECO_BUSH: DecoKind = 1, DECO_CONIFER: DecoKind = 2, DECO_DECIDUOUS: DecoKind = 3;
/** Ground variant drawn instead of the plain tile. */
export type Variant = 0 | 1 | 2;               // plain | flowers (grass) / alt sand | rock on grass
export interface TileState { t: Terrain; v: Variant; d: DecoKind; s: number }   // s = decoration scale (1 .. 4)
export const plainTile = (t: Terrain): TileState => ({ t, v: 0, d: DECO_NONE, s: 1 });

// ---- sheet coordinates (tile units, 16 px) ------------------------------------------------------------------------------

export type Cell = readonly [number, number];
const c = (x: number, y: number): Cell => [x, y];
export const SHEET = {
  grass: c(1, 1), sand: c(4, 1), water: c(5, 4),
  flowers: c(2, 3), rock: c(2, 5), sandAlt: c(5, 3),
  waterRockBig: c(0, 5), waterRockSmall: c(1, 5),
  bush: c(0, 7), conifer: c(1, 7), deciduous: c(2, 7), cloud: c(3, 7), drop: c(4, 7), plane: c(3, 6),
} as const;
export const DECO_CELL: Record<Exclude<DecoKind, 0>, Cell> = { 1: SHEET.bush, 2: SHEET.conifer, 3: SHEET.deciduous };

type Pair = 'grassWater' | 'sandWater' | 'grassSand';
type Edge = 'top' | 'bottom' | 'left' | 'right' | 'inner_tl' | 'inner_tr' | 'inner_bl' | 'inner_br' | 'outer_tl' | 'outer_tr' | 'outer_bl' | 'outer_br' | 'outer_top' | 'outer_bottom' | 'outer_left' | 'outer_right';
/** Android's `TerrainTransitionTiles`, same coordinates. */
const TRANSITIONS: Record<Pair, Record<Edge, Cell>> = {
  grassWater: {
    outer_tl: c(0, 0), outer_tr: c(2, 0), outer_bl: c(0, 2), outer_br: c(2, 2), outer_top: c(1, 0), outer_left: c(0, 1), outer_right: c(2, 1), outer_bottom: c(1, 2),
    inner_tl: c(0, 3), inner_tr: c(1, 3), inner_bl: c(0, 4), inner_br: c(1, 4), top: c(1, 0), bottom: c(1, 2), left: c(0, 1), right: c(2, 1),
  },
  sandWater: {
    outer_tl: c(3, 0), outer_tr: c(5, 0), outer_bl: c(3, 2), outer_br: c(5, 2), outer_top: c(4, 0), outer_left: c(3, 1), outer_right: c(5, 1), outer_bottom: c(4, 2),
    inner_tl: c(3, 3), inner_tr: c(4, 3), inner_bl: c(3, 4), inner_br: c(4, 4), top: c(4, 0), bottom: c(4, 2), left: c(3, 1), right: c(5, 1),
  },
  grassSand: {
    outer_tl: c(6, 0), outer_tr: c(8, 0), outer_bl: c(6, 2), outer_br: c(8, 2), outer_top: c(7, 0), outer_left: c(6, 1), outer_right: c(8, 1), outer_bottom: c(7, 2),
    inner_tl: c(6, 3), inner_tr: c(7, 3), inner_bl: c(6, 4), inner_br: c(7, 4), top: c(7, 2), bottom: c(7, 0), left: c(8, 1), right: c(6, 1),
  },
};

// ---- hashing and noise --------------------------------------------------------------------------------------------------

/** 32-bit integer hash of up to four ints -> 0..1. */
export function hash01(a: number, b: number, c2 = 0, d = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c2 | 0, 2246822519) ^ Math.imul(d | 0, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** One octave of value noise in -1..1, lattice values from a hash (never repeats). */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const a = hash01(xi, yi, seed) * 2 - 1, b = hash01(xi, yi + 1, seed) * 2 - 1, cc = hash01(xi + 1, yi, seed) * 2 - 1, d = hash01(xi + 1, yi + 1, seed) * 2 - 1;
  const x1 = a + u * (cc - a), x2 = b + u * (d - b);
  return x1 + v * (x2 - x1);
}
/** Single-octave value noise as 0..1 (also used for decorative clouds). */
export const valueNoise01 = (x: number, y: number, seed: number) => (valueNoise(x, y, seed) + 1) / 2;
/** Android's 3 octaves (1, 1/2, 1/4), normalised to 0..1. */
const terrainNoise = (x: number, y: number, seed: number) =>
  ((valueNoise(x, y, seed) + valueNoise(x * 2, y * 2, seed) * 0.5 + valueNoise(x * 4, y * 4, seed) * 0.25) / 1.75 + 1) * 0.5;

// ---- biomes -------------------------------------------------------------------------------------------------------------

export type BiomeId = 'grassland' | 'forest' | 'wetland' | 'desert' | 'lake' | 'ocean';
export interface Biome { id: BiomeId; water: number; beach: number; decor: number }
export const BIOMES: Record<BiomeId, Biome> = {
  grassland: { id: 'grassland', water: 0.25, beach: 2, decor: 0.08 },
  forest: { id: 'forest', water: 0.3, beach: 3, decor: 0.15 },
  wetland: { id: 'wetland', water: 0.45, beach: 4, decor: 0.05 },
  desert: { id: 'desert', water: 0, beach: 0, decor: 0.02 },
  lake: { id: 'lake', water: 0.5, beach: 3, decor: 0.06 },
  ocean: { id: 'ocean', water: 0, beach: 0, decor: 0 },
};
const BIOME_SCALE = 0.003;                      // ~333 tiles per biome
const TERRAIN_SCALE = 0.05;

export function seedFrom(text: string): number {   // any text -> a 32-bit seed
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

export function biomeAt(x: number, y: number, seed: number): Biome {
  const n = (valueNoise(x * BIOME_SCALE, y * BIOME_SCALE, seed ^ 0xb10e5eed) + 1) / 2;
  return n < 0.12 ? BIOMES.ocean : n < 0.22 ? BIOMES.desert : n < 0.4 ? BIOMES.grassland : n < 0.58 ? BIOMES.forest : n < 0.78 ? BIOMES.wetland : BIOMES.lake;
}

function isWater(x: number, y: number, seed: number, b: Biome): boolean {
  if (b.id === 'ocean') return true;
  if (b.id === 'desert') return false;
  return terrainNoise(x * TERRAIN_SCALE, y * TERRAIN_SCALE, seed) < b.water;
}

/**
 * The generated terrain of a chunk plus a ring of MARGIN tiles (SIDE x SIDE codes, row-major). Water by noise, sand within
 * the biome's beach width of any water (Android: a square window), grass elsewhere; deserts are all sand, oceans all water.
 */
export const BIOME_LIST: Biome[] = [BIOMES.grassland, BIOMES.forest, BIOMES.wetland, BIOMES.desert, BIOMES.lake, BIOMES.ocean];
const BIOME_INDEX: Record<BiomeId, number> = { grassland: 0, forest: 1, wetland: 2, desert: 3, lake: 4, ocean: 5 };
export const generateChunkTerrain = (cx: number, cy: number, seed: number): Uint8Array => generateChunk(cx, cy, seed).t;

/** Terrain codes and biome indices (both SIDE x SIDE) of a chunk and its margin. */
export function generateChunk(cx: number, cy: number, seed: number): { t: Uint8Array; b: Uint8Array } {
  const reach = 4;                                // widest beach (wetland)
  const side = SIDE + reach * 2, ox = cx * CHUNK - MARGIN - reach, oy = cy * CHUNK - MARGIN - reach;
  const biomes: Biome[] = new Array(side * side), water = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const b = biomeAt(ox + i, oy + j, seed);
    biomes[j * side + i] = b; water[j * side + i] = isWater(ox + i, oy + j, seed, b) ? 1 : 0;
  }
  const out = new Uint8Array(SIDE * SIDE), bio = new Uint8Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) {
    const k = (j + reach) * side + (i + reach), b = biomes[k];
    bio[j * SIDE + i] = BIOME_INDEX[b.id];
    if (water[k]) { out[j * SIDE + i] = WATER; continue; }
    if (b.id === 'desert') { out[j * SIDE + i] = SAND; continue; }
    let near = false;
    for (let dj = -b.beach; dj <= b.beach && !near; dj++) for (let di = -b.beach; di <= b.beach; di++) if (water[k + dj * side + di]) { near = true; break; }
    out[j * SIDE + i] = near ? SAND : GRASS;
  }
  return { t: out, b: bio };
}

/** The same grids for a Lake District chunk: water, rivers and the sea from the real map, a one-tile beach, sand on the bare tops. */
export function generateLakeChunk(cx: number, cy: number): { t: Uint8Array; b: Uint8Array } {
  const out = new Uint8Array(SIDE * SIDE), bio = new Uint8Array(SIDE * SIDE), ox = cx * CHUNK - MARGIN, oy = cy * CHUNK - MARGIN;
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) {
    const x = ox + i, y = oy + j, k = j * SIDE + i, b = lakeBiomeIndex(x, y);
    bio[k] = b;
    if (lakeWaterAt(x, y) !== LAKE_LAND) { out[k] = WATER; continue; }
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (lakeWaterAt(x + di, y + dj) !== LAKE_LAND) { near = true; break; }
    out[k] = near || b === 3 || lakeRoadAt(x, y) ? SAND : GRASS;   // (a road is a strip of bare ground)
  }
  return { t: out, b: bio };
}

/** A biome grid entry with this bit set is on a terrace ledge (see terrace.onLedge): nothing stands there. */
export const LEDGE_BIT = 0x80;

/**
 * The grids of a terraced chunk: water below the sea, sand on the lowest shelf and the beach shelf above it, on dry ground and the bare tops,
 * grass elsewhere. Biomes follow the layers (see terraceBiome), and tiles on a ledge carry LEDGE_BIT.
 */
export function generateTerraceChunk(cx: number, cy: number, field: TerraceField): { t: Uint8Array; b: Uint8Array } {
  const R = 2, side = SIDE + R * 2, ox = cx * CHUNK - MARGIN - R, oy = cy * CHUNK - MARGIN - R, lay = new Int16Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) lay[j * side + i] = field.layerAt(ox + i, oy + j);
  const out = new Uint8Array(SIDE * SIDE), bio = new Uint8Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) {
    const k = (j + R) * side + i + R, l = lay[k], x = ox + i + R, y = oy + j + R, o = j * SIDE + i;
    if (terraceLakeAt(x + 0.5, y + 0.5, field.seed)) { bio[o] = 4; out[o] = WATER; continue; }   // an inland lake: level water on its shelf
    if (terraceLakeShoreAt(x + 0.5, y + 0.5, field.seed)) { bio[o] = 3; out[o] = SAND; continue; }   // and a strip of sand along its shore, level ground before the land falls away
    const b = terraceBiome(l, terraceMoist(x, y, field.seed));
    const ledge = lay[k + 1] !== l || lay[k - 1] !== l || lay[k + side] !== l || lay[k - side] !== l;
    bio[o] = b | (ledge && l >= 0 ? LEDGE_BIT : 0);
    if (l < 0) { out[o] = WATER; continue; }
    let sand = l === 0 || b === 3;
    if (!sand && l === 1) for (let dj = -2; dj <= 2 && !sand; dj++) for (let di = -2; di <= 2; di++) if (lay[k + dj * side + di] < 0) { sand = true; break; }
    out[o] = sand ? SAND : GRASS;
  }
  return { t: out, b: bio };
}

// ---- tile choice --------------------------------------------------------------------------------------------------------

const validPair = (a: Terrain, b: Terrain) => a !== b;   // every pair of the three terrains has a transition set

function transitionCell(cur: Terrain, nb: Terrain, edge: Edge): Cell | null {
  let pair: Pair, invert = false, toOuter = false;
  if (cur === GRASS && nb === WATER) { pair = 'grassWater'; toOuter = true; }
  else if (cur === SAND && nb === WATER) { pair = 'sandWater'; toOuter = true; }
  else if (cur === GRASS && nb === SAND) pair = 'grassSand';
  else if (cur === SAND && nb === GRASS) { pair = 'grassSand'; invert = true; }
  else return null;
  const INVERT: Partial<Record<Edge, Edge>> = { top: 'outer_bottom', bottom: 'outer_top', left: 'outer_right', right: 'outer_left', inner_tl: 'outer_br', inner_tr: 'outer_bl', inner_bl: 'outer_tr', inner_br: 'outer_tl' };
  const e: Edge = invert ? (INVERT[edge] ?? edge) : toOuter && edge.startsWith('inner_') ? (edge.replace('inner_', 'outer_') as Edge) : edge;
  return TRANSITIONS[pair][e];
}

/**
 * What a land tile looks like it is: a grass or sand tile with three or four sides of one other terrain (a one-tile hole, a one-tile tip or islet)
 * is swallowed by it, since the art has no shape for those and they showed as square patches. Water is never swallowed: a rain puddle starts as one tile.
 */
export function swallowedBy(t: Terrain, n: Terrain, s: Terrain, e: Terrain, w: Terrain): Terrain {
  if (t === WATER) return t;
  for (const o of [WATER, SAND, GRASS] as const) {
    if (o === t) continue;
    if ((+(n === o) + +(s === o) + +(e === o) + +(w === o)) >= 3) return o;
  }
  return t;
}

/**
 * A tile whose four sides are all like it but whose corner touches another terrain: a small blob of that terrain in the corner.
 * Water is a pond's quarter piece (the water sits in the corner, its round end pointing at the tile's middle); sand on grass is the island's
 * outer corner on the far side (the sand sits in the corner). Android never did this, so such corners were left square.
 */
const POND_CORNER = { nw: 'inner_br', ne: 'inner_bl', sw: 'inner_tr', se: 'inner_tl' } as const;
const ISLE_CORNER = { nw: 'outer_br', ne: 'outer_bl', sw: 'outer_tr', se: 'outer_tl' } as const;
function diagonalCell(cur: Terrain, nb: Terrain, corner: 'nw' | 'ne' | 'sw' | 'se'): Cell | null {
  if (cur === GRASS && nb === WATER) return TRANSITIONS.grassWater[POND_CORNER[corner]];
  if (cur === SAND && nb === WATER) return TRANSITIONS.sandWater[POND_CORNER[corner]];
  if (cur === GRASS && nb === SAND) return TRANSITIONS.grassSand[ISLE_CORNER[corner]];
  return null;
}

/** Android's `selectSimpleTransition`: a border or a corner tile for a ground tile next to a different terrain (null = plain). `nw..se` are the diagonal neighbours (optional). */
export function transitionFor(cur: Terrain, n: Terrain, s: Terrain, e: Terrain, w: Terrain, nw?: Terrain, ne?: Terrain, sw?: Terrain, se?: Terrain): Cell | null {
  if (cur === WATER) return null;                 // water never gets transitions
  if (cur === SAND && n !== WATER && s !== WATER && e !== WATER && w !== WATER) {   // grass handles sand<->grass; only a water corner is left for sand
    if (nw === WATER) return diagonalCell(cur, nw, 'nw'); if (ne === WATER) return diagonalCell(cur, ne, 'ne');
    if (sw === WATER) return diagonalCell(cur, sw, 'sw'); if (se === WATER) return diagonalCell(cur, se, 'se');
    return null;
  }
  const nd = validPair(cur, n), sd = validPair(cur, s), ed = validPair(cur, e), wd = validPair(cur, w);
  const count = +nd + +sd + +ed + +wd;
  if (count === 0 && nw !== undefined) {          // all four sides alike: look at the corners (water first, it reads strongest)
    const corners: [Terrain, 'nw' | 'ne' | 'sw' | 'se'][] = [[nw, 'nw'], [ne!, 'ne'], [sw!, 'sw'], [se!, 'se']];
    for (const [t, k] of corners) if (t === WATER) return diagonalCell(cur, t, k);
    for (const [t, k] of corners) if (t !== cur) { const d = diagonalCell(cur, t, k); if (d) return d; }
    return null;
  }
  if (count === 1) return transitionCell(cur, nd ? n : sd ? s : ed ? e : w, nd ? 'top' : sd ? 'bottom' : ed ? 'right' : 'left');
  if (count === 2) {
    const corner = nd && wd ? 'inner_tl' : nd && ed ? 'inner_tr' : sd && wd ? 'inner_bl' : sd && ed ? 'inner_br' : null;
    if (corner) return transitionCell(cur, nd ? n : sd ? s : ed ? e : w, corner);
    return transitionCell(cur, nd ? n : sd ? s : ed ? e : w, nd ? 'top' : sd ? 'bottom' : ed ? 'right' : 'left');   // opposite sides: one is enough
  }
  return null;                                    // 3+ sides: base tile
}

/** What a tile looks like when nothing has changed it: variants and bushes/trees rolled from a hash of the tile. */
export function generatedState(x: number, y: number, t: Terrain, biome: Biome, seed: number, ledge = false): TileState {
  const r = hash01(x, y, seed, 1), r2 = hash01(x, y, seed, 2), r3 = hash01(x, y, seed, 3);
  if (t === SAND) return { t, v: r < 0.05 ? 1 : 0, d: DECO_NONE, s: 1 };
  if (t !== GRASS) return plainTile(t);
  const chance = biome.id === 'grassland' ? 0.08 : biome.id === 'forest' ? 0.15 : 0.05;
  if (r >= chance) return plainTile(t);
  if (ledge) return Math.floor(r2 * 3) === 0 ? { t, v: 1, d: DECO_NONE, s: 1 } : plainTile(t);   // on a terrace ledge only flowers: a tree, bush or rock would hang over the edge
  const pick = Math.floor(r2 * (biome.id === 'grassland' ? 3 : 5));     // grassland: no trees
  const scale = r3 < 0.5 ? 1 : 2;
  if (pick === 0) return { t, v: 1, d: DECO_NONE, s: 1 };
  if (pick === 1) return { t, v: 2, d: DECO_NONE, s: 1 };
  if (pick === 2) return { t, v: 0, d: DECO_BUSH, s: 1 };
  return { t, v: 0, d: pick === 3 ? DECO_CONIFER : DECO_DECIDUOUS, s: scale };
}

export const tileKey = (x: number, y: number) => (x + 1048576) * 2097152 + (y + 1048576);
export const keyX = (k: number) => Math.floor(k / 2097152) - 1048576;
export const keyY = (k: number) => (k % 2097152) - 1048576;
export const chunkOf = (t: number) => Math.floor(t / CHUNK);

/** A rock on grass stands up like a rock in the water (an upright sprite that faces the camera), instead of lying in the ground. */
const rockOn = (st: TileState): Cell | null => (st.t !== SAND && st.v === 2 ? SHEET.rock : null);

/** One drawable tile: the ground cell, plus what stands on it (a tree, bush or water rock). */
export interface Drawn { ground: Cell; deco: Cell | null; scale: number }

/**
 * The world: a seed (everything not touched is generated) plus the tiles the ecosystem, the paint tool or the player changed.
 * `version` counts changes so renderers know when to redraw a chunk.
 */
export class World {
  readonly seed: number;
  readonly kind: WorldKind;
  readonly changes = new Map<number, TileState>();
  version = 0;
  private cache = new Map<number, { t: Uint8Array; b: Uint8Array }>();
  /** The terraced world's height field (null on the other kinds). */
  readonly field: TerraceField | null;
  /** A second, small field of the same seed for the maps: they read hundreds of chunks, and through the game's own field they would push the grids of the chunks on screen out of its cache. */
  private readonly mapField: TerraceField | null;

  constructor(seed: number, changes?: Iterable<[number, TileState]>, kind: WorldKind = 'procedural') {
    this.seed = seed; this.kind = kind;
    this.field = kind === 'terraced' ? new TerraceField(seed) : null;
    this.mapField = this.field ? new TerraceField(seed, 40) : null;
    if (changes) for (const [k, s] of changes) this.changes.set(k, s);
  }
  /** Does the ground have height (hills, a chunk mesh, ridge lift)? The Lake District and the terraced worlds. */
  get hilly(): boolean { return this.kind !== 'procedural'; }
  /** Is this a real map (the Lake District: its tile size, roads, names, a fixed extent)? */
  get realMap(): boolean { return this.kind === 'lakedistrict'; }
  private gen(cx: number, cy: number) {
    return this.kind === 'lakedistrict' ? generateLakeChunk(cx, cy) : this.field ? generateTerraceChunk(cx, cy, this.field) : generateChunk(cx, cy, this.seed);
  }
  private base(cx: number, cy: number): { t: Uint8Array; b: Uint8Array } {
    const key = tileKey(cx, cy);
    let g = this.cache.get(key);
    if (!g) {
      g = this.gen(cx, cy);
      this.cache.set(key, g);
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);   // keep memory bounded; rebuilt on demand
    }
    return g;
  }
  /** A chunk's 16 x 16 terrain with the changes laid over it, for the maps: from the cache when it is there, otherwise generated and not kept (a map that reads hundreds of chunks must not push out the ones the game is drawing). */
  chunkTerrain(cx: number, cy: number): Uint8Array {
    const g = this.cache.get(tileKey(cx, cy)) ?? (this.mapField ? generateTerraceChunk(cx, cy, this.mapField) : this.gen(cx, cy));
    const out = new Uint8Array(CHUNK * CHUNK), x0 = cx * CHUNK, y0 = cy * CHUNK, ch = this.changes.size > 0;
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) out[j * CHUNK + i] = (ch ? this.changes.get(tileKey(x0 + i, y0 + j))?.t : undefined) ?? g.t[(j + MARGIN) * SIDE + i + MARGIN];
    return out;
  }
  /** One tile's terrain for a zoomed-out map, cheaply (a couple of noise reads, nothing generated or cached): beaches are left out, being narrower than a map pixel there. */
  mapSample(x: number, y: number, layer?: number): Terrain {
    const c = this.changes.get(tileKey(x, y)); if (c) return c.t;
    if (this.kind === 'lakedistrict') return lakeWaterAt(x, y) !== LAKE_LAND ? WATER : GRASS;
    if (this.field) { const l = layer ?? this.field.layerDirect(x, y); return l < 0 || terraceLakeAt(x + 0.5, y + 0.5, this.seed) ? WATER : terraceLakeShoreAt(x + 0.5, y + 0.5, this.seed) ? SAND : l === 0 || terraceBiome(l, terraceMoist(x, y, this.seed)) === 3 ? SAND : GRASS; }
    const b = biomeAt(x, y, this.seed);
    return isWater(x, y, this.seed, b) ? WATER : b.id === 'desert' ? SAND : GRASS;
  }
  /** Tree cover of the tile block from (x, y) to (x + n, y + n) for a zoomed-out map, 0..1 (a few hash reads on a 4 x 4 sample, nothing generated or cached; the hilly world has no generated trees). */
  mapTrees(x: number, y: number, n: number): number {
    if (this.kind === 'lakedistrict') return 0;
    const step = Math.max(1, n / 4), m = Math.min(4, n);
    let b: Biome | null = null, hit = 0, cnt = 0;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const tx = Math.floor(x + i * step), ty = Math.floor(y + j * step), c = this.changes.get(tileKey(tx, ty));
      cnt++;
      if (c) { if (c.t === GRASS && c.d >= DECO_CONIFER) hit++; continue; }
      b ??= this.field ? BIOME_LIST[terraceBiome(this.field.layerDirect(tx, ty), terraceMoist(tx, ty, this.seed))] : biomeAt(tx, ty, this.seed);   // (one biome for the block: the first sample's)
      if (b.id === 'grassland' || b.id === 'desert' || b.id === 'ocean') continue;
      const r = hash01(tx, ty, this.seed, 1);
      if (r < (b.id === 'forest' ? 0.15 : 0.05) && Math.floor(hash01(tx, ty, this.seed, 2) * 5) >= 3 && (this.field || !isWater(tx, ty, this.seed, b))) hit++;
    }
    return hit / cnt;
  }
  /** Ground height in tiles at a point (0 on the flat procedural worlds), and in glider metres. */
  heightAt(px: number, py: number): number { return this.field ? this.field.heightAt(px, py) : this.kind === 'lakedistrict' ? groundTiles(px, py) : 0; }
  /** Real ground height in metres at a tile's centre (0 on the flat worlds; a nominal TERRACE_LAYER_M a layer on the terraced ones). */
  metresAt(x: number, y: number): number { return this.field ? Math.max(0, this.field.naturalAt(x, y)) * TERRACE_LAYER_M : this.kind === 'lakedistrict' ? lakeMetresAt(x, y) : 0; }
  groundZAt(px: number, py: number): number { return this.field ? this.field.heightAt(px, py) / TILES_PER_GLIDER_M : this.kind === 'lakedistrict' ? groundZ(px, py) : 0; }
  /** The terrace layer of a tile (-1 = sea; 0 on the other kinds). */
  layerAt(x: number, y: number): number { return this.field ? this.field.layerAt(x, y) : 0; }
  /** A chunk's 16 x 16 terrace layers for the maps (read through the maps' own field; capped at 127; all 0 on the other kinds). */
  chunkLayers(cx: number, cy: number): Int8Array {
    const l = new Int8Array(CHUNK * CHUNK), f = this.mapField; if (!f) return l;
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) l[j * CHUNK + i] = Math.min(127, f.layerAt(cx * CHUNK + i, cy * CHUNK + j));
    return l;
  }
  /** The terrace layer of a tile as the ground was before any water was laid over it (a beck or a tarn lowers its tiles): what the weather judges ledges and shelves by. */
  naturalLayerAt(x: number, y: number): number { return this.field ? Math.floor(this.field.naturalAt(x, y)) < 0 ? -1 : Math.floor(this.field.naturalAt(x, y)) : 0; }
  /** The terrace layer of a tile for a zoomed-out map: straight from the noise, nothing cached. */
  mapLayer(x: number, y: number): number { return this.field ? this.field.layerDirect(x, y) : 0; }
  generatedTerrain(x: number, y: number): Terrain {
    const cx = chunkOf(x), cy = chunkOf(y);
    return this.base(cx, cy).t[(y - cy * CHUNK + MARGIN) * SIDE + (x - cx * CHUNK + MARGIN)] as Terrain;
  }
  /** The biome of a tile, from the chunk's cached grid (same answer as `biomeAt`, without the noise). */
  biomeOf(x: number, y: number): Biome {
    const cx = chunkOf(x), cy = chunkOf(y);
    return BIOME_LIST[this.base(cx, cy).b[(y - cy * CHUNK + MARGIN) * SIDE + (x - cx * CHUNK + MARGIN)] & ~LEDGE_BIT];
  }
  /** Is a tile on a terrace ledge (never on the other kinds)? */
  private ledgeOf(x: number, y: number): boolean {
    if (!this.field) return false;
    const cx = chunkOf(x), cy = chunkOf(y);
    return (this.base(cx, cy).b[(y - cy * CHUNK + MARGIN) * SIDE + (x - cx * CHUNK + MARGIN)] & LEDGE_BIT) !== 0;
  }
  terrainAt(x: number, y: number): Terrain {
    return this.changes.get(tileKey(x, y))?.t ?? this.generatedTerrain(x, y);
  }
  stateAt(x: number, y: number): TileState {
    return this.changes.get(tileKey(x, y)) ?? generatedState(x, y, this.generatedTerrain(x, y), this.biomeOf(x, y), this.seed, this.ledgeOf(x, y));
  }
  /** Replace a tile. Setting it back to what the generator would give removes the override. */
  set(x: number, y: number, s: TileState): void {
    const gen = generatedState(x, y, this.generatedTerrain(x, y), this.biomeOf(x, y), this.seed, this.ledgeOf(x, y));
    const k = tileKey(x, y);
    if (gen.t === s.t && gen.v === s.v && gen.d === s.d && gen.s === s.s) this.changes.delete(k); else this.changes.set(k, s);
    this.version++;
  }
  setTerrain(x: number, y: number, t: Terrain): void { this.set(x, y, plainTile(t)); }

  /** Coast distance of a water tile, 1..3 (3 = three or more), by Manhattan steps to the nearest land. */
  private coast(x: number, y: number): number {
    for (let r = 1; r <= 2; r++) for (let d = 0; d <= r; d++) {
      const e = r - d;
      for (const [dx, dy] of [[d, e], [-d, e], [d, -e], [-d, -e]]) if (this.terrainAt(x + dx, y + dy) !== WATER) return r;
    }
    return 3;
  }

  /**
   * The 16x16 drawn tiles of a chunk (row-major) in one go: terrain and biome are read straight from the chunk's grid (it has a margin of 2,
   * so every neighbour is inside it) and only tiles the world changed need a map lookup. About 5x faster than calling `drawn` per tile.
   */
  chunkDrawn(cx: number, cy: number): Drawn[] {
    const g = this.base(cx, cy), out: Drawn[] = new Array(CHUNK * CHUNK), ox = cx * CHUNK, oy = cy * CHUNK, any = this.changes.size > 0;
    // (an inland lake is drawn as sand: its water is the see-through sheets laid over its bed by the renderer, cut along the smooth rim of the bed, not a tile picture with a harsh edge; the world still counts it as water)
    const field = this.field, inland = field ? (x: number, y: number) => terraceLakeAt(x + 0.5, y + 0.5, this.seed) || field.waterTopAt(x + 0.5, y + 0.5) >= 0 : null;   // (water that has sheets over it: a lake, or any the weather made above the lowest shelves)
    const ter = (i: number, j: number, x: number, y: number): Terrain => { const t = (any ? this.changes.get(tileKey(x, y))?.t : undefined) ?? (g.t[(j + MARGIN) * SIDE + i + MARGIN] as Terrain); return t === WATER && inland && inland(x, y) ? SAND : t; };
    // what each tile looks like, for the chunk and a ring round it (a swallowed tile counts as its surroundings for its neighbours too)
    const EW = CHUNK + 2, eff = new Uint8Array(EW * EW);
    for (let j = -1; j <= CHUNK; j++) for (let i = -1; i <= CHUNK; i++) {
      const X = ox + i, Y = oy + j;
      eff[(j + 1) * EW + i + 1] = swallowedBy(ter(i, j, X, Y), ter(i, j - 1, X, Y - 1), ter(i, j + 1, X, Y + 1), ter(i + 1, j, X + 1, Y), ter(i - 1, j, X - 1, Y));
    }
    const ef = (i: number, j: number) => eff[(j + 1) * EW + i + 1] as Terrain;
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const x = ox + i, y = oy + j, k = tileKey(x, y), over = any ? this.changes.get(k) : undefined;
      const idx = (j + MARGIN) * SIDE + i + MARGIN;
      const raw = generatedState(x, y, g.t[idx] as Terrain, BIOME_LIST[g.b[idx] & ~LEDGE_BIT], this.seed, (g.b[idx] & LEDGE_BIT) !== 0);
      const here = ef(i, j), swallowed = here !== (over ?? raw).t;
      const st = swallowed ? plainTile(here) : over ?? raw;
      if (st.t === WATER) {
        out[j * CHUNK + i] = !over && !swallowed && hash01(x, y, this.seed, 4) < 0.05
          ? { ground: SHEET.water, deco: this.coast(x, y) <= 2 ? SHEET.waterRockBig : SHEET.waterRockSmall, scale: 1 }
          : { ground: SHEET.water, deco: null, scale: 1 };
        continue;
      }
      const tr = transitionFor(st.t, ef(i, j - 1), ef(i, j + 1), ef(i + 1, j), ef(i - 1, j), ef(i - 1, j - 1), ef(i + 1, j - 1), ef(i - 1, j + 1), ef(i + 1, j + 1));
      if (tr) { out[j * CHUNK + i] = { ground: tr, deco: st.d && over ? DECO_CELL[st.d as 1 | 2 | 3] : null, scale: st.s }; continue; }
      const ground = st.t === SAND ? (st.v === 1 ? SHEET.sandAlt : SHEET.sand) : st.v === 1 ? SHEET.flowers : SHEET.grass;
      out[j * CHUNK + i] = { ground, deco: st.d ? DECO_CELL[st.d as 1 | 2 | 3] : rockOn(st), scale: st.s };
    }
    return out;
  }

  drawn(x: number, y: number): Drawn {
    const eff = (px: number, py: number): Terrain => swallowedBy(this.terrainAt(px, py), this.terrainAt(px, py - 1), this.terrainAt(px, py + 1), this.terrainAt(px + 1, py), this.terrainAt(px - 1, py));
    const real = this.stateAt(x, y), here = eff(x, y), st = here !== real.t ? plainTile(here) : real;   // (swallowed: see swallowedBy)
    if (st.t === WATER) {
      if (here === real.t && hash01(x, y, this.seed, 4) < 0.05 && !this.changes.has(tileKey(x, y))) {   // a rock in the water (never on tiles the rain made)
        return { ground: SHEET.water, deco: this.coast(x, y) <= 2 ? SHEET.waterRockBig : SHEET.waterRockSmall, scale: 1 };
      }
      return { ground: SHEET.water, deco: null, scale: 1 };
    }
    const tr = transitionFor(st.t, eff(x, y - 1), eff(x, y + 1), eff(x + 1, y), eff(x - 1, y), eff(x - 1, y - 1), eff(x + 1, y - 1), eff(x - 1, y + 1), eff(x + 1, y + 1));
    if (tr) return { ground: tr, deco: st.d && this.changes.has(tileKey(x, y)) ? DECO_CELL[st.d as 1 | 2 | 3] : null, scale: st.s };   // generated trees keep off coast tiles (Android), grown ones stay
    const ground = st.t === SAND ? (st.v === 1 ? SHEET.sandAlt : SHEET.sand) : st.v === 1 ? SHEET.flowers : SHEET.grass;
    return { ground, deco: st.d ? DECO_CELL[st.d as 1 | 2 | 3] : rockOn(st), scale: st.s };
  }
}
