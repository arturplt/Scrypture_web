/** Saved Bóbr worlds: a seed plus only what changed (the generator rebuilds everything else), the plane, the sky and the wind. */
import { tileKey, keyX, keyY, type TileState, type Terrain, type DecoKind, type Variant } from './worldgen';
import { lakeSpawnFor, type LakeMapId } from './lakedistrict';
import { defaultWind, type Wind } from './ecosystem';
import { sanitizeBerries, type SavedBerry } from './berries';

export const MAX_WORLDS = 12;
export const MAX_CHANGES = 60000;
/** One changed tile: [x, y, terrain, variant, decoration, scale x 100]. */
export type SavedTile = [number, number, number, number, number, number];
/** One finished run (it ends with a crash): hoops flown through and metres flown, scored together. */
export interface RunScore { points: number; hoops: number; metres: number; height: number; bonus: number; at: number }
export const MAX_SCORES = 10;
/** Every 100 points of a run is a coin; a coin buys one boost in the pre-flight shop (up to MAX_BOOSTS in hand). */
export const POINTS_PER_COIN = 100, BOOST_PRICE = 1, MAX_BOOSTS = 9;
export const coinsFor = (points: number) => Math.max(0, Math.floor(points / POINTS_PER_COIN));
/** Points: 100 per hoop, 1 per metre flown, 2 per metre of height climbed above the launch point, plus the landing bonus or penalty. */
export const HEIGHT_POINTS = 2;
export const runPoints = (hoops: number, metres: number, bonus = 0, height = 0) => Math.max(0, Math.round(hoops) * 100 + Math.round(metres) + Math.round(height) * HEIGHT_POINTS + Math.round(bonus));
/** How the plane touched down: a soft landing (sinking under 3 m/s, wings nearly level) earns 50..150, anything harder costs 50..200. */
export const SOFT_SINK = 3, SOFT_BANK = 0.6;
export function landingScore(impact: { sink: number; bank: number } | null, onWater = false): { soft: boolean; water: boolean; bonus: number } {
  if (!impact) return { soft: true, water: false, bonus: 0 };
  if (onWater) return { soft: false, water: true, bonus: -(150 + Math.min(150, Math.round(impact.sink * 20))) };   // water: never a good landing, and a bigger penalty than any crash on land (150..300)
  if (impact.sink <= SOFT_SINK && impact.bank <= SOFT_BANK) return { soft: true, water: false, bonus: 50 + Math.round(50 * (1 - impact.sink / SOFT_SINK)) + Math.round(50 * (1 - impact.bank / SOFT_BANK)) };
  return { soft: false, water: false, bonus: -(50 + Math.min(150, Math.round(impact.sink * 20))) };
}
/** The leaderboard with a run added: best first, at most MAX_SCORES, nothing for a run that went nowhere. */
export function addRunScore(list: RunScore[], hoops: number, metres: number, at: number, bonus = 0, height = 0): RunScore[] {
  const points = runPoints(hoops, metres, bonus, height);
  if (points < 10) return list;
  return [...list, { points, hoops: Math.round(hoops), metres: Math.round(metres), height: Math.round(height), bonus: Math.round(bonus), at }].sort((a, b) => b.points - a.points || a.at - b.at).slice(0, MAX_SCORES);
}
export interface SavedWorld {
  id: string; name: string; seed: number; createdAt: number; playedAt: number;
  map?: LakeMapId;                // which Lake District map the world is on (none = the whole region at 50 m)
  kind?: 'procedural' | 'lakedistrict';   // the Lake District is a real map (see lakedistrict.ts); a world without this is procedural
  changes: SavedTile[];
  hour: number; wind: Wind; plane: { x: number; y: number; heading: number; pitch: number; landed?: boolean };   // landed: it was on the ground when saved (the Lake District then opens on foot there, not in the air)
  explored: number[];             // chunk keys the plane has seen (the minimap is redrawn from the seed, not stored)
  scores?: RunScore[];            // this world's leaderboard (best runs first)
  burned?: number;                // how many times fire or lightning has burned the plane (and sent it back to the start)
  boosts?: number;                // boosts in hand, carried over from run to run (and between visits)
  shop?: { launch: number; paper: number; insurance: number; float: number; double: number };   // what was bought in the shop (see shop.ts)
  sticks?: string[];              // keys of the sticks already picked up (see sticks.ts)
  stones?: string[];              // and of the stones
  berries?: SavedBerry[];         // berry bushes picked and not yet ripe again (see berries.ts)
  beavers?: SavedBeavers;         // the beavers' dams (see beavers.ts); the beavers and burrows themselves come back from the seed
  coins?: number;                 // legacy: coins used to be kept here; they now live in the inventory (BCOIN) and any left here are moved there when the world opens
}
/** One dam tile: [x, y, sticks laid, stones laid]. */
export type SavedDam = [number, number, number, number];
export const ADULT_AGE = 360, OLD_AGE = 2160, DEATH_AGE = 2760;   // seconds of age (60 s is a world day): grown at 6 days, old at 36, dead at 46; the stages are in beavers.ts
export const BURROW_STICKS = 6;   // sticks a burrow takes before it counts as a home
export interface SavedBeavers { dams: SavedDam[]; trust?: [string, number][]; burrows?: [string, number, number, number][]; pop?: [string, number, number][]; abandoned?: string[] }   // pop: a colony's beavers as colony key, sex (0 male, 1 female), age; only for colonies that are not the plain seed pair   // burrows: colony key, place, sticks laid   // trust: per colony key, how often the player has fed it (0..5)
export const MAX_DAM_TILES = 600, MAX_TRUSTED = 400;
export function sanitizeBeavers(raw: unknown): SavedBeavers {
  const dams: SavedDam[] = [], seen = new Set<number>();
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as any).dams) ? (raw as any).dams : [];
  for (const d of list) {
    if (!Array.isArray(d) || d.length < 4 || !d.every(n => typeof n === 'number' && Number.isFinite(n))) continue;
    const [x, y, sticks, stones] = d as number[];
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || seen.has(tileKey(x, y))) continue;
    seen.add(tileKey(x, y));
    dams.push([x, y, clamp(Math.round(sticks), 0, 9), clamp(Math.round(stones), 0, 9)]);
    if (dams.length >= MAX_DAM_TILES) break;
  }
  const trust: [string, number][] = [], keys = new Set<string>();
  for (const t of typeof raw === 'object' && raw !== null && Array.isArray((raw as any).trust) ? (raw as any).trust : []) {
    if (!Array.isArray(t) || typeof t[0] !== 'string' || t[0].length > 24 || typeof t[1] !== 'number' || !Number.isFinite(t[1]) || keys.has(t[0])) continue;
    keys.add(t[0]);
    trust.push([t[0], clamp(Math.round(t[1]), 0, 5)]);
    if (trust.length >= MAX_TRUSTED) break;
  }
  const burrows: [string, number, number, number][] = [], bk = new Set<string>();
  for (const b of typeof raw === 'object' && raw !== null && Array.isArray((raw as any).burrows) ? (raw as any).burrows : []) {
    if (!Array.isArray(b) || b.length < 4 || typeof b[0] !== 'string' || b[0].length > 24 || bk.has(b[0]) || !b.slice(1, 4).every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) continue;
    const [, x, y, n] = b as [string, number, number, number];
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) continue;
    bk.add(b[0]);
    burrows.push([b[0], x, y, clamp(Math.round(n), 0, BURROW_STICKS)]);
    if (burrows.length >= MAX_TRUSTED) break;
  }
  const pop: [string, number, number][] = [], per = new Map<string, number>();
  for (const p of typeof raw === 'object' && raw !== null && Array.isArray((raw as any).pop) ? (raw as any).pop : []) {
    if (!Array.isArray(p) || p.length < 3 || typeof p[0] !== 'string' || p[0].length > 24 || !(p[1] === 0 || p[1] === 1) || typeof p[2] !== 'number' || !Number.isFinite(p[2])) continue;
    const n = per.get(p[0]) ?? 0;
    if (n >= 8) continue;
    per.set(p[0], n + 1);
    pop.push([p[0], p[1], clamp(Math.round(p[2]), 0, DEATH_AGE)]);
    if (pop.length >= 4 * MAX_TRUSTED) break;
  }
  const abandoned: string[] = [];
  for (const k of typeof raw === 'object' && raw !== null && Array.isArray((raw as any).abandoned) ? (raw as any).abandoned : []) {
    if (typeof k === 'string' && k.length <= 24 && !abandoned.includes(k)) abandoned.push(k);
    if (abandoned.length >= MAX_TRUSTED) break;
  }
  return { dams, trust, burrows, pop, abandoned };
}
export interface WorldsSave { list: SavedWorld[] }
export const emptyWorlds = (): WorldsSave => ({ list: [] });

