/**
 * Stability assist (SAS), in the manner of Kerbal Space Program: the plane flies itself steady, and the stick only asks for a change.
 *  - off:   the stick is the elevator and aileron, as before;
 *  - level: the wings come back level and the climb angle holds wherever the stick was let go (altitude changes only when you ask);
 *  - hold:  the bank and the climb angle both hold wherever the stick was let go (a steady turn stays a steady turn);
 *  - acro:  for aerobatics, with the aerobatic wing: the stick turns the plane (roll right round, pull into a loop), and where it is let go the
 *           plane stops turning and holds that bank (upside down too) and that flight path, whatever the throttle does.
 *  - target: (dogfight) the plane turns and climbs or dives to point at the other plane, leading it, and holds the nose on it; the stick takes over
 *           while it is moved (letting go, the assist goes back to the target). With no target it holds like `hold`.
 *  - prograde / retro / entry (for the rocket stage, in air too thin to lift): the nose holds on the flight path (prograde), turns round to face against it
 *           (retro: a deorbit or braking burn) or turns broadside to it (entry: belly first, the way down that does not burn the paper). The wings stay level.
 *           The stick takes over while it is moved. In thick air they are the wing's own trim, so they do no harm on the way up or down.
 *  - auto:   the rocket flies itself to orbit (autoorbit.ts): the climb burn, the coast, the burn at the top; it picks the stick and the rocket.
 * Throttle no longer needs a pilot: more thrust bends the path up, and the assist pulls it back to the held climb angle.
 * Pure: `stepSas` turns the pilot's stick and the glider's state into the controls for `stepGlider`.
 */
import type { Glider } from './glider';
import { airDensity, thinness } from './orbit';
import { newAuto, stepAuto, type AutoOrbit } from './autoorbit';

export type SasMode = 'off' | 'level' | 'hold' | 'acro' | 'target' | 'prograde' | 'retro' | 'entry' | 'auto';
export const SAS_MODES: readonly SasMode[] = ['off', 'level', 'hold', 'acro', 'target', 'auto', 'prograde', 'retro', 'entry'];
export const ORBIT_SAS: readonly SasMode[] = ['off', 'prograde', 'retro', 'entry'];
export const isOrbitSas = (m: SasMode) => m === 'prograde' || m === 'retro' || m === 'entry';
/** The next mode round. `target` is skipped when there is nothing to target and `auto` when there is no rocket. In space (air too thin for the wing) the round is the orbit one: off, prograde, retro, entry. */
export const nextSasMode = (m: SasMode, hasTarget = false, space = false, hasRocket = false): SasMode => {
  if (space) { const i = ORBIT_SAS.indexOf(m); return i < 0 ? 'prograde' : ORBIT_SAS[(i + 1) % ORBIT_SAS.length]; }
  for (let k = 1; k <= SAS_MODES.length; k++) {
    const n = SAS_MODES[(SAS_MODES.indexOf(m) + k) % SAS_MODES.length];
    if (isOrbitSas(n) || (n === 'target' && !hasTarget) || (n === 'auto' && !hasRocket)) continue;
    return n;
  }
  return 'off';
};

export interface Sas { mode: SasMode; gammaT: number; phiT: number; i: number; lastGamma: number; engaged: boolean; vT: [number, number, number]; auto: AutoOrbit }   // vT: the flight path direction held (acro)
export const newSas = (mode: SasMode = 'off'): Sas => ({ mode, gammaT: 0, phiT: 0, i: 0, lastGamma: 0, engaged: false, vT: [1, 0, 0], auto: newAuto() });

export interface SasInput { pitch: number; roll: number; yaw: number }
export interface SasCtl { pitch: number; roll: number; yaw: number; aero?: boolean; rocket?: boolean }   // aero: the aerobatic wing is wanted (acro)

