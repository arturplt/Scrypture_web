import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildTiled, seedOf, N, TILE } from './tile-frames.mjs';

const FILE = 'public/assets/frames/stone_block.png';
const raw = async buf => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const px = (im, x, y) => { const i = (y * im.w + x) * 4; return `${im.d[i]},${im.d[i + 1]},${im.d[i + 2]},${im.d[i + 3]}`; };
const SEED = seedOf('stone_block');

describe('wide-edge frames', async () => {
  const src = await raw(FILE);
  const mirror = await raw(await buildTiled(FILE, 'mirror', SEED));
  const random = await raw(await buildTiled(FILE, 'random', SEED));
  const W = 2 * TILE + N * TILE;

  it('has the expected size: 16px corners, N-tile edges', () => {
    expect([mirror.w, mirror.h, random.w, random.h]).toEqual([W, W, W, W]);
    expect(N % 2).toBe(1); // odd, so every strip starts and ends with the original tile
  });
  it('keeps all four corners exactly as drawn', () => {
    for (const im of [mirror, random]) for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      expect(px(im, x, y)).toBe(px(src, x, y));
      expect(px(im, W - TILE + x, y)).toBe(px(src, 32 + x, y));
      expect(px(im, x, W - TILE + y)).toBe(px(src, x, 32 + y));
      expect(px(im, W - TILE + x, W - TILE + y)).toBe(px(src, 32 + x, 32 + y));
    }
  });
  it('mirror: neighbouring tiles join with identical columns (no visible seam) on all four sides', () => {
    for (let i = 1; i < N; i++) for (let k = 0; k < TILE; k++) {
      const x = TILE + i * TILE;                       // boundary between tile i-1 and tile i
      expect(px(mirror, x - 1, k)).toBe(px(mirror, x, k));                       // top strip (rows 0..15)
      expect(px(mirror, x - 1, W - TILE + k)).toBe(px(mirror, x, W - TILE + k)); // bottom strip
      expect(px(mirror, k, x - 1)).toBe(px(mirror, k, x));                       // left strip
      expect(px(mirror, W - TILE + k, x - 1)).toBe(px(mirror, W - TILE + k, x)); // right strip
    }
  });
  it('mirror: the first and last tile of each strip are the original tile (so they meet the corners correctly)', () => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      expect(px(mirror, TILE + x, y)).toBe(px(src, TILE + x, y));
      expect(px(mirror, TILE + (N - 1) * TILE + x, y)).toBe(px(src, TILE + x, y));
    }
  });
  it('random: same seams as mirror (outer rows/columns of every tile untouched) and a clean centre', () => {
    let changed = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const inTopOrBottom = y < TILE || y >= W - TILE, inSides = x < TILE || x >= W - TILE;
      if (px(random, x, y) !== px(mirror, x, y)) {
        changed++;
        expect(inTopOrBottom || inSides, `changed centre pixel ${x},${y}`).toBe(true);
        const along = inTopOrBottom ? (x - TILE) % TILE : (y - TILE) % TILE;
        expect(along >= 2 && along <= TILE - 3, `changed a seam pixel at ${x},${y}`).toBe(true);
      }
    }
    expect(changed).toBeGreaterThan(20);               // it actually adds variation
  });
  it('random only uses colours that exist in the original frame (palette-preserving)', () => {
    const colours = new Set(); for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) colours.add(px(src, x, y));
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) expect(colours.has(px(random, x, y))).toBe(true);
  });
  it('is deterministic per frame, and different frames/seeds vary differently', async () => {
    const again = await buildTiled(FILE, 'random', SEED);
    expect((await raw(again)).d.equals(random.d)).toBe(true);
    const other = await raw(await buildTiled(FILE, 'random', seedOf('another_frame')));
    expect(other.d.equals(random.d)).toBe(false);
  });
});

describe('weathered centre', async () => {
  const W = 2 * TILE + N * TILE;
  const lum = (im, x, y) => { const i = (y * im.w + x) * 4; return 0.2126 * im.d[i] + 0.7152 * im.d[i + 1] + 0.0722 * im.d[i + 2]; };
  for (const mode of ['mirror', 'random']) {
    it(`${mode}: only the centre changes; corners and all four edges stay exactly as without it`, async () => {
      const base = await raw(await buildTiled(FILE, mode, SEED, false)), wc = await raw(await buildTiled(FILE, mode, SEED, true));
      let changed = 0;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        if (px(base, x, y) !== px(wc, x, y)) { changed++; expect(x >= TILE && x < W - TILE && y >= TILE && y < W - TILE, `changed outside the centre at ${x},${y}`).toBe(true); }
      }
      expect(changed).toBeGreaterThan(200);
    });
  }
  it('a textured centre only uses colours of the original frame, and seams between centre tiles stay nearly invisible', async () => {
    const src = await raw(FILE), wc = await raw(await buildTiled(FILE, 'mirror', SEED, true));
    const colours = new Set(); for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) colours.add(px(src, x, y));
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) expect(colours.has(px(wc, x, y))).toBe(true);
    for (let i = 1; i < N; i++) for (let k = TILE; k < W - TILE; k++) {
      const x = TILE + i * TILE;
      expect(Math.abs(lum(wc, x - 1, k) - lum(wc, x, k))).toBeLessThan(45);   // vertical seam
      expect(Math.abs(lum(wc, k, x - 1) - lum(wc, k, x))).toBeLessThan(45);   // horizontal seam
    }
  });
  it('flat frames are left completely alone (no dust on solid colours)', async () => {
    const flat = 'public/assets/frames/green_bev.png';
    expect((await raw(await buildTiled(flat, 'mirror', 1, true))).d.equals((await raw(await buildTiled(flat, 'mirror', 1, false))).d)).toBe(true);
    expect((await raw(await buildTiled(flat, 'random', 1, true))).d.equals((await raw(await buildTiled(flat, 'random', 1, false))).d)).toBe(true);
  });
  it('is deterministic', async () => {
    expect((await raw(await buildTiled(FILE, 'random', SEED, true))).d.equals((await raw(await buildTiled(FILE, 'random', SEED, true))).d)).toBe(true);
  });
});
