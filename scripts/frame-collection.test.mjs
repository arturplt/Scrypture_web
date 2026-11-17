import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFrame, describeFrame, frameName } from './frame-collection.mjs';

const solid = (w, h, [r, g, b, a]) => sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: a / 255 } } }).png().toBuffer();

describe('frame collection', () => {
  it('cleans names', () => {
    expect(frameName(' My Frame!! v2 ')).toBe('my_frame_v2');
    expect(frameName('***')).toBe('');
  });
  it('measures accent and brightness', async () => {
    expect(await describeFrame(await solid(50, 50, [255, 0, 0, 255]))).toEqual({ accent: '#ff0000', light: false });
    expect((await describeFrame(await solid(50, 50, [250, 250, 250, 255]))).light).toBe(true);
  });
  it('adds a 50x50 frame, refuses wrong sizes and built-in names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'frames-')), jsonFile = join(dir, 'c.json');
    writeFileSync(join(dir, 'gold.9.png'), 'x');
    const opts = { rawDir: dir, jsonFile };
    expect(await addFrame('mine', await solid(48, 48, [0, 0, 255, 255]), opts)).toMatchObject({ status: 400 });
    expect(await addFrame('gold', await solid(50, 50, [0, 0, 255, 255]), opts)).toMatchObject({ status: 409 });
    expect(await addFrame('Mine', await solid(50, 50, [0, 0, 255, 255]), opts)).toMatchObject({ name: "mine" });
    expect(existsSync(join(dir, 'mine.9.png'))).toBe(true);
    expect(JSON.parse(readFileSync(jsonFile, 'utf8')).mine.accent).toBe('#0000ff');
    expect(await addFrame('mine', await solid(50, 50, [0, 255, 0, 255]), opts)).toMatchObject({ name: "mine" });   // custom frames can be replaced
  });
});
