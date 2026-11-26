import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import {
  pushupSummary, PUSHUP_CALIBRATE_MS, PUSHUP_KEYS, newPushupDetector, newPushupSession, pushupBest, pushupCameraRep, pushupCheer, pushupNudge, pushupPress, repBonusPoints, stepPushupDetector, liveStreak,
  type PushupDetector, type PushupSensitivity, type PushupSession, type Workout,
} from './index';

/** Feed a list of [luma, ms since start] samples; returns the detector, each rep (with when the stay down began) and the final state. */
function run(samples: [number, number][], sens: PushupSensitivity = 'med') {
  let d: PushupDetector = newPushupDetector(0);
  const reps: { at: number; downAt: number }[] = [];
  for (const [luma, at] of samples) {
    const before = d.downAt;
    const r = stepPushupDetector(d, luma, at, sens);
    d = r.d;
    if (r.rep) reps.push({ at, downAt: before });
  }
  return { d, reps };
}
/** 15 samples a second of a constant light for `ms`, starting at `from`. */
const hold = (luma: number, from: number, ms: number): [number, number][] => Array.from({ length: Math.round(ms / 66) }, (_, i) => [luma, from + i * 66]);
const calibrated = hold(200, 0, PUSHUP_CALIBRATE_MS + 200);
const T = PUSHUP_CALIBRATE_MS + 200;

describe('pushup detector', () => {
  it('calibrates for three seconds, then counts a rep when you go down and come back up', () => {
    const { d, reps } = run([...calibrated, ...hold(60, T, 700), ...hold(200, T + 700, 700)]);
    expect(reps).toHaveLength(1);
    expect(d.phase).toBe('up');
    expect(reps[0].downAt).toBeGreaterThanOrEqual(T);
  });
  it('counts nothing while calibrating, even when it goes dark', () => {
    expect(run([...hold(200, 0, 1000), ...hold(40, 1000, 800), ...hold(200, 1800, 800)]).reps).toHaveLength(0);
  });
  it('counts a rep per down and up, with a pause between', () => {
    let at = T; const s: [number, number][] = [...calibrated];
    for (let i = 0; i < 5; i++) { s.push(...hold(50, at, 800), ...hold(200, at + 800, 800)); at += 1600; }
    expect(run(s).reps).toHaveLength(5);
  });
  it('ignores a flicker faster than a pushup', () => {
    expect(run([...calibrated, ...hold(60, T, 100), ...hold(200, T + 100, 1000)]).reps).toHaveLength(0);
  });
  it('does not count a stay down until you come back up, and does not flutter between the two lines', () => {
    const wobble: [number, number][] = [];
    for (let i = 0; i < 20; i++) wobble.push([i % 2 ? 150 : 165, T + i * 66]);   // 0.75 - 0.83 of 200: between nothing
    expect(run([...calibrated, ...wobble]).reps).toHaveLength(0);
    const { d, reps } = run([...calibrated, ...hold(60, T, 3000)]);
    expect(reps).toHaveLength(0);
    expect(d.phase).toBe('down');
  });
  it('follows a slow change of light without seeing a pushup in it', () => {
    const s: [number, number][] = [...calibrated];
    for (let i = 0; i < 450; i++) s.push([200 - i * 0.12, T + i * 66]);   // 30 seconds, down to ~27% less
    expect(run(s).reps).toHaveLength(0);
  });
  it('sensitivity moves the line', () => {
    const shallow = [...calibrated, ...hold(150, T, 700), ...hold(200, T + 700, 700)];   // 0.75 of resting
    expect(run(shallow, 'low').reps).toHaveLength(0);
    expect(run(shallow, 'med').reps).toHaveLength(0);
    expect(run(shallow, 'high').reps).toHaveLength(1);
    const deeper = [...calibrated, ...hold(130, T, 700), ...hold(200, T + 700, 700)];   // 0.65
    expect(run(deeper, 'low').reps).toHaveLength(0);
    expect(run(deeper, 'med').reps).toHaveLength(1);
  });
  it('takes a long stay down as a new resting light instead of sticking there', () => {
    const { d, reps } = run([...calibrated, ...hold(100, T, 7000), ...hold(100, T + 7000, 1000)]);
    expect(reps).toHaveLength(0);
    expect(d.phase).toBe('up');
    expect(d.baseline).toBeCloseTo(100, 0);
  });
  it('says so when it is too dark to see', () => {
    const { d, reps } = run([...hold(4, 0, PUSHUP_CALIBRATE_MS + 200), ...hold(1, T, 700), ...hold(4, T + 700, 700)]);
    expect(d.dark).toBe(true);
    expect(reps).toHaveLength(0);
  });
  it('shows how close you are, 0 to 1', () => {
    expect(run([...calibrated, ...hold(200, T, 300)]).d.closeness).toBe(0);
    expect(run([...calibrated, ...hold(100, T, 300)]).d.closeness).toBeGreaterThan(0.4);
    expect(run([...calibrated, ...hold(10, T, 300)]).d.closeness).toBe(1);
  });
});

