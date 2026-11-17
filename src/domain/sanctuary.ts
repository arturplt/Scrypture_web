/**
 * Sanctuary: the isometric block builder, ported from Android's `Sanctuary` sandbox (tile sheet, grid maths, height-map
 * island generator, saved levels). Pure functions only; the canvas editor lives in `screens/Sanctuary.tsx`.
 *
 * Deliberate differences from Android (see BACKLOG.md): no WebGL path / performance monitor (a 2D canvas is plenty for
 * ~2000 blocks), layers are 16 px apart (Android used 32, which left a gap between stacked cubes), and there is no block
 * rotation (the sheet already has every direction as its own tile).
 */

export type TileType = 'cube' | 'ramp' | 'corner' | 'staircase' | 'flat' | 'pillar' | 'water';
export type Palette = 'green' | 'gray' | 'orange' | 'blue';

export interface Tile { id: number; name: string; type: TileType; palette: Palette; sx: number; sy: number }

export const TILE = 32;                 // sprite size in the sheet
export const CELL_W = 32;               // grid cell (diamond) width
export const CELL_H = 16;               // grid cell (diamond) height
export const LAYER_H = 16;              // one layer up lifts a block by this many px
export const GRID = 24;                 // cells per side
export const LAYERS = 8;                // z = 0 .. LAYERS-1
export const MAX_LEVELS = 30;
export const MAX_BLOCKS = GRID * GRID * LAYERS;

const NAMES = [
  ['Cube', 'cube'], ['Half Cube', 'cube'], ['Slope North', 'ramp'], ['Slope East', 'ramp'], ['Stairs East', 'staircase'], ['Stairs North', 'staircase'],
  ['Curb', 'corner'], ['Flat', 'flat'], ['Slope West', 'ramp'], ['Slope South', 'ramp'], ['Wall North', 'cube'], ['Wall South', 'cube'],
] as const;

/** Same ids as Android's `ISOMETRIC_TILES`, built from the sheet layout: 3 colours x 3 rows of 6, then the water tiles. */
function buildTiles(): Tile[] {
  const out: Tile[] = [];
  const palettes: [Palette, number, number][] = [['green', 0, 1], ['gray', 3, 19], ['orange', 6, 37]];
  for (const [palette, row0, id0] of palettes) {
    NAMES.forEach(([name, type], i) => out.push({ id: id0 + i, name, type, palette, sx: (i % 6) * TILE, sy: (row0 + Math.floor(i / 6)) * TILE }));
    out.push({ id: id0 + 16, name: 'Wall West', type: 'cube', palette, sx: 4 * TILE, sy: (row0 + 2) * TILE });
    out.push({ id: id0 + 17, name: 'Wall East', type: 'cube', palette, sx: 5 * TILE, sy: (row0 + 2) * TILE });
  }
  out.push({ id: 49, name: 'Pillar Long', type: 'pillar', palette: 'orange', sx: 0, sy: 8 * TILE });
  out.push({ id: 50, name: 'Pillar Short', type: 'pillar', palette: 'orange', sx: TILE, sy: 8 * TILE });
  [[0, 2], [3, 2], [2, 2], [1, 2], [0, 5], [1, 5], [2, 5], [3, 5]].forEach(([c, r], i) =>
    out.push({ id: 55 + i, name: `Water Block ${i + 1}`, type: 'water', palette: 'blue', sx: c * TILE, sy: r * TILE }));
  return out;
}
export const TILES: Tile[] = buildTiles();
const BY_ID = new Map(TILES.map(t => [t.id, t]));
export const tileById = (id: number): Tile | undefined => BY_ID.get(id);

export const TILE_TYPES: TileType[] = ['cube', 'flat', 'ramp', 'corner', 'staircase', 'pillar', 'water'];
export const PALETTES: Palette[] = ['green', 'gray', 'orange', 'blue'];
export const PALETTE_COLOR: Record<Palette, string> = { green: '#4caf50', gray: '#9e9e9e', orange: '#ff9800', blue: '#42a5f5' };

export const TILE_GRASS = 1, TILE_STONE = 19, TILE_SAND = 37, TILE_WATER = 55;
export const DEFAULT_TILE = TILE_GRASS;

/** A block: [x, y, z, tileId]. Tuples keep saved levels small. */
export type Block = [number, number, number, number];
export interface Level { id: string; name: string; blocks: Block[]; updatedAt: number }
export interface SanctuarySave { levels: Level[]; draft: Block[] }
export const emptySanctuarySave = (): SanctuarySave => ({ levels: [], draft: [] });

export const inBounds = (x: number, y: number, z: number) =>
  Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) && x >= 0 && y >= 0 && z >= 0 && x < GRID && y < GRID && z < LAYERS;
export const keyOf = (x: number, y: number, z: number) => (z * GRID + y) * GRID + x;

// ---- projection ----------------------------------------------------------------------------------------------------

interface ScreenPt { x: number; y: number }

/** Centre of a cell's top diamond in world px (z lifts it up). The 32px sprite is drawn at (x - 16, y - 8). */
export function gridToWorld(x: number, y: number, z: number): ScreenPt {
  return { x: (x - y) * (CELL_W / 2), y: (x + y) * (CELL_H / 2) - z * LAYER_H };
}

/** The cell (on layer z) under a world point, or null outside the grid. */
export function worldToGrid(wx: number, wy: number, z: number): { x: number; y: number } | null {
  const py = wy + z * LAYER_H;
  const x = Math.round((wx / (CELL_W / 2) + py / (CELL_H / 2)) / 2) + 0;   // + 0 turns -0 into 0
  const y = Math.round((py / (CELL_H / 2) - wx / (CELL_W / 2)) / 2) + 0;
  return inBounds(x, y, z) ? { x, y } : null;
}

