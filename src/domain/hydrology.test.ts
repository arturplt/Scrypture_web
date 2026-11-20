import { beforeAll, describe, expect, it } from 'vitest';
import { Pond, DAM_TILE_SHARE, POND_MAX, type PondEnv } from './hydrology';
import { World, WATER, GRASS, SAND, keyX, keyY, tileKey } from './worldgen';
import { setLakeData, lakeMetresAt, groundTiles, LAKE_RIVER } from './lakedistrict';
import { Ecosystem } from './ecosystem';
import { BeaversManager, POND_TICK, damBroken, type Picked } from './beavers';
import { mulberry32 } from './sanctuary';

/** A bowl: ground rises 1 m per tile away from (0,0). */
const bowl: PondEnv = { h: (x, y) => Math.hypot(x, y), wet: () => false, ok: () => true };

describe('Pond (pure)', () => {
  it('floods lowest ground first, never above its cap, and the level is the highest tile', () => {
    const p = new Pond(bowl, 0, 0, 3);
    let last = -1;
    for (let t = p.grow(); t; t = p.grow()) { const h = bowl.h(t[0], t[1]); expect(h).toBeGreaterThanOrEqual(last); last = h; }
    expect(p.tiles.length).toBeGreaterThan(10);
    for (const [x, y] of p.tiles) expect(bowl.h(x, y)).toBeLessThanOrEqual(3);
    expect(p.level).toBeLessThanOrEqual(3);
    expect(p.next()).toBeNull();
  });
  it('a higher cap holds more, and a size limit applies', () => {
    expect(Pond.estimate(bowl, 0, 0, 5)).toBeGreaterThan(Pond.estimate(bowl, 0, 0, 3));
    expect(Pond.estimate(bowl, 0, 0, 1000)).toBe(POND_MAX);
  });
  it('stays on its own side of the dam', () => {
    const half: PondEnv = { ...bowl, ok: (_x, y) => y > 0 };
    const p = new Pond(half, 0, 2, 6); while (p.grow()) { /* fills */ }
    expect(p.tiles.length).toBeGreaterThan(5);
    for (const [, y] of p.tiles) expect(y).toBeGreaterThan(0);
  });
  it('gives tiles back highest first when the cap falls', () => {
    const p = new Pond(bowl, 0, 0, 4); while (p.grow()) { /* fills */ }
    const n = p.tiles.length; p.cap = 2;
    expect(p.over).toBe(true);
    while (p.over) { const t = p.shrink()!; expect(bowl.h(t[0], t[1])).toBeGreaterThan(2); }
    expect(p.tiles.length).toBeLessThan(n);
    for (const [x, y] of p.tiles) expect(bowl.h(x, y)).toBeLessThanOrEqual(2);
    p.cap = 4; while (p.grow()) { /* fills again */ }
    expect(p.tiles.length).toBe(n);
  });
});

/** A valley 120 tiles square: a stream down the middle (x = 0) falling 0.2 m a tile to the south, sides rising 3 m a tile. */
const N = 120;
beforeAll(() => {
  const rgba = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - N / 2, y = j - N / 2, dm = Math.round((20 + 3 * Math.abs(x) + 0.2 * (N / 2 - y)) * 10), k = (j * N + i) * 4;
    rgba[k] = dm >> 8; rgba[k + 1] = dm & 255; rgba[k + 2] = x === 0 ? LAKE_RIVER : 0; rgba[k + 3] = 255;
  }
  setLakeData(N, N, rgba);
});
const hilly = () => {
  const w = new World(7, undefined, 'lakedistrict'), e = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 });
  const picked: Picked = { sticks: new Set(), stones: new Set() };
  return { w, e, m: new BeaversManager(w, e, mulberry32(2), picked) };
};

