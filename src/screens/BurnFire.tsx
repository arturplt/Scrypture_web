import { useEffect, useRef } from 'react';
import MILKY from '../assets/milkyway.png';
import { FLAME_H, FLAME_W, flameSprites } from './firesprites';

/**
 * The plane burned. Fire eats the whole view from the bottom, unevenly (each column has its own pace, licked by noise): a fragment
 * shader paints the burn on a chunky pixel grid, and the game's own flame pictures (1x, never stretched) flare up all over the
 * burnt screen as the front passes, then die. What is left is char with embers, the Milky Way picture's stars glowing orange.
 * Without WebGL the 2D canvas fills in.
 */
export const BURN_SECONDS = 2.6, FLAMES_OUT = 1.8;   // the front crosses the view in BURN_SECONDS; the flame glow then fades over FLAMES_OUT

const colPace = (x: number, seed: number) => 0.5 + 0.26 * Math.sin(x * 9 + seed) + 0.15 * Math.sin(x * 23 + 2 * seed + 1) + 0.09 * Math.sin(x * 41 + 3 * seed);   // (the same formula is in the shader)
const frontAt = (x: number, p: number, seed: number) => p * (0.55 + 0.9 * colPace(x, seed));
const ease = (k: number) => k * k * (3 - 2 * k);
const easeInv = (e: number) => 0.5 - Math.sin(Math.asin(Math.max(-1, Math.min(1, 1 - 2 * e))) / 3);   // (the time, 0..1, at which ease() has reached e)
const P_MAX = 2.1;

const NOISE = `float h(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1., 0.)), f.x), mix(h(i + vec2(0., 1.)), h(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 q) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * n(q); q = q * 2.03 + 7.1; a *= .5; } return s; }`;

const BURN_FRAG = `precision mediump float;
uniform vec2 res; uniform float t, p, seed, fade;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float x = uv.x;
  float pace = .5 + .26 * sin(x * 9. + seed) + .15 * sin(x * 23. + 2. * seed + 1.) + .09 * sin(x * 41. + 3. * seed);
  float front = p * (.55 + .9 * pace);
  float lick = fbm(vec2(x * 10., uv.y * 3. - t * 1.7)) * .2 - .05;   // flames lick up the front
  float d = front + lick - uv.y;                                      // > 0: burnt
  float heat = 0.;
  if (d > 0.) heat = (1. - smoothstep(.03, .26, d)) * (.65 + .35 * fbm(uv * vec2(14., 9.) + vec2(0., -t * 3.)));
  else if (d > -.1) heat = (1. - smoothstep(0., .1, -d)) * step(.52, fbm(uv * vec2(18., 7.) + vec2(0., -t * 4.)));   // tongues ahead of it
  heat = floor(heat * fade * 5.) / 5.;                                 // (fade: 1 while it burns, 0 once the flames are over)
  vec3 c = heat > .8 ? vec3(1., .93, .45) : heat > .55 ? vec3(1., .6, .12) : heat > .3 ? vec3(.85, .22, .04) : vec3(.4, .06, .02);
  float a = heat > .01 ? 1. : 0.;
  if (heat <= .01 && d <= 0.) { c = vec3(.1, .02, .01); a = .5 * clamp(p / 1.4, 0., 1.) * (1. - smoothstep(-.4, -.1, d)); }   // smoke over what has not burnt yet
  if (heat <= .01 && d > 0.) {                                        // char: dark, mottled, still glowing a little red where it has just burnt
    float charred = smoothstep(.12, .4, d);
    float mot = fbm(uv * vec2(16., 10.) * vec2(res.x / res.y, 1.) + vec2(0., -t * .15));
    float glow = (1. - smoothstep(.2, .9, d)) * fade * .35;
    c = mix(vec3(.05, .015, .012), vec3(.2, .045, .02), mot * .6 + glow); a = .95 * charred + .5 * (1. - charred);
  }
  gl_FragColor = vec4(c * a, a);
}`;

const EMBER_FRAG = `precision mediump float;
uniform vec2 res; uniform float t, p, seed; uniform sampler2D sky;
${NOISE}
float ember(vec2 uv, float cells, float speed, float sz, float k) {   // little glowing points that rise, drift and flicker
  vec2 g = uv * vec2(cells * res.x / res.y, cells);
  g.y -= t * speed * cells * .1;
  vec2 id = floor(g), f = fract(g) - .5;
  float r = h(id + k);
  vec2 off = (vec2(h(id + k + 1.3), h(id + k + 2.7)) - .5) * .55;
  off.x += sin(t * 1.3 + r * 20.) * .12;
  float tw = .5 + .5 * sin(t * (2. + r * 4.) + r * 30.);
  return step(.5, r) * tw * (1. - smoothstep(0., sz, length(f - off)));
}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float pace = .5 + .26 * sin(uv.x * 9. + seed) + .15 * sin(uv.x * 23. + 2. * seed + 1.) + .09 * sin(uv.x * 41. + 3. * seed);
  float d = p * (.55 + .9 * pace) + (fbm(vec2(uv.x * 10., uv.y * 3. - t * 1.7)) * .2 - .05) - uv.y;
  float mask = smoothstep(.1, .45, d);                                  // only on what has burnt
  float e = ember(uv, 26., .5, .2, 0.) + ember(uv, 52., .8, .14, 10.) + .8 * ember(uv, 96., 1.2, .11, 20.);
  vec2 su = fract(gl_FragCoord.xy / 760. + vec2(seed * .1, -t * .004));   // the Milky Way picture, at its own size: a faint dust of stars glowing red
  float st = smoothstep(.2, .65, dot(texture2D(sky, su).rgb, vec3(.33))) * (.55 + .45 * sin(t * 2.3 + h(floor(gl_FragCoord.xy / 3.)) * 40.));
  vec3 c = mix(vec3(.85, .2, .04), vec3(1., .75, .3), clamp(e * e, 0., 1.));
  float a = clamp(max(e, st * .45), 0., 1.) * mask;
  c = mix(c, vec3(.9, .3, .08), step(e, st * .45));
  gl_FragColor = vec4(c * a, a);
}`;

