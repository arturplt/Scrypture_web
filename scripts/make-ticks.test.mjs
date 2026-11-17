import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildTick, tickMask, TICKS } from './make-ticks.mjs';

const raw = async f => (await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
describe('generated tick boxes', async () => {
  const mask = await tickMask();
  const count = mask.flat().filter(Boolean).length;
  it('the lifted tick is a small, compact shape inside the box', () => {
    expect(count).toBeGreaterThan(20); expect(count).toBeLessThan(45);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (mask[y][x]) { expect(y >= 4 && y <= 11).toBe(true); expect(x >= 3 && x <= 13).toBe(true); }
  });
  for (const name of Object.keys(TICKS)) it(`${name}: 16x16, only the tick area changes, the box border is untouched`, async () => {
    const out = await buildTick(name, mask);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([16, 16]);
    const a = await raw(`public/assets/raw/${TICKS[name][0]}.png`), b = await sharp(out).ensureAlpha().raw().toBuffer();
    let changed = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) { changed++; expect(y >= 3 && y <= 12 && x >= 2 && x <= 14, `changed ${x},${y}`).toBe(true); } }
    expect(changed).toBeGreaterThan(count - 2);          // the tick is really drawn
  });
});
