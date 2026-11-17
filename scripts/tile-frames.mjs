// Builds "wide edge" versions of the 48x48 frames so long sides can tile instead of stretching one 16px tile.
//   mirror: every second tile is flipped along the edge, so neighbouring tiles always join seamlessly
//   random: mirror + palette-preserving speckle (pixels step to the next lighter/darker colour already used in the tile),
//           so repeats don't look identical. Seams stay clean because the outermost columns/rows of each tile are untouched.
// Output is a (32 + 16*N) square: 16px corners, N-tile edges, N x N centre. Use with border-image-slice: 16 and `repeat`.
import sharp from 'sharp';

export const TILE = 16;
export const MIN_STEP = 6, MAX_STEP = 14;  // brightness change (0-255 scale) a weathered pixel moves by
export const MAX_COLOUR_JUMP = 56;         // a weathered pixel may only become a palette colour this close (RGB distance) to its own: no hue jumps / colour noise
export const N = 9;                      // tiles per edge strip (odd, so strips start and end with the original tile)

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const seedOf = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

const px = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2], img.d[i + 3]]; };
const put = (img, x, y, c) => { const i = (y * img.w + x) * 4; img.d[i] = c[0]; img.d[i + 1] = c[1]; img.d[i + 2] = c[2]; img.d[i + 3] = c[3]; };
const crop = (img, x0, y0) => { const t = { w: TILE, h: TILE, d: Buffer.alloc(TILE * TILE * 4) }; for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(t, x, y, px(img, x0 + x, y0 + y)); return t; };
const flip = (t, fx, fy) => { const o = { w: TILE, h: TILE, d: Buffer.alloc(TILE * TILE * 4) }; for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(o, x, y, px(t, fx ? TILE - 1 - x : x, fy ? TILE - 1 - y : y)); return o; };
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Palette-preserving weathering. Only frames whose edge art is richly textured (stone, wood: ~90+ colours per tile on average)
 * are touched, decided once per frame so all four sides match; flat or dithered frames never get "dust". A chosen interior pixel moves to the palette colour closest to a slightly lighter/darker target.
 * The outermost 2 rows/columns of the tile stay untouched, so mirrored seams and outlines remain perfect.
 */
const colourCount = t => { const s = new Set(); for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const c = px(t, x, y); if (c[3] > 200) s.add(c.join(',')); } return s.size; };
export const RICH_PALETTE = 90;   // average colours per edge tile above which a frame counts as "textured"

function speckle(t, rand, strength, margin) {
  const key = c => c.join(','), seen = new Map();
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const c = px(t, x, y); if (c[3] > 200) seen.set(key(c), c); }
  const palette = [...seen.values()];
  const o = { ...t, d: Buffer.from(t.d) };
  for (let y = margin; y < TILE - margin; y++) for (let x = margin; x < TILE - margin; x++) {
    const c = px(t, x, y); if (c[3] < 200 || rand() > strength) continue;
    const target = lum(c) + (rand() < 0.5 ? -1 : 1) * (MIN_STEP + rand() * (MAX_STEP - MIN_STEP));
    let best = null, bestD = Infinity;
    for (const p of palette) {
      if (rgbDist(p, c) > MAX_COLOUR_JUMP) continue;   // same colour family only: a blue pixel never turns orange
      const d = Math.abs(lum(p) - target); if (d < bestD && key(p) !== key(c)) { best = p; bestD = d; }
    }
    if (best && bestD < 4) put(o, x, y, best);   // only when the palette really has a colour that close: no visible jumps
  }
  return o;
}

export const CENTRE_RICH = 20;    // colours in the centre tile above which a centre counts as textured (stone, wood, ornate metal)

/** `centre`: also weather the centre (textured centres only). Edges follow `mode` ('mirror' clean, 'random' weathered). */
export async function buildTiled(file, mode, seed, centre = false) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 48 || info.height !== 48) throw new Error(`${file}: expected 48x48`);
  const src = { w: 48, h: 48, d: data };
  const W = 2 * TILE + N * TILE, out = { w: W, h: W, d: Buffer.alloc(W * W * 4) };
  const blit = (t, x0, y0) => { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(out, x0 + x, y0 + y, px(t, x, y)); };
  const rand = rng(seed ^ 0x9e3779b9), randC = rng(seed ^ 0x51ed270b);   // separate streams: turning the centre on never re-shuffles the edges
  const top = crop(src, 16, 0), bottom = crop(src, 16, 32), left = crop(src, 0, 16), right = crop(src, 32, 16), centre_ = crop(src, 16, 16);
  // random: only the edges get life, and only where the art is textured; the centre stays a clean mirror
  const textured = [top, bottom, left, right].reduce((n, t) => n + colourCount(t), 0) / 4 >= RICH_PALETTE;
  const vary = t => (mode === 'random' && textured ? speckle(t, rand, 0.26, 2) : t);
  // centre: seams between tiles are mirrored, and a weathered pixel moves by at most ~14 brightness levels, so no margin is needed
  const keep = t => (centre && colourCount(centre_) >= CENTRE_RICH ? speckle(t, randC, 0.18, 0) : t);

  blit(crop(src, 0, 0), 0, 0); blit(crop(src, 32, 0), W - TILE, 0); blit(crop(src, 0, 32), 0, W - TILE); blit(crop(src, 32, 32), W - TILE, W - TILE);
  for (let i = 0; i < N; i++) {
    const odd = i % 2 === 1;
    blit(vary(flip(top, odd, false)), TILE + i * TILE, 0);
    blit(vary(flip(bottom, odd, false)), TILE + i * TILE, W - TILE);
    blit(vary(flip(left, false, odd)), 0, TILE + i * TILE);
    blit(vary(flip(right, false, odd)), W - TILE, TILE + i * TILE);
    for (let j = 0; j < N; j++) blit(keep(flip(centre_, odd, j % 2 === 1)), TILE + i * TILE, TILE + j * TILE);
  }
  return sharp(out.d, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
}
