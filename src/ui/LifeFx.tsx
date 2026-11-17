import { useEffect, useRef } from 'react';
import { useUi } from './useUi';
import { prefersReducedMotion } from './CompleteFx';

/**
 * Urgency effect for a task card: a small pixel grid running Conway's Game of Life behind the card's text. Cells light up as
 * they are born and fade out as they die (so it leaves soft trails), and a few random "embers" are dropped in each step so
 * it never settles or dies out. Due soon / HIGH: warm gold, calm. Overdue / CRITICAL: red, denser and faster.
 * One canvas pixel = one cell; CSS scales it with `image-rendering: pixelated`, so cells are crisp, whole-pixel squares.
 */
const SPEC = {
  soon: { rgb: [255, 210, 122], density: 0.07, ms: 340, embers: 1, alpha: 0.22 },
  overdue: { rgb: [255, 106, 94], density: 0.12, ms: 210, embers: 2, alpha: 0.3 },
} as const;
export type LifeUrgency = keyof typeof SPEC;

export function LifeFx({ urgency, className = '' }: { urgency: LifeUrgency; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { ui } = useUi();
  useEffect(() => {
    const cv = ref.current;
    if (!cv || prefersReducedMotion()) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { rgb, density, ms, embers, alpha } = SPEC[urgency];
    const cell = 3 * ui;                                   // a cell is 3 interface units wide
    let cols = 0, rows = 0, alive = new Uint8Array(0), next = new Uint8Array(0), glow = new Float32Array(0), img: ImageData;
    let visible = true;

    const draw = () => {
      const d = img.data;
      for (let i = 0; i < alive.length; i++) {
        glow[i] = alive[i] ? Math.min(1, glow[i] + 0.6) : glow[i] * 0.62;    // born = bright, dead = fading trail
        const a = glow[i] < 0.04 ? 0 : glow[i] * alpha * 255;
        d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
    };
    const step = () => {
      let count = 0;
      for (let y = 0; y < rows; y++) {
        const ya = ((y + rows - 1) % rows) * cols, yb = y * cols, yc = ((y + 1) % rows) * cols;
        for (let x = 0; x < cols; x++) {
          const xl = (x + cols - 1) % cols, xr = (x + 1) % cols;       // the grid wraps around its edges
          const n = alive[ya + xl] + alive[ya + x] + alive[ya + xr] + alive[yb + xl] + alive[yb + xr] + alive[yc + xl] + alive[yc + x] + alive[yc + xr];
          const live = alive[yb + x] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
          next[yb + x] = live; count += live;
        }
      }
      [alive, next] = [next, alive];
      const sparks = count < alive.length * 0.03 ? Math.ceil(alive.length * 0.04) : embers;   // nearly dead: re-seed a little
      for (let k = 0; k < sparks; k++) alive[(Math.random() * alive.length) | 0] = 1;
      draw();
    };
    const resize = () => {
      const c = Math.max(6, Math.ceil(cv.clientWidth / cell)), r = Math.max(4, Math.ceil(cv.clientHeight / cell));
      if (c === cols && r === rows) return;
      cols = c; rows = r; cv.width = c; cv.height = r;
      alive = new Uint8Array(c * r); next = new Uint8Array(c * r); glow = new Float32Array(c * r); img = ctx.createImageData(c, r);
      for (let i = 0; i < alive.length; i++) alive[i] = Math.random() < density ? 1 : 0;
      for (let k = 0; k < 6; k++) step();                      // start already "organic", not from raw noise
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    const timer = window.setInterval(() => { if (visible && !document.hidden && cols) step(); }, ms);
    return () => { clearInterval(timer); ro.disconnect(); io.disconnect(); };
  }, [urgency, ui]);
  return <canvas ref={ref} className={`life-fx ${className}`} aria-hidden />;
}
