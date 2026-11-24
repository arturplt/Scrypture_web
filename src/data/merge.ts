import { calculateLevel } from '../domain';
import type { UserStats } from '../domain';
import type { AppState } from './state';

/** Small record of the save at the last sync: which items existed (to tell "deleted" from "never had") and the stats (to add up both sides' progress). */
export interface Snap { ids: Record<string, string[]>; stats: UserStats }

export type Item = { id: string; updatedAt?: number; playedAt?: number; endTime?: number };
export interface Area { key: string; get: (s: AppState) => Item[]; set: (s: AppState, l: any[]) => AppState }
export const AREAS: Area[] = [
  { key: 'tasks', get: s => s.tasks, set: (s, l) => ({ ...s, tasks: l }) },
  { key: 'habits', get: s => s.habits, set: (s, l) => ({ ...s, habits: l }) },
  { key: 'categories', get: s => s.categories, set: (s, l) => ({ ...s, categories: l }) },
  { key: 'notes', get: s => s.notes.list, set: (s, l) => ({ ...s, notes: { ...s.notes, list: l } }) },
  { key: 'mindMaps', get: s => s.mindMaps.list, set: (s, l) => ({ ...s, mindMaps: { ...s.mindMaps, list: l } }) },
  { key: 'workouts', get: s => s.exercise.workouts, set: (s, l) => ({ ...s, exercise: { ...s.exercise, workouts: l } }) },
  { key: 'events', get: s => s.planner.events, set: (s, l) => ({ ...s, planner: { ...s.planner, events: l } }) },
  { key: 'worlds', get: s => s.worlds.list, set: (s, l) => ({ ...s, worlds: { ...s.worlds, list: l } }) },
  { key: 'levels', get: s => s.sanctuary.levels, set: (s, l) => ({ ...s, sanctuary: { ...s.sanctuary, levels: l } }) },
];
const NUMBERS = ['totalExperiencePoints', 'body', 'mind', 'soul', 'totalTasksCompleted'] as const;
export const stampOf = (x: Item) => x.updatedAt ?? x.playedAt ?? x.endTime ?? 0;

export const snapshotOf = (s: AppState): Snap => ({ ids: Object.fromEntries(AREAS.map(a => [a.key, a.get(s).map(x => x.id)])), stats: { ...s.stats } });

/** Union of two lists by id. Same id on both sides: the later edit wins (a tie goes to `prefer`). Missing on one side: kept, unless the last sync had it (then that side deleted it). */
function mergeList(dev: Item[], cl: Item[], was: string[] | undefined, prefer: 'device' | 'cloud'): Item[] {
  const a = new Map(dev.map(x => [x.id, x])), b = new Map(cl.map(x => [x.id, x]));
  const synced = new Set(was ?? []);
  const lead = prefer === 'device' ? dev : cl, rest = prefer === 'device' ? cl : dev;
  const out: Item[] = [];
  for (const x of [...lead, ...rest]) {
    if (out.some(y => y.id === x.id)) continue;
    const mine = a.get(x.id), theirs = b.get(x.id);
    if (mine && theirs) { const sa = stampOf(mine), sb = stampOf(theirs); out.push(sa > sb ? mine : sb > sa ? theirs : prefer === 'device' ? mine : theirs); }
    else if (!synced.has(x.id)) out.push(x);   // new on one side; if the last sync had it, the other side deleted it
  }
  return out;
}

/**
 * The parts of a save that are not lists of items (settings, pet, counters, achievements ...). Progress counters add up what each
 * side earned since the last sync (`statsBase`, or the larger value when there is none), achievements unlock if either side has
 * them, and everything else comes from whichever side changed last.
 */
export function mergeProfile(device: AppState, cloud: AppState, statsBase: UserStats | null, deviceAt: number, cloudAt: number): AppState {
  const prefer = deviceAt > cloudAt ? 'device' : 'cloud';
  const lead = prefer === 'device' ? device : cloud;
  const stats = { ...lead.stats };
  for (const k of NUMBERS) {
    const d = device.stats[k], c = cloud.stats[k], b = statsBase?.[k];
    stats[k] = b === undefined ? Math.max(d, c) : Math.max(0, b + (d - b) + (c - b));
  }
  stats.level = calculateLevel(stats.totalExperiencePoints);

  // unlocked on either side counts, with the earlier unlock time
  const other = new Map((lead === device ? cloud : device).achievements.map(x => [x.id, x]));
  const achievements = lead.achievements.map(x => {
    const y = other.get(x.id);
    if (!y || (!x.unlocked && !y.unlocked)) return x;
    if (!x.unlocked) return y;
    if (!y.unlocked) return x;
    return { ...x, unlockedAt: Math.min(x.unlockedAt ?? Infinity, y.unlockedAt ?? Infinity) };
  });
  const have = new Set(achievements.map(x => x.id));
  for (const x of [...device.achievements, ...cloud.achievements]) if (!have.has(x.id)) { have.add(x.id); achievements.push(x); }

  return { ...lead, stats, achievements, lakesFlown: [...new Set([...device.lakesFlown, ...cloud.lakesFlown])], orbitsReached: Math.max(device.orbitsReached ?? 0, cloud.orbitsReached ?? 0) };
}

/** The shortlist only names open tasks that still exist. */
export const pruneShortlist = (s: AppState): AppState => {
  const ids = new Set(s.tasks.map(t => t.id));
  return s.planner.shortlist.every(id => ids.has(id)) ? s : { ...s, planner: { ...s.planner, shortlist: s.planner.shortlist.filter(id => ids.has(id)) } };
};

/**
 * Combine two whole saves without asking (used once, when an older all-in-one cloud save is moved to per-item rows). Lists merge
 * item by item (later edit wins, deletions stick), the rest as in `mergeProfile`.
 */
export function mergeSaves(device: AppState, cloud: AppState, snap: Snap | null, deviceAt: number, cloudAt: number): AppState {
  const prefer = deviceAt > cloudAt ? 'device' : 'cloud';
  let out = mergeProfile(device, cloud, snap?.stats ?? null, deviceAt, cloudAt);
  for (const a of AREAS) out = a.set(out, mergeList(a.get(device), a.get(cloud), snap?.ids[a.key], prefer));
  return pruneShortlist(out);
}
