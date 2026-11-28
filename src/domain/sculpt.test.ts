import { describe, it, expect, afterEach } from 'vitest';
import { SculptModel, sculptAt, sculptDense, sculptGrid, brushFalloff } from './sculpt';
import { CUBE_N, FACES, cubeSize, setCubeSize, type V3 } from './cube';
import { SCULPT_MAX, SCULPT_POINTS, sanitizeGen, paramsKey, DEFAULT_GEN, type GenParams } from './genparams';
import { elevation, elevationBroad, setGenParams, terraceLakeAt, terraceLakesIn, withGen, layerOf, findTerraceSpawn } from './terrace';
import { planetGrid, sampleHeights, runToEnd, withPlanet } from './planetmesh';
import { newSavedWorld, sanitizeWorlds } from './worldsave';

afterEach(() => { setGenParams(null); setCubeSize(0); });
const norm = (v: number[]): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
/** The net point of a direction on a given face (equal-angle: what dirToNet does for the face the direction points at, here forced). */
const netOn = (f: number, d: V3): [number, number] => {
  const F = FACES[f], dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], c = dot(F.c, d);
  return [F.ix * CUBE_N + (Math.atan2(dot(F.a, d), c) * CUBE_N) / (Math.PI / 2), F.iy * CUBE_N + (Math.atan2(dot(F.b, d), c) * CUBE_N) / (Math.PI / 2)];
};
/** A sculpt with a few strong, wide dabs all over the planet (so every edge and corner carries values). */
function bumpy(): GenParams {
  const m = new SculptModel(); let s = 3;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const g = sculptGrid();
  for (let i = 0; i < 60; i++) { const k = Math.floor(rnd() * g.S); m.dab([g.dir[3 * k], g.dir[3 * k + 1], g.dir[3 * k + 2]], 0.15 + rnd() * 0.3, (rnd() - 0.5) * 30); }
  return sanitizeGen({ sculpt: m.toSparse() });
}

describe('the sculpt field', () => {
  it('has one point where faces meet: 6 * 64^2 + 2 points in all', () => { expect(sculptGrid().S).toBe(SCULPT_POINTS); expect(sculptGrid()).toBe(planetGrid(64)); });

  it('is continuous across every cube edge and at every corner', () => {
    setCubeSize(CUBE_N);
    const g = bumpy(), dense = sculptDense(g.sculpt), eps = 1e-8;
    let checked = 0;
    for (let f = 0; f < 6; f++) for (let h = f + 1; h < 6; h++) {
      const A = FACES[f].c, B = FACES[h].c; if (A[0] * B[0] + A[1] * B[1] + A[2] * B[2] !== 0) continue;   // (faces that share an edge)
      const e: V3 = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
      for (let k = 0; k <= 80; k++) {
        const s = -1 + (2 * k) / 80, d = norm([A[0] + B[0] + s * e[0], A[1] + B[1] + s * e[1], A[2] + B[2] + s * e[2]]);
        const inF = norm([d[0] + eps * A[0], d[1] + eps * A[1], d[2] + eps * A[2]]), inH = norm([d[0] + eps * B[0], d[1] + eps * B[1], d[2] + eps * B[2]]);
        const [xa, ya] = netOn(f, inF), [xb, yb] = netOn(h, inH);
        const va = sculptAt(dense, xa, ya, CUBE_N), vb = sculptAt(dense, xb, yb, CUBE_N);
        expect(Math.abs(va - vb), `edge ${f}/${h} at ${s}`).toBeLessThan(1e-4); checked++;
      }
    }
    expect(checked).toBe(12 * 81);
  });

  it('is bilinear between points and zero on an empty sculpt', () => {
    setCubeSize(CUBE_N);
    const d = new Int16Array(SCULPT_POINTS), g = sculptGrid(); const p = g.vid[0 * 65 * 65 + 10 * 65 + 10]; d[p] = 40;   // a point of face 0, 10 cells in
    const cell = CUBE_N / 64, x0 = -CUBE_N / 2 + 10 * cell, y0 = -CUBE_N / 2 + 10 * cell;
    expect(sculptAt(d, x0, y0, CUBE_N)).toBeCloseTo(10, 9);
    expect(sculptAt(d, x0 + cell / 2, y0, CUBE_N)).toBeCloseTo(5, 9);
    expect(sculptAt(d, x0 + cell / 2, y0 + cell / 2, CUBE_N)).toBeCloseTo(2.5, 9);
    expect(sculptAt(d, x0 + cell, y0, CUBE_N)).toBeCloseTo(0, 9);
    expect(sculptAt(new Int16Array(SCULPT_POINTS), 100, 100, CUBE_N)).toBe(0);
  });
});

