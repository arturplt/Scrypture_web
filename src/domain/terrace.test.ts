import { describe, expect, it } from 'vitest';
import { TerraceField, elevation, terraceH, terraceSpawn, onLedge, TERRACE_STEP, TERRACE_SUB, TERRACE_G, terraceFarMesh } from './terrace';
import { World, GRASS, DECO_NONE, CHUNK } from './worldgen';
import { newSavedWorld, sanitizeWorlds } from './worldsave';

describe('terraced height field', () => {
  it('is the same for the same seed and differs between seeds', () => {
    expect(elevation(123.5, -77, 9)).toBe(elevation(123.5, -77, 9));
    expect(elevation(123.5, -77, 9)).not.toBe(elevation(123.5, -77, 10));
  });

  it('looks up the stepped height at the grid points (the slow noise is blended, so within a hair of the exact field), and joins across chunk borders', () => {
    const f = new TerraceField(42);
    for (let y = -60; y < 60; y += 3.5) for (let x = -60; x < 60; x += 2.5) expect(Math.abs(f.heightAt(x, y) - terraceH(elevation(x, y, 42)))).toBeLessThan(0.12);
    for (let y = -40; y < 40; y += 1.37) {   // a point just either side of a chunk edge: no step in the ground
      expect(Math.abs(f.heightAt(CHUNK - 1e-4, y) - f.heightAt(CHUNK + 1e-4, y))).toBeLessThan(0.01);
    }
    expect(TERRACE_G).toBe(CHUNK * TERRACE_SUB + 1);
  });

  it('puts every shelf on a whole number of steps and the sea at 0', () => {
    for (let e = -3; e < 20; e += 0.05) {
      const h = terraceH(e), f = e - Math.floor(e);
      if (e <= 0) expect(h).toBe(0);
      else if (f < 0.65) expect(h / TERRACE_STEP).toBeCloseTo(Math.floor(e), 6);
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
});
