import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider, type GlideEnv } from './glider';
import { captureSas, newSas, nextSasMode, stepSas, type SasInput, type SasMode } from './sas';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const settled = (z = 200) => { const g = newGlider(0, 0, 0.4, z); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60); return g; };
/** Fly `secs` with the assist; `input` and `thrust` may change with the time. */
function fly(mode: SasMode, secs: number, input: (t: number) => Partial<SasInput> = () => ({}), thrust: (t: number) => number = () => 0, g = settled()) {
  const s = newSas(mode); captureSas(s, g);
  for (let i = 0; i < secs * 60; i++) {
    const t = i / 60, th = thrust(t), c = stepSas(s, g, { pitch: 0, roll: 0, yaw: 0, ...input(t) }, 1 / 60, th);
    stepGlider(g, { ...c, thrust: th }, still, 1 / 60);
  }
  return { g, s };
}
const deg = (r: number) => r * 180 / Math.PI;

describe('stability assist', () => {
  it('cycles off, level, hold, acro', () => { expect(nextSasMode('off')).toBe('level'); expect(nextSasMode('level')).toBe('hold'); expect(nextSasMode('hold')).toBe('acro'); expect(nextSasMode('acro')).toBe('off'); });
  it('throttle no longer throws the nose up: the climb angle stays near where it was held (without the assist it goes up past 15 degrees)', () => {
    for (const th of [0.1, 0.2, 0.4]) {
      const g0 = settled(), g1 = settled(); let off = -9;
      for (let i = 0; i < 60 * 8; i++) { stepGlider(g0, { pitch: 0, roll: 0, yaw: 0, thrust: th }, still, 1 / 60); off = Math.max(off, g0.gamma); }
      const held = g1.gamma, { g } = fly('hold', 8, () => ({}), () => th, g1);
      expect(Math.abs(deg(g.gamma - held)), `thrust ${th}`).toBeLessThan(8);
      if (th >= 0.2) expect(deg(off - held), `without the assist, thrust ${th}`).toBeGreaterThan(10);
    }
  });
  it('holds the climb angle the stick asked for (with a little thrust to climb on), and the wings stay level', () => {
    const g1 = settled(), g0 = g1.gamma, { g, s } = fly('level', 10, t => (t < 3 ? { pitch: 1 } : {}), () => 0.3, g1);
    expect(s.gammaT).toBeGreaterThan(g0 + 0.1); expect(deg(g.gamma - g0)).toBeGreaterThan(5); expect(Math.abs(g.phi)).toBeLessThan(0.1); expect(g.landed).toBe(false); expect(g.stalled).toBe(false);
  });
  it('with no thrust a climb is asked for but not stalled into: the speed stays above the stall', () => {
    const { g } = fly('hold', 10, () => ({ pitch: 1 })); expect(g.airspeed).toBeGreaterThan(4.5); expect(g.landed).toBe(false);
  });
  it('level: a bank held on the stick turns the plane, and letting go brings the wings level', () => {
    const { g } = fly('level', 8, t => (t < 1 ? { roll: 1 } : {}));
    expect(Math.abs(g.phi)).toBeLessThan(0.15);
  });
  it('hold: a bank is kept after the stick is let go (a steady turn), with the climb angle held through it', () => {
    const g1 = settled(), g0 = g1.gamma, { g, s } = fly('hold', 6, t => (t < 0.6 ? { roll: 1 } : {}), () => 0, g1);
    expect(s.phiT).toBeGreaterThan(0.5); expect(Math.abs(g.phi - s.phiT)).toBeLessThan(0.2); expect(Math.abs(deg(g.gamma - g0))).toBeLessThan(16); expect(g.landed).toBe(false);
  });
  it('the rudder passes through untouched', () => { const g = settled(), s = newSas('hold'); expect(stepSas(s, g, { pitch: 0, roll: 0, yaw: 0.7 }, 1 / 60).yaw).toBe(0.7); });

  describe('acro', () => {
    const settledAero = (z = 200) => settled(z);
    it('throttle does not throw the nose up: the flight path stays near where it was left, wings kept', () => {
      for (const th of [0.2, 0.4]) {
        const g1 = settledAero(), u0 = [g1.vx, g1.vy, g1.vz], { g } = fly('acro', 8, () => ({}), () => th, g1);
        const v = Math.hypot(g.vx, g.vy, g.vz), cos = (g.vx * u0[0] + g.vy * u0[1] + g.vz * u0[2]) / (v * Math.hypot(u0[0], u0[1], u0[2]));
        expect(deg(Math.acos(Math.min(1, cos))), `thrust ${th}`).toBeLessThan(15); expect(g.landed).toBe(false);
      }
    });
    it('a held roll stick rolls round with throttle on, and the path stays straight enough', () => {
      const g1 = settledAero(), u0 = [g1.vx, g1.vy, g1.vz], s = newSas('acro'); captureSas(s, g1);
      let cum = 0, worst = 0;
      for (let i = 0; i < 60 * 3; i++) { const c = stepSas(s, g1, { pitch: 0, roll: 1, yaw: 0 }, 1 / 60, 0.3); stepGlider(g1, { ...c, thrust: 0.3 }, still, 1 / 60); cum += g1.rollRate / 60;
        const v = Math.hypot(g1.vx, g1.vy, g1.vz); worst = Math.max(worst, deg(Math.acos(Math.max(-1, Math.min(1, (g1.vx * u0[0] + g1.vy * u0[1] + g1.vz * u0[2]) / (v * Math.hypot(u0[0], u0[1], u0[2]))))))); }
      expect(cum).toBeGreaterThan(2 * Math.PI); expect(worst).toBeLessThan(60); expect(g1.landed).toBe(false);
    });
    it('let go of the roll stick on its back and it stays there (inverted flight held)', () => {
      const g1 = settledAero(), s = newSas('acro'); captureSas(s, g1);
      for (let i = 0; i < 400 && Math.abs(g1.phi) < 3.0; i++) { const c = stepSas(s, g1, { pitch: 0, roll: 1, yaw: 0 }, 1 / 60, 0.2); stepGlider(g1, { ...c, thrust: 0.2 }, still, 1 / 60); }
      const stop = g1.phi;
      for (let i = 0; i < 60 * 2; i++) { const c = stepSas(s, g1, { pitch: 0, roll: 0, yaw: 0 }, 1 / 60, 0.2); stepGlider(g1, { ...c, thrust: 0.2 }, still, 1 / 60); }
      expect(Math.abs(Math.abs(g1.phi) - Math.PI)).toBeLessThan(0.6); expect(Math.abs(Math.sin(g1.phi - stop))).toBeLessThan(0.5); expect(g1.landed).toBe(false);
    });
    it('with some speed on (throttle), a held pull goes round in a loop and it comes out flying', () => {
      const g1 = settledAero(), s = newSas('acro'); captureSas(s, g1); let minNz = 9;
      for (let i = 0; i < 60 * 12; i++) { const c = stepSas(s, g1, { pitch: i > 60 * 4 && i < 60 * 7.5 ? 0.7 : 0, roll: 0, yaw: 0 }, 1 / 60, 0.5); stepGlider(g1, { ...c, thrust: 0.5 }, still, 1 / 60); minNz = Math.min(minNz, g1.nz); }
      expect(minNz).toBeLessThan(-0.3); expect(g1.landed).toBe(false);
    });
  });
});
