import { describe, expect, it } from 'vitest';
import { newWalker, REACH, stepWalker } from './wander';

describe('Bóbr wandering', () => {
  it('walks to an item lying on the ground and picks it up', () => {
    const w = newWalker(), items = [0.4];
    let got = -1;
    for (let i = 0; i < 20 * 60 && got < 0; i++) got = stepWalker(w, 0.05, items, () => 0.1);   // rnd 0.1: always heads for the nearest item
    expect(got).toBe(0);
    expect(Math.abs(items[0] - w.pos)).toBeLessThanOrEqual(REACH + 0.01);
    expect(w.act).toBe('pick');
  });
  it('stops and looks around when nothing calls him', () => {
    const w = newWalker(), seen = new Set<string>();
    for (let i = 0; i < 60 * 40; i++) { stepWalker(w, 1 / 60, []); seen.add(w.act); }
    expect(seen.has('walk') && seen.has('idle') && seen.has('look')).toBe(true);
  });
});
