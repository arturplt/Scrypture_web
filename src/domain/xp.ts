import type { Category, Priority, StatRewards } from './types';

export const PRIORITY_XP: Record<Priority, number> = { LOW: 5, MEDIUM: 10, HIGH: 15, CRITICAL: 20 };
/** Fibonacci scale for difficulty 0-9. */
export const DIFFICULTY_XP = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55] as const;

export const difficultyXP = (d: number) => (Number.isInteger(d) && d >= 0 && d <= 9 ? DIFFICULTY_XP[d] : 0);
export const calculateXP = (priority: Priority, difficulty: number) => PRIORITY_XP[priority] + difficultyXP(difficulty);

const ZERO: StatRewards = { body: 0, mind: 0, soul: 0 };
const bump = (r: StatRewards, c: Category): StatRewards => ({ ...r, [c.toLowerCase()]: r[c.toLowerCase() as keyof StatRewards] + 1 });

/** Port of StatRewards.fromAttributesAndCategory: +1 per selected core attribute, +1 for the task's category. */
export function statRewards(coreAttributes: Category[], category?: Category): StatRewards {
  let r = coreAttributes.reduce(bump, ZERO);
  if (category) r = bump(r, category);
  return r;
}
