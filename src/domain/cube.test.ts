import { describe, it, expect, afterEach } from 'vitest';
import { CUBE_N, FACES, setCubeSize, cubeRadius, faceOf, netToDir, dirToNet, canonInto, canonPoint, canonTile, canonChunk, newCanon, uncanon, turnVector, capAt, insideFace, eyeFrame, EXT_MARGIN, CAP_FLAT, CAP_FADE } from './cube';

const N = CUBE_N, R = cubeRadius(N);
afterEach(() => setCubeSize(null));
const ang = (p: number[], q: number[]) => Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
const dir = (x: number, y: number) => { const d = [0, 0, 0]; if (!netToDir(x, y, d)) throw new Error(`not on a face: ${x},${y}`); return d; };
const dot3 = (p: readonly number[], q: readonly number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross3 = (p: readonly number[], q: readonly number[]) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

describe('the cube: faces', () => {
  it('are six orthonormal frames with the same turn, one on each axis', () => {
    const centres = new Set<string>();
    for (const F of FACES) {
      expect(dot3(F.c, F.c)).toBe(1); expect(dot3(F.a, F.a)).toBe(1); expect(dot3(F.b, F.b)).toBe(1);
      expect(dot3(F.c, F.a)).toBe(0); expect(dot3(F.c, F.b)).toBe(0); expect(dot3(F.a, F.b)).toBe(0);
      const x = cross3(F.a, F.b); expect(x.map(v => v + 0)).toEqual(F.c.map(v => -v + 0));   // a x b = -c
      centres.add(F.c.join(','));
    }
    expect(centres.size).toBe(6);
  });
  it('is a planet of radius 2N / pi, and the endless plane when no size is set', () => {
    expect(R).toBeCloseTo(6417.127, 2);
    expect(faceOf(0, 0)).toBe(-1); expect(canonPoint(123, -456)).toEqual([123, -456]); expect(capAt(0, 0)).toBe(0);
    setCubeSize(N); expect(faceOf(0, 0)).toBe(0); expect(faceOf(N, 0)).toBe(1); expect(faceOf(0, -N)).toBe(4); expect(faceOf(0, N)).toBe(5); expect(faceOf(-N, 0)).toBe(3); expect(faceOf(2 * N, 0)).toBe(2);
    expect(faceOf(N, N)).toBe(-1);   // (a void of the net)
  });
  it('puts net points on the sphere and finds them again', () => {
    setCubeSize(N);
    for (let i = 0; i < 200; i++) {
      const f = FACES[i % 6], x = f.ix * N + ((i * 7919) % 9000) - 4500 + 0.3, y = f.iy * N + ((i * 104729) % 9000) - 4500 + 0.7, d = dir(x, y), [qx, qy] = dirToNet(d[0], d[1], d[2]);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12); expect(qx).toBeCloseTo(x, 6); expect(qy).toBeCloseTo(y, 6);
    }
  });
  it('has the front face centre at (0, 0) pointing along +x, a tile a metre across there, and tiles 0.7-1.0 of that along an axis everywhere (the least is along an edge, at its middle)', () => {
    setCubeSize(N);
    expect(dir(0, 0)).toEqual([1, 0, 0]);
    const step = (x: number, y: number, dx: number, dy: number) => ang(dir(x, y), dir(x + dx, y + dy)) * R;
    expect(step(0, 0, 1, 0)).toBeCloseTo(1, 6); expect(step(0, 0, 0, 1)).toBeCloseTo(1, 6);
    let lo = 9, hi = 0, loOut = 9;
    for (const F of FACES) for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
      const x = F.ix * N + (i / 10) * (N / 2 - 1), y = F.iy * N + (j / 10) * (N / 2 - 1);
      for (const s of [step(x, y, 0.5, 0), step(x, y, 0, 0.5)]) { const m = s * 2; lo = Math.min(lo, m); hi = Math.max(hi, m); if (capAt(x, y) === 0) loOut = Math.min(loOut, m); }
    }
    expect(hi).toBeLessThan(1.02); expect(lo).toBeGreaterThan(0.69); expect(loOut).toBeGreaterThan(0.69);   // (equal-angle: sqrt(1/2) along an edge at its middle, 0.94 at a corner)
  });
});

