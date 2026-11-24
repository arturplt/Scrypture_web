import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider, type GlideEnv, type Glider } from './glider';
import { CHASE_PTS, steer, FLEE_PTS, HITS_TO_WIN, SHOT_RANGE, aimOf, endDogfight, makeShot, placeAi, shotTolerance, sliderPos, startDogfight, stepDog, tapHits, tapShot } from './dogfight';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const still: GlideEnv = { windX: 0, windY: 0, air: () => 0.9 };   // (a gentle updraft: nobody runs out of sky during a long match)
function rng(seed = 1) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A player who just glides straight (or flies a lazy circle). */
const fly = (g: Glider, circle = false) => stepGlider(g, { pitch: 0, roll: circle ? 0.25 : 0, yaw: 0 }, still, 1 / 60);

describe('aiming', () => {
  it('locks only inside the range and the cone', () => {
    const a = newGlider(0, 0, 0, 100), b = newGlider(20, 0, 0, 100);
    expect(aimOf(a, b).inCone).toBe(true);
    expect(aimOf(a, newGlider(SHOT_RANGE + 5, 0, 0, 100)).inCone).toBe(false);   // too far
    expect(aimOf(a, newGlider(0, 20, 0, 100)).inCone).toBe(false);               // off to the side
    expect(aimOf(a, newGlider(-20, 0, 0, 100)).inCone).toBe(false);              // behind
    expect(aimOf(a, newGlider(8, 0, 0, 100)).q).toBeGreaterThan(aimOf(a, newGlider(24, 0, 0, 100)).q);
  });
});

describe('the skill shot', () => {
  it('has three sliders at different paces that are all in the middle together at one moment, and not elsewhere', () => {
    const s = makeShot('you', 0.5, rng(3));
    expect(new Set(s.specs.map(x => x.period)).size).toBe(3);
    const t0 = s.specs.reduce((m, x) => m + x.centre, 0) / 3;
    expect(tapHits(s, t0)).toBe(true);
    expect(tapHits(s, t0 + 0.9)).toBe(false); expect(tapHits(s, 0.05)).toBe(false);
    expect(Math.abs(sliderPos(s.specs[0], s.specs[0].centre))).toBeLessThan(1e-9);
  });
  it('is more forgiving the better the shot is lined up', () => {
    expect(shotTolerance(1)).toBeGreaterThan(shotTolerance(0));
    for (const seed of [1, 2, 3, 4, 5]) { const s = makeShot('you', 0.5, rng(seed)), t0 = s.specs.reduce((m, x) => m + x.centre, 0) / 3; expect(tapHits(s, t0)).toBe(true); }
  });
});

/** Fly a match with a bot as the player: it chases the AI when it is the chaser and runs when it is the runner, and taps the shot at the right moment when `skilled`. */
function match(opts: { skilled: boolean; secs?: number; seed?: number; straight?: boolean }) {
  const player = newGlider(0, 0, 0.3, 150), d = startDogfight(player, 'chase'), r = rng(opts.seed ?? 7);
  for (let i = 0; i < 240; i++) fly(player);
  placeAi(d, player);
  const log: string[] = []; let minDist = 1e9, nan = false, minZ = 1e9, t = 0;
  for (; t < 60 * (opts.secs ?? 240) && d.phase !== 'over'; t++) {
    if (opts.straight) fly(player);
    else { const dx = d.ai.x - player.x, dy = d.ai.y - player.y, h = Math.atan2(dy, dx); const dist = Math.hypot(dx, dy); stepGlider(player, d.role === 'chase' ? steer(player, h, dist > 30 ? -0.25 : clamp((d.ai.z - player.z) / (dist + 10), -0.6, 0.6)) : steer(player, h + Math.PI, 0), still, 1 / 60); }
    const ev = stepDog(d, player, still, 1 / 60, r); log.push(...ev);
    if (d.phase === 'shot' && d.shot?.who === 'you' && opts.skilled) { const t0 = d.shot.specs.reduce((m, x) => m + x.centre, 0) / 3; if (d.shot.t >= t0) log.push(...tapShot(d, player)); }
    minDist = Math.min(minDist, Math.hypot(d.ai.x - player.x, d.ai.y - player.y)); minZ = Math.min(minZ, d.ai.z, player.z);
    if (!Number.isFinite(d.ai.x + d.ai.y + d.ai.z)) nan = true;
    if (player.landed) { endDogfight(d); break; }
  }
  return { d, log, minDist, nan, minZ, secs: t / 60 };
}

