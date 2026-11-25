/**
 * Bóbr world map, part 4: the paper plane. Ported from Android's `InfiniteMapScreen` flight code: a joystick (or keys) flies the
 * plane, the speed preset keeps it going, and pitch picks one of 10 cloud layers,
 * which sets the parallax (high = slower ground) and the sprite size.
 * Positions are in tiles; the heading is an angle in radians (0 east, pi/2 north) like Android's wind and course.
 */
export type FlightMode = 'off' | 'manual' | 'glide';
export interface Flight {
  x: number; y: number;           // plane position in world tiles
  heading: number;                // radians, 0 = east, pi/2 = north
  course: number;                 // the way the view looks and the arrows are counted from: the heading, except that a glider's holds through loops and rolls
  mode: FlightMode;
  speed: number;                  // 0..10 preset (manual mode)
  pitch: number;                  // -45..45 degrees; up = lower layer number (closer)
  glideAlt?: number;              // 'glide' mode: height above the ground in metres (see glider.ts); it decides the layer
  glideLanded?: boolean;
}
export const MAX_TILES_PER_SECOND = 14;     // speed 10 (Android: 800 px/s)
export const newFlight = (x = 0, y = 0): Flight => ({ x, y, heading: Math.PI / 2, course: Math.PI / 2, mode: 'off', speed: 0, pitch: 0 });

/** The plane's place after it crossed a cut edge of the cube planet: at the canonical net point, the heading and course turned with it (the map's y is south, a heading's y north). */
export function reframeFlight(f: Flight, c: { x: number; y: number; a: number; b: number; c: number; d: number }): void {
  const turn = (a: number) => { const dx = Math.cos(a), dy = -Math.sin(a), tx = c.a * dx + c.b * dy, ty = c.c * dx + c.d * dy; return Math.atan2(-ty, tx); };
  f.x = c.x; f.y = c.y; f.heading = turn(f.heading); f.course = turn(f.course);
}
/** Layer 1 (closest) .. 10 (farthest): the glider's height, otherwise pitch decides. */
export function currentLayer(f: Flight): number {
  if (f.mode === 'glide' && f.glideAlt !== undefined) return 1 + (1 - Math.max(0, Math.min(1, f.glideAlt / 120))) * 9;
  return 1 + (1 - (f.pitch + 45) / 90) * 9;
}
/** Ground speed multiplier: 1.0 at layer 1 down to 0.5 at layer 10. */
export const parallax = (layer: number) => 1 - ((layer - 1) / 9) * 0.5;
/** Sprite size multiplier: 1.45 at layer 1 down to 1.0 at layer 10. */
export const layerScale = (layer: number) => 1 + (1 - layer / 10) * 0.5;

export interface FlightInput { dx: number; dy: number }   // joystick / keys, -1..1, screen axes (dy down)

/**
 * Advance the plane by dt seconds. The joystick overrides the mode while held (Android switched to manual and restored the
 * preset on release; here the preset is simply left alone). Returns the layer so the view can use it.
 */
export function stepFlight(f: Flight, input: FlightInput, dt: number): number {
  const layer = currentLayer(f), par = parallax(layer);
  const mag = Math.min(1, Math.hypot(input.dx, input.dy));
  if (mag > 0.01) {
    const angle = Math.atan2(-input.dy, input.dx);
    f.heading = angle;
    const v = mag * MAX_TILES_PER_SECOND * par;
    f.x += Math.cos(angle) * v * dt; f.y += -Math.sin(angle) * v * dt;
  } else if (f.mode === 'manual' && f.speed >= 0.1) {
    const v = (f.speed / 10) * MAX_TILES_PER_SECOND * par;
    f.x += Math.cos(f.heading) * v * dt; f.y += -Math.sin(f.heading) * v * dt;
  }
  return layer;
}
