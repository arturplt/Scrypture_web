#!/usr/bin/env node
/**
 * End-to-end flow test: a new user's first minutes in a real browser, on the built app. It serves `dist` with `vite preview` (run `npm run build` first), or tests
 * E2E_URL when that is set, starts headless Chromium with a fresh profile and drives it over the DevTools protocol (no test library: Node's own WebSocket).
 *
 * The flow: onboarding, add a task and tick it (XP paid), add a habit, ask Bóbr in the chat, export the data, change something, import the export back
 * (the change is gone), reload (everything is still there). Any error thrown in the page fails the run.
 *
 *   npm run build && npm run e2e
 *   E2E_URL=http://192.168.1.10:5173 npm run e2e        (another server, e.g. the LAN address of the dev server)
 *   CHROME=/path/to/chrome npm run e2e                     (when Chromium is not on the PATH)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 20 has WebSocket behind a flag (22 has it built in): run again with it
if (typeof WebSocket === 'undefined') {
  const r = spawnSync(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179, URL_ = process.env.E2E_URL ?? `http://localhost:${PORT}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
let profile = null;
function cleanup() { for (const p of procs) try { p.kill('SIGKILL'); } catch { /* gone */ } if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* left in tmp */ } }
process.on('exit', cleanup);
const fail = msg => { console.error(`\n✗ ${msg}`); process.exit(1); };

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const c of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const r = spawnSync('which', [c], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  fail('No Chromium or Chrome found: set CHROME=/path/to/browser');
}

async function waitHttp(url, ms) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) fail(`${url} did not answer within ${ms / 1000} s`);
    await sleep(250);
  }
}

/** A DevTools protocol session on one page: send() returns the result; events go to the listeners. */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl), waiting = new Map(), on = new Map();
  let next = 1;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const { ok, ko } = waiting.get(m.id); waiting.delete(m.id); if (m.error) ko(new Error(m.error.message)); else ok(m.result); }
    else if (m.method) for (const f of on.get(m.method) ?? []) f(m.params);
  };
  return {
    open: new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('DevTools connection failed')); }),
    send: (method, params = {}) => new Promise((ok, ko) => { const id = next++; waiting.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); }),
    on: (method, f) => on.set(method, [...(on.get(method) ?? []), f]),
    close: () => ws.close(),
  };
}

