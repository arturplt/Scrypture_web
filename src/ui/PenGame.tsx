import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BOBR_SCALE, FIELD_H, FIELD_W, THROWER, type GameMode } from '../domain';
import { RockGame } from '../screens/RockGame';
import { penView } from './penView';

const FADE_MS = 300;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Geo { left: number; width: number; height: number }   // the field inside the game layer (px)

/**
 * The rock game played in Bóbr's pen. The pen already has the field's proportions (see Home's CSS), so nothing in the layout changes and nothing
 * is swapped: the pen's scenery (with its leaves and pollen) carries on behind the play, the pen's other contents go, Bóbr's sprite turns round,
 * walks to the left and shrinks to the size and spot he has in the game, and then the field fades in over him and the game starts.
 * `card` is the pen card.
 */
export function PenGame({ card, mode, onClose }: { card: HTMLElement; mode: GameMode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [hold, setHold] = useState(true);
  const [geo, setGeo] = useState<Geo | null>(null);
  const clone = useRef<HTMLImageElement | null>(null);
  useLayoutEffect(() => { penView.hold = true; return () => { penView.hold = false; }; }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const cr = card.getBoundingClientRect(), er = el.getBoundingClientRect();
    const Wf = Math.min(er.width, er.height * (FIELD_W / FIELD_H)), Hf = Wf * (FIELD_H / FIELD_W);
    const g: Geo = { left: (er.width - Wf) / 2, width: Wf, height: Hf };
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
    setGeo(g);

    const sprite = card.querySelector<HTMLImageElement>('.bobr-img');
    const face = Number(card.querySelector<HTMLElement>('.pen')?.dataset.face ?? 1) || 1;
    card.classList.add('pen-playing');   // the pen's own contents (Bóbr, items, buttons) go; the sprite flown below stands in for him
    const cleanup = () => { timers.forEach(clearTimeout); clone.current?.remove(); clone.current = null; card.classList.remove('pen-playing'); };
    if (reduced() || !sprite || !sprite.naturalWidth) { setHold(false); return cleanup; }

    // where his feet are now and where the game puts them; his size follows the way the meadow recedes: smaller towards the horizon, bigger towards the bottom edge
    const nw = sprite.naturalWidth, nh = sprite.naturalHeight, sr = sprite.getBoundingClientRect();
    const k = g.width / FIELD_W;
    const from = { x: sr.left + sr.width / 2, y: sr.bottom, s: sr.width / nw };
    const to = { x: er.left + g.left + THROWER.x * k, y: er.top + (THROWER.y + (nh * BOBR_SCALE) / 2) * k, s: k * BOBR_SCALE };
    const img = document.createElement('img');
    img.src = sprite.src; img.className = 'pen-game-bobr'; img.alt = ''; img.setAttribute('aria-hidden', 'true');
    img.style.width = `${nw}px`; img.style.height = `${nh}px`; img.style.transformOrigin = '50% 100%';
    const put = (x: number, y: number, sx: number, sy: number, rot: number) => { img.style.transform = `translate(${x - nw / 2}px, ${y - nh}px) rotate(${rot}deg) scale(${sx}, ${sy})`; };
    put(from.x, from.y, face * from.s, from.s, 0);
    document.body.appendChild(img);
    clone.current = img;

    // he runs there (wiggling as he does, facing the way he goes), then turns to face the targets
    const dist = Math.hypot(to.x - from.x, to.y - from.y), RUN = Math.min(1700, Math.max(900, 600 + dist * 1.6)), TURN = 180, dir = to.x < from.x - 2 ? -1 : 1;
    const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);   // eases in and out
    let raf = 0, t0 = 0;
    const frame = (now: number) => {
      if (!t0) t0 = now + 80;   // a breath before he sets off
      const el = now - t0;
      if (el < 0) { raf = requestAnimationFrame(frame); return; }
      if (el < RUN) {
        const u = el / RUN, e = ease(u);
        const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e;
        const sc = from.s + (to.s - from.s) * e;   // the size follows how far down he is (the same law as on the way: bigger the nearer the bottom)
        put(x, y, dir * sc, sc, Math.sin(el / 1000 * Math.PI * 2 * 3.2) * 3.5 * Math.sin(Math.PI * u));
      } else if (el < RUN + TURN) {
        const u = (el - RUN) / TURN;
        put(to.x, to.y, to.s * (dir + (1 - dir) * u), to.s, 0);   // turns round on the spot
      } else {
        put(to.x, to.y, to.s, to.s, 0);
        setHold(false);   // the field fades in over him and the game starts
        later(() => { img.remove(); clone.current = null; }, 450);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    later(() => { setHold(false); img.remove(); clone.current = null; }, 80 + RUN + TURN + 1500);   // (a page that is not being drawn runs no frames: the game must still start)
    const stop = cleanup;
    return () => { cancelAnimationFrame(raf); stop(); };
  }, [card]);

  const exit = () => {   // the field fades, then the pen is Bóbr's again
    const el = box.current;
    if (reduced() || !el) { onClose(); return; }
    el.style.transition = `opacity ${FADE_MS}ms ease-out`; el.style.opacity = '0';
    window.setTimeout(onClose, FADE_MS);
  };

  return createPortal(
    <div className="pen-game" ref={box}>
      {geo && <div className="pen-game-field" style={{ left: geo.left, width: geo.width, height: geo.height }}>
        <RockGame mode={mode} embedded={{ hold, onExit: exit }} />
      </div>}
    </div>,
    card,
  );
}
