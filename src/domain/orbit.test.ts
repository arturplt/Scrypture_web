import { describe, expect, it } from 'vitest';
import { newGlider, launchPlane, refuel, stepGlider, type Glider, type GlideEnv, type GlideControls } from './glider';
import { SPACE_FROM, SPACE_TO, spaceFactor, ORBIT, MU, G0, airDensity, gravityAt, orbitElements, circularSpeed, rocketFuel, thinness, heatRate, clearsAir } from './orbit';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const DT = 1 / 60;
const sim = (g: Glider, ctl: GlideControls, secs: number) => { for (let i = 0; i < secs / DT; i++) stepGlider(g, ctl, still, DT); };

/**
 * A scripted two-burn ascent east off the ground: burn 1 climbs steeply, pitching over as it rises, holding the apoapsis at `apoT` (the rocket is shut off when it is
 * high enough and lit again if drag eats it); then coast to the top; burn 2 flies level and prograde until the lowest point clears the air. Returns the flight.
 */
function ascend(tier: number, apoT = 45000, secs = 600) {
  const g = newGlider(0, 0, 0, 1); launchPlane(g, 0, 0, 0, 1); refuel(g, rocketFuel(tier));
  let phase: 'climb' | 'coast' | 'insert' | 'done' = 'climb', t = 0, maxPeri = -Infinity, maxApo = 0, orbitedAt = -1, fuelAtOrbit = 0;
  while (t < secs && !g.landed) {
    let want = 0, rocket = false;
    if (phase === 'climb') { want = Math.max(0.5, 1.35 - 0.03 * g.z / 1000); rocket = g.apo < apoT; if (g.z > 15000 && g.apo >= apoT) phase = 'coast'; }
    else if (phase === 'coast') { if (g.vz <= 3 && g.z > 15000) phase = 'insert'; }
    else if (phase === 'insert') { rocket = g.peri < ORBIT.TOP + 2000; if (!rocket) phase = 'done'; }
    stepGlider(g, { pitch: phase === 'coast' || phase === 'done' ? 0 : Math.max(-1, Math.min(1, want - g.gamma)), roll: 0, yaw: 0, rocket }, still, DT); t += DT;
    if (Number.isFinite(g.apo)) maxApo = Math.max(maxApo, g.apo); maxPeri = Math.max(maxPeri, g.peri);
    if (g.orbited && orbitedAt < 0) { orbitedAt = t; fuelAtOrbit = g.fuel; }
  }
  return { g, t, maxPeri, maxApo, orbitedAt, fuelAtOrbit, phase };
}

describe('the planet', () => {
  it('leaves the air alone up to 1000 m, then thins it by e every H', () => {
    expect(airDensity(0)).toBe(1); expect(airDensity(1000)).toBe(1);
    expect(airDensity(1000 + ORBIT.H)).toBeCloseTo(Math.exp(-1), 6);
    expect(airDensity(ORBIT.TOP)).toBeLessThan(1e-4);
  });
  it('weakens gravity with height and keeps it at sea level', () => {
    expect(gravityAt(0)).toBe(G0); expect(gravityAt(-50)).toBe(G0);
    expect(gravityAt(ORBIT.R)).toBeCloseTo(G0 / 4, 6);
  });
  it('turns the stick from the wing to the whole nose as the air thins', () => {
    expect(thinness(1)).toBe(0); expect(thinness(ORBIT.GIMBAL_THIN[1])).toBe(0); expect(thinness(ORBIT.GIMBAL_THIN[0])).toBe(1); expect(thinness(0)).toBe(1);
  });
  it('works out a circular orbit: apoapsis = periapsis, and the period of a Kepler orbit', () => {
    const h = 30000, v = circularSpeed(h), el = orbitElements(h, v, 0);
    expect(el.bound).toBe(true); expect(el.apo).toBeCloseTo(h, 0); expect(el.peri).toBeCloseTo(h, 0);
    expect(el.period).toBeCloseTo((2 * Math.PI * (ORBIT.R + h)) / v, 0);
    expect(clearsAir(el)).toBe(true);
  });
  it('works out an ellipse (more speed at the low point: a higher apoapsis) and an escape', () => {
    const h = 30000, v = circularSpeed(h), el = orbitElements(h, v * 1.1, 0);
    expect(el.peri).toBeCloseTo(h, 0); expect(el.apo).toBeGreaterThan(h + 3000);
    expect(orbitElements(h, v * 1.5, 0).bound).toBe(false);
    expect(orbitElements(0, 0, 0).peri).toBeLessThan(0);   // standing still it would fall straight through the ground
  });
  it('only heats the paper when it is fast in thick air', () => {
    expect(heatRate(1, 40)).toBe(0); expect(heatRate(1, 60)).toBe(0); expect(heatRate(1e-4, 234)).toBe(0); expect(heatRate(0.03, 238)).toBeGreaterThan(0.5);
  });
  it('flies as it always did low down: no rocket, no change in a glide from 100 m', () => {
    const g = newGlider(0, 0, 0, 100); sim(g, { pitch: 0, roll: 0, yaw: 0 }, 20);
    expect(g.heat).toBe(0); expect(g.fuel).toBe(0); expect(g.airspeed).toBeGreaterThan(6); expect(g.airspeed).toBeLessThan(8);
  });
});

