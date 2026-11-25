/**
 * Bóbr world map, phase 5: beavers. A pair lives in a burrow by the water (colonies come from the world's seed, one chance per
 * 48 x 48 tile cell, and settle only where a narrow stretch of water can be dammed). They fetch the sticks and stones lying about
 * (the same ones the player picks up: what a beaver takes is gone for the player) and lay them across the water, tile by tile.
 * A finished dam holds water: its region aims for more water (`Ecosystem.addWaterTarget`) and a pond grows beside it.
 * Positions are in tiles (y south, like the map); a tile's centre is at its whole coordinates.
 */
import { Pond, DAM_TILE_SHARE, POND_MIN } from './hydrology';
import { lakeWaterAt, LAKE_WATER, lakeData } from './lakedistrict';
import { hash01, tileKey, WATER, DECO_NONE, DECO_BUSH, type World } from './worldgen';
import { insideFace, canonTile } from './cube';
import { isBerryBush } from './berries';
import { isNight } from './sky';
import type { Ecosystem, Random01 } from './ecosystem';
import { sticksIn, stonesIn } from './sticks';
import { MAX_DAM_TILES, MAX_TRUSTED, BURROW_STICKS, ADULT_AGE, OLD_AGE, DEATH_AGE, type SavedBeavers } from './worldsave';

export const COLONY_CELL = 48, COLONY_CHANCE = 0.6;
export const DAM_REACH = 16;             // how far from its seed point a colony looks for water to dam
/** How high a dam stands, in metres: a share of the map's tile width (1.5 m on the 10 m map, 7.5 m on the 50 m one). */
const damHeight = () => DAM_TILE_SHARE * (lakeData()?.tileM ?? 10);
export const HILL_REACH = 32;           // hilly worlds: a colony looks this far from its seed point for a valley to dam (the streams are few and a dam needs the right valley)
export const DAM_RUN = 20, DAM_MAX_LEN = 40;   // hilly worlds: a dam runs on over low ground up to this far each side of the stream, and at most this long in all
export const DAM_MAX_SPAN = 6;           // tiles of water a dam can cross
export const DAM_STICKS = 2, DAM_STONES = 1;   // what one dam tile takes
export const HAUL_REACH = 60;            // how far from the burrow a beaver goes for a stick or stone (about 45 of each lie that near on dry land; a lake colony finds only a few stones)
export const BEAVER_SPEED = 1.6;         // tiles per second (the player walks 2.6)
export const BUILD_TIME = 1;             // seconds to lay one stick or stone
export const POND_TILES = 40;            // extra water tiles a finished dam lets its region hold
export const POND_TICK = 4;              // seconds between two tiles of pond growth
export const GIVE_RADIUS = 1.5;          // how close the player must stand to hand over a stick or stone
export const FEED_RADIUS = 2;            // how close the player must stand to a beaver to feed it
export const FULL_TIME = 90;             // seconds a fed beaver stays full (and cannot be fed again)
export const EAT_TIME = 1.5;             // seconds it stops to eat
export const FED_SPEED = 1.4;            // a full beaver moves this much faster
export const MAX_TRUST = 5;              // a colony's trust in the player: one step per feeding
export const KIT_AGE = 120;              // seconds of age (2 world days) at which a kit becomes young; at ADULT_AGE (6 days) it is grown
export const LITTER_WAIT = 90;           // seconds a pair with a home and a finished dam waits between one brood having grown and the next litter
export const BROOD_CAP = 6;              // beavers in one colony (nothing sends the grown young away yet)
export const FOOD_FULL = 300;            // seconds of food a fed beaver has (5 world days); it falls by one a second
export const HUNGRY_AT = 100;            // below this it goes to gnaw bark, and a colony with a hungry adult does not breed
export const FOOD_REACH = 24;            // how far from the burrow it looks for a bush or tree to gnaw (14 left a lake colony nothing to eat: it never bred and died out)
export const GNAW_TIME = 3;              // seconds at the trunk
export const BARK_BUSH = 100, BARK_TREE = 150;   // food one bush (which is eaten whole) or one step of a tree gives
export const FELL_STICKS = 3;            // sticks a tree gnawed through gives (one is carried, the rest go straight on), a bush gives one
export const LEAK_EVERY = 120;           // seconds between two sticks a standing dam loses (one tile, at random); in heavy rain it is four times as often (a soak run showed 60 was more than the sticks within reach could keep up with)
export const FIRE_FLEE = 5;              // tiles: a beaver this near a fire runs for the water (or into the burrow)
export const BURN_TIME = 2;              // seconds a fire next to the burrow takes to burn it down (it is a heap of sticks)
export const TRUST_COME = 2, TRUST_FOLLOW = 4;   // a colony this trusting sends its beavers to a player holding berries, and lets its kits follow the player
export const BREAK_TRUST_LOSS = 1;       // trust a colony loses when the player breaks its dam
export const LEAVE_REACH = 150;         // how far a grown young beaver looks for a mate or a place to settle
const PACE = { baby: 0.6, young: 0.5, adult: 1, old: 0.6 };   // how fast each stage walks, against an adult
const SCAN_EVERY = 2, RETRY_AFTER = 60;  // seconds between looks for new colonies, and before a cell with no site is tried again

export type Haul = 'stick' | 'stone';
export interface Picked { sticks: Set<string>; stones: Set<string> }
export interface DamTile { x: number; y: number; sticks: number; stones: number }
export interface Colony {
  key: string;
  bx: number; by: number;                // the burrow
  dam: DamTile[];                        // in building order, from one bank to the other
  px: number; py: number;                // where the pond grows from (one side of the dam)
  done: boolean;
  pondAcc: number;
  pond?: Pond;                           // on a hilly world: the pond as a water level behind the dam (see hydrology.ts)
  trust: number;                         // 0..MAX_TRUST: how often the player has fed this colony
  pending: boolean;                      // reserved for a beaver that is on its way: no beavers yet, and not abandoned
  abandoned: boolean;                    // its last beaver died: the burrow and dam stay (and start to decay, B4)
  burnAcc: number;                       // seconds a fire has stood by the burrow
  leakAcc: number;                       // seconds since the dam last lost a stick
  litterAcc: number;                      // seconds the pair has waited for the next litter
  bsticks: number;                       // sticks laid on the burrow; at BURROW_STICKS it is a home (the pair builds it before the dam)
}
export type Stage = 'baby' | 'young' | 'adult' | 'old';
export const stageOf = (age: number): Stage => (age < KIT_AGE ? 'baby' : age < ADULT_AGE ? 'young' : age < OLD_AGE ? 'adult' : 'old');   // an old beaver is slow and no longer hauls or breeds; it dies at DEATH_AGE
export type BeaverState = 'idle' | 'seek' | 'carry' | 'build' | 'wander' | 'enter' | 'inside' | 'leave' | 'forage' | 'gnaw' | 'flee';
export interface Beaver {
  id: number; colony: string; sex: 'm' | 'f'; age: number;   // age in seconds, up to ADULT_AGE (see stageOf)
 
