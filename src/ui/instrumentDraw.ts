/**
 * One round flight instrument for the glide mode, drawn on one square canvas. It folds the old six-pack into a single face:
 *   middle        attitude: sky and ground slide with pitch, turn against the bank; a little plane stays fixed; the slip ball sits under it
 *   outer ring    heading: the compass card turns under a fixed amber mark at the top
 *   left arc      airspeed (red below the stall, green round best glide, amber when fast), the pointer rides the arc
 *   right arc     vertical speed, up is above the middle (white pointer: the ground; cyan: what the air gives)
 *   bottom arc    height above the ground, 0..200 m left to right
 *   top arc       turn rate, the pointer slides right in a right turn
 * The numbers sit on small plates over the horizon. Pure drawing: give it a context, its size in CSS pixels and the numbers.
 */
export interface Instruments {
  airspeed: number;        // m/s
  stallSpeed: number;      // m/s, the bottom of the green arc
  bestGlide: number;       // m/s
  altitude: number;        // m above the ground
  vsi: number;             // m/s, up positive
  energyRate: number;      // m/s, the thin needle on the vertical speed dial: what the air gives, stick movements removed
  heading: number;         // compass degrees, 0 = north, clockwise
  pitch: number;           // rad, nose up positive
  bank: number;            // rad, right wing down positive
  turnRate: number;        // rad/s, anticlockwise positive (maths angle)
  slip: number;            // -1..1, ball to the right is positive
  stalled: boolean;
  load: number;
  landed: boolean;
  mouse: boolean;          // mouse flying is on: the attitude indicator wears an amber ring
  foe: { theta: number; phi: number; dist: number; hunter: boolean; lock: number } | null;   // dogfight: the other plane as seen from the nose (angle off it, which way round, metres, whether it is hunting you, the lock 0..1)
}
export const emptyInstruments = (): Instruments => ({ airspeed: 0, stallSpeed: 5, bestGlide: 7, altitude: 0, vsi: 0, energyRate: 0, heading: 0, pitch: 0, bank: 0, turnRate: 0, slip: 0, stalled: false, load: 1, landed: false, mouse: false, foe: null });

const FACE = '#10151b', BEZEL = '#2b333d', RIM = '#58626f', INK = '#e6edf4', DIM = '#8d99a6', AMBER = '#ffb300', RED = '#ef5350', GREEN = '#66bb6a', CYAN = '#4dd0e1', SKY = '#3f8fd2', GROUND = '#8a5a2b';
const FONT = "'Press Start 2P', ui-monospace, monospace";   // the pixel font; its glyphs are 1 em wide, so the sizes below are scaled down to fit the dials
const FONT_K = 0.62;
const rad = (d: number) => (d * Math.PI) / 180;

