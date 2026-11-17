/** Pixelite: turns an image into pixel art by averaging every grid cell into one pixel (ported from the original Scrypture). */

export const OUTPUT_SIZES = ['16x16', '32x32', '50x50', '64x64', '64x128', '128x64', '128x128', '256x256', '256x512', '512x256', '512x512', 'snap', 'custom'] as const;
export type OutputSize = (typeof OUTPUT_SIZES)[number];
export const MAX_GRID = 100;
export const MAX_OUTPUT = 16384; // browser canvas limit, effectively uncapped
export const ZOOM_MIN = 0.1, ZOOM_MAX = 8;

export interface Rgb { r: number; g: number; b: number }

/** Grid size that makes the shorter side about 64 cells (1 when the image is already that small). */
export function detectGridSize(width: number, height: number): number {
  const shorter = Math.min(width, height);
  return shorter <= 64 ? 1 : Math.max(1, Math.min(MAX_GRID, Math.ceil(shorter / 64)));
}

/** Preset output size that suits the image's aspect ratio. */
export function detectOutputSize(width: number, height: number): OutputSize {
  const ratio = width / height;
  return ratio > 1.5 ? '128x64' : ratio < 0.67 ? '64x128' : '64x64';
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n) || lo));
export const clampOutput = (n: number) => clamp(n, 1, MAX_OUTPUT);

/** `snap` = whatever the shrunken picture comes to: one pixel per whole grid cell (pass those dims as `snapped`). */
export function outputDims(size: OutputSize, customW: number, customH: number, snapped?: { width: number; height: number }): { width: number; height: number } {
  if (size === 'snap') return snapped ?? { width: clampOutput(customW), height: clampOutput(customH) };
  if (size === 'custom') return { width: clampOutput(customW), height: clampOutput(customH) };
  const [w, h] = size.split('x').map(Number);
  return { width: w, height: h };
}

/** Output size that exactly covers the image from the grid offset on: one pixel per whole cell. */
export function snapOutput(width: number, height: number, grid: number, offsetX: number, offsetY: number) {
  return { width: clampOutput(Math.floor((width - offsetX) / grid)), height: clampOutput(Math.floor((height - offsetY) / grid)) };
}

/** The most common colours (quantised to 8 levels per channel so noise merges), most frequent first. */
export function extractPalette(data: Uint8ClampedArray, max = 16): Rgb[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 16) {   // every 4th pixel is plenty
    if (data[i + 3] < 128) continue;
    const q = (v: number) => Math.min(255, Math.round(v / 32) * 32);
    const key = (q(data[i]) << 16) | (q(data[i + 1]) << 8) | q(data[i + 2]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => ({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255 }));
}

export const SAMPLE_MODES = ['average', 'dominant', 'median', 'centre'] as const;
export type SampleMode = (typeof SAMPLE_MODES)[number];

/**
 * One output pixel per grid cell. Cells outside the image come out transparent.
 * - average: alpha-weighted mean (transparent pixels do not darken the colour). Soft edges stay soft.
 * - dominant: the most common colour of the cell (never a blend), solid. Crisp, best for pixel art.
 * - median: per-channel median of the visible pixels, ignores outliers and noise.
 * - centre: the pixel in the middle of the cell, nothing else.
 */
