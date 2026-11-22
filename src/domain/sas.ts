/**
 * Stability assist (SAS), in the manner of Kerbal Space Program: the plane flies itself steady, and the stick only asks for a change.
 *  - off:   the stick is the elevator and aileron, as before;
 *  - level: the wings come back level and the climb angle holds wherever the stick was let go (altitude changes only when you ask);
 *  - hold:  the bank and the climb angle both hold wherever the stick was let go (a steady turn stays a steady turn);
 *  - acro:  for aerobatics, with the aerobatic wing: the stick turns the plane (roll right round, pull into a loop), and where it is let go the
 *           plane stops turning and holds that bank (upside down too) and that flight path, whatever the throttle does.
 * Throttle no longer needs a pilot: more thrust bends the path up, and the assist pulls it back to the held climb angle.
 * Pure: `stepSas` turns the pilot's stick and the glider's state into the controls for `stepGlider`.
 */
import type { Glider } from './glider';

export type SasMode = 'off' | 'level' | 'hold' | 'acro';
export const SAS_MODES: readonly SasMode[] = ['off', 'level', 'hold', 'acro'];
export const nextSasMode = (m: SasMode): SasMode => SAS_MODES[(SAS_MODES.indexOf(m) + 1) % SAS_MODES.length];

export interface Sas { mode: SasMode; gammaT: number; phiT: number; i: number; lastGamma: number; engaged: boolean; vT: [number, number, number] }   // vT: the flight path direction held (acro)
export const newSas = (mode: SasMode = 'off'): Sas => ({ mode, gammaT: 0, phiT: 0, i: 0, lastGamma: 0, engaged: false, vT: [1, 0, 0] });

export interface SasInput { pitch: number; roll: number; yaw: number }
export interface SasCtl { pitch: number; roll: number; yaw: number; aero?: boolean }   // aero: the aerobatic wing is wanted (acro)

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
}

/** One frame. `thrust` 0..1 is passed so the assist can lean against it before the path has moved. */
export function stepSas(s: Sas, g: Glider, input: SasInput, dt: number, thrust = 0): SasCtl {
  if (!s.engaged) captureSas(s, g);
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
  return { pitch, roll, yaw: input.yaw };
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
