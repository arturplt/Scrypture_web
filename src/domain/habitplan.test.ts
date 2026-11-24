import { describe, expect, it } from 'vitest';
import { dayPlan, habitHistory, habitLog, habitSlot, habitsOn, isRuleDay, logWith, moveHabit, repeatDays, sanitizeHabitExtras, slotDone, slotTime, setSlotTime, type Habit, type HabitPlan } from './index';

const D = (n: number, m = 0) => new Date(2026, m, n).getTime();   // January 2026: the 5th is a Monday
const habit = (o: Partial<Habit> = {}): Habit => ({ id: 'h', title: 'h', category: 'BODY', frequency: 'WEEKLY', streak: 0, bestStreak: 0, lastCompleted: null, createdAt: 0, updatedAt: 0, ...o });

describe('a habit on the planner repeats by its cycle', () => {
  it('daily every day, weekly on its weekday, monthly on its date (the last day of a shorter month)', () => {
    expect([4, 5, 6, 20].map(n => isRuleDay('DAILY', D(5), D(n)))).toEqual([false, true, true, true]);
    expect([5, 6, 12, 13, 26].map(n => isRuleDay('WEEKLY', D(5), D(n)))).toEqual([true, false, true, false, true]);
    expect(isRuleDay('WEEKLY', D(5), D(29, 2))).toBe(false); expect(isRuleDay('WEEKLY', D(5), D(30, 2))).toBe(true);   // across the clock change
    expect(isRuleDay('MONTHLY', D(31), D(28, 1))).toBe(true); expect(isRuleDay('MONTHLY', D(31), D(27, 1))).toBe(false);
    expect(isRuleDay('MONTHLY', D(31), D(31, 2))).toBe(true); expect(isRuleDay('MONTHLY', D(31), D(30, 2))).toBe(false);
    expect(repeatDays(D(31), 'MONTHLY', 3)).toEqual([D(31), D(28, 1), D(31, 2)]);
    expect(repeatDays(D(5), 'WEEKLY', 3)).toEqual([D(5), D(12), D(19)]);
    expect(repeatDays(D(30), 'DAILY', 3)).toEqual([D(30), D(31), D(1, 1)]);
  });
  it('a day has the planned habits whose turn it is, timed ones last', () => {
    const a = habit({ id: 'a', title: 'b-swim', plan: { start: D(5), time: 600 } }), b = habit({ id: 'b', title: 'a-read', frequency: 'DAILY', plan: { start: D(1) } });
    expect(habitsOn([a, b, habit({ id: 'c' })], D(12)).map(s => s.habit.id)).toEqual(['b', 'a']);
    expect(habitsOn([a, b], D(13)).map(s => s.habit.id)).toEqual(['b']);
    expect(habitSlot(habit(), D(5))).toBeNull();
  });
  it('moving one turn leaves the others; moving all future ones starts the series again from the new day', () => {
    const plan: HabitPlan = { start: D(5), time: 600 };
    const one = moveHabit(plan, D(12), D(14), 'one');
    expect(one).toEqual({ start: D(5), time: 600, moved: { [D(12)]: D(14) } });
    const h = habit({ plan: one });
    expect([5, 12, 14, 19].map(n => habitSlot(h, D(n))?.ruleDay)).toEqual([D(5), undefined, D(12), D(19)]);
    expect(moveHabit(one, D(12), D(12), 'one')).toEqual(plan);                                  // dragged back: the move is forgotten
    const all = moveHabit(one, D(19), D(22), 'all');
    expect(all).toEqual({ start: D(22), time: 600, moved: { [D(12)]: D(14) } });               // the earlier single move is kept
    expect(moveHabit(one, D(12), D(15), 'all')).toEqual({ start: D(15), time: 600 });           // a single move from then on is dropped
    expect([22, 26, 29].map(n => !!habitSlot(habit({ plan: all }), D(n)))).toEqual([true, false, true]);
  });
  it('a turn counts as done on its day, a weekly one within three days, a monthly one within its month', () => {
    const slot = (h: Habit, n: number) => habitSlot(h, D(n))!;
    expect(slotDone(slot(habit({ frequency: 'DAILY', plan: { start: D(1) }, log: [D(6)] }), 7))).toBe(false);
    expect(slotDone(slot(habit({ frequency: 'DAILY', plan: { start: D(1) }, log: [D(7)] }), 7))).toBe(true);
    const weekly = (log: number[]) => slotDone(slot(habit({ plan: { start: D(7) }, log }), 14));
    expect([[D(11)], [D(17)], [D(10)], [D(18)]].map(weekly)).toEqual([true, true, false, false]);
    expect(slotDone(slot(habit({ frequency: 'MONTHLY', plan: { start: D(15) }, log: [D(2)] }), 15))).toBe(true);
    expect(slotDone(slot(habit({ frequency: 'MONTHLY', plan: { start: D(15) }, log: [D(2, 1)] }), 15))).toBe(false);
  });
  it('a weekly habit with a target of N days is on the board N days a week, spread out, and each turn is done in order', () => {
    expect([5, 6, 7, 8, 9, 10, 11, 12, 14].map(n => isRuleDay('WEEKLY', D(5), D(n), 3))).toEqual([true, false, true, false, false, true, false, true, true]);
    expect([5, 8, 9, 10].map(n => isRuleDay('WEEKLY', D(5), D(n), 2))).toEqual([true, false, true, false]);   // 0 and 4 days in
    expect(isRuleDay('WEEKLY', D(5), D(6), 1)).toBe(false);                                                  // no target: one a week as before
    const h = (log: number[]) => habit({ target: 3, plan: { start: D(5) }, log });
    const done = (log: number[], n: number) => slotDone(habitSlot(h(log), D(n))!);
    expect(habitsOn([h([])], D(7)).map(s => s.ruleDay)).toEqual([D(7)]);
    expect([5, 7, 10].map(n => done([], n))).toEqual([false, false, false]);
    expect([5, 7, 10].map(n => done([D(5)], n))).toEqual([true, false, false]);            // one done this week: the first turn only
    expect([5, 7, 10].map(n => done([D(6), D(8)], n))).toEqual([true, true, false]);       // done on other days than planned still count in order
    expect(done([D(12)], 7)).toBe(false);                                                   // next week's do not
    // a plan started midweek (Wed the 7th: turns on Wed, Fri and the next Mon) counts the habit's own Monday-to-Sunday weeks
    const mid = (log: number[], n: number) => slotDone(habitSlot(habit({ target: 3, plan: { start: D(7) }, log }), D(n))!);
    expect([7, 9].map(n => mid([D(6)], n))).toEqual([true, false]);       // done on the Tuesday: the first turn of that week
    expect([7, 9, 12].map(n => mid([D(10)], n))).toEqual([true, false, false]);
    expect(mid([D(8), D(11)], 9)).toBe(true);
  });
  it('today only asks for a planned habit on its day, and not when its turn is done', () => {
    const NOW = D(14) + 10 * 3_600_000, plan = { start: D(7) };
    const ids = (habits: Habit[], now = NOW) => dayPlan({ events: [], shortlist: [], tasks: [], habits }, now, now).habits.map(h => h.id);
    expect(ids([habit({ id: 'free' }), habit({ id: 'due', plan }), habit({ id: 'other', plan: { start: D(8) } }), habit({ id: 'early', plan, log: [D(12)] })])).toEqual(['free', 'due']);
    expect(ids([habit({ id: 'due', plan })], D(15) + 1)).toEqual([]);
  });
});

