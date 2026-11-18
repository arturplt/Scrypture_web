import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TARGETS, FIELD, FIELD_H, FIELD_W, THROWER, THROWS_PER_LEVEL, TARGET_SIZE,
  accuracyBonus, calculateRewards, canThrow, comboBonus, createTarget, distanceBonus, generateLevel, initGame, isGameOver, isLevelComplete,
  launchVelocity, moveTarget, movementPool, recordGame, emptyRockSave, rockHitsTarget, sanitizeRockSave, setAngle, setPower, step, summarize,
  targetSpeed, speedBonus, throwRock, totalScore, trajectory, isConditionMet, achievementProgress, initialStats, type GameState, type Movement, type Target,
} from './index';

/** Deterministic rng (mulberry32). */
const seeded = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const still = (g: GameState): GameState => ({ ...g, targets: g.targets.map(t => ({ ...t, movement: 'STATIC' as Movement })) });
/** Only this target is in play (the step tops the field back up to three afterwards), so other targets cannot intercept a test shot. */
const put = (g: GameState, t: Partial<Target>): GameState => ({ ...g, targets: [{ ...g.targets[0], movement: 'STATIC' as Movement, ...t }] });

describe('scoring tables', () => {
  it('distance bonus grows with range', () => {
    expect(distanceBonus(100)).toBe(1);
    expect(distanceBonus(750)).toBeCloseTo(1.25);
    expect(distanceBonus(1000)).toBeCloseTo(1.5);
    expect(distanceBonus(5000)).toBe(2);
  });
  it('accuracy bonus rewards a centred shot', () => {
    expect(accuracyBonus(0, 50)).toBe(2);
    expect(accuracyBonus(10, 50)).toBe(1.5);
    expect(accuracyBonus(25, 50)).toBe(1.2);
    expect(accuracyBonus(50, 50)).toBe(1);
  });
  it('combo bonus steps up to x1.5', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(comboBonus)).toEqual([1, 1, 1.1, 1.2, 1.4, 1.5, 1.5]);
  });
  it('total score truncates', () => { expect(totalScore(10, [1.25, 1.2, 1.1])).toBe(16); expect(totalScore(5, [1])).toBe(5); });
});

describe('rewards', () => {
  it('xp = score/10 + level*10 + targets*2', () => { expect(calculateRewards(1234, 3, 12, 'ARCADE').xp).toBe(123 + 30 + 24); });
  it('stat points split 40/30/30 and practice earns half', () => {
    expect(calculateRewards(1000, 1, 0, 'ARCADE')).toMatchObject({ body: 8, mind: 6, soul: 6 });
    expect(calculateRewards(1000, 1, 0, 'PRACTICE')).toMatchObject({ body: 4, mind: 3, soul: 3 });
  });
  it('item drops: bcoin at 1000, stone at level 5, more at 10', () => {
    expect(calculateRewards(999, 1, 0, 'ARCADE').items).toEqual([]);
    expect(calculateRewards(1000, 5, 0, 'ARCADE').items).toEqual(['bcoin', 'stone', 'hay']);
    expect(calculateRewards(2500, 10, 0, 'ARCADE').items).toEqual(['bcoin', 'stone', 'hay']);
    expect(calculateRewards(0, 3, 0, 'ARCADE').items).toEqual(['hay']);
    expect(calculateRewards(0, 1, 15, 'ARCADE').items).toEqual(['stick']);
    expect(calculateRewards(0, 4, 0, 'TIMETRIAL').items).toEqual(['hay', 'berry']);
    expect(calculateRewards(0, 4, 0, 'ARCADE').items).toEqual(['hay']);
  });
});

