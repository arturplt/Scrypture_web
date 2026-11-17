/**
 * Bóbr world map, part 7: hoops to fly through. They hang in the air at fixed places that come from the world's seed (one chance per
 * 36 x 36 tile cell), each standing upright and facing its own way. A hoop is passed when the plane's path crosses its disc.
 * Positions are in tiles (y south, like the map); heights are in tiles above the ground (about 0.18 tiles per metre for the glider).
 */
import { hash01 } from './worldgen';

export const HOOP_CELL = 36;
export const HOOP_RADIUS = 3.6;
export interface Hoop { key: string; x: number; y: number; h: number; angle: number; r: number }   // angle: the way its disc faces (radians, y south)

/** The hoop of one cell, or null. Cells are 36 tiles wide; about half of them hold a hoop, 4.5 to 10.5 tiles up (25 to 58 m for the glider). */
export function hoopInCell(seed: number, i: number, j: number): Hoop | null {
  const s = seed & 0xffff;
  if (hash01(i, j, s, 201) > 0.55) return null;
  return {
    key: `${i},${j}`,
    x: (i + 0.2 + 0.6 * hash01(i, j, s, 202)) * HOOP_CELL,
    y: (j + 0.2 + 0.6 * hash01(i, j, s, 203)) * HOOP_CELL,
    h: 4.5 + 6 * hash01(i, j, s, 204),
    angle: hash01(i, j, s, 205) * Math.PI,
    r: HOOP_RADIUS,
  };
}

/** All hoops whose cell touches the rectangle (tiles). */
export function hoopsIn(seed: number, x0: number, y0: number, x1: number, y1: number): Hoop[] {
  const out: Hoop[] = [];
  for (let j = Math.floor(y0 / HOOP_CELL); j <= Math.floor(y1 / HOOP_CELL); j++) for (let i = Math.floor(x0 / HOOP_CELL); i <= Math.floor(x1 / HOOP_CELL); i++) {
    const h = hoopInCell(seed, i, j); if (h) out.push(h);
  }
  return out;
}

/** Did the straight path a -> b (x, y, height) go through the hoop's disc, from either side? */
export function passedHoop(h: Hoop, ax: number, ay: number, ah: number, bx: number, by: number, bh: number): boolean {
  const nx = Math.cos(h.angle), ny = Math.sin(h.angle);
  const s0 = (ax - h.x) * nx + (ay - h.y) * ny, s1 = (bx - h.x) * nx + (by - h.y) * ny;
  if (s0 === s1 || s0 * s1 > 0) return false;                       // stays on one side
  const t = s0 / (s0 - s1);
  const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, ph = ah + (bh - ah) * t;
  const along = (px - h.x) * -ny + (py - h.y) * nx;                  // across the disc, on the ground
  return Math.hypot(along, ph - h.h) <= h.r;
}
