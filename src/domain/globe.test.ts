import { describe, it, expect, afterEach } from 'vitest';
import { GLOBE_W, setWorldSize, canonPoint, canonTile, canonChunk, canonInto, newCanon, unrollNear, latLon, capAt, poleOf, rebaseBy } from './globe';
import { elevation, terraceMoist, terraceLakeAt, TerraceField } from './terrace';

const W = GLOBE_W, P = poleOf(W);
afterEach(() => setWorldSize(null));

describe('the globe: canonical points', () => {
  it('is the identity on an endless world', () => {
    setWorldSize(null);
    expect(canonPoint(123456, -98765)).toEqual([123456, -98765]);
  });
  it('wraps east and west, and the canonical point stays put', () => {
    setWorldSize(W);
    const [x, y] = canonPoint(W * 3 + 17, 40);
    expect(x).toBeCloseTo(17, 6); expect(y).toBeCloseTo(40, 6);
    const [x2, y2] = canonPoint(x, y);
    expect(x2).toBeCloseTo(x, 9); expect(y2).toBeCloseTo(y, 9);
  });
  it('is a half turn past a pole, and comes home after a whole lap north', () => {
    setWorldSize(W);
    const a = canonPoint(100, P + 50);   // 50 tiles past the north pole line
    expect(a[0]).toBeCloseTo(-100, 6); expect(a[1]).toBeCloseTo(P - 50, 6);
    const b = canonPoint(100, 4 * P + 25);
    expect(b[0]).toBeCloseTo(100, 6); expect(b[1]).toBeCloseTo(25, 6);
    const c = canonPoint(100, -P - 50);   // past the south pole line
    expect(c[0]).toBeCloseTo(-100, 6); expect(c[1]).toBeCloseTo(-P + 50, 6);
  });
  it('maps a canonical point back next to where it came from', () => {
    setWorldSize(W);
    for (const [x, y] of [[5, 7], [W + 5, 7], [-W * 2 + 900, P + 300], [12345, 3 * P + 40], [-777, -2 * P - 12]]) {
      const ref = canonInto(x, y, newCanon()), [qx, qy] = [ref.x, ref.y], [ux, uy] = unrollNear(qx, qy, ref);
      expect(ux).toBeCloseTo(x, 6); expect(uy).toBeCloseTo(y, 6);
    }
  });
  it('sends tiles and chunks to tiles and chunks', () => {
    setWorldSize(W);
    expect(canonTile(W + 3, 4)).toEqual([3, 4]);
    expect(canonTile(10, P + 5)).toEqual([-11, P - 6]);   // tile x -> -x-1, tile y past the line -> 2P-1-y
    expect(canonChunk(W / 16 + 2, 3)).toEqual([2, 3]);
  });
  it('knows latitude and longitude, and the rebase moves whole laps', () => {
    setWorldSize(W);
    const ll = latLon(0, P / 2); expect(ll.lat).toBeCloseTo(Math.PI / 4, 9); expect(ll.flip).toBe(false);
    expect(latLon(W / 4, 0).lon).toBeCloseTo(Math.PI / 2, 9);
    expect(latLon(0, P + 10).flip).toBe(true);
    expect(rebaseBy(5 * W + 30, -6 * W, 4)).toEqual([5 * W, -6 * W]);
    expect(rebaseBy(3 * W, 10, 4)).toEqual([0, 0]);
  });
  it('has a flat cap at the poles and none at the equator', () => {
    setWorldSize(W);
    expect(capAt(0)).toBe(0); expect(capAt(P - 100)).toBe(1); expect(capAt(-P + 599)).toBe(1);
    expect(capAt(P - 1500)).toBeGreaterThan(0); expect(capAt(P - 1500)).toBeLessThan(1);
  });
});

