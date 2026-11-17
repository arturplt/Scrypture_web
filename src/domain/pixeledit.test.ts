import type { Pixels } from './pixeledit';
import { describe, expect, it } from 'vitest';
import { makePixels, blit, clearRect, cloneData, extract, flip, floodFill, inRect, rectBetween } from './pixeledit';

const img = (w: number, h: number, fill: (x: number, y: number) => number[]) => {
  const d = makePixels(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.data.set(fill(x, y), (y * w + x) * 4);
  return d;
};
const px = (d: Pixels, x: number, y: number) => [...d.data.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4)];

describe('pixeledit', () => {
  it('builds a clamped selection rectangle', () => {
    expect(rectBetween({ x: 5, y: 2 }, { x: 1, y: 6 }, 48)).toEqual({ x: 1, y: 2, w: 5, h: 5 });
    expect(rectBetween({ x: -4, y: 40 }, { x: 60, y: 99 }, 48)).toEqual({ x: 0, y: 40, w: 48, h: 8 });
    expect(inRect({ x: 1, y: 1, w: 2, h: 2 }, 2, 2)).toBe(true);
    expect(inRect({ x: 1, y: 1, w: 2, h: 2 }, 3, 2)).toBe(false);
  });
  it('extracts, clears and blits regions', () => {
    const d = img(4, 4, (x, y) => [x, y, 0, 255]);
    const part = extract(d, { x: 1, y: 1, w: 2, h: 2 });
    expect(px(part, 0, 0)).toEqual([1, 1, 0, 255]);
    clearRect(d, { x: 1, y: 1, w: 2, h: 2 });
    expect(px(d, 1, 1)).toEqual([0, 0, 0, 0]);
    blit(d, part, 2, 2);
    expect(px(d, 2, 2)).toEqual([1, 1, 0, 255]);
    expect(px(d, 3, 3)).toEqual([2, 2, 0, 255]);
  });
  it('leaves what is underneath where the pasted pixel is transparent', () => {
    const d = img(2, 1, () => [9, 9, 9, 255]);
    const top = img(2, 1, x => (x === 0 ? [1, 2, 3, 255] : [0, 0, 0, 0]));
    blit(d, top, 0, 0);
    expect(px(d, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(px(d, 1, 0)).toEqual([9, 9, 9, 255]);
  });
  it('clips a blit that hangs over the edge', () => {
    const d = img(2, 2, () => [0, 0, 0, 0]);
    blit(d, img(2, 2, () => [5, 5, 5, 255]), 1, 1);
    expect(px(d, 1, 1)).toEqual([5, 5, 5, 255]);
    expect(px(d, 0, 0)).toEqual([0, 0, 0, 0]);
  });
  it('flips both ways', () => {
    const d = img(3, 2, (x, y) => [x, y, 0, 255]);
    expect(px(flip(d, true), 0, 0)).toEqual([2, 0, 0, 255]);
    expect(px(flip(d, false), 0, 0)).toEqual([0, 1, 0, 255]);
  });
  it('fills a connected area only', () => {
    // column 1 is a wall; filling the left side must not leak right
    const d = img(3, 2, x => (x === 1 ? [1, 1, 1, 255] : [0, 0, 0, 0]));
    expect(floodFill(d, 0, 0, [9, 9, 9, 255])).toBe(true);
    expect(px(d, 0, 1)).toEqual([9, 9, 9, 255]);
    expect(px(d, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(floodFill(d, 0, 0, [9, 9, 9, 255])).toBe(false);   // already that colour
  });
  it('clones independently', () => {
    const d = img(1, 1, () => [1, 2, 3, 4]);
    const c = cloneData(d); c.data[0] = 99;
    expect(d.data[0]).toBe(1);
  });
});

import { scalePixels } from './pixeledit';
describe('scalePixels', () => {
  it('grows with hard edges and shrinks by averaging', () => {
    const two = img(2, 1, x => (x ? [0, 0, 255, 255] : [255, 0, 0, 255]));
    const big = scalePixels(two, 4, 2);
    expect(big.width).toBe(4); expect(Array.from(big.data.slice(0, 4))).toEqual([255, 0, 0, 255]); expect(Array.from(big.data.slice(8, 12))).toEqual([0, 0, 255, 255]);
    const small = scalePixels(two, 1, 1);
    expect(Array.from(small.data)).toEqual([128, 0, 128, 255]);
  });
});

import { rotatePixels } from './pixeledit';
describe('rotatePixels', () => {
  it('turns 90 degrees clockwise exactly', () => {
    const a = img(2, 1, x => (x ? [0, 0, 255, 255] : [255, 0, 0, 255]));   // red | blue
    const r = rotatePixels(a, Math.PI / 2);
    expect([r.width, r.height]).toEqual([1, 2]);
    expect(Array.from(r.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);   // red on top, blue below
    expect(rotatePixels(a, 0).data).toEqual(a.data);
  });
  it('grows the box for 45 degrees', () => {
    const r = rotatePixels(img(10, 10, () => [1, 1, 1, 255]), Math.PI / 4);
    expect(r.width).toBe(15); expect(r.data[3]).toBe(0); expect(r.data[((7 * 15) + 7) * 4 + 3]).toBe(255);
  });
});
