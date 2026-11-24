import { useMemo, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import {
  REPEAT_COUNT, SHORTLIST_MAX, dayToInput, fmtClock, habitHistory, inputToDay, isOverdue, monthGrid, monthMarks, parseClock, shortlistTasks, snapMinutes, startOfDay,
  type Category, type Frequency, type Habit, type PlanEvent, type Task,
} from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { frameOr } from '../ui/themes';
import { PixelButton } from '../ui/PixelButton';
import { Sparkles, fxVars, prefersReducedMotion } from '../ui/CompleteFx';
import { Chip, Icon, Modal, PixelCheckbox } from '../ui/misc';
import { TaskForm } from './TaskForm';
import { HabitForm } from './HabitForm';
import { PlannerBoard, dayAtPoint, scrollerOf, slotAtPoint, swallowClick } from './PlannerBoard';
import { askToNotify, canNotify } from '../audio/reminders';
import { REMIND_LEADS, type RemindLead } from '../domain';
import './planner.css';

const CATS: Category[] = ['BODY', 'MIND', 'SOUL'];
const LENGTHS = [15, 30, 45, 60, 90, 120, 180];
const FREQS: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
const FREQ_KEY = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' } as const;
/** How far back the list of completed habits goes, in days. */
const HISTORY_DAYS = 14;
const fmtShort = (ms: number, locale: string) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

/** Three small Body / Mind / Soul buttons (the same sprites the task form uses). */
function CatPick({ value, onChange, size = 32 }: { value: Category | undefined; onChange: (c: Category) => void; size?: number }) {
  return <>{CATS.map(c => (
    <button type="button" key={c} className={`catpick ${value === c ? 'on' : ''}`} onClick={() => onChange(c)} aria-pressed={value === c}>
      <Icon name={`${c.toLowerCase()}_${value === c ? 'active' : 'inactive'}`} size={size} alt={c} />
    </button>
  ))}</>;
}

/**
 * Planner: the shortlist of to-dos on top, the board under it (the chosen days as columns, see PlannerBoard; a to-do is dragged
 * from the shortlist onto a day), then the month calendar and the habits completed lately.
 * It shows the same tasks and habits as the rest of the app (ticking one here is ticking it everywhere), and Bóbr reads the same plan.
 */
export function Planner() {
  const { t, locale } = useI18n();
  const elements = useAppState(s => s.settings.elements);
  const tasks = useAppState(s => s.tasks);
  const habits = useAppState(s => s.habits);
  const planner = useAppState(s => s.planner);
  const now = useNow(30_000);
  const today = startOfDay(now);
  const [day, setDay] = useState(today);
  const [view, setView] = useState(() => { const d = new Date(today); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [eventForm, setEventForm] = useState<PlanEvent | { on: number; time?: number } | null>(null);   // an activity to change, or the day (and time) of a new one
  const [taskForm, setTaskForm] = useState<Task | { on: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [habitDay, setHabitDay] = useState<number | null>(null);   // choosing a habit to put on this day
  const [habitForm, setHabitForm] = useState<Habit | 'new' | null>(null);
  const [carry, setCarry] = useState<{ id: string; dx: number; dy: number; day: number | null; /** where in the shortlist it would land */ slot: number | null } | null>(null);   // a shortlist to-do being dragged onto the board
  const [ticking, setTicking] = useState<string | null>(null);   // the shortlist to-do whose completion effect is playing
  const [todo, setTodo] = useState('');
  const [todoCat, setTodoCat] = useState<Category>('MIND');

  const short = shortlistTasks(planner.shortlist, tasks, now);
  const full = short.length >= SHORTLIST_MAX;
  const inShort = new Set(short.map(x => x.id));
  const grid = useMemo(() => monthGrid(view.y, view.m), [view]);
  const history = useMemo(() => habitHistory(habits, now, HISTORY_DAYS), [habits, today]);   // eslint-disable-line react-hooks/exhaustive-deps
  const marks = useMemo(() => monthMarks({ events: planner.events, tasks }), [planner.events, tasks]);

  const show = (d: number) => { const x = new Date(d); setDay(d); setView({ y: x.getFullYear(), m: x.getMonth() }); };
  const turn = (by: number) => setView(v => { const x = new Date(v.y, v.m + by, 1); return { y: x.getFullYear(), m: x.getMonth() }; });
  const addTodo = () => { if (todo.trim() && actions.addTodo(todo, todoCat)) setTodo(''); };
  const toggleTask = (x: Task) => {
    if (x.completed) { actions.uncompleteTask(x.id); return; }
    if (ticking) return;
    if (prefersReducedMotion()) { actions.completeTask(x.id); return; }
    setTicking(x.id);
    setTimeout(() => { actions.completeTask(x.id); setTicking(null); }, 900);
  };

  /**
   * Dragging a to-do off the shortlist (with the mouse anywhere on its line, by touch on its handle): dropped on a day of the
   * board it gets that date. Near the top or bottom of the screen the page scrolls, so a board out of sight can be reached.
   */
  function grab(ev: RPointerEvent<HTMLElement>, x: Task) {
    if (ev.button !== 0 || x.completed || carry) return;
    const target = ev.target as HTMLElement;
    if (!target.closest('.pl-grip') && (ev.pointerType !== 'mouse' || target.closest('input, label, .pl-ib'))) return;
    const x0 = ev.clientX, y0 = ev.clientY, scroller = scrollerOf(ev.currentTarget), top0 = scroller.top();
    let px = x0, py = y0, active = false, raf = 0;
    const show = () => setCarry({ id: x.id, dx: px - x0, dy: py - y0 + scroller.top() - top0, day: dayAtPoint(px, py), slot: listSlotAt(px, py, x.id) });
    const loop = () => {
      const dir = py < 70 ? -1 : py > window.innerHeight - 70 ? 1 : 0;
      if (dir) { scroller.by(dir * 12); show(); }
      raf = requestAnimationFrame(loop);
    };
    const move = (e: PointerEvent) => {
      px = e.clientX; py = e.clientY;
      if (!active && Math.hypot(px - x0, py - y0) < 6) return;
      if (!active) { active = true; raf = requestAnimationFrame(loop); }
      show();
    };
    const end = (e: Event) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      cancelAnimationFrame(raf);
      setCarry(null);
      if (!active || e.type !== 'pointerup') return;
      swallowClick();
      const to = slotAtPoint(px, py);
      if (to) { actions.shortlistToDay(x.id, to.day, to.time === undefined ? undefined : Math.max(0, Math.min(1425, snapMinutes(to.time)))); return; }   // moved onto the calendar: dated, and no longer on the shortlist
      const slot = listSlotAt(px, py, x.id);
      if (slot != null) actions.shortlistPlace(x.id, slot);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }

  /** Where a dragged to-do would land in the shortlist when the pointer is over it: its place among the other lines, else null. */
  function listSlotAt(px: number, py: number, id: string): number | null {
    const box = document.querySelector('.pl-shortlist')?.getBoundingClientRect();
    if (!box || px < box.left || px > box.right || py < box.top - 24 || py > box.bottom + 24) return null;
    const rows = [...document.querySelectorAll<HTMLElement>('.pl-shortlist .pl-short')].filter(r => r.dataset.task !== id);
    return rows.filter(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < py; }).length;
  }

  /** The line a dragged to-do would land before (or after, for the last place) gets a bar. */
  const dropMark = (id: string) => {
    if (!carry || carry.slot == null || carry.id === id) return '';
    const others = short.filter(s => s.id !== carry.id), i = others.findIndex(s => s.id === id);
    return i === carry.slot ? 'drop-before' : i === others.length - 1 && carry.slot >= others.length ? 'drop-after' : '';
  };

  /** One line of the shortlist: handle, tick box, title (opens the task), what it is worth, and the button that takes it off. */
  const taskRow = (x: Task) => (
    <div key={x.id} data-task={x.id} className={`pl-row pl-short ${x.completed ? 'done' : 'can-drag'} ${carry?.id === x.id ? 'dragging' : ''} ${dropMark(x.id)}`} onPointerDown={ev => grab(ev, x)}
      style={{ ...(carry?.id === x.id ? { transform: `translate(${Math.round(carry.dx)}px, ${Math.round(carry.dy)}px)` } : {}), ...(ticking === x.id ? fxVars('task', x.experienceReward) : {}) } as CSSProperties}>
      {!x.completed && <span className="pl-grip" role="img" aria-label={t('plMove', { title: x.title })} title={t('plMove', { title: x.title })} />}
      <span className="fx-anchor">
        <PixelCheckbox checked={x.completed || ticking === x.id} ariaLabel={`${x.completed ? t('uncompleteTask') : t('completeTask')}: ${x.title}`} onChange={() => toggleTask(x)} label="" />
        {ticking === x.id && <Sparkles count={Math.min(x.experienceReward, 30)} />}
      </span>
      <button type="button" className="pl-title" disabled={x.completed} onClick={() => setTaskForm(x)}>{x.title}</button>
      {isOverdue(x, now) ? <Chip color="var(--error)" border="#a04848">{t('late')} {fmtShort(x.dueDate!, locale)}</Chip>
        : x.dueDate != null && startOfDay(x.dueDate) !== today ? <Chip color="var(--border-2)">{fmtShort(x.dueDate, locale)}</Chip> : null}
      <Chip color="#b6a432">{x.experienceReward} XP</Chip>
      <button type="button" className="pl-ib" aria-label={`${t('plRemove')}: ${x.title}`} title={t('plRemove')} onClick={() => actions.shortlistRemove(x.id)}><Icon name="symbol_cross" size={16} /></button>
    </div>
  );

  return (
    <div className="screen planner">
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton>
        <PixelButton scale={1} onClick={() => navigate('/chat')}>{t('plAskBobr')}</PixelButton>
      </div>
      <h1 className="title">{t('planner')}</h1>

      <PixelFrame theme={frameOr(elements.plCard, 'app')} scale={1} className="card">
        <h2 className="subtitle">{t('plShortlist')} ({short.length}/{SHORTLIST_MAX})</h2>
        <div className="muted small">{t('plShortHint', { n: SHORTLIST_MAX })} {t('plShortDrag')}</div>
        {short.length === 0 && <div className="muted small">{t('plShortEmpty')}</div>}
        <div className="pl-shortlist">{short.map(taskRow)}</div>
        <form className="pl-add" onSubmit={e => { e.preventDefault(); addTodo(); }}>
          <input value={todo} maxLength={80} placeholder={t('plTodoPlaceholder')} aria-label={t('plTodoPlaceholder')} onChange={e => setTodo(e.target.value)} />
          <CatPick value={todoCat} onChange={setTodoCat} size={16} />
          <PixelButton type="submit" scale={1} size="compact" disabled={!todo.trim()}>{t('add')}</PixelButton>
        </form>
        {full && <div className="muted small" role="status">{t('plShortFull', { n: SHORTLIST_MAX })}</div>}
        <div className="row"><PixelButton scale={1} size="compact" variant="red" disabled={full} onClick={() => setPicking(true)}>{t('plPick')}</PixelButton></div>
      </PixelFrame>

      <PlannerBoard day={day} onDay={show} tasks={tasks} habits={habits} planner={planner} now={now} dropDay={carry?.day}
        onEditEvent={setEventForm} onEditTask={setTaskForm} onEditHabit={setHabitForm} onNewEvent={(on, time) => setEventForm({ on, time })} onNewTask={on => setTaskForm({ on })} onAddHabit={setHabitDay} />

      <Reminders lead={planner.remind} />

      <div className="pl-cols">
        <div className="pl-col">
          <PixelFrame theme={frameOr(elements.plCard, 'app')} scale={1} className="card">
            <div className="pl-month">
              <button type="button" className="pl-ib" aria-label={t('plPrevMonth')} title={t('plPrevMonth')} onClick={() => turn(-1)}><Icon name="arrow_stone_left" size={16} /></button>
              <h2 className="pl-month-name" aria-live="polite">{new Date(view.y, view.m, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h2>
              <button type="button" className="pl-ib" aria-label={t('plNextMonth')} title={t('plNextMonth')} onClick={() => turn(1)}><Icon name="arrow_stone_right" size={16} /></button>
              <button type="button" className={`seg ${day === today ? 'on' : ''}`} onClick={() => show(today)}>{t('plToday')}</button>
            </div>
            <div className="pl-grid">
              {grid.slice(0, 7).map(d => <div key={d} className="pl-wd" aria-hidden>{new Date(d).toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2)}</div>)}
              {grid.map(d => {
                const m = marks.get(d), date = new Date(d), late = d < today && !!m?.tasks;
                return (
                  <button type="button" key={d} className={`pl-day ${date.getMonth() !== view.m ? 'out' : ''} ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`}
                    aria-pressed={d === day} aria-current={d === today ? 'date' : undefined} onClick={() => show(d)}
                    aria-label={t('plDayLabel', { date: date.toLocaleDateString(locale, { day: 'numeric', month: 'long' }), events: m?.events ?? 0, tasks: m?.tasks ?? 0 })}>
                    <span>{date.getDate()}</span>
                    <span className="pl-marks" aria-hidden>{m?.events ? <i className="pl-mark" /> : null}{m?.tasks ? <i className={`pl-mark ${late ? 'late' : 'task'}`} /> : null}</span>
                  </button>
                );
              })}
            </div>
            <div className="pl-legend muted small" aria-hidden><i className="pl-mark" /> {t('plActivities')} <i className="pl-mark task" /> {t('chatTasks')} <i className="pl-mark late" /> {t('late')}</div>
          </PixelFrame>
        </div>

        <div className="pl-col">
          <PixelFrame theme={frameOr(elements.plCard, 'app')} scale={1} className="card">
            <h2 className="subtitle">{t('plHabitsDone')}</h2>
            <div className="muted small">{t('plHabitsDoneHint', { n: HISTORY_DAYS })}</div>
            {history.length === 0 && <div className="muted small">{t('plHabitsDoneNone', { n: HISTORY_DAYS })}</div>}
            {history.map(({ day: d, habits: done }) => (
              <div key={d} className="pl-done-day">
                <button type="button" className="pl-done-date" onClick={() => show(d)}>{d === today ? t('plToday') : new Date(d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</button>
                <div className="row wrap chips">
                  {done.map(h => <button type="button" key={h.id} className="pl-done-habit" onClick={() => navigate(`/habits/${h.id}`)}><Chip color="var(--success)"><Icon name={`${h.category.toLowerCase()}_active`} size={8} alt={h.category} />{h.title}</Chip></button>)}
                </div>
              </div>
            ))}
          </PixelFrame>
        </div>
      </div>

      {eventForm && ('on' in eventForm ? <EventForm day={eventForm.on} time={eventForm.time} onClose={() => setEventForm(null)} /> : <EventForm event={eventForm} day={eventForm.day} onClose={() => setEventForm(null)} />)}
      {taskForm && ('on' in taskForm ? <TaskForm dueDate={taskForm.on} onClose={() => setTaskForm(null)} /> : <TaskForm task={taskForm} onClose={() => setTaskForm(null)} />)}
      {habitForm && <HabitForm habit={habitForm === 'new' ? undefined : habitForm} onClose={() => setHabitForm(null)} />}
      <Modal open={habitDay != null && !habitForm} onClose={() => setHabitDay(null)} title={t('plHabitPick', { date: habitDay != null ? fmtShort(habitDay, locale) : '' })} theme="app">
        <div className="muted small">{t('plHabitPickHint')}</div>
        <div className="pl-pick">
          {habits.length === 0 && <div className="muted small">{t('plHabitNone')}</div>}
          {habits.map(h => (
            <div key={h.id} className="pl-pick-row pl-pick-habit">
              <Icon name={`${h.category.toLowerCase()}_active`} size={16} alt={h.category} />
              <span>{h.title}{h.plan && <span className="pl-note muted">{t('plHabitSince', { date: fmtShort(h.plan.start, locale) })}</span>}</span>
              <Chip color="var(--success)">{t(FREQ_KEY[h.frequency]).toUpperCase()}</Chip>
              {h.plan
                ? <button type="button" className="pl-ib" aria-label={`${t('plHabitUnplan')}: ${h.title}`} title={t('plHabitUnplan')} onClick={() => actions.setHabitPlan(h.id, undefined)}><Icon name="symbol_cross" size={16} /></button>
                : <button type="button" className="pl-ib" aria-label={`${t('add')}: ${h.title}`} title={t('add')} onClick={() => { actions.setHabitPlan(h.id, { start: habitDay! }); setHabitDay(null); }}><Icon name="symbol_plus" size={16} /></button>}
            </div>
          ))}
        </div>
        <div className="row wrap">
          <PixelButton scale={1} onClick={() => setHabitForm('new')}>{t('plHabitNew')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={() => setHabitDay(null)}>{t('back')}</PixelButton>
        </div>
      </Modal>
      <Modal open={picking} onClose={() => setPicking(false)} title={t('plPickTitle')} theme="app">
        <div className="pl-pick">
          {tasks.filter(x => !x.completed && !inShort.has(x.id)).sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || b.createdAt - a.createdAt).map(x => (
            <button type="button" key={x.id} className="pl-pick-row" disabled={full} onClick={() => { actions.shortlistAdd(x.id); if (short.length + 1 >= SHORTLIST_MAX) setPicking(false); }}>
              <Icon name={`${x.category.toLowerCase()}_active`} size={16} alt={x.category} /><span>{x.title}</span>
              {x.dueDate != null && <Chip color={isOverdue(x, now) ? 'var(--error)' : 'var(--border-2)'}>{fmtShort(x.dueDate, locale)}</Chip>}
            </button>
          ))}
          {!tasks.some(x => !x.completed && !inShort.has(x.id)) && <div className="muted small">{t('plNoOpenTasks')}</div>}
        </div>
        <div className="row"><PixelButton scale={1} variant="red" onClick={() => setPicking(false)}>{t('back')}</PixelButton></div>
      </Modal>
    </div>
  );
}

/** Add or change an activity: what, which day, and optionally when, how long, which area of life and a note. */
function EventForm({ event, day, time: at, onClose }: { event?: PlanEvent; day: number; /** a new activity starts with this time (minutes after midnight) */ time?: number; onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(dayToInput(event?.day ?? day));
  const start = event?.time ?? at;
  const [time, setTime] = useState(start != null ? fmtClock(start) : '');
  const [minutes, setMinutes] = useState(event?.minutes ?? 0);
  const [category, setCategory] = useState<Category | undefined>(event?.category);
  const [note, setNote] = useState(event?.note ?? '');
  const [repeat, setRepeat] = useState<Frequency | undefined>(undefined);   // a new activity only: an existing one already is what it is
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [asking, setAsking] = useState(false);   // a repeated activity: change only this one, or the future ones too?
  const when = inputToDay(date);
  const valid = title.trim().length > 0 && when !== undefined;

  function save(scope: 'one' | 'all' = 'one') {
    if (!valid) return;
    const clock = parseClock(time);
    const fields = { title, day: when!, time: clock, minutes: clock !== undefined && minutes ? minutes : undefined, category, note };
    if (event) actions.updateEventScope(event.id, fields, scope); else actions.addEvent(fields, repeat);
    onClose();
  }

  return (
    <Modal open onClose={onClose} theme="app" title={event ? t('plEditActivity') : t('plNewActivity')}>
      <form className="form" onSubmit={e => { e.preventDefault(); if (event?.series) setAsking(true); else save(); }}>
        <div className="form-body">
          <label className="field">{t('title')}
            <input autoFocus value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder={t('plActivityPlaceholder')} />
          </label>
          <label className="field">{t('plDate')}
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="field">{t('plTime')}
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </label>
          {time && (
            <div className="field">{t('plLength')}
              <div className="row wrap" role="group" aria-label={t('plLength')}>
                {LENGTHS.map(n => <button type="button" key={n} className={`seg ${minutes === n ? 'on' : ''}`} aria-pressed={minutes === n} onClick={() => setMinutes(minutes === n ? 0 : n)}>{n}</button>)}
              </div>
            </div>
          )}
          <div className="field">{t('category')}
            <div className="row">
              <CatPick value={category} onChange={c => setCategory(category === c ? undefined : c)} />
            </div>
          </div>
          {!event && (
            <div className="field">{t('plRepeat')}
              <div className="row wrap" role="group" aria-label={t('plRepeat')}>
                <button type="button" className={`seg ${!repeat ? 'on' : ''}`} aria-pressed={!repeat} onClick={() => setRepeat(undefined)}>{t('plRepeatNone')}</button>
                {FREQS.map(f => <button type="button" key={f} className={`seg ${repeat === f ? 'on' : ''}`} aria-pressed={repeat === f} onClick={() => setRepeat(f)}>{t(FREQ_KEY[f])}</button>)}
              </div>
              {repeat && <div className="muted small">{t('plRepeatHint', { n: REPEAT_COUNT[repeat] })}</div>}
            </div>
          )}
          <label className="field">{t('plNote')}
            <textarea rows={2} value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder={t('optional')} />
          </label>
        </div>
        {asking ? (
          <div className="form-actions">
            <p className="pl-ask">{t('plEditAskText', { title: event?.title ?? title })}</p>
            <div className="row wrap">
              <PixelButton type="button" scale={1} onClick={() => save('one')}>{t('plAskOne')}</PixelButton>
              <PixelButton type="button" scale={1} onClick={() => save('all')}>{t('plAskAll')}</PixelButton>
              <PixelButton type="button" scale={1} variant="red" onClick={() => setAsking(false)}>{t('back')}</PixelButton>
            </div>
          </div>
        ) : (
        <div className="row wrap form-actions">
          <PixelButton type="submit" disabled={!valid} scale={1}>{event ? t('update') : t('add')}</PixelButton>
          <PixelButton type="button" scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
          {event && (confirmDelete
            ? <><PixelButton type="button" scale={1} variant="red" onClick={() => { actions.deleteEvent(event.id); onClose(); }}>{event.series ? t('plAskOne') : t('sure')}</PixelButton>
              {event.series && <PixelButton type="button" scale={1} variant="red" onClick={() => { actions.deleteEvent(event.id, 'all'); onClose(); }}>{t('plDeleteAll')}</PixelButton>}</>
            : <PixelButton type="button" scale={1} variant="red" onClick={() => setConfirmDelete(true)}>{t('delete')}</PixelButton>)}
        </div>
        )}
      </form>
    </Modal>
  );
}

/** Reminders before timed activities: off, at the start, or some minutes before. Asks for notification permission when switched on. */
function Reminders({ lead }: { lead?: RemindLead }) {
  const { t } = useI18n();
  const [note, setNote] = useState<string | null>(null);
  if (!canNotify()) return null;
  const pick = async (v: RemindLead | null) => {
    setNote(null);
    if (v === null) { actions.setPlannerRemind(null); return; }
    if (!(await askToNotify())) { setNote(t('plRemindDenied')); return; }
    actions.setPlannerRemind(v);
  };
  return (
    <div className="field pl-remind">{t('plRemind')}
      <div className="row wrap" role="group" aria-label={t('plRemind')}>
        <button type="button" className={`seg ${lead === undefined ? 'on' : ''}`} aria-pressed={lead === undefined} onClick={() => void pick(null)}>{t('crtOff')}</button>
        {REMIND_LEADS.map(v => <button type="button" key={v} className={`seg ${lead === v ? 'on' : ''}`} aria-pressed={lead === v} onClick={() => void pick(v)}>{v ? t('plRemindBefore', { n: v }) : t('plRemindAtStart')}</button>)}
      </div>
      <div className="muted small" role="status">{note ?? t('plRemindHint')}</div>
    </div>
  );
}