export function sampleGrid(src: Uint8ClampedArray, srcW: number, srcH: number, grid: number, offsetX: number, offsetY: number, outW: number, outH: number, mode: SampleMode = 'average'): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const rs: number[] = [], gs: number[] = [], bs: number[] = [], as: number[] = [];
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const x0 = offsetX + ox * grid, y0 = offsetY + oy * grid;
      const xa = Math.max(0, x0), xb = Math.min(srcW, x0 + grid), ya = Math.max(0, y0), yb = Math.min(srcH, y0 + grid);
      if (xa >= xb || ya >= yb) continue;
      const o = (oy * outW + ox) * 4;
      if (mode === 'centre') {
        const i = (Math.min(yb - 1, Math.max(ya, Math.floor(y0 + grid / 2))) * srcW + Math.min(xb - 1, Math.max(xa, Math.floor(x0 + grid / 2)))) * 4;
        out.set(src.subarray(i, i + 4), o);
        continue;
      }
      let r = 0, g = 0, b = 0, a = 0, n = 0, wsum = 0;
      rs.length = gs.length = bs.length = as.length = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * srcW + x) * 4, al = src[i + 3];
          a += al; n++;
          if (al === 0 && mode !== 'average') continue;
          if (mode === 'average') { r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; wsum += al; }
          else if (al >= 128 || mode === 'median') { rs.push(src[i]); gs.push(src[i + 1]); bs.push(src[i + 2]); as.push(al); }
        }
      }
      if (mode === 'average') {
        out[o + 3] = Math.round(a / n);
        if (wsum) { out[o] = Math.round(r / wsum); out[o + 1] = Math.round(g / wsum); out[o + 2] = Math.round(b / wsum); }
      } else if (mode === 'median') {
        if (rs.length * 2 < n) continue;   // mostly empty: stay clear
        const med = (v: number[]) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
        out[o] = med(rs); out[o + 1] = med(gs); out[o + 2] = med(bs); out[o + 3] = Math.round(as.reduce((p, q) => p + q, 0) / as.length);
      } else {   // dominant: bucket by 4 bits per channel, take the biggest bucket's mean
        if (rs.length * 2 < n) continue;
        const buckets = new Map<number, { c: number; r: number; g: number; b: number }>();
        for (let k = 0; k < rs.length; k++) {
          const key = ((rs[k] >> 4) << 8) | ((gs[k] >> 4) << 4) | (bs[k] >> 4), e = buckets.get(key) ?? { c: 0, r: 0, g: 0, b: 0 };
          e.c++; e.r += rs[k]; e.g += gs[k]; e.b += bs[k]; buckets.set(key, e);
        }
        let best = { c: 0, r: 0, g: 0, b: 0 };
        for (const e of buckets.values()) if (e.c > best.c) best = e;
        out[o] = Math.round(best.r / best.c); out[o + 1] = Math.round(best.g / best.c); out[o + 2] = Math.round(best.b / best.c); out[o + 3] = 255;
      }
    }
  }
  return out;
}

// ---- filters against scaling artifacts ----

/** Make every pixel fully solid or fully clear: alpha at or above `threshold` % stays (opaque), below goes. 0 = off. Kills soft fringes round a cut-out. */
export function alphaCleanup(px: Uint8ClampedArray, threshold: number): void {
  if (threshold <= 0) return;
  const cut = Math.round(Math.min(100, threshold) / 100 * 255);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] >= cut && px[i + 3] > 0) px[i + 3] = 255;
    else px.fill(0, i, i + 4);
  }
}

/** 3x3 median on the colour channels (alpha untouched): removes speckle and JPEG noise before the grid averages it into the result. */
export function medianDenoise(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(data.length), win = new Uint8Array(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
        win[n++] = data[(yy * w + xx) * 4 + c];
      }
      win.sort();
      out[o + c] = win[4];
    }
    out[o + 3] = data[o + 3];
  }
  return out;
}

/** Unsharp mask (3x3 box blur subtracted), `amount` 0-100: brings back the edges the downscale would soften. 0 returns the input. */
export function sharpen(data: Uint8ClampedArray, w: number, h: number, amount: number): Uint8ClampedArray {
  if (amount <= 0) return data;
  const k = amount / 50, out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        sum += data[(Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))) * 4 + c];
      out[o + c] = data[o + c] + k * (data[o + c] - sum / 9);
    }
    out[o + 3] = data[o + 3];
  }
  return out;
}

/**
 * Tidy the finished pixels, in place: a visible pixel with no similar neighbour takes its neighbours' colour (or is dropped when it
 * sits alone in clear space), and a clear pixel boxed in by four visible ones is filled. Reads from a copy, so the order does not matter.
 */
