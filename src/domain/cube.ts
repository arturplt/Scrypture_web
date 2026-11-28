/**
 * A finite world on a cube-sphere, for the seeded Hills.
 *
 * The planet is a cube whose six faces are each a square grid of N x N tiles, pushed out onto a ball ("equal-angle" cube-sphere: a face coordinate u of N/2 is 45 degrees from the face centre, and
 * the tile grid is `tan`-spaced so a tile is 0.94 to 1.0 of a metre across over nearly the whole face; only at the 8 cube corners is the grid skewed, so each corner is a flat CAP the ground
 * blends into, and nothing lives there). There are no poles and no wrapping: every place has one tile address, so terrain, saves and chunks never smear or repeat.
 *
 * The NET is the address. The six faces lie in a fixed 4 x 3 cross in one flat plane ("net coordinates", x east, y south, tiles): the front face is centred on (0, 0), its neighbours are one
 * face width N away. A tile's net coordinates ARE its canonical identity (tile key, chunk key, save key). Five of the cube's twelve edges are also edges in the net (a coordinate just
 * past them is just a tile of the next face, nothing to do); the other seven are cut, and a coordinate just past one lies in a void of the net. Those are handled by an *extension*: the
 * ground past a cut edge is the neighbour face's, turned by a quarter turn and moved (`canonInto` finds the tile and the exact transform, so the simulation can turn what it carries too).
 * A coordinate in the square beyond a corner, or further than EXT_MARGIN past an edge, is not on the planet: it reads as the flat corner cap.
 *
 * Face data are 3D unit vectors: `c` the face's centre direction, `a` the way net x grows on it, `b` the way net y grows. They are all derived from these six, nothing is a hand-written table.
 * A world of no size (`0`, the default) is the endless plane as it always was, and every function here is then the identity.
 */

/** Tiles along a face. The planet's radius is 2N / pi = 2139 m: a third of the first cube planet (CUBE_N_FIRST), so far less to build and draw. The orbit scales with it (see setPlanetRadius). */
export const CUBE_N = 3360;
/** The size the planet's fixed distances (the giant's ring, ...) were tuned for: a planet of another size scales them. */
export const CUBE_N_FIRST = 10080;
/** The sizes a saved world may have (anything else is read as an endless world). */
export const CUBE_SIZES: readonly number[] = [CUBE_N];
/** The planet's radius (m) for faces N tiles wide. */
export const cubeRadius = (n: number): number => (2 * n) / Math.PI;
/** How far past a cut edge the ground is still the neighbour's (tiles): wider than anything the view builds round the plane. */
export const EXT_MARGIN = 1500;
/** The corner cap: dead flat inside CAP_FLAT tiles of a cube corner, easing in from CAP_FLAT + CAP_FADE out. */
export const CAP_FLAT = 270, CAP_FADE = 400;
/** The layer (elevation) of the cap's sheet: well below the sea, so every cube corner is open ocean (the land eases down to it over CAP_FADE tiles). */
export const CAP_LEVEL = -6;

