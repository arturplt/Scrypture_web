// Builds "checked" versions of Android's 16x16 box sprites by lifting the tick out of box_checked.png (where it differs
// from box.png) and stamping it, with a dark outline, onto other boxes. Output: public/assets/ticks/<name>_on.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const RAW = 'public/assets/raw', OUT = 'public/assets/ticks';
export const TICKS = {            // name: [box sprite, tick colour, outline colour]
  wood: ['box_wood', [40, 118, 46], [18, 56, 22]],
  stone: ['box_stone_empty', [76, 217, 100], [16, 60, 28]],
  barrel: ['box_wood_gold', [255, 211, 77], [60, 35, 8]],
  ember: ['bar_red_box', [255, 179, 71], [70, 22, 6]],
};
const load = async f => (await sharp(`${RAW}/${f}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** 16x16 boolean mask of the tick pixels. A stray pixel below the tick is dropped (rows 4..11 only). */
export async function tickMask() {
  const [on, off] = [await load('box_checked'), await load('box')];
  const m = Array.from({ length: 16 }, () => Array(16).fill(false));
  for (let y = 4; y <= 11; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; if (Math.abs(lum(on, i) - lum(off, i)) > 8) m[y][x] = true; }
  return m;
}

export async function buildTick(name, mask) {
  const [sprite, fg, ol] = TICKS[name];
  const d = Buffer.from(await load(sprite));
  const set = (x, y, c) => { const i = (y * 16 + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!mask[y][x]) {       // outline = 4-neighbours of the tick
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => mask[y + dy]?.[x + dx])) set(x, y, ol);
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (mask[y][x]) set(x, y, fg);
  return sharp(d, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
}

export async function prepareTicks() {
  mkdirSync(OUT, { recursive: true });
  const mask = await tickMask();
  for (const name of Object.keys(TICKS)) await sharp(await buildTick(name, mask)).toFile(`${OUT}/${name}_on.png`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) await prepareTicks();
