import { describe, expect, it } from 'vitest';
import { elevation, peakOf, PEAK_M, PEAK_R, TERRACE_LAYER_M, TERRACE_STEP, terraceSpawn, setRealTerrain, terraceFarMesh, TERRACE_FAR_LODS, TERRACE_FAR_LODS_HILLS, FAR_LEVEL_FROM_HILLS, HILLS_NEAR, farLevelFor } from './terrace';
import { World } from './worldgen';

describe('the giant mountain of a terraced world', () => {
  setRealTerrain(null);
  for (const seed of [3, 7, 42]) it(`stands 8 km up and well away from where the world begins (seed ${seed})`, () => {
    const s = (seed ^ 0x7e77ace) | 0, p = peakOf(s);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(PEAK_R + 400);
    expect(elevation(p.x, p.y, seed) * TERRACE_LAYER_M).toBeGreaterThan(PEAK_M - 40);
    expect(elevation(p.x, p.y, seed) * TERRACE_LAYER_M).toBeLessThan(PEAK_M + 40);
    // it rises towards the summit: on average higher a third of the way in than at the edge of the skirt, and higher still a tenth of the way in
    const ring = (f: number) => { let t = 0; for (let k = 0; k < 8; k++) t += elevation(p.x + Math.cos(k) * PEAK_R * f, p.y + Math.sin(k) * PEAK_R * f, seed); return t / 8; };
    expect(ring(0.3)).toBeGreaterThan(ring(0.95) + 20); expect(ring(0.1)).toBeGreaterThan(ring(0.3) + 20);
    expect(Math.hypot(terraceSpawn(seed).x, terraceSpawn(seed).y)).toBeLessThan(Math.hypot(p.x, p.y) - PEAK_R);
  });
  it('is climbable: a tile apart the ground differs by under two layers on average, and the summit stands 8 km (about 120 tiles) up', () => {
    const w = new World(7, [], 'terraced'), p = peakOf((7 ^ 0x7e77ace) | 0);
    expect(w.heightAt(p.x + 0.5, p.y + 0.5)).toBeGreaterThan((PEAK_M / TERRACE_LAYER_M - 4) * TERRACE_STEP);
    let sum = 0, n = 0; for (let d = 0; d < 300; d++) { sum += Math.abs(w.heightAt(p.x + d + 0.5, p.y + 0.5) - w.heightAt(p.x + d + 1.5, p.y + 0.5)); n++; }
    expect(sum / n).toBeLessThan(TERRACE_STEP * 2);   // (a tile apart the ground differs by under two layers on average: the hills' own slopes are steeper in places, one ledge at a time)
  });
});

describe('mountain ranges', () => {
  it('stand as long belts of high ground far from the middle, and leave the start gentle', () => {
    setRealTerrain(null);
    for (const seed of [1, 7, 42]) {
      const p = peakOf((seed ^ 0x7e77ace) | 0); let high = 0, tall = 0, n = 0, near = 0;
      for (let y = -4000; y < 4000; y += 25) for (let x = -4000; x < 4000; x += 25) {
        if (Math.hypot(x - p.x, y - p.y) < PEAK_R) continue;
        const e = elevation(x, y, seed); n++; if (e > 60) high++; if (e > 130) tall++;
        if (Math.hypot(x, y) < 150) near = Math.max(near, e);
      }
      expect(high / n).toBeGreaterThan(0.02);   // (ranges are a few percent of the map)
      expect(tall).toBeGreaterThan(0);          // (the Tatras and the Himalayas reach well past the hills' 100)
      expect(near).toBeLessThan(100);           // (the middle of the world is the ordinary hills)
    }
  });
});

describe('the far mountains', () => {
  it('have flat tops: opening shaves off the spikes narrower than a few vertices, and leaves wide tops alone', () => {
    setRealTerrain(null);
    const run = (open: number) => { const g = terraceFarMesh(7, 1100, 100, 12, 2400, true, open); let r = g.next(); while (!r.done) r = g.next(); return r.value; };
    const spikes = (m: ReturnType<typeof run>) => {
      let n = 0, top = 0;
      for (let j = 3; j < m.rows - 3; j++) for (let i = 3; i < m.cols - 3; i++) {
        const h = (a: number, b: number) => -m.pos[((j + b) * m.cols + i + a) * 3 + 2], c = h(0, 0); top = Math.max(top, c);
        let nb = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b) nb = Math.max(nb, h(a, b));
        if (c > nb + TERRACE_STEP * 2) n++;   // a vertex two layers over every neighbour
      }
      return { n, top };
    };
    const raw = spikes(run(0)), flat = spikes(run(2));
    expect(raw.n).toBeGreaterThan(0);
    expect(flat.n).toBe(0);
    expect(flat.top).toBeGreaterThan(raw.top * 0.5);   // (the mountains are still there)
  });
});

describe('the seeded hills far levels', () => {
  it('put a fine two-tile level in front of the usual ones, and cost about the same to build', () => {
    expect(TERRACE_FAR_LODS_HILLS.length).toBe(TERRACE_FAR_LODS.length + 1);
    expect(FAR_LEVEL_FROM_HILLS.length).toBe(TERRACE_FAR_LODS_HILLS.length);
    expect(TERRACE_FAR_LODS_HILLS[0].step).toBeLessThan(TERRACE_FAR_LODS_HILLS[1].step);
    for (let i = 1; i < TERRACE_FAR_LODS_HILLS.length; i++) { expect(TERRACE_FAR_LODS_HILLS[i].step).toBeGreaterThan(TERRACE_FAR_LODS_HILLS[i - 1].step); expect(TERRACE_FAR_LODS_HILLS[i].half).toBeGreaterThan(TERRACE_FAR_LODS_HILLS[i - 1].half); }
    for (const L of TERRACE_FAR_LODS_HILLS) { const side = Math.floor((L.half * 2) / L.step) + 1; expect(side * side).toBeLessThan(170000); }
    // the fine level always reaches past where the real chunks end (HILLS_NEAR) and the first ring of the next level
    expect(TERRACE_FAR_LODS_HILLS[0].half - TERRACE_FAR_LODS_HILLS[0].moveBy).toBeGreaterThan(HILLS_NEAR + 90);
    expect(farLevelFor(0, FAR_LEVEL_FROM_HILLS)).toBe(0); expect(farLevelFor(80, FAR_LEVEL_FROM_HILLS)).toBe(1); expect(farLevelFor(1e6, FAR_LEVEL_FROM_HILLS)).toBe(5);
  });
});
