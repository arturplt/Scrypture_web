/**
 * Ecosystem numbers: a census of what the map holds in an area (water, sand, grass, flowers, trees, fire...), and the soak run that
 * steps a seeded world headless for a long time and records the census once a simulated minute. The stats window in the world map
 * shows the census live; the soak run (`npm run soak`) is phase 0 of ROADMAP.md: it tells whether a world drifts (dries out, burns,
 * turns to forest) over a long session.
 */
import { Ecosystem, type EcoTally, type Wind } from './ecosystem';
import { World, GRASS, SAND, WATER, DECO_BUSH, keyX, keyY, biomeAt, type BiomeId } from './worldgen';
import { advanceHour } from './sky';
import { naturalWind } from './naturalwind';
import { mulberry32 } from './sanctuary';
import { BeaversManager, stageOf, isHome, type BeaverTally } from './beavers';
import { sticksIn, stonesIn } from './sticks';

export interface Area { x0: number; y0: number; x1: number; y1: number }

/** What an area of the map holds right now, plus the sky over it. */
export interface Census {
  tiles: number;
  water: number; sand: number;
  grass: number;      // plain grass (with or without a rock)
  flowers: number;
  bushes: number; trees: number;
  /** Average size of the bushes and trees (1 .. 4); 0 when there are none. */
  woodScale: number;
  burning: number; charred: number; wet: number;
  clouds: number; raining: number;
  /** Water held by all clouds (one evaporated tile gives 0.5-1). */
  cloudWater: number;
  rivers: number;     // river-line tiles (everywhere, not only in the area)
  channels: number;   // channels still being dug between puddles
  temperature: number;
  weather: 'heat' | 'cold' | null;
  /** The most common biome in the area. */
  biome: BiomeId;
}

/** Count the area tile by tile. About 6,000 tiles for the in-game area: fine a couple of times a second, not every frame. */
export function census(eco: Ecosystem, a: Area = eco.watchedArea): Census {
  const w = eco.world;
  const out: Census = { tiles: 0, water: 0, sand: 0, grass: 0, flowers: 0, bushes: 0, trees: 0, woodScale: 0, burning: 0, charred: 0, wet: 0, clouds: 0, raining: 0, cloudWater: 0, rivers: eco.riverTiles.size, channels: 0, temperature: eco.temperature, weather: eco.weather?.kind ?? null, biome: 'grassland' };
  const biomes = new Map<BiomeId, number>();
  let scale = 0;
  for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) {
    const st = w.stateAt(x, y);
    out.tiles++;
    if (st.t === WATER) out.water++;
    else if (st.t === SAND) out.sand++;
    else if (st.t === GRASS) {
      if (st.d === DECO_BUSH) { out.bushes++; scale += st.s; }
      else if (st.d) { out.trees++; scale += st.s; }
      else if (st.v === 1) out.flowers++;
      else out.grass++;
    }
    if (eco.isWet(x, y)) out.wet++;
    if ((x & 3) === 0 && (y & 3) === 0) { const b = w.biomeOf(x, y).id; biomes.set(b, (biomes.get(b) ?? 0) + 1); }   // (a sample is enough)
  }
  const wood = out.bushes + out.trees;
  out.woodScale = wood ? scale / wood : 0;
  const inA = (x: number, y: number) => x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1;
  for (const f of eco.fires.values()) if (inA(f.x, f.y)) out.burning++;
  for (const k of eco.scorched.keys()) if (inA(keyX(k), keyY(k))) out.charred++;
  for (const c of eco.clouds) { out.clouds++; if (c.raining) out.raining++; out.cloudWater += Math.max(0, c.water); }
  out.channels = eco.connections.filter(c => !c.done).length;
  let best = 0;
  for (const [b, n] of biomes) if (n > best) { best = n; out.biome = b; }
  return out;
}

/** What the beaver colonies near the area hold right now, plus their running totals. */
export interface BeaverCensus {
  colonies: number; homes: number; dams: number; abandoned: number;
  beavers: number; babies: number; young: number; adults: number; old: number;
  /** Sticks and stones still lying on land in the area (what the beavers and the player can still take). */
  sticks: number; stones: number;
  tally: BeaverTally;
}