describe('level generation', () => {
  it('level 1 is static, from level 2 targets move, speed is capped', () => {
    expect(movementPool(1)).toEqual(['STATIC']);
    expect(new Set(movementPool(2))).toEqual(new Set(['HORIZONTAL', 'VERTICAL']));
    expect(movementPool(8)).toContain('ZIGZAG');
    expect([1, 2, 3, 6, 20].map(targetSpeed)).toEqual([0, 80, 140, 320 > 250 ? 250 : 320, 250]);
  });
  it('makes 3 targets on level 1 (2 medium + 1 large) and more later', () => {
    const l1 = generateLevel(1, 0, 1, seeded(1));
    expect(l1.map(t => t.kind).sort()).toEqual(['LARGE', 'MEDIUM', 'MEDIUM']);
    expect(generateLevel(6, 0, 1, seeded(1))).toHaveLength(6);
  });
  it('spawns targets inside the field, right of and above the thrower', () => {
    const rng = seeded(7);
    for (let level = 1; level <= 12; level++) for (const kind of ['SMALL', 'MEDIUM', 'LARGE'] as const) for (let i = 0; i < 20; i++) {
      const t = createTarget(1, kind, level, 0, rng), h = TARGET_SIZE[kind] / 2;
      if (t.movement === 'TELEPORT') { t.teleport.forEach(p => { expect(p.x).toBeGreaterThan(THROWER.x); expect(p.y).toBeLessThan(THROWER.y); }); continue; }
      expect(t.x - h).toBeGreaterThan(THROWER.x); expect(t.x + h).toBeLessThan(FIELD_W); expect(t.y - h).toBeGreaterThanOrEqual(0); expect(t.y + h).toBeLessThan(THROWER.y);
    }
  });
});

describe('target movement', () => {
  const kinds: Movement[] = ['HORIZONTAL', 'VERTICAL', 'BOUNCING', 'CIRCULAR', 'WANDER', 'TELEPORT', 'FIGURE_EIGHT', 'SINE_WAVE', 'ZIGZAG', 'SPEED_CHANGER', 'PENDULUM'];
  it('every pattern stays on the field and keeps numbers finite for 30 s', () => {
    for (const m of kinds) for (let seed = 1; seed <= 3; seed++) {
      const rng = seeded(seed * 31 + m.length);
      let t: Target | null = null;
      for (let tries = 0; tries < 500 && !t; tries++) { const c = createTarget(1, 'MEDIUM', m === 'SINE_WAVE' || m === 'PENDULUM' ? 6 : 9, 0, rng); if (c.movement === m) t = c; }
      expect(t, m).not.toBeNull();
      let cur = t!, now = 0;
      for (let f = 0; f < 1800; f++) {
        now += 16; cur = moveTarget(cur, 1 / 60, now, rng);
        const h = cur.size / 2;
        expect(Number.isFinite(cur.x) && Number.isFinite(cur.y), `${m} finite`).toBe(true);
        expect(cur.x - h, m).toBeGreaterThanOrEqual(-0.001); expect(cur.x + h, m).toBeLessThanOrEqual(FIELD_W + 0.001);
        expect(cur.y - h, m).toBeGreaterThanOrEqual(-0.001); expect(cur.y + h, m).toBeLessThanOrEqual(FIELD_H + 0.001);
      }
    }
  });
  it('horizontal targets turn around at the wall', () => {
    const t = { ...createTarget(1, 'MEDIUM', 2, 0, seeded(1)), movement: 'HORIZONTAL' as const, x: FIELD_W - 49, dx: 1, speed: 200 };
    const m = moveTarget(t, 0.1, 0, seeded(1));
    expect(m.x).toBe(FIELD_W - 48); expect(m.dx).toBe(-1);
  });
  it('teleporters hop to the next point each second', () => {
    const rng = seeded(3);
    let t: Target | null = null; for (let i = 0; i < 500 && !t; i++) { const c = createTarget(1, 'SMALL', 9, 1000, rng); if (c.movement === 'TELEPORT') t = c; }
    const a = moveTarget(t!, 0.016, 1500, rng); expect(a.x).toBe(t!.teleport[0].x);
    const b = moveTarget(a, 0.016, 2100, rng); expect(b.x).toBe(t!.teleport[1].x); expect(b.dx).toBe(1);
  });
  it('static and hit targets never move', () => {
    const t = createTarget(1, 'LARGE', 1, 0, seeded(1));
    expect(moveTarget(t, 0.1, 0, seeded(1))).toBe(t);
    const hit = { ...t, movement: 'BOUNCING' as const, hit: true }; expect(moveTarget(hit, 0.1, 0, seeded(1))).toBe(hit);
  });
});

