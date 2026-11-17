import { tintImage } from './tintFrame';

/**
 * Wide pixel-art boxes without smearing. A 9-slice sprite stretched across a 700px button turns its edges and textured centre
 * into long streaks. This builds two images from the sprite, in the browser:
 *  - `border`: the corners plus each edge piece tiled (repeated, mirrored or randomly flipped), so `border-image-repeat: repeat`
 *    never stretches it;
 *  - `centre`: the middle of the sprite as a small tile grid, used as a repeating background (never stretched).
 * `tw`/`th` are the centre tile's size in sprite pixels (draw it at the same 2x as the border).
 */
export type BoxMode = 'repeat' | 'mirror' | 'random';
export interface BoxSprite { border: string; centre: string; tw: number; th: number }

const pending = new Map<string, Promise<BoxSprite>>();
const ready = new Map<string, BoxSprite>();
const keyOf = (src: string, slice: number, mode: BoxMode, hue = 0) => `${src}|${slice}|${mode}|${hue}`;

/** Already built? (lets a repeat render use it immediately). */
export const boxSpriteNow = (src: string, slice: number, mode: BoxMode = 'mirror', hue = 0) => ready.get(keyOf(src, slice, mode, hue));

/** Small seeded generator, so a "random" box looks the same on every load. */
function rng(seedText: string) {
  let h = 2166136261; for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function boxSprite(src: string, slice: number, mode: BoxMode = 'mirror', hue = 0): Promise<BoxSprite> {
  const key = keyOf(src, slice, mode, hue);
  let p = pending.get(key);
  if (!p) {
    p = (hue ? tintImage(src, null, null, { hue }) : Promise.resolve(src)).then(realSrc => new Promise<BoxSprite>((resolve, reject) => {   // a colour variant is built from the hue-shifted sprite
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight, s = slice, cw = w - 2 * s, ch = h - 2 * s;
        const rand = rng(key);
        // flip flags per tile along the horizontal edges (fx) and the vertical edges (fy); the centre grid is fx.length x fy.length
        const flags = (n: number) => (mode === 'repeat' ? [false] : mode === 'mirror' ? [false, true] : Array.from({ length: n }, (_, i) => (i === 0 ? false : rand() < 0.5)));
        const fx = flags(6), fy = flags(6), nx = fx.length, ny = fy.length;
        const canvas = (cw2: number, ch2: number) => { const c = document.createElement('canvas'); c.width = cw2; c.height = ch2; return c; };
        /** draw a region of the sprite, optionally mirrored, at (dx, dy) */
        const put = (g: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, flipX = false, flipY = false) => {
          g.save(); g.translate(dx + (flipX ? sw : 0), dy + (flipY ? sh : 0)); g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh); g.restore();
        };
        // border: corners + tiled edges, empty middle
        const b = canvas(2 * s + nx * cw, 2 * s + ny * ch), bg = b.getContext('2d')!;
        put(bg, 0, 0, s, s, 0, 0); put(bg, w - s, 0, s, s, s + nx * cw, 0);
        put(bg, 0, h - s, s, s, 0, s + ny * ch); put(bg, w - s, h - s, s, s, s + nx * cw, s + ny * ch);
        for (const [sy, dy] of [[0, 0], [h - s, s + ny * ch]] as const) fx.forEach((f, i) => put(bg, s, sy, cw, s, s + i * cw, dy, f));       // top and bottom
        for (const [sx, dx] of [[0, 0], [w - s, s + nx * cw]] as const) fy.forEach((f, j) => put(bg, sx, s, s, ch, dx, s + j * ch, false, f));  // left and right
        // centre: grid of tiles
        const c = canvas(nx * cw, ny * ch), cg = c.getContext('2d')!;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const rx = mode === 'random' ? i > 0 && rand() < 0.5 : fx[i], ry = mode === 'random' ? j > 0 && rand() < 0.5 : fy[j];
          put(cg, s, s, cw, ch, i * cw, j * ch, rx, ry);
        }
        const sp = { border: b.toDataURL(), centre: c.toDataURL(), tw: nx * cw, th: ny * ch };
        ready.set(key, sp); resolve(sp);
      };
      img.onerror = reject; img.src = realSrc;
    }));
    pending.set(key, p);
  }
  return p;
}
/** CSS variables for a sprite under `--<prefix>-b/-c/-w/-h`; `initial` (= unset, so the CSS fallbacks apply) until it is built. */
export function boxVars(prefix: string, sp?: BoxSprite): Record<string, string> {
  return sp
    ? { [`--${prefix}-b`]: `url(${sp.border})`, [`--${prefix}-c`]: `url(${sp.centre})`, [`--${prefix}-w`]: String(sp.tw), [`--${prefix}-h`]: String(sp.th) }
    : { [`--${prefix}-b`]: 'initial', [`--${prefix}-c`]: 'initial', [`--${prefix}-w`]: 'initial', [`--${prefix}-h`]: 'initial' };
}
