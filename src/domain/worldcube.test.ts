import { describe, it, expect, afterEach } from 'vitest';
import { CUBE_N, FACES, setCubeSize, cubeRadius, faceOf, canonTile, canonInto, newCanon, canonChunk, insideFace, CAP_LEVEL } from './cube';
import { elevation, terraceMoist, terraceLakeAt, terraceLakesIn, TerraceField, layerOf } from './terrace';
import { hoopsIn } from './hoops';
import { stickInCell, stoneInCell, sticksIn } from './sticks';
import { tunnelInCell } from './windtunnel';
import { colonyInCell } from './beavers';
import { thermalInCell, newGlider, launchPlane, refuel, stepGlider, type ThermalEnv, type GlideEnv } from './glider';
import { isBerryBush } from './berries';
import { World, WATER, generatedState, plainTile, tileKey } from './worldgen';
import { newSavedWorld, sanitizeWorlds, encodeChanges, decodeChanges, terracePlaneSpawn } from './worldsave';
import { ORBIT, rocketFuel, setPlanetRadius, circularSpeed, orbitElements, spaceFactor, SPACE_FROM, SPACE_TO, trackK } from './orbit';
import { ChunkHost, type FromWorker } from '../workers/chunkHost';
import { BLOCK_TABLE_BYTES, blocksFromTable, buildChunk } from './chunkbuild';

const N = CUBE_N, R = cubeRadius(N), Q = N / 10080;   // (Q: the test points were chosen on the first, bigger planet)
afterEach(() => { setCubeSize(null); setPlanetRadius(null); });

/** Net points `t` along the side of a face, `d` tiles past it (negative: inside). */
const sidePoint = (fi: number, side: number, t: number, d: number): [number, number] => {
  const F = FACES[fi], east = side < 2, sgn = side % 2 === 0 ? 1 : -1;
  return east ? [F.ix * N + sgn * (N / 2 + d), F.iy * N + t] : [F.ix * N + t, F.iy * N + sgn * (N / 2 + d)];
};

