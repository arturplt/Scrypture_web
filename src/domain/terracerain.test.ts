import { describe, expect, it } from 'vitest';
import { Ecosystem, defaultWind } from './ecosystem';
import { World, WATER, tileKey, keyX, keyY, plainTile } from './worldgen';
import { terraceSpawn, onLedge, TerraceField, TERRACE_STEP, terraceChunkMesh, terraceLakeAt, terraceSpawn as spawnOf } from './terrace';
import { mulberry32 } from './sanctuary';

/** A terraced world with the weather ready: no clouds of its own, the area watched round the spawn. */
function scene(seed = 7) {
  const w = new World(seed, undefined, 'terraced'), sp = terraceSpawn(seed), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 });
  e.setWatchedArea(sp.x - 50, sp.y - 50, sp.x + 50, sp.y + 50); e.step(0.1);
  (e as any).importCloud = () => {}; (e as any).spawnCloud = () => {}; e.clouds.length = 0;
  return { w, e, sp, packets: () => (e as any).packets as { x: number; y: number; n: number }[] };
}

describe('rain on the terraced hills', () => {
  it('is a sloping world for the weather (rain runs downhill), but has no tarns or lake ponds', () => {
    const { e } = scene();
    expect(e.slopes).toBe(true); expect(e.hilly).toBe(false);
    expect((e as any).tarnAt(0, 0)).toBeNull();
  });

  it('runs a packet of rain downhill and wets the ground it crosses', () => {
    const { w, e, sp, packets } = scene();
    // a start a good way up: the highest land within 30 tiles of the spawn
    let best = { x: sp.x, y: sp.y, h: -1 };
    for (let dy = -30; dy <= 30; dy += 2) for (let dx = -30; dx <= 30; dx += 2) { const h = w.metresAt(sp.x + dx, sp.y + dy); if (h > best.h && w.terrainAt(sp.x + dx, sp.y + dy) !== WATER) best = { x: sp.x + dx, y: sp.y + dy, h }; }
    const start = w.metresAt(best.x, best.y);
    for (let i = 0; i < 30; i++) packets().push({ x: best.x, y: best.y, n: 0 });
    for (let t = 0; t < 60; t += 0.5) e.step(0.5);
    const trickle = (e as any).trickle as Map<number, number>;
    expect(trickle.size).toBeGreaterThan(3);
    for (const k of trickle.keys()) expect(w.metresAt(keyX(k), keyY(k))).toBeLessThanOrEqual(start + 1e-6);   // (it only ever went down from where it started)
  });

  it('turns wet ground that keeps being crossed into a stream that runs on down to water in one joined line, sunk into the ground', () => {
    const { w, e, sp, packets } = scene(11);
    for (let t = 0; t < 900; t += 0.5) { if (packets().length < 8) for (let i = 0; i < 4; i++) packets().push({ x: sp.x + i * 3, y: sp.y + 12, n: 0 }); e.step(0.5); }
    const becks = (e as any).becks as Map<number, number>;
    expect(becks.size).toBeGreaterThan(8);
    const lines = new Map<number, number[]>();
    for (const [k, l] of becks) (lines.get(l) ?? lines.set(l, []).get(l)!).push(k);
    let joined = 0, toWater = 0;
    for (const ks of lines.values()) {
      if (ks.length < 3) continue;
      joined++;
      for (const k of ks) {
        expect(w.terrainAt(keyX(k), keyY(k))).toBe(WATER);
        expect(ks.some(o => o !== k && Math.abs(keyX(o) - keyX(k)) <= 1 && Math.abs(keyY(o) - keyY(k)) <= 1)).toBe(true);   // (one joined line: no lone tile)
        expect(w.field!.heightAt(keyX(k) + 0.5, keyY(k) + 0.5)).toBeLessThan(w.heightAt(keyX(k) + 0.5, keyY(k) + 0.5) + 1e-9);
        expect(w.field!.waterTopAt(keyX(k) + 0.5, keyY(k) + 0.5)).toBeGreaterThanOrEqual(0);
      }
      // the line runs into water that is not itself: the sea, a lake, a pond, or the pool it ends in
      const ends = ks.some(k => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.terrainAt(keyX(k) + dx, keyY(k) + dy) === WATER && !becks.has(tileKey(keyX(k) + dx, keyY(k) + dy))));
      if (ends) toWater++;
    }
    expect(joined).toBeGreaterThan(0); expect(toWater).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const run = () => { const { e, sp, packets } = scene(5); for (let t = 0; t < 200; t += 0.5) { if (packets().length < 6) packets().push({ x: sp.x, y: sp.y + 8, n: 0 }); e.step(0.5); } return [...((e as any).trickle as Map<number, number>).keys()].sort().join(','); };
    expect(run()).toBe(run());
  });
});

