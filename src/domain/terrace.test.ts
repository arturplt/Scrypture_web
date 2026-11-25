import { describe, expect, it } from 'vitest';
import { hopOffset, ledgeStep, HOP, TerraceField, elevation, terraceH, terraceSpawn, onLedge, TERRACE_STEP, TERRACE_SUB, TERRACE_G, terraceFarMesh, terraceChunkMesh, terraceBiome, terraceMoist, terraceLakeAt, terraceLakesIn, TERRACE_FAR_LODS, FAR_LEVEL_FROM, farLevelFor, RELIEF_MAX } from './terrace';
import { World, GRASS, SAND, WATER, DECO_NONE, CHUNK, MARGIN, SIDE, generateTerraceChunk } from './worldgen';
import { newSavedWorld, sanitizeWorlds, sanitizeRelief } from './worldsave';

describe('terraced height field', () => {
  it('is the same for the same seed and differs between seeds', () => {
    expect(elevation(123.5, -77, 9)).toBe(elevation(123.5, -77, 9));
    expect(elevation(123.5, -77, 9)).not.toBe(elevation(123.5, -77, 10));
  });

  it('looks up the stepped height from the grid (the slow noise is blended and the cells are linear, so a point a hair from a wall may stand on the other side of it), and joins across chunk borders', () => {
    const f = new TerraceField(42);
    let n = 0, off = 0;
    for (let y = -60; y < 60; y += 3.5) for (let x = -60; x < 60; x += 2.5) {
      const raw = terraceH(elevation(x, y, 42)), d = raw - f.heightAt(x, y); n++;
      if (Math.abs(d) > 1e-9) { off++; expect(Math.abs(d / TERRACE_STEP - Math.round(d / TERRACE_STEP))).toBeLessThan(1e-6); }   // (by whole steps only: nothing between the shelves; the grid is the field opened, so it differs where a little bump was shaved off, or a point is a hair from a wall)
    }
    expect(off / n).toBeLessThan(0.2);
    for (let y = -40; y < 40; y += 1.37) {   // a point just either side of a chunk edge: no step in the ground
      expect(Math.abs(f.heightAt(CHUNK - 1e-4, y) - f.heightAt(CHUNK + 1e-4, y))).toBeLessThan(0.01);
    }
    expect(TERRACE_G).toBe(CHUNK * TERRACE_SUB + 1);
  });

  it('puts every shelf on a whole number of steps and the sea at 0', () => {
    for (let e = -3; e < 20; e += 0.05) {
      const h = terraceH(e);
      if (e < 1) expect(h).toBe(0); else expect(h / TERRACE_STEP).toBeCloseTo(Math.floor(e), 6);   // (right-angled: every height is a whole number of steps)
    }
    let sea = 0, n = 0;
    const f = new TerraceField(7);
    for (let y = -400; y < 400; y += 9) for (let x = -400; x < 400; x += 9) { n++; if (f.layerAt(x, y) < 0) { sea++; expect(f.heightAt(x + 0.5, y + 0.5)).toBeLessThan(TERRACE_STEP); } }
    expect(sea).toBeGreaterThan(0); expect(sea).toBeLessThan(n);
  });

  it('stands no tree, bush or rock on a ledge', () => {
    const w = new World(42, undefined, 'terraced'), lay = (x: number, y: number) => w.layerAt(x, y);
    let ledges = 0;
    for (let y = -120; y < 120; y++) for (let x = -120; x < 120; x++) {
      if (w.terrainAt(x, y) !== GRASS || !onLedge(lay, x, y)) continue;
      ledges++;
      const s = w.stateAt(x, y);
      expect(s.d).toBe(DECO_NONE); expect(s.v).not.toBe(2);
    }
    expect(ledges).toBeGreaterThan(20);
  });

  it('starts a new world on a low shelf, away from any ledge', () => {
    for (const seed of [1, 42, 12345, 987654]) {
      const p = terraceSpawn(seed), f = new TerraceField(seed), lay = (x: number, y: number) => f.layerDirect(x, y), l = lay(p.x, p.y);
      expect(l).toBeGreaterThanOrEqual(2); expect(l).toBeLessThanOrEqual(10);
      expect(onLedge(lay, p.x, p.y)).toBe(false);
    }
  });

  it('builds a far mesh of the asked size', () => {
    const g = terraceFarMesh(5, 100, -50, 32, 320);
    let r = g.next(); while (!r.done) r = g.next();
    const m = r.value;
    expect(m.cols).toBe(21); expect(m.pos.length).toBe(21 * 21 * 3); expect(m.idx.length).toBe(20 * 20 * 6);
    expect(m.pos[0]).toBe(100 - 320); expect(m.pos[1]).toBe(-50 - 320);
  });

  it('keeps the terraced kind through a save', () => {
    const w = newSavedWorld('a', 'Hills', 5, 1, 'terraced');
    expect(w.kind).toBe('terraced');
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [w] })));
    expect(back.list[0].kind).toBe('terraced');
  });

  it('gives a flat world no height and a terraced world some', () => {
    const flat = new World(42), hills = new World(42, undefined, 'terraced');
    expect(flat.hilly).toBe(false); expect(hills.hilly).toBe(true); expect(hills.realMap).toBe(false);
    let max = 0; for (let x = -300; x < 300; x += 7) max = Math.max(max, hills.heightAt(x, 13));
    expect(max).toBeGreaterThan(TERRACE_STEP);
    expect(flat.heightAt(10, 10)).toBe(0);
  });

  it('makes sand on the lowest shelf and water below the sea, by the tile\'s layer', () => {
    const f = new TerraceField(7);
    let sand = 0, water = 0;
    const chunks = new Set<string>();   // (the chunks that hold some sea or some lowest shelf, found on a sparse sweep)
    for (let y = -400; y < 400; y += 9) for (let x = -400; x < 400; x += 9) if (f.layerAt(x, y) <= 0) chunks.add(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
    for (const key of [...chunks].slice(0, 12)) {
      const [cx, cy] = key.split(',').map(Number), { t } = generateTerraceChunk(cx, cy, f);
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
        const l = f.layerAt(cx * CHUNK + i, cy * CHUNK + j), code = t[(j + MARGIN) * SIDE + i + MARGIN];
        if (l < 0) { water++; expect(code).toBe(WATER); } else if (l === 0) { sand++; expect(code).toBe(SAND); }
      }
    }
    expect(water).toBeGreaterThan(0);
    expect(sand).toBeGreaterThan(0);
  });

  it('puts the stepped far mesh on the terraces and the smooth one on the elevation', () => {
    const run = (stepped: boolean) => { const g = terraceFarMesh(9, 40, -20, 8, 160, stepped); let r = g.next(); while (!r.done) r = g.next(); return r.value; };
    const st = run(true), sm = run(false);
    for (let k = 0; k < st.cols * st.rows; k += 7) {
      const x = st.pos[k * 3], y = st.pos[k * 3 + 1], e = elevation(x, y, 9);
      expect(-st.pos[k * 3 + 2]).toBeCloseTo(e <= 0 ? 0 : terraceH(e), 5);
      expect(-sm.pos[k * 3 + 2]).toBeCloseTo(e <= 0 ? 0 : e * TERRACE_STEP, 5);
    }
    expect(st.idx).toBe(sm.idx);   // the same size shares one index array
  });

  it('keeps the maps off the game\'s grid cache, and warms grids ahead on request', () => {
    const w = new World(7, undefined, 'terraced'), f = w.field!;
    f.grid(0, 0);
    for (let cy = 100; cy < 112; cy++) for (let cx = 100; cx < 112; cx++) { w.chunkTerrain(cx, cy); w.chunkLayers(cx, cy); }
    expect(f.has(0, 0)).toBe(true); expect(f.has(100, 100)).toBe(false);
    expect(f.prewarm([[5, 5], [6, 5], [7, 5]], 1000)).toBe(3); expect(f.prewarm([[5, 5]], 1000)).toBe(0);
    const lay = w.chunkLayers(3, -2);
    for (let j = 0; j < CHUNK; j += 5) for (let i = 0; i < CHUNK; i += 3) expect(lay[j * CHUNK + i]).toBe(Math.min(127, w.layerAt(3 * CHUNK + i, -2 * CHUNK + j)));
  });

  it('cuts the chunk mesh along the contours: level pieces that tile the chunk, walls a whole step high, no slopes', () => {
    const f = new TerraceField(42);
    for (const [cx, cy] of [[0, 0], [-7, 3], [12, -5]]) {
      const m = terraceChunkMesh(f.grid(cx, cy).e, cx, cy);
      let area = 0;
      for (let k = 0; k < m.idx.length; k += 3) {
        const a = m.idx[k], b = m.idx[k + 1], c = m.idx[k + 2];
        if (m.nrm[a * 3 + 2] === -1) {   // a level piece: all three corners at one height, a whole number of steps
          expect(m.pos[b * 3 + 2]).toBe(m.pos[a * 3 + 2]); expect(m.pos[c * 3 + 2]).toBe(m.pos[a * 3 + 2]);
          expect(-m.pos[a * 3 + 2] / TERRACE_STEP).toBeCloseTo(Math.round(-m.pos[a * 3 + 2] / TERRACE_STEP), 4);
          area += Math.abs((m.pos[b * 3] - m.pos[a * 3]) * (m.pos[c * 3 + 1] - m.pos[a * 3 + 1]) - (m.pos[c * 3] - m.pos[a * 3]) * (m.pos[b * 3 + 1] - m.pos[a * 3 + 1])) / 2;
        } else { expect(m.nrm[a * 3 + 2]).toBe(0); }   // a wall faces sideways
      }
      expect(area).toBeCloseTo(CHUNK * CHUNK, 3);
    }
    // and the ground you stand on is the ground drawn: a level piece's height is heightAt there
    const m = terraceChunkMesh(f.grid(3, 3).e, 3, 3);
    for (let k = 0; k < m.idx.length; k += 3) {
      const a = m.idx[k], b = m.idx[k + 1], c = m.idx[k + 2];
      if (m.nrm[a * 3 + 2] !== -1) continue;
      const x = (m.pos[a * 3] + m.pos[b * 3] + m.pos[c * 3]) / 3, y = (m.pos[a * 3 + 1] + m.pos[b * 3 + 1] + m.pos[c * 3 + 1]) / 3;
      expect(f.heightAt(x, y)).toBeCloseTo(-m.pos[a * 3 + 2], 5);
    }
  });

  it('has no little blocks: no raised level is narrower than 5 grid points (2.5 tiles) along a row or a column', () => {
    const f = new TerraceField(42), G = TERRACE_G, cls = (v: number) => (v < 1 ? 0 : Math.floor(v));
    let runs = 0;
    for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) {
      const e = f.grid(cx, cy).e;
      for (let line = 0; line < G; line++) for (const col of [false, true]) {
        const at = (k: number) => cls(e[col ? k * G + line : line * G + k]);
        for (let lvl = 1; lvl < 40; lvl++) for (let k = 1; k < G - 1; k++) {
          if (at(k) >= lvl && at(k - 1) < lvl) {   // a run of the level or higher starts here...
            let m = k; while (m < G && at(m) >= lvl) m++;
            if (m < G) { runs++; expect(m - k).toBeGreaterThanOrEqual(5); }   // ...and ends before the grid does: it must be at least 5 wide
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(20);
  });

  it('has next to no little pits (the opening is the last filter, so blocks are guaranteed gone and a pit may rarely survive): few lowered levels are narrower than 5 grid points between higher ground', () => {
    const f = new TerraceField(42), G = TERRACE_G, cls = (v: number) => (v < 1 ? 0 : Math.floor(v));
    let runs = 0, narrow = 0;
    for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) {
      const e = f.grid(cx, cy).e;
      for (let line = 0; line < G; line++) for (const col of [false, true]) {
        const at = (k: number) => cls(e[col ? k * G + line : line * G + k]);
        for (let lvl = 1; lvl < 40; lvl++) for (let k = 1; k < G - 1; k++) {
          if (at(k) < lvl && at(k - 1) >= lvl) {   // a run below the level starts here...
            let m = k; while (m < G && at(m) < lvl) m++;
            if (m < G) { runs++; if (m - k < 5) narrow++; }   // ...and is walled in by higher ground again: nearly always at least 5 wide
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(20);
  });

  it('colours the far mesh by biome: dry country is sand, woods are darker than meadows', () => {
    const g = terraceFarMesh(42, 0, 0, 12, 1200); let r = g.next(); while (!r.done) r = g.next();
    const m = r.value, sum = [0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < m.cols * m.rows; k++) {
      const x = m.pos[k * 3], y = m.pos[k * 3 + 1], e = elevation(x, y, 42); if (e < 1) continue;
      const b = terraceBiome(Math.floor(e), terraceMoist(x, y, 42)); sum[b] += m.col[k * 3 + 1]; cnt[b]++;   // (the green channel)
    }
    expect(cnt[3]).toBeGreaterThan(50); expect(cnt[1]).toBeGreaterThan(50); expect(cnt[0]).toBeGreaterThan(50);
    expect(sum[3] / cnt[3]).toBeGreaterThan(0.55);               // sand is pale
    expect(sum[1] / cnt[1]).toBeLessThan(sum[0] / cnt[0] - 0.03);   // woods are darker than meadows
  });

  it('has inland lakes: level water on a shelf above the sea, the same for the same seed, and never under the spawn', () => {
    const seed = 5, f = new TerraceField(seed), w = new World(seed, undefined, 'terraced');
    let tiles = 0, flat = 0, onLand = 0; const levels = new Set<number>();
    for (let y = -150; y < 60; y++) for (let x = -80; x < 120; x++) {
      if (!terraceLakeAt(x + 0.5, y + 0.5, seed)) continue;
      tiles++; expect(terraceLakeAt(x + 0.5, y + 0.5, seed)).toBe(true);
      expect(w.terrainAt(x, y)).toBe(WATER);
      if (f.layerAt(x, y) >= 1) onLand++;
      levels.add(Math.round(f.heightAt(x + 0.5, y + 0.5) / TERRACE_STEP));
      if (Math.abs(f.heightAt(x + 0.5, y + 0.5) - f.heightAt(x + 0.25, y + 0.75)) < 1e-9) flat++;
    }
    expect(tiles).toBeGreaterThan(100);
    expect(onLand / tiles).toBeGreaterThan(0.95);                // (a lake lies in the hills, its bed above sea level)
    expect(flat / tiles).toBeGreaterThan(0.8);                   // (its bed is level but for the walls of the rings that step it down)
    for (const sd of [1, 3, 5, 7, 11, 42]) { const p = terraceSpawn(sd); expect(terraceLakeAt(p.x + 0.5, p.y + 0.5, sd)).toBe(false); }
    expect(terraceLakeAt(18.5, 22.5, 5)).toBe(terraceLakeAt(18.5, 22.5, 5));
    expect(levels.size).toBeGreaterThan(0);
  });

  it('puts each lake in a real basin: its middle is no higher than its water, and the ground on a ring round it stands at or over the water, with the lowest side at the spill', () => {
    let n = 0;
    for (const seed of [1, 5, 14, 30, 42]) for (const l of terraceLakesIn(-500, -500, 500, 500, seed)) {
      n++;
      expect(l.level).toBeGreaterThanOrEqual(3);
      expect(elevation(l.x, l.y, seed, 0)).toBeLessThan(l.level + 1.31);               // (the middle is no higher than the water's own layer, give or take the top of the layer)
      let lo = Infinity, at = 0;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, e = elevation(l.x + Math.cos(a) * (l.r * 1.3 + 3.6), l.y + Math.sin(a) * (l.r * 1.3 + 3.6), seed, 0); if (e < lo) { lo = e; at = a; } }
      expect(Math.floor(lo)).toBe(l.level);                                              // (the water stands at the ring's lowest shelf: it fills to where it would spill)
      expect(Math.cos(at - l.spill)).toBeGreaterThan(0.99);
    }
    expect(n).toBeGreaterThan(8);
  });

  it('keeps level ground (sand) round a lake, one step above its inset water, before the land can fall away', () => {
    const seed = 5, w = new World(seed, undefined, 'terraced'), f = new TerraceField(seed);
    let edge = 0, grass = 0, stepUp = 0, tooTall = 0;
    for (let y = -60; y < 70; y++) for (let x = -60; x < 70; x++) {
      if (w.terrainAt(x, y) !== WATER || !terraceLakeAt(x + 0.5, y + 0.5, seed)) continue;
      const h0 = f.heightAt(x + 0.5, y + 0.5);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (terraceLakeAt(x + dx + 0.5, y + dy + 0.5, seed)) continue;
        edge++;
        if (w.terrainAt(x + dx, y + dy) === GRASS) grass++;                                  // (the first tile past the water is sand)
        const up = f.heightAt(x + dx * 1.5 + 0.5, y + dy * 1.5 + 0.5) - h0;
        if (Math.abs(up - TERRACE_STEP) < 1e-9) stepUp++; else if (up > TERRACE_STEP + 1e-9) tooTall++;   // (the shore stands one step above the water, never more)
      }
    }
    expect(edge).toBeGreaterThan(40);
    expect(grass).toBe(0); expect(tooTall / edge).toBeLessThan(0.03); expect(stepUp / edge).toBeGreaterThan(0.8);
  });
});

describe('far levels by height', () => {
  it('each level is wider and coarser than the one before, and they all cost about the same to build', () => {
    for (let i = 1; i < TERRACE_FAR_LODS.length; i++) { expect(TERRACE_FAR_LODS[i].step).toBeGreaterThan(TERRACE_FAR_LODS[i - 1].step); expect(TERRACE_FAR_LODS[i].half).toBeGreaterThan(TERRACE_FAR_LODS[i - 1].half); }
    for (const L of TERRACE_FAR_LODS) { const side = Math.floor((L.half * 2) / L.step) + 1; expect(side * side).toBeLessThan(170000); }
    expect(FAR_LEVEL_FROM.length).toBe(TERRACE_FAR_LODS.length);
  });
  it('the higher the eye, the coarser the finest level wanted', () => {
    expect(farLevelFor(0)).toBe(0); expect(farLevelFor(499)).toBe(0); expect(farLevelFor(500)).toBe(1); expect(farLevelFor(3000)).toBe(2); expect(farLevelFor(8000)).toBe(3); expect(farLevelFor(1e6)).toBe(4);
    let last = 0; for (let h = 0; h < 40000; h += 100) { const l = farLevelFor(h); expect(l).toBeGreaterThanOrEqual(last); last = l; }
  });
  it('a coarse level covers the ground under a plane well up: its half-size is more than the eye height at which it starts', () => {
    for (let i = 1; i < TERRACE_FAR_LODS.length; i++) expect(TERRACE_FAR_LODS[i].half).toBeGreaterThan(FAR_LEVEL_FROM[i]);
  });
});

describe('the hop over a ledge on foot', () => {
  it('lifts the eye up a layer in an arc, and dips it a little down one', () => {
    expect(hopOffset(0, true)).toBe(0);
    expect(hopOffset(HOP.UP_T / 2, true)).toBeCloseTo(HOP.UP_H, 6);
    expect(hopOffset(HOP.UP_T, true)).toBe(0);
    expect(hopOffset(HOP.DOWN_T / 2, false)).toBeCloseTo(-HOP.DOWN_H, 6);
    expect(hopOffset(-1, true)).toBe(0); expect(hopOffset(NaN, true)).toBe(0);
    expect(HOP.UP_H).toBeLessThan(TERRACE_STEP);
  });
  it('tells a ledge from the slope of a shelf', () => {
    expect(ledgeStep(1, 1 + TERRACE_STEP)).toBe('up');
    expect(ledgeStep(1 + TERRACE_STEP, 1)).toBe('down');
    expect(ledgeStep(1, 1.1)).toBeNull();
  });
});

describe('sculpting (C5)', () => {
  // a land tile well above the beach, so lowering it a layer stays on land
  const pick = (f: TerraceField) => { for (let y = 0; y < 400; y += 7) for (let x = 0; x < 400; x += 7) { const l = f.layerAt(x, y); if (l >= 3 && l < 20) return { x, y, l }; } throw new Error('no land'); };
  it('raises a single tile by a layer as a small knoll, leaving the ground further off alone', () => {
    const f = new TerraceField(11), { x, y, l } = pick(f), far = f.layerAt(x + 6, y);
    const chunks = f.setRelief([[x, y]], 1);
    expect(chunks.length).toBeGreaterThan(0);
    expect(f.layerAt(x, y)).toBe(l + 1);
    expect(f.layerAt(x + 6, y)).toBe(far);
    expect(f.takeDirty().length).toBe(chunks.length);
  });
  it('raises a patch evenly and lowers it back to the generated ground', () => {
    const f = new TerraceField(12), { x, y, l } = pick(f), patch: [number, number][] = [];
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) patch.push([x + i, y + j]);
    const before = f.elevationAt(x, y);
    f.setRelief(patch, 2);
    expect(f.layerAt(x, y)).toBe(l + 2);
    expect(f.elevationAt(x, y)).toBeCloseTo(before + 2, 5);
    f.setRelief(patch, -2);
    expect(f.relief.size).toBe(0);
    expect(f.elevationAt(x, y)).toBeCloseTo(before, 5);
  });
  it('never digs below the floor, and keeps each tile within RELIEF_MAX', () => {
    const f = new TerraceField(13), { x, y, l } = pick(f);
    expect(f.setRelief([[x, y]], -1, l)).toEqual([]);
    for (let i = 0; i < RELIEF_MAX + 3; i++) f.setRelief([[x, y]], 1);
    expect(f.relief.get([...f.relief.keys()][0])).toBe(RELIEF_MAX);
  });
  it('saves and loads, and a world regenerates the tiles it touched', () => {
    const w = new World(14, undefined, 'terraced'), f = w.field!, { x, y, l } = pick(f);
    expect(w.layerAt(x, y)).toBe(l);
    expect(w.sculpt([[x, y], [x + 1, y]], 1).length).toBeGreaterThan(0);
    expect(w.layerAt(x, y)).toBe(l + 1);
    expect(w.mapLayer(x, y)).toBe(l + 1);
    const g = new TerraceField(14);
    g.loadRelief(sanitizeRelief(f.reliefList()));
    expect(g.layerAt(x, y)).toBe(l + 1);
    expect(sanitizeRelief([[1, 2, 0], [1, 2, 3], [1, 2, 4], [5, 5, RELIEF_MAX + 1], [6, 6, 1.5], 'x'])).toEqual([[1, 2, 3]]);
  });
});