describe('the cube planet: the ground', () => {
  const seeds = [3, 14, 99];
  it('is a function of the seed, and of the seed only', () => {
    setCubeSize(N);
    for (const seed of seeds) { const a = elevation(123.5, -456.5, seed); expect(elevation(123.5, -456.5, seed)).toBe(a); }
    expect(elevation(123.5, -456.5, 3)).not.toBe(elevation(123.5, -456.5, 4));
  });
  it('leaves an endless world exactly as it was', () => {
    setCubeSize(null);
    const e0 = elevation(1234.5, -678.9, 7), m0 = terraceMoist(1234, -679, 7);
    setCubeSize(N); elevation(1234.5, -678.9, 7); terraceMoist(1234, -679, 7); setCubeSize(null);
    expect(elevation(1234.5, -678.9, 7)).toBe(e0); expect(terraceMoist(1234, -679, 7)).toBe(m0);
  });
  it('runs on across all twelve edges: a half tile either side is as near as a half tile anywhere', () => {
    setCubeSize(N);
    for (const seed of seeds) {
      let edge = 0, inland = 0;
      for (let fi = 0; fi < 6; fi++) for (let side = 0; side < 4; side++) for (const t of [-3300, -1700, -500, 400, 1900, 3100].map(v => v * Q)) {
        const [ax, ay] = sidePoint(fi, side, t, -0.25), [bx, by] = sidePoint(fi, side, t, 0.25), [cx, cy] = sidePoint(fi, side, t, -1000.25 * Q), [dx, dy] = sidePoint(fi, side, t, -999.75 * Q);
        edge += Math.abs(elevation(ax, ay, seed) - elevation(bx, by, seed)); inland += Math.abs(elevation(cx, cy, seed) - elevation(dx, dy, seed));
      }
      expect(edge).toBeLessThan(inland * 3 + 2);   // (the ground's own slope, as anywhere: no step at an edge)
    }
  });
  it('is the same ground past a cut edge as on the face it belongs to (a point and its place on the neighbour)', () => {
    setCubeSize(N);
    const c = newCanon();
    for (const seed of seeds) for (const [x, y] of [[2 * N + N / 2 + 40.5, 100.5], [N / 2 + 40.5, -N + 7.5], [-N / 2 - 90.5, N - 3.5], [2 * N + 311.5, -N / 2 - 62.5]]) {
      canonInto(x, y, c); expect(elevation(x, y, seed)).toBe(elevation(c.x, c.y, seed));
      expect(terraceMoist(x, y, seed)).toBe(terraceMoist(c.x, c.y, seed)); expect(terraceLakeAt(x, y, seed)).toBe(terraceLakeAt(c.x, c.y, seed));
    }
  });
  it('is one flat sheet of open ocean on the corner caps, with no lakes', () => {
    setCubeSize(N);
    for (const seed of seeds) for (const F of FACES) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const k of [3, 200, 600].map(v => v * Q)) {
      const x = F.ix * N + sx * (N / 2 - 1 - k), y = F.iy * N + sy * (N / 2 - 1 - k * 0.7);
      expect(elevation(x, y, seed)).toBeCloseTo(CAP_LEVEL, 9); expect(CAP_LEVEL).toBeLessThan(0); expect(terraceLakeAt(x, y, seed)).toBe(false); expect(terraceMoist(x, y, seed)).toBeLessThan(0.2);
    }
  });
  it('has features the same size everywhere on the ball: the ground changes as fast near an edge as at a face centre', () => {
    setCubeSize(N);
    let centre = 0, near = 0, n = 0;
    for (const seed of seeds) for (let k = 0; k < 60; k++) {
      const a = (k * 311) % 3000 - 1500, b = (k * 677) % 3000 - 1500;
      centre += Math.abs(elevation(a, b, seed) - elevation(a + 20, b, seed)) + Math.abs(elevation(a, b, seed) - elevation(a, b + 20, seed));
      const x = N / 2 - 900 - ((k * 131) % 2500), y = ((k * 977) % 5000) - 2500;   // (a face centre's own measure against one near a face's edge, away from the corners)
      near += Math.abs(elevation(x, y, seed) - elevation(x + 20, y, seed)) + Math.abs(elevation(x, y, seed) - elevation(x, y + 20, seed)); n++;
    }
    expect(near / centre).toBeGreaterThan(0.4); expect(near / centre).toBeLessThan(2.5);
  });
  it('has oceans and continents (a good share of the points are sea, and a good share land), and a landmass under the start', () => {
    setCubeSize(N);
    for (const seed of seeds) {
      let sea = 0, n = 0;
      for (const F of FACES) for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { n++; if (layerOf(elevation(F.ix * N + i * 1100, F.iy * N + j * 1100, seed)) < 0) sea++; }
      expect(sea / n).toBeGreaterThan(0.12); expect(sea / n).toBeLessThan(0.85);
      const sp = terracePlaneSpawn(seed, N);
      expect(Math.abs(sp.x)).toBeLessThan(4000); expect(Math.abs(sp.y)).toBeLessThan(4000);
      setCubeSize(N);
    }
  });
  it('finds the lakes of a box, none close to a face edge', () => {
    setCubeSize(N);
    const lakes = terraceLakesIn(-1800, -1800, 1800, 1800, 14);
    expect(lakes.length).toBeGreaterThan(3);
    const near = terraceLakesIn(N / 2 - 150, -1000, N / 2 + 150, 1000, 14);
    for (const l of near) expect(insideFace(l.x, l.y, 100)).toBe(true);
  });
  it('builds chunk grids that agree across an edge', () => {
    setCubeSize(N);
    const f = new TerraceField(5);
    // two tiles that touch across the front / right edge, and two that touch across a cut edge (right / top, round the corner)
    expect(Math.abs(f.elevationAt(N / 2 - 1, 100) - f.elevationAt(N / 2, 100))).toBeLessThan(1.5);
    const [ax, ay] = sidePoint(1, 3, 123.5, -0.5), [bx, by] = sidePoint(1, 3, 123.5, 0.5);
    expect(Math.abs(f.elevationNear(ax, ay) - f.elevationNear(bx, by))).toBeLessThan(2.5);
  });
});

