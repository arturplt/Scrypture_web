import { beforeAll, describe, expect, it } from 'vitest';
import { Pond, type PondEnv } from './hydrology';
import { World, WATER, keyX, keyY } from './worldgen';
import { setLakeData, lakeMetresAt, groundTiles } from './lakedistrict';
import { Ecosystem } from './ecosystem';
import { mulberry32 } from './sanctuary';

describe('a tarn Pond (pure)', () => {
  /** A bowl of radius 6 around (0,0) with a rim at 3 m, and ground falling away west of the rim's west side. */
  const env: PondEnv = { h: (x, y) => { const r = Math.hypot(x, y); return r <= 6 ? 0.5 * r : x < 0 ? 3 - 0.3 * (-x - 5) : 3 + 0.01 * r; }, wet: () => false, ok: () => true };
  it('fills the bowl and stops at the rim where the water would run out, naming that tile', () => {
    const p = new Pond(env, 0, 0, Infinity, true);
    while (p.grow()) { /* fills */ }
    expect(p.spill).not.toBeNull();
    const [sx, sy] = p.spill!;
    expect(sx).toBeLessThan(0);                                  // it runs out to the west, where the ground falls
    expect(env.h(sx, sy)).toBeCloseTo(3, 0);
    expect(p.level).toBeLessThanOrEqual(env.h(sx, sy));
    for (const [x, y] of p.tiles) expect(env.h(x, y)).toBeLessThanOrEqual(env.h(sx, sy));
  });
  it('costs more volume to lift a bigger sheet, and gives the same back', () => {
    const p = new Pond(env, 0, 0, Infinity, true);
    const c1 = p.cost()!; p.grow();
    for (let i = 0; i < 20; i++) p.grow();
    expect(p.cost()!).toBeGreaterThan(c1);
    expect(p.downCost()!).toBeGreaterThan(0);
  });
  it('keeps its base tiles when it shrinks', () => {
    const p = new Pond(env, 0, 0, Infinity, true); p.setBase([[0, 0], [1, 0]]);
    p.grow(); p.grow();
    while (p.shrink()) { /* gives back */ }
    expect(p.tiles.length).toBe(2);
  });
});

/** A hollow: ground rises 0.5 m a tile round (30, 0) up to a 43 m rim 3.5 tiles out, falls away west of it, and rises a hair elsewhere (no flat ground to count as hollows). */
const N = 120;
beforeAll(() => {
  const rgba = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - N / 2, y = j - N / 2, r = Math.hypot(x - 30, y);
    const m = r <= 3.5 ? 40 + 0.86 * r : x < 27 ? 43 - 0.3 * (27 - x) : 43 + 0.01 * r, dm = Math.round(m * 10), k = (j * N + i) * 4;
    rgba[k] = dm >> 8; rgba[k + 1] = dm & 255; rgba[k + 2] = 0; rgba[k + 3] = 255;
  }
  setLakeData(N, N, rgba);
});
const quiet = (e: Ecosystem) => { (e as any).importCloud = () => {}; (e as any).spawnCloud = () => {}; e.clouds.length = 0; };

describe('a tarn on the Lake District ground', () => {
  it('forms in a hollow, fills along the contours, spills west over the rim, and shrinks in a dry spell', () => {
    const w = new World(7, undefined, 'lakedistrict'), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 });
    e.setWatchedArea(-40, -40, 40, 40); e.step(0.1); quiet(e);
    const packets = () => (e as any).packets as { x: number; y: number; n: number }[];   // (a new array each step)
    expect(w.terrainAt(30, 0)).not.toBe(WATER);
    let spilled = false, sawSpill = false, most = 0;
    for (let t = 0; t < 900; t += 0.5) {
      if (t < 400 && packets().length < 10) packets().push({ x: 30, y: 0, n: 0 });          // a steady rain on the hollow's slopes
      e.step(0.5);
      for (const q of e.tarns) { if (q.pond.spill) sawSpill = true; most = Math.max(most, q.pond.tiles.length); }
      if ([...((e as any).trickle as Map<number, number>).keys()].some(k => keyX(k) < 26 && Math.abs(keyY(k)) <= 8)) spilled = true;
    }
    const tarn = [...e.tarns][0];
    expect(tarn).toBeDefined();
    const p = tarn.pond;
    expect(most).toBeGreaterThan(10);
    for (const [x, y] of p.tiles) { expect(w.terrainAt(x, y)).toBe(WATER); expect(lakeMetresAt(x, y)).toBeLessThanOrEqual(p.level + 1e-6); }
    expect(p.level).toBeLessThanOrEqual(43.01);
    expect(sawSpill).toBe(true);                                                          // it filled to the rim
    expect(spilled).toBe(true);                                                           // and ran west over it into a beck
    if (p.tiles.length) expect(groundTiles(p.tiles[0][0], p.tiles[0][1])).toBeCloseTo(p.level / 50 * 1.5, 3);   // a flat sheet
    const grown = p.tiles.length;
    for (let t = 0; t < 4000; t += 0.5) e.step(0.5);                                  // no rain: the sun lowers it
    expect(p.tiles.length).toBeLessThan(grown);
  });
});

describe('a dam pond beside a lake', () => {
  it('stops where its water would run into the lake instead of standing above it', () => {
    // ground rises 0.5 m a tile from a lake at x <= -3 (water, 40 m); the pond is seeded at (0,0) with a high cap
    const env: PondEnv = { h: x => 40 + 0.5 * (x + 3), wet: x => x <= -3, ok: () => true, lake: x => x <= -3 };
    const p = new Pond(env, 0, 0, 100, true);
    while (p.grow()) { /* fills */ }
    expect(p.spill).not.toBeNull();
    expect(p.level).toBeLessThanOrEqual(41.6);               // only as high as the shore tile that touches the lake
    for (const [x] of p.tiles) expect(x).toBeGreaterThanOrEqual(-2);
  });
});
