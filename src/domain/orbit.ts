/**
 * Arcade orbit for the paper plane. The world stays flat (x east, y north, z up, 1 tile = 1 m) but it pretends to be a small planet:
 *  - the air thins with height above sea level (full density up to FLAT_H, so the fells fly as they always did, then exponentially);
 *  - gravity weakens with height, and a centrifugal term v^2 / r cancels it at orbital speed (the usual flat-world trick), with the angular momentum kept
 *    as the plane climbs and falls, so the path really is a Kepler ellipse;
 *  - a rocket stage (bought in the shop, fuel by tier) and the numbers below make the planet small enough to reach: it takes about 500 m/s of delta-v at the very least (a good two-burn ascent spends about 600).
 * Every tunable lives in ORBIT; `orbit.test.ts` flies a scripted ascent and checks the top tier gets there and the lower ones cannot.
 * Units: metres, seconds, m/s, as in glider.ts. Heights here are above SEA LEVEL.
 */
export const G0 = 9.81;
export const ORBIT = {
  R: 15000,                 // m: the planet's radius
  FLAT_H: 1000,             // m: full air density up to here
  H: 2000,                  // m: the air thins by e every H metres above it
  TOP: 25000,               // m: a periapsis above this clears the air: an orbit (the drag left is about 0.04 m/s^2 at orbital speed)
  HOLD: 3,                  // s: the periapsis must stay clear this long to count
  THRUST: 40,               // m/s^2 along the nose while the rocket burns (4 g: about 30 s of burn through the thick air)
  FUEL: [0, 6, 12, 22],     // seconds of burn by rocket tier (none, sounding rocket, booster, orbital stage)
  FAIRING: 0.003,            // the drag and heating of the plane are this much while the stage burns (the paper is tucked in the nose cone)
  FAIR_OFF: 3,              // s: the nose cone takes this long to fall away once it may
  CONE_DROP_V: 80,          // m/s: after burnout the cone is let go when the plane is slower than this ...
  CONE_DROP_RHO: 3e-5,      // ... or in air thinner than this (about 21 km up: at 700 m/s anything lower would burn the paper through)
  GIMBAL_THIN: [0.02, 0.15],// the air density over which the stick turns from steering with the wing to turning the whole nose (a thrust vector)
  SAIL: 0.6,                // m/s^2: with the tank empty, in air this thin, R unfolds the paper as a sail and it still pushes a little: enough to come down from an orbit in a couple of minutes
  SAIL_RHO: 1e-3,           // the air density below which the sail works
  CEILING: 70000,           // m: the edge of the world's space. Above it a soft wall throws the plane back, so a burn that overshoots escape does not strand it forever
  CEILING_K: 0.02, CEILING_DAMP: 0.03,   // the wall's spring (1/s^2) and its damping (1/s)
  HEAT_ONSET: 2.5e5,          // sqrt(rho) * V^3 below which nothing heats up (a 60 m/s dive at sea level is just under it)
  HEAT_SCALE: 2e6,          // ... and the excess that heats the paper to burning in a second
  HEAT_COOL: 0.1,           // per second
};
export const MU = G0 * ORBIT.R * ORBIT.R;
export const rocketFuel = (tier: number) => ORBIT.FUEL[Math.max(0, Math.min(ORBIT.FUEL.length - 1, Math.round(tier)))];

/** Air density against sea level at a height above sea level: 1 up to FLAT_H, then thinning exponentially. */
export const airDensity = (h: number) => (h <= ORBIT.FLAT_H ? 1 : Math.exp(-(h - ORBIT.FLAT_H) / ORBIT.H));
/** Gravity at a height above sea level. */
export const gravityAt = (h: number) => G0 * (ORBIT.R / (ORBIT.R + Math.max(0, h))) ** 2;
/** 0 in air that steers the wing, 1 where the stick turns the nose freely. */
export const thinness = (rho: number) => { const [a, b] = ORBIT.GIMBAL_THIN; const t = Math.max(0, Math.min(1, (rho - a) / (b - a))); return 1 - t * t * (3 - 2 * t); };

export interface OrbitElements { apo: number; peri: number; period: number; speed: number; bound: boolean }
/** The orbit the plane would fly with the controls and the air left alone: from its height above sea level, horizontal speed and climb speed. Heights are above sea level. */
export function orbitElements(h: number, vh: number, vz: number): OrbitElements {
  const r = ORBIT.R + Math.max(0, h), L = r * Math.abs(vh), eps = (vh * vh + vz * vz) / 2 - MU / r;
  if (eps >= 0) return { apo: Infinity, peri: -ORBIT.R, period: Infinity, speed: Math.hypot(vh, vz), bound: false };
  const a = -MU / (2 * eps), e = Math.sqrt(Math.max(0, 1 + (2 * eps * L * L) / (MU * MU)));
  return { apo: a * (1 + e) - ORBIT.R, peri: a * (1 - e) - ORBIT.R, period: 2 * Math.PI * Math.sqrt((a * a * a) / MU), speed: Math.hypot(vh, vz), bound: true };
}
/** Is this a stable orbit: bound, and its lowest point clear of the air. */
export const clearsAir = (el: OrbitElements) => el.bound && el.peri >= ORBIT.TOP;
/** The speed of a circular orbit at this height. */
export const circularSpeed = (h: number) => Math.sqrt(MU / (ORBIT.R + Math.max(0, h)));
/** How fast the paper heats at this density and speed (per second, before cooling). */
export const heatRate = (rho: number, v: number) => Math.max(0, Math.sqrt(rho) * v * v * v - ORBIT.HEAT_ONSET) / ORBIT.HEAT_SCALE;   // (sqrt(rho) v^3, as the heat flux of a blunt body goes: a fast dive at sea level is not a reentry)
/** How much like space the sky looks at this height above sea level: 0 below SPACE_FROM, 1 above SPACE_TO, smooth between. */
export const SPACE_FROM = 8000, SPACE_TO = 24000;
export const spaceFactor = (h: number) => { const t = Math.max(0, Math.min(1, (h - SPACE_FROM) / (SPACE_TO - SPACE_FROM))); return t * t * (3 - 2 * t); };
