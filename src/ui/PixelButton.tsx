import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { useAppState } from '../data/hooks';
import { buttonSlice } from '../domain';
import { edgeRepeat, frameUrl, resolveButton, type NativeButton } from './themes';
import { useHuedUrls } from './hue';
import './ui.css';

type Base = ButtonHTMLAttributes<HTMLButtonElement> & { scale?: 1 | 2 | 3; /** Overrides the size chosen in Settings for this button (e.g. 'compact' in dense toolbars). */ size?: 'large' | 'medium' | 'compact' };

/**
 * Frame variables and classes for a button style at the user's button size. Large keeps the full 16px border and the chosen
 * edge style; medium/compact use a thinner border slice of the plain frame image (the tiled wide-edge images would repeat
 * border art inside a small button).
 */
function useButtonLook(look: string, fallback: NativeButton, scale: number, sizeOverride?: string) {
  const edges = useAppState(s => s.settings.frameEdges);
  const center = useAppState(s => s.settings.frameCenter);
  const userSize = useAppState(s => s.settings.buttonSize);
  const size = sizeOverride ?? userSize;
  const r = resolveButton(look, fallback);
  const thin = size !== 'large';
  const e = thin ? 'stretch' : (r.edges ?? edges), c = thin ? 'clean' : (r.center ?? center);   // a button's own edge / centre style counts at Large size
  const plain = frameUrl(r.frame, e, c), plainPressed = frameUrl(r.pressed, e, c);
  const srcOf = (u: string) => /url\((.*)\)/.exec(u)![1];
  const [hued, huedPressed] = useHuedUrls([srcOf(plain), srcOf(plainPressed)], r.hue);   // colour variant, once built
  const vars = { '--frame': hued ?? plain, '--frame-pressed': huedPressed ?? plainPressed, '--edge': edgeRepeat(e), '--s': scale, '--k': buttonSlice(r.frame, size), ...(r.scale ? { '--bw': r.scale } : {}) } as CSSProperties;   // an own corner size draws the border at that width
  const cls = `pf pb ${size === 'compact' ? 'pb-compact' : size === 'medium' ? 'pb-medium' : ''} ${r.fx ? 'pb-fx' : ''} ${r.dark ? 'pb-dark' : ''}`;
  return { vars, cls };
}

/** Non-interactive sample of a button style (Settings pickers; a real button can't live inside a button). */
export function ButtonLook({ look, fallback = 'button_green', scale = 1, size, children }: { look: string; fallback?: NativeButton; scale?: 1 | 2 | 3; size?: string; children: React.ReactNode }) {
  const { vars, cls } = useButtonLook(look, fallback, scale, size);
  return <span className={`${cls} pb-sample`} style={vars} aria-hidden>{children}</span>;
}

/** Button for an explicit style. */
export function StyledButton({ look, fallback = 'button_green', scale = 2, size, className = '', style, children, ...rest }: Base & { look: string; fallback?: NativeButton }) {
  const { vars, cls } = useButtonLook(look, fallback, scale, size);
  return <button className={`${cls} ${className}`} style={{ ...vars, ...style } as CSSProperties} {...rest}>{children}</button>;
}

/** App button: 'green' = main style, 'red' = secondary style, both chosen in Settings. */
export function PixelButton({ variant = 'green', ...rest }: Base & { variant?: 'green' | 'red' }) {
  const buttons = useAppState(s => s.settings.buttons);
  return <StyledButton look={variant === 'red' ? buttons.secondary : buttons.primary} fallback={`button_${variant}`} {...rest} />;
}