describe('throwing', () => {
  it('launch velocity follows angle and power', () => {
    const v = launchVelocity(90, 1); expect(v.vx).toBeCloseTo(0, 5); expect(v.vy).toBeCloseTo(-1500);
    const w = launchVelocity(0, 0.5); expect(w.vx).toBeCloseTo(750); expect(w.vy).toBeCloseTo(0);
  });
  it('clamps aim', () => {
    const g = initGame('ARCADE', 0, seeded(1));
    expect(setPower(g, 3).power).toBe(1); expect(setPower(g, -1).power).toBe(0); expect(setAngle(g, 200).angle).toBe(90); expect(setAngle(g, -5).angle).toBe(0);
  });
  it('uses a throw, resets power and cannot throw with none left', () => {
    let g = setPower(initGame('ARCADE', 0, seeded(1)), 0.8);
    g = throwRock(g);
    expect(g.rocks).toHaveLength(1); expect(g.throwsRemaining).toBe(THROWS_PER_LEVEL - 1); expect(g.power).toBe(0); expect(g.throwsMade).toBe(1);
    expect(canThrow({ ...g, throwsRemaining: 0 })).toBe(false);
    expect(throwRock({ ...g, throwsRemaining: 0 }).rocks).toHaveLength(1);
    expect(throwRock({ ...g, paused: true }).rocks).toHaveLength(1);
  });
  it('practice has unlimited throws', () => {
    let g = initGame('PRACTICE', 0, seeded(1));
    for (let i = 0; i < 20; i++) g = throwRock(setPower(g, 0.5));
    expect(g.throwsRemaining).toBe(Infinity); expect(isGameOver(g)).toBe(false);
  });
  it('trajectory starts at the thrower and falls back down', () => {
    const tr = trajectory(45, 0.8); expect(tr[0]).toEqual(THROWER); expect(tr.length).toBeGreaterThan(10);
    expect(Math.max(...tr.map(p => THROWER.y - p.y))).toBeGreaterThan(50);
  });
  it('collision uses the rock radius around the target square', () => {
    const t = { ...createTarget(1, 'MEDIUM', 1, 0, seeded(1)), x: 500, y: 300 };
    expect(rockHitsTarget({ x: 500, y: 300 }, t)).toBe(true);
    expect(rockHitsTarget({ x: 500 + 48 + 7, y: 300 }, t)).toBe(true);
    expect(rockHitsTarget({ x: 500 + 48 + 9, y: 300 }, t)).toBe(false);
  });
});

