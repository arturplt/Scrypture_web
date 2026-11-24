/**
 * The page's end of the chunk worker (workers/chunkHost.ts). The map asks for the chunks it needs every frame (`request`, nearest first is decided here, from where
 * `tick` was last told the plane is); at most `maxInFlight` are with the worker at a time; finished ones come back from `tick` as pictures to store.
 *
 * The worker builds from its own copy of the ground. Every change made to the main thread's `World` (see `World.record`) is passed to `push` and goes to the worker, in
 * order, before the next build is asked for, so a chunk is never built from older ground than the page had when it asked. A change made after that (`noteDirty`, told by
 * the ecosystem's dirty chunks) marks the chunk in flight as stale, so the map builds it again: the same thing it does for a built chunk.
 *
 * If the worker cannot start, errors or is silent for `startTimeoutMs`, `state` becomes 'failed' and the map goes back to building on its own thread.
 */
import { CHUNK, tileKey, type TileState, type WorldOp } from '../domain/worldgen';
import type { WorldKind } from '../domain/lakedistrict';
import { decodeDecos, type Deco } from '../domain/chunkbuild';
import type { FromWorker, ToWorker } from '../workers/chunkHost';

/** What a Worker is to this file (a real one, or a test's stand-in). */
export interface WorkerLike {
  postMessage(m: ToWorker, transfer?: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}
export interface BuiltChunk { key: number; cx: number; cy: number; px: Uint8ClampedArray; decos: Deco[]; /** the ground changed under it while it was being built: build it again */ stale: boolean; ms: number }
export interface ChunkInit { seed: number; kind: WorldKind; changes: [number, TileState][]; table: Uint8ClampedArray; ops: WorldOp[] }

export class ChunkClient {
  state: 'starting' | 'ready' | 'failed' = 'starting';
  /** Why it failed, for the readout. */
  failure = '';
  private worker: WorkerLike;
  private pending: WorldOp[] = [];
  private queue = new Map<number, { cx: number; cy: number; seen: number }>();
  private inflight = new Map<number, { key: number; cx: number; cy: number; stale: boolean }>();
  private inflightKey = new Map<number, number>();
  private done: BuiltChunk[] = [];
  private nextId = 1;
  private frame = 0;
  private fx = 0;
  private fy = 0;
  private started: number;
  /** For the ?perf readout: chunks built, and the worker's own time for the last one (ms). */
  builtN = 0; lastMs = 0;

  constructor(spawn: () => WorkerLike, init: ChunkInit, private opts: { maxInFlight?: number; startTimeoutMs?: number; now?: () => number } = {}) {
    this.started = this.now();
    try {
      this.worker = spawn();
      this.worker.onmessage = e => this.onMessage(e.data);
      this.worker.onerror = e => this.fail(e instanceof Error ? e.message : 'worker error');
      this.worker.postMessage({ t: 'init', ...init }, [init.table.buffer]);
    } catch (e) {
      this.worker = { postMessage() {}, onmessage: null, onerror: null, terminate() {} };
      this.fail(e instanceof Error ? e.message : 'could not start the worker');
    }
  }
  private now() { return this.opts.now ? this.opts.now() : performance.now(); }

  /** Is the worker building chunks (the map should ask it, not build itself)? While it is still starting the map waits. */
  get active() { return this.state === 'ready'; }
  get waiting() { return this.state === 'starting'; }
  get busy() { return this.inflight.size + this.queue.size; }

  /** A change made to the main thread's world (see `World.record`). */
  push(op: WorldOp) { if (this.state !== 'failed') this.pending.push(op); }

  /** Ask for a chunk (every frame it is still wanted: asking again is free, a chunk not asked for lately is forgotten). */
  request(cx: number, cy: number) {
    if (this.state === 'failed') return;
    const key = tileKey(cx, cy), q = this.queue.get(key);
    if (this.inflightKey.has(key) || this.done.some(d => d.key === key)) return;   // (with the worker, or built and waiting to be taken by the next `tick`: asking again would build it twice)
    if (q) { q.seen = this.frame; return; }
    this.queue.set(key, { cx, cy, seen: this.frame });
  }

  /** The ground of this chunk changed on the page: a build under way will be out of date. */
  noteDirty(key: number) {
    const id = this.inflightKey.get(key); if (id === undefined) return;
    const j = this.inflight.get(id); if (j) j.stale = true;
  }

  /** Once a frame: `x, y` is where the plane is (what is nearest is built first). Sends changes and new requests; gives back what has been built since. */
  tick(x: number, y: number): BuiltChunk[] {
    this.frame++; this.fx = x; this.fy = y;
    if (this.state === 'starting' && this.now() - this.started > (this.opts.startTimeoutMs ?? 4000)) this.fail('the worker did not start in time');
    if (this.state === 'ready') this.dispatch();
    const out = this.done; this.done = [];
    return out;
  }

  private dispatch() {
    if (this.pending.length) this.worker.postMessage({ t: 'ops', ops: this.pending.splice(0) });
    const room = (this.opts.maxInFlight ?? 2) - this.inflight.size;
    if (room <= 0 || !this.queue.size) return;
    const list: { key: number; cx: number; cy: number }[] = [];
    for (const [key, q] of this.queue) {
      if (q.seen < this.frame - 2) { this.queue.delete(key); continue; }   // (not asked for lately: the plane has moved on)
      if (!this.inflightKey.has(key)) list.push({ key, cx: q.cx, cy: q.cy });
    }
    list.sort((a, b) => Math.hypot((a.cx + 0.5) * CHUNK - this.fx, (a.cy + 0.5) * CHUNK - this.fy) - Math.hypot((b.cx + 0.5) * CHUNK - this.fx, (b.cy + 0.5) * CHUNK - this.fy));
    for (const c of list.slice(0, room)) {
      const id = this.nextId++;
      this.queue.delete(c.key);
      this.inflight.set(id, { key: c.key, cx: c.cx, cy: c.cy, stale: false }); this.inflightKey.set(c.key, id);
      this.worker.postMessage({ t: 'build', id, cx: c.cx, cy: c.cy });
    }
  }

  private onMessage(m: FromWorker) {
    if (m.t === 'ready') { if (this.state === 'starting') this.state = 'ready'; return; }
    if (m.t === 'error') { this.fail(m.message); return; }
    const j = this.inflight.get(m.id);
    if (!j) return;
    this.inflight.delete(m.id); this.inflightKey.delete(j.key);
    this.builtN++; this.lastMs = m.ms;
    this.done.push({ key: j.key, cx: j.cx, cy: j.cy, px: m.px, decos: decodeDecos(m.decos), stale: j.stale, ms: m.ms });
  }

  private fail(why: string) {
    if (this.state === 'failed') return;
    this.state = 'failed'; this.failure = why;
    this.queue.clear(); this.inflight.clear(); this.inflightKey.clear(); this.pending = [];
    try { this.worker.terminate(); } catch { /* already gone */ }
  }

  terminate() { this.fail('closed'); }
}
