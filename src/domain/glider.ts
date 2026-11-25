/**
 * Bóbr world map, part 6: a paper plane that really glides.
 *
 * A point mass flown through moving air. Lift, drag and gravity act on the velocity *relative to the air*, and the integration is
 * done in the ground frame, so everything a pilot knows falls out by itself:
 *  - the plane trades height for speed and back (zoom climb, dive), and settles at a best-glide speed with a hands-off stick;
 *  - a bank tilts the lift, which turns the plane (and costs height if you do not pull a little);
 *  - pull too far and it stalls: lift collapses, the nose falls, the speed builds again;
 *  - rising air carries the plane up. Slowing down in lift (a gentle pull) cuts the sink and tightens the turn, which is what makes
 *    a climb in a small thermal work; the energy the plane takes from the air is lift x vertical air speed.
 * Units: 1 tile = 1 m, seconds, m/s; x east, y NORTH (the world map flips y), z up.
 */
import { hash01 } from './worldgen';
import { wrapCell } from './globe';
import { sunElevation } from './sky';
import { ORBIT, airDensity, gravityAt, thinness, heatRate, orbitElements, clearsAir, trackK } from './orbit';

export const G = 9.81;
export const ALT_MAX = 120;                 // the altitude of layer 1 (the top of the picture)
export const THROW_ALT = 40;                // the throw from a 40 m ledge (Space once landed, or the Throw button)
/** Space in the air: a kick of thrust along the nose and of lift, fading over BOOST_TIME, then a pause before the next one. */
export const BOOST_TIME = 1.3, BOOST_COOLDOWN = 4;
export const START_BOOSTS = 1;               // boosts in hand at the start of a run (and after a crash)
const BOOST_THRUST = 20, BOOST_LIFT = 14;   // m/s^2 at the start of a boost: about +5 m/s of speed and 13 m of height gained (more makes it loop backwards)
const K = 0.57;                             // air density x wing area / (2 x mass), per metre
const CL_A = 2.4;                           // lift slope per radian
export const ALPHA_STALL = 0.27;                  // 15.5 degrees
const ALPHA_TRIM = 0.146;                   // hands-off angle of attack: about best glide
const CD0 = 0.03, CD_K = 0.25;
export const GROUND_EFFECT_H = 4;           // m above the ground within which the ground cushions the wing
export const THRUST_MAX = 12;               // m/s^2 at full debug throttle
const MAX_LIFT = 5 * G;                     // the paper tears before this; it only keeps zoom climbs sane
/** A soaked plane weighs this much more (x 1.6): it flies faster, sinks faster, stalls sooner and rolls lazily. */
export const WET_MASS = 0.6;
export const WET_DRY_AIR = 45, WET_DRY_GROUND = 120, WET_DRY_HEAT = 7;   // seconds to dry out flying at best glide / lying on the ground; warm air dries it up to 1 + 7 times as fast
/** The plane came down in the water. */
export const soakPlane = (g: Glider) => { g.wet = 1; };
export const TRIM_SPEED = Math.sqrt(G / (K * CL_A * ALPHA_TRIM));   // ~7 m/s
export const STALL_SPEED = Math.sqrt(G / (K * CL_A * ALPHA_STALL));  // ~5 m/s at 1 g

export interface Glider {
  x: number; y: number; z: number;          // position, y north; z is the height above the ground under it
  gnd?: number;                             // the ground's height under it at the last step (hills; see GlideEnv.ground)
  vx: number; vy: number; vz: number;       // ground velocity
  alpha: number;                            // angle of attack, rad
  phi: number;                              // bank, rad, right wing down positive (read-out: worked out from `nx, ny, nz`; use setBank to change it)
  wx: number; wy: number; wz: number;       // the right wing: a unit vector along the wing, out to the right. This (with the velocity) IS the attitude: it has no
                                            // "straight up" where it breaks down, so loops and rolls need no special cases. psi, phi, gamma and pitch are read from it.
  nx: number; ny: number; nz: number;       // the way the wing lifts (read-out): square to the wing and to the flight path through the air
  fwd: [number, number, number];            // the nose, unit (x east, y north, z up)
  top: [number, number, number];            // the plane's own up (out of its back), unit
  rollRate: number;                         // rad/s about the flight path, right positive
  course: number;                           // rad: the way a camera behind the plane should look. It follows the heading in ordinary flight but holds through loops and rolls
  courseSwing: number;                      // -1 / 0 / 1: which way round the course is turning while it is more than 150 degrees off (so it never dithers)
  invT: number;                             // seconds flown level and upside down (after a while the course follows anyway)
  elev: number; ail: number; rud: number;   // smoothed control surfaces, -1..1 (elev + = pull up, ail + = roll right, rud + = yaw right)
  psi: number;                              // heading, rad, 0 east, pi/2 north (the way it flies through the air; over the top of a loop it turns round by pi, and the bank with it)
  gamma: number;                            // climb angle of the flight path through the air
  airspeed: number;
  load: number;                             // g
  stalled: boolean;
  landed: boolean;
  t: number;
  // instruments
  pitch: number;                            // nose attitude, rad
  turnRate: number;                         // rad/s, left positive (maths angle)
  vsi: number;                              // ground vertical speed, m/s
  energyRate: number;                       // total-energy climb rate, m/s: what the plane gains from the air, stick movements removed
  airLift: number;                          // vertical air speed at the plane, m/s
  boost: number;                            // seconds of boost left
  boostCd: number;                          // seconds until the next boost is allowed
  boostEase: number;                        // seconds the wing keeps easing off after a boost
  impact: { sink: number; speed: number; bank: number } | null;   // how it touched down (sink m/s, ground speed m/s, bank rad), null while flying
  dragK: number;                            // 1 = plain paper; below 1 = a slicker plane (the shop's paper tiers)
  wet: number;                              // 0 dry .. 1 soaked (it came down in the water): wet paper is heavy. It dries in the air, faster in warm air, and slowly on the ground
  boostCharges: number;                     // boosts in hand: one at the start, one more for every hoop flown, one spent per boost
  // the rocket stage and the orbit (see orbit.ts)
  fuel: number;                             // seconds of rocket burn left (filled by the shop's rocket tier at each launch)
  rocketOn: boolean;                        // the rocket burned during the last step
  fair: number;                             // 1 while the stage burns (the paper rides in its nose cone, which cuts drag and heat), easing back to 0 over ORBIT.FAIR_OFF seconds after burnout
  heat: number;                             // 0..1: how hot the paper is from fast flight in thick air; at 1 it burns
  heatK: number;                            // 1 = bare paper; below 1 = a heat shield
  apo: number; peri: number;                // the orbit it is on now (heights above sea level, m; apo is Infinity on an escape path)
  orbitT: number;                           // seconds the periapsis has been clear of the air
  orbited: boolean;                         // this flight has reached orbit
}
export interface GlideControls { pitch: number; roll: number; yaw: number; freeStall?: boolean; aero?: boolean; thrust?: number; rocket?: boolean }   // freeStall: the elevator reaches past the stall angle and nothing eases the nose back, so a hard pull really stalls; -1..1; pitch + = pull up, roll + = right, yaw + = right
export interface GlideEnv { windX: number; windY: number; ground?: (x: number, y: number) => number;   /* the ground's height under (x, y), in the plane's metres (hills): `z` stays the height above it, so the ground rising under the plane is a climb in the ground, not in the air */  air: (x: number, y: number, t: number) => number; turb?: (x: number, y: number, t: number) => number; heat?: (x: number, y: number, t: number) => number }   // heat: 0..1, how warm and drying the air is here (a thermal, a fire, a wind tunnel)   // turb: 0..1, how rough the air is here (rain): the plane is jolted about its roll and pitch

