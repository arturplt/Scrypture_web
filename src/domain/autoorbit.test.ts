import { describe, expect, it } from 'vitest';
import { newGlider, launchPlane, throwPlane, refuel, stepGlider, type Glider, type GlideEnv } from './glider';
import { newAuto, stepAuto } from './autoorbit';
import { rocketFuel, ORBIT } from './orbit';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const DT = 1 / 60;
/** Fly with the auto orbit only: it picks the rocket and the stick. */
function fly(g: Glider, secs = 600) {
  const a = newAuto(); let t = 0;
  while (t < secs && !g.landed) { const c = stepAuto(a, g); stepGlider(g, { pitch: c.pitch, roll: c.roll, yaw: c.yaw, rocket: c.rocket }, still, DT); t += DT; }
  return { g, a, t };
}
const fromGround = (tier: number, heading = 0) => { const g = newGlider(0, 0, heading, 1); launchPlane(g, 0, 0, heading, 1); refuel(g, rocketFuel(tier)); return g; };
const fromLakeStart = (tier: number) => { const g = newGlider(0, 0, 0.7, 50); throwPlane(g, 0, 0, 0.7, 50, 7, 0); refuel(g, rocketFuel(tier)); return g; };

describe('auto orbit', () => {
  it('flies the orbital stage from a ground launch to orbit, and keeps some fuel', () => {
    const { g, a } = fly(fromGround(3)); expect(a.phase).toBe('done'); expect(g.orbited).toBe(true); expect(g.fuel).toBeGreaterThan(2); expect(g.landed).toBe(false);
  });
  it('does it in any direction', () => { for (const h of [1.2, 3.0, -2.0]) expect(fly(fromGround(3, h)).g.orbited, `heading ${h}`).toBe(true); });
  it('and from a level start in the air, as a hilly world opens (50 m up at 7 m/s)', () => {
    const { g, a } = fly(fromLakeStart(3)); expect(g.orbited, `phase ${a.phase}`).toBe(true);
  });
  it('the lower tiers fail cleanly: no orbit, no burn after the fuel is gone', () => {
    for (const tier of [1, 2]) { const { g, a } = fly(fromGround(tier)); expect(g.orbited).toBe(false); expect(a.phase).toBe('fail'); expect(g.fuel).toBe(0); }
  });
  it('with no rocket at all it just fails at once', () => { const { a } = fly(fromGround(0), 20); expect(a.phase).toBe('fail'); });
  it('leaves enough fuel to come home (a retro burn of a few seconds)', () => {
    const { g } = fly(fromGround(3)); expect(g.fuel * ORBIT.THRUST).toBeGreaterThan(100);
  });
});
