/**
 * Rock-throwing minigame engine, ported from Android (GameStateManager, GameLevelGenerator, ProjectilePhysics,
 * ScoreCalculator, RewardCalculator, Target.updatePosition). Pure functions: time and randomness are passed in, so the
 * whole game is deterministic under test. The field is a fixed logical space (FIELD_W x FIELD_H, Android's px at ~3x
 * density) that the UI scales to the screen, so the game plays the same on every device.
 *
 * Deliberate differences from Android, where its own rules could not work as described (see BACKLOG.md and BACKLOG_DONE.md):
 *  - the combo carries across throws and resets when a thrown rock misses everything (Android reset it every frame);
 *  - the distance bonus is measured from the thrower to the target (Android measured hit point to target centre = ~0);
 *  - the accuracy bonus uses how close the rock's flight path passes to the target centre, so a "bullseye" is reachable;
 *  - rocks move in sub-steps so a fast rock cannot jump over a small target on a slow frame.
 */

export type Rng = () => number;
export type GameMode = 'PRACTICE' | 'ARCADE' | 'TIMETRIAL';
export type TargetKind = 'SMALL' | 'MEDIUM' | 'LARGE';
export type Movement =
  | 'STATIC' | 'HORIZONTAL' | 'VERTICAL' | 'BOUNCING' | 'CIRCULAR' | 'WANDER' | 'TELEPORT'
  | 'FIGURE_EIGHT' | 'SINE_WAVE' | 'ZIGZAG' | 'SPEED_CHANGER' | 'PENDULUM';

export const FIELD_W = 1080;
export const FIELD_H = 1200;
/** Where Bóbr stands (the centre of his sprite, and where rocks leave from): well down in the meadow, near the bottom edge. */
export const THROWER = { x: FIELD_W * 0.12, y: FIELD_H * 0.73 };
/** He is drawn this much bigger than his sprite's own pixels: the nearer the bottom edge, the bigger (the same law as in his pen). */
export const BOBR_SCALE = 1.2;
export const GRAVITY = 980;
export const MAX_SPEED = 1500;
/** Logical distance from the thrower to the aiming reticle at full power. */
export const RETICLE_REACH = 800;
export const ROCK_RADIUS = 8;          // collision radius (the sprite is drawn larger)
export const THROWS_PER_LEVEL = 5;
export const HITS_PER_LEVEL = 4;       // targets to hit per level number (level 2 = 8 hits in total)
export const ACTIVE_TARGETS = 3;
export const PLAY_COST_STONE = 5;
export const TARGET_POINTS: Record<TargetKind, number> = { SMALL: 20, MEDIUM: 10, LARGE: 5 };
export const TARGET_SIZE: Record<TargetKind, number> = { SMALL: 48, MEDIUM: 96, LARGE: 144 };   // 16 / 32 / 48 dp at 3x
export const BULLSEYE_AT = 0.1;        // normalised distance from the centre line that counts as "perfect centre"
export const FAST_LEVEL_SECONDS = 30;
/** Time trial: a countdown, unlimited rocks; every hit buys more time and a quick follow-up hit pays more points. */
export const TRIAL_START_SECONDS = 30;
export const TRIAL_HIT_SECONDS = 1;
export const TRIAL_MISS_SECONDS = 1;
export const TRIAL_MAX_SECONDS = 99;
export const FAR_HIT_DISTANCE = 900;   // thrower -> target, for "Distance King"

