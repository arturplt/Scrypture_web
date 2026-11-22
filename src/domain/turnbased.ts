/**
 * The groundwork for a turn-based game, in the manner of Ace of Aces (the dogfighting gamebook): each turn a player picks ONE move from
 * a short deck, and the plane flies it to the end before anyone chooses again. Nothing here needs fast hands: a move is a pattern
 * (maneuver.ts) flown by the autopilot with the real flight physics, so the result of a choice is exact and can be shown before it is made.
 * Pure: no drawing, no clock. A later screen only has to show `previewMove` for each card and call `playTurn` for the chosen one.
 */
import { stepGlider, type Glider, type GlideEnv } from './glider';
import { SIMPLE_PATTERNS, DEFAULT_PATTERNS, startManeuver, stepManeuver, type Pattern } from './maneuver';

/** One card of the deck. */
export interface Move { id: string; name: string; pattern: Pattern }

const byName = (n: string) => [...SIMPLE_PATTERNS, ...DEFAULT_PATTERNS].find(p => p.name === n)!;
const card = (id: string, name: string): Move => ({ id, name, pattern: byName(name) });
/** The deck, in the order a menu shows it: the plain moves first, the aerobatics last. */
export const MOVES: Move[] = [
  card('straight', 'Straight'), card('left45', 'Left 45'), card('right45', 'Right 45'), card('left90', 'Left 90'), card('right90', 'Right 90'),
  card('uturnL', 'U-turn left'), card('uturnR', 'U-turn right'), card('climb', 'Climb'), card('dive', 'Dive'),
  card('wingover', 'Wing over'), card('roll', 'Barrel'), card('loop', 'Loop'), card('immelman', 'Immelman'), card('splitS', 'Split S'),
];

export interface Fix { x: number; y: number; z: number }
export interface MoveResult {
  glider: Glider;        // the plane after the move (a copy: the one passed in is not touched)
  path: Fix[];           // where it went, every `sample` seconds, start and end included (tiles, tiles, metres above the ground)
  seconds: number;
  done: boolean;         // the move was flown to its end (false: it was cut short, by the ground or because the plane could not fly it)
  landed: boolean;
}

/** Fly one move on a copy of the plane. `sample`: seconds between path points. */
export function resolveMove(g: Glider, env: GlideEnv, move: Move, opt: { sample?: number; maxT?: number } = {}): MoveResult {
  const c = structuredClone(g), dt = 1 / 30, sample = opt.sample ?? 0.25, maxT = opt.maxT ?? 30;
  c.impact = null;
  const m = startManeuver(move.pattern, c), path: Fix[] = [{ x: c.x, y: c.y, z: c.z }];
  let t = 0, next = sample, done = false;
  while (t < maxT) {
    const ctl = stepManeuver(m, c, dt);
    if (!ctl) { done = m.rep >= Math.max(1, move.pattern.repeat) && !c.landed; break; }   // (null is both "all flown" and "cannot fly it": only the first has used up every repeat)
    stepGlider(c, { pitch: ctl.pitch, roll: ctl.roll, yaw: ctl.yaw, aero: ctl.aero }, env, dt); t += dt;
    if (t >= next) { path.push({ x: c.x, y: c.y, z: c.z }); next += sample; }
    if (c.landed) break;
  }
  path.push({ x: c.x, y: c.y, z: c.z });
  return { glider: c, path, seconds: t, done, landed: c.landed };
}

/** What a card would do from here, for showing a ghost of it before it is chosen. */
export const previewMove = resolveMove;

/** A game in progress: one plane, the turns played so far. (A second plane and a hit rule are what turn this into a dogfight.) */
export interface TurnState { turn: number; glider: Glider; played: { move: string; result: Pick<MoveResult, 'seconds' | 'done' | 'landed'> }[] }
export const newTurnState = (g: Glider): TurnState => ({ turn: 0, glider: structuredClone(g), played: [] });

/** Play the chosen card: the new state, and the move's full result (the path to animate). */
export function playTurn(s: TurnState, env: GlideEnv, move: Move): { state: TurnState; result: MoveResult } {
  const result = resolveMove(s.glider, env, move);
  return { state: { turn: s.turn + 1, glider: result.glider, played: [...s.played, { move: move.id, result: { seconds: result.seconds, done: result.done, landed: result.landed } }] }, result };
}
