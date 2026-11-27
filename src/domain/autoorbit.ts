/**
 * Auto orbit: the stability assist flies the two-burn ascent of `orbit.test.ts` by itself.
 *  climb   the rocket burns and the nose follows a gravity-turn program (steep low down, flatter as it rises) until the apoapsis reaches AUTO.APO
 *          and the plane is above AUTO.CUT_H, out of the thick air (cut sooner and drag eats the apoapsis);
 *  coast   engine off, nose on the flight path, up to the top of the arc;
 *  insert  at the top the rocket burns level and prograde until the periapsis clears the air (a margin over ORBIT.TOP);
 *  done    in orbit: engine off, nose on the path (prograde);
 *  fail    the fuel ran out first, or the coast fell back into the air: the assist stops burning and holds prograde.
 * Pure: `stepAuto` turns the glider's state into controls for `stepGlider`.
 */
import type { Glider } from './glider';
import { ORBIT } from './orbit';

export type AutoPhase = 'climb' | 'coast' | 'insert' | 'done' | 'fail';
export interface AutoOrbit { phase: AutoPhase }
export const newAuto = (): AutoOrbit => ({ phase: 'climb' });
/** APO: the apoapsis the first burn climbs to (m above sea level); CUT_H: the lowest it may be cut off; MARGIN: how far over the air's top the periapsis is taken. */
export const AUTO = { APO: 45000, CUT_H: 15000, MARGIN: 2000 };

export interface AutoCtl { pitch: number; roll: number; yaw: number; rocket: boolean }
const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function stepAuto(a: AutoOrbit, g: Glider): AutoCtl {
  const h = g.z + (g.gnd ?? 0), roll = clamp(2.2 * wrapPi(0 - g.phi) - 0.25 * g.rollRate);
  if (a.phase !== 'fail' && a.phase !== 'done' && g.peri >= ORBIT.TOP + AUTO.MARGIN * ORBIT.S) a.phase = 'done';
  if (a.phase === 'climb') {
    if (g.fuel <= 0) a.phase = 'fail';
    else {
      const want = Math.max(0.5, 1.35 - (0.03 * h) / (1000 * ORBIT.S)), rocket = g.apo < AUTO.APO * ORBIT.S;   // (an escape path, apo = Infinity, is "high enough" too)
      if (h > AUTO.CUT_H * ORBIT.S && g.apo >= AUTO.APO * ORBIT.S) a.phase = 'coast';
      return { pitch: clamp(want - g.gamma), roll, yaw: 0, rocket };
    }
  }
  if (a.phase === 'coast') {
    if (h < (AUTO.CUT_H - 3000) * ORBIT.S && g.vz < 0) a.phase = 'fail';   // fell back into the air before the top
    else if (g.vz <= 3 && h > AUTO.CUT_H * ORBIT.S) a.phase = 'insert';
    else return { pitch: 0, roll, yaw: 0, rocket: false };
  }
  if (a.phase === 'insert') {
    if (g.fuel <= 0) a.phase = 'fail';
    else return { pitch: clamp(0 - g.gamma), roll, yaw: 0, rocket: true };
  }
  return { pitch: 0, roll, yaw: 0, rocket: false };
}
