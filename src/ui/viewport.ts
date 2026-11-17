import { useSyncExternalStore } from 'react';

interface Viewport { w: number; h: number }
const read = (): Viewport => (typeof window === 'undefined' ? { w: 390, h: 844 } : { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) });
let vp = read();
const listeners = new Set<() => void>();
function update() {
  const n = read();
  if (n.w !== vp.w || n.h !== vp.h) { vp = n; listeners.forEach(l => l()); }
}
if (typeof window !== 'undefined') { addEventListener('resize', update); addEventListener('orientationchange', update); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Current window size in CSS pixels (one shared listener for the whole app). */
export const useViewport = () => useSyncExternalStore(subscribe, () => vp, () => vp);
