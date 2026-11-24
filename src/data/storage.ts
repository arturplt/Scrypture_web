import { CURRENT_VERSION, defaultState, type AppState, type ChatMessage } from './state';
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

/**
 * migrations[n] upgrades a state of version n to n+1. Most new fields need none: `normalize` fills them with defaults. Bump CURRENT_VERSION only for a change
 * that cannot be defaulted (a field renamed or reshaped), and then add the step here and a frozen save of the old version to `fixtures/` (the tests insist on both).
 * Before bumping, read the note on `readSaved`: an older copy of the app must already know to leave a newer save alone.
 */
export const migrations: Record<number, (s: any) => any> = {
  // 1: s => ({ ...s, newField: ... })
};

/** The version a raw save says it is (saves from before versions were written count as 1). */
export const versionOf = (raw: unknown): number => (isObj(raw) && Number.isInteger(raw.version) ? raw.version : 1);

export function migrate(raw: any, to = CURRENT_VERSION, steps = migrations): any {
  let s = raw, v = versionOf(raw);
  while (v < to) {
    const step = steps[v];
    if (!step) throw new Error(`No migration from version ${v}`);
    s = { ...step(s), version: v + 1 };
    v++;
  }
  return s;
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** How many chat messages are kept between visits (the newest), and how long one may be. */
export const CHAT_KEEP = 100, CHAT_TEXT_MAX = 2000;
/** The saved conversation with Bóbr: valid messages only, the newest CHAT_KEEP. */
export function sanitizeChat(raw: unknown): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!isObj(m) || typeof m.id !== 'string' || typeof m.text !== 'string' || typeof m.at !== 'number' || !Number.isFinite(m.at)) continue;
    out.push({ id: m.id, type: m.type === 'QUICK_ACTION' || m.type === 'SYSTEM' ? m.type : 'NORMAL', fromBobr: m.fromBobr === true, text: m.text.slice(0, CHAT_TEXT_MAX), at: m.at });
  }
  return out.slice(-CHAT_KEEP);
}

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
  const worlds = sanitizeWorlds(s.worlds);
  // the lifetime orbit count; a save from before it existed starts from the orbits its worlds remember
  const orbitsReached = Number.isInteger(s.orbitsReached) && s.orbitsReached >= 0 ? Math.min(s.orbitsReached, 1e6) : worlds.list.reduce((n, w) => n + (w.orbit?.reached ?? 0), 0);
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
      haptics: !(isObj(s.settings) && s.settings.haptics === false),
      volume: isObj(s.settings) && typeof s.settings.volume === 'number' && s.settings.volume >= 0 && s.settings.volume <= 1 ? Math.round(s.settings.volume * 10) / 10 : d.settings.volume },
    categories: sanitizeCategories(s.categories),
    inventory: isObj(s.inventory) ? s.inventory : {},
    rockGame: sanitizeRockSave(s.rockGame),
    lakesFlown: Array.isArray(s.lakesFlown) ? [...new Set<string>(s.lakesFlown.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 60))].slice(0, 100) : [],
    sanctuary: sanitizeSanctuarySave(s.sanctuary),
    mindMaps: sanitizeMindMaps(s.mindMaps),
    notes: sanitizeNotes(s.notes),
    exercise: sanitizeExerciseSave(s.exercise),
    planner: sanitizePlanner(s.planner),
    worlds,
    orbitsReached,
    tasks: (s.tasks ?? []).map((t: any) => (t && typeof t === 'object' ? { ...withGroups(t), completionCount: t.completionCount ?? (t.completed ? 1 : 0), lastCompletedAt: t.lastCompletedAt ?? (t.completed ? t.updatedAt : undefined) } : t)),
    habits: (s.habits ?? []).map((h: any) => { if (!h || typeof h !== 'object') return h; const { plan: _p, log: _l, target: _t, ...rest } = withGroups(h); return { ...rest, ...sanitizeHabitExtras(h) }; }), chat: sanitizeChat(s.chat), achievements,
    version: CURRENT_VERSION,
  };
}

/** Why the saved state could not be used: written by a newer version of the app, or unreadable. */
export type LoadProblem = 'newer' | 'corrupt';
/** Where a save from an older version is kept, untouched, before it is migrated (once per version, so a bad migration can be undone by hand). */
export const backupKey = (version: number) => `${STORAGE_KEY}:v${version}`;

/**
 * The saved state, and what was wrong with it if it could not be used (then the defaults are returned).
 * - `newer`: another copy of the app (a newer one in another tab, or after an update) wrote a version this one does not know. The save is left exactly as it is, and the caller must
 *   not save over it (the store stops saving until a reload brings the newer app). This guard has to ship before CURRENT_VERSION is ever raised: an older app without it would start
 *   fresh and write its empty state over the newer save.
 * - `corrupt`: not JSON, or not a state at all. A copy is kept under `:corrupt` and the app starts fresh, since it could not run on it anyway.
 */
export function readSaved(kv: KV | null, now = Date.now()): { state: AppState; problem: LoadProblem | null } {
  const fresh = (problem: LoadProblem | null) => ({ state: defaultState(now), problem });
  if (!kv) return fresh(null);
  let txt: string | null;
  try { txt = kv.getItem(STORAGE_KEY); } catch { return fresh(null); }
  if (!txt) return fresh(null);
  try {
    const raw = JSON.parse(txt), v = versionOf(raw);
    if (v > CURRENT_VERSION) { console.warn(`Saved state is from a newer app version (${v}); leaving it alone`); return fresh('newer'); }
    if (v < CURRENT_VERSION) { try { if (kv.getItem(backupKey(v)) === null) kv.setItem(backupKey(v), txt); } catch { /* no room for a backup: migrate anyway */ } }
    return { state: normalize(raw, now), problem: null };
  } catch (e) {
    console.warn('Could not read saved state, starting fresh', e);
    try { kv.setItem(`${STORAGE_KEY}:corrupt`, txt); } catch {}
    return fresh('corrupt');
  }
}
export const loadState = (kv: KV | null, now = Date.now()): AppState => readSaved(kv, now).state;

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
