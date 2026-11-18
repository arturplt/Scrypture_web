import { describe, expect, it } from 'vitest';
import { createStore } from './store';
import { STORAGE_KEY, exportJSON, importJSON, loadState, normalize, type KV } from './storage';
import { CURRENT_VERSION } from './state';

const memKV = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) };
};
let n = 0;
const make = (kv = memKV(), t = { now: new Date(2026, 0, 1, 12).getTime() }) =>
  ({ kv, t, s: createStore(kv, () => t.now, () => `id${++n}`) });
const day = (d: number) => new Date(2026, 0, d, 12).getTime();

describe('tasks', () => {
  it('add computes xp + stat rewards', () => {
    const { s } = make();
    const t = s.actions.addTask({ title: ' Run ', category: 'BODY', priority: 'MEDIUM', difficulty: 3, coreAttributes: ['SOUL'] });
    expect(t).toMatchObject({ title: 'Run', experienceReward: 13, statRewards: { body: 1, mind: 0, soul: 1 } });
  });
  it('complete pays once, levels up, unlocks first_task', () => {
    const { s } = make();
    const t = s.actions.addTask({ title: 'Big', category: 'MIND', priority: 'CRITICAL', difficulty: 9 }); // 75xp
    s.actions.completeTask(t.id);
    s.actions.completeTask(t.id); // idempotent
    const st = s.getState();
    expect(st.stats).toMatchObject({ totalExperiencePoints: 75, mind: 1, totalTasksCompleted: 1, level: 1 });
    expect(st.achievements.find(a => a.id === 'first_task')!.unlocked).toBe(true);
    expect(s.getEvents().map(e => e.type)).toEqual(['taskComplete', 'achievement']);
    const t2 = s.actions.addTask({ title: 'More', category: 'MIND', priority: 'LOW', difficulty: 9 }); // 60 -> 135xp
    s.actions.completeTask(t2.id);
    expect(s.getState().stats.level).toBe(2);
    expect(s.getEvents().some(e => e.type === 'levelUp')).toBe(true);
  });
  it('completed tasks are frozen; delete works', () => {
    const { s } = make();
    const t = s.actions.addTask({ title: 'a', category: 'BODY', priority: 'LOW', difficulty: 0 });
    s.actions.completeTask(t.id);
    s.actions.updateTask(t.id, { title: 'changed' });
    expect(s.getState().tasks[0].title).toBe('a');
    s.actions.deleteTask(t.id);
    expect(s.getState().tasks).toHaveLength(0);
  });
  it('update recomputes xp', () => {
    const { s } = make();
    const t = s.actions.addTask({ title: 'a', category: 'BODY', priority: 'LOW', difficulty: 0 });
    s.actions.updateTask(t.id, { priority: 'HIGH', difficulty: 5 });
    expect(s.getState().tasks[0].experienceReward).toBe(23);
  });
});

describe('habits', () => {
  it('one completion per day, streak over days, achievement at 7', () => {
    const { s, t } = make();
    const h = s.actions.addHabit({ title: 'Read', category: 'MIND', frequency: 'DAILY' });
    for (let d = 1; d <= 7; d++) { t.now = day(d); s.actions.completeHabit(h.id); s.actions.completeHabit(h.id); }
    expect(s.getState().habits[0]).toMatchObject({ streak: 7, bestStreak: 7 });
    expect(s.getState().achievements.find(a => a.id === 'streak_7')!.unlocked).toBe(true);
    t.now = day(10); s.actions.completeHabit(h.id);
    expect(s.getState().habits[0]).toMatchObject({ streak: 1, bestStreak: 7 });
  });
});

describe('persistence', () => {
  it('survives reload', () => {
    const { kv, s } = make();
    s.actions.addTask({ title: 'keep', category: 'SOUL', priority: 'LOW', difficulty: 1 });
    s.actions.setUser({ name: 'Bóbr fan', onboarded: true });
    const again = createStore(kv, Date.now, () => 'x');
    expect(again.getState().tasks[0].title).toBe('keep');
    expect(again.getState().user).toMatchObject({ name: 'Bóbr fan', onboarded: true });
  });
  it('subscribers are notified', () => {
    const { s } = make(); let calls = 0; const off = s.subscribe(() => calls++);
    s.actions.addItem('bcoin', 2); off(); s.actions.addItem('bcoin');
    expect(calls).toBe(1);
    expect(s.getState().inventory.bcoin).toBe(3);
  });
  it('export -> import round-trips', () => {
    const { s } = make();
    const t = s.actions.addTask({ title: 'x', category: 'BODY', priority: 'HIGH', difficulty: 4 });
    s.actions.completeTask(t.id);
    const json = s.actions.exportData();
    const other = make().s;
    other.actions.importData(json);
    expect(other.getState()).toEqual(s.getState());
  });
  it('resetAll wipes', () => {
    const { s } = make();
    s.actions.addTask({ title: 'x', category: 'BODY', priority: 'LOW', difficulty: 0 });
    s.actions.resetAll();
    expect(s.getState().tasks).toHaveLength(0);
  });
  it('corrupt storage falls back to defaults and keeps a backup', () => {
    const kv = memKV(); kv.setItem(STORAGE_KEY, '{not json');
    expect(loadState(kv).tasks).toEqual([]);
    expect(kv.getItem(`${STORAGE_KEY}:corrupt`)).toBe('{not json');
  });
  it('works without storage (private mode)', () => {
    const s = createStore(null, Date.now, () => 'z');
    s.actions.addTask({ title: 'x', category: 'BODY', priority: 'LOW', difficulty: 0 });
    expect(s.getState().tasks).toHaveLength(1);
  });
  it('normalize fills missing fields, adds new seeded achievements, rejects bad input', () => {
    const st = normalize({ version: 1, tasks: [], achievements: [{ id: 'first_task', unlocked: true }] });
    expect(st.stats.level).toBe(1);
    expect(st.achievements).toHaveLength(25);
    expect(st.achievements[0].unlocked).toBe(true);
    expect(() => normalize({ tasks: 'nope' })).toThrow();
    expect(() => normalize({ version: CURRENT_VERSION + 1 })).toThrow(/newer/);
    expect(() => importJSON('[]')).toThrow();
  });
  it('export json has app marker and is re-importable', () => {
    const { s } = make();
    expect(JSON.parse(exportJSON(s.getState())).app).toBe('scrypture');
  });
});

