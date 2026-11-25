import { describe, expect, it } from 'vitest';
import { moveFill, type BigMapFill } from './bigmapfill';

const mk = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
/** A finished fill whose pixel (i, j) has red = a number made of the WORLD position it shows. */
function finished(mw: number, mh: number, scale: number, fx: number, fy: number): BigMapFill {
  const f = moveFill(null, mw, mh, scale, fx, fy, mk);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) { const o = (j * mw + i) * 4, wx = Math.floor(fx + (i - mw / 2) * scale), wy = Math.floor(fy + (j - mh / 2) * scale); f.img.data[o] = (wx * 7 + wy * 13) & 255; f.ok[j * mw + i] = 1; f.lay[j * mw + i] = wx; }
  f.pend.fill(0); f.rem = 0;
  return f;
}
describe('big map fill', () => {
  it('starts dark and all to do', () => {
    const f = moveFill(null, 50, 40, 2, 0, 0, mk);
    expect(f.rem).toBe(2000); expect(f.ok.every(v => v === 0)).toBe(true); expect(f.img.data[0]).toBe(10); expect(f.img.data[3]).toBe(255);
  });
  it('a pan keeps every pixel still in view and leaves only the uncovered strip to do', () => {
    const old = finished(50, 40, 2, 100, 100), f = moveFill(old, 50, 40, 2, 100 + 2 * 7, 100 - 2 * 3, mk);   // 7 pixels right, 3 up
    expect(f.rem).toBe(50 * 3 + 7 * (40 - 3));
    for (let j = 0; j < 40; j++) for (let i = 0; i < 50; i++) {
      const k = j * 50 + i, inView = i + 7 < 50 && j - 3 >= 0;
      expect(f.ok[k]).toBe(inView ? 1 : 0);
      if (inView) { expect(f.img.data[k * 4]).toBe(old.img.data[((j - 3) * 50 + i + 7) * 4]); expect(f.lay[k]).toBe(old.lay[(j - 3) * 50 + i + 7]); }
    }
    expect(f.pend[0]).toBe(50); expect(f.pend[10]).toBe(7);
  });
  it('a pan before the last fill was done keeps what was done and the pixels still to do stay to do', () => {
    const old = finished(50, 40, 2, 0, 0); old.ok.fill(0, 25 * 50); old.pend.fill(50, 25); old.rem = 15 * 50;   // the bottom 15 rows not filled yet
    const f = moveFill(old, 50, 40, 2, 2 * 4, 0, mk);   // 4 pixels right
    expect(f.rem).toBe(15 * 50 + 25 * 4);
  });
  it('a pan by more than the view, or by a part of a pixel, keeps nothing as done', () => {
    expect(moveFill(finished(50, 40, 2, 0, 0), 50, 40, 2, 500, 0, mk).rem).toBe(2000);
    expect(moveFill(finished(50, 40, 2, 0, 0), 50, 40, 2, 1, 0, mk).rem).toBe(2000);
  });
  it('a zoom keeps the old picture as a stand-in, but all of it is still to do', () => {
    const old = finished(50, 40, 2, 100, 100), f = moveFill(old, 50, 40, 1, 100, 100, mk);
    expect(f.rem).toBe(2000);
    expect(f.img.data[(20 * 50 + 25) * 4]).toBe(old.img.data[(20 * 50 + 25) * 4]);   // (the middle is the same spot at either zoom)
    expect(f.img.data[(20 * 50 + 0) * 4]).not.toBe(10);   // (not a blank: the old picture covers the left edge at the finer zoom)
  });
});
