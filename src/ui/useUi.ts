import { autoUiScale, layoutFor, maxUiScale, needsRail, type Layout } from '../domain';
import { useAppState } from '../data/hooks';
import { useViewport } from './viewport';

/** The last automatic scale, shared by every caller so they all agree (see the hysteresis in `autoUiScale`). */
let lastAuto: 1 | 2 | 3 | undefined;

/** Interface scale (user's choice, or automatic from the screen) and the layout it implies. */
export function useUi(): { ui: number; maxUi: number; layout: Layout; rail: boolean; px: (n: number) => number } {
  const setting = useAppState(s => s.settings.uiScale);
  const { w, h } = useViewport();
  const maxUi = maxUiScale(w);
  const auto = autoUiScale(w, h, lastAuto);
  lastAuto = auto;
  const ui = Math.min(setting || auto, maxUi);
  const layout = layoutFor(w / ui);
  return { ui, maxUi, layout, rail: needsRail(layout, h / ui), px: n => n * ui };
}