describe('the log of completed habits', () => {
  it('adds each day once, oldest first; an old habit has only its last day', () => {
    expect(habitLog(habit())).toEqual([]);
    expect(habitLog(habit({ lastCompleted: D(3) + 5000 }))).toEqual([D(3)]);
    expect(logWith(habit({ log: [D(1), D(2)] }), D(2) + 99)).toEqual([D(1), D(2)]);
    expect(logWith(habit({ lastCompleted: D(1) + 9 }), D(2) + 99)).toEqual([D(1), D(2)]);
  });
  it('lists what was done on each of the last days, today first', () => {
    const a = habit({ id: 'a', log: [D(5), D(7)] }), b = habit({ id: 'b', log: [D(7)] });
    expect(habitHistory([a, b], D(7) + 500, 7).map(x => [x.day, x.habits.map(h => h.id)])).toEqual([[D(7), ['a', 'b']], [D(5), ['a']]]);
    expect(habitHistory([a, b], D(7), 2)).toHaveLength(1);
  });
  it('keeps only a valid plan and log from a save', () => {
    expect(sanitizeHabitExtras({ plan: { start: D(5) + 77, time: 600.4, minutes: 0, moved: { [D(12)]: D(14) + 5, x: 1, [D(19)]: 'no' } }, log: [D(2), 'x', D(1) + 9, D(2)] }))
      .toEqual({ plan: { start: D(5), time: 600, moved: { [D(12)]: D(14) } }, log: [D(1), D(2)] });
    expect(sanitizeHabitExtras({ plan: 'junk', log: 7 })).toEqual({});
  });
});

describe('the time of one occurrence', () => {
  const plan: HabitPlan = { start: D(5), time: 480, minutes: 30 };
  const h = habit({ frequency: 'DAILY', plan });
  const slot = (d: number) => habitSlot(h, D(d))!;
  it('one turn gets a time of its own, the rest keep the series time', () => {
    const one = setSlotTime(plan, D(6), 600, 'one');
    expect(one).toMatchObject({ time: 480, times: { [String(D(6))]: 600 } });
    const hh = habit({ frequency: 'DAILY', plan: one });
    expect(slotTime(habitSlot(hh, D(6))!)).toBe(600);
    expect(slotTime(habitSlot(hh, D(7))!)).toBe(480);
    expect(slotTime(slot(6))).toBe(480);
  });
  it('a turn can have no time, and putting it back to the series time removes its entry', () => {
    const none = setSlotTime(plan, D(6), undefined, 'one');
    expect(slotTime(habitSlot(habit({ frequency: 'DAILY', plan: none }), D(6))!)).toBeUndefined();
    expect(setSlotTime(none, D(6), 480, 'one').times).toBeUndefined();
  });
  it('all of them sets the series time and drops the times of their own; times snap to quarter hours', () => {
    const mixed = setSlotTime(plan, D(6), 600, 'one');
    expect(setSlotTime(mixed, D(7), 727, 'all')).toEqual({ start: D(5), time: 720, minutes: 30 });
    expect(setSlotTime(mixed, D(7), undefined, 'all')).toEqual({ start: D(5), minutes: 30 });
  });
  it('a bad saved times map is cleaned', () => {
    const out = sanitizeHabitExtras({ plan: { start: D(5), times: { [String(D(6))]: 600, x: 5, [String(D(7))]: 99999, [String(D(8))]: -1 } } });
    expect(out.plan?.times).toEqual({ [String(D(6))]: 600, [String(D(8))]: -1 });
  });
});