import { cleanTag, quickPresets, tagCounts, viewTasks } from '../domain';
import { BERRY_TREAT_MS, HUNGER_FULL_MS, SHORTLIST_MAX, emotionNow, habitSlot, tradeFor } from '../domain';
describe('bobr life', () => {
  it('feeding needs hunger and hay; resets hunger, refills happiness', () => {
    const { s, t } = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    expect(s.actions.feedBobr()).toBe(false);          // not hungry
    t.now += HUNGER_FULL_MS;
    expect(s.actions.feedBobr()).toBe(false);          // hungry, no hay
    s.actions.collectItem('hay');
    expect(s.actions.feedBobr()).toBe(true);
    expect(s.getState().inventory.hay).toBe(0);
    expect(s.getState().bobr).toMatchObject({ lastInteraction: t.now, happiness: 1, feedings: 1 });
    expect(s.actions.feedBobr()).toBe(false);          // no longer hungry
  });
  it('a berry is a treat: taken any time, resets hunger, refills happiness and excites him for a minute', () => {
    const { s, t } = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    expect(s.actions.feedBerry()).toBe(false);         // no berry
    s.actions.addItem('berry', 2);
    s.actions.setBobr({ happiness: 0.4, happinessAt: t.now });
    expect(s.actions.feedBerry()).toBe(true);          // not hungry, still takes it
    expect(s.getState().inventory.berry).toBe(1);
    expect(s.getState().bobr).toMatchObject({ lastInteraction: t.now, happiness: 1, feedings: 1, treatUntil: t.now + BERRY_TREAT_MS });
    expect(emotionNow(s.getState().bobr, t.now + 1000)).toBe('EXCITED');
    expect(emotionNow(s.getState().bobr, t.now + BERRY_TREAT_MS)).not.toBe('EXCITED');
    t.now += HUNGER_FULL_MS;
    expect(emotionNow(s.getState().bobr, t.now)).toBe('HUNGRY');
    expect(s.actions.feedBerry()).toBe(true);          // feeds a hungry Bóbr too
    expect(emotionNow(s.getState().bobr, t.now)).toBe('EXCITED');
    expect(s.actions.feedBerry()).toBe(false);         // the bag is empty
  });
  it('trade swaps one item for another and lifts happiness', () => {
    const { s, t } = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    const offer = tradeFor(t.now);
    expect(s.actions.trade()).toBe(false);             // nothing to give
    s.actions.addItem(offer.request, 2);
    s.actions.setBobr({ happiness: 0.5, happinessAt: t.now });
    expect(s.actions.trade()).toBe(true);
    const inv = s.getState().inventory;
    expect(inv[offer.request]).toBe(1);
    expect(inv[offer.offer]).toBe(1);
    expect(s.getState().bobr.happiness).toBeCloseTo(0.7);
  });
  it('refuses to trade when hungry', () => {
    const { s, t } = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    s.actions.addItem(tradeFor(t.now).request, 1);
    t.now += HUNGER_FULL_MS;
    expect(s.actions.trade()).toBe(false);
  });
});

describe('settings migration', () => {
  it('old saves without look settings get defaults; bad values are cleaned', () => {
    const old = normalize({ version: 1, settings: { frameTheme: 'gold', language: 'PL' } });
    expect(old.settings).toMatchObject({ frameTheme: 'gold', language: 'PL', textScale: 1, uiScale: 0, frameEdges: 'random', buttonSize: 'compact', frameCenter: 'clean', nav: { items: ['home', 'tasks', 'habits'], active: 'outline' }, chips: 'wood', elements: { tick: 'classic', task: 'app' }, buttons: { primary: 'button_green' }, bars: { hunger: 'boxes_red' } });
    const bad = normalize({ version: 1, settings: { textScale: 99, uiScale: 5, bars: { xp: 'seg_gold' } } });
    expect(bad.settings).toMatchObject({ textScale: 1, uiScale: 0, bars: { xp: 'seg_gold', hunger: 'boxes_red' } });
  });
});

