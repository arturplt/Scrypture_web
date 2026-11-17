import type { CSSProperties } from 'react';
import { boxCount } from '../domain';
import { barDef, type BarStyle } from './bars';
import { useHuedUrls } from './hue';
import './ui.css';

type Props = { value: number; max?: number; look?: BarStyle | string; scale?: 1 | 2 | 3; label?: string };
const raw = (n: string) => `url(/assets/raw/${n}.png)`;

export function PixelProgressBar({ value, max = 100, look = 'gold', scale = 2, label }: Props) {
  const s = scale; // the interface scale is applied in CSS via --u
  const pct = Math.max(0, Math.min(1, max ? value / max : 0)) * 100;
  const d = barDef(look);
  const hue = Number(look.split('~')[1]) || 0;
  // every sprite of the bar in its colour variant (the plain sprite shows until it is built)
  const paths = d.kind === 'boxes' ? [d.box] : d.kind === 'seg' ? [`${d.part}_left`, `${d.part}_middle`, `${d.part}_right`] : [d.frame, d.fill];
  const huedUrls = useHuedUrls(paths.map(n => `/assets/raw/${n}.png`), hue);
  const sprite = (i: number) => huedUrls[i] ?? raw(paths[i]);
  const aria = { role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemax': max, 'aria-label': label } as const;

  if (d.kind === 'boxes') {
    const lit = boxCount(value, max);
    return (
      <div className="boxbar" {...aria} style={{ '--s': s, '--box': sprite(0) } as CSSProperties}>
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
      </div>
    );
  }
  if (d.kind === 'seg') {
    const full = pct >= 100;
    return (
      <div className="segbar" {...aria} style={{ '--s': s, '--l': sprite(0), '--m': sprite(1), '--r': sprite(2) } as CSSProperties}>
        <div className={`seg-fill ${full ? 'full' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    );
  }
  // frame + fill: both are 48x16 three-slice sprites (16px caps, stretchy middle)
  return (
    <div className="pbar" {...aria} style={{ '--bar-frame': sprite(0), '--bar-fill': sprite(1), '--s': s } as CSSProperties}>
      <div className="pbar-frame" />
      <div className="pbar-fill" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />
    </div>
  );
}
