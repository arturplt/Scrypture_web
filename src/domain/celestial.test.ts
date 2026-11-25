import { describe, it, expect, afterEach } from 'vitest';
import { YEAR_DAYS, MONTH_DAYS, MOON_INCL, spinAngle, sunInertial, moonInertial, moonLit, toLocal, localHour, shiftToHour, skyAt, POLE } from './celestial';
import { CUBE_N, FACES, eyeFrame, setCubeSize } from './cube';

afterEach(() => setCubeSize(null));
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
/** The eye frame at the middle of a face (net point). */
function faceEye(fi: number) {
  setCubeSize(CUBE_N);
  const F = FACES[fi], fr = eyeFrame(F.ix * CUBE_N, F.iy * CUBE_N);
  if (!fr) throw new Error('no frame');
  return fr;
}
const dayLen = (up: ArrayLike<number>) => {   // days of the sun being up, over one day, from 1/1440 steps
  let n = 0; const steps = 1440;
  for (let i = 0; i < steps; i++) if (localHour(i / steps, up) > 6 && localHour(i / steps, up) < 18) n++;
  return n / steps;
};

describe('the planet and its sun', () => {
  it('turns once and a bit a day, so the SOLAR day is exactly one', () => {
    const up = faceEye(0).up;
    for (const t of [0, 3.3, 10.7]) expect(localHour(t + 1, up)).toBeCloseTo(localHour(t, up), 9);
    expect(spinAngle(1)).toBeCloseTo(Math.PI * 2 * (1 + 1 / YEAR_DAYS), 12);
  });
  it('has the local hour 12 when the sun is straight over the place, 6 and 18 on the horizon', () => {
    for (let fi = 0; fi < 6; fi++) {
      const fr = faceEye(fi);
      for (const t of [0, 1.234, 7.7]) {
        const h0 = localHour(t, fr.up);
        const noon = t + (12 - h0 + 24) % 24 / 24;
        const sunNoon = toLocal(sunInertial(noon), noon, fr), upNoon = -sunNoon[2];
        const sunRise = ((): number => { const tr = noon - 0.25; return -toLocal(sunInertial(tr), tr, fr)[2]; })();
        expect(upNoon).toBeGreaterThan(0.5);
        expect(sunRise).toBeCloseTo(0, 1);   // (the sun's own motion in a quarter day is a few degrees: near enough to the horizon)
      }
    }
  });
  it('rises on one side and sets on the other, and the day is twelve hours long at every place', () => {
    for (let fi = 0; fi < 6; fi++) {
      const fr = faceEye(fi);
      expect(dayLen(fr.up)).toBeCloseTo(0.5, 1);
      const t0 = shiftToHour(0, fr.up, 5.9, true), t1 = shiftToHour(0, fr.up, 6.1, true), t2 = shiftToHour(0, fr.up, 17.9, true);
      const rise = toLocal(sunInertial(t1), t1, fr), before = toLocal(sunInertial(t0), t0, fr), set = toLocal(sunInertial(t2), t2, fr);
      expect(before[2]).toBeGreaterThan(0);   // below the horizon (z is down)
      expect(rise[2]).toBeLessThan(0);
      expect(Math.sign(rise[0] * set[0]) < 0 || Math.sign(rise[1] * set[1]) < 0).toBe(true);   // (the opposite side of the sky)
    }
  });
  it('rises on the chart\'s east where the chart runs east on the sphere (the front face)', () => {
    const fr = faceEye(0), t = shiftToHour(0, fr.up, 6.5, true);
    expect(toLocal(sunInertial(t), t, fr)[0]).toBeGreaterThan(0.3);
  });
  it('comes back after a year, and a different place has a different hour at one instant', () => {
    const a = sunInertial(0), b = sunInertial(YEAR_DAYS);
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i], 9);
    const f0 = faceEye(0), f2 = faceEye(2);
    const d = (localHour(0.37, f0.up) - localHour(0.37, f2.up) + 24) % 24;
    expect(Math.min(d, 24 - d)).toBeGreaterThan(5);   // (opposite faces: about half a day apart)
  });
  it('shifts the clock to an hour, both ways, and never to a negative time when asked to go forward', () => {
    const up = faceEye(1).up;
    for (const h of [0, 5.5, 12, 23.9]) {
      const t = shiftToHour(2.3, up, h);
      expect(localHour(t, up)).toBeCloseTo(h, 6);
      expect(Math.abs(t - 2.3)).toBeLessThanOrEqual(0.5 + 1e-9);
      const f = shiftToHour(0, up, h, true);
      expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1);
      expect(localHour(f, up)).toBeCloseTo(h, 6);
    }
    expect(shiftToHour(0.1, up, 12)).toBeGreaterThanOrEqual(0);
  });
});

describe('the moon', () => {
  it('is new at day 0, full two days on, and back to new after a month', () => {
    expect(moonLit(0)).toBeLessThan(0.01);
    expect(moonLit(MONTH_DAYS / 2)).toBeGreaterThan(0.99);
    expect(moonLit(MONTH_DAYS)).toBeCloseTo(moonLit(0), 9);
    expect(moonLit(MONTH_DAYS / 4)).toBeCloseTo(0.5, 1);   // a quarter moon
    for (let t = 0; t < 40; t += 0.37) { const k = moonLit(t); expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(1); }
  });
  it('keeps off the sun at new moon (no eclipse) in every month of the year', () => {
    for (let m = 0; m < YEAR_DAYS / MONTH_DAYS * 4; m++) {
      const t = m * MONTH_DAYS, s = sunInertial(t), q = moonInertial(t);
      expect(angle(s, q)).toBeCloseTo(MOON_INCL, 6);
      const u = t + MONTH_DAYS / 2, away = angle(sunInertial(u), moonInertial(u));
      expect(Math.PI - away).toBeCloseTo(MOON_INCL, 6);
    }
    for (const t of [0.1, 5.5, 13.2]) { const q = moonInertial(t); expect(Math.hypot(q[0], q[1], q[2])).toBeCloseTo(1, 12); }
  });
  it('goes round once a month against the sun, to the east of it after new moon', () => {
    const t = 0.25;   // a little after new moon
    const s = sunInertial(t), q = moonInertial(t);
    const east = [POLE[1] * s[2] - POLE[2] * s[1], POLE[2] * s[0] - POLE[0] * s[2], POLE[0] * s[1] - POLE[1] * s[0]];
    expect(dot(q, east)).toBeGreaterThan(0);
  });
  it('is handed to the renderer as a unit frame at right angles to the moon', () => {
    const fr = faceEye(0);
    for (const t of [0, 0.7, 2.2, 3.9, 11]) {
      const k = skyAt(t, fr);
      for (const v of [k.sun, k.moon, k.moonRt, k.moonUp]) expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 9);
      expect(dot(k.moonRt, k.moon)).toBeCloseTo(0, 9); expect(dot(k.moonUp, k.moon)).toBeCloseTo(0, 9); expect(dot(k.moonRt, k.moonUp)).toBeCloseTo(0, 9);
      expect(k.moonK).toBeCloseTo(moonLit(t), 12);
    }
  });
});
