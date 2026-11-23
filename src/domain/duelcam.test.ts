import { describe, expect, it } from 'vitest';
import { duelLine, duelPose, CAM_MODES, ZOOM_DEFAULT } from './cameraman';

describe('the duel camera', () => {
  it('is a camera mode with its own zoom', () => { expect(CAM_MODES).toContain('duel'); expect(ZOOM_DEFAULT.duel).toBeGreaterThan(0); });
  it('looks at the middle of the pair, from behind you along the line to the opponent, with both planes in front of the eye', () => {
    for (const [fx, fy] of [[40, 0], [0, 55], [-30, 30], [8, 5]]) {
      const me = { x: 0, y: 0, h: 6 }, foe = { x: fx, y: fy, h: 9 }, ln = duelLine(me, foe, [1, 0]);
      const p = duelPose(me, foe, ln.ang, 0.85, 1);
      expect(p.target.x).toBeCloseTo(fx / 2); expect(p.target.y).toBeCloseTo(fy / 2);
      // the view direction is the line from the eye to the target; both planes are ahead of the eye along it
      const vx = p.target.x - p.eye.x, vy = p.target.y - p.eye.y, vh = p.target.h - p.eye.h, vl = Math.hypot(vx, vy, vh);
      for (const q of [me, foe]) expect(((q.x - p.eye.x) * vx + (q.y - p.eye.y) * vy + (q.h - p.eye.h) * vh) / vl).toBeGreaterThan(1);
      expect(Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.h - p.target.h)).toBeGreaterThan(Math.hypot(fx, fy) * 0.7);   // far enough out to fit the gap
    }
  });
  it('pulls out as the gap grows, and with the zoom', () => {
    const me = { x: 0, y: 0, h: 6 }, d = (g: number, z = 1) => { const f = { x: g, y: 0, h: 6 }, p = duelPose(me, f, 0, 0.85, z); return Math.hypot(p.eye.x - p.target.x, p.eye.h - p.target.h); };
    expect(d(60)).toBeGreaterThan(d(20)); expect(d(20, 2)).toBeGreaterThan(d(20, 1));
  });
  it('with no opponent it orbits behind the plane along its heading', () => {
    const me = { x: 3, y: 4, h: 6 }, ln = duelLine(me, null, [0, 1]), p = duelPose(me, null, ln.ang, 0.85, 1);
    expect(p.target).toEqual(me); expect(p.eye.y).toBeLessThan(me.y); expect(p.eye.x).toBeCloseTo(me.x);
  });
});
