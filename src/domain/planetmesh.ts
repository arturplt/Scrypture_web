/**
 * The whole planet as one terraced mesh, for the world generator's preview (see SCRYPTURE_WORLD_GENERATOR_ROADMAP.md, milestone 2). Pure: no GL, no DOM, no worker scope.
 *
 * The planet is sampled once per detail N: a (N+1) x (N+1) grid of points on each of the six faces (equal-angle net, as cube.ts), with the points on a face's edge and the cube's corners shared by
 * the faces that meet there (one sample, one height), so neighbouring patches and faces always agree exactly. The heights are the game's own `elevation` (or `elevationBroad`), in layers.
 * The mesh is cut into bands `k` layers thick, as the game's terraces are cut one layer thick (`terraceChunkMesh`, which this ports to a generic grid): every band is a flat floor at its own
 * height, and between two bands stands a wall along the contour. Sea level (height 0) is a plain coast: the land below it is not drawn at all (the renderer's sea covers it).
 *
 * Geometry lives in "direction and height": a vertex is a unit direction on the ball and a height in layers, so a renderer can place it at R + height * STEP * exaggeration without any rebuild:
 * a floor's normal is its own direction and a wall's normal is horizontal, and neither changes when the heights are scaled.
 *
 * Seams: a point where a contour crosses a grid edge is worked out from that edge's two samples alone, ordered by sample number, so both sides of the edge (two triangles, two patches or two faces) get
 * the very same bits. A sample's height that falls exactly on a contour is nudged up by a ten-thousandth of a band, so no vertex ever lies on a contour and every contour crosses a triangle's interior.
 */
import { FACES, cubeSize, setCubeSize } from './cube';
import { PATCHES, type PlanetGrid } from './planetgrid';
import { elevation, elevationBroad, terraceBiome, terraceBareFrom, terraceMoist, withGen } from './terrace';
import { groundTint } from './globemap';
import type { GenParams } from './genparams';
import { ttgTint } from './terrace';

/** Bytes of a vertex: direction (3 x float32), height in layers (float32), normal (4 x int8: x, y, z, 0), colour (4 x uint8: r, g, b, 255). */
export const PLANET_VERTEX_BYTES = 24;
export { PATCHES };
/** The details the generator offers (cells along a face's side). */
export const PLANET_DETAILS = [16, 32, 64, 128, 256] as const;
/** From this detail up the heights are the full `elevation` (lakes and small hills); below it the broad shape. */
export const FULL_DETAIL_FROM = 128;
/** Layers a preview band is thick, by default, for a detail: a coarse mesh needs thick terraces to show any (one layer is 0.45 of a tile on a planet 2139 tiles in radius). */
export const defaultBand = (N: number): number => (N <= 32 ? 4 : N <= 128 ? 3 : 4);

// ---- the sample grid (planetgrid.ts) --------------------------------------------------------------------------------------------------------

export { planetGrid, type PlanetGrid } from './planetgrid';

/** Run `fn` with the planet's size and settings in use, and put the old ones back. `fn` must not yield. */
export function withPlanet<T>(size: number, gen: GenParams | null | undefined, fn: () => T): T {
  const was = cubeSize(); setCubeSize(size);
  try { return withGen(gen, fn); } finally { setCubeSize(was); }
}

/**
 * The height in layers of every sample (`elevationBroad` below FULL_DETAIL_FROM unless `mode` says otherwise, else `elevation`), a block at a time: the planet's size and the world's
 * settings are in use only inside a block, and put back before each yield.
 */
export function* sampleHeights(grid: PlanetGrid, seed: number, size: number, gen: GenParams | null | undefined, mode: 'broad' | 'full' = grid.N >= FULL_DETAIL_FROM ? 'full' : 'broad'): Generator<null, Float32Array, void> {
  const out = new Float32Array(grid.S), BLOCK = 2048, inset = 0.01 / size, fn = mode === 'full' ? elevation : elevationBroad;
  for (let s0 = 0; s0 < grid.S; s0 += BLOCK) {
    const s1 = Math.min(grid.S, s0 + BLOCK);
    withPlanet(size, gen, () => {
      for (let s = s0; s < s1; s++) {
        const F = FACES[grid.face[s]]; let u = grid.fu[s], v = grid.fv[s];
        if (Math.abs(u) > 0.5 - 1e-9) u -= Math.sign(u) * inset;   // (a point exactly on a face's edge is read just inside it: the edge is the next cell's)
        if (Math.abs(v) > 0.5 - 1e-9) v -= Math.sign(v) * inset;
        out[s] = fn(F.ix * size + u * size, F.iy * size + v * size, seed);
      }
    });
    yield null;
  }
  return out;
}