describe('the globe: the ground repeats and folds', () => {
  const seeds = [3, 14, 99];
  const pts: [number, number][] = [];
  for (let i = 0; i < 40; i++) pts.push([((i * 7919) % 6000) - 3000 + 0.37, ((i * 104729) % (2 * P - 6000)) - P + 3000 + 0.61]);
  it('is the same one lap east and one lap north', () => {
    setWorldSize(W);
    for (const seed of seeds) for (const [x, y] of pts) {
      const e = elevation(x, y, seed);
      expect(elevation(x + W, y, seed)).toBeCloseTo(e, 9);
      expect(elevation(x - 2 * W, y, seed)).toBeCloseTo(e, 9);
      expect(elevation(x, y + W, seed)).toBeCloseTo(e, 9);
      expect(terraceMoist(x, y, seed)).toBeCloseTo(terraceMoist(x + W, y - W, seed), 4);   // (the tile dither is a sin hash: a few ulps of x turn into 1e-6)
    }
  });
  it('is joined across the east-west seam', () => {
    setWorldSize(W);
    for (const seed of seeds) {
      let seam = 0, inland = 0;
      for (let k = 0; k < 30; k++) {
        const y = -3000 + k * 211.3;
        seam += Math.abs(elevation(W / 2 - 0.25, y, seed) - elevation(W / 2 + 0.25, y, seed));
        inland += Math.abs(elevation(1000 - 0.25, y, seed) - elevation(1000 + 0.25, y, seed));
      }
      expect(seam).toBeLessThan(inland * 4 + 1);   // (half a tile apart: only the ground's own slope, as anywhere else)
    }
  });
  it('is point-reflected past a pole', () => {
    setWorldSize(W);
    for (const seed of seeds) for (const [x, y] of pts) {
      const yy = P - 100 - Math.abs(y) % 1000;   // a point below the north pole line, and the one past it that is the same place
      const a = elevation(x, yy, seed), b = elevation(-x, 2 * P - yy, seed);
      expect(b).toBeCloseTo(a, 9);
    }
  });
  it('is one flat sheet on the polar caps, with no lakes', () => {
    setWorldSize(W);
    for (const seed of seeds) for (let k = 0; k < 20; k++) {
      const x = k * 997 - 9000, y = P - 300 - k * 7;
      expect(elevation(x, y, seed)).toBeCloseTo(3.5, 9);
      expect(elevation(x, -y, seed)).toBeCloseTo(3.5, 9);
      expect(terraceLakeAt(x, y, seed)).toBe(false);
      expect(terraceMoist(x, y, seed)).toBeLessThan(0.2);
    }
  });
  it('leaves an endless world exactly as it was', () => {
    setWorldSize(null);
    const e0 = elevation(1234.5, -678.9, 7);
    setWorldSize(W); elevation(1234.5, -678.9, 7); setWorldSize(null);
    expect(elevation(1234.5, -678.9, 7)).toBe(e0);
  });
  it('builds chunk grids that agree across the seam and the pole line', () => {
    setWorldSize(W);
    const f = new TerraceField(5), cs = 16, sx = W / 2 / cs;   // the chunk column just east of the seam and the one just west of it
    const a = f.elevationAt(W / 2 - 1, 100), b = f.elevationAt(-W / 2, 100);   // two tiles in different unrolled places that touch
    expect(Math.abs(a - b)).toBeLessThan(1);
    void sx;
    const nA = f.elevationAt(500, P - 5), nB = f.elevationAt(-500 - 1, P + 4);   // past the pole line: the reflected tile
    expect(nA).toBeCloseTo(3.5, 5); expect(nB).toBeCloseTo(3.5, 5);
  });
});

import { newGlider, launchPlane, refuel, stepGlider, type GlideEnv } from './glider';
import { ORBIT, rocketFuel, setPlanetRadius, circularSpeed, orbitElements, spaceFactor, SPACE_FROM, SPACE_TO, trackK } from './orbit';
import { planetRadius } from './globe';

