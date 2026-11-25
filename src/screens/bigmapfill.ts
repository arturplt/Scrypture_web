/** The full-screen map's picture while it fills: which pixels are drawn for the place and zoom it shows, so a pan or zoom keeps what it can. */
export const NO_LAYER = -999;
export interface BigMapFill { w: number; h: number; scale: number; x: number; y: number; row: number; img: { data: Uint8ClampedArray }; ok: Uint8Array; lay: Int16Array; pend: Int32Array; rem: number; todo: number }   // ok: which pixels are drawn for this place and zoom; lay: their layers (a terraced world's contours); pend: the pixels left in each row; rem of todo in all; row: where the filling has got to

/**
 * The map moved (a pan, a zoom, a resize): the new picture starts as the old one seen from the new place (middle (fx, fy) in world tiles, `scale` tiles a pixel). A pixel that is the same pixel of the world
 * (a pan on the same zoom, a whole number of pixels) keeps its colour and counts as done; one the old picture only has at another zoom is kept as a stand-in until its row is filled again; the uncovered
 * strip is dark until filled. So a pan only fills the strip it uncovered, even if it comes while the last fill is half done (the pixels not filled yet stay to be filled), and a zoom is never a blank screen.
 */
export function moveFill(old: BigMapFill | null, mw: number, mh: number, scale: number, fx: number, fy: number, makeImage: (w: number, h: number) => { data: Uint8ClampedArray }): BigMapFill {
  const img = makeImage(mw, mh), nd = img.data, ok = new Uint8Array(mw * mh), lay = new Int16Array(mw * mh).fill(NO_LAYER), pend = new Int32Array(mh).fill(mw);
  nd.fill(10); for (let o = 3; o < nd.length; o += 4) nd[o] = 255;
  let rem = mw * mh;
  if (old) {
    const od = old.img.data, same = old.scale === scale, oxs = new Float64Array(mw);
    for (let i = 0; i < mw; i++) oxs[i] = (fx + (i - mw / 2) * scale - old.x) / old.scale + old.w / 2;
    for (let j = 0; j < mh; j++) {
      const oy = (fy + (j - mh / 2) * scale - old.y) / old.scale + old.h / 2, oj = Math.floor(oy);
      if (oj < 0 || oj >= old.h) continue;
      const exactY = same && Math.abs(oy - oj) < 1e-6;
      for (let i = 0; i < mw; i++) {
        const oi = Math.floor(oxs[i]); if (oi < 0 || oi >= old.w) continue;
        const idx = j * mw + i, oidx = oj * old.w + oi, o = idx * 4, oo = oidx * 4;
        nd[o] = od[oo]; nd[o + 1] = od[oo + 1]; nd[o + 2] = od[oo + 2];
        if (exactY && Math.abs(oxs[i] - oi) < 1e-6 && old.ok[oidx]) { ok[idx] = 1; lay[idx] = old.lay[oidx]; pend[j]--; rem--; }
      }
    }
  }
  return { w: mw, h: mh, scale, x: fx, y: fy, row: 0, img, ok, lay, pend, rem, todo: Math.max(1, rem) };
}
