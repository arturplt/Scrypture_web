import { describe, expect, it } from 'vitest';
import { SAYS_EVERY_MS, SAYS_FIRST_MS, SAYS_KEYS, SAYS_SHOW_MS, bobrSays, saysSlot, type SaysInput } from './bobrSays';
import { en } from '../i18n/en';

const base: SaysInput = { stage: 'YOUNG', emotion: 'NEUTRAL', hour: 14, doneToday: 1 };
const many = (inp: SaysInput) => Array.from({ length: 200 }, (_, i) => bobrSays(inp, i).key);

describe('bobrSays', () => {
  it('every line it can say is translated', () => {
    for (const k of SAYS_KEYS) expect(en, k).toHaveProperty(k);
  });
  it('the same slot always gives the same line', () => {
    expect(bobrSays(base, 42)).toEqual(bobrSays(base, 42));
  });
  it('a calm day uses the lines for his stage', () => {
    const keys = new Set(many(base));
    expect([...keys].every(k => k.startsWith('saysYoung') || k === 'saysNoneYet' || k === 'saysEvening')).toBe(true);
    expect(keys.size).toBeGreaterThan(2);
  });
  it('hungry or sleepy: always about that', () => {
    expect(many({ ...base, emotion: 'HUNGRY' }).every(k => k.startsWith('saysHungry'))).toBe(true);
    expect(many({ ...base, emotion: 'SLEEPY', hour: 1 }).every(k => k.startsWith('saysSleepy'))).toBe(true);
  });
  it('sad, excited or playful: mostly about that, sometimes not', () => {
    const sad = many({ ...base, emotion: 'SAD' }).filter(k => k.startsWith('saysSad')).length;
    expect(sad).toBeGreaterThan(110); expect(sad).toBeLessThan(180);
  });
  it('a good day is praised with the count', () => {
    const lines = Array.from({ length: 100 }, (_, i) => bobrSays({ ...base, doneToday: 4 }, i));
    expect(lines.some(l => l.key === 'saysProud' && l.n === 4)).toBe(true);
  });
  it('a morning with nothing done yet asks what comes first', () => {
    expect(many({ ...base, hour: 8, doneToday: 0 })).toContain('saysMorning');
    expect(many({ ...base, hour: 8, doneToday: 2 })).not.toContain('saysMorning');
  });
});

describe('saysSlot', () => {
  const since = 1_000_000;
  it('quiet at first, then shows for a while every period', () => {
    expect(saysSlot(since + SAYS_FIRST_MS - 1, since).showing).toBe(false);
    const a = saysSlot(since + SAYS_FIRST_MS, since), b = saysSlot(since + SAYS_FIRST_MS + SAYS_SHOW_MS + 1, since), c = saysSlot(since + SAYS_FIRST_MS + SAYS_EVERY_MS, since);
    expect(a.showing).toBe(true); expect(b.showing).toBe(false); expect(c.showing).toBe(true);
    expect(c.slot).toBe(a.slot + 1); expect(b.slot).toBe(a.slot);
  });
});
