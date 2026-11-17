import { resampleBox } from './pixelite';

/** Small pixel-editing helpers for the frame editor. All of them work on Pixels in place or return a new one. */

export interface Rect { x: number; y: number; w: number; h: number }
export type Rgba = [number, number, number, number];

/** The part of Pixels these helpers need, so they also run (and are tested) without a browser. */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }
export const makePixels = (width: number, height: number): Pixels => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
export const cloneData = (d: Pixels): Pixels => ({ width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) });

/** The corners of a drag as a rectangle (both corners included), kept inside a size x size picture. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }, size: number): Rect {
  const cl = (n: number) => Math.max(0, Math.min(size - 1, n));
  const x0 = cl(Math.min(a.x, b.x)), y0 = cl(Math.min(a.y, b.y)), x1 = cl(Math.max(a.x, b.x)), y1 = cl(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export function extract(d: Pixels, r: Rect): Pixels {
  const out = makePixels(r.w, r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const sx = r.x + x, sy = r.y + y;
    if (sx < 0 || sy < 0 || sx >= d.width || sy >= d.height) continue;
    const s = (sy * d.width + sx) * 4, o = (y * r.w + x) * 4;
    out.data.set(d.data.subarray(s, s + 4), o);
  }
  return out;
}

export function clearRect(d: Pixels, r: Rect): void {
  for (let y = Math.max(0, r.y); y < Math.min(d.height, r.y + r.h); y++)
    for (let x = Math.max(0, r.x); x < Math.min(d.width, r.x + r.w); x++) d.data.fill(0, (y * d.width + x) * 4, (y * d.width + x) * 4 + 4);
}

/** Draw `img` onto `d` at (x0, y0). `solidOnly`: transparent pixels of `img` leave what is underneath alone. */
export function blit(d: Pixels, img: Pixels, x0: number, y0: number, solidOnly = true): void {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const dx = x0 + x, dy = y0 + y;
    if (dx < 0 || dy < 0 || dx >= d.width || dy >= d.height) continue;
    const s = (y * img.width + x) * 4;
    if (solidOnly && img.data[s + 3] === 0) continue;
    d.data.set(img.data.subarray(s, s + 4), (dy * d.width + dx) * 4);
  }
}

export function flip(img: Pixels, horizontal: boolean): Pixels {
  const out = makePixels(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const sx = horizontal ? img.width - 1 - x : x, sy = horizontal ? y : img.height - 1 - y;
    const s = (sy * img.width + sx) * 4;
    out.data.set(img.data.subarray(s, s + 4), (y * img.width + x) * 4);
  }
  return out;
}

/** Flood fill (4-way, exact colour match) from (x, y). Returns false when nothing changed. */
export function floodFill(d: Pixels, x: number, y: number, color: Rgba): boolean {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return false;
  const at = (px: number, py: number) => (py * d.width + px) * 4;
  const t = at(x, y), target = [d.data[t], d.data[t + 1], d.data[t + 2], d.data[t + 3]];
  if (target.every((v, i) => v === color[i])) return false;
  const same = (i: number) => d.data[i] === target[0] && d.data[i + 1] === target[1] && d.data[i + 2] === target[2] && d.data[i + 3] === target[3];
  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop()!;
    if (px < 0 || py < 0 || px >= d.width || py >= d.height) continue;
    const i = at(px, py);
    if (!same(i)) continue;
    d.data.set(color, i);
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return true;
}

/** Resize a picture to w x h: crisp nearest-neighbour when it grows, area-averaged (keeps detail) when it shrinks. */
export function scalePixels(img: Pixels, w: number, h: number): Pixels {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (w === img.width && h === img.height) return cloneData(img);
  if (w * h < img.width * img.height) return { width: w, height: h, data: resampleBox(img.data, img.width, 0, 0, img.width, img.height, w, h) };
  const out = makePixels(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (Math.min(img.height - 1, Math.floor(y * img.height / h)) * img.width + Math.min(img.width - 1, Math.floor(x * img.width / w))) * 4;
    out.data.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
  }
  return out;
}

/**
 * Rotate a picture by `ang` radians (clockwise) about its centre. Hard-edged: every output pixel takes the nearest source pixel.
 * The result is the rotated picture's bounding box, so it is usually bigger than the input.
 */
export function rotatePixels(img: Pixels, ang: number): Pixels {
  const c = Math.cos(ang), s = Math.sin(ang), q = (n: number) => Math.round(n * 1e6) / 1e6;
  const w = Math.max(1, Math.ceil(q(Math.abs(img.width * c) + Math.abs(img.height * s)))), h = Math.max(1, Math.ceil(q(Math.abs(img.width * s) + Math.abs(img.height * c))));
  const out = makePixels(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + .5 - w / 2, dy = y + .5 - h / 2;
    const sx = Math.floor(q(c * dx + s * dy + img.width / 2)), sy = Math.floor(q(-s * dx + c * dy + img.height / 2));
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
    const i = (sy * img.width + sx) * 4;
    out.data.set(img.data.subarray(i, i + 4), (y * w + x) * 4);
  }
  return out;
}
