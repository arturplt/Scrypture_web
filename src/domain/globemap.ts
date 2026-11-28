/**
 * The cube planet seen from space, for the flat canvas (the 3D view draws the planet itself): a small colour map of the whole world, laid out as the net of the cube (one pixel is a patch of ground
 * tiles, built a few rows a frame from the same terrain the game plays on) and a software renderer that ray-casts a ball with that map on it, lit by the sun, with a thin blue limb and stars.
 * Pure arrays in and out, so it runs in a test, and as pixel art on a small canvas it matches the game's own look. See cube.ts for the world's shape.
 */
import { cubeSize, capAt, dirToNet, faceOf, type V3 } from './cube';
import type { World } from './worldgen';
import { terraceBiome, terraceMoist, terraceBareFrom, elevationBroad, layerOf } from './terrace';

/** Pixels along a face in the net map (the map is 4 faces wide and 3 high). */
export const FACE_PX = 128;
export const GLOBE_MAP_W = 4 * FACE_PX, GLOBE_MAP_H = 3 * FACE_PX;

type RGB = readonly [number, number, number];
const SEA: RGB = [30, 74, 142], SAND: RGB = [216, 198, 142], GRASS: RGB = [124, 164, 80], WET: RGB = [86, 142, 92], WOOD: RGB = [54, 106, 60];
const ROCK: RGB = [148, 138, 128], SNOW: RGB = [238, 242, 248], ICE: RGB = [226, 236, 246], UNBUILT: RGB = [24, 28, 40];
const mix = (a: RGB, b: RGB, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The colour of dry land of a layer and biome (index into BIOME_LIST) where the bare tops begin at layer `bareFrom`: sand, meadows, woods, wet ground, bare rock and snow on the heights, a little lighter with height. */
export function groundTint(layer: number, b: number, bareFrom: number): [number, number, number] {
  let col: [number, number, number];
  if (layer >= bareFrom + 55) col = mix(ROCK, SNOW, Math.min(1, (layer - bareFrom - 55) / 40));
  else if (b === 3) col = layer >= bareFrom ? mix(SAND, ROCK, Math.min(1, (layer - bareFrom) / 30)) : [...SAND];
  else col = [...(b === 1 ? WOOD : b === 2 ? WET : GRASS)];
  const shade = 0.9 + Math.min(0.25, layer * 0.006);
  return [col[0] * shade, col[1] * shade, col[2] * shade];
}

/** The colour of the ground at an unrolled tile of a globe (the polar caps white, then sea, lakes, sand, meadows, woods, bare rock and snow on the heights). */
export function globeColor(world: World, x: number, y: number): [number, number, number] {
  const cap = capAt(x + 0.5, y + 0.5);
  if (!world.field) return [...GRASS];
  const seed = world.seed, layer = layerOf(elevationBroad(x + 0.5, y + 0.5, seed));   // (the broad ground: at a pixel of dozens of tiles the small hills and lakes would only be a speckle)
  let col: [number, number, number];
  if (layer < 0) col = mix(SEA, [20, 52, 112], Math.min(1, -layer / 4));
  else col = groundTint(layer, terraceBiome(layer, terraceMoist(x, y, seed)), terraceBareFrom());
  return cap > 0 ? mix(col, ICE, cap) : col;
}

/** The whole planet as the net of its cube: faces side by side as in cube.ts, the voids of the net black. Built a few rows at a time. */
export class GlobeMap {
  readonly w = GLOBE_MAP_W; readonly h = GLOBE_MAP_H;
  readonly px = new Uint8ClampedArray(GLOBE_MAP_W * GLOBE_MAP_H * 4);
  /** Rows finished (from the top). */
  rows = 0;
  constructor(private readonly world: World) {
    for (let i = 0; i < this.px.length; i += 4) { this.px[i] = UNBUILT[0]; this.px[i + 1] = UNBUILT[1]; this.px[i + 2] = UNBUILT[2]; this.px[i + 3] = 255; }
  }
  get done(): boolean { return this.rows >= this.h; }
  /** Work for up to `ms` milliseconds (at least one row). Returns whether the map is now finished. */
  step(ms: number): boolean {
    const N = cubeSize(); if (!N || this.done) return this.done;
    const t0 = performance.now();
    do {
      const j = this.rows, y = -1.5 * N + ((j + 0.5) / this.h) * 3 * N;
      for (let i = 0; i < this.w; i++) {
        const x = -1.5 * N + ((i + 0.5) / this.w) * 4 * N, o = (j * this.w + i) * 4;
        if (faceOf(x, y) < 0) continue;   // (a void of the net)
        const c = globeColor(this.world, Math.floor(x), Math.floor(y));
        this.px[o] = c[0]; this.px[o + 1] = c[1]; this.px[o + 2] = c[2];
      }
      this.rows++;
    } while (!this.done && performance.now() - t0 < ms);
    return this.done;
  }
}

/** Where the eye is: over the point with the frame `up` / `east` / `south` (see cube.ts eyeFrame) heading `heading` (radians on the plane's chart, 0 east, pi/2 north), `alt` metres above a planet of radius `R`. */
export interface GlobeView { up: V3; east: V3; south: V3; heading: number; alt: number; R: number; hour?: number; fov?: number }

const hash2 = (x: number, y: number): number => { let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * Draw the globe into `out` (w x h RGBA, rows from the top). The eye looks straight down at the point under it with the heading up the screen; the sun is where it is
 * noon for the hour the plane's own clock says (default noon straight overhead). Pixels the ball does not cover are black with stars and the blue rim of the air.
 */
export function renderGlobe(out: Uint8ClampedArray, w: number, h: number, map: GlobeMap, v: GlobeView): void {
  const S = v.up, E = v.east, N = [-v.south[0], -v.south[1], -v.south[2]];
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const up = [ch * E[0] + sh * N[0], ch * E[1] + sh * N[1], ch * E[2] + sh * N[2]], fw = [-S[0], -S[1], -S[2]];
  const rt = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]];
  const R = v.R, r = R + Math.max(0, v.alt), P0 = [S[0] * r, S[1] * r, S[2] * r], tanF = Math.tan(((v.fov ?? 55) * Math.PI) / 360), aspect = w / h;
  const sunLon = Math.atan2(S[1], S[0]) + (((12 - (v.hour ?? 12)) * 15) * Math.PI) / 180, sun = [Math.cos(sunLon), Math.sin(sunLon), 0];
  const mw = map.w, mh = map.h, mp = map.px, c0 = r * r - R * R, NN = cubeSize() || 1;
  for (let j = 0; j < h; j++) {
    const ny = (1 - (2 * (j + 0.5)) / h) * tanF;
    for (let i = 0; i < w; i++) {
      const nx = ((2 * (i + 0.5)) / w - 1) * tanF * aspect;
      let dx = nx * rt[0] + ny * up[0] + fw[0], dy = nx * rt[1] + ny * up[1] + fw[1], dz = nx * rt[2] + ny * up[2] + fw[2];
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const b = P0[0] * dx + P0[1] * dy + P0[2] * dz, disc = b * b - c0, o = (j * w + i) * 4;
      if (disc >= 0 && b < 0) {
        const s = -b - Math.sqrt(disc), px = P0[0] + s * dx, py = P0[1] + s * dy, pz = P0[2] + s * dz, nxn = px / R, nyn = py / R, nzn = pz / R;
        const [nx2, ny2] = dirToNet(nxn, nyn, nzn);
        const u = Math.min(mw - 1, Math.max(0, Math.floor(((nx2 / NN + 1.5) / 4) * mw))), vv = Math.min(mh - 1, Math.max(0, Math.floor(((ny2 / NN + 1.5) / 3) * mh))), m = (vv * mw + u) * 4;
        const lam = nxn * sun[0] + nyn * sun[1] + nzn * sun[2], day = Math.max(0, Math.min(1, lam * 4 + 0.5)), k = 0.1 + 0.9 * day * (0.55 + 0.45 * Math.max(0, lam));
        out[o] = mp[m] * k + 6 * (1 - day); out[o + 1] = mp[m + 1] * k + 10 * (1 - day); out[o + 2] = mp[m + 2] * k + 26 * (1 - day); out[o + 3] = 255;
      } else {
        // the air's thin rim round the ball: closest approach of the ray to the centre, brighter on the sunlit side
        let rr = 0, gg = 0, bb = 0;
        if (b < 0) {
          const dm = Math.sqrt(Math.max(0, r * r - b * b)) / R;
          if (dm < 1.07) {
            const q = [P0[0] - b * dx, P0[1] - b * dy, P0[2] - b * dz], ql = Math.hypot(q[0], q[1], q[2]) || 1, sd = (q[0] * sun[0] + q[1] * sun[1] + q[2] * sun[2]) / ql;
            const g = (1 - (dm - 1) / 0.07) ** 2 * (0.2 + 0.8 * Math.max(0, Math.min(1, sd * 2 + 0.5)));
            rr = 70 * g; gg = 130 * g; bb = 255 * g;
          }
        }
        if (rr === 0 && hash2(i, j) > 0.9965) { rr = gg = bb = 200 + 55 * hash2(j, i); }
        out[o] = rr; out[o + 1] = gg; out[o + 2] = bb; out[o + 3] = 255;
      }
    }
  }
  // the plane: a little arrow at the middle, the nose up the screen
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (let dy = -5; dy <= 3; dy++) {
    const half = Math.floor((dy + 5) / 2) + (dy > 0 ? 1 : 0);
    for (let dx = -half - 1; dx <= half + 1; dx++) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const edge = Math.abs(dx) >= half || dy === -5 || dy === 3, o = (y * w + x) * 4;
      if (Math.abs(dx) > half && !edge) continue;
      const inner = Math.abs(dx) <= half && dy > -5 && dy < 3;
      out[o] = inner ? 255 : 20; out[o + 1] = inner ? 255 : 20; out[o + 2] = inner ? 255 : 30; out[o + 3] = 255;
    }
  }
}
