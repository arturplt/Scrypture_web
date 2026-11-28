/**
 * The world generator's preview worker, free of anything a page or a worker scope provides, so the tests can run it in-process (`planet.worker.ts` only wires it to `self`).
 * It builds the planet mesh (planetmesh.ts) for the latest request only: a request that arrives while one is being built replaces it (the job is dropped between two steps, and
 * `schedule` hands control back to the event loop between steps, so the new message is really delivered meanwhile). The heights of the last few requests are kept, so a change that
 * needs no new heights (the band thickness) rebuilds the mesh from them.
 */
import { bandsFor, buildPlanetMesh, paintTable, planetGrid, sampleHeights, sampleMoisture, type PatchMesh } from '../domain/planetmesh';
import { paramsKey, sanitizeGen, type GenParams } from '../domain/genparams';

export interface BuildReq {
  id: number; seed: number; size: number; gen?: GenParams;
  /** Layers a band is thick, and the detail (cells along a face's side). */
  k: number; detail: number;
  /** Bumped by the sculpt on every stroke: a different value is a different ground (the sculpt itself arrives with milestone 5). */
  sculptRev?: number;
}
export type PlanetTo = ({ t: 'build' } & BuildReq);
export interface MeshInfo { sampleMs: number; buildMs: number; /** the heights came from the cache */ cached: boolean }
export type PlanetFrom =
  | { t: 'ready' }
  | { t: 'progress'; id: number; stage: 'sample' | 'build'; frac: number }
  | ({ t: 'mesh'; id: number; N: number; k: number; tris: number; verts: number; bytes: number; patches: PatchMesh[] } & MeshInfo)
  | { t: 'error'; id?: number; message: string };

/** The key of a request's heights: moisture and cold change the colours only, so they are not in it (a change of either recolours from the heights kept). */
const keyOf = (r: BuildReq): string => [r.seed, r.size, paramsKey(r.gen ? { ...sanitizeGen(r.gen), moisture: 0, cold: 0 } : r.gen), r.detail, r.sculptRev ?? 0].join('|');
const moistKey = (r: BuildReq): string => [r.seed, r.size, r.detail].join('|');
const CACHE_MAX = 3;

type Step = { stage: 'sample' | 'build'; frac: number };
type Job = { req: BuildReq; it: Generator<Step, Extract<PlanetFrom, { t: 'mesh' }>, void> };

export class PlanetHost {
  private cur: Job | null = null;
  private next: BuildReq | null = null;
  private pumping = false;
  private cache = new Map<string, Float32Array>();
  private moistCache = new Map<string, Float32Array>();
  /** For the tests and the readout: jobs started, jobs dropped half-built. */
  started = 0; dropped = 0;

  constructor(private post: (m: PlanetFrom, transfer: Transferable[]) => void, private schedule: (fn: () => void) => void = defaultSchedule) {}

  message(m: PlanetTo) {
    try {
      if (m.t === 'build') {
        if (this.cur) { this.dropped++; this.cur = null; }   // (a half-built job is dropped, not finished)
        this.next = m;
        this.pump();
      }
    } catch (e) { this.post({ t: 'error', message: e instanceof Error ? e.message : String(e) }, []); }
  }

  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    this.schedule(() => {
      this.pumping = false;
      if (this.next) { const req = this.next; this.next = null; this.cur = { req, it: this.job(req) }; this.started++; }
      const j = this.cur;
      if (!j) return;
      try {
        const r = j.it.next();
        if (r.done) { this.cur = null; const m = r.value; this.post(m, m.patches.flatMap(p => [p.verts, p.index.buffer as ArrayBuffer])); }
        else this.post({ t: 'progress', id: j.req.id, stage: r.value.stage, frac: r.value.frac }, []);
      } catch (e) { this.cur = null; this.post({ t: 'error', id: j.req.id, message: e instanceof Error ? e.message : String(e) }, []); }
      if (this.cur || this.next) this.pump();
    });
  }

  private *job(req: BuildReq): Generator<Step, Extract<PlanetFrom, { t: 'mesh' }>, void> {
    const grid = planetGrid(req.detail), key = keyOf(req);
    let h = this.cache.get(key), sampleMs = 0, cached = true;
    if (h) { this.cache.delete(key); this.cache.set(key, h); }
    else {
      cached = false; const t0 = performance.now(), g = sampleHeights(grid, req.seed, req.size, req.gen);
      let r = g.next(), n = 0; const total = Math.ceil(grid.S / 2048);
      while (!r.done) { n++; yield { stage: 'sample', frac: n / total }; r = g.next(); }
      h = r.value; sampleMs = performance.now() - t0;
      this.cache.set(key, h); if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    }
    const mk = moistKey(req); let moist = this.moistCache.get(mk);
    if (!moist) {
      const t0 = performance.now(), g = sampleMoisture(grid, req.seed, req.size); let r = g.next(), n = 0; const total = Math.ceil(grid.S / 4096);
      while (!r.done) { n++; yield { stage: 'sample', frac: n / total }; r = g.next(); }
      moist = r.value; sampleMs += performance.now() - t0;
      this.moistCache.set(mk, moist); if (this.moistCache.size > CACHE_MAX) this.moistCache.delete(this.moistCache.keys().next().value!);
    }
    const t1 = performance.now(), paint = { moist, tint: paintTable(req.size, req.gen, req.k, bandsFor(h, req.k)) }, b = buildPlanetMesh(grid, h, req.k, paint);
    let r = b.next(), n = 0;
    while (!r.done) { n++; yield { stage: 'build', frac: n / 96 }; r = b.next(); }
    const m = r.value;
    return { t: 'mesh', id: req.id, N: m.N, k: m.k, tris: m.tris, verts: m.verts, bytes: m.bytes, patches: m.patches, sampleMs, buildMs: performance.now() - t1, cached };
  }
}

/** Hand control back to the event loop (a MessageChannel turn where there is one: no timer clamping). */
function defaultSchedule(fn: () => void) {
  if (typeof MessageChannel !== 'undefined') { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); fn(); }; c.port2.postMessage(0); }
  else setTimeout(fn, 0);
}
