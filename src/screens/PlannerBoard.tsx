import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  DEFAULT_SPAN, SNAP_MINUTES, SOON_MINUTES, SPANS, addDays, boardDays, boardHours, dayPlan, effectiveStreak, eventEnd, eventLength, fmtClock, habitsOn, layoutBlocks, minutesOfDay, placeEvent, placeHabit, resizeEvent, resizeHabit, slotDone, slotTime, startOfDay,
  type Habit, type HabitSlot, type PlanEvent, type PlannerSave, type Span, type Task,
} from '../domain';
import { actions, useAppState, useUndo } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import type { Key } from '../i18n';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Icon, Modal, PixelCheckbox } from '../ui/misc';
import { CATEGORY_TINT, URGENCY_TINT } from '../ui/colors';
import { frameOr, resolveFrame } from '../ui/themes';
import { useTintedFrame } from '../ui/tintFrame';
import { Sparkles, fxVars, prefersReducedMotion } from '../ui/CompleteFx';
import { TaskCard } from './Tasks';

const SPAN_KEY: Record<Span, Key> = { 1: 'plSpan1', 3: 'plSpan3', 5: 'plSpan5', 7: 'plSpan7' };
/** How long a ticked card glows and hops before it is marked done, ms. */
const HOP_MS = 700;
const EVENT_STARS = 8;
/** A pointer must travel this far (px) before a press becomes a drag, so a tap still opens the card. */
const DRAG_START = 6;
const FREQ_KEY = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' } as const;

/** The day of the board column under a point of the screen (its top lane or its hour grid), or null. */
export function dayAtPoint(x: number, y: number): number | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-plday]')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return Number(el.dataset.plday);
  }
  return null;
}
/** The click that ends a drag must not open what was dragged. */
export function swallowClick() {
  const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
/** What scrolls the page around an element: its nearest scrolling ancestor, else the window. */
export function scrollerOf(el: HTMLElement | null) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) { const box = p; return { top: () => box.scrollTop, by: (n: number) => { box.scrollTop += n; } }; }
  }
  return { top: () => window.scrollY, by: (n: number) => window.scrollBy(0, n) };
}

/**
 * A block of time. It is built like a task card (frame, tick, title that opens it, the glow and stars when ticked) but reads as
 * something else: a blue frame with the Body / Mind / Soul colour only on its border, its time where a task has its chips,
 * violet stars, and a blinking gem while it is on.
 */
