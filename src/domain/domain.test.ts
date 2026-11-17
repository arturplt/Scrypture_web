import { describe, expect, it } from 'vitest';
import {
  calculateXP, difficultyXP, statRewards, calculateLevel, xpForNextLevel, progressToNextLevel, bobrStage,
  nextStreak, completeHabit, dayDiff, seedAchievements, checkAchievements, isConditionMet,
  sanitizeCategories, categoryNameFree, addXP, applyTaskCompletion, initialStats, type Habit,
} from './index';

describe('xp', () => {
  it('priority + fibonacci difficulty', () => {
    expect(calculateXP('LOW', 0)).toBe(5);
    expect(calculateXP('MEDIUM', 3)).toBe(13);
    expect(calculateXP('CRITICAL', 9)).toBe(75);
  });
  it('out-of-range difficulty adds nothing', () => {
    expect([-1, 10, 2.5].map(difficultyXP)).toEqual([0, 0, 0]);
  });
  it('stat rewards: +1 per core attribute, +1 category', () => {
    expect(statRewards(['BODY', 'MIND'])).toEqual({ body: 1, mind: 1, soul: 0 });
    expect(statRewards(['SOUL'], 'SOUL')).toEqual({ body: 0, mind: 0, soul: 2 });
    expect(statRewards([], 'BODY')).toEqual({ body: 1, mind: 0, soul: 0 });
  });
});

describe('levels', () => {
  it('thresholds', () => {
    const cases: [number, number][] = [[0, 1], [99, 1], [100, 2], [249, 2], [250, 3], [700, 5], [2699, 9], [2700, 10], [99999, 10]];
    for (const [xp, lvl] of cases) expect(calculateLevel(xp)).toBe(lvl);
  });
  it('xp to next level and cap', () => {
    expect(xpForNextLevel(1, 40)).toBe(60);
    expect(xpForNextLevel(10, 3000)).toBe(0);
  });
  it('progress is 0..1', () => {
    expect(progressToNextLevel(1, 50)).toBe(0.5);
    expect(progressToNextLevel(2, 175)).toBe(0.5);
    expect(progressToNextLevel(10, 5000)).toBe(1);
  });
  it('bobr stage by level', () => {
    expect([1, 3, 4, 6, 7, 10].map(bobrStage)).toEqual(['HATCHLING', 'HATCHLING', 'YOUNG', 'YOUNG', 'MATURE', 'MATURE']);
  });
});

describe('habit streaks', () => {
  const at = (d: number, h = 12) => new Date(2026, 0, d, h).getTime();
  const habit = (over: Partial<Habit> = {}): Habit => ({
    id: 'h', title: 't', category: 'BODY', frequency: 'DAILY', streak: 0, bestStreak: 0, lastCompleted: null, createdAt: 0, updatedAt: 0, ...over,
  });
  it('first completion = 1', () => expect(nextStreak(0, null, at(1))).toBe(1));
  it('same day unchanged', () => expect(nextStreak(3, at(1, 8), at(1, 23))).toBe(3));
  it('next day +1 (even 23:59 -> 00:01)', () => expect(nextStreak(3, at(1, 23), at(2, 0))).toBe(4));
  it('gap resets to 1', () => expect(nextStreak(9, at(1), at(3))).toBe(1));
  it('tracks bestStreak', () => {
    let h = habit();
    for (let d = 1; d <= 5; d++) h = completeHabit(h, at(d));
    expect(h.streak).toBe(5);
    h = completeHabit(h, at(9));
    expect(h.streak).toBe(1);
    expect(h.bestStreak).toBe(5);
  });
  it('dayDiff across month boundary', () => expect(dayDiff(new Date(2026, 0, 31, 23).getTime(), new Date(2026, 1, 1, 1).getTime())).toBe(1));
});

