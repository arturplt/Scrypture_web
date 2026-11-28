#!/usr/bin/env node
/**
 * Phase 0 benchmark of the 3D view (SCRYPTURE_TERRAIN_OPTIMISATION_ROADMAP.md): opens Paperplane with `?perf` in headless Chromium, starts a Hills world, lets the plane
 * cruise for BENCH_SECS and writes the page's `window.__perfLog` (one row per 2 s: frame p50/p95/p99, draws, triangles, passes, upload bytes, GPU ms, worker latency...)
 * plus the GL renderer string to JSON. It starts the Vite dev server itself unless BENCH_URL is given.
 *
 *   node scripts/bench-perf.mjs                       real GPU if headless Chromium can use it (the renderer string in the output says which)
 *   BENCH_GPU=swiftshader node scripts/bench-perf.mjs software GL (slow, but works anywhere: GPU timer usually unavailable)
 *   BENCH_SECS=60 BENCH_SIZE=1280x720 BENCH_OUT=bench-results/run.json BENCH_URL=http://localhost:5197 CHROME=/path/to/chrome
 *   BENCH_FLAGS=nolayer,nostipple    adds ?dbg= switches for A/B runs
 *   BENCH_EVAL='<js>'                runs JS in the page 3 s after the world starts (e.g. wrap `__wgl.drawFar` to skip a pass)
 *   BENCH_READ='<js>'                prints the value of this expression at the end
 *   BENCH_QUERY='faceup=1&x=y'       more address parameters
 *   BENCH_SHOT=file.png              saves a screenshot at the end
 *   BENCH_WORLD=real                 the terraced Lake District (real map, endless: all far rings) instead of the Hills planet
 *   BENCH_LABEL=name                 stored in the JSON's meta
 * The world is a fresh random Hills world each run (the plane's route is the sim's own cruise), so compare runs by scenario and repeat them; see BENCHMARKS.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof WebSocket === 'undefined') { const r = spawnSync(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' }); process.exit(r.status ?? 1); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECS = +(process.env.BENCH_SECS ?? 30), [W, H] = (process.env.BENCH_SIZE ?? '1280x720').split('x').map(Number), SOFT = process.env.BENCH_GPU === 'swiftshader';
const PORT = 5197, ORIGIN = process.env.BENCH_URL ?? `http://localhost:${PORT}`, DBG = (process.env.BENCH_FLAGS ? `&dbg=${process.env.BENCH_FLAGS}` : '') + (process.env.BENCH_QUERY ? `&${process.env.BENCH_QUERY}` : '');
const OUT = process.env.BENCH_OUT ?? join(ROOT, 'bench-results', `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = []; let profile = null;
const cleanup = () => { for (const p of procs) try { p.kill('SIGKILL'); } catch { /* gone */ } if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* tmp */ } };
process.on('exit', cleanup);
const fail = m => { console.error('\n✗ ' + m); process.exit(1); };
async function waitHttp(url, ms) { const t0 = Date.now(); for (;;) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } if (Date.now() - t0 > ms) fail(`${url} did not answer`); await sleep(250); } }
function cdp(ws0) {
  const ws = new WebSocket(ws0), waiting = new Map(); let next = 1;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { ok, ko } = waiting.get(m.id); waiting.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); } };
  return { open: new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('DevTools connection failed')); }),
    send: (method, params = {}) => new Promise((ok, ko) => { const id = next++; waiting.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); }) };
}

