import { useCallback, useEffect, useRef, useState } from 'react';
import { newWalker, stepWalker } from '../domain/wander';
import { penView } from './penView';
import { ITEM_SPRITE, MAX_SPAWNED, SPAWN_MAX_MS, SPAWN_MIN_MS, SPAWN_TTL_MS, HOME_ITEMS, type BobrStage, type Emotion, type ItemId } from '../domain';
import { actions } from '../data/hooks';
import { BobrView } from './BobrView';
import { useUi } from './useUi';

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
        if (!still) {
          const got = stepWalker(w, dt, list.map(i => i.x));
          if (got >= 0) collect(list[got]);
        }
        penView.pos = w.pos; penView.width = W;
        const look = `${w.act} ${w.face}`;
        if (look !== shown) { shown = look; el.dataset.act = w.act; el.dataset.face = String(w.face); }
        list.forEach(it => { const e = els.current.get(it.id); if (e) e.style.transform = `translateX(calc(-50% + ${(it.x - w.pos) * W}px))`; });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { clearTimeout(timer); ttls.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [root, collect]);

  return { items, collect, els };
}

export function BobrPen({ stage, emotion, onChat, chatLabel, onBobr, bobrLabel, bobrOn }: { /** tapping Bóbr (opens / closes the trade) */ onBobr?: () => void; bobrLabel?: string; bobrOn?: boolean; stage: BobrStage; emotion: Emotion; /** a speech bubble over Bóbr that opens the chat */ onChat?: () => void; chatLabel?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { items, collect, els } = usePen(root);
  const { px } = useUi();
  return (
    <div className="pen" ref={root} data-act="idle" data-face="1">
      {onBobr
        ? <div className="pen-hit" role="button" tabIndex={0} aria-label={bobrLabel} aria-pressed={bobrOn} onClick={onBobr} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBobr(); } }}><BobrView stage={stage} emotion={emotion} /></div>
        : <BobrView stage={stage} emotion={emotion} />}
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
