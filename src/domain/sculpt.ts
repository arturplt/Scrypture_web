/**
 * The macro sculpt (milestone 5 of SCRYPTURE_WORLD_GENERATOR_ROADMAP.md): the player raises and lowers the planet's ground at the scale of the sample grid of 64 x 64 cells a face (one point every 82 tiles).
 * A point's value is whole quarter layers, kept sparse in the saved settings (`GenParams.sculpt`: pairs of point number and value). The points on a face's edges and the cube's corners are shared, so the field
 * has one value per place and is continuous across faces; between points it is bilinear in the face's net coordinates (equal-angle: a fraction of the way along a face is a fraction of the angle).
 * The terrain adds it once, to the base ground before the lakes are laid in and the terraces cut (terrace.ts), so chunks, far meshes, maps, minimap, collision and the workers all see it.
 */
import { FACES, faceOf, type V3 } from './cube';
import { planetGrid, type PlanetGrid } from './planetgrid';
import { SCULPT_CELLS, SCULPT_MAX, SCULPT_POINTS } from './genparams';

const W = SCULPT_CELLS + 1, PER = W * W;
let grid: PlanetGrid | null = null;
/** The sculpt's point grid (shared with the planet mesh's grid of the same detail). */
export const sculptGrid = (): PlanetGrid => (grid ??= planetGrid(SCULPT_CELLS));

/** The dense values (quarter layers) of a sparse list [point, value, point, value, ...]. */
export function sculptDense(sparse: ArrayLike<number> | undefined): Int16Array {
  const d = new Int16Array(SCULPT_POINTS);
  if (sparse) for (let i = 0; i + 1 < sparse.length; i += 2) { const p = sparse[i]; if (p >= 0 && p < SCULPT_POINTS) d[p] = Math.max(-SCULPT_MAX, Math.min(SCULPT_MAX, sparse[i + 1])); }
  return d;
}

/** The sculpt's height, in layers, at a point of the canonical net of a planet with faces `N` tiles wide (0 on the net's voids). */
export function sculptAt(dense: Int16Array, x: number, y: number, N: number): number {
  const f = faceOf(x, y); if (f < 0) return 0;
  const F = FACES[f], vid = sculptGrid().vid;
  const fu = Math.max(0, Math.min(1, (x - F.ix * N) / N + 0.5)) * SCULPT_CELLS, fv = Math.max(0, Math.min(1, (y - F.iy * N) / N + 0.5)) * SCULPT_CELLS;
  const i = Math.min(SCULPT_CELLS - 1, Math.floor(fu)), j = Math.min(SCULPT_CELLS - 1, Math.floor(fv)), tx = fu - i, ty = fv - j, o = f * PER + j * W + i;
  const a = dense[vid[o]], b = dense[vid[o + 1]], c = dense[vid[o + W]], d = dense[vid[o + W + 1]];
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 4;
}

/** How strongly a brush of angular radius `r` (rad) works at angular distance `d` from its middle: 1 in the middle, easing smoothly to 0 at the rim. */
export const brushFalloff = (d: number, r: number): number => { if (d >= r) return 0; const t = 1 - d / r; return t * t * (3 - 2 * t); };

const HISTORY_MAX = 40;
/**
 * The sculpt as it is edited: float values (so many small dabs add up), strokes that can be undone (a bounded history), and the sparse list to save. Values are kept within +-SCULPT_MAX quarter layers.
 */
export class SculptModel {
  /** Quarter layers of every point. */
  readonly v = new Float32Array(SCULPT_POINTS);
  private history: Map<number, number>[] = [];
  private stroke: Map<number, number> | null = null;

  static from(sparse: ArrayLike<number> | undefined): SculptModel { const m = new SculptModel(), d = sculptDense(sparse); for (let i = 0; i < d.length; i++) m.v[i] = d[i]; return m; }
  get canUndo(): boolean { return this.history.length > 0; }
  get empty(): boolean { for (let i = 0; i < this.v.length; i++) if (Math.round(this.v[i]) !== 0) return false; return true; }

  beginStroke() { this.stroke = new Map(); }
  /** Raise (layers > 0) or lower (< 0) the ground round a direction on the ball: `layers` at the middle, easing to nothing at angular distance `radius` (rad). Returns whether anything moved. */
  dab(dir: V3, radius: number, layers: number): boolean {
    const g = sculptGrid(), d = g.dir, c = Math.cos(radius), q = layers * 4; let moved = false;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1, x = dir[0] / l, y = dir[1] / l, z = dir[2] / l;
    for (let s = 0; s < g.S; s++) {
      const dot = d[3 * s] * x + d[3 * s + 1] * y + d[3 * s + 2] * z; if (dot <= c) continue;
      const w = brushFalloff(Math.acos(Math.min(1, dot)), radius); if (w <= 0) continue;
      const old = this.v[s], nv = Math.max(-SCULPT_MAX, Math.min(SCULPT_MAX, old + q * w)); if (nv === old) continue;
      if (this.stroke && !this.stroke.has(s)) this.stroke.set(s, old);
      this.v[s] = nv; moved = true;
    }
    return moved;
  }
  endStroke() { if (this.stroke && this.stroke.size) { this.history.push(this.stroke); if (this.history.length > HISTORY_MAX) this.history.shift(); } this.stroke = null; }
  /** Undo the last stroke. */
  undo(): boolean { const s = this.history.pop(); if (!s) return false; for (const [p, old] of s) this.v[p] = old; return true; }
  /** Flatten everything (one undoable step). */
  clear(): boolean {
    const s = new Map<number, number>(); for (let i = 0; i < this.v.length; i++) if (this.v[i] !== 0) { s.set(i, this.v[i]); this.v[i] = 0; }
    if (!s.size) return false; this.history.push(s); if (this.history.length > HISTORY_MAX) this.history.shift(); return true;
  }
  /** The sparse list to save: points whose value rounds to something, in order. */
  toSparse(): number[] | undefined {
    const out: number[] = [];
    for (let i = 0; i < this.v.length; i++) { const q = Math.max(-SCULPT_MAX, Math.min(SCULPT_MAX, Math.round(this.v[i]))); if (q !== 0) out.push(i, q); }
    return out.length ? out : undefined;
  }
}
