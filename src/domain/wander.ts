/**
 * Bóbr wandering in his pen: he walks (the scenery slides past), stops, looks around, and when something lies on the ground he
 * often heads for it and picks it up. Positions are in pen widths (1 = the width of the pen), so it looks the same at any size.
 * `pos` is where he stands in the pen's endless world; an item at `x` is on screen at `x - pos` from the middle.
 */
export type Act = 'walk' | 'idle' | 'look' | 'pick';
export interface Walker { pos: number; act: Act; dir: 1 | -1; face: 1 | -1; t: number; flip: number }

export const WALK_SPEED = 0.13, REACH = 0.05;   // pen widths per second; how close to an item counts as standing on it

export const newWalker = (): Walker => ({ pos: 0, act: 'idle', dir: 1, face: 1, t: 1, flip: 0 });

/** Advance by `dt` seconds. Returns the index of the item he picked up this step, or -1. `rnd` is Math.random (injectable for tests). */
export function stepWalker(w: Walker, dt: number, items: readonly number[], rnd: () => number = Math.random): number {
  w.t -= dt;
  let picked = -1;
  if (w.act === 'walk') {
    w.pos += w.dir * WALK_SPEED * dt;
    w.face = w.dir;
    const i = items.findIndex(x => Math.abs(x - w.pos) <= REACH);
    if (i >= 0) { picked = i; w.act = 'pick'; w.t = 0.5; }
  } else if (w.act === 'look') {
    w.flip -= dt;
    if (w.flip <= 0) { w.face = w.face === 1 ? -1 : 1; w.flip = 0.6 + rnd() * 0.5; }
  }
  if (w.t > 0) return picked;
  if (w.act === 'walk') {
    if (rnd() < 0.5) { w.act = 'idle'; w.t = 1 + rnd() * 1.5; } else { w.act = 'look'; w.t = 2 + rnd() * 2; w.flip = 0.4; }
  } else {
    w.act = 'walk';
    let near = -1;   // the nearest item, if any: three times in four he goes for it
    items.forEach((x, i) => { if (near < 0 || Math.abs(x - w.pos) < Math.abs(items[near] - w.pos)) near = i; });
    if (near >= 0 && rnd() < 0.75) { const d = items[near] - w.pos; w.dir = d >= 0 ? 1 : -1; w.t = Math.min(Math.abs(d) / WALK_SPEED + 0.3, 8); }
    else { w.dir = rnd() < 0.5 ? 1 : -1; w.t = 2 + rnd() * 3; }
  }
  return picked;
}
