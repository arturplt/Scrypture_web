/**
 * Planner: a calendar of activities, plus a shortlist of the few to-dos that matter now. Web-only (Android has no planner).
 * It adds one new kind of record, the activity (something at a day and maybe a time, like "Dentist 15:30"); everything else
 * it shows is what the app already has: tasks by their due date and habits still to do today. Bóbr's chat reads the same
 * functions (`todaySummary`, `nextSteps`), so the planner, the lists and the chat always agree.
 *
 * Days are local midnights in epoch ms, like a task's `dueDate`. Pure functions only; the screen is `screens/Planner.tsx`.
 */
import type { Category, Frequency, Habit, Task } from './types';
import { habitSlot, repeatDays, slotDone, type HabitPlan } from './habitplan';
import { isOverdue, startOfDay } from './tasks';
import { completedToday } from './habits';

export interface PlanEvent {
  id: string;
  title: string;
  /** local midnight of its day */
  day: number;
  /** minutes after midnight (unset = any time that day) */
  time?: number;
  /** how long it takes, in minutes */
  minutes?: number;
  category?: Category;
  note?: string;
  done: boolean;
  /** what ticking it paid (taken back when it is unticked) */
  paid?: { xp: number; category?: Category };
  createdAt: number;
  /** a repeated activity: the id its copies share, and how often it repeats */
  series?: string;
  repeat?: Frequency;
}
export interface PlannerSave { events: PlanEvent[]; /** ids of the tasks picked as "do these next", in order */ shortlist: string[]; /** how many day columns the board shows (unset = 3) */ span?: Span }
export const emptyPlanner = (): PlannerSave => ({ events: [], shortlist: [] });