export function newGlider(x = 0, y = 0, heading = Math.PI / 2, z = THROW_ALT): Glider {
  const g: Glider = {
    x, y, z, vx: 0, vy: 0, vz: 0, alpha: ALPHA_TRIM, phi: 0, wx: Math.sin(heading), wy: -Math.cos(heading), wz: 0, nx: 0, ny: 0, nz: 1, fwd: [1, 0, 0], top: [0, 0, 1], rollRate: 0, course: heading, courseSwing: 0, invT: 0, elev: 0, ail: 0, rud: 0, psi: heading, gamma: 0, airspeed: TRIM_SPEED, load: 1, stalled: false, landed: false, t: 0,
    pitch: 0, turnRate: 0, vsi: 0, energyRate: 0, airLift: 0, boost: 0, boostCd: 0, boostEase: 0, boostCharges: START_BOOSTS, impact: null, dragK: 1, wet: 0,
    fuel: 0, rocketOn: false, fair: 0, heat: 0, heatK: 1, apo: 0, peri: 0, orbitT: 0, orbited: false,
  };
  throwPlane(g, x, y, heading, z);
  return g;
}

/** Wings level on a path that points along `heading` and climbs by `up`: the lift vector, nose and camera course to match. */
function setAttitude(g: Glider, heading: number, up: number) {
  const ch = Math.cos(heading), sh = Math.sin(heading), cu = Math.cos(up), su = Math.sin(up), ca = Math.cos(g.alpha), sa = Math.sin(g.alpha);
  g.nx = -su * ch; g.ny = -su * sh; g.nz = cu; g.wx = sh; g.wy = -ch; g.wz = 0;
  g.fwd = [ch * cu * ca + g.nx * sa, sh * cu * ca + g.ny * sa, su * ca + g.nz * sa];
  g.top = [g.nx * ca - ch * cu * sa, g.ny * ca - sh * cu * sa, g.nz * ca - su * sa];
  g.course = heading; g.courseSwing = 0; g.invT = 0; g.rollRate = 0;
}

/** Bank the plane to `phi` (right wing down positive) about the way it is moving now (still air). */
export function setBank(g: Glider, phi: number) {
  const v = Math.hypot(g.vx, g.vy, g.vz) || 1, ex = g.vx / v, ey = g.vy / v, ez = g.vz / v, hz = Math.hypot(ex, ey);
  const c = hz > 1e-3 ? ex / hz : Math.cos(g.psi), s = hz > 1e-3 ? ey / hz : Math.sin(g.psi), cph = Math.cos(phi), sph = Math.sin(phi);
  g.nx = -ez * c * cph + s * sph; g.ny = -ez * s * cph - c * sph; g.nz = hz * cph; g.phi = phi;
  g.wx = s * cph + ez * c * sph; g.wy = -c * cph + ez * s * sph; g.wz = -hz * sph;
}

/** A hand launch: level wings, a little nose up, a bit faster than best glide. */
export function throwPlane(g: Glider, x: number, y: number, heading: number, z = THROW_ALT, speed?: number, climb = 0.12) {
  const v = speed ?? (TRIM_SPEED * 1.2) / (1 + 0.3 * g.wet), up = climb;   // (a wet plane leaves the hand slower)
  g.x = x; g.y = y; g.z = z; g.psi = heading; g.phi = 0; g.alpha = ALPHA_TRIM; g.elev = g.ail = g.rud = 0;
  g.vx = Math.cos(heading) * v * Math.cos(up); g.vy = Math.sin(heading) * v * Math.cos(up); g.vz = v * Math.sin(up);
  g.gamma = up; g.airspeed = v; g.landed = false; g.impact = null; g.stalled = false; g.load = 1; g.vsi = g.vz; g.energyRate = 0; g.airLift = 0; g.pitch = up + ALPHA_TRIM; g.boost = 0; g.boostCd = 0; g.boostEase = 0; resetOrbit(g);
  setAttitude(g, heading, up);
}

