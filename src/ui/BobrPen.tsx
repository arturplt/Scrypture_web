import { useCallback, useEffect, useRef, useState } from 'react';
import { ITEM_SPRITE, MAX_SPAWNED, SPAWN_MAX_MS, SPAWN_MIN_MS, SPAWN_TTL_MS, HOME_ITEMS, type BobrStage, type Emotion, type ItemId } from '../domain';
import { actions } from '../data/hooks';
import { BobrView } from './BobrView';
import { useUi } from './useUi';

interface Spawned { id: number; itemId: ItemId; x: number; y: number }

/** Items appear around Bóbr every 8-15s, vanish after 20s unless tapped (Android behaviour). */
function useSpawns() {
  const [items, setItems] = useState<Spawned[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const ttls = new Set<ReturnType<typeof setTimeout>>();
    const schedule = () => {
      timer = setTimeout(() => {
        const angle = Math.random() * Math.PI * 2, dist = 70 + Math.random() * 50;
        const item: Spawned = { id: counter.current++, itemId: HOME_ITEMS[Math.floor(Math.random() * HOME_ITEMS.length)], x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.7 };
        setItems(cur => (cur.length >= MAX_SPAWNED ? cur : [...cur, item]));
        const ttl = setTimeout(() => { ttls.delete(ttl); setItems(cur => cur.filter(i => i.id !== item.id)); }, SPAWN_TTL_MS);
        ttls.add(ttl);
        schedule();
      }, SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS));
    };
    schedule();
    return () => { clearTimeout(timer); ttls.forEach(clearTimeout); };
  }, []);

  const collect = useCallback((it: Spawned) => {
    setItems(cur => cur.filter(i => i.id !== it.id));
    actions.collectItem(it.itemId);
  }, []);
  return { items, collect };
}

export function BobrPen({ stage, emotion, onChat, chatLabel, onBobr, bobrLabel, bobrOn }: { /** tapping Bóbr (opens / closes the trade) */ onBobr?: () => void; bobrLabel?: string; bobrOn?: boolean; stage: BobrStage; emotion: Emotion; /** a speech bubble over Bóbr that opens the chat */ onChat?: () => void; chatLabel?: string }) {
  const { items, collect } = useSpawns();
  const { px } = useUi();
  return (
    <div className="pen">
      {onBobr
        ? <div className="pen-hit" role="button" tabIndex={0} aria-label={bobrLabel} aria-pressed={bobrOn} onClick={onBobr} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBobr(); } }}><BobrView stage={stage} emotion={emotion} /></div>
        : <BobrView stage={stage} emotion={emotion} />}
      {onChat && <button type="button" className="pen-chat" aria-label={chatLabel} title={chatLabel} onClick={onChat}><img className="pixel" src="/assets/raw/chat_bubble_blue.png" width={px(36)} alt="" /></button>}
      {items.map(it => (
        <button key={it.id} className="spawn" aria-label={`Collect ${it.itemId}`}
          style={{ transform: `translate(calc(-50% + ${px(it.x)}px), calc(-50% + ${px(it.y)}px))` }} onClick={() => collect(it)}>
          <img className="pixel" src={`/assets/raw/${ITEM_SPRITE[it.itemId]}.png`} width={px(32)} height={px(32)} alt="" />
        </button>
      ))}
    </div>
  );
}
