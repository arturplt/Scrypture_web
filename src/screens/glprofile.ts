/**
 * Phase 0 profiling for the 3D view (see SCRYPTURE_TERRAIN_OPTIMISATION_ROADMAP.md). Only created when `?perf` is in the address, so ordinary play never wraps the context.
 *
 *  - `GlProfile` counts draw calls, submitted triangles, render passes (framebuffer binds) and bytes handed to the GPU, per frame, by wrapping the context's own methods.
 *    Nothing in worldgl.ts has to be touched, so every draw site is counted, present and future.
 *  - It also times the frame on the GPU with EXT_disjoint_timer_query_webgl2, asynchronously: results are polled in later frames, disjoint samples are dropped and
 *    the number of queries in flight is bounded. When the extension is missing `gpuMs` stays null (never a synchronous readback: that is `gpuWaitMs()`, a separate opt-in probe).
 *  - `summarize` turns a list of frame times into median / p95 / p99 / 1% low.
 */

export interface FrameSummary { n: number; p50: number; p95: number; p99: number; max: number; avgFps: number; low1Fps: number }

/** The p-th percentile (0..100) of an ascending list, by nearest rank. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (!n) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
}

/** Frame times in ms -> the numbers a benchmark compares. `low1Fps` is the fps of the slowest 1% of frames (their mean frame time). */
export function summarize(ms: ArrayLike<number>): FrameSummary {
  const a = Array.from(ms).filter(v => v > 0 && isFinite(v)).sort((x, y) => x - y), n = a.length;
  if (!n) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0, avgFps: 0, low1Fps: 0 };
  let sum = 0; for (const v of a) sum += v;
  const k = Math.max(1, Math.ceil(n * 0.01)); let worst = 0; for (let i = n - k; i < n; i++) worst += a[i];
  return { n, p50: percentile(a, 50), p95: percentile(a, 95), p99: percentile(a, 99), max: a[n - 1], avgFps: 1000 / (sum / n), low1Fps: 1000 / (worst / k) };
}

/** The triangles a draw call of `count` indices or vertices submits. */
export function trianglesOf(mode: number, count: number, gl: { TRIANGLES: number; TRIANGLE_STRIP: number; TRIANGLE_FAN: number }): number {
  if (mode === gl.TRIANGLES) return Math.floor(count / 3);
  if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) return Math.max(0, count - 2);
  return 0;
}

export interface GlCounts { draws: number; tris: number; passes: number; upBytes: number; upCalls: number }
const zero = (): GlCounts => ({ draws: 0, tris: 0, passes: 0, upBytes: 0, upCalls: 0 });

const MAX_QUERIES = 6;   // (timer queries in flight: results come back a frame or two later)