export function cleanStray(px: Uint8ClampedArray, w: number, h: number): void {
  const src = new Uint8ClampedArray(px), vis = (i: number) => src[i + 3] >= 128;
  const near = (a: number, b: number) => (src[a] - src[b]) ** 2 + (src[a + 1] - src[b + 1]) ** 2 + (src[a + 2] - src[b + 2]) ** 2 <= 2400;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, nb: number[] = [];
    if (x > 0) nb.push(i - 4);
    if (x < w - 1) nb.push(i + 4);
    if (y > 0) nb.push(i - w * 4);
    if (y < h - 1) nb.push(i + w * 4);
    const seen = nb.filter(vis);
    if (vis(i)) {
      if (!seen.length) { if (nb.length >= 2) px.fill(0, i, i + 4); continue; }   // alone in clear space
      if (seen.length < 2 || seen.some(j => near(i, j))) continue;
      // no look-alike: take the neighbour colour that most of the others agree with
      const pick = seen.reduce((best, j) => (seen.filter(k => near(j, k)).length > seen.filter(k => near(best, k)).length ? j : best), seen[0]);
      px[i] = src[pick]; px[i + 1] = src[pick + 1]; px[i + 2] = src[pick + 2];
    } else if (nb.length === 4 && seen.length === 4) {   // a hole in the middle of a shape
      px[i] = src[seen[0]]; px[i + 1] = src[seen[0] + 1]; px[i + 2] = src[seen[0] + 2]; px[i + 3] = 255;
    }
  }
}

/** Cell shading: snap every visible pixel to the nearest of the first few palette colours. 0 = off, 100 = fewest colours. */
export function shadeWithPalette(data: Uint8ClampedArray, palette: Rgb[], intensity: number): void {
  if (intensity <= 0 || !palette.length) return;
  const colors = palette.slice(0, Math.max(2, Math.floor(16 * (1 - intensity / 100))));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    let best = colors[0], bestD = Infinity;
    for (const c of colors) {
      const d = (data[i] - c.r) ** 2 + (data[i + 1] - c.g) ** 2 + (data[i + 2] - c.b) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    data[i] = best.r; data[i + 1] = best.g; data[i + 2] = best.b;
  }
}

export const rgbCss = (c: Rgb) => `rgb(${c.r},${c.g},${c.b})`;
export const exportName = (w: number, h: number, imageName: string) => `pixelite-${w}x${h}-${imageName.replace(/\.[^/.]+$/, '') || 'image'}.png`;

// ---- frame 9-slice: shrink a big frame picture into a small one, keeping the corners where you put them ----

export interface Bounds { l: number; t: number; r: number; b: number }   // l/t inclusive, r/b exclusive, in source pixels

/** Box-filter shrink of a source rectangle to dw x dh (every output pixel is the area-weighted average of what it covers; alpha-aware). */
export function resampleBox(src: Uint8ClampedArray, srcW: number, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const kx = sw / dw, ky = sh / dh;
  for (let oy = 0; oy < dh; oy++) {
    const y0 = sy + oy * ky, y1 = y0 + ky;
    for (let ox = 0; ox < dw; ox++) {
      const x0 = sx + ox * kx, x1 = x0 + kx;
      let r = 0, g = 0, b = 0, a = 0, w = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wt = wy * (Math.min(x + 1, x1) - Math.max(x, x0)), i = (y * srcW + x) * 4, al = src[i + 3] / 255;
          r += src[i] * al * wt; g += src[i + 1] * al * wt; b += src[i + 2] * al * wt; a += al * wt; w += wt;
        }
      }
      const o = (oy * dw + ox) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = w ? Math.round(a / w * 255) : 0;
    }
  }
  return out;
}

/** Where the picture's content sits: everything that differs from the top-left pixel (the background). */
export function detectContentBounds(data: Uint8ClampedArray, w: number, h: number): Bounds {
  const bg = [data[0], data[1], data[2], data[3]];
  const differs = (i: number) => bg[3] < 16 ? data[i + 3] > 16 : data[i + 3] > 16 && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60;
  let l = w, t = h, r = 0, b = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (differs((y * w + x) * 4)) { if (x < l) l = x; if (x >= r) r = x + 1; if (y < t) t = y; if (y >= b) b = y + 1; }
  return r > l && b > t ? { l, t, r, b } : { l: 0, t: 0, r: w, b: h };
}

/** Starting cut lines: a bit over a tenth of the frame in from each edge. */
export const defaultCuts = (c: Bounds): Bounds => {
  const dx = Math.round((c.r - c.l) * 0.12), dy = Math.round((c.b - c.t) * 0.12);
  return { l: c.l + dx, t: c.t + dy, r: c.r - dx, b: c.b - dy };
};

/**
 * Build a frame of outW x outH with `spare` transparent pixels all around. The cropped picture is cut into 9 pieces at `cuts`;
 * each corner is shrunk to `corner` x `corner` pixels, the edges and centre take the rest.
 */
