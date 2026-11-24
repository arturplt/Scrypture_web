/**
 * Old saves must keep opening. `fixtures/` holds saves frozen in the shapes earlier releases wrote (named `v<version>-<what>.json`); each must load, keep the
 * player's data, and come out the same when loaded again. Raising CURRENT_VERSION needs a migration step and a frozen save of the old version (checked here).
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION } from './state';
import { STORAGE_KEY, backupKey, migrate, migrations, normalize, readSaved, saveState, type KV } from './storage';
import { createStore } from './store';

const files = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fixtures = Object.entries(files).map(([path, data]) => ({ name: path.replace(/^.*\//, ''), version: Number(/\/v(\d+)-/.exec(path)?.[1]), data }));
const memKV = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: k => { delete data[k]; } };
};

describe('old saves', () => {
  it('there is a frozen save for every version up to the current one, and a migration for every step', () => {
    for (let v = 1; v <= CURRENT_VERSION; v++) expect(fixtures.some(f => f.version === v), `fixtures/v${v}-*.json`).toBe(true);
    for (let v = 1; v < CURRENT_VERSION; v++) expect(migrations[v], `migrations[${v}]`).toBeTypeOf('function');
  });
  for (const f of fixtures) {
    it(`${f.name} opens with the player's data, and loading it again changes nothing`, () => {
      const raw = JSON.parse(JSON.stringify(f.data)) as any, st = normalize(raw, 1763400000000);
      expect(st.version).toBe(CURRENT_VERSION);
      expect(st.user.name).toBe(raw.user.name);
      expect(st.tasks.map(t => t.id)).toEqual(raw.tasks.map((t: any) => t.id));
      expect(st.habits.map(h => h.id)).toEqual(raw.habits.map((h: any) => h.id));
      expect(st.stats).toEqual({ ...st.stats, ...raw.stats });
      expect(st.settings.language).toBe(raw.settings.language);
      expect(normalize(JSON.parse(JSON.stringify(st)), 1763400000000)).toEqual(st);
    });
  }
  it('the first release keeps its planner, workouts, mind maps and Bóbr', () => {
    const st = normalize(files['./fixtures/v1-first-release.json'], 1763400000000);
    expect(st.planner.events[0]).toMatchObject({ title: 'Dentist', time: 930 });
    expect(st.planner.shortlist).toEqual(['t2']);
    expect(st.exercise.workouts[0].exercises[0].sets[0].reps).toBe(15);
    expect(st.mindMaps.list[0].nodes[0].label).toBe('Garden');
    expect(st.bobr.feedings).toBe(5);
    expect(st.inventory).toMatchObject({ bcoin: 7, stone: 12 });
  });
  it('a single category becomes a list, and a planned time without a day is dropped', () => {
    const st = normalize(files['./fixtures/v1-single-group.json'], 1763400000000);
    expect(st.tasks[0]).toMatchObject({ groups: ['c1'], scheduledTime: 540 });
    expect(st.tasks[0]).not.toHaveProperty('group');
    expect(st.tasks[1]).not.toHaveProperty('scheduledTime');
    expect(st.habits[0].groups).toEqual(['c1']);
    expect(st.categories.map(c => c.name)).toEqual(['Garden', 'Career']);
  });
});

describe('migrations and saves the app cannot read', () => {
  it('runs each step in order and stamps the version', () => {
    const steps = { 1: (s: any) => ({ ...s, b: s.a * 2 }), 2: (s: any) => ({ ...s, c: s.b + 1 }) };
    expect(migrate({ version: 1, a: 3 }, 3, steps)).toEqual({ version: 3, a: 3, b: 6, c: 7 });
    expect(migrate({ a: 1 }, 2, steps)).toMatchObject({ version: 2, b: 2 });   // no version written = version 1
    expect(() => migrate({ version: 1 }, 3, { 1: (s: any) => s })).toThrow(/No migration from version 2/);
  });
  it('leaves a save from a newer app alone, and the store does not write over it', () => {
    const newer = JSON.stringify({ version: CURRENT_VERSION + 1, user: { name: 'Future' }, tasks: [] });
    const kv = memKV({ [STORAGE_KEY]: newer });
    expect(readSaved(kv).problem).toBe('newer');
    const store = createStore(kv);
    expect(store.isSaveBlocked()).toBe(true);
    store.actions.addTask({ title: 'Here', category: 'MIND', priority: 'LOW', difficulty: 1 });
    expect(store.getState().tasks).toHaveLength(1);   // the app still works in memory
    expect(kv.data[STORAGE_KEY]).toBe(newer);          // but the newer save is untouched
  });
  it('keeps a copy of an unreadable save and starts fresh', () => {
    const kv = memKV({ [STORAGE_KEY]: '{not json' });
    const r = readSaved(kv);
    expect(r.problem).toBe('corrupt');
    expect(kv.data[`${STORAGE_KEY}:corrupt`]).toBe('{not json');
    expect(createStore(kv).isSaveBlocked()).toBe(false);
  });
  it('a current save loads without a problem or a backup', () => {
    const kv = memKV(); saveState(kv, normalize({ version: CURRENT_VERSION, user: { name: 'Now' } }));
    expect(readSaved(kv)).toMatchObject({ problem: null, state: { user: { name: 'Now' } } });
    expect(Object.keys(kv.data).filter(k => k.startsWith(`${STORAGE_KEY}:v`))).toEqual([]);
    expect(backupKey(1)).toBe(`${STORAGE_KEY}:v1`);
  });
});
