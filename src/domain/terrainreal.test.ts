import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { CHUNK, GRASS, SAND, WATER, World } from './worldgen';
import { lakeMetresAt, lakeWaterAt, setLakeData, lakeSpawnFor, lakeTileOf } from './lakedistrict';
import { realTerrainOn, setRealTerrain, terraceH, TERRACE_LAYER_M, TERRACE_STEP, terraceLakeAt, terraceLakeShoreAt, terraceLakeSheetAt, elevation, terraceFarMesh } from './terrace';
import { newSavedWorld, sanitizeWorlds } from './worldsave';

const DIR = 'public/assets/lakedistrict';
beforeAll(async () => {
  const { data, info } = await sharp(`${DIR}/lakedistrict.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  setLakeData(info.width, info.height, data, '', 'lakes', true);   // (the terraced ground has no corner grid)
});
afterAll(() => setRealTerrain(null));

const lakes = () => new World(7, [], 'terraced', 'lakes');
const windermere = { x: 272, y: 89 }, pike = { x: -80, y: -120 };   // tiles (see lakedistrict.test.ts)

describe('the terraced Lake District', () => {
  it('stands on the map: the fells are layers high, beyond the map is sea', () => {
    const w = lakes();
    expect(w.realTerrain).toBe(true); expect(realTerrainOn()).toBe(true);
    const layer = w.layerAt(pike.x, pike.y);
    expect(layer).toBeGreaterThanOrEqual(Math.floor(lakeMetresAt(pike.x, pike.y) / TERRACE_LAYER_M) - 1); expect(layer).toBeLessThanOrEqual(33);
    expect(w.layerAt(-1000, 0)).toBe(-1);
    expect(w.layerAt(100000, 100000)).toBe(-1);
  });
  it('a lake is a basin: water a layer below its shore, a sand rim, and sheets of water over the bed', () => {
    const w = lakes();
    expect(lakeWaterAt(windermere.x, windermere.y)).toBe(1);
    const level = Math.floor(lakeMetresAt(windermere.x, windermere.y) / TERRACE_LAYER_M);   // 39 m: layer 1
    expect(terraceLakeAt(windermere.x + 0.5, windermere.y + 0.5, 7)).toBe(true);
    expect(terraceLakeSheetAt(windermere.x + 0.5, windermere.y + 0.5, 7)).toBe(level);
    expect(w.layerAt(windermere.x, windermere.y)).toBe(level - 1);
    expect(w.generatedTerrain(windermere.x, windermere.y)).toBe(WATER);
    // walking east to the shore: dry ground at the lake's layer or above, with a strip of sand beside the water
    let shore = -1;
    for (let x = windermere.x; x < windermere.x + 12; x++) if (!terraceLakeAt(x + 0.5, windermere.y + 0.5, 7)) { shore = x; break; }
    expect(shore).toBeGreaterThan(windermere.x);
    expect(terraceLakeShoreAt(shore + 0.5, windermere.y + 0.5, 7)).toBe(true);
    expect(w.generatedTerrain(shore, windermere.y)).toBe(SAND);
    expect(w.layerAt(shore, windermere.y)).toBeGreaterThanOrEqual(level);
  });
  it('the water never stands higher than the shore round it', () => {
    const w = lakes(), level = Math.floor(lakeMetresAt(windermere.x, windermere.y) / TERRACE_LAYER_M);
    for (let y = windermere.y - 6; y <= windermere.y + 6; y++) for (let x = windermere.x - 6; x <= windermere.x + 12; x++) {
      if (!terraceLakeAt(x + 0.5, y + 0.5, 7)) continue;
      expect(w.field!.naturalAt(x, y)).toBeLessThan(level);   // the bed is under the surface
    }
  });
  it('the height field is the steps of the elevation: a layer is TERRACE_STEP tall', () => {
    const w = lakes(), e = elevation(pike.x + 0.5, pike.y + 0.5, 7);
    expect(w.heightAt(pike.x + 0.5, pike.y + 0.5)).toBeLessThanOrEqual(terraceH(e) + 1e-6);   // (the grid's opening may shave a narrow top by a layer or two)
    expect(w.heightAt(pike.x + 0.5, pike.y + 0.5)).toBeGreaterThanOrEqual(terraceH(e) - 3 * TERRACE_STEP);
    expect(w.heightAt(pike.x + 0.5, pike.y + 0.5)).toBeGreaterThan(25 * TERRACE_STEP);
  });
  it('chunks build: fells are grass and bare tops, the sea is water, roads are sand', () => {
    const w = lakes(), kinds = new Set<number>();
    for (let cy = -8; cy <= -6; cy++) for (let cx = -6; cx <= -4; cx++) for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) kinds.add(w.generatedTerrain(cx * CHUNK + i, cy * CHUNK + j));
    expect(kinds.has(GRASS)).toBe(true);
    expect(w.generatedTerrain(-1000, 0)).toBe(WATER);
  });
  it('the far mesh follows the map (the lake is water coloured, the fell stands high)', () => {
    lakes();
    const g = terraceFarMesh(7, pike.x, pike.y, 12, 240, false); let r = g.next();
    while (!r.done) r = g.next();
    const m = r.value, mid = ((m.rows >> 1) * m.cols + (m.cols >> 1)) * 3;
    expect(-m.pos[mid + 2]).toBeGreaterThan(20 * TERRACE_STEP);
  });
  it('a world on the map is saved with it and a seeded one is not', () => {
    const a = newSavedWorld('a', 'A', 5, 0, 'terraced', 'lakes25'), b = newSavedWorld('b', 'B', 5, 0, 'terraced');
    expect(a.map).toBe('lakes25'); expect(b.map).toBeUndefined();
    expect(a.plane.x).toBe(lakeSpawnFor('lakes25').x);
    const t = lakeTileOf(-3.1096, 54.3708, 'lakes25'), t0 = lakeTileOf(-3.1096, 54.3708, 'lakes');
    expect(Math.abs(t.x - 2 * t0.x)).toBeLessThan(3); expect(Math.abs(t.y - 2 * t0.y)).toBeLessThan(3);   // (the same place on a map with half the tile)
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [a, b] }))).list;
    expect(back[0].map).toBe('lakes25'); expect(back[1].map).toBeUndefined();
    expect(sanitizeWorlds({ list: [{ ...b, map: 'nowhere' }] }).list[0].map).toBeUndefined();
  });
  it('a seeded world after it is the seeded hills again', () => {
    new World(7, [], 'terraced', 'lakes');
    expect(realTerrainOn()).toBe(true);
    const h = new World(7, [], 'terraced');
    expect(h.realTerrain).toBe(false); expect(realTerrainOn()).toBe(false);
    expect(new Set([0, 500, 1000, 1500, 2000, 2500].map(x => h.layerAt(x + 3, 40))).size).toBeGreaterThan(1);   // (the noise, not the map's flat sea beyond its edge)
  });
});
