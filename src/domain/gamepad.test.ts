import { describe, expect, it } from 'vitest';
import { deadzone, stick2, readPad, padEdges, pickPad, PAD, NO_PAD, type PadSnapshot } from './gamepad';

const btn = (pressed = false, value = pressed ? 1 : 0) => ({ pressed, value });
const pad = (axes: number[] = [0, 0, 0, 0], on: number[] = [], trig: Record<number, number> = {}): PadSnapshot => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => (i in trig ? btn(false, trig[i]) : btn(on.includes(i)))),
});

describe('gamepad', () => {
  it('cuts a dead zone and rescales the rest', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(-0.1)).toBe(0);
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    expect(deadzone(0.59)).toBeGreaterThan(0);
    expect(deadzone(0.59)).toBeLessThan(0.59);
  });

  it('has a round dead zone that keeps the direction', () => {
    expect(stick2(0.12, 0.12)).toEqual({ x: 0, y: 0 });
    const s = stick2(1, 1);   // a diagonal corner is clamped to the unit circle
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(1);
    expect(s.x).toBeCloseTo(s.y);
  });

  it('reads sticks and ignores a resting pad', () => {
    expect(readPad(pad()).active).toBe(false);
    expect(readPad(pad([0.05, -0.05, 0.02, 0.01])).active).toBe(false);
    const r = readPad(pad([1, -1, 0.5, 0]));
    expect(r.active).toBe(true);
    expect(r.lx).toBeGreaterThan(0.6);
    expect(r.ly).toBeLessThan(-0.6);
    expect(r.rx).toBeGreaterThan(0);
    expect(r.ry).toBe(0);
    expect(readPad(null)).toBe(NO_PAD);
  });

  it('folds the d-pad into the left stick only when the stick rests', () => {
    expect(readPad(pad([0, 0, 0, 0], [PAD.LEFT, PAD.UP]))).toMatchObject({ lx: -1, ly: -1 });
    expect(readPad(pad([0.9, 0, 0, 0], [PAD.LEFT])).lx).toBeGreaterThan(0);
  });

  it('counts the triggers past a third', () => {
    expect(readPad(pad([0, 0, 0, 0], [], { [PAD.RT]: 0.2 })).down.has(PAD.RT)).toBe(false);
    expect(readPad(pad([0, 0, 0, 0], [], { [PAD.RT]: 0.5 })).down.has(PAD.RT)).toBe(true);
  });

  it('finds the buttons that went down and up', () => {
    const e = padEdges(new Set([PAD.A, PAD.B]), new Set([PAD.B, PAD.X]));
    expect(e.pressed).toEqual([PAD.X]);
    expect(e.released).toEqual([PAD.A]);
  });

  it('prefers the pad that is being used', () => {
    const idle = pad(), used = pad([0, 0, 0, 0], [PAD.A]);
    expect(pickPad([null, idle, used])).toBe(used);
    expect(pickPad([null, idle])).toBe(idle);
    expect(pickPad([null, null])).toBeNull();
    expect(pickPad(undefined)).toBeNull();
  });
});