describe('unticking and completing again', () => {
  const setup = () => {
    const ctx = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    const task = ctx.s.actions.addTask({ title: 'Run', category: 'BODY', priority: 'MEDIUM', difficulty: 3 }); // 13 xp, +1 body
    return { ...ctx, id: task.id };
  };
  const stats = (s: ReturnType<typeof make>['s']) => s.getState().stats;

  it('unticking within 10 s was a mistake: rewards are taken back and the task is open again', () => {
    const { s, t, id } = setup();
    s.actions.completeTask(id);
    expect(stats(s)).toMatchObject({ totalExperiencePoints: 13, body: 1, totalTasksCompleted: 1 });
    t.now += 10_000;
    expect(s.actions.uncompleteTask(id)).toBe(true);
    expect(stats(s)).toMatchObject({ totalExperiencePoints: 0, body: 0, totalTasksCompleted: 0, level: 1 });
    expect(s.getState().tasks[0]).toMatchObject({ completed: false, completionCount: 0 });
  });
  it('...and it can be completed again, paying again', () => {
    const { s, t, id } = setup();
    s.actions.completeTask(id); t.now += 3000; s.actions.uncompleteTask(id); t.now += 1000;
    s.actions.completeTask(id);
    expect(stats(s)).toMatchObject({ totalExperiencePoints: 13, body: 1, totalTasksCompleted: 1 });   // not doubled: the first payment was refunded
    expect(s.getState().tasks[0]).toMatchObject({ completed: true, completionCount: 1 });
  });
  it('unticking later just resets the task and keeps the rewards; completing again pays again', () => {
    const { s, t, id } = setup();
    s.actions.completeTask(id);
    t.now += 10_001;
    expect(s.actions.uncompleteTask(id)).toBe(false);
    expect(stats(s)).toMatchObject({ totalExperiencePoints: 13, totalTasksCompleted: 1 });
    expect(s.getState().tasks[0]).toMatchObject({ completed: false, completionCount: 1 });
    t.now += 86_400_000;
    s.actions.completeTask(id);
    expect(stats(s)).toMatchObject({ totalExperiencePoints: 26, body: 2, totalTasksCompleted: 2 });
    expect(s.getState().tasks[0]).toMatchObject({ completed: true, completionCount: 2 });
  });
  it('rapid tick/untick cannot farm xp', () => {
    const { s, t, id } = setup();
    for (let i = 0; i < 20; i++) { s.actions.completeTask(id); t.now += 500; s.actions.uncompleteTask(id); t.now += 500; }
    expect(stats(s).totalExperiencePoints).toBe(0);
    expect(stats(s).totalTasksCompleted).toBe(0);
  });
  it('a refund can lower the level, and re-completing raises it again with the level-up event', () => {
    const { s, t } = setup();
    const big = s.actions.addTask({ title: 'Big', category: 'MIND', priority: 'CRITICAL', difficulty: 9 }); // 75 xp
    const big2 = s.actions.addTask({ title: 'Big2', category: 'MIND', priority: 'CRITICAL', difficulty: 9 });
    s.actions.completeTask(big.id); t.now += 20_000; s.actions.completeTask(big2.id);   // 150 xp -> level 2
    expect(stats(s).level).toBe(2);
    s.actions.uncompleteTask(big2.id);                                                  // refund -> 75 xp -> level 1
    expect(stats(s)).toMatchObject({ level: 1, totalExperiencePoints: 75 });
    while (s.getEvents().length) s.actions.dismissEvent();
    s.actions.completeTask(big2.id);
    expect(s.getEvents().map(e => e.type)).toContain('levelUp');
  });
  it('unlocked achievements are never taken away by a refund', () => {
    const { s, id } = setup();
    s.actions.completeTask(id);
    expect(s.getState().achievements.find(a => a.id === 'first_task')!.unlocked).toBe(true);
    s.actions.uncompleteTask(id);
    expect(s.getState().achievements.find(a => a.id === 'first_task')!.unlocked).toBe(true);
  });
  it('the undo offer lasts 10 s, is cleared by unticking, and only the last completion is offered', () => {
    const { s, t, id } = setup();
    expect(s.getUndo()).toBeNull();
    s.actions.completeTask(id);
    expect(s.getUndo()).toEqual({ taskId: id, until: t.now + 10_000 });
    s.actions.uncompleteTask(id);
    expect(s.getUndo()).toBeNull();
    const other = s.actions.addTask({ title: 'B', category: 'SOUL', priority: 'LOW', difficulty: 0 });
    s.actions.completeTask(id); s.actions.completeTask(other.id);
    expect(s.getUndo()).toMatchObject({ taskId: other.id });
    s.actions.dismissUndo();
    expect(s.getUndo()).toBeNull();
  });
  it('a habit completion can be undone within 10 s, restoring its streak, and not after', () => {
    const { s, t } = setup();
    const h = s.actions.addHabit({ title: 'Stretch', category: 'BODY', frequency: 'DAILY' });
    s.actions.completeHabit(h.id);
    expect(s.getState().habits[0].streak).toBe(1);
    expect(s.getUndo()).toMatchObject({ habitId: h.id, until: t.now + 10_000 });
    expect(s.actions.undoHabit(h.id)).toBe(true);
    expect(s.getState().habits[0]).toMatchObject({ streak: 0, lastCompleted: null });
    expect(s.getUndo()).toBeNull();
    s.actions.completeHabit(h.id);
    t.now += 10_001;
    expect(s.actions.undoHabit(h.id)).toBe(false);
    expect(s.getState().habits[0].streak).toBe(1);
  });
  it('unticking something that is not completed does nothing', () => {
    const { s, id } = setup();
    expect(s.actions.uncompleteTask(id)).toBe(false);
    expect(s.actions.uncompleteTask('nope')).toBe(false);
    expect(stats(s).totalExperiencePoints).toBe(0);
  });
  it('an edited task refunds what it actually paid, not its new reward', () => {
    const { s, t, id } = setup();
    s.actions.completeTask(id);                          // paid 13
    s.actions.uncompleteTask(id);                        // refunded (window)
    s.actions.completeTask(id); t.now += 11_000;         // paid 13 again
    s.actions.uncompleteTask(id);                        // outside window: keeps
    s.actions.updateTask(id, { priority: 'CRITICAL', difficulty: 9 });   // now worth 75
    s.actions.completeTask(id);                          // pays 75
    t.now += 2000;
    s.actions.uncompleteTask(id);                        // refund exactly 75
    expect(stats(s).totalExperiencePoints).toBe(13);
  });
  it('old saves: completed tasks without counters count as completed once', () => {
    const st = normalize({ version: 1, tasks: [{ id: 'a', completed: true, updatedAt: 5 }, { id: 'b', completed: false }] });
    expect(st.tasks[0]).toMatchObject({ completionCount: 1, lastCompletedAt: 5 });
    expect(st.tasks[1]).toMatchObject({ completionCount: 0 });
    expect(canRefundOld(st.tasks[0], 6)).toBe(false);       // no reward record -> nothing to refund, task simply resets
  });
});
import { canRefund as canRefundOld } from '../domain';

describe('origin of suggestions', () => {
  it('tasks and habits remember where they came from, and it survives export/import', () => {
    const { s } = make();
    s.actions.addTask({ title: 'Make your bed', category: 'BODY', priority: 'LOW', difficulty: 0, origin: 'old:makeBed' });
    s.actions.addHabit({ title: 'Read Daily', category: 'MIND', frequency: 'DAILY', origin: 'habit:daily:MIND:readDaily' });
    expect(s.getState().tasks[0].origin).toBe('old:makeBed');
    const other = make().s; other.actions.importData(s.actions.exportData());
    expect(other.getState().tasks[0].origin).toBe('old:makeBed');
    expect(other.getState().habits[0].origin).toBe('habit:daily:MIND:readDaily');
  });
});

describe('full screen preference', () => {
  it('defaults to on, also for old saves, and is off only when explicitly false', () => {
    expect(normalize({ version: 1 }).settings.fullscreen).toBe(true);
    expect(normalize({ version: 1, settings: { frameTheme: 'gold' } }).settings.fullscreen).toBe(true);
    expect(normalize({ version: 1, settings: { fullscreen: false } }).settings.fullscreen).toBe(false);
    expect(normalize({ version: 1, settings: { fullscreen: 'no' } }).settings.fullscreen).toBe(true);     // garbage = default
    expect(normalize({ version: 1, settings: { fullscreen: true } }).settings.fullscreen).toBe(true);
  });
  it('survives export/import', () => {
    const { s } = make(); s.actions.setSettings({ fullscreen: false });
    const other = make().s; other.actions.importData(s.actions.exportData());
    expect(other.getState().settings.fullscreen).toBe(false);
  });
});

