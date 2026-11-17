// PWA icons from the Android launcher art. Run: node scripts/make-icons.mjs
import sharp from 'sharp';
const SRC = 'public/assets/raw/ico.png', OUT = 'public/icons';
const { data } = await sharp(SRC).extract({ left: 0, top: 0, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
const bg = { r: data[0], g: data[1], b: data[2], alpha: 1 }; // corner colour of the art
for (const size of [192, 512]) await sharp(SRC).resize(size, size, { kernel: 'lanczos3' }).png().toFile(`${OUT}/icon-${size}.png`);
await sharp(SRC).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);
// maskable: artwork inside the central 80% safe zone on the same background
const inner = await sharp(SRC).resize(410, 410).toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } }).composite([{ input: inner, left: 51, top: 51 }]).png().toFile(`${OUT}/icon-maskable-512.png`);
console.log('icons done, bg', bg);