  x: number; y: number; face: 1 | -1;    // face: 1 looks east (the way the sprites are drawn)
  state: BeaverState; carry: Haul | null;
  timer: number; tx: number; ty: number;
  item: { kind: Haul; key: string } | null;   // the stick or stone it is going for
  moving: boolean; phase: number;        // phase: seconds spent moving (for the walk cycle)
  hx: number; hy: number;                // the way it last moved (a unit vector): the 3D view turns the picture by it, as seen from the camera
  food: number;                          // seconds of food left (see HUNGRY_AT)
  forage: { x: number; y: number } | null;   // the bush or tree it is going to gnaw
  dest: string | null;                   // the colony it is walking to (state 'leave'), where it will settle
  inside: boolean;                       // resting in the burrow: not drawn, cannot be fed
  full: number; eat: number;             // seconds it stays full after being fed, and seconds left of eating (it stands still meanwhile)
}
export interface BeaverTally { hauled: number; given: number; fed: number; burnt: number; gnawed: number; leaked: number; damsBroken: number; born: number; died: number; left: number; damTiles: number; damsDone: number; pond: number }

export const damTileDone = (d: DamTile) => d.sticks >= DAM_STICKS && d.stones >= DAM_STONES;
/** Is the burrow built (so it counts as a home)? */
export const isHome = (c: Colony) => c.bsticks >= BURROW_STICKS;
/** Is every piece of the dam in place (none has leaked away, none is missing)? */
export const damIntact = (c: Colony) => c.dam.every(damTileDone);
/** A dam gives way when more than half its tiles have lost every stick. */
export const damBroken = (c: Colony) => c.dam.filter(d => d.sticks === 0).length * 2 > c.dam.length;

/** Where the colony of one cell would like to live, or null (cells are 48 tiles wide; a bit over half hold one). */
export function colonyInCell(seed: number, i: number, j: number): { key: string; x: number; y: number } | null {
  const s = seed & 0xffff;
  if (hash01(i, j, s, 401) > COLONY_CHANCE) return null;
  const x = Math.round((i + 0.2 + 0.6 * hash01(i, j, s, 402)) * COLONY_CELL), y = Math.round((j + 0.2 + 0.6 * hash01(i, j, s, 403)) * COLONY_CELL);
  if (!insideFace(x, y, 60)) return null;   // (on a cube-sphere: on a face, a little way from its edges; the net cell is the place and the key)
  return { key: `${i},${j}`, x, y };
}

export class BeaversManager {
  readonly world: World;
  readonly eco: Ecosystem;
  readonly picked: Picked;
  readonly beavers: Beaver[] = [];
  readonly colonies = new Map<string, Colony>();
  readonly tally: BeaverTally = { hauled: 0, given: 0, fed: 0, burnt: 0, gnawed: 0, leaked: 0, damsBroken: 0, born: 0, died: 0, left: 0, damTiles: 0, damsDone: 0, pond: 0 };
  /** Set when a beaver took a stick or stone, or a dam changed: the map saves and clears it. */
  dirty = false;
  /** On: the colonies keep to the sky's clock (the map turns it on): they work from dusk to dawn and sleep in the burrow by day. */
  dayNight = false;
  /** The player on foot (the map sets it each frame, null when flying): trusting colonies come to one who holds berries. */
  player: { x: number; y: number; berries: number } | null = null;
  private rng: Random01;
  private nextId = 1;
  private scanAcc = SCAN_EVERY;
  private clock = 0;
  private failed = new Map<string, number>();      // cells where no site was found, and when
  private orphans: DamTile[] = [];                 // saved dam tiles whose colony has not come back yet
  private savedAbandoned = new Set<string>();
  private savedPop = new Map<string, { sex: 'm' | 'f'; age: number }[]>();   // saved beavers of colonies that have not come back yet
  private savedBurrows = new Map<string, [number, number, number]>();   // saved burrows whose colony has not come back yet
  private savedTrust = new Map<string, number>();  // trust of colonies that have not come back yet

  constructor(world: World, eco: Ecosystem, rng: Random01 = Math.random, picked: Picked = { sticks: new Set(), stones: new Set() }, saved?: SavedBeavers) {
    this.world = world; this.eco = eco; this.rng = rng; this.picked = picked;
    for (const [x, y, sticks, stones] of saved?.dams ?? []) this.orphans.push({ x, y, sticks, stones });
    for (const [key, n] of saved?.trust ?? []) this.savedTrust.set(key, n);
    for (const [key, x, y, n] of saved?.burrows ?? []) this.savedBurrows.set(key, [x, y, n]);
    for (const k of saved?.abandoned ?? []) this.savedAbandoned.add(k);
    for (const [key, sex, age] of saved?.pop ?? []) { const l = this.savedPop.get(key) ?? []; l.push({ sex: sex ? 'f' : 'm', age }); this.savedPop.set(key, l); }
  }

