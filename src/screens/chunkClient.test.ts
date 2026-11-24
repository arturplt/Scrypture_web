import { describe, expect, it } from 'vitest';
import { ChunkClient, type WorkerLike } from './chunkClient';
import { ChunkHost, type FromWorker, type ToWorker } from '../workers/chunkHost';
import { BLOCK_BYTES, BLOCK_TABLE_BYTES, SHEET_COLS, SHEET_ROWS, blockIndex, blocksFromTable, buildChunk, type Deco } from '../domain/chunkbuild';
import { World, WATER, tileKey, type WorldOp } from '../domain/worldgen';

const table = () => {
  const t = new Uint8ClampedArray(BLOCK_TABLE_BYTES);
  for (let row = 0; row < SHEET_ROWS; row++) for (let col = 0; col < SHEET_COLS; col++) {
    const o = blockIndex(col, row, false) * BLOCK_BYTES;
    for (let p = 0; p < BLOCK_BYTES; p += 4) { t[o + p] = col * 16; t[o + p + 1] = row * 16; t[o + p + 2] = 77; t[o + p + 3] = 255; }
  }
  return t;
};
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/** A worker that is the real `ChunkHost` run in this process: messages arrive in a later turn, like a real worker's. `crash` makes it fail. */
function loopback(opts: { crash?: boolean; silent?: boolean } = {}): WorkerLike & { log: ToWorker[] } {
  const w: WorkerLike & { log: ToWorker[] } = { log: [], onmessage: null, onerror: null, terminate() {}, postMessage(m) {
    w.log.push(m);
    if (opts.silent) return;
    if (opts.crash && m.t === 'build') { setTimeout(() => w.onmessage?.({ data: { t: 'error', message: 'boom', id: m.id } }), 0); return; }
    setTimeout(() => host.message(m), 0);
  } };
  const host = new ChunkHost((m: FromWorker) => { setTimeout(() => w.onmessage?.({ data: m }), 0); }, fn => { setTimeout(fn, 0); });
  return w;
}
const wait = (ms = 5) => new Promise(r => setTimeout(r, ms));
async function until<T>(f: () => T | undefined | false, ms = 2000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = f(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error('timed out'); await wait(); }
}
const init = (kind: 'procedural' | 'terraced' = 'terraced', ops: WorldOp[] = []) => ({ seed: 9, kind, changes: [], table: table(), ops });

