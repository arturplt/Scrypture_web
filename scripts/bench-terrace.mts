import { TerraceField } from '../src/domain/terrace';
const f = new TerraceField(42);
for (let i = 0; i < 400; i++) f.grid(i, 3);
for (let r = 0; r < 4; r++) {
  const N = 300, t0 = performance.now();
  for (let i = 0; i < N; i++) f.grid(1000 + r * 400 + i, 7);
  console.log('grid ms', ((performance.now() - t0) / N).toFixed(3));
}
