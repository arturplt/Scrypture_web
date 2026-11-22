/**
 * Flight patterns: a chain of steps (turn, roll, loop, ...) that flies itself on one button.
 * Pure control logic: `stepManeuver` reads the glider and returns the stick (and whether the aerobatic wing is wanted), the
 * game feeds that to `stepGlider` in place of the player's hands. Progress is measured in angles flown, not seconds, so a
 * pattern adapts to speed and wind.
 */
import type { Glider } from './glider';

export type StepKind = 'turn' | 'roll' | 'loop' | 'immelman' | 'splitS' | 'level' | 'climb' | 'dive';
/** amount: degrees for turn / roll / loop (turn + roll: positive = right, negative = left), seconds for level / climb / dive, ignored for immelman and splitS. */
export interface Step { kind: StepKind; amount: number }
export interface Pattern { name: string; steps: Step[]; repeat: number }

export const STEP_KINDS: StepKind[] = ['turn', 'roll', 'loop', 'immelman', 'splitS', 'level', 'climb', 'dive'];
export const stepUnit = (k: StepKind): 'deg' | 's' | '' => (k === 'turn' || k === 'roll' || k === 'loop' ? 'deg' : k === 'level' || k === 'climb' || k === 'dive' ? 's' : '');
export const defaultStep = (kind: StepKind): Step => ({ kind, amount: kind === 'turn' ? 360 : kind === 'roll' ? 360 : kind === 'loop' ? 360 : stepUnit(kind) === 's' ? 2 : 0 });
export const stepLabel = (s: Step) => { const u = stepUnit(s.kind); return u ? `${s.kind} ${Math.round(s.amount)}${u === 'deg' ? '°' : 's'}` : s.kind; };

const P = (name: string, ...steps: [StepKind, number][]): Pattern => ({ name, repeat: 1, steps: steps.map(([kind, amount]) => ({ kind, amount })) });
/**
 * The simple moves, one button each, for players who cannot work a stick: a turn to either side, a U-turn, a square, a climb. They are
 * also the deck of the turn-based game (turnbased.ts): one move chosen per turn, flown to the end. Turn amounts: positive = right.
 */
export const SIMPLE_PATTERNS: Pattern[] = [
  P('Straight', ['level', 2]),
  P('Left 45', ['turn', -45]),
  P('Right 45', ['turn', 45]),
  P('Left 90', ['turn', -90]),
  P('Right 90', ['turn', 90]),
  P('U-turn left', ['turn', -180]),
  P('U-turn right', ['turn', 180]),
  P('Climb', ['climb', 2], ['level', 1]),
  P('Dive', ['dive', 1.5], ['level', 1]),
  P('S-turn', ['turn', 90], ['turn', -90]),
  P('Zigzag', ['turn', -45], ['turn', 90], ['turn', -90], ['turn', 45]),
  P('Square', ['turn', 90], ['level', 1], ['turn', 90], ['level', 1], ['turn', 90], ['level', 1], ['turn', 90]),
  P('Racetrack', ['level', 2], ['turn', 180], ['level', 2], ['turn', 180]),
  P('Wing over', ['climb', 1.5], ['turn', 180], ['dive', 1]),
  P('Chandelle', ['climb', 1.2], ['turn', 180], ['level', 1]),
  P('Dive and climb', ['dive', 1.2], ['climb', 2.2], ['level', 1]),
];

export const DEFAULT_PATTERNS: Pattern[] = [
  ...SIMPLE_PATTERNS,
  P('Roll left', ['roll', -360]),
  P('Double roll', ['roll', 720]),
  P('Loop and roll', ['loop', 360], ['roll', 360]),
  { name: 'Circle', repeat: 1, steps: [{ kind: 'turn', amount: 360 }] },
  { name: 'Loop', repeat: 1, steps: [{ kind: 'loop', amount: 360 }] },
  { name: 'Barrel', repeat: 1, steps: [{ kind: 'roll', amount: 360 }] },
  { name: 'Figure 8', repeat: 1, steps: [{ kind: 'turn', amount: 360 }, { kind: 'turn', amount: -360 }] },
  { name: 'Immelman', repeat: 1, steps: [{ kind: 'immelman', amount: 0 }] },
  { name: 'Split S', repeat: 1, steps: [{ kind: 'splitS', amount: 0 }] },
];

/** Bump when DEFAULT_PATTERNS gains patterns: saved lists from before get the new ones added (nothing of theirs is removed). */
export const PATTERN_VERSION = 2;
export interface MCtl { pitch: number; roll: number; yaw: number; aero: boolean }
export interface Maneuver {
  pattern: Pattern;
  i: number;                // current step
  rep: number;              // current repetition, from 0
  phase: number;            // sub-phase inside the step
  prog: number;             // progress in the step's own unit (rad or s)
  t: number;                // seconds in this step
  lastPsi: number; lastTheta: number; h0x: number; h0y: number;
}

