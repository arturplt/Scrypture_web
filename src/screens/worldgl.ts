/**
 * Bóbr world map, the 3D view: the same world drawn through a real camera in WebGL 2 instead of a flat canvas the browser tips.
 *
 * World space is in tiles: X east, Y south (the map's own axes), Z DOWN, so a height h above the ground is z = -h. The camera hangs
 * behind and above a target point on the ground: `tilt` 0 looks straight down (the flat map), larger tips it back towards the horizon,
 * and (upX, upY) is the ground direction that points up the screen (north, or the plane's heading in the chase view).
 *
 * What is drawn:
 *  - ground: one textured quad per chunk (the chunk's canvas as a mip-mapped texture, so far ground does not shimmer);
 *  - decals lying on the ground (shadows, thermal haze, the river debug dots): blended, no depth write;
 *  - upright sprites (trees, bushes, rocks) and the plane: alpha-tested with depth;
 *  - translucent sprites (clouds, rain, dust motes), sorted back to front.
 * Sprites face the camera ("billboards"), so trees and clouds stand up whatever the tilt and turn. Everything fades into the sky colour
 * with distance, so ground that is not drawn beyond the far limit is never missed.
 * All sprites come from one atlas: the sheet plus a few extra cells (shadow, a white dot, a haze gradient, the cloud pictures).
 */
import type { TerraceMesh } from '../domain/terrace';
import { TILE_PX, sunElevation } from '../domain';
import { bandGlsl } from '../domain/terrace';
import { dbgBits, dbgOn } from '../domain/dbg';
import { CLOUD_W, CLOUD_H, loadSkyBands, silhouette } from './cloudsprites';
import { FLAME_W, FLAME_H, BOLT_W, BOLT_H } from './firesprites';
import { BEAVER_W, BEAVER_H } from './beaversprites';

/** Add to a sprite's alpha to draw it at its own brightness whatever the hour (fire, lightning). */
export const GLOW = 2;
import MOON_URL from '../assets/moon.png';   // the moon: pixel art with a transparent background, drawn as a disc facing you
import STARS_URL from '../assets/milkyway.png';   // a square night sky, seen from straight below its middle: the zenith is the centre, the horizon its rim
// the skyline layers, 2172 x 724 pixel art with transparency, each laid round the sky as a band (mirrored, so it wraps without a seam):
// wispy cirrus high up, stratocumulus, cumulus nearer the horizon, then the mountain range and the tree line in front of them all
// (cirrus, stratocumulus and cumulus are built from every picture in public/assets/Clouds: see loadSkyBands)
import MOUNTAIN_URL from '../assets/mountainrange.png';
import TREELINE_URL from '../assets/treeline.png';

const VS = `#version 300 es
in vec3 aPos; in vec2 aUv; in vec4 aCol;
uniform float uFar, uHole, uBand, uTerrace; uniform int uDbg;   // (uDbg: the ?dbg= bisect switches, see domain/dbg.ts)
// (a far level is sunk a little where it overlaps the finer ground, see below)
uniform mat4 uVP; uniform vec3 uEye; uniform float uCurveC;   // uCurveC: the planet's curve high up (tiles of drop per tile squared of distance from the eye; 0 low down)
out vec2 vUv; out vec4 vCol; out vec3 vPos;
void main() { vec3 p = aPos; vec2 d = p.xy - uEye.xy; p.z += uCurveC * dot(d, d);
  // The far levels' coarse triangles run in slopes from one terrace to the next, so over a ledge they lie above the finer ground they are meant to sit under, and show through it as wedges that flicker as the view moves (worse where the depth buffer is short on precision: phones). Where a far level overlaps the finer ground, and for a few tiles past it, it is sunk most of a layer, so it lies under that ground; beyond that it fades back up to its own height.
  if (uFar > 0.5 && uTerrace > 0.0 && (uDbg & 4) == 0) p.z += uTerrace * 0.7 * (1.0 - smoothstep(uHole + uBand, uHole + uBand + 24.0, length(d)));
 gl_Position = uVP * vec4(p, 1.0); vUv = aUv; vCol = aCol; vPos = aPos; }   // (the ground falls away from under the eye as a paraboloid, the small planet's surface; z is down)   // (the distance is taken per pixel: a ground quad is a whole chunk, and seen from the ground its corners say nothing about the fog in between)`;
