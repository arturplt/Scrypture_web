/** Progress-bar looks, all built from Android sprites. */
export type BarDef =
  | { kind: 'boxes'; box: string }                       // 10 boxes (Android's hunger/happiness meters)
  | { kind: 'frame'; frame: string; fill: string }       // framed bar with a separate fill sprite
  | { kind: 'seg'; part: string };                       // coloured left/middle/right segments on a dark track

export const BAR_STYLES = {
  boxes_green: { kind: 'boxes', box: 'bar_green_box' },
  boxes_red: { kind: 'boxes', box: 'bar_red_box' },
  bev: { kind: 'frame', frame: 'green_bev_progress_frame', fill: 'green_bev_progress_fill' },
  gold: { kind: 'frame', frame: 'green_gold_ornamenta_progress_frame', fill: 'green_gold_ornamenta_progress_fill' },
  stone: { kind: 'frame', frame: 'grey_stone_chiseled_progress_frame', fill: 'grey_stone_chiseled_progress_fill' },
  seg_green: { kind: 'seg', part: 'bar_green' },
  seg_red: { kind: 'seg', part: 'bar_red' },
  seg_gold: { kind: 'seg', part: 'bar_gold' },
  seg_blue: { kind: 'seg', part: 'bar_blue_steel' },
  seg_wood: { kind: 'seg', part: 'bar_wood' },
} as const satisfies Record<string, BarDef>;
export type BarStyle = keyof typeof BAR_STYLES;
export const BAR_IDS = Object.keys(BAR_STYLES) as BarStyle[];
export const BAR_LABELS: Record<BarStyle, string> = {
  boxes_green: 'boxes green', boxes_red: 'boxes red', bev: 'bevel', gold: 'gold', stone: 'stone',
  seg_green: 'green', seg_red: 'red', seg_gold: 'gold seg', seg_blue: 'steel', seg_wood: 'wood',
};
/** `id` may carry a colour variant (`gold~120`). */
export const barDef = (id: string, fallback: BarStyle = 'gold'): BarDef => BAR_STYLES[id.split('~')[0] as BarStyle] ?? BAR_STYLES[fallback];
