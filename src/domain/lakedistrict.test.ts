import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import roadsRaw from '../../public/assets/lakedistrict/roads.json?raw';
import { CHUNK, GRASS, SAND, WATER, World, generateLakeChunk, MARGIN, SIDE } from './worldgen';
import { lakeSpawnFor, setLakeRoads, lakePlaceLabels, lakeRoadAt, lakeTileOf, lakeOnMap, LAKE_WATER, groundTiles, lakeMetresAt, lakeWaterAt, setLakeData, cornerMetres, HEIGHT_STRETCH, REAL_TILE_M } from './lakedistrict';
import { newSavedWorld, sanitizeWorlds } from './worldsave';
import { newGlider, stepGlider, throwPlane, type GlideEnv } from './glider';

const DIR = 'public/assets/lakedistrict';
beforeAll(async () => {
  const { data, info } = await sharp(`${DIR}/lakedistrict.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(1426); expect(info.height).toBe(1769);
  setLakeData(info.width, info.height, data);
});

describe('the Lake District map', () => {
  it('has Windermere as water, with Scafell Pike on the fells near the middle', () => {
    expect(lakeWaterAt(272, 89)).toBe(LAKE_WATER);          // the lake at Bowness
    expect(lakeWaterAt(290, 89)).toBe(0);                   // land on its east shore
    const pike = lakeMetresAt(-80, -120);                    // Scafell Pike is 978 m; a 100 m cell averages the summit a little down
    expect(pike).toBeGreaterThan(900); expect(pike).toBeLessThan(1000);
    expect(lakeWaterAt(-1000, 0)).toBe(LAKE_WATER);          // beyond the map is sea
  });
  it('lakes are flat sheets and the ground is continuous', () => {
    const level = cornerMetres(271, 89);
    for (let x = 271; x <= 274; x++) expect(cornerMetres(x, 89)).toBeCloseTo(level, 5);
    const a = groundTiles(290.6, 90.4), b = groundTiles(290.61, 90.4);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    expect(groundTiles(-80, -120) / HEIGHT_STRETCH * REAL_TILE_M).toBeGreaterThan(800);
  });
  it('a chunk is water where the map has water, and sand rings it', () => {
    const cx = Math.floor(272 / CHUNK), cy = Math.floor(89 / CHUNK), g = generateLakeChunk(cx, cy);
    const at = (x: number, y: number) => g.t[(y - cy * CHUNK + MARGIN) * SIDE + (x - cx * CHUNK + MARGIN)];
    expect(at(272, 89)).toBe(WATER);
    const w = new World(1, undefined, 'lakedistrict');
    expect(w.terrainAt(272, 89)).toBe(WATER);
    expect([SAND, GRASS]).toContain(w.terrainAt(290, 89));
    expect(w.heightAt(-80, -120)).toBeGreaterThan(13 * HEIGHT_STRETCH);
    expect(new World(1).heightAt(-80, -120)).toBe(0);          // procedural worlds are flat
  });
  it('the world kind is saved, and old saves stay procedural', () => {
    const lake = newSavedWorld('a', 'Lakes', 5, 1, 'lakedistrict'), plain = newSavedWorld('b', 'Plain', 5, 1);
    expect(plain.kind).toBeUndefined();
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [lake, plain] }))).list;
    expect(back[0].kind).toBe('lakedistrict'); expect(back[1].kind).toBeUndefined();
    expect(back[0].plane.x).toBe(lakeSpawnFor().x); expect(lakeOnMap(lakeSpawnFor().x, lakeSpawnFor().y, 4)).toBe(true); expect(lakeOnMap(900, 0)).toBe(false);   // starts at the spawn, which is on the map
  });
  it('a plane flying into a rising fell lands on it, sooner than on flat ground', () => {
    const fly = (ground?: (x: number, y: number) => number) => {
      const env: GlideEnv = { windX: 0, windY: 0, air: () => 0, ground };
      const g = newGlider(0, 0, 0, 30); throwPlane(g, 0, 0, 0, 30); if (ground) g.gnd = ground(0, 0);
      let t = 0; for (; t < 60 * 60 && !g.landed; t++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, env, 1 / 60);
      return { g, secs: t / 60 };
    };
    const flat = fly(), ramp = fly(x => Math.max(0, x) * 1.2);   // a slope rising 1.2 m per tile ahead of it
    expect(flat.g.landed).toBe(true); expect(ramp.g.landed).toBe(true);
    expect(ramp.secs).toBeLessThan(flat.secs);
    expect(ramp.g.z).toBeGreaterThanOrEqual(0); expect(ramp.g.gnd).toBeGreaterThan(5);   // it came down high on the slope, not at its foot
  });
});

describe('the Coniston map', () => {
  it('is Coniston Water and the Old Man, at 10 m a tile', async () => {
    const { data, info } = await sharp('public/assets/lakedistrict/coniston.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1400); expect(info.height).toBe(1500);
    setLakeData(info.width, info.height, data, '', 'coniston');
    const sp = lakeSpawnFor('coniston'), old = lakeTileOf(-3.1210, 54.3705, 'coniston');
    expect(lakeWaterAt(sp.x, sp.y)).toBe(LAKE_WATER);                         // the spawn is over the lake
    let top = 0, tx = 0, ty = 0;                                                          // (the summit's position is only known to ~100 m: take the highest tile within 15 tiles of it)
    for (let dy = -15; dy <= 15; dy++) for (let dx = -15; dx <= 15; dx++) { const m = lakeMetresAt(Math.round(old.x) + dx, Math.round(old.y) + dy); if (m > top) { top = m; tx = Math.round(old.x) + dx; ty = Math.round(old.y) + dy; } }
    expect(top).toBeGreaterThan(780);                                                       // the Old Man of Coniston is 803 m
    expect(groundTiles(tx, ty) / 0.5 * 10).toBeGreaterThan(700);                           // (10 m a tile, stretch 0.5: the height reads back in metres)
    setLakeData(1426, 1769, new Uint8Array(1426 * 1769 * 4), '', 'lakes');   // leave the big map's shape for the next tests
  });
});

describe('names and roads', () => {
  it('floats a name over Windermere and the top of Scafell Pike', async () => {
    const { data, info } = await sharp(`${DIR}/lakedistrict.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });   // (an earlier test left an empty map loaded)
    setLakeData(info.width, info.height, data);
    const l = lakePlaceLabels();
    const w = l.find(p => p.name === 'Windermere')!, pike = l.find(p => p.name === 'Scafell Pike')!;
    expect(lakeWaterAt(Math.round(w.x), Math.round(w.y))).toBe(LAKE_WATER);
    expect(lakeMetresAt(Math.floor(pike.x), Math.floor(pike.y))).toBeGreaterThan(900);
    expect(l.filter(p => p.kind === 'summit').length).toBeGreaterThan(12);
  });
  it('the M6 is found on its line and not far from it', async () => {
    const { data, info } = await sharp(`${DIR}/lakedistrict.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    setLakeData(info.width, info.height, data);
    const a = lakeTileOf(-2.72, 54.20);
    expect(lakeRoadAt(a.x, a.y)).toBe('M6');
    expect(lakeRoadAt(a.x - 40, a.y)).toBeNull();
  });
});

describe('real roads', () => {
  it('the M6 and the A591 are found, and chunks stay fast to build', async () => {
    const { data, info } = await sharp(`${DIR}/lakedistrict.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    setLakeData(info.width, info.height, data);
    const roads = JSON.parse(roadsRaw);
    setLakeRoads('lakes', roads.lakes);
    const refs = new Set<string>();
    for (const r of roads.lakes) if (r.ref === 'M6' || r.ref === 'A591') { const t = lakeTileOf(r.pts[0][0], r.pts[0][1]); if (lakeRoadAt(t.x, t.y) === r.ref) refs.add(r.ref); }
    expect(refs.has('M6')).toBe(true); expect(refs.has('A591')).toBe(true);
    const t0 = performance.now(); let sand = 0;
    for (let cx = 0; cx < 8; cx++) { const c = generateLakeChunk(cx, 3); for (const v of c.t) if (v === SAND) sand++; }
    expect(performance.now() - t0).toBeLessThan(400); expect(sand).toBeGreaterThan(0);
  });
});
