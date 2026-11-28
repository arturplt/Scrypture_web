// Steps for scripts/planet-check.mjs: the milestone 3 gate (frame times by detail, no rebuild on camera moves, idle frames stop, cancellation storm, disposal).
import { writeFileSync } from 'node:fs';
const D = new URL('../bench-results/planet/', import.meta.url).pathname;
export default async ({ go, ev, shot, sleep, renderer }) => {
  const out = { renderer, size: '1280x720', frames: {}, checks: {} };
  for (const [detail, band] of [[32, 4], [64, 3], [128, 3]]) {
    await go(`seed=42&detail=${detail}&band=${band}&perf&ex=2`);
    const hit = JSON.parse(await ev('JSON.stringify(__planet.pick(640,215))'));
    const row = {};
    row.build = JSON.parse(await ev('JSON.stringify(__planet.state.last)'));
    const req0 = await ev('__planet.client.requests');
    await ev('__planet.look([0.04,0.02,1], 7000, 0)'); await sleep(300);
    row.globe = JSON.parse(await ev('(async()=>JSON.stringify(await __planet.bench(4000)))()'));
    row.globeStats = await ev('__planet.stats()');
    await ev(`__planet.look(${JSON.stringify(hit.dir)}, 400, 0.6)`); await sleep(300);
    row.mid = JSON.parse(await ev('(async()=>JSON.stringify(await __planet.bench(4000)))()'));
    row.midStats = await ev('__planet.stats()');
    await ev(`__planet.look(${JSON.stringify(hit.dir)}, 25, 0.9)`); await sleep(300);
    row.close = JSON.parse(await ev('(async()=>JSON.stringify(await __planet.bench(4000)))()'));
    row.closeStats = await ev('__planet.stats()');
    row.gpu = await ev('(()=>{const p=__planet.gl.profile;return p?{timer:p.timerSupported,gpuMs:p.gpuMs,draws:p.last.draws,tris:p.last.tris}:null})()');
    out.frames[`N${detail}`] = row;
    out.checks[`N${detail}.noRebuildOnCamera`] = (await ev('__planet.client.requests')) === req0;
    if (detail === 64) await shot(D + 'perf-panel64.png');
  }
  // idle: nothing draws and no frame is scheduled
  await go('seed=42&detail=64&band=3');
  await sleep(1000); const f0 = await ev('__planet.stats().frames'); await sleep(1500);
  out.checks.idleFramesStop = (await ev('__planet.stats().frames')) === f0 && !(await ev('__planet.gl.frameScheduled'));
  // a camera move draws a few frames and then stops again
  await ev('__planet.look([0.3,0.4,0.8], 5000, 0)'); await sleep(600);
  const f1 = await ev('__planet.stats().frames'); await sleep(800);
  out.checks.cameraMoveThenIdle = f1 > f0 && (await ev('__planet.stats().frames')) === f1;
  // a cancellation storm: 80 dragged changes in a burst, then quiet
  const before = await ev('JSON.stringify({m:__planet.client.meshes,s:__planet.client.staleDropped,r:__planet.client.requests,sw:__planet.state.swaps})');
  await ev(`(async()=>{for(let i=0;i<80;i++){__planet.set({gen:{v:1,sea:0,continents:1,mountains:0.2+(i%10)/6,peaks:1,hills:0.3+(i%7)/5,moisture:0,cold:0}},true);await new Promise(r=>setTimeout(r,8));}})()`);
  await sleep(4000);
  const after = JSON.parse(await ev('JSON.stringify({m:__planet.client.meshes,s:__planet.client.staleDropped,r:__planet.client.requests,sw:__planet.state.swaps,last:__planet.state.last,staged:__planet.stats().stagedBytes})'));
  out.storm = { before: JSON.parse(before), after };
  out.checks.stormEndsOnFullDetail = after.last.N === 64 && !after.last.quick && after.staged === 0;
  out.checks.stormMeshesFarFewerThanRequests = after.m - JSON.parse(before).m < 20;
  // disposal
  const fr = await ev('__planet.stats().frames');
  await ev('__planet.dispose()'); await sleep(800);
  out.checks.disposed = { contextLost: await ev('__planet.gl.context.isContextLost()'), noFramesAfter: (await ev('__planet.stats().frames')) === fr, rafOff: !(await ev('__planet.gl.frameScheduled')) };
  writeFileSync(D + 'm3-measure.json', JSON.stringify(out, null, 1));
  const f = s => `p50 ${s.p50.toFixed(1)} p95 ${s.p95.toFixed(1)} p99 ${s.p99.toFixed(1)} ms${s.gpuMs != null ? `, gpu ${s.gpuMs.toFixed(2)} ms` : ''} (n=${s.n})`;
  for (const [k, r] of Object.entries(out.frames)) console.log(k, `build ${r.build.tris} tris, sample ${r.build.sampleMs.toFixed(0)} ms, build ${r.build.buildMs.toFixed(0)} ms, latency ${r.build.latencyMs.toFixed(0)} ms, ${(r.build.bytes / 1048576).toFixed(1)} MiB, upload ${r.globeStats.uploadMs.toFixed(1)} ms\n  globe: ${f(r.globe)}; drawn ${r.globeStats.drawnTris} tris / ${r.globeStats.drawnPatches} patches\n  mid: ${f(r.mid)}; drawn ${r.midStats.drawnTris} / ${r.midStats.drawnPatches}\n  close: ${f(r.close)}; drawn ${r.closeStats.drawnTris} / ${r.closeStats.drawnPatches}`);
  console.log(JSON.stringify(out.checks), JSON.stringify(out.storm));
};