  /** Every dam tile with something laid on it (for drawing). */
  damTiles(): DamTile[] {
    const out = this.orphans.filter(d => d.sticks || d.stones);
    for (const c of this.colonies.values()) for (const d of c.dam) if (d.sticks || d.stones) out.push(d);
    return out;
  }
  /** Every dam that has been begun, whole: its empty tiles too, so a half-built dam comes back as long as it was. */
  toSaved(): SavedBeavers {
    const out = [...this.orphans];
    for (const c of this.colonies.values()) if (c.dam.some(d => d.sticks || d.stones)) out.push(...c.dam);
    const trust = new Map(this.savedTrust);
    for (const c of this.colonies.values()) if (c.trust > 0) trust.set(c.key, c.trust);
    const pop: [string, number, number][] = [];
    const plain = (l: Beaver[]) => l.length === 2 && l.some(b => b.sex === 'm') && l.some(b => b.sex === 'f') && l.every(b => b.age <= ADULT_AGE);   // the pair the seed makes: nothing to keep
    for (const [k, l] of this.savedPop) for (const b of l) pop.push([k, b.sex === 'f' ? 1 : 0, b.age]);
    for (const c of this.colonies.values()) { const l = this.beavers.filter(b => b.colony === c.key); if (!c.pending && !c.abandoned && !plain(l)) for (const b of l) pop.push([c.key, b.sex === 'f' ? 1 : 0, b.age]); }
    const abandoned = new Set(this.savedAbandoned);
    for (const c of this.colonies.values()) if (c.abandoned) abandoned.add(c.key);
    const burrows = new Map(this.savedBurrows);
    for (const c of this.colonies.values()) if (c.bsticks > 0) burrows.set(c.key, [c.bx, c.by, c.bsticks]);
    // (dams and burrows are saved at their canonical places: on a globe the frame of this visit is not the next one's)
    return { dams: out.slice(0, MAX_DAM_TILES).map(d => { const [x, y] = canonTile(d.x, d.y); return [x, y, d.sticks, d.stones] as [number, number, number, number]; }), trust: [...trust].slice(0, MAX_TRUSTED), burrows: [...burrows].slice(0, MAX_TRUSTED).map(([k, v]) => { const [x, y] = canonTile(v[0], v[1]); return [k, x, y, v[2]] as [string, number, number, number]; }), pop: pop.slice(0, 4 * MAX_TRUSTED), abandoned: [...abandoned].slice(0, MAX_TRUSTED) };
  }

  private water(x: number, y: number) { return this.world.terrainAt(x, y) === WATER; }

  /** The pond a dam at these tiles holds (its crest is the lowest bed it crosses plus DAM_HEIGHT: water goes over the lowest point), seeded at (px, py): it floods only the seed's side of the dam, up to the dam's crest. */
  private makePond(dam: { x: number; y: number }[], px: number, py: number): Pond {
    const horiz = dam.length > 1 ? dam[0].y === dam[1].y : py !== dam[0].y, lx = dam[0].x, ly = dam[0].y;   // the dam is one straight line: along x (constant y) or along y; the seed is on one side of it
    const ok = horiz ? (_x: number, y: number) => (y - ly) * (py - ly) > 0 : (x: number) => (x - lx) * (px - lx) > 0;
    return new Pond(this.eco.pondEnv(ok), px, py, Math.min(...dam.map(d => this.world.metresAt(d.x, d.y))) + damHeight(), true);   // (true: it stops where its water would run out over low ground, instead of standing above it)
  }
  /** A dam stands or falls: a hilly world's pond gets its crest back or loses it (and drains tile by tile), a flat one moves its region's water target. */
  private holds(c: Colony, yes: boolean) {
    if (this.eco.hilly) {
      c.pond ??= this.makePond(c.dam, c.px, c.py);
      c.pond.cap = yes ? Math.min(...c.dam.map(d => this.world.metresAt(d.x, d.y))) + damHeight() : -Infinity;
    } else this.eco.addWaterTarget(c.px, c.py, yes ? POND_TILES : -POND_TILES);
  }

  /**
   * A stretch of water to dam near (cx, cy): a straight run of 1..6 water tiles with land at both ends and water on both sides
   * of it (so it cuts a channel or a neck, not a corner of a bay). River lines are preferred, then the nearest.
   */
  private findSite(cx: number, cy: number): { tiles: [number, number][]; px: number; py: number } | null {
    if (this.eco.hilly) return this.findSiteHilly(cx, cy);
    let best: { tiles: [number, number][]; px: number; py: number } | null = null, bestScore = Infinity;
    for (let y = cy - DAM_REACH; y <= cy + DAM_REACH; y++) for (let x = cx - DAM_REACH; x <= cx + DAM_REACH; x++) {
      if (!this.water(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (this.water(x - dx, y - dy)) continue;                       // only from the first tile of a run
        const tiles: [number, number][] = [];
        while (tiles.length <= DAM_MAX_SPAN && this.water(x + dx * tiles.length, y + dy * tiles.length)) tiles.push([x + dx * tiles.length, y + dy * tiles.length]);
        if (tiles.length > DAM_MAX_SPAN) continue;
        let a = false, b = false, river = false;                        // water on either side of the run
        for (const [tx, ty] of tiles) { a ||= this.water(tx + dy, ty + dx); b ||= this.water(tx - dy, ty - dx); river ||= this.eco.riverTiles.has(tileKey(tx, ty)); }
        if (!a || !b) continue;
        const [mx, my] = tiles[tiles.length >> 1];
        const score = Math.hypot(mx - cx, my - cy) + (river ? 0 : DAM_REACH) + tiles.length;
        if (score >= bestScore) continue;
        let side = hash01(mx, my, this.world.seed & 0xffff, 404) < 0.5 ? 1 : -1;
        if (this.eco.hilly) {                                           // the pond lies uphill of the dam, and must be big enough to be worth it
          side = this.world.metresAt(mx + dy * 2, my + dx * 2) >= this.world.metresAt(mx - dy * 2, my - dx * 2) ? 1 : -1;
          if (this.makePond(tiles.map(([x, y]) => ({ x, y })), mx + dy * 2 * side, my + dx * 2 * side).estimate() < POND_MIN) continue;
        }
        bestScore = score; best = { tiles, px: mx + dy * 2 * side, py: my + dx * 2 * side };
      }
    }
    return best;
  }

  /**
   * A hilly world: the dam is one straight line across the valley. It starts at a stream tile and runs on both ways over every tile lower than the
   * crest (the stream's bed plus the dam's height), until the ground rises to the crest on each side, so water cannot go round it. Of all the streams
   * and both directions near (cx, cy), the one that fills the biggest pond with the least dam (fewest tiles per tile of water, then the nearest) wins.
   * The pond lies on the higher side. Null if no dam of at most DAM_MAX_LEN tiles holds a pond of POND_MIN tiles.
   */
  private findSiteHilly(cx: number, cy: number): { tiles: [number, number][]; px: number; py: number } | null {
    const h = (x: number, y: number) => this.world.metresAt(x, y);
    let best: { tiles: [number, number][]; px: number; py: number } | null = null, bestScore = Infinity;
    for (let y = cy - HILL_REACH; y <= cy + HILL_REACH; y++) for (let x = cx - HILL_REACH; x <= cx + HILL_REACH; x++) {
      if (!this.water(x, y) || lakeWaterAt(x, y) === LAKE_WATER) continue;
      const river = this.eco.riverTiles.has(tileKey(x, y)) || lakeWaterAt(x, y) !== 0;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const crest = h(x, y) + damHeight();
        const run = (sg: 1 | -1): [number, number][] | null => {
          const out: [number, number][] = [];
          for (let i = 1; i <= DAM_RUN; i++) {
            const tx = x + dx * i * sg, ty = y + dy * i * sg;
            if (lakeWaterAt(tx, ty) === LAKE_WATER) return null;       // a lake is not dammed here
            if (h(tx, ty) >= crest && !this.water(tx, ty)) return out; // high ground: the dam ends against it
            out.push([tx, ty]);
          }
          return null;                                                  // never met high ground: the valley is too wide
        };
        const a = run(-1), b = run(1);
        if (!a || !b || a.length + b.length + 1 > DAM_MAX_LEN) continue;
        const tiles: [number, number][] = [...a.reverse(), [x, y], ...b];
        const up = h(x + dy * 6, y + dx * 6) >= h(x - dy * 6, y - dx * 6) ? 1 : -1;   // (rivers run downhill: the water gathers on the upstream side, judged over a few tiles so a bump does not fool it)
        const px = x + dy * 2 * up, py = y + dx * 2 * up;
        const est = this.makePond(tiles.map(([tx, ty]) => ({ x: tx, y: ty })), px, py).estimate();
        if (est < POND_MIN) continue;
        const score = tiles.length / est + Math.hypot(x - cx, y - cy) * 0.02 + (river ? 0 : 1);
        if (score < bestScore) { bestScore = score; best = { tiles, px, py }; }
      }
    }
    return best;
  }