export type V3 = readonly [number, number, number];
export interface Face { readonly c: V3; readonly a: V3; readonly b: V3; readonly ix: number; readonly iy: number; readonly name: string }
/** The six faces: front, right, back, left, top, bottom. a x b = -c on every face (the same turn on all of them). */
export const FACES: readonly Face[] = [
  { name: 'front', c: [1, 0, 0], a: [0, 1, 0], b: [0, 0, -1], ix: 0, iy: 0 },
  { name: 'right', c: [0, 1, 0], a: [-1, 0, 0], b: [0, 0, -1], ix: 1, iy: 0 },
  { name: 'back', c: [-1, 0, 0], a: [0, -1, 0], b: [0, 0, -1], ix: 2, iy: 0 },
  { name: 'left', c: [0, -1, 0], a: [1, 0, 0], b: [0, 0, -1], ix: -1, iy: 0 },
  { name: 'top', c: [0, 0, 1], a: [0, 1, 0], b: [1, 0, 0], ix: 0, iy: -1 },
  { name: 'bottom', c: [0, 0, -1], a: [0, 1, 0], b: [-1, 0, 0], ix: 0, iy: 1 },
];
const dot = (p: V3, q: V3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const faceByCentre = (v: V3): number => FACES.findIndex(f => dot(f.c, v) > 0.5);
/** The face whose net cell is (ix, iy), or -1 (net cells of the cross: ix -1..2 along the belt, iy -1..1 only at ix 0). */
const FACE_AT_CELL = new Map<number, number>(FACES.map((f, i) => [f.ix * 8 + f.iy, i]));
const cellFace = (ix: number, iy: number): number => FACE_AT_CELL.get(ix * 8 + iy) ?? -1;

let N = 0;
/** The face size in use, as a live binding for the hot paths (0 = endless). */
export let GN = 0;
/** Make the ground a cube-sphere with faces N tiles wide (0 or null: the endless plane). One world at a time, like `setRealTerrain`: every `World` sets it. */
export function setCubeSize(size: number | null | undefined) { N = size && size > 0 ? size : 0; GN = N; }
/** The face size now in use (0 = endless). */
export const cubeSize = (): number => N;
export const isCube = (): boolean => N > 0;

// ---- the sphere ----------------------------------------------------------------------------------------------------------------------

/** The face under a net point that lies inside a face's rect (-1 in the net's voids). */
export function faceOf(x: number, y: number): number {
  if (N === 0) return -1;
  const ix = Math.round(x / N), iy = Math.round(y / N);
  return cellFace(ix, iy);
}
/** The direction (unit vector) of a net point that lies inside a face's rect, written into `out`; false in the net's voids. */
export function netToDir(x: number, y: number, out: number[]): boolean {
  const f = faceOf(x, y); if (f < 0) return false;
  const F = FACES[f], u = x - F.ix * N, v = y - F.iy * N, ta = Math.tan((u / N) * (Math.PI / 2)), tb = Math.tan((v / N) * (Math.PI / 2));
  const dx = F.c[0] + F.a[0] * ta + F.b[0] * tb, dy = F.c[1] + F.a[1] * ta + F.b[1] * tb, dz = F.c[2] + F.a[2] * ta + F.b[2] * tb, l = Math.hypot(dx, dy, dz);
  out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
  return true;
}
/** The net point of a direction: [x, y] on the face it points at. */
export function dirToNet(dx: number, dy: number, dz: number): [number, number] {
  const d: V3 = [dx, dy, dz];
  let best = 0, bv = -Infinity;
  for (let i = 0; i < 6; i++) { const t = dot(FACES[i].c, d); if (t > bv) { bv = t; best = i; } }
  const F = FACES[best], u = (Math.atan2(dot(F.a, d), bv) * N) / (Math.PI / 2), v = (Math.atan2(dot(F.b, d), bv) * N) / (Math.PI / 2);
  return [F.ix * N + u, F.iy * N + v];
}

// ---- extensions: the ground past a cut edge -------------------------------------------------------------------------------------------

/** How a face's net coordinates continue past one of its sides (0 east, 1 west, 2 south, 3 north): onto which face, and the affine map from net coordinates here to net coordinates there. */
interface Ext { g: number; a: number; b: number; c: number; d: number; tx: number; ty: number; identity: boolean }
/** The neighbour's net coordinates of the point (u, v) from face f's centre that lies past side `side` (exact unfolding: the point is `into` tiles inside the neighbour from its edge). */
function extendRaw(f: number, side: number, u: number, v: number, n: number): { g: number; x: number; y: number } {
  const F = FACES[f], east = side < 2, sgn = side % 2 === 0 ? 1 : -1;
  const e: V3 = east ? [sgn * F.a[0], sgn * F.a[1], sgn * F.a[2]] : [sgn * F.b[0], sgn * F.b[1], sgn * F.b[2]];
  const g = faceByCentre(e), G = FACES[g];
  const into = n - Math.abs(east ? u : v), along = east ? v : u, axis = east ? F.b : F.a;
  const vx = into * F.c[0] + along * axis[0], vy = into * F.c[1] + along * axis[1], vz = into * F.c[2] + along * axis[2], vec: V3 = [vx, vy, vz];
  return { g, x: G.ix * n + dot(G.a, vec), y: G.iy * n + dot(G.b, vec) };
}
let EXT: Ext[][] = [];
function buildExt(n: number) {
  EXT = FACES.map((_, f) => [0, 1, 2, 3].map(side => {
    const F = FACES[f], east = side < 2, sgn = side % 2 === 0 ? 1 : -1;
    // three points past the side, to read the affine map (it is exactly affine over the whole side)
    const at = (du: number, dv: number) => { const u = east ? sgn * n + du : du, v = east ? dv : sgn * n + dv; return extendRaw(f, side, u, v, n); };
    const p0 = at(0, 0), p1 = at(1, 0), p2 = at(0, 1);
    const base = (east ? sgn * n : 0) + F.ix * n, basey = (east ? 0 : sgn * n) + F.iy * n;   // (net coordinates of the sample point p0)
    const a = p1.x - p0.x, c = p1.y - p0.y, b = p2.x - p0.x, d = p2.y - p0.y;
    const tx = p0.x - (a * base + b * basey), ty = p0.y - (c * base + d * basey);
    return { g: p0.g, a, b, c, d, tx, ty, identity: Math.abs(a - 1) < 1e-9 && Math.abs(d - 1) < 1e-9 && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && Math.abs(tx) < 1e-6 && Math.abs(ty) < 1e-6 };
  }));
}
let builtFor = 0;
const ensureExt = () => { if (builtFor !== N) { builtFor = N; if (N > 0) buildExt(N); } };

/** Where a net point is on the planet, and how to carry the plane's coordinates and what it holds to that place. `x, y` is the canonical net point; the affine map (a b / c d, tx ty) takes the given point to it (so a vector turns by the same a b / c d). */
export interface Canon {
  x: number; y: number;
  a: number; b: number; c: number; d: number; tx: number; ty: number;
  /** The point is past a cut edge (in a void of the net): it has been moved onto the neighbour face. */
  moved: boolean;
  /** The point is in a corner square or too far from any face: it is on the corner cap (x, y is the nearest face corner). */
  cap: boolean;
}
export const newCanon = (): Canon => ({ x: 0, y: 0, a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, moved: false, cap: false });
const setId = (o: Canon, x: number, y: number) => { o.x = x; o.y = y; o.a = 1; o.b = 0; o.c = 0; o.d = 1; o.tx = 0; o.ty = 0; o.moved = false; o.cap = false; };

/** The canonical net point of a net point, written into `out` (no allocation). On an endless world it is the point itself. */
export function canonInto(x: number, y: number, out: Canon): Canon {
  if (N === 0) { setId(out, x, y); return out; }
  ensureExt();
  if (cellFace(Math.round(x / N), Math.round(y / N)) >= 0) { setId(out, x, y); return out; }
  // a void of the net: the nearest face it is just past a side of (within the margin)
  let bf = -1, bside = 0, bd = EXT_MARGIN + 1, nearest = 0, nd = Infinity;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f], u = x - F.ix * N, v = y - F.iy * N, eu = Math.abs(u) - N / 2, ev = Math.abs(v) - N / 2;
    const worst = Math.max(eu, ev); if (worst < nd) { nd = worst; nearest = f; }
    if (eu > 0 && ev <= 0 && eu < bd) { bd = eu; bf = f; bside = u > 0 ? 0 : 1; }
    else if (ev > 0 && eu <= 0 && ev < bd) { bd = ev; bf = f; bside = v > 0 ? 2 : 3; }
  }
  if (bf < 0) {   // past a corner or too far: the nearest face's nearest corner (the cap)
    const F = FACES[nearest], cu = Math.max(-N / 2, Math.min(N / 2 - 1e-6, x - F.ix * N)), cv = Math.max(-N / 2, Math.min(N / 2 - 1e-6, y - F.iy * N));
    setId(out, F.ix * N + cu, F.iy * N + cv); out.cap = true; return out;
  }
  const E = EXT[bf][bside];
  out.x = E.a * x + E.b * y + E.tx; out.y = E.c * x + E.d * y + E.ty;
  out.a = E.a; out.b = E.b; out.c = E.c; out.d = E.d; out.tx = E.tx; out.ty = E.ty; out.moved = !E.identity; out.cap = false;
  return out;
}
const TMP = newCanon();
/** The canonical point as a pair (allocates: not for hot loops). */
export function canonPoint(x: number, y: number): [number, number] { if (N === 0) return [x, y]; canonInto(x, y, TMP); return [TMP.x, TMP.y]; }
/** The canonical tile of a tile (a tile's centre goes to a tile's centre). */
export function canonTile(tx: number, ty: number): [number, number] {
  if (N === 0) return [tx, ty];
  canonInto(tx + 0.5, ty + 0.5, TMP);
  return [Math.floor(TMP.x), Math.floor(TMP.y)];
}
/** `tileKey` of the canonical tile of a tile (no allocation). */
export function canonTileKey(tx: number, ty: number): number {
  if (N === 0) return (tx + 1048576) * 2097152 + (ty + 1048576);
  canonInto(tx + 0.5, ty + 0.5, TMP);
  return (Math.floor(TMP.x) + 1048576) * 2097152 + (Math.floor(TMP.y) + 1048576);
}
/** The canonical chunk of a chunk (chunks are 16 tiles; the faces' edges lie on chunk edges). */
export function canonChunk(cx: number, cy: number, chunk = 16): [number, number] {
  if (N === 0) return [cx, cy];
  canonInto((cx + 0.5) * chunk, (cy + 0.5) * chunk, TMP);
  return [Math.floor(TMP.x / chunk), Math.floor(TMP.y / chunk)];
}
/** The affine map of `c` taken back: net coordinates of the canonical place to the net coordinates the point was given at. */
export function uncanon(qx: number, qy: number, c: Canon): [number, number] {
  const det = c.a * c.d - c.b * c.c, px = qx - c.tx, py = qy - c.ty;
  return [(c.d * px - c.b * py) / det, (-c.c * px + c.a * py) / det];
}
/** A net point carried by a canon's map (the point it was found for gets `c.x, c.y`; any other point near it gets its place on the same face). */
export function applyCanon(x: number, y: number, c: Canon): [number, number] { return [c.a * x + c.b * y + c.tx, c.c * x + c.d * y + c.ty]; }
/** How far a canon turns a direction, in radians (anticlockwise on a map with y north; the chart's y is south, so a quarter turn that is clockwise on the chart is anticlockwise here). */
export function turnAngle(c: Canon): number { return Math.atan2(-c.c, c.a); }
/** A vector (a velocity, a heading's direction, the wind) turned by a canon's quarter turn. */
export function turnVector(vx: number, vy: number, c: Canon): [number, number] { return [c.a * vx + c.b * vy, c.c * vx + c.d * vy]; }

