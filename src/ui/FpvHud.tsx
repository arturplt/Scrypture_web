import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Instruments } from './instrumentDraw';

/**
 * The head-up display of the FPV camera: green strokes laid over the view from the plane's nose, drawn from the same numbers as the
 * round instrument (see instrumentDraw.ts) and in the same way, from a ref the game loop fills, 30 times a second, with no React render.
 *   top      heading tape, the caret on the course the nose points to
 *   middle   pitch ladder and horizon, turning against the bank (the camera is rolled with the plane), the flight path marker (where it
 *            is going, as the cross in the middle is where the nose points)
 *   sides    airspeed on the left, height above sea level on the right with the climb rate under it
 *   bottom   bank scale and the load; STALL flashes when the wings let go
 */
const GREEN = '#7dff72', DIM = 'rgba(125,255,114,0.55)', SHADOW = 'rgba(2,40,8,0.85)';
const FONT = "'Press Start 2P', ui-monospace, monospace";
const FOV_TAN = Math.tan(0.36);   // the camera's half field of view (worldgl.ts: 0.72 rad vertically)
const deg = (r: number) => (r * 180) / Math.PI;
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function drawFpvHud(g: CanvasRenderingContext2D, W: number, H: number, d: Instruments, now: number) {
  g.clearRect(0, 0, W, H);
  if (d.landed) return;
  const vw = d.view, pitch = vw ? vw.pitch : d.pitch, bank = vw ? vw.bank : d.bank, heading = vw ? vw.heading : d.heading;   // (the view is eased: the ladder and the tape are the view's, the cross and the path marker move in it)
  const u = Math.max(0.6, Math.min(W, H) / 520), lw = Math.max(1, Math.round(1.6 * u)), fs = 11 * u, cx = W / 2, cy = H / 2, pxT = (H / 2) / FOV_TAN;
  const text = (s: string, x: number, y: number, align: CanvasTextAlign = 'center', size = fs, color = GREEN) => {
    g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = SHADOW; g.fillText(s, x + u, y + u); g.fillStyle = color; g.fillText(s, x, y);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, color = GREEN) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = SHADOW; g.lineWidth = lw + 2 * u; g.stroke(); g.strokeStyle = color; g.lineWidth = lw; g.stroke(); };
  g.save(); g.lineCap = 'butt'; g.lineJoin = 'miter';

  // ---- the horizon and the pitch ladder: in the plane's own frame, so it turns against the bank ------------------------------------------------
  g.save(); g.translate(cx, cy); g.rotate(-bank);
  const yAt = (a: number) => -pxT * Math.tan(a - pitch);   // a: the angle above the horizon (rad); the screen's y is down, the nose up moves the horizon down
  const half = 84 * u;
  for (let a = -90; a <= 90; a += 5) {
    const ar = (a * Math.PI) / 180, off = ar - pitch;
    if (Math.abs(off) > 0.55) continue;
    const y = yAt(ar);
    if (a === 0) { line(-W, y, -half * 0.5, y); line(half * 0.5, y, W, y); continue; }   // (the horizon runs out to the edges, with a gap round the middle)
    const major = a % 10 === 0, w = major ? half : half * 0.5, tip = (a > 0 ? 1 : -1) * 6 * u, c = a < 0 ? DIM : GREEN;   // (the ends turn towards the horizon; below it the bars are broken and dimmer)
    for (const s of [-1, 1]) {
      if (a < 0) { line(s * w, y, s * w * 0.62, y, c); line(s * w * 0.4, y, s * w * 0.18, y, c); } else line(s * w, y, s * w * 0.22, y, c);
      line(s * w, y, s * w, y + tip, c);
    }
    if (major) { text(String(Math.abs(a)), -w - 10 * u, y, 'right', fs * 0.8); text(String(Math.abs(a)), w + 10 * u, y, 'left', fs * 0.8); }
  }
  // the flight path marker: a ring with wings and a fin, where the plane is going
  { const y = yAt(d.gamma), x = vw ? -pxT * vw.pathDh * Math.cos(d.gamma) : 0, r = 7 * u; g.save(); g.translate(x, 0); g.beginPath(); g.arc(0, y, r, 0, Math.PI * 2); g.strokeStyle = SHADOW; g.lineWidth = lw + 2 * u; g.stroke(); g.strokeStyle = GREEN; g.lineWidth = lw; g.stroke(); line(-r, y, -r - 9 * u, y); line(r, y, r + 9 * u, y); line(0, y - r, 0, y - r - 8 * u); g.restore(); }
  // the boresight: where the nose points. In the eased view it moves a little off the middle (in the same frame as the ladder), so the lag can be seen
  { const r = 4 * u, nx = vw ? -pxT * vw.noseDh * Math.cos(pitch) : 0, ny = vw ? -pxT * Math.tan(vw.nosePitch - pitch) : 0; line(nx - r * 2.4, ny, nx - r * 0.8, ny); line(nx + r * 0.8, ny, nx + r * 2.4, ny); line(nx, ny - r * 2.4, nx, ny - r * 0.8); line(nx, ny + r * 0.8, nx, ny + r * 2.4); }
  g.restore();

  // ---- the heading tape ------------------------------------------------------------------------------------------------------------------------
  { const tw = Math.min(W * 0.46, 420 * u), ty = Math.max(30 * u, H * 0.09), perDeg = tw / 60, h = ((heading % 360) + 360) % 360;
    g.save(); g.beginPath(); g.rect(cx - tw / 2, ty - 20 * u, tw, 40 * u); g.clip();
    for (let a = Math.floor(h - 31); a <= Math.ceil(h + 31); a++) {
      if (a % 5 !== 0) continue;
      const x = cx + (a - h) * perDeg, n = ((a % 360) + 360) % 360, big = n % 10 === 0;
      line(x, ty + 12 * u, x, ty + (big ? 2 : 6) * u);
      if (big) text(n % 90 === 0 ? CARD[n / 45] : String(n / 10).padStart(2, '0'), x, ty - 8 * u, 'center', fs * 0.85);
    }
    g.restore();
    line(cx - 6 * u, ty + 22 * u, cx, ty + 15 * u); line(cx + 6 * u, ty + 22 * u, cx, ty + 15 * u);
    text(String(Math.round(h) % 360).padStart(3, '0'), cx, ty + 34 * u, 'center', fs * 1.1);
  }

  // ---- airspeed (left) and height (right), each in a box with the number in it -------------------------------------------------------------------------
  const side = (x: number, label: string, value: string, sub: string, align: CanvasTextAlign) => {
    const bw = 78 * u, bh = 24 * u, y = cy, x0 = align === 'right' ? x - bw : x;
    g.beginPath(); g.rect(x0, y - bh / 2, bw, bh); g.fillStyle = 'rgba(0,24,4,0.35)'; g.fill(); g.strokeStyle = SHADOW; g.lineWidth = lw + 2 * u; g.stroke(); g.strokeStyle = GREEN; g.lineWidth = lw; g.stroke();
    text(value, x0 + bw / 2, y + u, 'center', fs * 1.15);
    text(label, x0 + bw / 2, y - bh / 2 - 9 * u, 'center', fs * 0.8, DIM);
    if (sub) text(sub, x0 + bw / 2, y + bh / 2 + 12 * u, 'center', fs * 0.9);
  };
  const sx = Math.max(16 * u, cx - Math.min(W * 0.36, 330 * u)), ex = Math.min(W - 16 * u, cx + Math.min(W * 0.36, 330 * u));
  side(sx, 'SPD m/s', d.airspeed.toFixed(1), '', 'left');
  side(ex, 'ALT m', String(Math.round(d.altitude)), `${d.vsi >= 0 ? '+' : '-'}${Math.abs(d.vsi).toFixed(1)} m/s`, 'right');

  // ---- the bank scale: ticks on an arc over the middle of the view, fixed to the plane; the pointer is the sky, so it swings the way the horizon does ----------------
  { const r0 = Math.min(H * 0.27, 190 * u);
    g.save(); g.translate(cx, cy);
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const ar = (a * Math.PI) / 180, major = a % 30 === 0 || a === 45, l = (major ? 9 : 5) * u, s = Math.sin(ar), c = Math.cos(ar);
      line(s * r0, -c * r0, s * (r0 + l), -c * (r0 + l));
    }
    const pa = -Math.max(-1.3, Math.min(1.3, bank)), ps = Math.sin(pa), pc = Math.cos(pa), pr = r0 - 3 * u;
    line(ps * pr, -pc * pr, ps * pr - pc * 6 * u - ps * 9 * u, -pc * pr - ps * 6 * u + pc * 9 * u); line(ps * pr, -pc * pr, ps * pr + pc * 6 * u - ps * 9 * u, -pc * pr + ps * 6 * u + pc * 9 * u); line(ps * pr - pc * 6 * u - ps * 9 * u, -pc * pr - ps * 6 * u + pc * 9 * u, ps * pr + pc * 6 * u - ps * 9 * u, -pc * pr + ps * 6 * u + pc * 9 * u);
    g.restore();
    text(`${Math.abs(Math.round(deg(bank)))}${bank >= 0 ? 'R' : 'L'}`, cx, cy - r0 - 22 * u, 'center', fs * 0.9);
  }
  text(`G ${d.load.toFixed(1)}`, Math.max(16 * u, cx - Math.min(W * 0.36, 330 * u)), cy + 56 * u, 'left', fs * 0.95);

  // ---- warnings ----------------------------------------------------------------------------------------------------------------------------------------------------
  if (d.stalled && Math.floor(now / 250) % 2 === 0) text('STALL', cx, cy + Math.min(H * 0.2, 130 * u), 'center', fs * 1.6, '#ff5a4a');
  if (d.altitude < 6 && d.vsi < -1.5 && Math.floor(now / 200) % 2 === 0) text('PULL UP', cx, cy + Math.min(H * 0.2, 130 * u) + 22 * u, 'center', fs * 1.2, '#ffb300');
  g.restore();
}

/** The overlay: one canvas over the whole view, redrawn 30 times a second from `data`. */
export function FpvHud({ data, label }: { data: MutableRefObject<Instruments>; label: string }) {
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
    const tick = (now: number) => { raf = requestAnimationFrame(tick); if (now - last < 33) return; last = now; drawFpvHud(ctx, W, H, data.current, now); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [data]);
  return <canvas ref={cv} className="world-fpvhud" role="img" aria-label={label} />;
}
