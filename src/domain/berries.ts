/**
 * Berries: some of the world's bushes bear them (which ones is fixed by the seed, per tile, so a bush that grows there later
 * bears them too). On foot the player picks a ripe bush clean; it is ripe again a few world days later. The berries go into
 * the inventory and are what the wild beavers are fed with (see `BeaversManager.feed`).
 * Only the bushes picked and not yet ripe again are kept, and saved with the world.
 */
import { hash01, tileKey, keyX, keyY, DECO_BUSH, type World } from './worldgen';

export const BERRY_CHANCE = 0.5;         // the share of bushes that bear berries
export const BERRY_YIELD = 2;            // berries from one picking
export const BERRY_REGROW = 180;         // seconds until a picked bush is ripe again (3 world days)
export const BERRY_PICK_RADIUS = 2.2;    // how close (tiles) the player must stand to the bush
export const MAX_PICKED_BUSHES = 2000;

/** One picked bush: [x, y, seconds until it is ripe again]. */
export type SavedBerry = [number, number, number];

/** Does a bush on this tile bear berries? */
export const isBerryBush = (seed: number, x: number, y: number) => hash01(x, y, seed & 0xffff, 501) < BERRY_CHANCE;

export function sanitizeBerries(raw: unknown): SavedBerry[] {
  const out: SavedBerry[] = [], seen = new Set<number>();
  for (const b of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(b) || b.length < 3 || !b.every(n => typeof n === 'number' && Number.isFinite(n))) continue;
    const [x, y, left] = b as number[];
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || seen.has(tileKey(x, y))) continue;
    seen.add(tileKey(x, y));
    out.push([x, y, Math.max(0, Math.min(BERRY_REGROW, left))]);
    if (out.length >= MAX_PICKED_BUSHES) break;
  }
  return out;
}

export class BerryPatch {
  readonly world: World;
  /** Picked bushes, by tile key: seconds until ripe again. */
  readonly picked = new Map<number, number>();
  /** Set when a bush was picked or grew back: the map saves and clears it. */
  dirty = false;

  constructor(world: World, saved: SavedBerry[] = []) {
    this.world = world;
    for (const [x, y, left] of saved) if (left > 0) this.picked.set(tileKey(x, y), left);
  }

  /** A tile already known to hold a bush: are there berries on it now? (For drawing: no look at the tile itself.) */
  ripeBush(x: number, y: number) { return isBerryBush(this.world.seed, x, y) && !this.picked.has(tileKey(x, y)); }
  ripe(x: number, y: number) { return this.world.stateAt(x, y).d === DECO_BUSH && this.ripeBush(x, y); }

  /** The nearest ripe bush within reach of (px, py), or null. A bush stands in the middle of its tile. */
  near(px: number, py: number, reach = BERRY_PICK_RADIUS): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null, bd = reach;
    const r = Math.ceil(reach);
    for (let y = Math.floor(py) - r; y <= Math.floor(py) + r; y++) for (let x = Math.floor(px) - r; x <= Math.floor(px) + r; x++) {
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d <= bd && this.ripe(x, y)) { bd = d; best = { x, y }; }
    }
    return best;
  }

  /** Pick the bush on this tile. Returns how many berries it gave (0 if there were none). */
  pick(x: number, y: number): number {
    if (!this.ripe(x, y)) return 0;
    if (this.picked.size >= MAX_PICKED_BUSHES) this.picked.delete(this.picked.keys().next().value!);   // the oldest grows back early
    this.picked.set(tileKey(x, y), BERRY_REGROW);
    this.dirty = true;
    return BERRY_YIELD;
  }

  step(dt: number): void {
    for (const [k, left] of this.picked) {
      if (left - dt <= 0) { this.picked.delete(k); this.dirty = true; } else this.picked.set(k, left - dt);
    }
  }

  toSaved(): SavedBerry[] { return [...this.picked].map(([k, left]) => [keyX(k), keyY(k), Math.round(left)]); }
}
