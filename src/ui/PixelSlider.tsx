import type { CSSProperties } from 'react';

const raw = (n: string) => `url(/assets/raw/${n}.png)`;

/**
 * A pixel-art slider. A real range input sits invisibly on top, so touch, mouse, keyboard (arrows, Home/End) and
 * screen readers all work; the sprites only draw its state.
 */
export function PixelSlider({ value, onChange, label, valueText, color = 'green', min = 0, max = 1, step = 0.01 }:
  { value: number; onChange: (v: number) => void; label: string; valueText?: string; color?: 'green' | 'red'; min?: number; max?: number; step?: number }) {
  const v = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const style = { '--v': v, '--bl': raw(`bar_${color}_left`), '--bm': raw(`bar_${color}_middle`), '--br': raw(`bar_${color}_right`), '--bt': raw(`bar_${color}_box`) } as CSSProperties;
  return (
    <div className="slider" style={style}>
      <div className="slider-track" />
      <div className="slider-thumb" />
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={valueText}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}