describe('rock throwing results', () => {
  const result = (over: object = {}) => ({ mode: 'ARCADE' as const, score: 1200, level: 5, targetsHit: 20, throws: 18, longestCombo: 4, bullseyes: 2, fastLevel: false, perfectLevel: false, farHit: false, ...over });

  it('pays xp, stat points and drops, saves the game and flags a new high score', () => {
    const { s } = make();
    const r = s.actions.finishRockGame(result());
    expect(r.newHighScore).toBe(true);
    expect(r.rewards).toMatchObject({ xp: 120 + 50 + 40, body: 9, mind: 7, soul: 7, items: ['bcoin', 'stone', 'hay', 'stick'] });
    const st = s.getState();
    expect(st.stats.totalExperiencePoints).toBe(210);
    expect(st.stats).toMatchObject({ body: 9, mind: 7, soul: 7 });
    expect(st.inventory).toMatchObject({ bcoin: 1, stone: 1, hay: 1, stick: 1 });
    expect(st.rockGame.stats).toMatchObject({ gamesPlayed: 1, highScore: 1200, bestLevel: 5, bullseyes: 2 });
    expect(st.rockGame.sessions).toHaveLength(1);
  });
  it('a lower score is not a new high score', () => {
    const { s } = make();
    s.actions.finishRockGame(result());
    expect(s.actions.finishRockGame(result({ score: 300, level: 1 })).newHighScore).toBe(false);
    expect(s.actions.finishRockGame(result({ score: 0, level: 1 })).newHighScore).toBe(false);
  });
  it('unlocks the minigame achievements it earned and announces them', () => {
    const { s } = make();
    s.actions.finishRockGame(result({ bullseyes: 10, longestCombo: 10, fastLevel: true, perfectLevel: true, farHit: true }));
    const done = s.getState().achievements.filter(a => a.category === 'SPECIAL' && a.unlocked).map(a => a.id).sort();
    expect(done).toEqual(['rock_game_bullseye_10', 'rock_game_combo_10', 'rock_game_first', 'rock_game_max_distance', 'rock_game_perfect_level', 'rock_game_score_1000', 'rock_game_speed_30s']);
    expect(s.getEvents().filter(e => e.type === 'achievement')).toHaveLength(7);
  });
  it('can level the player up', () => {
    const { s } = make();
    s.actions.finishRockGame(result({ score: 3000, level: 10, targetsHit: 80 }));
    expect(s.getEvents().some(e => e.type === 'levelUp')).toBe(true);
  });
  it('playing again costs stone and is refused without enough', () => {
    const { s } = make();
    expect(s.actions.spendStone(5)).toBe(false);
    s.actions.addItem('stone', 7);
    expect(s.actions.spendStone(5)).toBe(true);
    expect(s.getState().inventory.stone).toBe(2);
    expect(s.actions.spendStone(5)).toBe(false);
    expect(s.getState().inventory.stone).toBe(2);
  });
  it('survives a save, reload and export/import; old saves without it get an empty record', () => {
    const { kv, s } = make();
    s.actions.finishRockGame(result());
    const again = createStore(kv, Date.now, () => 'x');
    expect(again.getState().rockGame.stats.highScore).toBe(1200);
    const copy = importJSON(exportJSON(s.getState()), Date.now());
    expect(copy.rockGame.sessions).toHaveLength(1);
    const old = normalize({ version: 1, tasks: [] });
    expect(old.rockGame.stats.gamesPlayed).toBe(0); expect(old.rockGame.sessions).toEqual([]);
    expect(normalize({ version: 1, rockGame: 'junk' }).rockGame.sessions).toEqual([]);
  });
});

describe('mind maps', () => {
  it('creates, edits, renames and deletes', () => {
    const { s, t } = make();
    const id = s.actions.createMindMap('  Plans  ')!;
    expect(s.getState().mindMaps.list[0]).toMatchObject({ id, name: 'Plans', nodes: [], links: [] });
    t.now += 1000;
    s.actions.updateMindMap(id, { nodes: [{ id: 'a', x: 0, y: 0, w: 48, h: 32, label: 'A', theme: 'gold' }] });
    s.actions.updateMindMap(id, { name: '   ' });
    const m = s.getState().mindMaps.list[0];
    expect(m).toMatchObject({ name: 'Mind map', updatedAt: t.now });
    expect(m.nodes).toHaveLength(1);
    s.actions.deleteMindMap(id);
    expect(s.getState().mindMaps.list).toEqual([]);
  });
  it('refuses a new one when the list is full', () => {
    const { s } = make();
    for (let i = 0; i < 30; i++) expect(s.actions.createMindMap(`m${i}`)).not.toBeNull();
    expect(s.actions.createMindMap('one too many')).toBeNull();
    expect(s.getState().mindMaps.list).toHaveLength(30);
  });
  it('survives a save, reload and export/import; old saves without it get an empty list', () => {
    const { kv, s } = make();
    const id = s.actions.createMindMap('Keep')!;
    s.actions.updateMindMap(id, { nodes: [{ id: 'a', x: 0, y: 0, w: 48, h: 32, label: 'A', theme: 'gold' }, { id: 'b', x: 96, y: 0, w: 48, h: 32, label: 'B', theme: 'red' }], links: [{ id: 'l', from: 'a', to: 'b' }] });
    const again = createStore(kv, Date.now, () => 'x');
    expect(again.getState().mindMaps.list[0]).toMatchObject({ name: 'Keep', links: [{ id: 'l', from: 'a', to: 'b' }] });
    expect(importJSON(exportJSON(s.getState()), Date.now()).mindMaps.list[0].nodes).toHaveLength(2);
    expect(normalize({ version: 1, tasks: [] }).mindMaps).toEqual({ list: [] });
    expect(normalize({ version: 1, mindMaps: 'junk' }).mindMaps).toEqual({ list: [] });
  });
  it('notes: create, edit, delete, survive a reload; junk saves give an empty list', () => {
    const { kv, s } = make();
    const id = s.actions.createNote('  Ideas  ')!;
    s.actions.updateNote(id, { body: 'one\r\ntwo' });
    expect(s.getState().notes.list[0]).toMatchObject({ id, title: 'Ideas', body: 'one\ntwo' });
    expect(createStore(kv, Date.now, () => 'x').getState().notes.list[0]).toMatchObject({ title: 'Ideas', body: 'one\ntwo' });
    s.actions.deleteNote(id);
    expect(s.getState().notes.list).toEqual([]);
    expect(normalize({ version: 1, notes: 'junk' }).notes).toEqual({ list: [] });
    for (let i = 0; i < 100; i++) expect(s.actions.createNote(`n${i}`)).not.toBeNull();
    expect(s.actions.createNote('too many')).toBeNull();
  });
});