export function beaverCensus(bm: BeaversManager, a: Area): BeaverCensus {
  const out: BeaverCensus = { colonies: 0, homes: 0, dams: 0, abandoned: 0, beavers: 0, babies: 0, young: 0, adults: 0, old: 0, sticks: 0, stones: 0, tally: { ...bm.tally } };
  for (const c of bm.colonies.values()) { out.colonies++; if (isHome(c)) out.homes++; if (c.done) out.dams++; if (c.abandoned) out.abandoned++; }
  for (const b of bm.beavers) {
    out.beavers++;
    const st = stageOf(b.age);
    if (st === 'baby') out.babies++; else if (st === 'young') out.young++; else if (st === 'adult') out.adults++; else out.old++;
  }
  const land = (x: number, y: number) => bm.world.terrainAt(Math.round(x), Math.round(y)) !== WATER && x >= a.x0 && x <= a.x1 + 1 && y >= a.y0 && y <= a.y1 + 1;
  for (const st of sticksIn(bm.world.seed, a.x0, a.y0, a.x1, a.y1)) if (!bm.picked.sticks.has(st.key) && land(st.x, st.y)) out.sticks++;
  for (const st of stonesIn(bm.world.seed, a.x0, a.y0, a.x1, a.y1)) if (!bm.picked.stones.has(st.key) && land(st.x, st.y)) out.stones++;
  return out;
}

/** One soak sample: the census plus the running totals at that moment (`beavers` is null when the run had none). */
export interface SoakRow extends Census { minute: number; hour: number; tally: EcoTally; beavers: BeaverCensus | null }

export interface SoakOptions {
  seed: number;
  /** Simulated minutes to run. */
  minutes: number;
  /** Side of the square watched area, in tiles (the game watches about 60-80 round the plane). */
  size?: number;
  /** Centre of the area. */
  cx?: number; cy?: number;
  /** Step length in seconds (the game steps once a frame; 0.1 is close enough and 6x faster to run). */
  dt?: number;
  /** A fixed wind; without it the wind drifts like the game's natural wind. */
  wind?: Wind;
  /** Seed for the simulation's own randomness (rain, growth, fire). */
  rngSeed?: number;
  /** Start hour (the day is 60 s long, like the game). */
  hour?: number;
  /** Run the beaver colonies too (default: yes, as in the game; they settle as the area comes into view, keep to the day and night, and change the map). */
  beavers?: boolean;
}

/** Run a world headless and sample it at minute 0 and after every simulated minute. */
export function soak(o: SoakOptions): SoakRow[] {
  const size = o.size ?? 64, cx = o.cx ?? 0, cy = o.cy ?? 0, dt = o.dt ?? 0.1;
  const x0 = Math.round(cx - size / 2), y0 = Math.round(cy - size / 2), area: Area = { x0, y0, x1: x0 + size - 1, y1: y0 + size - 1 };
  const world = new World(o.seed);
  const eco = new Ecosystem(world, mulberry32(o.rngSeed ?? o.seed ^ 0x9e3779b9), o.wind ? { ...o.wind } : { enabled: true, ...naturalWind(o.seed, 0) });
  eco.setWatchedArea(area.x0, area.y0, area.x1, area.y1);
  const bm = o.beavers === false ? null : new BeaversManager(world, eco, mulberry32((o.rngSeed ?? o.seed) ^ 0x5bd1e995));
  if (bm) bm.dayNight = true;
  let hour = o.hour ?? 12, t = 0, windAcc = 0;
  eco.hour = hour;
  const rows: SoakRow[] = [];
  const sample = (minute: number) => rows.push({ minute, hour, ...census(eco, area), tally: { ...eco.tally }, beavers: bm ? beaverCensus(bm, area) : null });
  sample(0);
  const perMinute = Math.round(60 / dt);
  for (let m = 1; m <= o.minutes; m++) {
    for (let i = 0; i < perMinute; i++) {
      t += dt; hour = advanceHour(hour, dt); eco.hour = hour;
      if (!o.wind && (windAcc += dt) >= 0.25) { windAcc = 0; const nw = naturalWind(o.seed, t); eco.wind = { ...eco.wind, strength: nw.strength, dir: nw.dir }; }
      eco.step(dt);
      bm?.step(dt);
    }
    sample(m);
  }
  return rows;
}

