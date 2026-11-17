/**
 * Bóbr world map, part 4: the paper plane. Ported from Android's `InfiniteMapScreen` flight code: a joystick (or keys) flies the
 * plane, the speed preset keeps it going, the cruise mode flies Android's figure-eight, and pitch picks one of 10 cloud layers,
 * which sets the parallax (high = slower ground) and the sprite size.
 * Positions are in tiles; the heading is an angle in radians (0 east, pi/2 north) like Android's wind and course.
 */
export type FlightMode = 'off' | 'manual' | 'cruise' | 'glide';
export interface Flight {
  x: number; y: number;           // plane position in world tiles
  heading: number;                // radians, 0 = east, pi/2 = north
  course: number;                 // the way the view looks and the arrows are counted from: the heading, except that a glider's holds through loops and rolls
  mode: FlightMode;
  speed: number;                  // 0..10 preset (manual mode)
  pitch: number;                  // -45..45 degrees; up = lower layer number (closer)
  cruiseTime: number;
  layerTime: number;
  glideAlt?: number;              // 'glide' mode: height above the ground in metres (see glider.ts); it decides the layer
  glideLanded?: boolean;
}
export const MAX_TILES_PER_SECOND = 14;     // speed 10 (Android: 800 px/s)
export const CRUISE_SPEED = 200;
export const newFlight = (x = 0, y = 0): Flight => ({ x, y, heading: Math.PI / 2, course: Math.PI / 2, mode: 'off', speed: 0, pitch: 0, cruiseTime: 0, layerTime: 0 });

/** Layer 1 (closest) .. 10 (farthest): the cruise bobs up and down on a 12 second sine, otherwise pitch decides. */
export function currentLayer(f: Flight): number {
  if (f.mode === 'glide' && f.glideAlt !== undefined) return 1 + (1 - Math.max(0, Math.min(1, f.glideAlt / 120))) * 9;
  if (f.mode === 'cruise') return 1 + ((Math.sin((f.layerTime * 2 * Math.PI) / 12) + 1) / 2) * 9;
  return 1 + (1 - (f.pitch + 45) / 90) * 9;
}
/** Ground speed multiplier: 1.0 at layer 1 down to 0.5 at layer 10. */
export const parallax = (layer: number) => 1 - ((layer - 1) / 9) * 0.5;
/** Sprite size multiplier: 1.45 at layer 1 down to 1.0 at layer 10. */
export const layerScale = (layer: number) => 1 + (1 - layer / 10) * 0.5;

/** Android's cruise pattern: north -> south (S-curve), south -> west (quarter turn), west -> east (S-curve), east -> north. Returns the pan velocity. */
export function cruiseVelocity(cruiseTime: number): { vx: number; vy: number } {
  const PI = Math.PI, patternSpeed = 0.0125, base = 6;
  const t = (cruiseTime * patternSpeed) % (4 * PI);
  if (t < PI) { const l = t / PI; return { vx: 0, vy: -base * 2 * ((6 * l * (1 - l)) / PI) * patternSpeed }; }
  if (t < 2 * PI) { const a = ((t - PI) / PI) * (PI / 2), d = patternSpeed * (PI / 2); return { vx: -base * Math.cos(a) * d, vy: base * Math.sin(a) * d }; }
  if (t < 3 * PI) { const l = (t - 2 * PI) / PI; return { vx: base * 2 * ((6 * l * (1 - l)) / PI) * patternSpeed, vy: 0 }; }
  const a = ((t - 3 * PI) / PI) * (PI / 2), d = patternSpeed * (PI / 2);
  return { vx: -base * Math.sin(a) * d, vy: base * Math.cos(a) * d };
}

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
  } else if (f.mode === 'cruise') {
    f.cruiseTime += dt; f.layerTime += dt;
    const { vx, vy } = cruiseVelocity(f.cruiseTime);
    const k = (CRUISE_SPEED * par * dt) / 16;      // Android's px at ~16 px tiles
    f.x -= vx * k; f.y -= vy * k;                  // Android moved the map, so the plane goes the other way
    if (vx !== 0 || vy !== 0) f.heading = Math.atan2(vy, -vx);
  }
  if (f.mode !== 'cruise') f.layerTime = 0;
  return layer;
}
