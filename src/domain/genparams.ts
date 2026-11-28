/**
 * A seeded planet's generation settings: the knobs of the world generator (see SCRYPTURE_WORLD_GENERATOR_ROADMAP.md). They are saved with the world and change the game's own terrain formula
 * (terrace.ts reads the active set, see `setGenParams`), so the chunks, the far meshes, the maps and the workers all agree. Every field's default is the identity: a world made without
 * settings (every world made before the generator) is exactly as it always was.
 *
 * Pure: it imports nothing from the terrain, so the terrain can import it.
 */

export const GEN_VERSION = 1;

/** The sculpt: a grid of 64 x 64 cells a face (65 x 65 points, the points on edges and corners shared: 6 * 64^2 + 2 in all, see planetgrid.ts), each point raised or lowered by whole quarter layers, at most SCULPT_MAX (+-120 layers). */
export const SCULPT_CELLS = 64;
export const SCULPT_POINTS = 6 * SCULPT_CELLS * SCULPT_CELLS + 2;
export const SCULPT_MAX = 480;

export interface GenParams {
  v: typeof GEN_VERSION;
  /** Sea level: positive raises the sea (less land), negative lowers it. In the continent field's own units (about 0.1 of them is the width of a coast). */
  sea: number;
  /** Multiplier on the continents' frequencies: higher is smaller, more numerous land masses. */
  continents: number;
  /** How much mountain country there is: the belts' width and how far along a belt a range stands. 0 is none. */
  mountains: number;
  /** Multiplier on the ranges' heights and on the giant mountain's. */
  peaks: number;
  /** Multiplier on the hills' height and on the rolling ground. */
  hills: number;
  /** Added to a region's moisture when the biome is chosen (positive: wetter, more woods and wet ground; negative: dryer, more sand). */
  moisture: number;
  /** How many layers sooner the bare tops begin. */
  cold: number;
  /** The macro sculpt: pairs [point, quarter layers] of a sparse grid (see SCULPT_*). Absent: none. Read by the terrain (sculpt.ts). */
  sculpt?: number[];
}

/** The identity: the terrain as it was before there were settings. */
export const DEFAULT_GEN: Readonly<GenParams> = Object.freeze({ v: GEN_VERSION, sea: 0, continents: 1, mountains: 1, peaks: 1, hills: 1, moisture: 0, cold: 0 });

/** The allowed range of each number setting. */
export const GEN_RANGE = {
  sea: [-0.4, 0.4], continents: [0.5, 2.5], mountains: [0, 2], peaks: [0, 2], hills: [0, 2], moisture: [-0.3, 0.3], cold: [0, 25],
} as const satisfies Record<string, readonly [number, number]>;
export type GenNumberKey = keyof typeof GEN_RANGE;
export const GEN_KEYS = Object.keys(GEN_RANGE) as GenNumberKey[];

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function sanitizeSculpt(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const m = new Map<number, number>();
  for (let i = 0; i + 1 < raw.length && m.size < SCULPT_POINTS; i += 2) {
    const p = raw[i], q = raw[i + 1];
    if (typeof p !== 'number' || typeof q !== 'number' || !Number.isInteger(p) || !Number.isFinite(q) || p < 0 || p >= SCULPT_POINTS) continue;
    const v = Math.max(-SCULPT_MAX, Math.min(SCULPT_MAX, Math.round(q)));
    if (v !== 0) m.set(p, v); else m.delete(p);
  }
  if (!m.size) return undefined;
  const out: number[] = [];
  for (const p of [...m.keys()].sort((a, b) => a - b)) out.push(p, m.get(p)!);
  return out;
}

/** Any input to a valid set: finite numbers clamped to their ranges (a missing or bad one takes its default), unknown fields dropped, the sculpt bounded. Never throws. */
export function sanitizeGen(raw: unknown): GenParams {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: GenParams = { ...DEFAULT_GEN };
  for (const k of GEN_KEYS) {
    const v = r[k], [lo, hi] = GEN_RANGE[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = round3(Math.max(lo, Math.min(hi, v)));
  }
  const sc = sanitizeSculpt(r.sculpt);
  if (sc) out.sculpt = sc;
  return out;
}

/** Is it the identity (no setting changed, nothing sculpted)? */
export const isDefaultGen = (p: GenParams | null | undefined): boolean => !p || (GEN_KEYS.every(k => p[k] === DEFAULT_GEN[k]) && !(p.sculpt && p.sculpt.length));

const fnv = (n: number, h = 0x811c9dc5): number => { for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((n >>> (k * 8)) & 255), 0x01000193) >>> 0; return h; };

/** A short stable string for cache keys: '' for the identity, so keys of worlds without settings are what they always were. */
export function paramsKey(p: GenParams | null | undefined): string {
  if (isDefaultGen(p)) return '';
  const q = p!;
  let s = 'g' + q.v + ':' + GEN_KEYS.map(k => q[k]).join(',');
  if (q.sculpt && q.sculpt.length) { let h = 0x811c9dc5; for (const n of q.sculpt) h = fnv(n | 0, h); s += ':' + h.toString(36); }
  return s;
}

/** `paramsKey` as an integer (0 for the identity), for keys that are numbers. */
export function paramsHash(p: GenParams | null | undefined): number {
  const k = paramsKey(p); if (!k) return 0;
  let h = 0x811c9dc5; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0 || 1;
}