/** The moisture (0..1, as the game's biomes read it) of every sample: it depends on the seed and the planet only, never on the settings, so it is worked out once for a detail. */
export function* sampleMoisture(grid: PlanetGrid, seed: number, size: number): Generator<null, Float32Array, void> {
  const out = new Float32Array(grid.S), BLOCK = 4096, inset = 0.01 / size;
  for (let s0 = 0; s0 < grid.S; s0 += BLOCK) {
    const s1 = Math.min(grid.S, s0 + BLOCK);
    withPlanet(size, null, () => {
      for (let s = s0; s < s1; s++) {
        const F = FACES[grid.face[s]]; let u = grid.fu[s], v = grid.fv[s];
        if (Math.abs(u) > 0.5 - 1e-9) u -= Math.sign(u) * inset;
        if (Math.abs(v) > 0.5 - 1e-9) v -= Math.sign(v) * inset;
        out[s] = terraceMoist(F.ix * size + u * size, F.iy * size + v * size, seed);
      }
    });
    yield null;
  }
  return out;
}

/** How many moisture steps the paint table has. */
export const MOIST_STEPS = 16;
/** The bands a field of heights needs (the highest one, and two spare). */
export const bandsFor = (heights: ArrayLike<number>, k: number): number => { let m = 0; for (let i = 0; i < heights.length; i++) if (heights[i] > m) m = heights[i]; return Math.floor(m / k) + 3; };
/** What colours the mesh by biome: the moisture of each sample, and the colour (r, g, b bytes) of every band at every moisture step. */
export interface Paint { moist: ArrayLike<number>; tint: Uint8Array }
/** The paint table for settings: the biome of a band's layer at each moisture step, with the settings' moisture bias and cold (the biome functions read them), coloured as the globe map is. */
export function paintTable(size: number, gen: GenParams | null | undefined, k: number, bands: number): Uint8Array {
  const t = new Uint8Array(bands * MOIST_STEPS * 3);
  withPlanet(size, gen, () => {
    const bare = terraceBareFrom();
    for (let n = 0; n < bands; n++) for (let m = 0; m < MOIST_STEPS; m++) {
      const layer = Math.round(n * k), c = groundTint(layer, terraceBiome(layer, m / (MOIST_STEPS - 1)), bare), o = (n * MOIST_STEPS + m) * 3;
      t[o] = Math.min(255, Math.round(c[0])); t[o + 1] = Math.min(255, Math.round(c[1])); t[o + 2] = Math.min(255, Math.round(c[2]));
    }
  });
  return t;
}

// ---- the mesh -------------------------------------------------------------------------------------------------------------------------------

export interface PatchMesh {
  face: number; px: number; py: number;
  /** PLANET_VERTEX_BYTES a vertex (see there), `nv` vertices. */
  verts: ArrayBuffer; nv: number;
  /** Triangle indices: 16 bits when the patch has at most 65535 vertices, else 32. */
  index: Uint16Array | Uint32Array; ni: number;
  /** Bounding cap of the patch on the ball: centre direction x, y, z and angular radius (rad), and its lowest and highest vertex in layers. */
  cap: [number, number, number, number]; minH: number; maxH: number;
}
export interface PlanetMesh { N: number; k: number; patches: PatchMesh[]; tris: number; verts: number; bytes: number }

/** The radius used to take cross products in layer units (the ball's radius in layers: 2139 tiles of 0.45). Only its order of size matters (it fixes which way a wall and a floor face). */
const RL = 4753;

