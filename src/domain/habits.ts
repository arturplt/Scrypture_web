import type { Frequency, Habit, StatRewards } from './types';
import { habitLog, logWith } from './habitplan';
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

// ---- targets: "3 times a week" -----------------------------------------------------------------------------------------

/** The most days a period can ask for: every day of a week; for a month, 28 (so every month can meet it). */
export const TARGET_MAX: Record<Frequency, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 28 };
type Targeted = Pick<Habit, 'lastCompleted' | 'frequency'> & Partial<Pick<Habit, 'target' | 'log'>>;
/** How many different days of its period a habit wants (1 for daily habits and for those without a target). */
export const habitTarget = (h: Pick<Habit, 'frequency'> & { target?: number }) => (h.target && h.target > 1 ? Math.min(TARGET_MAX[h.frequency], Math.round(h.target)) : 1);
/** A target as it may be saved: a whole number from 2 to the period's maximum, else none. */
export const cleanTarget = (frequency: Frequency, target: unknown): number | undefined =>
  typeof target === 'number' && Number.isFinite(target) && Math.round(target) > 1 && frequency !== 'DAILY' ? Math.min(TARGET_MAX[frequency], Math.round(target)) : undefined;
/** On how many different days of the period of `now` the habit was done. */
export function doneInPeriod(h: Targeted, now: number): number {
  const p = periodIndex(h.frequency, now);
  return habitLog({ log: h.log, lastCompleted: h.lastCompleted }).filter(d => periodIndex(h.frequency, d) === p).length;
}
/**
 * A habit with a target: periods in a row that met it, ending with the period of `now` when that one is met already, otherwise with the one before
 * (a week still under way does not break the streak). Read from the log of days done.
 */
export function targetStreak(h: Targeted, now: number): number {
  const target = habitTarget(h), counts = new Map<number, number>();
  for (const d of habitLog({ log: h.log, lastCompleted: h.lastCompleted })) { const p = periodIndex(h.frequency, d); counts.set(p, (counts.get(p) ?? 0) + 1); }
  let p = periodIndex(h.frequency, now), n = 0;
  if ((counts.get(p) ?? 0) < target) p--;
  while ((counts.get(p) ?? 0) >= target) { n++; p--; }
  return n;
}

export function nextStreak(streak: number, lastCompleted: number | null, now: number, frequency: Frequency = 'DAILY'): number {
  if (lastCompleted == null) return 1;
  const d = periodDiff(frequency, lastCompleted, now);
  if (d <= 0) return streak;   // same day (or clock went back): unchanged
  if (d === 1) return streak + 1;
  return 1;                    // a period skipped: streak restarts
}

/** Android counts calendar days whatever the frequency; here a weekly habit counts weeks and a monthly one months. */
export function completeHabit(habit: Habit, now: number): Habit {
  const log = logWith(habit, now);
  // with a target the streak counts periods that met it, read from the log; otherwise each period done once
  const streak = habitTarget(habit) > 1 ? targetStreak({ ...habit, log }, now) : nextStreak(habit.streak, habit.lastCompleted, now, habit.frequency);
  return { ...habit, streak, bestStreak: Math.max(habit.bestStreak, streak), lastCompleted: now, log, updatedAt: now };
}

/**
 * Nothing to do on it now: for a daily habit, done today; for the others, done this week or month, or (with a target) done on enough days of it,
 * or done today already (a target counts different days).
 */
export const completedToday = (h: Targeted, now: number) => {
  if (h.lastCompleted == null) return false;
  if (habitTarget(h) === 1) return periodDiff(h.frequency, h.lastCompleted, now) === 0;
  return periodDiff('DAILY', h.lastCompleted, now) === 0 || doneInPeriod(h, now) >= habitTarget(h);
};

/** Streak as it should be shown now: a streak not continued yesterday or today is already lost. */
export function effectiveStreak(h: Pick<Habit, 'streak' | 'lastCompleted'> & { frequency?: Frequency; target?: number; log?: number[] }, now: number): number {
  if (h.lastCompleted == null) return 0;
  const frequency = h.frequency ?? 'DAILY';
  if (habitTarget({ frequency, target: h.target }) > 1) return targetStreak({ ...h, frequency }, now);
  return periodDiff(frequency, h.lastCompleted, now) > 1 ? 0 : h.streak;
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
