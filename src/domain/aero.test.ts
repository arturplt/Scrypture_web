import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider } from './glider';

const env = { windX: 0, windY: 0, air: () => 0 };
const fast = () => { const g = newGlider(0, 0, 0, 200); g.vx = 16; g.vy = 0; g.airspeed = 16; return g; };

describe('aerobatics', () => {
  it('a hard pull makes a loop: the heading flips over the top and the plane ends up inverted, heading back', () => {
    const g = fast(); let flipped = false, maxZ = g.z; const psi0 = g.psi;
    for (let i = 0; i < 90 * 4 && !g.landed; i++) { stepGlider(g, { pitch: 1, roll: 0, yaw: 0, aero: true }, env, 1 / 90); maxZ = Math.max(maxZ, g.z); if (Math.abs(Math.cos(g.psi - psi0) + 1) < 0.2) flipped = true; }
    expect(flipped).toBe(true);
    expect(Number.isFinite(g.x + g.y + g.z)).toBe(true);
    expect(maxZ).toBeGreaterThan(205);
  });
  it('without aerobatics the bank stays inside 77 degrees', () => {
    const g = fast();
    for (let i = 0; i < 90 * 4; i++) stepGlider(g, { pitch: 0, roll: 1, yaw: 0 }, env, 1 / 90);
    expect(Math.abs(g.phi)).toBeLessThanOrEqual(1.35 + 1e-9);
  });
  it('with aerobatics a held roll goes right past inverted', () => {
    const g = fast(); let max = 0;
    for (let i = 0; i < 90 * 3; i++) { stepGlider(g, { pitch: 0, roll: 1, yaw: 0, aero: true }, env, 1 / 90); max = Math.max(max, Math.abs(g.phi)); }
    expect(max).toBeGreaterThan(2.5);
  });
});

import { newTrickState, stepTricks, type TrickName } from './tricks';
const fly = (g: ReturnType<typeof newGlider>, secs: number, ctl: (g: ReturnType<typeof newGlider>) => { pitch: number; roll: number }, got: TrickName[], tr = newTrickState()) => {
  for (let i = 0; i < 90 * secs && !g.landed; i++) { const c = ctl(g); stepGlider(g, { ...c, yaw: 0, aero: true }, env, 1 / 90); if (i % 2 === 0) got.push(...stepTricks(tr, g, 2 / 90)); }
};
describe('tricks', () => {
  it('a held roll scores barrel rolls', () => { const got: TrickName[] = []; fly(fast(), 3, () => ({ pitch: 0, roll: 1 }), got); expect(got).toContain('roll'); });
  it('a hard pull scores a loop', () => { const got: TrickName[] = []; fly(fast(), 5, () => ({ pitch: 1, roll: 0 }), got); expect(got).toContain('loop'); });
  it('wings level straight flight scores nothing', () => { const got: TrickName[] = []; fly(fast(), 3, () => ({ pitch: 0, roll: 0 }), got); expect(got).toEqual([]); });
  it('immelman: pull up, then roll upright', () => {
    const g = fast(), got: TrickName[] = []; let ph = 0;
    fly(g, 8, x => { if (ph === 0 && Math.cos(x.psi) < -0.5) ph = 1; return ph === 0 ? { pitch: 1, roll: 0 } : { pitch: 0.1, roll: 1 }; }, got);
    expect(got).toContain('immelman');
  });
});

describe('split S', () => {
  it('roll inverted, then pull through', () => {
    const g = newGlider(0, 0, 0, 200); g.vx = 12; g.airspeed = 12; const got: TrickName[] = []; let ph = 0;
    fly(g, 8, x => { if (ph === 0 && Math.abs(x.phi) > 2.6) ph = 1; return ph === 0 ? { pitch: 0, roll: 1 } : { pitch: 1, roll: 0 }; }, got);
    expect(got).toContain('splitS');
  });
});