describe('step', () => {
  const aimedAt = (t: { x: number; y: number }): GameState => {
    // find angle/power that lands on the target by searching the preview trajectory (what a player does by eye)
    let best = { angle: 45, power: 0.8, d: Infinity };
    for (let a = 5; a <= 85; a += 1) for (let p = 0.3; p <= 1; p += 0.01) {
      const d = Math.min(...trajectory(a, p, 400).map(q => Math.hypot(q.x - t.x, q.y - t.y)));
      if (d < best.d) best = { angle: a, power: p, d };
    }
    return setPower(setAngle(initGame('ARCADE', 0, seeded(1)), best.angle), best.power);
  };

  it('a rock thrown at a target hits it: scores, counts, combo and replaces the target', () => {
    let g = still(aimedAt({ x: 700, y: 400 }));
    g = put(g, { x: 700, y: 400 });
    g = throwRock(g);
    let hits = 0, now = 0;
    for (let f = 0; f < 600 && hits === 0; f++) { now += 16; const r = step(g, 1 / 60, now, seeded(f)); g = r.state; hits += r.hits.length; }
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(g.score).toBeGreaterThan(0); expect(g.targetsHit).toBe(hits); expect(g.combo).toBe(hits);
    expect(g.targets.filter(t => !t.hit)).toHaveLength(ACTIVE_TARGETS);
  });
  it('a long frame cannot skip over a small target (sub-stepping)', () => {
    let g = initGame('ARCADE', 0, seeded(1));
    g = put(g, { x: 500, y: THROWER.y, size: 48, kind: 'SMALL', movement: 'STATIC' });
    g = { ...g, rocks: [{ id: 99, x: 400, y: THROWER.y, vx: 1500, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] }] };
    const r = step(g, 0.1, 0, seeded(1));       // would move 150 px in one go; the target is 48 wide
    expect(r.hits).toHaveLength(1);
  });
  it('a bullseye needs the shot to pass through the centre', () => {
    const base = put(initGame('ARCADE', 0, seeded(1)), { x: 600, y: 500, size: 96, kind: 'MEDIUM', movement: 'STATIC' });
    const rock = (y: number) => ({ id: 9, x: 400, y, vx: 1500, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] });
    const centred = step({ ...base, rocks: [rock(491.3)] }, 0.1, 0, seeded(1)); expect(centred.hits[0].bullseye).toBe(true); expect(centred.state.bullseyes).toBe(1);
    const edge = step({ ...base, rocks: [rock(540)] }, 0.1, 0, seeded(1)); expect(edge.hits[0].bullseye).toBe(false);
    expect(centred.hits[0].points).toBeGreaterThan(edge.hits[0].points);
  });
  it('a rock that misses everything breaks the combo and counts as a miss', () => {
    let g = initGame('ARCADE', 0, seeded(1));
    g = still({ ...g, combo: 4, longestCombo: 4, rocks: [{ id: 9, x: FIELD_W + 95, y: 100, vx: 1000, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] }] });
    const r = step(g, 0.016, 0, seeded(1));
    expect(r.state.rocks).toHaveLength(0); expect(r.state.combo).toBe(0); expect(r.state.levelMisses).toBe(1); expect(r.state.longestCombo).toBe(4);
  });
  it('game is over when the last throw has landed', () => {
    let g = initGame('ARCADE', 0, seeded(1));
    expect(isGameOver({ ...g, throwsRemaining: 0, rocks: [{ id: 1, x: 0, y: 0, vx: 0, vy: 0, angle: 0, power: 0, active: true, hits: 0, trail: [] }] })).toBe(false);
    expect(isGameOver({ ...g, throwsRemaining: 0 })).toBe(true);
    expect(isGameOver(g)).toBe(false);
  });
  it('hitting enough targets advances the level, refills throws, and records a fast and perfect level', () => {
    let g = still(initGame('ARCADE', 0, seeded(1)));
    g = { ...g, targetsHit: 3, throwsRemaining: 2, clock: 10, levelStart: 0 };
    g = put(g, { x: 600, y: 500, size: 96, kind: 'MEDIUM' });
    g = { ...g, rocks: [{ id: 9, x: 400, y: 500, vx: 1500, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] }] };
    const r = step(g, 0.1, 0, seeded(1));
    expect(r.levelUp).toBe(2); expect(r.state.level).toBe(2); expect(r.state.throwsRemaining).toBe(THROWS_PER_LEVEL); expect(r.state.rocks).toHaveLength(0);
    expect(r.state.fastLevel).toBe(true); expect(r.state.perfectLevel).toBe(true); expect(r.state.combo).toBe(0);
  });
  it('a slow level is not "fast"', () => {
    let g = still(initGame('ARCADE', 0, seeded(1)));
    g = { ...g, targetsHit: 3, clock: 40, levelStart: 0, levelMisses: 1 };
    g = put(g, { x: 600, y: 500, size: 96, kind: 'MEDIUM' });
    g = { ...g, rocks: [{ id: 9, x: 400, y: 500, vx: 1500, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] }] };
    const r = step(g, 0.1, 0, seeded(1));
    expect(r.state.level).toBe(2); expect(r.state.fastLevel).toBe(false); expect(r.state.perfectLevel).toBe(false);
  });
  it('paused games do not move', () => {
    const g = { ...initGame('ARCADE', 0, seeded(1)), paused: true };
    expect(step(g, 0.1, 0, seeded(1)).state).toBe(g);
  });
  it('a far hit is flagged for Distance King', () => {
    let g = put(initGame('ARCADE', 0, seeded(1)), { x: 1000, y: 150, size: 96, kind: 'MEDIUM', movement: 'STATIC' });
    g = { ...g, rocks: [{ id: 9, x: 900, y: 150, vx: 1500, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] }] };
    const r = step(g, 0.1, 0, seeded(1));
    expect(r.state.farHit).toBe(true);
  });
  it('level completion needs 4 hits per level number', () => {
    const g = initGame('ARCADE', 0, seeded(1));
    expect(isLevelComplete({ ...g, targetsHit: 3 })).toBe(false); expect(isLevelComplete({ ...g, targetsHit: 4 })).toBe(true);
    expect(isLevelComplete({ ...g, level: 2, targetsHit: 7 })).toBe(false); expect(isLevelComplete({ ...g, level: 2, targetsHit: 8 })).toBe(true);
  });
  it('the field is Android\'s; the web thrower stands lower (in the meadow of the pen): x as on Android, y at 0.73 of the height instead of 0.63', () => { expect(THROWER).toEqual({ x: 129.6, y: 876 }); expect(FIELD).toEqual({ left: 0, top: 0, right: 1080, bottom: 1200 }); });
});