  /** The burrow: land that touches water, a few steps from the dam's first bank (else the bank itself). */
  private findBurrow(x: number, y: number): [number, number] {
    for (let r = 3; r <= 8; r++) for (let d = 0; d <= r; d++) {
      const e = r - d;
      for (const [dx, dy] of [[d, e], [-d, e], [d, -e], [-d, -e]]) {
        const bx = x + dx, by = y + dy;
        if (!this.water(bx, by) && (this.water(bx + 1, by) || this.water(bx - 1, by) || this.water(bx, by + 1) || this.water(bx, by - 1))) return [bx, by];
      }
    }
    return [x, y];
  }

  /**
   * Settle a colony round (cx, cy): pick the dam site and the burrow and put a pair there. Saved dam tiles nearby are taken over
   * (the dam then stays where it was, however the water has moved since). Null if there is nothing to dam.
   */
  found(key: string, cx: number, cy: number, settle = true): Colony | null {
    if (this.colonies.has(key)) return this.colonies.get(key)!;
    const near = this.orphans.filter(d => Math.abs(d.x - cx) <= HILL_REACH + DAM_MAX_LEN && Math.abs(d.y - cy) <= DAM_REACH + DAM_MAX_LEN);
    let dam: DamTile[], px: number, py: number;
    if (near.length) {
      this.orphans = this.orphans.filter(d => !near.includes(d));
      dam = near;
      const m = dam[dam.length >> 1], across = dam.length > 1 && dam[1].x !== dam[0].x;   // the dam runs east-west: the pond lies north or south
      let side = hash01(m.x, m.y, this.world.seed & 0xffff, 404) < 0.5 ? 1 : -1;
      if (this.eco.hilly) side = this.world.metresAt(m.x + (across ? 0 : 2), m.y + (across ? 2 : 0)) >= this.world.metresAt(m.x - (across ? 0 : 2), m.y - (across ? 2 : 0)) ? 1 : -1;
      px = m.x + (across ? 0 : 2 * side); py = m.y + (across ? 2 * side : 0);
    } else {
      const site = this.findSite(cx, cy);
      if (!site) return null;
      dam = site.tiles.map(([x, y]) => ({ x, y, sticks: 0, stones: 0 })); px = site.px; py = site.py;
    }
    const first = dam[0], second = dam[1] ?? { x: first.x + 1, y: first.y };
    const sb = this.savedBurrows.get(key);                                // a burrow already begun stays where it was
    const [bx, by] = sb ? [sb[0], sb[1]] : this.findBurrow(first.x - (second.x - first.x), first.y - (second.y - first.y));
    const c: Colony = { key, bx, by, dam, px, py, done: false, pondAcc: 0, pending: !settle, abandoned: this.savedAbandoned.has(key), leakAcc: 0, burnAcc: 0, litterAcc: 0, trust: this.savedTrust.get(key) ?? 0, bsticks: sb?.[2] ?? 0 };
    this.savedTrust.delete(key); this.savedBurrows.delete(key); this.savedAbandoned.delete(key);
    this.colonies.set(key, c);
    // a saved dam holds water if it was ever finished (every tile has its stone: the stone goes on last) and has not given way since
    if (dam.every(d => d.stones >= DAM_STONES) && !damBroken(c)) { c.done = true; this.holds(c, true); if (c.pond) this.eco.adoptPond(c.pond); }
    const sp = this.savedPop.get(key);
    this.savedPop.delete(key);
    if (settle && !c.abandoned) for (const o of sp ?? [{ sex: 'm' as const, age: ADULT_AGE }, { sex: 'f' as const, age: ADULT_AGE }]) this.spawn(c, o.sex, o.age);
    return c;
  }

