/**
 * Dogfight tag: an AI paper plane that you chase, then flee from; when the chaser holds the other in its sights a shot opens.
 * Your shot is a little skill game (three sliders sweep through the middle at different paces and offsets: tap when they are
 * all in the middle), the AI's shot is a roll of the dice weighed by how well it is lined up. A hit swaps the roles. Time spent
 * fleeing pays much more than time spent chasing, and the match ends when someone's hit tally reaches HITS_TO_WIN.
 * Pure logic: the caller supplies the air (a GlideEnv for the AI) and feeds the events to the HUD.
 */
import { STALL_SPEED, TRIM_SPEED, newGlider, stepGlider, throwPlane, type GlideControls, type GlideEnv, type Glider } from './glider';
import { startManeuver, stepManeuver, DEFAULT_PATTERNS, type Maneuver } from './maneuver';

export const HITS_TO_WIN = 3;                 // the match ends when one side has this many hits
export const FLEE_PTS = 3, CHASE_PTS = 1, HIT_PTS = 60;   // points per second spent fleeing / chasing, and per hit scored
export const SHOT_RANGE = 28, SHOT_CONE = 30 * Math.PI / 180;   // m, rad: where the nose must be to lock on
export const CHASER_THRUST = 0.22;            // the AI chaser has a little engine (a fraction of the debug throttle) so it can catch a player who flies straight and has to be dodged
export const LOCK_TIME = 1, AI_LOCK_TIME = 1.4, SHOT_WINDOW = 3.5, SHOT_COOLDOWN = 3, SWAP_TIME = 2, GAP = 55;

export type Role = 'chase' | 'flee';
export type Who = 'you' | 'ai';
export type DogEvent = 'lock' | 'shotOpen' | 'incoming' | 'hit' | 'hurt' | 'miss' | 'dodged' | 'swap' | 'over';