/** How far into the corner cap a canonical net point is: 0 away from every corner, 1 on the flat sheet (a smooth ease between). */
export function capAt(x: number, y: number): number {
  if (N === 0) return 0;
  const f = cellFace(Math.round(x / N), Math.round(y / N)); if (f < 0) return 1;
  const F = FACES[f], u = Math.abs(x - F.ix * N), v = Math.abs(y - F.iy * N), d = Math.hypot(N / 2 - u, N / 2 - v);   // tiles from the nearest corner of the face
  if (d >= CAP_FLAT + CAP_FADE) return 0;
  if (d <= CAP_FLAT) return 1;
  const t = (CAP_FLAT + CAP_FADE - d) / CAP_FADE;
  return t * t * (3 - 2 * t);
}
/** Is a canonical net point inside its face's rect, at least `margin` tiles from every edge (features keep off the edges: they would be cut by them)? */
export function insideFace(x: number, y: number, margin = 0): boolean {
  if (N === 0) return true;
  const f = cellFace(Math.round(x / N), Math.round(y / N)); if (f < 0) return false;
  const F = FACES[f];
  return Math.abs(x - F.ix * N) <= N / 2 - margin && Math.abs(y - F.iy * N) <= N / 2 - margin;
}

// ---- the eye's frame, for the renderer ------------------------------------------------------------------------------------------------------

