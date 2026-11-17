import { useLayoutEffect, useRef, type CSSProperties } from 'react';

/** "Glow & sparkles" completion effect: shared pieces for the task and habit screens (the playground is /anim in dev). */
export type FxKind = 'task' | 'habit' | 'event';
/** Burst colours [main, light]: tasks gold, habits cyan, planner activities violet. */
const FX_COLORS: Record<FxKind, [string, string]> = { task: ['#ffd700', '#fff3b0'], habit: ['#3fd8ff', '#d2f6ff'], event: ['#b48cff', '#ecdcff'] };
/** How long the finished card takes to fling away, ms (matches `fx-exit` in app.css). */
export const EXIT_MS = 550;

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Delay before the card leaves, so the stars get to twinkle first (grows a little with their number). */
export const exitDelay = (stars: number) => 900 + Math.min(600, stars * 8);
/** Total time from the tick to the card being gone. */
export const fxDuration = (stars: number) => exitDelay(stars) + EXIT_MS;

/** CSS variables the effect styles read, set on the card. */
export const fxVars = (kind: FxKind, stars: number): CSSProperties => {
  const [main, light] = FX_COLORS[kind];
  return { '--fx-main': main, '--fx-light': light, '--fx-gl': 2 + stars / 20, '--fx-ex': `${exitDelay(stars)}ms` } as CSSProperties;
};

/** Stars scattered on a widening spiral around the tick, in interface units; deterministic so repeats look alike. */
function starsFor(n: number) {
  const R = 35 + Math.sqrt(n) * 7, base = n > 50 ? 0.75 : 1;
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996, r = 9 + Math.sqrt((i + 1) / n) * R;
    return { x: Math.round(Math.cos(a) * r * 1.5), y: Math.round(Math.sin(a) * r * 0.75), d: Math.round((i / n) * 650), z: base * (i % 7 === 0 ? 1.5 : i % 3 === 0 ? 1.2 : 1) };
  });
}

/** One four-point star per point of XP, bursting out of the element it is placed in (which must be position: relative). */
export function Sparkles({ count }: { count: number }) {
  return <>{starsFor(Math.max(1, Math.round(count))).map((p, i) =>
    <i key={i} className="fx-spark" aria-hidden style={{ '--x': p.x, '--y': p.y, '--d': `${p.d}ms`, '--z': p.z } as CSSProperties} />)}</>;
}

/**
 * Makes the cards that take a removed card's place glide up with a little overshoot (FLIP; one axis at a time, never diagonal). Put `ref` on the container,
 * mark cards with `data-flip="<id>"`, and call `mark(skipId)` right before the change that removes a card.
 */
export function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const cards = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? []);
  const mark = (skipId?: string) => {
    before.current = new Map(cards().filter(el => el.dataset.flip !== skipId).map(el => [el.dataset.flip!, el.getBoundingClientRect()]));
  };
  useLayoutEffect(() => {
    const prev = before.current;
    if (!prev) return;
    before.current = null;
    if (prefersReducedMotion()) return;
    for (const el of cards()) {
      const old = prev.get(el.dataset.flip!);
      if (!old) continue;
      const now = el.getBoundingClientRect(), dx = Math.round(old.left - now.left), dy = Math.round(old.top - now.top);
      if (!dx && !dy) continue;
      // Pixel art never moves diagonally and stays on whole pixels: sideways first, then up/down, each leg settling with the overshoot.
      const ease = 'cubic-bezier(.34, 1.56, .64, 1)';
      const frames: Keyframe[] = dx && dy
        ? [{ transform: `translate(${dx}px, ${dy}px)`, easing: ease }, { transform: `translate(0px, ${dy}px)`, offset: 0.4, easing: ease }, { transform: 'none' }]
        : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }];
      el.animate(frames, { duration: dx && dy ? 900 : 650, easing: dx && dy ? 'linear' : ease });
    }
  });
  return { ref, mark };
}
