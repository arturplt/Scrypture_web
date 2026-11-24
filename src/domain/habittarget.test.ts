import { describe, expect, it } from 'vitest';
import { completeHabit, completedToday, doneInPeriod, effectiveStreak, habitTarget, cleanTarget, targetStreak, type Habit } from './index';
import { sanitizeHabitExtras } from './habitplan';

// Monday 2 Nov 2026 is the start of a week (weeks run Monday to Sunday)
const day = (d: number, h = 9) => new Date(2026, 10, d, h).getTime();
const weekly = (target?: number): Habit => ({ id: 'h', title: 'Run', category: 'BODY', frequency: 'WEEKLY', streak: 0, bestStreak: 0, lastCompleted: null, createdAt: 0, updatedAt: 0, ...(target ? { target } : {}) });
const doOn = (h: Habit, ...days: number[]) => days.reduce((x, d) => completeHabit(x, day(d)), h);

describe('habits done N times a period', () => {
  it('keeps only sensible targets', () => {
    expect(cleanTarget('WEEKLY', 3)).toBe(3);
    expect(cleanTarget('WEEKLY', 12)).toBe(7);
    expect(cleanTarget('MONTHLY', 40)).toBe(28);
    expect(cleanTarget('WEEKLY', 1)).toBeUndefined();
    expect(cleanTarget('DAILY', 3)).toBeUndefined();
    expect(habitTarget({ frequency: 'DAILY', target: 3 })).toBe(1);
    expect(sanitizeHabitExtras({ frequency: 'WEEKLY', target: 3 }).target).toBe(3);
    expect(sanitizeHabitExtras({ frequency: 'DAILY', target: 3 }).target).toBeUndefined();
  });
  it('counts different days, and is open again the next day until the target is met', () => {
    let h = doOn(weekly(3), 2);
    expect(doneInPeriod(h, day(2, 20))).toBe(1);
    expect(completedToday(h, day(2, 20))).toBe(true);    // done today
    expect(completedToday(h, day(3))).toBe(false);       // open again on Tuesday
    h = doOn(h, 3, 5);
    expect(doneInPeriod(h, day(6))).toBe(3);
    expect(completedToday(h, day(6))).toBe(true);        // the week is met
    expect(completedToday(h, day(9))).toBe(false);       // a new week
  });
  it('a streak counts weeks that met the target, and a week under way does not break it', () => {
    let h = doOn(weekly(2), 2, 4);                  // week 1 met
    expect(h.streak).toBe(1);
    h = doOn(h, 10);                                // week 2: one day so far
    expect(h.streak).toBe(1);
    expect(effectiveStreak(h, day(13))).toBe(1);    // still within week 2
    h = doOn(h, 12);                                // week 2 met
    expect(h.streak).toBe(2);
    expect(h.bestStreak).toBe(2);
    expect(effectiveStreak(h, day(17))).toBe(2);    // week 3 under way
    expect(effectiveStreak(h, day(24))).toBe(0);    // week 3 missed
    expect(targetStreak(h, day(24))).toBe(0);
  });
  it('a habit without a target keeps the once-a-week rule', () => {
    let h = doOn(weekly(), 2);
    expect(completedToday(h, day(4))).toBe(true);
    h = doOn(h, 9);
    expect(h.streak).toBe(2);
  });
});
