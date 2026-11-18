/**
 * The pen opens into the world. A copy of the pen's backdrop (nothing else) is revealed from the pen's own rectangle out to the whole screen
 * and magnified (one scale, no squashing) so that its tree line ends up where the world's horizon is and its meadow fills the ground below, using only clip-path and transform (both are drawn by the compositor, so no layout work and no jitter). The route
 * changes only once the screen is fully covered, so the world's own start-up never shows; the world is preloaded while the backdrop opens, and
 * the cover fades once the world has drawn its first frames (`releaseWorldPortal`, called by the world screen; a timeout covers a world that never loads).
 */
let portal: HTMLElement | null = null;
let failsafe = 0;
/** Where the horizon sits on the world's screen (fraction of its height) and the grass colour below it. */
const HORIZON = 0.55, GROUND = '#1c2e0a';
const GROW_MS = 700, FADE_MS = 450, EASE = 'cubic-bezier(.65,0,.35,1)';

export function releaseWorldPortal() {
  const el = portal;
  if (!el) return;
  portal = null;
  clearTimeout(failsafe);
  el.style.transition = `opacity ${FADE_MS}ms ease-in-out`;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), FADE_MS + 50);
}

/** `from`: the pen card. `go` changes the route; `preload` warms what the next screen needs while the backdrop is opening. */
export function flyIntoWorld(from: Element | null, go: () => void, preload?: () => void) {
  const scene = from?.querySelector<HTMLElement>('.scene');
  if (!from || !scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { go(); return; }
  releaseWorldPortal();
  const r = scene.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  const g = parseFloat((from as HTMLElement).style.getPropertyValue('--g')) || 0.69, hz = g - 0.07;   // the pen's own horizon (see Home's CSS): the tree line stands there, the meadow below
  // one scale for both axes (the picture is never squashed), big enough to cover the screen once the horizon is where the world's is
  const s = Math.max(vw / r.width, (HORIZON * vh) / (hz * r.height), ((1 - HORIZON) * vh) / ((1 - hz) * r.height));
  const tx = vw / 2 - r.left - (s * r.width) / 2, ty = HORIZON * vh - r.top - s * hz * r.height;

  const root = document.createElement('div');
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '9999', overflow: 'hidden', background: GROUND, pointerEvents: 'all', clipPath: `inset(${r.top}px ${vw - r.right}px ${vh - r.bottom}px ${r.left}px)`, willChange: 'clip-path, opacity' });
  root.setAttribute('aria-hidden', 'true');
  // a copy of the pen's backdrop (sky, mountains, tree line, meadow; no Bóbr, no drifting leaves) in the same CSS context, so it is laid out exactly as in the pen
  const ctx = document.createElement('div');
  ctx.className = 'dash';
  Object.assign(ctx.style, { position: 'absolute', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block', transformOrigin: '0 0', willChange: 'transform' });
  const shell = document.createElement('div');
  shell.className = 'pen-card';
  Object.assign(shell.style, { position: 'relative', width: '100%', height: '100%', minHeight: '0', overflow: 'hidden' });
  shell.style.setProperty('--g', String(g));
  const copy = scene.cloneNode(true) as HTMLElement;
  copy.querySelector('.scene-fx')?.remove();   // nothing drifts: nothing moves but the opening
  Object.assign(copy.style, { inset: '0' });
  copy.querySelectorAll<HTMLElement>('.scene-track img').forEach(i => { i.style.imageRendering = 'auto'; });   // smooth while it is magnified: nearest-neighbour shimmers at odd scales
  shell.appendChild(copy);
  ctx.appendChild(shell);
  root.appendChild(ctx);
  document.body.appendChild(root);
  portal = root;

  void root.offsetWidth;   // commit the starting frame before the transitions are set
  const t = `${GROW_MS}ms ${EASE}`;
  root.style.transition = `clip-path ${t}`;
  ctx.style.transition = `transform ${t}`;
  root.style.clipPath = 'inset(0px 0px 0px 0px)';
  ctx.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  preload?.();
  setTimeout(go, GROW_MS + 30);   // fully covered: now the world can start under it
  failsafe = window.setTimeout(releaseWorldPortal, GROW_MS + 8000);
}
