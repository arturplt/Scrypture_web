/** The fire and lightning pictures (public/assets/Fire): three flame frames cut to their painted part and shrunk to one size, and the bolt. */
export const FLAME_W = 56, FLAME_H = 70;   // (the frames are about 5x enlarged pixel art; this is close to their own size)
export const FLAME_ASPECT = FLAME_H / FLAME_W;
export const BOLT_W = 222, BOLT_H = 111;   // (the bolt is 443 x 221)
export const BOLT_ASPECT = BOLT_H / BOLT_W;
/** Where the bolt's lowest tip is in its picture, from the left (0..1): that point is put on the struck tile. */
export const BOLT_TIP = 0.37;
const FRAMES = ['flame2', 'flame3', 'flame4'];

/** Filled by `loadFireSprites`; empty until then (or if nothing loads): every drawing site skips fire while it is. */
export const flameSprites: HTMLCanvasElement[] = [];
export const boltSprite: { current: HTMLCanvasElement | null } = { current: null };

const load = (name: string) => new Promise<HTMLImageElement | null>(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = `${import.meta.env.BASE_URL}assets/Fire/${name}.png`; });

/** The frames come with different empty borders: each is cut to what is painted and stood on the bottom middle of its cell, so the flame does not jump between frames. */
function fitFlame(im: HTMLImageElement): HTMLCanvasElement {
  const src = document.createElement('canvas'); src.width = im.width; src.height = im.height;
  const sg = src.getContext('2d', { willReadFrequently: true })!; sg.drawImage(im, 0, 0);
  const d = sg.getImageData(0, 0, im.width, im.height).data;
  let x0 = im.width, x1 = -1, y0 = im.height, y1 = -1;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (d[(y * im.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const c = document.createElement('canvas'); c.width = FLAME_W; c.height = FLAME_H;
  if (x1 < 0) return c;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min((FLAME_W - 2) / bw, (FLAME_H - 2) / bh), w = Math.round(bw * k), h = Math.round(bh * k);
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  g.drawImage(src, x0, y0, bw, bh, Math.round((FLAME_W - w) / 2), FLAME_H - 1 - h, w, h);
  return c;
}

export function loadFireSprites(): Promise<void> {
  if (flameSprites.length || boltSprite.current) return Promise.resolve();
  return Promise.all([...FRAMES.map(load), load('thunder')]).then(list => {
    const bolt = list.pop();
    for (const im of list) if (im) flameSprites.push(fitFlame(im));
    if (bolt) { const c = document.createElement('canvas'); c.width = BOLT_W; c.height = BOLT_H; const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(bolt, 0, 0, BOLT_W, BOLT_H); boltSprite.current = c; }
  });
}
