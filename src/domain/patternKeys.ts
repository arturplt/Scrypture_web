/**
 * The pattern keyboard: 21 keys, each with a symbol (public/assets/symbols_svg) and the flight pattern it flies. Pressing a key
 * flies its move; pressing more while it flies queues them behind it, so a figure can be typed in one go. The flying is the pattern
 * engine's (maneuver.ts): a key is only a name for a chain of steps. Turn amounts: positive = right.
 * The symbols are read as a view from above with "up" = straight ahead, and the layout (1, 5, 9, 3, 3 keys) is the reference picture's.
 */
import type { Glider } from './glider';
import { startManeuver, type Maneuver, type Pattern, type Step, type StepKind } from './maneuver';

export interface PatternKey {
  id: string;            // the file name without `.svg`
  label: string;         // shown on the toast / tooltip
  hotkey: string;        // a physical key that presses it while the keyboard is open (lower case)
  row: number;           // 0..4, top to bottom
  steps: Step[];
}

const S = (kind: StepKind, amount = 0): Step => ({ kind, amount });
const K = (id: string, label: string, hotkey: string, row: number, ...steps: Step[]): PatternKey => ({ id, label, hotkey, row, steps });

export const PATTERN_KEYS: PatternKey[] = [
  K('r01_c01_zigzag', 'Zigzag', 'z', 0, S('turn', -45), S('turn', 90), S('turn', -90), S('turn', 45)),

  K('r02_c01_wavy_left_dot', 'S left', '1', 1, S('turn', -90), S('turn', 90)),
  K('r02_c02_diagonal_up_left', 'Left 45', '2', 1, S('turn', -45)),
  K('r02_c03_curved_up_right', 'Curve right', '3', 1, S('turn', 90)),
  K('r02_c04_diagonal_up_right', 'Right 45', '4', 1, S('turn', 45)),
  K('r02_c05_wavy_right_dot', 'S right', '5', 1, S('turn', 90), S('turn', -90)),

  K('r03_c01_sweep_left', 'Sweep left', '6', 2, S('turn', -135)),
  K('r03_c02_circle_left', 'Circle left', '7', 2, S('turn', -360)),
  K('r03_c03_square_down_left', 'Box U left', '8', 2, S('turn', -90), S('level', 1), S('turn', -90)),
  K('r03_c04_turn_left', 'Corner left', '9', 2, S('level', 1), S('turn', -90)),
  K('r03_c05_straight_up', 'Straight', '0', 2, S('level', 2)),
  K('r03_c06_turn_right', 'Corner right', 'h', 2, S('level', 1), S('turn', 90)),
  K('r03_c07_square_down_right', 'Box U right', 'j', 2, S('turn', 90), S('level', 1), S('turn', 90)),
  K('r03_c08_circle_right', 'Circle right', 'l', 2, S('turn', 360)),
  K('r03_c09_sweep_right', 'Sweep right', 'y', 2, S('turn', 135)),

  K('r04_c01_u_turn_down_right', 'U-turn right', 'b', 3, S('turn', 180)),
  K('r04_c02_bend_down_right', 'Dive right', 'n', 3, S('turn', 90), S('dive', 1.2), S('level', 1)),
  K('r04_c03_double_right', 'Racetrack', 'm', 3, S('level', 2), S('turn', 180), S('level', 2), S('turn', 180)),

  K('r05_c01_square_loop', 'Square', 'u', 4, S('turn', 90), S('level', 1), S('turn', 90), S('level', 1), S('turn', 90), S('level', 1), S('turn', 90)),
  K('r05_c02_vertical_loop', 'Loop', 'i', 4, S('loop', 360)),
  K('r05_c03_figure_eight', 'Figure 8', 'v', 4, S('turn', 360), S('turn', -360)),
];

/** The keys row by row, left to right: 1, 5, 9, 3 and 3 keys. */
export const KEY_ROWS: PatternKey[][] = [0, 1, 2, 3, 4].map(r => PATTERN_KEYS.filter(k => k.row === r));

export const keyById = (id: string) => PATTERN_KEYS.find(k => k.id === id);
/** The key a physical key presses (no modifiers), or undefined. */
export const keyByHotkey = (hot: string) => PATTERN_KEYS.find(k => k.hotkey === hot.toLowerCase());
/** Where a key's symbol is served from (`base` is Vite's BASE_URL). */
export const keySymbolUrl = (k: PatternKey, base = '/') => `${base}assets/symbols_svg/${k.id}.svg`;

/** Most steps a typed sequence may hold (the editor's patterns stop at 12; a typed one is allowed a few more). */
export const MAX_QUEUE_STEPS = 24;

/** A typed sequence being flown: the pattern the keys build up, which keys they were and where each key's steps end (cumulative). */
export interface KeyRun { pattern: Pattern; keys: string[]; ends: number[] }

/**
 * A key was pressed. While the run it started is still flying, its steps are queued behind the ones in progress (false when the
 * queue is full: nothing changes). Otherwise a new run starts from the glider's state.
 */
export function pressPatternKey(cur: Maneuver | null, run: KeyRun | null, key: PatternKey, g: Glider): { man: Maneuver; run: KeyRun } | null {
  if (cur && run && cur.pattern === run.pattern) {
    const p = run.pattern;
    if (p.steps.length + key.steps.length > MAX_QUEUE_STEPS) return null;
    p.steps.push(...key.steps.map(s => ({ ...s })));
    run.keys.push(key.id); run.ends.push(p.steps.length);
    p.name = `${run.keys.length} moves`;
    return { man: cur, run };
  }
  const pattern: Pattern = { name: key.label, repeat: 1, steps: key.steps.map(s => ({ ...s })) };
  const fresh: KeyRun = { pattern, keys: [key.id], ends: [pattern.steps.length] };
  return { man: startManeuver(pattern, g), run: fresh };
}

/** How far a typed sequence has got: the keys, and how many of them are done (the one flying now is `done`). Null when it is not flying. */
export function runProgress(cur: Maneuver | null, run: KeyRun | null): { keys: string[]; at: number } | null {
  if (!cur || !run || cur.pattern !== run.pattern) return null;
  const at = run.ends.findIndex(e => cur.i < e);
  return { keys: run.keys, at: at < 0 ? run.keys.length - 1 : at };
}