describe('the cube planet: features sit on the faces', () => {
  it('hoops, sticks, stones, tunnels, colonies and thermals stand on a face and are the same wherever asked', () => {
    setCubeSize(N);
    const seed = 21;
    let count = 0;
    for (const h of hoopsIn(seed, N / 2 - 600, -600, N / 2 + 600, 600)) { count++; expect(faceOf(h.x, h.y)).toBeGreaterThanOrEqual(0); }
    for (const h of hoopsIn(seed, N / 2 - 600, -N - 600, N / 2 + 600, -N + 600)) expect(faceOf(h.x, h.y)).toBeGreaterThanOrEqual(0);   // (round the void at a corner of the net)
    expect(count).toBeGreaterThan(3);
    for (const s of sticksIn(seed, N / 2 - 300, N / 2 - 300, N / 2 + 300, N / 2 + 300)) expect(faceOf(s.x, s.y)).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < 400; k++) {
      const i = k * 3 - 300, j = k * 5 - 700;
      const s1 = stickInCell(seed, i, j), s2 = stoneInCell(seed, i, j), t = tunnelInCell(seed, i, j), c = colonyInCell(seed, i, j);
      if (s1) expect(insideFace(s1.x, s1.y, 5)).toBe(true); if (s2) expect(insideFace(s2.x, s2.y, 5)).toBe(true);
      if (t) expect(insideFace(t.x, t.y, 60)).toBe(true); if (c) expect(insideFace(c.x, c.y, 60)).toBe(true);
    }
    const env: ThermalEnv = { seed, hour: 12, warm: 1, heatAt: () => 0.7 };
    let th = 0; for (let k = -40; k < 40; k++) { const t = thermalInCell(env, k, 3, 100); if (t) { th++; expect(insideFace(t.x, t.y, 0)).toBe(true); } }
    expect(th).toBeGreaterThan(5);
  });
  it('rolls bushes and decorations by the canonical tile', () => {
    setCubeSize(N);
    for (let k = 0; k < 60; k++) {
      const x = N / 2 + 10 + k, y = -N + 20 + k;   // (past a cut edge: the right face's tile)
      const [cx, cy] = canonTile(x, y);
      expect(isBerryBush(5, x, y)).toBe(isBerryBush(5, cx, cy));
    }
    const gs = (x: number, y: number) => JSON.stringify(generatedState(x, y, 2, { id: 'forest' } as never, 3));
    const [qx, qy] = canonTile(N / 2 + 30, -N + 50); expect(gs(N / 2 + 30, -N + 50)).toBe(gs(qx, qy));
  });
});

describe('the cube planet: worlds, saves and workers', () => {
  it('keeps a change under its canonical tile: dug on one side of a cut edge, dug on the other', () => {
    const w = new World(4, undefined, 'terraced', null, N);
    expect(w.size).toBe(N);
    const x = N / 2 + 30, y = -N + 100, [cx, cy] = canonTile(x, y);
    expect([cx, cy]).not.toEqual([x, y]);
    w.set(x, y, plainTile(WATER));
    expect(w.terrainAt(cx, cy)).toBe(WATER); expect(w.terrainAt(x, y)).toBe(WATER);
    expect(w.ck(x, y)).toBe(tileKey(cx, cy));
    expect(w.changes.size).toBeLessThanOrEqual(1);
  });
  it('an endless world keeps its keys as they were, whatever planet was open before', () => {
    new World(4, undefined, 'terraced', null, N);
    const e = new World(4, undefined, 'terraced', null, 0);
    expect(e.size).toBe(0); expect(e.ck(30 + N, 40)).toBe(tileKey(30 + N, 40));
    expect(new World(4, undefined, 'procedural', null, N).size).toBe(0);   // (only the seeded hills can be a planet)
  });
  it('new Hills worlds are planets; the flat, the Lake District and the real map are not; old saves stay endless; the first globe is started again', () => {
    const hills = newSavedWorld('a', 'A', 5, 0, 'terraced'), flat = newSavedWorld('b', 'B', 5, 0), real = newSavedWorld('c', 'C', 5, 0, 'terraced', 'lakes25');
    expect(hills.size).toBe(N); expect(flat.size).toBeUndefined(); expect(real.size).toBeUndefined();
    const old = { ...hills, id: 'g', size: 40320, plane: { x: 31337, y: -5, heading: 1, pitch: 0 }, changes: [[1, 1, 0, 0, 0, 100]], explored: [1, 2, 3] };
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [hills, flat, real, { ...hills, id: 'd', size: 12345 }, { ...flat, id: 'e', size: N }, { ...hills, id: 'f', size: undefined }, old] })));
    expect(back.list.map(w => w.size)).toEqual([N, undefined, undefined, undefined, undefined, undefined, N]);
    const g = back.list[6]; expect(g.changes).toEqual([]); expect(g.explored).toEqual([]); expect(Math.abs(g.plane.x)).toBeLessThan(4000);
    expect(Math.abs(hills.plane.y)).toBeLessThan(4000);
  });
  it('saves changes at canonical coordinates, and reads them back', () => {
    const w = new World(4, undefined, 'terraced', null, N);
    w.set(N / 2 + 30, -N + 100, plainTile(WATER));
    const saved = encodeChanges(w.changes);
    for (const c of saved) { expect(faceOf(c[0], c[1])).toBeGreaterThanOrEqual(0); }
    const w2 = new World(4, decodeChanges(saved), 'terraced', null, N);
    const [cx, cy] = canonTile(N / 2 + 30, -N + 100); expect(w2.terrainAt(cx, cy)).toBe(WATER);
  });
  it('the chunk worker builds a planet\'s chunks, across edges and at a corner, as the page does', async () => {
    const world = new World(9, undefined, 'terraced', null, N), blocks = blocksFromTable(new Uint8ClampedArray(BLOCK_TABLE_BYTES));
    const out: FromWorker[] = [], host = new ChunkHost(m => { out.push(m); }, fn => fn());
    host.message({ t: 'init', seed: 9, kind: 'terraced', size: N, changes: [], table: new Uint8ClampedArray(BLOCK_TABLE_BYTES), ops: [] });
    const h = N / 2 / 16, spots: [number, number][] = [[h - 1, 3], [h, 3], [2, h - 1], [h - 1, -h + 1], [3, 5]];   // (round an edge between faces, and at a corner of the front face)
    for (const [i, [cx, cy]] of spots.entries()) host.message({ t: 'build', id: i + 1, cx, cy });
    for (let k = 0; k < 40 && out.filter(m => m.t === 'built').length < spots.length; k++) await new Promise(r => setTimeout(r, 5));
    const built = out.filter((m): m is Extract<FromWorker, { t: 'built' }> => m.t === 'built');
    expect(built.length).toBe(spots.length);
    for (const b of built) { const want = buildChunk(world, blocks, null, b.cx, b.cy); expect(Array.from(b.px)).toEqual(Array.from(want.px)); }
    setCubeSize(N);
    expect(canonChunk(h, 0)[0]).toBe(h);
  });
});

