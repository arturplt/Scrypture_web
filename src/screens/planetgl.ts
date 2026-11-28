/**
 * The world generator's own small renderer (see SCRYPTURE_WORLD_GENERATOR_ROADMAP.md, milestone 3): the whole terraced planet (planetmesh.ts), an opaque sea sphere, a star field, an orbit camera
 * and a ray picker. It shares the terrain's maths with the game, not `WorldGL`, which is built around the flight camera, chunks and rings.
 *
 *  - Render on demand: a frame is drawn only when something changed (the camera, a resize, a mesh being uploaded, the brush); the animation frame loop stops by itself when nothing moves, and stops
 *    while the page is hidden.
 *  - Patches are culled per frame with the game's own tested maths (facetiles.ts): over the horizon, or out of the view.
 *  - A new mesh is uploaded a few patches a frame beside the old one and swapped in whole when it is complete: the screen never shows a half-built planet.
 *  - Height exaggeration is a uniform: a vertex's place is direction * (R + height * step * exaggeration), so it needs no rebuild (floor normals are radial, walls' are horizontal).
 *  - Nothing is read back from the GPU (picking is on the CPU).
 */
import { capOverHorizon, sphereInView } from '../domain/facetiles';
import { PLANET_VERTEX_BYTES, type PatchMesh, type PlanetMesh } from '../domain/planetmesh';
import { summarize, type FrameSummary, type GlProfile } from './glprofile';

/** Tiles in a layer (the game's terrace step). */
export const LAYER_TILES = 0.45;

export interface PlanetStats {
  /** Triangles drawn last frame, patches drawn and culled, and the resident meshes. */
  drawnTris: number; drawnPatches: number; culledPatches: number; residentTris: number; residentBytes: number; stagedBytes: number;
  /** ms the last mesh took to upload (all its patches, summed over frames), and frames drawn so far. */
  uploadMs: number; frames: number; altitude: number;
  /** Frame times (ms) while benchmarking. */
  frameMs: number;
}
export interface PickHit { dir: [number, number, number]; point: [number, number, number]; t: number; sea: boolean; /** layers (0 on the sea) */ height: number; face: number; patch: number }

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function perspective(fovy: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fovy / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}
function lookAt(eye: V3, ctr: V3, up: V3): number[] {
  const f = norm(sub(ctr, eye)), r = norm(cross(f, up)), u = cross(r, f);
  return [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
}
function mul(P: number[], V: number[]): number[] {
  const M = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) M[c * 4 + r] += P[k * 4 + r] * V[c * 4 + k];
  return M;
}