// ---- helpers that run inside the page (added in front of every step, since a reload loses them) ----
const PAGE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const label = b => (b.getAttribute('aria-label') || b.textContent || '').trim();
const btn = (re, root = document) => [...root.querySelectorAll('button')].find(b => re.test(label(b)) && !b.disabled);
const click = (re, root) => { const b = btn(re, root); if (!b) throw new Error('no button ' + re); b.click(); };
const type = (el, v) => { let p = Object.getPrototypeOf(el), d; while (p && !(d = Object.getOwnPropertyDescriptor(p, 'value'))) p = Object.getPrototypeOf(p); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
const st = () => JSON.parse(localStorage.getItem('scrypture:state') || '{}');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const waitFor = async (f, what, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(100); } };
const go = async hash => { location.hash = hash; await sleep(400); await dismiss(); };
/** level-up, achievement and tutorial pop-ups that sit over the page */
const dismiss = async () => { for (let i = 0; i < 4; i++) { const b = btn(/^(Awesome!|Got it!|OK!?|Close)$/); if (!b || !b.closest('[role=dialog], .modal, .event-dialog')) return; b.click(); await sleep(250); } };
const dialog = () => waitFor(() => document.querySelector('[role=dialog] input') && document.querySelector('[role=dialog]'), 'a dialog');
const submit = d => { const b = [...d.querySelectorAll('button')].find(x => x.type === 'submit'); if (!b) throw new Error('no submit button'); b.click(); };
`;

const STEPS = [
  ['onboarding', `
    await waitFor(() => btn(/^Next$/), 'the onboarding');
    for (let i = 0; i < 40 && !st().user?.onboarded; i++) {
      for (const inp of document.querySelectorAll('main input')) if (!inp.value && inp.type !== 'checkbox') type(inp, 'Tester');
      const b = btn(/^(Next|Begin)$/); if (b) b.click();
      await sleep(300);
    }
    assert(st().user?.onboarded, 'onboarding did not finish');
    assert(st().user.name === 'Tester', 'the name was not kept: ' + st().user.name);
    await sleep(800);
    assert(!/Something broke/.test(document.body.innerText), 'the app crashed after onboarding');
    assert(document.querySelector('nav'), 'no navigation after onboarding');`],
  ['add a task', `
    await go('#/tasks');
    click(/New$/, document.querySelector('main'));
    const d = await dialog(); type(d.querySelector('input'), 'Water the plants'); submit(d);
    await waitFor(() => st().tasks?.some(t => t.title === 'Water the plants'), 'the task to be saved');
    await waitFor(() => [...document.querySelectorAll('main button')].some(b => label(b) === 'Water the plants'), 'the task on the list');`],
  ['tick the task', `
    await dismiss();
    const box = document.querySelector('main input[type=checkbox][aria-label*="Water the plants"]');
    assert(box, 'no tick box for the task'); box.click();
    await waitFor(() => st().tasks.find(t => t.title === 'Water the plants')?.completed, 'the task to be completed');
    assert(st().stats.totalExperiencePoints > 0, 'no XP paid');
    assert(st().stats.totalTasksCompleted === 1, 'tasks completed: ' + st().stats.totalTasksCompleted);`],
  ['add a habit', `
    await go('#/habits');
    click(/New$/, document.querySelector('main'));
    const d = await dialog(); type(d.querySelector('input'), 'Stretch'); submit(d);
    await waitFor(() => st().habits?.some(h => h.title === 'Stretch'), 'the habit to be saved');`],
  ['chat with Bóbr', `
    await go('#/chat');
    const said = () => [...document.querySelectorAll('main .msg.bobr')];
    await waitFor(() => said().length, 'the greeting');
    const before = said().length;
    click(/^My Stats$/);
    const reply = await waitFor(() => said().length > before && said()[said().length - 1].textContent, 'Bóbr to answer');
    assert(/1/.test(reply), 'the stats reply does not show the completed task: ' + reply.slice(0, 120));`],
  ['export', `
    await go('#/settings');
    window.__exported = null;
    const make = URL.createObjectURL; URL.createObjectURL = blob => { blob.text().then(t => { window.__exported = t; }); return make.call(URL, blob); };
    click(/^Export$/);
    const text = await waitFor(() => window.__exported, 'the export file');
    URL.createObjectURL = make;
    const data = JSON.parse(text);
    assert(data.app === 'scrypture', 'not a Scrypture export');
    assert(data.tasks.some(t => t.title === 'Water the plants') && data.habits.some(h => h.title === 'Stretch'), 'the export misses the task or habit');`],
  ['change something, then import the export back', `
    await go('#/tasks');
    click(/New$/, document.querySelector('main'));
    const d = await dialog(); type(d.querySelector('input'), 'Only here'); submit(d);
    await waitFor(() => st().tasks.some(t => t.title === 'Only here'), 'the extra task');
    await go('#/settings');
    const input = document.querySelector('main input[type=file]');
    const dt = new DataTransfer(); dt.items.add(new File([window.__exported], 'backup.json', { type: 'application/json' }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => btn(/^Replace$/), 'the import warning');
    click(/^Replace$/);
    await waitFor(() => !st().tasks.some(t => t.title === 'Only here'), 'the import to replace the data');
    assert(st().tasks.some(t => t.title === 'Water the plants' && t.completed), 'the imported task is missing');
    assert(st().habits.some(h => h.title === 'Stretch'), 'the imported habit is missing');`],
  ['reload keeps everything', `
    sessionStorage.setItem('e2e-before', JSON.stringify({ tasks: st().tasks.length, habits: st().habits.length, xp: st().stats.totalExperiencePoints }));
    location.reload();`, { reload: true }],
  ['after the reload', `
    await waitFor(() => document.querySelector('nav'), 'the app after the reload');
    const before = JSON.parse(sessionStorage.getItem('e2e-before'));
    assert(st().tasks.length === before.tasks && st().habits.length === before.habits && st().stats.totalExperiencePoints === before.xp, 'the data changed over a reload');
    assert(!/Something broke/.test(document.body.innerText), 'the app crashed after a reload');`],
];

async function main() {
  if (!process.env.E2E_URL) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('No build in dist/: run `npm run build` first (or set E2E_URL)');
    const srv = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(srv);
    srv.stderr.on('data', d => process.stderr.write(d));
  }
  await waitHttp(URL_, 30000);

  profile = mkdtempSync(join(tmpdir(), 'scrypture-e2e-'));
  const chrome = spawn(findChrome(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1024,768', 'about:blank'], { stdio: 'ignore' });
  procs.push(chrome);
  const portFile = join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) { if (Date.now() - t0 > 20000) fail('Chromium did not start'); await sleep(100); }
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const s = cdp(page.webSocketDebuggerUrl);
  await s.open;

  const errors = [];
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
  s.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push(p.args.map(a => a.value ?? a.description ?? '').join(' ')); });
  await s.send('Runtime.enable'); await s.send('Page.enable');
  let loaded = null; s.on('Page.loadEventFired', () => loaded?.());
  const navigate = async url => { const done = new Promise(r => { loaded = r; }); await s.send('Page.navigate', { url }); await done; };
  await navigate(URL_);

  console.log(`Testing ${URL_}`);
  for (const [name, code, opt] of STEPS) {
    const t = Date.now();
    const done = opt?.reload ? new Promise(r => { loaded = r; }) : null;
    const r = await s.send('Runtime.evaluate', { expression: `(async () => {${PAGE}\n${code}\n})()`, awaitPromise: !opt?.reload, returnByValue: true });
    if (r.exceptionDetails) fail(`${name}: ${r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text}`);
    if (done) await done;
    if (errors.length) fail(`${name}: the page logged an error:\n  ${errors.join('\n  ').slice(0, 2000)}`);
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  }
  s.close();
  console.log('\nAll steps passed.');
  process.exit(0);
}
main().catch(e => fail(e.stack ?? String(e)));
