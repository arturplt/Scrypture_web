/**
 * A brake for sync ping-pong: two copies of the app that disagree about a value (say, an older copy still cached on a phone and a newer one) can keep overwriting each
 * other, each save waking the other through the realtime channel. When this device has uploaded this often within the last minute, the next sync waits much longer.
 */
export const PACE_WINDOW_MS = 60_000;
export const PACE_MAX_UPLOADS = 5;
export const PACE_COOL_MS = 30_000;

export function paceMs(uploads: readonly number[], now: number, wanted: number): number {
  const recent = uploads.filter(t => now - t < PACE_WINDOW_MS).length;
  return recent >= PACE_MAX_UPLOADS ? Math.max(wanted, PACE_COOL_MS) : wanted;
}
