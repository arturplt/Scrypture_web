import { describe, expect, it } from 'vitest';
import { DICTIONARIES } from '../i18n';
import {
  DIFFICULTY_MINUTES, DIFFICULTY_PRIORITY, FREQUENCY, PERIODS, PERIOD_RANGE, STARTER_HABITS, STARTER_TASKS, STAT_ORDER, benchmarkFor, benchmarkXP, difficultyForMinutes, starterTaskInput, fmtMinutes, isHabitAdded, isTaskAdded, nextStarter,
  starterHabitsFor, starterTasksFor, timesDone, type StarterTask,
} from './index';

const title = (s: StarterTask) => DICTIONARIES.EN[s.title];

describe('Start Here catalogue', () => {
  it('keeps Android\'s 44 tasks and the 19 starters of the old web app under their old ids, plus 32 new ones, all unique', () => {
    expect(STARTER_TASKS).toHaveLength(95);
    expect(STARTER_TASKS.filter(t => t.id.startsWith('and:'))).toHaveLength(44);
    expect(STARTER_TASKS.filter(t => t.id.startsWith('old:'))).toHaveLength(19);
    expect(STARTER_TASKS.filter(t => t.id.startsWith('new:'))).toHaveLength(32);
    expect(new Set(STARTER_TASKS.map(t => t.id)).size).toBe(95);
    for (const id of ['and:Read1Page', 'and:20Pushups', 'old:makeBed', 'old:visitPlace']) expect(STARTER_TASKS.some(t => t.id === id), id).toBe(true);
  });
  it('the scale: every stat has at least two suggestions on every difficulty 0-9', () => {
    for (const s of STAT_ORDER) for (let d = 0; d <= 9; d++) {
      expect(STARTER_TASKS.filter(t => t.stat === s && t.difficulty === d).length, `${s} D${d}`).toBeGreaterThanOrEqual(2);
      expect(benchmarkFor(d, s)).toMatchObject({ stat: s, difficulty: d });
    }
  });
  it('difficulty follows the time a task takes (one step up or down for effort), priority follows difficulty', () => {
    expect([1, 2, 3, 15, 16, 60, 61, 480, 2400, 2401, 99999].map(difficultyForMinutes)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 8, 9, 9]);
    for (const t of STARTER_TASKS) {
      expect(t.difficulty, t.id).toBe(difficultyForMinutes(t.minutes) + t.effort);
      expect(t.priority, t.id).toBe(DIFFICULTY_PRIORITY[t.difficulty]);
      expect(t.minutes, t.id).toBeLessThanOrEqual(DIFFICULTY_MINUTES[9]);
    }
  });
  it('XP climbs with every step of the scale, from 5 to 75', () => {
    const xp = Array.from({ length: 10 }, (_, d) => benchmarkXP(d));
    expect(xp).toEqual([5, 6, 12, 13, 15, 23, 28, 36, 54, 75]);
    for (let d = 1; d <= 9; d++) expect(xp[d]).toBeGreaterThan(xp[d - 1]);
  });
  it('each period keeps to its range and covers all of it for every stat', () => {
    for (const p of PERIODS) for (const s of STAT_ORDER) {
      const [lo, hi] = PERIOD_RANGE[p], have = new Set(starterTasksFor(p, s).map(t => t.difficulty));
      for (let d = lo; d <= hi; d++) expect(have.has(d), `${p} ${s} D${d}`).toBe(true);
      expect(Math.min(...have), `${p} ${s}`).toBeGreaterThanOrEqual(lo); expect(Math.max(...have), `${p} ${s}`).toBeLessThanOrEqual(hi);
    }
  });
  it('a suggestion becomes a task with its own difficulty, priority and time', () => {
    const s = STARTER_TASKS.find(t => t.id === 'new:dayHike')!;
    expect(starterTaskInput(s, k => DICTIONARIES.EN[k])).toEqual({ title: 'Go on a day hike', description: DICTIONARIES.EN[s.desc], category: 'BODY', priority: 'HIGH', difficulty: 6, estimatedDuration: 300, origin: 'new:dayHike' });
  });
  it('every title, description and habit name exists in English, Latin and Polish', () => {
    for (const lang of ['EN', 'LA', 'PL'] as const) {
      for (const t of STARTER_TASKS) for (const k of [t.title, t.desc]) expect((DICTIONARIES[lang] as Record<string, string>)[k], `${lang} ${k}`).toBeTruthy();
      for (const h of STARTER_HABITS) expect((DICTIONARIES[lang] as Record<string, string>)[h.name], `${lang} ${h.name}`).toBeTruthy();
    }
  });
  it('values are sane', () => {
    for (const t of STARTER_TASKS) {
      expect(t.difficulty).toBeGreaterThanOrEqual(0); expect(t.difficulty).toBeLessThanOrEqual(9);
      expect(t.minutes).toBeGreaterThan(0);
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(t.priority);
    }
  });
  it('every period has suggestions for Body, Mind and Soul, and Daily has gentle first steps for each', () => {
    for (const p of PERIODS) for (const s of STAT_ORDER) expect(starterTasksFor(p, s).length, `${p} ${s}`).toBeGreaterThanOrEqual(3);
    for (const s of STAT_ORDER) expect(starterTasksFor('daily', s).filter(t => t.difficulty <= 1).length, `daily ${s}`).toBeGreaterThanOrEqual(3);
  });
  it('lists are easiest first', () => {
    for (const p of PERIODS) for (const s of STAT_ORDER) {
      const d = starterTasksFor(p, s).map(t => t.difficulty);
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
    expect(starterTasksFor('daily', 'BODY')[0].difficulty).toBe(0);
  });
  it('habits: every period and stat has a light, a steady and a big one (lightest first), unique ids and names per stat', () => {
    expect(STARTER_HABITS).toHaveLength(38);
    expect(new Set(STARTER_HABITS.map(h => h.id)).size).toBe(38);
    expect(new Set(STARTER_HABITS.map(h => h.name)).size).toBe(38);   // no name twice (Monthly Review used to be under both Mind and Soul)
    for (const p of PERIODS) for (const s of STAT_ORDER) {
      const e = starterHabitsFor(p, s).map(h => h.effort);
      expect(e.length, `${p} ${s}`).toBeGreaterThanOrEqual(4);
      expect(e).toEqual([...e].sort()); expect(new Set(e)).toEqual(new Set([1, 2, 3]));
    }
    expect(PERIODS.map(p => FREQUENCY[p])).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
  });
});