describe('the sky', () => {
  it('goes from blue to space between 8 and 24 km, smoothly', () => {
    expect(spaceFactor(0)).toBe(0); expect(spaceFactor(SPACE_FROM)).toBe(0); expect(spaceFactor(SPACE_TO)).toBe(1); expect(spaceFactor(100000)).toBe(1);
    const mid = spaceFactor((SPACE_FROM + SPACE_TO) / 2); expect(mid).toBeCloseTo(0.5, 6); expect(spaceFactor(10000)).toBeLessThan(mid);
  });
});

describe('the rocket stage', () => {
  it('only burns while there is fuel, and the fuel runs down', () => {
    const g = newGlider(0, 0, 0, 1); launchPlane(g, 0, 0, 0, 1); refuel(g, 2);
    sim(g, { pitch: 0, roll: 0, yaw: 0, rocket: true }, 1); expect(g.fuel).toBeCloseTo(1, 1); expect(g.rocketOn).toBe(true);
    sim(g, { pitch: 0, roll: 0, yaw: 0, rocket: true }, 3); expect(g.fuel).toBe(0); expect(g.rocketOn).toBe(false);
  });
  it('pushes the plane along its nose', () => {
    const a = newGlider(0, 0, 0, 100), b = newGlider(0, 0, 0, 100); refuel(b, 3);
    sim(a, { pitch: 0, roll: 0, yaw: 0, rocket: true }, 2); sim(b, { pitch: 0, roll: 0, yaw: 0, rocket: true }, 2);
    expect(b.airspeed).toBeGreaterThan(a.airspeed + 40);
  });
  it('the top tier carries the delta-v of an orbit and the lower ones cannot', () => {
    // the least delta-v of an orbit, from rest at sea level with no air and no gravity loss: the energy of the climb and of the circular speed
    const dv = (tier: number) => rocketFuel(tier) * ORBIT.THRUST, floor = Math.sqrt(2 * (MU * (1 / ORBIT.R - 1 / (ORBIT.R + ORBIT.TOP)) + 0.5 * circularSpeed(ORBIT.TOP) ** 2));
    expect(dv(2)).toBeLessThan(floor); expect(dv(1)).toBeLessThan(dv(2)); expect(dv(3)).toBeGreaterThan(1.4 * floor); expect(rocketFuel(0)).toBe(0);
  });
});

describe('an ascent', () => {
  it('the orbital stage reaches orbit: the periapsis clears the air and stays clear', () => {
    const r = ascend(3);
    expect(r.orbitedAt).toBeGreaterThan(0); expect(r.g.orbited).toBe(true); expect(r.fuelAtOrbit).toBeGreaterThan(0);   // (with a little to spare for coming down)
    expect(r.g.landed).toBe(false); expect(r.g.peri).toBeGreaterThan(ORBIT.TOP - 3000);
  });
  it('coasts in orbit for minutes without losing it', () => {
    const r = ascend(3), g = r.g; g.fuel = g.fuel; sim(g, { pitch: 0, roll: 0, yaw: 0 }, 300);
    expect(g.landed).toBe(false); expect(g.peri).toBeGreaterThan(ORBIT.TOP - 8000); expect(g.heat).toBeLessThan(0.5);
  });
  it('the sounding rocket and the booster reach space but not orbit', () => {
    for (const tier of [1, 2]) { const r = ascend(tier); expect(r.g.orbited).toBe(false); expect(r.maxPeri).toBeLessThan(ORBIT.TOP); }
    expect(ascend(2).maxApo).toBeGreaterThan(ascend(1).maxApo);
  });
});