export const newSavedWorld = (id: string, name: string, seed: number, now: number, kind: 'procedural' | 'lakedistrict' = 'procedural', map: LakeMapId = 'lakes'): SavedWorld => ({
  ...(kind === 'lakedistrict' ? { kind, ...(map !== 'lakes' ? { map } : {}) } : {}), id, name: name.trim().slice(0, 40) || 'World', seed: seed >>> 0, createdAt: now, playedAt: now, changes: [],
  hour: 12, wind: defaultWind(), plane: kind === 'lakedistrict' ? lakeSpawnFor(map) : { x: 0, y: 0, heading: Math.PI / 2, pitch: 0 }, explored: [],   // (the Lake District starts over the Old Man of Coniston, heading east down to Coniston Water)
});

export const encodeChanges = (m: Map<number, TileState>): SavedTile[] =>
  [...m].slice(0, MAX_CHANGES).map(([k, s]) => [keyX(k), keyY(k), s.t, s.v, s.d, Math.round(s.s * 100)]);
export const decodeChanges = (a: SavedTile[]): [number, TileState][] =>
  a.map(([x, y, t, v, d, s]) => [tileKey(x, y), { t: t as Terrain, v: v as Variant, d: d as DecoKind, s: s / 100 }]);

const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function sanitizeShop(raw: unknown): { launch: number; paper: number; insurance: number; float: number; double: number } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), 0, hi) : 0);
  return { launch: n(r.launch, 3), paper: n(r.paper, 3), insurance: n(r.insurance, 5), float: n(r.float, 5), double: n(r.double, 5) };
}