function EventCard({ event: e, onNow, expanded, leaving, label, onToggle, onTick, onEdit }: {
  event: PlanEvent; onNow: boolean; expanded: boolean; leaving: boolean; label: string; onToggle: () => void; onTick: () => void; onEdit: () => void;
}) {
  const { t } = useI18n();
  const el = useAppState(s => s.settings.elements);
  const theme = e.done ? frameOr(el.done, 'grey_stone_chiseld') : frameOr(el.plEvent, 'blue');
  const tinted = useTintedFrame(theme, !e.done && e.category ? CATEGORY_TINT[e.category] : null);
  const style = { ...(tinted ? { '--frame': tinted } : {}), ...(leaving ? fxVars('event', EVENT_STARS) : {}) } as CSSProperties;
  return (
    <PixelFrame theme={theme} scale={1} style={style} className={`task event compact ${e.done ? 'done' : ''} ${onNow ? 'urg-soon' : ''} ${leaving ? 'fx-hop' : ''} ${expanded ? 'is-open' : ''}`}>
      {onNow && <span className="urg-gem" role="img" aria-label={t('plOnNow')}><Chip color={URGENCY_TINT.soon}>!</Chip></span>}
      <div className="task-head">
        <span className="fx-anchor">
          <PixelCheckbox checked={e.done || leaving} ariaLabel={t('plMarkDone', { title: e.title })} onChange={onTick} label="" />
          {leaving && <Sparkles count={EVENT_STARS} />}
        </span>
        <button className="task-title" onClick={onToggle} aria-expanded={expanded}>{e.title}</button>
      </div>
      <div className="row wrap ev-when"><Chip color="var(--info)">{label}</Chip>{e.repeat && <Chip>{t(FREQ_KEY[e.repeat]).toUpperCase()}</Chip>}</div>
      <div className={`task-more ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="task-more-in">
          {e.category && <Icon name={`${e.category.toLowerCase()}_active`} size={16} alt={e.category} />}
          <p className={e.note ? 'task-desc' : 'task-desc muted'}>{e.note || t('noDescription')}</p>
          <button type="button" className="task-edit" aria-label={t('edit')} tabIndex={expanded ? 0 : -1} onClick={onEdit}><Icon name="pencil_yellow" size={16} /></button>
        </div>
      </div>
    </PixelFrame>
  );
}

/** A habit that is not on the calendar yet, as a small habit card (tick, title on one line); it can be dragged onto the grid. */
function LooseHabit({ habit: h, className, style, onPointerDown, grip }: { habit: Habit; className: string; style: CSSProperties; onPointerDown: (ev: RPointerEvent<HTMLElement>) => void; grip: ReactNode }) {
  const { t } = useI18n();
  const el = useAppState(s => s.settings.elements);
  const mainFrame = useAppState(st => st.settings.frameTheme);
  const theme = frameOr(el.habit, 'app');
  const cat = resolveFrame(theme, mainFrame, '', '').hue !== 0 ? null : CATEGORY_TINT[h.category];
  const tinted = useTintedFrame(theme, cat, cat);
  return (
    <div className={className} style={style} onPointerDown={onPointerDown}>
      {grip}
      <PixelFrame theme={theme} scale={1} style={tinted ? ({ '--frame': tinted } as CSSProperties) : undefined} className="task habit compact pl-loose">
        <div className="task-head">
          <span className="fx-anchor"><PixelCheckbox checked={false} ariaLabel={t('plMarkDone', { title: h.title })} onChange={() => actions.completeHabit(h.id)} label="" /></span>
          <button type="button" className="task-title" onClick={() => navigate(`/habits/${h.id}`)}>{h.title}</button>
        </div>
      </PixelFrame>
    </div>
  );
}

/**
 * One turn of a planned habit. The habit card of the Habits screen in small: its Body / Mind / Soul colour, the cyan stars and
 * the hop when ticked, the streak. It can only be ticked on the day itself; on other days it shows whether that turn was done.
 */
function HabitSlotCard({ slot, now, expanded, label, onToggle, onEdit }: { slot: HabitSlot; now: number; expanded: boolean; label: string | null; onToggle: () => void; onEdit: () => void }) {
  const { t, locale } = useI18n();
  const h = slot.habit, el = useAppState(s => s.settings.elements);
  const isToday = slot.day === startOfDay(now), done = slotDone(slot), streak = effectiveStreak(h, now);
  const stars = Math.max(3, Math.min(40, streak + 1));
  const [burst, setBurst] = useState(false);
  useEffect(() => { if (!burst) return; const id = setTimeout(() => setBurst(false), 1600); return () => clearTimeout(id); }, [burst]);
  const shownDone = done && !burst;   // the card keeps its colours while the stars fly, then turns to stone
  const theme = shownDone ? frameOr(el.done, 'grey_stone_chiseld') : frameOr(el.habit, 'app');
  const mainFrame = useAppState(st => st.settings.frameTheme);
  const cat = shownDone || resolveFrame(theme, mainFrame, '', '').hue !== 0 ? null : CATEGORY_TINT[h.category];
  const tinted = useTintedFrame(theme, cat, cat);
  const undo = useUndo();
  const canUndo = !!undo && 'habitId' in undo && undo.habitId === h.id;
  const tick = () => {
    if (!isToday) return;
    if (done) { if (canUndo) { actions.undoHabit(h.id); setBurst(false); } return; }
    actions.completeHabit(h.id); if (!prefersReducedMotion()) setBurst(true);
  };
  return (
    <PixelFrame theme={theme} scale={1} style={{ ...(tinted ? { '--frame': tinted } : {}), ...(burst ? fxVars('habit', stars) : {}) } as CSSProperties}
      className={`task habit compact ${shownDone ? 'done' : ''} ${burst ? 'fx-glow fx-hop' : ''} ${expanded ? 'is-open' : ''}`}>
      <div className="task-head">
        <span className="fx-anchor" title={isToday ? undefined : t('plOnlyToday')}>
          <PixelCheckbox checked={done} disabled={!isToday} ariaLabel={t('plMarkDone', { title: h.title })} onChange={tick} label="" />
          {burst && <Sparkles count={stars} />}
        </span>
        <button className="task-title" onClick={onToggle} aria-expanded={expanded}>{h.title}</button>
      </div>
      <div className="row wrap ev-when">{label && <Chip color="var(--info)">{label}</Chip>}<Chip color="var(--success)">{t(FREQ_KEY[h.frequency]).toUpperCase()}</Chip>
        <span className={`xp ${burst ? 'fx-bump' : ''}`}>x{streak}{burst && <span className="fx-plus" aria-hidden>+1</span>}</span>
      </div>
      <div className={`task-more ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="task-more-in">
          <Icon name={`${h.category.toLowerCase()}_active`} size={16} alt={h.category} />
          <span className="row">
            <button type="button" className="task-edit" aria-label={t('edit')} tabIndex={expanded ? 0 : -1} onClick={onEdit}><Icon name="pencil_yellow" size={16} /></button>
            <button type="button" className="task-edit" aria-label={t('plHabitUnplan')} title={t('plHabitUnplan')} tabIndex={expanded ? 0 : -1} onClick={() => actions.setHabitPlan(h.id, undefined)}><Icon name="symbol_cross" size={16} /></button>
          </span>
          <div className="task-desc">
            {h.description && <p className="task-desc">{h.description}</p>}
            <p className="task-desc muted">{t('lastDone', { date: h.lastCompleted ? new Date(h.lastCompleted).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) : t('never') })}</p>
          </div>
        </div>
      </div>
    </PixelFrame>
  );
}

