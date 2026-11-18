import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FIELD_H, FIELD_W, THROWER, type GameMode } from '../domain';
import { RockGame } from '../screens/RockGame';
import { penView } from './penView';

const FLY_MS = 700, FADE_MS = 300;
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

    // where Bóbr is now and where the game draws him (his sprite is drawn at its own pixel size, scaled like the field)
    const nw = sprite.naturalWidth, nh = sprite.naturalHeight, sr = sprite.getBoundingClientRect();
    const c0 = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 }, s0 = sr.width / nw;
    const k = g.width / FIELD_W;
    const c1 = { x: er.left + g.left + THROWER.x * k, y: er.top + THROWER.y * k };
    void cr;
    const img = document.createElement('img');
    img.src = sprite.src; img.className = 'pen-game-bobr'; img.alt = ''; img.setAttribute('aria-hidden', 'true');
    img.style.width = `${nw}px`; img.style.height = `${nh}px`;
    const at = (c: { x: number; y: number }, sx: number, sy: number) => `translate(${c.x - nw / 2}px, ${c.y - nh / 2}px) scale(${sx}, ${sy})`;
    img.style.transform = at(c0, face * s0, s0);
    document.body.appendChild(img);
    clone.current = img;

    void img.offsetWidth;   // start from where he stands
    later(() => {
      img.style.transition = `transform ${FLY_MS}ms cubic-bezier(.45,0,.2,1)`;
      img.style.transform = at(c1, k, k);   // he turns round, walks left and shrinks
    }, 60);
    later(() => setHold(false), 60 + FLY_MS);          // the field fades in over him and the game starts
    later(() => { img.style.transition = 'none'; img.remove(); clone.current = null; }, 60 + FLY_MS + 400);
    return cleanup;
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
