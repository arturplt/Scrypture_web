import { useCallback, useEffect, useRef, useState } from 'react';
import { newWalker, stepWalker } from '../domain/wander';
import { penView } from './penView';
import { ITEM_SPRITE, MAX_SPAWNED, SPAWN_MAX_MS, SPAWN_MIN_MS, SPAWN_TTL_MS, HOME_ITEMS, type BobrStage, type Emotion, type ItemId } from '../domain';
import { actions } from '../data/hooks';
import { BobrView } from './BobrView';
import { useUi } from './useUi';
import { useLongPress } from './misc';

/** The Start Here sign stands on the ground and slides with it; it loops once the pen plus the sign's own width has gone by, so it leaves fully out of sight on one side and walks in from the other (no jump on screen). */
const SIGN_AT = 0.25;
/** Forward in the meadow he is drawn this much lower (of the card's height) and this much bigger at depth 1; the sign stands at SIGN_DEPTH. */
const DEPTH_DROP = 0.28, DEPTH_GROW = 0.5, SIGN_DEPTH = 0.64;   // (the sign's base is at 0.87 of the card's height: see app.css; his feet are at --g, 0.69, and go DEPTH_DROP further down)

/** One of Bóbr's choices: a sprite (`wide`: shown at 2x), its label, and what it does. */
export interface PenChoice { icon: string; label: string; onClick: () => void; wide?: boolean; text?: string }

interface Spawned { id: number; itemId: ItemId; x: number }   // x: where it lies, in pen widths along the pen's endless ground

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Bóbr wanders (see domain/wander.ts) and items appear on the ground ahead of him every 8-15s, gone after 20s unless he reaches
 * them or they are tapped. The scenery follows `penView.pos`; the items slide with the ground, so they come closer as he walks.
 */
