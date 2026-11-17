import { describe, expect, it } from 'vitest';
import { buildFrame, frameOr, resolveFrame, splitFrame } from './themes';

describe('frame ids: name[~hue][:edges[:center[:scale]]]', () => {
  it('split and build round-trip, leaving trailing parts out', () => {
    for (const id of ['gold', 'gold~120', 'gold:repeat', 'gold~60:mirror:random', 'gold::random', 'gold:::64', 'gold~180:random::32']) expect(buildFrame(splitFrame(id))).toBe(id);
    expect(splitFrame('gold~120:repeat:random:16')).toEqual({ name: 'gold', hue: 120, edges: 'repeat', center: 'random', scale: '16' });
    expect(buildFrame({ name: 'gold', hue: 0, scale: '64' })).toBe('gold:::64');
  });
  it('frameOr accepts only known names, hues, edges, centres and corner sizes', () => {
    expect(frameOr('gold:::64', 'app')).toBe('gold:::64');
    // the old Tiny (4) and Small (8) corners are gone: saved ids with them now mean Normal
    expect(splitFrame('gold:::4').scale).toBe('16');
    expect(splitFrame('gold:::8').scale).toBe('8');
    expect(frameOr('gold:::8', 'app')).toBe('gold:::8');
    expect(frameOr('gold:::5', 'app')).toBe('app');
    expect(frameOr('gold:::7', 'app')).toBe('app');
    expect(frameOr('gold~61', 'app')).toBe('app');
    expect(frameOr('gold:wavy', 'app')).toBe('app');
    expect(frameOr('nope', 'app')).toBe('app');
  });
  it("resolveFrame: an element's own choice wins, 'app' inherits the main frame (name, hue, corner size)", () => {
    expect(resolveFrame('gold:repeat::32', 'green_bev', 'mirror', 'clean')).toMatchObject({ name: 'gold', edges: 'repeat', center: 'clean', scale: 32 });
    expect(resolveFrame('app', 'blue~120:::64', 'mirror', 'clean')).toMatchObject({ name: 'blue', hue: 120, edges: 'mirror', scale: 64 });
    expect(resolveFrame('app:::16', 'blue:::64', 'mirror', 'clean').scale).toBe(16);
    expect(resolveFrame('gold', 'blue:::64', 'mirror', 'clean').scale).toBeUndefined();
  });
});