function sanitizeScores(raw: unknown): RunScore[] {
  const out: RunScore[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (typeof r !== 'object' || r === null) continue;
    const hoops = clamp(Math.round(fin((r as any).hoops, 0)), 0, 1e6), metres = clamp(Math.round(fin((r as any).metres, 0)), 0, 1e9);
    const bonus = clamp(Math.round(fin((r as any).bonus, 0)), -1000, 1000);
    const height = clamp(Math.round(fin((r as any).height, 0)), 0, 1e5);
    out.push({ points: runPoints(hoops, metres, bonus, height), hoops, metres, height, bonus, at: fin((r as any).at, 0) });
  }
  return out.sort((a, b) => b.points - a.points || a.at - b.at).slice(0, MAX_SCORES);
}

export function sanitizeWorlds(raw: unknown): WorldsSave {
  const out = emptyWorlds();
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as any).list) ? (raw as any).list : [];
  for (const w of list) {
    if (typeof w !== 'object' || w === null || typeof w.id !== 'string' || out.list.some(x => x.id === w.id)) continue;
    const changes: SavedTile[] = [];
    for (const c of Array.isArray(w.changes) ? w.changes : []) {
      if (!Array.isArray(c) || c.length < 6 || !c.every(n => typeof n === 'number' && Number.isFinite(n))) continue;
      const [x, y, t, v, d, s] = c as number[];
      if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || ![0, 1, 2].includes(t) || ![0, 1, 2].includes(v) || ![0, 1, 2, 3].includes(d)) continue;
      changes.push([x, y, t, v, d, clamp(Math.round(s), 100, 400)]);
      if (changes.length >= MAX_CHANGES) break;
    }
    const wind = typeof w.wind === 'object' && w.wind !== null ? w.wind : {}, plane = typeof w.plane === 'object' && w.plane !== null ? w.plane : {};
    const dw = defaultWind();
    out.list.push({
      ...(w.kind === 'lakedistrict' ? { kind: 'lakedistrict' as const, ...(w.map === 'coniston' ? { map: 'coniston' as const } : {}) } : {}),
      id: w.id, name: (typeof w.name === 'string' ? w.name.trim().slice(0, 40) : '') || 'World', seed: fin(w.seed, 0) >>> 0,
      createdAt: fin(w.createdAt, 0), playedAt: fin(w.playedAt, 0), changes,
      hour: clamp(fin(w.hour, 12), 0, 23.999),
      wind: { enabled: wind.enabled !== false, strength: clamp(fin(wind.strength, dw.strength), 0, 10), dir: fin(wind.dir, dw.dir) },
      plane: { x: clamp(fin(plane.x, 0), -1e6, 1e6), y: clamp(fin(plane.y, 0), -1e6, 1e6), heading: fin(plane.heading, Math.PI / 2), pitch: clamp(fin(plane.pitch, 0), -45, 45), ...(plane.landed === true ? { landed: true } : {}) },
      scores: sanitizeScores(w.scores), coins: clamp(Math.round(fin(w.coins, 0)), 0, 1e6), boosts: clamp(Math.round(fin(w.boosts, 1)), 0, MAX_BOOSTS), burned: clamp(Math.round(fin(w.burned, 0)), 0, 1e6), shop: sanitizeShop(w.shop),
      sticks: (Array.isArray(w.sticks) ? w.sticks : []).filter((k: unknown): k is string => typeof k === 'string' && k.length < 24).slice(0, 5000),
      stones: (Array.isArray(w.stones) ? w.stones : []).filter((k: unknown): k is string => typeof k === 'string' && k.length < 24).slice(0, 5000),
      beavers: sanitizeBeavers(w.beavers), berries: sanitizeBerries(w.berries),
      explored: (Array.isArray(w.explored) ? w.explored : []).filter((k: unknown) => typeof k === 'number' && Number.isFinite(k)).slice(0, 20000),
    });
    if (out.list.length >= MAX_WORLDS) break;
  }
  return out;
}
