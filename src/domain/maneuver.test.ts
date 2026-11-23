import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider, type GlideEnv } from './glider';
import { newTrickState, resetTricks, stepTricks } from './tricks';
import { DEFAULT_PATTERNS, PATTERN_VERSION, deleteSelected, resetPatterns, sanitize, stamped, startManeuver, stepManeuver, type Pattern } from './maneuver';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };

/** Fly a pattern headless; returns the glider, how long it took and the extremes met on the way. */
function fly(p: Pattern, z = 150, heading = 0.4) {
  const g = newGlider(0, 0, heading, z);
  for (let i = 0; i < 60 * 4; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);   // settle at trim
  const m = startManeuver(p, g);
  let t = 0, done = false, nan = false, minZ = 1e9, maxLoad = 0, psiTurn = 0, lastPsi = g.psi, minNz = 1;
  for (; t < 60 * 40; t++) {
    const c = stepManeuver(m, g, 1 / 60);
    if (!c) { done = true; break; }
    stepGlider(g, { pitch: c.pitch, roll: c.roll, yaw: c.yaw, aero: c.aero }, still, 1 / 60);
    if (!Number.isFinite(g.x + g.y + g.z + g.psi + g.phi)) nan = true;
    minZ = Math.min(minZ, g.z); maxLoad = Math.max(maxLoad, g.load); minNz = Math.min(minNz, g.nz);
    psiTurn += Math.atan2(Math.sin(g.psi - lastPsi), Math.cos(g.psi - lastPsi)); lastPsi = g.psi;
    if (g.landed) break;
  }
  return { g, m, secs: t / 60, done, nan, minZ, maxLoad, psiTurn, minNz, startPsi: heading };
}
const byName = (n: string) => DEFAULT_PATTERNS.find(p => p.name === n)!;

