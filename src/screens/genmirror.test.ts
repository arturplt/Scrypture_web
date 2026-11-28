import { describe, expect, it } from 'vitest';
import { ChunkHost, type FromWorker } from '../workers/chunkHost';
import { BLOCK_TABLE_BYTES } from '../domain/chunkbuild';
import { World } from '../domain/worldgen';
import { terraceChunkMesh, terraceFarMesh, genParams, setGenParams, withGen } from '../domain/terrace';
import { sanitizeGen, DEFAULT_GEN, paramsKey } from '../domain/genparams';
import { CUBE_N, setCubeSize, cubeSize, netToDir } from '../domain/cube';
import { SculptModel } from '../domain/sculpt';
import { newSavedWorld, sanitizeWorlds, terracePlaneSpawn } from '../domain/worldsave';

const G = sanitizeGen({ sea: 0.15, continents: 1.3, mountains: 1.4, peaks: 1.5, hills: 1.3, moisture: 0.1, cold: 4 });
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
/** A host run in-process, answering at once. */
function host() {
  const out: FromWorker[] = [], q: (() => void)[] = [];
  const h = new ChunkHost(m => { out.push(m); }, fn => { q.push(fn); });
  const run = () => { while (q.length) q.shift()!(); };
  return { h, out, run };
}

describe('the worker reads the same settings as the page', () => {
  it('chunk meshes and grids of a planet with settings equal the page\'s', () => {
    const w = new World(42, undefined, 'terraced', null, CUBE_N, G), { h, out, run } = host();
    expect(w.settings).toEqual(G);
    h.message({ t: 'init', seed: 42, kind: 'terraced', size: CUBE_N, gen: G, changes: [], table: new Uint8ClampedArray(BLOCK_TABLE_BYTES), ops: [] });
    for (const [cx, cy] of [[20, 30], [60, 70], [150, 90]]) {
      h.message({ t: 'build', id: 1, cx, cy, mesh: true }); run();
      const b = out.find(m => m.t === 'built' && m.cx === cx && m.cy === cy) as Extract<FromWorker, { t: 'built' }>;
      expect(b, `chunk ${cx},${cy}`).toBeTruthy();
      const fld = w.field!, m = terraceChunkMesh(fld.grid(cx, cy).e, cx, cy, (x, y) => fld.waterSheetAt(x, y), (x, y) => fld.heightAt(x, y));
      for (const k of ['pos', 'nrm', 'idx', 'sub', 'wpos', 'widx', 'wkind'] as const) expect(same(b.mesh![k], m[k]), `${cx},${cy} ${k}`).toBe(true);
      expect(same(b.grid!.e, fld.grid(cx, cy).e)).toBe(true);
    }
    // and the same field under other settings differs (the settings are the world's ground, set when it opens)
    const f = w.field!, mine = withGen(G, () => f.grid(20, 30).e.slice()), plain = withGen(DEFAULT_GEN, () => f.grid(20, 30).e.slice());
    expect(same(mine, plain)).toBe(false);
  });

  it('a sculpted planet: the worker\'s chunks and far mesh are the page\'s', () => {
    setCubeSize(CUBE_N); const o = [0, 0, 0]; netToDir(400, 500, o);
    const m = new SculptModel(); m.beginStroke(); m.dab([o[0], o[1], o[2]], 0.2, 25); m.endStroke();
    const S = sanitizeGen({ hills: 1.2, sculpt: m.toSparse() }); setCubeSize(0);
    const w = new World(42, undefined, 'terraced', null, CUBE_N, S), { h, out, run } = host();
    h.message({ t: 'init', seed: 42, kind: 'terraced', size: CUBE_N, gen: S, changes: [], table: new Uint8ClampedArray(BLOCK_TABLE_BYTES), ops: [] });
    for (const [cx, cy] of [[20, 30], [26, 32], [40, 60]]) {
      h.message({ t: 'build', id: 1, cx, cy, mesh: true }); run();
      const b = out.find(x => x.t === 'built' && x.cx === cx && x.cy === cy) as Extract<FromWorker, { t: 'built' }>;
      const fld = w.field!, mesh = terraceChunkMesh(fld.grid(cx, cy).e, cx, cy, (x, y) => fld.waterSheetAt(x, y), (x, y) => fld.heightAt(x, y));
      for (const k of ['pos', 'nrm', 'idx', 'sub', 'wpos', 'widx', 'wkind'] as const) expect(same(b.mesh![k], mesh[k]), `${cx},${cy} ${k}`).toBe(true);
      expect(same(b.grid!.e, fld.grid(cx, cy).e)).toBe(true);
    }
    // the sculpt really is in the ground: the same chunk without it differs
    const plain = withGen(sanitizeGen({ hills: 1.2 }), () => new World(42, undefined, 'terraced', null, CUBE_N).field!.grid(20, 30).e.slice());
    setGenParams(S);
    expect(same(plain, w.field!.grid(20, 30).e)).toBe(false);
    h.message({ t: 'far', id: 9, seed: 42, cx: 400, cy: 500, step: 32, half: 800, stepped: false, open: 0, size: CUBE_N, up: 1, inset: 0, gen: S }); run();
    const f = out.find(x => x.t === 'far') as Extract<FromWorker, { t: 'far' }>;
    const g = withGen(S, () => { const it = terraceFarMesh(42, 400, 500, 32, 800, false, 0, 1, 0); let r = it.next(); while (!r.done) r = it.next(); return r.value; });
    expect(same(f.pos, g.pos)).toBe(true);
    expect(genParams()).toEqual(w.settings);
  });

  it('a far job under its own settings equals the page\'s and leaves the world\'s settings in place', () => {
    const w = new World(7, undefined, 'terraced', null, CUBE_N, G), { h, out, run } = host();
    h.message({ t: 'far', id: 5, seed: 7, cx: 400, cy: 300, step: 32, half: 800, stepped: false, open: 0, size: CUBE_N, up: 1, inset: 0, gen: sanitizeGen({ hills: 0.4, sea: -0.2 }) }); run();
    const f = out.find(m => m.t === 'far') as Extract<FromWorker, { t: 'far' }>;
    expect(f).toBeTruthy();
    const g = withGen(sanitizeGen({ hills: 0.4, sea: -0.2 }), () => { const it = terraceFarMesh(7, 400, 300, 32, 800, false, 0, 1, 0); let r = it.next(); while (!r.done) r = it.next(); return r.value; });
    expect(same(f.pos, g.pos)).toBe(true); expect(same(f.col, g.col)).toBe(true);
    expect(genParams()).toBe(w.settings); expect(cubeSize()).toBe(CUBE_N);
    // a job without settings is the default ground
    h.message({ t: 'far', id: 6, seed: 7, cx: 400, cy: 300, step: 32, half: 800, stepped: false, open: 0, size: CUBE_N }); run();
    const d = out.filter(m => m.t === 'far')[1] as Extract<FromWorker, { t: 'far' }>;
    const g0 = withGen(null, () => { const it = terraceFarMesh(7, 400, 300, 32, 800, false, 0, 1, 0); let r = it.next(); while (!r.done) r = it.next(); return r.value; });
    expect(same(d.pos, g0.pos)).toBe(true); expect(same(d.pos, f.pos)).toBe(false);
    expect(genParams()).toBe(w.settings);
  });
});

