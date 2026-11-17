import { useId, type ReactNode } from 'react';
import './ui.css';

/** One collapsible setting: shows the current choice; click to open the available styles. */
export function PickRow({ label, current, preview, open, onToggle, disabled = false, children }:
  { label: string; current: string; preview: ReactNode; open: boolean; onToggle: () => void; disabled?: boolean; children: ReactNode }) {
  const panel = useId();
  return (
    <div className={`pickrow ${open && !disabled ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <button type="button" className="pickrow-head" aria-expanded={open && !disabled} aria-controls={panel} aria-disabled={disabled} onClick={disabled ? undefined : onToggle}>
        <span className="pickrow-label">{label}</span>
        <span className="pickrow-cur">
          <span className="pickrow-prev" aria-hidden>{preview}</span>
          <span className="pickrow-name">{current}</span>
        </span>
        <img className="chev" src={`/assets/raw/${open && !disabled ? 'arrow_stone_up' : 'arrow_stone_down'}.png`} alt="" />
      </button>
      {open && !disabled && <div id={panel} className="pickrow-panel" role="group" aria-label={label}>{children}</div>}
    </div>
  );
}
