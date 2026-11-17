import { useHuedUrls } from './hue';
import { splitFrame } from './themes';

/** The plate drawn behind the active tab when the marker style is "plate": a small 9-slice sprite (3px corners, shown at 2x). */
export interface PlateDef { sprite: string; /** a dark sprite needs light label text */ dark: boolean }
export const NAV_PLATES = {
  wood: { sprite: 'box_wood', dark: false },
  barrel: { sprite: 'box_wood_gold', dark: true },
  gold: { sprite: 'box', dark: true },
  emerald: { sprite: 'bar_green_box', dark: true },
  ember: { sprite: 'bar_red_box', dark: true },
  stone: { sprite: 'box_stone_empty', dark: true },
  glass: { sprite: 'box_unchecked', dark: true },
  slot: { sprite: 'box_large', dark: true },
} as const satisfies Record<string, PlateDef>;
export type NavPlate = keyof typeof NAV_PLATES;
export const PLATE_IDS = Object.keys(NAV_PLATES) as NavPlate[];
/** `id` may carry a colour variant (`wood~120`). */
export const plateDef = (id: string): PlateDef => NAV_PLATES[splitFrame(id).name as NavPlate] ?? NAV_PLATES.wood;
/** Attributes for the nav element: the sprite (in its colour variant) as a CSS variable, plus whether the label needs light text. */
export function usePlateAttrs(id: string) {
  const d = plateDef(id), plain = `url(/assets/raw/${d.sprite}.png)`;
  const [huedUrl] = useHuedUrls([`/assets/raw/${d.sprite}.png`], splitFrame(id).hue);
  return { style: { '--plate': huedUrl ?? plain } as React.CSSProperties, 'data-plate-dark': d.dark ? '' : undefined };
}
