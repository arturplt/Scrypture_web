import { createContext, forwardRef, useContext, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { type FrameTheme, edgeRepeat, frameUrl, resolveFrame } from './themes';
import { useTintedImage } from './tintFrame';
import { useAppState } from '../data/hooks';
import './ui.css';

type Props = {
  /** 'app' = the frame style chosen in Settings. */
  theme?: FrameTheme | 'app' | (string & {});   // a frame name, optionally `name~hue`
  /** Override the edge style (Settings previews); default is the user's choice. */
  edges?: string;
  center?: string;
  /** Integer pixel scale (1, 2, 3). Frame tiles are 16px, so border = 16 * scale. */
  scale?: 1 | 2 | 3;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'style' | 'children'>;

/** 'slim' = a clean centre (screens that must fit a lot of framed pieces, like Home). On phone width its corners default to half size (see device.css); a corner size you choose always wins. */
export const FrameDensity = createContext<'normal' | 'slim'>('normal');

export const PixelFrame = forwardRef<any, Props>(function PixelFrame({ theme = 'green_bev', edges, center, scale = 2, as: Tag = 'div', className = '', style, children, ...rest }, ref) {
  const chosen = useAppState(st => st.settings.frameTheme);
  const userEdges = useAppState(st => st.settings.frameEdges);
  const userCenter = useAppState(st => st.settings.frameCenter);
  const slim = useContext(FrameDensity) === 'slim';
  const r = resolveFrame(theme, chosen, userEdges, userCenter);   // the frame's own edge / centre style, else the global one
  const e = edges ?? r.edges, name = r.name, hue = r.hue;
  const plain = frameUrl(name, e, slim ? 'clean' : (center ?? r.center));
  const hued = useTintedImage(/url\((.*)\)/.exec(plain)![1], null, null, { hue });   // colour variant, once built
  const vars = { '--frame': hued ?? plain, '--edge': edgeRepeat(e), '--s': scale, ...(r.scale ? { '--bw': r.scale } : {}), ...style } as CSSProperties;
  return <Tag ref={ref} className={`pf ${slim ? 'pf-slim' : ''} ${className}`} style={vars} data-bw-set={r.scale ? '' : undefined} {...rest}>{children}</Tag>;
});