describe('saved progress', () => {
  const result = (over: object = {}) => ({ ...summarize(initGame('ARCADE', 0, seeded(1))), score: 500, level: 2, targetsHit: 6, throws: 8, longestCombo: 3, bullseyes: 2, ...over });
  it('records stats and keeps the best scores first', () => {
    let save = emptyRockSave();
    save = recordGame(save, result({ score: 300 }), 'a', 1);
    save = recordGame(save, result({ score: 900, level: 4, longestCombo: 6 }), 'b', 2);
    save = recordGame(save, result({ score: 600 }), 'c', 3);
    expect(save.sessions.map(s => s.id)).toEqual(['b', 'c', 'a']);
    expect(save.stats).toMatchObject({ gamesPlayed: 3, highScore: 900, bestLevel: 4, longestCombo: 6, totalScore: 1800, bullseyes: 6, lastPlayedAt: 3 });
  });
  it('keeps only the best 50 sessions', () => {
    let save = emptyRockSave();
    for (let i = 0; i < 60; i++) save = recordGame(save, result({ score: i }), String(i), i);
    expect(save.sessions).toHaveLength(50); expect(save.sessions[0].score).toBe(59); expect(save.sessions[49].score).toBe(10);
  });
  it('sanitises garbage', () => {
    expect(sanitizeRockSave(undefined)).toEqual(emptyRockSave());
    expect(sanitizeRockSave({ stats: { highScore: 'x', gamesPlayed: -3, fastLevel: 1 }, sessions: [null, { id: 4 }, { id: 'ok', mode: 'WAT', score: 5 }] }))
      .toEqual({ stats: emptyRockSave().stats, sessions: [{ id: 'ok', mode: 'ARCADE', score: 5, level: 1, targetsHit: 0, throws: 0, at: 0 }] });
  });
});

