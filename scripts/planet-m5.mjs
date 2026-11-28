// Steps for scripts/planet-check.mjs: the milestone 5 gate on the real generator screen (a sculpt stroke with the real mouse, response times, undo, Create and fly).
import { writeFileSync } from 'node:fs';
const D = new URL('../bench-results/planet/', import.meta.url).pathname;
export default async ({ ev, shot, sleep, nav, ORIGIN, renderer, mouse }) => {
  const out = { renderer, checks: {} };
  await nav(ORIGIN + '/'); await ev(`localStorage.setItem('scrypture:state', JSON.stringify({version:1,user:{name:'Pilot',onboarded:true,tutorialSeen:true}}))`);
  await nav('about:blank'); await nav(`${ORIGIN}/?perf#/games/paperplane/generate`);
  await ev(`(()=>{const i=document.querySelector('.wg-seed input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'42');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  for (let i = 0; i < 100 && !(await ev('!!(window.__worldgen && window.__worldgen.log.length)')); i++) await sleep(300);
  await sleep(2500);
  const setRange = (label, v) => ev(`(()=>{const i=[...document.querySelectorAll('input[type=range]')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${v});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const click = txt => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(txt)});if(b){b.click();return true}return false})()`);
  await ev(`(()=>{for(const d of document.querySelectorAll('details.wg-sec')) if(/Sculpt/.test(d.innerText.slice(0,12))) d.open=true})()`);
  await ev(`window.__worldgen.gl.lookAt([1,0.1,0.1], 7000, 0)`); await sleep(500);
  const text = () => ev(`document.querySelector('.wg-status').innerText`);
  await shot(D + 'sculpt-before.png');
  out.checks.sculptButton = await click('Sculpt'); await sleep(200);
  await setRange('Brush radius', 12); await setRange('Strength (layers a dab)', 8); await sleep(300);
  const log0 = await ev('window.__worldgen.log.length');
  // a stroke: press, drag across the globe in 24 moves 20 ms apart, release
  const t0 = await ev('performance.now()');
  await mouse('mouseMoved', 690, 320); await sleep(100); await shot(D + 'sculpt-ring.png');
  await mouse('mousePressed', 690, 320, { buttons: 1 });
  for (let i = 1; i <= 24; i++) { await mouse('mouseMoved', 690 + i * 3, 320 + i * 2, { buttons: 1 }); await sleep(20); }
  const tUp = await ev('performance.now()'); await mouse('mouseReleased', 762, 368);
  for (let i = 0; i < 100; i++) { const l = JSON.parse(await ev('JSON.stringify(window.__worldgen.log.slice(-1)[0])')); if (l && !l.quick && (await ev('window.__worldgen.log.length')) > log0) break; await sleep(50); }
  const lg = JSON.parse(await ev(`JSON.stringify(window.__worldgen.log.slice(${log0}))`));
  out.stroke = { meshes: lg.map(m => ({ N: m.N, quick: m.quick, tMs: +(m.at - t0).toFixed(0), afterReleaseMs: +(m.at - tUp).toFixed(0) })), strokeMs: +(tUp - t0).toFixed(0) };
  out.checks.coarseDuringStroke = lg.some(m => m.quick && m.at < tUp);
  out.checks.fullAfterRelease = lg.length > 0 && !lg[lg.length - 1].quick;
  await sleep(1200); await shot(D + 'sculpt-after.png');
  out.sculptPoints = await ev(`(()=>{const g=window.__worldgen; return 0})()`);
  // undo, then redo the stroke's effect is gone: the planet is the unsculpted one
  out.checks.undoEnabled = await ev(`![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Undo').disabled`);
  const nUndo0 = await ev('window.__worldgen.log.length');
  await click('Undo'); for (let i = 0; i < 100 && (await ev('window.__worldgen.log.length')) === nUndo0; i++) await sleep(50);
  await sleep(1200); await shot(D + 'sculpt-undone.png');
  out.checks.undoDisabledAfter = await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Undo').disabled`);
  // paint again and create the world
  await mouse('mouseMoved', 800, 300); await mouse('mousePressed', 800, 300, { buttons: 1 }); for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', 800 + i * 5, 300 + i * 3, { buttons: 1 }); await sleep(20); } await mouse('mouseReleased', 850, 330);
  await sleep(3000);
  out.status = await text();
  out.checks.createEnabled = await ev(`![...document.querySelectorAll('button')].find(b=>/Create and fly/.test(b.textContent)).disabled`);
  await click('Create and fly'); await sleep(3000);
  const w = JSON.parse(await ev(`JSON.stringify(JSON.parse(localStorage.getItem('scrypture:state')).worlds.list.at(-1))`));
  out.world = { size: w.size, seed: w.seed, sculptPairs: (w.gen?.sculpt?.length ?? 0) / 2, bytes: JSON.stringify(w.gen ?? {}).length, hash: await ev('location.hash') };
  out.checks.savedSculpt = out.world.sculptPairs > 0;
  await sleep(6000); await shot(D + 'sculpt-world.png');
  writeFileSync(D + 'm5-measure.json', JSON.stringify(out, null, 1));
  return out;
};
