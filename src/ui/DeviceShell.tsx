import { useEffect, useRef, type ReactNode } from 'react';
import { PixelFrame } from './PixelFrame';
import { frameOr } from './themes';
import { useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { useI18n } from '../i18n/useT';
import './device.css';

/**
 * The hardware case around the whole app: a casing frame, a top strip (label plates + LEDs), the "screen" the pages live in and
 * the navigation as the bottom row of keys. The screen has a CRT / low-res LCD look: a faint scanline + RGB sub-pixel grid, a
 * vignette, a glass glint and a slight colour fringe (chromatic aberration) on everything drawn on it. Strength is a setting.
 */
export function DeviceShell({ title, level, resetKey, nav, children }: { title: string; level: number; resetKey: string; nav: ReactNode; children: ReactNode }) {
  const crt = useAppState(s => s.settings.crt);
  const frame = useAppState(s => s.settings.deviceFrame);
  const now = useNow(10_000);
  const { locale } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [resetKey]);   // a new screen starts at its top
  return (
    <PixelFrame theme={frameOr(frame, 'grey_gun')} scale={1} className="device-case" data-crt={crt}>
      <header className="device-top">
        <span className="plate" aria-live="polite">{title}</span>   {/* SCRYPTURE on Home, otherwise the screen's name */}
        <span className="plate lv">LV {level}</span>
        <span className="plate clock">{new Date(now).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="leds" aria-hidden><i className="led on" /><i className="led amber blink" /></span>
      </header>
      <div className="device-screen">
        <div className="device-scroll" ref={scroller} style={crt === 'off' ? undefined : { filter: `url(#ca-${crt})` }}>{children}</div>
        {crt !== 'off' && <div className="crt-fx" aria-hidden />}
      </div>
      <div className="device-bottom">{nav}</div>
      <ChromaDefs />
    </PixelFrame>
  );
}

/** SVG filters: red and blue are pulled 1px (low) or 2px (high) apart left and right, green stays put. */
function ChromaDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        {([['ca-low', 1], ['ca-high', 2]] as const).map(([id, d]) => (
          <filter key={id} id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={-d} dy="0" result="ro" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={d} dy="0" result="bo" />
            <feBlend in="ro" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
