/**
 * Manoeuvre tricks, read from the glider's motion: a full roll, a loop, an Immelman (half loop up, then roll upright) and a split S
 * (inverted, half loop down). Each is paid once when it is completed.
 */
import type { Glider } from './glider';

export type TrickName = 'roll' | 'loop' | 'immelman' | 'splitS' | 'slalom' | 'stallHang' | 'thermal' | 'turn90' | 'uTurn';
export const TRICK_POINTS: Record<TrickName, number> = { roll: 60, loop: 100, immelman: 200, splitS: 200, slalom: 30, stallHang: 120, thermal: 150, turn90: 15, uTurn: 40 };
export const THERMAL_CLIMB = 50;          // m climbed inside one thermal
export const STALL_HANG_TIME = 2;         // s held past the stall, then recovered
export const SLALOM_WINDOW = 5;           // s between two trees for the run to go on

/** A tree the plane might be flying past (tile centre in tiles, and how tall it is in metres). */
export interface TreeRef { key: number; x: number; y: number; top: number }
/** What the world says about this frame: where the plane is and heads (tiles, unit heading), the vertical air, and the trees about. */
export interface TrickCtx { px: number; py: number; hx: number; hy: number; lift: number; trees: TreeRef[] }

/** The combo: tricks in quick succession count up, and each is worth more. */
export interface Combo { n: number; t: number }
export const COMBO_WINDOW = 6;            // s to land the next trick
export const newCombo = (): Combo => ({ n: 0, t: 0 });
export const comboMult = (c: Combo) => Math.min(4, 1 + 0.5 * c.n);
/** Count a finished trick: returns its points with the multiplier it earned, and bumps the combo. */
export function comboAward(c: Combo, pts: number): { pts: number; mult: number } { const mult = comboMult(c); c.n++; c.t = COMBO_WINDOW; return { pts: Math.round(pts * mult), mult }; }
/** Time passes; `alive` (a trick is going on, like skimming the ground) holds the combo open. */
export function comboStep(c: Combo, dt: number, alive = false) { if (alive) c.t = Math.max(c.t, 1.5); else c.t = Math.max(0, c.t - dt); if (c.t <= 0) c.n = 0; }

export interface TrickState { rollCum: number; rollIdle: number; prevPhi: number; prevPsi: number; loopOn: boolean; loopCum: number; loopIdle: number; loopRef: number; loopPrev: number; loopInv: boolean; loopHalf: boolean; immT: number; immRoll: number; invAge: number;
  stallT: number; thermalOn: boolean; thermalZ0: number; thermalOut: number; thermalDone: boolean; clock: number; slSide: number; slT: number; slKey: number; turnCum: number; turnIdle: number }