const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const D2R = Math.PI / 180;
/** A loop is drag-limited: a full pull (stalling at the top) wobbles, a firm 0.7 pull from 16 m/s goes round clean. */
const LOOP_PULL = 0.7, LOOP_SPEED = 16;
/** The Immelman starts its half roll this far (rad) before the half loop is done: the nose is still coming over, and the path turns less while it rolls out. */
const IMM_LEAD = 1.2;
const STEP_TIMEOUT = 14, TURN_BANK = 1.0;

/** The angle of the nose in the vertical plane of the heading the step began on (0 level ahead, pi/2 straight up, pi upside down going back). */
const theta = (m: Maneuver, g: Glider) => Math.atan2(g.fwd[2], g.fwd[0] * m.h0x + g.fwd[1] * m.h0y);

function enter(m: Maneuver, g: Glider) {
  m.phase = 0; m.prog = 0; m.t = 0; m.lastPsi = g.psi; m.h0x = Math.cos(g.psi); m.h0y = Math.sin(g.psi); m.lastTheta = theta(m, g);
}

export function startManeuver(pattern: Pattern, g: Glider): Maneuver {
  const m: Maneuver = { pattern, i: 0, rep: 0, phase: 0, prog: 0, t: 0, lastPsi: 0, lastTheta: 0, h0x: 1, h0y: 0 };
  enter(m, g);
  return m;
}

/** Which step of how many is being flown, for the toast. */
export const maneuverStatus = (m: Maneuver) => `${m.pattern.name} ${m.i + 1}/${m.pattern.steps.length}`;

/** Wings level: right wing down is positive bank, a positive roll command rolls right. */
const level = (g: Glider) => clamp(-g.phi * 2.2);
/** Keep the wing axis horizontal: holds a loop in its plane even straight up or upside down, where the bank is meaningless. */
const flat = (g: Glider) => clamp(g.wz * 3);

/** Hold the nose where the flight path is flat: a small pull above trim speed, a small push below. */
const hold = (g: Glider) => clamp(0.3 * (g.airspeed - 7) / 7 - 1.2 * g.gamma, -0.6, 0.6);

/** Gaining loop speed: push over until the path is steep, then ease to zero lift (the least drag, so the plane dives to ~24 m/s instead of ~12). */
const dive = (g: Glider) => (g.gamma > -0.8 ? -0.6 : -0.45);

/** One frame of the pattern. Returns the controls, or null when the whole pattern is flown (or the plane cannot fly it any more). */
export function stepManeuver(m: Maneuver, g: Glider, dt: number): MCtl | null {
  if (g.landed || g.z < 12) return null;   // too low for anything fancy
  for (let guard = 0; guard < 4; guard++) {
    const s = m.pattern.steps[m.i];
    if (!s) return null;
    const out = stepOne(m, s, g, dt);
    if (out) return out;
    // step finished: next step, or next repeat, or done
    m.i++;
    if (m.i >= m.pattern.steps.length) { m.rep++; m.i = 0; if (m.rep >= Math.max(1, m.pattern.repeat)) return null; }
    enter(m, g);
    dt = 0;
  }
  return null;
}