describe('orbit round the cube planet', () => {
  const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 }, DT = 1 / 60;
  it('a planet of faces N wide has radius 2N / pi, and the endless plane keeps its 15 km', () => {
    setPlanetRadius(cubeRadius(N));
    expect(ORBIT.R).toBeCloseTo((2 * N) / Math.PI, 6);
    setPlanetRadius(null);
    expect(ORBIT.R).toBe(15000); expect(trackK(30000)).toBe(1); expect(SPACE_FROM).toBe(8000); expect(SPACE_TO).toBe(24000);
  });
  it('the sky band shrinks with the planet, and low flying keeps its ground speed', () => {
    setPlanetRadius(cubeRadius(N));
    expect(SPACE_FROM).toBeCloseTo(8000 * ORBIT.R / 15000, 6); expect(spaceFactor(SPACE_TO)).toBe(1);
    expect(trackK(0)).toBe(1); expect(trackK(1000)).toBe(1); expect(trackK(30000)).toBeCloseTo(ORBIT.R / (ORBIT.R + 30000), 9);
  });
  it('only the top rocket tier orbits a small planet', () => {
    setPlanetRadius(cubeRadius(N));
    const ascend = (tier: number) => {
      const g = newGlider(0, 0, 0, 1); launchPlane(g, 0, 0, 0, 1); refuel(g, rocketFuel(tier));
      let phase: 'climb' | 'coast' | 'insert' | 'done' = 'climb', t = 0;
      while (t < 900 && !g.landed) {
        let want = 0, rocket = false;
        if (phase === 'climb') { want = Math.max(0.5, 1.35 - 0.03 * g.z / 1000); rocket = g.apo < 45000 * ORBIT.S; if (g.z > 15000 * ORBIT.S && g.apo >= 45000 * ORBIT.S) phase = 'coast'; }
        else if (phase === 'coast') { if (g.vz <= 3 && g.z > 15000 * ORBIT.S) phase = 'insert'; }
        else if (phase === 'insert') { rocket = g.peri < ORBIT.TOP + 2000 * ORBIT.S; if (!rocket) phase = 'done'; }
        stepGlider(g, { pitch: phase === 'coast' || phase === 'done' ? 0 : Math.max(-1, Math.min(1, want - g.gamma)), roll: 0, yaw: 0, rocket }, still, DT); t += DT;
      }
      return g;
    };
    expect(ascend(3).orbited).toBe(true); expect(ascend(2).orbited).toBe(false); expect(ascend(1).orbited).toBe(false);
  });
  it('one orbit is one lap of the planet (four faces along the belt): a circular orbit comes back to where it began', () => {
    setPlanetRadius(cubeRadius(N));
    const h = 30000 * ORBIT.S, v = circularSpeed(h), g = newGlider(0, 0, 0, h), el = orbitElements(h, v, 0);
    g.vx = v; g.vy = 0; g.vz = 0; g.airspeed = v; g.gamma = 0; g.alpha = 0;
    const t = el.period / DT; for (let i = 0; i < t; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, DT);
    expect(g.x).toBeGreaterThan(4 * N * 0.97); expect(g.x).toBeLessThan(4 * N * 1.03);
    expect(R).toBeCloseTo(ORBIT.R, 6);
  });
});
