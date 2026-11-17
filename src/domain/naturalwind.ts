/**
 * Natural wind: strength and direction that wander on their own, slowly, the way a real wind does.
 * A few slow sine swells with phases taken from the world's seed (so every world has its own weather), no randomness at play time:
 * the same world at the same time always blows the same.
 *  - strength: a base of 4.5 with a 3 minute swell, a 53 s swell and a few seconds of gust (0..10, calm spells are rare);
 *  - direction: wanders about 60 degrees either side of a prevailing direction, over 4 minutes and over a little more than one.
 */
import { hash01 } from './worldgen';

const TAU = Math.PI * 2;

export function naturalWind(seed: number, t: number): { strength: number; dir: number } {
  const ph = (k: number) => hash01(seed & 0xffff, k, 7, 301) * TAU;
  const strength = 4.5 + 3 * Math.sin((TAU * t) / 180 + ph(1)) + 1.2 * Math.sin((TAU * t) / 53 + ph(2)) + 0.5 * Math.sin((TAU * t) / 17 + ph(3));
  const prevailing = hash01(seed & 0xffff, 4, 7, 301) * TAU;
  const dir = prevailing + 1.1 * Math.sin((TAU * t) / 240 + ph(5)) + 0.5 * Math.sin((TAU * t) / 71 + ph(6));
  return { strength: Math.round(Math.max(0, Math.min(10, strength)) * 10) / 10, dir: ((dir % TAU) + TAU) % TAU };
}