class Scratch {
  vbuf = new ArrayBuffer(PLANET_VERTEX_BYTES * 4096); f32 = new Float32Array(this.vbuf); i8 = new Int8Array(this.vbuf); u8 = new Uint8Array(this.vbuf); nv = 0;
  idx = new Uint32Array(3 * 8192); ni = 0;
  ms = new Map<number, number>(); me = new Map<number, number>();
  reset() { this.nv = 0; this.ni = 0; this.ms.clear(); this.me.clear(); }
  vertex(dx: number, dy: number, dz: number, h: number, nx: number, ny: number, nz: number, r: number, g: number, b: number): number {
    if ((this.nv + 1) * PLANET_VERTEX_BYTES > this.vbuf.byteLength) {
      const nb = new ArrayBuffer(this.vbuf.byteLength * 2); new Uint8Array(nb).set(this.u8);
      this.vbuf = nb; this.f32 = new Float32Array(nb); this.i8 = new Int8Array(nb); this.u8 = new Uint8Array(nb);
    }
    const o = this.nv * 6, b0 = this.nv * PLANET_VERTEX_BYTES;
    this.f32[o] = dx; this.f32[o + 1] = dy; this.f32[o + 2] = dz; this.f32[o + 3] = h;
    this.i8[b0 + 16] = Math.round(nx * 127); this.i8[b0 + 17] = Math.round(ny * 127); this.i8[b0 + 18] = Math.round(nz * 127); this.i8[b0 + 19] = 0;
    this.u8[b0 + 20] = r; this.u8[b0 + 21] = g; this.u8[b0 + 22] = b; this.u8[b0 + 23] = 255;
    return this.nv++;
  }
  tri(a: number, b: number, c: number) {
    if ((this.ni + 3) > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n; }
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
}

/** Smallest squared cross product (of directions, on the float32 values stored) a triangle may have: below it the triangle has no area to speak of. */
const MIN_AREA2 = 1e-40;

/**
 * The terraced mesh of a planet from the heights of its samples (layers; NaN counts as sea). `k` layers a band. A generator: it yields after each patch, so the caller can stop between them.
 */
export function* buildPlanetMesh(grid: PlanetGrid, heights: ArrayLike<number>, k: number, paint?: Paint): Generator<null, PlanetMesh, void> {
  const { N, S, vid, dir } = grid, W = N + 1, per = W * W, P = N / PATCHES;
  if (!(k > 0)) throw new Error('band thickness must be positive');
  // the heights, nudged off the contours (see the header), and the colour of each band
  const h = new Float64Array(S); let hMax = 0;
  for (let s = 0; s < S; s++) { let v = heights[s]; if (!Number.isFinite(v)) v = -1e3; const q = v / k; if (q === Math.floor(q)) v += k * 1e-4; h[s] = v; if (v > hMax) hMax = v; }
  const LV = Math.floor(hMax / k) + 3;
  const tint = (n: number, f: number): [number, number, number] => { const c = ttgTint(n * k); return [Math.min(255, Math.round(c[0] * 255 * f)), Math.min(255, Math.round(c[1] * 255 * f)), Math.min(255, Math.round(c[2] * 255 * f))]; };
  const floorCol: [number, number, number][] = [], wallCol: [number, number, number][] = [];
  for (let n = 0; n < LV; n++) { floorCol.push(tint(n, 1)); wallCol.push(tint(n, 0.72)); }
  // with paint, a vertex's colour is the biome colour of its band at its own moisture (a crossing point blends its edge's two ends)
  const pt = paint ? paint.tint : null, bandsP = pt ? pt.length / (MOIST_STEPS * 3) : 0, mo = paint ? paint.moist : null;
  const paintAt = (n: number, m: number, f: number, out: number[]) => {
    const b = Math.min(bandsP - 1, n), q = Math.max(0, Math.min(MOIST_STEPS - 1, Math.round(m * (MOIST_STEPS - 1)))), o = (b * MOIST_STEPS + q) * 3;
    out[0] = pt![o] * f; out[1] = pt![o + 1] * f; out[2] = pt![o + 2] * f;
  };
  const pc = [0, 0, 0];
  const sc = new Scratch(), patches: PatchMesh[] = [];
  let tris = 0, verts = 0, bytes = 0;

  // scratch for a crossing point, and the polygon of one band of one triangle
  const cd = [0, 0, 0];
  const crossDir = (lo: number, hi: number, m: number, out: number[]) => {
    const t = (m * k - h[lo]) / (h[hi] - h[lo]), a = lo * 3, b = hi * 3;
    const x = dir[a] + (dir[b] - dir[a]) * t, y = dir[a + 1] + (dir[b + 1] - dir[a + 1]) * t, z = dir[a + 2] + (dir[b + 2] - dir[a + 2]) * t, l = Math.hypot(x, y, z);
    out[0] = x / l; out[1] = y / l; out[2] = z / l;
  };
  /** The floor vertex of a sample in band n. */
  const sampleV = (s: number, n: number): number => {
    const key = s * LV + n; let v = sc.ms.get(key);
    if (v === undefined) {
      let c: ArrayLike<number> = floorCol[n]; const a = s * 3;
      if (pt) { paintAt(n, mo![s], 1, pc); c = pc; }
      v = sc.vertex(dir[a], dir[a + 1], dir[a + 2], n * k, dir[a], dir[a + 1], dir[a + 2], c[0], c[1], c[2]); sc.ms.set(key, v);
    }
    return v;
  };
  /** The floor vertex where the contour m (height m*k) crosses the edge (p, q), on the floor of band n (n is m or m - 1). */
  const edgeV = (p: number, q: number, m: number, n: number): number => {
    const lo = p < q ? p : q, hi = p < q ? q : p, key = ((lo * S + hi) * LV + m) * 2 + (n === m ? 1 : 0);
    let v = sc.me.get(key);
    if (v === undefined) {
      crossDir(lo, hi, m, cd); let c: ArrayLike<number> = floorCol[n];
      if (pt) { const t = (m * k - h[lo]) / (h[hi] - h[lo]); paintAt(n, mo![lo] + (mo![hi] - mo![lo]) * t, 1, pc); c = pc; }
      v = sc.vertex(cd[0], cd[1], cd[2], n * k, cd[0], cd[1], cd[2], c[0], c[1], c[2]); sc.me.set(key, v);
    }
    return v;
  };
  const dirAt = (v: number, out: number[]) => { const o = v * 6; out[0] = sc.f32[o]; out[1] = sc.f32[o + 1]; out[2] = sc.f32[o + 2]; };
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  /** Add a floor triangle, wound so that it faces outwards, unless it has no area. */
  const floorTri = (a: number, b: number, c: number) => {
    dirAt(a, A); dirAt(b, B); dirAt(c, C);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < MIN_AREA2) return;
    if (cx * (A[0] + B[0] + C[0]) + cy * (A[1] + B[1] + C[1]) + cz * (A[2] + B[2] + C[2]) > 0) sc.tri(a, b, c); else sc.tri(a, c, b);
  };
  const D1 = [0, 0, 0], D2 = [0, 0, 0], poly = [0, 0, 0, 0, 0, 0];
  /** Add the wall of contour m between the crossing points (p1 on the edge e1, p2 on e2) standing from band m-1 up to band m, facing the low side (towards the sample `low`). */
  const wall = (e1a: number, e1b: number, e2a: number, e2b: number, m: number, low: number) => {
    crossDir(e1a < e1b ? e1a : e1b, e1a < e1b ? e1b : e1a, m, D1); crossDir(e2a < e2b ? e2a : e2b, e2a < e2b ? e2b : e2a, m, D2);
    const tx = D2[0] - D1[0], ty = D2[1] - D1[1], tz = D2[2] - D1[2];
    if (tx * tx + ty * ty + tz * tz < MIN_AREA2) return;
    let mx = D1[0] + D2[0], my = D1[1] + D2[1], mz = D1[2] + D2[2]; const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
    let nx = ty * mz - tz * my, ny = tz * mx - tx * mz, nz = tx * my - ty * mx; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const l = low * 3;
    if (nx * (dir[l] - mx) + ny * (dir[l + 1] - my) + nz * (dir[l + 2] - mz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    let c: ArrayLike<number> = wallCol[m]; const h0 = (m - 1) * k, h1 = m * k;
    if (pt) { const lo = e1a < e1b ? e1a : e1b, hi = e1a < e1b ? e1b : e1a, t = (m * k - h[lo]) / (h[hi] - h[lo]); paintAt(m, mo![lo] + (mo![hi] - mo![lo]) * t, 0.72, pc); c = pc; }
    const v0 = sc.vertex(D1[0], D1[1], D1[2], h0, nx, ny, nz, c[0], c[1], c[2]), v1 = sc.vertex(D2[0], D2[1], D2[2], h0, nx, ny, nz, c[0], c[1], c[2]);
    const v2 = sc.vertex(D2[0], D2[1], D2[2], h1, nx, ny, nz, c[0], c[1], c[2]), v3 = sc.vertex(D1[0], D1[1], D1[2], h1, nx, ny, nz, c[0], c[1], c[2]);
    // wound so that the face turns to (nx, ny, nz): cross of two edges, in layer units
    const p0 = [D1[0] * (RL + h0), D1[1] * (RL + h0), D1[2] * (RL + h0)], p1 = [D2[0] * (RL + h0), D2[1] * (RL + h0), D2[2] * (RL + h0)], p3 = [D1[0] * (RL + h1), D1[1] * (RL + h1), D1[2] * (RL + h1)];
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2], fx = p3[0] - p0[0], fy = p3[1] - p0[1], fz = p3[2] - p0[2];
    const g = (ey * fz - ez * fy) * nx + (ez * fx - ex * fz) * ny + (ex * fy - ey * fx) * nz;
    if (g > 0) { sc.tri(v0, v1, v2); sc.tri(v0, v2, v3); } else { sc.tri(v0, v2, v1); sc.tri(v0, v3, v2); }
  };

  /** One triangle of the grid: its floors, and its walls. */
  const triangle = (s0: number, s1: number, s2: number) => {
    let a = s0, b = s1, c = s2, t: number;   // sorted by height: a lowest
    if (h[a] > h[b]) { t = a; a = b; b = t; } if (h[b] > h[c]) { t = b; b = c; c = t; } if (h[a] > h[b]) { t = a; a = b; b = t; }
    const ha = h[a], hb = h[b], hc = h[c];
    if (hc < 0) return;   // (wholly under the sea)
    const nlo = Math.max(0, Math.floor(ha / k)), nhi = Math.floor(hc / k);
    if (nlo === nhi && ha >= 0) { floorTri(sampleV(s0, nlo), sampleV(s1, nlo), sampleV(s2, nlo)); return; }   // (one band: a flat floor)
    for (let n = nlo; n <= nhi; n++) {
      const L0 = n * k, L1 = (n + 1) * k;
      let np = 0;
      // the chain: the bottom of the band along the long edge and the short side, the middle vertex if it lies inside, the top along the short side and the long edge
      if (L0 > ha) { poly[np++] = edgeV(a, c, n, n); poly[np++] = L0 < hb ? edgeV(a, b, n, n) : edgeV(b, c, n, n); } else poly[np++] = sampleV(a, n);
      if (hb > L0 && hb < L1) poly[np++] = sampleV(b, n);
      if (L1 < hc) { poly[np++] = L1 < hb ? edgeV(a, b, n + 1, n) : edgeV(b, c, n + 1, n); poly[np++] = edgeV(a, c, n + 1, n); } else poly[np++] = sampleV(c, n);
      for (let i = 1; i + 1 < np; i++) floorTri(poly[0], poly[i], poly[i + 1]);
    }
    for (let m = Math.max(1, Math.floor(ha / k) + 1); m <= nhi; m++) {   // (the contours that cross the triangle: ha < m*k < hc)
      const L = m * k; if (!(L > ha && L < hc)) continue;
      if (L < hb) wall(a, c, a, b, m, a); else wall(a, c, b, c, m, a);
    }
  };

  for (let f = 0; f < 6; f++) for (let pj = 0; pj < PATCHES; pj++) for (let pi = 0; pi < PATCHES; pi++) {
    sc.reset();
    for (let cj = pj * P; cj < (pj + 1) * P; cj++) for (let ci = pi * P; ci < (pi + 1) * P; ci++) {
      const o = f * per + cj * W + ci, v00 = vid[o], v10 = vid[o + 1], v01 = vid[o + W], v11 = vid[o + W + 1];
      if ((ci + cj) & 1) { triangle(v00, v10, v11); triangle(v00, v11, v01); } else { triangle(v00, v10, v01); triangle(v10, v11, v01); }
    }
    // the patch's buffers (copies of the right size: they are handed over), its cap and its heights
    const nv = sc.nv, ni = sc.ni, vb = sc.vbuf.slice(0, nv * PLANET_VERTEX_BYTES), index = nv <= 65535 ? Uint16Array.from(sc.idx.subarray(0, ni)) : sc.idx.slice(0, ni);
    let sx = 0, sy = 0, sz = 0, minH = Infinity, maxH = -Infinity;
    for (let v = 0; v < nv; v++) { const q = v * 6; sx += sc.f32[q]; sy += sc.f32[q + 1]; sz += sc.f32[q + 2]; const hh = sc.f32[q + 3]; if (hh < minH) minH = hh; if (hh > maxH) maxH = hh; }
    let cap: [number, number, number, number] = [1, 0, 0, 0];
    if (nv) {
      const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l; let rad = 0;
      for (let v = 0; v < nv; v++) { const q = v * 6, d = sc.f32[q] * sx + sc.f32[q + 1] * sy + sc.f32[q + 2] * sz; rad = Math.max(rad, Math.acos(Math.max(-1, Math.min(1, d)))); }
      cap = [sx, sy, sz, Math.min(Math.PI, rad * 1.02 + 0.002)];
    } else { minH = 0; maxH = 0; }
    patches.push({ face: f, px: pi, py: pj, verts: vb, nv, index, ni, cap, minH, maxH });
    tris += ni / 3; verts += nv; bytes += vb.byteLength + index.byteLength;
    yield null;
  }
  return { N, k, patches, tris, verts, bytes };
}

/** Run a generator to its end (for tests and tools; a worker steps it between messages instead). */
export function runToEnd<T>(g: Generator<null, T, void>): T { let r = g.next(); while (!r.done) r = g.next(); return r.value; }
