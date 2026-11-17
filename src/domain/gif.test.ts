import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { decodeGif, encodeGif, isGif, type GifFrame } from './gif';
import { borderColor, removeBackground, sheetFrames, exportFileName } from './pixelite';

const frame = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number], delay = 100): GifFrame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { data, delay };
};

describe('gif', () => {
  it('round-trips frames, delays and transparency', () => {
    const a = frame(5, 4, (x, y) => (x === y ? [255, 0, 0, 255] : [0, 0, 0, 0]), 60);
    const b = frame(5, 4, (x) => [x * 40, 20, 200, 255], 140);
    const g = decodeGif(encodeGif(5, 4, [a, b]));
    expect(g.width).toBe(5); expect(g.frames.length).toBe(2);
    expect(g.frames.map(f => f.delay)).toEqual([60, 140]);
    expect([...g.frames[0].data]).toEqual([...a.data]);
    expect([...g.frames[1].data]).toEqual([...b.data]);
  });
  it('writes a file other decoders read, even with many colours', async () => {
    const big = frame(40, 40, (x, y) => [x * 6, y * 6, (x * y) % 256, 255]);   // far over 256 colours
    const bytes = encodeGif(40, 40, [big, big]);
    expect(isGif(bytes)).toBe(true);
    const ext = await sharp(bytes, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    expect(ext.info.width).toBe(40);
    expect(ext.info.pages ?? ext.info.height / 40).toBe(2);
    const mine = decodeGif(bytes);
    let off = 0;
    for (let i = 0; i < 40 * 40; i++) off = Math.max(off, Math.abs(mine.frames[0].data[i * 4] - ext.data[i * ext.info.channels]));
    expect(off).toBeLessThan(2);
  });
  it('reads a gif made by another encoder', async () => {
    const raw = new Uint8Array(30 * 20 * 3);
    for (let i = 0; i < 30 * 20; i++) { raw[i * 3] = (i % 30) * 8; raw[i * 3 + 1] = 100; raw[i * 3 + 2] = i % 7 * 30; }
    const bytes = await sharp(raw, { raw: { width: 30, height: 20, channels: 3 } }).gif().toBuffer();
    const g = decodeGif(new Uint8Array(bytes));
    const ref = await sharp(bytes).raw().ensureAlpha().toBuffer();
    expect(g.frames.length).toBe(1);
    expect([...g.frames[0].data]).toEqual([...ref]);
  });
  it('refuses things that are not gifs', () => { expect(() => decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(); });
});

describe('remove background', () => {
  const sq = (): Uint8ClampedArray => frame(5, 5, (x, y) => {
    if (x === 2 && y === 2) return [255, 255, 255, 255];     // white inside the subject
    return x >= 1 && x <= 3 && y >= 1 && y <= 3 ? [200, 0, 0, 255] : [255, 255, 255, 255];
  }).data;
  it('finds the border colour', () => { expect(borderColor(sq(), 5, 5)).toEqual({ r: 255, g: 255, b: 255 }); });
  it('contiguous leaves matching colour inside the subject', () => {
    const d = sq(); const n = removeBackground(d, 5, 5, { r: 255, g: 255, b: 255 }, 5, true);
    expect(n).toBe(16); expect(d[3]).toBe(0); expect(d[(2 * 5 + 2) * 4 + 3]).toBe(255);
  });
  it('global removes it everywhere; tolerance widens the match', () => {
    const d = sq(); expect(removeBackground(d, 5, 5, { r: 255, g: 255, b: 255 }, 5, false)).toBe(17);
    const e = sq(); expect(removeBackground(e, 5, 5, { r: 250, g: 250, b: 250 }, 0, false)).toBe(0);
    expect(removeBackground(e, 5, 5, { r: 250, g: 250, b: 250 }, 5, false)).toBe(17);
  });
});

describe('export helpers', () => {
  it('lays frames in a row', () => {
    const a = new Uint8ClampedArray([1, 1, 1, 1, 2, 2, 2, 2]), b = new Uint8ClampedArray([3, 3, 3, 3, 4, 4, 4, 4]);   // 1x2 each
    expect([...sheetFrames([a, b], 1, 2)]).toEqual([1, 1, 1, 1, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4]);
  });
  it('names files by format', () => {
    expect(exportFileName(32, 32, 'cat.gif', 'gif')).toBe('pixelite-32x32-cat.gif');
    expect(exportFileName(32, 32, 'cat.gif', 'sheet')).toBe('pixelite-32x32-cat-sheet.png');
  });
});

import { crc32, makeZip } from './zip';
import { frameFileNames } from './pixelite';
describe('zip', () => {
  it('writes a readable archive of stored files', () => {
    const a = new TextEncoder().encode('hello'), b = new Uint8Array([1, 2, 3, 4]);
    const z = makeZip([{ name: 'a-001.png', data: a }, { name: 'a-002.png', data: b }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(2);      // entries
    expect(v.getUint32(14, true)).toBe(crc32(a));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);   // the standard check value
  });
  it('numbers frame files in sorting order', () => {
    expect(frameFileNames('cat.gif', 3)).toEqual(['cat-001.png', 'cat-002.png', 'cat-003.png']);
    expect(frameFileNames('x.png', 1000)[999]).toBe('x-1000.png');
  });
});
