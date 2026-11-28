import { describe, it, expect } from 'vitest';
import { planetGrid, sampleHeights, sampleMoisture, bandsFor, paintTable, buildPlanetMesh, runToEnd, PLANET_VERTEX_BYTES, defaultBand, type PlanetMesh, type PatchMesh, type PlanetGrid } from './planetmesh';
import { elevationBroad, elevation, genParams, withGen } from './terrace';
import { CUBE_N, cubeSize, setCubeSize, FACES } from './cube';
import { sanitizeGen, DEFAULT_GEN } from './genparams';

const same = (a: Uint8Array, b: Uint8Array): boolean => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const build = (g: PlanetGrid, h: ArrayLike<number>, k: number): PlanetMesh => runToEnd(buildPlanetMesh(g, h, k));
/** A synthetic height field: a function of the unit direction. */
const field = (g: PlanetGrid, f: (x: number, y: number, z: number) => number): Float32Array => { const h = new Float32Array(g.S); for (let s = 0; s < g.S; s++) h[s] = f(g.dir[3 * s], g.dir[3 * s + 1], g.dir[3 * s + 2]); return h; };
const realHeights = (N: number, seed = 42, gen = DEFAULT_GEN): Float32Array => runToEnd(sampleHeights(planetGrid(N), seed, CUBE_N, gen));

interface Rd { f: Float32Array; n: Int8Array; c: Uint8Array; idx: ArrayLike<number>; nv: number }
const rd = (p: PatchMesh): Rd => ({ f: new Float32Array(p.verts), n: new Int8Array(p.verts), c: new Uint8Array(p.verts), idx: p.index.subarray(0, p.ni), nv: p.nv });
const RL = 4753;
const pos = (r: Rd, v: number): [number, number, number] => { const o = v * 6, h = r.f[o + 3]; return [r.f[o] * (RL + h), r.f[o + 1] * (RL + h), r.f[o + 2] * (RL + h)]; };
const isFloor = (r: Rd, v: number): boolean => { const o = v * 6, b = v * PLANET_VERTEX_BYTES; return r.n[b + 16] / 127 * r.f[o] + r.n[b + 17] / 127 * r.f[o + 1] + r.n[b + 18] / 127 * r.f[o + 2] > 0.99; };
const forTris = (m: PlanetMesh, fn: (r: Rd, a: number, b: number, c: number, p: PatchMesh) => void) => { for (const p of m.patches) { const r = rd(p); for (let i = 0; i < p.ni; i += 3) fn(r, r.idx[i], r.idx[i + 1], r.idx[i + 2], p); } };

/** The checks every mesh must pass. */
function validate(m: PlanetMesh, k: number) {
  let tris = 0;
  forTris(m, (r, a, b, c) => {
    tris++;
    for (const v of [a, b, c]) { expect(v).toBeLessThan(r.nv); }
    const A = pos(r, a), B = pos(r, b), C = pos(r, c);
    for (const q of [A, B, C]) for (const x of q) if (!Number.isFinite(x)) throw new Error('not finite');
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const g: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    expect(Math.hypot(...g)).toBeGreaterThan(0);
    // floors: outward and on their band; walls: facing their normal
    const floors = [a, b, c].filter(v => isFloor(r, v)).length;
    if (floors === 3) {
      expect(g[0] * (A[0] + B[0] + C[0]) + g[1] * (A[1] + B[1] + C[1]) + g[2] * (A[2] + B[2] + C[2])).toBeGreaterThan(0);
      for (const v of [a, b, c]) { const q = r.f[v * 6 + 3] / k; expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-4); expect(r.f[v * 6 + 3]).toBeGreaterThanOrEqual(0); }
    } else {
      expect(floors).toBe(0);
      const b0 = a * PLANET_VERTEX_BYTES; expect(g[0] * r.n[b0 + 16] + g[1] * r.n[b0 + 17] + g[2] * r.n[b0 + 18]).toBeGreaterThan(0);
      const o = a * 6; expect(Math.abs(r.n[b0 + 16] * r.f[o] + r.n[b0 + 17] * r.f[o + 1] + r.n[b0 + 18] * r.f[o + 2]) / 127).toBeLessThan(0.05);   // (horizontal)
    }
  });
  expect(tris).toBe(m.tris);
}
const vkey = (r: Rd, v: number) => { const o = v * 6; return r.f[o] + ',' + r.f[o + 1] + ',' + r.f[o + 2] + ',' + r.f[o + 3]; };
/** Every edge of the mesh, by the positions of its ends: how many triangles use it. */
function edgeUse(m: PlanetMesh): Map<string, { n: number; h0: number; h1: number }> {
  const e = new Map<string, { n: number; h0: number; h1: number }>();
  forTris(m, (r, a, b, c) => {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const kp = vkey(r, p), kq = vkey(r, q); if (kp === kq) continue;
      const key = kp < kq ? kp + '|' + kq : kq + '|' + kp, u = e.get(key);
      if (u) u.n++; else e.set(key, { n: 1, h0: r.f[p * 6 + 3], h1: r.f[q * 6 + 3] });
    }
  });
  return e;
}