export interface Pt { x: number; y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
const rectW = (r: Rect) => r.right - r.left;
const rectH = (r: Rect) => r.bottom - r.top;
const center = (r: Rect): Pt => ({ x: r.left + rectW(r) / 2, y: r.top + rectH(r) / 2 });
export const FIELD: Rect = { left: 0, top: 0, right: FIELD_W, bottom: FIELD_H };

export interface Target {
  id: number; kind: TargetKind; x: number; y: number; size: number;
  movement: Movement; speed: number; hit: boolean;
  /** Movement state; meaning depends on the pattern (direction, angle, phase, teleport index...), as in Android. */
  dx: number; dy: number; changedAt: number;
  area: Rect; teleport: Pt[];
}
export interface Rock {
  id: number; x: number; y: number; vx: number; vy: number; angle: number; power: number;
  active: boolean; hits: number; trail: Pt[];
}
export interface GameState {
  mode: GameMode;
  score: number; level: number;
  /** Infinity in practice mode. */
  throwsRemaining: number; throwsMade: number;
  targetsHit: number; combo: number; longestCombo: number;
  power: number; angle: number;
  targets: Target[]; rocks: Rock[];
  /** Seconds of play (paused time excluded) and when the current level began. */
  clock: number; levelStart: number; levelMisses: number;
  bullseyes: number; fastLevel: boolean; perfectLevel: boolean; farHit: boolean;
  /** Time trial only: seconds left (Infinity in the other modes) and when (game clock) the last target was hit. */
  timeLeft: number; lastHitAt: number;
  paused: boolean; nextId: number;
}
export interface HitEvent { x: number; y: number; points: number; bullseye: boolean; combo: number; kind: TargetKind }
export interface StepResult { state: GameState; hits: HitEvent[]; levelUp: number | null }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

// ---- level generation ------------------------------------------------------------------------------------------

/** Movement patterns available at a level, as a weighted list (Android: more variety and weight on harder ones). */
export function movementPool(level: number): Movement[] {
  const w = (m: Movement, n: number) => Array<Movement>(n).fill(m);
  if (level < 2) return ['STATIC'];
  if (level >= 8) return [...w('BOUNCING', 4), ...w('CIRCULAR', 3), ...w('WANDER', 3), ...w('ZIGZAG', 3), ...w('TELEPORT', 3), ...w('FIGURE_EIGHT', 2), ...w('SPEED_CHANGER', 2), ...w('HORIZONTAL', 2), ...w('VERTICAL', 2)];
  if (level >= 5) return [...w('BOUNCING', 3), ...w('CIRCULAR', 2), ...w('WANDER', 2), ...w('FIGURE_EIGHT', 2), ...w('SINE_WAVE', 2), ...w('PENDULUM', 2), ...w('TELEPORT', 2), ...w('HORIZONTAL', 2), ...w('VERTICAL', 2)];
  if (level >= 3) return [...w('BOUNCING', 2), ...w('PENDULUM', 2), ...w('SINE_WAVE', 2), ...w('TELEPORT', 2), ...w('HORIZONTAL', 2), ...w('VERTICAL', 2)];
  return ['HORIZONTAL', 'VERTICAL'];
}

/** Pixels per second: 0 on level 1, 80 from level 2, +60 per level, capped at 250. */
export const targetSpeed = (level: number) => (level >= 2 ? Math.min(250, 80 + Math.max(0, (level - 2) * 60)) : 0);

const pick = <T,>(list: T[], rng: Rng): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sign = (rng: Rng) => (rng() < 0.5 ? 1 : -1);
const ZIGZAG_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

export function createTarget(id: number, kind: TargetKind, level: number, now: number, rng: Rng): Target {
  const size = TARGET_SIZE[kind], half = size / 2, margin = 60;
  const minX = THROWER.x + margin + half, maxX = FIELD.right - margin - half;
  const x = maxX > minX ? minX + rng() * (maxX - minX) : minX;
  const maxY = THROWER.y - margin - half, minY = FIELD.top + margin + half;
  const y = maxY > minY ? minY + rng() * (maxY - minY) : minY;
  const movement = pick(movementPool(level), rng);

  let teleport: Pt[] = [];
  if (movement === 'TELEPORT') {
    const n = 4 + Math.floor(rng() * 5);                                         // 4-8 points
    teleport = Array.from({ length: n }, () => ({ x: minX + rng() * Math.max(0, maxX - minX), y: minY + rng() * Math.max(0, maxY - minY) }));
  }
  let dx = 1, dy = 1, changedAt = 0;
  switch (movement) {
    case 'CIRCULAR': case 'FIGURE_EIGHT': dx = rng() * TAU; dy = 0; break;
    case 'BOUNCING': dx = sign(rng); dy = sign(rng); break;
    case 'WANDER': { const a = rng() * TAU; dx = Math.cos(a); dy = Math.sin(a); changedAt = now; break; }
    case 'TELEPORT': dx = 0; dy = 0; changedAt = now; break;
    case 'SINE_WAVE': dx = sign(rng); dy = 0; break;
    case 'ZIGZAG': dx = pick(ZIGZAG_ANGLES, rng); dy = 0; break;
    case 'SPEED_CHANGER': dx = rng() * TAU; dy = rng() * TAU; break;     // dx = speed phase, dy = travel angle
    case 'PENDULUM': dx = (rng() - 0.5) * (Math.PI / 3); dy = sign(rng); break;
    case 'HORIZONTAL': dx = sign(rng); dy = 1; break;
    case 'VERTICAL': dx = 1; dy = sign(rng); break;
  }
  const reach = Math.min(FIELD_W, FIELD_H) * 0.4 / 2;
  const area: Rect = { left: Math.max(x - reach, minX), top: Math.max(y - reach, FIELD.top), right: Math.min(x + reach, FIELD.right), bottom: Math.min(y + reach, maxY) };
  const start = movement === 'TELEPORT' && teleport.length ? teleport[0] : { x, y };
  return { id, kind, x: start.x, y: start.y, size, movement, speed: targetSpeed(level), hit: false, dx, dy, changedAt, area, teleport };
}

/** 20% small, 60% medium, 20% large. */
const randomKind = (rng: Rng): TargetKind => { const r = rng(); return r < 0.2 ? 'SMALL' : r < 0.8 ? 'MEDIUM' : 'LARGE'; };

export function generateLevel(level: number, now: number, firstId: number, rng: Rng): Target[] {
  const count = 3 + Math.floor(level / 2);
  const small = Math.floor(count * clamp(level * 0.1, 0, 0.5));
  const kinds: TargetKind[] = [...Array<TargetKind>(small).fill('SMALL'), ...Array<TargetKind>(Math.max(0, count - small - 1)).fill('MEDIUM'), 'LARGE'];
  return kinds.map((k, i) => createTarget(firstId + i, k, level, now, rng));
}

// ---- target movement -------------------------------------------------------------------------------------------

/** One frame of movement for a target (Android Target.updatePosition). `now` is wall-clock ms, used by wander/teleport. */
export function moveTarget(t: Target, dt: number, now: number, rng: Rng): Target {
  if (t.hit || t.movement === 'STATIC') return t;
  dt = clamp(dt, 0, 0.1);
  const half = t.size / 2;
  const b = t.movement === 'HORIZONTAL' || t.movement === 'VERTICAL' ? FIELD : t.area;
  const minX = b.left + half, maxX = b.right - half, minY = b.top + half, maxY = b.bottom - half;
  const c = center(t.area);
  const next = { ...t };
  const fieldX = (v: number) => clamp(v, FIELD.left + half, FIELD.right - half);
  const fieldY = (v: number) => clamp(v, FIELD.top + half, FIELD.bottom - half);
  const step = t.speed * dt;

  switch (t.movement) {
    case 'HORIZONTAL': {
      next.x = clamp(t.x + step * t.dx, minX, maxX);
      if (next.x <= minX || next.x >= maxX) next.dx = -t.dx;
      break;
    }
    case 'VERTICAL': {
      next.y = clamp(t.y + step * t.dy, minY, maxY);
      if (next.y <= minY || next.y >= maxY) next.dy = -t.dy;
      break;
    }
    case 'BOUNCING': {
      next.x = clamp(t.x + step * t.dx, minX, maxX);
      next.y = clamp(t.y + step * t.dy, minY, maxY);
      if (next.x - half <= b.left || next.x + half >= b.right) next.dx = -t.dx;
      if (next.y - half <= b.top || next.y + half >= b.bottom) next.dy = -t.dy;
      break;
    }
    case 'CIRCULAR': {
      const maxR = Math.min(Math.min(c.x - half, FIELD_W - half - c.x), Math.min(c.y - half, FIELD_H - half - c.y));
      const radius = Math.min(Math.max(Math.min(FIELD_W, FIELD_H) * 0.2, 80), Math.max(maxR, 40));
      const a = t.dx + (t.speed * dt) / radius;
      next.x = fieldX(c.x + radius * Math.cos(a)); next.y = fieldY(c.y + radius * Math.sin(a)); next.dx = a;
      break;
    }
    case 'WANDER': {
      let dx = t.dx, dy = t.dy;
      if (now - t.changedAt >= 800 + rng() * 1200) {                       // pick a new heading, eased in
        const a = rng() * TAU, k = 2.5 * dt;
        dx = t.dx + (Math.cos(a) - t.dx) * k; dy = t.dy + (Math.sin(a) - t.dy) * k;
        const len = Math.hypot(dx, dy); if (len > 0.001) { dx /= len; dy /= len; }
        next.changedAt = now;
      } else {                                                              // small continuous drift
        const a = Math.atan2(t.dy, t.dx) + (rng() - 0.5) * 0.05 * dt;
        dx = Math.cos(a); dy = Math.sin(a);
      }
      // steer away from the walls
      const near = 80;
      let ax = dx, ay = dy;
      const px = t.x + step * dx, py = t.y + step * dy;
      const dl = px - half - b.left, dr = b.right - (px + half), dtp = py - half - b.top, db = b.bottom - (py + half);
      if (dl <= near && dx < 0) ax += (1 - dl / near) * 0.3;
      if (dr <= near && dx > 0) ax -= (1 - dr / near) * 0.3;
      if (dtp <= near && dy < 0) ay += (1 - dtp / near) * 0.3;
      if (db <= near && dy > 0) ay -= (1 - db / near) * 0.3;
      const al = Math.hypot(ax, ay); if (al > 0.001) { ax /= al; ay /= al; }
      dx = dx * 0.85 + ax * 0.15; dy = dy * 0.85 + ay * 0.15;
      const fl = Math.hypot(dx, dy); if (fl > 0.001) { dx /= fl; dy /= fl; }
      next.x = clamp(t.x + step * dx, minX, maxX); next.y = clamp(t.y + step * dy, minY, maxY);
      if ((next.x <= minX && dx < 0) || (next.x >= maxX && dx > 0)) dx = -dx;
      if ((next.y <= minY && dy < 0) || (next.y >= maxY && dy > 0)) dy = -dy;
      next.dx = dx; next.dy = dy;
      break;
    }
    case 'FIGURE_EIGHT': {
      const r = Math.min(rectW(t.area), rectH(t.area)) * 0.12;
      const a = t.dx + (t.speed * dt) / Math.max(r, 1);
      next.x = fieldX(c.x + r * Math.sin(a)); next.y = fieldY(c.y + r * Math.sin(a) * Math.cos(a)); next.dx = a;
      break;
    }
    case 'SINE_WAVE': {
      const amp = Math.min(rectW(t.area), rectH(t.area)) * 0.15;
      const x = clamp(t.x + step * t.dx, minX, maxX);
      const progress = (x - t.area.left) / Math.max(1, rectW(t.area));
      next.x = x; next.y = fieldY(c.y + amp * Math.sin(progress * 0.5 * TAU));
      if (x <= minX || x >= maxX) next.dx = -t.dx;
      break;
    }
    case 'ZIGZAG': {
      const dist = t.dy + step;
      const a = dist >= 120 ? pick(ZIGZAG_ANGLES, rng) : t.dx;
      next.x = clamp(t.x + step * Math.cos(a), minX, maxX); next.y = clamp(t.y + step * Math.sin(a), minY, maxY);
      next.dx = a; next.dy = dist >= 120 ? 0 : dist;
      break;
    }
    case 'SPEED_CHANGER': {
      const phase = t.dx + dt * 1.5;
      const v = t.speed * (0.5 + 0.5 * Math.sin(phase));
      next.x = clamp(t.x + v * dt * Math.cos(t.dy), minX, maxX); next.y = clamp(t.y + v * dt * Math.sin(t.dy), minY, maxY);
      let ang = t.dy;
      if (next.x <= minX || next.x >= maxX) ang = Math.PI - ang;
      if (next.y <= minY || next.y >= maxY) ang = -ang;
      next.dx = phase; next.dy = ang;
      break;
    }
    case 'PENDULUM': {
      const len = Math.min(rectW(t.area), rectH(t.area)) * 0.25;
      const a = t.dx + (t.speed / Math.max(len, 1)) * dt * t.dy;
      const top = t.area.top + half;
      next.x = clamp(c.x + len * Math.sin(a), minX, maxX); next.y = clamp(top + len * Math.cos(a), minY, maxY);
      next.dx = a;
      if (next.y <= minY || next.y >= maxY) next.dy = -t.dy;
      break;
    }
    case 'TELEPORT': {
      if (!t.teleport.length) break;
      const i = clamp(Math.trunc(t.dx), 0, t.teleport.length - 1);
      if (now - t.changedAt >= 1000) {                                      // jump every second
        const n = (i + 1) % t.teleport.length;
        next.x = t.teleport[n].x; next.y = t.teleport[n].y; next.dx = n; next.changedAt = now;
      } else { next.x = t.teleport[i].x; next.y = t.teleport[i].y; }
      break;
    }
  }
  return next;
}

// ---- physics ---------------------------------------------------------------------------------------------------

export function launchVelocity(angleDeg: number, power: number) {
  const speed = MAX_SPEED * power, a = (angleDeg * Math.PI) / 180;
  return { vx: speed * Math.cos(a), vy: -speed * Math.sin(a) };      // y grows downward
}

/** Where a rock thrown now will be, for the aiming preview (Android calculateTrajectory). */
export function trajectory(angleDeg: number, power: number, maxPoints = 100): Pt[] {
  const { vx, vy } = launchVelocity(angleDeg, power), pts: Pt[] = [];
  for (let i = 0, t = 0; i < maxPoints; i++, t += 0.01) {
    const x = THROWER.x + vx * t, y = THROWER.y + vy * t + 0.5 * GRAVITY * t * t;
    pts.push({ x, y });
    if (y > THROWER.y + 1000 || x > THROWER.x + 2000) break;
  }
  return pts;
}

/** Circle (rock) against a target's square. */
export function rockHitsTarget(r: Pt, t: Target): boolean {
  const h = t.size / 2;
  const dx = r.x - clamp(r.x, t.x - h, t.x + h), dy = r.y - clamp(r.y, t.y - h, t.y + h);
  return dx * dx + dy * dy <= ROCK_RADIUS * ROCK_RADIUS;
}

/** How centred a shot was: the nearest the rock's flight path (on from the moment it touched) comes to the target's centre. */
export function closestApproach(r: Pick<Rock, 'x' | 'y' | 'vx' | 'vy'>, t: Pick<Target, 'x' | 'y'>): number {
  let best = Infinity;
  for (let k = 0; k <= 125; k++) {                                        // 0.25 s ahead in 2 ms steps
    const dt = k * 0.002;
    const x = r.x + r.vx * dt, y = r.y + r.vy * dt + 0.5 * GRAVITY * dt * dt;
    best = Math.min(best, Math.hypot(x - t.x, y - t.y));
  }
  return best;
}

// ---- scoring & rewards -----------------------------------------------------------------------------------------

export function distanceBonus(d: number): number {
  if (d < 500) return 1;
  if (d < 1000) return 1 + ((d - 500) / 500) * 0.5;
  return 1.5 + Math.min(0.5, ((d - 1000) / 1000) * 0.5);
}
/** `offset` = how far the shot's line passed from the target centre, `half` = half the target size. */
export function accuracyBonus(offset: number, half: number): number {
  if (half <= 0) return 1;
  const n = clamp(offset / half, 0, 1);
  return n < BULLSEYE_AT ? 2 : n < 0.3 ? 1.5 : n < 0.6 ? 1.2 : 1;
}
export function comboBonus(combo: number): number {
  return combo <= 1 ? 1 : combo === 2 ? 1.1 : combo === 3 ? 1.2 : combo === 4 ? 1.4 : 1.5;
}
/** Time trial: the quicker a hit follows the last one (or the start), the more it pays. `gap` = seconds since then. */
export function speedBonus(gap: number): number {
  return gap <= 2 ? 2 : gap <= 4 ? 1.5 : gap <= 7 ? 1.2 : 1;
}
export const totalScore = (base: number, multipliers: number[]) => Math.floor(base * multipliers.reduce((a, m) => a * m, 1));

/** What a rock game pays: XP and item drops only. It never gives Body, Mind or Soul points (those come from tasks, habits and exercise). */
export interface Rewards { xp: number; items: string[] }
export function calculateRewards(score: number, level: number, targetsHit: number, mode: GameMode): Rewards {
  const xp = Math.floor(score / 10) + level * 10 + targetsHit * 2;
  const items = new Set<string>();
  if (score >= 1000) items.add('bcoin');
  if (level >= 5) items.add('stone');
  if (level >= 10) items.add('bcoin');
  if (level >= 3) items.add('hay');                       // food for Bóbr
  if (targetsHit >= 15) items.add('stick');
  if (mode === 'TIMETRIAL' && level >= 4) items.add('berry');   // the fast game pays in the treat
  return { xp, items: [...items] };
}

// ---- game flow -------------------------------------------------------------------------------------------------

export function initGame(mode: GameMode, now: number, rng: Rng): GameState {
  const targets = generateLevel(1, now, 1, rng);
  return {
    mode, score: 0, level: 1, throwsRemaining: mode === 'ARCADE' ? THROWS_PER_LEVEL : Infinity, throwsMade: 0,
    targetsHit: 0, combo: 0, longestCombo: 0, power: 0, angle: 45, targets, rocks: [],
    clock: 0, levelStart: 0, levelMisses: 0, bullseyes: 0, fastLevel: false, perfectLevel: false, farHit: false,
    timeLeft: mode === 'TIMETRIAL' ? TRIAL_START_SECONDS : Infinity, lastHitAt: 0,
    paused: false, nextId: targets.length + 1,
  };
}
export const setPower = (s: GameState, p: number): GameState => ({ ...s, power: clamp(p, 0, 1) });
export const setAngle = (s: GameState, a: number): GameState => ({ ...s, angle: clamp(a, 0, 90) });
export const canThrow = (s: GameState) => s.throwsRemaining > 0 && !s.paused && s.timeLeft > 0;

export function throwRock(s: GameState): GameState {
  if (!canThrow(s)) return s;
  const { vx, vy } = launchVelocity(s.angle, s.power);
  const rock: Rock = { id: s.nextId, x: THROWER.x, y: THROWER.y, vx, vy, angle: s.angle, power: s.power, active: true, hits: 0, trail: [] };
  return { ...s, rocks: [...s.rocks, rock], throwsRemaining: s.throwsRemaining - 1, throwsMade: s.throwsMade + 1, power: 0, nextId: s.nextId + 1 };
}

/** Arcade ends when the rocks are used up and the last one has landed; practice never ends by itself. */
export const isGameOver = (s: GameState) => (s.throwsRemaining <= 0 || s.timeLeft <= 0) && !s.rocks.some(r => r.active);
export const isLevelComplete = (s: GameState) => s.targetsHit >= s.level * HITS_PER_LEVEL;

const SUBSTEP = 1 / 120;
const outOfBounds = (r: Rock) => r.x < FIELD.left - 100 || r.x > FIELD.right + 100 || r.y < FIELD.top - 100 || r.y > FIELD.bottom + 100;

/** Advance the game by `dt` seconds. `now` = wall-clock ms (for the targets' timers). */
export function step(prev: GameState, dtRaw: number, now: number, rng: Rng): StepResult {
  if (prev.paused) return { state: prev, hits: [], levelUp: null };
  const dt = clamp(dtRaw, 0, 0.1);
  let s: GameState = { ...prev, clock: prev.clock + dt };
  const hits: HitEvent[] = [];
  const n = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / n;

  let rocks = s.rocks.map(r => ({ ...r }));
  let targets = s.targets.map(t => ({ ...t }));
  let { score, targetsHit, combo, longestCombo, bullseyes, farHit, timeLeft, lastHitAt } = s;
  const trial = s.mode === 'TIMETRIAL';
  if (trial) timeLeft = Math.max(0, timeLeft - dt);

  for (let i = 0; i < n; i++) {
    for (const r of rocks) {
      if (!r.active) continue;
      r.x += r.vx * h; r.y += r.vy * h + 0.5 * GRAVITY * h * h; r.vy += GRAVITY * h;
      if (outOfBounds(r)) { r.active = false; continue; }
      for (const t of targets) {
        if (t.hit || !rockHitsTarget(r, t)) continue;
        const offset = closestApproach(r, t);
        const dist = Math.hypot(t.x - THROWER.x, t.y - THROWER.y);
        const bullseye = offset / (t.size / 2) < BULLSEYE_AT;
        combo += 1; longestCombo = Math.max(longestCombo, combo); targetsHit += 1; r.hits += 1;
        const gap = s.clock - lastHitAt;
        const points = totalScore(TARGET_POINTS[t.kind], [distanceBonus(dist), accuracyBonus(offset, t.size / 2), comboBonus(combo), ...(trial ? [speedBonus(gap)] : [])]);
        if (trial) { timeLeft = Math.min(TRIAL_MAX_SECONDS, timeLeft + TRIAL_HIT_SECONDS); lastHitAt = s.clock; }
        score += points; t.hit = true;
        if (bullseye) bullseyes += 1;
        if (dist >= FAR_HIT_DISTANCE) farHit = true;
        hits.push({ x: t.x, y: t.y, points, bullseye, combo, kind: t.kind });
      }
    }
  }

  // trails (once per frame), and rocks that ended without touching anything break the combo
  let levelMisses = s.levelMisses;
  for (const r of rocks) {
    if (r.active) r.trail = [{ x: r.x, y: r.y }, ...r.trail].slice(0, 10);
    else if (r.hits === 0) { combo = 0; levelMisses += 1; if (trial) timeLeft = Math.max(0, timeLeft - TRIAL_MISS_SECONDS); }
  }
  rocks = rocks.filter(r => r.active);

  targets = targets.map(t => moveTarget(t, dt, now, rng));
  // a target that was hit is replaced so there are always ACTIVE_TARGETS in play
  targets = targets.filter(t => !t.hit);
  let nextId = s.nextId;
  while (targets.length < ACTIVE_TARGETS) targets.push(createTarget(nextId++, randomKind(rng), s.level, now, rng));

  s = { ...s, rocks, targets, score, targetsHit, combo, longestCombo, bullseyes, farHit, levelMisses, nextId, timeLeft, lastHitAt };

  let levelUp: number | null = null;
  if (isLevelComplete(s) && !isGameOver(s)) {
    const seconds = s.clock - s.levelStart;
    levelUp = s.level + 1;
    s = {
      ...s, level: levelUp, throwsRemaining: s.mode === 'ARCADE' ? THROWS_PER_LEVEL : Infinity, rocks: [], combo: 0,
      fastLevel: s.fastLevel || seconds < FAST_LEVEL_SECONDS, perfectLevel: s.perfectLevel || s.levelMisses === 0,
      levelStart: s.clock, levelMisses: 0,
    };
  }
  return { state: s, hits, levelUp };
}

export interface RockResult { score: number; level: number; targetsHit: number; throws: number; longestCombo: number; bullseyes: number; fastLevel: boolean; perfectLevel: boolean; farHit: boolean; mode: GameMode }
export const summarize = (s: GameState): RockResult => ({
  score: s.score, level: s.level, targetsHit: s.targetsHit, throws: s.throwsMade, longestCombo: s.longestCombo, bullseyes: s.bullseyes,
  fastLevel: s.fastLevel, perfectLevel: s.perfectLevel, farHit: s.farHit, mode: s.mode,
});

// ---- saved progress --------------------------------------------------------------------------------------------

export interface RockStats {
  gamesPlayed: number; totalScore: number; highScore: number; bestLevel: number; totalTargetsHit: number; totalThrows: number;
  longestCombo: number; bullseyes: number; fastLevel: boolean; perfectLevel: boolean; farHit: boolean; lastPlayedAt: number;
}
export interface RockSession { id: string; mode: GameMode; score: number; level: number; targetsHit: number; throws: number; at: number }
export interface RockSave { stats: RockStats; sessions: RockSession[] }
export const SESSIONS_KEPT = 50;

export const emptyRockStats = (): RockStats => ({
  gamesPlayed: 0, totalScore: 0, highScore: 0, bestLevel: 0, totalTargetsHit: 0, totalThrows: 0, longestCombo: 0, bullseyes: 0,
  fastLevel: false, perfectLevel: false, farHit: false, lastPlayedAt: 0,
});
export const emptyRockSave = (): RockSave => ({ stats: emptyRockStats(), sessions: [] });

/** Fold a finished game into the saved stats and leaderboard (best scores first, ties by the newer game). */
export function recordGame(save: RockSave, r: RockResult, id: string, at: number): RockSave {
  const st = save.stats;
  const stats: RockStats = {
    gamesPlayed: st.gamesPlayed + 1, totalScore: st.totalScore + r.score, highScore: Math.max(st.highScore, r.score),
    bestLevel: Math.max(st.bestLevel, r.level), totalTargetsHit: st.totalTargetsHit + r.targetsHit, totalThrows: st.totalThrows + r.throws,
    longestCombo: Math.max(st.longestCombo, r.longestCombo), bullseyes: st.bullseyes + r.bullseyes,
    fastLevel: st.fastLevel || r.fastLevel, perfectLevel: st.perfectLevel || r.perfectLevel, farHit: st.farHit || r.farHit, lastPlayedAt: at,
  };
  const session: RockSession = { id, mode: r.mode, score: r.score, level: r.level, targetsHit: r.targetsHit, throws: r.throws, at };
  const sessions = [session, ...save.sessions].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, SESSIONS_KEPT);
  return { stats, sessions };
}