describe('planner', () => {
  const today = new Date(2026, 0, 1).getTime();
  it('adds, changes, ticks and deletes an activity', () => {
    const { s } = make();
    expect(s.actions.addEvent({ title: '  ', day: today })).toBeNull();
    const id = s.actions.addEvent({ title: ' Dentist ', day: day(1), time: 930, note: 'card' })!;
    expect(s.getState().planner.events[0]).toMatchObject({ id, title: 'Dentist', day: today, time: 930, note: 'card', done: false });
    s.actions.updateEvent(id, { title: 'Dentist', day: day(2) });
    expect(s.getState().planner.events[0]).toEqual({ id, title: 'Dentist', day: new Date(2026, 0, 2).getTime(), done: false, createdAt: day(1) });
    s.actions.setEventDone(id, true);
    expect(s.getState().planner.events[0].done).toBe(true);
    s.actions.deleteEvent(id);
    expect(s.getState().planner.events).toEqual([]);
  });
  it('a quick to-do is a task due today that goes on the shortlist until it is full', () => {
    const { s } = make();
    for (let i = 0; i < SHORTLIST_MAX; i++) expect(s.actions.addTodo(`todo ${i}`, 'MIND')!.listed).toBe(true);
    const sixth = s.actions.addTodo('one more', 'BODY')!;
    expect(sixth.listed).toBe(false);
    expect(sixth.task).toMatchObject({ title: 'one more', category: 'BODY', priority: 'MEDIUM', dueDate: today });
    expect(s.getState().planner.shortlist).toHaveLength(SHORTLIST_MAX);
    expect(s.actions.addTodo('  ', 'MIND')).toBeNull();
    const first = s.getState().planner.shortlist[0];
    s.actions.shortlistRemove(first);
    expect(s.actions.shortlistAdd(sixth.task.id)).toBe(true);
    expect(s.actions.shortlistAdd(sixth.task.id)).toBe(false);
    expect(s.getState().planner.shortlist).not.toContain(first);
  });
  it('the board moves an activity to another day and time, takes its time away, stretches it, and remembers the span', () => {
    const { s } = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    const d2 = new Date(2026, 0, 2).getTime(), id = s.actions.addEvent({ title: 'Gym', day: new Date(2026, 0, 1).getTime(), time: 600, minutes: 60, note: 'bag' })!;
    const e = () => s.getState().planner.events[0];
    s.actions.moveEvent(id, d2, 668);
    expect(e()).toMatchObject({ day: d2, time: 675, minutes: 60, note: 'bag' });
    s.actions.resizeEvent(id, 100);
    expect(e().minutes).toBe(105);
    s.actions.moveEvent(id, d2, undefined);
    expect(e().time).toBeUndefined(); expect(e().minutes).toBe(105);
    s.actions.resizeEvent(id, 30);                                // no time: nothing to stretch
    expect(e().minutes).toBe(105);
    s.actions.setPlannerSpan(7);
    expect(s.getState().planner.span).toBe(7);
  });
  it('a repeated activity is a series: move or delete just one, or it and all the future ones', () => {
    const { s } = make(undefined, { now: new Date(2026, 0, 1, 12).getTime() });
    const D = (n: number) => new Date(2026, 0, n).getTime();
    const id = s.actions.addEvent({ title: 'Gym', day: D(5), time: 600, minutes: 60 }, 'WEEKLY')!;
    const ev = () => s.getState().planner.events;
    expect(ev()).toHaveLength(12);
    expect(ev().slice(0, 3).map(e => e.day)).toEqual([D(5), D(12), D(19)]);
    expect(ev().every(e => e.series === id && e.repeat === 'WEEKLY' && e.time === 600)).toBe(true);
    expect(new Set(ev().map(e => e.id)).size).toBe(12);
    const second = ev()[1].id;
    s.actions.moveEvent(second, D(13), 660);                      // just this one
    expect(ev().slice(0, 3).map(e => [e.day, e.time])).toEqual([[D(5), 600], [D(13), 660], [D(19), 600]]);
    s.actions.moveEvent(second, D(14), 720, 'all');               // it and the later ones: a day later, at 12:00
    expect(ev().slice(0, 4).map(e => [e.day, e.time])).toEqual([[D(5), 600], [D(14), 720], [D(20), 720], [D(27), 720]]);
    s.actions.deleteEvent(ev()[2].id);
    expect(ev()).toHaveLength(11);
    s.actions.deleteEvent(second, 'all');
    expect(ev().map(e => e.day)).toEqual([D(5)]);
    s.actions.addEvent({ title: 'Stretch', day: D(31) }, 'MONTHLY');
    expect(ev().slice(1, 4).map(e => e.day)).toEqual([D(31), new Date(2026, 1, 28).getTime(), new Date(2026, 2, 31).getTime()]);
  });
  it('a habit goes on the planner, logs the days it was done, and moves one turn or all the future ones', () => {
    const { s, t } = make(undefined, { now: new Date(2026, 0, 7, 12).getTime() });   // a Wednesday
    const D = (n: number) => new Date(2026, 0, n).getTime();
    const h = s.actions.addHabit({ title: 'Swim', category: 'BODY', frequency: 'WEEKLY' });
    const get = () => s.getState().habits[0];
    s.actions.setHabitPlan(h.id, { start: D(7), time: 480 });
    expect(get().plan).toEqual({ start: D(7), time: 480 });
    s.actions.completeHabit(h.id);
    expect(get().log).toEqual([D(7)]);
    s.actions.moveHabit(h.id, D(14), D(16), 'one');
    expect(habitSlot(get(), D(14))).toBeNull(); expect(habitSlot(get(), D(16))).toMatchObject({ ruleDay: D(14) }); expect(habitSlot(get(), D(21))).toBeTruthy();
    s.actions.moveHabit(h.id, D(21), D(23), 'all');
    expect(get().plan).toMatchObject({ start: D(23), moved: { [D(14)]: D(16) } });
    t.now = new Date(2026, 0, 12, 9).getTime();
    s.actions.completeHabit(h.id);
    expect(get().log).toEqual([D(7), D(12)]);
    expect(s.actions.undoHabit(h.id)).toBe(true);
    expect(get().log).toEqual([D(7)]);
    s.actions.setHabitPlan(h.id, undefined);
    expect(get().plan).toBeUndefined(); expect('plan' in get()).toBe(false);
  });
  it('survives a save, reload and export/import; old saves without it get an empty planner', () => {
    const { kv, s } = make();
    s.actions.addEvent({ title: 'Gym', day: today, time: 420 });
    s.actions.addTodo('Call', 'SOUL');
    const again = createStore(kv, Date.now, () => 'x').getState().planner;
    expect(again.events[0]).toMatchObject({ title: 'Gym', time: 420 });
    expect(again.shortlist).toHaveLength(1);
    expect(importJSON(exportJSON(s.getState()), Date.now()).planner.events).toHaveLength(1);
    expect(normalize({ version: 1, tasks: [] }).planner).toEqual({ events: [], shortlist: [] });
    expect(normalize({ version: 1, planner: 'junk' }).planner).toEqual({ events: [], shortlist: [] });
  });
});