const FS = `#version 300 es
precision highp float; precision highp sampler2D; precision highp int;
in vec2 vUv; in vec4 vCol; in vec3 vPos;
uniform vec3 uEye; uniform sampler2D uTex; uniform float uCut; uniform vec3 uFog; uniform vec2 uFogRange; uniform vec4 uBase; uniform vec4 uNight;   // uBase: the water colour (rgb) to put under see-through ground, when a > 0.5
uniform int uDbg; uniform float uFx, uTime, uDay, uTileUv, uTerr, uFar, uHole, uHoleMax, uBand, uBandOut, uTerrace, uSurf; uniform vec3 uSun, uZen, uLight;   // uFx: the pretty extras on or off; uTileUv: one tile in the ground texture; uLight: the sunlight's tint
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
// how much a ground colour is water: the sheet's water is the only thing that is blue over green over hardly any red
float isWater(vec3 c) { return smoothstep(0.05, 0.10, c.b - c.g) * smoothstep(0.18, 0.28, c.g - c.r); }
${bandGlsl()}   // (the terraced world's grass tint ramp, written from terrace.ts so the shader, the maps and the far mesh share one table)
float waterAt(vec2 uv, vec2 dx, vec2 dy) { vec4 s = textureGrad(uTex, uv, dx, dy); return isWater(mix(uBase.rgb, s.rgb, s.a)); }
void main() {
  // The rings of detail hand over to each other in a band, not along a line: in the band both layers are drawn, each in the pixels the screen's noise gives it (the two patterns are exact opposites, so there is no gap and no double
  // pixel), and the share goes from all the finer one to all the coarser one across it. A ring edge, where the coarse ground is a different shape, shade and detail, is then a stipple, not a seam.
  // (the screen derivatives and every texture read that needs them come first, before any discard: a pixel thrown away below is a quad-mate whose derivatives the others still need, and phones' GPUs, which end a discarded pixel at once, give the rest of its quad garbage for them: texture shimmer along the rings' stipple, moving with the view)
  vec2 dUx = dFdx(vUv), dUy = dFdy(vUv), fw = fwidth(vPos.xy);
  float fwLv = fwidth(-vPos.z / max(uTerrace, 1e-3));
  vec4 tex0 = textureGrad(uTex, vUv, dUx, dUy);
  float dn = (uDbg & 8) != 0 ? 0.5 : fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));   // (nostipple: every pixel has the same share, so the hand-over is a clean cut half way across the band)
  if (uFar > 0.5) {          // a far level: from uHole (where it starts to show through the finer one) to uHoleMax (where it has given way to the next, coarser, one)
    float fd = distance(vPos.xy, uEye.xy);
    if (fd < uHole || fd > uHoleMax) discard;
    if (dn >= smoothstep(uHole, uHole + uBand, fd)) discard;
    if (uBandOut > 0.0 && dn < smoothstep(uHoleMax - uBandOut, uHoleMax, fd)) discard;   // (the last level has no coarser one to give way to)
  } else if (uTerr > 0.5 && uBase.a > 0.5 && uHoleMax > 0.0) {   // a real chunk (the ground of the near ring): it gives way to the far mesh across uHole .. uHole + uBand, the first far level's own entry band
    float fd = distance(vPos.xy, uEye.xy);
    if (fd > uHole + uBand || dn < smoothstep(uHole, uHole + uBand, fd)) discard;
  }
  vec4 tint = vCol; float lit = 0.0, fxq = 0.0;
  vec3 tn = vec3(0.0, 0.0, -1.0);
  float flatK = 1.0;                                                         // how level the ground is here: the water's ripples and glitter only lie on level water, a steep bank is plain colour
  float bedD = 1.0;                                                          // ... and how many layers (1 .. 5) below the surface it lies
  float bedK = 0.0;                                                          // how far this ground lies under inland water (the mesh marks it in the colour's alpha)
  if (uTerr > 0.5 && uBase.a > 0.5) { bedK = 1.0 - smoothstep(0.6, 0.9, vCol.a); bedD = clamp(floor((0.55 - vCol.a) / 0.02 + 0.5), 1.0, 5.0); tn = normalize(vCol.rgb * 2.0 - 1.0); tint = vec4(1.0); flatK = smoothstep(0.82, 0.96, -tn.z); }   // a terrain chunk: the colour carries the ground's normal (z is down, so up is -z), the picture is untinted
  if (uTerr > 0.5 && uBase.a > 0.5 && uSurf < 0.5 && uTerrace > 0.0 && abs(tn.z) < 0.02 && ((uDbg & 64) != 0 || dot(vPos - uEye, tn) > 0.0)) discard;   // a terrace wall seen from behind (looking down the hill: it faces downhill): not drawn, the shelf's own edge is what you see there
  if ((uDbg & 16) != 0 && uTerr > 0.5 && uBase.a > 0.5 && uSurf < 0.5 && vPos.z > 0.01) discard;   // nosea: the sea's stepped bed is not drawn (its sheet, below, is opaque)
  if (tint.a > 3.5) { fxq = 1.0; tint.a -= 4.0; }                           // alpha + 4 marks a drawn effect (see FX_*): the quad has no picture, its colour is worked out here; r = which, g and b = its numbers
  if (tint.a > 1.5) { lit = 1.0; tint.a -= 2.0; }                           // alpha + 2 marks a sprite that gives its own light (fire, lightning): no sun tint, no night
  vec4 c = tex0 * tint;
  if (uTerr > 0.5 && uBase.a > 0.5 && uTerrace > 0.0 && uSurf < 0.5 && uFar < 0.5) {   // a terraced chunk's picture: each tile's layer rides in its alpha. A pixel belongs to its tile's shelf; where the ground it lands on is another shelf (the contours cut across the tiles' squares), take the same pixel of the nearest tile on this shelf instead (up to two tiles out), so the texture fills every terrace and never spills over a wall
    vec2 gx = dUx, gy = dUy;
    float fl = floor(-vPos.z / uTerrace + 0.04), want = mod(fl + (abs(tn.z) < 0.5 ? 1.0 : 0.0), 16.0);   // (a wall belongs to the shelf it climbs to: it takes that shelf's picture)
    // (the tile's layer is read at the finest level, always: from a distance, or on a screen drawn at a lower resolution, the mip levels blur the alpha into nonsense)
    if ((uDbg & 1) == 0 && floor((1.0 - textureLod(uTex, vUv, 0.0).a) * 255.0 + 0.5) != want) {
      vec2 f = fract(vUv / uTileUv), sg = vec2(f.x < 0.5 ? -1.0 : 1.0, f.y < 0.5 ? -1.0 : 1.0);
      const ivec2 NB[24] = ivec2[24](ivec2(1, 0), ivec2(0, 1), ivec2(1, 1), ivec2(-1, 0), ivec2(0, -1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1),
        ivec2(2, 0), ivec2(0, 2), ivec2(2, 1), ivec2(1, 2), ivec2(2, 2), ivec2(-2, 0), ivec2(0, -2), ivec2(2, -1), ivec2(-1, 2), ivec2(1, -2), ivec2(-2, 1), ivec2(2, -2), ivec2(-2, 2), ivec2(-1, -2), ivec2(-2, -1), ivec2(-2, -2));
      for (int k = 0; k < 24; k++) {
        vec2 uv2 = vUv + vec2(float(NB[k].x) * sg.x, float(NB[k].y) * sg.y) * uTileUv;
        if (floor((1.0 - textureLod(uTex, uv2, 0.0).a) * 255.0 + 0.5) == want) { c = textureGrad(uTex, uv2, gx, gy); break; }
      }
    }
    c.a = 1.0;
  }
  if (uSurf > 0.5) c = vec4(mix(uBase.rgb, vec3(0.20, 0.40, 0.30), bedK * 0.8), 1.0);   // a sheet of inland water: the water's own colour (a beaver's pond, marked in the alpha, a murkier green), shaded as water below
  float vDist = distance(vPos, uEye), nk = clamp(uNight.a / 0.7, 0.0, 1.0);
  vec3 V = (vPos - uEye) / max(vDist, 1e-4), moon = vec3(0.0);
  if (fxq > 0.5) {
    float k = tint.g, sd = tint.b, t = uTime;
    vec2 ap = floor(vPos.xy * 16.0);                                        // the art pixel on the ground (16 to a tile), so the effects are as blocky as the tiles
    float n2 = hash(ap), rag = 1.0 - smoothstep(0.30, 0.50, length(vUv - 0.5) + (vnoise(ap / 5.0 + sd * 9.0) - 0.5) * 0.22);   // a ragged patch, not a square
    if (tint.r < 1.5) {
      // scorched grass: char and ash, darker in clumps, a few embers that breathe while it is fresh
      float n = vnoise(ap / 6.0 + 3.7);
      vec3 col = mix(vec3(0.045, 0.035, 0.03), vec3(0.17, 0.12, 0.085), n * 0.75 + n2 * 0.25);
      col = mix(col, vec3(0.40, 0.38, 0.36), step(0.93, n2) * 0.55);                                   // flecks of ash
      float em = step(0.95, hash(ap + 17.0)) * smoothstep(0.55, 0.95, k) * (0.45 + 0.55 * sin(t * 2.5 + n2 * 50.0));
      moon = vec3(1.0, 0.42, 0.08) * em * rag;                                                         // (added after the night, so the embers glow in the dark)
      c = vec4(col, rag * min(1.0, k * 1.4) * 0.88 * tint.a);
    } else if (tint.r < 2.5) {
      // a flame: a blocky tongue that narrows upwards, torn by noise that climbs through it; white-yellow heart, orange body, red tips
      vec2 g = vec2(16.0, 24.0), q = (floor(vUv * g) + 0.5) / g; float y = 1.0 - q.y, x = (q.x - 0.5) * 2.0;
      float n = vnoise(vec2(q.x * 5.0 + sd * 31.0, y * 4.0 - t * 3.4)), m = vnoise(vec2(q.x * 11.0 - sd * 17.0, y * 9.0 - t * 6.0));
      float body = 1.0 - abs(x) * (1.2 + y * 1.1) - y * 0.9 + (n - 0.5) * 0.8 * (0.3 + y) + (m - 0.5) * 0.28;
      vec3 col = body > 0.45 ? vec3(1.0, 0.95, 0.62) : body > 0.2 ? vec3(1.0, 0.64, 0.15) : vec3(0.92, 0.25, 0.06);
      float spark = step(0.992, hash(floor(vUv * g) + floor(t * 9.0) * 5.0)) * step(0.45, y) * step(abs(x), 0.6);   // sparks thrown up over it
      c = vec4(mix(col * 1.4, vec3(1.6, 1.1, 0.4), spark), max(step(0.0, body), spark) * tint.a);
    } else if (tint.r < 3.5) {
      // a wind tunnel: streaks of air running along the corridor (g = which way: +1 towards the quad's top), in lanes, fading at the sides and the ends
      float u = vUv.x, v = floor(vUv.y * 440.0) / 440.0, lane = floor(u * 18.0), lh = hash(vec2(lane, sd * 91.0));
      float ph = fract(v * (5.0 + 3.0 * lh) + k * t * (0.22 + 0.2 * lh) + lh * 7.0); if (k < 0.0) ph = 1.0 - ph;
      float dash = smoothstep(0.45, 1.0, ph) * step(ph, 0.99), line = step(abs(fract(u * 18.0) - 0.5), 0.09 + 0.07 * lh);
      float edge = smoothstep(0.0, 0.3, u) * smoothstep(1.0, 0.7, u) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
      c = vec4(vec3(0.92, 0.97, 1.0), dash * line * edge * 0.55 * tint.a);
    } else {
      // wet grass: darker and cooler, the sky's sheen at a low angle, puddles in the hollows with rings where drops fall, blades that glint
      float fres = pow(1.0 - clamp(V.z, 0.0, 1.0), 3.0);
      vec3 sky = mix(uFog, uZen, 0.55);
      float pud = smoothstep(0.60, 0.66, vnoise(ap / 14.0 + 11.0));
      vec2 cell = floor(vPos.xy * 2.0); float rp = fract(t * 0.8 + hash(cell) * 5.0);
      vec2 cc = (cell + 0.5 + (vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5) * 0.5) / 2.0;
      float ring = (1.0 - smoothstep(0.0, 0.035, abs(distance((ap + 0.5) / 16.0, cc) - rp * 0.22))) * (1.0 - rp);
      vec3 col = mix(vec3(0.03, 0.09, 0.08), sky, fres * 0.45);                                        // laid over the grass: it darkens it and lends it the sky
      float al = 0.34 + 0.25 * fres;
      col = mix(col, mix(vec3(0.10, 0.20, 0.24), sky, 0.3 + 0.5 * fres) + 0.3 * ring, pud); al = mix(al, 0.78, pud);
      float gl = step(0.988, hash(ap + floor(t * 6.0) * 3.0)) * (1.0 - pud) * uDay;
      col += vec3(0.75, 0.85, 0.8) * gl; al = max(al, gl * 0.9);
      c = vec4(col, al * rag * min(1.0, k * 2.0) * tint.a);
    }
  }
  if (uBase.a > 0.5) {   // ground: the water shows through the see-through tiles
    c.rgb = mix(uBase.rgb, c.rgb, c.a); c.a = 1.0;
    float wm = uFx > 0.5 ? isWater(c.rgb) * flatK * (1.0 - smoothstep(90.0, 130.0, vDist)) : 0.0;   // (the ripples and glitter, with all their texture reads, fade out by 130 tiles: far water is a plain colour)
    if (wm > 0.01) {     // living water: ripples, the sky mirrored at shallow angles, the sun's glitter, foam along the shore
      vec2 wq = mod(vPos.xy, 256.0);
      float texel = max(fw.x, fw.y) * 16.0, t = uTime;                    // screen pixels per art pixel, upside down: under 1 the art pixels are big, so everything snaps to them
      vec2 wp = texel < 1.0 ? (floor(wq * 16.0) + 0.5) / 16.0 : wq;
      float ph = vnoise(wp * 0.7 + vec2(t * 0.05, 0.0)) * 6.2831853, h = 0.0; vec2 grad = vec2(0.0);
#define WAVE(d, k, s, a) { float q = dot(wp, d) * k + t * s + ph; h += a * sin(q); grad += a * k * d * cos(q); }
      WAVE(vec2(0.80, 0.60), 2.1, 1.3, 0.50)
      WAVE(vec2(-0.45, 0.89), 3.7, -1.7, 0.30)
      WAVE(vec2(0.97, -0.26), 6.3, 2.3, 0.20)
      vec3 N = normalize(vec3(grad * 0.045, -1.0)), Rf = reflect(V, N);  // (z is down, so the water's normal points to -z)
      float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 4.0);
      float rel = clamp(-Rf.z, 0.0, 1.0);
      vec3 skyc = mix(uFog, uZen, pow(rel, 0.5));
      skyc = mix(vec3(0.10, 0.18, 0.12) * (0.4 + 0.6 * uDay), skyc, smoothstep(0.02, 0.11, rel));   // low over the horizon the lake mirrors the tree line (not blank sky), so a far lake meets the forest instead of leaving a pale band
      vec3 w = c.rgb * (0.95 + 0.09 * h) + 0.07 * smoothstep(0.55, 0.75, h);   // darker troughs, a light line on the crests
      w = mix(w, skyc, fres * 0.6 * (1.0 - 0.9 * uSurf));   // (a sheet over a bed mirrors the sky less than open water: it would wash the bed out to lavender)
      float d1 = uTileUv * 0.10, d2 = uTileUv * 0.30;
      float s1 = 1.0 - 0.25 * (waterAt(vUv + vec2(d1, 0.0), dUx, dUy) + waterAt(vUv - vec2(d1, 0.0), dUx, dUy) + waterAt(vUv + vec2(0.0, d1), dUx, dUy) + waterAt(vUv - vec2(0.0, d1), dUx, dUy));
      float s2 = 1.0 - 0.25 * (waterAt(vUv + vec2(d2, 0.0), dUx, dUy) + waterAt(vUv - vec2(d2, 0.0), dUx, dUy) + waterAt(vUv + vec2(0.0, d2), dUx, dUy) + waterAt(vUv - vec2(0.0, d2), dUx, dUy));
      float foam = clamp(s1 * 2.0, 0.0, 1.0) * 0.7 + clamp(s2 * 2.0, 0.0, 1.0) * 0.4 * (0.5 + 0.5 * sin(t * 1.6 + ph * 2.0));
      w = mix(w, vec3(0.86, 0.95, 1.0), min(foam, 0.85) * (1.0 - uSurf));   // (foam is worked out from the picture's water and shore: over a sheet the picture is the bed's sand, which would foam all over)
      {   // pixel art: close up the water is not smooth shading but flat bands of colour, in art pixels (16 to a tile) that move in steps, like the sprites; far away, where the pixels are smaller than the screen's, it goes back to the smooth look above
        vec2 pq = (floor(wq * 16.0) + 0.5) / 16.0; float ts = floor(t * 4.0) / 4.0;
        float hv = vnoise(pq * vec2(1.6, 2.6) + vec2(ts * 0.30, ts * 0.10)) * 0.55 + vnoise(pq * vec2(3.4, 5.0) + vec2(-ts * 0.45, ts * 0.20) + 7.0) * 0.45;
        float lvl = floor(clamp((hv - 0.5) * 1.7 + 0.5, 0.0, 0.999) * 4.0);       // four bands: trough, body, swell, crest
        vec3 wx = c.rgb * (lvl < 0.5 ? 0.80 : lvl < 1.5 ? 0.93 : lvl < 2.5 ? 1.06 : 1.24);
        wx = mix(wx, skyc, floor(fres * 3.0 + 0.5) / 3.0 * 0.35 * (1.0 - 0.9 * uSurf));    // (the sky's sheen in three steps, not a gradient)
        float fq = step(0.5 + 0.35 * hash(floor(wq * 16.0) + floor(t * 3.0)), foam);    // the shore's foam: broken pixels, a few more of them nearer the bank
        wx = mix(wx, vec3(0.86, 0.95, 1.0), fq * (1.0 - uSurf));
        w = mix(wx, w, clamp(texel - 1.0, 0.0, 1.0));
      }
      float sp = mix(step(0.6, hash(floor(wq * 16.0) + floor(t * 8.0) * 7.0)), 0.4, clamp(texel - 1.0, 0.0, 1.0));   // glitter: art pixels that flash, evened out far away
      float sd = max(dot(Rf, uSun), 0.0), md = max(dot(Rf, -uSun), 0.0);
      w += vec3(1.0, 0.86, 0.6) * (pow(sd, 60.0) * (0.25 + 1.75 * sp) + 3.0 * pow(sd, 400.0)) * uDay;
      moon = vec3(0.75, 0.85, 1.0) * pow(md, 80.0) * (0.2 + 0.8 * sp) * nk * wm * 0.8;
      c.rgb = mix(c.rgb, w, wm);
    }
  }
  if (uTerr > 0.5 && uBase.a > 0.5 && uTerrace > 0.0) {   // a terraced world (terrace.ts): every layer a band of its own colour, the ledges between them earth walls with a light lip and a dark foot, after Godus
    float hgt = -vPos.z, lvs = hgt / uTerrace + 0.04, lay = floor(lvs), fr = clamp((lvs - lay - 0.04) / 0.96, 0.0, 1.0), up = -tn.z;   // (the ground is flat shelves with walls straight down between them: fr is how far up a wall this pixel is, 0 on a shelf; +0.04 keeps a shelf from flickering between two layers)
    float grassK = smoothstep(-0.02, 0.06, c.g - c.r);   // grass or sand, from the crisp picture: the pixel art stays
    vec3 base = c.rgb;
    float wq = isWater(c.rgb);
    float cycW = (uDbg & 2) != 0 ? 0.0 : 1.0 - smoothstep(0.12, 0.5, fwLv);   // (the layers' own colours only while a layer is wider than a few pixels: further off, or on a steep slope, they would be noise that shimmers as the view moves, so the plain ramp takes over)
    float wallK = 1.0 - smoothstep(0.80, 0.96, up);   // 1 on a wall, 0 on a shelf
    vec3 btUp = bandRamp(lay + 1.0) * mix(vec3(1.0), bandCyc(lay + 1.0), cycW);
    vec3 bt = mix(mix(bandRamp(lay), bandRamp(lay + 1.0), fr) * mix(vec3(1.0), mix(bandCyc(lay), bandCyc(lay + 1.0), fr), cycW), btUp, wallK);   // every layer its own colour; a wall is the colour of the shelf it climbs to
    vec3 land = base * mix(vec3(1.0), bt, grassK);
    float cliff = 1.0 - smoothstep(0.84, 0.97, up), slope = 1.0 - smoothstep(0.90, 0.995, up);
    // a wall is one flat colour: its picture is the shelf's, stretched up the wall, which smears every flower and blade of grass into a vertical streak. Sand where the shelf it climbs to is the beach, the shelf's grass colour elsewhere.
    vec3 wallC = mix(vec3(0.30, 0.50, 0.16) * btUp, vec3(0.90, 0.78, 0.54), step(lay + 1.0, 0.5));
    land = mix(land, wallC, wallK);
    land *= mix(1.0, 0.86, wallK);   // (the wall is a shade darker than the shelf above it; the light and the foot's crease below do the rest)
    land = mix(land, land * 1.14 + 0.03, smoothstep(0.75, 1.0, fr) * slope);   // the lip: a light edge along the top of every wall
    land = mix(land, land * 0.78, (1.0 - smoothstep(0.0, 0.25, fr)) * slope);   // the foot: a darker crease where a wall meets the shelf below
    // water lies on level ground only: a ramp face that happens to stand over a water tile (the rim of a lake, a pond or the sea) is ground like any other, except where the water is on its high side and
    // spills over (a few stretches of every rim, picked by a hash of the place): there it is a waterfall, falling streaks of foam and a white foot
    vec2 nd = normalize(tn.xy + vec2(1e-5)) * uTileUv * 0.45;
    float fallOn = cliff * step(0.5, waterAt(vUv - nd, dUx, dUy)) * (1.0 - step(0.5, waterAt(vUv + nd, dUx, dUy))) * step(0.7, hash(vec2(floor((vPos.x + vPos.y) * 0.2), floor((vPos.x - vPos.y) * 0.2))));
    vec3 fallC = mix(vec3(0.12, 0.46, 0.64), vec3(0.88, 0.96, 1.0), step(0.7, hash(vec2(floor((vPos.x + vPos.y) * 8.0), floor(hgt * 12.0 + uTime * 6.0)))) * 0.8 + (1.0 - smoothstep(0.0, 0.12, fr)) * 0.5);
    // the bed under water: flat colour a layer, light sand-green in the shallows down to deep blue, so the steps of the bed show through the water as bands
    vec3 bedC = bedD < 1.5 ? vec3(0.70, 0.86, 0.72) : bedD < 2.5 ? vec3(0.34, 0.68, 0.70) : bedD < 3.5 ? vec3(0.12, 0.48, 0.64) : bedD < 4.5 ? vec3(0.05, 0.32, 0.54) : vec3(0.03, 0.22, 0.44);
    c.rgb = mix(mix(land, c.rgb, wq * (1.0 - cliff)), fallC, fallOn);
    c.rgb = mix(c.rgb, bedC * mix(1.0, 0.74, cliff), bedK * (1.0 - step(0.5, uSurf)));
  }
  if (uFar > 0.5 && uTerrace > 0.0) {   // the far hills of a terraced world are too coarse to be cut into steps, so the terraces are drawn instead: a thin dark line (and every other band a shade darker) wherever the height crosses a layer. At every distance, in steps of 1, 2, 4 ... layers, whichever keeps a band at least about seven pixels wide, so a far mountain is terraced like the ground near it (fewer, wider steps), not smooth where the bands would be thinner than a pixel; the next size cross-fades in as the view opens or closes
    float lvf = -vPos.z / uTerrace, wf = max(fwLv, 1e-4), lod = clamp(log2(wf * 7.0), 0.0, 6.0), j = floor(lod), tj = lod - j;
    float lineF = 0.0, shadeF = 1.0;
    for (int k = 0; k < 2; k++) {
      float m = exp2(j + float(k)), wk = k == 0 ? 1.0 - tj : tj, u = lvf / m + 0.04 / m, wm = wf / m;
      lineF += wk * (1.0 - smoothstep(0.0, 1.5 * wm, fract(u))) * step(0.5, lvf);
      shadeF *= mix(1.0, mod(floor(u), 2.0) > 0.5 ? 0.93 : 1.0, wk);
    }
    c.rgb *= shadeF;
    c.rgb = mix(c.rgb, c.rgb * vec3(0.58, 0.50, 0.42), clamp(lineF, 0.0, 1.0) * 0.85);
  }
  if (uTerr > 0.5 && uBase.a > 0.5) {   // hill shading: slopes facing the sun are bright, those away from it dark; water (flat) keeps its own look
    float flatL = max(uSun.z * -1.0, 0.0), dif = max(dot(tn, uSun), 0.0), sh = (0.50 + 0.60 * dif) / (0.50 + 0.60 * flatL);
    c.rgb *= mix(clamp(sh, 0.45, 1.18), 1.0, isWater(c.rgb) * flatK);
  }
  float cur = (uSurf > 0.5 && uTerr > 0.5 && vCol.a < 0.4) ? 1.0 : 0.0;   // a waterfall's curtain (the mesh marks it with alpha 0.25): water falling from one surface to the lower one
  if (cur > 0.5) {
    if (dot(V, tn) > 0.0) discard;                                                   // seen from behind (from the high side, the way the water comes): not drawn, the wall is what stands there
    // pixel art, like the sprites: art pixels 16 to a tile, a palette of five colours and no blending between them, and the picture steps eight times a second, a whole pixel at a time
    vec2 tg = normalize(vec2(-tn.y, tn.x) + vec2(1e-5));                              // (the mesh gives a curtain its facing as its normal: along the wall runs the tangent, so the columns follow it at any angle)
    float hg = -vPos.z, lv2 = hg / max(uTerrace, 1e-3);
    float col = floor(dot(vPos.xy, tg) * 16.0), rowF = floor(hg * 16.0), step8 = floor(uTime * 8.0);
    float h1 = hash(vec2(col, 3.7)), h2 = hash(vec2(col * 0.37, 11.3));
    float speed = 1.0 + floor(h1 * 3.0);                                              // 1 to 3 pixels a step, column by column
    float period = 5.0 + floor(h2 * 7.0);                                             // each column's own rhythm of streaks
    float ph = mod(rowF + step8 * speed + floor(h2 * 40.0), period);                  // (+ time: the pattern climbs the rows, so on screen the water runs down)
    float quiet = step(h1, 0.22);                                                     // (some columns are only body: a fall is not a wall of foam)
    float edgePx = min(fract(lv2 + 0.02), 1.0 - fract(lv2 + 0.02)) * max(uTerrace, 1e-3) * 16.0;   // (art pixels to the nearest layer line: the lip of the fall and the splash at its foot)
    vec3 deep = vec3(0.09, 0.33, 0.52), mid = vec3(0.16, 0.50, 0.70), light = vec3(0.36, 0.72, 0.88), foam = vec3(0.82, 0.95, 1.0);
    vec3 body = mod(col, 2.0) < 1.0 ? mid : deep;                                     // (alternate columns a shade apart, the grain of the water)
    vec3 pix = body;
    if (quiet < 0.5) { if (ph < 1.0) pix = foam; else if (ph < 3.0) pix = light; else if (ph < 4.0) pix = mid; }
    if (edgePx < 1.2) pix = step(0.35, hash(vec2(col, step8))) > 0.5 ? foam : light;    // lip and foot: broken foam, a pixel high, flickering
    c.rgb = pix;
  }
  if (c.a < uCut) discard;
  vec3 fog = uFog;
  bool onGround = (uBase.a > 0.5 || uCut > 0.25) && uFar < 0.5;   // (the far fells fade into the sky's haze, not the grass plane)   // the ground and the solid sprites (trees, bushes, rocks); clouds and other blended sprites keep the sky
  if (onGround) fog = vec3(0.30, 0.46, 0.13) * (0.45 + 0.55 * uDay);          // the ground and what stands on it fade into the endless grass plane of the sky (same colour), never into grey sky: that left a grey line at its far edge
  if (uFx > 0.5) {
    if (lit < 0.5) c.rgb *= uLight;                                                           // warm light when the sun is low
    if (!onGround) fog += vec3(1.0, 0.78, 0.45) * 0.30 * pow(max(dot(V, uSun), 0.0), 14.0) * uDay;   // the haze glows towards the sun, as the sky behind it does
  }
  c.rgb = mix(c.rgb, fog, clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0));
  if (lit < 0.5) c.rgb = mix(c.rgb, uNight.rgb, uNight.a);                  // night: the same tint the flat map lays over everything, done here
  c.rgb += moon;                                                             // (the moon's path on the water stays bright)
  o = c;
  if (uSurf > 0.5) o.a = (uDbg & 16) != 0 && abs(vPos.z) < 1e-4 ? 1.0 : mix(0.45, 0.92, cur);   // a sheet of inland water: see-through (several lie over a deep bed, so it darkens with the depth)
}`;