describe('pushup score', () => {
  it('a camera rep is 10, a deep one 20', () => {
    const a = pushupCameraRep(newPushupSession(), 1000, 100);
    expect(a).toMatchObject({ points: 10, rep: true });
    const b = pushupPress(a.s, 1300, 'up', 0);   // the nose touched just after the camera saw it
    expect(b).toMatchObject({ points: 10, upgraded: true, rep: false });
    expect(b.s).toMatchObject({ reps: 1, deep: 1, score: 20 });
  });
  it('a press while the camera sees you down is a deep rep at once, and coming back up does not count it twice', () => {
    const a = pushupPress(newPushupSession(), 1000, 'down', 500);
    expect(a.s).toMatchObject({ reps: 1, deep: 1, score: 20 });
    const b = pushupCameraRep(a.s, 1600, 500);
    expect(b.s).toMatchObject({ reps: 1, deep: 1, score: 20 });
    expect(b.points).toBe(0);
    expect(pushupPress(a.s, 1800, 'down', 500).points).toBe(0);   // a second tap in the same stay down
  });
  it('a press just before the camera notices the motion joins it: one deep rep', () => {
    const a = pushupPress(newPushupSession(), 1000, 'up', 0);     // the camera is a beat late
    expect(a.s).toMatchObject({ reps: 1, deep: 1, score: 20 });   // deep at once: the touch is the proof
    const b = pushupCameraRep(a.s, 1900, 1100);
    expect(b.s).toMatchObject({ reps: 1, deep: 1, score: 20 });   // the camera confirms it and adds nothing
  });
  it('a press with no camera is a deep rep, and a bouncing nose is one rep', () => {
    const a = pushupPress(newPushupSession(), 1000, 'off', 0);
    expect(a.s).toMatchObject({ reps: 1, deep: 1, score: 20 });
    expect(pushupPress(a.s, 1200, 'off', 0).points).toBe(0);
    expect(pushupPress(a.s, 2000, 'off', 0).s.reps).toBe(2);
  });
  it('a press long after a camera rep is its own rep, not a bonus', () => {
    const a = pushupCameraRep(newPushupSession(), 1000, 100);
    const b = pushupPress(a.s, 4000, 'up', 0);
    expect(b.s).toMatchObject({ reps: 2, deep: 1 });   // the camera's rep stays a plain one, the press is a deep one of its own
  });
  it('a streak of quick reps raises the multiplier to x3; a long pause ends it', () => {
    let s: PushupSession = newPushupSession();
    const mult: number[] = [];
    for (let i = 0; i < 12; i++) { s = pushupCameraRep(s, 4000 * (i + 1), 4000 * (i + 1) - 800).s; mult.push(s.mult); }
    expect(mult).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3]);
    expect(s.score).toBe(4 * 10 + 5 * 20 + 3 * 30);
    expect(liveStreak(s, 48_000 + 1000)).toBe(12);
    expect(liveStreak(s, 48_000 + 6000)).toBe(0);
    expect(pushupCameraRep(s, 48_000 + 6000, 53_000).s.mult).toBe(1);
  });
  it('knows when the old high score is beaten, once', () => {
    let s = newPushupSession(30);
    s = pushupCameraRep(s, 1000, 200).s; s = pushupCameraRep(s, 5000, 4200).s;
    expect(s.beaten).toBe(false);
    const g = pushupCameraRep(s, 9000, 8200);   // 30 points: ties
    expect(g.s.beaten).toBe(false);
    expect(pushupCameraRep(g.s, 13_000, 12_200).s.beaten).toBe(true);
    expect(newPushupSession(0).beaten).toBe(false);
  });
  it('turns Body points up with the reps', () => {
    expect([0, 9, 10, 35, 100, 500].map(repBonusPoints)).toEqual([0, 0, 1, 3, 10, 10]);
  });
});

describe('pace', () => {
  it('a rep within 3 s of the one before earns 5 more; the first and slow ones do not', () => {
    const a = pushupCameraRep(newPushupSession(), 1000, 100);
    expect(a).toMatchObject({ points: 10, fast: false });
    const b = pushupCameraRep(a.s, 3500, 2800);   // 2.5 s later
    expect(b).toMatchObject({ points: 15, fast: true });
    const c = pushupCameraRep(b.s, 7000, 6200);   // 3.5 s later: still a streak, no pace bonus
    expect(c).toMatchObject({ points: 10, fast: false });
    expect(c.s.streak).toBe(3);
  });
  it('the pace bonus counts with a deep rep and rises with the streak multiplier', () => {
    let s = newPushupSession();
    for (let i = 0; i < 4; i++) s = pushupCameraRep(s, 1000 + i * 2000, 200 + i * 2000).s;   // 10 + 15 + 15 + 15
    expect(s.score).toBe(55);
    const g = pushupPress(s, 9000, 'down', 8500);   // the fifth, deep: (10 + 10 + 5) x 2
    expect(g).toMatchObject({ points: 50, fast: true });
  });
  it('the deep bonus added later has no pace in it', () => {
    const a = pushupCameraRep(pushupCameraRep(newPushupSession(), 1000, 100).s, 2500, 1800);
    expect(pushupPress(a.s, 2700, 'up', 0)).toMatchObject({ points: 10, upgraded: true, fast: false });
  });
});