describe('orbit on the globe', () => {
  const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 }, DT = 1 / 60;
  afterEach(() => setPlanetRadius(null));
  it('a world W round is a planet of radius W / 2 pi, and the endless plane keeps its 15 km', () => {
    setPlanetRadius(planetRadius(W));
    expect(ORBIT.R).toBeCloseTo(W / (2 * Math.PI), 6);
    setPlanetRadius(null);
    expect(ORBIT.R).toBe(15000); expect(trackK(30000)).toBe(1); expect(SPACE_FROM).toBe(8000); expect(SPACE_TO).toBe(24000);
  });
  it('the sky band shrinks with the planet, and low flying keeps its ground speed', () => {
    setPlanetRadius(planetRadius(W));
    expect(SPACE_FROM).toBeCloseTo(8000 * ORBIT.R / 15000, 6); expect(spaceFactor(SPACE_TO)).toBe(1);
    expect(trackK(0)).toBe(1); expect(trackK(1000)).toBe(1); expect(trackK(30000)).toBeCloseTo(ORBIT.R / (ORBIT.R + 30000), 9);
  });
  it('only the top rocket tier orbits a small planet', () => {
    setPlanetRadius(planetRadius(W));
    const ascend = (tier: number) => {
      const g = newGlider(0, 0, 0, 1); launchPlane(g, 0, 0, 0, 1); refuel(g, rocketFuel(tier));
      let phase: 'climb' | 'coast' | 'insert' | 'done' = 'climb', t = 0;
      while (t < 900 && !g.landed) {   // (a small planet's ascent coasts a long way up: the climb to the top is slow)
        let want = 0, rocket = false;
        if (phase === 'climb') { want = Math.max(0.5, 1.35 - 0.03 * g.z / 1000); rocket = g.apo < 45000; if (g.z > 15000 && g.apo >= 45000) phase = 'coast'; }
        else if (phase === 'coast') { if (g.vz <= 3 && g.z > 15000) phase = 'insert'; }
        else if (phase === 'insert') { rocket = g.peri < ORBIT.TOP + 2000; if (!rocket) phase = 'done'; }
        stepGlider(g, { pitch: phase === 'coast' || phase === 'done' ? 0 : Math.max(-1, Math.min(1, want - g.gamma)), roll: 0, yaw: 0, rocket }, still, DT); t += DT;
      }
      return g;
    };
    expect(ascend(3).orbited).toBe(true); expect(ascend(2).orbited).toBe(false); expect(ascend(1).orbited).toBe(false);
  });
  it('one orbit is one lap of the world: a circular orbit comes back to where it began', () => {
    setPlanetRadius(planetRadius(W));
    const h = 30000, v = circularSpeed(h), g = newGlider(0, 0, 0, h), el = orbitElements(h, v, 0);
    g.vx = v; g.vy = 0; g.vz = 0; g.airspeed = v; g.gamma = 0; g.alpha = 0;
    const t = el.period / DT; for (let i = 0; i < t; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, DT);
    expect(g.x).toBeGreaterThan(W * 0.97); expect(g.x).toBeLessThan(W * 1.03);   // (the air up there is thin but not nothing: a little off a whole lap)
  });
});

import { hoopsIn, hoopInCell, HOOP_CELL } from './hoops';
import { stickInCell, stoneInCell, STICK_CELL } from './sticks';
import { tunnelInCell, TUNNEL_CELL } from './windtunnel';
import { colonyInCell, COLONY_CELL } from './beavers';
import { thermalInCell, THERMAL_CELL, type ThermalEnv } from './glider';
import { isBerryBush } from './berries';
import { World, WATER, generatedState, plainTile, tileKey } from './worldgen';
import { newSavedWorld, sanitizeWorlds, encodeChanges, decodeChanges } from './worldsave';
import { terraceLakesIn } from './terrace';
import { ChunkHost, type FromWorker } from '../workers/chunkHost';
import { BLOCK_TABLE_BYTES, blocksFromTable, buildChunk } from './chunkbuild';

