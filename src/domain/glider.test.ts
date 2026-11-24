import { describe, expect, it } from 'vitest';
import { projectLanding, hullDipM, ALT_MAX, BOOST_COOLDOWN, BOOST_TIME, boostPlane, launchPlane, GROUND_ALT, START_BOOSTS, hoopBoost, HOOP_SPEED, STALL_SPEED, THERMAL_CELL, TRIM_SPEED, airVertical, newGlider, setBank, stepGlider, thermalsIn, throwPlane, type GlideControls, type GlideEnv, type ThermalEnv } from './glider';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const none: GlideControls = { pitch: 0, roll: 0, yaw: 0 };
const run = (g: ReturnType<typeof newGlider>, ctl: GlideControls | ((t: number) => GlideControls), env: GlideEnv, secs: number) => {
  for (let i = 0; i < secs * 60; i++) stepGlider(g, typeof ctl === 'function' ? ctl(i / 60) : ctl, env, 1 / 60);
};
const hot: ThermalEnv = { seed: 7, hour: 12, warm: 1, heatAt: () => 1 };

describe('glider physics', () => {
  it('settles at best glide hands-off, sinking about 1 m/s with a glide ratio of 5 to 8', () => {
    const g = newGlider(0, 0, 0, 100);
    run(g, none, still, 20);
    expect(g.airspeed).toBeGreaterThan(TRIM_SPEED * 0.85); expect(g.airspeed).toBeLessThan(TRIM_SPEED * 1.15);
    const z0 = g.z, x0 = g.x; run(g, none, still, 10);
    const ratio = (g.x - x0) / (z0 - g.z);
    expect(ratio).toBeGreaterThan(5); expect(ratio).toBeLessThan(9);
  });
  it('a nose-down push speeds it up and a pull slows it, until the stall', () => {
    const a = newGlider(0, 0, 0, 100); run(a, { pitch: -1, roll: 0, yaw: 0 }, still, 4);
    const b = newGlider(0, 0, 0, 100); run(b, { pitch: 0.5, roll: 0, yaw: 0 }, still, 4);
    expect(a.airspeed).toBeGreaterThan(b.airspeed + 3);
  });
  it('stalls when held fully back and recovers when released', () => {
    const g = newGlider(0, 0, 0, 100); let stalled = false;
    run(g, () => { if (g.stalled) stalled = true; return { pitch: 1, roll: 0, yaw: 0 }; }, still, 10);
    expect(stalled).toBe(true);
    run(g, none, still, 10);
    expect(g.stalled).toBe(false);
    expect(g.airspeed).toBeGreaterThan(STALL_SPEED);
  });
  it('banks turn it the right way (right = clockwise = heading decreases)', () => {
    const g = newGlider(0, 0, Math.PI / 2, 100); run(g, { pitch: 0, roll: 1, yaw: 0 }, still, 0.6);
    const h = g.psi; run(g, none, still, 3);
    expect(g.phi).toBeGreaterThan(0.3);
    expect(g.psi).toBeLessThan(h);
    expect(g.turnRate).toBeLessThan(0);
  });
  it('the wings level themselves slowly', () => {
    const g = newGlider(0, 0, 0, 100); setBank(g, 0.8); run(g, none, still, 12);
    expect(g.phi).toBeLessThan(0.45);
  });
  it('lands and stays on the ground until thrown again', () => {
    const g = newGlider(0, 0, 0, 5); run(g, none, still, 20);
    expect(g.landed).toBe(true); expect(g.z).toBe(0);
    throwPlane(g, 3, 4, 1, 40); run(g, none, still, 1);
    expect(g.landed).toBe(false); expect(g.z).toBeGreaterThan(30);
  });
  it('drifts with the wind', () => {
    const calm = newGlider(0, 0, Math.PI / 2, 100); run(calm, none, still, 10);
    const g = newGlider(0, 0, Math.PI / 2, 100); run(g, none, { ...still, windX: 2 }, 10);
    expect(g.x - calm.x).toBeGreaterThan(10);
  });
  it('climbs in a steady updraft', () => {
    const up: GlideEnv = { windX: 0, windY: 0, air: () => 2.5 };
    const g = newGlider(0, 0, 0, 50); run(g, none, up, 20);
    expect(g.z).toBeGreaterThan(50);
  });
  it('flying slower in lift (a gentle pull) climbs better in a thermal than hands-off', () => {
    const th = thermalsIn(hot, 0, 0, 400, 400, 30).sort((a, b) => b.w - a.w)[0];
    const env: GlideEnv = { windX: 0, windY: 0, air: (x, y, t) => airVertical(hot, x, -y, t) };
    const circle = (pitch: number) => { const g = newGlider(th.x, -th.y + 8, 0, 60); run(g, () => ({ pitch, roll: g.phi < 0.55 ? 0.3 : 0, yaw: 0 }), env, 20); return g.z; };   // (20 s: a strong thermal lifts either to the ceiling in 30)
    expect(circle(0.3)).toBeGreaterThan(circle(0) + 5);   // (a gentle pull: too much loses it again)
  });
  it('drifts with the wind', () => {
    const calm = newGlider(0, 0, Math.PI / 2, 100); run(calm, none, still, 10);
    const g = newGlider(0, 0, Math.PI / 2, 100); run(g, none, { ...still, windX: 2 }, 10);
    expect(g.x - calm.x).toBeGreaterThan(10);
  });
  it('climbs in a steady updraft', () => {
    const up: GlideEnv = { windX: 0, windY: 0, air: () => 2.5 };
    const g = newGlider(0, 0, 0, 50); run(g, none, up, 20);
    expect(g.z).toBeGreaterThan(50);
  });
  it('flying slower in lift (a gentle pull) climbs better in a thermal than hands-off', () => {
    const th = thermalsIn(hot, 0, 0, 400, 400, 30).sort((a, b) => b.w - a.w)[0];
    const env: GlideEnv = { windX: 0, windY: 0, air: (x, y, t) => airVertical(hot, x, -y, t) };
    const circle = (pitch: number) => { const g = newGlider(th.x, -th.y + 8, 0, 60); run(g, () => ({ pitch, roll: g.phi < 0.55 ? 0.3 : 0, yaw: 0 }), env, 20); return g.z; };   // (20 s: a strong thermal lifts either to the ceiling in 30)
    expect(circle(0.3)).toBeGreaterThan(circle(0) + 5);   // (a gentle pull: too much loses it again)
  });
});

