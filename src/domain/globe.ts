/**
 * A finite world on a globe, for the seeded Hills.
 *
 * The ground stays a flat tile grid (1 tile = 1 m, so everything that does tile or distance maths keeps working), but it is a *pillowcase sphere*:
 *  - going east or west, W tiles bring you back to where you began (x repeats with period W);
 *  - going north or south you reach a pole after P = W/4 tiles. A pole is a half turn: the world past it is the point-reflected world, as it is on a real sphere
 *    (left stays left), and after 4P = W tiles you are home again. Within CAP_FLAT + CAP_FADE tiles of a pole line the ground blends to one flat sheet (the polar cap),
 *    so the fold is seamless and nothing lives there;
 *  - the equator is y = 0 (where a world begins).
 * The player's coordinates are NOT wrapped: they stay "unrolled" and keep growing, and everything the world is made of is a function of the CANONICAL point
 * (`canonInto`): x in [-W/2, W/2), y in [-P, P]. Translating by W in x or in y is an exact symmetry (`rebaseBy`).
 *
 * One approximation, on purpose: parallels do not shrink towards the poles. A lap along any parallel is W game metres. The globe view pinches the map onto the sphere.
 * A world of no size (`0`, the default) is the endless plane as it always was, and every function here is then the identity.
 */

/** The one size of a globe for now: every cell size of the generators (8, 10, 16, 32, 36, 48, 56, 60, 96, 120, 192) divides 20160, and W is twice that. */
export const GLOBE_W = 40320;
/** The sizes a saved world may have (anything else is read as an endless world). */
export const GLOBE_SIZES: readonly number[] = [GLOBE_W];
/** The planet's radius (m) for a world W tiles round. */
export const planetRadius = (w: number): number => w / (2 * Math.PI);
/** Tiles from the equator to a pole line. */
export const poleOf = (w: number): number => w / 4;
/** The polar cap: dead flat inside CAP_FLAT tiles of the pole line, easing in from CAP_FLAT + CAP_FADE tiles out. */
export const CAP_FLAT = 600, CAP_FADE = 1400;
/** The layer (elevation) of the cap's sheet: just above the sea, so it reads as flat bare ground. */
export const CAP_LEVEL = 3.5;

let W = 0, P = 0;
/** The size in use, as a live binding for the hot paths (0 = endless). */
export let GW = 0;
/** Make the ground a globe W tiles round (0 or null: the endless plane). One world at a time, like `setRealTerrain`: every `World` sets it. */
export function setWorldSize(size: number | null | undefined) { W = size && size > 0 ? size : 0; P = W / 4; GW = W; }
/** The size of the world now in use (0 = endless). */
export const worldSize = (): number => W;
export const isGlobe = (): boolean => W > 0;

/** Where a point of the unrolled plane is on the globe, and how the two are related (to carry things back and forth). */
export interface Canon {
  /** The canonical point: x in [-W/2, W/2], y in [-P, P]. */
  x: number; y: number;
  /** Past a pole an odd number of times: the canonical world is turned by a half turn there. */
  flip: boolean;
  /** Whole laps east (x = xc + k W, or k W - xc when flipped) and whole laps of 4P north. */
  k: number; n: number;
}
export const newCanon = (): Canon => ({ x: 0, y: 0, flip: false, k: 0, n: 0 });

