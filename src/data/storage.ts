import { CURRENT_VERSION, defaultState, type AppState } from './state';
import { sanitizeCategories, groupsFrom, sanitizeExerciseSave, sanitizeLook, sanitizeMindMaps, sanitizeNotes, sanitizeHabitExtras, sanitizePlanner, sanitizeRockSave, sanitizeSanctuarySave, sanitizeWorlds } from '../domain';

/** Older saves kept one `group` per task or habit; now it is a list `groups` (left out when empty). */
const withGroups = (x: any) => {
  const { group: _g, scheduledTime, ...rest } = x, groups = groupsFrom(x);
  const time = typeof scheduledTime === 'number' && Number.isFinite(scheduledTime) && scheduledTime >= 0 && scheduledTime <= 1439 && x.dueDate != null ? { scheduledTime: Math.round(scheduledTime) } : {};   // a planned time only makes sense with a due date
  return { ...rest, ...time, ...(groups.length ? { groups } : {}) };
};
export const STORAGE_KEY = 'scrypture:state';

/** Minimal key/value interface (localStorage-compatible) so tests can inject a fake. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function browserKV(): KV | null {
  try { const t = '__t'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch { return null; }
}

/** migrations[n] upgrades a state of version n to n+1. */
export const migrations: Record<number, (s: any) => any> = {
  // 1: s => ({ ...s, version: 2, newField: ... })
};

export function migrate(raw: any): any {
  let s = raw;
  let v = Number.isInteger(s?.version) ? s.version : 1;
  while (v < CURRENT_VERSION) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from version ${v}`);
    s = { ...step(s), version: v + 1 };
    v++;
  }
  return s;
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Validate + merge onto defaults so missing/new fields never crash the app. Throws on garbage. */
export function normalize(raw: unknown, now = Date.now()): AppState {
  if (!isObj(raw)) throw new Error('State must be an object');
  if (Number.isInteger(raw.version) && raw.version > CURRENT_VERSION) throw new Error(`State is from a newer app version (${raw.version})`);
  const s = migrate(raw);
  const d = defaultState(now);
  for (const k of ['tasks', 'habits', 'achievements', 'chat'] as const) {
    if (s[k] !== undefined && !Array.isArray(s[k])) throw new Error(`"${k}" must be an array`);
  }
  // keep seeded achievements that the saved state doesn't know yet (e.g. added in a newer release)
  const savedAch: any[] = s.achievements ?? [];
  const achievements = [...savedAch, ...d.achievements.filter(a => !savedAch.some(x => x.id === a.id))];
  return {
    ...d,
    ...s,
    user: { ...d.user, ...(isObj(s.user) ? s.user : {}) },
    stats: { ...d.stats, ...(isObj(s.stats) ? s.stats : {}) },
    bobr: { ...d.bobr, ...(isObj(s.bobr) ? s.bobr : {}) },
    settings: { ...d.settings, ...(isObj(s.settings) ? s.settings : {}), ...sanitizeLook(isObj(s.settings) ? s.settings : undefined),
      // starts in full screen unless the user turned it off (anything else, including old saves, means on)
      fullscreen: !(isObj(s.settings) && s.settings.fullscreen === false),
      // sound volume 0..1, in steps of 0.1 (anything else means the default)
      reduceMotion: isObj(s.settings) && s.settings.reduceMotion === true,
      highContrast: isObj(s.settings) && s.settings.highContrast === true,
      volume: isObj(s.settings) && typeof s.settings.volume === 'number' && s.settings.volume >= 0 && s.settings.volume <= 1 ? Math.round(s.settings.volume * 10) / 10 : d.settings.volume },
    categories: sanitizeCategories(s.categories),
    inventory: isObj(s.inventory) ? s.inventory : {},
    rockGame: sanitizeRockSave(s.rockGame),
    sanctuary: sanitizeSanctuarySave(s.sanctuary),
    mindMaps: sanitizeMindMaps(s.mindMaps),
    notes: sanitizeNotes(s.notes),
    exercise: sanitizeExerciseSave(s.exercise),
    planner: sanitizePlanner(s.planner),
    worlds: sanitizeWorlds(s.worlds),
    tasks: (s.tasks ?? []).map((t: any) => (t && typeof t === 'object' ? { ...withGroups(t), completionCount: t.completionCount ?? (t.completed ? 1 : 0), lastCompletedAt: t.lastCompletedAt ?? (t.completed ? t.updatedAt : undefined) } : t)),
    habits: (s.habits ?? []).map((h: any) => { if (!h || typeof h !== 'object') return h; const { plan: _p, log: _l, ...rest } = withGroups(h); return { ...rest, ...sanitizeHabitExtras(h) }; }), chat: s.chat ?? [], achievements,
    version: CURRENT_VERSION,
  };
}

export function loadState(kv: KV | null, now = Date.now()): AppState {
  if (!kv) return defaultState(now);
  try {
    const txt = kv.getItem(STORAGE_KEY);
    return txt ? normalize(JSON.parse(txt), now) : defaultState(now);
  } catch (e) {
    console.warn('Could not read saved state, starting fresh', e);
    try { const bad = kv.getItem(STORAGE_KEY); if (bad) kv.setItem(`${STORAGE_KEY}:corrupt`, bad); } catch {}
    return defaultState(now);
  }
}

export function saveState(kv: KV | null, state: AppState): boolean {
  if (!kv) return false;
  try { kv.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export const exportJSON = (state: AppState) => JSON.stringify({ app: 'scrypture', exportedAt: new Date().toISOString(), ...state }, null, 2);

export function importJSON(text: string, now = Date.now()): AppState {
  const raw = JSON.parse(text);
  if (isObj(raw)) { delete raw.app; delete raw.exportedAt; }
  return normalize(raw, now);
}