describe('the globe: features come back a lap on', () => {
  it('hoops, sticks, stones, tunnels, colonies and thermals are the same one lap east or north, where their cell stands', () => {
    setWorldSize(W);
    const seed = 21;
    for (let k = 0; k < 40; k++) {
      const i = k * 3 - 20, j = k * 5 - 60;
      const a = hoopInCell(seed, i, j), b = hoopInCell(seed, i + W / HOOP_CELL, j - W / HOOP_CELL);
      expect(!!a).toBe(!!b); if (a && b) { expect(b.x - a.x).toBeCloseTo(W, 6); expect(b.y - a.y).toBeCloseTo(-W, 6); expect(b.h).toBe(a.h); expect(b.angle).toBe(a.angle); }
      const s1 = stickInCell(seed, i, j), s2 = stickInCell(seed, i + W / STICK_CELL, j);
      expect(!!s1).toBe(!!s2); if (s1 && s2) { expect(s2.key).toBe(s1.key); expect(s2.x - s1.x).toBeCloseTo(W, 6); }
      expect(!!stoneInCell(seed, i, j)).toBe(!!stoneInCell(seed, i, j + W / STICK_CELL));
      expect(!!tunnelInCell(seed, i, j)).toBe(!!tunnelInCell(seed, i - W / TUNNEL_CELL, j));
      const c1 = colonyInCell(seed, i, j), c2 = colonyInCell(seed, i + W / COLONY_CELL, j);
      expect(!!c1).toBe(!!c2); if (c1 && c2) expect(c2.key).toBe(c1.key);
    }
    const env: ThermalEnv = { seed, hour: 12, warm: 1, heatAt: () => 0.7 };
    for (let k = 0; k < 20; k++) {
      const a = thermalInCell(env, k, 3, 100), b = thermalInCell(env, k + W / THERMAL_CELL, 3, 100);
      expect(!!a).toBe(!!b); if (a && b) { expect(b.x - a.x).toBeCloseTo(W, 6); expect(b.w).toBeCloseTo(a.w, 9); }
    }
    expect(hoopsIn(seed, 0, 0, 500, 500).length).toBe(hoopsIn(seed, W, W, W + 500, W + 500).length);
  });
  it('berry bushes and tile decorations are rolled by the canonical tile', () => {
    setWorldSize(W);
    for (let k = 0; k < 60; k++) {
      const x = k * 7 - 100, y = k * 3 - 80;
      expect(isBerryBush(5, x, y)).toBe(isBerryBush(5, x + W, y - 2 * W));
      expect(isBerryBush(5, 10 + k, P + 5 + k)).toBe(isBerryBush(5, -11 - k, P - 6 - k));   // past a pole: tile -x-1, 2P-1-y
    }
    const gs = (x: number, y: number) => JSON.stringify(generatedState(x, y, 2, { id: 'forest' } as never, 3));
    expect(gs(11, 12)).toBe(gs(11 + W, 12 + W));
  });
  it('lakes of a box are found at the unrolled places, a lap out', () => {
    setWorldSize(W);
    const base = terraceLakesIn(-1500, -1500, 1500, 1500, 14), far = terraceLakesIn(W - 1500, -1500 + W, W + 1500, 1500 + W, 14);
    expect(base.length).toBeGreaterThan(5); expect(far.length).toBe(base.length);
    const key = (l: { x: number; y: number }, dx: number, dy: number) => `${Math.round(l.x - dx)},${Math.round(l.y - dy)}`;
    expect(new Set(far.map(l => key(l, W, W)))).toEqual(new Set(base.map(l => key(l, 0, 0))));
  });
});

