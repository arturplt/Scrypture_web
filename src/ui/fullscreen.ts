import { useSyncExternalStore } from 'react';

/** Thin wrapper around the Fullscreen API (with the old WebKit prefix). iPhone Safari has none of it. */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void>; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = () => document as FsDoc;
export const fullscreenSupported = (): boolean => {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as FsEl;
  return !!((doc().fullscreenEnabled || doc().webkitFullscreenEnabled) && (el.requestFullscreen || el.webkitRequestFullscreen));
};
export const isFullscreen = (): boolean => typeof document !== 'undefined' && !!(doc().fullscreenElement || doc().webkitFullscreenElement);

/** Must be called from a user gesture (tap, key press); browsers refuse it otherwise. Resolves to whether it worked. */
export async function enterFullscreen(): Promise<boolean> {
  try {
    const el = document.documentElement as FsEl;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch { return false; }
}
export async function exitFullscreen(): Promise<void> {
  try {
    if (!isFullscreen()) return;
    if (doc().exitFullscreen) await doc().exitFullscreen();
    else if (doc().webkitExitFullscreen) await doc().webkitExitFullscreen!();
  } catch { /* already out */ }
}

const subscribe = (cb: () => void) => {
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, cb);
  return () => { for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(ev, cb); };
};
/** Live: is the page in full screen right now (it also changes when the user leaves with Esc / back). */
export const useFullscreen = () => ({ supported: fullscreenSupported(), active: useSyncExternalStore(subscribe, isFullscreen, () => false) });

/** The gestures browsers accept as permission to go full screen. */
export const GESTURE_EVENTS = ['pointerup', 'click', 'keydown'] as const;
