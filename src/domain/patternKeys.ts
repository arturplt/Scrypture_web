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
/** The player's own hotkeys: key id -> physical key (lower case). Keys not in it keep their default. */
export type HotkeyMap = Readonly<Record<string, string>>;
/** A key's hotkey with the player's choices applied. */
export const hotkeyFor = (k: PatternKey, map?: HotkeyMap) => map?.[k.id] ?? k.hotkey;
/** The key a physical key presses (no modifiers), or undefined. */
export const keyByHotkey = (hot: string, map?: HotkeyMap) => { const h = hot.toLowerCase(); return PATTERN_KEYS.find(k => hotkeyFor(k, map) === h); };

/** Keys the flying already uses (WASD QE, R rocket, X pattern, T SAS, P pause, F interact, C camera, G dogfight, O auto orbit, K the keyboard, space, the warp's , and .): never a pattern key. */
export const RESERVED_HOTKEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'x', 't', 'p', 'f', 'c', 'g', 'o', 'k', ' ', ',', '.']);
/** Whether a physical key can be a pattern key at all: one printable character, not one the flying uses. */
export const hotkeyUsable = (hot: string) => hot.length === 1 && hot.trim() !== '' && !RESERVED_HOTKEYS.has(hot.toLowerCase());

/**
 * Give key `id` the physical key `hot`. A key another pattern key already has is swapped over to it (so no two keys ever share one);
 * a reserved or unprintable key is refused (null). Choosing a key's own default drops it from the map.
 */
export function setHotkey(map: HotkeyMap, id: string, hot: string): Record<string, string> | null {
  const k = keyById(id), h = hot.toLowerCase();
  if (!k || !hotkeyUsable(h)) return null;
  const next: Record<string, string> = { ...map }, mine = hotkeyFor(k, map), other = PATTERN_KEYS.find(o => o.id !== id && hotkeyFor(o, map) === h);
  if (other) { if (mine === other.hotkey) delete next[other.id]; else next[other.id] = mine; }
  if (h === k.hotkey) delete next[id]; else next[id] = h;
  return next;
}
/** A saved map read back: only known keys, usable hotkeys, and no two keys on one hotkey (later ones lose); anything else is dropped. */
export function sanitizeHotkeys(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string' && keyById(id) && hotkeyUsable(v)) out[id] = v.toLowerCase();
  // (the map is checked whole, so a swapped pair stays; on a clash the later entry goes, which can bring a default back into a clash: so again until none is left)
  for (let pass = 0; pass < PATTERN_KEYS.length; pass++) {
    const owner = new Map<string, string>(); let dropped = false;
    for (const id of [...PATTERN_KEYS.filter(k => !(k.id in out)).map(k => k.id), ...Object.keys(out)]) {
      const h = hotkeyFor(keyById(id)!, out);
      if (owner.has(h)) { delete out[id]; dropped = true; } else owner.set(h, id);
    }
    if (!dropped) break;
  }
  return out;
}

/** Where the highlight is on the keyboard (a gamepad's d-pad moves it): row, and the key in that row. */
export interface KeyFocus { r: number; c: number }
/** Move the highlight one key. Up and down keep the place across the row (the rows are 1, 5, 9, 3 and 3 wide): the nearest key under it. */
export function moveFocus(f: KeyFocus, dir: 'up' | 'down' | 'left' | 'right'): KeyFocus {
  const rows = KEY_ROWS.length, r = Math.max(0, Math.min(rows - 1, f.r)), n = KEY_ROWS[r].length, c = Math.max(0, Math.min(n - 1, f.c));
  if (dir === 'left') return { r, c: Math.max(0, c - 1) };
  if (dir === 'right') return { r, c: Math.min(n - 1, c + 1) };
  const r2 = Math.max(0, Math.min(rows - 1, r + (dir === 'down' ? 1 : -1))), n2 = KEY_ROWS[r2].length;
  return { r: r2, c: n === 1 ? Math.floor((n2 - 1) / 2) : Math.round((c / (n - 1)) * (n2 - 1)) };
}
/** The key under the highlight. */
export const keyAtFocus = (f: KeyFocus) => KEY_ROWS[Math.max(0, Math.min(KEY_ROWS.length - 1, f.r))]?.[f.c];
/** The highlight's starting place: Straight, in the middle of the keyboard. */
export const FOCUS_START: KeyFocus = { r: 2, c: 4 };
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