if (!process.env.BENCH_URL) { procs.push(spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })); }
await waitHttp(ORIGIN + '/', 60000);
let chrome = process.env.CHROME; if (!chrome) for (const c of ['chromium', 'chromium-browser', 'google-chrome']) { const r = spawnSync('which', [c], { encoding: 'utf8' }); if (r.status === 0) { chrome = r.stdout.trim(); break; } }
if (!chrome) fail('No Chromium found: set CHROME=');
profile = mkdtempSync(join(tmpdir(), 'bench-perf-'));
const gpuFlags = SOFT ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-gl=angle', '--use-angle=gl', '--enable-webgl-draft-extensions'];
procs.push(spawn(chrome, ['--headless=new', '--no-sandbox', `--user-data-dir=${profile}`, '--remote-debugging-port=9344', `--window-size=${W},${H}`, '--ignore-gpu-blocklist', ...gpuFlags, 'about:blank'], { stdio: 'ignore' }));
await waitHttp('http://127.0.0.1:9344/json/version', 20000);
const tab = (await (await fetch('http://127.0.0.1:9344/json')).json()).find(t => t.type === 'page');
const c = cdp(tab.webSocketDebuggerUrl); await c.open;
await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const ev = async expr => { const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page error'); return r.result.value; };
const go = async url => { await c.send('Page.navigate', { url }); await sleep(2500); };

await go(ORIGIN + '/');
await ev(`localStorage.setItem('scrypture:state', JSON.stringify({version:1,user:{name:'Pilot',onboarded:true,tutorialSeen:true}}))`);
await go('about:blank'); await go(`${ORIGIN}/?perf${DBG}#/games/paperplane`);
const clickBtn = re => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>${re}.test((b.getAttribute('aria-label')||b.textContent||'').trim())&&!b.disabled);if(b)b.click();return !!b})()`);
let started = false;
const REAL = process.env.BENCH_WORLD === 'real';   // BENCH_WORLD=real: the Lake District cut into terraces (an endless world with all six far rings, no cube planet)
const tickTerraced = () => ev(`(()=>{const e=[...document.querySelectorAll('label,button,[role=checkbox],div,span')].filter(n=>/Terraced: cut into layers/.test(n.textContent||'')&&n.children.length<4).pop();if(e){e.click();return true}return false})()`);
for (let i = 0; i < 40 && !started; i++) { if (REAL) { await clickBtn('/^Lake District$/'); await sleep(400); await tickTerraced(); } else await clickBtn('/hills/i'); await sleep(400); started = await clickBtn('/create and fly/i'); await sleep(600); }
if (!started) fail('could not start a Hills world (the menu labels may have changed)');
if (process.env.BENCH_WORLD === 'endless') {   // an older Hills world without a planet size (endless: all six far rings): make a Hills world, strip its size from the save, reopen it
  await sleep(4000); await go(ORIGIN + '/assets/raw/airplane.png');   // (leaving the app flushes the save)
  const id = await ev(`(()=>{const s=JSON.parse(localStorage.getItem('scrypture:state'));const w=s.worlds.list[0];delete w.size;localStorage.setItem('scrypture:state',JSON.stringify(s));return w.id})()`);
  await go(`${ORIGIN}/?perf${DBG}#/games/paperplane/play/${id}`); await sleep(1500);
  await go('about:blank'); await go(`${ORIGIN}/?perf${DBG}#/games/paperplane/play/${id}`);
}
if (process.env.BENCH_EVAL) { for (let i = 0; i < 120 && !(await ev('!!window.__wgl')); i++) await sleep(500); await sleep(3000); await ev(process.env.BENCH_EVAL); }   // (experiments: JS run in the page once the world is up; dev server only, `__wgl` is the renderer)
console.log(`flying: ${SECS} s at ${W}x${H} (${SOFT ? 'software GL' : 'real GPU if available'})`);
await sleep(SECS * 1000);
if (process.env.BENCH_SHOT) { const { data } = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(process.env.BENCH_SHOT, Buffer.from(data, 'base64')); }
const out = await ev(`JSON.stringify({ log: window.__perfLog ?? [], txt: window.__perfTxt ?? '', ua: navigator.userAgent, renderer: (()=>{ const c=document.createElement('canvas'), g=c.getContext('webgl2'), e=g&&g.getExtension('WEBGL_debug_renderer_info'); return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'?'; })() })`);
const res = JSON.parse(out);
if (!res.log.length) fail('no ?perf rows came back: the 3D view did not start (is WebGL available?)');
const meta = { when: new Date().toISOString(), secs: SECS, size: `${W}x${H}`, gpu: SOFT ? 'swiftshader' : 'default', dbg: process.env.BENCH_FLAGS ?? '', eval: process.env.BENCH_EVAL ?? '', label: process.env.BENCH_LABEL ?? '', renderer: res.renderer, ua: res.ua };
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ meta, rows: res.log }, null, 1));
const rows = res.log.slice(Math.min(5, res.log.length - 1)), med = f => { const a = rows.map(f).filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; }, f1 = v => v == null ? 'n/a' : v.toFixed(1);
console.log(`renderer ${res.renderer}\n${rows.length} windows: frame p50 ${f1(med(r => r.frame.p50))} p95 ${f1(med(r => r.frame.p95))} p99 ${f1(med(r => r.frame.p99))} ms, draws ${f1(med(r => r.draws))}, tris ${f1(med(r => r.tris))}, gpu ${f1(med(r => r.gpuMs))} ms\n-> ${OUT}`);
if (process.env.BENCH_READ) console.log('BENCH_READ:', await ev(process.env.BENCH_READ));
process.exit(0);
