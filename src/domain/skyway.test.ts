import { afterEach, describe, expect, it } from 'vitest';
import { newGlider, throwPlane, insertOrbit, stepGlider, type Glider, type GlideEnv } from './glider';
import { setPlanetRadius, trackK } from './orbit';
import { newLadder, startLadder, stepLadder, nextRung, rungFuel, climbProgram, type Ladder } from './skyway';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const DT = 1 / 60;
afterEach(() => setPlanetRadius(null));

/** A pilot who flies the rungs: points the nose at the next one and burns while there is fuel. */
function climb(g: Glider, L: Ladder, secs = 900, skill = 1) {
  let gateT = -1, prev = { x: g.x, y: -g.y, h: g.z * 0.18 }, t = 0, passes = 0, misses = 0, maxZ = 0, orbitedAt = -1;
  startLadder(L, g);
  while (t < secs && !g.landed && (L.on || (gateT >= 0 && t < gateT + 8))) {
    const rg = L.rung;
    let want = g.gamma;
    if (rg) { const dh = rg.h / 0.18 - g.z, dd = Math.hypot(rg.x - g.x, rg.y + g.y) / trackK(g.z); want = Math.atan2(dh, Math.max(1, dd)); }
    const ctl = { pitch: Math.max(-1, Math.min(1, 2.5 * skill * (want - g.gamma))), roll: 0, yaw: 0, rocket: g.fuel > 0 && Math.abs(Math.asin(g.fwd[2]) - want) < 0.25 };   // (it burns when the nose is on the rung, not before)
    stepGlider(g, ctl, still, DT); t += DT;
    const ev = stepLadder(L, g, prev); prev = { x: g.x, y: -g.y, h: g.z * 0.18 };
    if (ev === 'gate') { insertOrbit(g); gateT = t; }
    if (ev === 'pass') passes++; else if (ev === 'miss') misses++;
    maxZ = Math.max(maxZ, g.z);
    if (g.orbited && orbitedAt < 0) orbitedAt = t;
  }
  return { t, gateT, passes, misses, maxZ, orbitedAt };
}
const fromGlide = () => { const g = newGlider(0, 0, 0, 50); throwPlane(g, 0, 0, 0, 50, 8, 0); return g; };

describe('the sky ladder', () => {
  it('makes each rung ahead of the plane, and higher when the plane is higher', () => {
    const g = fromGlide(); g.fuel = 2; const a = nextRung(1, g); expect(a.x).toBeGreaterThan(g.x + 50); expect(a.h).toBeGreaterThan(g.z * 0.18);
    g.z = 3000; g.fuel = 2; g.vx = 100; g.vz = 20; g.gamma = 0.2; const b = nextRung(2, g);
    expect(b.h / 0.18).toBeGreaterThan(3000); expect(b.r).toBeGreaterThan(a.r);
  });
  it('flattens the climb with height, to level at 45 km', () => { expect(climbProgram(0)).toBeGreaterThan(1.3); expect(climbProgram(45000)).toBeCloseTo(0, 6); expect(climbProgram(20000)).toBeGreaterThan(climbProgram(30000)); });
  it('gives a few seconds of burn a rung', () => { expect(rungFuel()).toBeGreaterThan(1); expect(rungFuel()).toBeLessThan(4); });
  it('makes a rung again when it is flown past', () => {
    const g = fromGlide(), L = newLadder(); L.on = true; expect(stepLadder(L, g, null)).toBe('spawn'); const r1 = L.rung!;
    g.x = r1.x + 30; g.y = -r1.y; expect(stepLadder(L, g, null)).toBe('miss'); expect(L.rung).not.toBe(r1); expect(L.n).toBe(0);
  });
  it('counts a rung flown through and makes the next', () => {
    const g = fromGlide(), L = newLadder(); L.on = true; stepLadder(L, g, null); const r1 = L.rung!;
    const prev = { x: r1.x - 5, y: r1.y, h: r1.h }; g.x = r1.x + 2; g.y = -r1.y; g.z = r1.h / 0.18;
    expect(stepLadder(L, g, prev)).toBe('pass'); expect(L.n).toBe(1); expect(L.rung!.n).toBe(2);
  });
  it('ends on the ground', () => { const g = fromGlide(), L = newLadder(); L.on = true; g.landed = true; expect(stepLadder(L, g, null)).toBe('end'); expect(L.on).toBe(false); });
  it('carries a pilot from a glide to orbit on the endless world (R 15 km)', () => {
    const g = fromGlide(), L = newLadder(); climb(g, L);
    expect(g.orbited).toBe(true);
  });
  it('a slower hand (half the stick) still gets there, on both planets', () => {
    for (const R of [null, 6417]) { setPlanetRadius(R); const g = fromGlide(), L = newLadder(); climb(g, L, 900, 0.5); expect(g.orbited, `R ${R}`).toBe(true); }
  });
  it('and on a cube planet (R 6.4 km)', () => {
    setPlanetRadius(6417); const g = fromGlide(), L = newLadder(); climb(g, L);
    expect(g.orbited).toBe(true);
  });
});
