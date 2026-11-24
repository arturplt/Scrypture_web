/**
 * Building a ground chunk's picture: every tile of a 16 x 16 chunk is a 16 x 16 block of pixels (already laid over the water colour), copied row by row into one
 * 256 x 256 RGBA array, plus the list of decorations (trees, bushes) standing on it. Pure: it needs a `World` and a lookup for the blocks, nothing from the page, so the
 * same function runs on the main thread (the fallback, and the Lake District) and in the chunk worker (see chunkclient.ts and workers/chunk.worker.ts).
 */
import { CHUNK, TILE_PX, SAND, SHEET, type Cell, type World } from './worldgen';
import type { TerraceMesh } from './terrace';

export const CPX = CHUNK * TILE_PX;                         // a chunk's picture is this many pixels a side
export interface Deco { x: number; y: number; cell: Cell; scale: number }

/** The sheet of tiles is 16 x 8 cells; a block table holds each cell twice (plain, then as a road), 16 x 16 pixels x 4 bytes each. */
export const SHEET_COLS = 16, SHEET_ROWS = 8, BLOCK_BYTES = TILE_PX * TILE_PX * 4;
export const BLOCK_TABLE_BYTES = SHEET_COLS * SHEET_ROWS * 2 * BLOCK_BYTES;
export type BlockOf = (col: number, row: number, road: boolean) => Uint8ClampedArray;

/** Where a block sits in a block table (the plain cell, then its road variant). */
export const blockIndex = (col: number, row: number, road: boolean) => (row * SHEET_COLS + col) * 2 + (road ? 1 : 0);
/** A block lookup over a table made of every cell's blocks (see `blockIndex`). */
export function blocksFromTable(table: Uint8ClampedArray): BlockOf {
  return (col, row, road) => {
    if (col < 0 || row < 0 || col >= SHEET_COLS || row >= SHEET_ROWS) throw new Error(`tile cell ${col},${row} is not on the sheet`);
    const o = blockIndex(col, row, road) * BLOCK_BYTES;
    return table.subarray(o, o + BLOCK_BYTES);
  };
}

/**
 * Build a chunk into `px` (CPX x CPX x 4 bytes), a few rows at a time: it yields between slices so the main thread can spread the work over frames. Returns the chunk's
 * decorations. `roadAt` (the Lake District only) says which sand tiles are tarmac.
 */
export function* chunkPixels(world: World, blockOf: BlockOf, roadAt: ((x: number, y: number) => boolean) | null, cx: number, cy: number, px: Uint8ClampedArray): Generator<void, Deco[]> {
  const row = TILE_PX * 4, stride = CPX * 4, decos: Deco[] = [], fld = world.field;
  if (fld) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!fld.has(cx + dx, cy + dy)) { fld.grid(cx + dx, cy + dy); yield; }   // (the terraced world: the chunk's tiles read its own height grid and its neighbours', a few ms each on a phone: one a slice)
  const tiles = world.chunkDrawn(cx, cy);
  yield;
  for (let j = 0; j < CHUNK; j++) {
    if (j > 0 && j % 4 === 0) yield;
    for (let i = 0; i < CHUNK; i++) {
      const x = cx * CHUNK + i, y = cy * CHUNK + j, d = tiles[j * CHUNK + i];
      const b = blockOf(d.ground[0], d.ground[1], !!roadAt && world.terrainAt(x, y) === SAND && roadAt(x, y));
      for (let r = 0, o = (j * TILE_PX * CPX + i * TILE_PX) * 4; r < TILE_PX; r++, o += stride) px.set(b.subarray(r * row, r * row + row), o);
      if (d.deco) decos.push({ x, y, cell: d.deco, scale: d.scale });
    }
  }
  return decos;
}

/** Run a build to the end (tests, and the worker, which does not need to share its time). */
export function buildChunk(world: World, blockOf: BlockOf, roadAt: ((x: number, y: number) => boolean) | null, cx: number, cy: number, px: Uint8ClampedArray = new Uint8ClampedArray(CPX * CPX * 4)): { px: Uint8ClampedArray; decos: Deco[] } {
  const g = chunkPixels(world, blockOf, roadAt, cx, cy, px);
  let r = g.next();
  while (!r.done) r = g.next();
  return { px, decos: r.value };
}

// ---- decorations across a structured clone: the cells are shared constants the renderer compares by identity (`d.cell === SHEET.bush`), so they travel as a number ----
const CELLS: readonly Cell[] = Object.values(SHEET);
/** Decorations as flat numbers [x, y, cell, scale, ...] (transferable). */
export function encodeDecos(decos: readonly Deco[]): Float64Array {
  const out = new Float64Array(decos.length * 4);
  decos.forEach((d, i) => {
    const c = CELLS.indexOf(d.cell);
    if (c < 0) throw new Error('a decoration on a cell that is not in the sheet table');
    out[i * 4] = d.x; out[i * 4 + 1] = d.y; out[i * 4 + 2] = c; out[i * 4 + 3] = d.scale;
  });
  return out;
}
/** The decorations again, each on the shared cell constant. */
export function decodeDecos(flat: Float64Array): Deco[] {
  const out: Deco[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) out.push({ x: flat[i], y: flat[i + 1], cell: CELLS[flat[i + 2]], scale: flat[i + 3] });
  return out;
}

// ---- is a rebuilt chunk any different? (the ecosystem touches a chunk's neighbours and edges all the time; a rebuild that came out the same must not cost a texture and a mesh upload) ----
/** Do two chunk pictures hold the same pixels? */
export function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0 && a.length % 4 === 0) {
    const x = new Uint32Array(a.buffer, a.byteOffset, a.length / 4), y = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** The same decorations, on the same tiles, at the same scale? */
export function sameDecos(a: readonly Deco[], b: readonly Deco[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].x !== b[i].x || a[i].y !== b[i].y || a[i].cell !== b[i].cell || a[i].scale !== b[i].scale) return false;
  return true;
}
/** A number that changes when any of a hill mesh's arrays does (FNV-1a over their bytes): to tell, after the renderer has taken the arrays, that a new mesh is the same one. */
export function meshSig(m: TerraceMesh): number {
  let h = 0x811c9dc5;
  for (const a of [m.pos, m.nrm, m.idx, m.sub, m.wpos, m.widx, m.wkind]) {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    h = Math.imul(h ^ a.length, 0x01000193);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
  }
  return h >>> 0;
}