describe('coming back', () => {
  /** A circular orbit flown east at 27 km, a retrograde burn of `burn` seconds (stick full back turns the nose round), then down with the stick held at `stick` while above 8 km. */
  function reenter(burn: number, stick: number, secs = 400) {
    const g = newGlider(0, 0, 0, 27000), v = circularSpeed(27000);
    g.vx = v; g.vy = 0; g.vz = 0; g.airspeed = v; g.gamma = 0; g.alpha = 0; refuel(g, 20);
    let t = 0, maxHeat = 0, burnedAt = -1, minH = Infinity;
    while (t < secs && !g.landed) {
      const burning = t < burn;
      stepGlider(g, { pitch: burning ? 1 : g.z > 8000 ? stick : 0, roll: 0, yaw: 0, rocket: burning }, still, DT); t += DT;
      maxHeat = Math.max(maxHeat, g.heat); minH = Math.min(minH, g.z); if (burnedAt < 0 && g.heat >= 1) burnedAt = t;
    }
    return { g, maxHeat, burnedAt, minH };
  }
  it('a retrograde burn drops the periapsis into the air', () => {
    const g = newGlider(0, 0, 0, 27000), v = circularSpeed(27000);
    g.vx = v; g.vy = 0; g.vz = 0; g.airspeed = v; g.alpha = 0; refuel(g, 20);
    sim(g, { pitch: 1, roll: 0, yaw: 0, rocket: true }, 4); sim(g, { pitch: 0, roll: 0, yaw: 0 }, 0.1);
    expect(g.peri).toBeLessThan(ORBIT.TOP - 15000); expect(g.vx).toBeLessThan(v - 40);
  });
  it('comes down nose first and burns up, belly first and it does not', () => {
    const nose = reenter(5.5, 0), belly = reenter(5.5, 0.5);
    expect(nose.burnedAt).toBeGreaterThan(0); expect(belly.maxHeat).toBeLessThan(0.5); expect(belly.burnedAt).toBe(-1);
  });
  it('a heat shield slows the heating', () => {
    const g = newGlider(0, 0, 0, 27000), v = circularSpeed(27000), s = newGlider(0, 0, 0, 27000); s.heatK = 0.15;
    for (const p of [g, s]) { p.vx = v; p.vy = 0; p.vz = 0; p.airspeed = v; p.alpha = 0; refuel(p, 20); }
    for (const p of [g, s]) { sim(p, { pitch: 1, roll: 0, yaw: 0, rocket: true }, 5.5); sim(p, { pitch: 0, roll: 0, yaw: 0 }, 140); }
    expect(s.heat).toBeLessThan(g.heat + 1e-9); expect(s.heat).toBeLessThan(1);
  });
  it('the glide that follows lands the plane after a belly-first descent', () => {
    const r = reenter(5.5, 0.5, 700); expect(r.g.z).toBeLessThan(9000); expect(r.g.airspeed).toBeLessThan(120); expect(r.burnedAt).toBe(-1);
  });
});

describe('the way down from a spent orbit, and the edge of space', () => {
  it('with the tank empty, R still pushes a little (a sail) in thin air, and not at all in thick air', () => {
    const v = circularSpeed(30000), a = newGlider(0, 0, 0, 30000); a.vx = v; a.vy = 0; a.vz = 0; a.airspeed = v; a.alpha = 0;
    const b = structuredClone(a); sim(a, { pitch: 0, roll: 0, yaw: 0, rocket: true }, 10); sim(b, { pitch: 0, roll: 0, yaw: 0 }, 10);
    expect(a.vx - b.vx).toBeGreaterThan(0.5 * ORBIT.SAIL * 10); expect(a.rocketOn).toBe(true);
    const c = newGlider(0, 0, 0, 100), d = structuredClone(c); sim(c, { pitch: 0, roll: 0, yaw: 0, rocket: true }, 3); sim(d, { pitch: 0, roll: 0, yaw: 0 }, 3);
    expect(Math.abs(c.airspeed - d.airspeed)).toBeLessThan(0.05); expect(c.rocketOn).toBe(false);
  });
  it('a tank-empty orbit can be sailed down: stick full back, R held, and the periapsis falls into the air', () => {
    const v = circularSpeed(30000), g = newGlider(0, 0, 0, 30000); g.vx = v; g.vy = 0; g.vz = 0; g.airspeed = v; g.alpha = 0;
    let t = 0; while (t < 400 && g.peri > 5000) { stepGlider(g, { pitch: 1, roll: 0, yaw: 0, rocket: true }, still, DT); t += DT; }
    expect(g.peri).toBeLessThanOrEqual(5000); expect(t).toBeLessThan(300);
  });
  it('a straight-up burn that overshoots escape is thrown back at the ceiling, not lost', () => {
    const g = newGlider(0, 0, 0, 1); launchPlane(g, 0, 0, 0, 1); refuel(g, 22);
    let t = 0, top = 0; while (t < 700 && !g.landed) { stepGlider(g, { pitch: 0, roll: 0, yaw: 0, rocket: t < 18 }, still, DT); t += DT; top = Math.max(top, g.z); }
    expect(top).toBeGreaterThan(ORBIT.CEILING); expect(top).toBeLessThan(ORBIT.CEILING + 15000); expect(g.vz).toBeLessThan(0);
  });
});