import { comboAward, comboStep, newCombo, comboMult, type TreeRef } from './tricks';
describe('combo', () => {
  it('each trick in quick succession is worth more, and a pause ends the chain', () => {
    const c = newCombo();
    expect(comboAward(c, 100)).toEqual({ pts: 100, mult: 1 });
    expect(comboAward(c, 100)).toEqual({ pts: 150, mult: 1.5 });
    expect(comboAward(c, 100).pts).toBe(200);
    for (let i = 0; i < 70; i++) comboStep(c, 0.1);
    expect(c.n).toBe(0); expect(comboMult(c)).toBe(1);
  });
  it('is capped', () => { const c = newCombo(); for (let i = 0; i < 20; i++) comboAward(c, 10); expect(comboMult(c)).toBe(4); });
});
describe('slalom, stall hang, thermal', () => {
  const run = (trees: TreeRef[], secs: number, mk = (g: ReturnType<typeof newGlider>) => g, lift = 0) => {
    const g = mk(newGlider(0, 0, 0, 3)); g.vx = 8; g.vy = 0; g.airspeed = 8; const t = newTrickState(), got: TrickName[] = [];
    for (let i = 0; i < 90 * secs; i++) { stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, { ...env, air: () => lift }, 1 / 90); if (i % 2 === 0) got.push(...stepTricks(t, g, 2 / 90, { px: g.x, py: -g.y, hx: Math.cos(g.psi), hy: -Math.sin(g.psi), lift, trees })); }
    return got;
  };
  it('weaving between trees pays; passing them all on one side does not', () => {
    const alt: TreeRef[] = [0, 1, 2, 3].map(i => ({ key: i, x: 4 + i * 4, y: i % 2 ? 1.2 : -1.2, top: 5 }));
    const same: TreeRef[] = [0, 1, 2, 3].map(i => ({ key: 10 + i, x: 4 + i * 4, y: 1.2, top: 5 }));
    expect(run(alt, 3).filter(x => x === 'slalom').length).toBeGreaterThanOrEqual(2);
    expect(run(same, 3)).not.toContain('slalom');
  });
  it('a climb of 50 m inside one thermal pays once', () => {
    const got = run([], 6, g => { g.z = 100; g.vz = 12; return g; }, 12);
    expect(got.filter(x => x === 'thermal').length).toBe(1);
  });
});

describe('stall hang', () => {
  it('2 s past the stall then recovered pays; dropping into the ground does not', () => {
    const run = (secs: number, land: boolean) => {
      const g = newGlider(0, 0, 0, 50), t = newTrickState(), got: TrickName[] = [];
      for (let i = 0; i < 90 * secs; i++) { g.stalled = true; got.push(...stepTricks(t, g, 1 / 90, { px: 0, py: 0, hx: 1, hy: 0, lift: 0, trees: [] })); }
      if (land) g.landed = true;
      g.stalled = false; got.push(...stepTricks(t, g, 1 / 90, { px: 0, py: 0, hx: 1, hy: 0, lift: 0, trees: [] }));
      return got;
    };
    expect(run(2.2, false)).toContain('stallHang');
    expect(run(1, false)).not.toContain('stallHang');
    expect(run(2.2, true)).not.toContain('stallHang');
  });
});

describe('debug throttle', () => {
  it('pushes the plane along its nose: faster than without', () => {
    const run = (thrust: number) => { const g = fast(); for (let i = 0; i < 90 * 2; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0, thrust }, env, 1 / 90); return g.airspeed; };
    expect(run(1)).toBeGreaterThan(run(0) + 5);
  });
});

import { sticksIn, STICK_CELL } from './sticks';
describe('sticks', () => {
  it('come from the seed: the same every time, in their cell, and not everywhere', () => {
    const a = sticksIn(7, 0, 0, 100, 100), b = sticksIn(7, 0, 0, 100, 100);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(15); expect(a.length).toBeLessThan(70);
    for (const s of a) { const [i, j] = s.key.split(',').map(Number); expect(Math.floor(s.x / STICK_CELL)).toBe(i); expect(Math.floor(s.y / STICK_CELL)).toBe(j); }
    expect(sticksIn(8, 0, 0, 100, 100)).not.toEqual(a);
  });
});

import { tunnelAt, tunnelInCell, TUNNEL_CELL } from './windtunnel';
describe('wind tunnels', () => {
  it('blow hard along their line, fade at the sides, and are fixed by the seed', () => {
    let t = null as ReturnType<typeof tunnelInCell>, i = 0;
    while (!t) t = tunnelInCell(5, i++, 0);
    const mid = tunnelAt(5, t.x, t.y), side = tunnelAt(5, t.x - Math.sin(t.angle) * 20, t.y + Math.cos(t.angle) * 20);
    expect(mid.k).toBeCloseTo(1, 1); expect(Math.hypot(mid.dx, mid.dy)).toBeCloseTo(1, 5);
    expect(side.k).toBe(0);
    expect(tunnelAt(5, t.x, t.y)).toEqual(mid);
    expect(TUNNEL_CELL).toBeGreaterThan(0);
  });
});

import { stonesIn } from './sticks';
describe('stones', () => {
  it('are fixed by the seed and different from the sticks', () => {
    const a = stonesIn(7, 0, 0, 140, 140);
    expect(a).toEqual(stonesIn(7, 0, 0, 140, 140)); expect(a.length).toBeGreaterThan(8);
    expect(a.map(s => s.x + ',' + s.y)).not.toEqual(sticksIn(7, 0, 0, 140, 140).map(s => s.x + ',' + s.y));
  });
});

