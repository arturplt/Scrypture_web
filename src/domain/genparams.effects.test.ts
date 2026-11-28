import { describe, it, expect, afterEach } from 'vitest';
import { elevation, terraceMoist, terraceBiome, layerOf, terraceBareFrom, withGen, setGenParams, genParams, terraceLakeAt, peakOf, setRealTerrain, TerraceField, findTerraceSpawn } from './terrace';
import { setCubeSize, CUBE_N, FACES, cubeSize } from './cube';
import { sanitizeGen, GEN_RANGE, GEN_KEYS, DEFAULT_GEN, paramsKey, paramsHash, isDefaultGen, SCULPT_POINTS, type GenParams } from './genparams';

afterEach(() => { setGenParams(null); setCubeSize(0); });

/** A fixed spread of points over the six faces of the cube planet. */
function spread(n: number, seed = 5): [number, number][] {
  const out: [number, number][] = []; let s = seed;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < n; i++) { const F = FACES[i % 6]; out.push([F.ix * CUBE_N + Math.round((rnd() - 0.5) * (CUBE_N - 400)), F.iy * CUBE_N + Math.round((rnd() - 0.5) * (CUBE_N - 400))]); }
  return out;
}
const PTS = spread(1800);
interface Stats { land: number; maxLayer: number; wet: number; bare: number; hi: number; coast: number }
/** Statistics over the spread, on the cube planet, under these settings. */
function stats(seed: number, gen: Partial<GenParams>): Stats {
  setCubeSize(CUBE_N);
  return withGen(sanitizeGen(gen), () => {
    let land = 0, maxLayer = -9, wet = 0, bare = 0, hi = 0;
    for (const [x, y] of PTS) {
      const e = elevation(x, y, seed), l = layerOf(e); if (l < 0) continue;
      land++; maxLayer = Math.max(maxLayer, l); if (l >= 20) hi++;
      const b = terraceBiome(l, terraceMoist(x, y, seed)); if (b === 1 || b === 2) wet++; if (b === 3 && l >= terraceBareFrom()) bare++;
    }
    // coast: land/sea changes along a line
    let coast = 0;   // (land and sea changes along a line across each face)
    for (const F of FACES) { let prev = 0; for (let i = 0; i < 800; i++) { const l = layerOf(elevation(F.ix * CUBE_N - 1600 + i * 4, F.iy * CUBE_N + 700, seed)) >= 0 ? 1 : 0; if (i && l !== prev) coast++; prev = l; } }
    return { land: land / PTS.length, maxLayer, wet: wet / Math.max(1, land), bare: bare / Math.max(1, land), hi: hi / PTS.length, coast };
  });
}

describe('the sanitizer', () => {
  it('turns anything into a valid set', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}, { sea: NaN, hills: Infinity, cold: 'a' }]) expect(sanitizeGen(bad)).toEqual(DEFAULT_GEN);
  });
  it('clamps, rounds and drops unknown fields', () => {
    const g = sanitizeGen({ sea: 9, continents: -3, mountains: 0.12345, peaks: 1e9, hills: -1, moisture: 0.1, cold: 99, evil: 1, __proto__: { x: 1 } });
    expect(g).toEqual({ v: 1, sea: 0.4, continents: 0.5, mountains: 0.123, peaks: 2, hills: 0, moisture: 0.1, cold: 25 });
    expect(Object.keys(g)).not.toContain('evil');
  });
  it('bounds and cleans the sculpt', () => {
    const g = sanitizeGen({ sculpt: [5, 9999, 5.5, 1, -1, 3, SCULPT_POINTS, 4, 7, 0, 9, -2, 'a', 1, 12] });
    expect(g.sculpt).toEqual([5, 480, 9, -2]);
    const many: number[] = []; for (let i = 0; i < SCULPT_POINTS + 500; i++) many.push(i, 1);
    expect(sanitizeGen({ sculpt: many }).sculpt!.length).toBe(SCULPT_POINTS * 2);
    expect(sanitizeGen({ sculpt: [3, 0] }).sculpt).toBeUndefined();
    expect(sanitizeGen({ sculpt: 'no' }).sculpt).toBeUndefined();
  });
  it('keys: empty for the identity, stable and distinct otherwise', () => {
    expect(paramsKey(DEFAULT_GEN)).toBe(''); expect(paramsHash(DEFAULT_GEN)).toBe(0); expect(isDefaultGen(sanitizeGen({ sea: 0, hills: 1 }))).toBe(true);
    const a = sanitizeGen({ sea: 0.1 }), b = sanitizeGen({ sea: 0.2 }), c = sanitizeGen({ sea: 0.1, sculpt: [1, 4] });
    expect(paramsKey(a)).toBe(paramsKey(sanitizeGen({ sea: 0.1 })));
    expect(new Set([paramsKey(a), paramsKey(b), paramsKey(c)]).size).toBe(3);
    expect(new Set([paramsHash(a), paramsHash(b), paramsHash(c)]).size).toBe(3);
  });
});

