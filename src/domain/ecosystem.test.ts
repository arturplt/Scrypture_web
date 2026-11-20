import { describe, expect, it } from 'vitest';
import { Ecosystem, FIRE_CLOUD_CAP, MAX_FIRES, WET_TIME, DAMP_TIME, SHORE_DAMP, type Cloud } from './ecosystem';
import { World, GRASS, SAND, WATER, DECO_CONIFER, type TileState } from './worldgen';
import { mulberry32 } from './sanctuary';

const NO_WIND = { enabled: false, strength: 0, dir: 0 };
const tree: TileState = { t: GRASS, v: 0, d: DECO_CONIFER, s: 1 };

/** Bare sand all round (it never burns), so only the tiles a test plants can catch. */
function sand(seed = 5) {
  const w = new World(seed);
  for (let y = -10; y < 60; y++) for (let x = -10; x < 60; x++) w.setTerrain(x, y, SAND);
  return w;
}
const cloud = (id: number, x: number, y: number, o: Partial<Cloud> = {}): Cloud => ({ id, x, y, layer: 1, water: 1, size: 1, age: 40, raining: false, rain: 0, prevRain: 0, rained: new Set(), toSand: false, ...o });
/** A forest block of `w` x `h` trees at (x0, y0). */
function forest(world: World, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) world.set(x, y, tree);
}
/** Light every tree of the block and keep it burning (a huge fuel store) so the test sees the pull, not the burn-out. */
function lightAll(e: Ecosystem, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) e.ignite(x, y);
  for (const f of e.fires.values()) { f.fuel = 1e9; f.total = 1e9; }
}
const run = (e: Ecosystem, seconds: number, dt = 0.25) => { for (let t = 0; t < seconds; t += dt) e.step(dt); };

describe('fire and wet ground', () => {
  it('ground beside water is damp all the time, ground far from it is not', () => {
    const w = sand(); forest(w, 0, 0, 10, 10); w.setTerrain(5, 5, WATER);
    const e = new Ecosystem(w, mulberry32(1), NO_WIND);
    expect(e.moisture(6, 5)).toBe(SHORE_DAMP[0]);       // next to the pond
    expect(e.moisture(7, 6)).toBe(SHORE_DAMP[1]);       // two tiles off
    expect(e.moisture(9, 9)).toBe(0);                   // far away
  });
  it('rain makes the ground wet, then damp, then dry again', () => {
    const w = sand(); forest(w, 0, 0, 20, 20);
    const e = new Ecosystem(w, mulberry32(2), NO_WIND);
    e.clouds.push(cloud(1, 10.5, 10.5, { raining: true, rain: 0.5, layer: 8 }));
    e.step(0.25);
    expect(e.isWet(10, 10)).toBe(true); expect(e.moisture(10, 10)).toBe(1);
    e.clouds.length = 0;
    run(e, WET_TIME + 0.5);
    expect(e.isWet(10, 10)).toBe(false);
    const damp = e.moisture(10, 10); expect(damp).toBeGreaterThan(0.5); expect(damp).toBeLessThan(1);
    run(e, DAMP_TIME);
    expect(e.moisture(10, 10)).toBeLessThanOrEqual(SHORE_DAMP[0]);   // (the rain may have flooded a tile close by: a shore stays damp)
  });
  it('damp ground refuses ignitions and counts them', () => {
    const w = sand(); forest(w, 0, 0, 12, 12); w.setTerrain(6, 6, WATER);
    const e = new Ecosystem(w, mulberry32(3), NO_WIND);
    e.ignite(4, 6);
    for (const f of e.fires.values()) f.fuel = 1e9;
    run(e, 30);
    expect(e.tally.damped).toBeGreaterThan(0);
  });
  it('a big fire pulls a cloud harder than a small one', () => {
    const moved = (w0: number, h0: number) => {
      const w = sand(); forest(w, 30, 20, w0, h0);
      const e = new Ecosystem(w, mulberry32(4), NO_WIND);
      lightAll(e, 30, 20, w0, h0);
      e.clouds.push(cloud(1, 10, 22));
      run(e, 10);
      return e.clouds.find(c => c.id === 1)!.x - 10;
    };
    const big = moved(6, 6), small = moved(2, 2);
    expect(big).toBeGreaterThan(small + 1);
  });
  it('a big fire makes clouds, they rain on it, and the numbers stay in bounds', () => {
    const w = sand(); forest(w, 20, 20, 12, 12);
    const e = new Ecosystem(w, mulberry32(6), NO_WIND);
    lightAll(e, 20, 20, 12, 12);
    const start = e.fires.size;
    expect(start).toBe(144);
    let peak = 0;
    for (let t = 0; t < 240; t += 0.25) {
      e.step(0.25);
      expect(e.fires.size).toBeLessThanOrEqual(MAX_FIRES);
      expect(e.clouds.filter(c => c.fire).length).toBeLessThanOrEqual(FIRE_CLOUD_CAP);
      peak = Math.max(peak, e.clouds.filter(c => c.fire).length);
    }
    expect(e.tally.fireClouds).toBeGreaterThan(0); expect(peak).toBeGreaterThan(0);
    expect(e.tally.fireRain).toBeGreaterThan(0);
    expect(e.tally.doused).toBeGreaterThan(0);
    expect(e.fires.size).toBeLessThan(start);
  });
});

describe('irrigation', () => {
  it('water feeds the land around it, inside the watched area only', () => {
    const w = sand(); for (let y = 10; y < 16; y++) for (let x = 18; x < 24; x++) w.setTerrain(x, y, WATER);
    const e = new Ecosystem(w, mulberry32(8), NO_WIND);
    (e as any).importCloud = () => {};                                       // no rain from outside: only the pond feeds anything
    e.setWatchedArea(0, 0, 20, 30);                                           // the pond is half inside
    run(e, 240);
    let near = 0, outside = 0, far = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
      if (w.terrainAt(x, y) === WATER || w.terrainAt(x, y) === SAND) continue;
      if (x > 20) outside++; else if (x < 12) far++; else near++;
    }
    expect(e.tally.irrigated).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(0);
    expect(far).toBe(0);                                                      // too far from the water for it to reach
    expect(outside).toBe(0);                                                  // and nothing grows where nobody is watching
  });
});
