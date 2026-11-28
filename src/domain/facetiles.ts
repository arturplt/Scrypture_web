/**
 * Planet faces drawn in tiles (Phase 1 of SCRYPTURE_TERRAIN_OPTIMISATION_ROADMAP.md): a face's far mesh is one 210 x 210 cell grid, and every frame it was drawn whole, twice, however little of it
 * showed. Its triangles are regrouped by tile (the same triangles, in a different order), each tile has a bounding cap on the ball, and a tile over the horizon or outside the view is not drawn.
 * Pure functions, so they can be tested without a GL context.
 */
import type { V3 } from './cube';

/** The triangles of a far level of `cols` x `cols` vertices, regrouped by tile of `T` x `T` cells (tiles in row order). The same triangles as `farIndices`, so the picture is the same. */
export interface TiledIndices { idx: Uint32Array; nt: number; T: number; /** index offset of each tile (nt * nt + 1 entries: tile k is starts[k] .. starts[k + 1]) */ starts: Int32Array }
const CACHE = new Map<number, TiledIndices>();
export function tiledIndices(cols: number, T: number): TiledIndices {
  const key = cols * 4096 + T, hit = CACHE.get(key); if (hit) return hit;
  const cells = cols - 1, nt = Math.ceil(cells / T), idx = new Uint32Array(cells * cells * 6), starts = new Int32Array(nt * nt + 1);
  let o = 0;
  for (let ty = 0; ty < nt; ty++) for (let tx = 0; tx < nt; tx++) {
    starts[ty * nt + tx] = o;
    for (let j = ty * T; j < Math.min(cells, (ty + 1) * T); j++) for (let i = tx * T; i < Math.min(cells, (tx + 1) * T); i++, o += 6) {
      const a = j * cols + i, c = a + cols;   // (the quad's two triangles, as in terrace.ts farIndices)
      idx[o] = a; idx[o + 1] = a + 1; idx[o + 2] = c + 1; idx[o + 3] = a; idx[o + 4] = c + 1; idx[o + 5] = c;
    }
  }
  starts[nt * nt] = o;
  const t = { idx, nt, T, starts }; CACHE.set(key, t); return t;
}

/**
 * The bounding cap of each tile on the ball: [x, y, z of the cap's centre direction, angular radius (rad)]. `dirOf` gives a net point's direction (false in a void of the net: that tile gets a
 * whole-sphere cap, so it is always drawn). The radius comes from 9 sample vertices of the tile and 3% + 0.01 rad to spare (the grid is smooth between them).
 */
export function tileCaps(pos: ArrayLike<number>, cols: number, nt: number, T: number, dirOf: (x: number, y: number, out: number[]) => boolean): Float32Array {
  const out = new Float32Array(nt * nt * 4), cells = cols - 1, d = [0, 0, 0], ds: number[][] = [];
  for (let ty = 0; ty < nt; ty++) for (let tx = 0; tx < nt; tx++) {
    const r0 = ty * T, r1 = Math.min(cells, (ty + 1) * T), c0 = tx * T, c1 = Math.min(cells, (tx + 1) * T), rm = (r0 + r1) >> 1, cm = (c0 + c1) >> 1;
    ds.length = 0; let ok = true, sx = 0, sy = 0, sz = 0;
    for (const r of [r0, rm, r1]) for (const c of [c0, cm, c1]) {
      const k = (r * cols + c) * 3; if (!dirOf(pos[k], pos[k + 1], d)) { ok = false; break; }
      ds.push([d[0], d[1], d[2]]); sx += d[0]; sy += d[1]; sz += d[2];
    }
    const o = (ty * nt + tx) * 4, l = Math.hypot(sx, sy, sz);
    if (!ok || l < 1e-6) { out[o] = 1; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = Math.PI; continue; }
    sx /= l; sy /= l; sz /= l; let rad = 0;
    for (const q of ds) rad = Math.max(rad, Math.acos(Math.max(-1, Math.min(1, q[0] * sx + q[1] * sy + q[2] * sz))));
    out[o] = sx; out[o + 1] = sy; out[o + 2] = sz; out[o + 3] = Math.min(Math.PI, rad * 1.03 + 0.01);
  }
  return out;
}

/** Is a cap (centre direction `c`, angular radius `rad`) wholly over the horizon of an eye `h` tiles up over a ball of radius `R` at `up`, allowing hills `hill` tiles tall? */
export function capOverHorizon(c: V3, rad: number, up: V3, R: number, h: number, hill: number): boolean {
  const ang = Math.acos(Math.max(-1, Math.min(1, c[0] * up[0] + c[1] * up[1] + c[2] * up[2])));
  return ang - rad > Math.acos(R / (R + Math.max(0, h))) + Math.acos(R / (R + Math.max(0, hill)));
}

/** Is a sphere (centre x y z, radius r) at least partly inside the view volume of the column-major matrix `m` (projection * view)? Conservative: true when in doubt. */
export function sphereInView(m: ArrayLike<number>, x: number, y: number, z: number, r: number): boolean {
  for (let k = 0; k < 3; k++) for (const s of [1, -1]) {   // (left/right, bottom/top, near/far planes: row 3 + s * row k of the matrix)
    const a = m[3] + s * m[k], b = m[7] + s * m[k + 4], c = m[11] + s * m[k + 8], d = m[15] + s * m[k + 12], len = Math.hypot(a, b, c);
    if (len > 0 && (a * x + b * y + c * z + d) / len < -r) return false;
  }
  return true;
}