export function sliceFrame(src: Uint8ClampedArray, srcW: number, crop: Bounds, cuts: Bounds, outW: number, outH: number, spare: number, corner: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const fw = Math.max(3, outW - 2 * spare), fh = Math.max(3, outH - 2 * spare);
  const cx = Math.max(1, Math.min(Math.round(corner), Math.floor((fw - 1) / 2))), cy = Math.max(1, Math.min(Math.round(corner), Math.floor((fh - 1) / 2)));
  const xs = [crop.l, cuts.l, cuts.r, crop.r], ys = [crop.t, cuts.t, cuts.b, crop.b];
  const dxs = [0, cx, fw - cx, fw], dys = [0, cy, fh - cy, fh];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const sw = xs[i + 1] - xs[i], sh = ys[j + 1] - ys[j], dw = dxs[i + 1] - dxs[i], dh = dys[j + 1] - dys[j];
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
    const piece = resampleBox(src, srcW, xs[i], ys[j], sw, sh, dw, dh);
    for (let y = 0; y < dh; y++) {
      const o = ((spare + dys[j] + y) * outW + spare + dxs[i]) * 4;
      out.set(piece.subarray(y * dw * 4, (y + 1) * dw * 4), o);
    }
  }
  return out;
}

// ---- remove background ----

/** The most common opaque colour on the picture's border, a good guess for the background. Null when the border is clear. */
export function borderColor(data: Uint8ClampedArray, w: number, h: number): Rgb | null {
  const counts = new Map<number, number>();
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  let best = -1, n = 0;
  for (const [k, c] of counts) if (c > n) { n = c; best = k; }
  return best < 0 ? null : { r: (best >> 16) & 255, g: (best >> 8) & 255, b: best & 255 };
}

/**
 * Make the background transparent, in place. A pixel is background when its colour is within `tolerance` (0-100 %)
 * of `key`. `contiguous`: only background connected to the picture's edge (so the same colour inside the subject stays).
 * Returns how many pixels were cleared.
 */
export function removeBackground(px: Uint8ClampedArray, w: number, h: number, key: Rgb, tolerance: number, contiguous: boolean): number {
  const limit = (Math.max(0, Math.min(100, tolerance)) / 100 * 441.6729559300637) ** 2;
  const match = (p: number) => {
    const i = p * 4;
    if (px[i + 3] === 0) return false;
    return (px[i] - key.r) ** 2 + (px[i + 1] - key.g) ** 2 + (px[i + 2] - key.b) ** 2 <= limit;
  };
  let cleared = 0;
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) { px.fill(0, p * 4, p * 4 + 4); cleared++; }
    return cleared;
  }
  const stack: number[] = [];
  const seed = (x: number, y: number) => { const p = y * w + x; if (match(p)) { px.fill(0, p * 4, p * 4 + 4); cleared++; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!, x = p % w, y = (p - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  return cleared;
}

// ---- export formats ----

export const EXPORT_FORMATS = ['png', 'gif', 'webp', 'jpg', 'sheet', 'frames'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_EXT: Record<ExportFormat, string> = { png: 'png', gif: 'gif', webp: 'webp', jpg: 'jpg', sheet: 'png', frames: 'zip' };
export const EXPORT_MIME: Record<ExportFormat, string> = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', sheet: 'image/png', frames: 'application/zip' };
export const exportFileName = (w: number, h: number, imageName: string, fmt: ExportFormat) =>
  exportName(w, h, imageName).replace(/\.png$/, '') + (fmt === 'sheet' ? '-sheet' : fmt === 'frames' ? '-frames' : '') + '.' + EXPORT_EXT[fmt];

/** Frames side by side in one row. */
export function sheetFrames(frames: Uint8ClampedArray[], w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * frames.length * 4), rowLen = w * frames.length * 4;
  frames.forEach((f, n) => { for (let y = 0; y < h; y++) out.set(f.subarray(y * w * 4, (y + 1) * w * 4), y * rowLen + n * w * 4); });
  return out;
}

/** Names for the files inside a frames ZIP: `cat-001.png`, `cat-002.png`, ... (padded so they sort in order). */
export const frameFileNames = (imageName: string, count: number): string[] => {
  const base = imageName.replace(/\.[^/.]+$/, '') || 'frame', pad = Math.max(3, String(count).length);
  return Array.from({ length: count }, (_, n) => `${base}-${String(n + 1).padStart(pad, '0')}.png`);
};