export class GlProfile {
  /** Counts since the last `frameBegin`. */
  readonly cur: GlCounts = zero();
  /** The finished frame's counts. */
  last: GlCounts = zero();
  /** Frame totals over the current readout window (divide by `frames`). */
  win: GlCounts = zero(); frames = 0; maxDraws = 0; maxTris = 0; maxUp = 0;
  /** GPU time of the last completed frame (ms), or null when the extension is missing or nothing has come back yet. */
  gpuMs: number | null = null;
  /** GPU ms of the samples that came back in the current window. */
  gpuWin: number[] = [];
  readonly timerSupported: boolean;
  disjoint = 0;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private open: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];
  private restore: (() => void)[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GlProfile['ext'];
    this.timerSupported = !!this.ext;
    const g = gl as unknown as Record<string, (...a: number[]) => unknown>, c = this.cur;
    const wrap = (name: string, fn: (orig: (...a: unknown[]) => unknown, args: unknown[]) => void) => {
      if (typeof g[name] !== 'function') return;
      const own = Object.prototype.hasOwnProperty.call(g, name), prev = g[name] as unknown as (...a: unknown[]) => unknown, orig = prev.bind(gl);
      (g as Record<string, unknown>)[name] = (...args: unknown[]) => { fn(orig, args); return orig(...args); };
      this.restore.push(() => { if (own) (g as Record<string, unknown>)[name] = prev; else delete (g as Record<string, unknown>)[name]; });   // (a real context keeps these on its prototype: deleting our own property puts the original back)
    };
    const bytesOf = (v: unknown): number => typeof v === 'number' ? v : ArrayBuffer.isView(v) ? v.byteLength : v instanceof ArrayBuffer ? v.byteLength : 0;
    wrap('drawElements', (_o, a) => { c.draws++; c.tris += trianglesOf(a[0] as number, a[1] as number, gl); });
    wrap('drawArrays', (_o, a) => { c.draws++; c.tris += trianglesOf(a[0] as number, a[2] as number, gl); });
    wrap('drawElementsInstanced', (_o, a) => { c.draws++; c.tris += trianglesOf(a[0] as number, a[1] as number, gl) * (a[4] as number); });
    wrap('drawArraysInstanced', (_o, a) => { c.draws++; c.tris += trianglesOf(a[0] as number, a[2] as number, gl) * (a[3] as number); });
    wrap('bindFramebuffer', (_o, a) => { if (a[0] === gl.FRAMEBUFFER || a[0] === gl.DRAW_FRAMEBUFFER) c.passes++; });
    wrap('bufferData', (_o, a) => { c.upCalls++; c.upBytes += bytesOf(a[1]); });
    wrap('bufferSubData', (_o, a) => { c.upCalls++; c.upBytes += bytesOf(a[2]); });
    wrap('texImage2D', (_o, a) => { c.upCalls++; const px = a[a.length - 1]; if (ArrayBuffer.isView(px)) c.upBytes += px.byteLength; });
    wrap('texSubImage2D', (_o, a) => { c.upCalls++; const px = a[a.length - 1]; if (ArrayBuffer.isView(px)) c.upBytes += px.byteLength; });
  }

  /** Call right before the frame's first GL work. */
  frameBegin() {
    this.poll();
    const c = this.cur; c.draws = c.tris = c.passes = c.upBytes = c.upCalls = 0;   // (reset in place: the wrappers hold this object)
    if (this.ext && !this.open && this.pending.length < MAX_QUERIES) {
      const q = this.gl.createQuery();
      if (q) { this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.open = q; }
    }
  }

  /** Call after the frame's last GL work. */
  frameEnd() {
    if (this.ext && this.open) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.open); this.open = null; }
    const c = this.cur; this.last = { ...c };
    this.frames++; this.win.draws += c.draws; this.win.tris += c.tris; this.win.passes += c.passes; this.win.upBytes += c.upBytes; this.win.upCalls += c.upCalls;
    this.maxDraws = Math.max(this.maxDraws, c.draws); this.maxTris = Math.max(this.maxTris, c.tris); this.maxUp = Math.max(this.maxUp, c.upBytes);
  }

  /** The counts so far this frame (for attributing a stretch of the frame: take one before and one after). */
  snap(): GlCounts { return { ...this.cur }; }

  /** Start a new readout window (call after printing it). */
  resetWindow() { this.win = zero(); this.frames = 0; this.maxDraws = this.maxTris = this.maxUp = 0; this.gpuWin = []; }

  /** Collect timer results that are ready; drop everything if the GPU reported a disjoint event. */
  private poll() {
    const gl = this.gl, ext = this.ext; if (!ext) return;
    const lost = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!lost && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (lost) { this.disjoint++; gl.deleteQuery(q); continue; }
      const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      gl.deleteQuery(q);
      this.gpuMs = ms; this.gpuWin.push(ms);
    }
  }

  dispose() {
    const gl = this.gl;
    if (this.open && this.ext) { try { gl.endQuery(this.ext.TIME_ELAPSED_EXT); } catch { /* none open */ } gl.deleteQuery(this.open); this.open = null; }
    for (const q of this.pending) gl.deleteQuery(q);
    this.pending = [];
    for (const r of this.restore) r();
    this.restore = [];
  }
}
