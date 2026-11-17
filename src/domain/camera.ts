/**
 * Bóbr world map, part 5: the 3rd-person camera and billboard trees. Android only has these as plans
 * (THIRD_PERSON_CAMERA_IDEA/IMPLEMENTATION/REVIEW.md; nothing in its code), so this is the plan built, with its review's fixes:
 *  - the camera looks ahead of the plane by a distance and eases there (the plan's lerp of 0.15 per frame, made frame-rate
 *    independent); it eases back to centre when the plane is not flying;
 *  - the plane is drawn where it really is (behind the middle of the view). The plan kept the sprite in the middle, which would
 *    have shown the ground of a point ahead of the plane under it;
 *  - billboards: the plan rotates every tree around its centre by the angle to the camera (+90), which makes trees spin on the
 *    spot. From a camera above the middle of the view, an upright object leans away from the middle, so a tree is sheared
 *    outward from its base instead, more the farther it is, and stretched or squashed a little by how far below or above the
 *    middle it stands; closer trees are slightly bigger. Beyond the maximum distance trees stay upright and plain.
 *  - the plan's layer parallax offset for billboards is dropped (it would slide trees off their tiles); the layer only calms the lean.
 */
import { parallax, type Flight } from './flight';

export const DEFAULT_CAMERA_DISTANCE = 12;      // tiles the view looks ahead at full speed (the slider's cap); it starts at 0 and grows with speed
export const MAX_CAMERA_DISTANCE = 12;
export const FLAT_VIEW_MIN_LOOK = 6;            // tiles: with the view flat (tilt 0) the plane must stay above the glide button / instrument, so it never looks less far ahead
export const TILT_FLAT_ALTITUDE = 190;          // m: the tilt starts at its slider value on the ground and fades to flat (0) at this height
export const FULL_LOOK_AIRSPEED = 15;           // m/s of the glider at which the view looks the full distance ahead
export const MAX_TILT_STEP = 16;                // the tilt slider's top step
export const CAMERA_RATE = 9;                   // 1/s of the easing (about the plan's 0.15 per frame at 60 fps)
export const BILLBOARD_MAX_DISTANCE = 800;      // px, as in the plan
export const BILLBOARD_RANGE_CHUNKS = 3;

/** Is the plane moving by itself or by the stick? (Android's `isFlying`.) */
export const isFlying = (f: Flight, stickActive: boolean) => stickActive || f.mode === 'cruise' || (f.mode === 'glide' && !f.glideLanded) || (f.mode === 'manual' && f.speed >= 0.1);

/** Where the camera wants to be relative to the plane, in tiles: ahead along the heading. */
export function chaseOffset(heading: number, distance: number): { x: number; y: number } {
  return { x: Math.cos(heading) * distance, y: -Math.sin(heading) * distance };
}

/** 1 on the ground, 0 at `TILT_FLAT_ALTITUDE` and above: how much of the chosen tilt is left at this height. */
export const tiltAltitudeFactor = (altitude: number) => Math.max(0, Math.min(1, 1 - altitude / TILT_FLAT_ALTITUDE));

/**
 * How far ahead of the plane the view looks, in tiles: nothing when still, more the faster it goes (`speed01` 0..1 of full speed, up to
 * `cap`), but never less than 6 when the view is flat (`tiltNow` 0) because the plane would hide behind the controls; the floor melts
 * away as the view tips (`tiltNow` is in slider steps, 0..16).
 */
export function lookAhead(speed01: number, cap: number, tiltNow: number): number {
  const floor = FLAT_VIEW_MIN_LOOK * (1 - Math.max(0, Math.min(1, tiltNow / MAX_TILT_STEP)));
  return Math.max(floor, Math.max(0, Math.min(1, speed01)) * Math.max(0, cap));
}

/** Ease `cur` towards `target` (frame-rate independent). */
export function easeOffset(cur: { x: number; y: number }, target: { x: number; y: number }, dt: number, rate = CAMERA_RATE) {
  const k = 1 - Math.exp(-rate * dt);
  return { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k };
}

export interface Lean { shear: number; stretch: number; scale: number }
/**
 * How to draw an upright sprite standing at (dx, dy) pixels from the middle of the view. `shear` slides the top sideways per pixel of
 * height, `stretch` scales its height, `scale` its overall size. Returns upright and plain beyond `maxDistance`.
 */
export function billboardLean(dx: number, dy: number, layer: number, maxDistance = BILLBOARD_MAX_DISTANCE): Lean {
  const d = Math.hypot(dx, dy);
  if (!(maxDistance > 0) || d > maxDistance) return { shear: 0, stretch: 1, scale: 1 };
  const k = parallax(layer);                              // 1 near the ground .. 0.5 high up: a high camera sees less lean
  return {
    shear: (dx / maxDistance) * 0.5 * k,
    stretch: 1 + (dy / maxDistance) * 0.3 * k,
    scale: 1 + (1 - d / maxDistance) * 0.35,              // closer trees are a bit bigger (the plan's 0.3x..2x was too wild)
  };
}
