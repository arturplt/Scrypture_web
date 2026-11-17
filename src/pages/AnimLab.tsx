import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Icon } from '../ui/misc';
import { useChipVars } from '../ui/chips';
import { tickDef, tickUrl } from '../ui/ticks';
import { useAppState } from '../data/hooks';
import { useTintedFrame } from '../ui/tintFrame';
import './anim.css';

/** Dev-only (/anim): the chosen "glow & sparkles" completion animation, with the knobs that will drive it in the real app. */
type Kind = 'task' | 'habit';
type Urgency = 'none' | 'soon' | 'overdue';

/** Burst colours: tasks gold, habits cyan. [main, light] */
const KIND_COLORS: Record<Kind, [string, string]> = { task: ['#ffd700', '#fff3b0'], habit: ['#3fd8ff', '#d2f6ff'] };
/** Difficulty 0-9 -> tint laid over the frame: easy green -> yellow -> hard red. */
const tintFor = (d: number) => `hsl(${Math.round(130 - d * 14.4)} 80% 50%)`;
/** One star per XP point. */
export const sparkCount = (xp: number) => Math.max(1, Math.round(xp));
/** Stars scattered around the tick on a spiral that widens with the count, deterministic so a replay looks the same. */
const sparksFor = (xp: number) => {
  const n = sparkCount(xp), R = 70 + Math.sqrt(n) * 14, base = n > 50 ? 0.75 : 1;
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996, r = 18 + Math.sqrt((i + 1) / n) * R;
    return { x: Math.round(Math.cos(a) * r * 1.5), y: Math.round(Math.sin(a) * r * 0.75), d: Math.round((i / n) * 650), s: base * (i % 7 === 0 ? 1.5 : i % 3 === 0 ? 1.2 : 1) };
  });
};

const URGENCY_LABEL: Record<Urgency, string> = { none: 'No deadline', soon: 'Due soon', overdue: 'Overdue' };
const XPS = [5, 15, 25, 50, 100];
const NEXT: { title: string; diff: number; urgency: Urgency; xp: number }[] = [
  { title: 'Water the plants', diff: 2, urgency: 'soon', xp: 15 },
  { title: 'Call mum', diff: 8, urgency: 'overdue', xp: 40 },
];

function TaskRow({ title, kind, diff, urgency, xp, done, tickOff, tickOn, children }:
  { title: string; kind: Kind; diff: number; urgency: Urgency; xp: number; done?: boolean; tickOff: string; tickOn: string; children?: React.ReactNode }) {
  const frame = useTintedFrame('app', '#cf565c', tintFor(diff));
  return (
    <PixelFrame theme="app" scale={1} className={`task a-card ${done ? '' : `urg-${urgency}`}`} style={(frame ? { '--frame': frame } : {}) as CSSProperties}>
      <div className="task-head">
        <span className="a-tick">
          <i className="tick-sample" style={{ backgroundImage: tickUrl(done ? tickOn : tickOff) }} />
          {children}
        </span>
        <span className="task-title a-title"><span>{title}</span></span>
        <span className="xp">{kind === 'habit' ? 'x4' : <><Icon name="xp" size={16} />{xp}</>}</span>
      </div>
      <div className="row wrap chips">
        <Chip color={tintFor(diff)}>D{diff}</Chip>
        {urgency !== 'none' && <Chip color={urgency === 'overdue' ? 'var(--error)' : '#b67332'}>{urgency === 'overdue' ? 'LATE' : 'DUE SOON'}</Chip>}
      </div>
    </PixelFrame>
  );
}

