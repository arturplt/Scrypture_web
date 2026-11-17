import { autoUiScale, layoutFor, maxUiScale, needsRail, type Layout } from '../domain';
import { useAppState } from '../data/hooks';
import { useViewport } from './viewport';

/** Interface scale (user's choice, or automatic from the screen) and the layout it implies. */
export function useUi(): { ui: number; maxUi: number; layout: Layout; rail: boolean; px: (n: number) => number } {
  const setting = useAppState(s => s.settings.uiScale);
  const { w, h } = useViewport();
  const maxUi = maxUiScale(w);
  const ui = Math.min(setting || autoUiScale(w, h), maxUi);
  const layout = layoutFor(w / ui);
  return { ui, maxUi, layout, rail: needsRail(layout, h / ui), px: n => n * ui };
}
