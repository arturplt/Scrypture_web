/**
 * The sky of the cube planet: it spins, goes round a sun once a year, and has a moon going round it once a month.
 *
 * Time is `days`: a float, 1 = one solar day (DAY_SECONDS of play, see sky.ts). The inertial frame is the planet's own ball frame at day 0 (the axes are the cube's, see cube.ts FACES).
 *  - The planet turns about the axis P, a cube CORNER (1,1,1)/sqrt3: corners are open ocean (cube.ts CAP_LEVEL), so the permanent dusk at the poles never falls on land. No axial tilt (no seasons): every
 *    place has a 12 hour day. The spin is "eastward" (anticlockwise seen from over P), at a sidereal rate that makes the SOLAR day exactly 1: 2pi (1 + 1/YEAR_DAYS) a day.
 *  - It goes round the sun in the plane at right angles to P, once per YEAR_DAYS. `sunInertial` is the direction of the sun from the planet.
 *  - The moon goes round the planet once per MONTH_DAYS counted from new moon to new moon (so the phases repeat every month): its elongation from the sun is 2pi t / MONTH_DAYS. Its path is a great
 *    circle tilted MOON_INCL from the ecliptic, and the tilt is held on the sun (the nodes follow the sun round, as if they precessed once a year), so at new moon it is always MOON_INCL away from the sun
 *    (no eclipse: they are not asked for) and at full moon MOON_INCL from the antisun.
 *
 * Everything here is pure. The renderer takes unit directions in the EYE frame (x east, y south, z down, the chart the plane flies in: `eyeFrame` of cube.ts), so `toLocal` turns an inertial direction into
 * one, for the eye's `{ up, east, south }` (which are fixed to the planet).
 */
import { DAY_SECONDS } from './sky';

export type Vec3 = [number, number, number];
export interface EyeAxes { up: readonly number[]; east: readonly number[]; south: readonly number[] }

/** One orbit round the sun, and one moon from new to new, in solar days. */
export const YEAR_DAYS = 24;
export const MONTH_DAYS = 4;
/** The moon's path is this far (rad) off the sun at new moon, and off the antisun at full moon. */
export const MOON_INCL = (5 * Math.PI) / 180;
/** The sky follows time warp at most this many times faster than real time (x50 would put a whole day between two frames of a slow screen). */
export const SKY_WARP_MAX = 50;
/** Days per second of play. */
export const DAYS_PER_SECOND = 1 / DAY_SECONDS;

const TAU = Math.PI * 2;
const S3 = Math.sqrt(3);
/** The spin axis, and two unit vectors that span the ecliptic (E1 x E2 = P). */
export const POLE: Vec3 = [1 / S3, 1 / S3, 1 / S3];
const E1: Vec3 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
const E2: Vec3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => { const k = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / k, v[1] / k, v[2] / k]; };
/** `v` turned by `ang` about the pole (anticlockwise seen from over it). */
function spin(v: ArrayLike<number>, ang: number): Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang), k = dot(POLE, v) * (1 - c), x = cross(POLE, v);
  return [v[0] * c + x[0] * s + POLE[0] * k, v[1] * c + x[1] * s + POLE[1] * k, v[2] * c + x[2] * s + POLE[2] * k];
}

/** How far the planet has turned (rad): 2pi (1 + 1/YEAR) a day. */
export const spinAngle = (days: number): number => TAU * days * (1 + 1 / YEAR_DAYS);
/** The sun's ecliptic longitude (rad): the direction of the sun from the planet is cos L E1 + sin L E2. */
export const sunLongitude = (days: number): number => (TAU * days) / YEAR_DAYS;
/** Where the moon is on its way round the sun-fixed frame: elongation from the sun (0 new, pi full). */
export const moonElongation = (days: number): number => (TAU * days) / MONTH_DAYS;

/** The direction of the sun from the planet, in the inertial frame. */
export function sunInertial(days: number): Vec3 {
  const L = sunLongitude(days), c = Math.cos(L), s = Math.sin(L);
  return [c * E1[0] + s * E2[0], c * E1[1] + s * E2[1], c * E1[2] + s * E2[2]];
}
/** The direction of the moon from the planet, in the inertial frame: in the frame of the sun (S, P x S, P) it is (cos a cos i, sin a, -cos a sin i), a = the elongation, i = the tilt. */
export function moonInertial(days: number): Vec3 {
  const S = sunInertial(days), T = cross(POLE, S), a = moonElongation(days), x = Math.cos(a) * Math.cos(MOON_INCL), y = Math.sin(a), z = -Math.cos(a) * Math.sin(MOON_INCL);
  return [x * S[0] + y * T[0] + z * POLE[0], x * S[1] + y * T[1] + z * POLE[1], x * S[2] + y * T[2] + z * POLE[2]];
}
/** The lit part of the moon's face (0 new .. 1 full). */
export const moonLit = (days: number): number => (1 - dot(moonInertial(days), sunInertial(days))) / 2;

/** An inertial direction as the eye sees it (x east, y south, z down): the planet is turned by `spinAngle(days)` under the sky. */
export function toLocal(w: ArrayLike<number>, days: number, eye: EyeAxes): Vec3 {
  const u = spin(w, -spinAngle(days));
  return [dot(u, eye.east), dot(u, eye.south), -dot(u, eye.up)];
}

/** The local solar time (0..24 h) of the place whose planet-fixed up is `up`: 12 when the sun stands over its meridian, 6 at sunrise, 18 at sunset. */
export function localHour(days: number, up: ArrayLike<number>): number {
  const p = spin(up, spinAngle(days)), lp = Math.atan2(dot(p, E2), dot(p, E1)), ls = sunLongitude(days);
  const h = 12 + ((lp - ls) / TAU) * 24;
  return ((h % 24) + 24) % 24;
}
/**
 * The time (days) nearest `days` at which `hour` is the local time at `up`. `forward` instead takes the first such time at or after `days` (a time that is never negative: for a world
 * opened with an hour and no clock yet).
 */
export function shiftToHour(days: number, up: ArrayLike<number>, hour: number, forward = false): number {
  const h = localHour(days, up);
  let d = (((hour - h) % 24) + 24) % 24;
  if (!forward && d >= 12) d -= 24;
  const t = days + d / 24;
  return t < 0 ? t + 1 : t;
}

/** What the renderer is given: unit directions in the eye frame. */
export interface SkyState {
  sun: Vec3;
  moon: Vec3;
  /** The moon's picture: unit vectors at right angles to `moon` and to each other, `moonUp` towards the ecliptic's north. */
  moonRt: Vec3;
  moonUp: Vec3;
  /** The lit part of the moon's face, 0 new .. 1 full. */
  moonK: number;
}
export function skyAt(days: number, eye: EyeAxes): SkyState {
  const sun = toLocal(sunInertial(days), days, eye), moon = toLocal(moonInertial(days), days, eye), pole = toLocal(POLE, days, eye);
  const k = dot(pole, moon), up = unit([pole[0] - moon[0] * k, pole[1] - moon[1] * k, pole[2] - moon[2] * k]);
  return { sun, moon, moonUp: up, moonRt: unit(cross(up, moon)), moonK: moonLit(days) };
}
