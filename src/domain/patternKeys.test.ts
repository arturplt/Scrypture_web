import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider, type GlideEnv } from './glider';
import { STEP_KINDS, stepManeuver, type Maneuver } from './maneuver';
import { KEY_ROWS, MAX_QUEUE_STEPS, PATTERN_KEYS, keyByHotkey, keyById, keySymbolUrl, pressPatternKey, runProgress, type KeyRun, hotkeyFor, setHotkey, sanitizeHotkeys, hotkeyUsable, RESERVED_HOTKEYS, moveFocus, keyAtFocus, FOCUS_START } from './patternKeys';

/** The symbol files in public/, by file name (read at build time: the project has no node typings). */
const files = Object.keys(import.meta.glob('../../public/assets/symbols_svg/*.svg', { query: '?raw', eager: true })).map(p => p.split('/').pop());
const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const settled = () => { const g = newGlider(0, 0, 0.4, 150); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60); return g; };
/** Fly a maneuver to its end (or 60 s); returns the glider and whether it finished. */
function flyOut(g: ReturnType<typeof settled>, m: Maneuver, maxS = 60) {
  let done = false;
  for (let t = 0; t < 60 * maxS; t++) {
    const c = stepManeuver(m, g, 1 / 60);
    if (!c) { done = true; break; }
    stepGlider(g, { pitch: c.pitch, roll: c.roll, yaw: c.yaw, aero: c.aero }, still, 1 / 60);
    if (g.landed) break;
  }
  return done;
}

describe('pattern keyboard', () => {
  it('has the 21 keys in rows of 1, 5, 9, 3 and 3', () => {
    expect(PATTERN_KEYS).toHaveLength(21);
    expect(KEY_ROWS.map(r => r.length)).toEqual([1, 5, 9, 3, 3]);
  });
  it('has unique ids and hotkeys, and none of the flying keys', () => {
    expect(new Set(PATTERN_KEYS.map(k => k.id)).size).toBe(21);
    expect(new Set(PATTERN_KEYS.map(k => k.hotkey)).size).toBe(21);
    for (const k of PATTERN_KEYS) expect('wasdqerxtpfcgok '.includes(k.hotkey)).toBe(false);
  });
  it('orders the rows by their file names (r01_c01 .. r05_c03)', () => {
    const ids = KEY_ROWS.flat().map(k => k.id);
    expect(ids).toEqual([...ids].sort());
    KEY_ROWS.forEach((row, r) => row.forEach((k, c) => expect(k.id.startsWith(`r0${r + 1}_c0${c + 1}_`)).toBe(true)));
  });
  it('every key has a symbol file', () => {
    for (const k of PATTERN_KEYS) expect(files, k.id).toContain(keySymbolUrl(k).split('/').pop());
    expect(files).toHaveLength(21);
  });
  it('every key is a valid chain of known steps', () => {
    for (const k of PATTERN_KEYS) {
      expect(k.steps.length).toBeGreaterThan(0); expect(k.steps.length).toBeLessThanOrEqual(12);
      for (const s of k.steps) { expect(STEP_KINDS).toContain(s.kind); expect(Math.abs(s.amount)).toBeLessThanOrEqual(720); }
    }
  });
  it('looks keys up by id and by hotkey', () => {
    expect(keyById('r05_c02_vertical_loop')?.label).toBe('Loop');
    expect(keyByHotkey('Z')?.id).toBe('r01_c01_zigzag');
    expect(keyByHotkey('w')).toBeUndefined();
  });

  for (const k of PATTERN_KEYS) {
    it(`${k.label} flies to the end, level, upright and above the ground`, () => {
      const g = settled();
      const r = pressPatternKey(null, null, k, g)!;
      expect(flyOut(g, r.man)).toBe(true);
      expect(g.landed).toBe(false); expect(Math.abs(g.phi)).toBeLessThan(0.4); expect(g.nz).toBeGreaterThan(0.6);
      expect(Number.isFinite(g.x + g.y + g.z)).toBe(true);
    });
  }

  it('left and right keys turn opposite ways', () => {
    const turn = (id: string) => { const g = settled(), p0 = g.psi, r = pressPatternKey(null, null, keyById(id)!, g)!; flyOut(g, r.man); return Math.atan2(Math.sin(g.psi - p0), Math.cos(g.psi - p0)); };
    expect(turn('r02_c02_diagonal_up_left')).toBeGreaterThan(0.4);    // left = counter-clockwise = heading grows
    expect(turn('r02_c04_diagonal_up_right')).toBeLessThan(-0.4);
    expect(turn('r03_c04_turn_left')).toBeGreaterThan(1.2);
    expect(turn('r03_c06_turn_right')).toBeLessThan(-1.2);
  });

  describe('typing a sequence', () => {
    const left = keyById('r02_c02_diagonal_up_left')!, right = keyById('r02_c04_diagonal_up_right')!;
    it('queues keys pressed while the run flies, without touching the key tables', () => {
      const g = settled(), before = JSON.stringify(PATTERN_KEYS);
      const a = pressPatternKey(null, null, left, g)!;
      const b = pressPatternKey(a.man, a.run, right, g)!;
      expect(b.man).toBe(a.man); expect(b.run.keys).toEqual([left.id, right.id]);
      expect(b.man.pattern.steps.map(s => s.amount)).toEqual([-45, 45]);
      expect(JSON.stringify(PATTERN_KEYS)).toBe(before);
    });
    it('flies the queued moves one after another and reports progress', () => {
      const g = settled(), p0 = g.psi;
      const a = pressPatternKey(null, null, left, g)!;
      const b = pressPatternKey(a.man, a.run, right, g)!;
      expect(runProgress(b.man, b.run)).toEqual({ keys: [left.id, right.id], at: 0 });
      let sawSecond = false;
      for (let t = 0; t < 60 * 40; t++) {
        const c = stepManeuver(b.man, g, 1 / 60); if (!c) break;
        stepGlider(g, { pitch: c.pitch, roll: c.roll, yaw: c.yaw, aero: c.aero }, still, 1 / 60);
        if (runProgress(b.man, b.run)?.at === 1) sawSecond = true;
      }
      expect(sawSecond).toBe(true);
      expect(Math.abs(Math.atan2(Math.sin(g.psi - p0), Math.cos(g.psi - p0)))).toBeLessThan(0.35);   // left 45 then right 45: back on the heading
    });
    it('starts a new run when the old one is over, or was not the keyboard\'s', () => {
      const g = settled();
      const a = pressPatternKey(null, null, left, g)!;
      const stale = pressPatternKey(null, a.run, right, g)!;        // no maneuver flying: new run
      expect(stale.run).not.toBe(a.run); expect(stale.run.keys).toEqual([right.id]);
      const other = { ...a.man, pattern: { name: 'mine', repeat: 1, steps: [{ kind: 'turn' as const, amount: 90 }] } };
      const fresh = pressPatternKey(other, a.run, right, g)!;       // the pilot's own pattern is flying: left alone
      expect(other.pattern.steps).toHaveLength(1); expect(fresh.man).not.toBe(other);
      expect(runProgress(null, a.run)).toBeNull();
    });
    it('stops queueing at the limit', () => {
      const g = settled(), zig = keyById('r01_c01_zigzag')!;   // 4 steps
      let r: { man: Maneuver; run: KeyRun } | null = pressPatternKey(null, null, zig, g)!;
      const run = r.run, man = r.man;
      for (let i = 0; i < 10; i++) r = pressPatternKey(man, run, zig, g);
      expect(run.pattern.steps.length).toBeLessThanOrEqual(MAX_QUEUE_STEPS);
      expect(run.pattern.steps.length).toBe(24);
      expect(r).toBeNull();
    });
  });
});

