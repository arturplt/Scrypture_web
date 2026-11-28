/**
 * The sample grid of the cube planet: a (N+1) x (N+1) grid of points on each of the six faces (equal-angle net, as cube.ts), with the points on a face's edge and the cube's corners shared by the faces that
 * meet there, so a point has one number whatever face it is reached from (6 N^2 + 2 points in all). The planet mesh samples the ground on it (planetmesh.ts) and the macro sculpt keeps its heights on the
 * one of N = 64 (sculpt.ts). Pure: it needs the cube's faces only.
 */
import { FACES } from './cube';

/** Patches along a face's side. */
export const PATCHES = 4;

export interface PlanetGrid {
  /** Cells along a face's side, and the number of distinct samples (the shared edges and corners counted once). */
  N: number; S: number;
  /** Per face (N+1)^2 grid points, row by row: the sample each is. */
  vid: Int32Array;
  /** Per sample: unit direction (3 numbers), and where it first appeared (a face, and the fractions of that face's width from its centre, -0.5..0.5). */
  dir: Float64Array; face: Uint8Array; fu: Float64Array; fv: Float64Array;
}
const gridCache = new Map<number, PlanetGrid>();
/** The sample grid of a detail (worked out once and kept). */
export function planetGrid(N: number): PlanetGrid {
  const hit = gridCache.get(N); if (hit) return hit;
  if (!Number.isInteger(N) || N < PATCHES || N % PATCHES) throw new Error('detail must be a multiple of ' + PATCHES);
  const W = N + 1, per = W * W, vid = new Int32Array(6 * per), dirs: number[] = [], faces: number[] = [], us: number[] = [], vs: number[] = [], seen = new Map<string, number>();
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const u = i / N - 0.5, v = j / N - 0.5, ta = Math.tan(u * (Math.PI / 2)), tb = Math.tan(v * (Math.PI / 2));
      const x = F.c[0] + F.a[0] * ta + F.b[0] * tb, y = F.c[1] + F.a[1] * ta + F.b[1] * tb, z = F.c[2] + F.a[2] * ta + F.b[2] * tb, l = Math.hypot(x, y, z), dx = x / l, dy = y / l, dz = z / l;
      const edge = i === 0 || j === 0 || i === N || j === N;
      let id: number | undefined;
      let key = '';
      if (edge) { key = Math.round(dx * 1e8) + ',' + Math.round(dy * 1e8) + ',' + Math.round(dz * 1e8); id = seen.get(key); }
      if (id === undefined) { id = faces.length; dirs.push(dx, dy, dz); faces.push(f); us.push(u); vs.push(v); if (edge) seen.set(key, id); }
      vid[f * per + j * W + i] = id;
    }
  }
  const g: PlanetGrid = { N, S: faces.length, vid, dir: Float64Array.from(dirs), face: Uint8Array.from(faces), fu: Float64Array.from(us), fv: Float64Array.from(vs) };
  gridCache.set(N, g);
  return g;
}
