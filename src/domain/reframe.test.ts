import { describe, it, expect, afterEach } from 'vitest';
import { CUBE_N, setCubeSize, canonInto, newCanon, netToDir, turnAngle, applyCanon } from './cube';
import { newGlider, stepGlider, reframeGlider, type GlideEnv } from './glider';
import { newFlight, reframeFlight } from './flight';

const N = CUBE_N;
afterEach(() => setCubeSize(null));
const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 }, DT = 1 / 60;
const dir = (x: number, y: number) => { const d = [0, 0, 0]; netToDir(x, y, d); return d; };
const sub = (p: number[], q: number[]) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const norm = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };

/** Fly a plane (y north in its own state, net y south) from a face of the cube until it has crossed an edge, re-framing it when it leaves the faces; returns the sphere path as it went. */
function fly(x0: number, y0: number, heading: number, steps: number) {
  const g = newGlider(x0, -y0, heading, 400); const sp = 25;
  g.vx = Math.cos(heading) * sp; g.vy = Math.sin(heading) * sp; g.vz = 0; g.airspeed = sp; g.psi = heading;
  const c = newCanon(), path: { dir: number[]; psi: number; speed: number; z: number; moved: boolean }[] = [];
  for (let i = 0; i < steps; i++) {
    stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, DT);
    canonInto(g.x, -g.y, c); let moved = false;
    if (c.moved) { reframeGlider(g, c); moved = true; }
    path.push({ dir: dir(g.x, -g.y), psi: g.psi, speed: Math.hypot(g.vx, g.vy), z: g.z, moved });
  }
  return { g, path };
}

describe('the cube planet: crossing a cut edge', () => {
  it('an edge the net keeps (front to right) changes nothing at all', () => {
    setCubeSize(N);
    const { path } = fly(N / 2 - 30, 0, 0, 300);   // east off the front face onto the right face
    expect(path.some(p => p.moved)).toBe(false);
    expect(path[path.length - 1].psi).toBeCloseTo(path[0].psi, 1);
  });
  it('an edge the net cuts (top to right) puts the plane on the neighbour face, turned, with its speed and height', () => {
    setCubeSize(N);
    const { path, g } = fly(N / 2 - 30, -N, 0, 360);   // east off the top face (centred on (0, -N)) onto the right face
    const i = path.findIndex(p => p.moved); expect(i).toBeGreaterThan(0);
    expect(Math.abs(path[i].psi - path[i - 1].psi) % (2 * Math.PI)).toBeGreaterThan(0.5);   // (the heading turned: the chart turned by a quarter)
    expect(Math.abs(path[i].speed - path[i - 1].speed)).toBeLessThan(0.3); expect(Math.abs(path[i].z - path[i - 1].z)).toBeLessThan(0.5);   // (one physics step apart: only the plane's own settling)
    expect(g.x).toBeLessThan(N * 1.6); expect(g.x).toBeGreaterThan(N * 0.4);   // (on the right face's rect now)
  });
  it('the plane goes straight on over the sphere: the step before and the step after the crossing point the same way, the same length', () => {
    setCubeSize(N);
    for (const [x0, y0, hd] of [[N / 2 - 30, -N, 0], [-N / 2 + 30, -N, Math.PI], [N / 2 - 30, N, 0], [300, -N / 2 - 1500 + 1500 - 40 + 40 + 0, Math.PI / 2], [2 * N + N / 2 - 30, 0, 0]] as [number, number, number][]) {
      const { path } = fly(x0, y0, hd, 420), i = path.findIndex(p => p.moved);
      if (i < 3) continue;
      const before = norm(sub(path[i - 1].dir, path[i - 2].dir)), after = norm(sub(path[i + 1].dir, path[i].dir)), len = (a: number[], b: number[]) => Math.hypot(...sub(a, b));
      const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
      expect(dot, `${x0},${y0}`).toBeGreaterThan(0.97);
      const l1 = len(path[i - 1].dir, path[i - 2].dir), l2 = len(path[i + 1].dir, path[i].dir); expect(l2 / l1).toBeGreaterThan(0.7); expect(l2 / l1).toBeLessThan(1.45);
    }
  });
  it('the belt wraps round: flying east along the equator past the back face comes out on the left face, and so round to the front', () => {
    setCubeSize(N);
    const g = newGlider(0, 0, 0, 300); g.vx = 140; g.vy = 0; g.vz = 0; g.airspeed = 140;
    const c = newCanon(); let moves = 0, maxX = 0;
    for (let i = 0; i < 4 * N / 140 / DT * 1.05 && moves < 3; i++) {
      g.x += g.vx * DT; canonInto(g.x, -g.y, c); maxX = Math.max(maxX, g.x); if (c.moved) { reframeGlider(g, c); moves++; }
    }
    expect(moves).toBe(1);   // (only the back-to-left edge is cut along the belt)
    expect(g.x).toBeLessThan(N * 1.0);   // (round again: on the left face or the front)
    expect(maxX).toBeGreaterThan(2 * N);
  });
});

describe('the cube planet: the carried state', () => {
  it('turns a flight and a glider by the same quarter turn', () => {
    setCubeSize(N);
    const c = newCanon(); canonInto(N / 2 + 20, -N + 100, c); expect(c.moved).toBe(true);
    const g = newGlider(N / 2 + 20, N - 100, 0.3, 120); g.vx = 10; g.vy = 3;
    const f = newFlight(N / 2 + 20, -N + 100); f.heading = 0.3; f.course = 0.3;
    const d = reframeGlider(g, c); reframeFlight(f, c);
    expect(Math.abs(Math.sin(d))).toBeCloseTo(1, 9);   // a quarter turn
    expect(Math.hypot(g.vx, g.vy)).toBeCloseTo(Math.hypot(10, 3), 9);
    expect(g.psi).toBeCloseTo(f.heading, 9); expect(g.x).toBeCloseTo(f.x, 9); expect(g.y).toBeCloseTo(-f.y, 9);
    expect(Math.abs(turnAngle(c) - d)).toBeLessThan(1e-9);
    const [px, py] = applyCanon(N / 2 + 20, -N + 100, c); expect(px).toBeCloseTo(c.x, 9); expect(py).toBeCloseTo(c.y, 9);
  });
});