function bezel(g: CanvasRenderingContext2D, r: number, warn = false) {
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = warn ? RED : BEZEL; g.fill();
  g.beginPath(); g.arc(0, 0, r * 0.94, 0, Math.PI * 2); g.fillStyle = FACE; g.fill();
  g.lineWidth = r * 0.03; g.strokeStyle = RIM; g.stroke();
}
function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = 'center') {
  g.font = `${Math.max(5, size * FONT_K)}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(text, x, y);
}
function arc(g: CanvasRenderingContext2D, r: number, a0: number, a1: number, w: number, color: string) {
  g.beginPath(); g.arc(0, 0, r, a0, a1); g.lineWidth = w; g.strokeStyle = color; g.stroke();
}
const SPAN = (a: number, b: number) => [rad(a), rad(b)] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A small dark plate with a number on it, so it can be read over sky and ground. */
function plate(g: CanvasRenderingContext2D, text: string, x: number, y: number, r: number, color: string, size = 0.13) {
  const w = text.length * r * size * FONT_K * 1.02 + r * 0.1, h = r * size * 1.35;
  g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h * 0.3); g.fillStyle = 'rgba(5,8,11,0.72)'; g.fill();
  label(g, text, x, y + r * 0.005, r * size, color);
}
/** A pointer on an arc: a small triangle on the outside of the ring, tip towards the middle. */
function marker(g: CanvasRenderingContext2D, ang: number, rr: number, size: number, color: string) {
  g.save(); g.rotate(ang); g.translate(rr + size * 0.55, 0);
  g.beginPath(); g.moveTo(-size * 1.1, 0); g.lineTo(size * 0.7, -size * 0.7); g.lineTo(size * 0.7, size * 0.7); g.closePath(); g.fillStyle = color; g.fill();
  g.restore();
}
function tick(g: CanvasRenderingContext2D, ang: number, r0: number, r1: number, w: number, color: string) {
  g.beginPath(); g.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0); g.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1); g.lineWidth = w; g.strokeStyle = color; g.lineCap = 'butt'; g.stroke();
}

function dial(g: CanvasRenderingContext2D, r: number, d: Instruments, blink: boolean) {
  const lowAlt = d.altitude < 8 && !d.landed && Math.floor(performance.now() / 250) % 2 === 0;
  bezel(g, r, (d.stalled && blink) || lowAlt);

  // ---- outer ring: the compass card turns, the amber mark at the top is the nose
  g.save(); g.rotate(-rad(d.heading));
  for (let a = 0; a < 360; a += 10) {
    const aa = rad(a) - Math.PI / 2, big = a % 30 === 0;
    tick(g, aa, r * 0.9, r * (big ? 0.82 : 0.86), big ? r * 0.03 : r * 0.015, big ? INK : DIM);
  }
  for (const [t, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [string, number][]) {
    const aa = rad(a) - Math.PI / 2; g.save(); g.translate(Math.cos(aa) * r * 0.775, Math.sin(aa) * r * 0.775); g.rotate(rad(a)); label(g, t, 0, 0, r * 0.12, t === 'N' ? AMBER : INK); g.restore();
  }
  g.restore();
  g.beginPath(); g.moveTo(0, -r * 0.93); g.lineTo(-r * 0.045, -r * 0.84); g.lineTo(r * 0.045, -r * 0.84); g.closePath(); g.fillStyle = AMBER; g.fill();

  // ---- left arc: airspeed 0..20 m/s, bottom to top
  const [sa0, sa1] = SPAN(128, 232), RA = r * 0.69, LW = r * 0.06;
  const at = (v: number) => sa0 + (clamp(v, 0, 20) / 20) * (sa1 - sa0);
  arc(g, RA, at(0), at(d.stallSpeed), LW, RED);
  arc(g, RA, at(d.stallSpeed + 0.6), at(d.bestGlide + 2.5), LW, GREEN);
  arc(g, RA, at(14), at(20), LW, AMBER);
  for (let v = 0; v <= 20; v += 5) tick(g, at(v), RA - LW * 0.5, RA - LW * 1.5, r * 0.02, INK);
  marker(g, at(d.airspeed), RA + LW * 0.5, r * 0.055, d.stalled ? RED : INK);

  // ---- right arc: vertical speed +-5 m/s, up is above the middle
  const vat = (v: number) => -(clamp(v, -5, 5) / 5) * rad(48);
  arc(g, RA, vat(5), vat(0.05), LW * 0.7, GREEN); arc(g, RA, vat(-0.05), vat(-5), LW * 0.7, RED);
  for (let v = -5; v <= 5; v++) tick(g, vat(v), RA - LW * 0.4, RA - LW * (v === 0 ? 1.7 : 1.2), r * (v === 0 ? 0.03 : 0.015), INK);
  marker(g, vat(d.energyRate), RA + LW * 0.5, r * 0.04, CYAN);
  marker(g, vat(d.vsi), RA + LW * 0.5, r * 0.055, INK);

  // ---- bottom arc: height 0..200 m, left to right
  const hat = (m: number) => rad(120) - (clamp(m, 0, 200) / 200) * rad(60);
  arc(g, RA, rad(60), rad(120), LW * 0.7, '#2f3944');
  if (d.altitude > 0) arc(g, RA, hat(clamp(d.altitude, 0, 200)), rad(120), LW * 0.7, d.altitude < 8 ? RED : SKY);
  for (let m = 0; m <= 200; m += 50) tick(g, hat(m), RA - LW * 0.4, RA - LW * 1.4, r * 0.02, INK);
  marker(g, hat(d.altitude), RA + LW * 0.5, r * 0.055, INK);

  // ---- top arc: turn rate; the pointer slides right in a right turn, the ticks are a standard rate
  const tat = (rate: number) => rad(-90) + clamp(-rate / 1.6, -1, 1) * rad(24);
  arc(g, RA, rad(-114), rad(-66), LW * 0.5, '#2f3944');
  for (const k of [-1, 0, 1]) tick(g, tat(k * 1.6 * 0.5), RA - LW * 0.4, RA - LW * 1.2, r * 0.02, INK);
  marker(g, tat(d.turnRate), RA + LW * 0.5, r * 0.05, Math.abs(d.turnRate) > 1.6 ? AMBER : INK);

  // ---- middle: the attitude indicator
  const R = r * 0.6, per = R / rad(30);
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
  g.rotate(-d.bank); g.translate(0, d.pitch * per);
  g.fillStyle = SKY; g.fillRect(-R * 3, -R * 4, R * 6, R * 4);
  g.fillStyle = GROUND; g.fillRect(-R * 3, 0, R * 6, R * 4);
  g.strokeStyle = INK; g.lineWidth = r * 0.02; g.beginPath(); g.moveTo(-R * 3, 0); g.lineTo(R * 3, 0); g.stroke();
  for (let p = -20; p <= 20; p += 10) {
    if (p === 0) continue;
    const y = -rad(p) * per, w = p % 20 === 0 ? R * 0.3 : R * 0.18;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
  }
  g.restore();
  g.lineWidth = r * 0.02; g.strokeStyle = d.mouse ? AMBER : RIM; if (d.mouse) g.lineWidth = r * 0.06; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();   // (an amber ring: the mouse flies pitch and roll)
  // bank pointer on the disc's rim, fixed ticks at 0 / 30 / 60 degrees
  for (const a of [-60, -30, 0, 30, 60]) { const aa = rad(a) - Math.PI / 2; tick(g, aa, R, R - r * (a === 0 ? 0.08 : 0.05), r * 0.025, INK); }
  g.save(); g.rotate(-d.bank);
  g.beginPath(); g.moveTo(0, -R + r * 0.01); g.lineTo(-r * 0.045, -R + r * 0.1); g.lineTo(r * 0.045, -R + r * 0.1); g.closePath(); g.fillStyle = AMBER; g.fill();
  g.restore();
  // the little plane that stays fixed
  g.strokeStyle = AMBER; g.lineWidth = r * 0.045; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.32, 0); g.lineTo(-r * 0.12, 0); g.lineTo(-r * 0.08, r * 0.07); g.moveTo(r * 0.32, 0); g.lineTo(r * 0.12, 0); g.lineTo(r * 0.08, r * 0.07); g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.035, 0, Math.PI * 2); g.fillStyle = AMBER; g.fill();

  // dogfight: the other plane, fixed to the plane's own frame (the disc is 30 degrees from the nose to its rim, which is also the lock cone). Inside the rim it is a ring and a diamond; further off it is an arrow on the rim pointing the way to turn
  if (d.foe) {
    // the anti-target: straight away from the other plane (it comes onto the disc when the other plane is behind you). A cross in a diamond, in the opponent's colour but paler; on the rim a small pale arrow
    const f0 = d.foe, aTheta = Math.PI - f0.theta, aPhi = f0.phi + Math.PI, aEdge = R * 0.88, aOff = Math.min(aTheta * per, aEdge), aOut = aTheta * per > aEdge, ax = Math.cos(aPhi) * aOff, ay = -Math.sin(aPhi) * aOff, aCol = f0.hunter ? '#ff9a95' : '#a9d3ff';
    g.save(); g.translate(ax, ay);
    if (aOut) { g.rotate(Math.atan2(ay, ax) + Math.PI / 2); g.beginPath(); g.moveTo(0, -r * 0.045); g.lineTo(-r * 0.04, r * 0.03); g.lineTo(r * 0.04, r * 0.03); g.closePath(); g.globalAlpha = 0.75; g.fillStyle = aCol; g.fill(); g.globalAlpha = 1; g.lineWidth = r * 0.012; g.strokeStyle = '#05080b'; g.stroke(); }
    else { const k = r * 0.05; g.beginPath(); g.moveTo(0, -k); g.lineTo(k, 0); g.lineTo(0, k); g.lineTo(-k, 0); g.closePath(); g.fillStyle = 'rgba(5,8,11,0.6)'; g.fill(); g.lineWidth = r * 0.02; g.strokeStyle = aCol; g.stroke(); g.beginPath(); g.moveTo(-k * 0.55, -k * 0.55); g.lineTo(k * 0.55, k * 0.55); g.moveTo(k * 0.55, -k * 0.55); g.lineTo(-k * 0.55, k * 0.55); g.stroke(); }
    g.restore();
  }
  if (d.foe) {
    const f = d.foe, col = f.hunter ? RED : '#6fb7ff', edge = R * 0.88, off = Math.min(f.theta * per, edge), out = f.theta * per > edge, px = Math.cos(f.phi) * off, py = -Math.sin(f.phi) * off;
    if (f.lock > 0) { g.beginPath(); g.arc(px, py, r * (0.16 - 0.09 * Math.min(1, f.lock)), 0, Math.PI * 2); g.lineWidth = r * 0.025; g.strokeStyle = AMBER; g.stroke(); }
    g.save(); g.translate(px, py);
    if (out) { g.rotate(Math.atan2(py, px) + Math.PI / 2); g.beginPath(); g.moveTo(0, -r * 0.07); g.lineTo(-r * 0.055, r * 0.04); g.lineTo(r * 0.055, r * 0.04); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = r * 0.015; g.strokeStyle = '#05080b'; g.stroke(); }
    else { const k = r * 0.055; g.beginPath(); g.moveTo(0, -k); g.lineTo(k, 0); g.lineTo(0, k); g.lineTo(-k, 0); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = r * 0.02; g.strokeStyle = '#05080b'; g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.09, 0, Math.PI * 2); g.lineWidth = r * 0.02; g.strokeStyle = col; g.stroke(); }
    g.restore();
    plate(g, `${Math.round(f.dist)}m`, 0, r * 0.19, r, col, 0.1);
  }

  // the slip tube under the plane
  g.save(); g.translate(0, r * 0.5);
  g.beginPath(); g.roundRect(-r * 0.3, -r * 0.055, r * 0.6, r * 0.11, r * 0.055); g.fillStyle = 'rgba(5,8,11,0.8)'; g.fill(); g.lineWidth = r * 0.015; g.strokeStyle = RIM; g.stroke();
  g.lineWidth = r * 0.015; g.strokeStyle = INK; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * r * 0.07, -r * 0.055); g.lineTo(s * r * 0.07, r * 0.055); g.stroke(); }
  g.beginPath(); g.arc(clamp(d.slip, -1, 1) * r * 0.22, 0, r * 0.042, 0, Math.PI * 2); g.fillStyle = Math.abs(d.slip) > 0.4 ? AMBER : INK; g.fill();
  g.restore();

  // the numbers, on plates over the horizon
  plate(g, d.airspeed.toFixed(0), -r * 0.34, -r * 0.2, r, d.stalled ? RED : AMBER);
  plate(g, (d.vsi >= 0 ? '+' : '') + d.vsi.toFixed(1), r * 0.34, -r * 0.2, r, d.vsi >= 0.1 ? GREEN : d.vsi < -0.1 ? RED : INK);
  plate(g, String(Math.max(0, Math.round(d.altitude))) + 'm', 0, r * 0.32, r, AMBER, 0.15);
  plate(g, String(Math.round(d.heading) % 360).padStart(3, '0'), 0, -r * 0.42, r, AMBER, 0.11);
}

export function drawInstruments(ctx: CanvasRenderingContext2D, W: number, H: number, d: Instruments) {
  ctx.clearRect(0, 0, W, H);
  const S = Math.min(W, H), r = S / 2 - 2, blink = Math.floor(performance.now() / 200) % 2 === 0;
  ctx.save(); ctx.translate(W / 2, H / 2); dial(ctx, r, d, blink); ctx.restore();
}
