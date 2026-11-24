import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from './CompleteFx';

/** How long the XP stars take to fly from Bóbr to the level bar (the bar fills when they land), ms. */
export const XP_FLY_MS = 750;
const STAGGER_MS = 45;

/** The XP the Home level bar last showed, kept while the app is open: coming back to Home with more makes the stars fly. */
let seenXp: number | null = null;

/**
 * The XP the level bar should show right now, and the flight of stars that brings it up to `xp`: when XP grew since Home last
 * showed it (a task done on another screen, a game won in the pen), stars fly from `from` to the bar and the bar fills as they
 * land. `paused` (a game covering the pen) holds the flight until it is gone.
 */
export function useXpRush(xp: number, paused: boolean) {
  const [shown, setShown] = useState(() => (seenXp != null && seenXp < xp ? seenXp : xp));
  const [rush, setRush] = useState<{ gain: number; key: number } | null>(null);
  useEffect(() => {
    if (xp <= shown) { if (xp < shown) setShown(xp); seenXp = xp; return; }   // (an undo takes XP back: no stars for that)
    if (paused || rush) return;
    if (prefersReducedMotion()) { setShown(xp); seenXp = xp; return; }
    setRush({ gain: xp - shown, key: Date.now() });
  }, [xp, shown, paused, rush]);
  useEffect(() => {
    if (!rush) return;
    const land = setTimeout(() => { setShown(s => s + rush.gain); seenXp = (seenXp ?? 0) + rush.gain; }, XP_FLY_MS + STAGGER_MS * 4);
    const done = setTimeout(() => setRush(null), XP_FLY_MS + STAGGER_MS * starCount(rush.gain) + 200);
    return () => { clearTimeout(land); clearTimeout(done); };
  }, [rush]);
  useEffect(() => () => { seenXp = Math.max(seenXp ?? 0, shown); }, [shown]);
  return { shown, rush };
}

const starCount = (gain: number) => Math.max(3, Math.min(14, Math.ceil(gain / 4)));

/** The stars themselves: four-point pixel stars on an arc from `from` (Bóbr's pen) to `to` (the level bar), drawn over everything. */
export function XpStars({ gain, from, to }: { gain: number; from: HTMLElement | null; to: HTMLElement | null }) {
  const [pts, setPts] = useState<CSSProperties[]>([]);
  useLayoutEffect(() => {
    if (!from || !to) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const sx = a.left + a.width / 2, sy = a.top + a.height * 0.55;
    const n = starCount(gain);
    setPts(Array.from({ length: n }, (_, i) => {
      const k = n > 1 ? i / (n - 1) : 0.5;
      const ex = b.left + b.width * (0.15 + 0.7 * k), ey = b.top + b.height / 2;
      const spread = (k - 0.5) * a.width * 0.5;
      const mx = (sx + ex) / 2 + spread, my = Math.min(sy, ey) - 30 - (i % 3) * 12;   // up and over, fanning out a little
      return { '--sx': `${Math.round(sx)}px`, '--sy': `${Math.round(sy)}px`, '--mx': `${Math.round(mx)}px`, '--my': `${Math.round(my)}px`, '--ex': `${Math.round(ex)}px`, '--ey': `${Math.round(ey)}px`, '--d': `${i * STAGGER_MS}ms`, '--t': `${XP_FLY_MS}ms` } as CSSProperties;
    }));
  }, [gain, from, to]);
  return createPortal(<>{pts.map((s, i) => <i key={i} className="xp-star" style={s} aria-hidden />)}</>, document.body);
}

/** Bóbr's speech bubble over the pen: a short line every half minute; tapping it opens the chat. */
export function BobrBubble({ text, onClick, label }: { text: string; onClick: () => void; label: string }) {
  return <button type="button" className="bobr-say" role="status" aria-label={`${label}: ${text}`} onClick={onClick}><span>{text}</span></button>;
}
