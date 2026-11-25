/**
 * The sky ladder: fly through any hoop and a chain of rungs (bigger, golden-blue hoops) starts in front of the plane. Each rung hangs higher than the last, along the
 * gravity turn the auto orbit flies (steep low down, flatter as it rises), and each one flown through fills the rocket stage with a little more fuel, so a
 * pilot who holds R and flies the rungs ends up with the delta-v of an orbit. A rung is placed from the plane's own state when it is made (ahead along its course,
 * about AHEAD seconds of flight away; on a round planet the ground track of a plane at height is shorter than its path: `trackK`), so the ladder is always within reach, and a rung that is flown past is simply made again ahead.
 * Pure: `stepLadder` takes the glider after a step and says whether a rung was flown through or missed. Positions are in tiles (y south, like the hoops), heights in tiles above the ground.
 */
import { type Hoop, passedHoop } from './hoops';
import { ORBIT, gravityAt, trackK } from './orbit';

export const SKY = {
  AHEAD: 5,        // s of flight to the next rung
  MIN: 70, MAX: 4500,   // m: how far ahead it may hang
  STEP: 0.4,       // rad: how much steeper than the plane's own climb the next rung may be (it curves upward, not a wall)
  REACH: 0.45,     // the next rung is never higher than this share of the height the plane could still coast up to (its speed plus all its fuel): a rung is a climb it can fly
  FLOOR: 0.4,      // rad: the flattest a rung is while the program still wants a climb (a plane that has lost its climb is not set a level ladder)
  R0: 9, RK: 0.03, // the rung's radius (tiles): this much, plus this much of its distance (a rung far ahead is hard to hit)
  FUEL: 1.8,       // s of rocket burn each rung gives (about 70 m/s): the climb is a rung at a time, and a pilot who coasts too long runs dry
  GATE_PAD: 1000,  // m: a rung made above the air's top by this much is the orbit gate
};
/** The seconds of burn one rung gives. */
export const rungFuel = () => SKY.FUEL;
/** The climb angle (rad) the ladder wants at a height above sea level: a gravity turn (the auto orbit's, a little quicker), level by 28 km. */
export const climbProgram = (hAbs: number) => Math.max(0, 1.35 - (0.048 * hAbs) / 1000);

export interface Rung extends Hoop { n: number; gate?: boolean }   // gate: the last rung, above the air: through it the plane is set on a circular orbit
export interface Ladder { on: boolean; n: number; rung: Rung | null }
export const newLadder = (): Ladder => ({ on: false, n: 0, rung: null });
/** Begin a ladder (a hoop has just been flown): the first rung's fuel is in the tank at once, the rung itself is made on the next step. */
export function startLadder(L: Ladder, g: { fuel: number }) { L.on = true; L.n = 0; L.rung = null; g.fuel += rungFuel(); }
/** The part of a glider the ladder reads (x east, y north, z metres above the ground under it, gnd the ground's height above the sea). */
export interface LadderGlider { x: number; y: number; z: number; gnd?: number; vx: number; vy: number; vz: number; psi: number; gamma: number; fuel: number; landed: boolean; orbited: boolean }

/** The rung that follows rung n - 1, made from the plane's state. */
export function nextRung(n: number, g: LadderGlider): Rung {
  const vh = Math.hypot(g.vx, g.vy), ux = vh > 3 ? g.vx / vh : Math.cos(g.psi), uy = vh > 3 ? g.vy / vh : Math.sin(g.psi);   // (glider axes)
  const dx = ux, dy = -uy;                                                                                                     // (the map's: y south)
  const speed = Math.hypot(vh, g.vz), ds = Math.max(SKY.MIN, Math.min(SKY.MAX, speed * SKY.AHEAD)), prog = climbProgram(g.z + (g.gnd ?? 0));
  const hAbs = g.z + (g.gnd ?? 0), tk = trackK(hAbs), vTop = speed + ORBIT.THRUST * g.fuel, rise = (SKY.REACH * vTop * vTop) / (2 * gravityAt(hAbs));   // (the height its speed and fuel could carry it to: a rung is never set beyond a share of it)
  if (hAbs >= ORBIT.TOP + SKY.GATE_PAD) {   // above the air: the gate, straight ahead on the plane's own path (never down), at whatever height it has by then
    const eg = Math.max(0, Math.min(1.2, g.gamma));
    return { key: `sky${n}`, n, gate: true, x: g.x + dx * ds * Math.cos(eg) * tk, y: -g.y + dy * ds * Math.cos(eg) * tk, h: (g.z + ds * Math.sin(eg)) * 0.18, angle: Math.atan2(dy, dx), r: SKY.R0 + SKY.RK * ds * tk };
  }
  // the climb of the next rung: the program's, a little above the plane's own, and within reach; with the tank empty the plane cannot turn upward, so the rung is on the path it is flying
  const e = g.fuel > 0 ? Math.max(0, Math.min(Math.min(prog, Math.max(SKY.FLOOR, g.gamma + SKY.STEP)), Math.asin(Math.min(1, rise / ds)))) : Math.max(-0.3, Math.min(prog, g.gamma));
  return { key: `sky${n}`, n, x: g.x + dx * ds * Math.cos(e) * tk, y: -g.y + dy * ds * Math.cos(e) * tk, h: (g.z + ds * Math.sin(e)) * 0.18, angle: Math.atan2(dy, dx), r: SKY.R0 + SKY.RK * ds * tk };
}

export type LadderEvent = 'spawn' | 'pass' | 'gate' | 'miss' | 'end' | null;
/**
 * One frame after the plane has moved from `prev` (map x, y; h in tiles above the ground) to where it is now. Starts the first rung, and tells if the rung was flown through
 * (the next is made at once; the gate ends the ladder, and the caller sets the plane on its orbit), or flown past (made again ahead), or if the ladder is over (landed, or the orbit is reached).
 */
export function stepLadder(L: Ladder, g: LadderGlider, prev: { x: number; y: number; h: number } | null): LadderEvent {
  if (!L.on) return null;
  if (g.landed || g.orbited) { L.on = false; L.rung = null; return 'end'; }
  if (!L.rung) { L.rung = nextRung(L.n + 1, g); return 'spawn'; }
  const rg = L.rung, hl = g.z * 0.18;
  if (prev && passedHoop(rg, prev.x, prev.y, prev.h, g.x, -g.y, hl)) { L.n++; if (rg.gate) { L.on = false; L.rung = null; return 'gate'; } g.fuel += rungFuel(); L.rung = nextRung(L.n + 1, g); return 'pass'; }   // (each rung flown fills the tank a little more, before the next is made: it is set within what that fuel can reach)
  if ((g.x - rg.x) * Math.cos(rg.angle) + (-g.y - rg.y) * Math.sin(rg.angle) > 0) { L.rung = nextRung(L.n + 1, g); return 'miss'; }   // (past its disc without going through)
  return null;
}