describe('pattern keyboard: own hotkeys', () => {
  const zig = PATTERN_KEYS[0];   // Zigzag, Z by default
  it('keeps the defaults with no map, and finds keys through a map', () => {
    expect(hotkeyFor(zig)).toBe('z');
    expect(keyByHotkey('Z')?.id).toBe(zig.id);
    const m = setHotkey({}, zig.id, 'ä')!;
    expect(keyByHotkey('ä', m)?.id).toBe(zig.id);
    expect(keyByHotkey('z', m)).toBeUndefined();
  });
  it('refuses the flying keys and anything unprintable', () => {
    for (const h of RESERVED_HOTKEYS) expect(setHotkey({}, zig.id, h)).toBeNull();
    expect(setHotkey({}, zig.id, 'Shift')).toBeNull();
    expect(setHotkey({}, zig.id, 'ArrowUp')).toBeNull();
    expect(hotkeyUsable('7')).toBe(true);
  });
  it('swaps a key that is already taken, so no two keys ever share one', () => {
    const one = keyByHotkey('1')!, m = setHotkey({}, zig.id, '1')!;
    expect(hotkeyFor(zig, m)).toBe('1'); expect(hotkeyFor(one, m)).toBe('z');
    const all = PATTERN_KEYS.map(k => hotkeyFor(k, m));
    expect(new Set(all).size).toBe(21);
    const back = setHotkey(m, zig.id, 'z')!;   // putting it back swaps them home, and the map is empty again
    expect(back).toEqual({});
  });
  it('cleans a saved map: unknown ids, reserved keys and clashes are dropped', () => {
    const one = keyByHotkey('1')!;
    expect(sanitizeHotkeys({ nope: 'x', [zig.id]: 'w' })).toEqual({});
    expect(sanitizeHotkeys({ [zig.id]: '1' })).toEqual({});   // (1 is still the default of another key)
    expect(sanitizeHotkeys({ [zig.id]: '1', [one.id]: 'z' })).toEqual({ [zig.id]: '1', [one.id]: 'z' });
    expect(sanitizeHotkeys('junk')).toEqual({});
  });
});

describe('pattern keyboard: the gamepad highlight', () => {
  it('starts on Straight and moves along a row, stopping at the ends', () => {
    expect(keyAtFocus(FOCUS_START)?.label).toBe('Straight');
    expect(moveFocus({ r: 2, c: 0 }, 'left')).toEqual({ r: 2, c: 0 });
    expect(moveFocus({ r: 2, c: 8 }, 'right')).toEqual({ r: 2, c: 8 });
  });
  it('keeps its place across rows of other widths', () => {
    expect(moveFocus({ r: 0, c: 0 }, 'down')).toEqual({ r: 1, c: 2 });   // (from the single top key to the middle of five)
    expect(moveFocus({ r: 2, c: 8 }, 'down')).toEqual({ r: 3, c: 2 });   // (the right end stays the right end)
    expect(moveFocus({ r: 2, c: 4 }, 'down')).toEqual({ r: 3, c: 1 });
    expect(moveFocus({ r: 1, c: 4 }, 'up')).toEqual({ r: 0, c: 0 });
    expect(moveFocus({ r: 4, c: 1 }, 'down')).toEqual({ r: 4, c: 1 });
    for (let r = 0; r < KEY_ROWS.length; r++) for (let c = 0; c < KEY_ROWS[r].length; c++) for (const d of ['up', 'down', 'left', 'right'] as const) expect(keyAtFocus(moveFocus({ r, c }, d))).toBeDefined();
  });
});
