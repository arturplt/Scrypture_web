/**
 * Water that follows the ground. On a hilly world (the Lake District) a pond is a water LEVEL, not a tile count: it floods only the
 * connected tiles whose ground lies at or below that level, lowest first, so its shore runs along the contours (natural curves) and
 * it can never climb a hillside. A dam sets the highest level the pond can reach (its crest); the pond also stays on the upstream
 * side of the dam, so it cannot leak round the end of it and run on downhill.
 *
 * Pure: it only asks `PondEnv` about the ground, so it is tested with small made-up heightmaps.
 */
export const DAM_HEIGHT = 1.5;      // metres a finished dam stands above the ground under it, on a map with 10 m tiles (see `damHeight`)
export const DAM_TILE_SHARE = 0.15; // the dam stands this share of a tile's width high: a dam is a game-scale thing, and on a 50 m tile map a 1.5 m crest would hold no pond at all
export const POND_MAX = 120;        // most tiles one pond floods
export const POND_MIN = 5;          // a dam site that would hold fewer tiles than this is not worth building

export interface PondEnv {
  /** Ground height in metres at a tile's centre. */
  h(x: number, y: number): number;
  /** Is there water on this tile now (a river or lake the pond must not count again)? */
  wet(x: number, y: number): boolean;
  /** May the pond flood this tile (it lies on the upstream side of its dam)? */
  ok(x: number, y: number): boolean;
  /** Is this a lake of the map (water the pond cannot stand above), as opposed to a stream it drowns? Without it, no water counts as a lake. */
  lake?(x: number, y: number): boolean;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);

export class Pond {
  /** Tiles flooded, in the order they flooded: lowest ground first, so the last one is the highest. */
  tiles: [number, number][] = [];
  /** The water level in metres: the ground height of the highest tile flooded (the seed's own, before any). */
  level: number;
  private front: { h: number; x: number; y: number }[] = [];   // land that could flood next, lowest first
  private seen = new Set<number>();

  /** Water tiles at the start that never drain (a real tarn's own water): `shrink` stops at this many. */
  base = 0;
  /** The rim tile where this pond's water would run out downhill (set once the pond is full, if it was made to look for one). */
  spill: [number, number] | null = null;
  /** The tile just outside the rim that the water runs down to: where overflow starts its way downhill. */
  spillTo: [number, number] | null = null;

  constructor(private env: PondEnv, readonly sx: number, readonly sy: number, public cap: number, private findSpill = false) {
    this.level = env.h(sx, sy);
    this.rebuild();
  }