describe('a world keeps its settings in its save', () => {
  it('round-trips through the sanitizer and a JSON copy', () => {
    const sw = newSavedWorld('a', 'Gen', 42, 1, 'terraced', 'lakes', G);
    expect(sw.gen).toEqual(G); expect(sw.size).toBe(CUBE_N);
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [sw] }))).list[0];
    expect(back.gen).toEqual(G); expect(paramsKey(back.gen)).toBe(paramsKey(G));
  });
  it('a world without settings, or with the defaults, has none (every old save is as it was)', () => {
    expect(newSavedWorld('b', 'Old', 42, 1, 'terraced').gen).toBeUndefined();
    expect(newSavedWorld('c', 'Def', 42, 1, 'terraced', 'lakes', DEFAULT_GEN).gen).toBeUndefined();
    const raw = { list: [{ ...newSavedWorld('d', 'X', 42, 1, 'terraced'), gen: { sea: 0, hills: 1 } }] };
    expect(sanitizeWorlds(raw).list[0].gen).toBeUndefined();
  });
  it('bad settings are cleaned, and only a seeded planet keeps them', () => {
    const w = newSavedWorld('e', 'Bad', 42, 1, 'terraced');
    const raw = { list: [{ ...w, gen: { sea: 99, junk: 1, hills: 'x', peaks: 1.5 } }, { ...newSavedWorld('f', 'Plain', 1, 1), gen: { sea: 0.2 } }, { ...newSavedWorld('g', 'Lake', 1, 1, 'lakedistrict', 'coniston'), gen: { sea: 0.2 } }] };
    const l = sanitizeWorlds(raw).list;
    expect(l[0].gen).toEqual(sanitizeGen({ sea: 0.4, peaks: 1.5 })); expect(l[1].gen).toBeUndefined(); expect(l[2].gen).toBeUndefined();
  });
  it('a planet with settings starts on land of its own ground, and the settings do not leak out of the spawn search', () => {
    setCubeSize(0); setGenParams(null);
    const a = terracePlaneSpawn(42, CUBE_N, G), b = terracePlaneSpawn(42, CUBE_N);
    expect(Number.isFinite(a.x) && Number.isFinite(b.x)).toBe(true);
    expect(genParams()).toBe(DEFAULT_GEN); expect(cubeSize()).toBe(0);
  });
  it('a World made without settings resets any earlier set', () => {
    setGenParams(G); new World(1, undefined, 'terraced', null, CUBE_N); expect(genParams()).toEqual(DEFAULT_GEN);
    new World(2, undefined, 'procedural'); expect(genParams()).toEqual(DEFAULT_GEN);
    setCubeSize(0);
  });
});
