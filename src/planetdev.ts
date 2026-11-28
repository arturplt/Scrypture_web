/**
 * Development harness for the world generator's preview (milestone 3): `/planet.html?seed=42&detail=64&band=3&ex=1&perf`. It is not part of the game's build (vite builds index.html only); the
 * generator screen of milestone 4 uses the same pieces. `window.__planet` is for scripts: `set(params, dragging)`, `ready`, `stats()`, `bench(ms)`, `shot`.
 */
import { PlanetGL } from './screens/planetgl';
import { PlanetClient, type PlanetParams } from './screens/planetClient';
import { GlProfile } from './screens/glprofile';
import { PerfPanel, v, tone, type Section } from './screens/perfpanel';
import { sanitizeGen } from './domain/genparams';
import { cubeRadius, CUBE_N } from './domain/cube';
import { defaultBand } from './domain/planetmesh';
import type { WorkerLike } from './screens/chunkClient';

const q = new URLSearchParams(location.search), num = (k: string, d: number) => (q.has(k) ? +q.get(k)! : d);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const detail = num('detail', 64);
let params: PlanetParams = { seed: num('seed', 42), size: CUBE_N, gen: sanitizeGen(Object.fromEntries(['sea', 'continents', 'mountains', 'peaks', 'hills', 'moisture', 'cold'].filter(k => q.has(k)).map(k => [k, +q.get(k)!]))), detail, band: num('band', defaultBand(detail)) };
const state = { ready: false, warn: '', last: null as unknown, swaps: 0, uploads: 0 };
const gl = new PlanetGL(canvas, { radius: cubeRadius(CUBE_N), pixelRatio: num('dpr', 1), profile: g => (q.has('perf') ? new GlProfile(g) : null) });
gl.setExaggeration(num('ex', 1));
gl.onSwap = () => { state.ready = true; state.swaps++; };
const client = new PlanetClient(() => new Worker(new URL('./workers/planet.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike, {
  onMesh: (mesh, info) => { state.last = { N: mesh.N, k: mesh.k, tris: mesh.tris, bytes: mesh.bytes, ...info }; gl.stage(mesh); },
  onWarn: w => { state.warn = w; },
  budgetTris: num('budget', 200_000),
});
client.set(params);
gl.lookAt([0.5, 0.3, 0.8], num('alt', 3.2 * cubeRadius(CUBE_N)), num('tilt', 0));

if (q.has('perf')) {
  const panel = new PerfPanel('monospace');
  const rows: Section[] = [];
  setInterval(() => {
    const s = gl.stats(), L = state.last as { N: number; k: number; tris: number; sampleMs: number; buildMs: number; latencyMs: number } | null, p = gl.profile;
    rows.length = 0;
    rows.push({ id: 'pl', title: 'Planet', open: true, head: [v(s.drawnTris / 1000, 'n', 0), 'k tris drawn'],
      rows: [['patches drawn ', v(s.drawnPatches), ' culled ', v(s.culledPatches)], ['resident ', v(s.residentTris / 1000, 'n', 0), 'k tris, ', v(s.residentBytes / 1048576, tone(s.residentBytes / 1048576, 64, 128), 1), ' MiB, staged ', v(s.stagedBytes / 1048576, 'n', 1), ' MiB'],
        ['upload ', v(s.uploadMs, 'n', 1), ' ms, frame ', v(s.frameMs, 'n', 1), ' ms, altitude ', v(s.altitude, 'n', 0), ' tiles'],
        ...(L ? [['last mesh N ', v(L.N), ' band ', v(L.k), ': sample ', v(L.sampleMs, 'n', 0), ' ms, build ', v(L.buildMs, 'n', 0), ' ms, latency ', v(L.latencyMs, 'n', 0), ' ms'] as const] : []),
        ...(p ? [['draws ', v(p.last.draws), ' tris ', v(p.last.tris), ' up ', v(p.last.upBytes / 1024, 'n', 0), ' KiB gpu ', v(p.gpuMs ?? NaN, 'n', 2), ' ms'] as const] : []),
        ['requests ', v(client.requests), ' meshes ', v(client.meshes), ' stale dropped ', v(client.staleDropped), ' over budget ', v(client.overBudget)]] });
    panel.update(rows, state.warn ? [state.warn] : []);
  }, 1000);
}
(window as unknown as Record<string, unknown>).__planet = {
  gl, client, state,
  get ready() { return state.ready; },
  set: (p: Partial<PlanetParams>, dragging = false) => { params = { ...params, ...p }; client.set(params, dragging); },
  stats: () => gl.stats(), bench: (ms: number) => gl.benchmark(ms),
  look: (d: [number, number, number], alt: number, tilt = 0) => gl.lookAt(d, alt, tilt),
  pick: (x: number, y: number) => gl.pick(x, y),
  dispose: () => { client.dispose(); gl.dispose(); },
};
