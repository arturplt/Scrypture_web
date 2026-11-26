import { describe, expect, it } from 'vitest';
import { COUNT_MAX, addXP, cleanCount, initialStats } from './progress';


describe('counters are whole numbers and bounded', () => {
  it('cleanCount floors, never goes below 0 and stops at COUNT_MAX', () => {
    expect(cleanCount(12.7)).toBe(12); expect(cleanCount(-3)).toBe(0); expect(cleanCount(NaN)).toBe(0); expect(cleanCount('x')).toBe(0);
    expect(cleanCount(2.1e53)).toBe(COUNT_MAX); expect(cleanCount(Infinity)).toBe(COUNT_MAX);
  });
  it('XP and stat points never exceed the bound or turn fractional', () => {
    const big = { ...initialStats(), totalExperiencePoints: COUNT_MAX - 1 };
    expect(addXP(big, 50).stats.totalExperiencePoints).toBe(COUNT_MAX);
    expect(addXP(initialStats(), 10.6).stats.totalExperiencePoints).toBe(10);
  });
});
