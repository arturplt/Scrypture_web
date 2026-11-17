/**
 * Habits on the planner. A habit put on a day repeats from that day on as often as its frequency says: every day, every
 * week on that weekday, every month on that date (the last day of a shorter month). One occurrence can be moved to another
 * day on its own (`moved`), or the whole rest of the series can (`start` changes). A habit may also have a time of day and
 * a length, which make it a block on the board; those belong to the whole series.
 *
 * Every completion is logged by day (`Habit.log`), so the board can show what was done on past days and the planner can
 * list the completed habits. Pure functions only.
 */
import type { Frequency, Habit } from './types';
import { dayDiff } from './habits';
import { startOfDay } from './tasks';

export interface HabitPlan {
  /** local midnight of the first occurrence: the series repeats from here */
  start: number;
  /** minutes after midnight (unset = any time that day) */
  time?: number;
  /** how long it takes, in minutes */
  minutes?: number;
  /** occurrences moved on their own: the day the rule gives -> the day it is shown on instead */
  moved?: Record<string, number>;
}
export const HABIT_LOG_MAX = 400, HABIT_MOVED_MAX = 60;

const shift = (day: number, n: number) => { const d = new Date(day); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const monthLength = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Does the rule put an occurrence on this day? */
export function isRuleDay(frequency: Frequency, start: number, day: number): boolean {
  const n = dayDiff(start, day);
  if (n < 0) return false;
  if (frequency === 'DAILY') return true;
  if (frequency === 'WEEKLY') return n % 7 === 0;
  const d = new Date(day);
  return d.getDate() === Math.min(new Date(start).getDate(), monthLength(d));
}

/** The days a series of `n` occurrences falls on, starting at `day` (what a repeated activity is made of). */
export function repeatDays(day: number, frequency: Frequency, n: number): number[] {
  const first = new Date(startOfDay(day));
  return Array.from({ length: n }, (_, i) => {
    if (frequency !== 'MONTHLY') return shift(first.getTime(), i * (frequency === 'DAILY' ? 1 : 7));
    const m = new Date(first.getFullYear(), first.getMonth() + i, 1);
    return new Date(m.getFullYear(), m.getMonth(), Math.min(first.getDate(), monthLength(m))).getTime();
  });
}

/** The days a habit was completed on, oldest first (a habit from before the log existed has only its last day). */
export const habitLog = (h: Pick<Habit, 'log' | 'lastCompleted'>): number[] => h.log ?? (h.lastCompleted != null ? [startOfDay(h.lastCompleted)] : []);
/** The log with one more day. */
export const logWith = (h: Pick<Habit, 'log' | 'lastCompleted'>, now: number): number[] => {
  const day = startOfDay(now);
  return [...habitLog(h).filter(d => d !== day), day].slice(-HABIT_LOG_MAX);
};

/** One occurrence of a planned habit: the day it is shown on and the day its rule gave it. */
export interface HabitSlot { habit: Habit; day: number; ruleDay: number }

/** The occurrence of this habit shown on this day, if there is one. */
export function habitSlot(habit: Habit, day: number): HabitSlot | null {
  const p = habit.plan;
  if (!p) return null;
  const d = startOfDay(day), moved = p.moved ?? {};
  for (const [from, to] of Object.entries(moved)) if (to === d && isRuleDay(habit.frequency, p.start, Number(from))) return { habit, day: d, ruleDay: Number(from) };
  return isRuleDay(habit.frequency, p.start, d) && !(String(d) in moved) ? { habit, day: d, ruleDay: d } : null;
}
/** The planned habits of a day: the ones without a time first, then by time, then by name. */
export function habitsOn(habits: readonly Habit[], day: number): HabitSlot[] {
  return habits.map(h => habitSlot(h, day)).filter((s): s is HabitSlot => !!s)
    .sort((a, b) => (a.habit.plan!.time ?? -1) - (b.habit.plan!.time ?? -1) || a.habit.title.localeCompare(b.habit.title));
}
/**
 * Was this occurrence done? A daily one on its day; a weekly one on any day of the week around it (three days either
 * side); a monthly one any day of its month. So a habit done a little early or late still counts for its turn.
 */
export function slotDone({ habit, day, ruleDay }: HabitSlot): boolean {
  const near = (d: number) => {
    if (d === day || d === ruleDay) return true;
    if (habit.frequency === 'WEEKLY') return Math.abs(dayDiff(ruleDay, d)) <= 3;
    if (habit.frequency === 'MONTHLY') { const a = new Date(d), b = new Date(ruleDay); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
    return false;
  };
  return habitLog(habit).some(near);
}

/**
 * A plan with one occurrence moved to another day: only that one (`one`), or that one and every one after it (`all`: the
 * series starts again from the new day, and the single moves from then on are dropped).
 */
export function moveHabit(plan: HabitPlan, ruleDay: number, toDay: number, scope: 'one' | 'all'): HabitPlan {
  const to = startOfDay(toDay);
  const moved = Object.entries(plan.moved ?? {}).filter(([from]) => Number(from) !== ruleDay && (scope === 'one' || Number(from) < ruleDay));
  if (scope === 'one' && to !== ruleDay) moved.push([String(ruleDay), to]);
  const out: HabitPlan = { ...plan, start: scope === 'all' ? to : plan.start };
  delete out.moved;
  if (moved.length) out.moved = Object.fromEntries(moved.sort((a, b) => Number(a[0]) - Number(b[0])).slice(-HABIT_MOVED_MAX));
  return out;
}

/** The habits completed on each of the last `days` days, today first; days with none are left out. */
export function habitHistory(habits: readonly Habit[], now: number, days: number): { day: number; habits: Habit[] }[] {
  const today = startOfDay(now), out: { day: number; habits: Habit[] }[] = [];
  for (let i = 0; i < days; i++) {
    const day = shift(today, -i), done = habits.filter(h => habitLog(h).includes(day));
    if (done.length) out.push({ day, habits: done });
  }
  return out;
}

/** Keep only a valid plan and log from anything (an old save or an import). */
export function sanitizeHabitExtras(h: { plan?: unknown; log?: unknown }): { plan?: HabitPlan; log?: number[] } {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const out: { plan?: HabitPlan; log?: number[] } = {};
  if (Array.isArray(h.log)) out.log = [...new Set(h.log.filter(num).map(startOfDay))].sort((a, b) => a - b).slice(-HABIT_LOG_MAX);
  const p = h.plan as Record<string, unknown> | undefined;
  if (p && typeof p === 'object' && num(p.start)) {
    const plan: HabitPlan = { start: startOfDay(p.start) };
    if (num(p.time) && p.time >= 0 && p.time <= 1439) plan.time = Math.round(p.time);
    if (num(p.minutes) && p.minutes >= 1 && p.minutes <= 1440) plan.minutes = Math.round(p.minutes);
    const moved = p.moved && typeof p.moved === 'object' ? Object.entries(p.moved as Record<string, unknown>).filter(([k, v]) => Number.isFinite(Number(k)) && num(v)) : [];
    if (moved.length) plan.moved = Object.fromEntries(moved.slice(-HABIT_MOVED_MAX).map(([k, v]) => [k, startOfDay(v as number)]));
    out.plan = plan;
  }
  return out;
}