/** How fast the stick moves the targets (rad/s at full stick), and how far they may go. */
export const SAS_PITCH_RATE = 0.7, SAS_ROLL_RATE = 1.6, SAS_MAX_BANK = 1.2;
/** The climb angle that may be asked for: a glider cannot hold much of a climb without thrust, so the top is low; down it may dive steeply. */
export const SAS_MAX_CLIMB = 0.5, SAS_MAX_DIVE = 0.9;
/** Below this airspeed (m/s) the assist stops asking for more climb: the plane would stall. */
export const SAS_MIN_SPEED = 5.2;
const DEAD = 0.08;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const unit = (g: Glider): [number, number, number] => { const v = Math.hypot(g.vx, g.vy, g.vz) || 1; return [g.vx / v, g.vy / v, g.vz / v]; };
const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));

/** Take the plane's present climb angle and bank as the targets (on switching on, on the ground, after a pattern). */
export function captureSas(s: Sas, g: Glider) {
  s.gammaT = clamp(g.gamma, -SAS_MAX_DIVE, SAS_MAX_CLIMB); s.phiT = s.mode === 'level' ? 0 : clamp(g.phi, -SAS_MAX_BANK, SAS_MAX_BANK); s.i = 0; s.lastGamma = g.gamma; s.engaged = true;
  if (s.mode === 'acro') { s.phiT = g.phi; s.vT = unit(g); }
  s.auto = newAuto();
}

/** One frame. `thrust` 0..1 is passed so the assist can lean against it before the path has moved. */
export function stepSas(s: Sas, g: Glider, input: SasInput, dt: number, thrust = 0, target: Glider | null = null): SasCtl {
  if (!s.engaged) captureSas(s, g);
  if (isOrbitSas(s.mode)) return stepOrbit(s, g, input);
  if (s.mode === 'auto') { const c = stepAuto(s.auto, g); return { pitch: c.pitch, roll: c.roll, yaw: input.yaw, rocket: c.rocket }; }
  if (s.mode === 'target' && target && !target.landed) {
    if (Math.abs(input.pitch) > DEAD || Math.abs(input.roll) > DEAD) { s.lastGamma = g.gamma; return { pitch: input.pitch, roll: input.roll, yaw: input.yaw }; }   // the pilot takes the stick: the plane goes where it says, the target waits
    aimAt(s, g, target);
  } else if (s.mode === 'target') { if (target === null && Math.abs(input.pitch) > DEAD) s.gammaT = clamp(s.gammaT + input.pitch * SAS_PITCH_RATE * dt, -SAS_MAX_DIVE, SAS_MAX_CLIMB); }
  if (s.mode === 'acro') return stepAcro(s, g, input, dt, thrust);
  const gammaRate = dt > 0 ? (g.gamma - s.lastGamma) / dt : 0; s.lastGamma = g.gamma;
  // the stick moves the targets; letting go leaves them where they got to (hold: the bank where it is, level: wings level)
  if (Math.abs(input.pitch) > DEAD) s.gammaT = clamp(s.gammaT + input.pitch * SAS_PITCH_RATE * dt, -SAS_MAX_DIVE, SAS_MAX_CLIMB);
  if (g.airspeed < SAS_MIN_SPEED) s.gammaT = Math.min(s.gammaT, g.gamma);   // (too slow: the nose comes down to pick up speed rather than stalling)
  if (Math.abs(input.roll) > DEAD) s.phiT = clamp(s.phiT + input.roll * SAS_ROLL_RATE * dt, -SAS_MAX_BANK, SAS_MAX_BANK);
  else if (s.mode === 'level') s.phiT += (0 - s.phiT) * Math.min(1, dt * 2.5);
  // pitch: less pull the faster it goes (the wing lifts more), a bank needs more pull to keep the path level, then close the climb-angle error (with its rate and a slow integral for what thrust and drag leave)
  const err = s.gammaT - g.gamma;
  s.i = clamp(s.i + err * dt * 0.6, -0.35, 0.35);
  const bank = clamp(0.55 * (1 / Math.max(0.4, Math.cos(g.phi)) - 1), 0, 0.6);
  const pitch = clamp(-0.3 * (g.airspeed - 7) / 7 + 1.4 * err - 0.25 * gammaRate + s.i + bank - 0.12 * thrust, -1, 1);
  const roll = clamp(2.2 * (s.phiT - g.phi) - 0.25 * g.rollRate, -1, 1);
  // (in air too thin to lift the stick turns the whole nose, so the wing's pitch commands are faded out there: they would swing it through half a turn)
  return { pitch: pitch * (1 - thinness(airDensity(g.z + (g.gnd ?? 0)))), roll, yaw: input.yaw };
}

