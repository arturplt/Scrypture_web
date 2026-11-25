import { describe, expect, it } from 'vitest';
import { BLOCK_BYTES, BLOCK_TABLE_BYTES, CPX, SHEET_COLS, SHEET_ROWS, blockIndex, blocksFromTable, buildChunk, chunkPixels, decodeDecos, encodeDecos, meshSig, sameBytes, sameDecos } from './chunkbuild';
import { CHUNK, SHEET, TILE_PX, World, SAND } from './worldgen';
import { terraceChunkMesh } from './terrace';

/** A block table whose every block is one flat colour that says which cell (and whether road) it is. */
function table(): Uint8ClampedArray {
  const t = new Uint8ClampedArray(BLOCK_TABLE_BYTES);
  for (let row = 0; row < SHEET_ROWS; row++) for (let col = 0; col < SHEET_COLS; col++) for (const road of [false, true]) {
    const o = blockIndex(col, row, road) * BLOCK_BYTES;
    for (let p = 0; p < BLOCK_BYTES; p += 4) { t[o + p] = col * 16; t[o + p + 1] = row * 16; t[o + p + 2] = road ? 200 : 50; t[o + p + 3] = 255; }
  }
  return t;
}

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/** The slow, tile-by-tile way: what the chunk should look like. */
function reference(w: World, cx: number, cy: number, roadAt: ((x: number, y: number) => boolean) | null) {
  const px = new Uint8ClampedArray(CPX * CPX * 4), decos: { x: number; y: number; cell: readonly [number, number]; scale: number }[] = [];
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const x = cx * CHUNK + i, y = cy * CHUNK + j, d = w.drawn(x, y), road = !!roadAt && w.terrainAt(x, y) === SAND && roadAt(x, y);
    for (let r = 0; r < TILE_PX; r++) for (let c = 0; c < TILE_PX; c++) {
      const o = ((j * TILE_PX + r) * CPX + i * TILE_PX + c) * 4;
      px[o] = d.ground[0] * 16; px[o + 1] = d.ground[1] * 16; px[o + 2] = road ? 200 : 50; px[o + 3] = w.field ? 255 - (w.naturalLayerAt(x, y) & 15) : 255;
    }
    if (d.deco) decos.push({ x, y, cell: d.deco, scale: d.scale });
  }
  return { px, decos };
}

describe('chunkPixels', () => {
  const blocks = blocksFromTable(table());
  it('lays each tile\'s block where the tile is and lists the decorations, the same as drawing tile by tile', () => {
    for (const [seed, kind] of [[77, 'procedural'], [5, 'terraced']] as const) {
      const w = new World(seed, undefined, kind);
      for (const [cx, cy] of [[0, 0], [-3, 2], [9, -7]]) {
        const got = buildChunk(w, blocks, null, cx, cy), want = reference(w, cx, cy, null);
        expect(same(got.px, want.px), `${kind} ${cx},${cy} pixels`).toBe(true);
        expect(got.decos).toEqual(want.decos);
      }
    }
  });
  it('sees the changes laid over the ground, and a road variant where the road lookup says so', () => {
    const w = new World(77);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) w.setTerrain(x, y, (x + y) % 3 as 0 | 1 | 2);
    const road = (x: number) => x % 2 === 0;
    const got = buildChunk(w, blocks, (x) => road(x), 0, 0), want = reference(w, 0, 0, (x) => road(x));
    expect(same(got.px, want.px)).toBe(true);
    expect(got.decos).toEqual(want.decos);
  });
  it('yields between slices and builds into the array it is given', () => {
    const w = new World(5, undefined, 'terraced'), px = new Uint8ClampedArray(CPX * CPX * 4);
    let slices = 0;
    const gen = chunkPixels(w, blocks, null, 4, 4, px);
    for (let r = gen.next(); !r.done; r = gen.next()) slices++;
    expect(slices).toBeGreaterThan(3);
    expect(px.some(v => v !== 0)).toBe(true);
  });
});

describe('decorations across a clone', () => {
  it('come back on the shared cell constants, which the renderer compares by identity', () => {
    const decos = [{ x: 3, y: -4, cell: SHEET.bush, scale: 2 }, { x: 10, y: 11, cell: SHEET.conifer, scale: 1.5 }, { x: -1, y: 0, cell: SHEET.deciduous, scale: 3 }];
    const back = decodeDecos(encodeDecos(decos));
    expect(back).toEqual(decos);
    expect(back[0].cell === SHEET.bush && back[1].cell === SHEET.conifer && back[2].cell === SHEET.deciduous).toBe(true);
  });
  it('refuses a cell that is not on the sheet table instead of drawing the wrong tree', () => {
    expect(() => encodeDecos([{ x: 0, y: 0, cell: [9, 9], scale: 1 }])).toThrow();
  });
});

describe('telling whether a rebuilt chunk is any different', () => {
  const blocks = blocksFromTable(table());
  it('sees one changed pixel, and the same picture built twice', () => {
    const w = new World(5, undefined, 'terraced');
    const a = buildChunk(w, blocks, null, 2, 2), b = buildChunk(w, blocks, null, 2, 2);
    expect(sameBytes(a.px, b.px)).toBe(true);
    expect(sameDecos(a.decos, b.decos)).toBe(true);
    b.px[b.px.length - 3] ^= 1;
    expect(sameBytes(a.px, b.px)).toBe(false);
    expect(sameBytes(a.px, a.px.subarray(4))).toBe(false);
  });
  it('sees a decoration that moved, changed scale or kind', () => {
    const d = [{ x: 1, y: 2, cell: SHEET.bush, scale: 2 }];
    expect(sameDecos(d, [{ x: 1, y: 2, cell: SHEET.bush, scale: 2 }])).toBe(true);
    expect(sameDecos(d, [{ x: 2, y: 2, cell: SHEET.bush, scale: 2 }])).toBe(false);
    expect(sameDecos(d, [{ x: 1, y: 2, cell: SHEET.conifer, scale: 2 }])).toBe(false);
    expect(sameDecos(d, [{ x: 1, y: 2, cell: SHEET.bush, scale: 3 }])).toBe(false);
    expect(sameDecos(d, [])).toBe(false);
  });
  it('fingerprints a hill mesh: the same ground the same, water laid over it different', () => {
    const w = new World(9, undefined, 'terraced'), f = w.field!;
    const mesh = () => terraceChunkMesh(f.grid(0, 0).e, 0, 0, (x, y) => f.waterSheetAt(x, y), (x, y) => f.heightAt(x, y));
    const before = meshSig(mesh());
    expect(meshSig(mesh())).toBe(before);
    f.setFill([[5, 5], [6, 5], [5, 6], [6, 6]], 1, 2, 0);
    expect(meshSig(mesh())).not.toBe(before);
  });
});
