import { useSyncExternalStore } from 'react';

/**
 * A screen can park a small picture in the navigation bar (Pixelite shows its result there, so it stays in view while you scroll
 * the controls). While one is set the bar shows a Back button and that picture instead of the usual items.
 */
export interface NavPreview { url: string; height?: number }   // height: the picture's height in px (Pixelite passes its 1x / 2x / 4x size); the bar caps it
let cur: NavPreview | null = null;
const subs = new Set<() => void>();
export const setNavPreview = (url: string | null, height?: number) => {
  if (!url) { if (cur) { cur = null; subs.forEach(f => f()); } return; }
  if (cur && cur.url === url && cur.height === height) return;
  cur = { url, height }; subs.forEach(f => f());
};
export const useNavPreview = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