describe('each setting moves its statistic the right way (cube planet, seed 42)', () => {
  const base = stats(42, {});
  it('has some land, mountains and woods by default', () => { console.log('base', JSON.stringify(base)); expect(base.land).toBeGreaterThan(0.1); expect(base.land).toBeLessThan(0.9); expect(base.maxLayer).toBeGreaterThan(15); });
  it('sea: higher means less land, lower more', () => {
    const hi = stats(42, { sea: 0.3 }), lo = stats(42, { sea: -0.3 }); console.log('sea', hi.land, base.land, lo.land);
    expect(hi.land).toBeLessThan(base.land); expect(lo.land).toBeGreaterThan(base.land);
  });
  it('continents: a higher number is more, smaller land masses (more coastline crossings)', () => {
    const hi = stats(42, { continents: 2.2 }), lo = stats(42, { continents: 0.6 }); console.log('cont', hi.coast, base.coast, lo.coast);
    expect(hi.coast).toBeGreaterThan(lo.coast);
  });
  it('mountains: none lowers the tops, more raises the high ground', () => {
    const none = stats(42, { mountains: 0 }), more = stats(42, { mountains: 2 }); console.log('mnt', none.hi, base.hi, more.hi, none.maxLayer, base.maxLayer, more.maxLayer);
    expect(none.hi).toBeLessThan(base.hi); expect(more.hi).toBeGreaterThan(base.hi);
  });
  it('peaks: scales the ranges and the giant', () => {
    const lo = stats(42, { peaks: 0.3 }), hi = stats(42, { peaks: 2 }); console.log('peaks', lo.maxLayer, base.maxLayer, hi.maxLayer);
    expect(hi.maxLayer).toBeGreaterThan(base.maxLayer); expect(lo.maxLayer).toBeLessThan(base.maxLayer);
  });
  it('hills: flatter or taller', () => {
    const lo = stats(42, { hills: 0 }), hi = stats(42, { hills: 2 }); console.log('hills', lo.hi, base.hi, hi.hi);
    expect(hi.hi).toBeGreaterThan(base.hi); expect(lo.hi).toBeLessThan(base.hi);
  });
  it('moisture: wetter has more woods and wet ground', () => {
    const wet = stats(42, { moisture: 0.25 }), dry = stats(42, { moisture: -0.25 }); console.log('moist', dry.wet, base.wet, wet.wet);
    expect(wet.wet).toBeGreaterThan(base.wet); expect(dry.wet).toBeLessThan(base.wet);
  });
  it('cold: more bare tops', () => {
    const c = stats(42, { cold: 12 }); console.log('cold', base.bare, c.bare);
    expect(c.bare).toBeGreaterThan(base.bare);
  });
  it('the identity is exactly the default ground', () => {
    const a = stats(42, DEFAULT_GEN), b = stats(42, {}); expect(a).toEqual(b);
  });
});

