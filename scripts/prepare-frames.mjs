// Crops Android 50x50 *.9.png frames to the inner 48x48 (drops the 1px transparent border)
// so they can be used directly with CSS border-image-slice: 16.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { buildTiled, seedOf } from './tile-frames.mjs';
import { prepareTicks } from './make-ticks.mjs';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIRS = ['public/assets/raw', 'public/assets/sprites'];
const OUT = 'public/assets/frames';
// mode = how the edges are tiled; `centre` = also weather textured centres (folder suffix -c)
const TILED = [
  { dir: 'public/assets/frames-mirror', mode: 'mirror', centre: false }, { dir: 'public/assets/frames-random', mode: 'random', centre: false },
  { dir: 'public/assets/frames-mirror-c', mode: 'mirror', centre: true }, { dir: 'public/assets/frames-random-c', mode: 'random', centre: true },
];

export async function prepareFrames(log = console.log) {
  await prepareTicks();
  mkdirSync(OUT, { recursive: true });
  for (const v of TILED) mkdirSync(v.dir, { recursive: true });
  for (const dir of DIRS.filter(existsSync)) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.9.png'))) {
      const img = sharp(`${dir}/${f}`);
      const { width, height } = await img.metadata();
      if (width !== 50 || height !== 50) { log(`skip ${f}: ${width}x${height} (frames must be 50x50)`); continue; }
      const name = f.replace('.9.png', '');
      await img.extract({ left: 1, top: 1, width: 48, height: 48 }).toFile(`${OUT}/${name}.png`);
      for (const v of TILED) writeFileSync(`${v.dir}/${name}.png`, await buildTiled(`${OUT}/${name}.png`, v.mode, seedOf(name), v.centre));
      log('frame', f);
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareFrames();