export const MAX_EVENTS = 500, SHORTLIST_MAX = 12, EVENT_TITLE_MAX = 80, EVENT_NOTE_MAX = 300;
/** How many days the board shows side by side: a day, three, five, or the week. */
export const SPANS = [1, 3, 5, 7] as const;
export type Span = (typeof SPANS)[number];
export const DEFAULT_SPAN: Span = 3;
/** Dragging on the board lands on quarter hours; a block is never shorter than one. */
export const SNAP_MINUTES = 15;
/** The hours the board shows unless something lies outside them. */
export const BOARD_FROM_HOUR = 6, BOARD_TO_HOUR = 22;
/** An activity with a time counts as "now" from this many minutes before it starts until it ends. */
export const SOON_MINUTES = 30;
/** How long an activity is taken to last when it has a time but no length. */
export const DEFAULT_EVENT_MINUTES = 30;
const CATEGORIES: readonly string[] = ['BODY', 'MIND', 'SOUL'];
const FREQUENCIES: readonly string[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
/** A repeated activity is made as this many separate activities (so each can be ticked, moved or changed on its own). */
export const REPEAT_COUNT: Record<Frequency, number> = { DAILY: 30, WEEKLY: 12, MONTHLY: 12 };

// ---- days ----------------------------------------------------------------------------------------------------------

/** The local midnight `n` days after (or before) a day; safe across clock changes. */
export const addDays = (day: number, n: number) => { const d = new Date(day); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
export const minutesOfDay = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

/** The 42 days (6 weeks) a month view shows, starting on `weekStart` (0 = Sunday, 1 = Monday). `month` is 0-11. */
export function monthGrid(year: number, month: number, weekStart = 1): number[] {
  const first = new Date(year, month, 1), lead = (first.getDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i).getTime());
}

/** A day as the value of a date field ("2026-11-16"), and back (undefined when the field is empty or not a date). */
export const dayToInput = (day: number) => { const d = new Date(day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function inputToDay(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** 570 -> "09:30". */
export const fmtClock = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
/** "9:30" or "09:30" -> 570; anything else -> undefined. */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!m) return undefined;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

// ---- activities ----------------------------------------------------------------------------------------------------

export interface NewEvent { title: string; day: number; time?: number; minutes?: number; category?: Category; note?: string; series?: string; repeat?: Frequency }

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const whole = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined);

/** The checked, tidy fields of an activity, or null when it has no title or no valid day. */
export function cleanEvent(input: Partial<NewEvent>): NewEvent | null {
  const title = cleanText(input.title, EVENT_TITLE_MAX).replace(/\n/g, ' ');
  if (!title || typeof input.day !== 'number' || !Number.isFinite(input.day)) return null;
  const note = cleanText(input.note, EVENT_NOTE_MAX);
  const out: NewEvent = { title, day: startOfDay(input.day) };
  const time = whole(input.time, 0, 1439), minutes = whole(input.minutes, 1, 1440);
  if (time !== undefined) out.time = time;
  if (minutes !== undefined) out.minutes = minutes;
  if (CATEGORIES.includes(input.category as string)) out.category = input.category;
  if (note) out.note = note;
  if (typeof input.series === 'string' && input.series && FREQUENCIES.includes(input.repeat as string)) { out.series = input.series; out.repeat = input.repeat; }
  return out;
}

/** In the order of a day: activities without a time first, then by time; ties by when they were added. */
export const sortEvents = (events: readonly PlanEvent[]): PlanEvent[] =>
  [...events].sort((a, b) => a.day - b.day || (a.time ?? -1) - (b.time ?? -1) || a.createdAt - b.createdAt);
export const eventsOn = (events: readonly PlanEvent[], day: number): PlanEvent[] => { const d = startOfDay(day); return sortEvents(events.filter(e => e.day === d)); };

/** When an activity with a time ends, in minutes after midnight. */
export const eventEnd = (e: Pick<PlanEvent, 'time' | 'minutes'>) => (e.time ?? 0) + (e.minutes ?? DEFAULT_EVENT_MINUTES);

// ---- the board: day columns with blocks of time -----------------------------------------------------------------------

/** The days the board shows for the chosen day: the day itself and the ones after it, or its whole week (from `weekStart`, 1 = Monday) for 7. */
export function boardDays(day: number, span: Span, weekStart = 1): number[] {
  const d = startOfDay(day), first = span === 7 ? addDays(d, -((new Date(d).getDay() - weekStart + 7) % 7)) : d;
  return Array.from({ length: span }, (_, i) => addDays(first, i));
}
export const snapMinutes = (m: number, step = SNAP_MINUTES) => Math.round(m / step) * step;
/** How long a block is drawn (and takes) on the board. */
export const eventLength = (e: Pick<PlanEvent, 'minutes'>) => e.minutes ?? DEFAULT_EVENT_MINUTES;

/**
 * Where a dragged activity lands: on `day`, at `time` (snapped to quarter hours and kept inside the day with its whole length),
 * or at no time at all (`time` undefined: dropped on the day's top lane; its length is then kept for when it gets a time again).
 */
export function placeEvent(e: PlanEvent, day: number, time: number | undefined): NewEvent {
  const { title, minutes, category, note, series, repeat } = e;
  const t = time === undefined ? undefined : Math.max(0, Math.min(1440 - eventLength(e), snapMinutes(time)));
  return { title, day: startOfDay(day), time: t, minutes, category, note, series, repeat };
}
/** An activity with a new length: quarter hours, at least one, and never past midnight. */
export function resizeEvent(e: PlanEvent, minutes: number): NewEvent {
  const { title, day, time, category, note, series, repeat } = e;
  return { title, day, time, series, repeat, minutes: Math.max(SNAP_MINUTES, Math.min(1440 - (time ?? 0), snapMinutes(minutes))), category, note };
}

/** The activities a repeated one is made of: the same fields on each of its days, sharing `series`. */
export function repeatEvents(input: NewEvent, repeat: Frequency, series: string): NewEvent[] {
  return repeatDays(input.day, repeat, REPEAT_COUNT[repeat]).map(day => ({ ...input, day, series, repeat }));
}
/** The activities of a series from this one on (itself included): what "all future ones" means. */
export const seriesFrom = (events: readonly PlanEvent[], e: PlanEvent): PlanEvent[] => (e.series ? events.filter(x => x.series === e.series && x.day >= e.day) : [e]);

/** Blocks laid out so that overlapping ones get different lanes: `lane` counts from the left, `lanes` is how many its group has. */
export function layoutBlocks<T>(items: readonly T[], span: (x: T) => [number, number]): { item: T; lane: number; lanes: number }[] {
  const sorted = items.map((item, i) => ({ item, i, s: span(item) })).sort((a, b) => a.s[0] - b.s[0] || a.i - b.i);
  const out: { item: T; lane: number; lanes: number }[] = [];
  let group: typeof out = [], ends: number[] = [], groupEnd = -1;
  const close = () => { for (const p of group) p.lanes = ends.length; group = []; ends = []; };
  for (const { item, s: [start, end] } of sorted) {
    if (start >= groupEnd) close();
    let lane = ends.findIndex(e => e <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = end;
    groupEnd = Math.max(groupEnd, end);
    const p = { item, lane, lanes: 1 };
    group.push(p); out.push(p);
  }
  close();
  return out;
}

/** A habit's plan with a new time of day (quarter hours, its whole length inside the day), or none. */
export function placeHabit(plan: HabitPlan, time: number | undefined): HabitPlan {
  const { time: _t, ...rest } = plan;
  return time === undefined ? rest : { ...rest, time: Math.max(0, Math.min(1440 - eventLength(plan), snapMinutes(time))) };
}
/** A habit's plan with a new length: quarter hours, at least one, and never past midnight. */
export const resizeHabit = (plan: HabitPlan, minutes: number): HabitPlan => ({ ...plan, minutes: Math.max(SNAP_MINUTES, Math.min(1440 - (plan.time ?? 0), snapMinutes(minutes))) });

export interface Placed { event: PlanEvent; /** which of the side-by-side lanes it sits in, and how many lanes its group has */ lane: number; lanes: number }
/** The timed activities of one day laid out so that overlapping ones sit side by side (each group of overlapping blocks shares the width). */
export function layoutDay(events: readonly PlanEvent[]): Placed[] {
  return layoutBlocks(sortEvents(events.filter(e => e.time != null)), e => [e.time!, eventEnd(e)]).map(({ item, lane, lanes }) => ({ event: item, lane, lanes }));
}
/** The hours [from, to) the board must show for these days: the usual day, widened to hold every timed activity (and `nowMin` when given). */
export function boardHours(events: readonly PlanEvent[], days: readonly number[], nowMin?: number, more: readonly [number, number][] = []): [number, number] {
  let from = BOARD_FROM_HOUR, to = BOARD_TO_HOUR;
  const want = (a: number, b: number) => { from = Math.min(from, Math.floor(a / 60)); to = Math.max(to, Math.min(24, Math.ceil(b / 60))); };
  for (const e of events) if (e.time != null && days.includes(e.day)) want(e.time, eventEnd(e));
  if (nowMin !== undefined) want(nowMin, nowMin + 1);
  for (const [a, b] of more) want(a, b);
  return [from, to];
}

// ---- shortlist -----------------------------------------------------------------------------------------------------

const doneToday = (t: Task, now: number) => t.completed && t.lastCompletedAt != null && startOfDay(t.lastCompletedAt) === startOfDay(now);

/** The shortlist without what no longer belongs: deleted tasks, repeats, and tasks finished before today. */
export function pruneShortlist(list: readonly string[], tasks: readonly Task[], now: number): string[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const out: string[] = [];
  for (const id of list) {
    const t = byId.get(id);
    if (t && !out.includes(id) && (!t.completed || doneToday(t, now))) out.push(id);
    if (out.length >= SHORTLIST_MAX) break;
  }
  return out;
}
/** The shortlisted tasks, in order. A task ticked today stays (ticked) until tomorrow, so the day's progress shows. */
export function shortlistTasks(list: readonly string[], tasks: readonly Task[], now: number): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  return pruneShortlist(list, tasks, now).map(id => byId.get(id)!);
}
/** The shortlist with one more task, or null when it is full, already there, or not an open task. */
export function shortlistWith(list: readonly string[], tasks: readonly Task[], id: string, now: number): string[] | null {
  const cur = pruneShortlist(list, tasks, now), t = tasks.find(x => x.id === id);
  return !t || t.completed || cur.includes(id) || cur.length >= SHORTLIST_MAX ? null : [...cur, id];
}

// ---- a day ---------------------------------------------------------------------------------------------------------

export interface PlanData { events: readonly PlanEvent[]; shortlist: readonly string[]; tasks: readonly Task[]; habits: readonly Habit[] }
export interface DayPlan {
  day: number;
  isToday: boolean;
  events: PlanEvent[];
  /** tasks due that day (open first, then the ones already done) */
  tasks: Task[];
  /** today only: open tasks whose day has passed */
  late: Task[];
  /** today only: habits not done yet */
  habits: Habit[];
}
export function dayPlan(p: PlanData, day: number, now: number): DayPlan {
  const d = startOfDay(day), isToday = d === startOfDay(now);
  const due = p.tasks.filter(t => t.dueDate != null && startOfDay(t.dueDate) === d);
  return {
    day: d, isToday,
    events: eventsOn(p.events, d),
    tasks: [...due.filter(t => !t.completed), ...due.filter(t => t.completed)],
    late: isToday ? p.tasks.filter(t => isOverdue(t, now)).sort((a, b) => a.dueDate! - b.dueDate!) : [],
    // a habit on the planner is only due on its own days (and not when its turn was already done); the others every day
    habits: isToday ? p.habits.filter(h => { if (completedToday(h, now)) return false; if (!h.plan) return true; const s = habitSlot(h, d); return !!s && !slotDone(s); }) : [],
  };
}

/** What the month view marks on each day: how many activities and open tasks it has. Days with nothing are left out. */
export function monthMarks(p: Pick<PlanData, 'events' | 'tasks'>): Map<number, { events: number; tasks: number }> {
  const out = new Map<number, { events: number; tasks: number }>();
  const at = (day: number) => { let m = out.get(day); if (!m) out.set(day, m = { events: 0, tasks: 0 }); return m; };
  for (const e of p.events) if (!e.done) at(e.day).events++;
  for (const t of p.tasks) if (!t.completed && t.dueDate != null) at(startOfDay(t.dueDate)).tasks++;
  return out;
}

export interface TodaySummary { events: number; nextEvent?: PlanEvent; shortlist: number; dueToday: number; late: number; habitsLeft: number; /** everything still to do today, counted once */ total: number }
/** Today in numbers (for the Home badge and Bóbr's greeting). */
export function todaySummary(p: PlanData, now: number): TodaySummary {
  const plan = dayPlan(p, now, now), nowMin = minutesOfDay(now);
  const open = plan.events.filter(e => !e.done);
  const short = shortlistTasks(p.shortlist, p.tasks, now).filter(t => !t.completed);
  const dueToday = plan.tasks.filter(t => !t.completed);
  const todo = new Set([...short, ...dueToday, ...plan.late].map(t => t.id));
  return {
    events: open.length, nextEvent: open.find(e => e.time != null && eventEnd(e) >= nowMin),
    shortlist: short.length, dueToday: dueToday.length, late: plan.late.length, habitsLeft: plan.habits.length,
    total: open.length + todo.size,
  };
}

// ---- what to do next -----------------------------------------------------------------------------------------------

export type NextWhy = 'now' | 'late' | 'shortlist' | 'today' | 'planned' | 'habit' | 'urgent';
export type NextStep =
  | { kind: 'event'; id: string; why: 'now' | 'planned'; event: PlanEvent }
  | { kind: 'task'; id: string; why: 'late' | 'shortlist' | 'today' | 'urgent'; task: Task }
  | { kind: 'habit'; id: string; why: 'habit'; habit: Habit };

/**
 * Everything worth doing now, most pressing first, each thing once:
 * an activity that is on now or starts within half an hour; late tasks (shortlisted ones first); the shortlist in its order;
 * tasks due today; today's activities without a time; habits still to do; then other high-priority tasks.
 * Activities later today are not offered: they have their own time.
 */
export function nextSteps(p: PlanData, now: number): NextStep[] {
  const plan = dayPlan(p, now, now), nowMin = minutesOfDay(now);
  const short = shortlistTasks(p.shortlist, p.tasks, now).filter(t => !t.completed), inShort = new Set(short.map(t => t.id));
  const out: NextStep[] = [], seen = new Set<string>();
  const push = (s: NextStep) => { if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } };
  const open = plan.events.filter(e => !e.done);
  for (const e of open) if (e.time != null && e.time - SOON_MINUTES <= nowMin && eventEnd(e) >= nowMin) push({ kind: 'event', id: e.id, why: 'now', event: e });
  for (const t of [...plan.late.filter(x => inShort.has(x.id)), ...plan.late.filter(x => !inShort.has(x.id))]) push({ kind: 'task', id: t.id, why: 'late', task: t });
  for (const t of short) push({ kind: 'task', id: t.id, why: 'shortlist', task: t });
  for (const t of plan.tasks) if (!t.completed) push({ kind: 'task', id: t.id, why: 'today', task: t });
  for (const e of open) if (e.time == null) push({ kind: 'event', id: e.id, why: 'planned', event: e });
  for (const h of plan.habits) push({ kind: 'habit', id: h.id, why: 'habit', habit: h });
  for (const t of p.tasks) if (!t.completed && (t.priority === 'CRITICAL' || t.priority === 'HIGH')) push({ kind: 'task', id: t.id, why: 'urgent', task: t });
  return out;
}

// ---- saving --------------------------------------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const done_paid = (e: Record<string, unknown>): { paid?: { xp: number; category?: Category } } => {
  const p = e.paid;
  if (e.done !== true || !isObj(p) || typeof p.xp !== 'number' || !Number.isFinite(p.xp) || p.xp < 0) return {};
  return { paid: CATEGORIES.includes(p.category as string) ? { xp: p.xp, category: p.category as Category } : { xp: p.xp } };
};