describe('the AI pilot', () => {
  it('as the chaser it closes on a player gliding straight and gets a lock', () => {
    const player = newGlider(0, 0, 0.3, 150), d = startDogfight(player, 'flee'), r = rng(5), log: string[] = [];
    for (let i = 0; i < 60 * 60 && d.phase !== 'over'; i++) { fly(player); log.push(...stepDog(d, player, still, 1 / 60, r)); expect(Number.isFinite(d.ai.x + d.ai.z)).toBe(true); }
    expect(log).toContain('lock'); expect(d.ai.landed).toBe(false);
  });
  it('as the runner it stays airborne, keeps away from a plain chase and never produces NaN', () => {
    const r = match({ skilled: false, secs: 60 });
    expect(r.nan).toBe(false); expect(r.minZ).toBeGreaterThan(2);
  });
});

describe('the match', () => {
  it('a skilled player scores hits, the roles swap, and it ends at the tally', () => {
    const r = match({ skilled: true, secs: 600, seed: 11 });
    expect(r.nan).toBe(false);
    expect(r.log).toContain('hit'); expect(r.log).toContain('swap');
    expect(r.d.phase).toBe('over'); expect(r.d.tally.you >= HITS_TO_WIN || r.d.tally.ai >= HITS_TO_WIN).toBe(true);
  });
  it('time fleeing pays more than time chasing', () => {
    expect(FLEE_PTS).toBeGreaterThan(CHASE_PTS * 2);
    const player = newGlider(0, 0, 0, 150), c = startDogfight(player, 'chase'), f = startDogfight(player, 'flee');
    for (let i = 0; i < 60; i++) { fly(player); stepDog(c, player, still, 1 / 60, rng(1)); stepDog(f, player, still, 1 / 60, rng(1)); }
    expect(f.score).toBeGreaterThan(c.score * 2);
  });
  it('a missed tap costs a cooldown, not a hit; a tap with no shot open does nothing; ending is final', () => {
    const player = newGlider(0, 0, 0, 150), d = startDogfight(player, 'chase');
    expect(tapShot(d, player)).toEqual([]);
    d.phase = 'shot'; d.shot = makeShot('you', 0.5, rng(1)); d.shot.t = 0.05;
    expect(tapShot(d, player)).toEqual(['miss']); expect(d.tally.you).toBe(0); expect(d.cooldown).toBeGreaterThan(0);
    endDogfight(d); expect(stepDog(d, player, still, 1 / 60)).toEqual([]);
  });
});

describe('the instrument bearing', () => {
  it('reads where the other plane is off your nose and wings', async () => {
    const { foeBearing } = await import('./dogfight');
    const me = newGlider(0, 0, 0, 100);
    const ahead = foeBearing(me, newGlider(30 * me.fwd[0], 30 * me.fwd[1], 0, 100 + 30 * me.fwd[2]));   // (the nose points a little above the horizon)
    expect(ahead.theta).toBeLessThan(0.1); expect(ahead.dist).toBeCloseTo(30, 0);
    const behind = foeBearing(me, newGlider(-30, 0, 0, 100)); expect(behind.theta).toBeGreaterThan(2.6);
    const above = foeBearing(me, newGlider(30, 0, 0, 130)); expect(above.theta).toBeGreaterThan(0.5); expect(above.phi).toBeGreaterThan(1.2); expect(above.phi).toBeLessThan(1.9);   // (up)
    const right = foeBearing(me, newGlider(0, -30, 0, 100)); expect(Math.abs(right.phi)).toBeLessThan(0.3);   // (east-facing plane: its right wing points south)
    const left = foeBearing(me, newGlider(0, 30, 0, 100)); expect(Math.abs(left.phi)).toBeGreaterThan(2.8);
  });
});