/** Painter's order, back to front: far cells (small x+y) first, then lower layers first. */
export function drawOrder(blocks: readonly Block[]): Block[] {
  return [...blocks].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2] || a[0] - b[0]);
}

/** BlockWorld-space bounding box of the whole grid (for centring the camera). */
export function gridBounds() {
  const top = gridToWorld(0, 0, LAYERS - 1).y - CELL_H;
  const bottom = gridToWorld(GRID - 1, GRID - 1, 0).y + CELL_H * 2;
  return { left: -(GRID * CELL_W) / 2, right: (GRID * CELL_W) / 2, top, bottom };
}

// ---- level editing (immutable) -------------------------------------------------------------------------------------

export type BlockWorld = Map<number, Block>;
export const toWorld = (blocks: readonly Block[]): BlockWorld => {
  const w: BlockWorld = new Map();
  for (const b of blocks) w.set(keyOf(b[0], b[1], b[2]), b);
  return w;
};
export const toBlocks = (w: BlockWorld): Block[] => [...w.values()];

/** Put a tile in a cell (replaces what is there). Returns false when out of bounds or nothing changed. */
export function placeBlock(w: BlockWorld, x: number, y: number, z: number, tile: number): boolean {
  if (!inBounds(x, y, z) || !BY_ID.has(tile)) return false;
  const k = keyOf(x, y, z), old = w.get(k);
  if (old && old[3] === tile) return false;
  w.set(k, [x, y, z, tile]);
  return true;
}
export function removeBlock(w: BlockWorld, x: number, y: number, z: number): boolean {
  return w.delete(keyOf(x, y, z));
}
/** Fill a whole layer with one tile (Android's "FILL" button). */
export function fillLayer(w: BlockWorld, z: number, tile: number): void {
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) placeBlock(w, x, y, z, tile);
}
/** The block that is on top of a column, if any. */
export function topBlock(w: BlockWorld, x: number, y: number): Block | undefined {
  for (let z = LAYERS - 1; z >= 0; z--) { const b = w.get(keyOf(x, y, z)); if (b) return b; }
  return undefined;
}

// ---- island generator (Android's HeightMapSystem + MapGenerator, simplified) ----------------------------------------

/** Small deterministic PRNG so the same seed always makes the same island. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 0..1, summed over octaves (fractal), like the Android height-map generator. */
export function makeNoise(seed: number, octaves = 4, persistence = 0.5, lacunarity = 2) {
  const lattice = (ix: number, iy: number) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x: number, y: number) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += value(x * freq, y * freq) * amp; norm += amp; amp *= persistence; freq *= lacunarity; }
    return sum / norm;
  };
}

export interface IslandOptions { seed: number; maxHeight?: number; sea?: number }

/**
 * Build an island: water around the edge, orange sand on the beach, green hills, grey stone on the peaks. Every column is
 * filled down to layer 0 so the sides of the hills show no holes.
 */
export function generateIsland({ seed, maxHeight = 4, sea = 0.36 }: IslandOptions): Block[] {
  const noise = makeNoise(seed, 4, 0.5, 2);
  const out: Block[] = [];
  const c = (GRID - 1) / 2;
  const hMax = Math.max(1, Math.min(LAYERS - 1, maxHeight));
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = Math.min(1, Math.hypot(x - c, y - c) / (GRID / 2));   // 0 centre .. 1 edge
      const v = noise(x / 6 + 11.3, y / 6 + 4.7) * 0.65 + (1 - d * d) * 0.55 - 0.18;
      if (v < sea) { out.push([x, y, 0, TILE_WATER]); continue; }
      if (v < sea + 0.05) { out.push([x, y, 0, TILE_SAND]); continue; }
      const height = Math.min(hMax, Math.floor(((v - sea - 0.05) / (1 - sea - 0.05)) * (hMax + 1.6)));
      const top = height >= hMax && hMax >= 3 ? TILE_STONE : TILE_GRASS;
      for (let z = 0; z <= height; z++) out.push([x, y, z, z === height ? top : z === 0 ? TILE_SAND : top === TILE_STONE ? TILE_STONE : TILE_GRASS]);
    }
  }
  return out;
}

// ---- saving --------------------------------------------------------------------------------------------------------

/** Keep only valid, in-bounds, de-duplicated blocks from anything (an old save or an import). */
export function sanitizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const w: BlockWorld = new Map();
  for (const b of raw) {
    if (!Array.isArray(b) || b.length < 4) continue;
    const [x, y, z, t] = b as unknown[];
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && typeof t === 'number') placeBlock(w, x, y, z, t);
    if (w.size >= MAX_BLOCKS) break;
  }
  return toBlocks(w);
}

export function sanitizeSanctuarySave(raw: unknown): SanctuarySave {
  if (typeof raw !== 'object' || raw === null) return emptySanctuarySave();
  const o = raw as Record<string, unknown>;
  const levels: Level[] = [];
  for (const l of Array.isArray(o.levels) ? o.levels : []) {
    if (typeof l !== 'object' || l === null || typeof (l as any).id !== 'string') continue;
    const name = typeof (l as any).name === 'string' ? (l as any).name.trim().slice(0, 40) : '';
    const at = (l as any).updatedAt;
    levels.push({ id: (l as any).id, name: name || 'Level', blocks: sanitizeBlocks((l as any).blocks), updatedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0 });
    if (levels.length >= MAX_LEVELS) break;
  }
  return { levels, draft: sanitizeBlocks(o.draft) };
}