/** A new flight: cool paper, no orbit yet (the rocket's fuel is the shop's: see `refuel`). */
function resetOrbit(g: Glider) { g.heat = 0; g.rocketOn = false; g.fair = 0; g.orbitT = 0; g.orbited = false; g.apo = g.peri = 0; }
/** Fill the rocket stage for a flight (seconds of burn, from the rocket tier). */
export const refuel = (g: Glider, seconds: number) => { g.fuel = Math.max(0, seconds); };

/** Space in the air: kick the plane along (thrust and lift for a moment). False when it is landed, out of boosts or still pausing from the last one. */
export function boostPlane(g: Glider): boolean {
  if (g.landed || g.boostCd > 0 || g.boostCharges < 1) return false;
  g.boostCharges--; g.boost = BOOST_TIME; g.boostCd = BOOST_COOLDOWN; g.boostEase = BOOST_TIME + 1.2;
  return true;
}

/** The ground launch: the plane is held just above the ground (1 m) while the player aims, then let go with a speed and a climb that grow with the hold (power 0..1).
 *  It shoots up, arcs over and settles into a steady glide by itself: the wing is eased to carry 1 g for a few seconds (as after a boost), so the speed turns into height without looping. */
export const GROUND_ALT = 1, LAUNCH_EASE = 4;
/** The paper plane's hitbox. The model is drawn this many view tiles per metre of height, and a tilted wing tip or nose dips up to HULL_DIP tiles below its centre (the view lifts the plane by that much, so keep the two together). */
export const VIEW_TILES_PER_M = 0.18, HULL_DIP = 1.2;
/** How far (m) the lowest point of the plane hangs below its centre at this bank and pitch: it touches down when the centre is this high, not at 0. */
/** How big the plane is drawn against the default (1 = 2.4 tiles); the hull dip shrinks with it, so a small plane touches down closer to the ground. */
export const hull = { k: 1 };
export const hullDipM = (phi: number, pitch: number) => hull.k * Math.min(HULL_DIP, Math.abs(Math.sin(phi)) + Math.abs(Math.sin(pitch))) / VIEW_TILES_PER_M;
export function launchPlane(g: Glider, x: number, y: number, heading: number, power: number, z0 = GROUND_ALT) {
  const p = Math.max(0, Math.min(1, power)), v = (TRIM_SPEED * (2 + 3.4 * p)) / (1 + 0.3 * g.wet), up = 0.45 + 0.3 * p;
  g.x = x; g.y = y; g.z = z0; g.psi = heading; g.phi = 0; g.alpha = ALPHA_TRIM; g.elev = g.ail = g.rud = 0;
  g.vx = Math.cos(heading) * v * Math.cos(up); g.vy = Math.sin(heading) * v * Math.cos(up); g.vz = v * Math.sin(up);
  g.gamma = up; g.airspeed = v; g.landed = false; g.impact = null; g.stalled = false; g.load = 1; g.vsi = g.vz; g.energyRate = 0; g.airLift = 0; g.pitch = up + ALPHA_TRIM; g.boost = 0; g.boostCd = 0; g.boostEase = LAUNCH_EASE; resetOrbit(g);
  setAttitude(g, heading, up);
}

/** Flying through a hoop: a kick of ground speed along the way the plane is moving (the heading when it is nearly still). Returns the speed added, m/s. */
export const HOOP_SPEED = 4, HOOP_EASE = 3;
export function hoopBoost(g: Glider, add = HOOP_SPEED): number {
  if (g.landed) return 0;
  const h = Math.hypot(g.vx, g.vy), ux = h > 0.5 ? g.vx / h : Math.cos(g.psi), uy = h > 0.5 ? g.vy / h : Math.sin(g.psi);
  g.vx += ux * add; g.vy += uy * add; g.boostCharges++;   // and one more boost in hand
  g.boostEase = Math.max(g.boostEase, HOOP_EASE);   // the wing eases off to carry 1 g while the extra speed lasts, or the plane balloons up and then stalls into a dive
  return add;
}

function liftCoeff(a: number): number {
  const m = Math.abs(a), s = Math.sign(a);
  if (m <= ALPHA_STALL) return CL_A * a;
  return s * Math.max(0.4, CL_A * ALPHA_STALL - (m - ALPHA_STALL) * 3);
}
const approach = (v: number, target: number, rate: number, dt: number) => (target > v ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt));

/** 0..1: how much the ground cushions the wing at height z (smooth bump, 0 above GROUND_EFFECT_H). */
export function groundEffect(z: number): number { const ge = Math.max(0, 1 - Math.max(0, z - GROUND_ALT) / GROUND_EFFECT_H); return ge * ge * (3 - 2 * ge); }

const SUBSTEP = 1 / 90;
/** Advance by dt seconds (split into small steps, so a slow frame cannot break the flight). */
export function stepGlider(g: Glider, ctl: GlideControls, env: GlideEnv, dt: number) {
  let left = dt;
  while (left > 1e-6) { const h = Math.min(SUBSTEP, left); left -= h; step(g, ctl, env, h); }
}

/**
 * Where the plane comes down if the controls are let go now: a copy of it is flown on, in steps of `dt`, until it touches the ground (or
 * `blocked` says it has hit something, a tree) or `maxT` seconds are up. Returns where it ended, how long that took and what stopped it
 * ('ground', 'blocked', or 'time' when it is still flying at the end). The real plane is untouched.
 */
