import { describe, expect, it } from 'vitest';
import { census, soak, soakTable, beaverTable, drift, findBiome, type SoakRow } from './ecostats';
import { Ecosystem, WATER_CAUSES } from './ecosystem';
import { World, GRASS, SAND, WATER, DECO_CONIFER, seedFrom, biomeAt, type BiomeId } from './worldgen';
import { mulberry32 } from './sanctuary';

describe('ecosystem census', () => {
  it('counts every tile once, by kind', () => {
    const w = new World(5), e = new Ecosystem(w, mulberry32(1));
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) w.setTerrain(x, y, GRASS);
    w.setTerrain(0, 0, WATER); w.setTerrain(1, 0, SAND);
    w.set(2, 0, { t: GRASS, v: 1, d: 0, s: 1 });
    w.set(3, 0, { t: GRASS, v: 0, d: DECO_CONIFER, s: 2 });
    const c = census(e, { x0: 0, y0: 0, x1: 3, y1: 3 });
    expect(c.tiles).toBe(16);
    expect([c.water, c.sand, c.flowers, c.trees, c.bushes, c.grass]).toEqual([1, 1, 1, 1, 0, 12]);
    expect(c.water + c.sand + c.grass + c.flowers + c.bushes + c.trees).toBe(c.tiles);
    expect(c.woodScale).toBe(2);
  });
  it('counts burning tiles in the area and keeps running totals', () => {
    const w = new World(5), e = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 });
    for (let y = -4; y < 8; y++) for (let x = -4; x < 8; x++) w.set(x, y, { t: GRASS, v: 0, d: DECO_CONIFER, s: 1 });
    expect(e.strike(1.5, 1.5, undefined, true)).toBe(true);
    expect(census(e, { x0: 0, y0: 0, x1: 3, y1: 3 }).burning).toBe(1);
    expect(e.tally.strikes).toBe(1); expect(e.tally.ignited).toBe(1);
    e.paint(2, 2, WATER); expect(e.tally.toWater).toBe(1); expect(e.tally.toWaterBy.paint).toBe(1);
    e.paint(2, 2, GRASS); expect(e.tally.fromWater).toBe(1);
  });
});

describe('soak run', () => {
  it('samples minute 0 and every minute after, deterministically', () => {
    const opts = { seed: seedFrom('soak'), minutes: 2, size: 32 };
    const a = soak(opts), b = soak(opts);
    expect(a.map(r => r.minute)).toEqual([0, 1, 2]);
    expect(a.map(r => [r.water, r.sand, r.trees, r.clouds])).toEqual(b.map(r => [r.water, r.sand, r.trees, r.clouds]));
    for (const r of a) expect(r.tiles).toBe(32 * 32);
    expect(soakTable(a).split('\n').length).toBe(3);   // header, minute 0, the last minute
  });
  it('runs the beavers with the world, and can be run without them', () => {
    const opts = { seed: seedFrom('soak'), minutes: 3, size: 96 };
    const a = soak(opts), b = soak(opts), none = soak({ ...opts, beavers: false });
    expect(none.every(r => r.beavers === null)).toBe(true);
    expect(a[0].beavers).not.toBeNull();
    expect(a.map(r => [r.beavers!.colonies, r.beavers!.beavers, r.beavers!.tally.hauled])).toEqual(b.map(r => [r.beavers!.colonies, r.beavers!.beavers, r.beavers!.tally.hauled]));   // deterministic
    const last = a[a.length - 1].beavers!;
    expect(last.beavers).toBe(last.babies + last.young + last.adults + last.old);
    expect(beaverTable(a).split('\n').length).toBe(a.length > 1 ? 1 + a.filter((r, i) => r.minute % 5 === 0 || i === a.length - 1).length : 2);
  });
  it('finds a spot in the asked-for biome', () => {
    const s = seedFrom('soak'), at = findBiome(s, 'forest')!;
    expect(biomeAt(at[0], at[1], s).id).toBe('forest');
  });
});

// The long run (phase 0 of ROADMAP.md): `npm run soak` (SOAK=<minutes>). Skipped in the normal test run; it takes a minute or two.
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SOAK_MINUTES = Number(ENV.SOAK ?? 0);
const SOAK_BIOMES: BiomeId[] = ['grassland', 'forest', 'wetland', 'desert', 'lake'];
const SOAK_SEED = seedFrom(ENV.SOAK_SEED || 'soak');   // SOAK_SEED=<words> picks another world
describe.skipIf(!SOAK_MINUTES)('soak report', () => {
  it(`runs ${SOAK_BIOMES.length} biomes for ${SOAK_MINUTES} simulated minutes`, () => {
    const all: [string, SoakRow[]][] = [];
    for (const biome of SOAK_BIOMES) {
      const at = findBiome(SOAK_SEED, biome);
      if (!at) { console.log(`no ${biome} found`); continue; }
      const t0 = performance.now(), rows = soak({ seed: SOAK_SEED, minutes: SOAK_MINUTES, cx: at[0], cy: at[1] });
      all.push([biome, rows]);
      console.log(`\n== ${biome} (seed "${ENV.SOAK_SEED || 'soak'}") at ${at[0]}, ${at[1]} (${((performance.now() - t0) / 1000).toFixed(1)} s) ==\n${soakTable(rows)}\n-- beavers --\n${beaverTable(rows)}`);
    }
    const f = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%` : 'from 0');
    console.log('\n== drift, first minute to last ==\nbiome       water    sand   grass  flower    wood');
    for (const [name, rows] of all) {
      console.log(name.padEnd(10) + [drift(rows, r => r.water), drift(rows, r => r.sand), drift(rows, r => r.grass), drift(rows, r => r.flowers), drift(rows, r => r.bushes + r.trees)].map(x => f(x).padStart(8)).join(''));
    }
    console.log('\n== became water, by rule (whole run) ==\nbiome   ' + WATER_CAUSES.map(c => c.padStart(11)).join(''));
    for (const [name, rows] of all) { const by = rows[rows.length - 1].tally.toWaterBy; console.log(name.padEnd(8) + WATER_CAUSES.map(c => String(by[c]).padStart(11)).join('')); }
    expect(all.length).toBeGreaterThan(0);
  }, 30 * 60 * 1000);
});