describe('added / done / next', () => {
  const list = starterTasksFor('daily', 'BODY');
  const first = list[0], second = list[1];
  const T = (o: object) => ({ title: 'x', completed: false, ...o }) as never;

  it('added = an open task from it exists, by origin or by title (any case)', () => {
    expect(isTaskAdded(first.id, title(first), [])).toBe(false);
    expect(isTaskAdded(first.id, title(first), [T({ origin: first.id, title: 'translated differently' })])).toBe(true);   // survives a language change
    expect(isTaskAdded(first.id, title(first), [T({ title: `  ${title(first).toUpperCase()} ` })])).toBe(true);           // typed by hand
    expect(isTaskAdded(first.id, title(first), [T({ origin: first.id, completed: true })])).toBe(false);                  // finished ones can be added again
    expect(isTaskAdded(first.id, title(first), [T({ origin: second.id })])).toBe(false);
  });
  it('habits count as added by origin or name', () => {
    expect(isHabitAdded('h1', 'Read Daily', [{ title: 'read daily' }] as never)).toBe(true);
    expect(isHabitAdded('h1', 'Read Daily', [{ origin: 'h1', title: 'Czytaj codziennie' }] as never)).toBe(true);
    expect(isHabitAdded('h1', 'Read Daily', [{ title: 'other' }] as never)).toBe(false);
  });
  it('times done sums the completion counts of tasks from that suggestion', () => {
    expect(timesDone('a', [T({ origin: 'a', completionCount: 2 }), T({ origin: 'a', completed: true }), T({ origin: 'b', completionCount: 9 })])).toBe(3);
    expect(timesDone('a', [])).toBe(0);
  });
  it('next step climbs the ladder: easiest not added and never done; falls back once everything was done', () => {
    const titleOf = (s: StarterTask) => title(s);
    expect(nextStarter(list, titleOf, [])?.id).toBe(first.id);
    expect(nextStarter(list, titleOf, [T({ origin: first.id })])?.id).toBe(second.id);                                   // first is on the list
    expect(nextStarter(list, titleOf, [T({ origin: first.id, completed: true, completionCount: 1 })])?.id).toBe(second.id); // first was done, so move on
    const allDone = list.map(s => T({ origin: s.id, completed: true, completionCount: 1 }));
    expect(nextStarter(list, titleOf, allDone)?.id).toBe(first.id);                                                       // all done once: start the ladder again
    const allOpen = list.map(s => T({ origin: s.id }));
    expect(nextStarter(list, titleOf, allOpen)).toBeUndefined();                                                          // everything is already on the list
  });
  it('formats minutes', () => {
    expect([1, 5, 59, 60, 150, 1800].map(fmtMinutes)).toEqual(['1m', '5m', '59m', '1h', '2h 30m', '30h']);
  });
});
