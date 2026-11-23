// the terraced chunk mesh: its size, its time, and that its level pieces tile the chunk exactly (area 256)
import { TerraceField, terraceChunkMesh } from '../src/domain/terrace';
const f = new TerraceField(42);
for (let i = 0; i < 60; i++) terraceChunkMesh(f.grid(i, 5).e, i, 5);
let t0 = performance.now(), N = 200, verts = 0, tris = 0;
for (let i = 0; i < N; i++) { const m = terraceChunkMesh(f.grid(100 + i, 9).e, 100 + i, 9); verts += m.pos.length / 3; tris += m.idx.length / 3; }
console.log('mesh ms', ((performance.now() - t0) / N).toFixed(2), 'verts', (verts / N).toFixed(0), 'tris', (tris / N).toFixed(0));
for (const [cx, cy] of [[100, 9], [0, 0], [-7, 3]]) {
  const m = terraceChunkMesh(f.grid(cx, cy).e, cx, cy); let area = 0;
  for (let k = 0; k < m.idx.length; k += 3) {
    const a = m.idx[k], b = m.idx[k + 1], c = m.idx[k + 2];
    if (m.nrm[a * 3 + 2] !== -1) continue;   // (walls are not level)
    area += Math.abs((m.pos[b * 3] - m.pos[a * 3]) * (m.pos[c * 3 + 1] - m.pos[a * 3 + 1]) - (m.pos[c * 3] - m.pos[a * 3]) * (m.pos[b * 3 + 1] - m.pos[a * 3 + 1])) / 2;
  }
  console.log('chunk', cx, cy, 'level area', area.toFixed(4), '(256 expected)');
}