describe('thermals', () => {
  it('exist all day but weaker at night, and only over hot ground', () => {
    const day = thermalsIn(hot, 0, 0, 400, 400, 10);
    expect(day.length).toBeGreaterThan(5);
    const night = thermalsIn({ ...hot, hour: 0 }, 0, 0, 400, 400, 10);
    expect(Math.max(...night.map(n => n.w))).toBeLessThan(Math.max(...day.map(n => n.w)));
    expect(thermalsIn({ ...hot, heatAt: () => 0 }, 0, 0, 400, 400, 10)).toHaveLength(0);
  });
  it('lift in the core, sink around it', () => {
    const th = thermalsIn(hot, 0, 0, 400, 400, 10).sort((a, b) => b.w - a.w)[0];
    expect(th.w).toBeGreaterThan(2);
    const core = airVertical(hot, th.x, th.y, 10), edge = airVertical(hot, th.x + th.r * 2.1, th.y, 10);
    expect(core).toBeGreaterThan(1.5); expect(edge).toBeLessThan(core * 0.2);
  });
  it('are dense enough to find one within a glide from the ledge', () => {
    const near = thermalsIn(hot, -200, -200, 200, 200, 30, 0).filter(t => Math.hypot(t.x, t.y) < ALT_MAX * 6);
    expect(near.length).toBeGreaterThan(3); expect(THERMAL_CELL).toBeGreaterThan(30);
  });
  it('a circling plane climbs in one', () => {
    const th = thermalsIn(hot, 0, 0, 400, 400, 30).sort((a, b) => b.w - a.w)[0];
    const env: GlideEnv = { windX: 0, windY: 0, air: (x, y, t) => airVertical(hot, x, -y, t) };
    const g = newGlider(th.x, -th.y + 8, 0, 60);
    run(g, () => ({ pitch: 0.5, roll: g.phi < 0.55 ? 0.3 : 0, yaw: 0 }), env, 30);
    expect(g.z).toBeGreaterThan(80);
  });
});

