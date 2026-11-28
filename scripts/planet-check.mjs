#!/usr/bin/env node
/**
 * Headless Chromium over CDP for the world generator's preview page (planet.html), in the pattern of bench-perf.mjs: starts the Vite dev server (unless PLANET_URL is given), opens Chromium with
 * the real-GPU flags (PLANET_GPU=swiftshader for software GL), and runs the steps module given as the first argument:
 *
 *   node scripts/planet-check.mjs path/to/steps.mjs
 *
 * The module's default export is `async ({ go, ev, shot, sleep, renderer, W, H }) => result`: `go(query)` opens /planet.html?query and waits for the first mesh, `ev(js)` evaluates in the page
 * (awaiting promises), `shot(file)` writes a PNG, `nav(url)` opens any URL (the game itself: ORIGIN + '/#/...'). The GL renderer string is printed first: say which GPU every number came from (never assume acceleration).
 *   PLANET_SIZE=1280x720  PLANET_URL=http://localhost:5198  CHROME=/path/to/chrome
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (typeof WebSocket === 'undefined') { const r = spawnSync(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' }); process.exit(r.status ?? 1); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [W, H] = (process.env.PLANET_SIZE ?? '1280x720').split('x').map(Number), SOFT = process.env.PLANET_GPU === 'swiftshader', PORT = 5198, ORIGIN = process.env.PLANET_URL ?? `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = []; let profile = null;
const cleanup = () => { for (const p of procs) try { p.kill('SIGKILL'); } catch { /* gone */ } if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* tmp */ } };
process.on('exit', cleanup);
const fail = m => { console.error('\n✗ ' + m); process.exit(1); };
async function waitHttp(url, ms) { const t0 = Date.now(); for (;;) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } if (Date.now() - t0 > ms) fail(`${url} did not answer`); await sleep(300); } }
function cdp(ws0) {
  const ws = new WebSocket(ws0), waiting = new Map(); let next = 1;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { ok, ko } = waiting.get(m.id); waiting.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); } };
  return { open: new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('DevTools connection failed')); }),
    send: (method, params = {}) => new Promise((ok, ko) => { const id = next++; waiting.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); }) };
}
const stepsPath = process.argv[2]; if (!stepsPath) fail('usage: node scripts/planet-check.mjs steps.mjs');
if (!process.env.PLANET_URL) procs.push(spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
await waitHttp(ORIGIN + '/planet.html', 60000);
let chrome = process.env.CHROME; if (!chrome) for (const c of ['chromium', 'chromium-browser', 'google-chrome']) { const r = spawnSync('which', [c], { encoding: 'utf8' }); if (r.status === 0) { chrome = r.stdout.trim(); break; } }
if (!chrome) fail('No Chromium found: set CHROME=');
profile = mkdtempSync(join(tmpdir(), 'planet-check-'));
const gpu = SOFT ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-gl=angle', '--use-angle=gl', '--enable-webgl-draft-extensions'];
procs.push(spawn(chrome, ['--headless=new', '--no-sandbox', `--user-data-dir=${profile}`, '--remote-debugging-port=9345', `--window-size=${W},${H}`, '--ignore-gpu-blocklist', ...gpu, 'about:blank'], { stdio: 'ignore' }));
await waitHttp('http://127.0.0.1:9345/json/version', 20000);
const tab = (await (await fetch('http://127.0.0.1:9345/json')).json()).find(t => t.type === 'page');
const c = cdp(tab.webSocketDebuggerUrl); await c.open;
await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const ev = async expr => { const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const go = async (query = '', timeout = 120000) => {
  await c.send('Page.navigate', { url: `${ORIGIN}/planet.html?${query}` });
  const t0 = Date.now(); for (;;) { await sleep(300); try { if (await ev('!!(window.__planet && window.__planet.ready)')) break; } catch { /* loading */ } if (Date.now() - t0 > timeout) fail('the planet did not appear: ' + query); }
};
const shot = async file => { const { data } = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(data, 'base64')); };
await c.send('Page.navigate', { url: ORIGIN + '/planet.html' }); await sleep(1500);
const renderer = await ev(`(()=>{const g=document.createElement('canvas').getContext('webgl2');if(!g)return 'NO WEBGL2';const e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)})()`);
console.log(`renderer: ${renderer}  (${W}x${H}, ${SOFT ? 'software GL requested' : 'real GPU flags'})`);
const mouse = (type, x, y, extra = {}) => c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left', buttons: extra.buttons ?? 0, clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0, ...extra });
const nav = async url => { await c.send('Page.navigate', { url }); await sleep(2500); };
const mod = await import(pathToFileURL(resolve(stepsPath)).href);
const res = await mod.default({ go, ev, shot, sleep, renderer, W, H, nav, ORIGIN, mouse });
if (res !== undefined) console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
process.exit(0);