function Stage({ kind, xp, diff, urgency, n }: { kind: Kind; xp: number; diff: number; urgency: Urgency; n: number }) {
  const tick = tickDef(useAppState(s => s.settings.elements.tick));
  const on = n > 0;
  const stage = useRef<HTMLDivElement>(null), first = useRef<HTMLDivElement>(null);
  // how far the next cards must travel to take the finished card's place = its height + the gap below it
  useLayoutEffect(() => {
    if (!stage.current || !first.current) return;
    const gap = parseFloat(getComputedStyle(first.current).marginBottom) || 0;
    stage.current.style.setProperty('--h', `${first.current.offsetHeight + gap}px`);
  }, [n, urgency, diff]);
  const [k, k2] = KIND_COLORS[kind];
  const sparks = on ? sparksFor(xp) : [];
  const ex = 900 + Math.min(600, sparks.length * 8);   // leave once the stars have mostly twinkled out
  const vars = { '--fx-main': k, '--fx-light': k2, '--gl': `${4 + xp / 10}px`, '--ex': `${ex}ms` } as CSSProperties;
  return (
    <div className={`stage ${on ? 'play' : ''}`} key={n} ref={stage} style={vars}>
      <div className="a-list">
        <div className="a-slot a-first" ref={first}>
          <TaskRow title={kind === 'habit' ? 'Morning stretch' : 'Write the report'} kind={kind} diff={diff} urgency={on ? 'none' : urgency} xp={xp} done={on} tickOff={tick.off} tickOn={tick.on}>
            {sparks.map((p, i) => <i key={i} className="fx-spark" style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--d': `${p.d}ms`, '--z': p.s } as CSSProperties} />)}
          </TaskRow>
        </div>
        {NEXT.map((t, i) => (
          <div key={t.title} className="a-slot a-next" style={{ '--i': i } as CSSProperties}>
            <TaskRow title={t.title} kind="task" diff={t.diff} urgency={t.urgency} xp={t.xp} tickOff={tick.off} tickOn={tick.on} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnimLab() {
  const chips = useAppState(s => s.settings.chips);
  const [kind, setKind] = useState<Kind>('task');
  const [xp, setXp] = useState(25);
  const [diff, setDiff] = useState(4);
  const [urgency, setUrgency] = useState<Urgency>('soon');
  const [n, setN] = useState(0);
  useEffect(() => { const r = document.documentElement; r.style.setProperty('--ui', '2'); r.style.setProperty('--font-scale', '1'); }, []);
  // changing a knob resets the stage so the card is idle (and pulsing) again
  const knob = <T,>(set: (v: T) => void) => (v: T) => { set(v); setN(0); };
  const seg = (on: boolean, label: string, click: () => void, extra?: CSSProperties) => (
    <button key={label} className={`seg ${on ? 'on' : ''}`} style={extra} aria-pressed={on} onClick={click}>{label}</button>
  );
  return (
    <main className="al" style={useChipVars(chips)}>
      <h1 className="title">Glow &amp; sparkles</h1>
      <p className="muted small" style={{ lineHeight: 1.7 }}>
        Task = gold burst, habit = cyan. One star per XP point. Difficulty tints the whole frame (border and centre). An open card pulses: orange when due soon, fast red when overdue.
      </p>

      <PixelFrame theme="wood_gold_gem" scale={1} className="al-demo">
        <div className="al-ctl"><span className="muted small">Type</span><div className="row wrap">{(['task', 'habit'] as Kind[]).map(v => seg(kind === v, v, () => knob(setKind)(v)))}</div></div>
        <div className="al-ctl"><span className="muted small">XP ({sparkCount(xp)} stars)</span><div className="row wrap">{XPS.map(v => seg(xp === v, String(v), () => knob(setXp)(v)))}</div></div>
        <div className="al-ctl"><span className="muted small">Difficulty</span>
          <div className="row wrap">{Array.from({ length: 10 }, (_, d) => seg(diff === d, String(d), () => knob(setDiff)(d), { '--chip-text': tintFor(d), '--chip-on-text': '#fff' } as CSSProperties))}</div></div>
        <div className="al-ctl"><span className="muted small">Urgency</span><div className="row wrap">{(['none', 'soon', 'overdue'] as Urgency[]).map(v => seg(urgency === v, URGENCY_LABEL[v], () => knob(setUrgency)(v)))}</div></div>
        <Stage kind={kind} xp={xp} diff={diff} urgency={urgency} n={n} />
        <div className="row"><PixelButton scale={1} onClick={() => setN(v => v + 1)}>{n === 0 ? 'Complete task' : 'Replay'}</PixelButton></div>
      </PixelFrame>
    </main>
  );
}