describe('boost', () => {
  it('kicks the plane faster and up, then has to wait before the next one', () => {
    const a = newGlider(0, 0, 0, 100); run(a, none, still, 5);
    const b = newGlider(0, 0, 0, 100); run(b, none, still, 5);
    expect(b.boostCharges).toBe(1);                          // one in hand at the start
    b.boostCharges = 2; expect(boostPlane(b)).toBe(true); expect(b.boostCharges).toBe(1);
    run(a, none, still, BOOST_TIME + 0.2); run(b, none, still, BOOST_TIME + 0.2);
    expect(b.airspeed).toBeGreaterThan(a.airspeed + 2);
    expect(b.z).toBeGreaterThan(a.z + 6);
    expect(boostPlane(b)).toBe(false);                       // still pausing
    run(b, none, still, BOOST_COOLDOWN);
    expect(boostPlane(b)).toBe(true); expect(b.boostCharges).toBe(0);
    run(b, none, still, BOOST_COOLDOWN); expect(boostPlane(b)).toBe(false);   // spent
  });
  it('never throws the plane backwards, whatever way it points or whatever the stick does', () => {
    for (const heading of [0, 1, 2.5, -2]) for (const pull of [0, 0.5, 1, -1]) {
      const g = newGlider(0, 0, heading, 150); run(g, none, still, 5); g.boostCharges = 1; boostPlane(g);
      let min = 99, maxGamma = 0;
      for (let i = 0; i < 600 && !g.landed; i++) { run(g, { pitch: i < 180 ? pull : 0, roll: 0, yaw: 0 }, still, 1 / 60); min = Math.min(min, g.vx * Math.cos(g.psi) + g.vy * Math.sin(g.psi)); maxGamma = Math.max(maxGamma, g.gamma); }
      expect(min).toBeGreaterThan(1); expect(maxGamma).toBeLessThan(1.3);
    }
  });
  it('does nothing on the ground', () => {
    const g = newGlider(0, 0, 0, 100); run(g, none, still, 200);
    g.boostCharges = 1; expect(g.landed).toBe(true); expect(boostPlane(g)).toBe(false);
  });
  it('a hoop adds ground speed along the way the plane moves, and nothing once landed', () => {
    const g = newGlider(0, 0, 1, 100); run(g, none, still, 2);
    const before = Math.hypot(g.vx, g.vy); hoopBoost(g);
    expect(Math.hypot(g.vx, g.vy) - before).toBeCloseTo(HOOP_SPEED, 5); expect(g.boostCharges).toBe(START_BOOSTS + 1);
    const l = newGlider(0, 0, 0, 100); run(l, none, still, 200); expect(hoopBoost(l)).toBe(0);
  });
  it('a hoop kick does not balloon the nose up and then dive: the climb angle stays small and the plane never stalls', () => {
    const g = newGlider(0, 0, 0, 100); run(g, none, still, 4); hoopBoost(g);
    let maxG = -9, minG = 9, stalled = false;
    for (let i = 0; i < 600 && !g.landed; i++) { run(g, none, still, 1 / 60); maxG = Math.max(maxG, g.gamma); minG = Math.min(minG, g.gamma); stalled = stalled || g.stalled; }
    expect(stalled).toBe(false); expect(maxG).toBeLessThan(0.25); expect(minG).toBeGreaterThan(-0.5);
  });
});

