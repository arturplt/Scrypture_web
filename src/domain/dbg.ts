/**
 * Bisect switches for problems seen on one device only: each turns a feature off (or, for msaa, on), so a bug can be pinned to a feature without a rebuild. They are checkboxes in the world menu's
 * Debug section (kept in this browser), and `?dbg=nolayer,nocycle,...` in the address adds to them.
 *   nolayer   texture borrowing across terrace layers off        nocycle   plain colour ramp (no per-layer colours)
 *   nofarsink far levels not sunk under the finer ground          nostipple hard near/far hand-over, no noise stipple
 *   nosea     sea as a flat opaque sheet at sea level             nopond    weather water on the beach not sunk (applies to water made after the change)
 *   nowalls   terrace walls not drawn                             msaa      4x multisampled scene (needs the glow pass)
 *   nolod     all the far-ground culling off at once (nofacecull + notilecull): the old way, everything drawn, for comparing frame rates
 *   nofacecull every planet face is drawn, even those over the horizon (they are skipped otherwise)
 *   notilecull planet faces are drawn whole, not tile by tile (a tile over the horizon or outside the view is skipped otherwise)
 *   nonearcull the real chunks round the plane are all drawn, even those outside the view or over the horizon (they are skipped otherwise); also off with nolod
 *   nosoftcam the camera clears the stepped ground (it jumps a step at every ledge) instead of the smooth one
 * Read on the page's thread only (the chunk worker never sees them).
 */
export const DBG_FLAGS = ['nolayer', 'nocycle', 'nofarsink', 'nostipple', 'nosea', 'nopond', 'nowalls', 'msaa', 'nosoftcam', 'nolod', 'nofacecull', 'notilecull', 'nonearcull'] as const;
export type DbgFlag = typeof DBG_FLAGS[number];
const KEY = 'scrypture:dbg';

function read(): Set<string> {
  const out = new Set<string>();
  if (typeof location !== 'undefined') for (const src of [location.search, location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '']) {
    const v = new URLSearchParams(src).get('dbg');
    if (v) for (const f of v.split(',')) out.add(f.trim());
  }
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? '[]'); if (Array.isArray(s)) for (const f of s) if (typeof f === 'string') out.add(f); } catch { /* none kept */ }
  return out;
}
const flags = read();
export const dbgOn = (f: DbgFlag): boolean => flags.has(f);
/** Turn a switch on or off (kept for the next visit). */
export function setDbg(f: DbgFlag, on: boolean): void {
  if (on) flags.add(f); else flags.delete(f);
  try { localStorage.setItem(KEY, JSON.stringify([...flags])); } catch { /* private window: not kept */ }
}
/** The switches as a bit set for the shaders: bit i is DBG_FLAGS[i]. */
export const dbgBits = (): number => DBG_FLAGS.reduce((n, f, i) => (flags.has(f) ? n | (1 << i) : n), 0);