describe('a pond on the Lake District ground', () => {
  it('floods flat sheets that stop at the dam crest, upstream only', () => {
    const { w, e, m } = hilly(), c = m.found('t', 0, 0, false)!;
    expect(c).not.toBeNull();
    const stream = c.dam.find(d => w.terrainAt(d.x, d.y) === WATER)!;
    expect(stream).toBeDefined();
    const dy = c.dam[0].y, crest = Math.min(...c.dam.map(d => lakeMetresAt(d.x, d.y))) + DAM_TILE_SHARE * 50   /* (the synthetic map is a 50 m tile map) */;
    // one straight line across the valley, ending against ground as high as the crest on both sides
    expect(c.dam.length).toBeGreaterThan(3);
    for (const d of c.dam) expect(d.y).toBe(dy);
    expect(lakeMetresAt(c.dam[0].x - 1, dy)).toBeGreaterThanOrEqual(crest - 1e-6);
    expect(lakeMetresAt(c.dam[c.dam.length - 1].x + 1, dy)).toBeGreaterThanOrEqual(crest - 1e-6);
    expect(c.py).toBeLessThan(dy);                       // the seed lies uphill (north: the ground rises that way)
    c.done = true; (m as any).holds(c, true);
    for (let t = 0; t < 400; t += POND_TICK) { c.pondAcc = POND_TICK; (m as any).step(0); if (!e.growHeightPond(c.pond!)) break; }
    const tiles = c.pond!.tiles;
    expect(tiles.length).toBeGreaterThanOrEqual(5);
    for (const [x, y] of tiles) { expect(w.terrainAt(x, y)).toBe(WATER); expect(lakeMetresAt(x, y)).toBeLessThanOrEqual(crest + 1e-6); expect(y).toBeLessThan(dy); expect(groundTiles(x, y)).toBeCloseTo(c.pond!.level / 50 * 1.5, 4); }   // (the corner is held at the water level)
    expect(groundTiles(tiles[0][0] + 0.5, tiles[0][1] + 0.5)).toBeGreaterThan(0);
    // pond shape follows the valley: wider near the dam than far up it is not required, but it must not touch the far hillside
    for (const [x] of tiles) expect(Math.abs(x)).toBeLessThanOrEqual(Math.ceil((crest - 20) / 3) + 1);
  });
  it('a broken dam lets the pond drain, tile by tile, back to land', () => {
    const { w, e, m } = hilly(), c = m.found('t', 0, 0, false)!;
    c.done = true; (m as any).holds(c, true);
    while (e.growHeightPond(c.pond!)) { /* fills */ }
    const tiles = c.pond!.tiles.slice(), before = groundTiles(tiles[0][0], tiles[0][1]);
    c.done = false; (m as any).holds(c, false);
    while (e.drainHeightPond(c.pond!)) { /* empties */ }
    expect(c.pond!.tiles.length).toBe(0);
    for (const [x, y] of tiles) expect([GRASS, SAND]).toContain(w.terrainAt(x, y));
    expect(groundTiles(tiles[0][0], tiles[0][1])).not.toBeCloseTo(before, 3);
    void damBroken;
  });
});

describe('rain on the Lake District ground', () => {
  it('runs downhill, turns the tiles it keeps crossing into a stream, and the stream dries when the rain stops', () => {
    const w = new World(7, undefined, 'lakedistrict'), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 });
    e.setWatchedArea(-40, -40, 40, 40); e.step(0.1);
    // a slope with no stream on it: x = 30..34 rises 0.4 m a tile away from the stream at x = 0, so water runs west toward it; shed many packets from one tile
    const sx = 30, sy = 0, hh = (x: number, y: number) => w.metresAt(x, y);
    for (let i = 0; i < 40; i++) { (e as any).packets.push({ x: sx, y: sy, n: 0 }); }
    const path: [number, number][] = [];
    for (let t = 0; t < 120; t += 0.2) { e.step(0.2); }
    // the ground along the line the packets took is wet (grass, not water) except where a steady line of runoff has cut a beck; the tile where it meets the real stream at x = 0 turns to water too
    const becks = (e as any).becks as Set<number>;
    const wet = [...e.wetUntil.keys()].map(k => [keyX(k), keyY(k)] as [number, number]).filter(([x, y]) => x > 0 && x < sx && y >= sy - 2 && y <= sy + 40);   // (it winds: steepest of 8 ways, so it drifts south as it goes west)
    expect(wet.length).toBeGreaterThan(5);
    for (const [x, y] of wet.filter(([x]) => x > 1)) if (!becks.has(tileKey(x, y))) expect(w.terrainAt(x, y)).not.toBe(WATER);
    const made = [...e.streams].map(k => [keyX(k), keyY(k)] as [number, number]);
    for (const [x, y] of made) { expect(w.terrainAt(x, y)).toBe(WATER); if (!becks.has(tileKey(x, y))) expect(Math.abs(x)).toBeLessThanOrEqual(1); }
    expect(made.length).toBeGreaterThan(0);
    void path;
    // no more rain: the counts fade and the stream dries to the ground the generator made
    (e as any).importCloud = () => {}; (e as any).spawnCloud = () => {}; e.clouds.length = 0; (e as any).packets.length = 0;   // a dry spell: no clouds, no runoff
    for (let t = 0; t < 600; t += 0.5) e.step(0.5);
    expect(e.streams.size).toBe(0);
    for (const [x, y] of made) expect(w.terrainAt(x, y)).not.toBe(WATER);
  });
});