/** The orbit assists: where the nose points against the flight path, in the thin air where the stick turns the nose. prograde 0, retro full back (alpha = pi), entry half back (broadside). */
function stepOrbit(s: Sas, g: Glider, input: SasInput): SasCtl {
  const thin = thinness(airDensity(g.z + (g.gnd ?? 0))), want = s.mode === 'retro' ? 1 : s.mode === 'entry' ? 0.5 : 0;
  const pitch = Math.abs(input.pitch) > DEAD ? input.pitch : want * thin;
  const roll = Math.abs(input.roll) > DEAD ? input.roll : clamp(2.2 * wrapPi(0 - g.phi) - 0.25 * g.rollRate, -1, 1);
  return { pitch, roll, yaw: input.yaw };
}

/** Target mode: set the climb angle and bank that point the plane at the other one (a little ahead of it, as far as it will have flown by the time we are there). */
function aimAt(s: Sas, g: Glider, t: Glider) {
  const dx0 = t.x - g.x, dy0 = t.y - g.y, d0 = Math.hypot(dx0, dy0), lead = clamp(d0 / Math.max(4, g.airspeed), 0, 2);
  const dx = dx0 + t.vx * lead, dy = dy0 + t.vy * lead, dz = (t.z + (t.gnd ?? 0)) - (g.z + (g.gnd ?? 0)) + t.vz * lead, hd = Math.hypot(dx, dy);
  const err = wrapPi(Math.atan2(dy, dx) - g.psi);
  const maxBank = g.airspeed < SAS_MIN_SPEED * 1.4 ? 0.6 : 0.95;   // (a steep turn needs lift to spare: when slow, ease it)
  s.phiT = clamp(-err * 1.4, -maxBank, maxBank);
  const climbCap = clamp((g.airspeed - 6) * 0.25, -0.2, SAS_MAX_CLIMB);   // (energy first: a slow plane dives to pick up speed before it climbs after a target above it)
  s.gammaT = clamp(Math.atan2(dz, Math.max(hd, 1)), -SAS_MAX_DIVE, climbCap);
}

/** The acro assist: the stick is a turning command (as with no assist), and where it is let go the turning stops and the attitude is held. */
function stepAcro(s: Sas, g: Glider, input: SasInput, dt: number, thrust: number): SasCtl {
  const u = unit(g);
  let pitch: number, roll: number;
  if (Math.abs(input.pitch) > DEAD) { pitch = input.pitch; s.vT = u; s.i = 0; }                       // pulling or pushing: the path turns as the stick says
  else {
    if (g.airspeed < SAS_MIN_SPEED) s.vT = [s.vT[0], s.vT[1], Math.min(s.vT[2], u[2])];               // too slow: no more climb asked for
    const e = (s.vT[0] - u[0]) * g.top[0] + (s.vT[1] - u[1]) * g.top[1] + (s.vT[2] - u[2]) * g.top[2];   // how far the path is off, along the wing's own up (turns over with the plane)
    s.i = clamp(s.i + e * dt * 0.6, -0.35, 0.35);
    pitch = clamp(2 * e + 0.12 * g.top[2] + s.i - 0.12 * thrust, -0.7, 0.7);
  }
  if (Math.abs(input.roll) > DEAD) { roll = input.roll; s.phiT = g.phi; }                              // rolling: as fast as the stick says, round and round if it is held
  else roll = clamp(2.2 * wrapPi(s.phiT - g.phi) - 0.25 * g.rollRate, -1, 1);
  return { pitch, roll, yaw: input.yaw, aero: true };
}