const TERRAIN_VS = `#version 300 es
layout(location=0) in vec4 aPos;
layout(location=1) in vec4 aNrm;
layout(location=2) in vec4 aCol;
uniform mat4 uVP; uniform float uR; uniform float uStep;
out vec3 vN; out vec3 vCol; out vec3 vDir; out vec3 vWorld;
void main(){
  float r = uR + aPos.w * uStep; vec3 p = aPos.xyz * r;
  vWorld = p; vDir = aPos.xyz; vN = aNrm.xyz; vCol = aCol.rgb;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vCol; in vec3 vDir; in vec3 vWorld;
uniform vec3 uSun; uniform vec3 uEye; uniform vec4 uBrush; uniform float uRim;
out vec4 o;
void main(){
  vec3 n = normalize(vN);
  float d = max(dot(n, uSun), 0.0);
  vec3 c = vCol * (0.34 + 0.86 * d);
  vec3 v = normalize(uEye - vWorld);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0) * uRim;
  c += vec3(0.25, 0.4, 0.7) * rim * 0.5;
  if (uBrush.w > 0.0) { float a = acos(clamp(dot(normalize(vDir), uBrush.xyz), -1.0, 1.0)); float ring = 1.0 - smoothstep(0.0, uBrush.w * 0.05 + 1e-4, abs(a - uBrush.w)); c = mix(c, vec3(1.0, 0.95, 0.4), ring); }
  o = vec4(c, 1.0);
}`;
const SEA_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP; uniform float uSeaR;
out vec3 vDir; out vec3 vWorld;
void main(){ vDir = aPos; vWorld = aPos * uSeaR; gl_Position = uVP * vec4(vWorld, 1.0); }`;
const SEA_FS = `#version 300 es
precision highp float;
in vec3 vDir; in vec3 vWorld;
uniform vec3 uSun; uniform vec3 uEye; uniform vec4 uBrush; uniform float uRim;
out vec4 o;
void main(){
  vec3 n = normalize(vDir);
  float d = max(dot(n, uSun), 0.0);
  vec3 c = vec3(0.10, 0.28, 0.52) * (0.34 + 0.86 * d);
  vec3 v = normalize(uEye - vWorld);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0) * uRim;
  c += vec3(0.25, 0.4, 0.7) * rim * 0.5;
  if (uBrush.w > 0.0) { float a = acos(clamp(dot(n, uBrush.xyz), -1.0, 1.0)); float ring = 1.0 - smoothstep(0.0, uBrush.w * 0.05 + 1e-4, abs(a - uBrush.w)); c = mix(c, vec3(1.0, 0.95, 0.4), ring); }
  o = vec4(c, 1.0);
}`;
const STAR_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProj; uniform mat4 uView;
out float vB;
void main(){ vec4 p = uProj * vec4(mat3(uView) * aPos, 1.0); gl_Position = p.xyww; gl_PointSize = 1.0 + step(0.985, fract(aPos.x * 91.7 + aPos.y * 37.3)) * 1.5; vB = 0.35 + 0.65 * fract(aPos.z * 53.1 + aPos.x * 17.9); }`;
const MARK_VS = `#version 300 es
uniform mat4 uVP; uniform vec3 uPos; uniform float uSize;
void main(){ gl_Position = uVP * vec4(uPos, 1.0); gl_PointSize = uSize; }`;
const MARK_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard; o = vec4(r > 0.62 ? vec3(1.0) : vec3(0.95, 0.12, 0.12), 1.0); }`;
const STAR_FS = `#version 300 es
precision mediump float;
in float vB; out vec4 o;
void main(){ o = vec4(vec3(vB), 1.0); }`;

interface GpuPatch { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; ni: number; type: number; cap: [number, number, number, number]; minH: number; maxH: number; nv: number; bytes: number; src: PatchMesh }
interface GpuMesh { patches: GpuPatch[]; tris: number; bytes: number; src: PlanetMesh }

export interface PlanetGLOpts {
  /** Planet radius in tiles (the game's `cubeRadius(size)`). */
  radius: number;
  profile?: (gl: WebGL2RenderingContext) => GlProfile | null;
  /** Patches uploaded per frame while a new mesh is staged. */
  uploadPerFrame?: number;
  /** Device pixels per CSS pixel to draw at (default: the device's, at most 2). */
  pixelRatio?: number;
  /** Listen to the canvas for orbit (drag), tilt (right-drag / shift), zoom (wheel, pinch). */
  controls?: boolean;
  onPick?: (hit: PickHit | null, e: PointerEvent) => void;
}

export class PlanetGL {
  readonly R: number;
  /** View settings: exaggeration of the heights (1 = the game's own), rim light. */
  exaggeration = 1; rim = 1;
  private gl: WebGL2RenderingContext;
  private prof: GlProfile | null = null;
  private progT!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  private progS!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  private progStar!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  private progMark!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  /** A marker on the ground (the place the world starts): its direction, and where it stands now (worked out again when the mesh or the exaggeration changes). */
  private marker: V3 | null = null; private markerAt: V3 | null = null;
  private sea!: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; n: number };
  private stars!: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; n: number };
  private mesh: GpuMesh | null = null;
  private staged: { src: PlanetMesh; done: GpuPatch[]; ms: number } | null = null;
  private raf = 0;
  private disposed = false; private lost = false;
  private listeners: [EventTarget, string, EventListenerOrEventListenerObject, AddEventListenerOptions?][] = [];
  private ro: ResizeObserver | null = null;
  private w = 1; private h = 1;
  private brush: [number, number, number, number] = [0, 0, 1, 0];
  // camera: the focus (a unit vector to the ground point under the middle of the view), the screen-up tangent there, the distance from that ground point and the tilt
  private f: V3 = [1, 0, 0]; private t: V3 = [0, 0, 1]; private D: number; private tilt = 0; private fov = (45 * Math.PI) / 180;
  private eye: V3 = [0, 0, 0]; private fwd: V3 = [-1, 0, 0]; private rgt: V3 = [0, 1, 0]; private upv: V3 = [0, 0, 1];
  private vp: number[] = new Array(16).fill(0); private view: number[] = new Array(16).fill(0); private proj: number[] = new Array(16).fill(0);
  private near = 1; private far = 1e4;
  private bench: { until: number; times: number[]; last: number; resolve: (s: FrameSummary & { gpuMs: number | null }) => void } | null = null;
  private lastDraw = { tris: 0, patches: 0, culled: 0 };
  private uploadMs = 0; private frames = 0; private frameMs = 0; private lastFrameAt = 0;
  /** How many frames drew while nothing asked for one (must stay 0: a test). */
  idleFrames = 0;
  private dirty = false;
  /** Called when a staged mesh has been swapped in. */
  onSwap: ((m: PlanetMesh) => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, private o: PlanetGLOpts) {
    this.R = o.radius; this.D = this.R * 3.2;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'default' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.initGL();
    this.prof = o.profile ? o.profile(gl) : null;
    const on = (t: EventTarget, ev: string, fn: EventListenerOrEventListenerObject, opt?: AddEventListenerOptions) => { t.addEventListener(ev, fn, opt); this.listeners.push([t, ev, fn, opt]); };
    on(canvas, 'webglcontextlost', e => { e.preventDefault(); this.lost = true; if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } });
    on(canvas, 'webglcontextrestored', () => { this.lost = false; this.restore(); });
    on(document, 'visibilitychange', () => { if (!document.hidden) this.invalidate(); });
    if (o.controls !== false) this.attachControls(on);
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas); }
    this.resize();
  }

  // ---- resources ----------------------------------------------------------------------------------------------------------------------

  private program(vs: string, fs: string, names: string[]) {
    const gl = this.gl, mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram()!, a = mk(gl.VERTEX_SHADER, vs), b = mk(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
    gl.deleteShader(a); gl.deleteShader(b);
    const u: Record<string, WebGLUniformLocation | null> = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
  private initGL() {
    const gl = this.gl;
    this.progT = this.program(TERRAIN_VS, TERRAIN_FS, ['uVP', 'uR', 'uStep', 'uSun', 'uEye', 'uBrush', 'uRim']);
    this.progS = this.program(SEA_VS, SEA_FS, ['uVP', 'uSeaR', 'uSun', 'uEye', 'uBrush', 'uRim']);
    this.progStar = this.program(STAR_VS, STAR_FS, ['uProj', 'uView']);
    this.progMark = this.program(MARK_VS, MARK_FS, ['uVP', 'uPos', 'uSize']);
    // the sea: a finely cut ball (inscribed: its flats lie a little under the sea's radius)
    const LON = 192, LAT = 96, pos = new Float32Array((LON + 1) * (LAT + 1) * 3), idx = new Uint16Array(LON * LAT * 6);
    for (let j = 0; j <= LAT; j++) for (let i = 0; i <= LON; i++) {
      const th = (i / LON) * Math.PI * 2, ph = (j / LAT) * Math.PI, o = (j * (LON + 1) + i) * 3;
      pos[o] = Math.sin(ph) * Math.cos(th); pos[o + 1] = Math.cos(ph); pos[o + 2] = Math.sin(ph) * Math.sin(th);
    }
    let q = 0; for (let j = 0; j < LAT; j++) for (let i = 0; i < LON; i++) { const a = j * (LON + 1) + i, b = a + LON + 1; idx[q++] = a; idx[q++] = a + 1; idx[q++] = b; idx[q++] = a + 1; idx[q++] = b + 1; idx[q++] = b; }
    const vao = gl.createVertexArray()!, vbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); gl.bindVertexArray(null);
    this.sea = { vao, vbo, ibo, n: idx.length };
    // the stars: fixed points on a ball round the eye
    const N = 1500, sp = new Float32Array(N * 3); let s = 12345;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
    for (let i = 0; i < N; i++) { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); sp[i * 3] = r * Math.cos(a); sp[i * 3 + 1] = r * Math.sin(a); sp[i * 3 + 2] = z; }
    const svao = gl.createVertexArray()!, svbo = gl.createBuffer()!;
    gl.bindVertexArray(svao); gl.bindBuffer(gl.ARRAY_BUFFER, svbo); gl.bufferData(gl.ARRAY_BUFFER, sp, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    this.stars = { vao: svao, vbo: svbo, n: N };
  }
  /** After a lost context: the GPU's copies are gone, the CPU's are not. */
  private restore() {
    const keep = this.mesh?.src ?? null, st = this.staged?.src ?? null;
    this.mesh = null; this.staged = null;
    this.initGL();
    if (keep) { this.stage(keep); }
    if (st) this.stage(st);
    this.invalidate();
  }
  private uploadPatch(p: PatchMesh): GpuPatch {
    const gl = this.gl, vao = gl.createVertexArray()!, vbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(p.verts, 0, p.nv * PLANET_VERTEX_BYTES), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, PLANET_VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.BYTE, true, PLANET_VERTEX_BYTES, 16);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, PLANET_VERTEX_BYTES, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.index.subarray(0, p.ni), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, ni: p.ni, type: p.index instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, cap: p.cap, minH: p.minH, maxH: p.maxH, nv: p.nv, bytes: p.nv * PLANET_VERTEX_BYTES + p.ni * p.index.BYTES_PER_ELEMENT, src: p };
  }
  private freeMesh(m: GpuMesh | null) { if (!m) return; const gl = this.gl; for (const p of m.patches) { gl.deleteVertexArray(p.vao); gl.deleteBuffer(p.vbo); gl.deleteBuffer(p.ibo); } }

  /**
   * Stage a new mesh: its patches are uploaded over the next frames beside the old mesh (which keeps being drawn), and swapped in all at once when the last is in.
   * A newer mesh replaces one still being staged (what it had uploaded is freed).
   */
  stage(m: PlanetMesh) {
    if (this.disposed) return;
    if (this.staged) this.freeMesh({ patches: this.staged.done, tris: 0, bytes: 0, src: this.staged.src });
    this.staged = { src: m, done: [], ms: 0 };
    this.invalidate();
  }
  private pumpUpload() {
    const s = this.staged; if (!s) return;
    const t0 = performance.now(), per = this.o.uploadPerFrame ?? 24, all = s.src.patches;
    for (let n = 0; n < per && s.done.length < all.length; n++) s.done.push(this.uploadPatch(all[s.done.length]));
    s.ms += performance.now() - t0;
    if (s.done.length === all.length) {
      const old = this.mesh; let bytes = 0; for (const p of s.done) bytes += p.bytes;
      this.mesh = { patches: s.done, tris: s.src.tris, bytes, src: s.src }; this.uploadMs = s.ms; this.staged = null;
      this.freeMesh(old);
      this.markerAt = null;
      this.seaDrop = Math.max(0.15 * LAYER_TILES, (this.R * (Math.PI / (2 * s.src.N)) ** 2) / 4 + 0.05);
      this.onSwap?.(s.src);
    }
  }

  // ---- state --------------------------------------------------------------------------------------------------------------------------

  /** The brush ring: a direction on the ball and a radius (rad); radius 0 hides it. */
  setBrush(dir: V3 | null, radius = 0) { const d = dir ? norm(dir) : [0, 0, 1] as V3; this.brush = [d[0], d[1], d[2], dir ? radius : 0]; this.invalidate(); }
  setExaggeration(x: number) { this.exaggeration = Math.max(0.1, Math.min(20, x)); this.markerAt = null; this.invalidate(); }
  /** Mark a place on the ball (a unit direction), or clear the mark. */
  setMarker(dir: V3 | null) { this.marker = dir ? norm(dir) : null; this.markerAt = null; this.invalidate(); }
  private markerPos(): V3 | null {
    if (!this.marker) return null;
    if (!this.markerAt) { const top = (this.mesh ? Math.max(0, ...this.mesh.patches.map(p => p.maxH)) : 0) * this.step + 10, d = this.marker, hit = this.castRay(sc(d, this.R + top), sc(d, -1)); this.markerAt = hit && !hit.sea ? hit.point : sc(d, this.R); }
    return this.markerAt;
  }
  private get step() { return LAYER_TILES * this.exaggeration; }
  /** How far under sea level the sea sphere lies: more than the sag of the flat floors between their vertices (a floor at sea level is a chord of the ball), or the sea would show through them. */
  private seaDrop = 0.15 * LAYER_TILES;
  private get seaR() { return this.R - this.seaDrop; }
  get hasMesh() { return !!this.mesh; }
  /** The camera's height over the sea level (tiles). */
  get altitude() { return Math.hypot(...this.eye) - this.R; }

  /** Put the camera over a point on the ball (unit direction) at a height (tiles over the ground; large: the whole planet). */
  lookAt(dir: V3, altitude: number, tilt = 0) {
    this.f = norm(dir); const ref: V3 = Math.abs(this.f[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    this.t = norm(sub(ref, sc(this.f, dot(ref, this.f)))); this.tilt = tilt; this.D = Math.max(altitude, 2) / Math.cos(tilt); this.camera(); this.invalidate();
  }
  /** Back off until the whole planet fits the view (a tall phone screen is narrower than it is high). */
  fitGlobe(dir: V3 = this.f) {
    const th = Math.atan(Math.tan(this.fov / 2) * Math.min(1, this.w / this.h));
    this.lookAt(dir, this.R / Math.sin(th * 0.8) - this.R);
  }
  /** The highest ground (tiles over sea level) under the middle of the view, from the patches' caps. */
  private groundTop(): number {
    const m = this.mesh; if (!m) return 0;
    let top = 0;
    for (const p of m.patches) { const a = Math.acos(Math.max(-1, Math.min(1, dot(p.cap as unknown as V3, this.f)))); if (a <= p.cap[3] && p.maxH > top) top = p.maxH; }
    return top * this.step;
  }
  private camera() {
    const R = this.R, minD = 2.5;
    // the nearest the camera may come: a few tiles over the highest ground under the view
    const top = this.groundTop() + 2;
    this.D = Math.max(minD / Math.max(Math.cos(this.tilt), 0.2), Math.min(this.D, R * 7));
    const place = () => { const g = sc(this.f, R), back = sub(sc(this.f, Math.cos(this.tilt)), sc(this.t, Math.sin(this.tilt))); return { g, eye: add(g, sc(back, this.D)) }; };
    let { g, eye } = place();
    for (let i = 0; i < 4 && Math.hypot(...eye) < R + top; i++) { this.D += (R + top - Math.hypot(...eye)) / Math.max(Math.cos(this.tilt), 0.2); ({ g, eye } = place()); }
    this.eye = eye;
    const fwd = norm(sub(g, eye)), upRef = add(sc(this.f, Math.sin(this.tilt)), sc(this.t, Math.cos(this.tilt)));
    const rgt = norm(cross(fwd, upRef)), up = cross(rgt, fwd);
    this.fwd = fwd; this.rgt = rgt; this.upv = up;
    const dist = Math.hypot(...eye), alt = Math.max(dist - R - top + 2, 0.5);
    this.near = Math.max(0.05, Math.min(alt * 0.3, R * 0.5)); this.far = dist + R * 1.2 + 50;
    this.view = lookAt(eye, g, up); this.proj = perspective(this.fov, this.w / this.h, this.near, this.far); this.vp = mul(this.proj, this.view);
  }
  private resize() {
    const c = this.canvas, dpr = this.o.pixelRatio ?? Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round((c.clientWidth || 300) * dpr)), h = Math.max(1, Math.round((c.clientHeight || 150) * dpr));
    if (w !== c.width || h !== c.height) { c.width = w; c.height = h; }
    this.w = w; this.h = h; this.camera(); this.invalidate();
  }
  /** Rotate the focus: `a` over the screen's up axis (drag down), `b` round it (drag right), in radians. */
  private pan(a: number, b: number) {
    let f = this.f, t = this.t;
    const f1 = add(sc(f, Math.cos(a)), sc(t, Math.sin(a))), t1 = sub(sc(t, Math.cos(a)), sc(f, Math.sin(a)));
    const r = cross(t1, f1); f = norm(sub(sc(f1, Math.cos(b)), sc(r, Math.sin(b)))); t = norm(sub(t1, sc(f, dot(t1, f))));
    this.f = f; this.t = t;
  }
  private heading(a: number) { const r = cross(this.t, this.f); this.t = norm(add(sc(this.t, Math.cos(a)), sc(r, Math.sin(a)))); }
  private rate(): number { const alt = Math.max(this.D * Math.cos(this.tilt), 1); return this.fov * Math.max(0.0003, Math.min(1, alt / this.R)); }

  // ---- input --------------------------------------------------------------------------------------------------------------------------

  /** Sculpt mode: a left drag (one finger) paints, reported through `onStroke`, and a right or middle drag (two fingers) turns the planet. Off: a left drag turns it, right or shift tilts. */
  sculptMode = false;
  /** A stroke of the brush: the first hit (`start`), each move of it (`move`: null when the pointer is off the planet) and its end. */
  onStroke: ((hit: PickHit | null, phase: 'start' | 'move' | 'end') => void) | null = null;

  private attachControls(on: (t: EventTarget, ev: string, fn: EventListenerOrEventListenerObject, opt?: AddEventListenerOptions) => void) {
    const c = this.canvas, ptrs = new Map<number, { x: number; y: number; mode: 'orbit' | 'stroke' | 'tilt' }>(); let pinch = 0, moved = false;
    c.style.touchAction = 'none';
    const endStrokes = () => { for (const p of ptrs.values()) if (p.mode === 'stroke') { p.mode = 'orbit'; this.onStroke?.(null, 'end'); } };
    on(c, 'pointerdown', ((e: PointerEvent) => {
      c.setPointerCapture(e.pointerId); moved = false;
      const sculpt = this.sculptMode, mode = sculpt ? (e.button === 0 && !e.shiftKey ? 'stroke' : e.button === 0 ? 'tilt' : 'orbit') : (e.shiftKey || e.button === 2 ? 'tilt' : 'orbit');
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, mode });
      if (ptrs.size === 2) { endStrokes(); const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      else if (mode === 'stroke') this.onStroke?.(this.pick(e.clientX, e.clientY), 'start');
    }) as EventListener);
    on(c, 'pointermove', ((e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      if (!p) { this.o.onPick?.(this.pick(e.clientX, e.clientY), e); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
      const H = c.clientHeight || 1;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) this.D *= pinch / d; pinch = d;
        const k = this.rate() / H / 2; this.pan(dy * k, dx * k);   // (two fingers: each moved by dx, dy, and they turn the planet by the mean)
      } else if (p.mode === 'stroke') { const hit = this.pick(e.clientX, e.clientY); this.o.onPick?.(hit, e); this.onStroke?.(hit, 'move'); return; }
      else if (p.mode === 'tilt') { this.heading(-dx * 0.006); this.tilt = Math.max(0, Math.min(1.25, this.tilt + dy * 0.006)); }
      else { const k = this.rate() / H; this.pan(dy * k, dx * k); }
      this.camera(); this.invalidate();
    }) as EventListener);
    const up = ((e: PointerEvent) => {
      const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); pinch = 0;
      if (p?.mode === 'stroke') this.onStroke?.(null, 'end');
      else if (!moved && e.type === 'pointerup' && !this.sculptMode) this.o.onPick?.(this.pick(e.clientX, e.clientY), e);
    }) as EventListener;
    on(c, 'pointerup', up); on(c, 'pointercancel', up);
    on(c, 'contextmenu', (e => e.preventDefault()) as EventListener);
    on(c, 'wheel', ((e: WheelEvent) => { e.preventDefault(); this.D *= Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015); this.camera(); this.invalidate(); }) as EventListener, { passive: false });
  }

  // ---- frames -------------------------------------------------------------------------------------------------------------------------

  /** Ask for one frame (any number of calls before it runs make one). */
  invalidate() { this.dirty = true; if (!this.raf && !this.disposed && !this.lost && !document.hidden) this.raf = requestAnimationFrame(this.frame); }
  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.lost || document.hidden) return;
    const wanted = this.dirty || !!this.staged || !!this.bench; this.dirty = false;
    if (!wanted) { this.idleFrames++; return; }
    const b = this.bench;
    if (b) { if (b.last) b.times.push(now - b.last); b.last = now; this.f = norm(add(sc(this.f, Math.cos(0.012)), sc(cross(this.t, this.f), 0.012))); this.camera(); }
    if (this.lastFrameAt) this.frameMs = now - this.lastFrameAt; this.lastFrameAt = now;
    this.pumpUpload();
    this.draw();
    if (b && now >= b.until) { this.bench = null; const gpu = this.prof?.gpuWin.length ? [...this.prof.gpuWin].sort((x, y) => x - y)[Math.floor(this.prof.gpuWin.length / 2)] : null; b.resolve({ ...summarize(b.times), gpuMs: gpu }); this.lastFrameAt = 0; }
    if (this.staged || this.bench) this.invalidate();   // (uploads and a benchmark keep the frames coming; nothing else does)
  };

  private draw() {
    const gl = this.gl, R = this.R, step = this.step;
    this.prof?.frameBegin();
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0.015, 0.02, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // stars: at infinity, behind everything
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.progStar.p); gl.uniformMatrix4fv(this.progStar.u.uProj, false, this.proj); gl.uniformMatrix4fv(this.progStar.u.uView, false, this.view);
    gl.bindVertexArray(this.stars.vao); gl.drawArrays(gl.POINTS, 0, this.stars.n);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    const sun = norm(add(add(sc(this.rgt, -0.35), sc(this.upv, 0.45)), sc(sc(this.fwd, -1), 0.8)));   // (a light over the viewer's left shoulder, so the walls facing it read as walls)
    // the ground
    const m = this.mesh; let tris = 0, drawn = 0, culled = 0;
    if (m) {
      gl.useProgram(this.progT.p); const u = this.progT.u;
      gl.uniformMatrix4fv(u.uVP, false, this.vp); gl.uniform1f(u.uR, R); gl.uniform1f(u.uStep, step); gl.uniform3f(u.uSun, sun[0], sun[1], sun[2]); gl.uniform3f(u.uEye, this.eye[0], this.eye[1], this.eye[2]);
      gl.uniform4f(u.uBrush, this.brush[0], this.brush[1], this.brush[2], this.brush[3]); gl.uniform1f(u.uRim, this.rim);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      const dist = Math.hypot(...this.eye), up = sc(this.eye, 1 / dist) as V3, alt = dist - R;
      for (const p of m.patches) {
        if (!this.visible(p, up, alt, step)) { culled++; continue; }
        gl.bindVertexArray(p.vao); gl.drawElements(gl.TRIANGLES, p.ni, p.type, 0); tris += p.ni / 3; drawn++;
      }
      gl.disable(gl.CULL_FACE);
    }
    // the sea
    gl.useProgram(this.progS.p); const s = this.progS.u;
    gl.uniformMatrix4fv(s.uVP, false, this.vp); gl.uniform1f(s.uSeaR, this.seaR); gl.uniform3f(s.uSun, sun[0], sun[1], sun[2]); gl.uniform3f(s.uEye, this.eye[0], this.eye[1], this.eye[2]);
    gl.uniform4f(s.uBrush, this.brush[0], this.brush[1], this.brush[2], this.brush[3]); gl.uniform1f(s.uRim, this.rim);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.bindVertexArray(this.sea.vao); gl.drawElements(gl.TRIANGLES, this.sea.n, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.CULL_FACE); gl.bindVertexArray(null);
    const mk = this.markerPos();
    if (mk) {   // (a dot a little over the ground, hidden behind the horizon and the hills like anything else)
      const dist = Math.hypot(this.eye[0] - mk[0], this.eye[1] - mk[1], this.eye[2] - mk[2]), lift = Math.max(0.6, dist * 0.004), dn = norm(mk), at = add(mk, sc(dn, lift));
      gl.useProgram(this.progMark.p); gl.uniformMatrix4fv(this.progMark.u.uVP, false, this.vp); gl.uniform3f(this.progMark.u.uPos, at[0], at[1], at[2]); gl.uniform1f(this.progMark.u.uSize, 18 * (this.w / Math.max(1, this.canvas.clientWidth || this.w)));
      gl.drawArrays(gl.POINTS, 0, 1);
    }
    this.lastDraw = { tris, patches: drawn, culled }; this.frames++;
    this.prof?.frameEnd();
  }

  /** Is any of a patch in view? Over the horizon and out of the view are both tested with facetiles.ts; the bounds include the highest ground times the exaggeration. */
  private visible(p: GpuPatch, up: V3, alt: number, step: number): boolean {
    if (!p.nv) return false;
    const c = p.cap as unknown as V3, rad = p.cap[3], hill = Math.max(0, p.maxH * step);
    if (capOverHorizon(c, rad, up, this.R, Math.max(alt, 0), hill)) return false;
    const Rt = this.R + p.maxH * step, rr = Rt * 2 * Math.sin(Math.min(rad, Math.PI / 2) / 2) + (p.maxH - Math.min(p.minH, p.maxH)) * step + 1;
    return sphereInView(this.vp, c[0] * Rt, c[1] * Rt, c[2] * Rt, rad > Math.PI / 2 ? Rt * 2 : rr);
  }

  // ---- picking ------------------------------------------------------------------------------------------------------------------------

  /** The ray under a point of the canvas (client pixels), as an origin and a unit direction. */
  ray(cx: number, cy: number): { o: V3; d: V3 } {
    const r = this.canvas.getBoundingClientRect(), nx = ((cx - r.left) / (r.width || 1)) * 2 - 1, ny = 1 - ((cy - r.top) / (r.height || 1)) * 2, th = Math.tan(this.fov / 2), asp = this.w / this.h;
    return { o: this.eye, d: norm(add(add(this.fwd, sc(this.rgt, nx * th * asp)), sc(this.upv, ny * th))) };
  }
  /** What the ray at a canvas point first hits: the terrain (a ray against the patches' caps, then their triangles), else the sea, else null. Nothing is read from the GPU. */
  pick(cx: number, cy: number): PickHit | null { const { o, d } = this.ray(cx, cy); return this.castRay(o, d); }
  /** `pick` for any ray (origin, unit direction). */
  castRay(o: V3, d: V3): PickHit | null {
    const m = this.mesh, step = this.step, R = this.R;
    let best: PickHit | null = null;
    if (m) {
      const hits: { p: GpuPatch; i: number; t: number }[] = [];
      m.patches.forEach((p, i) => {
        if (!p.nv) return;
        const Rt = R + p.maxH * step, rad = p.cap[3], r = rad > Math.PI / 2 ? Rt : Rt * 2 * Math.sin(rad / 2) + (p.maxH - p.minH) * step + 1, c = sc(p.cap as unknown as V3, rad > Math.PI / 2 ? 0 : Rt);
        const oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - r * r, disc = b * b - cc;
        if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > -2 * r) hits.push({ p, i, t }); }
      });
      hits.sort((a, b) => a.t - b.t);
      for (const h of hits) {
        if (best && h.t > best.t) break;   // (the patches are in order of where the ray enters them: no later one can be nearer)
        const src = h.p.src, f = new Float32Array(src.verts), idx = src.index;
        const P = (v: number): V3 => { const q = v * 6, r = R + f[q + 3] * step; return [f[q] * r, f[q + 1] * r, f[q + 2] * r]; };
        for (let k = 0; k < src.ni; k += 3) {
          const a = P(idx[k]), b = P(idx[k + 1]), c = P(idx[k + 2]), e1 = sub(b, a), e2 = sub(c, a), pv = cross(d, e2), det = dot(e1, pv);
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, tv = sub(o, a), u = dot(tv, pv) * inv; if (u < 0 || u > 1) continue;
          const qv = cross(tv, e1), v = dot(d, qv) * inv; if (v < 0 || u + v > 1) continue;
          const t = dot(e2, qv) * inv; if (t <= 0 || (best && t >= best.t)) continue;
          const pt = add(o, sc(d, t)), dir = norm(pt), hh = (Math.hypot(...pt) - R) / step;
          best = { dir, point: pt, t, sea: false, height: hh, face: src.face, patch: h.i };
        }
      }
    }
    // the sea: where the ray meets it (and the terrain did not come first)
    const oc = o, b = dot(oc, d), cc = dot(oc, oc) - this.seaR * this.seaR, disc = b * b - cc;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && (!best || t < best.t)) { const pt = add(o, sc(d, t)); best = { dir: norm(pt), point: pt, t, sea: true, height: 0, face: -1, patch: -1 }; } }
    return best;
  }

  // ---- measuring ----------------------------------------------------------------------------------------------------------------------

  /** Draw continuously for `ms`, turning the planet under the camera, and give the frame times (the benchmark: every frame is drawn, not just the ones asked for). */
  benchmark(ms: number): Promise<FrameSummary & { gpuMs: number | null }> {
    return new Promise(resolve => { this.prof?.resetWindow(); this.bench = { until: performance.now() + ms, times: [], last: 0, resolve }; this.invalidate(); });
  }
  stats(): PlanetStats {
    return { drawnTris: this.lastDraw.tris, drawnPatches: this.lastDraw.patches, culledPatches: this.lastDraw.culled, residentTris: this.mesh?.tris ?? 0, residentBytes: this.mesh?.bytes ?? 0,
      stagedBytes: this.staged ? this.staged.done.reduce((s, p) => s + p.bytes, 0) : 0, uploadMs: this.uploadMs, frames: this.frames, altitude: this.altitude, frameMs: this.frameMs };
  }
  get profile() { return this.prof; }
  get context() { return this.gl; }
  /** Is a frame waiting to be drawn? (for the tests: idle means no). */
  get frameScheduled() { return this.raf !== 0; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    for (const [t, ev, fn, opt] of this.listeners) t.removeEventListener(ev, fn, opt);
    this.listeners = []; this.ro?.disconnect(); this.ro = null;
    const gl = this.gl;
    this.freeMesh(this.mesh); this.mesh = null;
    if (this.staged) this.freeMesh({ patches: this.staged.done, tris: 0, bytes: 0, src: this.staged.src }); this.staged = null;
    for (const p of [this.progT, this.progS, this.progStar, this.progMark]) gl.deleteProgram(p.p);
    gl.deleteVertexArray(this.sea.vao); gl.deleteBuffer(this.sea.vbo); gl.deleteBuffer(this.sea.ibo);
    gl.deleteVertexArray(this.stars.vao); gl.deleteBuffer(this.stars.vbo);
    this.prof?.dispose(); this.prof = null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
