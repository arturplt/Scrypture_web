// "Add to collection": a finished 50x50 frame goes into public/assets/raw/<name>.9.png (the source the frame pipeline reads) and is
// listed in src/ui/customFrames.json (accent colour + whether it needs dark button text), which is how the Theme manager learns about it.
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const CUSTOM_JSON = 'src/ui/customFrames.json';
export const RAW_DIR = 'public/assets/raw';
const RESERVED = new Set(['app', 'button_green', 'button_red']);

/** A safe frame name: lower-case letters, digits and underscores. '' when nothing usable is left. */
export const frameName = raw => String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
export const isReserved = name => RESERVED.has(name);

export function readCustom(file = CUSTOM_JSON) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}
export function writeCustom(map, file = CUSTOM_JSON) {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
}

/** Accent colour (average of the border) and whether the centre is bright enough to need dark button text (> 0.45, see frame-luminance.mjs). */
export async function describeFrame(png50) {
  const { data } = await sharp(png50).extract({ left: 1, top: 1, width: 48, height: 48 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0, lr = 0, lg = 0, lb = 0, ln = 0;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const i = (y * 48 + x) * 4, edge = Math.min(x, y, 47 - x, 47 - y);
    if (data[i + 3] <= 200) continue;
    if (edge >= 2 && edge <= 7) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    if (x >= 16 && x < 32 && y >= 16 && y < 32) { lr += data[i]; lg += data[i + 1]; lb += data[i + 2]; ln++; }
  }
  const hex = v => Math.round(v).toString(16).padStart(2, '0');
  const accent = n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : '#888888';
  const light = ln ? (0.2126 * lr + 0.7152 * lg + 0.0722 * lb) / ln / 255 > 0.45 : false;
  return { accent, light };
}

/**
 * Save a 50x50 PNG as a frame. Returns { name } or { error, status }. A name that belongs to a built-in frame (a raw file that
 * is not in the custom list) is never overwritten; a custom frame can be replaced.
 */
export async function addFrame(rawName, png, { rawDir = RAW_DIR, jsonFile = CUSTOM_JSON, prepare = async () => {} } = {}) {
  const name = frameName(rawName);
  if (!name || isReserved(name)) return { error: 'bad name', status: 400 };
  const custom = readCustom(jsonFile);
  if (existsSync(`${rawDir}/${name}.9.png`) && !(name in custom)) return { error: 'exists', status: 409 };
  let meta;
  try { meta = await sharp(png).metadata(); } catch { return { error: 'not an image', status: 400 }; }
  if (meta.width !== 50 || meta.height !== 50) return { error: 'frames must be 50x50', status: 400 };
  const clean = await sharp(png).ensureAlpha().png().toBuffer();
  writeFileSync(`${rawDir}/${name}.9.png`, clean);
  await prepare();
  custom[name] = await describeFrame(clean);
  writeCustom(custom, jsonFile);
  return { name, ...custom[name] };
}
