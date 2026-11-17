import { useEffect, useState } from 'react';
import { useAppState } from '../data/hooks';
import { frameUrl, resolveFrame } from './themes';

/**
 * A copy of a pixel-art sprite (a frame or a chip box) whose visible pixels are tinted: the border and the centre can have
 * different colours; transparent pixels (chamfered corners) are left alone and each pixel keeps its own light/dark shading.
 * Cards and chips draw it through the same border-image as the plain sprite, so it lines up exactly - no overlay to clip.
 */
const done = new Map<string, string>();            // finished tints, so a repeat render has them immediately (no flash of the plain sprite)
const pending = new Map<string, Promise<string>>();

/** Any CSS colour (hsl(), #hex, var(--x)) -> [r, g, b], resolved by the browser. */
const rgbOf = (css: string): [number, number, number] => {
  const el = document.createElement('i');
  el.style.color = css; document.body.append(el);
  const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(getComputedStyle(el).color); el.remove();
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
};

/** `ringMix` / `centreMix`: further colours blended into the border / centre colour, [css colour, amount 0..1]. */
/** Rotate a colour's hue by `deg`, keeping its lightness and saturation (so the sprite's shading survives). */
function shiftHue(r: number, g: number, b: number, deg: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
  if (!dl) return [r * 255, g * 255, b * 255];
  const sat = l > 0.5 ? dl / (2 - mx - mn) : dl / (mx + mn);
  let h = mx === r ? (g - b) / dl + (g < b ? 6 : 0) : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
  h = (h * 60 + deg) % 360;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const f = (t: number) => { t = ((t % 360) + 360) % 360; return (t < 60 ? p + (q - p) * t / 60 : t < 180 ? q : t < 240 ? p + (q - p) * (240 - t) / 60 : p) * 255; };
  return [f(h + 120), f(h), f(h - 120)];
}

export interface TintOpts { hue?: number; slice?: number; ring?: number; centre?: number; ringMix?: [string, number][]; centreMix?: [string, number][] }
const keyOf = (src: string, ring: string | null, centre: string | null, o: TintOpts) => `${src}|${ring}|${centre}|${o.slice ?? 16}|${o.ring ?? 0.8}|${o.centre ?? 0.8}|${o.hue ?? 0}|${JSON.stringify([o.ringMix, o.centreMix])}`;

/** An already-built tint (or undefined), so a repeat render has it at once. */
export const tintedNow = (src: string, ring: string | null, centre: string | null, o: TintOpts = {}) => done.get(keyOf(src, ring, centre, o));

export function tintImage(src: string, ring: string | null, centre: string | null, o: TintOpts = {}): Promise<string> {
  const key = keyOf(src, ring, centre, o);
  let p = pending.get(key);
  if (!p) {
    const slice = o.slice ?? 16, sr = o.ring ?? 0.8, sc = o.centre ?? 0.8;
    p = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
        const im = ctx.getImageData(0, 0, w, h), d = im.data;
        const mixed = (base: string | null, mix: [string, number][] = []) => mix.reduce<[number, number, number] | null>((acc, [c, a]) => {
          const m = rgbOf(c); return acc && [0, 1, 2].map(j => acc[j] * (1 - a) + m[j] * a) as [number, number, number];
        }, base ? rgbOf(base) : null);
        const rr = mixed(ring, o.ringMix), cc = mixed(centre, o.centreMix);
        if (o.hue) for (let i = 0; i < d.length; i += 4) if (d[i + 3]) [d[i], d[i + 1], d[i + 2]] = shiftHue(d[i], d[i + 1], d[i + 2], o.hue);   // colour variant first
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const inner = x >= slice && x < w - slice && y >= slice && y < h - slice, rgb = inner ? cc : rr, st = inner ? sc : sr;
          const i = (y * w + x) * 4; if (!rgb || d[i + 3] === 0) continue;               // nothing to tint / invisible pixel (chamfer)
          const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255, k = 0.35 + 1.1 * l;   // keep the bevel shading
          for (let j = 0; j < 3; j++) d[i + j] += (Math.min(255, rgb[j] * k) - d[i + j]) * st;
        }
        ctx.putImageData(im, 0, 0);
        const url = c.toDataURL(); done.set(key, url); resolve(url);
      };
      img.onerror = reject; img.src = src;
    });
    pending.set(key, p);
  }
  return p;
}

/** `url(...)` of `src` tinted (border `ring`, centre `centre`, either may be null); undefined with no colours or until ready. */
export function useTintedImage(src: string, ring: string | null, centre: string | null, o: TintOpts = {}): string | undefined {
  const key = keyOf(src, ring, centre, o), want = !!(ring || centre || o.hue);
  const [url, setUrl] = useState<string | undefined>(() => (want ? done.get(key) : undefined));
  useEffect(() => {
    if (!want) { setUrl(undefined); return; }
    let live = true;
    tintImage(src, ring, centre, o).then(u => { if (live) setUrl(u); }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return want ? (url ?? done.get(key)) && `url(${url ?? done.get(key)})` : undefined;
}

/** `--frame` value for a frame ('app' = the main one) with its border and centre tinted. */
export function useTintedFrame(theme: string, ring: string | null, centre: string | null = null, opts: TintOpts = {}): string | undefined {
  const main = useAppState(s => s.settings.frameTheme), edges = useAppState(s => s.settings.frameEdges), center = useAppState(s => s.settings.frameCenter);
  const r = resolveFrame(theme, main, edges, center);
  const src = /url\((.*)\)/.exec(frameUrl(r.name, r.edges, r.center))![1];
  return useTintedImage(src, ring, centre, { ...opts, hue: r.hue });
}
