import { describe, it, expect } from 'vitest';
import { GlProfile, percentile, summarize, trianglesOf } from './glprofile';

const K = { TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, FRAMEBUFFER: 0x8d40, DRAW_FRAMEBUFFER: 0x8ca9, QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2 };

function fakeGl(timer: boolean) {
  const calls: string[] = [];
  const ready = new Set<object>();
  const gl: Record<string, unknown> = {
    ...K,
    drawElements() { calls.push('de'); }, drawArrays() { calls.push('da'); }, bindFramebuffer() { calls.push('fb'); },
    bufferData() { calls.push('bd'); }, bufferSubData() { calls.push('bsd'); }, texImage2D() { calls.push('ti'); }, texSubImage2D() { calls.push('tsi'); },
    getExtension: (n: string) => (timer && n === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 } : null),
    createQuery: () => { const q = {}; return q; }, beginQuery() { calls.push('bq'); }, endQuery() { calls.push('eq'); },
    deleteQuery: (q: object) => { ready.delete(q); },
    getParameter: () => false,
    getQueryParameter: (q: object, what: number) => (what === K.QUERY_RESULT_AVAILABLE ? ready.has(q) : 4_000_000),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls, ready };
}

describe('frame summary', () => {
  it('percentile is nearest-rank', () => {
    const a = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(a, 50)).toBe(50); expect(percentile(a, 95)).toBe(95); expect(percentile(a, 99)).toBe(99); expect(percentile([], 50)).toBe(0);
  });
  it('summarize finds the slow tail', () => {
    const ms = [...Array(99).fill(16.67), 100];
    const s = summarize(ms);
    expect(s.p50).toBeCloseTo(16.67); expect(s.max).toBe(100); expect(s.low1Fps).toBeCloseTo(10);
    expect(summarize([]).n).toBe(0);
  });
  it('counts triangles by mode', () => {
    expect(trianglesOf(K.TRIANGLES, 300, K)).toBe(100); expect(trianglesOf(K.TRIANGLE_STRIP, 10, K)).toBe(8); expect(trianglesOf(1, 10, K)).toBe(0);
  });
});

describe('GlProfile', () => {
  it('counts draws, triangles, passes and upload bytes per frame, and still calls the real methods', () => {
    const { gl, calls } = fakeGl(false), p = new GlProfile(gl);
    p.frameBegin();
    gl.drawElements(K.TRIANGLES, 3000, 0, 0); gl.drawArrays(K.TRIANGLES, 0, 3);
    gl.bindFramebuffer(K.FRAMEBUFFER, null); gl.bindFramebuffer(0x8d41, null);   // (a renderbuffer bind is not a pass)
    gl.bufferData(0, new Float32Array(100), 0); gl.bufferSubData(0, 0, new Uint8Array(50));
    p.frameEnd();
    expect(p.last).toEqual({ draws: 2, tris: 1001, passes: 1, upBytes: 450, upCalls: 2 });
    expect(calls).toEqual(['de', 'da', 'fb', 'fb', 'bd', 'bsd']);
    p.frameBegin(); p.frameEnd();
    expect(p.last.draws).toBe(0); expect(p.frames).toBe(2); expect(p.win.draws).toBe(2);
    expect(p.timerSupported).toBe(false); expect(p.gpuMs).toBeNull();
    p.dispose(); gl.drawArrays(K.TRIANGLES, 0, 3); expect(p.win.draws).toBe(2);   // (unwrapped: no longer counted)
  });
  it('collects timer results a frame later and bounds the queries in flight', () => {
    const { gl, calls, ready } = fakeGl(true), p = new GlProfile(gl);
    expect(p.timerSupported).toBe(true);
    for (let i = 0; i < 10; i++) { p.frameBegin(); p.frameEnd(); }   // (no result is ever ready)
    expect(calls.filter(c => c === 'bq').length).toBe(6);
    expect(p.gpuMs).toBeNull();
    // make them all ready: the next frame picks them up
    p['pending'].forEach(q => ready.add(q as object));
    p.frameBegin(); p.frameEnd();
    expect(p.gpuMs).toBeCloseTo(4); expect(p.gpuWin.length).toBe(6);
    p.dispose();
  });
});