/** What ticking an activity pays: 5 XP plus 1 per 15 minutes (up to +15), and one point in its category when it has one. */
export function eventReward(e: Pick<PlanEvent, 'minutes' | 'category'>): { xp: number; category?: Category } {
  const xp = 5 + Math.min(15, Math.floor((e.minutes ?? 0) / 15));
  return e.category ? { xp, category: e.category } : { xp };
}

/** Keep only valid activities and shortlist ids from anything (an old save or an import). */
export function sanitizePlanner(raw: unknown): PlannerSave {
  if (!isObj(raw)) return emptyPlanner();
  const events: PlanEvent[] = [], ids = new Set<string>();
  for (const e of Array.isArray(raw.events) ? raw.events : []) {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id || ids.has(e.id)) continue;
    const clean = cleanEvent(e as Partial<NewEvent>);
    if (!clean) continue;
    ids.add(e.id);
    events.push({ id: e.id, ...clean, done: e.done === true, ...(done_paid(e)), createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0 });
    if (events.length >= MAX_EVENTS) break;
  }
  const shortlist = [...new Set((Array.isArray(raw.shortlist) ? raw.shortlist : []).filter((x): x is string => typeof x === 'string' && !!x))].slice(0, SHORTLIST_MAX);
  const span = SPANS.find(n => n === raw.span);
  return span ? { events, shortlist, span } : { events, shortlist };
}

/** Move one id a place up (-1) or down (1) in a list; anything else (not there, already at the end) leaves it as it was. */
export function moveInList<T>(list: readonly T[], item: T, by: -1 | 1): T[] {
  const i = list.indexOf(item), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
