import { describe, it, expect } from 'vitest';
import { elevation, elevationBroad, terraceMoist, terraceBiome, layerOf, TerraceField, terraceChunkMesh, setRealTerrain } from './terrace';
import { setCubeSize, cubeSize, CUBE_N, FACES } from './cube';

/**
 * The terrain signature: a fingerprint of the generator's output for fixed seeds, on the endless plane and on the cube planet. The world-generator work (GenParams, sculpt)
 * must leave every existing world exactly as it was, so these hashes were captured on untouched code and must never change by accident.
 * Two hashes per case: FNV-1a over values rounded to 1e-6 (portable between engines) and FNV-1a over the raw bytes (exact within one JS engine).
 */

class Fnv {
  /** [portable, raw] */
  private p = 0x811c9dc5; private r = 0x811c9dc5;
  private f64 = new Float64Array(1); private u8 = new Uint8Array(this.f64.buffer);
  private f32 = new Float32Array(1); private u8b = new Uint8Array(this.f32.buffer);
  private mixP(n: number) { for (let k = 0; k < 4; k++) { this.p = Math.imul(this.p ^ ((n >>> (k * 8)) & 255), 0x01000193) >>> 0; } }
  private mixR(b: number) { this.r = Math.imul(this.r ^ b, 0x01000193) >>> 0; }
  /** a computed number (float64) */
  num(v: number) {
    this.mixP(Number.isFinite(v) ? Math.round(v * 1e6) | 0 : 0x7fffffff);
    this.f64[0] = v; for (let i = 0; i < 8; i++) this.mixR(this.u8[i]);
  }
  /** a typed array (float32 or integer data), both ways */
  arr(a: ArrayLike<number> & { BYTES_PER_ELEMENT?: number }, isFloat: boolean) {
    this.num(a.length);
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      this.mixP(isFloat ? (Number.isFinite(v) ? Math.round(v * 1e6) | 0 : 0x7fffffff) : v | 0);
      if (isFloat) { this.f32[0] = v; for (let k = 0; k < 4; k++) this.mixR(this.u8b[k]); } else { this.mixR(v & 255); this.mixR((v >>> 8) & 255); this.mixR((v >>> 16) & 255); this.mixR((v >>> 24) & 255); }
    }
  }
  get out(): [string, string] { return [this.p.toString(16).padStart(8, '0'), this.r.toString(16).padStart(8, '0')]; }
}

/** Points found once by a scan and fixed here: ocean, a range, a lake, a cube edge and a corner cap, per seed (net coordinates on the cube planet). */
const SPECIAL: Record<number, [number, number][]> = {
  1: [[-1593, 4797], [7946, -757], [-4997, -183], [-4991, -173], [94, -2609], [4115, -531], [1579, 4653]],
  7: [[4896, 1538], [6320, -363], [1414, -4035], [-3457, -464], [113, 307], [-3771, -1083], [-4654, -1673]],
  42: [[1095, -669], [-4949, 1552], [-1283, -16], [-1669, -434], [34, 3303], [-2254, -908], [1791, 1641]],
};
/** Cube edges (an exact edge between two faces, and a three-face corner of the net) common to every seed. */
const EDGES: [number, number][] = [[1680, 700], [900, -1680], [5040, 700], [4260, -1680], [8400, 700], [7620, -1680], [1680, 1680], [-1680, 1680], [1679, 1679], [1681, 1679]];

/** About 240 points: a fixed pseudo-random spread plus the special ones. */
function points(seed: number, cube: boolean): [number, number][] {
  const pts: [number, number][] = [];
  let s = 987654 + seed;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  if (cube) {
    for (let i = 0; i < 210; i++) { const F = FACES[Math.floor(rnd() * 6)]; pts.push([F.ix * CUBE_N + Math.round((rnd() - 0.5) * (CUBE_N - 2)), F.iy * CUBE_N + Math.round((rnd() - 0.5) * (CUBE_N - 2))]); }
    pts.push(...SPECIAL[seed], ...EDGES);
  } else {
    for (let i = 0; i < 240; i++) pts.push([Math.round((rnd() - 0.5) * 8000), Math.round((rnd() - 0.5) * 8000)]);
  }
  return pts;
}

/** Chunks whose grid and mesh are hashed: ordinary ones, and on the cube one against a face edge. */
const CHUNKS_PLANE: [number, number][] = [[0, 0], [5, -3], [-7, 9], [20, 20]];
const CHUNKS_CUBE: [number, number][] = [[3, 4], [100, 100], [209, 40], [-100, 60]];

export function terrainSignature(seed: number, cube: boolean): [string, string] {
  const keep = cubeSize(), h = new Fnv();
  try {
    setRealTerrain(null);
    setCubeSize(cube ? CUBE_N : 0);
    for (const [x, y] of points(seed, cube)) {
      const e = elevation(x, y, seed), m = terraceMoist(x, y, seed);
      h.num(e); h.num(elevationBroad(x, y, seed)); h.num(m); h.num(terraceBiome(layerOf(e), m));
    }
    const f = new TerraceField(seed);
    for (const [cx, cy] of cube ? CHUNKS_CUBE : CHUNKS_PLANE) {
      const g = f.grid(cx, cy), mesh = terraceChunkMesh(g.e, cx, cy);
      h.arr(g.e, true);
      h.arr(mesh.pos, true); h.arr(mesh.nrm, true); h.arr(mesh.idx, false); h.arr(mesh.sub, false);
      h.arr(mesh.wpos, true); h.arr(mesh.widx, false); h.arr(mesh.wkind, false);
    }
  } finally { setCubeSize(keep); }
  return h.out;
}

/** Captured on untouched code (before any GenParams change): `seed:mode` -> [portable, raw]. */
const EXPECTED: Record<string, [string, string]> = {
  '1:plane': ['6570d0d1', 'ee834a05'],
  '1:cube': ['3e964d87', 'a9219764'],
  '7:plane': ['bda7d11f', 'bca58825'],
  '7:cube': ['c984e777', 'd77383e2'],
  '42:plane': ['34abd51b', 'ae433a53'],
  '42:cube': ['a92ef4a8', '2a34434e'],
};

describe('terrain signature', () => {
  for (const seed of [1, 7, 42]) for (const cube of [false, true]) {
    const key = `${seed}:${cube ? 'cube' : 'plane'}`;
    it(`is unchanged for seed ${seed} on the ${cube ? 'cube planet' : 'plane'}`, () => {
      const got = terrainSignature(seed, cube);
      expect(got).toEqual(EXPECTED[key]);
    });
  }
  it('is repeatable and restores the cube size', () => {
    const before = cubeSize(), a = terrainSignature(7, true), b = terrainSignature(7, true);
    expect(b).toEqual(a); expect(cubeSize()).toBe(before);
  });
});
