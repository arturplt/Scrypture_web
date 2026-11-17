/** A small GIF reader and writer, so Pixelite needs no library and no browser decoder. */

export interface GifFrame { data: Uint8ClampedArray<ArrayBuffer>; delay: number }   // full-size RGBA, delay in ms
export interface Gif { width: number; height: number; frames: GifFrame[] }

export const MIN_DELAY = 20;     // browsers show anything under 20 ms as 100 ms, so treat it as the floor
export const DEFAULT_DELAY = 100;

export const isGif = (b: Uint8Array) => b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;

/** GIF's variable-width LZW. Returns the colour index of every pixel (short data leaves the rest 0). */
function lzwDecode(minCode: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode, end = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = minCode + 1, next = end + 1, prev = -1, first = 0, bits = 0, acc = 0, p = 0, o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < count) {
    while (bits < size && p < data.length) { acc |= data[p++] << bits; bits += 8; }
    if (bits < size) break;
    let code = acc & ((1 << size) - 1);
    acc >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; next = end + 1; prev = -1; continue; }
    if (code === end) break;
    if (prev === -1) { out[o++] = suffix[code]; prev = first = code; continue; }
    const incoming = code;
    let sp = 0;
    if (code >= next) { stack[sp++] = first; code = prev; }
    while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
    first = suffix[code];
    stack[sp++] = first;
    if (next < 4096) { prefix[next] = prev; suffix[next] = first; next++; if (next === (1 << size) && size < 12) size++; }
    prev = incoming;
    while (sp > 0 && o < count) out[o++] = stack[--sp];
  }
  return out;
}

/** Decode every frame of a GIF, each already composed onto the full canvas (disposal methods honoured). */
export function decodeGif(buf: Uint8Array): Gif {
  if (!isGif(buf)) throw new Error('not a gif');
  const u16 = (i: number) => buf[i] | (buf[i + 1] << 8);
  const width = u16(6), height = u16(8);
  if (!width || !height) throw new Error('empty gif');
  let p = 13;
  let global: Uint8Array | null = null;
  if (buf[10] & 0x80) { const n = 3 * (1 << ((buf[10] & 7) + 1)); global = buf.subarray(p, p + n); p += n; }
  const frames: GifFrame[] = [];
  let canvas = new Uint8ClampedArray(width * height * 4);
  let gce = { disposal: 0, transparent: -1, delay: DEFAULT_DELAY };
  const skipBlocks = () => { while (p < buf.length && buf[p] !== 0) p += buf[p] + 1; p++; };
  while (p < buf.length) {
    const tag = buf[p++];
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = buf[p++];
      if (label === 0xf9 && buf[p] >= 4) {
        const f = buf[p + 1];
        gce = { disposal: (f >> 2) & 7, transparent: f & 1 ? buf[p + 4] : -1, delay: Math.max(MIN_DELAY, u16(p + 2) * 10 || DEFAULT_DELAY) };
      }
      skipBlocks();
    } else if (tag === 0x2c) {
      const x0 = u16(p), y0 = u16(p + 2), w = u16(p + 4), h = u16(p + 6), flags = buf[p + 8];
      p += 9;
      let table = global;
      if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); table = buf.subarray(p, p + n); p += n; }
      const minCode = buf[p++];
      const chunks: Uint8Array[] = []; let total = 0;
      while (p < buf.length && buf[p] !== 0) { chunks.push(buf.subarray(p + 1, p + 1 + buf[p])); total += buf[p]; p += buf[p] + 1; }
      p++;
      const packed = new Uint8Array(total);
      let q = 0; for (const c of chunks) { packed.set(c, q); q += c.length; }
      const idx = lzwDecode(minCode, packed, w * h);
      const before = gce.disposal === 3 ? new Uint8ClampedArray(canvas) : null;
      // interlaced rows are stored in four passes
      const rows: number[] = [];
      if (flags & 0x40) { for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s; y < h; y += st) rows.push(y); }
      else for (let y = 0; y < h; y++) rows.push(y);
      for (let r = 0; r < h; r++) {
        const y = y0 + rows[r];
        if (y >= height) continue;
        for (let x = 0; x < w; x++) {
          const c = idx[r * w + x];
          if (c === gce.transparent || !table || x0 + x >= width) continue;
          const o = (y * width + x0 + x) * 4;
          canvas[o] = table[c * 3]; canvas[o + 1] = table[c * 3 + 1]; canvas[o + 2] = table[c * 3 + 2]; canvas[o + 3] = 255;
        }
      }
      frames.push({ data: new Uint8ClampedArray(canvas), delay: gce.delay });
      if (gce.disposal === 2) {
        for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) canvas.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      } else if (before) canvas = before;
      gce = { disposal: 0, transparent: -1, delay: DEFAULT_DELAY };
    } else break;   // damaged file: keep what we have
  }
  if (!frames.length) throw new Error('no frames');
  return { width, height, frames };
}

