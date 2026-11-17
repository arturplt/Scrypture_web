// Draws the berry item (public/assets/raw/berry.png and public/assets/items/berry.png): 32 x 32 pixel art, saved at 2x like the
// other item pictures. Run: node scripts/make-berry.mjs
import sharp from 'sharp';

const N = 32, px = new Uint8Array(N * N * 4);
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const put = (x, y, h) => { if (x < 0 || y < 0 || x >= N || y >= N) return; const [r, g, b] = hex(h), i = (y * N + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
const OUT = '#3a0f24', DARK = '#8e1740', MID = '#c2264f', LIGHT = '#e8506f', SHINE = '#ffd3da';

/** A round berry lit from the top left, with a dark rim. */
function berry(cx, cy, r) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r + 0.5) continue;
    if (d > r - 0.6) { put(x, y, OUT); continue; }
    const lit = ((cx - x) + (cy - y)) / r;                 // 1.4 top left .. -1.4 bottom right
    put(x, y, lit > 0.55 ? LIGHT : lit < -0.5 ? DARK : MID);
  }
  put(Math.round(cx - r * 0.4), Math.round(cy - r * 0.45), SHINE); put(Math.round(cx - r * 0.4) + 1, Math.round(cy - r * 0.45), SHINE);
  put(Math.round(cx - r * 0.4), Math.round(cy - r * 0.45) + 1, SHINE);
}
/** A leaf: a slanted ellipse with a lighter midrib. */
function leaf(cx, cy, rx, ry, slant) {
  for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
    const u = x + y * slant, e = (u * u) / (rx * rx) + (y * y) / (ry * ry);
    if (e > 1.25) continue;
    put(Math.round(cx + x), Math.round(cy + y), e > 0.8 ? '#1f4d24' : Math.abs(y) < 0.6 ? '#7cc45a' : '#3f8f3a');
  }
}
for (const [x, y] of [[15, 9], [15, 8], [16, 7], [16, 6], [17, 5], [17, 4]]) { put(x, y, '#5a3a1a'); put(x + 1, y, '#3d2610'); }   // the stem
leaf(10, 7, 5, 2.4, 0.35); leaf(22, 8, 4.5, 2.2, -0.4);
berry(21, 17, 6); berry(10, 17, 6.5); berry(16, 23, 7);

const png = await sharp(Buffer.from(px), { raw: { width: N, height: N, channels: 4 } }).resize(64, 64, { kernel: 'nearest' }).png().toBuffer();
for (const dir of ['raw', 'items']) await sharp(png).toFile(`public/assets/${dir}/berry.png`);
console.log('berry.png written');
