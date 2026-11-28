import { describe, expect, it } from 'vitest';
import { PlanetHost, type PlanetFrom, type PlanetTo } from '../workers/planetHost';
import { PlanetClient, type PlanetParams } from './planetClient';
import type { WorkerLike } from './chunkClient';
import { bandsFor, buildPlanetMesh, paintTable, planetGrid, runToEnd, sampleHeights, sampleMoisture } from '../domain/planetmesh';
import { sanitizeGen } from '../domain/genparams';
import { CUBE_N, cubeSize } from '../domain/cube';
import type { PlanetMesh } from '../domain/planetmesh';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A host run in this thread, its messages delivered by timers as a worker's are. */
function loopback(log?: { hosts: PlanetHost[] }): WorkerLike {
  const w: WorkerLike = { onmessage: null, onerror: null, terminate() {}, postMessage(m) { setTimeout(() => host.message(m as unknown as PlanetTo), 0); } };
  const host = new PlanetHost((m: PlanetFrom) => { setTimeout(() => w.onmessage?.({ data: m as never }), 0); }, fn => { setTimeout(fn, 0); });
  log?.hosts.push(host);
  return w;
}
const P = (o: Partial<PlanetParams> = {}): PlanetParams => ({ seed: 42, size: CUBE_N, detail: 32, band: 3, ...o });
const same = (a: ArrayBuffer, b: ArrayBuffer) => { const x = new Uint8Array(a), y = new Uint8Array(b); if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

describe('the preview worker', () => {
  it('builds only the latest of a burst of requests, and what it builds is what the pure builder gives', async () => {
    const out: PlanetFrom[] = [], host = new PlanetHost(m => { out.push(m); }, fn => { setTimeout(fn, 0); });
    for (let i = 1; i <= 25; i++) host.message({ t: 'build', id: i, seed: 42, size: CUBE_N, gen: sanitizeGen({ sea: i / 100 }), k: 3, detail: 32 });
    for (let i = 0; i < 300 && !out.some(m => m.t === 'mesh'); i++) await wait(10);
    await wait(50);
    const meshes = out.filter(m => m.t === 'mesh') as Extract<PlanetFrom, { t: 'mesh' }>[];
    expect(meshes.map(m => m.id)).toEqual([25]);
    expect(host.started).toBeLessThanOrEqual(2);
    const g32 = planetGrid(32), gen = sanitizeGen({ sea: 0.25 }), hh = runToEnd(sampleHeights(g32, 42, CUBE_N, gen));
    const want = runToEnd(buildPlanetMesh(g32, hh, 3, { moist: runToEnd(sampleMoisture(g32, 42, CUBE_N)), tint: paintTable(CUBE_N, gen, 3, bandsFor(hh, 3)) }));
    expect(meshes[0].tris).toBe(want.tris);
    meshes[0].patches.forEach((p, i) => expect(same(p.verts, want.patches[i].verts)).toBe(true));
    expect(cubeSize()).toBe(0);   // (the planet's size is in use only inside a step)
  });

  it('a cancellation storm leaves no stale mesh: the job is dropped between steps, however far along it is', async () => {
    const out: PlanetFrom[] = [], host = new PlanetHost(m => { out.push(m); }, fn => { setTimeout(fn, 0); });
    let id = 0;
    for (let round = 0; round < 40; round++) { host.message({ t: 'build', id: ++id, seed: 7, size: CUBE_N, gen: sanitizeGen({ hills: 0.2 + (round % 9) / 10 }), k: 3, detail: 64 }); await wait(round % 3); }
    await wait(1500);
    const meshes = out.filter(m => m.t === 'mesh') as Extract<PlanetFrom, { t: 'mesh' }>[];
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    expect(meshes[meshes.length - 1].id).toBe(id);
    expect(meshes.every(m => m.id <= id)).toBe(true);
    for (const m of out) if (m.t === 'progress') expect(m.id).toBeLessThanOrEqual(id);
    expect(host.dropped).toBeGreaterThan(0);
  }, 30000);

  it('a change of band reuses the heights', async () => {
    const out: PlanetFrom[] = [], host = new PlanetHost(m => { out.push(m); }, fn => { setTimeout(fn, 0); });
    const meshes = () => out.filter(x => x.t === 'mesh').length, until = async (n: number) => { for (let i = 0; i < 400 && meshes() < n; i++) await wait(10); };
    host.message({ t: 'build', id: 1, seed: 5, size: CUBE_N, k: 3, detail: 32 }); await until(1);
    host.message({ t: 'build', id: 2, seed: 5, size: CUBE_N, k: 5, detail: 32 }); await until(2);
    host.message({ t: 'build', id: 3, seed: 5, size: CUBE_N, gen: sanitizeGen({ peaks: 1.5 }), k: 5, detail: 32 }); await until(3);
    const m = out.filter(x => x.t === 'mesh') as Extract<PlanetFrom, { t: 'mesh' }>[];
    expect(m.map(x => x.cached)).toEqual([false, true, false]);
    expect(m[1].sampleMs).toBe(0); expect(m[1].tris).toBeLessThan(m[0].tris);
  });
});

describe('moisture and cold', () => {
  it('recolour the mesh from the heights kept: same shape, other colours, no resampling', async () => {
    const out: PlanetFrom[] = [], host = new PlanetHost(m => { out.push(m); }, fn => { setTimeout(fn, 0); });
    const meshes = () => out.filter(x => x.t === 'mesh').length, until = async (n: number) => { for (let i = 0; i < 400 && meshes() < n; i++) await wait(10); };
    host.message({ t: 'build', id: 1, seed: 11, size: CUBE_N, k: 3, detail: 32 }); await until(1);
    host.message({ t: 'build', id: 2, seed: 11, size: CUBE_N, gen: sanitizeGen({ moisture: 0.3, cold: 10 }), k: 3, detail: 32 }); await until(2);
    const [a, b] = out.filter(x => x.t === 'mesh') as Extract<PlanetFrom, { t: 'mesh' }>[];
    expect(b.cached).toBe(true); expect(b.sampleMs).toBe(0); expect(b.tris).toBe(a.tris);
    let shape = true, colour = false;
    a.patches.forEach((p, i) => { const q = b.patches[i], fa = new Float32Array(p.verts), fb = new Float32Array(q.verts), ca = new Uint8Array(p.verts), cb = new Uint8Array(q.verts);
      for (let v = 0; v < p.nv; v++) { for (let c = 0; c < 4; c++) if (fa[v * 6 + c] !== fb[v * 6 + c]) shape = false; for (let c = 20; c < 23; c++) if (ca[v * 24 + c] !== cb[v * 24 + c]) colour = true; } });
    expect(shape).toBe(true); expect(colour).toBe(true);
  });
});

describe('the preview client', () => {
  it('hands on the latest mesh and drops the stale ones before anyone uploads them', async () => {
    const got: { N: number; k: number; id: number; quick: boolean }[] = [];
    const c = new PlanetClient(() => loopback(), { onMesh: (m, i) => got.push({ N: m.N, k: m.k, id: i.id, quick: i.quick }), quietMs: 20 });
    for (let i = 0; i < 12; i++) c.set(P({ seed: 1 + i }));
    await wait(500);
    expect(got.length).toBe(1); expect(got[0].id).toBe(12);
    expect(c.requests).toBe(12);
    c.dispose();
  });

  it('while dragging it builds the coarse mesh, then the chosen detail after a quiet moment', async () => {
    const got: { N: number; quick: boolean }[] = [];
    const c = new PlanetClient(() => loopback(), { onMesh: (m, i) => got.push({ N: m.N, quick: i.quick }), quietMs: 120 });
    for (let i = 0; i < 6; i++) { c.set(P({ detail: 64, gen: sanitizeGen({ hills: 0.5 + i / 10 }) }), true); await wait(15); }
    await wait(900);
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[got.length - 1]).toEqual({ N: 64, quick: false });
    for (const g of got.slice(0, -1)) expect(g).toEqual({ N: 32, quick: true });
    c.dispose();
  }, 20000);

  it('a long drag still shows meshes as it goes: one coarse build at a time, the newest state each time', async () => {
    const got: { N: number; quick: boolean; at: number }[] = []; const t0 = Date.now();
    const c = new PlanetClient(() => loopback(), { onMesh: (m, i) => got.push({ N: m.N, quick: i.quick, at: Date.now() - t0 }), quietMs: 150 });
    let events = 0;
    for (let i = 0; i < 60; i++) { c.set(P({ detail: 64, gen: sanitizeGen({ hills: 0.4 + i / 50 }) }), true); events++; await wait(10); }
    const during = got.filter(g => g.quick).length;
    await wait(1200);
    expect(during).toBeGreaterThanOrEqual(2);
    expect(c.requests).toBeLessThan(events / 2);
    expect(got[got.length - 1]).toMatchObject({ N: 64, quick: false });
    c.dispose();
  }, 20000);

  it('a mesh over the budget is not used: a warning, and no mesh', async () => {
    const got: number[] = [], warns: string[] = [];
    const c = new PlanetClient(() => loopback(), { onMesh: m => got.push(m.tris), onWarn: w => warns.push(w), budgetTris: 1000 });
    c.set(P({ detail: 32 })); await wait(300);
    expect(got).toEqual([]); expect(warns.length).toBe(1); expect(warns[0]).toMatch(/budget/); expect(c.overBudget).toBe(1);
    c.dispose();
  });

  it('falls back to a host of its own where there are no workers, and stops when disposed', async () => {
    const got: PlanetMesh[] = [];
    const c = new PlanetClient(() => { throw new Error('no workers'); }, { onMesh: m => got.push(m) });
    expect(c.state).toBe('inprocess');
    c.set(P({ detail: 16 })); await wait(300);
    expect(got.length).toBe(1);
    c.dispose(); c.set(P({ detail: 16 })); await wait(100);
    expect(got.length).toBe(1);
  });
});