describe('the brush and its history', () => {
  const dir: V3 = [1, 0, 0];
  it('raises and lowers with a smooth falloff to nothing at the rim', () => {
    const m = new SculptModel(); m.beginStroke(); expect(m.dab(dir, 0.2, 3)).toBe(true); m.endStroke();
    const g = sculptGrid(); let top = 0, outside = 0;
    for (let s = 0; s < g.S; s++) { const a = Math.acos(Math.min(1, g.dir[3 * s])); if (a > 0.2 && m.v[s] !== 0) outside++; top = Math.max(top, m.v[s]); }
    expect(outside).toBe(0); expect(top).toBeGreaterThan(0); expect(top).toBeLessThanOrEqual(12.0001);   // (3 layers = 12 quarters at most)
    m.beginStroke(); m.dab(dir, 0.2, -3); m.endStroke(); expect(Math.max(...m.v)).toBeCloseTo(0, 4);   // (the same dab lowered undoes the raise)
    expect(brushFalloff(0, 1)).toBe(1); expect(brushFalloff(1, 1)).toBe(0); expect(brushFalloff(0.5, 1)).toBeCloseTo(0.5, 9); expect(brushFalloff(0.9, 1)).toBeLessThan(brushFalloff(0.4, 1));
  });
  it('clamps at +-120 layers', () => {
    const m = new SculptModel(); for (let i = 0; i < 400; i++) m.dab(dir, 0.3, 5);
    expect(Math.max(...m.v)).toBe(SCULPT_MAX);
    for (let i = 0; i < 1200; i++) m.dab(dir, 0.3, -5);
    expect(Math.min(...m.v)).toBe(-SCULPT_MAX);
    expect(sanitizeGen({ sculpt: m.toSparse() }).sculpt!.every((v, i) => i % 2 === 0 || Math.abs(v) <= SCULPT_MAX)).toBe(true);
  });
  it('undoes the last stroke exactly, a bounded number of times', () => {
    const m = new SculptModel(); m.beginStroke(); m.dab(dir, 0.2, 4); m.endStroke(); const one = Float32Array.from(m.v);
    m.beginStroke(); m.dab([0, 1, 0], 0.3, -6); m.dab([0.7, 0.7, 0], 0.3, 2); m.endStroke();
    expect(m.undo()).toBe(true); expect(Array.from(m.v)).toEqual(Array.from(one));
    expect(m.undo()).toBe(true); expect(m.empty).toBe(true); expect(m.undo()).toBe(false);
    for (let i = 0; i < 60; i++) { m.beginStroke(); m.dab(dir, 0.1, 1); m.endStroke(); }
    let n = 0; while (m.undo()) n++; expect(n).toBe(40);
  });
  it('an empty sculpt is no sculpt: the settings and their key are the defaults', () => {
    const m = new SculptModel(); m.beginStroke(); m.dab(dir, 0.2, 2); m.endStroke(); m.undo();
    expect(m.toSparse()).toBeUndefined();
    const g = sanitizeGen({ sculpt: m.toSparse() }); expect(g).toEqual(DEFAULT_GEN); expect(paramsKey(g)).toBe('');
  });
  it('round-trips through the sparse list and the save', () => {
    const g = bumpy(); expect(g.sculpt!.length).toBeGreaterThan(100);
    expect(SculptModel.from(g.sculpt).toSparse()).toEqual(g.sculpt);
    const w = newSavedWorld('s', 'Sculpted', 42, 1, 'terraced', 'lakes', g);
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [w] }))).list[0];
    expect(back.gen).toEqual(g); expect(paramsKey(back.gen)).toBe(paramsKey(g));
    expect(newSavedWorld('t', 'Plain', 42, 1, 'terraced').gen).toBeUndefined();
  });
});

