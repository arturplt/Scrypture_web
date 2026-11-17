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

/** All sticks whose cell touches the rectangle (tiles). */
export function sticksIn(seed: number, x0: number, y0: number, x1: number, y1: number): Stick[] {
  const out: Stick[] = [];
  for (let j = Math.floor(y0 / STICK_CELL); j <= Math.floor(y1 / STICK_CELL); j++) for (let i = Math.floor(x0 / STICK_CELL); i <= Math.floor(x1 / STICK_CELL); i++) {
    const st = stickInCell(seed, i, j); if (st) out.push(st);
  }
  return out;
}

/** Stones: the same idea, standing about instead of lying (they are drawn upright), about as common. Their keys are kept apart from the sticks'. */
export const STONE_CELL = 10, STONE_CHANCE = 0.4;   // the same density as the sticks
export function stoneInCell(seed: number, i: number, j: number): Stick | null {
  const s = seed & 0xffff;
  if (hash01(i, j, s, 311) > STONE_CHANCE) return null;
  return { key: `${i},${j}`, x: (i + 0.1 + 0.8 * hash01(i, j, s, 312)) * STONE_CELL, y: (j + 0.1 + 0.8 * hash01(i, j, s, 313)) * STONE_CELL, angle: 0 };
}
export function stonesIn(seed: number, x0: number, y0: number, x1: number, y1: number): Stick[] {
  const out: Stick[] = [];
  for (let j = Math.floor(y0 / STONE_CELL); j <= Math.floor(y1 / STONE_CELL); j++) for (let i = Math.floor(x0 / STONE_CELL); i <= Math.floor(x1 / STONE_CELL); i++) {
    const st = stoneInCell(seed, i, j); if (st) out.push(st);
  }
  return out;
}
