import { describe, expect, it } from 'vitest';
import { paceMs } from './syncPace';

describe('sync pace', () => {
  it('leaves a calm device alone and slows one that keeps uploading', () => {
    const now = 1_000_000;
    expect(paceMs([], now, 400)).toBe(400);
    expect(paceMs([now - 5000, now - 4000], now, 400)).toBe(400);
    expect(paceMs([1, 2, 3, 4, 5].map(i => now - i * 1000), now, 400)).toBe(30_000);
    expect(paceMs([1, 2, 3, 4, 5].map(i => now - 70_000 - i * 1000), now, 400)).toBe(400);   // those were long ago
    expect(paceMs([1, 2, 3, 4, 5].map(i => now - i * 1000), now, 60_000)).toBe(60_000);   // never shortens a longer wait
  });
});
