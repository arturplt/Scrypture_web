import { describe, expect, it } from 'vitest';
import { ChunkClient, type WorkerLike } from './chunkClient';
import { ChunkHost, type FromWorker, type ToWorker } from '../workers/chunkHost';
import { BLOCK_BYTES, BLOCK_TABLE_BYTES, SHEET_COLS, SHEET_ROWS, blockIndex, blocksFromTable, buildChunk } from '../domain/chunkbuild';
import { Ecosystem } from '../domain/ecosystem';
import { World } from '../domain/worldgen';
import { terraceChunkMesh, terraceSpawn } from '../domain/terrace';
import { mulberry32 } from '../domain/sanctuary';

const table = () => {
  const t = new Uint8ClampedArray(BLOCK_TABLE_BYTES);
  for (let row = 0; row < SHEET_ROWS; row++) for (let col = 0; col < SHEET_COLS; col++) {
    const o = blockIndex(col, row, false) * BLOCK_BYTES;
    for (let p = 0; p < BLOCK_BYTES; p += 4) { t[o + p] = col * 16; t[o + p + 1] = row * 16; t[o + p + 2] = 77; t[o + p + 3] = 255; }
  }
  return t;
};
const wait = (ms = 3) => new Promise(r => setTimeout(r, ms));

function loopback(): WorkerLike {
  const w: WorkerLike = { onmessage: null, onerror: null, terminate() {}, postMessage(m) { setTimeout(() => host.message(m as ToWorker), 0); } };
  const host = new ChunkHost((m: FromWorker) => { setTimeout(() => w.onmessage?.({ data: m }), 0); }, fn => { setTimeout(fn, 0); });
  return w;
}

/** The same order as the game: the world and its weather first, then the worker from a snapshot, then every later change is passed on. */
describe('the worker\'s copy of the ground stays the page\'s, while the weather works on it', () => {
  for (const seed of [7, 11, 5]) it(`seed ${seed}: chunks built after floods, streams and ponds are exactly the page's`, async () => {
    const w = new World(seed, undefined, 'terraced'), sp = terraceSpawn(seed), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 });
    e.setWatchedArea(sp.x - 60, sp.y - 60, sp.x + 60, sp.y + 60); e.step(0.1);
    (e as any).importCloud = () => {}; (e as any).spawnCloud = () => {}; e.clouds.length = 0;
    const snap = w.snapshot();
    const c = new ChunkClient(() => loopback(), { seed, kind: 'terraced', changes: snap.changes, table: table(), ops: snap.ops }, { epoch: () => w.field!.epoch });
    c.wantMesh = true;
    w.record(op => c.push(op));
    while (!c.active) { c.tick(0, 0); await wait(); }
    const packets = () => (e as any).packets as { x: number; y: number; n: number }[];
    const blocks = blocksFromTable(table());
    const cx0 = Math.floor(sp.x / 16), cy0 = Math.floor(sp.y / 16);
    let compared = 0, ops = 0;
    for (let round = 0; round < 4; round++) {
      for (let t = 0; t < 120; t += 0.5) {   // two minutes of weather: rain packets, becks, floods
        if (packets().length < 8) for (let i = 0; i < 4; i++) packets().push({ x: sp.x + i * 3 - 6, y: sp.y + 12 + round * 5, n: 0 });
        e.step(0.5);
      }
      // (nothing changes from here until the chunks are back: what the worker built must be what the page builds now)
      const want: [number, number][] = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) want.push([cx0 + dx, cy0 + dy]);
      const got = new Map<string, ReturnType<ChunkClient['tick']>[number]>();
      for (let spin = 0; got.size < want.length && spin < 4000; spin++) {
        for (const [cx, cy] of want) if (!got.has(`${cx},${cy}`)) c.request(cx, cy);
        for (const b of c.tick(sp.x, sp.y)) got.set(`${b.cx},${b.cy}`, b);
        await wait(1);
      }
      expect(got.size).toBe(want.length);
      const fld = w.field!;
      for (const [cx, cy] of want) {
        const b = got.get(`${cx},${cy}`)!, direct = buildChunk(w, blocks, null, cx, cy);
        const same = (a: ArrayLike<number>, d: ArrayLike<number>) => { if (a.length !== d.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== d[i]) return false; return true; };
        expect(same(b.px, direct.px), `round ${round} chunk ${cx},${cy} pixels`).toBe(true);
        const m = terraceChunkMesh(fld.grid(cx, cy).e, cx, cy, (x, y) => fld.waterSheetAt(x, y), (x, y) => fld.heightAt(x, y));
        for (const k of ['pos', 'nrm', 'idx', 'sub', 'wpos', 'widx', 'wkind'] as const) expect(same(b.mesh![k], m[k]), `round ${round} chunk ${cx},${cy} mesh ${k}`).toBe(true);
        expect(same(b.grid!.e, fld.grid(cx, cy).e), `round ${round} chunk ${cx},${cy} grid`).toBe(true);
        compared++;
      }
      ops += w.changes.size;
    }
    expect(compared).toBe(4 * 49);
    expect(ops).toBeGreaterThan(0);   // (the weather really changed the ground)
    c.terminate();
  }, 120000);
});
