/**
 * Wind tunnels: long straight corridors where the wind runs hard along the corridor, whatever the day's wind is doing. They come from the
 * world's seed (one chance per 120 x 120 tile cell), a few tiles wide and about a hundred long, and fade out at the sides and the ends.
 */
import { hash01 } from './worldgen';
import { wrapCell } from './globe';

export const TUNNEL_CELL = 120, TUNNEL_CHANCE = 0.35, TUNNEL_HALF_WIDTH = 7, TUNNEL_HALF_LENGTH = 55;
export interface Tunnel { key: string; x: number; y: number; angle: number }

export function tunnelInCell(seed: number, i: number, j: number): Tunnel | null {
  const s = seed & 0xffff, wi = wrapCell(i, TUNNEL_CELL), wj = wrapCell(j, TUNNEL_CELL);
  if (hash01(wi, wj, s, 401) > TUNNEL_CHANCE) return null;
  return { key: `${i},${j}`, x: (i + 0.2 + 0.6 * hash01(wi, wj, s, 402)) * TUNNEL_CELL, y: (j + 0.2 + 0.6 * hash01(wi, wj, s, 403)) * TUNNEL_CELL, angle: hash01(wi, wj, s, 404) * Math.PI * 2 };
}

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** How much a point is inside a tunnel (0..1) and which way it blows (unit vector, y south). Zero outside every tunnel. */
export function tunnelAt(seed: number, x: number, y: number): { k: number; dx: number; dy: number } {
  let best = { k: 0, dx: 0, dy: 0 };
  const ci = Math.floor(x / TUNNEL_CELL), cj = Math.floor(y / TUNNEL_CELL);
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    const t = tunnelInCell(seed, i, j); if (!t) continue;
    const ax = Math.cos(t.angle), ay = Math.sin(t.angle), px = x - t.x, py = y - t.y;
    const along = px * ax + py * ay, lat = -px * ay + py * ax;
    const k = smooth(1 - Math.abs(lat) / TUNNEL_HALF_WIDTH) * smooth((TUNNEL_HALF_LENGTH - Math.abs(along)) / 12);
    if (k > best.k) best = { k, dx: ax, dy: ay };
  }
  return best;
}
