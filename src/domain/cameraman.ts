/**
 * Bóbr world map: the cameraman. Three ways to watch the paper plane, changed with C (or the camera button):
 *  - chase: the view sits behind the plane and turns with its course (the view the map always had); the wheel zooms it;
 *  - free:  the camera orbits the plane wherever it is dragged to and stays there; the wheel is how far out it sits;
 *  - duel:   (dogfight) the camera sits behind your plane and a little above, looking over it at the opponent: both planes are always in view, whatever the gap;
 *  - flyby: the camera stands still at a spot ahead of the plane and beside its path, and turns to watch it go by. Once the plane is
 *           past and well away (or has turned off somewhere else) it cuts to a new spot ahead, on the other side.
 * Pure: positions are in tiles as the world map has them (x east, y SOUTH), heights in tiles above the ground.
 */
export type CamMode = 'chase' | 'free' | 'flyby' | 'duel';
export const CAM_MODES: readonly CamMode[] = ['chase', 'free', 'flyby', 'duel'];

/** The next mode round. `poseOk` false (no 3D view, or not gliding) leaves only the chase view. */
export function nextCamMode(m: CamMode, poseOk = true): CamMode {
  if (!poseOk) return 'chase';
  return CAM_MODES[(CAM_MODES.indexOf(m) + 1) % CAM_MODES.length];
}

/** What the wheel changes in each mode: chase = how big the map is drawn (x); free = the orbit's radius; flyby = how far from the path it stands (tiles); duel = how much room is left round the two planes (x). */
export const ZOOM_RANGE: Record<CamMode, readonly [number, number]> = { chase: [0.5, 40], free: [2.5, 60], flyby: [3, 40], duel: [0.6, 3] };
export const ZOOM_DEFAULT: Record<CamMode, number> = { chase: 2, free: 12, flyby: 9, duel: 1 };
export const clampZoom = (m: CamMode, v: number) => Math.max(ZOOM_RANGE[m][0], Math.min(ZOOM_RANGE[m][1], v));
/** Wheel up (a negative delta, in pixels) always brings the plane closer: the chase view grows, the other two move in. */
export function zoomBy(m: CamMode, cur: number, deltaY: number): number {
  const k = Math.exp(Math.max(-1, Math.min(1, deltaY * 0.0015)));
  return clampZoom(m, m === 'chase' ? cur / k : cur * k);
}
/** The same for a pinch: `ratio` is how much further apart the fingers are now (over 1 = spread = closer). */
export const pinchBy = (m: CamMode, cur: number, ratio: number) => clampZoom(m, m === 'chase' ? cur * ratio : cur / ratio);

export interface Vec3h { x: number; y: number; h: number }
export const MIN_EYE_H = 0.4;                 // tiles: the camera never goes into the ground
export const FREE_TILT_RANGE: readonly [number, number] = [0.05, 1.75];   // rad from straight down: 0 looks down on the plane, pi/2 is level with it, more looks up at it

/** The orbit's eye: `radius` from the target, looking along the ground direction (dirX, dirY), `tilt` radians from straight down. */
export function orbitEye(t: Vec3h, dirX: number, dirY: number, tilt: number, radius: number, minH = MIN_EYE_H): Vec3h {
  const st = Math.sin(tilt), ct = Math.cos(tilt);
  return { x: t.x - dirX * radius * st, y: t.y - dirY * radius * st, h: Math.max(minH, t.h + radius * ct) };
}

export interface Flyby { on: boolean; x: number; y: number; h: number; side: number; lead: number }
export const newFlyby = (): Flyby => ({ on: false, x: 0, y: 0, h: MIN_EYE_H, side: 1, lead: 0 });
export const FLYBY_LEAD_TIME = 2.5;           // s of flying from where the plane is to abeam of the camera
export const FLYBY_LEAD: readonly [number, number] = [8, 45];   // tiles

/**
 * Keep the flyby camera where it is, or park it again. `plane` is where the plane is, (vx, vy) its speed over the ground in tiles a
 * second and (hx, hy) the way it points (used when it is hardly moving), `dist` how far beside the path the camera stands.
 * Returns true when it has just moved (a cut).
 */
export function flybyStep(fb: Flyby, plane: Vec3h, vx: number, vy: number, hx: number, hy: number, dist: number, k = 1): boolean {   // k: how much smaller than the usual the plane (and so the whole camera) is
  const sp = Math.hypot(vx, vy), dx = sp > 0.5 ? vx / sp : hx, dy = sp > 0.5 ? vy / sp : hy;
  if (fb.on) {
    const rx = plane.x - fb.x, ry = plane.y - fb.y, d = Math.hypot(rx, ry), past = rx * dx + ry * dy > 0;
    const gone = past && d > Math.max(dist * 1.5, fb.lead * 0.9);              // it has gone by and is small again
    const lost = d > fb.lead + dist * 2 + 15 * k;                                 // it turned away and never came by
    if (!gone && !lost) return false;
  }
  const lead = Math.max(FLYBY_LEAD[0] * k, Math.min(FLYBY_LEAD[1] * k, sp * FLYBY_LEAD_TIME));
  fb.side = fb.on ? -fb.side : fb.side;                                      // the other side of the path each time
  fb.x = plane.x + dx * lead - dy * fb.side * dist; fb.y = plane.y + dy * lead + dx * fb.side * dist;
  fb.h = Math.max((MIN_EYE_H + 0.1) * k, plane.h + (fb.side > 0 ? -0.25 : 0.2) * dist);   // from one side it looks up at the plane, from the other down on it
  fb.lead = lead; fb.on = true;
  return true;
}

/**
 * The duel camera. `me` and `foe` are the two planes (tiles, y south, heights in tiles). The eye looks at the middle of the pair along the line
 * from you to the opponent, from behind you, far enough out that both fit; `ang` is that line's heading, which the caller eases so the view
 * does not snap. With no opponent it just orbits behind the plane along its heading. Returns the point looked at and where the eye is.
 */
export function duelLine(me: Vec3h, foe: Vec3h | null, heading: number[]): { ang: number; gap: number } {
  if (!foe) return { ang: Math.atan2(heading[1], heading[0]), gap: 0 };
  const dx = foe.x - me.x, dy = foe.y - me.y, hz = Math.hypot(dx, dy);
  return { ang: hz > 0.5 ? Math.atan2(dy, dx) : Math.atan2(heading[1], heading[0]), gap: Math.hypot(dx, dy, foe.h - me.h) };
}
export function duelPose(me: Vec3h, foe: Vec3h | null, ang: number, tilt: number, zoom: number, k = 1, minH = MIN_EYE_H): { target: Vec3h; eye: Vec3h } {
  const target = foe ? { x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2, h: (me.h + foe.h) / 2 } : me;
  const gap = foe ? Math.hypot(foe.x - me.x, foe.y - me.y, foe.h - me.h) : 0;
  const radius = Math.max(9 * k, gap * 0.75 + 8 * k) * zoom;
  return { target, eye: orbitEye(target, Math.cos(ang), Math.sin(ang), tilt, radius, minH) };
}
