import { useEffect, useId, useRef, type ReactNode } from 'react';
import { PixelFrame } from './PixelFrame';
import { useUi } from './useUi';
import { PixelButton } from './PixelButton';
import { useT } from '../i18n/useT';
import type { FrameTheme } from './themes';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Accessible dialog: labelled, Escape closes, Tab stays inside, focus returns to the opener. */
/** `onBack` puts a Back button beside the title, where a long dialog's scrolling cannot carry it away. */
export function Modal({ open, onClose, onBack, title, theme = 'wood_gold_gem', children }:
  { open: boolean; onClose: () => void; onBack?: () => void; title?: string; theme?: FrameTheme | 'app' | (string & {}); children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const { layout } = useUi();   // on a phone the frame is drawn at 1x (still never smaller) so the content gets the room
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
    // a drag on the dim area, or on a part of the dialog with nothing to scroll, must not scroll the page behind it
    const backdrop = el.parentElement;
    const canScroll = (n: HTMLElement) => { const cs = getComputedStyle(n); return (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY)) || (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX)); };
    const onTouchMove = (e: TouchEvent) => {
      for (let n = e.target as HTMLElement | null; n && n !== backdrop; n = n.parentElement) if (canScroll(n)) return;
      if (e.cancelable) e.preventDefault();
    };
    backdrop?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKey);
      backdrop?.removeEventListener('touchmove', onTouchMove);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <PixelFrame theme={theme} scale={layout === 'compact' ? 1 : 2} className="modal" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1} ref={ref}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {title && (onBack
          ? <div className="modal-head"><h2 id={titleId} className="modal-title">{title}</h2><PixelButton scale={1} size="compact" variant="red" onClick={onBack}>{t('back')}</PixelButton></div>
          : <h2 id={titleId} className="modal-title">{title}</h2>)}
        {children}
      </PixelFrame>
    </div>
  );
}
