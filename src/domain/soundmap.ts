/**
 * What the glider sounds like, as plain numbers (the Web Audio part lives in src/audio/engine.ts and only follows these).
 * Wind is two channels: the ear the air comes in from is the louder one (sideslip, bank, yaw), and rough air adds gusts.
 * The stall whistle climbs as the wing nears its stall angle, and warbles once it has stalled.
 */
import { ALPHA_STALL, STALL_SPEED, TRIM_SPEED, type Glider, type GlideEnv } from './glider';
import { sunElevation } from './sky';

export interface SoundParams {
  /** false = silent (landed, or nothing flying) */
  on: boolean;
  /** wind loudness per ear, 0..1 */
  windL: number; windR: number;
  /** wind brightness: low-pass cutoff in Hz */
  windHz: number;
  /** extra roughness 0..1 (rain, gusts): modulates the wind */
  gust: number;
  /** stall whistle loudness 0..1, pitch in Hz, and warble depth 0..1 */
  whistle: number; whistleHz: number; warble: number;
  /** rain bed loudness 0..1 */
  rain: number;
  /** soft shimmer inside rising air, 0..1 */
  lift: number;
  /** paper flutter (crackle) from g-load and rough air, 0..1 */
  flutter: number;
  /** high up: how much the whole mix is muffled, 0..1 */
  muffle: number;
  /** near the ground: loudness of birds (by day) / crickets (by night), 0..1 each */
  birds: number; crickets: number;
  /** the throw is being charged on the ground: 0..1 power (0 = not aiming) */
  charge: number;
}

/** What the world adds beyond the plane itself. */
export interface SoundExtras { hour?: number; charge?: number }

export const SILENT: SoundParams = { on: false, windL: 0, windR: 0, windHz: 400, gust: 0, whistle: 0, whistleHz: 1200, warble: 0, rain: 0, lift: 0, flutter: 0, muffle: 0, birds: 0, crickets: 0, charge: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Which way the air hits the plane: -1 = from the left, +1 = from the right (the sideslip, 0 when the nose points into the air). */
export function airSide(g: Glider, env: GlideEnv): number {
  const rx = g.vx - env.windX, ry = g.vy - env.windY, h = Math.hypot(rx, ry);
  return h > 0.3 ? clamp((Math.cos(g.psi) * ry - Math.sin(g.psi) * rx) / h, -1, 1) : 0;
}

/** Birds / crickets heard close to the ground, from the hour (0..24) and the height above the ground. */
export function ambience(z: number, hour = 12): { birds: number; crickets: number } {
  const near = 1 - smooth(4, 35, z), day = smooth(-0.05, 0.25, sunElevation(hour));
  return { birds: near * day, crickets: near * (1 - day) };
}

/** rain 0..1 (how hard it rains at the plane), turb 0..1 (how rough the air is). */
export function soundParams(g: Glider, env: GlideEnv, rain = 0, turb = rain, extra: SoundExtras = {}): SoundParams {
  const amb = ambience(g.z, extra.hour), charge = clamp(extra.charge ?? 0, 0, 1);
  if (g.landed) return { ...SILENT, on: true, rain: clamp(rain, 0, 1) * 0.6, charge };
  const v = g.airspeed, h = smooth(40, 200, g.z);
  const speed = smooth(STALL_SPEED * 0.5, TRIM_SPEED * 3, v);                 // 0 slow .. 1 in a hard dive
  const level = (0.08 + 0.92 * speed * speed) * (1 - 0.25 * h);               // the air is thinner up there
  // stereo: sideslip (air from the side), the lowered wing, and a turn leaning into the air all push the wind to one ear
  const pan = clamp(airSide(g, env) * 3 + Math.sin(g.phi) * 0.5 + g.rud * 0.25, -1, 1);
  const wide = 0.55 + 0.45 * Math.abs(pan);                                   // a hard side wind is a bit louder than a head wind
  const windL = clamp(level * wide * (1 - Math.max(0, pan) * 0.85), 0, 1), windR = clamp(level * wide * (1 + Math.min(0, pan) * 0.85), 0, 1);
  const windHz = 250 + 2600 * speed * speed + 400 * clamp(Math.abs(g.load - 1), 0, 2);
  const gust = clamp(turb * 0.9 + Math.hypot(env.windX, env.windY) / 20 + Math.max(0, g.load - 1.5) * 0.3, 0, 1);
  // stall whistle: rises over the last quarter of the way to the stall angle, full once stalled
  const near = smooth(0.7, 1.0, g.alpha / ALPHA_STALL);
  const whistle = g.stalled ? 1 : near * 0.8;
  const whistleHz = 1100 + 900 * near + (g.stalled ? 250 : 0);
  const lift = smooth(0.3, 4, g.airLift);
  const flutter = clamp(smooth(1.3, 3, g.load) * 0.8 + turb * 0.6, 0, 1) * smooth(STALL_SPEED * 0.5, TRIM_SPEED, v);
  return { on: true, windL, windR, windHz, gust, whistle, whistleHz, warble: g.stalled ? 1 : 0, rain: clamp(rain, 0, 1), lift, flutter, muffle: h, charge, ...amb };
}
