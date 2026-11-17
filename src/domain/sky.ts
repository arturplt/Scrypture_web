/**
 * Bóbr world map, part 3: the sky. Ported from Android's day/night cycle (DAY_NIGHT_CYCLE_DOCUMENTATION.md): a 24 hour day that
 * lasts 60 real seconds, a sun that crosses from east to west, and a dark overlay when it is below the horizon.
 * Android's `darkness()` had an `else 0` branch after the smoothstep that made the "just above horizon" fade dead code; the
 * curve here is the one the docs describe (dark -> bright across the horizon).
 */
export const DAY_SECONDS = 60;
export const HOURS_PER_SECOND = 24 / DAY_SECONDS;      // 0.4
export const MAX_DARKNESS = 0.7;

export const advanceHour = (hour: number, dt: number) => (hour + HOURS_PER_SECOND * dt) % 24;
export function clockText(hour: number): string {
  const h = Math.floor(hour) % 24, m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** -1 (straight below) .. 0 (horizon at 6h and 18h) .. 1 (zenith at noon). */
export function sunElevation(hour: number): number {
  const t = (((hour % 24) + 24) % 24) / 24;
  if (t < 0.25) return -1 + t / 0.25;
  if (t < 0.75) return Math.sin(((t - 0.25) / 0.5) * Math.PI);
  return -(t - 0.75) / 0.25;
}
/** 0 = east .. pi = west; it keeps to the west from 21h until midnight (Android). */
export function sunAzimuth(hour: number): number {
  const t = (((hour % 24) + 24) % 24) / 24;
  return t < 21 / 24 ? (t / (21 / 24)) * Math.PI : Math.PI;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Black overlay alpha: 0.7 once the sun is 0.1 below the horizon, fading to 0 as it rises through the horizon. */
export function darkness(elevation: number): number {
  if (elevation <= -0.1) return MAX_DARKNESS;
  if (elevation < 0.1) return MAX_DARKNESS * (1 - smooth((elevation + 0.1) / 0.2));
  return 0;
}
export const isNight = (hour: number) => sunElevation(hour) < 0;
