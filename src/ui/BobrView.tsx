import { useEffect, useState } from 'react';
import { EMOTICONS, type BobrStage, type Emotion } from '../domain';
import { useUi } from './useUi';
import { PixelFrame } from './PixelFrame';

export function Emoticon({ emotion }: { emotion: Emotion }) {
  const { frames, ms } = EMOTICONS[emotion];
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    const t = setInterval(() => setI(n => (n + 1) % frames.length), ms);
    return () => clearInterval(t);
  }, [emotion, frames.length, ms]);
  return (
    <div className="emoticon" aria-label={emotion.toLowerCase()}>
      <PixelFrame theme="app" scale={1} className="emoticon-bg" aria-hidden />
      <span className="emoticon-text">{frames[i % frames.length]}</span>
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