export interface EyeFrame { up: V3; east: V3; south: V3 }
/**
 * Can any of a tile's ground be seen? `c`/`rad` its cap, `fr` the eye's frame on the ball, `R` the ball's radius, `h` the eye's height, `hill` the tallest ground, `ex, ey` the eye's chart
 * position and `vp` the view-projection matrix. The view test mirrors the vertex shader's turn of the ball under the eye (vertex shader: `q`), and is made only where the ground is wholly on
 * the ball (0.4 R from the eye; the shader eases the nearer ground in from the flat chart), so nearer tiles are always drawn.
 */
export function tileShown(c: V3, rad: number, fr: EyeFrame, R: number, h: number, hill: number, ex: number, ey: number, vp: ArrayLike<number>): boolean {
  if (capOverHorizon(c, rad, fr.up, R, h, hill)) return false;
  const ang = Math.acos(Math.max(-1, Math.min(1, c[0] * fr.up[0] + c[1] * fr.up[1] + c[2] * fr.up[2])));
  if (R * (ang - rad) <= 0.4 * R) return true;
  const wx = (c[0] - fr.up[0]) * R, wy = (c[1] - fr.up[1]) * R, wz = (c[2] - fr.up[2]) * R;
  const qx = ex + wx * fr.east[0] + wy * fr.east[1] + wz * fr.east[2], qy = ey + wx * fr.south[0] + wy * fr.south[1] + wz * fr.south[2], qz = -(wx * fr.up[0] + wy * fr.up[1] + wz * fr.up[2]);
  return sphereInView(vp, qx, qy, qz, (2 * R * Math.sin(Math.min(rad, Math.PI) / 2) + hill) * 1.05);
}

/** The bounds of each tile of a square grid of `cols` x `cols` vertices (tiles of T cells): [minx, maxx, miny, maxy, minz, maxz] over every vertex of the tile. */
export function gridTileBounds(pos: ArrayLike<number>, cols: number, nt: number, T: number): Float32Array {
  const out = new Float32Array(nt * nt * 6), cells = cols - 1;
  for (let ty = 0; ty < nt; ty++) for (let tx = 0; tx < nt; tx++) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let r = ty * T; r <= Math.min(cells, (ty + 1) * T); r++) for (let c = tx * T; c <= Math.min(cells, (tx + 1) * T); c++) {
      const k = (r * cols + c) * 3, x = pos[k], y = pos[k + 1], z = pos[k + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    out.set([x0, x1, y0, y1, z0, z1], (ty * nt + tx) * 6);
  }
  return out;
}

/**
 * Does a tile of an endless world's far level show? The level draws only between `s0` and `e0` tiles from the eye (the fragment shader throws the rest away), and only what is in the view.
 * `b` is the tile's bounds (see gridTileBounds); the vertex shader drops ground away from the eye by `curveC` a tile squared of distance and sinks it a few terrace steps (`zPad`), so the
 * tile's z range is widened to match before the view test.
 */
export function ringTileShown(b: ArrayLike<number>, o: number, ex: number, ey: number, s0: number, e0: number, vp: ArrayLike<number>, curveC: number, zPad: number): boolean {
  const x0 = b[o], x1 = b[o + 1], y0 = b[o + 2], y1 = b[o + 3];
  const nx = Math.max(x0 - ex, 0, ex - x1), ny = Math.max(y0 - ey, 0, ey - y1), fx = Math.max(Math.abs(x0 - ex), Math.abs(x1 - ex)), fy = Math.max(Math.abs(y0 - ey), Math.abs(y1 - ey));
  const dmin = Math.hypot(nx, ny), dmax = Math.hypot(fx, fy);
  if (dmax < s0 || dmin > e0) return false;
  const zlo = b[o + 4] - zPad, zhi = b[o + 5] + zPad + Math.max(0, curveC) * dmax * dmax;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (zlo + zhi) / 2, r = Math.hypot((x1 - x0) / 2, (y1 - y0) / 2, (zhi - zlo) / 2) * 1.02 + 1;
  return sphereInView(vp, cx, cy, cz, r);
}

/**
 * Can any of a real chunk of the ground round the eye be seen? `x, y` its middle and `tiles` its side (the chart's tiles), `zMin..zMax` the height range of its own mesh (z is down), `ex, ey` the eye, `vp` the
 * view-projection matrix. The vertex shader bends the ground away from the chart the chunk is made in: onto the planet's ball (radius `planetR`, 0 = none) or down a paraboloid (`curveC`, tiles of drop a tile
 * squared of distance): at most about d^2 / R (or curveC d^2) tiles at d tiles from the eye, plus on a planet the stretch of the net itself (a tile is 0.94 to 1 of a metre over most of a face and less near its corners, which moves a chunk d tiles away by a fifth of d at worst): the bounding sphere is widened by that (and a few tiles). Conservative: true when in doubt.
 */
export function chunkShown(vp: ArrayLike<number>, x: number, y: number, zMin: number, zMax: number, tiles: number, ex: number, ey: number, planetR: number, curveC: number): boolean {
  const dx = x - ex, dy = y - ey, d2 = dx * dx + dy * dy, bend = planetR > 0 ? d2 / planetR + 0.2 * Math.sqrt(d2) : curveC * d2, hz = (zMax - zMin) / 2, r = Math.hypot(tiles * Math.SQRT1_2, hz) + 3 + 1.5 * bend;
  return sphereInView(vp, x, y, (zMin + zMax) / 2, r);
}
