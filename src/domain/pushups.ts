/**
 * Pushups mode of the exercise tracker: counting reps from the front camera's brightness (a face coming close to the
 * lens darkens the picture), a big nose button that turns a rep into a deep one, the score and what the screen says
 * to keep you going. Pure rules only: nothing here reads the clock, the camera or the store.
 */

// ---- the camera signal

export type PushupSensitivity = 'low' | 'med' | 'high';
export const PUSHUP_SENSITIVITIES: PushupSensitivity[] = ['low', 'med', 'high'];
/** A sample below `down` x the resting brightness is "down"; above `up` x it is "up" again (two levels, so noise cannot flutter between them). */
export const PUSHUP_THRESHOLDS: Record<PushupSensitivity, { down: number; up: number }> = {
  low: { down: 0.6, up: 0.8 },
  med: { down: 0.7, up: 0.86 },
  high: { down: 0.8, up: 0.92 },
};
export const PUSHUP_CALIBRATE_MS = 3000;
/** Shortest stay down that counts, and the shortest time between two reps: shadows and flicker are faster than a pushup. */
export const PUSHUP_MIN_DOWN_MS = 150, PUSHUP_MIN_GAP_MS = 600;
/** A picture darker than this (0..255) has nothing to compare against. */
export const PUSHUP_MIN_LIGHT = 12;
/** How fast the resting brightness follows slow changes of light (per sample), and the ratio above which a sample may move it. */
const FOLLOW = 0.02;
/** Staying down this long is not a pushup: the light changed. Take the picture as the new resting light. */
export const PUSHUP_MAX_DOWN_MS = 6000;

export type PushupPhase = 'calibrating' | 'up' | 'down';
export interface PushupDetector {
  phase: PushupPhase;
  startedAt: number;
  /** the resting ("up") brightness */
  baseline: number;
  /** when the current stay down began (0 while up) */
  downAt: number;
  lastRepAt: number;
  /** 0 = far, 1 = as close as a rep needs: what the signal bar shows */
  closeness: number;
  /** the picture is too dark to see anything */
  dark: boolean;
}
export const newPushupDetector = (now: number): PushupDetector => ({ phase: 'calibrating', startedAt: now, baseline: 0, downAt: 0, lastRepAt: -Infinity, closeness: 0, dark: false });

/** Feed one brightness sample (0..255). `rep` is true on the sample that finishes a pushup: down, then back up. */
export function stepPushupDetector(d: PushupDetector, luma: number, now: number, sens: PushupSensitivity = 'med'): { d: PushupDetector; rep: boolean } {
  if (d.phase === 'calibrating') {
    const baseline = d.baseline === 0 ? luma : d.baseline + (luma - d.baseline) * 0.2;
    const done = now - d.startedAt >= PUSHUP_CALIBRATE_MS;
    return { d: { ...d, baseline, phase: done ? 'up' : 'calibrating', dark: baseline < PUSHUP_MIN_LIGHT, closeness: 0 }, rep: false };
  }
  const { down, up } = PUSHUP_THRESHOLDS[sens];
  const dark = d.baseline < PUSHUP_MIN_LIGHT;
  const ratio = luma / Math.max(d.baseline, 1);
  // 0 at "as bright as resting", 1 at the "down" line
  const closeness = dark ? 0 : Math.max(0, Math.min(1, (1 - ratio) / (1 - down)));
  if (dark) return { d: { ...d, dark, closeness, baseline: d.baseline + (luma - d.baseline) * FOLLOW }, rep: false };
  if (d.phase === 'up') {
    if (ratio < down) return { d: { ...d, phase: 'down', downAt: now, closeness, dark }, rep: false };
    const baseline = ratio > (down + 1) / 2 ? d.baseline + (luma - d.baseline) * FOLLOW : d.baseline;
    return { d: { ...d, baseline, closeness, dark }, rep: false };
  }
  // down
  if (now - d.downAt >= PUSHUP_MAX_DOWN_MS) return { d: { ...d, phase: 'up', downAt: 0, baseline: luma, closeness: 0, dark }, rep: false };
  if (ratio > up) {
    const rep = now - d.downAt >= PUSHUP_MIN_DOWN_MS && now - d.lastRepAt >= PUSHUP_MIN_GAP_MS;
    return { d: { ...d, phase: 'up', downAt: 0, closeness, dark, lastRepAt: rep ? now : d.lastRepAt }, rep };
  }
  return { d: { ...d, closeness, dark }, rep: false };
}