function usePen(root: React.RefObject<HTMLDivElement>) {
  const [items, setItems] = useState<Spawned[]>([]);
  const itemsRef = useRef<Spawned[]>([]); itemsRef.current = items;
  const els = useRef(new Map<number, HTMLElement>());
  const walker = useRef(newWalker());
  const counter = useRef(0);

  const collect = useCallback((it: Spawned) => {
    setItems(cur => cur.filter(i => i.id !== it.id));
    actions.collectItem(it.itemId);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const ttls = new Set<ReturnType<typeof setTimeout>>();
    const still = reducedMotion();
    const schedule = () => {
      timer = setTimeout(() => {
        const side = Math.random() < 0.7 ? walker.current.dir : -walker.current.dir, away = still ? 0.12 + Math.random() * 0.25 : 0.55 + Math.random() * 0.25;   // just past the edge of the pen, mostly the way he is heading
        const item: Spawned = { id: counter.current++, itemId: HOME_ITEMS[Math.floor(Math.random() * HOME_ITEMS.length)], x: walker.current.pos + side * away };
        setItems(cur => (cur.length >= MAX_SPAWNED ? cur : [...cur, item]));
        const ttl = setTimeout(() => { ttls.delete(ttl); setItems(cur => cur.filter(i => i.id !== item.id)); }, SPAWN_TTL_MS);
        ttls.add(ttl);
        schedule();
      }, SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS));
    };
    schedule();

    let raf = 0, last = performance.now(), shown = '';
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      const el = root.current, w = walker.current, list = itemsRef.current;
      if (el) {
        const W = el.closest('.pen-card')?.clientWidth || el.clientWidth || 300;
        if (!still && !penView.hold) {
          const got = stepWalker(w, dt, list.map(i => i.x));
          if (got >= 0) collect(list[got]);
        }
        penView.pos = w.pos; penView.width = W;
        if (!penView.hold) {   // forward in the meadow: lower and bigger (he is drawn from his feet); in front of the Start Here sign once he is past where it stands
          const H = el.closest('.pen-card')?.clientHeight || W * 1.11, z = 1 + w.depth * DEPTH_GROW;
          el.style.setProperty('--dy', `${w.depth * DEPTH_DROP * H}px`); el.style.setProperty('--zs', z.toFixed(3));
          const front = w.depth > SIGN_DEPTH;
          if (el.dataset.front !== String(front)) { el.dataset.front = String(front); const hit = el.querySelector<HTMLElement>('.pen-hit'); if (hit) hit.style.zIndex = front ? '2' : '0'; }
        }
        const look = `${w.act} ${w.face}`;
        if (look !== shown) { shown = look; el.dataset.act = w.act; el.dataset.face = String(w.face); }
        const sign = el.querySelector<HTMLElement>('.pen-sign');
        if (sign) {   // it wraps just beyond the edges of the pen row, which is what clips it (measured, since the card's padding differs by layout), so it is out of sight while it jumps
          const row = el.closest<HTMLElement>('.pen-row'), scene = el.closest('.pen-card')?.querySelector('.scene')?.getBoundingClientRect(), rr = row?.getBoundingClientRect();
          if (row && scene && rr) {   // the row clips its sides, but the scenery reaches further out: widen the clip to the scenery's edges so the sign is seen all the way across
            const clip = `inset(calc(-40 * var(--u)) ${Math.min(0, rr.right - scene.right)}px calc(-32 * var(--u)) ${Math.min(0, scene.left - rr.left)}px)`;
            if (row.dataset.clip !== clip) { row.dataset.clip = clip; row.style.clipPath = clip; }
          }
          const card = scene ?? el.closest('.pen-row')?.getBoundingClientRect(), me = el.getBoundingClientRect();
          const mid = me.left + me.width / 2, half = sign.offsetWidth / 2 + 8;
          const lo = (card ? card.left - mid : -W / 2) - half, span = (card ? card.width : W) + half * 2;
          // it stands on a seam of the meadow (where one mirrored copy of the picture meets the next), so the join is hidden behind it: seams are one picture-width apart and slide with the ground
          const m = el.closest('.pen-card')?.querySelector('.scene-meadow img')?.getBoundingClientRect();
          let x: number;
          if (m && m.width > 20) {
            const seamSpan = m.width * Math.max(1, Math.ceil(span / m.width));
            x = lo + ((((m.left - mid) - lo) % seamSpan) + seamSpan) % seamSpan;
          } else x = lo + ((((SIGN_AT - w.pos) * W - lo) % span) + span) % span;
          sign.style.transform = `translateX(calc(-50% + ${x}px))`;
        }
        list.forEach(it => { const e = els.current.get(it.id); if (e) e.style.transform = `translateX(calc(-50% + ${(it.x - w.pos) * W}px))`; });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { clearTimeout(timer); ttls.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [root, collect]);

  return { items, collect, els };
}

export function BobrPen({ stage, emotion, onChat, chatLabel, onBobr, bobrLabel, bobrOn, onFly, onFlyHold, flyLabel, onSign, signLabel, choice }: { /** tapping Bóbr offers two things, one each side of him (first trade or play, then which game) */ choice?: { open: boolean; left: PenChoice; right: PenChoice }; /** the Start Here sign on the ground */ onSign?: () => void; signLabel?: string; /** a paper plane in the corner: straight back into the flying world */ onFly?: (from: HTMLElement) => void; /** press and hold on the plane: pick a world instead */ onFlyHold?: () => void; flyLabel?: string; /** tapping Bóbr (opens / closes the trade) */ onBobr?: () => void; bobrLabel?: string; bobrOn?: boolean; stage: BobrStage; emotion: Emotion; /** a speech bubble over Bóbr that opens the chat */ onChat?: () => void; chatLabel?: string }) {
  const flyHeld = useRef(false);
  const flyHold = useLongPress(onFlyHold && (() => { flyHeld.current = true; onFlyHold(); }));
  const root = useRef<HTMLDivElement>(null);
  const { items, collect, els } = usePen(root);
  const { px } = useUi();
  const open = !!choice?.open;
  const [mounted, setMounted] = useState(open);   // the choices stay on while they play their leaving animation
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const id = setTimeout(() => setMounted(false), reducedMotion() ? 0 : 250);
    return () => clearTimeout(id);
  }, [open]);
  return (
    <div className="pen" ref={root} data-act="idle" data-face="1">
      {onBobr
        ? <div className="pen-hit" role="button" tabIndex={0} aria-label={bobrLabel} aria-pressed={bobrOn} onClick={onBobr} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBobr(); } }}><BobrView stage={stage} emotion={emotion} /></div>
        : <BobrView stage={stage} emotion={emotion} />}
      {onSign && <button type="button" className="pen-sign" aria-label={signLabel} title={signLabel} onClick={onSign}><img className="pixel" src="/assets/raw/starthere.png" width={px(90)} alt="" /></button>}
      {choice && mounted && ([['left', choice.left], ['right', choice.right]] as const).map(([side, c]) => (
        <button key={side} type="button" className={`pen-choice ${side} ${c.wide ? 'wide' : ''} ${open ? '' : 'out'}`} disabled={!open} aria-label={c.label} title={c.label} onClick={c.onClick}>
          <img className="pixel" src={`/assets/raw/${c.icon}.png`} alt="" />{c.text && <span className="pen-choice-text">{c.text}</span>}
        </button>
      ))}
      {onFly && <button type="button" className="pen-fly" aria-label={flyLabel} title={flyLabel} {...flyHold} onClick={e => { if (flyHeld.current) { flyHeld.current = false; return; } onFly(e.currentTarget); }}><img className="pixel" src="/assets/raw/airplane.png" width={px(36)} alt="" /></button>}
      {onChat && <button type="button" className="pen-chat" aria-label={chatLabel} title={chatLabel} onClick={onChat}><img className="pixel" src="/assets/raw/chat_bubble_blue.png" width={px(36)} alt="" /></button>}
      {items.map(it => (
        <button key={it.id} ref={e => { if (e) els.current.set(it.id, e); else els.current.delete(it.id); }} className="spawn ground" aria-label={`Collect ${it.itemId}`}
          style={{ transform: 'translateX(-50%)' }} onClick={() => collect(it)}>
          <img className="pixel" src={`/assets/raw/${ITEM_SPRITE[it.itemId]}.png`} width={px(32)} height={px(32)} alt="" />
        </button>
      ))}
    </div>
  );
}