describe('progress + achievements', () => {
  it('addXP reports level up', () => {
    const r = addXP(initialStats(), 120);
    expect(r.stats.level).toBe(2);
    expect(r.leveledUp).toBe(2);
    expect(addXP(r.stats, 10).leveledUp).toBeNull();
  });
  it('applyTaskCompletion updates xp, stats, counter', () => {
    const r = applyTaskCompletion(initialStats(), { experienceReward: 13, statRewards: { body: 1, mind: 0, soul: 1 } });
    expect(r.stats).toMatchObject({ totalExperiencePoints: 13, body: 1, soul: 1, totalTasksCompleted: 1 });
  });
  it('seed has 18 unique achievements', () => {
    const s = seedAchievements();
    expect(s).toHaveLength(18);
    expect(new Set(s.map(a => a.id)).size).toBe(18);
  });
  it('unlocks once and reports new ones', () => {
    const stats = { ...initialStats(), totalTasksCompleted: 10, totalExperiencePoints: 700, body: 100 };
    const r1 = checkAchievements(seedAchievements(), { stats, maxHabitStreak: 7 }, 1000);
    expect(r1.newlyUnlocked.map(a => a.condition).sort()).toEqual(['body_100', 'first_task', 'level_5', 'streak_7', 'ten_tasks']);
    const r2 = checkAchievements(r1.achievements, { stats, maxHabitStreak: 7 }, 2000);
    expect(r2.newlyUnlocked).toHaveLength(0);
    expect(r2.achievements.find(a => a.id === 'first_task')!.unlockedAt).toBe(1000);
  });
  it('minigame conditions are not met yet', () => {
    expect(isConditionMet('rock_game_first', { stats: initialStats(), maxHabitStreak: 0 })).toBe(false);
  });
});

import { hungerAt, emotionFor, HUNGER_FULL_MS, EMOTICONS } from './index';
describe('bobr', () => {
  it('hunger is linear and clamped', () => {
    expect(hungerAt(0, 0)).toBe(0);
    expect(hungerAt(0, HUNGER_FULL_MS / 2)).toBe(0.5);
    expect(hungerAt(0, HUNGER_FULL_MS * 9)).toBe(1);
    expect(hungerAt(100, 0)).toBe(0);
  });
  it('emotion priority', () => {
    const base = { hunger: 0, happiness: 1, hour: 12 };
    expect(emotionFor(base)).toBe('HAPPY');
    expect(emotionFor({ ...base, hunger: 0.9 })).toBe('HUNGRY');
    expect(emotionFor({ ...base, happiness: 0.1 })).toBe('SAD');
    expect(emotionFor({ ...base, hour: 2 })).toBe('SLEEPY');
    expect(emotionFor({ ...base, happiness: 0.5 })).toBe('NEUTRAL');
    expect(emotionFor({ ...base, hunger: 0.9, excited: true })).toBe('EXCITED');
  });
  it('every emotion has frames', () => {
    for (const e of Object.values(EMOTICONS)) expect(e.frames.length).toBeGreaterThan(1);
  });
});