/** The direction of a net point in a chart that may reach past a cut edge (the plane's chart: its own face and the strip of the next one): false where it is not on the planet. */
export function chartDir(x: number, y: number, out: number[]): boolean {
  if (N === 0) return false;
  canonInto(x, y, TMP); if (TMP.cap) return false;
  return netToDir(TMP.x, TMP.y, out);
}
/** The frame at a net point of the plane's chart: up (the direction from the planet's centre), and the unit vectors along chart x (east) and chart y (south), made square to up and to each other. */
export function eyeFrame(x: number, y: number): { up: V3; east: V3; south: V3 } | null {
  const h = 0.5, p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0], s = [0, 0, 0], t = [0, 0, 0];
  if (!chartDir(x, y, p) || !chartDir(x + h, y, q) || !chartDir(x - h, y, r) || !chartDir(x, y + h, s) || !chartDir(x, y - h, t)) return null;
  let ex = q[0] - r[0], ey = q[1] - r[1], ez = q[2] - r[2], k = Math.hypot(ex, ey, ez); ex /= k; ey /= k; ez /= k;
  const dp = ex * p[0] + ey * p[1] + ez * p[2]; ex -= dp * p[0]; ey -= dp * p[1]; ez -= dp * p[2]; k = Math.hypot(ex, ey, ez); ex /= k; ey /= k; ez /= k;
  // south: square to up and east (up x east is one of north and south: the finite difference along chart y says which)
  const sx = p[1] * ez - p[2] * ey, sy = p[2] * ex - p[0] * ez, sz = p[0] * ey - p[1] * ex;   // up x east
  const sg = (s[0] - t[0]) * sx + (s[1] - t[1]) * sy + (s[2] - t[2]) * sz > 0 ? 1 : -1;
  return { up: [p[0], p[1], p[2]], east: [ex, ey, ez], south: [sg * sx, sg * sy, sg * sz] };
}
/** The planet as flat arrays for the vertex shader: the faces (centres, net-x axes, net-y axes, net cells) and the 24 extensions past a side (a b c d, tx ty), index face * 4 + side (east, west, south, north). */
export function shaderTables(): { c: Float32Array; a: Float32Array; b: Float32Array; cell: Float32Array; xa: Float32Array; xt: Float32Array } {
  ensureExt();
  const xa = new Float32Array(24 * 4), xt = new Float32Array(24 * 2);
  for (let f = 0; f < 6; f++) for (let side = 0; side < 4; side++) { const E = EXT[f]?.[side]; if (!E) continue; const i = f * 4 + side; xa.set([E.a, E.b, E.c, E.d], i * 4); xt.set([E.tx, E.ty], i * 2); }
  return { c: new Float32Array(FACES.flatMap(f => [...f.c])), a: new Float32Array(FACES.flatMap(f => [...f.a])), b: new Float32Array(FACES.flatMap(f => [...f.b])), cell: new Float32Array(FACES.flatMap(f => [f.ix, f.iy])), xa, xt };
}

/** The widest a face reaches from its centre on the ball (a cube corner: acos(1/sqrt 3) = 54.74 degrees) plus two degrees to spare, in radians. */
export const FACE_CAP = ((54.7356 + 2) * Math.PI) / 180;
/**
 * Is no part of face `f` (its ground, or hills up to `hill` tiles tall on it) above the horizon of an eye `h` tiles over the ball of radius `R`, at the point `up` (a unit vector)?
 * Conservative: the face lies within FACE_CAP of its centre; the eye sees out to acos(R / (R + h)) over the sea and a hill shows over that by another acos(R / (R + hill)).
 */
export function faceOverHorizon(f: number, up: V3, R: number, h: number, hill: number): boolean {
  if (f < 0 || f >= 6 || !(R > 0)) return false;
  const ang = Math.acos(Math.max(-1, Math.min(1, dot(FACES[f].c, up))));
  return ang - FACE_CAP > Math.acos(R / (R + Math.max(0, h))) + Math.acos(R / (R + Math.max(0, hill)));
}
