import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { PixelFrame } from '../ui/PixelFrame';
import { Chip, PixelCheckbox } from '../ui/misc';
import { LifeFx } from '../ui/LifeFx';
import { CATEGORY_TINT, difficultyTint } from '../ui/colors';
import { useTintedFrame } from '../ui/tintFrame';
import { useChipVars } from '../ui/chips';
import { useAppState } from '../data/hooks';
import './anim.css';

/** Dev-only (/urgency): five subtle ways to make an urgent card stand out. */
type Level = 'none' | 'soon' | 'overdue';

function Card({ level, variant, title }: { level: Level; variant: string; title: string }) {
  const frame = useTintedFrame('app', CATEGORY_TINT.MIND, CATEGORY_TINT.MIND, { ringMix: [[difficultyTint(3), 0.2]], centreMix: [[difficultyTint(3), 0.2]] });
  const urgent = level !== 'none';
  return (
    <PixelFrame theme="app" scale={1} style={(frame ? { '--frame': frame } : {}) as CSSProperties} className={`task ux ${urgent ? `ux-${variant} ux-${level}` : ''}`}>
      {urgent && variant === 'e' && <LifeFx urgency={level as 'soon' | 'overdue'} className="life-corner" />}
      {urgent && variant === 'a' && <span className="ux-gem" aria-hidden><Chip color={level === 'overdue' ? '#ff3b30' : '#ff9800'}>!</Chip></span>}
      <div className="task-head">
        <PixelCheckbox checked={false} onChange={() => {}} label="" />
        <span className="task-title">{title}</span>
      </div>
      <div className="row wrap chips"><Chip color="#b89000">{level === 'overdue' ? 'CRITICAL' : 'HIGH'}</Chip><Chip color={difficultyTint(3)}>D3</Chip><Chip>60m</Chip><Chip color="#b6a432">18 XP</Chip></div>
    </PixelFrame>
  );
}

function Idea({ id, name, blurb }: { id: string; name: string; blurb: ReactNode }) {
  return (
    <PixelFrame theme="wood_gold_gem" scale={1} className="al-demo">
      <h2 className="subtitle">{name}</h2>
      <p className="muted small" style={{ lineHeight: 1.7 }}>{blurb}</p>
      <div className="ux-row">
        <Card level="none" variant={id} title="Write CV" />
        <Card level="soon" variant={id} title="Write CV" />
        <Card level="overdue" variant={id} title="Write CV" />
      </div>
      <div className="ux-labels muted small"><span>normal</span><span>due soon / HIGH</span><span>overdue / CRITICAL</span></div>
    </PixelFrame>
  );
}

export function UrgencyLab() {
  const chips = useAppState(s => s.settings.chips);
  const vars = useChipVars(chips);
  useEffect(() => { const r = document.documentElement; r.style.setProperty('--ui', '2'); r.style.setProperty('--font-scale', '1'); }, []);
  return (
    <main className="al ux-page" style={vars}>
      <h1 className="title">Urgency: 5 subtle ideas</h1>
      <p className="muted small" style={{ lineHeight: 1.7 }}>Each one only touches a small part of the card. Left to right: normal, due soon, overdue.</p>
      <Idea id="a" name="A · Blinking alert gem" blurb="A small “!” tag in the corner blinks in two steps. The card itself is untouched. The overdue gem is red and blinks faster." />
      <Idea id="b" name="B · Marching dashes" blurb="Pixel dashes crawl around the inside edge of the frame (right along the top, down the right side, and so on). Like a selection outline." />
      <Idea id="c" name="C · Inner edge blink" blurb="A one-pixel ring just inside the frame switches between bright and dim in two steps, like a heartbeat. Nothing else moves." />
      <Idea id="d" name="D · Breathing accent bar" blurb="A thin coloured bar down the left side fades in four steps and back. The quietest option; reads as a status stripe." />
      <Idea id="e" name="E · Life in the corner only" blurb="Today's Game of Life, but confined to a small patch in the top-right corner instead of the whole card." />
    </main>
  );
}
