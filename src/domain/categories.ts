import { NODE_THEMES } from './mindmap';
import type { Habit, Task } from './types';

/**
 * Your own task categories (Career, Home, Garden...): a name and a frame colour for the task cards. They only group tasks;
 * the stat a task trains is still chosen by its Body / Mind / Soul category and attributes.
 */
export interface CustomCategory { id: string; name: string; frame: string }
export const MAX_CATEGORIES = 12, MAX_CATEGORY_NAME = 16;
/** The frames a category can use: the same set as mind-map boxes. */
export const CATEGORY_FRAMES: readonly string[] = NODE_THEMES;
export const DEFAULT_CATEGORY_FRAME = 'blue';

export const cleanCategoryName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_NAME);
export const isCategoryFrame = (f: unknown): f is string => typeof f === 'string' && CATEGORY_FRAMES.includes(f);

/** Saved categories, checked: junk and duplicates dropped, a bad frame replaced, at most MAX_CATEGORIES. */
export function sanitizeCategories(raw: unknown): CustomCategory[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>(), names = new Set<string>(), out: CustomCategory[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
    const name = cleanCategoryName(c.name), key = name.toLowerCase();
    if (!name || ids.has(c.id) || names.has(key) || out.length >= MAX_CATEGORIES) continue;
    ids.add(c.id); names.add(key);
    out.push({ id: c.id, name, frame: isCategoryFrame(c.frame) ? c.frame : DEFAULT_CATEGORY_FRAME });
  }
  return out;
}

/** Is this name free (ignoring case), apart from the category `except`? */
export const categoryNameFree = (list: readonly CustomCategory[], name: string, except?: string) =>
  !!cleanCategoryName(name) && !list.some(c => c.id !== except && c.name.toLowerCase() === cleanCategoryName(name).toLowerCase());

/** How many tasks and habits each category holds, in list order. */
export const categoryCounts = (list: readonly CustomCategory[], tasks: readonly Pick<Task, 'group'>[], habits: readonly Pick<Habit, 'group'>[] = []) =>
  list.map(c => ({ ...c, count: tasks.filter(t => t.group === c.id).length + habits.filter(h => h.group === c.id).length }));
