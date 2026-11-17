import type { Frequency, Habit, StatRewards } from './types';
import { logWith } from './habitplan';
import { statRewards } from './xp';

export const HABIT_BASE_XP = 5;
/** Each day of streak makes the next completion pay 10% more than the one before, up to 3x. */
export const STREAK_GROWTH = 1.1, STREAK_CAP = 3;
/** Quick start: the first habit ticked within 3 minutes of opening the app pays 1.5x. */
export const QUICK_START_MS = 180_000, QUICK_START_BONUS = 1.5;

export const streakMultiplier = (streak: number) => Math.min(STREAK_CAP, STREAK_GROWTH ** Math.max(0, streak - 1));

/** What completing a habit pays: base XP times the streak multiplier (streak as it is after this completion) and the quick start bonus, plus one point in its category. */
export function habitReward(habit: Pick<Habit, 'category'>, streakAfter: number, quickStart: boolean): { xp: number; statRewards: StatRewards; multiplier: number } {
  const multiplier = streakMultiplier(streakAfter) * (quickStart ? QUICK_START_BONUS : 1);
  return { xp: Math.max(1, Math.round(HABIT_BASE_XP * multiplier)), statRewards: statRewards([], habit.category), multiplier };
}

/** Whole local-calendar days between two timestamps (DST-safe). */
export function dayDiff(fromMs: number, toMs: number): number {
  const a = new Date(fromMs), b = new Date(toMs);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

/**
 * Which period a moment falls in, counted from a fixed start: a calendar day, a week (Monday to Sunday) or a calendar month.
 * A habit is done once per period and its streak counts consecutive periods.
 */
export function periodIndex(frequency: Frequency, ms: number): number {
  const d = new Date(ms);
  if (frequency === 'MONTHLY') return d.getFullYear() * 12 + d.getMonth();
  const days = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  return frequency === 'WEEKLY' ? Math.floor((days + 3) / 7) : days;   // 1 Jan 1970 was a Thursday: +3 puts the week break on Monday
}
export const periodDiff = (frequency: Frequency, fromMs: number, toMs: number) => periodIndex(frequency, toMs) - periodIndex(frequency, fromMs);

export function nextStreak(streak: number, lastCompleted: number | null, now: number, frequency: Frequency = 'DAILY'): number {
  if (lastCompleted == null) return 1;
  const d = periodDiff(frequency, lastCompleted, now);
  if (d <= 0) return streak;   // same day (or clock went back): unchanged
  if (d === 1) return streak + 1;
  return 1;                    // a period skipped: streak restarts
}

/** Android counts calendar days whatever the frequency; here a weekly habit counts weeks and a monthly one months. */
export function completeHabit(habit: Habit, now: number): Habit {
  const streak = nextStreak(habit.streak, habit.lastCompleted, now, habit.frequency);
  return { ...habit, streak, bestStreak: Math.max(habit.bestStreak, streak), lastCompleted: now, log: logWith(habit, now), updatedAt: now };
}

/** Done for the current period: today for a daily habit, this week or month for the others. */
export const completedToday = (h: Pick<Habit, 'lastCompleted' | 'frequency'>, now: number) => h.lastCompleted != null && periodDiff(h.frequency, h.lastCompleted, now) === 0;

/** Streak as it should be shown now: a streak not continued yesterday or today is already lost. */
export function effectiveStreak(h: Pick<Habit, 'streak' | 'lastCompleted'> & { frequency?: Frequency }, now: number): number {
  if (h.lastCompleted == null) return 0;
  return periodDiff(h.frequency ?? 'DAILY', h.lastCompleted, now) > 1 ? 0 : h.streak;
}

/** How the habit list can be ordered: newest first, longest streak, still-to-do-today first, or A-Z. */
export type HabitSort = 'newest' | 'streak' | 'open' | 'name';
export function sortHabits(habits: Habit[], sort: HabitSort, now: number): Habit[] {
  const by: Record<HabitSort, (a: Habit, b: Habit) => number> = {
    newest: (a, b) => b.createdAt - a.createdAt,
    streak: (a, b) => effectiveStreak(b, now) - effectiveStreak(a, now) || b.bestStreak - a.bestStreak,
    open: (a, b) => Number(completedToday(a, now)) - Number(completedToday(b, now)),
    name: (a, b) => a.title.localeCompare(b.title),
  };
  return [...habits].sort((a, b) => by[sort](a, b) || b.createdAt - a.createdAt);   // ties: newest first, so the order is stable
}
