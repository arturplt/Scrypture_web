import type { StatRewards, Task, UserStats } from './types';
import { calculateLevel } from './levels';

/** Counters (XP, stat points, tasks done, items) are whole numbers and never grow past this: a runaway value would print as 2.1e+53 and break every sum. */
export const COUNT_MAX = 1_000_000_000;
export const cleanCount = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(COUNT_MAX, Math.max(0, Math.floor(n))) : n === Infinity ? COUNT_MAX : 0);

export const initialStats = (): UserStats =>
  ({ level: 1, totalExperiencePoints: 0, body: 0, mind: 0, soul: 0, totalTasksCompleted: 0 });

export function addXP(stats: UserStats, xp: number): { stats: UserStats; leveledUp: number | null } {
  const totalExperiencePoints = cleanCount(stats.totalExperiencePoints + xp);
  const level = calculateLevel(totalExperiencePoints);
  return { stats: { ...stats, totalExperiencePoints, level }, leveledUp: level !== stats.level ? level : null };
}

/** Give XP and stat points that are not a task (a habit, an activity); the task counter stays as it is. */
export function applyReward(stats: UserStats, xp: number, rewards: StatRewards) {
  const { stats: s, leveledUp } = addXP(stats, xp);
  return { stats: { ...s, body: cleanCount(s.body + rewards.body), mind: cleanCount(s.mind + rewards.mind), soul: cleanCount(s.soul + rewards.soul) }, leveledUp };
}
/** Take such a reward back (never below zero). */
export function revokeReward(stats: UserStats, xp: number, rewards: StatRewards): UserStats {
  const totalExperiencePoints = Math.max(0, stats.totalExperiencePoints - xp);
  return { ...stats, totalExperiencePoints, level: calculateLevel(totalExperiencePoints),
    body: Math.max(0, stats.body - rewards.body), mind: Math.max(0, stats.mind - rewards.mind), soul: Math.max(0, stats.soul - rewards.soul) };
}

/** Apply a completed task's rewards (XP, stat points, task counter). */
export function applyTaskCompletion(stats: UserStats, task: Pick<Task, 'experienceReward' | 'statRewards'>) {
  const { stats: s, leveledUp } = addXP(stats, task.experienceReward);
  return {
    stats: {
      ...s,
      body: cleanCount(s.body + task.statRewards.body),
      mind: cleanCount(s.mind + task.statRewards.mind),
      soul: cleanCount(s.soul + task.statRewards.soul),
      totalTasksCompleted: cleanCount(s.totalTasksCompleted + 1),
    },
    leveledUp,
  };
}

/** Unticking a task within this long after completing it takes its rewards back (it was a mistake). */
export const UNDO_WINDOW_MS = 10_000;

/** Take back a completion's rewards: XP, stat points and the task counter, never below zero; the level follows the XP. */
export function revokeTaskCompletion(stats: UserStats, paid: { xp: number; statRewards: StatRewards }): UserStats {
  const totalExperiencePoints = Math.max(0, stats.totalExperiencePoints - paid.xp);
  return {
    ...stats,
    totalExperiencePoints,
    level: calculateLevel(totalExperiencePoints),
    body: Math.max(0, stats.body - paid.statRewards.body),
    mind: Math.max(0, stats.mind - paid.statRewards.mind),
    soul: Math.max(0, stats.soul - paid.statRewards.soul),
    totalTasksCompleted: Math.max(0, stats.totalTasksCompleted - 1),
  };
}

/** Within the undo window of the last completion? */
export const canRefund = (task: Pick<Task, 'completed' | 'lastCompletedAt' | 'lastReward'>, now: number) =>
  task.completed && task.lastReward != null && task.lastCompletedAt != null && now - task.lastCompletedAt <= UNDO_WINDOW_MS && now >= task.lastCompletedAt;
