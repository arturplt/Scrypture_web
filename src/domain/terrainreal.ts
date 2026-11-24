/**
 * A real map as terraced ground: the Lake District's elevation (see lakedistrict.ts, scripts/build-lakedistrict.py) read as terrace layers, so the stepped
 * look of the Hills world stands on the real fells and lakes. `terrace.ts` uses this in place of its noise whenever a world is on a real map.
 *
 * The map is a grid of tiles (heights in real metres, a water class), centred on tile (0, 0) like the rest of the Lake District code. Elevation is in layers
 * (`layerM` real metres each; below 0 is the sea): the height of each tile read linearly between tile centres, so contours flow between them instead of
 * following the pixels, and the sea (and anything beyond the map) is -1. A lake is a flat sheet: its tiles are cut into a basin, one layer below the
 * shelf its shore stands on, stepping deeper towards its middle in rings, as the procedural lakes of the Hills world are, so everything that knows
 * about those (the sheets of water, the sand shore, the mesh's walls) works the same on a real lake.
 */
import type { LakeData } from './lakedistrict';

/** The most layers a lake's bed steps down from its surface, and the real metres from a lake's shore that one ring of its bed takes. */
const LAKE_DEEP = 3, RING_M = 150;
/** The distance transform is kept in thirds of a tile (a 3-4 chamfer: 3 for a step along a row, 4 for a diagonal one). */
const CH = 3;

export interface RealTerrain {
  readonly data: LakeData;
  readonly w: number; readonly h: number; readonly ox: number; readonly oy: number;
  readonly layerM: number;
  /** A lake's surface layer + 1 for every tile of a lake that stands at least one layer above the sea; 0 for land, sea and a lake at sea level. */
  readonly lv: Uint8Array;
  /** How far in from the rim a lake tile is, in thirds of a tile (capped at 255); 0 on land. */
  readonly dist: Uint8Array;
  /** Tiles one ring of a lake's bed takes, and the radius (tiles) of the sand shore round a lake. */
  readonly ring: number; readonly shoreR: number;
}

/** Work out what a terraced world needs from a loaded map: each lake tile's level and its distance in from the rim. */
export function makeRealTerrain(d: LakeData, layerM: number): RealTerrain {
  const { w, h } = d, lv = new Uint8Array(w * h), dist = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (d.water[i] === 1 && d.heightM[i] > 0.5) { const l = Math.floor(d.heightM[i] / layerM + 1e-6); if (l >= 1) lv[i] = Math.min(255, l + 1); }
  // distance from the rim: 0 outside, then a two-pass 3-4 chamfer inwards (a tile on the rim is CH, a tile further in adds CH or 4/3 CH for a diagonal)
  const INF = 255;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; if (!lv[k]) continue;
    let v = i === 0 || j === 0 || i === w - 1 || j === h - 1 ? CH : INF;   // (the edge of the map is a rim)
    if (v === INF) {
      const a = dist[k - 1], b = dist[k - w], c = dist[k - w - 1], e = dist[k - w + 1];
      v = Math.min(INF, Math.min(a + CH, b + CH, c + 4, e + 4));
      if (!lv[k - 1] || !lv[k - w] || !lv[k - w - 1] || !lv[k - w + 1]) v = CH;
    }
    dist[k] = v;
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i; if (!lv[k]) continue;
    if (i === w - 1 || j === h - 1) { dist[k] = Math.min(dist[k], CH); continue; }
    if (!lv[k + 1] || !lv[k + w] || !lv[k + w + 1] || (i > 0 && !lv[k + w - 1])) { dist[k] = Math.min(dist[k], CH); continue; }
    dist[k] = Math.min(dist[k], dist[k + 1] + CH, dist[k + w] + CH, dist[k + w + 1] + 4, i > 0 ? dist[k + w - 1] + 4 : INF);
  }
  return { data: d, w, h, ox: w >> 1, oy: h >> 1, layerM, lv, dist, ring: Math.max(2, RING_M / d.tileM), shoreR: Math.max(1, Math.round(40 / d.tileM)) };
}

const smooth01 = (t: number) => { const k = t < 0 ? 0 : t > 1 ? 1 : t; return k * k * (3 - 2 * k); };

/** A pixel's land value in layers: the height of the ground (a lake's surface included, so the land is continuous across it), -1 for sea or off the map. */
function landAt(r: RealTerrain, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return -1;
  const k = j * r.w + i;
  return r.data.water[k] === 1 && !r.lv[k] ? -1 : r.data.heightM[k] / r.layerM;
}