/** The canonical point of an unrolled point, written into `out` (no allocation). On an endless world it is the point itself. */
export function canonInto(x: number, y: number, out: Canon): Canon {
  if (W === 0) { out.x = x; out.y = y; out.flip = false; out.k = 0; out.n = 0; return out; }
  const k = Math.round(x / W), xc = x - W * k, s = y + P, n = Math.floor(s / (4 * P)), t = s - 4 * P * n;
  out.k = k; out.n = n;
  if (t <= 2 * P) { out.x = xc; out.y = t - P; out.flip = false; }
  else { out.x = -xc; out.y = 3 * P - t; out.flip = true; }
  return out;
}
const TMP = newCanon();
/** The canonical point as a pair (allocates: not for hot loops). */
export function canonPoint(x: number, y: number): [number, number] { if (W === 0) return [x, y]; canonInto(x, y, TMP); return [TMP.x, TMP.y]; }
/** The canonical tile of an unrolled tile (a tile's centre goes to a tile's centre: tile x maps to -x-1 when flipped). */
export function canonTile(tx: number, ty: number): [number, number] {
  if (W === 0) return [tx, ty];
  canonInto(tx + 0.5, ty + 0.5, TMP);
  return [Math.floor(TMP.x), Math.floor(TMP.y)];
}
/** `tileKey` of the canonical tile of an unrolled tile (no allocation). */
export function canonTileKey(tx: number, ty: number): number {
  if (W === 0) return (tx + 1048576) * 2097152 + (ty + 1048576);
  canonInto(tx + 0.5, ty + 0.5, TMP);
  return (Math.floor(TMP.x) + 1048576) * 2097152 + (Math.floor(TMP.y) + 1048576);
}
/** The canonical chunk of an unrolled chunk (chunks are 16 tiles; the pole lines and the seam lie on chunk edges). */
export function canonChunk(cx: number, cy: number, chunk = 16): [number, number] {
  if (W === 0) return [cx, cy];
  canonInto((cx + 0.5) * chunk, (cy + 0.5) * chunk, TMP);
  return [Math.floor(TMP.x / chunk), Math.floor(TMP.y / chunk)];
}
/** Which way a canonical heading (radians, 0 = east, anticlockwise) points for an unrolled one: turned by a half turn past a pole. */
export const canonHeading = (psi: number, flip: boolean): number => (flip ? psi + Math.PI : psi);

/** The copy of a canonical point that sits next to the unrolled point `ref` (what `canonInto(ref)` took it from): the inverse of the canonical map in that neighbourhood. */
export function unrollNear(qx: number, qy: number, ref: Canon): [number, number] {
  if (W === 0) return [qx, qy];
  return ref.flip ? [W * ref.k - qx, 2 * P + 4 * P * ref.n - qy] : [qx + W * ref.k, qy + 4 * P * ref.n];
}

/** Longitude (-pi..pi, east positive) and latitude (-pi/2..pi/2) of an unrolled point, and whether a heading there is turned by the poles. */
export function latLon(x: number, y: number): { lon: number; lat: number; flip: boolean } {
  if (W === 0) return { lon: 0, lat: 0, flip: false };
  canonInto(x, y, TMP);
  return { lon: (TMP.x / W) * 2 * Math.PI, lat: (TMP.y / P) * (Math.PI / 2), flip: TMP.flip };
}

/** How far into the polar cap a canonical y is: 0 away from it, 1 on the flat sheet (a smooth ease between). */
export function capAt(yc: number): number {
  if (W === 0) return 0;
  const d = P - Math.abs(yc);   // tiles from the pole line
  if (d >= CAP_FLAT + CAP_FADE) return 0;
  if (d <= CAP_FLAT) return 1;
  const t = (CAP_FLAT + CAP_FADE - d) / CAP_FADE;
  return t * t * (3 - 2 * t);
}

/** The whole laps of an unrolled position to take off so it sits near the origin again: a multiple of W in each axis (a symmetry of the world: nothing changes but the frame). */
export function rebaseBy(x: number, y: number, limit = 4): [number, number] {
  if (W === 0) return [0, 0];
  const lim = limit * W, rx = Math.abs(x) > lim ? Math.round(x / W) * W : 0, ry = Math.abs(y) > lim ? Math.round(y / W) * W : 0;
  return [rx, ry];
}

/** A cell index of cell size `c` folded into one lap (translation only: cells repeat with period W / c). The cell size must divide W. */
export function wrapCell(i: number, c: number): number {
  if (W === 0) return i;
  const n = W / c; let r = i % n; if (r < 0) r += n; return r;
}
