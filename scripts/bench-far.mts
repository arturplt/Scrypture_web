import { terraceFarMesh } from '../src/domain/terrace';
for (const [step, half] of [[5, 1000], [12, 2400], [32, 4000]]) {
  const g = terraceFarMesh(42, 100, 100, step, half, step < 10); let worst = 0, total = 0, n = 0; let t = performance.now();
  for (;;) { const r = g.next(); const now = performance.now(); worst = Math.max(worst, now - t); total += now - t; t = now; n++; if (r.done) {
    const m = r.value; const t1 = performance.now(); const N = m.pos.length / 3, v = new Float32Array(N * 9);
    for (let i = 0; i < N; i++) { const o = i * 9; v[o] = m.pos[i*3]; v[o+1] = m.pos[i*3+1]; v[o+2] = m.pos[i*3+2]; v[o+3] = .5; v[o+4] = .5; v[o+5] = m.col[i*3]; v[o+6] = m.col[i*3+1]; v[o+7] = m.col[i*3+2]; v[o+8] = 1; }
    console.log(`step ${step}: cols ${m.cols}, slices ${n}, total ${total.toFixed(0)} ms, worst slice ${worst.toFixed(1)} ms, interleave ${(performance.now() - t1).toFixed(1)} ms`); break; } }
}