import { viewTasks, isOverdue, startOfDay, urgencyOf, type Task } from './index';
describe('task view', () => {
  const mk = (id: string, o: Partial<Task> = {}): Task => ({
    id, title: id, category: 'BODY', priority: 'LOW', difficulty: 0, completed: false, experienceReward: 5,
    statRewards: { body: 1, mind: 0, soul: 0 }, tags: [], createdAt: 0, updatedAt: 0, ...o,
  });
  const tasks = [
    mk('a', { createdAt: 1, priority: 'HIGH', difficulty: 2, dueDate: 300 }),
    mk('b', { createdAt: 2, priority: 'LOW', difficulty: 9, category: 'MIND' }),
    mk('c', { createdAt: 3, priority: 'CRITICAL', difficulty: 5, dueDate: 100 }),
    mk('d', { createdAt: 4, completed: true, updatedAt: 9 }),
    mk('e', { createdAt: 5, completed: true, updatedAt: 20 }),
  ];
  const ids = (l: Task[]) => l.map(t => t.id).join('');
  const V = { category: 'ALL', sort: 'newest', showCompleted: true } as const;
  it('sorts', () => {
    expect(ids(viewTasks(tasks, V).open)).toBe('cba');
    expect(ids(viewTasks(tasks, { ...V, sort: 'due' }).open)).toBe('cab');   // no due date last
    expect(ids(viewTasks(tasks, { ...V, sort: 'priority' }).open)).toBe('cab');
    expect(ids(viewTasks(tasks, { ...V, sort: 'difficulty' }).open)).toBe('bca');
  });
  it('filters by category and hides/ shows completed (latest first)', () => {
    expect(ids(viewTasks(tasks, { ...V, category: 'MIND' }).open)).toBe('b');
    expect(ids(viewTasks(tasks, V).done)).toBe('ed');
    expect(viewTasks(tasks, { ...V, showCompleted: false }).done).toEqual([]);
  });
  it('overdue only after the due day has fully passed', () => {
    const now = new Date(2026, 5, 10, 15).getTime();
    const day = (d: number) => new Date(2026, 5, d).getTime();
    expect(isOverdue({ dueDate: day(10), completed: false }, now)).toBe(false);
    expect(isOverdue({ dueDate: day(9), completed: false }, now)).toBe(true);
    expect(isOverdue({ dueDate: day(9), completed: true }, now)).toBe(false);
    expect(isOverdue({ completed: false }, now)).toBe(false);
    expect(startOfDay(now)).toBe(day(10));
  });
});

import { effectiveStreak, completedToday } from './index';
describe('effective streak', () => {
  const at = (d: number, h = 12) => new Date(2026, 0, d, h).getTime();
  it('alive today/yesterday, lost after a missed day', () => {
    const h = { streak: 5, lastCompleted: at(10) };
    expect(effectiveStreak(h, at(10, 20))).toBe(5);
    expect(effectiveStreak(h, at(11))).toBe(5);
    expect(effectiveStreak(h, at(12))).toBe(0);
    expect(effectiveStreak({ streak: 0, lastCompleted: null }, at(1))).toBe(0);
  });
  it('completedToday', () => {
    const base = { id: 'h', title: 't', category: 'BODY', frequency: 'DAILY', streak: 1, bestStreak: 1, createdAt: 0, updatedAt: 0 } as const;
    expect(completedToday({ ...base, lastCompleted: at(3, 1) }, at(3, 23))).toBe(true);
    expect(completedToday({ ...base, lastCompleted: at(2) }, at(3))).toBe(false);
  });
});

import { achievementProgress } from './index';
describe('achievement progress', () => {
  it('clamps to the target and ignores uncountable ones', () => {
    const ctx = { stats: { ...initialStats(), totalTasksCompleted: 12, totalExperiencePoints: 350 }, maxHabitStreak: 3 };
    expect(achievementProgress('ten_tasks', ctx)).toEqual({ current: 10, target: 10 });
    expect(achievementProgress('level_5', ctx)).toEqual({ current: 350, target: 700 });
    expect(achievementProgress('streak_7', ctx)).toEqual({ current: 3, target: 7 });
    expect(achievementProgress('rock_game_speed_30s', ctx)).toBeNull();
  });
});

