/**
 * Sticks lying about the world, to pick up on foot. Like the hoops they come from the world's seed: one chance per 10 x 10 tile cell
 * (the stick's place and the way it lies are fixed). Which ones have been taken is kept in the saved world, by key.
 */
import { hash01 } from './worldgen';

export const STICK_CELL = 10;
export const STICK_CHANCE = 0.4;
export const STICK_PICK_RADIUS = 0.8;   // tiles
export interface Stick { key: string; x: number; y: number; angle: number }

export function stickInCell(seed: number, i: number, j: number): Stick | null {
  const s = seed & 0xffff;
  if (hash01(i, j, s, 301) > STICK_CHANCE) return null;
  return { key: `${i},${j}`, x: (i + 0.1 + 0.8 * hash01(i, j, s, 302)) * STICK_CELL, y: (j + 0.1 + 0.8 * hash01(i, j, s, 303)) * STICK_CELL, angle: hash01(i, j, s, 304) * Math.PI };
}


/**
 * `sticksIn` / `stonesIn` are asked for the whole view every frame. Working out every cell (three hashes and a key string each) 60 times a second is
 * most of what they cost, so the cells are worked out once in blocks of 8 x 8 and the finished lists are kept.
 */
const BLOCK = 8;
const blocks = new Map<string, Stick[]>();
function inBlocks(kind: 'stick' | 'stone', seed: number, cell: number, inCell: (seed: number, i: number, j: number) => Stick | null, x0: number, y0: number, x1: number, y1: number): Stick[] {
  const out: Stick[] = [], ci0 = Math.floor(x0 / cell), ci1 = Math.floor(x1 / cell), cj0 = Math.floor(y0 / cell), cj1 = Math.floor(y1 / cell), i0 = Math.floor(Math.floor(x0 / cell) / BLOCK), i1 = Math.floor(Math.floor(x1 / cell) / BLOCK), j0 = Math.floor(Math.floor(y0 / cell) / BLOCK), j1 = Math.floor(Math.floor(y1 / cell) / BLOCK);
  if (blocks.size > 6000) blocks.clear();
  for (let bj = j0; bj <= j1; bj++) for (let bi = i0; bi <= i1; bi++) {
    const k = `${kind}|${seed}|${bi}|${bj}`;
    let list = blocks.get(k);
    if (!list) { list = []; for (let j = bj * BLOCK; j < (bj + 1) * BLOCK; j++) for (let i = bi * BLOCK; i < (bi + 1) * BLOCK; i++) { const st = inCell(seed, i, j); if (st) list.push(st); } blocks.set(k, list); }
    for (const st of list) { const ci = Math.floor(st.x / cell), cj = Math.floor(st.y / cell); if (ci >= ci0 && ci <= ci1 && cj >= cj0 && cj <= cj1) out.push(st); }   // (only the cells that touch the rectangle: the same answer as working each one out)
  }
  return out;
}

/** All sticks whose cell touches the rectangle (tiles). */
export function sticksIn(seed: number, x0: number, y0: number, x1: number, y1: number): Stick[] {
  return inBlocks('stick', seed, STICK_CELL, stickInCell, x0, y0, x1, y1);
}

/** Stones: the same idea, standing about instead of lying (they are drawn upright), about as common. Their keys are kept apart from the sticks'. */
export const STONE_CELL = 10, STONE_CHANCE = 0.4;   // the same density as the sticks
export function stoneInCell(seed: number, i: number, j: number): Stick | null {
  const s = seed & 0xffff;
  if (hash01(i, j, s, 311) > STONE_CHANCE) return null;
  return { key: `${i},${j}`, x: (i + 0.1 + 0.8 * hash01(i, j, s, 312)) * STONE_CELL, y: (j + 0.1 + 0.8 * hash01(i, j, s, 313)) * STONE_CELL, angle: 0 };
}
export function stonesIn(seed: number, x0: number, y0: number, x1: number, y1: number): Stick[] {
  return inBlocks('stone', seed, STONE_CELL, stoneInCell, x0, y0, x1, y1);
}
