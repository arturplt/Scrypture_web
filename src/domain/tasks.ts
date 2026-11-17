import type { Category, Priority, Task } from './types';

export type TaskSort = 'newest' | 'due' | 'priority' | 'difficulty' | 'created' | 'none';
export interface TaskView { category: Category | 'ALL'; sort: TaskSort; showCompleted: boolean; /** only tasks with this tag */ tag?: string | null }

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
/** Due date = local midnight of the chosen day; overdue once that whole day has passed. */
export const isOverdue = (t: Pick<Task, 'dueDate' | 'completed'>, now: number) =>
  !t.completed && t.dueDate != null && t.dueDate < startOfDay(now);

/**
 * How pressing an open task is, which drives the card's pulsing glow: 'overdue' (fast red) or 'soon' (slow orange).
 * It is the stronger of the due date (past = overdue, today or tomorrow = soon) and the priority (CRITICAL = overdue-level,
 * HIGH = soon), so tasks without a deadline can still be urgent.
 */
export type Urgency = 'none' | 'soon' | 'overdue';
const URGENCY_RANK: Urgency[] = ['none', 'soon', 'overdue'];
export const urgencyOf = (t: Pick<Task, 'dueDate' | 'completed'> & { priority?: Priority }, now: number): Urgency => {
  if (t.completed) return 'none';
  const byDate: Urgency = t.dueDate == null ? 'none' : isOverdue(t, now) ? 'overdue' : t.dueDate < startOfDay(now) + 2 * 86_400_000 ? 'soon' : 'none';   // due dates are midnights, so ~2 days is close enough
  const byPriority: Urgency = t.priority === 'CRITICAL' ? 'overdue' : t.priority === 'HIGH' ? 'soon' : 'none';
  return URGENCY_RANK[Math.max(URGENCY_RANK.indexOf(byDate), URGENCY_RANK.indexOf(byPriority))];
};

const bySort: Record<TaskSort, (a: Task, b: Task) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  due: (a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || b.createdAt - a.createdAt,
  priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.createdAt - a.createdAt,
  difficulty: (a, b) => b.difficulty - a.difficulty || b.createdAt - a.createdAt,
  created: (a, b) => a.createdAt - b.createdAt,
  none: () => 0,   // keeps the stored order (Array.sort is stable)
};

/** Open tasks sorted as requested, followed (optionally) by completed ones, most recently finished first. */
export function viewTasks(tasks: Task[], v: TaskView): { open: Task[]; done: Task[] } {
  const inCat = tasks.filter(t => (v.category === 'ALL' || t.category === v.category) && (!v.tag || t.tags.includes(v.tag)));
  return {
    open: inCat.filter(t => !t.completed).sort(bySort[v.sort]),
    done: v.showCompleted ? inCat.filter(t => t.completed).sort((a, b) => b.updatedAt - a.updatedAt) : [],
  };
}

export const MAX_TAG = 20;
/** One tag as written by the user: trimmed, no '#', no commas, at most 20 characters. */
export const cleanTag = (s: string) => s.replace(/[#,]/g, '').trim().slice(0, MAX_TAG);

/** Every tag in use with how many tasks carry it, most used first, then A-Z. */
export function tagCounts(tasks: readonly Pick<Task, 'tags'>[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of tasks) for (const g of new Set(t.tags)) m.set(g, (m.get(g) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
/** Rename a tag everywhere (a name that already exists merges into it); `to` empty = delete. Returns the new list for one task. */
export function retag(tags: readonly string[], from: string, to: string): string[] {
  const next = tags.flatMap(g => (g === from ? (to ? [to] : []) : [g]));
  return [...new Set(next)];
}

export interface QuickPreset { title: string; category: Category; priority: Priority; difficulty: number; tags: string[]; count: number }
/**
 * Quick presets: the tasks you do again and again. Each distinct title you have finished (most often first, up to `max`),
 * with the settings of its latest copy, so a chore can be put back on the list with one tap.
 */
export function quickPresets(tasks: readonly Task[], max = 5): QuickPreset[] {
  const by = new Map<string, { latest: Task; count: number }>();
  for (const t of tasks) {
    const n = t.completionCount ?? (t.completed ? 1 : 0);
    if (n <= 0) continue;
    const key = t.title.trim().toLowerCase(), cur = by.get(key);
    if (!cur) by.set(key, { latest: t, count: n });
    else by.set(key, { latest: t.createdAt > cur.latest.createdAt ? t : cur.latest, count: cur.count + n });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.latest.createdAt - a.latest.createdAt).slice(0, max)
    .map(({ latest: t, count }) => ({ title: t.title, category: t.category, priority: t.priority, difficulty: t.difficulty, tags: t.tags, count }));
}
