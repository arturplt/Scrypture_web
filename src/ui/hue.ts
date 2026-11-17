import { useEffect, useState } from 'react';
import { tintImage, tintedNow } from './tintFrame';
export { FRAME_HUES as HUES, splitFrame as splitHue, withHue } from './themes';

/**
 * Colour variants for any sprite: a style id is `name` or `name~degrees` (e.g. `ember~120`, same as frames). The variant is the
 * original sprite with its hue rotated (shading kept), built in the browser, so no extra image files exist.
 */

/** `url(...)` for each sprite path with the hue applied; an entry is undefined with hue 0 or until it is built (use the plain sprite then). */
export function useHuedUrls(srcs: string[], hue: number): (string | undefined)[] {
  const key = `${srcs.join('|')}|${hue}`;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!hue) return;
    let live = true;
    Promise.all(srcs.map(src => tintImage(src, null, null, { hue }))).then(() => { if (live) bump(n => n + 1); }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return srcs.map(src => { const u = hue ? tintedNow(src, null, null, { hue }) : undefined; return u ? `url(${u})` : undefined; });
}