describe('the sample grid', () => {
  it('shares the points on the cube\'s edges and corners', () => {
    for (const N of [8, 16, 64]) { const g = planetGrid(N); expect(g.S).toBe(6 * N * N + 2); expect(planetGrid(N)).toBe(g); }
    expect(() => planetGrid(10)).toThrow();
  });
  it('has unit directions', () => { const g = planetGrid(16); for (let s = 0; s < g.S; s++) expect(Math.hypot(g.dir[3 * s], g.dir[3 * s + 1], g.dir[3 * s + 2])).toBeCloseTo(1, 12); });
});

describe('sampling', () => {
  it('is the game\'s own elevation at every sample, steps in blocks, and leaves the size and settings alone', () => {
    const g = planetGrid(32), gen = sanitizeGen({ sea: 0.1, hills: 1.3 }), it = sampleHeights(g, 7, CUBE_N, gen, 'broad');
    let steps = 0, r = it.next(); while (!r.done) { steps++; expect(cubeSize()).toBe(0); expect(genParams()).toBe(DEFAULT_GEN); r = it.next(); }
    expect(steps).toBeGreaterThan(2);
    const h = r.value;
    setCubeSize(CUBE_N);
    try {
      
      withGen(gen, () => { for (const s of [0, 5, 777, 3000, g.S - 1]) { const F = FACES[g.face[s]]; let u = g.fu[s], v = g.fv[s]; if (Math.abs(u) > 0.5 - 1e-9) u -= Math.sign(u) * 0.01 / CUBE_N; if (Math.abs(v) > 0.5 - 1e-9) v -= Math.sign(v) * 0.01 / CUBE_N; expect(h[s]).toBe(Math.fround(elevationBroad(F.ix * CUBE_N + u * CUBE_N, F.iy * CUBE_N + v * CUBE_N, 7))); } });
    } finally { setCubeSize(0); }
    expect(Number.isFinite(elevation(0, 0, 1))).toBe(true);
  });
});