describe('the globe: a world that is saved and shared across laps', () => {
  it('keeps a change under its canonical tile: dug on one lap, dug on every lap', () => {
    const w = new World(4, undefined, 'terraced', null, W);
    expect(w.size).toBe(W);
    const before = w.terrainAt(30, 40);
    w.set(30, 40, plainTile(WATER));
    expect(w.terrainAt(30 + W, 40)).toBe(WATER); expect(w.terrainAt(30, 40 - 2 * W)).toBe(WATER); expect(w.terrainAt(30, 40)).toBe(WATER);
    expect(w.changes.size).toBe(before === WATER ? 0 : 1);
    expect(w.ck(30 + W, 40)).toBe(tileKey(30, 40));
    // past the pole line (y = P) a tile is the point-reflected one: (x, y) is (-x-1, 2P-1-y)
    expect(w.ck(10, P + 5)).toBe(w.ck(-11, P - 6));
  });
  it('an endless world keeps its keys as they were, whatever globe was open before', () => {
    new World(4, undefined, 'terraced', null, W);
    const e = new World(4, undefined, 'terraced', null, 0);
    expect(e.size).toBe(0); expect(e.ck(30 + W, 40)).toBe(tileKey(30 + W, 40));
    const f = new World(4, undefined, 'procedural', null, W);
    expect(f.size).toBe(0);   // (only the seeded hills can be a globe)
  });
  it('new Hills worlds are globes; the flat, the Lake District and the real map are not; old saves stay endless', () => {
    const hills = newSavedWorld('a', 'A', 5, 0, 'terraced'), flat = newSavedWorld('b', 'B', 5, 0), real = newSavedWorld('c', 'C', 5, 0, 'terraced', 'lakes25');
    expect(hills.size).toBe(W); expect(flat.size).toBeUndefined(); expect(real.size).toBeUndefined();
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [hills, flat, real, { ...hills, id: 'd', size: 12345 }, { ...flat, id: 'e', size: W }, { ...hills, id: 'f', size: undefined }] })));
    expect(back.list.map(w => w.size)).toEqual([W, undefined, undefined, undefined, undefined, undefined]);
    expect(hills.plane.y).toBeGreaterThan(-4000); expect(hills.plane.y).toBeLessThan(4000);
  });
  it('saves changes at canonical coordinates, and reads them back', () => {
    const w = new World(4, undefined, 'terraced', null, W);
    w.set(30 + 3 * W, 40 - W, plainTile(WATER));
    const saved = encodeChanges(w.changes);
    for (const c of saved) { expect(Math.abs(c[0])).toBeLessThanOrEqual(W / 2); expect(Math.abs(c[1])).toBeLessThanOrEqual(P); }
    const w2 = new World(4, decodeChanges(saved), 'terraced', null, W);
    expect(w2.terrainAt(30, 40)).toBe(WATER);
  });
});

describe('the globe: the chunk worker', () => {
  it('builds the globe\'s chunks, across the seam and past a pole, as the page does', async () => {
    const world = new World(9, undefined, 'terraced', null, W), blocks = blocksFromTable(new Uint8ClampedArray(BLOCK_TABLE_BYTES));
    const out: FromWorker[] = [], host = new ChunkHost(m => { out.push(m); }, fn => fn());
    host.message({ t: 'init', seed: 9, kind: 'terraced', size: W, changes: [], table: new Uint8ClampedArray(BLOCK_TABLE_BYTES), ops: [] });
    const spots: [number, number][] = [[W / 32 + 1, 3], [-W / 32 - 2, 5], [2, P / 16 + 1], [4, -P / 16 - 2], [W / 16 + 2, 0]];
    for (const [i, [cx, cy]] of spots.entries()) host.message({ t: 'build', id: i + 1, cx, cy });
    for (let k = 0; k < 20 && out.filter(m => m.t === 'built').length < spots.length; k++) await new Promise(r => setTimeout(r, 5));
    const built = out.filter((m): m is Extract<FromWorker, { t: 'built' }> => m.t === 'built');
    expect(built.length).toBe(spots.length);
    for (const b of built) { const want = buildChunk(world, blocks, null, b.cx, b.cy); expect(Array.from(b.px)).toEqual(Array.from(want.px)); }
    setWorldSize(W);
  });
});
