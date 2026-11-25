/**
 * The chunk worker's brain, free of anything a page or a worker scope provides, so it can be run in-process by the tests: `chunk.worker.ts` only wires it to `self`.
 * It holds its own copy of the world's ground (the same seed and kind, with the main thread's later changes replayed on it in the order they happened) and builds chunk
 * pictures on request, one at a time, between messages. See chunkclient.ts for the other end.
 */
import { World, type TileState, type WorldOp } from '../domain/worldgen';
import { setCubeSize, cubeSize } from '../domain/cube';
import type { WorldKind } from '../domain/lakedistrict';
import { blocksFromTable, buildChunk, encodeDecos, type BlockOf } from '../domain/chunkbuild';
import { terraceChunkMesh, terraceFarMesh, type TerraceMesh } from '../domain/terrace';

export type ToWorker =
  | { t: 'init'; seed: number; kind: WorldKind; size?: number; changes: [number, TileState][]; table: Uint8ClampedArray; ops: WorldOp[] }
  | { t: 'ops'; ops: WorldOp[] }
  /** `mesh`: also cut the chunk's hill mesh (a terraced world: the work `WorldGL` would otherwise do on the page). */
  | { t: 'build'; id: number; cx: number; cy: number; mesh?: boolean }
  /** A far level of the terraced world's ground (a pure function of these numbers: no `init` needed, so a worker can be used for nothing else). */
  | { t: 'far'; id: number; seed: number; cx: number; cy: number; step: number; half: number; stepped: boolean; open: number; size?: number; up?: number; inset?: number };
export type FromWorker =
  | { t: 'ready' }
  | { t: 'built'; id: number; cx: number; cy: number; px: Uint8ClampedArray; decos: Float64Array; mesh?: TerraceMesh; /** the chunk's height grid (a terraced world), for the page to adopt */ grid?: { e: Float32Array; base?: Float32Array }; ms: number }
  | { t: 'far'; id: number; cols: number; rows: number; step: number; cx: number; cy: number; pos: Float32Array; col: Float32Array; aux?: Float32Array; ms: number }
  | { t: 'error'; message: string; id?: number };

export class ChunkHost {
  private world: World | null = null;
  private blocks: BlockOf | null = null;
  private queue: (({ kind: 'build'; mesh: boolean } | { kind: 'far'; seed: number; step: number; half: number; stepped: boolean; open: number; size: number; up: number; inset: number }) & { id: number; cx: number; cy: number })[] = [];
  private pumping = false;

  /** `post` sends a message to the page (with what to transfer); `schedule` runs a function in a later turn (so messages that arrive meanwhile are handled first). */
  constructor(private post: (m: FromWorker, transfer: Transferable[]) => void, private schedule: (fn: () => void) => void = fn => { setTimeout(fn, 0); }) {}

  message(m: ToWorker) {
    try {
      if (m.t === 'init') {
        this.world = new World(m.seed, m.changes, m.kind, null, m.size ?? 0);
        this.blocks = blocksFromTable(m.table);
        for (const op of m.ops) this.world.apply(op);
        this.post({ t: 'ready' }, []);
      } else if (m.t === 'ops') {
        if (!this.world) throw new Error('changes before init');
        for (const op of m.ops) this.world.apply(op);
      } else if (m.t === 'far') {
        this.queue.push({ kind: 'far', id: m.id, seed: m.seed, cx: m.cx, cy: m.cy, step: m.step, half: m.half, stepped: m.stepped, open: m.open, size: m.size ?? 0, up: m.up ?? 1, inset: m.inset ?? 0 });
        this.pump();
      } else {
        this.queue.push({ kind: 'build', mesh: !!m.mesh, id: m.id, cx: m.cx, cy: m.cy });
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
        const t0 = performance.now();
        if (job.kind === 'far') {
          const was = cubeSize(); setCubeSize(job.size);   // (a planet's far ground is its own field; the world this worker may hold keeps its size)
          let m: ReturnType<typeof terraceFarMesh> extends Generator<unknown, infer R, unknown> ? R : never;
          try { const g = terraceFarMesh(job.seed, job.cx, job.cy, job.step, job.half, job.stepped, job.open, job.up, job.inset); let r = g.next(); while (!r.done) r = g.next(); m = r.value; } finally { setCubeSize(was); }
          this.post({ t: 'far', id: job.id, cols: m.cols, rows: m.rows, step: m.step, cx: m.cx, cy: m.cy, pos: m.pos, col: m.col, aux: m.aux, ms: performance.now() - t0 }, m.aux ? [m.pos.buffer, m.col.buffer, m.aux.buffer] : [m.pos.buffer, m.col.buffer]);   // (the indices are a shared array the page makes itself: `farIndices`)
        } else {
          if (!this.world || !this.blocks) throw new Error('build before init');
          const { px, decos } = buildChunk(this.world, this.blocks, null, job.cx, job.cy), fld = this.world.field;
          // the hill mesh, from this worker's own copy of the field (the same grids, relief and water as the page's)
          const mesh = job.mesh && fld ? terraceChunkMesh(fld.grid(job.cx, job.cy).e, job.cx, job.cy, (x, y) => fld.waterSheetAt(x, y), (x, y) => fld.heightAt(x, y)) : undefined;
          const g = fld ? fld.grid(job.cx, job.cy) : undefined, grid = g ? { e: g.e.slice(), base: g.base?.slice() } : undefined;   // (copies: the worker keeps its own)
          const transfer: Transferable[] = [px.buffer];
          if (grid) { transfer.push(grid.e.buffer); if (grid.base) transfer.push(grid.base.buffer); }
          if (mesh) transfer.push(mesh.pos.buffer, mesh.nrm.buffer, mesh.idx.buffer, mesh.sub.buffer, mesh.wpos.buffer, mesh.widx.buffer, mesh.wkind.buffer);
          this.post({ t: 'built', id: job.id, cx: job.cx, cy: job.cy, px, decos: encodeDecos(decos), mesh, grid, ms: performance.now() - t0 }, transfer);
        }
      } catch (e) { this.post({ t: 'error', message: e instanceof Error ? e.message : String(e), id: job.id }, []); }
      if (this.queue.length) this.pump();
    });
  }
}