describe('the mesh of synthetic fields', () => {
  const g = planetGrid(16);
  const cases: [string, (x: number, y: number, z: number) => number, number][] = [
    ['tilted plane over several bands', (x, y) => 18 * x + 9 * y + 2, 2],
    ['steep cone with sea around it', (_x, _y, z) => 80 * Math.max(0, z) ** 2 - 4, 3],
    ['flat land', () => 7.5, 2],
    ['all sea', () => -3, 2],
    ['waves', (x, y, z) => 10 + 9 * Math.sin(9 * x) * Math.cos(7 * y + z), 1],
    ['heights exactly on the contours', (x) => 3 * Math.round(8 * x + 8), 3],
    ['a plateau as high as a contour', (_x, _y, z) => (z > 0.2 ? 12 : 6), 3],
  ];
  for (const [name, f, k] of cases) it(name, () => {
    const m = build(g, field(g, f), k);
    validate(m, k);
    if (name === 'all sea') expect(m.tris).toBe(0);
    if (name === 'flat land') expect(m.tris).toBe(g.N * g.N * 6 * 2);   // (one flat floor: two triangles a cell, no walls, nothing cut)
    // closed except at the coast: an edge is used twice; an edge used once is on the shore (height 0)
    for (const [key, u] of edgeUse(m)) { expect(u.n, key).toBeLessThanOrEqual(2); if (u.n === 1) { expect(u.h0).toBe(0); expect(u.h1).toBe(0); } }
  });
  it('is deterministic to the byte', () => {
    const h = field(g, cases[4][1]), a = build(g, h, 1), b = build(g, h, 1);
    expect(a.patches.length).toBe(b.patches.length);
    a.patches.forEach((p, i) => { const q = b.patches[i]; expect(same(new Uint8Array(p.verts), new Uint8Array(q.verts))).toBe(true); expect(same(new Uint8Array(p.index.buffer, p.index.byteOffset, p.index.byteLength), new Uint8Array(q.index.buffer, q.index.byteOffset, q.index.byteLength))).toBe(true); });
  });
  it('lays no hidden floors: the floors cover the land once', () => {
    const h = field(g, (x, _y, z) => 30 * x + 12 * z * z + 3), k = 2, m = build(g, h, k);
    let floors = 0;
    forTris(m, (r, a, b, c) => { if (![a, b, c].every(v => isFloor(r, v))) return; const A = [r.f[a * 6], r.f[a * 6 + 1], r.f[a * 6 + 2]], B = [r.f[b * 6], r.f[b * 6 + 1], r.f[b * 6 + 2]], C = [r.f[c * 6], r.f[c * 6 + 1], r.f[c * 6 + 2]]; floors += Math.hypot(...cross(sub(B, A), sub(C, A))) / 2; });
    // the same, from the grid: each triangle's area times the share of it that is land (heights >= 0), clipped in barycentric space
    let want = 0; const P = g.N / 4, W = g.N + 1, per = W * W;
    for (let f = 0; f < 6; f++) for (let cj = 0; cj < g.N; cj++) for (let ci = 0; ci < g.N; ci++) {
      const o = f * per + cj * W + ci, v00 = g.vid[o], v10 = g.vid[o + 1], v01 = g.vid[o + W], v11 = g.vid[o + W + 1];
      for (const t of ((ci + cj) & 1 ? [[v00, v10, v11], [v00, v11, v01]] : [[v00, v10, v01], [v10, v11, v01]])) {
        const d = t.map(s => [g.dir[3 * s], g.dir[3 * s + 1], g.dir[3 * s + 2]]);
        want += Math.hypot(...cross(sub(d[1], d[0]), sub(d[2], d[0]))) / 2 * landShare(t.map(s => h[s]));
      }
    }
    void P;
    expect(Math.abs(floors - want) / want).toBeLessThan(2e-3);
  });
});
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** The share of a triangle (by area) where its linear height is at least 0. */
function landShare(h: number[]): number {
  let poly: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const val = (p: number[]) => p[0] * h[0] + p[1] * h[1] + p[2] * h[2];
  const out: [number, number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], vp = val(p), vq = val(q);
    if (vp >= 0) out.push(p);
    if ((vp >= 0) !== (vq >= 0)) { const t = vp / (vp - vq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
  }
  poly = out; if (poly.length < 3) return 0;
  let a = 0; for (let i = 1; i + 1 < poly.length; i++) { const u = sub(poly[i], poly[0]), v = sub(poly[i + 1], poly[0]); a += Math.abs(u[0] * v[1] - u[1] * v[0]) / 2; }   // (area in the (w0, w1) plane: the triangle is 1/2)
  return a / 0.5;
}

describe('the mesh of the real planet', () => {
  it('is watertight, seam-exact and valid (seed 42, detail 32, 3 layers a band)', () => {
    const g = planetGrid(32), h = realHeights(32), m = build(g, h, 3);
    validate(m, 3);
    let used1 = 0;
    for (const [key, u] of edgeUse(m)) { expect(u.n, key).toBeLessThanOrEqual(2); if (u.n === 1) { used1++; expect(u.h0).toBe(0); expect(u.h1).toBe(0); } }
    expect(used1).toBeGreaterThan(0);   // (there is a coast)
    // vertices of different patches that are the same place are the very same bits
    const all: [number, number, number, number][] = [];
    for (const p of m.patches) { const r = rd(p); for (let v = 0; v < r.nv; v++) all.push([r.f[v * 6], r.f[v * 6 + 1], r.f[v * 6 + 2], r.f[v * 6 + 3]]); }
    all.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7 && Math.abs(a[2] - b[2]) < 1e-7 && Math.abs(a[3] - b[3]) < 1e-4) expect(a).toEqual(b);
    }
    // each patch's cap holds its vertices
    for (const p of m.patches) { const r = rd(p); for (let v = 0; v < r.nv; v++) { const d = r.f[v * 6] * p.cap[0] + r.f[v * 6 + 1] * p.cap[1] + r.f[v * 6 + 2] * p.cap[2]; expect(Math.acos(Math.min(1, d))).toBeLessThanOrEqual(p.cap[3]); expect(r.f[v * 6 + 3]).toBeGreaterThanOrEqual(p.minH); expect(r.f[v * 6 + 3]).toBeLessThanOrEqual(p.maxH); } }
  }, 60000);

  it('painted by biome it is the same mesh, valid, with colours that follow moisture and cold', () => {
    const g = planetGrid(32), h = realHeights(32), m0 = runToEnd(sampleMoisture(g, 42, CUBE_N)), k = 3, bands = bandsFor(h, k);
    const plain = build(g, h, k), dry = runToEnd(buildPlanetMesh(g, h, k, { moist: m0.map(() => 0.05), tint: paintTable(CUBE_N, null, k, bands) })), wet = runToEnd(buildPlanetMesh(g, h, k, { moist: m0.map(() => 0.9), tint: paintTable(CUBE_N, null, k, bands) }));
    validate(dry, k); expect(dry.tris).toBe(plain.tris); expect(wet.tris).toBe(plain.tris);
    const avg = (m: PlanetMesh, ch: number) => { let t = 0, n = 0; for (const p of m.patches) { const u = new Uint8Array(p.verts); for (let v = 0; v < p.nv; v++) { t += u[v * 24 + 20 + ch]; n++; } } return t / n; };
    expect(avg(dry, 0)).toBeGreaterThan(avg(wet, 0) + 10);   // (sand is redder than woods)
    const cold = runToEnd(buildPlanetMesh(g, h, k, { moist: m0.map(() => 0.5), tint: paintTable(CUBE_N, sanitizeGen({ cold: 20 }), k, bands) })), mild = runToEnd(buildPlanetMesh(g, h, k, { moist: m0.map(() => 0.5), tint: paintTable(CUBE_N, null, k, bands) }));
    expect(avg(cold, 1)).not.toBeCloseTo(avg(mild, 1), 1);
  }, 60000);

  it('counts and build times by detail (reported; the default detail fits the budget)', () => {
    const rows: string[] = [];
    for (const N of [16, 32, 64, 128]) {
      const g = planetGrid(N), t0 = performance.now(), h = realHeights(N), t1 = performance.now();
      for (const k of [1, 2, 3, 4]) { const t2 = performance.now(), m = build(g, h, k), t3 = performance.now(); rows.push(`N=${N} k=${k}: ${m.tris} tris, ${m.verts} verts, ${(m.bytes / 1048576).toFixed(2)} MiB, build ${(t3 - t2).toFixed(0)} ms (sampling ${(t1 - t0).toFixed(0)} ms)`); if (N === 64 && k === defaultBand(64)) expect(m.tris).toBeLessThan(200_000); }
    }
    console.log('PLANETMESH\n' + rows.join('\n'));
  }, 240000);
});
