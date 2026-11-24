import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A chip-styled button that rolls a list of options down on click (closes on pick, outside click or Escape). */
export function Dropdown({ label, children, ariaLabel }: { label: ReactNode; ariaLabel?: string; /** options: render with `close` so a pick can fold the list */ children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button type="button" className={`seg ${open ? 'on' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>
        {label} <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="dd-list" role="listbox">{children(() => setOpen(false))}</div>}
    </div>
  );
}