describe('ponds on the terraced hills', () => {
  it('lays a flat sheet of water over the ground at a shelf, and takes it off again', () => {
    const f = new TerraceField(42);
    // a tile whose natural ground is below shelf 6
    let tx = 0, ty = 0; for (let k = 0; k < 4000; k++) { tx = (k * 37) % 200 - 100; ty = Math.floor(k / 5) % 200 - 100; if (f.elevationAt(tx, ty) > 1 && f.elevationAt(tx, ty) < 5) break; }
    const natural = f.naturalAt(tx, ty), before = f.heightAt(tx + 0.5, ty + 0.5);
    f.setFill([[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]], 6);
    expect(f.heightAt(tx + 0.5, ty + 0.5)).toBeCloseTo(6 * TERRACE_STEP, 6);
    expect(f.heightAt(tx + 1, ty + 1)).toBeCloseTo(6 * TERRACE_STEP, 6);   // (the point all four touch: inside the sheet)
    expect(f.naturalAt(tx, ty)).toBeCloseTo(natural, 6);          // (the natural ground is still there to measure by)
    const dirty = f.takeDirty(); expect(dirty.length).toBeGreaterThan(0); expect(f.takeDirty().length).toBe(0);
    expect(dirty.some(([cx, cy]) => cx === Math.floor(tx / 16) && cy === Math.floor(ty / 16))).toBe(true);
    f.setFill([[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]], null);
    expect(f.heightAt(tx + 0.5, ty + 0.5)).toBeCloseTo(before, 6);
  });

  it('a closed shelf collects rain into a tarn that fills the shelf and no more, and gives it back in a dry spell', () => {
    const { w, e, sp } = scene(7);
    e.setWatchedArea(sp.x - 150, sp.y - 150, sp.x + 150, sp.y + 150); e.step(0.1);
    let spot: [number, number] | null = null;
    for (let dy = -140; dy <= 140 && !spot; dy++) for (let dx = -140; dx <= 140 && !spot; dx++) { const x = sp.x + dx, y = sp.y + dy; if (w.terrainAt(x, y) !== WATER && (e as any).tarnAt(x, y)) spot = [x, y]; }
    expect(spot).not.toBeNull();
    e.setWatchedArea(spot![0] - 25, spot![1] - 25, spot![0] + 25, spot![1] + 25); e.step(0.1);   // (a small area from here on: stepping a big one is slow)
    const tarn = (e as any).tarnAt(spot![0], spot![1]) as { pond: { tiles: [number, number][]; level: number }; vol: number; region: number[] };
    const shelf = tarn.region.length;
    tarn.vol = 40;
    for (let t = 0; t < 600; t += 1) { tarn.vol = Math.max(tarn.vol, 30); e.step(1); }
    expect(tarn.pond.tiles.length).toBeGreaterThan(1);
    expect(tarn.pond.tiles.length).toBeLessThanOrEqual(shelf);
    for (const [x, y] of tarn.pond.tiles) { expect(w.terrainAt(x, y)).toBe(WATER); expect(Math.floor(w.metresAt(x, y) / 30 + 1e-9)).toBe(Math.floor(tarn.pond.level / 30 + 1e-9)); }   // (never past the top of its shelf)
    const grown = tarn.pond.tiles.length;
    tarn.vol = -20;
    for (let t = 0; t < 6000; t += 2) { tarn.vol = Math.min(tarn.vol, -20); e.step(2); }
    expect(tarn.pond.tiles.length).toBeLessThan(grown);
  });

  it('cuts the mesh of a chunk with a pond in it: the sheet is level at its shelf, and the pieces still tile the chunk', () => {
    const f = new TerraceField(42), tiles: [number, number][] = [];
    for (let y = 4; y < 9; y++) for (let x = 5; x < 11; x++) tiles.push([x, y]);
    f.setFill(tiles, 9);
    const m = terraceChunkMesh(f.grid(0, 0).e, 0, 0);
    let area = 0, pond = 0;
    for (let k = 0; k < m.idx.length; k += 3) {
      const a = m.idx[k], b = m.idx[k + 1], c = m.idx[k + 2];
      if (m.nrm[a * 3 + 2] !== -1) continue;
      area += Math.abs((m.pos[b * 3] - m.pos[a * 3]) * (m.pos[c * 3 + 1] - m.pos[a * 3 + 1]) - (m.pos[c * 3] - m.pos[a * 3]) * (m.pos[b * 3 + 1] - m.pos[a * 3 + 1])) / 2;
      const x = (m.pos[a * 3] + m.pos[b * 3] + m.pos[c * 3]) / 3, y = (m.pos[a * 3 + 1] + m.pos[b * 3 + 1] + m.pos[c * 3 + 1]) / 3;
      if (x > 5.5 && x < 9.5 && y > 4.5 && y < 7.5) { pond++; expect(-m.pos[a * 3 + 2]).toBeCloseTo(9 * TERRACE_STEP, 5); }
    }
    expect(area).toBeCloseTo(256, 3); expect(pond).toBeGreaterThan(5);
  });

  it('rains over the middle of the watched area: the wind tops the sky up, and a cloud may not rain before it has blown in', () => {
    const w = new World(10, undefined, 'terraced'), sp = terraceSpawn(10), e = new Ecosystem(w, mulberry32(3), defaultWind());
    e.setWatchedArea(sp.x - 60, sp.y - 60, sp.x + 60, sp.y + 60);
    let near = 0;
    for (let t = 0; t < 900; t++) { e.step(1); if (e.clouds.some(c => c.raining && Math.hypot(c.x - sp.x, c.y - sp.y) < 25)) near++; }
    expect(near).toBeGreaterThan(60);
  });

  it('lays see-through sheets of water over inland water, a layer apart from the bed up to the shore, cut from the ground pieces, and none over dry ground or the sea', () => {
    const f = new TerraceField(5);
    let found = false, deepest = 0, underVerts = 0;
    for (let cy = -4; cy <= 4; cy++) for (let cx = -4; cx <= 4; cx++) {
      const m = terraceChunkMesh(f.grid(cx, cy).e, cx, cy, (x, y) => f.waterTopAt(x, y));
      if (m.sub.some(v => v)) underVerts++;
      if (!m.widx.length) continue;
      found = true;
      expect(m.widx.length % 3).toBe(0);
      const layersAt = new Map<string, Set<number>>();
      for (let v = 0; v < m.wpos.length / 3; v++) {
        const x = m.wpos[v * 3], y = m.wpos[v * 3 + 1], layer = -m.wpos[v * 3 + 2] / TERRACE_STEP;
        expect(layer).toBeCloseTo(Math.round(layer), 6);
        const k = `${Math.floor(x * 2)},${Math.floor(y * 2)}`; (layersAt.get(k) ?? layersAt.set(k, new Set()).get(k)!).add(Math.round(layer));
      }
      for (const ls of layersAt.values()) deepest = Math.max(deepest, ls.size);
    }
    expect(found).toBe(true); expect(underVerts).toBeGreaterThan(0);
    expect(deepest).toBeGreaterThan(1);   // (a lake's bed steps down: its middle has more sheets than its rim)
    const dry = terraceChunkMesh(new TerraceField(5).grid(40, 40).e, 40, 40, () => -1);
    expect(dry.widx.length).toBe(0);
    expect(dry.sub.some(v => v)).toBe(false);
  });

  it('sinks the water the weather makes, deeper the more water surrounds a tile, to the same surface', () => {
    const { w, e } = scene(7), f = w.field!;
    e.setWatchedArea(-200, -200, 200, 200); e.step(0.1);
    // a flat 7 x 7 patch of one layer, 4 or more
    let at: [number, number] | null = null;
    for (let y = -150; y < 150 && !at; y += 3) for (let x = -150; x < 150 && !at; x += 3) {
      const c = w.naturalLayerAt(x, y); if (c < 4) continue;
      let flat = true; for (let dy = -4; dy <= 4 && flat; dy++) for (let dx = -4; dx <= 4; dx++) if (w.naturalLayerAt(x + dx, y + dy) !== c || w.generatedTerrain(x + dx, y + dy) === WATER) { flat = false; break; }
      if (flat) at = [x, y];
    }
    expect(at).not.toBeNull();
    const [cx, cy] = at!, top = w.naturalLayerAt(cx, cy);
    (e as any).by('rain', () => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) (e as any).put(cx + dx, cy + dy, plainTile(WATER)); });
    const h = (dx: number, dy: number) => f.heightAt(cx + dx + 0.5, cy + dy + 0.5);
    expect(h(0, 0)).toBeCloseTo(TERRACE_STEP * (top - 3), 6);   // water two tiles out all round: three steps down
    expect(h(2, 0)).toBeCloseTo(TERRACE_STEP * (top - 2), 6);   // water on all eight sides: two
    expect(h(3, 0)).toBeCloseTo(TERRACE_STEP * (top - 1), 6);   // on the edge: one
    for (const [dx, dy] of [[0, 0], [2, 0], [3, 3]]) expect(f.waterTopAt(cx + dx + 0.5, cy + dy + 0.5)).toBe(top);   // (one surface: the shelf beside it)
    (e as any).by('rain', () => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) (e as any).put(cx + dx, cy + dy, plainTile(2)); });
    expect(h(0, 0)).toBeCloseTo(TERRACE_STEP * top, 6);   // dry again: back to the shelf
  });

  it('marks a beaver\'s dam pond as its own kind of water (a different tint), sunk and sheeted like the rest, even on a low shelf', () => {
    const { w, e } = scene(7), f = w.field!;
    e.setWatchedArea(-200, -200, 200, 200); e.step(0.1);
    let at: [number, number] | null = null;
    for (let y = -150; y < 150 && !at; y += 3) for (let x = -150; x < 150 && !at; x += 3) {
      const c = w.naturalLayerAt(x, y); if (c < 1 || c > 2) continue;
      let flat = true; for (let dy = -3; dy <= 3 && flat; dy++) for (let dx = -8; dx <= 3; dx++) if (w.naturalLayerAt(x + dx, y + dy) !== c || w.generatedTerrain(x + dx, y + dy) === WATER) { flat = false; break; }
      if (flat) at = [x, y];
    }
    expect(at).not.toBeNull();
    const [cx, cy] = at!;
    (e as any).by('dam', () => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) (e as any).put(cx + dx, cy + dy, plainTile(WATER)); });
    (e as any).by('rain', () => { for (let dy = -2; dy <= 2; dy++) for (let dx = -7; dx <= -4; dx++) (e as any).put(cx + dx, cy + dy, plainTile(WATER)); });
    const dam = f.waterSheetAt(cx + 0.5, cy + 0.5), other = f.waterSheetAt(cx - 5.5, cy + 0.5);
    expect(dam - Math.floor(dam)).toBeCloseTo(0.5, 6); expect(other - Math.floor(other)).toBe(0);
    expect(Math.floor(dam)).toBeGreaterThanOrEqual(1);
    expect(f.heightAt(cx + 0.5, cy + 0.5)).toBeLessThan(w.heightAt(cx + 0.5, cy + 0.5) + 1e-9);
  });

  it('sheets the water on the beach shelf too (a thin film, it cannot sink), and sinks the water a loaded world already has', () => {
    const base = new World(7, undefined, 'terraced');
    let at: [number, number] | null = null;
    for (let y = -250; y < 250 && !at; y += 3) for (let x = -250; x < 250 && !at; x += 3) {
      if (base.naturalLayerAt(x, y) !== 0 || base.generatedTerrain(x, y) === WATER) continue;
      let flat = true; for (let dy = -3; dy <= 3 && flat; dy++) for (let dx = -3; dx <= 3; dx++) if (base.naturalLayerAt(x + dx, y + dy) !== 0 || base.generatedTerrain(x + dx, y + dy) === WATER) { flat = false; break; }
      if (flat) at = [x, y];
    }
    expect(at).not.toBeNull();
    const [cx, cy] = at!, changes: [number, ReturnType<typeof plainTile>][] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) changes.push([tileKey(cx + dx, cy + dy), plainTile(WATER)]);
    const w = new World(7, changes, 'terraced'), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 }), f = w.field!;
    expect(e).toBeDefined();
    expect(f.waterTopAt(cx + 0.5, cy + 0.5)).toBe(0);   // (the water a world was loaded with has its sheet: no flat tile picture)
    const gx = Math.floor(cx / 16), gy = Math.floor(cy / 16), m = terraceChunkMesh(f.grid(gx, gy).e, gx, gy, (x, y) => f.waterSheetAt(x, y));
    expect(m.widx.length).toBeGreaterThan(0);
    for (let v = 0; v < m.wpos.length / 3; v++) expect(-m.wpos[v * 3 + 2]).toBeCloseTo(TERRACE_STEP * 0.18, 6);
    expect(spawnOf(7)).toBeDefined();
  });
});