describe('minigame achievements', () => {
  const ctx = (rock: Partial<ReturnType<typeof emptyRockSave>['stats']>) => ({ stats: initialStats(), maxHabitStreak: 0, rock: { ...emptyRockSave().stats, ...rock } });
  it('unlock from the saved stats', () => {
    expect(isConditionMet('rock_game_first', ctx({}))).toBe(false);
    expect(isConditionMet('rock_game_first', ctx({ gamesPlayed: 1 }))).toBe(true);
    expect(isConditionMet('rock_game_bullseye_10', ctx({ bullseyes: 9 }))).toBe(false);
    expect(isConditionMet('rock_game_bullseye_10', ctx({ bullseyes: 10 }))).toBe(true);
    expect(isConditionMet('rock_game_combo_10', ctx({ longestCombo: 10 }))).toBe(true);
    expect(isConditionMet('rock_game_speed_30s', ctx({ fastLevel: true }))).toBe(true);
    expect(isConditionMet('rock_game_score_1000', ctx({ highScore: 999 }))).toBe(false);
    expect(isConditionMet('rock_game_score_1000', ctx({ highScore: 1000 }))).toBe(true);
    expect(isConditionMet('rock_game_perfect_level', ctx({ perfectLevel: true }))).toBe(true);
    expect(isConditionMet('rock_game_max_distance', ctx({ farHit: true }))).toBe(true);
  });
  it('count-based ones show progress', () => {
    expect(achievementProgress('rock_game_bullseye_10', ctx({ bullseyes: 4 }))).toEqual({ current: 4, target: 10 });
    expect(achievementProgress('rock_game_score_1000', ctx({ highScore: 4000 }))).toEqual({ current: 1000, target: 1000 });
  });
});

describe('time trial', () => {
  const rng = () => 0.5;
  it('starts with 30 s, unlimited rocks, and counts down only while playing', () => {
    let s = initGame('TIMETRIAL', 0, rng);
    expect(s).toMatchObject({ timeLeft: 30, throwsRemaining: Infinity });
    s = step(s, 0.1, 0, rng).state;
    expect(s.timeLeft).toBeCloseTo(29.9);
    s = { ...s, paused: true };
    expect(step(s, 0.1, 0, rng).state.timeLeft).toBeCloseTo(29.9);
  });
  it('ends when the time is out and no rock is in the air; no throws after that', () => {
    let s = { ...initGame('TIMETRIAL', 0, rng), timeLeft: 0 };
    expect(canThrow(s)).toBe(false);
    expect(isGameOver(s)).toBe(true);
    s = { ...s, timeLeft: 5 };
    expect(isGameOver(s)).toBe(false);
  });
  it('a hit adds 3 s, and a quick hit scores more than a slow one', () => {
    const shot = (clock: number) => {
      let g = initGame('TIMETRIAL', 0, seeded(1));
      g = put(g, { x: 500, y: THROWER.y, size: 48, kind: 'SMALL', movement: 'STATIC' });
      g = { ...g, clock, rocks: [{ id: 99, x: 400, y: THROWER.y, vx: 1500, vy: 0, angle: 0, power: 1, active: true, hits: 0, trail: [] }] };
      return step(g, 0.1, 0, seeded(1));
    };
    const quick = shot(1), slow = shot(20);
    expect(quick.hits).toHaveLength(1);
    expect(quick.state.timeLeft).toBeCloseTo(30 - 0.1 + 1);
    expect(quick.state.score).toBeGreaterThan(slow.state.score);
  });
  it('speed bonus is bigger for a quick follow-up hit', () => {
    expect(speedBonus(1)).toBe(2);
    expect(speedBonus(3)).toBe(1.5);
    expect(speedBonus(6)).toBe(1.2);
    expect(speedBonus(20)).toBe(1);
  });
  it('time trial pays 1.5x the stat points of arcade', () => {
    expect(calculateRewards(1000, 1, 5, 'TIMETRIAL').body).toBeGreaterThan(calculateRewards(1000, 1, 5, 'ARCADE').body);
  });
  it('saved sessions keep their mode', () => {
    expect(sanitizeRockSave({ sessions: [{ id: 'a', mode: 'TIMETRIAL', score: 1 }] }).sessions[0].mode).toBe('TIMETRIAL');
  });
});
