import { describe, expect, it } from 'vitest';
import { detectGridSize, detectOutputSize, exportName, extractPalette, outputDims, sampleGrid, shadeWithPalette, snapOutput, alphaCleanup, cleanStray, medianDenoise, sharpen } from './pixelite';

const px = (...cells: number[][]) => new Uint8ClampedArray(cells.flat());

describe('pixelite', () => {
  it('detects grid and output size', () => {
    expect(detectGridSize(32, 100)).toBe(1);
    expect(detectGridSize(640, 1000)).toBe(10);
    expect(detectOutputSize(1000, 400)).toBe('128x64');
    expect(detectOutputSize(400, 1000)).toBe('64x128');
    expect(detectOutputSize(500, 500)).toBe('64x64');
  });
  it('resolves output dimensions', () => {
    expect(outputDims('64x128', 1, 1)).toEqual({ width: 64, height: 128 });
    expect(outputDims('512x256', 1, 1)).toEqual({ width: 512, height: 256 });
    expect(outputDims('custom', 0, 9999)).toEqual({ width: 1, height: 9999 });
    expect(snapOutput(100, 50, 10, 5, 0)).toEqual({ width: 9, height: 5 });
    expect(outputDims('snap', 1, 1, { width: 9, height: 5 })).toEqual({ width: 9, height: 5 });
  });
  it('averages each grid cell', () => {
    // 2x1 image: black and white, one 2-wide cell -> mid grey
    const out = sampleGrid(px([0, 0, 0, 255], [200, 100, 50, 255]), 2, 1, 2, 0, 0, 1, 1);
    expect([...out]).toEqual([100, 50, 25, 255]);
  });
  it('leaves cells outside the image transparent', () => {
    const out = sampleGrid(px([10, 10, 10, 255]), 1, 1, 1, 0, 0, 2, 1);
    expect([...out]).toEqual([10, 10, 10, 255, 0, 0, 0, 0]);
  });
  it('builds a palette ordered by frequency and snaps to it', () => {
    const data = new Uint8ClampedArray(16 * 4 * 3);
    for (let i = 0; i < data.length; i += 4) { const red = i < 16 * 4 * 2; data.set(red ? [255, 0, 0, 255] : [0, 0, 255, 255], i); }
    const palette = extractPalette(data);
    expect(palette[0]).toEqual({ r: 255, g: 0, b: 0 });
    const out = px([250, 10, 10, 255], [10, 10, 240, 255]);
    shadeWithPalette(out, palette, 50);
    expect([...out]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
  it('names the export file', () => {
    expect(exportName(64, 32, 'cat.photo.jpg')).toBe('pixelite-64x32-cat.photo.png');
  });
});

import { defaultCuts, detectContentBounds, resampleBox, sliceFrame } from './pixelite';
describe('frame 9-slice', () => {
  it('averages a box and keeps alpha', () => {
    const s = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);   // 2x2: red, blue / clear, clear
    expect(Array.from(resampleBox(s, 2, 0, 0, 2, 2, 1, 1))).toEqual([128, 0, 128, 128]);
    expect(Array.from(resampleBox(s, 2, 0, 0, 2, 1, 2, 1))).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
  it('finds the content inside a plain background', () => {
    const d = new Uint8ClampedArray(6 * 6 * 4).fill(255);
    for (const [x, y] of [[2, 1], [3, 4]]) { const i = (y * 6 + x) * 4; d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
    expect(detectContentBounds(d, 6, 6)).toEqual({ l: 2, t: 1, r: 4, b: 5 });
    expect(defaultCuts({ l: 0, t: 0, r: 100, b: 50 })).toEqual({ l: 12, t: 6, r: 88, b: 44 });
  });
  it('lays a 50x50 output with 1px spare and sized corners', () => {
    const W = 30, src = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; src[i] = x < 10 ? 255 : 0; src[i + 1] = y < 10 ? 255 : 0; src[i + 3] = 255; }
    const b = { l: 0, t: 0, r: W, b: W }, out = sliceFrame(src, W, b, { l: 10, t: 10, r: 20, b: 20 }, 50, 50, 1, 8);
    const at = (x: number, y: number) => Array.from(out.subarray((y * 50 + x) * 4, (y * 50 + x) * 4 + 4));
    expect(at(0, 0)[3]).toBe(0); expect(at(49, 25)[3]).toBe(0);                // spare ring is transparent
    expect(at(1, 1)).toEqual([255, 255, 0, 255]);                              // corner piece starts at 1,1
    expect(at(8, 8)).toEqual([255, 255, 0, 255]); expect(at(9, 9)).toEqual([0, 0, 0, 255]);   // corner is exactly 8px
    expect(at(48, 48)).toEqual([0, 0, 0, 255]);
  });
});

describe('scaling filters', () => {
  const RED = [220, 30, 30, 255], BLUE = [30, 30, 220, 255], CLEAR = [0, 0, 0, 0];
  // one 4x1 cell: three red pixels and one blue
  const cell = px(RED, RED, RED, BLUE);
  it('average blends, dominant keeps the majority colour, centre takes the middle', () => {
    const avg = sampleGrid(cell, 4, 1, 4, 0, 0, 1, 1, 'average');
    expect(avg[2]).toBeGreaterThan(30);   // some blue crept in
    expect([...sampleGrid(cell, 4, 1, 4, 0, 0, 1, 1, 'dominant')]).toEqual(RED);
    expect([...sampleGrid(cell, 4, 1, 4, 0, 0, 1, 1, 'median')]).toEqual(RED);
    expect([...sampleGrid(px(BLUE, BLUE, RED, RED), 4, 1, 4, 0, 0, 1, 1, 'centre')]).toEqual(RED);   // x = 2
  });
  it('average is weighted by alpha: no dark halo next to clear pixels', () => {
    const out = sampleGrid(px(RED, CLEAR), 2, 1, 2, 0, 0, 1, 1, 'average');
    expect([out[0], out[1], out[2]]).toEqual([220, 30, 30]);
    expect(out[3]).toBe(128);
  });
  it('dominant and median stay clear when the cell is mostly empty', () => {
    for (const m of ['dominant', 'median'] as const) expect([...sampleGrid(px(RED, CLEAR, CLEAR, CLEAR), 4, 1, 4, 0, 0, 1, 1, m)]).toEqual(CLEAR);
  });
  it('alpha cleanup snaps to solid or clear at the threshold, and 0 is off', () => {
    const d = px([1, 2, 3, 200], [1, 2, 3, 100], [1, 2, 3, 127]);
    alphaCleanup(d, 0); expect([d[3], d[7], d[11]]).toEqual([200, 100, 127]);
    alphaCleanup(d, 50);
    expect([d[3], d[7], d[11]]).toEqual([255, 0, 0]);
    expect([...d.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });
  it('clean stray: lone speck dropped, odd pixel recoloured, 2x2 block and holes handled', () => {
    const lone = new Uint8ClampedArray(5 * 5 * 4); lone.set(RED, (2 * 5 + 2) * 4);
    cleanStray(lone, 5, 5); expect(lone.every(v => v === 0)).toBe(true);
    const block = new Uint8ClampedArray(4 * 4 * 4);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) block.set(RED, (y * 4 + x) * 4);
    const before = [...block]; cleanStray(block, 4, 4); expect([...block]).toEqual(before);
    const field = new Uint8ClampedArray(3 * 3 * 4); for (let i = 0; i < 9; i++) field.set(BLUE, i * 4);
    field.set(RED, 4 * 4); cleanStray(field, 3, 3); expect([...field.subarray(16, 20)]).toEqual(BLUE);
    const ring = new Uint8ClampedArray(3 * 3 * 4); for (const i of [1, 3, 5, 7]) ring.set(BLUE, i * 4);
    cleanStray(ring, 3, 3); expect([...ring.subarray(16, 20)]).toEqual(BLUE);   // the hole in the middle is filled
  });
  it('median denoise removes a lone noisy pixel and leaves flat images alone; sharpen(0) is a no-op', () => {
    const flat = new Uint8ClampedArray(9 * 4); for (let i = 0; i < 9; i++) flat.set([50, 60, 70, 255], i * 4);
    expect([...medianDenoise(flat, 3, 3)]).toEqual([...flat]);
    const noisy = new Uint8ClampedArray(flat); noisy.set([255, 255, 255, 255], 16);
    expect([...medianDenoise(noisy, 3, 3).subarray(16, 20)]).toEqual([50, 60, 70, 255]);
    expect(sharpen(flat, 3, 3, 0)).toBe(flat);
    expect([...sharpen(flat, 3, 3, 100)]).toEqual([...flat]);   // nothing to sharpen
  });
  it('sharpen raises contrast across an edge', () => {
    const d = new Uint8ClampedArray(4 * 1 * 4); [60, 60, 200, 200].forEach((v, i) => d.set([v, v, v, 255], i * 4));
    const o = sharpen(d, 4, 1, 100);
    expect(o[4]).toBeLessThan(60); expect(o[8]).toBeGreaterThan(200);
  });
});