import { COURSE_MAX_RATE } from './glider';
describe('past 360 degrees: the attitude and the camera course stay sane', () => {
  const D = 180 / Math.PI, wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const between = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * D;
  /** Fly for `secs`; returns the biggest turn of the nose or the plane's up between two steps (degrees), the fastest the course moved (rad/s) and how far it strayed from the start (rad). */
  const watch = (g: ReturnType<typeof newGlider>, secs: number, ctl: (t: number) => { pitch: number; roll: number; thrust?: number; aero?: boolean }) => {
    let jump = 0, rate = 0, stray = 0, flips = 0; const c0 = g.course;
    for (let i = 0; i < 90 * secs && !g.landed; i++) {
      const f = [...g.fwd], u = [...g.top], c = g.course, p = g.psi;
      stepGlider(g, { yaw: 0, aero: true, ...ctl(i / 90) }, env, 1 / 90);
      jump = Math.max(jump, between(f, g.fwd), between(u, g.top)); rate = Math.max(rate, Math.abs(g.course - c) * 90); stray = Math.max(stray, Math.abs(g.course - c0));
      if (Math.abs(wrapA(g.psi - p)) > 2) flips++;
    }
    return { jump, rate, stray, flips };
  };
  it('loop after loop: the plane never snaps round, and the course holds while the heading read-out turns over twice a loop', () => {
    const g = fast(), r = watch(g, 12, () => ({ pitch: 1, roll: 0, thrust: 0.6 }));
    expect(r.flips).toBeGreaterThanOrEqual(8);                 // (four loops or more)
    expect(r.jump).toBeLessThan(8);
    expect(r.stray).toBeLessThan(0.35);
    expect([g.nx, g.ny, g.nz, ...g.fwd, ...g.top].every(Number.isFinite)).toBe(true);
    expect(Math.abs(Math.hypot(g.wx, g.wy, g.wz) - 1)).toBeLessThan(1e-6);
  });
  it('roll after roll: it stays on its line', () => {
    const g = fast(), r = watch(g, 10.5, () => ({ pitch: 0, roll: 1 }));   // (five rolls)
    expect(r.jump).toBeLessThan(8);
    expect(Math.abs(wrapA(g.psi))).toBeLessThan(0.1);
    expect(r.stray).toBeLessThan(0.1);
  });
  it('a loop flown with a wing low does not whirl: the turns stay smooth and the course never races', () => {
    const r = watch(fast(), 8, () => ({ pitch: 1, roll: 0.15, thrust: 0.6 }));
    expect(r.jump).toBeLessThan(8);
    expect(r.rate).toBeLessThanOrEqual(COURSE_MAX_RATE + 1e-6);
  });
  it('an ordinary turn takes the course with it', () => {
    const g = newGlider(0, 0, 0, 200); let worst = 0;
    for (let i = 0; i < 90 * 8; i++) { stepGlider(g, { pitch: 0.4, roll: g.phi < 1 ? 1 : 0, yaw: 0 }, env, 1 / 90); worst = Math.max(worst, Math.abs(wrapA(g.course - g.psi))); }
    expect(Math.abs(g.psi)).toBeGreaterThan(Math.PI * 2);      // (more than once round)
    expect(worst).toBeLessThan(0.25);
  });
  it('half a loop flown out the other way (an Immelman) brings the course round once', () => {
    const g = fast(); g.vx = 20; let ph = 0;
    const r = watch(g, 6, () => { if (ph === 0 && Math.cos(g.psi) < -0.5 && g.gamma < 0.2) ph = 1; if (ph === 1 && Math.abs(g.phi) < 0.3) ph = 2; return ph === 0 ? { pitch: 1, roll: 0 } : ph === 1 ? { pitch: 0, roll: 1 } : { pitch: 0, roll: 0 }; });
    expect(ph).toBe(2);
    expect(Math.abs(wrapA(g.course - g.psi))).toBeLessThan(0.2);
    expect(Math.cos(g.course)).toBeLessThan(-0.7);
    expect(r.rate).toBeLessThanOrEqual(COURSE_MAX_RATE + 1e-6);
  });
  it('a push lifts the other way, so an outside loop can be flown', () => {
    const g = fast(); let lo = 0;
    for (let i = 0; i < 110; i++) { stepGlider(g, { pitch: -1, roll: 0, yaw: 0, aero: true }, env, 1 / 90); lo = Math.min(lo, g.load); }
    expect(lo).toBeLessThan(-1);
    expect(g.alpha).toBeLessThan(-0.08);
    expect(g.alpha).toBeGreaterThan(-0.2);                     // (about half of what a full pull asks of the wing)
  });
  it('at speed a held pull does not stall the wing; slow, it still can', () => {
    const g = fast(); let stalledFast = false;
    for (let i = 0; i < 45; i++) { stepGlider(g, { pitch: 1, roll: 0, yaw: 0, aero: true }, env, 1 / 90); if (g.stalled && g.airspeed > 8) stalledFast = true; }
    expect(stalledFast).toBe(false);
    const s = newGlider(0, 0, 0, 200); let stalled = false;
    for (let i = 0; i < 90 * 6; i++) { stepGlider(s, { pitch: 1, roll: 0, yaw: 0, aero: true }, env, 1 / 90); if (s.stalled) stalled = true; }
    expect(stalled).toBe(true);
  });
});
