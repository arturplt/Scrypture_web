// Steps for scripts/planet-check.mjs (PLANET_URL not needed; it opens the game, not planet.html): the near-chunk view test must not change a frame.
// It starts a Hills world, pauses the sim ('p'), then takes the same frame with the test on, off and on again. The water and the clouds still move with the clock,
// so "on" against "on again" is the noise floor: "on" against "off" must not be worse. Writes the three shots and a diff image to bench-results/nearcull/.
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
const D = new URL('../bench-results/nearcull/', import.meta.url).pathname;
export default async ({ ev, shot, sleep, nav, ORIGIN, renderer }) => {
  mkdirSync(D, { recursive: true });
  await nav(ORIGIN + '/'); await ev(`localStorage.setItem('scrypture:state', JSON.stringify({version:1,user:{name:'Pilot',onboarded:true,tutorialSeen:true}}))`);
  await nav('about:blank'); await nav(`${ORIGIN}/?perf#/games/paperplane`);
  const click = re => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>${re}.test((b.getAttribute('aria-label')||b.textContent||'').trim())&&!b.disabled);if(b)b.click();return !!b})()`);
  let started = false; for (let i = 0; i < 40 && !started; i++) { await click('/hills/i'); await sleep(400); started = await click('/create and fly/i'); await sleep(600); }
  for (let i = 0; i < 120 && !(await ev('!!window.__wgl')); i++) await sleep(500);
  await sleep(9000);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p'}))`); await sleep(1500);
  const take = async (on, file) => { await ev(`__wgl.nearCull=${on}`); await sleep(900); await shot(D + file); return await ev('JSON.stringify({d:__wgl.nearDrawn,c:__wgl.nearCulled})'); };
  const a = await take(true, 'on.png'), b = await take(false, 'off.png'), c = await take(true, 'on2.png');
  const raw = async f => (await sharp(D + f).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  const A = await raw('on.png'), B = await raw('off.png'), C = await raw('on2.png');
  const diff = (X, Y) => { let n = 0, big = 0; const out = Buffer.alloc(X.data.length); for (let i = 0; i < X.data.length; i += 3) { const d = Math.max(Math.abs(X.data[i] - Y.data[i]), Math.abs(X.data[i + 1] - Y.data[i + 1]), Math.abs(X.data[i + 2] - Y.data[i + 2])); if (d > 0) n++; if (d > 24) { big++; out[i] = 255; } } return { differing: n, bigDiffs: big, of: X.data.length / 3, out }; };
  const ab = diff(A, B), ac = diff(A, C);
  await sharp(ab.out, { raw: { width: A.info.width, height: A.info.height, channels: 3 } }).png().toFile(D + 'diff-on-off.png');
  return { renderer, near: { on: JSON.parse(a), off: JSON.parse(b) }, onVsOff: { differing: ab.differing, over24: ab.bigDiffs }, onVsOnAgain: { differing: ac.differing, over24: ac.bigDiffs }, pixels: ab.of };
};
