/**
 * Gamepad / joystick support for the Paperplane world: turns a browser Gamepad snapshot (the "standard" mapping that every common pad has)
 * into the same controls the keyboard gives: left stick = pitch + roll (and walking on foot), right stick = yaw (and looking round on
 * foot), the right trigger burns the rocket, and the buttons are the keys' actions.
 */

/** The part of a browser `Gamepad` we read (so tests need no DOM). */
export interface PadSnapshot { axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] }

export const PAD_DEADZONE = 0.18;

/** A stick axis with a dead zone cut out of the middle and the rest stretched back to 0..1 (so there is no jump at the edge of the dead zone). */
export function deadzone(v: number, dz = PAD_DEADZONE): number {
  const a = Math.abs(v);
  if (!(a > dz)) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** A round dead zone for a two-axis stick: the length is cut and rescaled, the direction kept (a square one makes diagonals feel stuck). */
export function stick2(x: number, y: number, dz = PAD_DEADZONE): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (!(len > dz)) return { x: 0, y: 0 };
  const k = Math.min(1, (len - dz) / (1 - dz)) / len;
  return { x: x * k, y: y * k };
}

/** Buttons in the standard layout, by name. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
export type PadButton = keyof typeof PAD;

export interface PadInput {
  /** left stick, screen axes (y down, so pulling back is +1) */
  lx: number; ly: number;
  /** right stick */
  rx: number; ry: number;
  /** which buttons are down */
  down: ReadonlySet<number>;
  /** true when the pad moved or was pressed at all (so an idle pad does not take over from the keyboard) */
  active: boolean;
}

export const NO_PAD: PadInput = { lx: 0, ly: 0, rx: 0, ry: 0, down: new Set(), active: false };

/** Read a snapshot: dead zones applied, the d-pad folded into the left stick when that is at rest, the triggers counted as down past a third. */
export function readPad(p: PadSnapshot | null | undefined, opts: { dpadStick?: boolean } = {}): PadInput {   // dpadStick false: the d-pad is only buttons (the pattern keyboard's highlight moves with it)
  if (!p) return NO_PAD;
  const down = new Set<number>();
  p.buttons.forEach((b, i) => { if (b.pressed || (i === PAD.LT || i === PAD.RT ? b.value > 0.33 : false)) down.add(i); });
  const l = stick2(p.axes[0] ?? 0, p.axes[1] ?? 0), r = stick2(p.axes[2] ?? 0, p.axes[3] ?? 0);
  let lx = l.x, ly = l.y;
  if (!lx && !ly && opts.dpadStick !== false) { lx = (down.has(PAD.RIGHT) ? 1 : 0) - (down.has(PAD.LEFT) ? 1 : 0); ly = (down.has(PAD.DOWN) ? 1 : 0) - (down.has(PAD.UP) ? 1 : 0); }
  return { lx, ly, rx: r.x, ry: r.y, down, active: !!(lx || ly || r.x || r.y || down.size) };
}

/** The buttons that went down (or up) between two reads: what a key press (or release) is on a keyboard. */
export function padEdges(prev: ReadonlySet<number>, now: ReadonlySet<number>): { pressed: number[]; released: number[] } {
  const pressed: number[] = [], released: number[] = [];
  for (const b of now) if (!prev.has(b)) pressed.push(b);
  for (const b of prev) if (!now.has(b)) released.push(b);
  return { pressed, released };
}

/** The first connected pad that is doing something (or just the first connected one), from `navigator.getGamepads()`. */
export function pickPad(pads: ArrayLike<PadSnapshot | null> | null | undefined): PadSnapshot | null {
  if (!pads) return null;
  let first: PadSnapshot | null = null;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]; if (!p) continue;
    if (!first) first = p;
    if (readPad(p).active) return p;
  }
  return first;
}