import { happinessNow, tradeFor, willTrade, ITEM_IDS, HOME_ITEMS, HAPPY_GRACE_MS } from './index';
describe('bobr happiness + trades', () => {
  const v = (o = {}) => ({ happiness: 1, happinessAt: 0, lastInteraction: 0, ...o });
  it('no decay during grace, then falls and bottoms at 0', () => {
    expect(happinessNow(v(), HAPPY_GRACE_MS)).toBe(1);
    const after10s = happinessNow(v(), HAPPY_GRACE_MS + 10_000);
    expect(after10s).toBeLessThan(0.9);
    expect(after10s).toBeGreaterThan(0.85);
    expect(happinessNow(v(), HAPPY_GRACE_MS + 10 * 60_000)).toBe(0);
  });
  it('fresh interaction restarts the grace window', () => {
    expect(happinessNow(v({ happinessAt: 50_000, lastInteraction: 50_000 }), 70_000)).toBe(1);
  });
  it('trade is stable within a minute, differs from previous, never trades item for itself', () => {
    const t0 = 10 * 60_000;
    expect(tradeFor(t0 + 1)).toEqual(tradeFor(t0 + 59_000));
    for (let s = 1; s < 300; s++) {
      const a = tradeFor(s * 60_000), b = tradeFor((s - 1) * 60_000);
      expect(a.request).not.toBe(a.offer);
      expect(ITEM_IDS).toContain(a.request);
      expect([a.request, a.offer]).not.toContain('berry');   // berries only come from the world's bushes

      expect(a.request === b.request && a.offer === b.offer).toBe(false);
    }
  });
  it('berries never turn up at home', () => {
    expect(HOME_ITEMS).toEqual(['bcoin', 'stone', 'hay', 'stick']);
  });
  it('mood gate', () => {
    expect(willTrade('HAPPY')).toBe(true);
    expect(['SLEEPY', 'SAD', 'HUNGRY'].some(e => willTrade(e as never))).toBe(false);
  });
});

