// Steps for scripts/planet-check.mjs: the milestone 4 gate on the real generator screen (every control, drag latency, Create and fly).
import { writeFileSync } from 'node:fs';
const D = new URL('../bench-results/planet/', import.meta.url).pathname;
export default async ({ ev, shot, sleep, nav, ORIGIN, renderer }) => {
  const out = { renderer, checks: {} };
  await nav(ORIGIN + '/'); await ev(`localStorage.setItem('scrypture:state', JSON.stringify({version:1,user:{name:'Pilot',onboarded:true,tutorialSeen:true}}))`);
  await nav('about:blank'); await nav(`${ORIGIN}/?perf#/games/paperplane/generate`);
  for (let i = 0; i < 100 && !(await ev('!!(window.__worldgen && window.__worldgen.log.length)')); i++) await sleep(300);
  out.checks.firstMesh = await ev('window.__worldgen.log.length') >= 1;
  const text = () => ev(`document.querySelector('.wg-status').innerText`);
  await sleep(1500); out.status0 = await text(); await shot(D + 'gen-screen.png');
  // set a slider the way a user does (the range input's own value setter, then an input event)
  const setRange = (label, v, drag = false) => ev(`(()=>{const i=[...document.querySelectorAll('input[type=range]')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)});if(!i)return false;
    if(${drag}) i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,capture:true}));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${v});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const meshes = () => ev('window.__worldgen.log.length'), last = () => ev('JSON.stringify(window.__worldgen.log.at(-1))').then(JSON.parse);
  // every control moves the preview
  const rows = {};
  for (const [label, v] of [['Sea level', 0.3], ['Continents', 2], ['Mountains', 1.5], ['Peak height', 1.4], ['Hills', 1.3], ['Moisture', 0.25], ['Cold: bare tops from lower down', 12]]) {
    const n0 = await meshes(); const t0 = Date.now();
    out.checks['set ' + label] = await setRange(label, v);
    for (let i = 0; i < 100 && (await meshes()) === n0; i++) await sleep(50);
    rows[label] = { ms: Date.now() - t0, got: (await meshes()) > n0 };
  }
  out.controls = rows;
  await shot(D + 'gen-screen-changed.png');
  // view settings: detail 128 and thicker terraces
  const nOpen = await ev(`(()=>{const d=[...document.querySelectorAll('details.wg-sec')].find(d=>/View/.test(d.innerText));d.open=true;return !!d})()`);
  out.checks.viewOpen = nOpen;
  const n1 = await meshes(); await ev(`(()=>{const b=[...document.querySelectorAll('button.seg')].find(b=>b.textContent==='128');b.click()})()`);
  for (let i = 0; i < 300 && (await meshes()) === n1; i++) await sleep(100);
  out.detail128 = await last();
  await ev(`(()=>{const b=[...document.querySelectorAll('button.seg')].find(b=>b.textContent==='64');b.click()})()`); await sleep(1500);
  // dragging: 60 input events 10 ms apart, then release: the coarse mesh while it moves, the chosen detail after
  const nBefore = await meshes(); const tStart = Date.now();
  await ev(`(async()=>{const i=[...document.querySelectorAll('input[type=range]')].find(x=>x.getAttribute('aria-label')==='Hills');i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,capture:true}));
    for(let k=0;k<60;k++){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,0.3+k/40);i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,10));}
    window.__dragEnd=performance.now();window.dispatchEvent(new PointerEvent('pointerup'));})()`);
  for (let i = 0; i < 200; i++) { const l = await last(); if (l && l.N === 64 && !l.quick && (await meshes()) > nBefore) break; await sleep(50); }
  const lg = JSON.parse(await ev('JSON.stringify(window.__worldgen.log.slice(' + nBefore + '))')), dragEnd = await ev('window.__dragEnd');
  out.drag = { meshesDuringAndAfter: lg.map(m => ({ N: m.N, quick: m.quick, afterReleaseMs: +(m.at - dragEnd).toFixed(0) })), totalMs: Date.now() - tStart };
  // an over-budget mesh is refused with a warning and the last mesh stays
  await setRange('Terrace thickness', 1); await sleep(1500); const nB = await meshes(); await setRange('Mountains', 2); await setRange('Peak height', 2); await setRange('Hills', 2); await sleep(5000);
  out.overBudgetWarned = /budget/.test(await text()); out.checks.overBudgetKeepsMesh = (await meshes()) === nB || out.overBudgetWarned;
  await shot(D + 'gen-over-budget.png');
  await setRange('Mountains', 1.5); await setRange('Peak height', 1.4); await setRange('Hills', 1.3); await sleep(3000);
  // Create and fly
  const gen = await ev(`document.querySelector('.wg-status').innerText`); out.statusEnd = gen;
  await sleep(800);
  const disabled = await ev(`[...document.querySelectorAll('button')].find(b=>/Create and fly/.test(b.textContent)).disabled`);
  out.checks.createEnabled = disabled === false;
  await ev(`[...document.querySelectorAll('button')].find(b=>/Create and fly/.test(b.textContent)).click()`);
  await sleep(2500);
  out.hash = await ev('location.hash');
  const w = JSON.parse(await ev(`JSON.stringify(JSON.parse(localStorage.getItem('scrypture:state')).worlds.list.at(-1))`));
  out.world = { kind: w.kind, size: w.size, seed: w.seed, gen: w.gen, plane: w.plane };
  out.checks.savedWithSettings = !!w.gen && w.gen.sea === 0.3 && w.gen.mountains === 1.5 && w.gen.cold === 12;
  out.checks.opensTheWorld = /\/games\/paperplane\/play\//.test(out.hash);
  await sleep(6000); await shot(D + 'gen-created-world.png');
  out.canvasInGame = await ev(`!!document.querySelector('canvas')`);
  writeFileSync(D + 'm4-measure.json', JSON.stringify(out, null, 1));
  return out;
};
