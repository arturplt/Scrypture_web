/**
 * Vibration, where the device has it (Android phones; iPhone Safari has no Vibration API, so it is simply quiet there).
 * Follows the Vibration setting (on unless switched off) and stays still in the world map, which shakes nothing yet.
 */
import { store } from '../data/hooks';

/** The few patterns the app uses, in ms (on, off, on...): short enough to feel like a tick, not a phone call. */
export const BUZZ = { tap: 12, hit: 25, bullseye: [30, 40, 30], level: [40, 60, 80], fail: [60, 40, 60] } as const;
export type Buzz = keyof typeof BUZZ;

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const inWorld = () => location.hash.startsWith('#/games/paperplane/play/');

export function buzz(kind: Buzz) {
  if (!canVibrate() || store.getState().settings.haptics === false || inWorld()) return;
  // a browser refuses before the first tap, and some throw instead of returning false
  try { navigator.vibrate(BUZZ[kind] as number | number[]); } catch { /* no vibration, nothing lost */ }
}