import { sanitizeLook, DEFAULT_LOOK, autoUiScale, layoutFor, needsRail, maxUiScale, boxCount, sanitizeNavItems, buttonSlice } from './index';
describe('look (appearance + accessibility)', () => {
  it('defaults match Android: boxes for hunger/happiness', () => {
    expect(sanitizeLook(undefined)).toEqual(DEFAULT_LOOK);
    expect(DEFAULT_LOOK.bars).toMatchObject({ hunger: 'boxes_red', happiness: 'boxes_green' });
  });
  it('keeps valid values and replaces garbage', () => {
    const ok = { presets: [], device: false, crt: 'high', deviceFrame: 'tech', textScale: 1.5, uiScale: 2, frameEdges: 'random', buttonSize: 'medium', frameCenter: 'random', chips: 'stone', chipEdges: 'random', chipsCat: { all: 'same', body: 'ember', mind: 'stone', soul: 'gold' }, nav: { frame: 'tech', active: 'plate', plate: 'ember', items: ['home', 'chat', 'settings'], labels: 'both' }, elements: { tick: 'slot', task: 'gold', habit: 'app', done: 'tech', taskDialog: 'space', habitDialog: 'blue' , dashLevel: 'app', dashBody: 'app', dashMind: 'app', dashSoul: 'app', dashPen: 'app', dashHunger: 'app', dashHappiness: 'app', dashMenu: 'app', dashInventory: 'app', dashNudge: 'app', manageDialog: 'wood_steel', tip: 'gold_ornate', slot: 'tech', plCard: 'gold', plBoard: 'app', plEvent: 'red' }, buttons: { primary: 'gold', secondary: 'button_red', keys: 'blue', keysFn: 'button_red' }, bars: { xp: 'stone', hunger: 'seg_red', happiness: 'bev' } };
    expect(sanitizeLook(ok)).toEqual(ok);
    const bad = sanitizeLook({ textScale: 7, uiScale: '2', frameEdges: 'wavy', buttonSize: 'tiny', frameCenter: 'huge', buttons: { primary: 5, secondary: '' }, bars: null } as never);
    expect(bad).toEqual(DEFAULT_LOOK);
  });
  it('elements: defaults, partial values and garbage', () => {
    expect(DEFAULT_LOOK.elements).toEqual({ tick: 'classic', task: 'app', habit: 'app', done: 'grey_stone_chiseld', taskDialog: 'wood_gold_gem', habitDialog: 'wood_gold_gem', dashLevel: 'app', dashBody: 'app', dashMind: 'app', dashSoul: 'app', dashPen: 'app', dashHunger: 'app', dashHappiness: 'app', dashMenu: 'app', dashInventory: 'app', dashNudge: 'app', manageDialog: 'wood_gold_gem', tip: 'wood_gold_gem', slot: 'classic', plCard: 'app', plBoard: 'app', plEvent: 'blue' });
    // settings saved before the home-screen elements existed get the defaults
    expect(sanitizeLook({ elements: { task: 'gold' } } as never).elements).toMatchObject({ task: 'gold', dashLevel: 'app', dashMenu: 'app' });
    expect(sanitizeLook({ elements: { dashPen: 'gold_thick', dashMenu: 7 } } as never).elements).toMatchObject({ dashPen: 'gold_thick', dashMenu: 'app' });
    expect(sanitizeLook({ elements: { task: 'stone_block', habit: 7, tick: '' } } as never).elements).toEqual({ ...DEFAULT_LOOK.elements, task: 'stone_block' });
    expect(sanitizeLook({ elements: 'nope' } as never).elements).toEqual(DEFAULT_LOOK.elements);
  });
  it('navigation bar: defaults, always keeps Home, canonical order, drops unknown and duplicate items', () => {
    expect(DEFAULT_LOOK.nav).toEqual({ frame: 'wood_steel', active: 'outline', plate: 'wood', items: ['home', 'tasks', 'habits'], labels: 'icons' });
    expect(sanitizeNavItems(['settings', 'chat', 'chat', 'nope', 7])).toEqual(['home', 'chat', 'settings']);   // Home added, order fixed
    expect(sanitizeNavItems([])).toEqual(['home']);
    expect(sanitizeNavItems('nope')).toEqual(['home', 'tasks', 'habits']);
    const bad = sanitizeLook({ nav: { frame: '', active: 'blink', items: ['tasks'], labels: 'text' } } as never).nav;
    expect(bad).toEqual({ frame: 'wood_steel', active: 'outline', plate: 'wood', items: ['home', 'tasks'], labels: 'icons' });
  });
  it('button size: compact by default, thinner borders for smaller sizes, decorated frames protected', () => {
    expect(DEFAULT_LOOK.buttonSize).toBe('compact');
    expect([buttonSlice('green_button', 'large'), buttonSlice('green_button', 'medium'), buttonSlice('green_button', 'compact')]).toEqual([16, 12, 8]);
    expect(buttonSlice('wood_gold_gem', 'compact')).toBe(12);          // gems would be cut
    expect(buttonSlice('stone_block', 'medium')).toBe(12);
    expect(buttonSlice('stone_block', 'large')).toBe(16);              // never thinner than asked
    expect(buttonSlice('gold', 'unknown')).toBe(8);                    // unknown size = compact
  });
  it('interface scale is automatic by default and only 0..3 are valid', () => {
    expect(DEFAULT_LOOK.uiScale).toBe(0);
    expect(sanitizeLook({ uiScale: 3 }).uiScale).toBe(3);
    expect(sanitizeLook({ uiScale: 4 }).uiScale).toBe(0);
  });
  it('auto scale: phones 1x, portrait tablets 2x, short windows stay 1x, huge screens 3x', () => {
    const cases: [number, number, number][] = [
      [320, 568, 1], [390, 844, 1], [430, 932, 1], [844, 390, 1],      // phones (portrait + landscape)
      [768, 1024, 2], [1024, 768, 1], [1366, 657, 1], [1536, 730, 1], [1920, 940, 2],  // tablet portrait = big phone UI; tablet landscape/laptops = 1x wide layout; 1080p desktop window = 2x
      [1440, 1300, 2], [2560, 1300, 2], [1080, 1500, 3], [3840, 2000, 3], [5000, 3000, 3], [100, 100, 1],
    ];
    for (const [w, h, want] of cases) expect(autoUiScale(w, h), `${w}x${h}`).toBe(want);
  });
  it('layout comes from the logical width', () => {
    expect([320, 559, 560, 899, 900, 1920].map(layoutFor)).toEqual(['compact', 'compact', 'medium', 'medium', 'wide', 'wide']);
    expect(layoutFor(1440 / 2)).toBe('medium');
  });
  it('manual scale is capped so the logical screen stays usable', () => {
    expect([100, 280, 320, 390, 768, 1920].map(maxUiScale)).toEqual([1, 1, 2, 2, 3, 3]);
  });
  it('side rail on wide layouts and on short screens only', () => {
    expect([needsRail('compact', 844), needsRail('medium', 390), needsRail('medium', 700), needsRail('wide', 900), needsRail('compact', 300), needsRail('compact', 512)]).toEqual([false, true, false, true, false, false]);
  });
  it('box meter', () => {
    expect([boxCount(0), boxCount(0.5), boxCount(1), boxCount(2), boxCount(-1), boxCount(0.04)]).toEqual([0, 5, 10, 10, 0, 0]);
    expect(boxCount(30, 100)).toBe(3);
    expect(boxCount(5, 0)).toBe(0);
  });
});

