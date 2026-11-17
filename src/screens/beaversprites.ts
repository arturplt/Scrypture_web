/**
 * The beaver pictures: the male's eight walk frames (public/assets/beavers, drawn facing east) and the idle stills of the male and the
 * female (src/assets, about 10x enlarged pixel art). All are shrunk to one cell size and stood on its bottom middle.
 * The female has no walk frames yet: she is drawn with her idle still wherever she goes.
 */
import maleIdleUrl from '../assets/male_idle.png';
import femaleIdleUrl from '../assets/female_idle.png';
import babyIdleUrl from '../assets/baby_idle.png';
import youngIdleUrl from '../assets/young_idle.png';
import { stageOf, type Beaver } from '../domain/beavers';

export const BEAVER_W = 50, BEAVER_H = 44;
export const BEAVER_ASPECT = BEAVER_H / BEAVER_W;
export const WALK_FRAMES = 8;
/** Places in `beaverSprites` (and in the 3D atlas): the walk frames first, then the two stills. */
export const BEAVER_MALE_IDLE = WALK_FRAMES, BEAVER_FEMALE_IDLE = WALK_FRAMES + 1, BEAVER_BABY_IDLE = WALK_FRAMES + 2, BEAVER_YOUNG_IDLE = WALK_FRAMES + 3;

/**
 * Which picture a beaver is drawn with, how big (against an adult, whose picture is 1.5 tiles wide) and whether it hops as it
 * goes. Only the adult male has walk frames; the others slide on their idle still, and bob a little when they move.
 */
export function beaverLook(b: Pick<Beaver, 'sex' | 'age' | 'moving' | 'phase'>): { cell: number; size: number; hops: boolean } {
  const st = stageOf(b.age);
  if (st === 'baby') return { cell: BEAVER_BABY_IDLE, size: 0.5, hops: true };
  if (st === 'young') return { cell: BEAVER_YOUNG_IDLE, size: 0.75, hops: true };
  return { cell: b.sex === 'f' ? BEAVER_FEMALE_IDLE : b.moving ? Math.floor(b.phase * 10) % WALK_FRAMES : BEAVER_MALE_IDLE, size: 1, hops: b.sex === 'f' };
}

/** Filled by `loadBeaverSprites`; empty until then (or if a picture is missing): every drawing site skips beavers while it is. */
export const beaverSprites: HTMLCanvasElement[] = [];

const load = (src: string) => new Promise<HTMLImageElement | null>(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });

/**
 * Cut the pictures to what is painted in any of them (one box for the whole set, so an animation does not jump) and shrink them
 * into the cell. The stills have faint specks near their edges, so only pixels at least `alphaMin` solid count as painted.
 */
function fit(images: HTMLImageElement[], alphaMin: number): HTMLCanvasElement[] {
  const srcs = images.map(im => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d', { willReadFrequently: true })!.drawImage(im, 0, 0); return c; });
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (const c of srcs) {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] >= alphaMin) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return srcs.map(src => {
    const c = document.createElement('canvas'); c.width = BEAVER_W; c.height = BEAVER_H;
    if (x1 < 0) return c;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min((BEAVER_W - 2) / bw, (BEAVER_H - 2) / bh), w = Math.round(bw * k), h = Math.round(bh * k);
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    g.drawImage(src, x0, y0, bw, bh, Math.round((BEAVER_W - w) / 2), BEAVER_H - 1 - h, w, h);
    return c;
  });
}

export function loadBeaverSprites(): Promise<void> {
  if (beaverSprites.length) return Promise.resolve();
  const walk = Array.from({ length: WALK_FRAMES }, (_, i) => load(`${import.meta.env.BASE_URL}assets/beavers/male_walk${i + 1}.png`));
  return Promise.all([...walk, load(maleIdleUrl), load(femaleIdleUrl), load(babyIdleUrl), load(youngIdleUrl)]).then(list => {
    if (beaverSprites.length || list.some(im => !im)) return;            // all or nothing: the frames are used by place
    const ims = list as HTMLImageElement[];
    beaverSprites.push(...fit(ims.slice(0, WALK_FRAMES), 64), ...fit([ims[WALK_FRAMES]], 64), ...fit([ims[WALK_FRAMES + 1]], 64), ...fit([ims[WALK_FRAMES + 2]], 64), ...fit([ims[WALK_FRAMES + 3]], 64));
  });
}
