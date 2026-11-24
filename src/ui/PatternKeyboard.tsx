import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PixelFrame } from './PixelFrame';
import { KEY_ROWS, PATTERN_KEYS, keyById, keySymbolUrl, hotkeyFor, setHotkey, hotkeyUsable, type HotkeyMap } from '../domain/patternKeys';

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
  /** The player's own hotkeys (shown on the keys). */
  hotkeys?: HotkeyMap;
  /** The key a gamepad's highlight is on (polled), or null with no pad in use. */
  focus?: () => string | null;
  /** Where the panel was dragged to last (pixels), and the drag's end (to remember it). */
  pos0?: { l: number; t: number } | null;
  onMoved?: (p: { l: number; t: number }) => void;
  title: string; hint: string; stopLabel: string; closeLabel: string;
}

/**
 * The pattern keyboard: the 21 flight-pattern symbols as keys (rows of 1, 5, 9, 3 and 3). A tap flies that move; taps while it flies
 * queue the next ones, and the strip on top shows what is typed, the move in progress lit. The panel never takes the pointer from
 * the stage beyond its own keys, so the plane keeps flying while it is open.
 */
export function PatternKeyboard({ onPress, onStop, onClose, run, instScale = 0.5, hotkeys, focus, pos0, onMoved, title, hint, stopLabel, closeLabel }: Props) {
  const [prog, setProg] = useState<{ keys: string[]; at: number } | null>(null), [foc, setFoc] = useState<string | null>(null);
  const focRef = useRef(focus); focRef.current = focus;
  useEffect(() => {
    const id = setInterval(() => { setProg(prev => { const n = run(); return (n?.at ?? -1) === (prev?.at ?? -1) && (n?.keys.join() ?? '') === (prev?.keys.join() ?? '') ? prev : n; }); setFoc(focRef.current?.() ?? null); }, 100);
    return () => clearInterval(id);
  }, [run]);
  // the top strip drags the panel (left / top in pixels, kept on the screen)
  const root = useRef<HTMLDivElement>(null), drag = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const [pos, setPos] = useState<{ l: number; t: number } | null>(pos0 ?? null);
  useEffect(() => {   // a remembered place is kept on this screen (it may be smaller than the one it was dragged on)
    const r = root.current?.getBoundingClientRect(); if (!pos0 || !r) return;
    const l = Math.max(0, Math.min(innerWidth - r.width, pos0.l)), t = Math.max(0, Math.min(innerHeight - r.height, pos0.t));
    if (l !== pos0.l || t !== pos0.t) setPos({ l, t });
  }, []);
  const posRef = useRef(pos); posRef.current = pos;
  const grab = (e: React.PointerEvent<HTMLElement>) => { const r = root.current?.getBoundingClientRect(); if (!r) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }; };
  const move = (e: React.PointerEvent<HTMLElement>) => { const d = drag.current, r = root.current?.getBoundingClientRect(); if (!d || d.id !== e.pointerId || !r) return; setPos({ l: Math.max(0, Math.min(innerWidth - r.width, e.clientX - d.dx)), t: Math.max(0, Math.min(innerHeight - r.height, e.clientY - d.dy)) }); };
  const drop = (e: React.PointerEvent<HTMLElement>) => { if (drag.current?.id === e.pointerId) { drag.current = null; if (posRef.current) onMoved?.(posRef.current); } };
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
              <PixelFrame key={k.id} as="button" theme="red_thick" scale={1} className="wui-kbkey" style={{ '--bw': 4 } as CSSProperties} aria-label={k.label} title={`${k.label} (${hotkeyFor(k, hotkeys).toUpperCase()})`} data-lit={lit === k.id ? 'true' : 'false'} data-focus={foc === k.id ? 'true' : undefined} onPointerDown={e => stop(e, () => onPress(k.id))}>
                <img src={symbol(k.id)} alt="" draggable={false} />
                <kbd aria-hidden="true">{hotkeyFor(k, hotkeys)}</kbd>
              </PixelFrame>
            ))}
          </div>
        ))}
      </PixelFrame>
    </div>
  );
}

/**
 * The menu's list of the 21 keys with the physical key each one answers to: tap a key, then press the new one on the keyboard
 * (Esc keeps the old one). A key another pattern key has is swapped with it; the flying keys are refused.
 */
export function HotkeyEditor({ map, onChange, labels }: { map: HotkeyMap; onChange: (m: Record<string, string>) => void; labels: { hint: string; press: string; taken: string; reset: string } }) {
  const [listen, setListen] = useState<string | null>(null), [bad, setBad] = useState(false);
  const mapRef = useRef(map); mapRef.current = map;
  const changeRef = useRef(onChange); changeRef.current = onChange;
  useEffect(() => {
    if (!listen) return;
    const down = (e: KeyboardEvent) => {   // (caught before the game's own keys see it: this press is only a choice)
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { setListen(null); setBad(false); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const next = hotkeyUsable(e.key) ? setHotkey(mapRef.current, listen, e.key) : null;
      if (!next) { setBad(true); return; }
      changeRef.current(next); setListen(null); setBad(false);
    };
    addEventListener('keydown', down, { capture: true });
    return () => removeEventListener('keydown', down, { capture: true });
  }, [listen]);
  return (
    <div className="wui-hkedit">
      <p className="wui-hkhint">{listen ? (bad ? labels.taken : labels.press) : labels.hint}</p>
      <div className="wui-hkgrid">
        {PATTERN_KEYS.map(k => (
          <button key={k.id} type="button" className="wui-hkkey" aria-label={`${k.label}: ${hotkeyFor(k, map).toUpperCase()}`} aria-pressed={listen === k.id} title={k.label} onClick={() => { setBad(false); setListen(l => (l === k.id ? null : k.id)); }}>
            <img src={symbol(k.id)} alt="" draggable={false} /><kbd>{listen === k.id ? '?' : hotkeyFor(k, map).toUpperCase()}</kbd>
          </button>
        ))}
      </div>
      <button type="button" className="wui-hkreset" disabled={!Object.keys(map).length} onClick={() => { setListen(null); onChange({}); }}>{labels.reset}</button>
    </div>
  );
}