import { revokeTaskCompletion, canRefund, UNDO_WINDOW_MS } from './index';
describe('undoing a completion', () => {
  const paid = { xp: 100, statRewards: { body: 1, mind: 0, soul: 2 } };
  it('refunds xp, stats, counter and lets the level fall back', () => {
    const s = { ...initialStats(), level: 2, totalExperiencePoints: 130, body: 5, mind: 1, soul: 2, totalTasksCompleted: 4 };
    expect(revokeTaskCompletion(s, paid)).toEqual({ level: 1, totalExperiencePoints: 30, body: 4, mind: 1, soul: 0, totalTasksCompleted: 3 });
  });
  it('never goes below zero', () => {
    const s = { ...initialStats(), totalExperiencePoints: 20, soul: 1 };
    expect(revokeTaskCompletion(s, paid)).toMatchObject({ totalExperiencePoints: 0, level: 1, body: 0, soul: 0, totalTasksCompleted: 0 });
  });
  it('the undo window is exactly 10 seconds', () => {
    expect(UNDO_WINDOW_MS).toBe(10_000);
    const t = { completed: true, lastCompletedAt: 1_000, lastReward: paid };
    expect([1_000, 5_000, 11_000].map(n => canRefund(t, n))).toEqual([true, true, true]);
    expect(canRefund(t, 11_001)).toBe(false);
    expect(canRefund({ ...t, completed: false }, 2_000)).toBe(false);
    expect(canRefund({ completed: true }, 2_000)).toBe(false);          // old saves without reward info: nothing to refund
    expect(canRefund(t, 500)).toBe(false);                               // clock went backwards
  });
});

describe('urgencyOf', () => {
  const now = new Date(2025, 5, 10, 15).getTime(), day = (d: number) => new Date(2025, 5, d).getTime();
  it('is none without a due date or once completed', () => {
    expect(urgencyOf({ dueDate: undefined, completed: false }, now)).toBe('none');
    expect(urgencyOf({ dueDate: day(9), completed: true }, now)).toBe('none');
  });
  it('is overdue after the due day, soon today and tomorrow, none later', () => {
    expect(urgencyOf({ dueDate: day(9), completed: false }, now)).toBe('overdue');
    expect(urgencyOf({ dueDate: day(10), completed: false }, now)).toBe('soon');
    expect(urgencyOf({ dueDate: day(11), completed: false }, now)).toBe('soon');
    expect(urgencyOf({ dueDate: day(12), completed: false }, now)).toBe('none');
  });
});

