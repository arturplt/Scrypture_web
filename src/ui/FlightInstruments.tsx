import { useEffect, useRef, type MutableRefObject } from 'react';
import { drawInstruments, type Instruments } from './instrumentDraw';

/** The six-pack, redrawn 30 times a second from a ref the game loop fills; React never re-renders for it. */
export function FlightInstruments({ data, label }: { data: MutableRefObject<Instruments>; label: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = cv.current!, ctx = el.getContext('2d')!;
    let W = 1, H = 1, raf = 0, last = 0;
    const fit = () => {
      const r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      el.width = Math.round(W * dpr); el.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    const tick = (now: number) => { raf = requestAnimationFrame(tick); if (now - last < 33) return; last = now; const t0 = performance.now(); drawInstruments(ctx, W, H, data.current); const w = window as unknown as { __instMs?: number }; w.__instMs = Math.max(w.__instMs ?? 0, performance.now() - t0); };   // (the ?perf readout shows the worst draw of the last 2 s)
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [data]);
  return <canvas ref={cv} className="world-inst" role="img" aria-label={label} />;
}