describe('flight patterns', () => {
  for (const p of DEFAULT_PATTERNS) {
    it(`${p.name} finishes, upright and level, without NaN or hitting the ground`, () => {
      const r = fly(p);
      expect(r.nan).toBe(false); expect(r.done).toBe(true); expect(r.g.landed).toBe(false);
      expect(Math.abs(r.g.phi)).toBeLessThan(0.4); expect(r.g.nz).toBeGreaterThan(0.6);
      expect(r.secs).toBeLessThan(30);
    });
  }
  it('Circle comes back to the heading it started on (within 25 degrees)', () => {
    const r = fly(byName('Circle'));
    expect(Math.abs(Math.abs(r.psiTurn) - 2 * Math.PI)).toBeLessThan(0.45);
  });
  it('Figure 8 turns both ways', () => {
    const r = fly(byName('Figure 8'));
    expect(Math.abs(r.psiTurn)).toBeLessThan(0.6);
  });
  it('Loop goes over the top and ends on the same heading, Immelman ends reversed', () => {
    const l = fly(byName('Loop')); expect(l.minNz).toBeLessThan(-0.8);
    const dl = Math.abs(Math.atan2(Math.sin(l.g.psi - l.startPsi), Math.cos(l.g.psi - l.startPsi))); expect(dl).toBeLessThan(0.6);
    const im = fly(byName('Immelman'));
    const di = Math.abs(Math.atan2(Math.sin(im.g.psi - im.startPsi), Math.cos(im.g.psi - im.startPsi))); expect(di).toBeGreaterThan(2.4);
  });
  it('Immelman rolls upright once (a half roll), not round and round', () => {
    const g = newGlider(0, 0, 0.4, 150); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);
    const m = startManeuver(byName('Immelman'), g); let rolled = 0;
    for (let i = 0; i < 60 * 20; i++) { const c = stepManeuver(m, g, 1 / 60); if (!c) break; stepGlider(g, { ...c }, still, 1 / 60); if (m.phase >= 2) rolled += g.rollRate / 60; }
    expect(rolled).toBeGreaterThan(2.5); expect(rolled).toBeLessThan(4.2);
  });
  it('the trick scorer recognises the patterns it flies: Immelman, Split S, Loop and Barrel roll', () => {
    for (const [name, trick] of [['Immelman', 'immelman'], ['Split S', 'splitS'], ['Loop', 'loop'], ['Barrel', 'roll']] as const) {
      const g = newGlider(0, 0, 0.4, 150); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);
      const m = startManeuver(byName(name), g), t = newTrickState(), got: string[] = [];
      for (let i = 0; i < 60 * 12; i++) { const c = stepManeuver(m, g, 1 / 60); stepGlider(g, c ? { ...c } : { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60); got.push(...stepTricks(t, g, 1 / 60)); }
      expect(got, name).toContain(trick);
    }
  });
  it('Split S ends upright, heading reversed, after one half roll and a half loop down', () => {
    const r = fly(byName('Split S'), 80);
    expect(r.done).toBe(true); expect(r.g.landed).toBe(false); expect(r.minNz).toBeLessThan(-0.5);
    const d = Math.abs(Math.atan2(Math.sin(r.g.psi - r.startPsi), Math.cos(r.g.psi - r.startPsi))); expect(d).toBeGreaterThan(2.4);
    expect(r.g.z).toBeGreaterThan(40);
  });
  it('Left 90 and Right 90 turn about a quarter turn the right way and end level', () => {
    for (const [name, sign] of [['Left 90', 1], ['Right 90', -1], ['U-turn right', -1], ['U-turn left', 1]] as const) {
      const r = fly(byName(name)), want = name.startsWith('U') ? Math.PI : Math.PI / 2;
      expect(r.done, name).toBe(true); expect(Math.sign(r.psiTurn), name).toBe(sign); expect(Math.abs(Math.abs(r.psiTurn) - want), name).toBeLessThan(0.25); expect(Math.abs(r.g.phi), name).toBeLessThan(0.2);
    }
  });
  it('Square comes back to its first heading a quarter turn at a time', () => {
    const r = fly(byName('Square')); expect(r.done).toBe(true); expect(Math.abs(Math.abs(r.psiTurn) - 2 * Math.PI)).toBeLessThan(0.7);
  });
  it('the trick scorer pays the simple turns: a 90 and a U-turn (and not a full circle)', () => {
    for (const [name, trick] of [['Left 90', 'turn90'], ['Right 90', 'turn90'], ['U-turn right', 'uTurn'], ['U-turn left', 'uTurn']] as const) {
      const g = newGlider(0, 0, 0.4, 150); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);
      const m = startManeuver(byName(name), g), t = newTrickState(), got: string[] = []; resetTricks(t, g);
      for (let i = 0; i < 60 * 14; i++) { const c = stepManeuver(m, g, 1 / 60); stepGlider(g, c ? { ...c } : { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60); got.push(...stepTricks(t, g, 1 / 60)); }
      expect(got, name).toContain(trick);
    }
    const g = newGlider(0, 0, 0.4, 150); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);
    const m = startManeuver(byName('Circle'), g), t = newTrickState(), got: string[] = []; resetTricks(t, g);
    for (let i = 0; i < 60 * 14; i++) { const c = stepManeuver(m, g, 1 / 60); stepGlider(g, c ? { ...c } : { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60); got.push(...stepTricks(t, g, 1 / 60)); }
    expect(got).not.toContain('turn90'); expect(got).not.toContain('uTurn');
  });
  it('a barrel roll holds its path: the flight path and the nose stay within 45 degrees of where the roll began, and the load stays low', () => {
    const ang = (u: number[], v: number[]) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(u[0], u[1], u[2]) * Math.hypot(v[0], v[1], v[2]))))) * 180 / Math.PI;
    for (const name of ['Barrel', 'Roll left', 'Double roll']) {
      const g = newGlider(0, 0, 0.4, 150); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);
      const m = startManeuver(byName(name), g); let u0: number[] | null = null, nose = 0, path = 0, load = 0;
      for (let i = 0; i < 60 * 20; i++) {
        const c = stepManeuver(m, g, 1 / 60); if (!c) break;
        if (m.phase === 1 && !u0) u0 = [g.vx, g.vy, g.vz];
        stepGlider(g, { ...c }, still, 1 / 60);
        if (m.phase === 1 && u0) { nose = Math.max(nose, ang([g.fwd[0], g.fwd[1], g.fwd[2]], u0)); path = Math.max(path, ang([g.vx, g.vy, g.vz], u0)); load = Math.max(load, Math.abs(g.load)); }
      }
      expect(nose, name).toBeLessThan(45); expect(path, name).toBeLessThan(45); expect(load, name).toBeLessThan(3);
      expect(Math.abs(Math.atan2(Math.sin(g.psi - 0.4), Math.cos(g.psi - 0.4))), name).toBeLessThan(0.2);   // ends on the heading it began on
    }
  });
  it('is cancelled by landing', () => {
    const g = newGlider(0, 0, 0, 1); for (let i = 0; i < 600; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60);
    expect(g.landed).toBe(true);
    expect(stepManeuver(startManeuver(byName('Loop'), g), g, 1 / 60)).toBeNull();
  });
  it('repeat flies the steps again; saved junk is cleaned up', () => {
    const r = fly({ name: 'x', repeat: 2, steps: [{ kind: 'roll', amount: 360 }] });
    expect(r.done).toBe(true); expect(r.m.rep).toBe(2);
    expect(sanitize({ patterns: [{ name: 'a', repeat: 99, steps: [{ kind: 'nope', amount: 1 }, { kind: 'loop', amount: 9999 }] }], sel: 5, v: PATTERN_VERSION })).toEqual({ patterns: [{ name: 'a', repeat: 9, steps: [{ kind: 'loop', amount: 720 }] }], sel: 0, v: PATTERN_VERSION, removed: [] });
    // a list saved before the simple moves existed gets them added, and keeps its own patterns first
    const old = sanitize({ patterns: [{ name: 'mine', repeat: 1, steps: [{ kind: 'roll', amount: 360 }] }], sel: 0 });
    expect(old.patterns[0].name).toBe('mine'); expect(old.patterns.map(p => p.name)).toContain('Left 90'); expect(old.patterns.length).toBe(DEFAULT_PATTERNS.length + 1);
    expect(sanitize('junk').patterns.length).toBe(DEFAULT_PATTERNS.length);
  });
});

