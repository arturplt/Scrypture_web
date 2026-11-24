import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PixelFrame } from './PixelFrame';
import { KEY_ROWS, keyById, keySymbolUrl } from '../domain/patternKeys';

const BASE = import.meta.env.BASE_URL;
const symbol = (id: string) => { const k = keyById(id); return k ? keySymbolUrl(k, BASE) : ''; };

interface Props {
  /** A key was pressed (by pointer): fly it, or queue it behind the run in progress. */
  onPress: (id: string) => void;
  /** Hand the stick back. */
  onStop: () => void;
  onClose: () => void;
  /** The typed run now (polled): which keys, and which one is flying. Null when nothing is flying. */
  run: () => { keys: string[]; at: number } | null;
  /** The instrument's size as a fraction (0.5 .. 1.6): the keys are sized so the panel stays above it. */
  instScale?: number;
  title: string; hint: string; stopLabel: string; closeLabel: string;
}

/**
 * The pattern keyboard: the 21 flight-pattern symbols as keys (rows of 1, 5, 9, 3 and 3). A tap flies that move; taps while it flies
 * queue the next ones, and the strip on top shows what is typed, the move in progress lit. The panel never takes the pointer from
 * the stage beyond its own keys, so the plane keeps flying while it is open.
 */
export function PatternKeyboard({ onPress, onStop, onClose, run, instScale = 0.5, title, hint, stopLabel, closeLabel }: Props) {
  const [prog, setProg] = useState<{ keys: string[]; at: number } | null>(null);
  useEffect(() => {
    const id = setInterval(() => setProg(prev => { const n = run(); return (n?.at ?? -1) === (prev?.at ?? -1) && (n?.keys.join() ?? '') === (prev?.keys.join() ?? '') ? prev : n; }), 100);
    return () => clearInterval(id);
  }, [run]);
  // the top strip drags the panel (left / top in pixels, kept on the screen)
  const root = useRef<HTMLDivElement>(null), drag = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const [pos, setPos] = useState<{ l: number; t: number } | null>(null);
  const grab = (e: React.PointerEvent<HTMLElement>) => { const r = root.current?.getBoundingClientRect(); if (!r) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }; };
  const move = (e: React.PointerEvent<HTMLElement>) => { const d = drag.current, r = root.current?.getBoundingClientRect(); if (!d || d.id !== e.pointerId || !r) return; setPos({ l: Math.max(0, Math.min(innerWidth - r.width, e.clientX - d.dx)), t: Math.max(0, Math.min(innerHeight - r.height, e.clientY - d.dy)) }); };
  const drop = (e: React.PointerEvent<HTMLElement>) => { if (drag.current?.id === e.pointerId) drag.current = null; };
  const stop = (e: { stopPropagation: () => void }, f: () => void) => { e.stopPropagation(); f(); };
  const lit = prog ? prog.keys[prog.at] : null;
  return (
    <div ref={root} className="wui wui-kb" role="group" aria-label={title} style={{ '--is': instScale, ...(pos ? { left: pos.l, top: pos.t } : {}) } as CSSProperties}>
      <PixelFrame theme="blue_steel" scale={1} className="wui-kbpanel" style={{ '--bw': 5 } as CSSProperties}>
        <div className="wui-kbtop">
          <div className="wui-kbtape" aria-live="off" onPointerDown={grab} onPointerMove={move} onPointerUp={drop} onPointerCancel={drop}>
            {prog ? prog.keys.map((id, i) => <img key={i} src={symbol(id)} alt="" draggable={false} data-st={i < prog.at ? 'done' : i === prog.at ? 'now' : 'next'} />) : <span className="wui-kbhint">{hint}</span>}
          </div>
          <PixelFrame as="button" theme="bronze" scale={1} className="wui-kbsmall" style={{ '--bw': 4 } as CSSProperties} aria-label={stopLabel} title={stopLabel} aria-disabled={!prog} onPointerDown={e => stop(e, () => { if (prog) onStop(); })}><span>{stopLabel}</span></PixelFrame>
          <PixelFrame as="button" theme="bronze" scale={1} className="wui-kbsmall" style={{ '--bw': 4 } as CSSProperties} aria-label={closeLabel} title={`${closeLabel} (K)`} onPointerDown={e => stop(e, onClose)}><span>X</span></PixelFrame>
        </div>
        {KEY_ROWS.map((row, r) => (
          <div className="wui-kbrow" key={r}>
            {row.map(k => (
              <PixelFrame key={k.id} as="button" theme="red_thick" scale={1} className="wui-kbkey" style={{ '--bw': 4 } as CSSProperties} aria-label={k.label} title={`${k.label} (${k.hotkey.toUpperCase()})`} data-lit={lit === k.id ? 'true' : 'false'} onPointerDown={e => stop(e, () => onPress(k.id))}>
                <img src={symbol(k.id)} alt="" draggable={false} />
                <kbd aria-hidden="true">{k.hotkey}</kbd>
              </PixelFrame>
            ))}
          </div>
        ))}
      </PixelFrame>
    </div>
  );
}