export interface SliderSpec { axis: 'v' | 'h' | 'd'; period: number; centre: number }   // the slider is in the middle when t = centre (+ half periods)
export interface Shot { who: Who; t: number; dur: number; q: number; specs: SliderSpec[]; done: boolean }
export interface Dog {
  role: Role; ai: Glider; tally: { you: number; ai: number };
  score: number; tChase: number; tFlee: number;
  lock: number; cooldown: number; phase: 'play' | 'shot' | 'swap' | 'over'; swapT: number; winner: Who | null;
  shot: Shot | null; man: Maneuver | null; manCd: number; t: number; jinkPhase: number;
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const absZ = (g: Glider) => g.z + (g.gnd ?? 0);

// ---- aiming -----------------------------------------------------------------------------------------------------------------

/** How well `shooter` has `target` lined up: the range, the angle off the nose and a 0..1 quality (1 = point blank and dead ahead). */
export function aimOf(shooter: Glider, target: Glider) {
  const dx = target.x - shooter.x, dy = target.y - shooter.y, dz = absZ(target) - absZ(shooter), dist = Math.hypot(dx, dy, dz) || 1e-6;
  const cos = (dx * shooter.fwd[0] + dy * shooter.fwd[1] + dz * shooter.fwd[2]) / dist, angle = Math.acos(clamp(cos));
  const inCone = dist <= SHOT_RANGE && angle <= SHOT_CONE;
  const q = inCone ? clamp(0.5 * (1 - dist / SHOT_RANGE) + 0.5 * (1 - angle / SHOT_CONE)) : 0;
  return { dist, angle, inCone, q };
}

/** Where the other plane is as seen from your own: `theta` the angle off your nose (0 dead ahead, pi behind), `phi` which way round the nose it lies (0 off the right wing, pi/2 above, -pi/2 below), `dist` in metres. For the instrument. */
export function foeBearing(me: Glider, foe: Glider) {
  const dx = foe.x - me.x, dy = foe.y - me.y, dz = absZ(foe) - absZ(me), dist = Math.hypot(dx, dy, dz) || 1e-6;
  const f = (dx * me.fwd[0] + dy * me.fwd[1] + dz * me.fwd[2]) / dist, r = (dx * me.wx + dy * me.wy + dz * me.wz) / dist, u = (dx * me.top[0] + dy * me.top[1] + dz * me.top[2]) / dist;
  return { theta: Math.acos(clamp(f)), phi: Math.atan2(u, r), dist };
}

// ---- the skill shot -----------------------------------------------------------------------------------------------------------

/** The slider's place at time t, -1..1 (0 = the middle). */
export const sliderPos = (s: SliderSpec, t: number) => Math.sin((2 * Math.PI * (t - s.centre)) / s.period);
/** The widest a slider may be off the middle for the tap to count: wider when the shot is well lined up. */
export const shotTolerance = (q: number) => 0.3 + 0.25 * q;

/** Three sliders (up-down, left-right, diagonal) at different paces; they are all near the middle together only around one moment (a little different for each). */
export function makeShot(who: Who, q: number, rng: () => number): Shot {
  const slow = 1 + 0.4 * (1 - q), t0 = 1 + 1.4 * rng(), axes: SliderSpec['axis'][] = ['v', 'h', 'd'], pace = [2.0, 2.6, 3.2];
  const specs = axes.map((axis, i) => ({ axis, period: pace[i] * slow, centre: t0 + (rng() * 2 - 1) * 0.08 }));
  return { who, t: 0, dur: SHOT_WINDOW, q, specs, done: false };
}
/** Does a tap at time t hit? Every slider must be within the tolerance of the middle. */
export const tapHits = (shot: Shot, t: number) => shot.specs.every(s => Math.abs(sliderPos(s, t)) <= shotTolerance(shot.q));

// ---- the AI pilot -------------------------------------------------------------------------------------------------------------

/** Steer towards a heading with a banked turn and a gentle nose (pull more in the bank, hold the speed, follow a climb angle). */
export function steer(g: Glider, heading: number, climb: number, speedK = 0.3): GlideControls {
  const err = wrapPi(heading - g.psi), bank = clamp(-err * 1.4, -1.05, 1.05);
  let pitch = 0.12 + 0.55 * (1 / Math.max(0.3, Math.cos(g.phi)) - 1) + speedK * (g.airspeed - TRIM_SPEED) / TRIM_SPEED + 3 * (climb - g.gamma);
  if (g.airspeed < STALL_SPEED * 1.3) pitch = Math.min(pitch, -0.25);
  return { pitch: clamp(pitch, -0.8, 0.9), roll: clamp((bank - g.phi) * 2.2), yaw: 0 };
}

/** The AI's controls for this frame (`d.role` is YOUR role). When it chases: lead the target. When it flees: turn away with jinks, keep a healthy height, and when locked on, loop or roll out of it. */
export function aiControls(d: Dog, player: Glider, dt: number, rng: () => number): GlideControls & { aero?: boolean } {
  const ai = d.ai;
  if (d.man) { const c = stepManeuver(d.man, ai, dt); if (c) return c; d.man = null; d.manCd = 4 + 3 * rng(); }
  if (d.manCd > 0) d.manCd -= dt;
  const dx = player.x - ai.x, dy = player.y - ai.y, dist = Math.hypot(dx, dy);
  const lowest = ai.z < 22;                                        // never fly into the ground
  if (d.role === 'chase') {                                        // you chase, so the AI is the runner
    if (d.lock > 0.3 && d.manCd <= 0 && ai.z > 70 && rng() < dt * 1.2) {   // locked on from behind: try a loop, a split S or an Immelman
      const pats = [DEFAULT_PATTERNS[1], DEFAULT_PATTERNS[4], DEFAULT_PATTERNS[5]].filter(Boolean);
      d.man = startManeuver(pats[Math.floor(rng() * pats.length)], ai);
    }
    d.jinkPhase += dt;
    const away = Math.atan2(-dy, -dx) + 0.8 * Math.sin(d.jinkPhase * 0.9) * (dist < 70 ? 1 : 0.3);
    const climb = lowest ? 0.25 : ai.z < 45 ? 0.1 : ai.z > 130 ? -0.15 : -0.02;
    return { ...steer(ai, away, climb), aero: false };
  }
  // you flee, so the AI is the chaser: aim where the player will be, and match the height
  const lead = clamp(dist / Math.max(4, ai.airspeed), 0, 2.5);
  const pv = Math.hypot(player.vx, player.vy) || 1;
  const back = dist < 18 ? 12 : 0;                                  // (close in: aim behind the target, not at it, or it overshoots and circles at point-blank range)
  const px = player.x + player.vx * lead - (player.vx / pv) * back, py = player.y + player.vy * lead - (player.vy / pv) * back;
  const dh = Math.atan2(py - ai.y, px - ai.x), dz = absZ(player) - absZ(ai);
  const climb = lowest ? 0.25 : clamp(dz / (dist + 12) - (dist > 30 ? 0.08 : 0), -0.8, 0.8);   // (far behind: a little dive for speed)
  return { ...steer(ai, dh, climb, 0), thrust: dist > 20 ? CHASER_THRUST : 0.05, aero: false };
}

// ---- the match ----------------------------------------------------------------------------------------------------------------

/** Put the AI `GAP` m ahead of the player (you chase) or behind (you flee), same height, same way, same speed. */
export function placeAi(d: Dog, player: Glider) {
  const sign = d.role === 'chase' ? 1 : -1, h = player.psi, v = Math.max(TRIM_SPEED, player.airspeed);
  throwPlane(d.ai, player.x + Math.cos(h) * GAP * sign, player.y + Math.sin(h) * GAP * sign, h, Math.max(30, player.z), v, 0);
  d.ai.wet = 0; d.man = null; d.manCd = 3; d.lock = 0; d.cooldown = 0; d.shot = null;
}

export function startDogfight(player: Glider, role: Role = 'chase'): Dog {
  const d: Dog = { role, ai: newGlider(0, 0, 0, 50), tally: { you: 0, ai: 0 }, score: 0, tChase: 0, tFlee: 0, lock: 0, cooldown: 0, phase: 'play', swapT: 0, winner: null, shot: null, man: null, manCd: 3, t: 0, jinkPhase: 0 };
  placeAi(d, player);
  return d;
}

/** Someone scored: the tally goes up, the match may end, otherwise the roles swap and the planes are set a gap apart again. */
function score(d: Dog, who: Who, player: Glider, ev: DogEvent[]) {
  d.tally[who]++; if (who === 'you') d.score += HIT_PTS;
  ev.push(who === 'you' ? 'hit' : 'hurt');
  d.shot = null; d.lock = 0;
  if (d.tally[who] >= HITS_TO_WIN) { d.phase = 'over'; d.winner = who; ev.push('over'); return; }
  d.role = d.role === 'chase' ? 'flee' : 'chase'; d.phase = 'swap'; d.swapT = SWAP_TIME; placeAi(d, player); ev.push('swap');
}

/** The player's tap on the shot minigame. Returns true when it counted (a shot was open). */
export function tapShot(d: Dog, player: Glider): DogEvent[] {
  const ev: DogEvent[] = [], s = d.shot;
  if (d.phase !== 'shot' || !s || s.who !== 'you' || s.done) return ev;
  s.done = true;
  if (tapHits(s, s.t)) score(d, 'you', player, ev); else { d.phase = 'play'; d.cooldown = SHOT_COOLDOWN; d.shot = null; d.lock = 0; ev.push('miss'); }
  return ev;
}

/** Advance the match by dt: the AI flies, the score ticks, locks build up and shots open and resolve. Returns what happened. */
export function stepDog(d: Dog, player: Glider, env: GlideEnv, dt: number, rng: () => number = Math.random): DogEvent[] {
  const ev: DogEvent[] = [];
  if (d.phase === 'over') return ev;
  d.t += dt;
  if (d.ai.landed) placeAi(d, player);                              // (it came down: set it flying again)
  const c = aiControls(d, player, dt, rng);
  stepGlider(d.ai, c, env, dt);
  if (d.phase === 'swap') { d.swapT -= dt; if (d.swapT <= 0) d.phase = 'play'; return ev; }
  if (d.role === 'flee') { d.tFlee += dt; d.score += FLEE_PTS * dt; } else { d.tChase += dt; d.score += CHASE_PTS * dt; }
  if (d.cooldown > 0) d.cooldown = Math.max(0, d.cooldown - dt);
  const shooter = d.role === 'chase' ? player : d.ai, target = d.role === 'chase' ? d.ai : player, a = aimOf(shooter, target);
  if (d.phase === 'shot' && d.shot) {
    const s = d.shot; s.t += dt;
    if (s.who === 'you') { if (s.t >= s.dur && !s.done) { d.phase = 'play'; d.cooldown = SHOT_COOLDOWN; d.shot = null; d.lock = 0; ev.push('miss'); } }
    else if (s.t >= 0.9) {                                          // the AI fires: you can still break out of its sights while it takes aim
      const still = aimOf(d.ai, player), p = 0.3 + 0.55 * still.q;
      if (!still.inCone) { d.phase = 'play'; d.cooldown = SHOT_COOLDOWN; d.shot = null; d.lock = 0; ev.push('dodged'); }
      else if (rng() < p) score(d, 'ai', player, ev); else { d.phase = 'play'; d.cooldown = SHOT_COOLDOWN; d.shot = null; d.lock = 0; ev.push('miss'); }
    }
    return ev;
  }
  if (d.cooldown > 0) { d.lock = 0; return ev; }
  if (a.inCone) {
    const before = d.lock; d.lock += dt;
    if (before === 0) ev.push('lock');
    const need = d.role === 'chase' ? LOCK_TIME : AI_LOCK_TIME;
    if (d.lock >= need) { d.phase = 'shot'; d.shot = makeShot(d.role === 'chase' ? 'you' : 'ai', a.q, rng); ev.push(d.role === 'chase' ? 'shotOpen' : 'incoming'); }
  } else d.lock = Math.max(0, d.lock - dt * 2);
  return ev;
}

/** The player came down in the middle of the match: it is over, the AI takes it. */
export function endDogfight(d: Dog, winner: Who = 'ai') { d.phase = 'over'; d.winner = winner; d.shot = null; }