/** The land's elevation in layers at a point (tile coordinates, x east, y south): read linearly between tile centres, a lake's surface counting as ground, so the land is continuous across it. No basin cut. */
export function realLand(r: RealTerrain, x: number, y: number): number {
  const u = x + r.ox - 0.5, v = y + r.oy - 0.5, i0 = Math.floor(u), j0 = Math.floor(v), tx = u - i0, ty = v - j0;
  const a = landAt(r, i0, j0), b = landAt(r, i0 + 1, j0), c = landAt(r, i0, j0 + 1), e = landAt(r, i0 + 1, j0 + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
}

/**
 * The land `base` at a point with the lake basin cut into it, if a lake is near. The lake's rim is where the (linearly read) lake mask crosses a half; the ground eases down to the bed across a
 * tile, so the wall between shore and water stands on the rim. Kept apart from `realLand` so the chunk grids can smooth the land (see TerraceField.grid) without ever filling a lake in.
 */
export function realLake(r: RealTerrain, x: number, y: number, base: number): number {
  const u = x + r.ox - 0.5, v = y + r.oy - 0.5, i0 = Math.floor(u), j0 = Math.floor(v), tx = u - i0, ty = v - j0;
  if (i0 < 0 || j0 < 0 || i0 + 1 >= r.w || j0 + 1 >= r.h) return base;   // (past the map's edge no lake is looked for: one of the four is off the map)
  const k = j0 * r.w + i0, l0 = r.lv[k], l1 = r.lv[k + 1], l2 = r.lv[k + r.w], l3 = r.lv[k + r.w + 1];
  if ((l0 | l1 | l2 | l3) === 0) return base;
  const w0 = l0 ? (1 - tx) * (1 - ty) : 0, w1 = l1 ? tx * (1 - ty) : 0, w2 = l2 ? (1 - tx) * ty : 0, w3 = l3 ? tx * ty : 0, m = w0 + w1 + w2 + w3;
  if (m < 1e-9) return base;   // (exactly on a tile centre beside a lake: none of the lake's pixels has any say)
  const level = Math.max(l0, l1, l2, l3) - 1;
  const dd = (w0 * r.dist[k] + w1 * r.dist[k + 1] + w2 * r.dist[k + r.w] + w3 * r.dist[k + r.w + 1]) / m / CH;   // tiles in from the rim, over the lake's own pixels only
  const bed = level - 0.5 - Math.min(Math.min(LAKE_DEEP - 1, level - 1), Math.max(0, dd - 1) / r.ring), land = Math.max(base, level + 0.2);   // (a bed never goes under the beach shelf: below it is the sea)
  return land + (bed - land) * smooth01(m);
}

/** The elevation in layers at a point: the land with its lakes cut in. */
export const realElevation = (r: RealTerrain, x: number, y: number): number => realLake(r, x, y, realLand(r, x, y));

/** The layer of the lake's surface at a point if it is over the lake's water or the first sliver of its rim (so a sheet piece cut along the rim is counted), or -1. */
export function realLakeSheet(r: RealTerrain, x: number, y: number): number {
  const u = x + r.ox - 0.5, v = y + r.oy - 0.5, i0 = Math.floor(u), j0 = Math.floor(v);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= r.w || j0 + 1 >= r.h) return -1;
  const tx = u - i0, ty = v - j0, k = j0 * r.w + i0, l0 = r.lv[k], l1 = r.lv[k + 1], l2 = r.lv[k + r.w], l3 = r.lv[k + r.w + 1];
  if ((l0 | l1 | l2 | l3) === 0) return -1;
  const m = (l0 ? (1 - tx) * (1 - ty) : 0) + (l1 ? tx * (1 - ty) : 0) + (l2 ? (1 - tx) * ty : 0) + (l3 ? tx * ty : 0);
  return m >= 0.3 ? Math.max(l0, l1, l2, l3) - 1 : -1;
}

/** The surface layer of the lake the tile (floor of x, y) belongs to, or -1. */
export function realLakeTile(r: RealTerrain, x: number, y: number): number {
  const i = Math.floor(x) + r.ox, j = Math.floor(y) + r.oy;
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return -1;
  return r.lv[j * r.w + i] - 1;
}

/** Is the tile (floor of x, y) dry ground within the shore's radius of a lake? */
export function realLakeShore(r: RealTerrain, x: number, y: number): boolean {
  const ti = Math.floor(x) + r.ox, tj = Math.floor(y) + r.oy;
  if (ti < 0 || tj < 0 || ti >= r.w || tj >= r.h || r.lv[tj * r.w + ti]) return false;
  const R = r.shoreR;
  for (let dj = -R; dj <= R; dj++) {
    const j = tj + dj; if (j < 0 || j >= r.h) continue;
    for (let di = -R; di <= R; di++) { const i = ti + di; if (i >= 0 && i < r.w && r.lv[j * r.w + i]) return true; }
  }
  return false;
}