describe('the cube: past the edges', () => {
  it('is a tile of the next face where the net has the edge too (five of the twelve), and moved only past the cut ones', () => {
    setCubeSize(N);
    const c = newCanon();
    for (const [x, y] of [[N / 2 + 40, 100], [-N / 2 - 40, 100], [100, -N / 2 - 40], [100, N / 2 + 40], [N + N / 2 + 40, -200]]) { canonInto(x, y, c); expect(c.moved).toBe(false); expect(c.x).toBe(x); expect(c.y).toBe(y); }
    for (const [x, y] of [[2 * N + N / 2 + 40, 100], [N / 2 + 40, -N], [-N / 2 - 40, -N], [N / 2 + 40, N], [-N / 2 - 40, N], [2 * N + 100, -N / 2 - 40]]) { canonInto(x, y, c); expect(c.moved, `${x},${y}`).toBe(true); expect(c.cap).toBe(false); }
  });
  it('is the same place on the planet just past an edge as just short of it, on all 24 sides', () => {
    setCubeSize(N);
    const c = newCanon();
    for (let fi = 0; fi < 6; fi++) for (let side = 0; side < 4; side++) for (const t of [-4500, -1200, 3, 777, 4400]) {
      const F = FACES[fi], east = side < 2, sgn = side % 2 === 0 ? 1 : -1;
      const edge = (d: number) => east ? [F.ix * N + sgn * (N / 2 + d), F.iy * N + t] : [F.ix * N + t, F.iy * N + sgn * (N / 2 + d)];
      const [ex, ey] = edge(-1e-7), [px, py] = edge(0.5);
      canonInto(px, py, c);
      const here = dir(ex, ey), there = dir(c.x, c.y);
      expect(ang(here, there) * R, `${F.name} side ${side} t ${t}`).toBeGreaterThan(0.45); expect(ang(here, there) * R).toBeLessThan(0.55 * 1.02 + 1e-6);   // (half a tile on: about half a metre)
    }
  });
  it('turns by a quarter turn at most, keeps the turn (det 1), and takes a vector the same way a step is taken', () => {
    setCubeSize(N);
    const c = newCanon();
    for (let fi = 0; fi < 6; fi++) for (let side = 0; side < 4; side++) {
      const F = FACES[fi], east = side < 2, sgn = side % 2 === 0 ? 1 : -1, x = east ? F.ix * N + sgn * (N / 2 + 30) : F.ix * N + 111, y = east ? F.iy * N + 111 : F.iy * N + sgn * (N / 2 + 30);
      canonInto(x, y, c);
      expect(c.a * c.d - c.b * c.c).toBe(1); for (const v of [c.a, c.b, c.c, c.d]) expect([-1, 0, 1]).toContain(v + 0);
      // a step of one tile in the old chart lands one tile away in the new one, in the direction the vector turns to
      const c2 = newCanon(); canonInto(x + 1, y + 2, c2); const [vx, vy] = turnVector(1, 2, c);
      expect(c2.x - c.x).toBeCloseTo(vx, 9); expect(c2.y - c.y).toBeCloseTo(vy, 9);
    }
  });
  it('goes back where it came from (uncanon), and the tiles and chunks past an edge are whole tiles and chunks', () => {
    setCubeSize(N);
    const c = newCanon();
    for (const [x, y] of [[2 * N + N / 2 + 40.5, 100.5], [N / 2 + 40.5, -N + 7.5], [-N / 2 - 90.5, N - 3.5], [2 * N + 311.5, -N / 2 - 62.5]]) {
      canonInto(x, y, c); const [bx, by] = uncanon(c.x, c.y, c); expect(bx).toBeCloseTo(x, 9); expect(by).toBeCloseTo(y, 9);
      const [tx, ty] = canonTile(Math.floor(x), Math.floor(y)); expect(Number.isInteger(tx) && Number.isInteger(ty)).toBe(true);
      expect(tx + 0.5).toBeCloseTo(c.x, 9); expect(ty + 0.5).toBeCloseTo(c.y, 9);
      const [cx, cy] = canonChunk(Math.floor(x / 16), Math.floor(y / 16)); expect(Number.isInteger(cx) && Number.isInteger(cy)).toBe(true);
    }
  });
  it('is the corner cap in a corner square or far past an edge, flat at the corners and nothing away from them', () => {
    setCubeSize(N);
    const c = newCanon();
    canonInto(N / 2 + EXT_MARGIN + 50, -N / 2 - EXT_MARGIN - 50, c); expect(c.cap).toBe(true);
    canonInto(N / 2 + EXT_MARGIN + 50, 0, c); expect(c.cap).toBe(false);   // (past a side of the right face... but that is inside the right face's rect)
    for (const F of FACES) {
      expect(capAt(F.ix * N, F.iy * N)).toBe(0);
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const cx = F.ix * N + sx * (N / 2 - 1), cy = F.iy * N + sy * (N / 2 - 1);
        expect(capAt(cx, cy)).toBe(1);
        expect(capAt(cx - sx * CAP_FLAT, cy)).toBeGreaterThan(0.9); expect(capAt(cx - sx * (CAP_FLAT + CAP_FADE + 5), cy)).toBe(0);
      }
    }
    expect(insideFace(0, 0, 100)).toBe(true); expect(insideFace(N / 2 - 50, 0, 100)).toBe(false); expect(insideFace(N / 2 + 10, 0, 0)).toBe(true);   // (inside the right face's rect)
  });
  it('has a frame at a net point: up on the ball, east and south square to it and to each other, pointing along the chart', () => {
    setCubeSize(N);
    for (const [x, y] of [[0, 0], [1234, -2345], [N + 700, 900], [-300, N - 40], [2 * N - 1500, 3000], [0, -N + 100]]) {
      const e = eyeFrame(x, y)!, d = dir(x, y);
      expect(ang([...e.up], d)).toBeLessThan(1e-6); expect(dot3(e.east, e.up)).toBeCloseTo(0, 9); expect(dot3(e.south, e.up)).toBeCloseTo(0, 9); expect(dot3(e.east, e.south)).toBeCloseTo(0, 2);
      const q = dir(x + 1, y), r = dir(x, y + 1);
      expect(dot3([q[0] - d[0], q[1] - d[1], q[2] - d[2]], e.east)).toBeGreaterThan(0); expect(dot3([r[0] - d[0], r[1] - d[1], r[2] - d[2]], e.south)).toBeGreaterThan(0);
    }
    expect(eyeFrame(N, N)).toBeNull();
  });
});