/** A palette for all frames: the exact colours when they fit, otherwise the most used ones (5 bits per channel). */
function buildPalette(frames: GifFrame[], room: number): { colors: number[]; exact: boolean } {
  const counts = new Map<number, number>();
  for (const f of frames) for (let i = 0; i < f.data.length; i += 4) {
    if (f.data[i + 3] < 128) continue;
    const k = (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size <= room) return { colors: [...counts.keys()], exact: true };
  const coarse = new Map<number, number>();
  for (const [k, n] of counts) { const c = ((k >> 19) << 10) | (((k >> 11) & 31) << 5) | ((k >> 3) & 31); coarse.set(c, (coarse.get(c) ?? 0) + n); }
  const colors = [...coarse.entries()].sort((a, b) => b[1] - a[1]).slice(0, room).map(([c]) => {
    const r = (c >> 10) & 31, g = (c >> 5) & 31, b = c & 31;
    return (((r << 3) | (r >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((b << 3) | (b >> 2));
  });
  return { colors, exact: false };
}

function lzwEncode(indices: Uint8Array, minCode: number): number[] {
  const bytes: number[] = [];
  const clear = 1 << minCode, end = clear + 1;
  let size = minCode + 1, next = end + 1, acc = 0, bits = 0;
  let dict = new Map<number, number>();
  const put = (code: number) => { acc |= code << bits; bits += size; while (bits >= 8) { bytes.push(acc & 255); acc >>>= 8; bits -= 8; } };
  put(clear);
  let cur = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = cur * 256 + indices[i], hit = dict.get(k);
    if (hit !== undefined) { cur = hit; continue; }
    put(cur);
    if (next < 4096) { dict.set(k, next++); if (next - 1 === (1 << size) && size < 12) size++; }
    else { put(clear); dict = new Map(); size = minCode + 1; next = end + 1; }
    cur = indices[i];
  }
  put(cur); put(end);
  if (bits > 0) bytes.push(acc & 255);
  return bytes;
}

/** Write a looping GIF. Pixels with alpha under 128 become the transparent colour. */
export function encodeGif(width: number, height: number, frames: GifFrame[]): Uint8Array<ArrayBuffer> {
  const needsAlpha = frames.some(f => { for (let i = 3; i < f.data.length; i += 4) if (f.data[i] < 128) return true; return false; });
  const { colors, exact } = buildPalette(frames, needsAlpha ? 255 : 256);
  const tIndex = needsAlpha ? colors.length : -1;
  const total = colors.length + (needsAlpha ? 1 : 0);
  let depth = 1; while ((1 << depth) < Math.max(2, total)) depth++;
  const lookup = new Map<number, number>(colors.map((c, i) => [c, i]));
  const nearest = (r: number, g: number, b: number): number => {
    const k = (r << 16) | (g << 8) | b, hit = lookup.get(k);
    if (hit !== undefined) return hit;
    let best = 0, bd = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i], d = (r - (c >> 16)) ** 2 + (g - ((c >> 8) & 255)) ** 2 + (b - (c & 255)) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (!exact) lookup.set(k, best);
    return best;
  };
  const out: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8, 0x80 | ((depth - 1) << 4) | (depth - 1), 0, 0];
  for (let i = 0; i < (1 << depth); i++) { const c = colors[i] ?? 0; out.push(c >> 16, (c >> 8) & 255, c & 255); }
  out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(ch => ch.charCodeAt(0)), 3, 1, 0, 0, 0);   // loop forever
  const minCode = Math.max(2, depth);
  for (const f of frames) {
    const cs = Math.max(2, Math.round(f.delay / 10));
    out.push(0x21, 0xf9, 4, needsAlpha ? 0x09 : 0x04, cs & 255, cs >> 8, Math.max(0, tIndex), 0);   // dispose to background when transparent, else leave
    out.push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0);
    const idx = new Uint8Array(width * height);
    for (let i = 0; i < idx.length; i++) {
      const o = i * 4;
      idx[i] = f.data[o + 3] < 128 ? tIndex : nearest(f.data[o], f.data[o + 1], f.data[o + 2]);
    }
    const lz = lzwEncode(idx, minCode);
    out.push(minCode);
    for (let i = 0; i < lz.length; i += 255) { const n = Math.min(255, lz.length - i); out.push(n); for (let j = 0; j < n; j++) out.push(lz[i + j]); }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