/** A repeating thing was dragged to another day: which ones should move? */
type Ask = { what: 'event'; id: string; title: string; day: number; time: number | undefined } | { what: 'habit'; id: string; title: string; ruleDay: number; day: number; time: number | undefined }
  /** a repeated habit dragged to another time on its own day */
  | { what: 'habittime'; id: string; title: string; ruleDay: number; day: number; time: number | undefined };

/** A block on a day's hour grid: an activity with a time, or a turn of a planned habit that has one. */
interface Block { key: string; time: number; length: number; event?: PlanEvent; slot?: HabitSlot }

interface Drag {
  kind: 'task' | 'event' | 'habit' | 'newhabit' | 'resize' | 'hresize'; id: string;
  dx: number; dy: number; active: boolean;
  /** move: where it would land (time undefined = the day's top lane) */
  over: { day: number; time: number | undefined } | null;
  /** resize: the length it would get */
  minutes: number;
}

/**
 * The board: the chosen days side by side. Each day has a top lane (tasks due that day, activities without a time, and today
 * the late tasks and open habits) over an hour grid where every activity with a time is a block as tall as it is long.
 * Cards are dragged to another day or time and blocks are stretched by their bottom edge; a tap on a title opens the card.
 * Blocks that overlap cascade to the right.
 */