// ---- the session: reps, deep reps, streak and score

export const PUSHUP_REP_POINTS = 10, PUSHUP_DEEP_POINTS = 10;
/** A rep that follows the one before within this long is brisk and earns a pace bonus (half a rep's points), also raised by the streak multiplier. A slower one is worth the plain 10. */
export const PUSHUP_FAST_MS = 3000, PUSHUP_PACE_POINTS = 5;
/** Reps closer together than this keep a streak going; every 5 reps of it raises the pushupMultiplier, up to x3. */
export const PUSHUP_STREAK_GAP_MS = 5000;
/** A pushupPress this soon after a counted rep, or this long before the camera noticed the motion, still belongs to that rep. */
export const PUSHUP_PRESS_AFTER_MS = 600, PUSHUP_PRESS_BEFORE_MS = 600;
/** Presses closer together than this are one touch, not two reps (a nose bouncing on the button). */
export const PUSHUP_PRESS_DEBOUNCE_MS = 400;

export interface PushupSession {
  reps: number;
  deep: number;
  score: number;
  streak: number;
  mult: number;
  lastRepAt: number;
  lastRepDeep: boolean;
  lastRepMult: number;
  /** when the camera last finished a rep, and whether a pushupPress has already made it deep */
  cameraRepAt: number;
  /** a rep counted from a pushupPress alone, still waiting to see whether the camera saw the same motion */
  buttonRepAt: number;
  /** the stay down that a pushupPress already counted, so coming back up does not count it again */
  consumedDownAt: number;
  /** the best score before this session */
  high: number;
  beaten: boolean;
}
export const newPushupSession = (high = 0): PushupSession => ({ reps: 0, deep: 0, score: 0, streak: 0, mult: 1, lastRepAt: -Infinity, lastRepDeep: false, lastRepMult: 1, cameraRepAt: -Infinity, buttonRepAt: -Infinity, consumedDownAt: -1, high, beaten: false });

export const pushupMultiplier = (streak: number) => 1 + Math.min(2, Math.floor(streak / 5));
/** The streak as it stands now: it ends when you pause too long. */
export const liveStreak = (s: PushupSession, now: number) => (now - s.lastRepAt <= PUSHUP_STREAK_GAP_MS ? s.streak : 0);

export interface PushupGain { s: PushupSession; /** points added */ points: number; /** a new rep was counted */ rep: boolean; /** an earlier rep became deep */ upgraded: boolean; /** the rep came quickly after the one before and earned the pace bonus */ fast: boolean }
const nothing = (s: PushupSession): PushupGain => ({ s, points: 0, rep: false, upgraded: false, fast: false });

function addRep(s: PushupSession, now: number, deep: boolean): PushupGain {
  const streak = now - s.lastRepAt <= PUSHUP_STREAK_GAP_MS ? s.streak + 1 : 1;
  const mult = pushupMultiplier(streak);
  const fast = now - s.lastRepAt <= PUSHUP_FAST_MS;   // (the first rep has nothing before it)
  const points = (PUSHUP_REP_POINTS + (deep ? PUSHUP_DEEP_POINTS : 0) + (fast ? PUSHUP_PACE_POINTS : 0)) * mult;
  const score = s.score + points;
  return { s: { ...s, reps: s.reps + 1, deep: s.deep + (deep ? 1 : 0), score, streak, mult, lastRepAt: now, lastRepDeep: deep, lastRepMult: mult, beaten: s.beaten || (s.high > 0 && score > s.high) }, points, rep: true, upgraded: false, fast };
}
function makeDeep(s: PushupSession): PushupGain {
  const points = PUSHUP_DEEP_POINTS * s.lastRepMult, score = s.score + points;
  return { s: { ...s, deep: s.deep + 1, score, lastRepDeep: true, beaten: s.beaten || (s.high > 0 && score > s.high) }, points, rep: false, upgraded: true, fast: false };
}