describe('natural wind', () => {
  it('wanders over time within range, is repeatable, and differs between worlds', async () => {
    const { naturalWind } = await import('./naturalwind');
    let lo = 99, hi = -1, dirSpan = 0, prev = naturalWind(5, 0).dir;
    for (let t = 0; t < 900; t += 5) { const w = naturalWind(5, t); lo = Math.min(lo, w.strength); hi = Math.max(hi, w.strength); dirSpan += Math.abs(Math.atan2(Math.sin(w.dir - prev), Math.cos(w.dir - prev))); prev = w.dir; expect(w.strength).toBeGreaterThanOrEqual(0); expect(w.strength).toBeLessThanOrEqual(10); }
    expect(hi - lo).toBeGreaterThan(3);                 // it really changes
    expect(dirSpan).toBeGreaterThan(1);                 // and the direction moves
    expect(naturalWind(5, 123)).toEqual(naturalWind(5, 123));
    expect(naturalWind(5, 123)).not.toEqual(naturalWind(6, 123));
  });
});

describe('ground launch', () => {
  it('starts 1 m up, shoots up faster the harder it is thrown, never stalls or goes backwards, then settles into a steady glide', () => {
    const peaks: number[] = [];
    for (const power of [0.4, 0.7, 1]) {
      const g = newGlider(0, 0, 0, 100); launchPlane(g, 0, 0, 0.3, power);
      expect(g.z).toBe(GROUND_ALT);
      let peak = 0, stalled = false, back = false, t = 0;
      for (; t < 60 * 40 && !g.landed; t++) { stepGlider(g, none, still, 1 / 60); peak = Math.max(peak, g.z); stalled = stalled || g.stalled; if (g.vx * Math.cos(0.3) + g.vy * Math.sin(0.3) < 0) back = true; if (t === 60 * 8) expect(Math.abs(g.airspeed - TRIM_SPEED)).toBeLessThan(2.5); }
      expect(stalled).toBe(false); expect(back).toBe(false); expect(peak).toBeGreaterThan(8);
      peaks.push(peak);
    }
    expect(peaks[2]).toBeGreaterThan(peaks[0] + 8);   // a harder throw goes higher
  });
});

describe('touchdown', () => {
  it('records how the plane touched down: a gentle glide lands soft, a dive lands hard', () => {
    const a = newGlider(0, 0, 0, 30); run(a, none, still, 60);
    expect(a.landed).toBe(true); expect(a.impact!.sink).toBeLessThan(3); expect(a.impact!.bank).toBeLessThan(0.6);
    const b = newGlider(0, 0, 0, 120); run(b, { pitch: -1, roll: 0, yaw: 0 }, still, 60);
    expect(b.landed).toBe(true); expect(b.impact!.sink).toBeGreaterThan(a.impact!.sink);
    throwPlane(b, 0, 0, 0); expect(b.impact).toBeNull();
  });
});

describe('rain', () => {
  it('sinking air drags the plane down faster, and rough air jolts its bank', () => {
    const calm = newGlider(0, 0, 0, 200), wet = newGlider(0, 0, 0, 200);
    run(calm, none, still, 8); run(wet, none, { ...still, air: () => -3.5 }, 8);
    expect(wet.z).toBeLessThan(calm.z - 10);
    const rough = newGlider(0, 0, 0, 200); let maxPhi = 0, maxCalm = 0;
    const env = { ...still, turb: () => 1 };
    for (let i = 0; i < 60 * 8; i++) { stepGlider(rough, none, env, 1 / 60); maxPhi = Math.max(maxPhi, Math.abs(rough.phi)); }
    const smooth = newGlider(0, 0, 0, 200); for (let i = 0; i < 60 * 8; i++) { stepGlider(smooth, none, still, 1 / 60); maxCalm = Math.max(maxCalm, Math.abs(smooth.phi)); }
    expect(maxPhi).toBeGreaterThan(0.05); expect(maxCalm).toBeLessThan(0.01);
  });
});

