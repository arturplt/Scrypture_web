import { useEffect, useId, useState } from 'react';
import { completedToday, doneInPeriod, habitTarget, effectiveStreak, sortHabits, type Category, type Habit, type HabitSort } from '../domain';
import type { Key } from '../i18n';
import { actions, useAppState, useUndo } from '../data/hooks';
import { useNow } from '../hooks';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Icon, PixelCheckbox } from '../ui/misc';
import { HabitForm } from './HabitForm';
import { CategoryManager } from './CategoryManager';
import { Dropdown } from '../ui/Dropdown';
import { CategoryChip } from '../ui/CategoryChip';
import { useI18n, useT } from '../i18n/useT';
import { frameOr, resolveFrame, splitFrame } from '../ui/themes';
import { CATEGORY_TINT } from '../ui/colors';
import { useTintedFrame } from '../ui/tintFrame';
import { Sparkles, fxVars, prefersReducedMotion, useFlip } from '../ui/CompleteFx';

function HabitCard({ habit, now, beforeTick, onEdit }: { habit: Habit; now: number; beforeTick: () => void; onEdit: () => void }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);   // clicking the title reveals the description in place
  const moreId = useId();
  const el = useAppState(s => s.settings.elements);
  const done = completedToday(habit, now);
  const streak = effectiveStreak(habit, now);
  // The burst has one star per day of the (new) streak, 3 to 40.
  const stars = Math.max(3, Math.min(40, streak + 1));
  const [burst, setBurst] = useState(false);
  useEffect(() => { if (!burst) return; const id = setTimeout(() => setBurst(false), 1600); return () => clearTimeout(id); }, [burst]);
  // while the burst plays the card keeps its live colours; it turns into the stone "done" card once the effect has finished
  const shownDone = done && !burst;
  const allCats = useAppState(st => st.categories);
  const groups = allCats.filter(c => habit.groups?.includes(c.id));   // shown as a chip in its own frame; the card itself follows the theme manager
  const theme = shownDone ? frameOr(el.done, 'grey_stone_chiseld') : frameOr(el.habit, 'app');
  const mainFrame = useAppState(st => st.settings.frameTheme);
  const cat = shownDone || resolveFrame(theme, mainFrame, '', '').hue !== 0 ? null : CATEGORY_TINT[habit.category];   // a chosen colour variant wins over the category colour
  const tinted = useTintedFrame(theme, cat, cat);   // the whole card takes its Body/Mind/Soul colour
  const undo = useUndo();
  const canUndo = !!undo && 'habitId' in undo && undo.habitId === habit.id;   // within 10 s of ticking it
  const tick = () => {
    if (done) { if (canUndo) { actions.undoHabit(habit.id); setBurst(false); } return; }   // unticking in the window takes it back
    beforeTick(); actions.completeHabit(habit.id); if (!prefersReducedMotion()) setBurst(true);
  };
  return (
    <PixelFrame theme={theme} scale={1} style={{ ...(tinted ? { '--frame': tinted } : {}), ...(burst ? fxVars('habit', stars) : {}) } as React.CSSProperties} data-flip={habit.id} className={`task ${shownDone ? 'done' : ''} ${burst ? 'fx-glow fx-hop' : ''}`}>
      <div className="task-head">
        <span className="fx-anchor">
          <PixelCheckbox checked={done} onChange={tick} label="" />
          {burst && <Sparkles count={stars} />}
        </span>
        <button className="task-title" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} aria-controls={moreId}>{habit.title}</button>
        <span className={`xp ${burst ? 'fx-bump' : ''}`}>x{streak}{burst && <span className="fx-plus" aria-hidden>+1</span>}</span>
      </div>
      <div id={moreId} className={`task-more ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="task-more-in">
          <Icon name={`${habit.category.toLowerCase()}_active`} size={32} alt={habit.category} />
          <div className="task-desc-col">
            <p className={habit.description ? 'task-desc' : 'task-desc muted'}>{habit.description || t('noDescription')}</p>
            <p className="task-desc muted">{t('lastDone', { date: habit.lastCompleted ? new Date(habit.lastCompleted).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) : t('never') })}</p>
          </div>
          <button type="button" className="task-edit" aria-label={t('edit')} tabIndex={expanded ? 0 : -1} onClick={onEdit}><Icon name="pencil_yellow" size={16} /></button>
        </div>
      </div>
      <div className="row wrap chips">
        <Chip>{t(habit.frequency.toLowerCase() as 'daily' | 'weekly' | 'monthly').toUpperCase()}</Chip>
        {habitTarget(habit) > 1 && <Chip color={doneInPeriod(habit, now) >= habitTarget(habit) ? 'var(--success)' : undefined}>{t(habit.frequency === 'WEEKLY' ? 'habitThisWeek' : 'habitThisMonth', { n: doneInPeriod(habit, now), target: habitTarget(habit) })}</Chip>}
        <Chip color={streak > 0 ? 'var(--success)' : 'var(--bg-3)'}>{t('streak').toUpperCase()} {streak}</Chip>
        <Chip color="var(--bg-3)">{t('best').toUpperCase()} {habit.bestStreak}</Chip>
        {groups.map(g => <CategoryChip key={g.id} category={g} />)}
      </div>
    </PixelFrame>
  );
}

const CATS: [Category, Key][] = [['BODY', 'body'], ['MIND', 'mind'], ['SOUL', 'soul']];
const SORTS: [HabitSort, Key][] = [['newest', 'sortNew'], ['streak', 'sortStreak'], ['open', 'sortOpenFirst'], ['name', 'sortName']];

export function Habits() {
  const t = useT();
  const habits = useAppState(s => s.habits);
  const now = useNow(30_000);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [sort, setSort] = useState<HabitSort>('newest');
  const [category, setCategory] = useState<Category | 'ALL'>('ALL');
  const cats = useAppState(s => s.categories);
  const [pick, setPick] = useState<string | null>(null);
  const [managingCats, setManagingCats] = useState(false);
  const activeGroup = pick && cats.some(c => c.id === pick) ? pick : null;
  const flip = useFlip<HTMLDivElement>();   // in the TO DO order a ticked habit glides down to the finished ones
  const doneToday = habits.filter(h => completedToday(h, now)).length;

  return (
    <div className="screen" ref={flip.ref}>
      {habits.length > 0 && <div className="muted small">{t('doneTodayCount', { done: doneToday, total: habits.length })}</div>}
      {habits.length === 0 && (
        <PixelFrame theme="app" scale={1} className="card"><p className="muted">{t('createFirstHabit')}</p><div className="row"><PixelButton scale={1} onClick={() => navigate('/start')}>{t('startHere')}</PixelButton></div></PixelFrame>
      )}
      {(cats.length > 0 || habits.length > 0) && (
        <div className="row wrap" role="group" aria-label={t('customCategory')}>
          <button className="seg" onClick={() => setManagingCats(true)}>{t('manageCategories')}</button>
          {cats.map(c => <button key={c.id} type="button" className={`cat-filter ${activeGroup === c.id ? 'on' : ''}`} aria-pressed={activeGroup === c.id} onClick={() => setPick(activeGroup === c.id ? null : c.id)}><CategoryChip category={c} /></button>)}
        </div>
      )}
      {habits.length > 0 && (
        <div className="row" role="group" aria-label={t('categoryFilter')} style={{ flexWrap: 'nowrap' }}>
          {CATS.map(([c, k]) => (
            <button key={c} type="button" className="cat-icon" aria-pressed={category === c} aria-label={t(k).toUpperCase()} onClick={() => setCategory(category === c ? 'ALL' : c)}><Icon name={`${c.toLowerCase()}_${category === c ? 'active' : 'inactive'}`} size={48} alt="" /></button>
          ))}
          {habits.length > 1 && (
            <Dropdown ariaLabel={t('sort')} label={t(SORTS.find(([k]) => k === sort)![1])}>
              {close => SORTS.filter(([k]) => k !== sort).map(([k, label]) => (
                <button key={k} type="button" role="option" aria-selected={false} className="seg" onClick={() => { setSort(k); close(); }}>{t(label)}</button>
              ))}
            </Dropdown>
          )}
        </div>
      )}
      {/* Daily, weekly and monthly habits are kept apart; the chosen sort applies inside each group */}
      {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(f => {
        const group = sortHabits(habits.filter(h => h.frequency === f && (category === 'ALL' || h.category === category) && (!activeGroup || !!h.groups?.includes(activeGroup))), sort, now);
        if (!group.length) return null;
        return (
          <section key={f} className="list" aria-label={t(f.toLowerCase() as 'daily' | 'weekly' | 'monthly')}>
            <h2 className="subtitle">{t(f.toLowerCase() as 'daily' | 'weekly' | 'monthly')}</h2>
            <div className="list cards">{group.map(h => <HabitCard key={h.id} habit={h} now={now} beforeTick={() => flip.mark()} onEdit={() => setEditing(h)} />)}</div>
          </section>
        );
      })}
      <div className="fab-wrap">
        <PixelButton scale={1} className="fab-add" aria-label={t('newButton')} onClick={() => setCreating(true)}>+</PixelButton>
      </div>
      {managingCats && <CategoryManager onClose={() => setManagingCats(false)} />}
      {creating && <HabitForm onClose={() => setCreating(false)} />}
      {editing && <HabitForm habit={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
