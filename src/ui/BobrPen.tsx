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

export function BobrPen({ stage, emotion }: { stage: BobrStage; emotion: Emotion }) {
  const { items, collect } = useSpawns();
  const { px } = useUi();
  return (
    <div className="pen">
      <BobrView stage={stage} emotion={emotion} />
      {items.map(it => (
        <button key={it.id} className="spawn" aria-label={`Collect ${it.itemId}`}
          style={{ transform: `translate(calc(-50% + ${px(it.x)}px), calc(-50% + ${px(it.y)}px))` }} onClick={() => collect(it)}>
          <img className="pixel" src={`/assets/raw/${ITEM_SPRITE[it.itemId]}.png`} width={px(32)} height={px(32)} alt="" />
        </button>
      ))}
    </div>
  );
}
