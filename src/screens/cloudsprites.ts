/** The cloud pictures for the sprite clouds (water cycle, thermals, decorative sky): public/assets/Clouds, shrunk to a handful of small sprites. */
export const CLOUD_W = 256, CLOUD_H = 85;   // (the pictures are 543 x 181, three to one)
export const CLOUD_ASPECT = CLOUD_H / CLOUD_W;
const NAMES = ['Cumulus1', 'Cumulus2', 'Cumulus3', 'Stratocumulus1', 'Stratocumulus2', 'Stratocumulus3'];

/** Filled by `loadCloudSprites`; empty until then (or if nothing loads), and every drawing site skips clouds while it is. */
export const cloudSprites: HTMLCanvasElement[] = [];

/** High, thin cirrus for the 3D sky's top layer (kept apart from `cloudSprites`: rain and thermal clouds never use them). */
export const cirrusSprites: HTMLCanvasElement[] = [];

/** The same pictures as flat black shapes (the ground shadows), in the same order. */
export const cloudShadows: HTMLCanvasElement[] = [];
export const shadowOf = (c: HTMLCanvasElement) => { const i = cloudSprites.indexOf(c); return cloudShadows[i] ?? c; };
export function silhouette(c: HTMLCanvasElement) {
  const s = document.createElement('canvas'); s.width = c.width; s.height = c.height;
  const g = s.getContext('2d')!; g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, s.width, s.height);
  return s;
}

/** One sprite for a number (a cloud's id, a cluster's cell): the same number always gets the same picture. */
export const cloudPick = (n: number) => cloudSprites[Math.abs(Math.floor(n)) % cloudSprites.length];

export function loadCloudSprites(): Promise<void> {
  if (cloudSprites.length) return Promise.resolve();
  const base = `${import.meta.env.BASE_URL}assets/Clouds/pixelite-543x181-`;
  const load = (names: string[], into: HTMLCanvasElement[], shadows?: HTMLCanvasElement[]) => Promise.all(names.map(n => new Promise<HTMLCanvasElement | null>(res => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = CLOUD_W; c.height = CLOUD_H;
      const g = c.getContext('2d')!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(im, 0, 0, CLOUD_W, CLOUD_H);
      res(c);
    };
    im.onerror = () => res(null);
    im.src = `${base}${n}.png`;
  }))).then(list => { for (const c of list) if (c) { into.push(c); shadows?.push(silhouette(c)); } });
  return Promise.all([load(NAMES, cloudSprites, cloudShadows), load(['Cirrus2', 'Cirrus3'], cirrusSprites)]).then(() => undefined);
}

// ---- the skybox bands: every picture in public/assets/Clouds, laid out across three 4096 x 683 bands (180 degrees wide, 30 tall: half the sky, repeated, never mirrored) ----------------------
const BAND_W = 4096, BAND_H = 683;
const dir = `${import.meta.env.BASE_URL}assets/Clouds/pixelite-`;
/** Which pictures each layer scatters, and across which rows of its band (0 = top .. 1 = bottom, where the horizon side is). */
const BANDS: { files: string[]; count: number; rows: [number, number]; scale: [number, number] }[] = [
  { files: ['128x64-Cirrus2', '543x181-Cirrus2', '543x181-Cirrus3'], count: 11, rows: [0.0, 0.8], scale: [0.8, 1.5] },                                                                     // cirrus, high
  { files: ['543x181-Stratocumulus1', '543x181-Stratocumulus2', '543x181-Stratocumulus3', '538x185-Stratocumulus_xl', '499x197-Stratocumulus_l', '385x123-Stratocumulus_m', '443x221-Stratocumulus_xs'], count: 17, rows: [0.1, 1.0], scale: [0.7, 1.4] },   // stratocumulus, middle
  { files: ['543x181-Cumulus1', '543x181-Cumulus2', '543x181-Cumulus3', '134x40-Stratocumulus_s', '134x49-Stratocumulus_xs', '385x123-Stratocumulus_m'], count: 19, rows: [0.3, 1.0], scale: [0.6, 1.4] },   // cumulus and little puffs, low
];

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** The three skybox cloud bands (cirrus, stratocumulus, cumulus), built from all the pictures: each is scattered in its own rows with a fixed seed, so the sky is the same every time. */
export function loadSkyBands(): Promise<HTMLCanvasElement[]> {
  const names = [...new Set(BANDS.flatMap(b => b.files))];
  const imgs = new Map<string, HTMLImageElement>();
  return Promise.all(names.map(n => new Promise<void>(res => { const im = new Image(); im.onload = () => { imgs.set(n, im); res(); }; im.onerror = () => res(); im.src = `${dir}${n}.png`; })))
    .then(() => BANDS.map((b, bi) => {
      const c = document.createElement('canvas'); c.width = BAND_W; c.height = BAND_H;
      const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
      const r = rng(1234 + bi * 77), have = b.files.filter(f => imgs.has(f));
      if (!have.length) return c;
      const slotW = BAND_W / b.count;
      for (let k = 0; k < b.count; k++) {
        const im = imgs.get(have[Math.floor(r() * have.length)])!;
        const small = im.width < 200, sc = (b.scale[0] + r() * (b.scale[1] - b.scale[0])) * (small ? 2.4 : 1);
        const w = Math.round(im.width * sc), h = Math.round(im.height * sc);
        const x = Math.round((k * slotW + (r() - 0.5) * slotW * 0.9 + BAND_W) % BAND_W);   // (one per slot, nudged; wraps round the edge, so the band joins itself)
        const rowMin = b.rows[0] * BAND_H, rowMax = Math.max(rowMin, b.rows[1] * BAND_H - h);
        const y = Math.round(rowMin + r() * (rowMax - rowMin)), flip = r() < 0.5;   // (each picture faces either way, so no two read as the same cloud)
        g.globalAlpha = 0.78 + r() * 0.22;
        for (const dx of x + w > BAND_W ? [0, -BAND_W] : [0]) {
          g.save(); g.translate(x + dx + (flip ? w : 0), y); g.scale(flip ? -1 : 1, 1); g.drawImage(im, 0, 0, w, h); g.restore();
        }
      }
      g.globalAlpha = 1;
      return c;
    }));
}