/** A full-screen quad with a fragment shader; returns a draw(uniforms) function, or null without WebGL / when the shader will not build. */
function makeShader(cv: HTMLCanvasElement, frag: string, image?: string) {
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }'), fs = sh(gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const pr = gl.createProgram()!; gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  if (image) {   // the picture goes in as a texture (unit 0); a dark pixel stands in until it has loaded
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const im = new Image(); im.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); }; im.src = image;
    gl.uniform1i(gl.getUniformLocation(pr, 'sky'), 0);
  }
  return (u: Record<string, number>) => {
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(gl.getUniformLocation(pr, 'res'), cv.width, cv.height);
    for (const k in u) gl.uniform1f(gl.getUniformLocation(pr, k), u[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

/** A tiny seeded random generator, so the same flames stand in the same places every frame. */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

export function BurnFire() {
  const glCv = useRef<HTMLCanvasElement>(null), flCv = useRef<HTMLCanvasElement>(null), emCv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const a = glCv.current!, b = flCv.current!, em = emCv.current!, box = b.parentElement!;
    const seed = Math.random() * 6;
    let raf = 0, W = 0, H = 0, ps = 4, GW = 0, GH = 0, flames: { x: number; y: number; born: number; life: number; ph: number }[] = [];
    const draw = makeShader(a, BURN_FRAG), drawEm = makeShader(em, EMBER_FRAG, MILKY);
    const g = b.getContext('2d')!; g.imageSmoothingEnabled = false;
    // one pixel grid for the shader and the char, square pixels of `ps` screen pixels, anchored bottom left
    const fit = () => {
      W = box.clientWidth; H = box.clientHeight; ps = Math.max(3, Math.round(Math.min(W, H) / 180));
      GW = Math.ceil(W / ps); GH = Math.ceil(H / ps);
      a.width = GW; a.height = GH; b.width = GW * ps; b.height = GH * ps; em.width = Math.max(1, Math.round(W / 2)); em.height = Math.max(1, Math.round(H / 2));   // (the embers are drawn finer than the burn: small soft points)
      for (const c of [a, b]) { c.style.width = `${GW * ps}px`; c.style.height = `${GH * ps}px`; c.style.left = '0'; c.style.top = 'auto'; c.style.bottom = '0'; }
      // flames all over the screen (1x: the pictures' own pixels), each born when the front reaches it and gone a moment later
      const r = rng(Math.floor(seed * 1e6) + 7), n = Math.round((GW * ps * GH * ps) / (FLAME_W * FLAME_H * 2.2));
      flames = Array.from({ length: n }, () => {
        const x = r() * (GW * ps - FLAME_W), yb = r() * (GH * ps - FLAME_H * 0.4), need = (yb / (GH * ps)) / (0.55 + 0.9 * colPace((x + FLAME_W / 2) / (GW * ps), seed));
        const reach = need >= P_MAX ? 1 : easeInv(need / P_MAX) * BURN_SECONDS;   // (when the front gets there)
        return { x: Math.round(x), y: Math.round(yb), born: reach + r() * 0.35, life: 1.1 + r() * 1.7, ph: Math.floor(r() * 4) };
      });
    };
    fit();
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (box.clientWidth !== W || box.clientHeight !== H) fit();
      const t = (now - t0) / 1000, p = P_MAX * ease(Math.min(1, t / BURN_SECONDS)), BW = GW * ps, BH = GH * ps, out = 1 - Math.min(1, Math.max(0, (t - BURN_SECONDS) / FLAMES_OUT));
      draw?.({ t, p, seed, fade: out }); drawEm?.({ t, p, seed });
      g.clearRect(0, 0, BW, BH);
      if (!draw || !drawEm) {   // no WebGL: the char is columns filled up to the front with a glowing edge, and embers once the flames are out
        for (let x = 0; x < BW; x += ps) { const fy = Math.min(BH, Math.round(frontAt((x + ps / 2) / BW, p, seed) * GH) * ps); if (fy <= 0) continue; g.fillStyle = 'rgba(30,8,4,0.93)'; g.fillRect(x, BH - fy, ps, fy); if (out > 0) { g.fillStyle = '#d8380a'; g.fillRect(x, BH - fy, ps, ps * 2); g.fillStyle = '#ffb02e'; g.fillRect(x, BH - fy, ps, ps); } }
        const r = rng(99); g.fillStyle = '#ff9a2e';
        for (let i = 0; i < (BW * BH) / 900; i++) { const ex = r() * BW, ey = r() * BH, tw = Math.sin(t * 3 + i); if (tw > 0 && frontAt(ex / BW, p, seed) * BH > BH - ey) g.fillRect(Math.round(ex / ps) * ps, Math.round(ey / ps) * ps, ps, ps); }
      }
      if (!flameSprites.length) return;
      for (const f of flames) {   // 1x flames, scattered, standing where the fire has been; each flares up, flickers through the frames and dies
        const age = t - f.born;
        if (age < 0 || age > f.life) continue;
        g.globalAlpha = Math.min(1, age / 0.15, (f.life - age) / 0.5);
        g.drawImage(flameSprites[(Math.floor(t * 9) + f.ph) % flameSprites.length], f.x, BH - f.y - FLAME_H);
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (<><canvas ref={glCv} className="burn-gl" /><canvas ref={emCv} className="burn-em" /><canvas ref={flCv} className="burn-fl" /></>);
}
