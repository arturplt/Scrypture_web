import { describe, expect, it } from 'vitest';
import { CAM_MODES, FLYBY_LEAD, MIN_EYE_H, ZOOM_DEFAULT, ZOOM_RANGE, flybyStep, newFlyby, nextCamMode, orbitEye, pinchBy, zoomBy, type CamMode } from './cameraman';

describe('camera modes', () => {
  it('C goes chase -> free -> flyby -> chase', () => {
    let m: CamMode = 'chase'; const seen: CamMode[] = [];
    for (let i = 0; i < 4; i++) { m = nextCamMode(m); seen.push(m); }
    expect(seen).toEqual(['free', 'flyby', 'chase', 'free']);
  });
  it('without the 3D view (or off the glider) only the chase view is left', () => {
    for (const m of CAM_MODES) expect(nextCamMode(m, false)).toBe('chase');
  });
});

describe('zoom', () => {
  it('wheel up brings the plane closer in every mode, and it stays in range', () => {
    for (const m of CAM_MODES) {
      const closer = zoomBy(m, ZOOM_DEFAULT[m], -120);
      if (m === 'chase') expect(closer).toBeGreaterThan(ZOOM_DEFAULT[m]); else expect(closer).toBeLessThan(ZOOM_DEFAULT[m]);
      let z = ZOOM_DEFAULT[m]; for (let i = 0; i < 200; i++) z = zoomBy(m, z, -500); expect(z).toBe(m === 'chase' ? ZOOM_RANGE[m][1] : ZOOM_RANGE[m][0]);
      for (let i = 0; i < 200; i++) z = zoomBy(m, z, 500); expect(z).toBe(m === 'chase' ? ZOOM_RANGE[m][0] : ZOOM_RANGE[m][1]);
    }
  });
  it('spreading two fingers does the same as wheel up', () => {
    expect(pinchBy('chase', 2, 1.5)).toBeGreaterThan(2);
    expect(pinchBy('free', 12, 1.5)).toBeLessThan(12);
    expect(pinchBy('free', 12, 1000)).toBe(ZOOM_RANGE.free[0]);
  });
});

describe('free view', () => {
  it('sits at the radius from the plane, behind it along the view, and never in the ground', () => {
    const t = { x: 10, y: -4, h: 3 }, e = orbitEye(t, 1, 0, 1.1, 12);
    expect(Math.hypot(e.x - t.x, e.y - t.y, e.h - t.h)).toBeCloseTo(12, 6);
    expect(e.x).toBeLessThan(t.x);
    expect(orbitEye(t, 1, 0, 1.75, 30).h).toBe(MIN_EYE_H);     // (looking up from under the plane, low down)
  });
});

describe('flyby', () => {
  it('parks ahead of the plane and beside its path, above the ground, then cuts to a new spot once the plane is past', () => {
    const fb = newFlyby(), p = { x: 0, y: 0, h: 4 }; let cuts = 0, far = 0; const sides = new Set<number>();
    for (let i = 0; i < 60 * 60; i++) {
      p.x += 10 / 60;                                          // 10 tiles a second, due east
      if (flybyStep(fb, p, 10, 0, 1, 0, 9)) {
        cuts++; sides.add(fb.side);
        expect(fb.x - p.x).toBeGreaterThanOrEqual(FLYBY_LEAD[0]);   // ahead
        expect(Math.abs(fb.y - p.y)).toBeCloseTo(9, 6);              // beside the path
      }
      expect(fb.h).toBeGreaterThan(MIN_EYE_H);
      far = Math.max(far, Math.hypot(fb.x - p.x, fb.y - p.y));
    }
    expect(cuts).toBeGreaterThan(5);
    expect(sides.size).toBe(2);                                // both sides, turn about
    expect(far).toBeLessThan(60);                              // the plane is never a speck
  });
  it('a plane low over the ground still has the camera above it', () => {
    const fb = newFlyby(); flybyStep(fb, { x: 0, y: 0, h: 0.2 }, 6, 0, 1, 0, 30);
    expect(fb.h).toBeGreaterThan(MIN_EYE_H);
  });
  it('moves when the plane turns away and never comes by', () => {
    const fb = newFlyby(), p = { x: 0, y: 0, h: 4 }; flybyStep(fb, p, 10, 0, 1, 0, 9); const x0 = fb.x; let moved = false;
    for (let i = 0; i < 60 * 20 && !moved; i++) { p.x -= 10 / 60; moved = flybyStep(fb, p, -10, 0, -1, 0, 9); }   // it turned round and flew off the other way
    expect(moved).toBe(true);
    expect(fb.x).toBeLessThan(x0);
  });
  it('a plane that is hardly moving is watched from ahead of where it points', () => {
    const fb = newFlyby(); flybyStep(fb, { x: 0, y: 0, h: 4 }, 0, 0, 0, -1, 9);   // pointing north (y is south)
    expect(fb.y).toBeLessThan(0);
  });
});