describe('no cross-talk', () => {
  const A = sanitizeGen({ sea: 0.2, peaks: 1.6, hills: 1.4, mountains: 1.5 }), B = sanitizeGen({ sea: -0.2, continents: 1.8, hills: 0.5, moisture: 0.2 });
  /** Heights, lakes and the giant under these settings, with whatever cache state there is. */
  const sample = (g: GenParams) => withGen(g, () => {
    const out: number[] = []; for (let i = 0; i < 220; i++) { const [x, y] = PTS[i * 7 % PTS.length]; out.push(elevation(x, y, 42), terraceLakeAt(x + 0.5, y + 0.5, 42) ? 1 : 0, terraceMoist(x, y, 42)); }
    const p = peakOf((42 ^ 0x7e77ace) | 0); out.push(p.x, p.y, p.add); return out;
  });
  it('alternating worlds through the caches equals fresh runs', () => {
    setCubeSize(CUBE_N);
    const fresh = (g: GenParams) => { setCubeSize(0); setCubeSize(CUBE_N); setGenParams(null); return sample(g); };
    const a1 = sample(A), b1 = sample(B), a2 = sample(A), b2 = sample(B), d1 = sample(DEFAULT_GEN);
    expect(a2).toEqual(a1); expect(b2).toEqual(b1); expect(a1).not.toEqual(b1); expect(d1).not.toEqual(a1);
    expect(fresh(A)).toEqual(a1);
    expect(genParams()).toBe(DEFAULT_GEN);   // (withGen puts the old set back)
  });
  it('withGen restores on a throw', () => {
    setGenParams(A);
    expect(() => withGen(B, () => { throw new Error('x'); })).toThrow();
    expect(genParams()).toBe(A);
  });
  it('a field made under one set does not serve its grids under another', () => {
    setCubeSize(CUBE_N);
    const f = new TerraceField(42);
    const a = withGen(A, () => f.grid(30, 120).e.slice()), b = withGen(B, () => f.grid(30, 120).e.slice()), a2 = withGen(A, () => f.grid(30, 120).e.slice());
    expect(b).not.toEqual(a); expect(a2).toEqual(a);
  });
  it('real maps ignore the settings', () => {
    setCubeSize(0); setRealTerrain(null);
    expect(withGen(A, () => terraceBiome(10, 0.5))).not.toBe(-1);   // (smoke: the biome path with a real map is covered by terrace.test)
  });
});

describe('spawn', () => {
  it('finds land across the sea range on a few seeds, or says there is none', () => {
    for (const seed of [1, 7, 42]) for (const sea of [-0.4, -0.2, 0, 0.2, 0.4]) {
      setCubeSize(CUBE_N);
      const sp = withGen(sanitizeGen({ sea }), () => findTerraceSpawn(seed));
      console.log('spawn', seed, sea, sp ? 'land' : 'none');
      expect(sp === null || (Number.isFinite(sp.x) && Number.isFinite(sp.y))).toBe(true);
    }
    expect(cubeSize()).toBe(CUBE_N);
  }, 120000);
});

describe('the slider endpoints (the generator offers exactly these ranges)', () => {
  const seeds = [1, 7, 42, 99, 2024, 31337];
  const ends: [string, Partial<GenParams>][] = [];
  for (const k of ['sea', 'continents', 'mountains', 'peaks', 'hills', 'moisture', 'cold'] as const) for (const i of [0, 1]) ends.push([`${k} ${i ? 'max' : 'min'}`, { [k]: GEN_RANGE[k][i] }]);
  ends.push(['every setting at its wettest, tallest and highest sea', { sea: GEN_RANGE.sea[1], mountains: 2, peaks: 2, hills: 2, continents: 0.5, cold: 25, moisture: -0.3 }], ['every setting at its lowest sea', { sea: GEN_RANGE.sea[0], mountains: 0, peaks: 0, hills: 0, continents: 2.5, cold: 0, moisture: 0.3 }]);
  for (const [name, g] of ends) it(`${name}: the world changes noticeably and still has a place to start`, () => {
    setCubeSize(CUBE_N);
    const gen = sanitizeGen(g);
    // a meaningful change: the ground, or the biomes, differ from the default's over the spread
    let dEl = 0, dBiome = 0, n = 0;
    for (const [x, y] of PTS.slice(0, 400)) {
      const a = withGen(null, () => { const e = elevation(x, y, 42); return [e, terraceBiome(layerOf(e), terraceMoist(x, y, 42))]; }), b = withGen(gen, () => { const e = elevation(x, y, 42); return [e, terraceBiome(layerOf(e), terraceMoist(x, y, 42))]; });
      if (a[0] < 0 && b[0] < 0) continue;   // (open sea says nothing about the land)
      dEl += Math.abs(a[0] - b[0]); if (a[1] !== b[1]) dBiome++; n++;
    }
    const atDefault = GEN_KEYS.every(k => gen[k] === DEFAULT_GEN[k]);   // (a setting whose end is the default has nothing to show there)
    const changed = atDefault || dEl / n > 0.3 || dBiome / n > 0.04;
    expect(changed, `mean |d elevation| ${dEl / n}, biome changes ${dBiome / n}`).toBe(true);
    for (const seed of seeds) expect(withGen(gen, () => findTerraceSpawn(seed)), `seed ${seed} has no ground to start on`).not.toBeNull();
  }, 60000);
});