describe('exercise tracker', () => {
  const planned = [{ name: 'Squats', type: 'WEIGHT_TRAINING' as const, sets: 2, reps: 5 }, { name: 'Running', type: 'CARDIO' as const, sets: 1 }];
  it('runs one workout at a time, logs sets, pauses and pays Body points once on finish', () => {
    const { s, t } = make();
    const id = s.actions.startWorkout('  Leg  day ', planned)!;
    expect(s.actions.startWorkout('again')).toBe(id);
    expect(s.getState().exercise.workouts).toHaveLength(1);
    let w = s.getState().exercise.workouts[0];
    expect(w).toMatchObject({ name: 'Leg day', completed: false });
    expect(w.exercises.map(e => e.sets.length)).toEqual([2, 1]);

    const [squats] = w.exercises;
    s.actions.completeSet(id, squats.id, squats.sets[0].id, { reps: 6, weight: 80 });
    t.now += 10 * 60_000;
    s.actions.pauseWorkout(id);
    t.now += 30 * 60_000;
    s.actions.resumeWorkout(id);
    t.now += 10 * 60_000;
    w = s.getState().exercise.workouts[0];
    expect(w.pausedMs).toBe(30 * 60_000);
    expect(w.exercises[0].sets[0]).toMatchObject({ completed: true, reps: 6, weight: 80, completedAt: expect.any(Number) });

    const body = s.getState().stats.body;
    expect(s.actions.finishWorkout(id)).toBe(4 + 2 + 0);      // 20 trained minutes, 2 exercises, 3 sets
    expect(s.actions.finishWorkout(id)).toBe(0);              // already finished: nothing more
    expect(s.getState().stats.body).toBe(body + 6);
    expect(s.getState().exercise.workouts[0]).toMatchObject({ completed: true, duration: 20 * 60_000, bodyPointsAwarded: 6 });
    s.actions.addExercise(id, planned[0]);                    // a finished workout is frozen
    expect(s.getState().exercise.workouts[0].exercises).toHaveLength(2);
    expect(s.actions.startWorkout('next')).not.toBe(id);
  });
  it('quick log makes a finished workout and pays at once', () => {
    const { s } = make();
    expect(s.actions.quickLog({ name: 'Running', type: 'CARDIO', minutes: 30 })).toBe(6 + 1);
    expect(s.getState().exercise.workouts[0]).toMatchObject({ name: 'Quick Log', completed: true, duration: 30 * 60_000 });
    expect(s.getState().exercise.workouts[0].exercises[0].sets[0]).toMatchObject({ completed: true, duration: 30 * 60_000 });
    expect(s.getState().stats.body).toBeGreaterThanOrEqual(7);
  });
  it('deleting keeps the points; the save and the export round-trip', () => {
    const { kv, s } = make();
    const id = s.actions.startWorkout('A', planned)!;
    s.actions.finishWorkout(id);
    const body = s.getState().stats.body;
    expect(importJSON(exportJSON(s.getState()), Date.now()).exercise.workouts).toHaveLength(1);
    expect(make(kv).s.getState().exercise.workouts[0].id).toBe(id);
    s.actions.deleteWorkout(id);
    expect(s.getState().exercise.workouts).toEqual([]);
    expect(s.getState().stats.body).toBe(body);
    expect(normalize({ version: 1, tasks: [] }).exercise).toEqual({ workouts: [] });
  });
});

describe('habit and activity rewards', () => {
  it('a habit pays XP and a stat point, more with a streak, and quick start only once per session', () => {
    const { s, t } = make();
    const a = s.actions.addHabit({ title: 'Stretch', category: 'BODY', frequency: 'DAILY' });
    const b = s.actions.addHabit({ title: 'Read', category: 'MIND', frequency: 'DAILY' });
    s.actions.completeHabit(a.id);                       // within 3 minutes of opening: 5 x 1.5 = 8 (rounded)
    expect(s.getState().stats).toMatchObject({ totalExperiencePoints: 8, body: 1 });
    s.actions.completeHabit(b.id);                       // not the first any more: 5
    expect(s.getState().stats).toMatchObject({ totalExperiencePoints: 13, mind: 1, totalTasksCompleted: 0 });
    t.now += 86_400_000;
    s.actions.completeHabit(a.id);                       // streak 2: 5 x 1.1 = 5.5 -> 6
    expect(s.getState().stats.totalExperiencePoints).toBe(19);
  });
  it('no quick start bonus after the first 3 minutes', () => {
    const { s, t } = make();
    const a = s.actions.addHabit({ title: 'Stretch', category: 'BODY', frequency: 'DAILY' });
    t.now += 181_000;
    s.actions.completeHabit(a.id);
    expect(s.getState().stats.totalExperiencePoints).toBe(5);
  });
  it('undoing a habit takes its XP and stat point back and gives the quick start back', () => {
    const { s } = make();
    const a = s.actions.addHabit({ title: 'Stretch', category: 'BODY', frequency: 'DAILY' });
    s.actions.completeHabit(a.id);
    expect(s.actions.undoHabit(a.id)).toBe(true);
    expect(s.getState().stats).toMatchObject({ totalExperiencePoints: 0, body: 0 });
    s.actions.completeHabit(a.id);
    expect(s.getState().stats.totalExperiencePoints).toBe(8);
  });
  it('an activity pays on tick and takes it back on untick, so it cannot be farmed', () => {
    const { s, t } = make();
    const id = s.actions.addEvent({ title: 'Run', day: t.now, minutes: 60, category: 'BODY' })!;
    s.actions.setEventDone(id, true); s.actions.setEventDone(id, true);
    expect(s.getState().stats).toMatchObject({ totalExperiencePoints: 9, body: 1 });
    s.actions.setEventDone(id, false);
    expect(s.getState().stats).toMatchObject({ totalExperiencePoints: 0, body: 0 });
    expect(s.getState().planner.events[0].paid).toBeUndefined();
    s.actions.setEventDone(id, true);
    expect(s.getState().stats.totalExperiencePoints).toBe(9);
  });
  it('an activity without a category pays XP only', () => {
    const { s, t } = make();
    const id = s.actions.addEvent({ title: 'Nap', day: t.now })!;
    s.actions.setEventDone(id, true);
    expect(s.getState().stats).toMatchObject({ totalExperiencePoints: 5, body: 0, mind: 0, soul: 0 });
  });
  it('what an activity paid survives a save and reload', () => {
    const { s, t, kv } = make();
    const id = s.actions.addEvent({ title: 'Run', day: t.now, category: 'SOUL' })!;
    s.actions.setEventDone(id, true);
    const again = createStore(kv, () => t.now, () => `x${++n}`);
    again.actions.setEventDone(id, false);
    expect(again.getState().stats).toMatchObject({ totalExperiencePoints: 0, soul: 0 });
  });
});