// the skybox: one big triangle, each pixel looks along its own ray (camera basis + field of view), so the sky holds still when the view turns and tips
const SKY_VS = `#version 300 es
out vec2 vN;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vN = p * 2.0 - 1.0; gl_Position = vec4(vN, 1.0, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vN;
uniform vec3 uF, uR, uU, uHor, uZen, uSun; uniform vec2 uTan, uPos; uniform vec4 uNight; uniform float uDay, uNoon, uHasStars, uHasMoon, uSpin, uTime, uFx, uSpace, uHigh, uDip;   // uSpace: 0 in the air .. 1 in space (the sky goes black, the stars come out and the layers fade)
uniform sampler2D uMoon, uStars, uCirrus, uStrato, uCumulus, uMount, uTrees; uniform vec4 uHas, uDrop; uniform float uHasT, uSea;   // uDrop: how far (degrees) the mountains, then the far, middle and near tree lines have sunk, the higher the eye   // uHas: which of cirrus, strato, cumulus, mountains are loaded; uHasT: the tree line
out vec4 o;
// (360 / span must be a whole number, even for the mirrored mountains and trees, or the sky shows a seam where the angle wraps: the clouds repeat 180 -> 2, the mountains 60 -> 6, the trees 20 -> 18)
// one band of picture: it runs from elevation eb (the picture's row vb) up by hDeg degrees to the top row, and repeats every span degrees round the horizon
vec4 band(sampler2D tex, float az, float elDeg, float span, float hDeg, float vb, float eb, float drift, float far) {
  float v = vb - (elDeg - eb) / hDeg;
  if (v < 0.0 || v > 1.0) return vec4(0.0);
  // the clouds slowly shear and wobble as they drift, so they seem to change shape instead of sliding by like pictures
  float u = az / 6.2831853 * (360.0 / span) + drift;
  if (far > 0.0) u += (uPos.x * sin(az) - uPos.y * cos(az)) / far / 6.2831853 * (360.0 / span);   // parallax: a layer far tiles away slides against the mountains as the camera moves across the world
  u += 0.0035 * sin(elDeg * 0.45 + uTime * 0.11 + az * 3.0) + 0.0020 * sin(elDeg * 1.3 - uTime * 0.07);
  v += 0.0045 * sin(az * 6.0 + uTime * 0.09 + elDeg * 0.2);
  return texture(tex, vec2(u, clamp(v, 0.0, 1.0)));
}
void main() {
  vec3 ray = normalize(uF + uR * (vN.x * uTan.x) + uU * (vN.y * uTan.y));
  float e = clamp(-ray.z + uDip, 0.0, 1.0);                                   // height of the ray over the horizon (z is down). High up the horizon is the planet's rim, uDip below level: the whole sky (its colours, the stars' dome, the picture bands) stands on the rim, or the rays between the rim and level would all sample one row of it and streak
  vec3 c = mix(uHor, uZen, pow(e, 0.5));
  float nk = max(clamp(uNight.a / 0.7, 0.0, 1.0), uSpace);
  c = mix(c, vec3(0.004, 0.006, 0.016), uSpace * smoothstep(-0.1, 0.5, e + 0.35 * uSpace));           // space: black above, the air's blue left only low down
  c += vec3(0.20, 0.45, 1.0) * uSpace * (0.35 + 0.65 * uDay) * exp(-abs(-ray.z + uDip) * 22.0);      // and a thin blue limb of air along the rim
  float d = dot(ray, uSun);
  c += vec3(1.0, 0.78, 0.45) * (0.30 * pow(max(d, 0.0), 14.0) + 0.25 * pow(max(d, 0.0), 120.0)) * uDay;   // the sun's glow
  c += vec3(1.0, 0.55, 0.25) * 0.22 * pow(max(d, 0.0), 4.0) * pow(1.0 - e, 6.0) * uDay * uFx;               // and the haze low on its side of the horizon
  float sunMask = smoothstep(0.9990, 0.9994, d) * uDay;
  vec3 S = vec3(1.0, 0.96, 0.8) * (1.0 + 3.0 * uFx) * sunMask; c *= 1.0 - sunMask;   // the sun's disc (brighter than white when the glow pass is on, so it blooms) goes in the layer that everything in front dims: stars and moon behind it too
  float m = dot(ray, -uSun);
  c = mix(c, uNight.rgb, uNight.a);
  vec3 q = floor(ray * 150.0);
  float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  S += vec3(0.9) * step(0.9965, h) * mix(smoothstep(0.05, 0.4, e), 1.0, uSpace) * nk * (1.0 - uHasStars);   // (the stars and the Milky Way join S, which is added last, after everything in front has dimmed it)
  if (uHasStars > 0.5) {                                                                                  // the Milky Way: the square picture laid over the sky dome, slowly turning with the hours
    float az2 = atan(ray.y, ray.x) + uSpin, r = 1.0 - asin(clamp(e, 0.0, 1.0)) / 1.5707963;
    vec2 suv = 0.5 + 0.5 * r * vec2(cos(az2), sin(az2));
    S += texture(uStars, suv).rgb * 1.15 * nk * mix(smoothstep(0.04, 0.35, e), 1.0, uSpace) * (1.0 + uFx * 0.25 * sin(uTime * 2.3 + h * 60.0));   // (they twinkle)
  }                                         // stars, only up high at night
  if (uHasMoon > 0.5) {                                                                                      // the moon opposite the sun, in front of the stars and the Milky Way: its picture laid across the sky, about seven degrees wide
    // the picture's up is the normal of the sun's orbit plane (north and a little up, for the 75 degree arc in setHour): always at right angles to the moon, so there is no overhead spot where it breaks, and it turns smoothly with the night like a real moon
    vec3 md = -uSun, up2 = vec3(0.0, -0.96593, -0.25882), rt = normalize(cross(up2, md));
    vec2 q = vec2(dot(ray, rt), dot(ray, up2)) / 0.062;
    if (dot(ray, md) > 0.0 && abs(q.x) < 1.0 && abs(q.y) < 1.0) { vec4 mt = texture(uMoon, vec2(0.5 + 0.5 * q.x, 0.5 - 0.5 * q.y)); c = mix(c, mt.rgb * 1.08, mt.a * nk); S *= 1.0 - mt.a * nk; }
  } else c = mix(c, vec3(0.88, 0.92, 1.0), smoothstep(0.9989, 0.9993, m) * nk);                              // (until the picture loads)
  // the layers, far to near, over the sun and the stars: so the sun sets behind the mountains and the clouds drift across it
  float az = atan(ray.y, ray.x), el = degrees(asin(clamp(-ray.z + uDip, -1.0, 1.0)));
  if (el > -91.0) {
    vec3 night = mix(uNight.rgb, vec3(0.03, 0.04, 0.10), 0.6);
    // clouds: the art is dusk light (peach and violet); at midday it turns white and bluish, at night dark
    vec3 whiteCloud = vec3(1.0, 1.0, 1.04);
    for (int i = 0; i < 3; i++) {
      vec4 t = vec4(0.0);
      if (i == 0 && uHas.x > 0.5) t = band(uCirrus, az, el, 180.0, 30.0, 0.94, 30.0, uTime * 0.0020, 20000.0);
      if (i == 1 && uHas.y > 0.5) t = band(uStrato, az, el, 180.0, 30.0, 0.975, 8.0, uTime * 0.0013, 9000.0);
      if (i == 2 && uHas.z > 0.5) t = band(uCumulus, az, el, 180.0, 30.0, 0.88, 2.0, uTime * 0.0008, 4500.0);
      t.a *= 1.0 - uSpace;
      if (t.a < 0.01) continue;
      float lum = dot(t.rgb, vec3(0.3, 0.59, 0.11));
      vec3 col = mix(t.rgb, whiteCloud * (0.55 + 0.6 * lum), uNoon * 0.8);
      col = mix(col, night * 1.6 + 0.04 * col, nk * 0.85);
      c = mix(c, col, t.a * (i == 0 ? 0.85 : 0.97));
      S *= 1.0 - t.a * (i == 0 ? 0.85 : 0.97);   // a cloud blocks the stars behind it
    }
    if (uHas.w > 0.5) {   // the mountain range: its peaks stand about nine degrees up
      vec4 t = band(uMount, az, el + uDrop.x, 60.0, 20.0, 0.90, 0.0, 0.0, 12000.0);   // (the higher the eye, the lower they stand against the horizon, instead of vanishing)
      t.a *= 1.0 - uSpace;
      if (t.a > 0.01) {
        float lum = dot(t.rgb, vec3(0.3, 0.59, 0.11));
        vec3 col = mix(t.rgb, vec3(0.40, 0.52, 0.72) * (0.5 + 1.1 * lum), uNoon * 0.55);   // midday haze
        col = mix(col, night * 0.8 + 0.15 * col, nk * 0.9);
        c = mix(c, col, t.a);
        S *= 1.0 - t.a;
      }
    }
    if (el + uDrop.x < 0.0) {       // the endless plane (its edge, the horizon, sinks with the mountains): grass all the way to the horizon, under the tree line, where the real ground has not drawn (far away, unloaded, or past the reach)
      vec3 col = vec3(0.30, 0.46, 0.13) * (0.45 + 0.55 * uDay);
      if (uSea > 0.5) col = mix(vec3(0.06, 0.40, 0.52) * (0.45 + 0.55 * uDay), uHor * 0.92, pow(clamp(1.0 + (el + uDrop.x) / 6.0, 0.0, 1.0), 2.0));   // a hilly world's edge: the sea out to the horizon, paling towards it
      col = mix(col, night * 0.5 + 0.1 * col, nk * 0.9);
      col = mix(col, vec3(0.02, 0.05, 0.12), uSpace * 0.8);   // (from space the far ground is a dark blue-green)
      c = col; S = vec3(0.0);
    }
    if (uHasT > 0.5) {    // the tree line in front: three copies of the one picture, far to near, each smaller, hazier and shifted round the horizon, and sinking faster the nearer they are
      for (int i = 0; i < 3; i++) {
        float sc = i == 0 ? 0.5 : (i == 1 ? 0.75 : 1.0);                   // size
        float dr = i == 0 ? uDrop.y : (i == 1 ? uDrop.z : uDrop.w);
        float shift = i == 0 ? 0.37 : (i == 1 ? 0.71 : 0.0);                // a different stretch of forest in each, so the trees do not line up
        vec4 t = band(uTrees, az + shift * 6.2831853 / (360.0 / (20.0 * sc)), el + dr, 20.0 * sc, 6.6667 * sc, 0.80, -0.7 * sc, 0.0, i == 0 ? 4500.0 : (i == 1 ? 1800.0 : 700.0));   // (360 / span stays whole: 36, 24, 18)
        t.a *= 1.0 - uSpace;
        if (t.a < 0.01) continue;
        vec3 col = mix(t.rgb, t.rgb * vec3(0.9, 1.0, 1.0) + 0.04, uNoon * 0.3);
        col = mix(col, mix(col, uHor * 0.8, 0.5), i == 0 ? 0.55 : (i == 1 ? 0.28 : 0.0));   // distance haze
        col = mix(col, night * 0.5 + 0.1 * col, nk * 0.9);
        c = mix(c, col, t.a);
        S *= 1.0 - t.a;
      }
    }
  }
  if (-ray.z < -uDip) {   // below the horizon (the planet's rim, high up), high up: the haze of the ground out to the edge of the world (the far ground fades into the same colour), never the sky's stars and layers, which all sample one row down here and streak
    float k = max(uHigh, uSpace);
    vec3 hz = mix(uHor * (1.0 - 0.45 * uSpace), uNight.rgb, uNight.a);
    c = mix(c, hz, k); S *= 1.0 - k;
  }
  c += S;
  o = vec4(c, 1.0);
}`;