describe('the pilot removes moves', () => {
  const roundTrip = (s: ReturnType<typeof resetPatterns>) => sanitize(JSON.parse(JSON.stringify(s)));
  it('a deleted built-in stays gone after the list is saved and loaded again', () => {
    let st = resetPatterns(); const name = st.patterns[3].name;
    st = { ...st, sel: 3 }; st = deleteSelected(st);
    expect(st.patterns.some(p => p.name === name)).toBe(false); expect(st.removed).toContain(name);
    expect(roundTrip(st).patterns.some(p => p.name === name)).toBe(false);
  });
  it('stays gone even when the saved list lost its version (every editor change is stamped, and removed names are not re-added)', () => {
    let st = deleteSelected({ ...resetPatterns(), sel: 0 }); const name = DEFAULT_PATTERNS[0].name;
    const noVersion = JSON.parse(JSON.stringify({ ...st, v: undefined }));   // (an old save: it would normally get the defaults back)
    expect(sanitize(noVersion).patterns.some(p => p.name === name)).toBe(false);
    expect(stamped({ ...st, v: undefined }).v).toBe(PATTERN_VERSION);
  });
  it('removing your own move does not remember a name; the last move cannot be removed; Reset brings the built-ins back', () => {
    let st = resetPatterns(); st = { ...st, patterns: [...st.patterns, { name: 'mine', repeat: 1, steps: [{ kind: 'roll', amount: 360 }] }], sel: st.patterns.length };
    const del = deleteSelected(st); expect(del.removed).toEqual([]); expect(del.patterns.length).toBe(st.patterns.length - 1);
    const one = { patterns: [st.patterns[0]], sel: 0, v: PATTERN_VERSION, removed: [] as string[] }; expect(deleteSelected(one)).toBe(one);
    expect(resetPatterns().patterns.length).toBe(DEFAULT_PATTERNS.length); expect(resetPatterns().removed).toEqual([]);
  });
});