describe('task with several core attributes', () => {
  it('each extra attribute pays one more stat point, and editing keeps them', () => {
    const { s } = make();
    const t = s.actions.addTask({ title: 'Hike', category: 'BODY', priority: 'LOW', difficulty: 0, coreAttributes: ['SOUL', 'MIND'] });
    expect(t.statRewards).toEqual({ body: 1, mind: 1, soul: 1 });
    s.actions.updateTask(t.id, { title: 'Hike far', category: 'BODY', coreAttributes: ['SOUL'] });
    expect(s.getState().tasks[0].statRewards).toEqual({ body: 1, mind: 0, soul: 1 });
  });
});

describe('tags and quick presets', () => {
  it('counts, filters, renames (merging) and deletes tags', () => {
    const { s } = make();
    const a = s.actions.addTask({ title: 'A', category: 'BODY', priority: 'LOW', difficulty: 0, tags: ['home', 'chore'] });
    s.actions.addTask({ title: 'B', category: 'MIND', priority: 'LOW', difficulty: 0, tags: ['home'] });
    expect(tagCounts(s.getState().tasks)).toEqual([{ tag: 'home', count: 2 }, { tag: 'chore', count: 1 }]);
    expect(viewTasks(s.getState().tasks, { category: 'ALL', sort: 'none', showCompleted: false, tag: 'chore' }).open.map(t => t.id)).toEqual([a.id]);
    s.actions.renameTag('chore', 'home');                       // merges: no duplicate on the task
    expect(s.getState().tasks.find(t => t.id === a.id)!.tags).toEqual(['home']);
    s.actions.deleteTag('home');
    expect(tagCounts(s.getState().tasks)).toEqual([]);
    expect(cleanTag(' #a,b ')).toBe('ab');
  });
  it('presets are the finished tasks done most often, with their latest settings', () => {
    const { s, t } = make();
    const a = s.actions.addTask({ title: 'Dishes', category: 'SOUL', priority: 'HIGH', difficulty: 1 });
    s.actions.completeTask(a.id); t.now += 11_000; s.actions.uncompleteTask(a.id); s.actions.completeTask(a.id);
    s.actions.addTask({ title: 'Never done', category: 'BODY', priority: 'LOW', difficulty: 0 });
    const p = quickPresets(s.getState().tasks);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ title: 'Dishes', category: 'SOUL', priority: 'HIGH', difficulty: 1 });
  });
});

describe('Bóbr reacts', () => {
  it('cheers after a task and a habit, plays about after a level-up, and both wear off', () => {
    const { s, t } = make();
    const task = s.actions.addTask({ title: 'T', category: 'BODY', priority: 'LOW', difficulty: 0 });
    s.actions.completeTask(task.id);
    expect(emotionNow(s.getState().bobr, t.now)).toBe('EXCITED');
    expect(emotionNow(s.getState().bobr, t.now + 21_000)).not.toBe('EXCITED');
    s.actions.addXP(5000);                                          // a level-up (and its dialog)
    expect(s.getState().bobr.mischiefUntil).toBeGreaterThan(t.now);
    const later = { ...s.getState().bobr, treatUntil: 0, lastInteraction: t.now, happiness: 1, happinessAt: t.now };
    expect(emotionNow(later, t.now + 1000)).toBe('MISCHIEVOUS');
    expect(emotionNow(later, t.now + 61_000)).not.toBe('MISCHIEVOUS');
  });
});

describe('shortlist order', () => {
  it('a task can be moved up and down, and not past the ends', () => {
    const { s } = make();
    const ids = ['a', 'b', 'c'].map(x => s.actions.addTodo(x, 'MIND')!.task.id);
    s.actions.shortlistMove(ids[2], -1);
    expect(s.getState().planner.shortlist).toEqual([ids[0], ids[2], ids[1]]);
    s.actions.shortlistMove(ids[0], -1);
    s.actions.shortlistMove(ids[1], 1);
    expect(s.getState().planner.shortlist).toEqual([ids[0], ids[2], ids[1]]);
  });
});

