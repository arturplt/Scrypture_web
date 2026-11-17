import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { boxSprite, boxSpriteNow, boxVars, type BoxMode } from './boxSprite';
import { useAppState } from '../data/hooks';
import { CHIP_SCALES, splitFrame } from './themes';

/** Filter/sort chips ("seg" buttons): an off and an on sprite, drawn as 9-slices (same slice for both, so toggling never resizes). */
export interface ChipDef { off: string; on: string; slice: number; offText: string; onText: string }
const DARK = '#3a1d0b', LIGHT = 'var(--text)', SOFT = 'var(--text-2)';
export const CHIP_STYLES = {
  wood: { off: 'box', on: 'box_wood', slice: 3, offText: SOFT, onText: DARK },
  emerald: { off: 'bar_green_box', on: 'box_unchecked', slice: 3, offText: SOFT, onText: LIGHT },
  ember: { off: 'bar_red_box', on: 'box_wood', slice: 3, offText: SOFT, onText: DARK },
  gold: { off: 'box_large', on: 'box_wood', slice: 3, offText: SOFT, onText: DARK },
  stone: { off: 'box_stone_empty', on: 'button_stone_gem', slice: 5, offText: SOFT, onText: LIGHT },
} as const satisfies Record<string, ChipDef>;
export type ChipStyle = keyof typeof CHIP_STYLES;
export const CHIP_IDS = Object.keys(CHIP_STYLES) as ChipStyle[];
/** `id` may carry a colour variant (`ember~120`). */
export const chipDef = (id: string): ChipDef => CHIP_STYLES[splitFrame(id).name as ChipStyle] ?? CHIP_STYLES.wood;

/** Units per sprite pixel of a chip (corner size): its own choice (`wood::` + `:3`), else 2. */
export const chipScale = (id: string) => { const n = Number(splitFrame(id).scale); return (CHIP_SCALES as readonly number[]).includes(n) ? n : 2; };

/** CSS variables consumed by `.seg` (set on :root for the whole app, or inline for a preview). */
export function chipVars(id: string): CSSProperties {
  const d = chipDef(id);
  return { '--chip-off': `url(/assets/raw/${d.off}.png)`, '--chip-on': `url(/assets/raw/${d.on}.png)`, '--chip-slice': d.slice, '--chip-text': d.offText, '--chip-on-text': d.onText, '--chip-scale': chipScale(id) } as CSSProperties;
}

/**
 * Chip variables plus the mirrored-tile versions of its two sprites (so wide chips repeat instead of stretching). Until those
 * are built the plain sprite variables are returned and the CSS falls back to them.
 */
export function useChipVars(id: string, edges?: string): CSSProperties {
  const chosen = useAppState(st => st.settings.chipEdges);
  const want = edges ?? splitFrame(id).edges ?? chosen;   // an explicit choice, the chip's own (`ember:random`), else the general one
  const mode = (want === 'repeat' || want === 'random' ? want : 'mirror') as BoxMode;
  const d = chipDef(id), hue = splitFrame(id).hue, off = `/assets/raw/${d.off}.png`, on = `/assets/raw/${d.on}.png`;
  const [sp, setSp] = useState(() => ({ off: boxSpriteNow(off, d.slice, mode, hue), on: boxSpriteNow(on, d.slice, mode, hue) }));
  useEffect(() => {
    let live = true;
    setSp({ off: boxSpriteNow(off, d.slice, mode, hue), on: boxSpriteNow(on, d.slice, mode, hue) });
    Promise.all([boxSprite(off, d.slice, mode, hue), boxSprite(on, d.slice, mode, hue)]).then(([a, b]) => { if (live) setSp({ off: a, on: b }); }, () => {});
    return () => { live = false; };
  }, [off, on, d.slice, mode, hue]);
  return useMemo(() => ({ ...chipVars(id), ...boxVars('chip-off', sp.off), ...boxVars('chip-on', sp.on) }) as CSSProperties, [id, sp]);
}

/** Non-interactive sample of a chip style (Settings). */
export function ChipLook({ id, on = false, edges, wide = false, children }: { id: string; on?: boolean; edges?: string; wide?: boolean; children: React.ReactNode }) {
  const vars = useChipVars(id, edges);
  return <span className={`seg chip-sample ${on ? 'on' : ''}`} style={wide ? { ...vars, display: 'block', minWidth: 'calc(110 * var(--u))' } : vars} aria-hidden>{children}</span>;
}

/** The style a category chip really uses: its own choice, or the general filter-button style for 'same'. */
export function useCatChipStyle(cat: 'all' | 'body' | 'mind' | 'soul'): string {
  const own = useAppState(st => st.settings.chipsCat[cat]), general = useAppState(st => st.settings.chips);
  return own === 'same' || !(splitFrame(own).name in CHIP_STYLES) ? general : own;
}

/** A filter chip with its own style (the category row on the Tasks screen). */
export function ChipButton({ cat, on, onClick, children, big = false, ariaLabel }: { cat: 'all' | 'body' | 'mind' | 'soul'; big?: boolean; ariaLabel?: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  const vars = useChipVars(useCatChipStyle(cat));
  return <button className={`seg ${big ? 'cat-big' : ''} ${on ? 'on' : ''}`} style={big ? { ...vars, '--chip-scale': 4 } as React.CSSProperties : vars} aria-pressed={on} aria-label={ariaLabel} onClick={onClick}>{children}</button>;
}