  private push(x: number, y: number) {
    const k = key(x, y);
    if (this.seen.has(k) || !this.env.ok(x, y) || this.env.wet(x, y)) return;
    this.seen.add(k);
    const h = this.env.h(x, y);
    let lo = 0, hi = this.front.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.front[m].h <= h) lo = m + 1; else hi = m; }
    this.front.splice(lo, 0, { h, x, y });
  }
  private reach(x: number, y: number) { for (const [dx, dy] of N4) this.push(x + dx, y + dy); }
  /** The frontier again from the seed and the tiles flooded (after a tile is given back, or tiles are adopted). */
  private rebuild() {
    this.front = []; this.seen = new Set(this.tiles.map(([x, y]) => key(x, y)));
    this.push(this.sx, this.sy); this.reach(this.sx, this.sy);
    for (const [x, y] of this.tiles) this.reach(x, y);
  }

  estimate(): number { return Pond.estimate(this.env, this.sx, this.sy, this.cap, this.findSpill); }
  okTile(x: number, y: number): boolean { return this.env.ok(x, y); }

  /** The tile that would flood next, or null if the pond is full (the next ground is above the cap) or at its size limit. */
  next(): [number, number] | null {
    const f = this.front[0];
    if (!f || f.h > this.cap || this.tiles.length >= POND_MAX) return null;
    if (this.findSpill) { const out = this.escapes(f); if (out) { this.spill = [f.x, f.y]; this.spillTo = out; return null; } }
    this.spill = null;
    return [f.x, f.y];
  }
  /** A stream on the pond's side of the dam: the pond drowns it, so water running into it is still in the pond. */
  private river(x: number, y: number) { return this.env.wet(x, y) && !this.env.lake?.(x, y) && this.env.ok(x, y); }
  /** Would water standing at this frontier tile run out of the pond? A lower neighbour the pond has not reached counts only if water running down from it does not end up back in the pond (on a grid, a tile can have a lower neighbour the flood has simply not got to yet). */
  private escapes(f: { h: number; x: number; y: number }): [number, number] | null {
    const mine = new Set(this.tiles.map(([x, y]) => key(x, y)));
    for (const [dx, dy] of N4) {
      let x = f.x + dx, y = f.y + dy; const first: [number, number] = [x, y];
      if (this.env.h(x, y) >= f.h - 1e-6 || mine.has(key(x, y)) || !this.env.ok(x, y) || this.river(x, y)) continue;   // (across a dam is the dam's own business: its crest caps the level)
      let back = false;
      for (let i = 0; i < 40; i++) {                              // follow the water downhill from there
        if (mine.has(key(x, y)) || this.river(x, y) || (this.seen.has(key(x, y)) && !(x === f.x && y === f.y))) { back = true; break; }
        let bx = x, by = y, bh = this.env.h(x, y);
        for (const [ex, ey] of N4) { const h = this.env.h(x + ex, y + ey); if (h < bh) { bh = h; bx = x + ex; by = y + ey; } }
        if (bx === x && by === y) break;                          // a hollow of its own
        x = bx; y = by;
      }
      if (!back) return first;
    }
    return null;
  }
  /** Volume (tile-metres) needed to flood the next tile: raise the whole sheet to its ground, plus a little for the tile itself. Null if there is none to flood. */
  cost(): number | null {
    const t = this.next(); if (!t) return null;
    return Math.max(0, this.env.h(t[0], t[1]) - this.level) * Math.max(1, this.tiles.length) + 0.5;
  }
  /** Volume that must be lost before the highest tile is given back (null while only the base is left). */
  downCost(): number | null {
    if (this.tiles.length <= this.base) return null;
    const rest = this.tiles.slice(0, -1);
    const prev = rest.length ? Math.max(this.env.h(this.sx, this.sy), ...rest.map(([x, y]) => this.env.h(x, y))) : this.env.h(this.sx, this.sy);
    return Math.max(0, this.level - prev) * Math.max(1, this.tiles.length) + 0.5;
  }
  /** Start from water that is already there (a real tarn): its tiles stay, and the pond grows out from them. */
  setBase(tiles: [number, number][]) {
    this.tiles = tiles.slice(); this.base = tiles.length;
    this.level = Math.max(...tiles.map(([x, y]) => this.env.h(x, y)));
    this.rebuild();
  }
  /** Flood the next tile; the level rises to its ground. */
  grow(): [number, number] | null {
    const t = this.next(); if (!t) return null;
    this.front.shift();
    this.tiles.push(t);
    this.level = Math.max(this.level, this.env.h(t[0], t[1]));
    this.reach(t[0], t[1]);
    return t;
  }
  /** True while the highest tile flooded lies above the cap (a broken or lowered dam): the pond must give tiles back. */
  get over(): boolean { const t = this.tiles[this.tiles.length - 1]; return !!t && this.env.h(t[0], t[1]) > this.cap; }
  /** Give the highest tile back (the water falls to the next one down). */
  shrink(): [number, number] | null {
    if (this.tiles.length <= this.base) return null;
    const t = this.tiles.pop(); if (!t) return null;
    const last = this.tiles[this.tiles.length - 1];
    this.level = last ? Math.max(this.env.h(this.sx, this.sy), ...this.tiles.map(([x, y]) => this.env.h(x, y))) : this.env.h(this.sx, this.sy);
    this.rebuild();
    return t;
  }
  /** Take over water tiles already there (a saved pond coming back). */
  adopt(tiles: [number, number][]) {
    this.tiles = tiles.slice(0, POND_MAX).sort((a, b) => this.env.h(a[0], a[1]) - this.env.h(b[0], b[1]));
    this.level = Math.max(this.env.h(this.sx, this.sy), ...this.tiles.map(([x, y]) => this.env.h(x, y)));
    this.rebuild();
  }
  /** How many tiles a pond at this seed would hold at `cap`, without flooding anything. */
  static estimate(env: PondEnv, sx: number, sy: number, cap: number, findSpill = false): number {
    const p = new Pond(env, sx, sy, cap, findSpill);
    while (p.grow()) { /* fills */ }
    return p.tiles.length;
  }
}