describe('what the screen says', () => {
  const rep = (s: PushupSession, i: number) => pushupCameraRep(s, 1000 + i * 2000, 200 + i * 2000);
  it('cheers the first rep, the fives, the tens and a new high score', () => {
    let s = newPushupSession(0), keys: string[] = [];
    for (let i = 0; i < 10; i++) { const g = rep(s, i); keys.push(pushupCheer(s, g).key); s = g.s; }
    expect(keys[0]).toBe('exPushCheerFirst');
    expect(keys[4]).toBe('exPushCheerStreak');   // the fifth rep also steps the multiplier up: that is bigger news than "5"
    expect(keys[9]).toBe('exPushCheer10');
    s = newPushupSession(15);
    const first = rep(s, 0), second = rep(first.s, 1);
    expect(pushupCheer(first.s, second).key).toBe('exPushCheerBeat');
  });
  it('cheers a deep upgrade and halfway to the high score', () => {
    const s = newPushupSession(40);
    const a = pushupCameraRep(s, 1000, 200), b = pushupPress(a.s, 1200, 'up', 0);
    expect(pushupCheer(a.s, b).key).toBe('exPushCheerDeep');
    const c = pushupCameraRep(b.s, 3000, 2200);   // 30 of 40
    expect(pushupCheer(b.s, c).key).not.toBe('exPushCheerFirst');
  });
  it('cheers a rep made deep at once by pressing while down', () => {
    const g = pushupPress(newPushupSession(), 3000, 'down', 2000);
    expect(pushupCheer(newPushupSession(), g).key).toBe('exPushCheerDeep');
  });
  it('nudges after a pause, never while moving along', () => {
    const s = pushupCameraRep(newPushupSession(), 10_000, 9000).s;
    expect(pushupNudge(s, 15_000, 0)).toBeNull();
    expect(pushupNudge(s, 19_000, 0)?.key).toBe('exPushNudge1');
    expect(pushupNudge(newPushupSession(), 3000, 0)).toBeNull();
    expect(pushupNudge(newPushupSession(), 7000, 0)?.key).toBe('exPushNudgeStart');
  });
  it('has a translation for every line it can return', () => {
    for (const k of PUSHUP_KEYS) expect(en, k).toHaveProperty(k);
  });
});

describe('pushup high score', () => {
  const sess = (reps: number, score?: number, completed = true): Workout => ({ id: `p${reps}${score}`, startTime: 1, completed, pausedMs: 0, bodyPointsAwarded: 0, score, exercises: [{ id: 'e', name: 'Push-ups', type: 'BODYWEIGHT', sets: [{ id: 's', setNumber: 1, reps, completed: true }] }] });
  it('is the best score and the most reps of any finished session', () => {
    expect(pushupBest([])).toEqual({ score: 0, reps: 0 });
    expect(pushupBest([sess(20, 300), sess(35, 250), sess(50, 999, false)])).toEqual({ score: 300, reps: 35 });
  });
  it('counts a plain workout of Push-ups as reps without a score', () => {
    expect(pushupBest([sess(15, undefined)])).toEqual({ score: 0, reps: 15 });
  });
});

describe('pushup history line', () => {
  const w = (reps: number, ms: number, score?: number): Workout => ({ id: 'a', name: 'Push-ups', startTime: 0, completed: true, pausedMs: 0, duration: ms, bodyPointsAwarded: 1, score, exercises: [{ id: 'e', name: 'Push-ups', type: 'BODYWEIGHT', sets: [{ id: 's', setNumber: 1, reps, completed: true }] }] });
  it('gives reps, pace a minute and score', () => {
    expect(pushupSummary(w(35, 120_000, 520))).toEqual({ reps: 35, perMin: 18, score: 520 });
    expect(pushupSummary(w(5, 120_000, 50))).toEqual({ reps: 5, perMin: 2.5, score: 50 });
  });
  it('has no pace without a time, and is null for other workouts', () => {
    expect(pushupSummary(w(10, 0, 100))?.perMin).toBeNull();
    expect(pushupSummary(w(10, 60_000, undefined))).toBeNull();
  });
});
