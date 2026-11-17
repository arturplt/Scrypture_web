import { useEffect, useRef } from 'react';

/**
 * A range input with an arrow at each end for fine tuning: a tap moves one step, holding repeats.
 * The range comes first in the DOM (so a surrounding <label> points at it, not at an arrow); CSS puts the arrows round it.
 */
export function NudgeRange({ value, onChange, min, max, step = 1, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label?: string }) {
  const latest = useRef({ value, onChange, min, max, step });
  latest.current = { value, onChange, min, max, step };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => stop, []);
  const nudge = (dir: -1 | 1) => {
    const l = latest.current;
    const v = Math.max(l.min, Math.min(l.max, +(l.value + dir * l.step).toFixed(6)));
    if (v === l.value) return false;
    latest.current = { ...l, value: v };   // repeats before React re-renders must keep moving
    l.onChange(v);
    return true;
  };
  const hold = (dir: -1 | 1) => {
    stop();
    nudge(dir);
    const again = (delay: number) => { timer.current = setTimeout(() => { if (nudge(dir)) again(50); }, delay); };
    again(350);
  };
  const arrow = (dir: -1 | 1) => (
    <button type="button" className={`nudge-btn ${dir < 0 ? 'nudge-l' : 'nudge-r'}`} aria-label={dir < 0 ? 'Decrease' : 'Increase'} disabled={dir < 0 ? value <= min : value >= max}
      onPointerDown={e => { if (e.button === 0) { e.preventDefault(); hold(dir); } }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nudge(dir); } }}>{dir < 0 ? '<' : '>'}</button>
  );
  return (
    <span className="nudge">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))} />
      {arrow(-1)}{arrow(1)}
    </span>
  );
}
