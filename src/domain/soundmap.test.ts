import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider, type GlideControls, type GlideEnv } from './glider';
import { airSide, ambience, soundParams } from './soundmap';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const none: GlideControls = { pitch: 0, roll: 0, yaw: 0 };
const run = (g: ReturnType<typeof newGlider>, ctl: GlideControls | ((t: number) => GlideControls), env: GlideEnv, secs: number) => {
  for (let i = 0; i < secs * 60; i++) stepGlider(g, typeof ctl === 'function' ? ctl(i / 60) : ctl, env, 1 / 60);
};

describe('soundParams', () => {
  it('has no wind or whistle on the ground', () => {
    const g = newGlider(0, 0, 0, 1); g.landed = true;
    const p = soundParams(g, still, 0);
    expect(p.windL + p.windR + p.whistle + p.rain).toBe(0);
  });
  it('wind is louder and brighter in a dive than in a glide', () => {
    const a = newGlider(0, 0, 0, 200); run(a, none, still, 8);
    const b = newGlider(0, 0, 0, 200); run(b, { pitch: -1, roll: 0, yaw: 0 }, still, 4);
    const pa = soundParams(a, still), pb = soundParams(b, still);
    expect(pb.windL + pb.windR).toBeGreaterThan(pa.windL + pa.windR);
    expect(pb.windHz).toBeGreaterThan(pa.windHz);
  });
  it('level flight with the air on the nose is even in both ears', () => {
    const g = newGlider(0, 0, 0, 200); run(g, none, still, 6);
    const p = soundParams(g, still);
    expect(Math.abs(p.windL - p.windR)).toBeLessThan(0.05);
  });
  it('a crosswind from the left is louder in the left ear, from the right in the right ear', () => {
    const g = newGlider(0, 0, 0, 200); run(g, none, still, 4);   // heading east
    // wind blowing towards the north pushes the air onto the plane's left side (east-facing, left = north)
    const fromLeft = { ...still, windY: 6 }, fromRight = { ...still, windY: -6 };
    expect(airSide(g, fromLeft)).toBeLessThan(0); expect(airSide(g, fromRight)).toBeGreaterThan(0);
    const l = soundParams(g, fromLeft), r = soundParams(g, fromRight);
    expect(l.windL).toBeGreaterThan(l.windR); expect(r.windR).toBeGreaterThan(r.windL);
  });
  it('banking right shifts the wind to the right ear', () => {
    const g = newGlider(0, 0, 0, 200); run(g, { pitch: 0, roll: 1, yaw: 0 }, still, 1);
    expect(g.phi).toBeGreaterThan(0.3);
    const p = soundParams(g, still);
    expect(p.windR).toBeGreaterThan(p.windL);
  });
  it('whistles only near the stall, and fully (with a warble) once stalled', () => {
    const g = newGlider(0, 0, 0, 300); run(g, none, still, 6);
    expect(soundParams(g, still).whistle).toBe(0);
    let max = 0, warbled = false;
    run(g, () => { const p = soundParams(g, still); max = Math.max(max, p.whistle); warbled ||= p.warble > 0; return { pitch: 1, roll: 0, yaw: 0 }; }, still, 8);
    expect(max).toBe(1); expect(warbled).toBe(true);
  });
  it('rain adds roughness and a rain bed', () => {
    const g = newGlider(0, 0, 0, 200); run(g, none, still, 4);
    const dry = soundParams(g, still, 0), wet = soundParams(g, still, 0.8);
    expect(wet.rain).toBeGreaterThan(dry.rain); expect(wet.gust).toBeGreaterThan(dry.gust);
  });
  it('shimmers only in rising air', () => {
    const g = newGlider(0, 0, 0, 100); run(g, none, still, 3);
    g.airLift = 0; expect(soundParams(g, still).lift).toBe(0);
    g.airLift = 4; expect(soundParams(g, still).lift).toBe(1);
  });
  it('flutters under heavy load, not in a calm glide', () => {
    const g = newGlider(0, 0, 0, 100); run(g, none, still, 6);
    expect(soundParams(g, still).flutter).toBeLessThan(0.1);
    g.load = 3; expect(soundParams(g, still).flutter).toBeGreaterThan(0.5);
  });
  it('muffles the mix and thins the wind up high', () => {
    const lo = newGlider(0, 0, 0, 30), hi = newGlider(0, 0, 0, 200);
    expect(soundParams(hi, still).muffle).toBe(1); expect(soundParams(lo, still).muffle).toBe(0);
  });
  it('birds by day and crickets by night, only near the ground', () => {
    expect(ambience(1, 12).birds).toBeGreaterThan(0.8); expect(ambience(1, 12).crickets).toBeLessThan(0.1);
    expect(ambience(1, 0).crickets).toBeGreaterThan(0.8); expect(ambience(1, 0).birds).toBeLessThan(0.1);
    expect(ambience(100, 12).birds).toBe(0);
  });
  it('carries the throw charge on the ground', () => {
    const g = newGlider(0, 0, 0, 1); g.landed = true;
    expect(soundParams(g, still, 0, 0, { charge: 0.6 }).charge).toBeCloseTo(0.6);
  });
});