describe('the chunk client and host', () => {
  it('builds what the page would build itself, nearest chunk first, two at a time', async () => {
    const w = loopback(), c = new ChunkClient(() => w, init());
    await until(() => (c.tick(0, 0), c.active));
    for (const [cx, cy] of [[6, 0], [1, 0], [-2, 3], [0, 0]]) c.request(cx, cy);
    const got = new Map<number, ReturnType<ChunkClient['tick']>[number]>();
    const want = [[6, 0], [1, 0], [-2, 3], [0, 0]];
    await until(() => { for (const [cx, cy] of want) if (!got.has(tileKey(cx, cy))) c.request(cx, cy); for (const b of c.tick(0, 0)) got.set(b.key, b); return got.size === 4; });
    const builds = w.log.filter(m => m.t === 'build') as { id: number; cx: number }[];
    expect(builds[0].cx).toBe(0);                              // (the one under the plane first)
    expect(builds.length).toBe(4);
    const direct = new World(9, undefined, 'terraced'), blocks = blocksFromTable(table());
    for (const [cx, cy] of [[6, 0], [1, 0], [-2, 3], [0, 0]]) {
      const b = got.get(tileKey(cx, cy))!, want = buildChunk(direct, blocks, null, cx, cy);
      expect(same(b.px, want.px), `${cx},${cy}`).toBe(true);
      expect(b.decos).toEqual(want.decos as Deco[]);
      expect(b.stale).toBe(false);
    }
    c.terminate();
  });

  it('builds from the ground the page has: changes sent before a build are in it, in order', async () => {
    const ops: WorldOp[] = [];
    const main = new World(9, undefined, 'terraced'); main.record(op => ops.push(op));
    main.set(3, 3, { t: WATER, v: 0, d: 0, s: 1 });
    main.sculpt([[20, 20], [21, 20]], 1);
    const w = loopback(), c = new ChunkClient(() => w, init('terraced', ops.splice(0)));
    main.record(op => c.push(op));
    await until(() => (c.tick(0, 0), c.active));
    main.set(5, 5, { t: WATER, v: 0, d: 0, s: 1 });             // after the worker started: goes with the next tick
    main.setTerrain(6, 5, WATER);
    c.request(0, 0); c.request(1, 1);
    const got: ReturnType<ChunkClient['tick']> = [];
    await until(() => { if (!got.some(b => b.cx === 0)) c.request(0, 0); if (!got.some(b => b.cx === 1)) c.request(1, 1); got.push(...c.tick(0, 0)); return got.length >= 2; });
    const blocks = blocksFromTable(table());
    for (const b of got) expect(same(b.px, buildChunk(main, blocks, null, b.cx, b.cy).px), `${b.cx},${b.cy}`).toBe(true);
    c.terminate();
  });

  it('starts from a snapshot of the page\'s ground as well as from the history of its changes', async () => {
    const main = new World(9, undefined, 'terraced');
    main.set(3, 3, { t: WATER, v: 0, d: 0, s: 1 });
    main.sculpt([[20, 20], [21, 20], [20, 21]], 2);
    main.field!.setFill([[6, 6], [7, 6], [6, 7]], 1, 2, 0);
    main.field!.setFill([[9, 9]], 1, 2, 1);
    const snap = main.snapshot();
    const w = loopback(), c = new ChunkClient(() => w, { seed: 9, kind: 'terraced', changes: snap.changes, table: table(), ops: snap.ops });
    await until(() => (c.tick(0, 0), c.active));
    const got: ReturnType<ChunkClient['tick']> = [];
    await until(() => { for (const [cx, cy] of [[0, 0], [1, 1]]) if (!got.some(b => b.cx === cx)) c.request(cx, cy); got.push(...c.tick(0, 0)); return got.length >= 2; });
    const blocks = blocksFromTable(table());
    for (const b of got) expect(same(b.px, buildChunk(main, blocks, null, b.cx, b.cy).px), `${b.cx},${b.cy}`).toBe(true);
    c.terminate();
  });

  it('marks a chunk built while the ground under it changed as stale, and not one that was not', async () => {
    const w = loopback(), c = new ChunkClient(() => w, init('procedural'));
    await until(() => (c.tick(0, 0), c.active));
    c.request(0, 0); c.request(5, 5);
    c.tick(0, 0);                                                // both are with the worker now
    c.noteDirty(tileKey(0, 0));
    const got = new Map<number, boolean>();
    await until(() => { for (const b of c.tick(0, 0)) got.set(b.key, b.stale); return got.size === 2; });
    expect(got.get(tileKey(0, 0))).toBe(true);
    expect(got.get(tileKey(5, 5))).toBe(false);
    c.terminate();
  });

  it('forgets chunks nobody asks for any more', async () => {
    const w = loopback(), c = new ChunkClient(() => w, init('procedural'), { maxInFlight: 1 });
    await until(() => (c.tick(0, 0), c.active));
    for (let i = 0; i < 6; i++) c.request(i, 0);
    for (let i = 0; i < 6; i++) c.tick(0, 0);                    // (nothing asks again)
    await wait(30);
    for (let i = 0; i < 4; i++) { c.tick(0, 0); await wait(5); }
    expect(w.log.filter(m => m.t === 'build').length).toBeLessThan(6);
    c.terminate();
  });

  it('fails over, so the page builds for itself, when the worker errors or never answers', async () => {
    const a = new ChunkClient(() => loopback({ crash: true }), init('procedural'));
    await until(() => (a.tick(0, 0), a.active));
    a.request(0, 0);
    await until(() => (a.tick(0, 0), a.state === 'failed'));
    expect(a.active).toBe(false);
    const quiet = new ChunkClient(() => loopback({ silent: true }), init('procedural'), { startTimeoutMs: 20 });
    expect(quiet.waiting).toBe(true);
    await wait(40);
    quiet.tick(0, 0);
    expect(quiet.state).toBe('failed');
    const none = new ChunkClient(() => { throw new Error('no workers here'); }, init('procedural'));
    expect(none.state).toBe('failed');
    expect(none.failure).toContain('no workers');
  });
});