import { sortHabits } from './index';
describe('sortHabits', () => {
  const now = new Date(2025, 5, 10, 12).getTime(), yest = new Date(2025, 5, 9, 12).getTime();
  const h = (title: string, createdAt: number, streak: number, lastCompleted: number | null): Habit =>
    ({ id: title, title, category: 'BODY', frequency: 'DAILY', streak, bestStreak: streak, lastCompleted, createdAt, updatedAt: createdAt });
  const list = [h('Read', 1, 2, yest), h('Walk', 3, 9, now), h('Yoga', 2, 5, yest)];
  const names = (s: Parameters<typeof sortHabits>[1]) => sortHabits(list, s, now).map(x => x.title);
  it('orders by each rule without touching the input', () => {
    expect(names('newest')).toEqual(['Walk', 'Yoga', 'Read']);
    expect(names('streak')).toEqual(['Walk', 'Yoga', 'Read']);
    expect(names('name')).toEqual(['Read', 'Walk', 'Yoga']);
    expect(list.map(x => x.title)).toEqual(['Read', 'Walk', 'Yoga']);
  });
  it('puts habits still to do today first, newest first among equals', () => {
    expect(names('open')).toEqual(['Yoga', 'Read', 'Walk']);
  });
});

describe('urgencyOf with priority', () => {
  const now = new Date(2025, 5, 10, 15).getTime();
  it('lets HIGH and CRITICAL tasks pulse even without a deadline', () => {
    expect(urgencyOf({ dueDate: undefined, completed: false, priority: 'HIGH' }, now)).toBe('soon');
    expect(urgencyOf({ dueDate: undefined, completed: false, priority: 'CRITICAL' }, now)).toBe('overdue');
    expect(urgencyOf({ dueDate: undefined, completed: false, priority: 'MEDIUM' }, now)).toBe('none');
  });
  it('takes the stronger of date and priority, and never pulses once completed', () => {
    expect(urgencyOf({ dueDate: new Date(2025, 5, 9).getTime(), completed: false, priority: 'LOW' }, now)).toBe('overdue');
    expect(urgencyOf({ dueDate: new Date(2025, 5, 10).getTime(), completed: false, priority: 'CRITICAL' }, now)).toBe('overdue');
    expect(urgencyOf({ dueDate: undefined, completed: true, priority: 'CRITICAL' }, now)).toBe('none');
  });
});


import { BUILTIN_PRESETS, DEFAULT_APPEARANCE, MAX_PRESETS, appearanceOf, sanitizeAppearance, sanitizePresets, FRAME_EDGES } from './index';
describe('theme presets', () => {
  it('every built-in preset is already valid (a typo in a style name or setting would be replaced by a default)', () => {
    for (const p of BUILTIN_PRESETS) expect(sanitizeAppearance(p.look)).toEqual(p.look);
    expect(new Set(BUILTIN_PRESETS.map(p => p.id)).size).toBe(BUILTIN_PRESETS.length);
  });
  it('a preset holds the look only: no text size, interface size or other presets', () => {
    expect(Object.keys(DEFAULT_APPEARANCE)).not.toEqual(expect.arrayContaining(['textScale']));
    expect(DEFAULT_APPEARANCE).not.toHaveProperty('uiScale');
    expect(DEFAULT_APPEARANCE).not.toHaveProperty('presets');
    expect(DEFAULT_APPEARANCE.frameTheme).toBe('green_bev');
    expect(appearanceOf({ ...DEFAULT_APPEARANCE, textScale: 2, presets: [{ id: 'x', name: 'y', look: {} }] })).toEqual(DEFAULT_APPEARANCE);
  });
  it('saved presets are cleaned: garbage dropped, names trimmed and capped, at most MAX_PRESETS, bad looks repaired', () => {
    expect(sanitizePresets('nope')).toEqual([]);
    const many = Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({ id: `p${i}`, name: `  Name ${i} `, look: { frameTheme: 'gold', frameEdges: 'bogus' } }));
    const out = sanitizePresets([...many, 7, null]);
    expect(out).toHaveLength(MAX_PRESETS);
    expect(out[0].name).toBe('Name 0');
    expect(FRAME_EDGES).toContain(out[0].look.frameEdges);
    expect(out[0].look.frameTheme).toBe('gold');
    expect(sanitizePresets([{ id: 1, name: 'x'.repeat(60), look: null }])[0].name).toHaveLength(24);
  });
});

