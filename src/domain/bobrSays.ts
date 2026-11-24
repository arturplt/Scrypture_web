import type { BobrStage } from './types';
import type { Emotion } from './bobr';

/**
 * What Bóbr says on Home: a short line in a speech bubble over him, a new one every SAYS_EVERY_MS, shown for SAYS_SHOW_MS.
 * The web version of Android's `getMotivationalMessage` (by stage), plus lines for his mood, the time of day and how the day is
 * going. Returns a translation key (and its parameters), picked the same way for the same slot so a re-render never changes it.
 */
export const SAYS_EVERY_MS = 30_000, SAYS_SHOW_MS = 7_000, SAYS_FIRST_MS = 4_000;

export interface SaysInput { stage: BobrStage; emotion: Emotion; hour: number; /** tasks and habits done today */ doneToday: number }
export interface SaysLine { key: string; n?: number }

const MOOD: Partial<Record<Emotion, string[]>> = {
  HUNGRY: ['saysHungry1', 'saysHungry2'],
  SAD: ['saysSad1', 'saysSad2'],
  SLEEPY: ['saysSleepy1', 'saysSleepy2'],
  EXCITED: ['saysExcited1', 'saysExcited2'],
  MISCHIEVOUS: ['saysMischief1', 'saysMischief2'],
};
const STAGE: Record<BobrStage, string[]> = {
  HATCHLING: ['saysHatch1', 'saysHatch2', 'saysHatch3'],
  YOUNG: ['saysYoung1', 'saysYoung2', 'saysYoung3'],
  MATURE: ['saysMature1', 'saysMature2', 'saysMature3'],
};

/** Every key this module can return (the i18n test checks each is translated). */
export const SAYS_KEYS = [...Object.values(MOOD).flat(), ...Object.values(STAGE).flat(), 'saysMorning', 'saysEvening', 'saysNoneYet', 'saysProud'];

/** A small deterministic hash, so slot n always gives the same pick. */
const mix = (n: number) => { let x = (n | 0) * 2654435761; x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; return (x >>> 0) / 4294967296; };

export function bobrSays({ stage, emotion, hour, doneToday }: SaysInput, slot: number): SaysLine {
  const r = mix(slot), pick = (a: string[]) => a[Math.floor(mix(slot * 7 + 3) * a.length)];
  // a strong mood comes first (he says what he feels most of the time), sleepy at night always
  const mood = MOOD[emotion];
  if (mood && (emotion === 'HUNGRY' || emotion === 'SLEEPY' || r < 0.7)) return { key: pick(mood) };
  if (doneToday >= 3 && r < 0.85) return { key: 'saysProud', n: doneToday };
  if (hour >= 6 && hour < 11 && doneToday === 0 && r < 0.85) return { key: 'saysMorning' };
  if (hour >= 19 && hour < 23 && r < 0.4) return { key: 'saysEvening' };
  if (doneToday === 0 && hour >= 11 && r < 0.4) return { key: 'saysNoneYet' };
  return { key: pick(STAGE[stage]) };
}

/** Which line slot `now` falls in, and whether the bubble is showing then (`since`: when Home was opened). */
export function saysSlot(now: number, since: number): { slot: number; showing: boolean } {
  const t = now - since - SAYS_FIRST_MS;
  if (t < 0) return { slot: -1, showing: false };
  const slot = Math.floor(t / SAYS_EVERY_MS);
  return { slot: slot + Math.floor(since / SAYS_EVERY_MS), showing: t - slot * SAYS_EVERY_MS < SAYS_SHOW_MS };
}