describe('custom categories', () => {
  it('adds, renames, recolours and deletes; deleting keeps the tasks', () => {
    const { s, kv, t } = make();
    const id = s.actions.addCategory('Career', 'gold')!;
    expect(id).toBeTruthy();
    expect(s.actions.addCategory('career', 'red')).toBeNull();   // same name
    expect(s.actions.addCategory('  ', 'red')).toBeNull();
    const other = s.actions.addCategory('Home', 'nonsense')!;
    expect(s.getState().categories).toEqual([{ id, name: 'Career', frame: 'gold' }, { id: other, name: 'Home', frame: 'blue_ornate' }]);
    expect(s.actions.updateCategory(other, { name: 'Career' })).toBe(false);
    expect(s.actions.updateCategory(other, { name: 'House', frame: 'red' })).toBe(true);
    const task = s.actions.addTask({ title: 'CV', category: 'MIND', priority: 'LOW', difficulty: 1, groups: [id] });
    expect(s.getState().tasks[0].groups).toEqual([id]);
    s.actions.updateTask(task.id, { groups: [id, other] });
    expect(s.getState().tasks[0].groups).toEqual([id, other]);   // several at once
    // it survives a reload
    const again = createStore(kv, () => t.now);
    expect(again.getState().categories.map(c => c.name)).toEqual(['Career', 'House']);
    s.actions.deleteCategory(other);
    expect(s.getState().categories).toHaveLength(1);
    expect(s.getState().tasks).toHaveLength(1);
    expect(s.getState().tasks[0].groups).toEqual([id]);          // only the deleted one goes
    s.actions.deleteCategory(id);
    expect(s.getState().tasks[0].groups).toBeUndefined();
  });
  it('old saves with one `group` become a list', () => {
    const { kv, t } = make();
    kv.setItem('scrypture:state', JSON.stringify({ version: 1, categories: [{ id: 'k', name: 'Home', frame: 'gold' }],
      tasks: [{ id: 't1', title: 'x', category: 'MIND', priority: 'LOW', difficulty: 0, completed: false, experienceReward: 1, statRewards: { body: 0, mind: 1, soul: 0 }, tags: [], group: 'k', createdAt: 0, updatedAt: 0 }],
      habits: [{ id: 'h1', title: 'y', category: 'BODY', frequency: 'DAILY', streak: 0, bestStreak: 0, lastCompleted: null, group: 'k', createdAt: 0, updatedAt: 0 }] }));
    const st = createStore(kv, () => t.now).getState();
    expect(st.tasks[0].groups).toEqual(['k']); expect('group' in st.tasks[0]).toBe(false);
    expect(st.habits[0].groups).toEqual(['k']);
  });
  it('holds at most 12', () => {
    const { s } = make();
    for (let i = 0; i < 12; i++) expect(s.actions.addCategory(`c${i}`, 'red')).toBeTruthy();
    expect(s.actions.addCategory('one more', 'red')).toBeNull();
  });
});

describe('custom categories on habits', () => {
  it('a habit can belong to a category; deleting the category frees it and counts both', () => {
    const { s } = make();
    const id = s.actions.addCategory('Health', 'green')!;
    const h = s.actions.addHabit({ title: 'Walk', category: 'BODY', frequency: 'DAILY', groups: [id] });
    expect(s.getState().habits[0].groups).toEqual([id]);
    s.actions.updateHabit(h.id, { groups: undefined });
    expect(s.getState().habits[0].groups).toBeUndefined();
    s.actions.updateHabit(h.id, { groups: [id] });
    s.actions.deleteCategory(id);
    expect(s.getState().habits).toHaveLength(1);
    expect(s.getState().habits[0].groups).toBeUndefined();
  });
});

describe('shortlist drag and drop', () => {
  it('places a to-do, and dropping on a day dates it and takes it off the list', () => {
    const { s } = make();
    const mk = (title: string) => s.actions.addTask({ title, category: 'MIND', priority: 'LOW', difficulty: 0 });
    const [a, b, c] = [mk('a'), mk('b'), mk('c')];
    for (const t of [a, b, c]) s.actions.shortlistAdd(t.id);
    s.actions.shortlistPlace(c.id, 0);
    expect(s.getState().planner.shortlist).toEqual([c.id, a.id, b.id]);
    s.actions.shortlistToDay(a.id, day(5));
    expect(s.getState().planner.shortlist).toEqual([c.id, b.id]);
    expect(s.getState().tasks.find(t => t.id === a.id)!.dueDate).toBe(day(5));
  });
});

describe('editing a repeated activity', () => {
  it('changes only this one, or this one and the later ones', () => {
    const { s } = make();
    s.actions.addEvent({ title: 'Swim', day: day(5), time: 480 }, 'WEEKLY');
    const ev = () => s.getState().planner.events.slice().sort((a, b) => a.day - b.day);
    const [first, second, third] = ev();
    s.actions.updateEventScope(second.id, { title: 'Swim hard', day: second.day, time: 540 }, 'one');
    expect(ev().slice(0, 3).map(e => [e.title, e.time])).toEqual([['Swim', 480], ['Swim hard', 540], ['Swim', 480]]);
    expect(ev()[1].series).toBe(first.series);
    s.actions.updateEventScope(second.id, { title: 'Run', day: second.day + 86_400_000, time: 600 }, 'all');
    const after = ev();
    expect(after[0].title).toBe('Swim');                                // earlier ones stay
    expect(after[1]).toMatchObject({ title: 'Run', time: 600, day: second.day + 86_400_000 });
    expect(after[2]).toMatchObject({ title: 'Run', time: 600, day: third.day + 86_400_000 });   // shifted by the same day
    expect(after.every(e => e.series === first.series)).toBe(true);
  });
});

describe('tasks planned for a time of day', () => {
  it('a task can get a time on its due date, from the board or the shortlist, and a bad saved time is dropped', () => {
    const { s, kv, t } = make();
    const a = s.actions.addTask({ title: 'a', category: 'MIND', priority: 'LOW', difficulty: 0, dueDate: day(5) });
    s.actions.updateTask(a.id, { dueDate: day(6), scheduledTime: 600 });
    expect(s.getState().tasks[0]).toMatchObject({ dueDate: day(6), scheduledTime: 600 });
    s.actions.updateTask(a.id, { dueDate: day(6), scheduledTime: undefined });
    expect(s.getState().tasks[0].scheduledTime).toBeUndefined();
    const b = s.actions.addTask({ title: 'b', category: 'MIND', priority: 'LOW', difficulty: 0 });
    s.actions.shortlistAdd(b.id);
    s.actions.shortlistToDay(b.id, day(7), 720);
    expect(s.getState().tasks.find(x => x.id === b.id)).toMatchObject({ dueDate: day(7), scheduledTime: 720 });
    expect(s.getState().planner.shortlist).toEqual([]);
    const saved = JSON.parse(kv.getItem('scrypture:state')!);
    saved.tasks[0].scheduledTime = 99999;
    kv.setItem('scrypture:state', JSON.stringify(saved));
    expect(createStore(kv, () => t.now).getState().tasks[0].scheduledTime).toBeUndefined();
  });
});