/** The nearest point to the origin (searching outwards in steps of 32 tiles) whose 64x64 surroundings are mostly `biome`; null if none within ~4000 tiles. */
export function findBiome(seed: number, biome: BiomeId): [number, number] | null {
  for (let r = 0; r <= 128; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;          // the ring at distance r only
    const x = i * 32, y = j * 32;
    if (biomeAt(x, y, seed).id !== biome) continue;
    let n = 0;
    for (let dy = -24; dy <= 24; dy += 12) for (let dx = -24; dx <= 24; dx += 12) if (biomeAt(x + dx, y + dy, seed).id === biome) n++;
    if (n >= 20) return [x, y];                                       // 20 of the 25 samples
  }
  return null;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '-');

/** A plain-text table of soak rows (every `every` minutes, and the last one), for the console and ROADMAP.md. */
export function soakTable(rows: SoakRow[], every = 5): string {
  const head = ['min', 'water', 'sand', 'grass', 'flower', 'bush', 'tree', 'size', 'fire', 'char', 'cloud', 'rain', 'river', 'evap', 'wet+', 'grow', 'bolt', 'burnt', 'doused', 'damped', 'fclouds', 'frain', 'irrig', 'beck', 'rocks'];
  const lines = [head.map(h => h.padStart(6)).join('')];
  const pick = rows.filter((r, i) => r.minute % every === 0 || i === rows.length - 1);
  for (const r of pick) {
    const cells = [r.minute, pct(r.water, r.tiles), pct(r.sand, r.tiles), pct(r.grass, r.tiles), pct(r.flowers, r.tiles), pct(r.bushes, r.tiles), pct(r.trees, r.tiles), r.woodScale.toFixed(2), r.burning, r.charred, r.clouds, r.raining, r.rivers, r.tally.evaporated, r.tally.toWater, r.tally.grown, r.tally.strikes, r.tally.burnt, r.tally.doused, r.tally.damped, r.tally.fireClouds, r.tally.fireRain, r.tally.irrigated, r.tally.becks, r.tally.bankRocks];
    lines.push(cells.map(c => String(c).padStart(6)).join(''));
  }
  return lines.join('\n');
}

/** A plain-text table of the beaver side of soak rows: colonies, who lives there by stage, dams and ponds, what was hauled, eaten, born. */
export function beaverTable(rows: SoakRow[], every = 5): string {
  const head = ['min', 'col', 'home', 'dam', 'abnd', 'bvr', 'kit', 'yng', 'adl', 'old', 'leak', 'brk', 'pond', 'haul', 'gnaw', 'born', 'died', 'left', 'stick', 'stone'];
  const lines = [head.map(h => h.padStart(6)).join('')];
  for (const r of rows.filter((r, i) => r.minute % every === 0 || i === rows.length - 1)) {
    const b = r.beavers; if (!b) continue;
    const cells = [r.minute, b.colonies, b.homes, b.dams, b.abandoned, b.beavers, b.babies, b.young, b.adults, b.old, b.tally.leaked, b.tally.damsBroken, b.tally.pond, b.tally.hauled, b.tally.gnawed, b.tally.born, b.tally.died, b.tally.left, b.sticks, b.stones];
    lines.push(cells.map(c => String(c).padStart(6)).join(''));
  }
  return lines.join('\n');
}

/** How much a quantity moved from the first row to the last, as a fraction of where it started (0.2 = up 20%). */
export function drift(rows: SoakRow[], pick: (r: SoakRow) => number): number {
  const a = pick(rows[0]), b = pick(rows[rows.length - 1]);
  return a ? (b - a) / a : b ? Infinity : 0;
}