/** Make a loaded save safe to use: wrong types fall back to empty values. */
export function sanitizeRockSave(raw: unknown): RockSave {
  const d = emptyRockSave();
  if (typeof raw !== 'object' || raw === null) return d;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const st = (typeof o.stats === 'object' && o.stats !== null ? o.stats : {}) as Record<string, unknown>;
  const stats: RockStats = {
    gamesPlayed: num(st.gamesPlayed), totalScore: num(st.totalScore), highScore: num(st.highScore), bestLevel: num(st.bestLevel),
    totalTargetsHit: num(st.totalTargetsHit), totalThrows: num(st.totalThrows), longestCombo: num(st.longestCombo), bullseyes: num(st.bullseyes),
    fastLevel: st.fastLevel === true, perfectLevel: st.perfectLevel === true, farHit: st.farHit === true, lastPlayedAt: num(st.lastPlayedAt),
  };
  const sessions = (Array.isArray(o.sessions) ? o.sessions : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && typeof (x as any).id === 'string')
    .map(x => ({ id: String(x.id), mode: (x.mode === 'PRACTICE' || x.mode === 'TIMETRIAL' ? x.mode : 'ARCADE') as GameMode, score: num(x.score), level: Math.max(1, num(x.level)), targetsHit: num(x.targetsHit), throws: num(x.throws), at: num(x.at) }))
    .slice(0, SESSIONS_KEPT);
  return { stats, sessions };
}