/** The camera saw a whole pushup (down and back up; `downAt` is when it went down). */
export function pushupCameraRep(s: PushupSession, now: number, downAt: number): PushupGain {
  if (s.consumedDownAt === downAt) return nothing({ ...s, consumedDownAt: -1 });   // a pushupPress already counted this one
  if (s.buttonRepAt >= downAt - PUSHUP_PRESS_BEFORE_MS && s.buttonRepAt <= now) {
    // the nose touched the button in this very motion: the pushupPress was the rep, the camera confirms it was a deep one
    const g = s.lastRepDeep && s.lastRepAt === s.buttonRepAt ? nothing(s) : makeDeep(s);
    return { ...g, s: { ...g.s, buttonRepAt: -Infinity, cameraRepAt: now } };
  }
  const g = addRep(s, now, false);
  return { ...g, s: { ...g.s, cameraRepAt: now } };
}
/** The big button was pressed. `phase` and `downAt` are the camera's view at that moment ('off' = no camera). */
export function pushupPress(s: PushupSession, now: number, phase: PushupPhase | 'off', downAt: number): PushupGain {
  // just after the camera counted a rep that was not deep yet: the same motion, make it deep
  if (s.lastRepAt === s.cameraRepAt && now - s.cameraRepAt <= PUSHUP_PRESS_AFTER_MS && !s.lastRepDeep) return makeDeep(s);
  if (now - s.lastRepAt < PUSHUP_PRESS_DEBOUNCE_MS) return nothing(s);
  if (phase === 'down') {
    if (s.consumedDownAt === downAt) return nothing(s);    // one rep per stay down
    const g = addRep(s, now, true);
    return { ...g, s: { ...g.s, consumedDownAt: downAt } };
  }
  const g = addRep(s, now, false);   // the camera saw nothing (yet): a touch is a rep all the same
  return { ...g, s: { ...g.s, buttonRepAt: now } };
}

// ---- what the screen says

export interface PushupCheer { key: string; params?: Record<string, string | number> }
const CHEERS_PLAIN = ['exPushCheerRep1', 'exPushCheerRep2', 'exPushCheerRep3', 'exPushCheerRep4'];
const NUDGES = ['exPushNudge1', 'exPushNudge2', 'exPushNudge3'];
/** Every key this module can return (a test checks each is translated). */
export const PUSHUP_KEYS = [...CHEERS_PLAIN, ...NUDGES, 'exPushCheerFirst', 'exPushCheer5', 'exPushCheer10', 'exPushCheer25', 'exPushCheerStreak', 'exPushCheerDeep', 'exPushCheerFast', 'exPushCheerHalf', 'exPushCheerBeat', 'exPushNudgeStart'];

/** The line to show after a rep (or a deep upgrade): the most special thing that just happened wins. */
export function pushupCheer(prev: PushupSession, g: PushupGain): PushupCheer {
  const s = g.s;
  if (!prev.beaten && s.beaten) return { key: 'exPushCheerBeat' };
  if (g.upgraded || (g.rep && g.s.lastRepDeep)) return { key: 'exPushCheerDeep' };
  if (s.reps === 1) return { key: 'exPushCheerFirst' };
  if (s.reps % 25 === 0) return { key: 'exPushCheer25', params: { n: s.reps } };
  if (s.reps % 10 === 0) return { key: 'exPushCheer10', params: { n: s.reps } };
  if (s.mult > prev.mult) return { key: 'exPushCheerStreak', params: { n: s.mult } };
  if (s.high > 0 && prev.score * 2 < s.high && s.score * 2 >= s.high) return { key: 'exPushCheerHalf' };
  if (s.reps % 5 === 0) return { key: 'exPushCheer5', params: { n: s.reps } };
  if (g.fast && s.reps % 2 === 0) return { key: 'exPushCheerFast' };
  return { key: CHEERS_PLAIN[s.reps % CHEERS_PLAIN.length] };
}
/** A push to keep going when nothing has happened for a while (null while you are moving along). */
export function pushupNudge(s: PushupSession, now: number, startedAt: number): PushupCheer | null {
  if (s.reps === 0) return now - startedAt >= 6000 ? { key: 'exPushNudgeStart' } : null;
  const idle = now - s.lastRepAt;
  return idle >= 8000 ? { key: NUDGES[Math.floor(idle / 8000 - 1) % NUDGES.length] } : null;
}

/** Body points for a session: the usual ones for time and sets, plus 1 per 10 reps (up to 10), since a pushup session is short. */
export const repBonusPoints = (reps: number) => Math.min(10, Math.floor(Math.max(0, reps) / 10));