// the glow pass: the scene is drawn into a texture, its bright parts are blurred small and laid back over it, with rays from the sun
const POST_VS = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uPx; uniform float uThr; out vec4 o;
void main() {
  vec3 c = 0.25 * (texture(uTex, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture(uTex, vUv + uPx * vec2(1.0, -1.0)).rgb + texture(uTex, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture(uTex, vUv + uPx * vec2(1.0, 1.0)).rgb);
  float m = max(c.r, max(c.g, c.b));
  o = vec4(min(c, vec3(4.0)) * smoothstep(uThr, uThr + 0.25, m), 1.0);
}`;
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += (texture(uTex, vUv + uDir * 1.3846153846).rgb + texture(uTex, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(uTex, vUv + uDir * 3.2307692308).rgb + texture(uTex, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
  o = vec4(c, 1.0);
}`;
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uScene, uBloom; uniform vec2 uSunPos, uSceneSz; uniform float uRays, uBloomK, uVig, uCrt; out vec4 o;
void main() {
  vec3 c;
  if (uCrt > 0.5) {   // the CRT look: the picture is drawn small and stretched to the screen, its colour channels pulled apart a little towards the corners (chromatic aberration), a dark line between its rows, a slightly stronger vignette
    vec2 d = vUv - 0.5; float k = 0.0018 + 0.012 * dot(d, d);
    c = vec3(texture(uScene, vUv - d * k).r, texture(uScene, vUv).g, texture(uScene, vUv + d * k).b);
    float row = 0.5 + 0.5 * cos(6.2831853 * vUv.y * uSceneSz.y);   // 0 in the middle of a picture row, 1 between two
    c *= (1.0 - 0.26 * pow(row, 1.7)) * 1.09;
  } else c = texture(uScene, vUv).rgb;
  c += texture(uBloom, vUv).rgb * uBloomK;
  if (uRays > 0.001) {                                         // rays: the glow smeared away from the sun, so what stands in front of it casts streaks
    vec2 d = (uSunPos - vUv) * (0.9 / 14.0), p = vUv; float w = 1.0; vec3 r = vec3(0.0);
    for (int i = 0; i < 14; i++) { p += d; r += texture(uBloom, p).rgb * w; w *= 0.9; }
    c += r * (uRays / 14.0);
  }
  c = clamp(c, 0.0, 1.0);
  c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 1.10);     // a little more colour and contrast
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.15);
  c *= 1.0 - uVig * smoothstep(0.42, 1.0, length(vUv - 0.5) * 1.5);   // darker corners
  o = vec4(c, 1.0);
}`;

/** How far a hilly world is seen: the far meshes (the whole map, in levels of detail) haze out to here, past the map's far corner. */
const FAR_REACH = 2400;
const FLOATS = 9;                 // x y z u v r g b a
const MAX_QUADS = 8000;           // per draw call (4 vertices each must stay under 65536)

export type Kind = 'decal' | 'solid' | 'blend';
/** Drawn effects: a quad with `FX_UV` and the colour (FX_x, a, b, alpha + FX_MARK) is painted by the shader instead of from the sheet (add 2 more to the alpha for one that shines by itself). */
export const FX_SCORCH = 1, FX_FLAME = 2, FX_TUNNEL = 3, FX_WET = 4, FX_MARK = 4;
export const FX_UV = { u0: 0, v0: 0, u1: 1, v1: 1 };
/** A rectangle of the atlas in 0..1 texture coordinates. */
export interface UV { u0: number; v0: number; u1: number; v1: number }

type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface CameraSpec {
  x: number; y: number;           // the ground point in the middle of the screen, in tiles
  upX: number; upY: number;       // the ground direction that points up the screen (unit)
  tilt: number;                   // radians from looking straight down
  T: number;                      // pixels per tile at the middle of the screen
  fullView?: boolean;             // draw everything the camera can see, with no haze, as long as that is a finite stretch of ground (else out to a cap, fading)
  lockTo?: [number, number];      // the chase camera locked rigidly behind a plane at this point: its height follows the ground under the plane exactly, instead of easing towards it (so the plane does not bob up and down in the view as the ground rises and falls)
  reach?: number;                 // a fixed ground reach (tiles) for a camera that looks towards the horizon
  lookH?: number;                 // how high above the ground the camera's target is (it follows the plane up a little, so the plane stays in view)
  /** A camera that stands anywhere (the free view, the flyby): the eye as (x, y, height above the ground), looking at the target (`x`, `y`, `lookH`). `tilt` and `T` are then not used; the horizon stays level. */
  eye?: [number, number, number];
  W: number; H: number;           // the stage in CSS pixels
  /** First person: the eye stands on the ground point at `eyeH` tiles, looking along (upX, upY) and `pitch` radians up. (`x`, `y`) is where it stands; `k` 0..1 blends from the chase camera (it eases in and out). */
  fpv?: { k: number; x: number; y: number; eyeH: number; pitch: number; air?: boolean; gx?: number; gy?: number; basis?: { f: ArrayLike<number>; u: ArrayLike<number> } };   // air: the eye is the plane's (eyeH is its height above the ground at (gx, gy), the plane's own spot): the ground is taken exactly there, never eased or cleared ahead of it   // basis: the plane's own attitude (nose `f` and up `u`, x east, y NORTH, z up, as the glider keeps them): the view turns with it, roll included, instead of staying level at `pitch`
}

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

/** A chunk's ground picture as raw RGBA pixels, `size` x `size`. A new object whenever the chunk is drawn again (that is how the texture knows to update). */
export interface ChunkPx { px: Uint8ClampedArray<ArrayBuffer>; size: number }
/** Where a chunk's hill mesh waits when the chunk worker made it: `WorldGL` takes it from here when it builds the chunk's buffers (and empties the box, so the arrays are not held for nothing). */
export interface MeshBox { mesh?: TerraceMesh }
export interface GroundChunk { key: number; cx: number; cy: number; src: ChunkPx; meshBox?: MeshBox }
const TEX_POOL = 48;   // spare chunk textures kept to be written over
const TEX_KEEP = 200;   // chunk textures kept at most (the longest unseen go first; ~350 KB each with mipmaps)

/** The convex hull of some points, counter-clockwise (Andrew's monotone chain). */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export class WorldGL {
  private fpvK = 0;
  private skyProg!: WebGLProgram;
  private skyLoc: Record<string, WebGLUniformLocation | null> = {};
  private disposed = false;
  /** The pretty extras: living water, sunlight, and the glow pass. Off = the plain picture. */
  fx = true;
  /** 0 in the air .. 1 in space: set by the screen from the plane's height above sea level (see spaceFactor). Blacks out the sky and brings out the stars. */
  space = 0;
  /** The planet's curve as drawn: the ground drops by curveC * d^2 (tiles) at d tiles from the eye. The screen sets it from the height (0 low down, so nothing changes there). */
  curveC = 0;
  /** The sine of how far the planet's rim has sunk below level for this eye: the tangent from the eye to the curved ground (z = curveC d^2) falls at 2 sqrt(curveC H). */
  dipSin() { const H = Math.max(0, -this.eye[2]); if (!(this.curveC > 0) || !(H > 0)) return 0; const m = 2 * Math.sqrt(this.curveC * H); return m / Math.sqrt(1 + m * m); }
  private light: [number, number, number] = [1, 1, 1];
  private postProg: { bright: WebGLProgram; blur: WebGLProgram; comp: WebGLProgram } | null = null;
  private postLoc: Record<string, WebGLUniformLocation | null> = {};
  private post: { w: number; h: number; sw: number; sh: number; hdr: boolean; depth: WebGLRenderbuffer; depthBits: number; wantMs: boolean; ms?: { fb: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; samples: number }; scene: Target; a: Target; b: Target } | null = null;
  private postBroken = false; private postOn = false;
  private layerTex: (WebGLTexture | null)[] = [null, null, null, null, null]; private starsTex: WebGLTexture | null = null; private moonTex: WebGLTexture | null = null; private spin = 0; private noonK = 0;
  private sunDir: Vec3 = [0, 0, -1]; private dayK = 1; private zenith: [number, number, number] = [0.3, 0.52, 0.85];                    // how much the camera stands on the ground (0 = the chase camera)
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private atlasTex: WebGLTexture;
  private aniso: number;
  private chunkTex = new Map<number, { src: ChunkPx; tex: WebGLTexture; mesh?: WebGLBuffer; ibo?: WebGLBuffer; count?: number; wmesh?: WebGLBuffer; wibo?: WebGLBuffer; wcount?: number; wvao?: WebGLVertexArrayObject; vao?: WebGLVertexArrayObject; used?: number; stale?: boolean }>();
  /** Chunk textures no chunk is using, kept to be written over: making and freeing textures as you fly makes the driver stall, writing into one that exists does not. */
  private texPool: WebGLTexture[] = [];
  /** How many chunk textures one frame may upload at most (also stops at ~3 ms). The upload and its mipmaps mostly cost GPU time the frame's own timers cannot see, so it is a count, set by the game: a few while the screen first fills, then one or two. */
  uploadMax = 2;
  /** (how many chunk textures the last ground() call uploaded: the game puts other occasional work, the minimap, on a quieter frame) */
  lastMade = 0;
  private groundFrames = 0;   // (counts the ground draws: a chunk's GPU copy that has not been drawn for a few seconds is freed)
  /** Ground height in tiles under a point (a hilly world: the Lake District); null = flat ground at 0. Set it before the first frame. */
  terrain: ((x: number, y: number) => number) | null = null;
  /** The ground without the terraces' steps (a terraced world): what the camera clears, so it glides over a ledge instead of jumping a step. */
  terrainSoft: ((x: number, y: number) => number) | null = null;
  /** Mesh points a tile for the hilly chunks (1 = a vertex at every tile corner; the terraced world uses 2 so its ledges read as edges). Set with `terrain`, before the first chunk. */
  terrainSub = 1;
  /** A terraced chunk's own mesh (right-angled terraces cut along the elevation's contours, see terrace.ts terraceChunkMesh): positions, normals and indices. Set with `terrain`, before the first chunk. */
  terraceMesh: ((cx: number, cy: number) => { pos: Float32Array; nrm: Float32Array; idx: Uint32Array; sub: Uint8Array; wpos: Float32Array; widx: Uint32Array; wkind: Uint8Array }) | null = null;
  /** A terraced world's layer height in tiles (0 = not terraced): turns on the bands, walls and lips in the shader. */
  terraceStep = 0;
  /** While true, sprites are placed at heights above sea level (the clouds), not above the ground under them. */
  skyMode = false;
  private terrIbo: WebGLBuffer | null = null;
  /** The far view (a hilly world on foot): the whole map as one coarse mesh, so the chunks only have to cover the near ring. */
  private farMesh: { vbo: WebGLBuffer; ibo: WebGLBuffer; n: number; bytes: number; shared: boolean; /** a square grid of `cols` x `cols` vertices, the first row at y0, `step` apart (the terraced levels): only the rows near the eye are drawn */ grid?: { cols: number; y0: number; step: number } }[] | null = null;
  private farIbos = new Map<Uint32Array, WebGLBuffer>();   // the terraced far levels share their index arrays (see terrace.ts farIndices), so each size has one GPU buffer for good
  private farStage = new Float32Array(0);                   // where a far level's vertices are interleaved before the upload (kept for the next one)
  private farOn = false;
  /** The finest far level to draw (a hilly world with more than three: from high up the finer ones are pixels). Set by the screen. */
  /** The CRT look (see COMP_FS): the scene is drawn at `renderScale` of the canvas (which then stays at the screen's own size) and stretched over it by the last pass. */
  crt = false; renderScale = 1;
  farMin = 0;
  /** How far (tiles) the real chunks may reach whatever the view asks (Infinity: no cap), and where each far level ends past the hole (null: the usual rings). The seeded hills cap the chunks and put a fine far level in front. */
  nearCap = Infinity; farRing: number[] | null = null;
  /** 0..1: how high the eye is over a hilly world (from 150 tiles, about 830 m, to 600), for the haze at the edge of the ground. */
  highK() { if (!this.terrain) return 0; const t = Math.max(0, Math.min(1, (this.eyeHeight - 150) / 450)); return t * t * (3 - 2 * t); }
  /** The eye's height above the ground (tiles), as of the last camera. */
  get eyeHeight() { return Math.max(0, -this.eye[2] - (this.terrain ? this.terrain(this.eye[0], this.eye[1]) : 0)); }
  /** How far from the eye every visible chunk is built (set by the map each frame; Infinity = all of them). The far mesh's hole is never wider than this, so ground whose chunk is still being built is covered by the far mesh instead of left empty. */
  cover = Infinity;
  /** How far from the eye the nearest chunk is that the GPU cannot draw yet (see `ground`); the far mesh starts no further out than this. */
  private undrawn = Infinity;
  private nearBand = 1;   // the width (tiles) of the band where the real chunks hand over to the first far level
  /** How far from the camera real chunks are asked for: the most the chunk budget can hold (see WorldMap), eased. Past it the far mesh draws everything. */
  capD = 1e5;
  private coverSm = Infinity;
  /** For the ?perf readout: where the far mesh began last frame (tiles from the eye), and how far the chunks were meant to reach. */
  private zNear = 0; private zFar = 0;
  /** (?perf) What the GPU gave us: the depth buffer's bits (the scene's own when the glow pass draws it), the near and far planes, the resolution scale, and the renderer's name. A phone that z-fights where a desktop does not shows here. */
  get gpuInfo(): string {
    const gl = this.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    return `depth ${this.postOn ? (this.post?.depthBits ?? 24) : gl.getParameter(gl.DEPTH_BITS)}b  near ${this.zNear.toFixed(3)} far ${this.zFar.toFixed(0)}  scale ${this.renderScale}  post ${this.postOn ? (this.post?.hdr ? 'hdr' : 'rgba8') : 'off'}  ${ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 40) : ''}`;
  }
  get holeInfo() { return { hole: this.coverSm * 0.9, near: this.nearReach }; }
  /** For the ?perf readout: nearest chunk (tiles from the eye) the GPU could not draw on the last `ground` call, and how far the far mesh was told to start. */
  get groundInfo() { return { undrawn: this.undrawn, cover: this.cover, coverSm: this.coverSm }; }
  /** Where the real ground ends and the far mesh begins (tiles from the eye), last frame; Infinity when there is no far mesh. */
  get farHole() { return this.farOn && this.farMesh && isFinite(this.coverSm) ? this.coverSm * 0.9 : Infinity; }
  private nearReach = 0;                                          // how far the real chunks reach when the far mesh covers the rest (0 = as far as `reach`)
  private baseH = 0;
  private sm: Record<string, number> = {}; private smAt = 0; private camDt = 0.016;   // the camera's smoothed ground heights (see smooth)                                              // the ground height under the camera's target
  // the queued sprites live in growing typed arrays (no per-sprite allocation, no copy before the upload)
  private pools: Record<Kind, { a: Float32Array; n: number }> = { decal: { a: new Float32Array(4096 * 4 * FLOATS), n: 0 }, solid: { a: new Float32Array(4096 * 4 * FLOATS), n: 0 }, blend: { a: new Float32Array(4096 * 4 * FLOATS), n: 0 } };
  private depths = new Float32Array(4096);                          // per quad of the blend queue: squared distance to the eye
  private nBlend = 0;
  private order = new Uint32Array(4096);
  private sortBuf = new Float32Array(4096 * 4 * FLOATS);
  // the plane model (optional): its own texture and indices, drawn after the sprites
  private model: { local: Float32Array; uv: Float32Array; tex: WebGLTexture; ibo: WebGLBuffer; n: number; out: Float32Array } | null = null;
  private pose: { x: number; y: number; h0: number; dx: number; dy: number; roll: number; pitch: number; len: number; sa: number; sx: number; sy: number; tint?: [number, number, number]; basis?: { f: ArrayLike<number>; u: ArrayLike<number> } } | null = null;
  private poses: NonNullable<WorldGL['pose']>[] = [];   // every plane queued this frame (the player's, and an opponent's)
  private shadowOut = new Float32Array(0);
  // the atlas
  readonly aw: number; readonly ah: number;
  private cells: { shadow: UV; clouds: UV[]; cloudShadows: UV[]; dot: UV; haze: UV; ring: UV; stick: UV; leaf: UV; maple: UV; pollen: UV; stone: UV; berry: UV; flames: UV[]; bolt: UV | null; beavers: UV[] };
  // the camera
  W = 1; H = 1; dpr = 1;
  eye: Vec3 = [0, 0, -20];
  R: Vec3 = [1, 0, 0];            // the camera's right and up, in world space: sprites span these
  U: Vec3 = [0, -1, 0];
  private F: Vec3 = [0, 0, 1];
  private vp = new Float32Array(16);
  private tanY = 0.4; private tanX = 0.5;
  /** Ground reach: fully faded into the sky here, nothing is drawn beyond. */
  reach = 60; fogStart = 30;
  /** The draw distance setting: 1 = the usual cap (320 tiles) on how far the ground is drawn when the horizon is in view. */
  drawK = 1;
  /** (the ?perf readout: the longest time one frame spent making new chunk textures and meshes, and how many it made) */
  madeMs = 0; madeN = 0; oneMs = 0; oneN = 0;
  private gbuf: Float32Array | null = null; private gdrawn: WebGLTexture[] = [];   // (the flat chunks' quads, all at once)
  /** On foot: how far the real chunks reach, as a multiple of the usual 200 tiles (the options slider). */
  walkK = 1;
  /** How far the sky clouds reach (tiles): the far plane goes out to it and the blended sprites fade into the haze over this distance, not the ground's. */
  skyRadius = 360;
  sky: [number, number, number] = [0.62, 0.78, 0.9];
  /** Night tint: colour and how much (0 = day). */
  night: [number, number, number, number] = [0, 0, 0, 0];

  static create(canvas: HTMLCanvasElement, sheet: HTMLImageElement, shadow: HTMLCanvasElement, clouds: HTMLCanvasElement[], extras: (HTMLImageElement | null)[] = [], fire: { flames: HTMLCanvasElement[]; bolt: HTMLCanvasElement | null } = { flames: [], bolt: null }, beavers: HTMLCanvasElement[] = []): WorldGL | null {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    try { return new WorldGL(gl, sheet, shadow, clouds, extras, fire, beavers); } catch (e) { console.warn('3D view unavailable:', e); return null; }
  }

  private constructor(gl: WebGL2RenderingContext, sheet: HTMLImageElement, shadow: HTMLCanvasElement, clouds: HTMLCanvasElement[], extras: (HTMLImageElement | null)[], fire: { flames: HTMLCanvasElement[]; bolt: HTMLCanvasElement | null }, beavers: HTMLCanvasElement[]) {
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const link = (vs: string, fs: string, attribs: string[] = []) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      attribs.forEach((n, i) => gl.bindAttribLocation(p, i, n));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
      return p;
    };
    const prog = this.prog = link(VS, FS, ['aPos', 'aUv', 'aCol']);
    const sp = this.skyProg = link(SKY_VS, SKY_FS);
    try {   // the glow pass is an extra: without it the view is simply drawn straight to the screen
      const pp = this.postProg = { bright: link(POST_VS, BRIGHT_FS), blur: link(POST_VS, BLUR_FS), comp: link(POST_VS, COMP_FS) };
      for (const [k, p, names] of [['bright', pp.bright, ['uTex', 'uPx', 'uThr']], ['blur', pp.blur, ['uTex', 'uDir']], ['comp', pp.comp, ['uScene', 'uBloom', 'uSunPos', 'uRays', 'uBloomK', 'uVig', 'uCrt', 'uSceneSz']]] as [string, WebGLProgram, string[]][]) for (const n of names) this.postLoc[k + '.' + n] = gl.getUniformLocation(p, n);
    } catch (e) { console.warn('3D glow pass unavailable:', e); this.postProg = null; }
    for (const n of ['uF', 'uR', 'uU', 'uHor', 'uZen', 'uSun', 'uTan', 'uNight', 'uDay', 'uNoon', 'uHasStars', 'uHasMoon', 'uMoon', 'uPos', 'uSpin', 'uSpace', 'uHigh', 'uDip', 'uStars', 'uTime', 'uCirrus', 'uStrato', 'uCumulus', 'uMount', 'uTrees', 'uHas', 'uDrop', 'uHasT', 'uSea', 'uFx']) this.skyLoc[n] = gl.getUniformLocation(sp, n);
    for (const n of ['uVP', 'uEye', 'uCurveC', 'uTex', 'uCut', 'uFog', 'uFogRange', 'uBase', 'uNight', 'uFx', 'uTime', 'uDay', 'uTileUv', 'uTerr', 'uFar', 'uHole', 'uHoleMax', 'uBand', 'uBandOut', 'uTerrace', 'uSurf', 'uSun', 'uZen', 'uLight', 'uDbg']) this.loc[n] = gl.getUniformLocation(prog, n);
    this.vbo = gl.createBuffer()!; this.ibo = gl.createBuffer()!;
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) { const v = q * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    this.aniso = ext ? Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1;

    // the atlas: the sheet, then a strip of extra cells under it
    const CY0 = TILE_PX + 128 + 128, cloudRows = Math.ceil(clouds.length / 2), aw = sheet.width, FY0 = CY0 + cloudRows * (CLOUD_H + 1) * 2, BY0 = FY0 + FLAME_H + 1 + BOLT_H + 1, extra = BY0 + Math.ceil(beavers.length / 5) * (BEAVER_H + 1), ah = sheet.height + extra, y0 = sheet.height;
    const at = document.createElement('canvas'); at.width = aw; at.height = ah;
    const g = at.getContext('2d')!; g.imageSmoothingEnabled = false;
    g.drawImage(sheet, 0, 0);
    g.drawImage(shadow, 0, y0);
    clouds.forEach((c, i) => g.drawImage(c, (i % 2) * CLOUD_W, y0 + CY0 + Math.floor(i / 2) * (CLOUD_H + 1)));   // the cloud pictures, two to a row, a pixel apart
    const SY0 = CY0 + cloudRows * (CLOUD_H + 1);
    clouds.forEach((c, i) => g.drawImage(silhouette(c), (i % 2) * CLOUD_W, y0 + SY0 + Math.floor(i / 2) * (CLOUD_H + 1)));   // and under them the same shapes in black, for the shadows they cast
    g.fillStyle = '#fff'; g.fillRect(TILE_PX * 2, y0, 4, 4);
    const hz = g.createRadialGradient(32, y0 + TILE_PX + 32, 0, 32, y0 + TILE_PX + 32, 32);
    hz.addColorStop(0, 'rgba(255,150,40,1)'); hz.addColorStop(0.6, 'rgba(255,190,80,0.41)'); hz.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = hz; g.fillRect(0, y0 + TILE_PX, 64, 64);
    // a hoop: a thick white ring (tinted when drawn) with a soft glow either side and a faint film inside
    const ry = y0 + TILE_PX + 64;
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.arc(32, ry + 32, 24, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 11; g.beginPath(); g.arc(32, ry + 32, 25, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(32, ry + 32, 25, 0, Math.PI * 2); g.stroke();
    const sy = y0 + TILE_PX + 128; extras.forEach((im, i) => { if (im) g.drawImage(im, (i % 3) * 64, sy + Math.floor(i / 3) * 64, 64, 64); });   // item pictures, three to a row (the sheet is 192 wide): stick, leaf, maple leaf, then pollen, stone and berry on the next row
    fire.flames.forEach((c, i) => g.drawImage(c, i * (FLAME_W + 1), y0 + FY0));   // the flame frames side by side, then the bolt under them
    if (fire.bolt) g.drawImage(fire.bolt, 0, y0 + FY0 + FLAME_H + 1);
    beavers.forEach((c, i) => g.drawImage(c, (i % 5) * (BEAVER_W + 1), y0 + BY0 + Math.floor(i / 5) * (BEAVER_H + 1)));   // the beaver frames, five to a row
    this.aw = aw; this.ah = ah;
    const cell = (x: number, y: number, w: number, h: number, inset = 0.02): UV => ({ u0: (x + inset) / aw, v0: (y + inset) / ah, u1: (x + w - inset) / aw, v1: (y + h - inset) / ah });
    this.cells = { shadow: cell(0, y0, TILE_PX, TILE_PX, 0), clouds: clouds.map((_, i) => cell((i % 2) * CLOUD_W, y0 + CY0 + Math.floor(i / 2) * (CLOUD_H + 1), CLOUD_W, CLOUD_H, 0.5)), cloudShadows: clouds.map((_, i) => cell((i % 2) * CLOUD_W, y0 + SY0 + Math.floor(i / 2) * (CLOUD_H + 1), CLOUD_W, CLOUD_H, 0.5)), dot: cell(TILE_PX * 2 + 1, y0 + 1, 2, 2, 0), haze: cell(0, y0 + TILE_PX, 64, 64, 0), stick: cell(0, y0 + TILE_PX + 128, 64, 64, 0.5), leaf: cell(64, y0 + TILE_PX + 128, 64, 64, 0.5), maple: cell(128, y0 + TILE_PX + 128, 64, 64, 0.5), pollen: cell(0, y0 + TILE_PX + 192, 64, 64, 0.5), stone: cell(64, y0 + TILE_PX + 192, 64, 64, 0.5), berry: cell(128, y0 + TILE_PX + 192, 64, 64, 0.5), ring: cell(0, y0 + TILE_PX + 64, 64, 64, 0), flames: fire.flames.map((_, i) => cell(i * (FLAME_W + 1), y0 + FY0, FLAME_W, FLAME_H, 0.5)), bolt: fire.bolt ? cell(0, y0 + FY0 + FLAME_H + 1, BOLT_W, BOLT_H, 0.5) : null, beavers: beavers.map((_, i) => cell((i % 5) * (BEAVER_W + 1), y0 + BY0 + Math.floor(i / 5) * (BEAVER_H + 1), BEAVER_W, BEAVER_H, 0.5)) };
    this.atlasTex = this.makeTexture(at, false);
    // the skyline layers load on their own; until then (or if one fails) its band is simply missing
    const upload = (i: number, src: HTMLImageElement | HTMLCanvasElement, wrap: number = gl.MIRRORED_REPEAT) => {
      if (this.disposed) return;
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      if (src instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data);   // (raw pixels: see makeTexture)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);   // (blocky like the rest, and no mip levels: they would show a seam where the angle wraps)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.layerTex[i] = t; gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    };
    loadSkyBands().then(bands => bands.forEach((c, i) => upload(i, c, gl.REPEAT)));   // the three cloud bands: a plain repeat, half the sky each, nothing mirrored
    [MOUNTAIN_URL, TREELINE_URL].forEach((url, j) => { const im = new Image(); im.onload = () => upload(3 + j, im); im.src = url; });   // then the mountain range and the tree line
    const moon = new Image();
    moon.onload = () => {
      if (this.disposed) return;
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, moon);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.moonTex = t; gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    };
    moon.src = MOON_URL;
    const stars = new Image();
    stars.onload = () => {
      if (this.disposed) return;
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stars);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.starsTex = t; gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    };
    stars.src = STARS_URL;

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
  }

  get atlas() { return this.cells; }
  /** A cell of the sheet (tile coordinates) as atlas coordinates. */
  cell(cx: number, cy: number): UV {
    const e = 0.02;
    return { u0: (cx * TILE_PX + e) / this.aw, v0: (cy * TILE_PX + e) / this.ah, u1: ((cx + 1) * TILE_PX - e) / this.aw, v1: ((cy + 1) * TILE_PX - e) / this.ah };
  }

  private makeTexture(src: TexImageSource, mips: boolean) {
    const gl = this.gl, tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Raw pixels, not the canvas itself: the browser's direct canvas-to-texture copy can swap red and blue for some canvases (a GPU-backed one
    // against a software one), which turned some chunks of water brown and sand light blue.
    const c2 = src instanceof HTMLCanvasElement ? src.getContext('2d') : null;
    if (c2 && src instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, c2.getImageData(0, 0, src.width, src.height).data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);                       // blocky when close, like the flat map
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);        // smooth when far, so it does not shimmer
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext && this.aniso > 1) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return tex;
  }

  resize(W: number, H: number, dpr: number, cv: HTMLCanvasElement) {
    this.W = W; this.H = H; this.dpr = dpr;
    const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
  }

  /** Put the camera behind and above the target: the stage's middle shows the target at `T` pixels per tile, whatever the tilt. */
  /** A ground height the camera follows: eased over `tau` seconds, so a bump or a ridge does not jerk the view (it snaps when the place changes a lot, e.g. a teleport). */
  private smooth(key: string, raw: number, tau: number): number {
    const v = this.sm[key];
    if (v === undefined || Math.abs(raw - v) > 12) return (this.sm[key] = raw);
    return (this.sm[key] = v + (raw - v) * (1 - Math.exp(-this.camDt / tau)));
  }

  /** The ground under a first-person eye: eased a little when walking (a step in the ground is not a jolt), exact in the air (the eye is the plane, whose height is the ground plus its height above it). */
  /** The highest ground at a point and four points `r` tiles round it: the camera clears the lot, so its near plane never cuts into a slope beside it. */
  private groundNear(x: number, y: number, r: number, soft = false): number {   // (`soft`: the ground without the steps, for the flying camera's clearance)
    const T = (soft && !dbgOn('nosoftcam') && this.terrainSoft) || this.terrain; if (!T) return 0;
    return Math.max(T(x, y), T(x + r, y), T(x - r, y), T(x, y + r), T(x, y - r));
  }
  private footGround(raw: number, eyeH: number): number {
    const soft = this.smooth('foot', raw, 0.1), k = Math.max(0, Math.min(1, (eyeH - 0.8) / 0.6));
    return soft + (raw - soft) * k;
  }

  /** The ground under a walking eye. On the terraces a step up or down a ledge is a jump of a whole layer in the ground, and the eye eases over it (a quarter of a second or so) instead of snapping; other worlds' ground is smooth already. */
  private walkGround(raw: number): number { return this.terraceStep > 0 ? this.smooth('eyeg', raw, 0.16) : raw; }

  setCamera(c: CameraSpec) {
    this.nearReach = 0; this.farOn = false;
    const now = performance.now(); this.camDt = Math.min(0.1, Math.max(0.001, (now - this.smAt) / 1000)); this.smAt = now;
    const fov = 0.72, tanY = Math.tan(fov / 2), tanX = tanY * (c.W / c.H);
    this.tanY = tanY; this.tanX = tanX; this.W = c.W; this.H = c.H;
    let D = c.H / 2 / (c.T * tanY);                                      // distance from the target so that a tile is T px high there
    const st = Math.sin(c.tilt), ct = Math.cos(c.tilt);
    const lh = c.lookH ?? 0, T = this.terrain, onFoot = !!c.fpv && c.fpv.k > 0.5; let bh = T ? (c.lockTo && !onFoot ? (this.sm.base = T(c.lockTo[0], c.lockTo[1]) + lh) - lh : this.smooth('base', T(c.x, c.y) + lh, onFoot ? 0.12 : 0.35) - lh) : 0;   // (the whole target height is eased, ground and look height together: the look height follows the height above the ground, which moves against the ground as the plane crosses a ridge)
    this.baseH = bh;                                                      // everything below is as on flat ground, lifted by the ground under the target
    this.eye = [c.x - c.upX * D * st, c.y - c.upY * D * st, -bh - lh - D * ct];
    if (T && !c.eye) {   // (the chase camera keeps off a hill behind it: lifted at once, let down slowly)
      const need = Math.max(0, this.groundNear(this.eye[0], this.eye[1], 1, true) + 0.8 - -this.eye[2]), lift = (this.sm.lift = this.smooth('lift', need, need > (this.sm.lift ?? 0) ? 0.18 : 1.2));   // (up quickly, down slowly: on the terraces a ledge behind the camera is a jump of a whole layer, and lifting at once would snap the picture; the last guard below keeps the eye out of the ground meanwhile)
      this.eye[2] -= lift; bh += lift;   // (the target rises with the eye: the camera is carried up, not tipped down, so the tilt stays what it was)
    }   // (the chase camera does not sink into a hill behind it)
    let f = norm([c.x - this.eye[0], c.y - this.eye[1], -bh - lh - this.eye[2]]);
    let r = norm(cross(f, [c.upX, c.upY, 0]));
    if (c.eye) {                                                          // an eye given outright: look from it at the target, the right-hand side level (looking straight down there is no level: then (upX, upY) is up the screen)
      this.eye = [c.eye[0], c.eye[1], -Math.max(0.3, c.eye[2]) - (T ? T(c.eye[0], c.eye[1]) : 0)];   // (the free eye is exactly where it is told; the clearance guard below only lifts it off a slope)
      const dx = c.x - this.eye[0], dy = c.y - this.eye[1], dz = -bh - lh - this.eye[2];
      D = Math.max(0.5, Math.hypot(dx, dy, dz)); f = norm([dx, dy, dz]);
      r = Math.hypot(f[0], f[1]) > 0.05 ? norm(cross(f, [0, 0, -1])) : norm(cross(f, [c.upX, c.upY, 0]));
    }
    this.reach = c.reach ?? D * 3.3; this.fogStart = c.reach ? c.reach * 0.7 : D * 1.8;
    let near = Math.max(0.02, D * 0.05), far = this.reach * 1.6 + D;
    if (!(c.fpv && c.fpv.k > 0.5)) delete this.sm.eyeg;                   // (the walker's eased eye height starts afresh each time it lands)
    if (c.fpv && c.fpv.k > 0) {                                           // standing on the ground: eye, view direction and reach blend towards the walker's
      const k = Math.min(1, c.fpv.k), cp = Math.cos(c.fpv.pitch), sp = Math.sin(c.fpv.pitch), e = this.eye;
      const f1: Vec3 = [c.upX * cp, c.upY * cp, -sp], mix = (a: number, b: number) => a + (b - a) * k;
      const gTerm = !T ? 0 : c.fpv.air ? (this.sm.eyeg = this.sm.foot = T(c.fpv.gx ?? c.fpv.x, c.fpv.gy ?? c.fpv.y)) : this.walkGround(Math.max(this.footGround(T(c.fpv.x, c.fpv.y), c.fpv.eyeH), this.groundNear(c.fpv.x, c.fpv.y, 0.3)));   // (in the air the eye's height is the plane's: its height above the ground plus the ground right under the plane, with no easing, or the one would change a moment before the other at every ledge and the eye would bob)
      this.eye = [mix(e[0], c.fpv.x), mix(e[1], c.fpv.y), mix(e[2], -c.fpv.eyeH - gTerm)];
      const fc = f; f = norm([mix(f[0], f1[0]), mix(f[1], f1[1]), mix(f[2], f1[2])]);
      r = [-c.upY, c.upX, 0];                                             // (the right-hand side is level, whatever the pitch)
      if (c.fpv.basis) {                                                  // the plane's own view: forward and up from the glider (y north, z up become y south, Z down), the right-hand side from them
        const F = c.fpv.basis.f, U = c.fpv.basis.u, f2: Vec3 = [F[0], -F[1], -F[2]], u2: Vec3 = [U[0], -U[1], -U[2]];
        const fb = norm([mix(fc[0], f2[0]), mix(fc[1], f2[1]), mix(fc[2], f2[2])]), ub: Vec3 = [mix(0, u2[0]), mix(0, u2[1]), mix(-1, u2[2])];   // (blending in from the chase view's level up)
        const rb = cross(fb, ub); r = Math.hypot(rb[0], rb[1], rb[2]) > 1e-4 ? norm(rb) : [-c.upY, c.upX, 0]; f = fb;
      }
      const hasFar = !!T && !!this.farMesh;
      if (hasFar) this.nearReach = mix(this.reach, 200 * this.walkK);                       // the real chunks reach 140 tiles; the far mesh shows the rest of the map, hazing out at 560
      this.reach = mix(this.reach, T ? (hasFar ? FAR_REACH : 240 * this.walkK) : 200 * this.drawK); this.fogStart = mix(this.fogStart, T ? (hasFar ? Math.max(500, 300 * this.walkK) : 180 * this.walkK) : 140 * this.drawK); this.farOn = hasFar;   // (a flat world keeps at least the flying view's reach, and 150 tiles, when the eye comes down: it used to shrink to 48, which cut the ground off close by)   // (a hilly world shows far: fells and lakes kilometres off. The flat worlds keep their short haze)   // (the haze only in the last few tiles: from eye height it is a thin strip at the horizon, so the tree line meets the grass instead of floating over a pale band)
      this.fogStart = Math.max(this.fogStart, this.reach * 0.9);   // (the blend from the flying view's haze to the walking one must not pass through a close fog: the haze only ever sits in the last tenth of the reach)
      near = mix(near, hasFar ? 0.15 : 0.05); far = mix(far, this.reach * 1.6);
    }
    this.fpvK = c.fpv ? Math.min(1, c.fpv.k) : 0;
    if (T) { const g = this.groundNear(this.eye[0], this.eye[1], 0.4, !onFoot) + 0.2; if (-this.eye[2] < g) this.eye[2] = -g; }   // (last guard: whatever the mode, the eye is above the ground)
    const u = cross(r, f);
    this.F = f; this.R = r; this.U = u;
    if (c.fullView && this.fpvK === 0) {
      // the reach is one fixed distance (the draw distance setting), whatever the camera looks at. It used to be just past the farthest visible ground, and the full cap
      // the moment the horizon came on screen: looking up (the plane above the horizon) then asked for far more ground at once, which was not built yet, and the ground vanished
      const CAP = 200 * this.drawK;
      this.reach = CAP; this.fogStart = CAP * 0.85   // (the haze only in the last sixth: at night it is dark, and a wide dark band at the horizon reads as missing ground)
      far = this.reach * 1.6 + D;
    }
    if (T && this.farMesh && !(c.fpv && c.fpv.k > 0)) {                 // flying: the same far mesh beyond the chunks the view needs, so the fells stand on the horizon
      this.nearReach = Math.min(this.reach, 200 * this.drawK, 400); this.reach = Math.max(FAR_REACH, Math.max(0, -this.eye[2]) * 4); this.fogStart = Math.max(this.fogStart, 500); this.farOn = true;
      far = Math.max(far, this.reach * 1.05 + D);
    }
    if (this.nearCap < Infinity && this.nearReach > 0) this.nearReach = Math.min(this.nearReach, this.nearCap);
    far = Math.max(far, this.skyRadius * 1.05 + D);
    const a = 1 / tanY, asp = c.W / c.H, e = this.eye;
    // view * projection, column-major: clip = P * V * p, with V's rows r, u, -f
    const vr = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
    this.zNear = near; this.zFar = far;
    const P = [a / asp, 0, 0, 0, 0, a, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    const m = this.vp;
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
      let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + row] * vr[col * 4 + k];
      m[col * 4 + row] = s;
    }
  }

  /** The stage position, in CSS pixels, of a world point (z is down), or null when it is behind the camera. */
  project(x: number, y: number, z: number): [number, number] | null {   // (z is the world's, down; for a height above the ground use projectAgl)
    const m = this.vp, cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.0001) return null;
    return [(cx / cw * 0.5 + 0.5) * this.W, (1 - (cy / cw * 0.5 + 0.5)) * this.H];
  }

  /** The stage position of a point `h` tiles above the ground under it. */
  projectAgl(x: number, y: number, h: number): [number, number] | null { return this.project(x, y, -h - this.groundH(x, y)); }

  /** Where a ray through a stage point (-1..1 both ways) meets the ground, clamped to the reach; the points ring the visible ground. */
  private groundAt(nx: number, ny: number): [number, number] {
    const d: Vec3 = [this.R[0] * nx * this.tanX + this.U[0] * ny * this.tanY + this.F[0], this.R[1] * nx * this.tanX + this.U[1] * ny * this.tanY + this.F[1], this.R[2] * nx * this.tanX + this.U[2] * ny * this.tanY + this.F[2]];
    const hl = Math.hypot(d[0], d[1]) || 1e-6;
    // Where the ray meets the ground, taken as a flat plane. On the terraces the plane is the lowest ground there is (the beach, 0), not the ground under the plane: lowland (a lake basin,
    // a valley below the shelf the plane flies over) is met farther out than a plane at the plane's own height says, and chunks there fell outside this polygon, were never listed or uploaded,
    // and, with the far ground told to start well beyond them, were drawn by nobody. A plane at the bottom reaches everything above it (a hill is met sooner, never later).
    let t = d[2] > 1e-4 ? Math.max(0, -this.eye[2] - (this.terraceStep > 0 ? 0 : this.baseH)) / d[2] : Infinity;
    const lim = this.nearReach > 0 ? this.nearReach : this.reach;
    if (t * hl > lim) t = lim / hl;                         // looks over the horizon, or past the reach: stop at the reach
    return [this.eye[0] + d[0] * t, this.eye[1] + d[1] * t];
  }

  /** The visible ground as a polygon round the stage's border (rays clamped at the reach, so the far edge is an arc) and its bounding box, in tiles. */
  footprint() {
    // The stage's border, 12 points a side. The ground is cut off at the reach, so where one point is cut and its neighbour is not, the straight line between them cuts a corner off what is
    // visible: with 4 points a side that corner was tens of tiles and chunks in it were never listed (a patch of missing ground). The more points, the smaller the corner.
    const border: [number, number][] = [];
    for (let i = 0; i < 12; i++) { const u = -1 + (2 * i) / 12; border.push([u, 1]); }
    for (let i = 0; i < 12; i++) { const u = 1 - (2 * i) / 12; border.push([1, u]); }
    for (let i = 0; i < 12; i++) { const u = 1 - (2 * i) / 12; border.push([u, -1]); }
    for (let i = 0; i < 12; i++) { const u = -1 + (2 * i) / 12; border.push([-1, u]); }
    // The ground the border meets is where a flat plane is; ground that stands higher is met sooner, on the same rays, between the eye and that edge. So the region is the hull of the eye and
    // the points, a wedge that starts at the eye (a hill by a lake is seen on rays that hit it long before the plane they were drawn against, and chunks there were never listed).
    const pts = convexHull([...border.map(([nx, ny]) => this.groundAt(nx, ny)), [this.eye[0], this.eye[1]]]), n = pts.length;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, area = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i], b = pts[(i + 1) % n];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      area += x * b[1] - b[0] * y;
    }
    const sgn = area >= 0 ? 1 : -1;                                       // the polygon's winding, so "inside" is the same side of every edge
    // (each edge's start and unit direction are worked out once here: `inside` is asked for thousands of sprites a frame)
    const eax: number[] = [], eay: number[] = [], enx: number[] = [], eny: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      eax.push(a[0]); eay.push(a[1]); enx.push(sgn * ex / len); eny.push(sgn * ey / len);
    }
    const ne = eax.length;
    const inside = (x: number, y: number, m: number) => {
      for (let i = 0; i < ne; i++) if (enx[i] * (y - eay[i]) - eny[i] * (x - eax[i]) < -m) return false;
      return true;
    };
    if (this.fpvK > 0.002) {                                              // on foot the fan of rays is thin close to the eye: take everything round the eye in front of it, too
      const ex = this.eye[0], ey = this.eye[1], R = this.nearReach > 0 ? this.nearReach : this.reach, fx = this.F[0], fy = this.F[1], fl = Math.hypot(fx, fy) || 1;
      const chase = inside, near = (x: number, y: number, m: number) => { const dx = x - ex, dy = y - ey; return dx * dx + dy * dy < (R + m) * (R + m) && (dx * fx + dy * fy) / fl > -(m + 2); };
      return { minX: Math.min(minX, ex - R), maxX: Math.max(maxX, ex + R), minY: Math.min(minY, ey - R), maxY: Math.max(maxY, ey + R), inside: (x: number, y: number, m: number) => near(x, y, m) || chase(x, y, m) };
    }
    return { minX, maxX, minY, maxY, inside };
  }

  // ---- drawing ------------------------------------------------------------------------------------------------------

  /** Set the sun for the time of day (hours): its direction, a warmer horizon at dawn and dusk, and the sky colour the ground fades into. */
  setHour(hour: number) {
    const e = sunElevation(hour);
    // the sun's path is one great circle, turned at a steady rate: up in the east at 6h, highest in the south (75 degrees) at noon, down in the west at 18h,
    // and on under the ground to the north and back (so the moon, opposite it, takes the same smooth path across the night sky). No kinks, no jump at midnight.
    const th = ((hour - 6) / 24) * Math.PI * 2, dl = (75 * Math.PI) / 180;
    this.sunDir = [Math.cos(th), Math.sin(th) * Math.cos(dl), -Math.sin(th) * Math.sin(dl)];
    this.dayK = Math.max(0, Math.min(1, (e + 0.1) / 0.2));
    this.spin = Math.sin((hour / 24) * Math.PI * 2) * 0.1;   // (it only sways a few degrees to and fro over the day, so it never jumps at midnight)
    { const t = Math.max(0, Math.min(1, (e - 0.15) / 0.45)); this.noonK = t * t * (3 - 2 * t); }
    const warm = Math.max(0, 1 - Math.abs(e) / 0.3) * 0.65, base = [0.62, 0.78, 0.9], glow = [1.0, 0.62, 0.38];
    this.sky = [base[0] + (glow[0] - base[0]) * warm, base[1] + (glow[1] - base[1]) * warm, base[2] + (glow[2] - base[2]) * warm];
    this.zenith = [0.3 + 0.25 * warm, 0.52 - 0.14 * warm, 0.85 - 0.3 * warm];
    this.light = [1 + 0.10 * warm, 1 - 0.03 * warm, 1 - 0.14 * warm];
  }

  /** The textures the glow pass draws through, made (again) when the canvas changes size. False when there is no glow pass. */
  private ensurePost(): boolean {
    if (!this.postProg || this.postBroken) return false;
    const gl = this.gl, w = gl.canvas.width, h = gl.canvas.height, sw = Math.max(1, Math.round(w * this.renderScale)), sh = Math.max(1, Math.round(h * this.renderScale));
    if (this.post && this.post.w === w && this.post.h === h && this.post.sw === sw && this.post.sh === sh && this.post.wantMs === dbgOn('msaa')) return true;
    this.freePost();
    const build = (hdr: boolean) => {
      const mk = (tw: number, th: number): Target => {
        const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, tw, th, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { fb, tex, w: tw, h: th };
      };
      const qw = Math.max(1, sw >> 2), qh = Math.max(1, sh >> 2);
      const a = mk(qw, qh), b = mk(qw, qh), scene = mk(sw, sh), depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, sw, sh);
      const depthBits = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_DEPTH_SIZE) as number;
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      this.post = { w, h, sw, sh, hdr, depth, depthBits, wantMs: dbgOn('msaa'), scene, a, b };
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };
    const canHdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));   // brighter-than-white colours, so only the sun and the glitter glow
    let ok = canHdr && build(true);
    if (!ok) { this.freePost(); ok = build(false); }
    if (ok && dbgOn('msaa') && this.post) {   // `?dbg=msaa`: the scene is drawn into a multisampled copy of the same formats and resolved into the scene texture (see `end`)
      const P = this.post, fmt = P.hdr ? gl.RGBA16F : gl.RGBA8, list = gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES) as Int32Array | null, samples = list && list.length ? Math.min(4, list[0]) : 0;
      if (samples > 1) {
        const fb = gl.createFramebuffer()!, color = gl.createRenderbuffer()!, depth = gl.createRenderbuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, P.sw, P.sh); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, P.sw, P.sh); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) P.ms = { fb, color, depth, samples };
        else { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); console.warn('msaa: multisampled framebuffer incomplete'); }
      } else console.warn('msaa: no multisampled format for', P.hdr ? 'RGBA16F' : 'RGBA8');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    if (!ok) { this.freePost(); this.postBroken = true; console.warn('3D glow pass unavailable: framebuffer'); }
    return ok;
  }
  private freePost() {
    const gl = this.gl, p = this.post; this.post = null; if (!p) return;
    for (const t of [p.scene, p.a, p.b]) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    gl.deleteRenderbuffer(p.depth);
    if (p.ms) { gl.deleteFramebuffer(p.ms.fb); gl.deleteRenderbuffer(p.ms.color); gl.deleteRenderbuffer(p.ms.depth); }
  }
  /** The scene texture to the screen: bright parts out, blurred at a quarter of the size, then laid back with the sun's rays, a little grading and darker corners. */
  private runPost() {
    const gl = this.gl, p = this.post!, pp = this.postProg!, L = this.postLoc;
    for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.activeTexture(gl.TEXTURE0);
    if (this.fx) {   // (without the pretty extras only the last pass runs: the stretch, and the CRT look if it is on)
    gl.viewport(0, 0, p.a.w, p.a.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.a.fb); gl.useProgram(pp.bright); gl.bindTexture(gl.TEXTURE_2D, p.scene.tex);
    gl.uniform1i(L['bright.uTex'], 0); gl.uniform2f(L['bright.uPx'], 1 / p.sw, 1 / p.sh); gl.uniform1f(L['bright.uThr'], p.hdr ? 1.0 : 0.82);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(pp.blur); gl.uniform1i(L['blur.uTex'], 0);
    for (const step of [1, 2]) {                                              // twice, the second time wider
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.b.fb); gl.bindTexture(gl.TEXTURE_2D, p.a.tex); gl.uniform2f(L['blur.uDir'], step / p.a.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.a.fb); gl.bindTexture(gl.TEXTURE_2D, p.b.tex); gl.uniform2f(L['blur.uDir'], 0, step / p.a.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    }
    // where the sun is on the screen: the rays fade out as it leaves the picture, and there are none when it is behind the camera or down
    const s = this.sunDir, e = this.eye, at = this.project(e[0] + s[0] * 1e4, e[1] + s[1] * 1e4, e[2] + s[2] * 1e4);
    let rays = 0, su = 0.5, sv = 0.5;
    if (at && this.dayK > 0) {
      su = at[0] / this.W; sv = 1 - at[1] / this.H;
      const out = Math.max(0, -su, su - 1, -sv, sv - 1);
      rays = this.fx ? this.dayK * (1 - this.night[3]) * 0.55 * Math.max(0, 1 - out / 0.5) : 0;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, p.w, p.h); gl.useProgram(pp.comp);
    gl.bindTexture(gl.TEXTURE_2D, p.scene.tex); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, p.a.tex); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(L['comp.uScene'], 0); gl.uniform1i(L['comp.uBloom'], 1); gl.uniform2f(L['comp.uSunPos'], su, sv);
    gl.uniform1f(L['comp.uRays'], rays); gl.uniform1f(L['comp.uBloomK'], this.fx ? 0.7 : 0); gl.uniform1f(L['comp.uVig'], this.crt ? 0.32 : 0.22); gl.uniform1f(L['comp.uCrt'], this.crt ? 1 : 0); gl.uniform2f(L['comp.uSceneSz'], p.sw, p.sh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.useProgram(this.prog);
  }

  begin() {
    const gl = this.gl;
    this.postOn = (this.fx || this.crt) && this.ensurePost();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.postOn ? (this.post!.ms?.fb ?? this.post!.scene.fb) : null);
    if (this.postOn) gl.viewport(0, 0, this.post!.sw, this.post!.sh); else gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    const nt = this.night, nk = nt[3];
    gl.clearColor(this.sky[0] * (1 - nk) + nt[0] * nk, this.sky[1] * (1 - nk) + nt[1] * nk, this.sky[2] * (1 - nk) + nt[2] * nk, 1); gl.clearDepth(1);
    gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    {   // the skybox, behind everything
      for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
      gl.useProgram(this.skyProg); gl.disable(gl.DEPTH_TEST);
      const L = this.skyLoc, nt = this.night;
      gl.uniform3f(L.uF, this.F[0], this.F[1], this.F[2]); gl.uniform3f(L.uR, this.R[0], this.R[1], this.R[2]); gl.uniform3f(L.uU, this.U[0], this.U[1], this.U[2]);
      gl.uniform3f(L.uHor, this.sky[0], this.sky[1], this.sky[2]); gl.uniform3f(L.uZen, this.zenith[0], this.zenith[1], this.zenith[2]);
      gl.uniform3f(L.uSun, this.sunDir[0], this.sunDir[1], this.sunDir[2]); gl.uniform2f(L.uTan, this.tanX, this.tanY);
      gl.uniform4f(L.uNight, nt[0], nt[1], nt[2], nt[3]); gl.uniform1f(L.uDay, this.dayK); gl.uniform1f(L.uNoon, this.noonK); gl.uniform1f(L.uTime, performance.now() / 1000);
      gl.uniform1f(L.uSpace, this.space); gl.uniform1f(L.uHigh, this.highK()); gl.uniform1f(L.uDip, this.dipSin()); gl.uniform1f(L.uFx, this.fx ? 1 : 0); gl.uniform1f(L.uHasStars, this.starsTex ? 1 : 0); gl.uniform1f(L.uSpin, this.spin);
      gl.uniform2f(L.uPos, Math.tanh(this.eye[0] / 400) * 400, Math.tanh(this.eye[1] / 400) * 400);   // (the position is squashed to +-400 tiles: the shift changes with the azimuth, so a big shift would squeeze and stretch the clouds; this keeps every layer within about 9% of its width)
      gl.uniform1f(L.uHasMoon, this.moonTex ? 1 : 0);
      if (this.moonTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.moonTex); gl.uniform1i(L.uMoon, 8); gl.activeTexture(gl.TEXTURE0); }
      if (this.starsTex) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.starsTex); gl.uniform1i(L.uStars, 2); gl.activeTexture(gl.TEXTURE0); }
      const lt = this.layerTex, names = ['uCirrus', 'uStrato', 'uCumulus', 'uMount', 'uTrees'];
      gl.uniform4f(L.uHas, lt[0] ? 1 : 0, lt[1] ? 1 : 0, lt[2] ? 1 : 0, lt[3] ? 1 : 0); gl.uniform1f(L.uHasT, lt[4] ? 1 : 0);
      {   // the higher the eye (metres above sea level), the lower the layers stand: the angle a layer's base lies below the eye, for how far off it is (mountains far, the near trees close). A flat map's camera height is no altitude
        const m = this.terrain ? Math.max(0, -this.eye[2] / 0.18) : 0, dg = (d: number) => Math.atan(m / d) * 180 / Math.PI;
        gl.uniform4f(L.uDrop, dg(2500), dg(1800), dg(1100), dg(650));
      } gl.uniform1f(L.uSea, this.terrain ? 1 : 0);
      lt.forEach((t, i) => { gl.activeTexture(gl.TEXTURE3 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(L[names[i]], 3 + i); });   // (units 3..7)
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.enable(gl.DEPTH_TEST);
    }
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.uVP, false, this.vp);
    gl.uniform3f(this.loc.uEye, this.eye[0], this.eye[1], this.eye[2]); gl.uniform1f(this.loc.uCurveC, this.curveC);
    { const sp = 1 - 0.45 * this.space; gl.uniform3f(this.loc.uFog, this.sky[0] * sp, this.sky[1] * sp, this.sky[2] * sp); }   // (the same haze as the sky's below the horizon)
    // no distance haze, except high up over a hilly world: the far ground fades into the haze before the edge of what is drawn, so it meets the sky with no gap
    { const hk = this.farOn && this.farMesh ? this.highK() : 0, st = this.reach * (0.55 + 3 * (1 - hk)); if (hk > 0) gl.uniform2f(this.loc.uFogRange, st, st + this.reach * 0.42); else gl.uniform2f(this.loc.uFogRange, 1e7, 2e7); }
    gl.uniform1i(this.loc.uTex, 0);
    gl.uniform4f(this.loc.uNight, nt[0], nt[1], nt[2], nt[3]);
    gl.uniform1f(this.loc.uFx, this.fx ? 1 : 0); gl.uniform1f(this.loc.uTime, (performance.now() / 1000) % 3600); gl.uniform1f(this.loc.uDay, this.dayK);
    gl.uniform3f(this.loc.uSun, this.sunDir[0], this.sunDir[1], this.sunDir[2]); gl.uniform3f(this.loc.uZen, this.zenith[0], this.zenith[1], this.zenith[2]);
    gl.uniform3f(this.loc.uLight, this.light[0], this.light[1], this.light[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
    this.pools.decal.n = 0; this.pools.solid.n = 0; this.pools.blend.n = 0; this.nBlend = 0;
  }

  /** Draw the chunks (each a ground-sized quad textured with its canvas). New or rebuilt canvases are uploaded once. */
  ground(list: GroundChunk[], chunkTiles: number) {
    const gl = this.gl;
    this.groundFrames++;
    const e = 0.03;                                                              // a hair of overlap hides cracks between chunks
    // a new chunk costs a texture (read back, uploaded, mip-mapped) and, on hills, a mesh: far too much for one frame when a lot come in at once (flying fast, a camera jump).
    // So only a few are made each frame, the nearest first (at least one, then while ~3 ms last); the rest are skipped this frame and drawn once their turn comes.
    let pending: typeof list | null = null;
    for (const c of list) { const ent = this.chunkTex.get(c.key); if (!ent || ent.src !== c.src || (this.terrain && (!ent.vao || ent.stale))) (pending ??= []).push(c); }
    let made = 0;
    this.lastMade = 0;
    if (pending) {
      const ex = this.eye[0], ey = this.eye[1];
      const hole = (c: GroundChunk) => { const e = this.chunkTex.get(c.key); return !e || !e.vao ? 0 : 1; };   // (a chunk with nothing to draw before one that is only out of date: the hole first, whatever its distance)
      pending.sort((a, b) => hole(a) - hole(b) || Math.hypot((a.cx + 0.5) * chunkTiles - ex, (a.cy + 0.5) * chunkTiles - ey) - Math.hypot((b.cx + 0.5) * chunkTiles - ex, (b.cy + 0.5) * chunkTiles - ey));
      const t0 = performance.now();
      for (const c of pending) { if (made > 0 && (made >= this.uploadMax || performance.now() - t0 > 3)) break; made++; const e0 = performance.now(); this.ensureChunk(c, chunkTiles); this.oneMs = Math.max(this.oneMs, performance.now() - e0); }
      this.madeMs = Math.max(this.madeMs, performance.now() - t0); this.madeN += made; this.oneN += made; this.lastMade = made;
    }
    // The far mesh is drawn after the chunks have had their turn: it fills in for every chunk that is still not on the GPU (texture or mesh not made yet, dropped to keep the pool small, its mesh forgotten),
    // not only for the ones the map has not built: such a chunk is built but not drawn, and with the far mesh held back inside `cover` that left a hole to the sky's tree line.
    this.undrawn = Infinity;
    if (this.terrain) {
      const ex = this.eye[0], ey = this.eye[1];
      for (const c of list) { const ent = this.chunkTex.get(c.key); if (!ent || !ent.vao) this.undrawn = Math.min(this.undrawn, Math.hypot((c.cx + 0.5) * chunkTiles - ex, (c.cy + 0.5) * chunkTiles - ey) - chunkTiles); }
      this.undrawn = Math.max(0, this.undrawn);
    }
    gl.bindVertexArray(null);   // (a chunk made just now has its vertex array bound: the far mesh must not rewrite it)
    if (this.farOn && this.farMesh) { this.drawFar(); gl.uniform1f(this.loc.uHole, this.coverSm * 0.9); gl.uniform1f(this.loc.uBand, this.nearBand); gl.uniform1f(this.loc.uHoleMax, 1); } else gl.uniform1f(this.loc.uHoleMax, 0);
    gl.uniform1f(this.loc.uCut, 0.5); gl.depthMask(true); gl.uniform1f(this.loc.uTileUv, 1 / chunkTiles);
    gl.uniform4f(this.loc.uBase, 15 / 255, 107 / 255, 140 / 255, 1);   // the flat map's water colour, under every ground tile
    gl.uniform1i(this.loc.uDbg, dbgBits());   // (the bisect switches of the Debug section, read every frame so a click shows at once)
    gl.uniform1f(this.loc.uTerr, this.terrain ? 1 : 0); gl.uniform1f(this.loc.uTerrace, this.terrain ? this.terraceStep : 0);
    if (this.terrain) {
      for (const c of list) {
        const ent = this.chunkTex.get(c.key);
        if (!ent) continue;   // (its turn has not come yet)
        ent.used = this.groundFrames; gl.bindTexture(gl.TEXTURE_2D, ent.tex); this.drawTerrainChunk(c, ent, chunkTiles);
      }
    } else {   // flat chunks: every quad goes up in one buffer (one upload, not one per chunk), then one small draw each, each with its own texture
      const need = Math.min(MAX_QUADS, list.length) * 4 * FLOATS;
      if (!this.gbuf || this.gbuf.length < need) this.gbuf = new Float32Array(need);
      const b = this.gbuf, drawn = this.gdrawn; drawn.length = 0; let o = 0;
      for (const c of list) {
        const ent = this.chunkTex.get(c.key);
        if (!ent || drawn.length >= MAX_QUADS) continue;
        ent.used = this.groundFrames;
        const x0 = c.cx * chunkTiles - e, y0 = c.cy * chunkTiles - e, x1 = (c.cx + 1) * chunkTiles + e, y1 = (c.cy + 1) * chunkTiles + e;
        b[o++] = x0; b[o++] = y0; b[o++] = 0; b[o++] = 0; b[o++] = 0; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1;
        b[o++] = x1; b[o++] = y0; b[o++] = 0; b[o++] = 1; b[o++] = 0; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1;
        b[o++] = x1; b[o++] = y1; b[o++] = 0; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1;
        b[o++] = x0; b[o++] = y1; b[o++] = 0; b[o++] = 0; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1; b[o++] = 1;
        drawn.push(ent.tex);
      }
      if (drawn.length) {
        gl.bufferData(gl.ARRAY_BUFFER, b.subarray(0, o), gl.DYNAMIC_DRAW);
        for (let i = 0; i < drawn.length; i++) { gl.bindTexture(gl.TEXTURE_2D, drawn[i]); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, i * 12); }
      }
    }
    if (this.terrain) {
      gl.uniform1f(this.loc.uSurf, 1); gl.depthMask(false);   // the sheets of inland water, see-through, over the beds and the foot of the walls
      for (const c of list) { const ent = this.chunkTex.get(c.key); if (!ent || !ent.wvao) continue; gl.bindTexture(gl.TEXTURE_2D, ent.tex); gl.bindVertexArray(ent.wvao); gl.drawElements(gl.TRIANGLES, ent.wcount!, gl.UNSIGNED_INT, 0); }
      gl.uniform1f(this.loc.uSurf, 0); gl.depthMask(true);
      gl.bindVertexArray(null); this.endTerrain();
    }
    gl.uniform1f(this.loc.uTerr, 0);
  }

  /** Make (or remake, when the chunk's picture was redrawn) a chunk's texture; the mesh of a hilly chunk is built by its first draw. */
  private ensureChunk(c: GroundChunk, chunkTiles: number) {
    let ent = this.chunkTex.get(c.key);
    if (!ent) { ent = { src: c.src, tex: this.chunkTexture(c.src, null) }; this.chunkTex.set(c.key, ent); }
    else if (ent.src !== c.src) { this.chunkTexture(c.src, ent.tex); ent.src = c.src; if (c.meshBox?.mesh && ent.vao) this.dropTerrainMeshes([c.key]); }   // (a changed chunk is written into its own texture; when the worker sent its mesh too, that one is cut in)

    if (this.terrain && (!ent.vao || ent.stale)) { if (ent.stale) this.freeMesh(ent); this.prepTerrain(c, ent, chunkTiles); }
  }

  /** A chunk of a hilly world: a 16 x 16 grid of quads at the ground's height, the chunk canvas over it, each vertex carrying its normal in the colour. Built once, kept with the texture. A terraced world brings its own mesh (`terraceMesh`) instead: level pieces and vertical walls. */
  private prepTerrain(c: { cx: number; cy: number; meshBox?: MeshBox }, ent: { mesh?: WebGLBuffer; ibo?: WebGLBuffer; count?: number; wmesh?: WebGLBuffer; wibo?: WebGLBuffer; wcount?: number; wvao?: WebGLVertexArrayObject; vao?: WebGLVertexArrayObject }, tiles: number) {
    const gl = this.gl, T = this.terrain!, sub = this.terrainSub, n = tiles * sub, side = n + 1, st = 1 / sub;   // (n: quads a side; st: tiles between vertices)
    gl.bindVertexArray(null);   // (a chunk drawn just before still has its vertex array bound, and binding an index buffer now would swap that chunk's indices for this one's)
    if (this.terraceMesh) {
      if (!ent.mesh) {
        const m = c.meshBox?.mesh ?? this.terraceMesh(c.cx, c.cy), nv = m.pos.length / 3, v = new Float32Array(nv * FLOATS), x0 = c.cx * tiles, y0 = c.cy * tiles;
        if (c.meshBox) c.meshBox.mesh = undefined;   // (taken: the arrays are copied into the buffer below, and nothing else needs them)
        for (let i = 0; i < nv; i++) {
          const o = i * FLOATS, x = m.pos[i * 3], y = m.pos[i * 3 + 1];
          v[o] = x; v[o + 1] = y; v[o + 2] = m.pos[i * 3 + 2]; v[o + 3] = (x - x0) / tiles; v[o + 4] = (y - y0) / tiles;
          v[o + 5] = m.nrm[i * 3] * 0.5 + 0.5; v[o + 6] = m.nrm[i * 3 + 1] * 0.5 + 0.5; v[o + 7] = m.nrm[i * 3 + 2] * 0.5 + 0.5; v[o + 8] = m.sub[i] ? 0.55 - 0.02 * Math.min(m.sub[i], 5) : 1;   // (alpha 0.53 .. 0.45 marks ground under water, and how many layers down the surface is: the shader gives it a bed's colour by depth)
        }
        ent.mesh = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, ent.mesh); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
        ent.ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ent.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW); ent.count = m.idx.length;
        if (m.widx.length) {   // the sheet of inland water: its own little mesh, drawn see-through after the ground
          const wn = m.wpos.length / 3, wv = new Float32Array(wn * FLOATS);
          for (let i = 0; i < wn; i++) { const o = i * FLOATS, x = m.wpos[i * 3], y = m.wpos[i * 3 + 1]; wv[o] = x; wv[o + 1] = y; wv[o + 2] = m.wpos[i * 3 + 2]; wv[o + 3] = (x - x0) / tiles; wv[o + 4] = (y - y0) / tiles; const k = m.wkind[i]; if (k >= 2) { const an = (k - 2) / 250 * Math.PI * 2 - Math.PI; wv[o + 5] = Math.cos(an) * 0.5 + 0.5; wv[o + 6] = Math.sin(an) * 0.5 + 0.5; wv[o + 7] = 0.5; wv[o + 8] = 0.25; } else { wv[o + 5] = 0.5; wv[o + 6] = 0.5; wv[o + 7] = 0; wv[o + 8] = k ? 0.5 : 1; } }   // (a waterfall's curtain (kind 2 and up, which way it faces in the number) carries that facing as its normal, flat sheets point up)   // (alpha 0.5 on a sheet marks a beaver's pond: the shader tints it)
          ent.wmesh = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, ent.wmesh); gl.bufferData(gl.ARRAY_BUFFER, wv, gl.STATIC_DRAW);
          ent.wibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ent.wibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.widx, gl.STATIC_DRAW); ent.wcount = m.widx.length;
          const stride = FLOATS * 4;
          ent.wvao = gl.createVertexArray()!; gl.bindVertexArray(ent.wvao);
          gl.bindBuffer(gl.ARRAY_BUFFER, ent.wmesh); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ent.wibo);
          gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
          gl.bindVertexArray(null);
        }
      }
    } else {
      if (!this.terrIbo) {
        const idx = new Uint16Array(n * n * 6);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * side + i, b = a + 1, d = a + side, e2 = d + 1; idx.set([a, b, e2, a, e2, d], (j * n + i) * 6); }
        this.terrIbo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      }
      if (!ent.mesh) {
        const v = new Float32Array(side * side * FLOATS), x0 = c.cx * tiles, y0 = c.cy * tiles, h = (x: number, y: number) => T(x, y);
        for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
          const x = x0 + i * st, y = y0 + j * st, o = (j * side + i) * FLOATS;
          const gx = (h(x + st, y) - h(x - st, y)) / (2 * st), gy = (h(x, y + st) - h(x, y - st)) / (2 * st);        // the slope east and south; z is down, so the normal is (gx, gy, -1) up to its length
          const l = Math.hypot(gx, gy, 1);
          v[o] = x; v[o + 1] = y; v[o + 2] = -h(x, y); v[o + 3] = i / n; v[o + 4] = j / n;
          v[o + 5] = (gx / l) * 0.5 + 0.5; v[o + 6] = (gy / l) * 0.5 + 0.5; v[o + 7] = (-1 / l) * 0.5 + 0.5; v[o + 8] = 1;
        }
        ent.mesh = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, ent.mesh); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      }
    }
    if (!ent.vao) {   // the chunk's own vertex array: its buffers and attribute layout are set once, a draw is one bind and one call
      const stride = FLOATS * 4;
      ent.vao = gl.createVertexArray()!; gl.bindVertexArray(ent.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, ent.mesh!); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ent.ibo ?? this.terrIbo);
      gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
      gl.bindVertexArray(null);   // (never leave the chunk's own vertex array bound: whatever binds buffers next (`endTerrain`, a far-mesh upload, the sprite pass) would change ITS index buffer, and the chunk could not be drawn again: the dark squares)
    }
  }
  /** Mark the meshes of these chunks as out of date (their ground changed under water): each keeps drawing as it is until its turn comes to be built again from the new ground (a few a frame, nearest first), so no chunk is ever a hole meanwhile. */
  dropTerrainMeshes(keys: number[]) {
    for (const k of keys) { const e = this.chunkTex.get(k); if (e && e.vao) e.stale = true; }
  }
  /** Give back a chunk's mesh buffers (it is built again straight after, or the chunk is gone). */
  private freeMesh(e: { mesh?: WebGLBuffer; ibo?: WebGLBuffer; count?: number; wmesh?: WebGLBuffer; wibo?: WebGLBuffer; wcount?: number; wvao?: WebGLVertexArrayObject; vao?: WebGLVertexArrayObject; stale?: boolean }) {
    const gl = this.gl;
    if (e.mesh) gl.deleteBuffer(e.mesh); if (e.ibo) gl.deleteBuffer(e.ibo); if (e.vao) gl.deleteVertexArray(e.vao);
    if (e.wmesh) gl.deleteBuffer(e.wmesh); if (e.wibo) gl.deleteBuffer(e.wibo); if (e.wvao) gl.deleteVertexArray(e.wvao);
    e.mesh = e.ibo = e.vao = e.wmesh = e.wibo = e.wvao = undefined; e.count = e.wcount = undefined; e.stale = false;
  }
  private drawTerrainChunk(c: { cx: number; cy: number; meshBox?: MeshBox }, ent: { mesh?: WebGLBuffer; ibo?: WebGLBuffer; count?: number; wmesh?: WebGLBuffer; wibo?: WebGLBuffer; wcount?: number; wvao?: WebGLVertexArrayObject; vao?: WebGLVertexArrayObject }, tiles: number) {
    const gl = this.gl, n = tiles * this.terrainSub;
    if (!ent.vao) this.prepTerrain(c, ent, tiles);
    gl.bindVertexArray(ent.vao!);
    if (ent.count) gl.drawElements(gl.TRIANGLES, ent.count, gl.UNSIGNED_INT, 0); else gl.drawElements(gl.TRIANGLES, n * n * 6, gl.UNSIGNED_SHORT, 0);
  }
  /** Back to the shared buffers the sprites are written into. */
  private endTerrain() {
    const gl = this.gl, stride = FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
  }

  /** Give a hilly world its far meshes, finest first (see lakeFarLods): positions, colours and indices of each. */
  setFar(lods: { pos: Float32Array; col: Float32Array; idx: Uint32Array }[] | null) {
    const gl = this.gl;
    if (this.farMesh) for (const m of this.farMesh) if (m) { gl.deleteBuffer(m.vbo); if (!m.shared) gl.deleteBuffer(m.ibo); }
    this.farMesh = null;
    if (!lods || !lods.length) return;
    this.farMesh = lods.map(m => this.uploadFar(m));
    this.endTerrain();
  }
  /**
   * Replace one far level (the terraced world rebuilds each level around the eye as it travels; see terrace.ts terraceFarMesh). A generator, so the work spreads over frames: the
   * vertices are interleaved a slice at a time, then uploaded in one go, over the old buffer's storage when the size is the same (it always is), and with the index buffer the
   * level already has. The old level keeps drawing until the swap.
   */
  *farLodUpload(i: number, m: { pos: Float32Array; col: Float32Array; idx: Uint32Array }): Generator<void, void, void> {
    const gl = this.gl, d = this.cells.dot, du = (d.u0 + d.u1) / 2, dv = (d.v0 + d.v1) / 2, n = m.pos.length / 3, len = n * FLOATS, SLICE = 24000;
    if (this.farStage.length !== len) this.farStage = new Float32Array(len);
    const v = this.farStage;
    // a new buffer, filled a slice a frame and swapped in at the end: one upload of the whole level is several MB, a long stall on a phone, and writing into the buffer being drawn would show half a level
    const vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, v.byteLength, gl.STATIC_DRAW); this.endTerrain();
    for (let a = 0; a < n; a += SLICE) {
      const e = Math.min(n, a + SLICE);
      for (let k = a; k < e; k++) { const o = k * FLOATS; v[o] = m.pos[k * 3]; v[o + 1] = m.pos[k * 3 + 1]; v[o + 2] = m.pos[k * 3 + 2]; v[o + 3] = du; v[o + 4] = dv; v[o + 5] = m.col[k * 3]; v[o + 6] = m.col[k * 3 + 1]; v[o + 7] = m.col[k * 3 + 2]; v[o + 8] = 1; }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferSubData(gl.ARRAY_BUFFER, a * FLOATS * 4, v, a * FLOATS, (e - a) * FLOATS); this.endTerrain();   // (the usual buffers bound again for whatever draws next)
      yield;
    }
    this.farMesh ??= [];
    const old = this.farMesh[i];
    let ibo = this.farIbos.get(m.idx);
    if (!ibo) { ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW); this.farIbos.set(m.idx, ibo); }
    if (old) gl.deleteBuffer(old.vbo);
    const cols = Math.round(Math.sqrt(n));
    this.farMesh[i] = { vbo, ibo, n: m.idx.length, bytes: v.byteLength, shared: true, grid: cols * cols === n && cols > 2 ? { cols, y0: m.pos[1], step: m.pos[cols * 3 + 1] - m.pos[1] } : undefined };
    this.endTerrain();
  }
  private uploadFar(m: { pos: Float32Array; col: Float32Array; idx: Uint32Array }) {
    const gl = this.gl, d = this.cells.dot, du = (d.u0 + d.u1) / 2, dv = (d.v0 + d.v1) / 2;
    const n = m.pos.length / 3, v = new Float32Array(n * FLOATS);
    for (let i = 0; i < n; i++) { const o = i * FLOATS; v[o] = m.pos[i * 3]; v[o + 1] = m.pos[i * 3 + 1]; v[o + 2] = m.pos[i * 3 + 2]; v[o + 3] = du; v[o + 4] = dv; v[o + 5] = m.col[i * 3]; v[o + 6] = m.col[i * 3 + 1]; v[o + 7] = m.col[i * 3 + 2]; v[o + 8] = 1; }
    const vbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    return { vbo, ibo, n: m.idx.length, bytes: v.byteLength, shared: false };
  }
  private drawFar() {
    const gl = this.gl, stride = FLOATS * 4;
    const want = Math.min(this.nearReach, this.cover, this.undrawn);
    this.coverSm = this.coverSm > want || !isFinite(this.coverSm) ? want : Math.min(want, this.coverSm + 4);   // (a chunk missing close by closes the hole at once; it opens again a few tiles a frame as the chunks arrive)
    const hole = this.coverSm * 0.9;
    this.nearBand = Math.max(1, Math.min(40, this.coverSm * 0.1));   // (the real chunks are built out to coverSm, so the band between 0.9 and 1.0 of it is ground they can still draw)
    gl.uniform1f(this.loc.uCut, 0.5); gl.depthMask(true); gl.uniform4f(this.loc.uBase, 0, 0, 0, 0); gl.uniform1f(this.loc.uTerr, 0);
    gl.uniform1f(this.loc.uFar, 1); gl.uniform1f(this.loc.uTerrace, this.terraceStep);   // (the far hills of a terraced world draw their layer contours)
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    const kk = Math.max(1, this.drawK), E = this.farRing ? this.farRing.map((v, i) => (i === 1 || i === 2 ? v * kk : v)) : [260 * kk, 820 * kk, 2600, 8000];   // (the draw distance stretches the fine and medium rings: more of the far map in detail, at no cost in chunks)
    // the levels in use: from the finest one wanted (and built) to the coarsest. The first starts at the hole; each next one a little inside where the one before ends (no crack)
    const n = this.farMesh!.length;
    let lo = n > 3 ? Math.min(this.farMin, n - 1) : 0; while (lo > 0 && !this.farMesh![lo]) lo--;   // (the one wanted is not built yet: the next finer one stands in)
    gl.enable(gl.POLYGON_OFFSET_FILL);
    let prevEnd = -1;
    this.farMesh!.forEach((f, i) => {
      if (i < lo || !f) return;
      const s0 = prevEnd < 0 ? hole : prevEnd - 20 * kk, e0 = i === n - 1 ? 1e9 : hole + E[Math.min(i, E.length - 1)];
      const bandIn = prevEnd < 0 ? this.nearBand : 20 * kk;   // (the first far level fades in over the real chunks' band; each next one over the 20 tiles it overlaps the one before)
      prevEnd = e0;
      gl.polygonOffset(1 + i * 1.5, 1 + i * 1.5);                         // (where two levels overlap the finer one wins every pixel, so they never fight; and all of them give way to the real ground in the ring where it overlaps the first: it was pulled in front of it, and its coarse triangles showed through beside the ledges)
      gl.uniform1f(this.loc.uHole, s0); gl.uniform1f(this.loc.uHoleMax, e0); gl.uniform1f(this.loc.uBand, bandIn); gl.uniform1f(this.loc.uBandOut, i === n - 1 ? 0 : 20 * kk);
      gl.bindBuffer(gl.ARRAY_BUFFER, f.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, f.ibo);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
      let first = 0, count = f.n;
      if (f.grid && e0 < 1e8 && f.grid.step > 0) {   // (a level is a whole square, but only the ring of it between s0 and e0 round the eye is ever seen: the rows of cells within e0 of the eye's row are drawn, not the whole square's vertices and triangles)
        const { cols, y0, step } = f.grid, r0 = Math.max(0, Math.min(cols - 2, Math.floor((this.eye[1] - e0 - 40 - y0) / step))), r1 = Math.max(r0 + 1, Math.min(cols - 1, Math.ceil((this.eye[1] + e0 + 40 - y0) / step)));
        first = r0 * (cols - 1) * 6 * 4; count = (r1 - r0) * (cols - 1) * 6;
      }
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniform1f(this.loc.uFar, 0);
    this.endTerrain();
  }

  /** Is this chunk on the GPU, ready to draw (its texture and, on hills, its mesh)? (the loading screen waits for the ring round the plane) */
  has(key: number) { const e = this.chunkTex.get(key); return !!e && (!this.terrain || !!e.vao); }
  /** (the ?perf readout) how many chunk textures are held on the GPU */
  get texCount() { return this.chunkTex.size; }

  /** Upload chunk textures (and hill meshes) ahead of drawing them, nearest first as given, for up to `ms`: the big map keeps the ground ready while time stands still. */
  preload(list: GroundChunk[], chunkTiles: number, ms: number) {
    const t0 = performance.now();
    for (const c of list) {
      if (performance.now() - t0 > ms) break;
      const ent = this.chunkTex.get(c.key);
      if (ent && ent.src === c.src && (!this.terrain || (ent.vao && !ent.stale))) { ent.used = this.groundFrames; continue; }
      this.ensureChunk(c, chunkTiles); const e2 = this.chunkTex.get(c.key); if (e2) e2.used = this.groundFrames;
    }
    this.gl.bindVertexArray(null); this.endTerrain();   // (a chunk made just now: its vertex array must be unbound before the shared buffers are, or they replace its own)
  }

  /** A chunk's pixels into a texture: `into`, or one from the pool, or a new one (storage made once, at the chunk's size, with room for its mipmaps). */
  private chunkTexture(src: ChunkPx, into: WebGLTexture | null) {
    const gl = this.gl, n = src.size;
    let tex = into ?? this.texPool.pop() ?? null;
    if (!tex) {
      tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(n)) + 1, gl.RGBA8, n, n);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);   // (blocky when close, smooth when far: see makeTexture)
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext && this.aniso > 1) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso);
    } else gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, src.px);   // (raw pixels straight from the chunk: no canvas to read back)
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  /** Let go of the textures of chunks that are gone, and of the longest unseen ones when too many are kept; they go back to the pool to be written over. */
  prune(has: (key: number) => boolean) {
    const drop = (k: number, e: { tex: WebGLTexture; mesh?: WebGLBuffer; ibo?: WebGLBuffer; count?: number; wmesh?: WebGLBuffer; wibo?: WebGLBuffer; wcount?: number; wvao?: WebGLVertexArrayObject; vao?: WebGLVertexArrayObject }) => {
      if (this.texPool.length < TEX_POOL) this.texPool.push(e.tex); else this.gl.deleteTexture(e.tex);
      if (e.mesh) this.gl.deleteBuffer(e.mesh); if (e.ibo) this.gl.deleteBuffer(e.ibo); if (e.wmesh) this.gl.deleteBuffer(e.wmesh); if (e.wibo) this.gl.deleteBuffer(e.wibo); if (e.wvao) this.gl.deleteVertexArray(e.wvao); if (e.vao) this.gl.deleteVertexArray(e.vao); this.chunkTex.delete(k);
    };
    for (const [k, e] of this.chunkTex) if (!has(k) || this.groundFrames - (e.used ?? this.groundFrames) > 900) drop(k, e);   // (unseen for ~15 s: turning round soon after finds it still there, no upload)
    if (this.chunkTex.size > TEX_KEEP) {
      const old = [...this.chunkTex].sort((a, b) => (a[1].used ?? 0) - (b[1].used ?? 0));
      for (const [k, e] of old.slice(0, this.chunkTex.size - TEX_KEEP)) if (e.used !== this.groundFrames) drop(k, e);
    }
  }

  /** A quad from its centre and two half-axes (world vectors), textured with `uv`, tinted `rgba`. */
  quad(kind: Kind, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, uv: UV, r = 1, g = 1, b = 1, a = 1) {
    const P = this.pools[kind], per = 4 * FLOATS;
    if (P.n + per > P.a.length) { const bigger = new Float32Array(P.a.length * 2); bigger.set(P.a); P.a = bigger; }
    const q = P.a; let o = P.n; P.n += per;
    // corners: bottom-left, bottom-right, top-right, top-left, where +b is the picture's top and +a its right
    q[o] = cx - ax - bx; q[o + 1] = cy - ay - by; q[o + 2] = cz - az - bz; q[o + 3] = uv.u0; q[o + 4] = uv.v1; q[o + 5] = r; q[o + 6] = g; q[o + 7] = b; q[o + 8] = a; o += FLOATS;
    q[o] = cx + ax - bx; q[o + 1] = cy + ay - by; q[o + 2] = cz + az - bz; q[o + 3] = uv.u1; q[o + 4] = uv.v1; q[o + 5] = r; q[o + 6] = g; q[o + 7] = b; q[o + 8] = a; o += FLOATS;
    q[o] = cx + ax + bx; q[o + 1] = cy + ay + by; q[o + 2] = cz + az + bz; q[o + 3] = uv.u1; q[o + 4] = uv.v0; q[o + 5] = r; q[o + 6] = g; q[o + 7] = b; q[o + 8] = a; o += FLOATS;
    q[o] = cx - ax + bx; q[o + 1] = cy - ay + by; q[o + 2] = cz - az + bz; q[o + 3] = uv.u0; q[o + 4] = uv.v0; q[o + 5] = r; q[o + 6] = g; q[o + 7] = b; q[o + 8] = a;
    if (kind === 'blend') {
      if (this.nBlend >= this.depths.length) { const d = new Float32Array(this.depths.length * 2); d.set(this.depths); this.depths = d; }
      const dx = cx - this.eye[0], dy = cy - this.eye[1], dz = cz - this.eye[2];
      this.depths[this.nBlend++] = dx * dx + dy * dy + dz * dz;
    }
  }

  /** A sprite facing the camera: `w` tiles wide, `h` tall, its bottom middle at (x, y, z up) when `base`, else its middle. */
  board(kind: Kind, x: number, y: number, h0: number, w: number, h: number, base: boolean, uv: UV, r = 1, g = 1, b = 1, a = 1) {
    const R = this.R, U = this.U, up = base ? h / 2 : 0;
    if (this.terrain && !this.skyMode) h0 += this.terrain(x, y);   // standing on the hill (the sky's clouds are at their own height: skyMode)
    this.quad(kind, x + U[0] * up, y + U[1] * up, -h0 + U[2] * up, R[0] * w / 2, R[1] * w / 2, R[2] * w / 2, U[0] * h / 2, U[1] * h / 2, U[2] * h / 2, uv, r, g, b, a);
  }

  /** A sprite lying flat: `w` by `l` tiles at height h0 above the ground, its top pointing along (dirX, dirY); `roll` tips the wings (radians), `pitch` the nose. */
  flat(kind: Kind, x: number, y: number, h0: number, w: number, l: number, dirX: number, dirY: number, uv: UV, r = 1, g = 1, b = 1, a = 1, roll = 0, pitch = 0) {
    const rx = -dirY, ry = dirX;                                          // to the picture's right, on the ground
    if (this.terrain && !this.skyMode) {
      const T = this.terrain, lift = kind === 'decal' && this.terraceStep > 0 ? 0.0015 * Math.hypot(x - this.eye[0], y - this.eye[1]) : 0;   // (a decal lies a hair over the ground, and more the further off: a short depth buffer cannot tell a hundredth of a tile at fifty tiles)
      if (kind === 'decal' && this.terraceStep > 0 && roll === 0 && pitch === 0 && Math.max(w, l) > 0.5) {
        // On the terraces a decal wider than a tile crosses ledges: one flat quad would hang in the air over the lower shelf and sink into the higher one. If the ground under it is not all one shelf, it is cut into cells, each lying on its own shelf.
        const N = 6, hw0 = w / 2, hl0 = l / 2, c0 = T(x, y);
        let level = true;
        for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) if (Math.abs(T(x + rx * hw0 * ox + dirX * hl0 * oy, y + ry * hw0 * ox + dirY * hl0 * oy) - c0) > 1e-6) { level = false; break; }
        if (!level) {
          const cw = w / N, cl = l / N, cu = uv.u1 - uv.u0, cvv = uv.v1 - uv.v0;
          for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const fx = (i + 0.5 - N / 2) * cw, fy = (j + 0.5 - N / 2) * cl, px = x + rx * fx + dirX * fy, py = y + ry * fx + dirY * fy;
            const sub: UV = { u0: uv.u0 + cu * i / N, u1: uv.u0 + cu * (i + 1) / N, v1: uv.v1 - cvv * j / N, v0: uv.v1 - cvv * (j + 1) / N };
            this.quad(kind, px, py, -(h0 + T(px, py) + lift), rx * cw / 2, ry * cw / 2, 0, dirX * cl / 2, dirY * cl / 2, 0, sub, r, g, b, a);
          }
          return;
        }
      }
      h0 += T(x, y) + lift;
    }
    const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const hw = w / 2, hl = l / 2;
    // right = (rx, ry) * cos(roll), and down by sin(roll); top = dir * cos(pitch), and up by sin(pitch)
    this.quad(kind, x, y, -h0, rx * hw * cr, ry * hw * cr, hw * sr, dirX * hl * cp, dirY * hl * cp, -hl * sp, uv, r, g, b, a);
  }

  /** Give the 3D view a plane model (forward / right / up vertices, 1 long, with texture coordinates and indices). */
  setModel(m: { local: Float32Array; uv: Float32Array; idx: Uint16Array; image: TexImageSource }) {
    const gl = this.gl, tex = this.makeTexture(m.image, true), ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    this.model = { local: m.local, uv: m.uv, tex, ibo, n: m.idx.length, out: new Float32Array((m.local.length / 3) * FLOATS) };
  }
  get hasModel() { return !!this.model; }
  /** The ground height (tiles) under a point: 0 on flat worlds. For the blended sprites that stand on the ground. */
  groundH(x: number, y: number): number { return this.terrain ? this.terrain(x, y) : 0; }
  /** Queue the model for this frame: centre (x, y), height h0, heading (dirX, dirY), roll and pitch in radians, `len` tiles long.
   *  `basis` gives the attitude outright instead: the nose `f` and the plane's own up `u` as unit vectors (x east, y NORTH, z up, as the glider keeps them), which has no trouble at the vertical or upside down. */
  drawModel(x: number, y: number, h0: number, dirX: number, dirY: number, roll: number, pitch: number, len: number, shadowAlpha = 0.3, shadowSx = 0.12, shadowSy = 0.25, basis?: { f: ArrayLike<number>; u: ArrayLike<number> }, tint?: [number, number, number]) { this.pose = { x, y, h0, dx: dirX, dy: dirY, roll, pitch, len, sa: shadowAlpha, sx: shadowSx, sy: shadowSy, basis, tint }; this.poses.push(this.pose); if (shadowAlpha > 0) this.pushShadow(); }

  /** The model's vertices in the world for the queued pose: `shadow` squashes them onto the ground, slid along the light (the plane's silhouette). */
  private modelVerts(shadow: boolean): Float32Array {
    const m = this.model!, p = this.pose!, cr = Math.cos(p.roll), sr = Math.sin(p.roll), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    // forward / right / up in world axes (Z is down), the same turns as a flat sprite: roll about the nose, then pitch about the wing
    const f0 = [p.dx, p.dy, 0], r0 = [-p.dy, p.dx, 0];
    const r1 = [r0[0] * cr, r0[1] * cr, sr], u1 = [r0[0] * sr, r0[1] * sr, -cr];
    let f1 = [f0[0] * cp + u1[0] * sp, f0[1] * cp + u1[1] * sp, u1[2] * sp], u2 = [u1[0] * cp - f0[0] * sp, u1[1] * cp - f0[1] * sp, u1[2] * cp];
    if (p.basis) {   // (y north and z up become the world's y south and Z down; the right wing is nose x up)
      const F = p.basis.f, U = p.basis.u, R = [F[1] * U[2] - F[2] * U[1], F[2] * U[0] - F[0] * U[2], F[0] * U[1] - F[1] * U[0]];
      f1 = [F[0], -F[1], -F[2]]; u2 = [U[0], -U[1], -U[2]]; r1[0] = R[0]; r1[1] = -R[1]; r1[2] = -R[2];
    }
    const n = m.local.length / 3, g0 = this.terrain ? this.terrain(p.x, p.y) : 0;   // (the pose's height is above the ground under it)
    if (shadow && this.shadowOut.length < n * FLOATS) this.shadowOut = new Float32Array(n * FLOATS);
    const out = shadow ? this.shadowOut : m.out;
    for (let i = 0; i < n; i++) {
      const a = m.local[i * 3] * p.len, b = m.local[i * 3 + 1] * p.len, c = m.local[i * 3 + 2] * p.len, o = i * FLOATS;
      const x = p.x + f1[0] * a + r1[0] * b + u2[0] * c, y = p.y + f1[1] * a + r1[1] * b + u2[1] * c, z = -p.h0 + f1[2] * a + r1[2] * b + u2[2] * c;
      if (shadow) { const h = Math.max(0, -z); out[o] = x + h * p.sx; out[o + 1] = y + h * p.sy; out[o + 2] = -g0 - 0.02; }
      else { out[o] = x; out[o + 1] = y; out[o + 2] = z - g0; out[o + 3] = m.uv[i * 2]; out[o + 4] = m.uv[i * 2 + 1]; out[o + 5] = p.tint ? p.tint[0] : 1; out[o + 6] = p.tint ? p.tint[1] : 1; out[o + 7] = p.tint ? p.tint[2] : 1; out[o + 8] = 1; }
    }
    return out;
  }

  /** The plane's shadow: its outline (nose, wing tips, tail corners) flattened onto the ground, as a fan of ground decals that never overlap, so it is one flat shade. */
  private pushShadow() {
    const v = this.modelVerts(true), p = this.pose!, P = this.pools.decal, d = this.cells.dot, du = (d.u0 + d.u1) / 2, dv = (d.v0 + d.v1) / 2;
    const at = (i: number) => [v[i * FLOATS], v[i * FLOATS + 1], v[i * FLOATS + 2]];
    const ring = [4, 3, 17, 18].map(at), nose = at(0);              // outline order: right tip, right tail, left tail, left tip
    for (let k = 0; k < 3; k++) {
      const a = ring[k], b = ring[k + 1], per = 4 * FLOATS;
      if (P.n + per > P.a.length) { const bigger = new Float32Array(P.a.length * 2); bigger.set(P.a); P.a = bigger; }
      let o = P.n; P.n += per;
      for (const c of [nose, a, b, nose]) { P.a.set([c[0], c[1], c[2], du, dv, 0, 0, 0, p.sa], o); o += FLOATS; }   // (a triangle as a quad whose last corner repeats the first)
    }
  }

  private drawMesh(verts: Float32Array, tex: WebGLTexture) {
    const gl = this.gl, m = this.model!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, (m.local.length / 3) * FLOATS), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
  }
  private flushModel() {
    const m = this.model, list = this.poses; this.pose = null; this.poses = []; if (!m || !list.length) return;
    const gl = this.gl;
    gl.uniform4f(this.loc.uBase, 0, 0, 0, 0); gl.uniform1f(this.loc.uCut, 0.5); gl.depthMask(true);
    for (const p of list) { this.pose = p; const v = this.modelVerts(false); this.pose = null; this.drawMesh(v, m.tex); }
  }

  /** Draw what was queued: decals, then solid sprites, then the blended ones back to front. */
  /** (the ?perf readout) Wait for the GPU to finish everything queued so far, by reading one pixel back, and say how long that took in ms: the GPU's own time for the frame, which the game's timers cannot see. */
  gpuWaitMs(): number {
    const gl = this.gl, t0 = performance.now(), px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return performance.now() - t0;
  }

  end() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform4f(this.loc.uBase, 0, 0, 0, 0);                                      // (sprites keep their own transparency)
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    gl.uniform1f(this.loc.uCut, 0.02); gl.depthMask(false);
    this.flush(this.pools.decal.a, this.pools.decal.n);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniform1f(this.loc.uCut, 0.5); gl.depthMask(true);
    this.flush(this.pools.solid.a, this.pools.solid.n);
    this.flushModel();
    gl.uniform1f(this.loc.uCut, 0.02); gl.depthMask(false);
    gl.uniform2f(this.loc.uFogRange, this.skyRadius * 0.3, this.skyRadius * 0.98);   // (the clouds are far beyond the ground's reach: their haze is their own)
    const n = this.nBlend;
    if (n) {
      if (this.order.length < n) this.order = new Uint32Array(Math.max(n, this.order.length * 2));
      const order = this.order.subarray(0, n), depths = this.depths;
      for (let i = 0; i < n; i++) order[i] = i;
      order.sort((a, b) => depths[b] - depths[a]);                                // far first
      const per = 4 * FLOATS;
      if (this.sortBuf.length < n * per) this.sortBuf = new Float32Array(Math.max(n * per, this.sortBuf.length * 2));
      const src = this.pools.blend.a, dst = this.sortBuf;
      for (let i = 0; i < n; i++) dst.set(src.subarray(order[i] * per, order[i] * per + per), i * per);
      this.flush(dst, n * per);
    }
    gl.depthMask(true);
    if (this.postOn) {
      const P = this.post!;
      if (P.ms) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, P.ms.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, P.scene.fb); gl.blitFramebuffer(0, 0, P.sw, P.sh, 0, 0, P.sw, P.sh, gl.COLOR_BUFFER_BIT, gl.NEAREST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }   // (the multisampled scene resolved into the scene texture the glow pass reads)
      this.runPost();
    }
  }

  private flush(a: Float32Array, floats: number) {
    const gl = this.gl, per = 4 * FLOATS, total = Math.floor(floats / per);
    for (let start = 0; start < total; start += MAX_QUADS) {
      const n = Math.min(MAX_QUADS, total - start);
      gl.bufferData(gl.ARRAY_BUFFER, a.subarray(start * per, (start + n) * per), gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    }
  }

  dispose() {
    const gl = this.gl; this.disposed = true;
    for (const e of this.chunkTex.values()) { gl.deleteTexture(e.tex); if (e.mesh) gl.deleteBuffer(e.mesh); if (e.ibo) gl.deleteBuffer(e.ibo); if (e.wmesh) gl.deleteBuffer(e.wmesh); if (e.wibo) gl.deleteBuffer(e.wibo); if (e.wvao) gl.deleteVertexArray(e.wvao); if (e.vao) gl.deleteVertexArray(e.vao); }
    for (const t of this.texPool) gl.deleteTexture(t); this.texPool.length = 0;
    this.chunkTex.clear(); this.setFar(null); gl.deleteTexture(this.atlasTex); gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.ibo); gl.deleteProgram(this.prog); this.freePost();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
