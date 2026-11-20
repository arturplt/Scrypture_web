import { beforeAll, describe, expect, it } from 'vitest';
import { Ecosystem, MAX_BECK_TILES } from './ecosystem';
import { World, WATER, SAND, tileKey, keyX, keyY } from './worldgen';
import { setLakeData } from './lakedistrict';
import { mulberry32 } from './sanctuary';

/** Plain ground that falls 0.4 m a tile to the west everywhere: runoff from a packet runs west along a line. */
const N = 120;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
beforeAll(() => {
  const rgba = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dm = Math.round((60 + 0.4 * i) * 10), k = (j * N + i) * 4;
    rgba[k] = dm >> 8; rgba[k + 1] = dm & 255; rgba[k + 2] = 0; rgba[k + 3] = 255;
  }
  setLakeData(N, N, rgba);
});

function scene() {
  const w = new World(7, undefined, 'lakedistrict'), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 });
  e.setWatchedArea(-40, -40, 40, 40); e.step(0.1);
  (e as any).importCloud = () => {}; (e as any).spawnCloud = () => {}; e.clouds.length = 0;
  const packets = () => (e as any).packets as { x: number; y: number; n: number }[];
  return { w, e, packets };
}

describe('becks', () => {
  it('a line of runoff turns into a beck with stones on its banks, and dries back when it stops', () => {
    const { w, e, packets } = scene();
    for (let t = 0; t < 600; t += 0.5) { if (packets().length < 6) { packets().push({ x: 10, y: 0, n: 0 }); packets().push({ x: 10, y: 6, n: 0 }); } e.step(0.5); }
    const beckMap = (e as any).becks as Map<number, number>, becks = [...beckMap.keys()];
    expect(e.tally.becks).toBeGreaterThan(2);
    expect(becks.length).toBeLessThanOrEqual(MAX_BECK_TILES);
    expect(new Set(beckMap.values()).size).toBe(1);                           // one line only, though packets started in two places
    for (const k of becks) {                                                   // one tile wide: at most 2 neighbours, which do not touch each other
      const nb = N8.map(([dx, dy]) => [keyX(k) + dx, keyY(k) + dy] as [number, number]).filter(([nx, ny]) => beckMap.has(tileKey(nx, ny)));
      expect(nb.length).toBeLessThanOrEqual(2);
      if (nb.length === 2) expect(Math.max(Math.abs(nb[0][0] - nb[1][0]), Math.abs(nb[0][1] - nb[1][1]))).toBeGreaterThanOrEqual(2);
    }
    for (const k of becks) expect(w.terrainAt(keyX(k), keyY(k))).toBe(WATER);
    expect(e.tally.bankRocks).toBeGreaterThan(0);
    let rocks = 0;
    for (const k of becks) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.stateAt(keyX(k) + dx, keyY(k) + dy).v === 2) rocks++;
    expect(rocks).toBeGreaterThan(0);
    for (let t = 0; t < 2000; t += 0.5) e.step(0.5);                          // no more rain: the beck dries, the stones stay
    expect(beckMap.size).toBe(0);
    expect(w.terrainAt(keyX(becks[0]), keyY(becks[0]))).not.toBe(WATER);
    let left = 0;
    for (let y = -10; y <= 10; y++) for (let x = -40; x <= 12; x++) if (w.stateAt(x, y).v === 2) left++;
    expect(left).toBeGreaterThan(0);
  });
  it('one busy tile that is not part of a line does not turn into a beck', () => {
    const { e } = scene();
    const cross = (e as any).cross.bind(e) as (x: number, y: number) => void;
    for (let i = 0; i < 12; i++) cross(5, 5);
    expect(e.tally.becks).toBe(0);
    expect((e as any).trickle.get(tileKey(5, 5))).toBeGreaterThanOrEqual(8);
  });
  it('never starts beside sand, and a second line needs 10 tiles of room', () => {
    const { w, e } = scene();
    const spot = (x: number, y: number) => (e as any).beckSpot(x, y) as number | null;
    expect(spot(0, 0)).not.toBeNull();
    e.paint(2, 0, SAND);
    expect(spot(0, 0)).toBeNull();                                            // sand two tiles off would force a sand bank
    expect(spot(-1, 0)).not.toBeNull();
    (e as any).makeBeck(20, 0, tileKey(20, 0), 1);
    expect(w.terrainAt(20, 0)).toBe(WATER);
    expect(spot(20, 8)).toBeNull();                                           // a different line within 10 tiles
    expect(spot(20, 12)).not.toBeNull();
    expect(spot(19, 1)).toBe(1);                                              // the end of its own line extends it
  });
});
