import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { World } from './worldgen';
import { LAKE_MAPS, lakeData, lakeMetresAt, lakeTileOf, setLakeData } from './lakedistrict';
import { setRealTerrain, terraceFarMesh, terraceLakeAt, TERRACE_LAYER_M } from './terrace';

beforeAll(async () => {
  const { data, info } = await sharp('public/assets/lakedistrict/lakedistrict25.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([LAKE_MAPS.lakes25.grid.w, LAKE_MAPS.lakes25.grid.h]);
  setLakeData(info.width, info.height, data, '', 'lakes25', true);
}, 60000);
afterAll(() => setRealTerrain(null));

describe('the terraced Lake District at 25 m', () => {
  it('has the fells and Windermere where the 50 m map has them', () => {
    const pike = lakeTileOf(-3.2117, 54.4542, 'lakes25'), w = new World(3, [], 'terraced', 'lakes25');
    expect(w.realTerrain).toBe(true); expect(lakeData()!.tileM).toBe(25);
    let top = 0; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) top = Math.max(top, lakeMetresAt(Math.round(pike.x) + dx, Math.round(pike.y) + dy));
    expect(top).toBeGreaterThan(940);
    expect(w.layerAt(Math.round(pike.x), Math.round(pike.y))).toBeGreaterThanOrEqual(28);
    const win = lakeTileOf(-2.935, 54.365, 'lakes25');   // on Windermere
    expect(terraceLakeAt(Math.round(win.x) + 0.5, Math.round(win.y) + 0.5, 3)).toBe(true);
    expect(w.layerAt(Math.round(win.x), Math.round(win.y))).toBeLessThan(Math.floor(lakeMetresAt(Math.round(win.x), Math.round(win.y)) / TERRACE_LAYER_M));
  });
  it('builds a ring of chunks and a far level quickly enough', () => {
    const w = new World(3, [], 'terraced', 'lakes25'), c = lakeTileOf(-3.1, 54.4, 'lakes25');
    const t0 = performance.now(); let n = 0;
    for (let cy = -5; cy <= 5; cy++) for (let cx = -5; cx <= 5; cx++) { w.chunkDrawn(Math.floor(c.x / 16) + cx, Math.floor(c.y / 16) + cy); n++; }
    const tChunks = (performance.now() - t0) / n;
    const t1 = performance.now(), g = terraceFarMesh(3, Math.round(c.x), Math.round(c.y), 5, 1000, true); let r = g.next(); while (!r.done) r = g.next();
    console.log(`25 m: ${tChunks.toFixed(2)} ms a chunk (drawn), far level 5 ${(performance.now() - t1).toFixed(0)} ms`);
    expect(tChunks).toBeLessThan(40);
  });
});
