import type { BobrStage } from './types';

/** Cumulative XP needed for level i+1. Level 10 is the cap. */
export const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700] as const;
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export function calculateLevel(totalXP: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) if (totalXP >= LEVEL_THRESHOLDS[i]) return i + 1;
  return 1;
}

/** XP still missing for the next level (0 at the cap). */
export function xpForNextLevel(level: number, totalXP: number): number {
  return level >= MAX_LEVEL ? 0 : LEVEL_THRESHOLDS[level] - totalXP;
}

/** 0..1 progress inside the current level. */
export function progressToNextLevel(level: number, totalXP: number): number {
  if (level >= MAX_LEVEL) return 1;
  const cur = level > 1 ? LEVEL_THRESHOLDS[level - 1] : 0;
  const next = LEVEL_THRESHOLDS[level];
  return Math.min(1, Math.max(0, (totalXP - cur) / (next - cur)));
}

export function bobrStage(level: number): BobrStage {
  return level <= 3 ? 'HATCHLING' : level <= 6 ? 'YOUNG' : 'MATURE';
}