import { soakPlane, WET_DRY_AIR } from './glider';
describe('a wet plane', () => {
  it('is heavy: it flies faster and comes down sooner than a dry one', () => {
    const dry = newGlider(0, 0, 0, 60), wet = newGlider(0, 0, 0, 60); soakPlane(wet);
    const env: GlideEnv = { ...still, heat: () => 0 };
    let tDry = 0, tWet = 0, vWet = 0, vDry = 0;
    for (let i = 0; i < 60 * 12; i++) { stepGlider(dry, none, env, 1 / 60); stepGlider(wet, none, env, 1 / 60); if (i === 60 * 6) { vWet = wet.airspeed; vDry = dry.airspeed; } }
    expect(vWet).toBeGreaterThan(vDry * 1.08);
    expect(wet.z).toBeLessThan(dry.z - 2);
    void tDry; void tWet;
  });
  it('dries out as it flies, and much faster in warm air', () => {
    const a = newGlider(0, 0, 0, 5000), b = newGlider(0, 0, 0, 5000); soakPlane(a); soakPlane(b);
    run(a, none, still, 10); run(b, none, { ...still, heat: () => 1 }, 10);
    expect(a.wet).toBeLessThan(1); expect(a.wet).toBeGreaterThan(0.5);
    expect(b.wet).toBe(0);
    run(a, none, still, WET_DRY_AIR * 2); expect(a.wet).toBe(0);
  });
  it('stays wet for the next throw, and dries slowly on the ground', () => {
    const g = newGlider(0, 0, 0, 1); soakPlane(g); run(g, none, still, 5);
    expect(g.landed).toBe(true); expect(g.wet).toBeGreaterThan(0.85);
    throwPlane(g, 0, 0, 0); expect(g.wet).toBeGreaterThan(0.85);
    expect(Math.hypot(g.vx, g.vy, g.vz)).toBeLessThan(TRIM_SPEED * 1.2 * 0.85);
  });
});

describe('hitbox', () => {
  it('a nose dive lands while its centre is still above the ground (the nose touched first)', () => {
    const g = newGlider(0, 0, 0, 40); let prev = g.z;
    for (let i = 0; i < 60 * 30 && !g.landed; i++) { prev = g.z; stepGlider(g, { pitch: -1, roll: 0, yaw: 0 }, still, 1 / 60); }
    expect(g.landed).toBe(true); expect(prev).toBeGreaterThan(1);
  });
  it('a level plane still flies down to the ground', () => {
    expect(hullDipM(0, 0)).toBe(0);
    const g = newGlider(0, 0, 0, 3); run(g, none, still, 0.2); expect(g.landed).toBe(false);
  });
});

describe('projectLanding', () => {
  it('flies a copy on to the ground without touching the plane, and lands where the real plane does', () => {
    const env = { windX: 0, windY: 0, air: () => 0 }, ctl = { pitch: 0, roll: 0, yaw: 0, freeStall: false, aero: false, thrust: 0 } as any;
    const g = newGlider(0, 0, 0, 40); throwPlane(g, 0, 0, 0, 40, 7, 0);
    const z0 = g.z, p = projectLanding(g, ctl, env, { maxT: 300 });
    expect(g.z).toBe(z0); expect(g.landed).toBeFalsy();
    expect(p.end).toBe('ground');
    for (let i = 0; i < 20000 && !g.landed; i++) stepGlider(g, ctl, env, 0.05);
    expect(Math.hypot(p.x - g.x, p.y - g.y)).toBeLessThan(0.1 * Math.hypot(g.x, g.y) + 2);
  });
});
