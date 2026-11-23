// cold chunkDrawn cost on a terraced world, flying along a row of new chunks (roadmap A2: < 1.5 ms)
import { World } from '../src/domain/worldgen';
const w = new World(42, undefined, 'terraced');
for (let i = 0; i < 150; i++) w.chunkDrawn(-i - 300, 0);   // warm up the JIT somewhere else
for (let r = 0; r < 4; r++) {
  const N = 120, t0 = performance.now();
  for (let i = 0; i < N; i++) w.chunkDrawn(1000 + r * 200 + i, 40);
  console.log('cold chunkDrawn ms', ((performance.now() - t0) / N).toFixed(2));
}
// the same with the grids warmed ahead (what the look-ahead in WorldMap does a little each frame)
for (let r = 0; r < 3; r++) {
  const N = 120, list: [number, number][] = []; for (let i = -1; i <= N; i++) for (let j = 39; j <= 41; j++) list.push([3000 + r * 200 + i, j]);
  w.field!.prewarm(list, 1e9);
  const t0 = performance.now(); for (let i = 0; i < N; i++) w.chunkDrawn(3000 + r * 200 + i, 40);
  console.log('chunkDrawn with grids warm ms', ((performance.now() - t0) / N).toFixed(2));
}
