import { describe, it, expect } from 'vitest';
import { FACES, faceOverHorizon, netToDir, setCubeSize, CUBE_N, cubeRadius, type V3 } from './cube';

describe('faceOverHorizon', () => {
  const R = cubeRadius(CUBE_N), hill = 0.06 * R;
  it('hides the opposite face low down, a neighbour only low down, none from space', () => {
    expect(faceOverHorizon(2, [1, 0, 0], R, 50, hill)).toBe(true);    // (back, with the eye over the front face)
    expect(faceOverHorizon(0, [1, 0, 0], R, 50, hill)).toBe(false);   // (the face under the eye)
    expect(faceOverHorizon(1, [1, 0, 0], R, 50, hill)).toBe(true);    // (a neighbour's edge is 45 degrees away; at 50 tiles up the eye sees 12 + 19 degrees)
    expect(faceOverHorizon(1, [1, 0, 0], R, 600, hill)).toBe(false);  // (at 600 tiles it sees 39 + 19, and the cap of the face reaches in)
    expect(faceOverHorizon(1, [1, 0, 0], R, 1e6, hill)).toBe(false);  // (from space a hemisphere shows, so the far side's face stays hidden but the neighbours do not)
    expect(faceOverHorizon(2, [1, 0, 0], R, 1e6, hill)).toBe(true);
  });
  it('never hides a face that has a point the eye can see (random eyes and points)', () => {
    setCubeSize(CUBE_N);
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const out = [0, 0, 0];
    let hiddenSeen = 0;
    for (let k = 0; k < 4000; k++) {
      const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z), up: V3 = [r * Math.cos(a), r * Math.sin(a), z];
      const h = Math.pow(rnd(), 3) * 3 * R, E = [up[0] * (R + h), up[1] * (R + h), up[2] * (R + h)];
      for (let f = 0; f < 6; f++) {
        const hidden = faceOverHorizon(f, up, R, h, hill); if (hidden) hiddenSeen++;
        if (!hidden) continue;
        for (let j = 0; j < 12; j++) {   // points on the face, at ground level and at the tallest hills
          const F = FACES[f]; netToDir(F.ix * CUBE_N + (rnd() - 0.5) * CUBE_N, F.iy * CUBE_N + (rnd() - 0.5) * CUBE_N, out);
          const rad = R + rnd() * hill, P = [out[0] * rad, out[1] * rad, out[2] * rad];
          // the segment E -> P stays out of the ball (radius R) <=> the point is seen
          const d = [P[0] - E[0], P[1] - E[1], P[2] - E[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          const t = Math.max(0, Math.min(1, -(E[0] * d[0] + E[1] * d[1] + E[2] * d[2]) / dd)), m = Math.hypot(E[0] + d[0] * t, E[1] + d[1] * t, E[2] + d[2] * t);
          expect(m < R - 1e-6 || h < 0).toBe(true);   // (it must be hidden by the ball)
        }
      }
    }
    expect(hiddenSeen).toBeGreaterThan(1000);
    setCubeSize(0);
  });
});
