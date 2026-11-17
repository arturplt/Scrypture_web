// Prints the average brightness of each frame centre; frames above ~0.45 need dark button text (see LIGHT_FRAMES in src/ui/themes.ts)
import sharp from 'sharp'; import { readdirSync } from 'node:fs';
const out = [];
for (const f of readdirSync('public/assets/frames')) {
  const { data } = await sharp(`public/assets/frames/${f}`).extract({ left: 16, top: 16, width: 16, height: 16 }).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / n / 255;
  out.push([f.replace('.png', ''), +L.toFixed(2)]);
}
out.sort((a, b) => b[1] - a[1]); console.log(out.map(([n, l]) => `${n}:${l}`).join('  '));
