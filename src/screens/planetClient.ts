/**
 * The page's end of the generator's preview worker (see workers/planetHost.ts). Every change of the settings is a request; the worker builds the latest only, and any result that is not
 * for the latest request is dropped before anyone uploads it. While a slider is dragged the request is a coarse mesh (an interaction preview, not LOD); after `quietMs` without a change the
 * selected detail is built. A mesh over the budget is not used: the last complete one stays and the warning says why (nothing is ever truncated, and the chosen detail is never lowered silently).
 */
import type { WorkerLike } from './chunkClient';
import { PlanetHost, type PlanetFrom, type PlanetTo, type MeshInfo } from '../workers/planetHost';
import { defaultBand, type PlanetMesh } from '../domain/planetmesh';
import type { GenParams } from '../domain/genparams';

export interface PlanetParams { seed: number; size: number; gen?: GenParams; detail: number; band: number; sculptRev?: number }
export interface BuiltInfo extends MeshInfo { id: number; quick: boolean; /** ms from asking to the mesh arriving */ latencyMs: number }
export interface PlanetClientOpts {
  onMesh: (mesh: PlanetMesh, info: BuiltInfo) => void;
  onWarn?: (msg: string, info: { N: number; k: number; tris: number; budget: number }) => void;
  onProgress?: (stage: 'sample' | 'build', frac: number, quick: boolean) => void;
  onError?: (msg: string) => void;
  /** Triangle budget of a mesh (low preset 100k, balanced 200k). */
  budgetTris?: number;
  /** Quiet time after the last dragged change before the selected detail is built. */
  quietMs?: number;
  /** The detail built while dragging. */
  quickDetail?: number;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
  now?: () => number;
}

export class PlanetClient {
  state: 'starting' | 'ready' | 'inprocess' | 'failed' = 'starting';
  failure = '';
  private worker: WorkerLike;
  private nextId = 1;
  private latest = 0;
  private latestQuick = false;
  private sentAt = new Map<number, number>();
  private timer: unknown = null;
  private pending: PlanetParams | null = null;
  /** While dragging: is a coarse request still being built, and the newest change that came meanwhile (sent when it arrives: one build at a time, so the preview keeps up with the drag instead of waiting for a pause). */
  private inFlight = false; private queued: PlanetParams | null = null;
  private o: Required<Pick<PlanetClientOpts, 'budgetTris' | 'quietMs' | 'quickDetail'>> & PlanetClientOpts;
  /** For the readout and the tests. */
  requests = 0; meshes = 0; staleDropped = 0; overBudget = 0; lastInfo: BuiltInfo | null = null;

  constructor(spawn: () => WorkerLike, opts: PlanetClientOpts) {
    this.o = { budgetTris: 200_000, quietMs: 150, quickDetail: 32, ...opts };
    try {
      this.worker = spawn();
    } catch {
      this.worker = this.inProcess(); this.state = 'inprocess';
    }
    this.worker.onmessage = e => this.onMessage(e.data as unknown as PlanetFrom);
    this.worker.onerror = e => this.fail(e instanceof Error ? e.message : 'worker error');
  }

  private inProcess(): WorkerLike {
    const w: WorkerLike = { onmessage: null, onerror: null, terminate() { /* nothing */ }, postMessage: m => { setTimeout(() => host.message(m as unknown as PlanetTo), 0); } };
    const host = new PlanetHost(m => { setTimeout(() => w.onmessage?.({ data: m as never }), 0); }, fn => { setTimeout(fn, 0); });
    return w;
  }
  private now() { return (this.o.now ?? (() => performance.now()))(); }
  private setT(fn: () => void, ms: number) { return (this.o.timers?.set ?? ((f, m) => setTimeout(f, m)))(fn, ms); }
  private clearT(h: unknown) { (this.o.timers?.clear ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h); }

  /** The settings changed. `dragging`: the change is part of a drag (a coarse mesh now, the chosen detail after a quiet moment). */
  set(p: PlanetParams, dragging = false) {
    if (this.state === 'failed') return;
    if (this.timer !== null) { this.clearT(this.timer); this.timer = null; }
    if (dragging && p.detail > this.o.quickDetail) {
      if (this.inFlight) this.queued = p; else this.sendQuick(p);
      this.pending = p;
      this.timer = this.setT(() => { this.timer = null; const q = this.pending; this.pending = null; if (q) this.send(q, q.detail, q.band, false); }, this.o.quietMs);
    } else { this.pending = null; this.queued = null; this.send(p, p.detail, p.band, false); }
  }
  private sendQuick(p: PlanetParams) { this.queued = null; this.inFlight = true; this.send(p, this.o.quickDetail, Math.max(p.band, defaultBand(this.o.quickDetail)), true); }
  /** The latest request is answered: if the drag has moved on meanwhile, build its newest state. */
  private answered() { this.inFlight = false; if (this.queued && this.timer !== null) this.sendQuick(this.queued); }

  private send(p: PlanetParams, detail: number, k: number, quick: boolean) {
    if (!quick) this.inFlight = false;
    const id = this.nextId++; this.latest = id; this.latestQuick = quick; this.requests++; this.sentAt.set(id, this.now());
    if (this.sentAt.size > 64) this.sentAt.delete(this.sentAt.keys().next().value!);
    this.worker.postMessage({ t: 'build', id, seed: p.seed, size: p.size, gen: p.gen, k, detail, sculptRev: p.sculptRev ?? 0 } as unknown as never);
  }

  private onMessage(m: PlanetFrom) {
    if (m.t === 'ready') { if (this.state === 'starting') this.state = 'ready'; return; }
    if (m.t === 'error') { if (m.id === undefined || m.id === this.latest) { this.o.onError?.(m.message); this.answered(); } return; }
    if (m.id !== this.latest) { if (m.t === 'mesh') this.staleDropped++; return; }
    if (m.t === 'progress') { this.o.onProgress?.(m.stage, m.frac, this.latestQuick); return; }
    if (m.tris > this.o.budgetTris) {
      this.overBudget++; this.answered();
      this.o.onWarn?.(`Detail ${m.N} with ${(m.k)}-layer bands is ${Math.round(m.tris / 1000)}k triangles, over the ${Math.round(this.o.budgetTris / 1000)}k budget: the last mesh stays. Raise the band thickness or lower the detail.`, { N: m.N, k: m.k, tris: m.tris, budget: this.o.budgetTris });
      return;
    }
    this.meshes++;
    const info: BuiltInfo = { id: m.id, quick: this.latestQuick, latencyMs: this.now() - (this.sentAt.get(m.id) ?? this.now()), sampleMs: m.sampleMs, buildMs: m.buildMs, cached: m.cached };
    this.lastInfo = info;
    this.answered();
    this.o.onMesh({ N: m.N, k: m.k, patches: m.patches, tris: m.tris, verts: m.verts, bytes: m.bytes }, info);
  }

  /** The most triangles a mesh may have (the quality preset). The next request is judged by it. */
  setBudget(tris: number) { this.o.budgetTris = tris; }

  private fail(why: string) { if (this.state === 'failed') return; this.state = 'failed'; this.failure = why; this.o.onError?.(why); }
  dispose() {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null; this.latest = -1; this.state = 'failed';
    try { this.worker.terminate(); } catch { /* gone */ }
  }
}
