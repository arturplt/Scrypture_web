import { describe, expect, it } from 'vitest';
import { World, GRASS, DECO_BUSH, DECO_NONE } from './worldgen';
import { BerryPatch, BERRY_REGROW, BERRY_YIELD, isBerryBush, sanitizeBerries } from './berries';

/** A meadow with a bush on every tile of a 20 x 20 square. */
function scene(seed = 7) {
  const w = new World(seed);
  for (let y = -5; y < 25; y++) for (let x = -5; x < 25; x++) w.setTerrain(x, y, GRASS);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) w.set(x, y, { t: GRASS, v: 0, d: DECO_BUSH, s: 1 });
  const all: [number, number][] = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (isBerryBush(seed, x, y)) all.push([x, y]);
  return { w, all };
}

describe('berries', () => {
  it('about half the bushes bear berries, the same ones every time', () => {
    const { all } = scene();
    expect(all.length).toBeGreaterThan(140); expect(all.length).toBeLessThan(260);
    expect(scene().all).toEqual(all);
  });
  it('a ripe bush is picked clean and grows back', () => {
    const { w, all } = scene(), p = new BerryPatch(w), [x, y] = all[0];
    expect(p.ripe(x, y)).toBe(true);
    expect(p.pick(x, y)).toBe(BERRY_YIELD); expect(p.dirty).toBe(true);
    expect(p.ripe(x, y)).toBe(false); expect(p.pick(x, y)).toBe(0);
    p.step(BERRY_REGROW - 1); expect(p.ripe(x, y)).toBe(false);
    p.step(2); expect(p.ripe(x, y)).toBe(true);
  });
  it('only a bush that stands bears berries', () => {
    const { w, all } = scene(), p = new BerryPatch(w), [x, y] = all[0];
    w.set(x, y, { t: GRASS, v: 0, d: DECO_NONE, s: 1 });               // burnt down or eaten
    expect(p.ripe(x, y)).toBe(false); expect(p.pick(x, y)).toBe(0);
  });
  it('finds the nearest ripe bush within reach', () => {
    const { w, all } = scene(), p = new BerryPatch(w), [x, y] = all[0];
    expect(p.near(x + 0.5, y + 0.5)).toEqual({ x, y });
    expect(p.near(-4, -4)).toBeNull();
    p.pick(x, y);
    expect(p.near(x + 0.5, y + 0.5, 0.4)).toBeNull();
  });
  it('picked bushes are saved with the time they still need', () => {
    const { w, all } = scene(), p = new BerryPatch(w), [x, y] = all[0];
    p.pick(x, y); p.step(60);
    const saved = sanitizeBerries(JSON.parse(JSON.stringify(p.toSaved())));
    expect(saved).toEqual([[x, y, BERRY_REGROW - 60]]);
    const p2 = new BerryPatch(w, saved);
    expect(p2.ripe(x, y)).toBe(false); p2.step(BERRY_REGROW - 59); expect(p2.ripe(x, y)).toBe(true);
    expect(sanitizeBerries([[1, 2], 'x', [1.5, 2, 3], [3, 4, 9999], [3, 4, 1]])).toEqual([[3, 4, BERRY_REGROW]]);
    expect(sanitizeBerries(null)).toEqual([]);
  });
});