describe('the terrain reads the sculpt', () => {
  it('adds it to the base ground, once: elevationBroad moves by exactly the sculpt (away from the caps)', () => {
    setCubeSize(CUBE_N);
    const g = bumpy(), dense = sculptDense(g.sculpt); let n = 0;
    for (let i = 0; i < 300; i++) {
      const F = FACES[i % 6], x = F.ix * CUBE_N + ((i * 7919) % 2000) - 1000, y = F.iy * CUBE_N + ((i * 104729) % 2000) - 1000;
      const a = withGen(null, () => elevationBroad(x, y, 42)), b = withGen(g, () => elevationBroad(x, y, 42)), s = sculptAt(dense, x, y, CUBE_N);
      expect(b - a).toBeCloseTo(s, 4); n++;
    }
    expect(n).toBe(300);
  });
  it('moves the full elevation by the sculpt where no lake is', () => {
    setCubeSize(CUBE_N);
    const g = bumpy(), dense = sculptDense(g.sculpt); let same = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const F = FACES[i % 6], x = F.ix * CUBE_N + ((i * 7919) % 2000) - 1000, y = F.iy * CUBE_N + ((i * 104729) % 2000) - 1000;
      const a = withGen(null, () => elevation(x, y, 42)), b = withGen(g, () => elevation(x, y, 42)), s = sculptAt(dense, x, y, CUBE_N); n++;
      if (Math.abs(b - a - s) < 1e-4) same++;
    }
    expect(same / n).toBeGreaterThan(0.85);
  });
  it('lays lakes on the sculpted ground and keeps no stale lake across a change of sculpt', () => {
    setCubeSize(CUBE_N);
    const g = bumpy(), box = [-1500, -1500, 1500, 1500] as const;
    const lakes = (gen: GenParams | null) => withGen(gen, () => terraceLakesIn(box[0], box[1], box[2], box[3], 42).map(l => [l.x, l.y, l.r, l.level].join(',')).join(';'));
    const a1 = lakes(null), b1 = lakes(g), a2 = lakes(null), b2 = lakes(g);
    expect(a2).toBe(a1); expect(b2).toBe(b1);
    setCubeSize(0); setCubeSize(CUBE_N);
    expect(lakes(g)).toBe(b1);
    withGen(g, () => { for (const l of terraceLakesIn(box[0], box[1], box[2], box[3], 42)) { expect(terraceLakeAt(l.x + 0.5, l.y + 0.5, 42), `lake at ${l.x},${l.y}`).toBe(true); expect(layerOf(elevation(l.x + 0.5, l.y + 0.5, 42))).toBeLessThanOrEqual(l.level); } });
    expect(a1 === b1).toBe(false);   // (the sculpt really moved the lakes)
  });
  it('the preview heights are the game\'s own at the grid points, sculpt and all', () => {
    const g = bumpy(), grid = planetGrid(32), h = runToEnd(sampleHeights(grid, 42, CUBE_N, g, 'broad'));
    withPlanet(CUBE_N, g, () => {
      for (const s of [0, 17, 500, 2000, 4000, grid.S - 1]) {
        const F = FACES[grid.face[s]]; let u = grid.fu[s], v = grid.fv[s]; if (Math.abs(u) > 0.5 - 1e-9) u -= Math.sign(u) * 0.01 / CUBE_N; if (Math.abs(v) > 0.5 - 1e-9) v -= Math.sign(v) * 0.01 / CUBE_N;
        expect(h[s]).toBe(Math.fround(elevationBroad(F.ix * CUBE_N + u * CUBE_N, F.iy * CUBE_N + v * CUBE_N, 42)));
      }
    });
    expect(cubeSize()).toBe(0);
  });
  it('a world can still start somewhere after a heavy sculpt, and the size and settings are put back', () => {
    const g = bumpy();
    expect(withPlanet(CUBE_N, g, () => findTerraceSpawn(42))).not.toBeNull();
  });
});