export type LandingProjection = { x: number; y: number; t: number; end: 'ground' | 'blocked' | 'time'; impact: { sink: number; speed: number; bank: number } | null };
export function projectLanding(g: Glider, ctl: GlideControls, env: GlideEnv, opt: { maxT?: number; dt?: number; blocked?: (x: number, y: number, z: number) => boolean } = {}): LandingProjection {
  const it = projectLandingSteps(g, ctl, env, opt);
  let r = it.next(); while (!r.done) r = it.next();
  return r.value;
}
/** `projectLanding` a step of `dt` at a time (a generator): the game runs it a millisecond or two a frame, since the whole flight is thousands of the physics' small steps. The copy is taken at the start. */
export function* projectLandingSteps(g: Glider, ctl: GlideControls, env: GlideEnv, opt: { maxT?: number; dt?: number; blocked?: (x: number, y: number, z: number) => boolean } = {}): Generator<void, LandingProjection, void> {
  const c = structuredClone(g), dt = opt.dt ?? 0.2, maxT = opt.maxT ?? 60;
  c.impact = null;
  let t = 0;
  while (t < maxT) {
    stepGlider(c, ctl, env, dt); t += dt;
    if (c.landed) return { x: c.x, y: c.y, t, end: 'ground', impact: c.impact };
    if (opt.blocked && opt.blocked(c.x, c.y, c.z)) return { x: c.x, y: c.y, t, end: 'blocked', impact: null };
    yield;
  }
  return { x: c.x, y: c.y, t, end: 'time', impact: null };
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sstep = (x: number, a: number, b: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const COURSE_MAX_RATE = 5;           // rad/s: the fastest a camera's course swings round (a hard turn is about 4)

/**
 * The attitude is the air-relative velocity (where the plane goes) and the wing axis w (a unit vector out along the right wing). The
 * lift acts square to both. The wing axis is the axis the plane pitches about, so bending the path up or down (a pull, a loop) leaves
 * it alone; the ailerons turn it about the nose, the rudder about the lift, and whatever bends the path sideways (banked lift, gravity)
 * carries it round with the path. Nothing here divides by the cosine of the climb angle, so straight up, straight down and upside down
 * are places like any other. A change of wind does not turn the wing axis: it leaves the plane slipping, and the fin's side force then
 * drags the path round to the nose, so the wind pushes the plane along instead of turning it.
 */
function step(g: Glider, ctl: GlideControls, env: GlideEnv, dt: number) {
  g.t += dt;
  if (g.boostCd > 0) g.boostCd = Math.max(0, g.boostCd - dt);
  if (g.boostEase > 0) g.boostEase = Math.max(0, g.boostEase - dt);
  if (g.landed) { if (env.ground) g.gnd = env.ground(g.x, g.y); g.vx = g.vy = g.vz = 0; g.vsi = g.energyRate = 0; g.turnRate = 0; g.rollRate = 0; g.phi *= 0.9; g.wet = Math.max(0, g.wet - dt / WET_DRY_GROUND); g.rocketOn = false; g.heat = Math.max(0, g.heat - ORBIT.HEAT_COOL * dt); g.course = g.psi; g.courseSwing = 0; g.invT = 0; return; }
  // controls move towards the keys, and spring back when they are let go
  g.elev = approach(g.elev, ctl.pitch, ctl.pitch === 0 ? 5 : 4, dt);
  g.ail = approach(g.ail, ctl.roll, ctl.roll === 0 ? 5 : 5, dt);
  g.rud = approach(g.rud, ctl.yaw, ctl.yaw === 0 ? 5 : 4, dt);

  // the air thins with height above sea level (orbit.ts): the thermals, the ridge lift and the wind fade with it (full strength up to 1000 m)
  const hAbs = g.z + (g.gnd ?? 0), dens = airDensity(hAbs), thin = thinness(dens), wX = env.windX * dens, wY = env.windY * dens;
  const w = env.air(g.x, g.y, g.t) * dens;
  const rx = g.vx - wX, ry = g.vy - wY, rz = g.vz - w;
  const V = Math.max(0.8, Math.hypot(rx, ry, rz));
  const cp0 = Math.cos(g.psi), sp0 = Math.sin(g.psi);
  // wet paper: heavier (the air's forces move it less), drying as it flies, and faster in warm air
  const Kw = K * dens / (1 + WET_MASS * g.wet);
  if (g.wet > 0) g.wet = Math.max(0, g.wet - (dt / WET_DRY_AIR) * (0.5 + 0.5 * Math.min(2, V / TRIM_SPEED)) * (1 + WET_DRY_HEAT * (env.heat ? Math.max(0, Math.min(1, env.heat(g.x, g.y, g.t))) : 0)));
  // a change in the rising air (the edge of a thermal, a gust) pitches the plane to meet it, wings as they were: it does not leave it slipping
  { const dW = w - g.airLift, s0 = Math.hypot(rx, ry, rz + dW); if (dW !== 0 && s0 > 0.5) carry(g, rx / s0, ry / s0, (rz + dW) / s0, 0, 0, -dW / s0); }
  const F = bodyFrame(g, rx, ry, rz);
  const { ex, ey, ez, bx, by, bz, cg, hx, hy } = F;
  g.gamma = Math.asin(Math.max(-1, Math.min(1, ez)));
  g.airspeed = V;
  const sinBeta = ex * g.wx + ey * g.wy + ez * g.wz;                  // sideslip: the air comes from beside the nose

  // angle of attack follows the elevator (the short-period motion of a stable plane is far quicker than anything the player does)
  g.stalled = g.alpha > ALPHA_STALL && thin < 0.5;           // (no stall in air too thin to lift)
  const tb = env.turb ? env.turb(g.x, g.y, g.t) : 0;                  // rough air: quick, uneven jolts
  const free = !!ctl.freeStall, aero = !!ctl.aero;   // aero: loops, inverted flight and rolls past the vertical are allowed
  // (aerobatics: upside down the hands-off wing lifts the other way, so a roll does not end in a dive; a pull on the stick keeps the plain trim, so loops and the split S pull as before.
  //  "Upside down" is how far the lift vector points at the ground, which fades through nothing on the way up a loop instead of snapping over)
  const trimA = aero ? ALPHA_TRIM * (() => { const c = Math.max(-1, Math.min(1, g.nz * 3)), f = Math.max(0, Math.min(1, g.elev / 0.3)); return c + (1 - c) * f; })() : ALPHA_TRIM;
  // aerobatics: a push really lifts the other way (about half of what a pull gives), so the plane can bunt and fly an outside loop
  let aCmd = trimA + g.elev * (g.elev > 0 ? (free ? 0.3 : 0.15) : aero ? 0.28 : 0.15);
  // aerobatics: at speed the stick stops just short of the stall, so a held pull flies a clean loop; as the speed runs out it can still be pulled into one
  if (aero && !free) { const cap = ALPHA_STALL - 0.012; aCmd = Math.max(-cap, Math.min(cap + (1 - sstep(V, 6, 8)) * 0.2, aCmd)); }
  aCmd += tb * 0.07 * Math.sin(g.t * 11.3 + 2);
  // after a kick the wing eases off to carry 1 g (pulling back cannot add to it, pushing still can), so the extra speed does not pull it into a loop
  if (!free && (g.boost > 0 || g.boostEase > 0)) aCmd = Math.min(aCmd, Math.max(0.03, G / (Kw * V * V * CL_A)) + Math.min(0, g.elev) * 0.15);
  // and never up (or down) the wall: past about 55 degrees the nose is eased back, so a fast pull or push cannot send the plane over the top and backwards
  // (aerobatics: only a hands-off, upright plane is eased back from the vertical, so it does not loop itself when fast; the stick fades the easing out)
  const lim = free ? 0 : aero ? (g.nz >= 0 ? Math.max(0, 1 - Math.abs(g.elev) * 2) : 0) : 1;
  if (lim > 0) {
    if (g.gamma > 0.95) aCmd += lim * (Math.min(aCmd, ALPHA_TRIM - (g.gamma - 0.95) * 1.5) - aCmd);
    else if (g.gamma < -0.95) aCmd += lim * (Math.max(aCmd, ALPHA_TRIM + (-0.95 - g.gamma) * 1.5) - aCmd);   // (and the same on the way down: no bunt through the vertical)
  }
  // in thin air the wing does nothing and the stick turns the whole nose (a gimbal): full back is a retrograde burn, hands off holds the path (prograde)
  // (and a burning stage steers its thrust in the thick air too, over a smaller range: its fairing keeps the wing out of it)
  { const wgt = Math.max(thin, g.fair), span = Math.PI * (thin + (1 - thin) * 0.3); if (wgt > 0) aCmd += wgt * (Math.max(-span, Math.min(span, g.elev * span)) - aCmd); }
  if (g.stalled) aCmd -= (g.alpha - ALPHA_STALL) * 1.6;            // the nose falls through
  g.alpha += (aCmd - g.alpha) * (1 - Math.exp(-dt / (0.28 + 0.5 * thin)));
  const cl = liftCoeff(g.alpha);
  const over = Math.max(0, Math.abs(g.alpha) - ALPHA_STALL);
  // ground effect: close to the ground the wing sheds less induced drag and gains a little lift, fading out by GROUND_EFFECT_H (a smooth bump)
  const ge2 = groundEffect(g.z);
  const burning = !!ctl.rocket && g.fuel > 0, sail = !!ctl.rocket && g.fuel <= 0 && dens < ORBIT.SAIL_RHO; g.rocketOn = burning || sail;
  g.fair = burning ? 1 : (V < ORBIT.CONE_DROP_V || dens < ORBIT.CONE_DROP_RHO) ? Math.max(0, g.fair - dt / ORBIT.FAIR_OFF) : g.fair; const fairK = 1 - g.fair * (1 - ORBIT.FAIRING);   // (the stage's fairing: the plane is tucked in the nose cone while it burns, and the cone stays on while the plane is fast in thick air, then falls away slowly)
  const cd = (CD0 + CD_K * (1 - 0.55 * ge2) * cl * cl + 2.2 * over * over + 1.2 * sinBeta * sinBeta) * g.dragK * fairK;
  const q = Kw * V * V;
  const lift = Math.max(-MAX_LIFT, Math.min(MAX_LIFT, q * cl * (1 + 0.12 * ge2))), drag = q * cd;

  // lift acts along n (square to the path and the wing); the fin's side force pushes the path back in line with the nose (it weathervanes)
  const side = -0.9 * q * sinBeta;
  // aerobatics: a roll on its own does not carry the plane round the corner (the level, sideways part of the lift is mostly cancelled); pulling brings the turn back.
  // (There is no "sideways" straight up or down, so the cut fades out there)
  const kt = aero ? 0.2 * (1 - Math.min(1, Math.abs(g.ail))) + 0.8 * Math.min(1, Math.abs(g.elev) * 2) : 1;   // (and none of it while the stick is rolling the plane: a held roll stays on its line)
  const lat = g.nx * hx + g.ny * hy, cut = (1 - kt) * sstep(cg, 0.1, 0.4) * lat;
  // (the debug throttle pushes along the nose; the boost along the heading and up, strongest at the start, and it eases the stall)
  let tx = 0, ty = 0, tz = 0;
  if (ctl.thrust) { const a = ctl.thrust * THRUST_MAX, ca = Math.cos(g.alpha), sa = Math.sin(g.alpha); tx += (bx * ca + g.nx * sa) * a; ty += (by * ca + g.ny * sa) * a; tz += (bz * ca + g.nz * sa) * a; }
  if (burning) { g.fuel = Math.max(0, g.fuel - dt); const ca = Math.cos(g.alpha), sa = Math.sin(g.alpha); tx += (bx * ca + g.nx * sa) * ORBIT.THRUST; ty += (by * ca + g.ny * sa) * ORBIT.THRUST; tz += (bz * ca + g.nz * sa) * ORBIT.THRUST; }
  if (sail) { const ca = Math.cos(g.alpha), sa = Math.sin(g.alpha); tx += (bx * ca + g.nx * sa) * ORBIT.SAIL; ty += (by * ca + g.ny * sa) * ORBIT.SAIL; tz += (bz * ca + g.nz * sa) * ORBIT.SAIL; }
  if (g.boost > 0) {
    const k = g.boost / BOOST_TIME; g.boost = Math.max(0, g.boost - dt);
    tx += cp0 * BOOST_THRUST * k; ty += sp0 * BOOST_THRUST * k; tz += BOOST_LIFT * k;
    if (g.stalled) g.alpha -= (g.alpha - ALPHA_STALL) * Math.min(1, dt * 6);
  }
  // (a round planet: gravity weakens with height, the curve of the ground falls away under a fast plane (v^2 / r, up), and the horizontal speed shrinks as the plane climbs and grows as it falls)
  const rr = ORBIT.R + Math.max(0, hAbs), cor = -g.vz / rr, vh2 = g.vx * g.vx + g.vy * g.vy;
  const fx = (g.nx - cut * hx) * lift - (rx / V) * drag + tx + cor * g.vx, fy = (g.ny - cut * hy) * lift - (ry / V) * drag + ty + cor * g.vy, fz = g.nz * lift - (rz / V) * drag - gravityAt(hAbs) + vh2 / rr + tz - (hAbs > ORBIT.CEILING ? (hAbs - ORBIT.CEILING) * ORBIT.CEILING_K + g.vz * ORBIT.CEILING_DAMP : 0);
  const ax = fx + g.wx * side, ay = fy + g.wy * side, az = fz + g.wz * side;
  g.vx += ax * dt; g.vy += ay * dt; g.vz += az * dt;
  // the wing axis goes round with the path as far as lift, drag, gravity and thrust bend it (not the fin's push: that is the path catching up with the nose)
  carry(g, ex, ey, ez, fx * dt / V, fy * dt / V, fz * dt / V);
  { const tk = trackK(hAbs); g.x += g.vx * dt * tk; g.y += g.vy * dt * tk; g.z += g.vz * dt; }   // (a round planet: the ground track of a plane at height is shorter than its path, so an orbit comes round to where it began)
  if (env.ground) { const gr = env.ground(g.x, g.y); g.z -= gr - (g.gnd ?? gr); g.gnd = gr; }   // a hill rising under the plane takes its height away

  // roll: ailerons set a roll rate, the dihedral slowly levels the wings, right rudder rolls right, a stall drops a wing.
  // Carried round a climbing or sinking turn the wings would slowly change their bank against the horizon; a plane left alone holds it,
  // so that drift is taken out again (not near the vertical, where there is no horizon to hold a bank against)
  const phi0 = Math.atan2(lat, g.nx * F.ux + g.ny * F.uy + g.nz * F.uz);
  const M = bodyFrame(g, g.vx - wX, g.vy - wY, g.vz - w);
  const hold = -sstep(M.cg, 0.15, 0.5) * wrapPi(Math.atan2(g.nx * M.hx + g.ny * M.hy, g.nx * M.ux + g.ny * M.uy + g.nz * M.uz) - phi0);
  const phiNow = Math.atan2(g.nx * M.hx + g.ny * M.hy, g.nx * M.ux + g.ny * M.uy + g.nz * M.uz) + hold;
  let dPhi = g.ail * (aero ? 3 : 1.7) * (1 - 0.25 * g.wet) + g.rud * 0.45 - (aero ? 0.06 * Math.sin(2 * phiNow) * M.cg : phiNow * 0.12) + (g.stalled ? Math.sin(g.t * 9) * 0.7 : 0) + tb * 1.8 * (Math.sin(g.t * 9.1) + Math.sin(g.t * 13.7 + 1)) * 0.5;
  if (!aero) dPhi = (Math.max(-1.35, Math.min(1.35, phiNow + dPhi * dt)) - phiNow) / dt;      // (without aerobatics the bank stops at 77 degrees)
  // the wing tip goes down (away from the lift) with a roll to the right, and back (away from the nose) with right rudder
  { const a = hold + dPhi * dt, y = g.rud * 0.55 * dt; g.wx -= g.nx * a + M.bx * y; g.wy -= g.ny * a + M.by * y; g.wz -= g.nz * a + M.bz * y;
    const l = Math.hypot(g.wx, g.wy, g.wz) || 1; g.wx /= l; g.wy /= l; g.wz /= l; }
  g.rollRate = dPhi;

  // read-outs, from where the plane goes now: heading, bank, nose
  const R = bodyFrame(g, g.vx - wX, g.vy - wY, g.vz - w);
  if (R.cg > 0.02) { const d = wrapPi(Math.atan2(R.by, R.bx) - g.psi); if (Math.abs(d) < 2) g.turnRate = d / dt; g.psi += d; }   // (straight up or down there is no heading: it keeps the last one. Over the top it turns round at once: that is not a turn)
  g.phi = Math.atan2(g.nx * R.hx + g.ny * R.hy, g.nx * R.ux + g.ny * R.uy + g.nz * R.uz);
  { const ca = Math.cos(g.alpha), sa = Math.sin(g.alpha);
    g.fwd[0] = R.bx * ca + g.nx * sa; g.fwd[1] = R.by * ca + g.ny * sa; g.fwd[2] = R.bz * ca + g.nz * sa;
    g.top[0] = g.nx * ca - R.bx * sa; g.top[1] = g.ny * ca - R.by * sa; g.top[2] = g.nz * ca - R.bz * sa; }
  g.pitch = Math.asin(Math.max(-1, Math.min(1, g.fwd[2])));
  stepCourse(g, R.cg, dt);

  // instruments
  g.load += (lift / G - g.load) * Math.min(1, dt * 8);
  g.vsi += (g.vz - g.vsi) * Math.min(1, dt * 6);
  const energy = g.z + (g.gnd ?? 0) + (g.vx * g.vx + g.vy * g.vy + g.vz * g.vz) / (2 * G);
  g.energyRate = energyRateFilter(g, energy, dt);
  g.airLift = w;
  g.heat = Math.max(0, Math.min(1.5, g.heat + (heatRate(dens, V) * g.heatK * fairK - ORBIT.HEAT_COOL) * dt));
  { const el = orbitElements(g.z + (g.gnd ?? 0), Math.hypot(g.vx, g.vy), g.vz); g.apo = el.apo; g.peri = el.peri; g.orbitT = clearsAir(el) ? g.orbitT + dt : 0; if (g.orbitT >= ORBIT.HOLD) g.orbited = true; }
  if (g.z <= 0 || (g.vz <= 0 && g.z <= hullDipM(g.phi, g.pitch))) { g.impact = { sink: Math.max(0, -g.vz), speed: Math.hypot(g.vx, g.vy), bank: Math.abs(g.phi) }; g.z = 0; g.landed = true; g.vx = g.vy = g.vz = 0; }
}

/** The path's direction e has changed by d (as a fraction of the speed): turn the wing axis by the same turn (the least one that takes e to e + d). */
function carry(g: Glider, ex: number, ey: number, ez: number, dx: number, dy: number, dz: number) {
  const de = dx * ex + dy * ey + dz * ez; dx -= de * ex; dy -= de * ey; dz -= de * ez;
  const s = ex * g.wx + ey * g.wy + ez * g.wz, dw = dx * g.wx + dy * g.wy + dz * g.wz;
  g.wx += dx * s - ex * dw; g.wy += dy * s - ey * dw; g.wz += dz * s - ez * dw;
}

/**
 * The plane's frame for an air-relative velocity: e along the path, n the way the wing lifts (square to the path and the wing axis),
 * b the nose's line (square to n and the wing; it is e but for the sideslip), h level and to the right of b, u square to b and h ("up"
 * for level wings); cg is the cosine of b's climb angle. Straight up or down, "level right" is taken from the last heading.
 */
function bodyFrame(g: Glider, rx: number, ry: number, rz: number) {
  const sp = Math.hypot(rx, ry, rz), cp0 = Math.cos(g.psi), sp0 = Math.sin(g.psi);
  let ex = rx / (sp || 1), ey = ry / (sp || 1), ez = rz / (sp || 1);
  if (sp < 1e-3) { ex = g.ny * g.wz - g.nz * g.wy; ey = g.nz * g.wx - g.nx * g.wz; ez = g.nx * g.wy - g.ny * g.wx; }   // (not moving: along the nose)
  let nx = g.wy * ez - g.wz * ey, ny = g.wz * ex - g.wx * ez, nz = g.wx * ey - g.wy * ex;             // n = w x e
  const nl = Math.hypot(nx, ny, nz);
  if (nl > 0.05) { g.nx = nx / nl; g.ny = ny / nl; g.nz = nz / nl; }                                    // (flying straight along the wing: the lift keeps its last direction)
  nx = g.nx; ny = g.ny; nz = g.nz;
  const bx = ny * g.wz - nz * g.wy, by = nz * g.wx - nx * g.wz, bz = nx * g.wy - ny * g.wx, cg = Math.hypot(bx, by);   // b = n x w
  const ch = cg > 0.02 ? bx / cg : cp0, sh = cg > 0.02 ? by / cg : sp0;
  return { ex, ey, ez, bx, by, bz, cg, hx: sh, hy: -ch, ux: -bz * ch, uy: -bz * sh, uz: cg };
}

/**
 * The camera's course. It chases the heading, but only as far as the plane is flying level and the right way up: on the way up, over
 * the top and down the back of a loop (and through a roll) it stays put, so the world does not swing round twice a loop. Flown out
 * level the other way (an Immelman, a split S, or a second of level inverted flight) it comes round once, at a steady rate, one way.
 */
function stepCourse(g: Glider, cg: number, dt: number) {
  g.invT = g.nz < -0.1 && cg > 0.7 ? g.invT + dt : 0;
  const k = cg * cg * Math.max(sstep(g.nz, -0.15, 0), sstep(g.invT, 0.8, 1.6));
  let d = wrapPi(g.psi - g.course);
  if (Math.abs(d) > 2.6) { if (!g.courseSwing) g.courseSwing = d >= 0 ? 1 : -1; if (g.courseSwing > 0 && d < 0) d += 2 * Math.PI; else if (g.courseSwing < 0 && d > 0) d -= 2 * Math.PI; }
  else g.courseSwing = 0;
  const lim = COURSE_MAX_RATE * dt;
  g.course += Math.max(-lim, Math.min(lim, d * (1 - Math.exp(-20 * k * dt))));
}

const lastEnergy = new WeakMap<Glider, { e: number; rate: number }>();
function energyRateFilter(g: Glider, e: number, dt: number): number {
  const s = lastEnergy.get(g);
  if (!s) { lastEnergy.set(g, { e, rate: 0 }); return 0; }
  const inst = (e - s.e) / dt;
  s.e = e; s.rate += (inst - s.rate) * Math.min(1, dt * 1.5);
  return s.rate;
}

// ---- thermals -----------------------------------------------------------------------------------------------------------

/** A day lasts a minute here, so the sun only dims the thermals (40% at night .. 100% at noon) instead of switching them off. */
export const sunFactor = (hour: number) => Math.max(0.4, 0.7 + 0.3 * sunElevation(hour));
export const THERMAL_CELL = 60;               // one trigger point (at most) per 60 x 60 tiles
export interface ThermalEnv {
  seed: number;
  hour: number;
  warm: number;                               // 0.4..1.4: cold snaps weaken, heat waves strengthen
  heatAt: (x: number, y: number) => number;   // 0 (water, forest) .. 1 (bare sand), y south like the world
  /**
   * Optional: where a thermal's place, size and ground heat are kept once worked out (they change only with its cell's epoch, every minute or two). Every lookup of the rising air
   * reads nine cells and each cell's heat reads the ground six times, so without it the flight (and the landing prediction, ninety steps at a time) asks for the terrain hundreds of times a step.
   * The owner clears it when the ground changes.
   */
  memo?: Map<number, ThermalSite>;
}
/** A thermal's fixed part for one epoch of its cell (see `ThermalEnv.memo`). */
export interface ThermalSite { epoch: number; x: number; y: number; r: number; heat: number; wb: number }
export interface Thermal { x: number; y: number; r: number; w: number; heat: number; age: number }   // y south; w = peak updraft in m/s right now

/** The thermal rising from cell (i, j) at time t, or null while there is none. Anchored to the ground, born and fading with a 90..170 s life. */
export function thermalInCell(env: ThermalEnv, i: number, j: number, t: number): Thermal | null {
  const sun = sunFactor(env.hour);
  const s = env.seed & 0xffff;
  const wi = wrapCell(i, THERMAL_CELL), wj = wrapCell(j, THERMAL_CELL);   // (on a globe a cell is hashed by its place in the lap; where it stands is its unrolled cell's)
  const period = 90 + 80 * hash01(wi, wj, s, 1), phase = period * hash01(wi, wj, s, 2);
  const epoch = Math.floor((t + phase) / period), age = ((t + phase) % period) / period;
  const memo = env.memo, mk = memo ? (((i + 32768) * 65536 + (j + 32768)) * 4 + (epoch & 3)) : 0;   // (two slots a cell would do, epochs only move on; four leave room for a prediction running ahead of the flight)
  let site = memo?.get(mk);
  if (!site || site.epoch !== epoch) {
    if (hash01(wi, wj, s * 31 + epoch, 3) > 0.85) site = { epoch, x: 0, y: 0, r: 0, heat: 0, wb: 0 };   // (no thermal in this cell this time)
    else {
      const x = (i + 0.15 + 0.7 * hash01(wi, wj, s * 31 + epoch, 4)) * THERMAL_CELL, y = (j + 0.15 + 0.7 * hash01(wi, wj, s * 31 + epoch, 5)) * THERMAL_CELL;
      const r = 15 + 10 * hash01(wi, wj, s * 31 + epoch, 6);   // wide shafts: 15..25 tiles of core radius
      const heat = (env.heatAt(x, y) * 2 + env.heatAt(x + r, y) + env.heatAt(x - r, y) + env.heatAt(x, y + r) + env.heatAt(x, y - r)) / 6;
      site = { epoch, x, y, r, heat, wb: 6.0 + 6.8 * hash01(wi, wj, s * 31 + epoch, 7) };
    }
    if (memo) { if (memo.size > 4096) memo.clear(); memo.set(mk, site); }
  }
  if (site.wb === 0) return null;
  const life = Math.min(1, age / 0.2, (1 - age) / 0.2);
  const w = Math.min(14, site.wb * site.heat * sun * env.warm * Math.max(0, life));   // up to 14 m/s: strong enough to climb while banking round in it
  if (w < 0.15) return null;
  return { x: site.x, y: site.y, r: site.r, w, heat: site.heat, age };
}

/** All thermals touching a rectangle (world tiles, y south). */
export function thermalsIn(env: ThermalEnv, x0: number, y0: number, x1: number, y1: number, t: number, margin = 24): Thermal[] {
  const out: Thermal[] = [], C = THERMAL_CELL;
  for (let j = Math.floor((y0 - margin) / C); j <= Math.floor((y1 + margin) / C); j++) for (let i = Math.floor((x0 - margin) / C); i <= Math.floor((x1 + margin) / C); i++) {
    const th = thermalInCell(env, i, j, t); if (th) out.push(th);
  }
  return out;
}

/** The updraft of one thermal at a distance: a bell core, with a ring of gentle sink around it. */
export function thermalProfile(d: number, r: number, t: number, phase: number): number {
  const u = d / r;
  const core = Math.exp(-u * u * 0.7), ring = 0.2 * Math.exp(-(((u - 2.1) / 0.8) ** 2));
  return (core - ring) * (1 + 0.3 * Math.sin((2 * Math.PI * t) / 6 + phase));         // the core pulses: that is what pumping feeds on
}

/** Vertical air speed (m/s, up) at a world point (y south). Thermals, a little sink between them in the sun, and light turbulence. */
export function airVertical(env: ThermalEnv, x: number, y: number, t: number): number {
  const C = THERMAL_CELL, ci = Math.floor(x / C), cj = Math.floor(y / C);
  let w = 0;
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    const th = thermalInCell(env, i, j, t);
    if (th) w += th.w * thermalProfile(Math.hypot(x - th.x, y - th.y), th.r, t, i * 1.7 + j * 2.9);
  }
  const sun = sunFactor(env.hour);
  w -= 0.12 * sun;
  w += 0.18 * Math.sin(x * 0.31 + t * 1.3) * Math.cos(y * 0.27 - t * 0.9) * (0.4 + sun);
  return w;
}