function stepOne(m: Maneuver, s: Step, g: Glider, dt: number): MCtl | null {
  m.t += dt;
  if (m.t > STEP_TIMEOUT) return null;
  const dPsi = wrapPi(g.psi - m.lastPsi); m.lastPsi = g.psi;
  const th = theta(m, g), dTh = wrapPi(th - m.lastTheta); m.lastTheta = th;

  switch (s.kind) {
    case 'turn': {
      const dir = s.amount >= 0 ? 1 : -1, want = Math.abs(s.amount) * D2R;
      m.prog += -dir * dPsi;                          // a right turn decreases the heading
      const left = want - m.prog;
      if (m.phase === 0 && left < Math.min(0.8, want * 0.73)) m.phase = 1;  // start rolling out early enough that the wings are level as the turn ends (the turn goes on while the bank comes off: about 0.35 rad at full bank)
      if (m.phase === 1 && Math.abs(g.phi) < 0.08 && left < 0.2) return null;
      if (m.phase === 1 && left < -0.5) return null;
      const bank = m.phase === 0 ? dir * TURN_BANK : 0;
      const pull = m.phase === 0 ? clamp(0.12 + 0.55 * (1 / Math.max(0.3, Math.cos(g.phi)) - 1) + hold(g) * 0.3, -0.2, 0.9) : hold(g);
      return { pitch: pull, roll: clamp((bank - g.phi) * 2.2), yaw: 0, aero: false };
    }
    case 'roll': {
      const dir = s.amount >= 0 ? 1 : -1, want = Math.abs(s.amount) * D2R;
      if (m.phase === 0) {
        m.prog += dir * g.rollRate * dt;
        if (m.prog >= want - 0.25) m.phase = 1;
        return { pitch: 0.12, roll: dir, yaw: 0, aero: true };
      }
      if (Math.abs(g.phi) < 0.1 && g.nz > 0.9) return null;
      return { pitch: hold(g), roll: level(g), yaw: 0, aero: true };
    }
    case 'loop': {
      const want = Math.abs(s.amount) * D2R;
      if (m.phase === 0) {                                   // pick up speed first
        if (g.airspeed >= LOOP_SPEED) { m.phase = 1; m.lastTheta = th; m.prog = th; }
        else return { pitch: dive(g), roll: flat(g), yaw: 0, aero: true };
      }
      if (m.phase === 1) {
        m.prog += dTh;
        if (m.prog >= want - 0.3) m.phase = 2;
        return { pitch: LOOP_PULL, roll: flat(g), yaw: 0, aero: true };
      }
      if (Math.abs(g.phi) < 0.15 && g.nz > 0.8 && Math.abs(g.gamma) < 0.5) return null;
      return { pitch: hold(g), roll: level(g), yaw: 0, aero: true };
    }
    case 'immelman': {                                      // half loop up, then roll upright
      if (m.phase === 0) { if (g.airspeed >= LOOP_SPEED) { m.phase = 1; m.lastTheta = th; m.prog = th; } else return { pitch: dive(g), roll: flat(g), yaw: 0, aero: true }; }
      if (m.phase === 1) { m.prog += dTh; if (m.prog >= Math.PI - IMM_LEAD) m.phase = 2; return { pitch: LOOP_PULL, roll: flat(g), yaw: 0, aero: true }; }
      if (m.phase === 2) { if (Math.abs(g.phi) < 0.9) m.phase = 3; return { pitch: 0, roll: 1, yaw: 0, aero: true }; }   // (upright is the bank against the horizon, not nz: in a dive the lift points sideways even upright, which made it roll on and on)
      if (Math.abs(g.phi) < 0.15 && Math.abs(g.gamma) < 0.4) return null;
      return { pitch: hold(g), roll: level(g), yaw: 0, aero: true };
    }
    case 'splitS': {                                        // roll inverted, then pull through half a loop down
      if (m.phase === 0) { if (Math.abs(g.phi) > 2.5) { m.phase = 1; m.lastTheta = th; m.prog = -th; } return { pitch: 0, roll: 1, yaw: 0, aero: true }; }   // (inverted = bank near half a turn; nz is no use once the nose drops)
      if (m.phase === 1) { m.prog -= dTh; if (m.prog >= Math.PI - 0.35) m.phase = 2; return { pitch: LOOP_PULL, roll: flat(g), yaw: 0, aero: true }; }
      if (Math.abs(g.phi) < 0.15 && g.nz > 0.8 && Math.abs(g.gamma) < 0.6) return null;
      return { pitch: hold(g), roll: level(g), yaw: 0, aero: true };
    }
    case 'level': {
      m.prog += dt; if (m.prog >= s.amount && Math.abs(g.phi) < 0.15) return null;
      return { pitch: hold(g), roll: level(g), yaw: 0, aero: false };
    }
    case 'climb': case 'dive': {
      m.prog += dt; if (m.prog >= s.amount) return null;
      return { pitch: s.kind === 'climb' ? 0.4 : -0.6, roll: level(g), yaw: 0, aero: false };
    }
  }
}

// ---- persistence ----------------------------------------------------------------------------------------------------------

const KEY = 'scrypture.patterns';
export interface PatternStore { patterns: Pattern[]; sel: number; v?: number }

export function sanitize(raw: unknown): PatternStore {
  const fallback: PatternStore = { patterns: DEFAULT_PATTERNS.map(p => ({ ...p, steps: p.steps.map(x => ({ ...x })) })), sel: 0, v: PATTERN_VERSION };
  try {
    const r = raw as PatternStore;
    if (!r || !Array.isArray(r.patterns) || r.patterns.length === 0) return fallback;
    const patterns = r.patterns.slice(0, 32).map((p): Pattern => ({
      name: String(p.name ?? 'Pattern').slice(0, 14),
      repeat: clamp(Math.round(Number(p.repeat) || 1), 1, 9),
      steps: (Array.isArray(p.steps) ? p.steps : []).filter(x => STEP_KINDS.includes(x?.kind)).slice(0, 12).map(x => ({ kind: x.kind, amount: clamp(Number(x.amount) || 0, -720, 720) })),
    }));
    if ((Number(r.v) || 1) < PATTERN_VERSION) for (const d of DEFAULT_PATTERNS) if (patterns.length < 32 && !patterns.some(p => p.name === d.name)) patterns.push({ ...d, steps: d.steps.map(x => ({ ...x })) });   // (an older saved list: the new defaults join it)
    return { patterns, sel: clamp(Math.round(Number(r.sel) || 0), 0, patterns.length - 1), v: PATTERN_VERSION };
  } catch { return fallback; }
}

export function loadPatterns(): PatternStore {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return sanitize(null); }
}
export function savePatterns(s: PatternStore) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ } }
