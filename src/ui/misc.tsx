import { useRef, type CSSProperties, type ReactNode } from 'react';
import { PixelFrame } from './PixelFrame';
import { useTickUrls } from './TickLook';
import { useAppState } from '../data/hooks';
import { backdropFrame, frameOr, rawUrl } from './themes';
import { useTintedImage } from './tintFrame';
import './ui.css';

/** `size` = rendered height in px (width follows). Use multiples of the sprite's native height for crisp pixels. */
export function Icon({ name, size = 32, alt = '' }: { name: string; size?: number; alt?: string }) {
  return <img className="icon" src={rawUrl(name)} alt={alt} style={{ '--px': size } as CSSProperties} />;
}

export function PixelCheckbox({ checked, onChange, label, ariaLabel, disabled = false, big = false }: { checked: boolean; onChange: (v: boolean) => void; label?: string; ariaLabel?: string; disabled?: boolean; big?: boolean }) {
  const [off, on] = useTickUrls(useAppState(s => s.settings.elements.tick));
  return (
    <label className={`pcheck ${disabled ? 'disabled' : ''} ${big ? 'pcheck-big' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={ariaLabel} onChange={e => onChange(e.target.checked)} />
      <span className="pcheck-box" style={{ backgroundImage: checked ? on : off }} />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Divider() { return <div className="divider" style={{ backgroundImage: `url(${rawUrl('break_floral')})` }} />; }

/**
 * Priority / difficulty / time / due-date tag, drawn as a pixel-art 9-slice (the `box` sprite, 3px corners shown at 2x).
 * `color` tints the sprite (border: `border` if given, else `color`; centre: `color`, kept dark by the sprite's own shading).
 * No colour = the sprite as drawn.
 */
export function Chip({ children, color, border }: { children: ReactNode; color?: string; border?: string }) {
  const img = useTintedImage('/assets/raw/box.png', color ? (border ?? color) : null, color ?? null, { slice: 3, ring: 0.85, centre: 0.45 });
  return <span className="chip" style={img ? ({ '--chip-img': img } as CSSProperties) : undefined}>{children}</span>;
}

/** A choice (priority, difficulty) drawn as its own pixel-art 9-slice, tinted `color`; the chosen one gets a bright outline and a stronger fill. */
export function PickBox({ color, selected, onClick, children }: { color: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  const img = useTintedImage('/assets/raw/box.png', selected ? '#fff3b0' : color, color, { slice: 3, ring: selected ? 0.95 : 0.85, centre: selected ? 0.75 : 0.3 });
  return <button type="button" className={`chip pbox ${selected ? 'on' : ''}`} aria-pressed={selected} onClick={onClick} style={img ? ({ '--chip-img': img } as CSSProperties) : undefined}>{children}</button>;
}

/** Pointer handlers that call `fn` after the pointer has been held down for `ms` (Android's long press). */
export function useLongPress(fn?: () => void, ms = 500) {
  const timer = useRef(0);
  if (!fn) return {};
  const stop = () => clearTimeout(timer.current);
  return {
    onPointerDown: () => { stop(); timer.current = window.setTimeout(fn, ms); },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),   // a long touch would open the browser's menu instead
  };
}

export function StatBox({ stat, value, frame = 'app', onLongPress, tip }: { stat: 'body' | 'mind' | 'soul'; value: number; frame?: string; onLongPress?: () => void; /** shown in a pixel-art box when hovered or focused */ tip?: string }) {
  const hold = useLongPress(onLongPress);
  const tipFrame = useAppState(s => s.settings.elements.tip);
  return (
    <div className={`statbox stat-${stat} ${onLongPress ? 'holdable' : ''}`} {...hold}>
      <img className="stat-icon" src={rawUrl(`${stat}_active`)} alt={stat} />
      <PixelFrame theme={frameOr(frame, 'app')} scale={1} className="stat-num"><div className="stat-val">{value}</div></PixelFrame>
      {tip && <span className="tip" role="tooltip"><PixelFrame as="span" theme={backdropFrame(tipFrame)} scale={1} className="tip-bg" aria-hidden /><span className="tip-text">{tip}</span></span>}
    </div>
  );
}

export { Modal } from './Modal';
