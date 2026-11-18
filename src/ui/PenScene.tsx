import { useEffect, useRef } from 'react';
import { penView } from './penView';
import mountainsUrl from '../assets/mountainrange.png';
import treesUrl from '../assets/treeline.png';

/**
 * The scenery behind Bóbr in his pen, from the same pictures as the world view's skybox: clouds, mountains and the tree line, each a strip
 * that slides past at its own speed (far = slow), so Bóbr, standing in the middle, looks to be walking. A strip is the picture and its
 * mirror image, three times over, slid by exactly one pair: the loop has no seam, whatever the picture's edges look like.
 * The strips are moved by Bóbr's walking (`penView.pos`, set by BobrPen each frame): standing still, nothing moves. `far` is how much of the
 * ground's speed a strip keeps (the ground and the items on it are 1).
 */
// `wind`: how fast a strip drifts on its own, in pixels a second, whether he walks or not (the clouds)
const LAYERS = [
  { src: '/assets/Clouds/pixelite-543x181-Cirrus3.png', cls: 'scene-cirrus', far: 0.01, wind: 3 },
  { src: '/assets/Clouds/pixelite-543x181-Stratocumulus2.png', cls: 'scene-strato', far: 0.025, wind: 6 },
  { src: '/assets/Clouds/pixelite-543x181-Cumulus1.png', cls: 'scene-clouds', far: 0.04, wind: 10 },
  { src: mountainsUrl, cls: 'scene-mountains', far: 0.2, wind: 0 },
  { src: treesUrl, cls: 'scene-trees', far: 0.5, wind: 0 },
  { src: '/assets/raw/meadow.png', cls: 'scene-meadow', far: 1, wind: 0 },   // the ground itself, in front of the tree line: it moves at Bóbr's own speed
];

/** Things that float about: pollen rises and wanders, leaves tumble down. Laid out once; each moves by its own CSS animation. */
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const POLLEN = Array.from({ length: 14 }, (_, i) => ({ left: rnd(i, 1) * 100, bottom: rnd(i, 2) * 40, dur: 9 + rnd(i, 3) * 8, delay: -rnd(i, 4) * 17, sway: 10 + rnd(i, 5) * 22, size: 6 + rnd(i, 11) * 5 }));
const LEAVES = Array.from({ length: 7 }, (_, i) => ({ left: rnd(i, 6) * 100, dur: 11 + rnd(i, 7) * 9, delay: -rnd(i, 8) * 20, sway: 20 + rnd(i, 9) * 40, src: i % 3 === 2 ? 'leaf_maple' : 'leaf', size: 10 + rnd(i, 10) * 6 }));

export function PenScene() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const secs = (now - t0) / 1000;
      root.current?.querySelectorAll<HTMLElement>('.scene-track').forEach((t, i) => {
        const period = t.scrollWidth / 3;   // one picture-and-mirror pair
        if (period > 0) t.style.transform = `translateX(${-(((penView.pos * penView.width * LAYERS[i].far + secs * LAYERS[i].wind) % period) + period) % period}px)`;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="scene" ref={root} aria-hidden>
      {LAYERS.map(l => (
        <div key={l.cls} className={`scene-layer ${l.cls}`}>
          <div className="scene-track">
            {[0, 1, 2, 3, 4, 5].map(i => <img key={i} className="pixel" src={l.src} alt="" draggable={false} data-flip={i % 2 ? '' : undefined} />)}
          </div>
        </div>
      ))}
      <div className="scene-ground" />
      <div className="scene-fx">
        {POLLEN.map((p, i) => <img key={`p${i}`} className="pollen pixel" src="/assets/items/pollen.png" alt="" style={{ left: `${p.left}%`, bottom: `${p.bottom}%`, width: `calc(${p.size} * var(--u))`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, ['--sway' as string]: `${p.sway}` }} />)}
        {LEAVES.map((l, i) => <img key={`l${i}`} className="leaf pixel" src={`/assets/items/${l.src}.png`} alt="" style={{ left: `${l.left}%`, width: `calc(${l.size} * var(--u))`, animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s`, ['--sway' as string]: `${l.sway}` }} />)}
      </div>
    </div>
  );
}