  private spawn(c: Colony, sex: 'm' | 'f', age: number) {
    this.beavers.push({ id: this.nextId++, colony: c.key, sex, age, x: c.bx + (sex === 'm' ? 0.3 : -0.3) + (this.rng() - 0.5) * 0.4, y: c.by + (this.rng() - 0.5) * 0.4, face: 1, state: 'idle', carry: null, timer: 0.5 + this.rng() * 2, tx: c.bx, ty: c.by, item: null, moving: false, phase: 0, hx: 1, hy: 0, food: FOOD_FULL * (0.6 + 0.4 * this.rng()), forage: null, dest: null, inside: false, full: 0, eat: 0 });
  }
  /**
   * A young beaver that has grown up leaves home unless its colony is short of an adult of its sex (then it stays to fill the
   * place). It walks to the nearest colony within reach that has an adult of the other sex and none of its own (a widow, a loner,
   * or a pair someone else is already walking to), else to the nearest cell of the seed with a place to dam and no colony yet:
   * there it settles, and the next to come pairs up with it. With nowhere to go it stays.
   */
  private maybeLeave(b: Beaver, c: Colony) {
    const adults = (k: string) => this.beavers.filter(o => o !== b && o.colony === k && stageOf(o.age) === 'adult');
    if (!adults(c.key).some(o => o.sex === b.sex)) return;
    let to: Colony | null = null, bd = LEAVE_REACH;
    for (const o of this.colonies.values()) {
      if (o === c || o.abandoned) continue;
      const mates = [...adults(o.key), ...this.beavers.filter(x => x.dest === o.key)];   // who lives there, and who is on the way
      if (!mates.some(x => x.sex !== b.sex) || mates.some(x => x.sex === b.sex) || this.beavers.filter(x => x.colony === o.key).length >= BROOD_CAP) continue;
      const d = Math.hypot(o.bx - c.bx, o.by - c.by);
      if (d < bd) { bd = d; to = o; }
    }
    if (!to) {   // a place of its own, if the seed has one near
      const cells: { key: string; x: number; y: number; d: number }[] = [];
      const ci = Math.floor(c.bx / COLONY_CELL), cj = Math.floor(c.by / COLONY_CELL), n = Math.ceil(LEAVE_REACH / COLONY_CELL);
      for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
        const w = colonyInCell(this.world.seed, i, j);
        if (!w || this.colonies.has(w.key) || this.savedAbandoned.has(w.key)) continue;
        const d = Math.hypot(w.x - c.bx, w.y - c.by);
        if (d <= LEAVE_REACH) cells.push({ ...w, d });
      }
      cells.sort((p, q) => p.d - q.d);
      for (const w of cells.slice(0, 14)) { to = this.found(w.key, w.x, w.y, false); if (to) break; }
    }
    if (!to) return;
    b.inside = false; b.carry = null; b.item = null; b.dest = to.key;
    this.goTo(b, to.bx, to.by, 'leave');
  }
  /** Arrived: it belongs to the new colony now (and the colony is no longer waiting for someone). */
  private join(b: Beaver) {
    const to = b.dest ? this.colonies.get(b.dest) : undefined;
    b.dest = null;
    if (!to) { this.rest(b, 1, 2); return; }
    b.colony = to.key; to.pending = false; to.abandoned = false;
    this.tally.left++; this.dirty = true;
    this.rest(b, 1, 3);
  }
  /** The old die; a colony left with nobody (and nobody on the way) is abandoned. */
  private reap() {
    for (let i = this.beavers.length - 1; i >= 0; i--) {
      const b = this.beavers[i];
      if (b.age < DEATH_AGE) continue;
      this.beavers.splice(i, 1); this.tally.died++; this.dirty = true;
      const c = this.colonies.get(b.colony);
      if (c && !c.pending && !this.beavers.some(o => o.colony === c.key || o.dest === c.key)) c.abandoned = true;
    }
  }
  private fireNear(x: number, y: number, r: number) { for (const f of this.eco.fires.values()) if (Math.hypot(f.x - x, f.y - y) <= r) return true; return false; }
  /** A fire close by: run for the nearest water that is clear of it, else into the burrow, else straight away from the flames. */
  private flee(b: Beaver, c: Colony) {
    b.item = null; b.carry = null; b.forage = null;
    let best: { x: number; y: number } | null = null, bd = 10;
    for (let y = Math.round(b.y) - 10; y <= Math.round(b.y) + 10; y++) for (let x = Math.round(b.x) - 10; x <= Math.round(b.x) + 10; x++) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < bd && this.water(x, y) && !this.fireNear(x, y, FIRE_FLEE)) { bd = d; best = { x, y }; }
    }
    if (best) { this.goTo(b, best.x, best.y, 'flee'); return; }
    if (isHome(c) && !this.fireNear(c.bx, c.by, FIRE_FLEE)) { this.goTo(b, c.bx, c.by, 'enter'); return; }
    let near: { x: number; y: number } | null = null, nd = Infinity;
    for (const f of this.eco.fires.values()) { const d = Math.hypot(f.x - b.x, f.y - b.y); if (d < nd) { nd = d; near = f; } }
    const dx = near ? b.x - near.x : 1, dy = near ? b.y - near.y : 0, l = Math.hypot(dx, dy) || 1;
    this.goTo(b, b.x + (dx / l) * 8, b.y + (dy / l) * 8, 'flee');
  }
  /** Heavy rain over (x, y): a cloud raining hard within a few tiles. */
  private heavyRain(x: number, y: number) { return this.eco.clouds.some(k => k.raining && k.rain >= 0.5 && Math.hypot(k.x - x, k.y - y) < 6 * k.size); }
  /**
   * A standing dam loses a stick now and then and has to be topped up (beavers mend it like a new one, the player can hand pieces
   * to it), four times as fast in heavy rain, which then picks the weakest tile. When more than half its tiles are bare it gives way:
   * the pond's extra water is taken off the region's target again, and the pond drains back as the ecosystem works it off.
   * (An abandoned dam is not mended, so it breaks in the end.)
   */
  private age(c: Colony, dt: number) {
    const rain = this.heavyRain(c.px, c.py);
    if ((c.leakAcc += dt * (rain ? 4 : 1)) < LEAK_EVERY) return;
    c.leakAcc = 0;
    const left = c.dam.filter(d => d.sticks > 0);
    if (!left.length) return;
    const d = rain ? left.reduce((a, b) => (b.sticks < a.sticks ? b : a)) : left[Math.floor(this.rng() * left.length)];
    d.sticks--; this.tally.leaked++; this.dirty = true;
    if (damBroken(c)) { c.done = false; this.holds(c, false); this.tally.damsBroken++; }
  }
  /** Daytime with the clock on: time to be in the burrow. */
  private resting() { return this.dayNight && !isNight(this.eco.hour); }
  /** The nearest bush or tree near the burrow that no other beaver is going for (bushes that bear berries are left for the player). */
  private findFood(c: Colony, b: Beaver): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    const R = FOOD_REACH;
    for (let y = c.by - R; y <= c.by + R; y++) for (let x = c.bx - R; x <= c.bx + R; x++) {
      if (Math.hypot(x - c.bx, y - c.by) > R) continue;
      const st = this.world.stateAt(x, y);
      if (st.d === DECO_NONE || (st.d === DECO_BUSH && isBerryBush(this.world.seed, x, y)) || this.beavers.some(o => o !== b && o.forage?.x === x && o.forage.y === y)) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  }
  /** At the trunk: a bush is eaten whole, a tree loses a step of its size; a tree gnawed through gives a stick to carry if the colony wants one. */
  private gnaw(b: Beaver, c: Colony) {
    const f = b.forage; b.forage = null;
    const st = f ? this.world.stateAt(f.x, f.y) : null;
    if (!f || !st || st.d === DECO_NONE) { this.rest(b, 0.5, 1); return; }
    this.tally.gnawed++;
    let felled = false, spare = 0;   // spare: sticks that go straight to the work
    if (st.d === DECO_BUSH) { this.eco.edit(f.x, f.y, { ...st, d: DECO_NONE, s: 1 }); b.food = Math.min(FOOD_FULL, b.food + BARK_BUSH); spare = 1; }
    else {
      b.food = Math.min(FOOD_FULL, b.food + BARK_TREE);
      if (st.s > 1) this.eco.edit(f.x, f.y, { ...st, s: st.s - 1 }); else { this.eco.edit(f.x, f.y, { ...st, d: DECO_NONE, s: 1 }); felled = true; spare = FELL_STICKS - 1; }
    }
    if (stageOf(b.age) !== 'old') for (let i = 0; i < spare && this.wanted(c, b).stick > 0; i++) this.lay(c, 'stick');   // (the rest of the tree is dragged to the work)
    if (felled && stageOf(b.age) !== 'old' && this.wanted(c, b).stick > 0) { b.carry = 'stick'; const d = this.dest(c, 'stick'); this.goTo(b, d.x, d.y, 'carry'); return; }
    this.rest(b, 0.5, 2);
  }
  /** A litter of 1 to 3 kits (as many as the colony has room for), born in the burrow. */
  private birth(c: Colony, have: number) {
    const n = Math.min(1 + Math.floor(this.rng() * 3), BROOD_CAP - have);
    for (let i = 0; i < n; i++) { this.spawn(c, this.rng() < 0.5 ? 'm' : 'f', 0); this.beavers[this.beavers.length - 1].y = c.by + 0.8; this.tally.born++; }
    this.dirty = true;
  }

  /** Colonies of the seed whose cell touches the watched area settle as it comes into view. */
  private scan() {
    const a = this.eco.watchedArea;
    if (a.x1 < a.x0) return;
    for (let j = Math.floor(a.y0 / COLONY_CELL); j <= Math.floor(a.y1 / COLONY_CELL); j++) for (let i = Math.floor(a.x0 / COLONY_CELL); i <= Math.floor(a.x1 / COLONY_CELL); i++) {
      const c = colonyInCell(this.world.seed, i, j);
      if (!c || this.colonies.has(c.key)) continue;
      const at = this.failed.get(c.key);
      if (at !== undefined && this.clock - at < RETRY_AFTER) continue;
      if (this.found(c.key, c.x, c.y)) this.failed.delete(c.key); else this.failed.set(c.key, this.clock);
    }
  }

  /** Is this colony near enough to what is being watched to be worth simulating? (With nothing watched, everything runs.) */
  private awake(c: Colony) {
    const a = this.eco.watchedArea, m = HAUL_REACH;
    return a.x1 < a.x0 || (c.bx >= a.x0 - m && c.bx <= a.x1 + m && c.by >= a.y0 - m && c.by <= a.y1 + m);
  }

  /** What the dam still wants, less what is already on its way in a beaver's mouth. */
  private wanted(c: Colony, but?: Beaver): Record<Haul, number> {
    const w = { stick: 0, stone: 0 };
    w.stick += Math.max(0, BURROW_STICKS - c.bsticks);
    for (const d of c.dam) { w.stick += Math.max(0, DAM_STICKS - d.sticks); w.stone += Math.max(0, DAM_STONES - d.stones); }
    for (const b of this.beavers) if (b !== but && b.colony === c.key) { const k = b.carry ?? b.item?.kind; if (k) w[k]--; }
    return w;
  }
  private claimed(kind: Haul, key: string) { return this.beavers.some(b => b.item?.kind === kind && b.item.key === key); }

  /** The nearest stick or stone of that kind lying on land within reach of the burrow that nobody has taken or is going for. */
  private nearestItem(c: Colony, b: Beaver, kind: Haul) {
    const set = kind === 'stick' ? this.picked.sticks : this.picked.stones, r = HAUL_REACH;
    const list = (kind === 'stick' ? sticksIn : stonesIn)(this.world.seed, c.bx - r, c.by - r, c.bx + r, c.by + r);
    let best: { key: string; x: number; y: number } | null = null, bd = Infinity;
    for (const it of list) {
      if (set.has(it.key) || Math.hypot(it.x - c.bx, it.y - c.by) > r || this.water(Math.round(it.x), Math.round(it.y)) || this.claimed(kind, it.key)) continue;
      const d = Math.hypot(it.x - b.x, it.y - b.y);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** The first dam tile that still takes this kind. */
  private tileFor(c: Colony, kind: Haul): DamTile | null {
    return c.dam.find(d => (kind === 'stick' ? d.sticks < DAM_STICKS : d.stones < DAM_STONES)) ?? null;
  }
  /** Where a piece goes: sticks go to the burrow until it is built, then to the dam. */
  private dest(c: Colony, kind: Haul): { x: number; y: number } { return kind === 'stick' && !isHome(c) ? { x: c.bx, y: c.by } : this.tileFor(c, kind) ?? c.dam[0]; }
  private lay(c: Colony, kind: Haul): boolean {
    if (kind === 'stick' && !isHome(c)) { c.bsticks++; this.dirty = true; return true; }
    const d = this.tileFor(c, kind);
    if (!d) return false;
    if (kind === 'stick') d.sticks++; else d.stones++;
    this.dirty = true;
    if (damTileDone(d)) this.tally.damTiles++;
    if (!c.done && c.dam.every(damTileDone)) { c.done = true; this.tally.damsDone++; this.holds(c, true); }
    return true;
  }

  /** What the dam next to (x, y) still takes from the player, if one is within reach. */
  needsAt(x: number, y: number): { stick: boolean; stone: boolean; brk: boolean } {
    const out = { stick: false, stone: false, brk: false };   // brk: there is dam here to break
    for (const c of this.colonies.values()) {
      if (c.dam.some(d => (d.sticks || d.stones) && Math.hypot(d.x - x, d.y - y) <= GIVE_RADIUS)) out.brk = true;
      if (!isHome(c) && Math.hypot(c.bx - x, c.by - y) <= GIVE_RADIUS) out.stick = true;           // the burrow takes sticks until it is built
      if (damIntact(c) || !c.dam.some(d => Math.hypot(d.x - x, d.y - y) <= GIVE_RADIUS)) continue;
      out.stick ||= !!this.tileFor(c, 'stick'); out.stone ||= !!this.tileFor(c, 'stone');
    }
    return out;
  }
  /** The player hands a stick or stone to the burrow or dam they stand by (the burrow first). False if nothing here takes it. */
  give(x: number, y: number, kind: Haul): boolean {
    for (const c of this.colonies.values()) {
      if (kind === 'stick' && !isHome(c) && Math.hypot(c.bx - x, c.by - y) <= GIVE_RADIUS) { c.bsticks++; this.dirty = true; this.tally.given++; return true; }
      if (damIntact(c) || !c.dam.some(d => Math.hypot(d.x - x, d.y - y) <= GIVE_RADIUS)) continue;
      if (this.lay(c, kind)) { this.tally.given++; return true; }
    }
    return false;
  }

  /**
   * The player pulls the dam beside them apart: half the sticks and stones come back, the pond's extra water goes off the region's
   * target (the pond drains), and the colony trusts them a step less. Null if there is no dam piece here. The beavers start again.
   */
  breakDam(x: number, y: number): { sticks: number; stones: number } | null {
    for (const c of this.colonies.values()) {
      if (!c.dam.some(d => (d.sticks || d.stones) && Math.hypot(d.x - x, d.y - y) <= GIVE_RADIUS)) continue;
      let sticks = 0, stones = 0;
      for (const d of c.dam) { sticks += d.sticks; stones += d.stones; d.sticks = 0; d.stones = 0; }
      if (c.done) { c.done = false; this.holds(c, false); this.tally.damsBroken++; }
      c.trust = Math.max(0, c.trust - BREAK_TRUST_LOSS); this.dirty = true;
      return { sticks: Math.ceil(sticks / 2), stones: Math.ceil(stones / 2) };
    }
    return null;
  }

  /** The nearest beaver the player at (x, y) can reach, or null. */
  beaverNear(x: number, y: number, reach = FEED_RADIUS): Beaver | null {
    let best: Beaver | null = null, bd = reach;
    for (const b of this.beavers) { if (b.inside) continue; const d = Math.hypot(b.x - x, b.y - y); if (d <= bd) { bd = d; best = b; } }
    return best;
  }
  /**
   * The player at (px, py) feeds a beaver a berry. It stops to eat, facing them, then is full for a while: it works faster and
   * takes no more. Each feeding raises its colony's trust a step. False if it is still full.
   */
  feed(b: Beaver, px = b.x): boolean {
    if (b.full > 0) return false;
    b.full = FULL_TIME; b.eat = EAT_TIME; b.food = FOOD_FULL;
    if (Math.abs(px - b.x) > 0.05) b.face = px > b.x ? 1 : -1;
    const c = this.colonies.get(b.colony);
    if (c) c.trust = Math.min(MAX_TRUST, c.trust + 1);
    this.tally.fed++; this.dirty = true;
    return true;
  }

  private goTo(b: Beaver, x: number, y: number, state: BeaverState) { b.tx = x; b.ty = y; b.state = state; }
  private rest(b: Beaver, lo: number, hi: number) { b.state = 'idle'; b.item = null; b.timer = lo + this.rng() * (hi - lo); }

  /** Walk (or swim) straight at the target. True on arrival. */
  private move(b: Beaver, dt: number): boolean {
    const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy), step = BEAVER_SPEED * (b.full > 0 ? FED_SPEED : 1) * PACE[stageOf(b.age)] * dt;
    if (Math.abs(dx) > 0.05) b.face = dx > 0 ? 1 : -1;
    b.moving = true; b.phase += dt;
    if (d > 1e-3) { b.hx = dx / d; b.hy = dy / d; }
    if (d <= step) { b.x = b.tx; b.y = b.ty; return true; }
    b.x += (dx / d) * step; b.y += (dy / d) * step;
    return false;
  }

  private decide(b: Beaver, c: Colony) {
    const st = stageOf(b.age);
    if (isHome(c) && this.resting()) { this.goTo(b, c.bx, c.by, 'enter'); return; }   // daytime: asleep in the burrow
    const pl = this.player;
    if (pl && pl.berries > 0 && c.trust >= TRUST_COME && st !== 'baby' && this.rng() < 0.5) {   // a trusting colony comes to a player who holds berries
      const d = Math.hypot(pl.x - b.x, pl.y - b.y);
      if (d < 8 && d > 1.3) { this.goTo(b, pl.x + ((b.x - pl.x) / d) * 1.1, pl.y + ((b.y - pl.y) / d) * 1.1, 'wander'); return; }
    }
    if (st !== 'baby' && b.food < HUNGRY_AT) { const f = this.findFood(c, b); if (f) { b.forage = f; this.goTo(b, f.x, f.y, 'forage'); return; } }
    if ((st === 'young' || st === 'adult') && (!damIntact(c) || !isHome(c))) {   // (a dam that has leaked is mended like a new one)
      const w = this.wanted(c, b);
      const next = c.dam.find(d => !damTileDone(d));                   // finish one tile before starting the next: its sticks first, then its stone
      for (const kind of ((next && next.sticks >= DAM_STICKS && w.stone > 0 ? ['stone', 'stick'] : ['stick', 'stone']) as Haul[]).filter(k => st === 'adult' || k === 'stick')) {   // the young carry sticks only
        if (w[kind] <= 0) continue;
        const it = this.nearestItem(c, b, kind);
        if (it) { b.item = { kind, key: it.key }; this.goTo(b, it.x, it.y, 'seek'); return; }
      }
    }
    if (isHome(c) && this.rng() < (st === 'old' ? 0.8 : 0.4)) { this.goTo(b, c.bx, c.by, 'enter'); return; }   // the old spend most of their time indoors   // nothing to do: go in and rest
    if (st === 'baby') {   // a kit stays by a parent
      const par = this.beavers.find(o => o.colony === c.key && stageOf(o.age) === 'adult' && !o.inside);
      const lead = c.trust >= TRUST_FOLLOW && pl && Math.hypot(pl.x - b.x, pl.y - b.y) < 12 ? pl : par;   // with trust a kit follows the player
      this.goTo(b, (lead?.x ?? c.bx) + (this.rng() - 0.5) * 3, (lead?.y ?? c.by) + (this.rng() - 0.5) * 3, 'wander'); return;
    }
    const ang = this.rng() * Math.PI * 2, r = 1 + this.rng() * 3;
    this.goTo(b, c.bx + Math.cos(ang) * r, c.by + Math.sin(ang) * r, 'wander');
  }

  private stepBeaver(b: Beaver, c: Colony, dt: number) {
    b.moving = false;
    if (b.food > 0) b.food = Math.max(0, b.food - dt);
    if (!b.inside && b.state !== 'flee' && b.state !== 'enter' && b.state !== 'leave' && this.fireNear(b.x, b.y, FIRE_FLEE)) this.flee(b, c);
    if (b.age < DEATH_AGE) {
      const was = stageOf(b.age); b.age += dt;
      if (stageOf(b.age) !== was) { this.dirty = true; if (was === 'young') this.maybeLeave(b, c); }
    }
    if (b.full > 0) b.full = Math.max(0, b.full - dt);
    if (b.eat > 0) { b.eat = Math.max(0, b.eat - dt); return; }
    switch (b.state) {
      case 'idle':
        if ((b.timer -= dt) <= 0) this.decide(b, c);
        break;
      case 'wander':
        if (this.move(b, dt)) this.rest(b, 2, 5);
        break;
      case 'leave':
        if (this.move(b, dt)) this.join(b);
        break;
      case 'enter':
        if (this.move(b, dt)) { b.state = 'inside'; b.inside = true; b.timer = 5 + this.rng() * 8; }
        break;
      case 'flee':
        if (this.move(b, dt)) { if (this.fireNear(b.x, b.y, FIRE_FLEE + 2)) this.flee(b, c); else this.rest(b, 1, 3); }
        break;
      case 'forage':
        if (this.move(b, dt)) { b.state = 'gnaw'; b.timer = GNAW_TIME; }
        break;
      case 'gnaw':
        if ((b.timer -= dt) <= 0) this.gnaw(b, c);
        break;
      case 'inside':
        if (this.resting()) { b.timer = 1 + this.rng() * 6; break; }                 // it sleeps through the day, and wakes a few seconds into the night
        if ((b.timer -= dt) <= 0) { b.inside = false; b.x = c.bx + (this.rng() - 0.5); b.y = c.by + 0.8; this.rest(b, 1, 3); }
        break;
      case 'seek': {
        if (!this.move(b, dt)) break;
        const it = b.item!, set = it.kind === 'stick' ? this.picked.sticks : this.picked.stones;
        if (set.has(it.key)) { this.rest(b, 0.5, 1.5); break; }           // the player got there first
        set.add(it.key); this.dirty = true; this.tally.hauled++;
        b.carry = it.kind; b.item = null;
        const d = this.dest(c, it.kind);
        this.goTo(b, d.x, d.y, 'carry');
        break;
      }
      case 'carry':
        if (this.move(b, dt)) { b.state = 'build'; b.timer = BUILD_TIME; }
        break;
      case 'build':
        if ((b.timer -= dt) > 0) break;
        if (b.carry) this.lay(c, b.carry);                                 // (a dam finished meanwhile: the piece is simply dropped)
        b.carry = null; this.rest(b, 0.5, 2);
        break;
    }
  }

  step(dt: number): void {
    dt = Math.min(dt, 0.5);
    this.clock += dt;
    if ((this.scanAcc += dt) >= SCAN_EVERY) { this.scanAcc = 0; this.scan(); }
    const awake = new Set<string>();
    for (const c of this.colonies.values()) {
      if (!this.awake(c)) continue;
      awake.add(c.key);
      if (c.done) this.age(c, dt);
      if (c.bsticks > 0 && this.fireNear(c.bx, c.by, 1.5)) {   // a fire at the burrow burns it down: it has to be built again, from nothing
        if ((c.burnAcc += dt) >= BURN_TIME) {
          c.burnAcc = 0; c.bsticks = 0; this.dirty = true; this.tally.burnt++;
          for (const b of this.beavers) if (b.colony === c.key && b.inside) { b.inside = false; b.state = 'idle'; b.timer = 0.5; }
        }
      } else c.burnAcc = 0;
      if (c.done && isHome(c)) {   // a pair with a home and a finished dam has a litter, one brood at a time
        const mine = this.beavers.filter(b => b.colony === c.key);
        const ready = mine.length < BROOD_CAP && mine.some(b => b.sex === 'm' && stageOf(b.age) === 'adult') && mine.some(b => b.sex === 'f' && stageOf(b.age) === 'adult') && mine.every(b => stageOf(b.age) !== 'baby' && stageOf(b.age) !== 'young');
        const fed = mine.every(b => stageOf(b.age) === 'old' || b.food >= HUNGRY_AT);   // a hungry colony does not breed: the wait stands still (it is not lost)
        if (ready) {
          if (fed && (c.litterAcc += dt) >= LITTER_WAIT) { c.litterAcc = 0; this.birth(c, mine.length); }
        } else c.litterAcc = 0;
      }
      if (this.eco.hilly) {
        if (c.pond && (c.pondAcc += dt) >= POND_TICK) { c.pondAcc = 0; if (c.done ? this.eco.growHeightPond(c.pond) : this.eco.drainHeightPond(c.pond)) this.tally.pond++; else if (c.done) this.eco.spillHeightPond(c.pond); }
      } else if (c.done && (c.pondAcc += dt) >= POND_TICK) { c.pondAcc = 0; if (this.eco.growPond(c.px, c.py)) this.tally.pond++; }
    }
    for (const b of this.beavers.slice()) if (awake.has(b.colony)) this.stepBeaver(b, this.colonies.get(b.colony)!, dt);
    this.reap();
  }
}