export const newTrickState = (): TrickState => ({ rollCum: 0, rollIdle: 0, prevPhi: 0, prevPsi: 0, loopOn: false, loopCum: 0, loopIdle: 0, loopRef: 0, loopPrev: 0, loopInv: false, loopHalf: false, immT: 0, immRoll: 0, invAge: 99, stallT: 0, thermalOn: false, thermalZ0: 0, thermalOut: 0, thermalDone: false, clock: 0, slSide: 0, slT: -99, slKey: -1, turnCum: 0, turnIdle: 0 });
export function resetTricks(t: TrickState, g?: Glider) { Object.assign(t, newTrickState()); if (g) { t.prevPhi = g.phi; t.prevPsi = g.psi; } }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Call once per frame while flying; returns the tricks completed in this frame. */
export function stepTricks(t: TrickState, g: Glider, dt: number, ctx?: TrickCtx): TrickName[] {
  const done: TrickName[] = [];
  if (g.landed || !(dt > 0)) { resetTricks(t, g); return done; }
  const dpsi = wrap(g.psi - t.prevPsi);
  const dphi = g.rollRate * dt; t.prevPhi = g.phi; t.prevPsi = g.psi;             // the roll about the flight path itself (the bank read-out turns over at the top of a loop: that is not a roll)
  // a deliberate turn, rolled out of: about a quarter turn (90) or half a turn (U-turn); a long circle pays neither, so circling is not a way to farm points
  if (Math.abs(dpsi) / dt > 0.2) { if (t.turnCum !== 0 && Math.sign(dpsi) !== Math.sign(t.turnCum) && Math.abs(t.turnCum) < 0.4) t.turnCum = 0; t.turnCum += dpsi; t.turnIdle = 0; }
  else if (t.turnCum !== 0 && (t.turnIdle += dt) > 0.5) { const deg = Math.abs(t.turnCum) * 180 / Math.PI; if (deg >= 70 && deg <= 115 && g.z > 3) done.push('turn90'); else if (deg >= 150 && deg <= 205 && g.z > 3) done.push('uTurn'); t.turnCum = 0; }
  if (Math.abs(dphi) / dt > 1) { t.rollCum += dphi; t.rollIdle = 0; if (Math.abs(t.rollCum) >= Math.PI * 1.9) { done.push('roll'); t.rollCum = 0; } }
  else if ((t.rollIdle += dt) > 0.8) t.rollCum = 0;
  t.invAge = Math.abs(g.phi) > 2.2 ? 0 : t.invAge + dt;                              // how long since it was last upside down
  const hs = g.vx * Math.cos(t.loopRef) + g.vy * Math.sin(t.loopRef), ang = Math.atan2(g.vz, hs), dA = wrap(ang - t.loopPrev); t.loopPrev = ang;
  if (!t.loopOn) {
    t.loopRef = Math.atan2(g.vy, g.vx); t.loopPrev = Math.atan2(g.vz, Math.hypot(g.vx, g.vy));
    if (Math.abs(dA) / dt > 0.6 && Math.abs(dA) < 1) { t.loopOn = true; t.loopCum = dA; t.loopIdle = 0; t.loopInv = Math.abs(g.phi) > 2; t.loopHalf = false; }
  } else {
    if (Math.abs(dA) / dt > 0.4) { t.loopCum += dA; t.loopIdle = 0; } else if ((t.loopIdle += dt) > 1) { t.loopOn = false; t.loopCum = 0; }
    const inv = Math.abs(g.phi) > 2;
    if (t.loopOn && !t.loopHalf && Math.abs(t.loopCum) >= Math.PI * 0.9) {
      t.loopHalf = true;
      if (t.loopCum < 0 && t.invAge < 2.5 && !inv) done.push('splitS');                // inverted, pulled through the bottom
      else if (t.loopCum > 0 && !t.loopInv && (inv || t.invAge < 0.8)) t.immT = 4, t.immRoll = 0;   // over the top, upside down (or already rolling out of it): roll out for the Immelman
    }
    if (t.loopOn && Math.abs(t.loopCum) >= Math.PI * 1.9) { t.immT = 0; done.push('loop'); t.loopOn = false; t.loopCum = 0; }
  }
  if (t.immT > 0) t.immRoll += Math.abs(g.rollRate) * dt;
  if (t.loopOn && Math.abs(t.loopCum) > Math.PI * 1.4 && t.immRoll < 1.5) t.immT = 0;   // still looping: this is a full loop, not an Immelman (unless it really rolled out: the path keeps curving down meanwhile)
  if (ctx) {
    t.clock += dt;
    // stall hang: held past the stall angle for a while and flown out of it (not into the ground)
    if (g.stalled && g.z > 6) t.stallT += dt; else { if (t.stallT >= STALL_HANG_TIME && !g.stalled) done.push('stallHang'); t.stallT = 0; }
    // thermal rider: a climb of 50 m or more without leaving one patch of rising air for long
    if (ctx.lift > 0.8) { if (!t.thermalOn) { t.thermalOn = true; t.thermalZ0 = g.z; t.thermalDone = false; } t.thermalOut = 0; if (!t.thermalDone && g.z - t.thermalZ0 >= THERMAL_CLIMB) { t.thermalDone = true; done.push('thermal'); } }
    else if (t.thermalOn && (t.thermalOut += dt) > 2) t.thermalOn = false;
    // tree slalom: abeam of a tree, close, low enough, and on the other side from the last one
    if (g.z < 8) for (const tr of ctx.trees) {
      const dx = tr.x - ctx.px, dy = tr.y - ctx.py, fwd = dx * ctx.hx + dy * ctx.hy, lat = -dx * ctx.hy + dy * ctx.hx;
      if (tr.key === t.slKey || Math.abs(fwd) > 0.5 || Math.abs(lat) < 0.45 || Math.abs(lat) > 2.4 || g.z > tr.top + 2) continue;
      const side = lat > 0 ? 1 : -1;
      if (t.slSide !== 0 && t.clock - t.slT < SLALOM_WINDOW && side !== t.slSide) done.push('slalom');
      t.slSide = side; t.slT = t.clock; t.slKey = tr.key;
    }
  }
  if (t.immT > 0) { t.immT -= dt; if (Math.abs(g.phi) < 0.6) { done.push('immelman'); t.immT = 0; t.loopOn = false; t.loopCum = 0; } }
  return done;
}
