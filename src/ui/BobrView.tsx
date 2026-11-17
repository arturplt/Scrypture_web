import { useEffect, useState } from 'react';
import { EMOTICONS, flourishFor, type BobrStage, type Emotion } from '../domain';
import { useUi } from './useUi';
import { PixelFrame } from './PixelFrame';

export function Emoticon({ emotion }: { emotion: Emotion }) {
  const { frames, ms } = EMOTICONS[emotion];
  const [i, setI] = useState(0);
  // Now and then, at the end of a round of his frames, he flashes a face from the neighbouring feelings (his repertoire).
  const [flash, setFlash] = useState<{ face: string; fancy: boolean } | null>(null);
  useEffect(() => {
    setI(0); setFlash(null);
    let n = 0;
    const t = setInterval(() => {
      n = (n + 1) % frames.length;
      if (n === 0 && Math.random() < 0.5) { const f = flourishFor(emotion); setFlash({ face: f.face, fancy: !!f.fancy }); }
      else setFlash(null);
      setI(n);
    }, ms);
    return () => clearInterval(t);
  }, [emotion, frames.length, ms]);
  return (
    <div className="emoticon" aria-label={emotion.toLowerCase()}>
      <PixelFrame theme="app" scale={1} className="emoticon-bg" aria-hidden />
      <span className={`emoticon-text${flash?.fancy ? ' fancy-face' : ''}`}>{flash ? flash.face : frames[i % frames.length]}</span>
    </div>
  );
}

const FILE: Record<BobrStage, string> = { HATCHLING: 'bobr_hatchling', YOUNG: 'bobr_young', MATURE: 'bobr_mature' };

export function BobrView({ stage, emotion }: { stage: BobrStage; emotion: Emotion }) {
  const { px } = useUi();
  return (
    <div className="bobr">
      <div className="bobr-top"><Emoticon emotion={emotion} /></div>
      <img className="pixel bobr-img" src={`/assets/raw/${FILE[stage]}.png`} width={px(220)} height={px(220)} alt="Bóbr" />
    </div>
  );
}