export function PlannerBoard({ day, onDay, tasks, habits, planner, now, dropDay = null, onEditEvent, onEditTask, onEditHabit, onNewEvent, onNewTask, onAddHabit }: {
  day: number; onDay: (day: number) => void; tasks: Task[]; habits: Habit[]; planner: PlannerSave; now: number;
  /** the day something dragged from outside the board (a shortlist to-do) is over */
  dropDay?: number | null;
  onEditEvent: (e: PlanEvent) => void; onEditTask: (t: Task) => void; onEditHabit: (h: Habit) => void; onNewEvent: (day: number, time?: number) => void; onNewTask: (day: number) => void; onAddHabit: (day: number) => void;
}) {
  const { t, locale } = useI18n();
  const elements = useAppState(s => s.settings.elements);
  const span = planner.span ?? DEFAULT_SPAN;
  const today = startOfDay(now), nowMin = minutesOfDay(now);
  const days = boardDays(day, span);
  const [allHours, setAllHours] = useState(false);
  // the habits not on the calendar yet are a folded group (long lists), remembered on this device
  const [habitsOpen, setHabitsOpen] = useState(() => { try { return localStorage.getItem('scrypture:plhabits') === '1'; } catch { return false; } });
  const toggleHabits = () => setHabitsOpen(v => { try { localStorage.setItem('scrypture:plhabits', v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  const slots = new Map(days.map(d => [d, habitsOn(habits, d)]));   // the planned habits of each shown day
  const habitSpans = [...slots.values()].flat().filter(s => slotTime(s) != null).map(s => [slotTime(s)!, slotTime(s)! + eventLength(s.habit.plan!)] as [number, number]);
  const [from, to] = allHours ? [0, 24] : boardHours(planner.events, days, days.includes(today) ? nowMin : undefined, habitSpans);
  const [open, setOpen] = useState<string | null>(null);        // the activity whose card is opened
  const [leaving, setLeaving] = useState<string | null>(null);  // the card whose completion effect is playing
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const grids = useRef(new Map<number, HTMLElement>());         // each day's hour grid, to turn a pointer position into a day and a time
  const stopDrag = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Closed blocks keep their title on one line: in a narrow column the text steps down in whole pixels (never blurred) before it is cut with "...". */
  const fitTitles = () => {
    for (const el of scrollRef.current?.querySelectorAll<HTMLElement>('.pl-item.timed:not(.open) .task-title, .pl-loose .task-title, .pl-group-head > span') ?? []) {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize), floor = Math.max(4, Math.round(base * 0.5));
      for (let size = Math.floor(base); el.scrollWidth > el.clientWidth && size > floor; size--) el.style.fontSize = `${size - 1}px`;
    }
  };
  useLayoutEffect(() => { if (!drag?.active) fitTitles(); });   // after every change that is not a drag in flight
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fitTitles());
    ro.observe(el);
    // the pixel font may arrive after the first measure (the text is wider once it has): measure again then
    const again = () => fitTitles();
    document.fonts?.ready.then(again);
    document.fonts?.addEventListener?.('loadingdone', again);
    return () => { ro.disconnect(); document.fonts?.removeEventListener?.('loadingdone', again); };
  }, []);
  useEffect(() => () => stopDrag.current?.(), []);

  const data = { events: planner.events, shortlist: planner.shortlist, tasks, habits };
  const fmtDay = (d: number, o: Intl.DateTimeFormatOptions) => new Date(d).toLocaleDateString(locale, o);
  const range = span === 1 ? fmtDay(days[0], { weekday: 'long', day: 'numeric', month: 'long' })
    : `${fmtDay(days[0], { day: 'numeric', month: 'short' })} – ${fmtDay(days[span - 1], { day: 'numeric', month: 'short' })}`;

  /** Tick with the glow and stars first; the card stays where it is. */
  const tick = (id: string, done: () => void) => {
    if (leaving) return;
    if (prefersReducedMotion()) { done(); return; }
    setLeaving(id);
    setTimeout(() => { done(); setLeaving(null); }, HOP_MS);
  };

  /** The day and time under the pointer, for a card grabbed `grabY` px below its top edge. */
  function dropAt(x: number, y: number, grabY: number): Drag['over'] {
    let best: { day: number; rect: DOMRect; d: number } | null = null;
    for (const d of days) {
      const el = grids.current.get(d);
      if (!el) continue;
      const rect = el.getBoundingClientRect(), dist = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (!best || dist < best.d) best = { day: d, rect, d: dist };
    }
    if (!best) return null;
    const { rect } = best;
    if (y < rect.top) return { day: best.day, time: undefined };
    return { day: best.day, time: from * 60 + ((y - grabY - rect.top) / (rect.height / (to - from))) * 60 };
  }

  /** A press on a card: a drag once the pointer has moved a little (with the mouse anywhere on the card, by touch on its handle). */
  function press(ev: RPointerEvent<HTMLElement>, kind: Drag['kind'], id: string, slot?: HabitSlot) {
    if (ev.button !== 0 || stopDrag.current) return;
    const target = ev.target as HTMLElement, handle = !!target.closest('.pl-grip, .pl-size');
    if (!handle && (ev.pointerType !== 'mouse' || target.closest('input, label, .task-edit, .pl-ib'))) return;
    const sizing = kind === 'resize' || kind === 'hresize';
    if (sizing) ev.stopPropagation();
    const event = planner.events.find(e => e.id === id), plan = slot?.habit.plan;
    const key = slot ? `${id}@${slot.ruleDay}` : id, length = event ? eventLength(event) : plan ? eventLength(plan) : 0;
    const box = ev.currentTarget.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY, grabY = y0 - box.top;
    const grid = grids.current.get(slot?.day ?? event?.day ?? days[0])?.getBoundingClientRect();
    const hourPx = grid ? grid.height / (to - from) : 1;
    const d: Drag = { kind, id: key, dx: 0, dy: 0, active: false, over: null, minutes: length };
    const move = (e: PointerEvent) => {
      d.dx = e.clientX - x0; d.dy = e.clientY - y0;
      if (!d.active && Math.hypot(d.dx, d.dy) < DRAG_START) return;
      d.active = true;
      const want = length + (d.dy / hourPx) * 60;
      if (kind === 'resize' && event) d.minutes = resizeEvent(event, want).minutes!;
      else if (kind === 'hresize' && plan) d.minutes = resizeHabit(plan, want).minutes!;
      else d.over = dropAt(e.clientX, e.clientY, grabY);
      setDrag({ ...d });
    };
    const end = (e?: Event) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      stopDrag.current = null;
      setDrag(null);
      if (!d.active || e?.type !== 'pointerup') return;
      swallowClick();
      if (kind === 'resize') actions.resizeEvent(id, d.minutes);
      else if (kind === 'hresize' && plan) actions.setHabitPlan(id, resizeHabit(plan, d.minutes));
      else if (!d.over) return;
      else if (kind === 'task') actions.updateTask(id, { dueDate: d.over.day });
      else if (kind === 'event' && event) {
        // one of a repeated series dragged to another day: ask which ones move (a new time alone moves just this one)
        if (event.series && d.over.day !== event.day) setAsk({ what: 'event', id, title: event.title, day: d.over.day, time: d.over.time });
        else actions.moveEvent(id, d.over.day, d.over.time);
      } else if (kind === 'newhabit') {
        // a habit that is not on the calendar yet, dropped on a day (and a time): it starts repeating from there
        actions.setHabitPlan(id, placeHabit({ start: startOfDay(d.over.day) }, d.over.time));
      } else if (kind === 'habit' && slot && plan) {
        // a daily habit is on every day already; the others ask whether only this turn moves or all the future ones
        const newTime = d.over.time === undefined ? undefined : placeHabit(plan, d.over.time).time;
        if (d.over.day !== slot.day && slot.habit.frequency !== 'DAILY') setAsk({ what: 'habit', id, title: slot.habit.title, ruleDay: slot.ruleDay, day: d.over.day, time: d.over.time });
        else if (newTime !== slotTime(slot)) setAsk({ what: 'habittime', id, title: slot.habit.title, ruleDay: slot.ruleDay, day: slot.day, time: d.over.time });   // it repeats: this one only, or all of them?
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    stopDrag.current = () => end();
  }

  const dragging = (id: string) => (drag?.active && drag.id === id && drag.kind !== 'resize' && drag.kind !== 'hresize' ? drag : null);
  const moveStyle = (id: string): CSSProperties => { const d = dragging(id); return d ? { transform: `translate(${Math.round(d.dx)}px, ${Math.round(d.dy)}px)` } : {}; };
  const grip = (title: string) => <span className="pl-grip" role="img" aria-label={t('plMove', { title })} title={t('plMove', { title })} />;
  const whenOf = (e: PlanEvent, minutes = eventLength(e)) => (e.time == null ? t('plAnyTime') : `${fmtClock(e.time)}–${fmtClock((e.time + minutes) % 1440)}`);

  const taskItem = (x: Task) => (
    <div key={x.id} className={`pl-item ${x.completed ? '' : 'can-drag'} ${dragging(x.id) ? 'dragging' : ''}`} style={moveStyle(x.id)} onPointerDown={x.completed ? undefined : ev => press(ev, 'task', x.id)}>
      {!x.completed && grip(x.title)}
      <TaskCard task={x} now={now} compact stay leaving={leaving === x.id} onEdit={() => onEditTask(x)} onComplete={() => tick(x.id, () => actions.completeTask(x.id))} />
    </div>
  );
  const eventCard = (e: PlanEvent, label: string) => (
    <EventCard event={e} label={label} expanded={open === e.id} leaving={leaving === e.id}
      onNow={!e.done && e.day === today && e.time != null && e.time - SOON_MINUTES <= nowMin && eventEnd(e) >= nowMin}
      onToggle={() => setOpen(open === e.id ? null : e.id)} onEdit={() => onEditEvent(e)}
      onTick={() => (e.done ? actions.setEventDone(e.id, false) : tick(e.id, () => actions.setEventDone(e.id, true)))} />
  );
  const slotKey = (s: HabitSlot) => `${s.habit.id}@${s.ruleDay}`;
  const habitWhen = (s: HabitSlot, minutes = eventLength(s.habit.plan!)) => {
    const d = dragging(slotKey(s)), time = d?.over ? placeHabit(s.habit.plan!, d.over.time).time : slotTime(s);
    return time == null ? null : `${fmtClock(time)}–${fmtClock((time + minutes) % 1440)}`;
  };
  const habitCard = (s: HabitSlot, minutes?: number) => (
    <HabitSlotCard slot={s} now={now} label={habitWhen(s, minutes)} expanded={open === slotKey(s)} onToggle={() => setOpen(open === slotKey(s) ? null : slotKey(s))} onEdit={() => onEditHabit(s.habit)} />
  );
  /** What the card being dragged says while it is in the air: the time it would land on. */
  const landing = (e: PlanEvent) => { const d = dragging(e.id); return d?.over ? whenOf({ ...e, ...placeEvent(e, d.over.day, d.over.time) }) : whenOf(e); };

  return (
    <PixelFrame theme={frameOr(elements.plBoard, 'app')} scale={1} className="card pl-board">
      <div className="pl-bar">
        <button type="button" className="pl-ib" aria-label={t('plEarlier')} title={t('plEarlier')} onClick={() => onDay(addDays(days[0], -span))}><Icon name="arrow_stone_left" size={16} /></button>
        <h2 className="pl-month-name" aria-live="polite">{range}</h2>
        <button type="button" className="pl-ib" aria-label={t('plLater')} title={t('plLater')} onClick={() => onDay(addDays(days[0], span))}><Icon name="arrow_stone_right" size={16} /></button>
        <button type="button" className={`seg ${day === today ? 'on' : ''}`} onClick={() => onDay(today)}>{t('plToday')}</button>
      </div>
      <div className="pl-bar">
        <div className="row wrap" role="group" aria-label={t('planner')}>
          {SPANS.map(n => <button type="button" key={n} className={`seg ${span === n ? 'on' : ''}`} aria-pressed={span === n} onClick={() => actions.setPlannerSpan(n)}>{t(SPAN_KEY[n])}</button>)}
          <button type="button" className={`seg ${allHours ? 'on' : ''}`} aria-pressed={allHours} aria-label={t('plAllHoursAria')} title={t('plAllHoursAria')} onClick={() => setAllHours(v => !v)}>{t('plAllHours')}</button>
        </div>
        <div className="row pl-bar-end">
          <PixelButton scale={1} size="compact" onClick={() => onNewEvent(day)}>{t('plAddActivity')}</PixelButton>
          <PixelButton scale={1} size="compact" onClick={() => onNewTask(day)}>{t('plAddTask')}</PixelButton>
          <PixelButton scale={1} size="compact" onClick={() => onAddHabit(day)}>{t('plAddHabit')}</PixelButton>
        </div>
      </div>

      <div className="pl-scroll" ref={scrollRef}>
        <div className={`pl-days ${drag?.active ? 'is-dragging' : ''}`} style={{ '--n': span, '--hours': to - from } as CSSProperties}>
          <div className="pl-corner" />
          {days.map(d => (
            <button type="button" key={d} className={`pl-head ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`} aria-pressed={d === day} aria-current={d === today ? 'date' : undefined} onClick={() => onDay(d)}>
              <span>{fmtDay(d, { weekday: 'short' })}</span><span>{fmtDay(d, { day: 'numeric', month: 'numeric' })}</span>
            </button>
          ))}

          <div className="pl-corner" />
          {days.map(d => {
            const plan = dayPlan(data, d, now), loose = plan.events.filter(e => e.time == null);
            return (
              <div key={d} data-plday={d} className={`pl-lane ${dropDay === d || (drag?.active && drag.over?.day === d && drag.over.time === undefined) ? 'drop' : ''}`}>
                {slots.get(d)!.filter(s => slotTime(s) == null).map(s => (
                  <div key={slotKey(s)} className={`pl-item can-drag ${dragging(slotKey(s)) ? 'dragging' : ''}`} style={moveStyle(slotKey(s))} onPointerDown={ev => press(ev, 'habit', s.habit.id, s)}>
                    {grip(s.habit.title)}{habitCard(s)}
                  </div>
                ))}
                {loose.map(e => (
                  <div key={e.id} className={`pl-item can-drag ${dragging(e.id) ? 'dragging' : ''}`} style={moveStyle(e.id)} onPointerDown={ev => press(ev, 'event', e.id)}>
                    {grip(e.title)}{eventCard(e, landing(e))}
                  </div>
                ))}
                {plan.late.map(taskItem)}
                {plan.tasks.map(taskItem)}
                {plan.habits.some(h => !h.plan) && (
                  <div className="pl-group">
                    <button type="button" className="pl-group-head" aria-expanded={habitsOpen} onClick={toggleHabits}>
                      <span>{t('plHabitsGroup', { n: plan.habits.filter(h => !h.plan).length })}</span>
                      <img className="chev" src={`/assets/raw/${habitsOpen ? 'arrow_stone_up' : 'arrow_stone_down'}.png`} alt="" />
                    </button>
                    {habitsOpen && plan.habits.filter(h => !h.plan).map(h => (
                      <LooseHabit key={h.id} habit={h} className={`pl-item can-drag ${dragging(h.id) ? 'dragging' : ''}`} style={moveStyle(h.id)} onPointerDown={ev => press(ev, 'newhabit', h.id)} grip={grip(h.title)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="pl-hours" aria-hidden>
            {Array.from({ length: to - from }, (_, i) => <span key={i} className="pl-hour" style={{ top: `calc(${i} * var(--hh))` }}>{String(from + i).padStart(2, '0')}</span>)}
          </div>
          {days.map(d => (
            <div key={d} data-plday={d} className={`pl-grid-col ${d === today ? 'today' : ''} ${dropDay === d || (drag?.active && drag.over?.day === d && drag.over.time !== undefined) ? 'drop' : ''}`}
              ref={el => { if (el) grids.current.set(d, el); else grids.current.delete(d); }}
              aria-label={t('plAddHere', { date: fmtDay(d, { day: 'numeric', month: 'long' }) })}
              onDoubleClick={ev => {
                if (ev.target !== ev.currentTarget) return;   // only the empty grid, not a block on it
                const rect = ev.currentTarget.getBoundingClientRect();
                onNewEvent(d, Math.max(0, Math.min(1425, Math.floor((from * 60 + ((ev.clientY - rect.top) / rect.height) * (to - from) * 60) / SNAP_MINUTES) * SNAP_MINUTES)));
              }}>
              {d === today && nowMin >= from * 60 && nowMin < to * 60 && <i className="pl-nowline" style={{ top: `calc(${(nowMin - from * 60) / 60} * var(--hh))` }} />}
              {layoutBlocks<Block>([
                ...planner.events.filter(e => e.day === d && e.time != null).map((e): Block => ({ key: e.id, time: e.time!, length: eventLength(e), event: e })),
                ...slots.get(d)!.filter(s => slotTime(s) != null).map((s): Block => ({ key: slotKey(s), time: slotTime(s)!, length: eventLength(s.habit.plan!), slot: s })),
              ], b => [b.time, b.time + b.length]).map(({ item: b, lane }) => {
                const sizing = !!drag?.active && (drag.kind === 'resize' || drag.kind === 'hresize') && drag.id === b.key, minutes = sizing ? drag!.minutes : b.length;
                const shift = Math.min(54, lane * 18);   // overlapping blocks cascade: each one starts a step to the right and runs to the edge, so even in a narrow column its title stays readable
                const style: CSSProperties = {
                  top: `calc(${(b.time - from * 60) / 60} * var(--hh))`, height: `calc(${minutes / 60} * var(--hh))`,
                  left: `${shift}%`, width: `${100 - shift}%`, zIndex: lane || undefined, ...moveStyle(b.key),
                };
                const title = b.event?.title ?? b.slot!.habit.title;
                let card: ReactNode;
                if (b.event) { const e = b.event; card = eventCard(e, sizing ? whenOf(e, minutes) : landing(e)); } else card = habitCard(b.slot!, minutes);
                return (
                  <div key={b.key} className={`pl-item timed can-drag ${open === b.key ? 'open' : ''} ${dragging(b.key) ? 'dragging' : ''} ${sizing ? 'sizing' : ''}`} style={style}
                    onPointerDown={ev => (b.event ? press(ev, 'event', b.event.id) : press(ev, 'habit', b.slot!.habit.id, b.slot))}>
                    {grip(title)}{card}
                    <span className="pl-size" role="img" aria-label={t('plResize', { title })} title={t('plResize', { title })}
                      onPointerDown={ev => (b.event ? press(ev, 'resize', b.event.id) : press(ev, 'hresize', b.slot!.habit.id, b.slot))} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="muted small">{t('plBoardHint')}</div>

      <Modal open={!!ask} onClose={() => setAsk(null)} title={t('plAskTitle')} theme="app">
        {ask && <>
          <p className="pl-ask">{ask.what === 'habittime' ? t('plAskTimeText', { title: ask.title, time: ask.time == null ? t('plAnyTime') : fmtClock(placeHabit({ start: 0 }, ask.time).time ?? 0) }) : t('plAskText', { title: ask.title, date: fmtDay(ask.day, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p>
          <div className="row wrap">
            {(['one', 'all'] as const).map(scope => (
              <PixelButton key={scope} scale={1} onClick={() => {
                if (ask.what === 'event') actions.moveEvent(ask.id, ask.day, ask.time, scope);
                else { actions.setHabitSlotTime(ask.id, ask.ruleDay, ask.time, scope); if (ask.what === 'habit') actions.moveHabit(ask.id, ask.ruleDay, ask.day, scope); }
                setAsk(null);
              }}>{t(scope === 'one' ? 'plAskOne' : ask.what === 'habittime' ? 'plAskAllOfThem' : 'plAskAll')}</PixelButton>
            ))}
            <PixelButton scale={1} variant="red" onClick={() => setAsk(null)}>{t('cancel')}</PixelButton>
          </div>
        </>}
      </Modal>
    </PixelFrame>
  );
}
