import { FIELD_H, FIELD_W, RETICLE_REACH, THROWER, trajectory, type BobrStage, type GameState, type HitEvent } from '../domain';
import { rawUrl } from './themes';

export interface Sprites { target: HTMLImageElement; stone: HTMLImageElement; bobr: HTMLImageElement }

const load = (name: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Could not load ${name}`));
  img.src = rawUrl(name);
});
export const loadSprites = async (stage: BobrStage): Promise<Sprites> => {
  const [target, stone, bobr] = await Promise.all([load('target'), load('stone'), load(`bobr_${stage.toLowerCase()}`)]);
  return { target, stone, bobr };
};

interface Particle { x: number; y: number; vx: number; vy: number; size: number; age: number }
interface Popup { x: number; y: number; text: string; age: number; big: boolean }
/** Short-lived visual effects (not part of the game rules). */
export interface Fx { particles: Particle[]; popups: Popup[]; banner: { text: string; age: number } | null }
export const newFx = (): Fx => ({ particles: [], popups: [], banner: null });

const PARTICLE_LIFE = 1, POPUP_LIFE = 1.1, BANNER_LIFE = 1.6;

export function addHit(fx: Fx, h: HitEvent, rng: () => number = Math.random) {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, v = 250 + rng() * 450;           // logical px / s
    fx.particles.push({ x: h.x, y: h.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 12 + Math.floor(rng() * 3) * 6, age: 0 });
  }
  fx.popups.push({ x: h.x, y: h.y - 30, text: `+${h.points}`, age: 0, big: h.bullseye });
}
export function tickFx(fx: Fx, dt: number) {
  fx.particles = fx.particles.map(p => ({ ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt + 400 * dt * dt, vy: p.vy + 800 * dt, age: p.age + dt })).filter(p => p.age < PARTICLE_LIFE);
  fx.popups = fx.popups.map(p => ({ ...p, y: p.y - 70 * dt, age: p.age + dt })).filter(p => p.age < POPUP_LIFE);
  if (fx.banner) { fx.banner = { ...fx.banner, age: fx.banner.age + dt }; if (fx.banner.age >= BANNER_LIFE) fx.banner = null; }
}

const GOLD = '#ffd700', DARK = '#1a1812';
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, alpha = 1, color = GOLD) {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.font = `${size}px "Press Start 2P", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 4; ctx.strokeStyle = DARK; ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y); ctx.fillStyle = color; ctx.fillText(s, x, y);
  ctx.restore();
}

/** Draw one frame. The context is already scaled so that (0,0)-(FIELD_W,FIELD_H) fills the canvas. */
/** The aiming reticle is drawn only when this is true (aiming by touch still works without it). */
const SHOW_RETICLE = false;

export function drawGame(ctx: CanvasRenderingContext2D, s: GameState, sp: Sprites, fx: Fx, comboLabel: string, clear = false) {
  ctx.imageSmoothingEnabled = false;
  // ground under the thrower (`clear`: the pen's own scenery is behind the canvas, so nothing is painted under the play)
  const ground = THROWER.y + sp.bobr.height / 2;
  if (clear) ctx.clearRect(0, 0, FIELD_W, FIELD_H);
  else {
    ctx.fillStyle = '#23211a'; ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.fillStyle = '#2d2b22'; ctx.fillRect(0, ground, FIELD_W, FIELD_H - ground);
    ctx.fillStyle = '#44412f'; ctx.fillRect(0, ground, FIELD_W, 8);
  }

  ctx.drawImage(sp.bobr, THROWER.x - sp.bobr.width / 2, THROWER.y - sp.bobr.height / 2);

  // aiming: a short guide at the current angle, and the predicted path once there is some power
  const a = (s.angle * Math.PI) / 180;
  if (SHOW_RETICLE && !s.paused) {   // the reticle: where the angle and power point; dragging it (or the sliders) moves the other
    const d = Math.max(60, s.power * RETICLE_REACH), rx = THROWER.x + Math.cos(a) * d, ry = THROWER.y - Math.sin(a) * d;
    ctx.strokeStyle = s.power > 0.01 ? GOLD : '#e8e5d2'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(rx, ry, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx - 40, ry); ctx.lineTo(rx - 12, ry); ctx.moveTo(rx + 12, ry); ctx.lineTo(rx + 40, ry);
    ctx.moveTo(rx, ry - 40); ctx.lineTo(rx, ry - 12); ctx.moveTo(rx, ry + 12); ctx.lineTo(rx, ry + 40); ctx.stroke();
  }
  if (s.power > 0.01) {
    const path = trajectory(s.angle, Math.max(0.1, s.power));
    path.forEach((p, i) => { if (i % 5 === 0 && i > 0) { ctx.globalAlpha = Math.max(0.15, 0.8 - i / path.length * 0.7); ctx.fillStyle = GOLD; ctx.fillRect(p.x - 5, p.y - 5, 10, 10); } });
    ctx.globalAlpha = 1;
  }

  for (const t of s.targets) if (!t.hit) ctx.drawImage(sp.target, t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);

  for (const r of s.rocks) {
    if (!r.active) continue;
    r.trail.forEach((p, i, arr) => {
      const next = arr[i + 1] ?? { x: r.x, y: r.y }, k = i / arr.length;
      ctx.globalAlpha = (1 - k) * 0.6; ctx.strokeStyle = k < 0.33 ? '#ffd700' : k < 0.66 ? '#ffa500' : '#ff6347'; ctx.lineWidth = Math.max(4, 14 * (1 - k));
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(next.x, next.y); ctx.stroke();
    });
    ctx.globalAlpha = 0.3; ctx.drawImage(sp.stone, r.x - 32 + 6, r.y - 32 + 6, 64, 64);
    ctx.globalAlpha = 1; ctx.drawImage(sp.stone, r.x - 32, r.y - 32, 64, 64);
  }

  for (const p of fx.particles) { ctx.globalAlpha = 1 - p.age / PARTICLE_LIFE; ctx.fillStyle = GOLD; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
  for (const p of fx.popups) text(ctx, p.text, p.x, p.y, p.big ? 44 : 32, 1 - p.age / POPUP_LIFE, p.big ? '#ff8a8a' : GOLD);
  if (s.combo >= 2) text(ctx, `${comboLabel}${s.combo}`, FIELD_W / 2, 60, 36);
  if (fx.banner) text(ctx, fx.banner.text, FIELD_W / 2, FIELD_H * 0.35, 54, Math.min(1, (BANNER_LIFE - fx.banner.age) * 2));
}
