/**
 * The chunk worker's brain, free of anything a page or a worker scope provides, so it can be run in-process by the tests: `chunk.worker.ts` only wires it to `self`.
 * It holds its own copy of the world's ground (the same seed and kind, with the main thread's later changes replayed on it in the order they happened) and builds chunk
 * pictures on request, one at a time, between messages. See chunkclient.ts for the other end.
 */
import { World, type TileState, type WorldOp } from '../domain/worldgen';
import type { WorldKind } from '../domain/lakedistrict';
import { blocksFromTable, buildChunk, encodeDecos, type BlockOf } from '../domain/chunkbuild';

export type ToWorker =
  | { t: 'init'; seed: number; kind: WorldKind; changes: [number, TileState][]; table: Uint8ClampedArray; ops: WorldOp[] }
  | { t: 'ops'; ops: WorldOp[] }
  | { t: 'build'; id: number; cx: number; cy: number };
export type FromWorker =
  | { t: 'ready' }
  | { t: 'built'; id: number; cx: number; cy: number; px: Uint8ClampedArray; decos: Float64Array; ms: number }
  | { t: 'error'; message: string; id?: number };

export class ChunkHost {
  private world: World | null = null;
  private blocks: BlockOf | null = null;
  private queue: { id: number; cx: number; cy: number }[] = [];
  private pumping = false;

  /** `post` sends a message to the page (with what to transfer); `schedule` runs a function in a later turn (so messages that arrive meanwhile are handled first). */
  constructor(private post: (m: FromWorker, transfer: Transferable[]) => void, private schedule: (fn: () => void) => void = fn => { setTimeout(fn, 0); }) {}

  message(m: ToWorker) {
    try {
      if (m.t === 'init') {
        this.world = new World(m.seed, m.changes, m.kind);
        this.blocks = blocksFromTable(m.table);
        for (const op of m.ops) this.world.apply(op);
        this.post({ t: 'ready' }, []);
      } else if (m.t === 'ops') {
        if (!this.world) throw new Error('changes before init');
        for (const op of m.ops) this.world.apply(op);
      } else {
        this.queue.push({ id: m.id, cx: m.cx, cy: m.cy });
        this.pump();
      }
    } catch (e) { this.post({ t: 'error', message: e instanceof Error ? e.message : String(e) }, []); }
  }

  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    this.schedule(() => {
      this.pumping = false;
      const job = this.queue.shift();
      if (!job) return;
      try {
        if (!this.world || !this.blocks) throw new Error('build before init');
        const t0 = performance.now(), { px, decos } = buildChunk(this.world, this.blocks, null, job.cx, job.cy);
        this.post({ t: 'built', id: job.id, cx: job.cx, cy: job.cy, px, decos: encodeDecos(decos), ms: performance.now() - t0 }, [px.buffer]);
      } catch (e) { this.post({ t: 'error', message: e instanceof Error ? e.message : String(e), id: job.id }, []); }
      if (this.queue.length) this.pump();
    });
  }
}
