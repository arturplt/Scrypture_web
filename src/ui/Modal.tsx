import { useEffect, useId, useRef, type ReactNode } from 'react';
import { PixelFrame } from './PixelFrame';
import type { FrameTheme } from './themes';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Accessible dialog: labelled, Escape closes, Tab stays inside, focus returns to the opener. */
export function Modal({ open, onClose, title, theme = 'wood_gold_gem', children }:
  { open: boolean; onClose: () => void; title?: string; theme?: FrameTheme | 'app' | (string & {}); children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Remember who had focus *before* the dialog (and its autofocused field) mounts.
  const openerRef = useRef<HTMLElement | null>(null);
  if (open && !openerRef.current) openerRef.current = document.activeElement as HTMLElement | null;
  if (!open) openerRef.current = null;

  useEffect(() => {
    if (!open) return;
    const el = ref.current!;
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <PixelFrame theme={theme} className="modal" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1} ref={ref}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {title && <h2 id={titleId} className="modal-title">{title}</h2>}
        {children}
      </PixelFrame>
    </div>
  );
}