describe('weekly and monthly habits count periods, not days', () => {
  const wed = new Date(2026, 0, 7, 12).getTime(), thu = new Date(2026, 0, 8, 12).getTime(), nextMon = new Date(2026, 0, 12, 12).getTime(), skip = new Date(2026, 0, 19, 12).getTime();
  const weekly = { frequency: 'WEEKLY' as const, lastCompleted: wed, streak: 2 };
  it('a week is Monday to Sunday and is done once', () => {
    expect(completedToday(weekly, thu)).toBe(true);
    expect(completedToday(weekly, nextMon)).toBe(false);
    expect(nextStreak(2, wed, thu, 'WEEKLY')).toBe(2);
    expect(nextStreak(2, wed, nextMon, 'WEEKLY')).toBe(3);
    expect(nextStreak(2, wed, skip, 'WEEKLY')).toBe(1);
  });
  it('a missed week or month ends the streak, a quiet day does not', () => {
    expect(effectiveStreak(weekly, nextMon)).toBe(2);
    expect(effectiveStreak(weekly, skip)).toBe(0);
    const monthly = { frequency: 'MONTHLY' as const, lastCompleted: new Date(2026, 0, 31, 12).getTime(), streak: 4 };
    expect(effectiveStreak(monthly, new Date(2026, 1, 10).getTime())).toBe(4);
    expect(effectiveStreak(monthly, new Date(2026, 2, 1).getTime())).toBe(0);
    expect(completedToday(monthly, new Date(2026, 0, 1).getTime())).toBe(true);
  });
});

describe('custom categories', () => {
  it('keeps good ones, drops junk and duplicates, fixes the frame', () => {
    const list = sanitizeCategories([{ id: 'a', name: '  Career ', frame: 'gold' }, { id: 'b', name: 'career', frame: 'red' }, { id: 'a', name: 'Home', frame: 'red' }, { id: 'c', name: 'Home', frame: 'nope' }, { name: 'x' }, null, { id: 'd', name: '   ' }]);
    expect(list).toEqual([{ id: 'a', name: 'Career', frame: 'gold' }, { id: 'c', name: 'Home', frame: 'blue_ornate' }]);
    expect(sanitizeCategories('nope')).toEqual([]);
    expect(sanitizeCategories(Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, name: `n${i}`, frame: 'red' })))).toHaveLength(12);
  });
  it('a name is free unless another category has it', () => {
    const list = [{ id: 'a', name: 'Career', frame: 'gold' }];
    expect(categoryNameFree(list, 'career')).toBe(false);
    expect(categoryNameFree(list, 'Career', 'a')).toBe(true);
    expect(categoryNameFree(list, '  ')).toBe(false);
  });
  it('filters tasks by category', () => {
    const mk = (id: string, ...groups: string[]) => ({ id, title: id, category: 'MIND', priority: 'LOW', difficulty: 0, completed: false, experienceReward: 1, statRewards: { body: 0, mind: 1, soul: 0 }, tags: [], groups: groups.length ? groups : undefined, createdAt: 0, updatedAt: 0 }) as never;
    const { open } = viewTasks([mk('x', 'a'), mk('y'), mk('z', 'b'), mk('w', 'b', 'a')], { category: 'ALL', sort: 'none', showCompleted: false, group: 'a' });
    expect(open.map(t => t.id)).toEqual(['x', 'w']);   // a task in several categories shows under each
  });
});
