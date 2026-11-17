import { useId, useState } from 'react';
import { isOverdue, quickPresets, tagCounts, urgencyOf, viewTasks, type Category, type Task, type TaskSort } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Icon, PixelCheckbox } from '../ui/misc';
import { DIFFICULTY_COLORS, PRIORITY_COLORS } from '../ui/colors';
import { TaskForm } from './TaskForm';
import { TagManager } from './TagManager';
import { CategoryManager } from './CategoryManager';
import { FirstTaskTutorial } from '../ui/FirstTaskTutorial';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PRIORITY_KEY, type Key } from '../i18n';
import { frameOr, resolveFrame, splitFrame } from '../ui/themes';
import { CATEGORY_TINT, URGENCY_TINT, difficultyTint } from '../ui/colors';
import { useTintedFrame } from '../ui/tintFrame';
import { ChipButton } from '../ui/chips';
import { Sparkles, fxDuration, fxVars, prefersReducedMotion, useFlip } from '../ui/CompleteFx';

const fmtDate = (ms: number, locale: string) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

/**
 * `compact`: the small card of the Planner board (the chips show only once it is opened).
 * `stay`: the card does not leave when ticked (the board keeps done tasks on their day), so it hops instead of flinging away.
 */
export function TaskCard({ task, now, onEdit, onComplete, leaving, compact = false, stay = false }: { task: Task; now: number; onEdit: () => void; onComplete: () => void; leaving: boolean; compact?: boolean; stay?: boolean }) {
  const { t, locale } = useI18n();
  const el = useAppState(s => s.settings.elements);
  const overdue = isOverdue(task, now);
  const p = PRIORITY_COLORS[task.priority];
  const open = !task.completed;
  const [expanded, setExpanded] = useState(false);   // clicking the title shows the description
  const moreId = useId();
  const group = useAppState(st => (task.group ? st.categories.find(c => c.id === task.group) : undefined));   // its own category frame wins over the default card
  const theme = task.completed ? frameOr(el.done, 'grey_stone_chiseld') : group ? frameOr(group.frame, 'app') : frameOr(el.task, 'app');
  const urgency = open && !leaving ? urgencyOf(task, now) : 'none';
  // One rule per thing: the card is the Body/Mind/Soul colour, one light overlay over the whole card (border and inside) shows
  // difficulty (green easy -> red hard), and urgency is shown only by the blinking "!" gem in the corner, so the colours never stack into muddy mixes.
  // A colour variant chosen for the frame wins over the category colour (otherwise the tint would paint over it): then only the
  // light difficulty overlay is added.
  const mainFrame = useAppState(st => st.settings.frameTheme);
  const variant = (!task.completed && !!group) || resolveFrame(theme, mainFrame, '', '').hue !== 0;
  const cat = open && !variant ? CATEGORY_TINT[task.category] : null;
  const diff = difficultyTint(task.difficulty);
  const tinted = useTintedFrame(theme, cat, variant && open ? diff : cat, open ? (variant
    ? { centre: 0.18 }
    : { ringMix: [[diff, 0.2]], centreMix: [[diff, 0.2]] }) : {});   // the same light overlay over border and inside
  const style = { ...(tinted ? { '--frame': tinted } : {}), ...(leaving ? fxVars('task', task.experienceReward) : {}) } as React.CSSProperties;
  return (
    <PixelFrame theme={theme} scale={1} style={style} data-flip={task.id} className={`task ${task.completed ? 'done' : ''} ${urgency !== 'none' ? `urg-${urgency}` : ''} ${leaving ? (stay ? 'fx-hop' : 'fx-leave') : ''} ${compact ? 'compact' : ''} ${expanded ? 'is-open' : ''}`}>
      {urgency !== 'none' && <span className="urg-gem" role="img" aria-label={t(urgency === 'overdue' ? 'urgentLate' : 'urgentSoon')}><Chip color={URGENCY_TINT[urgency]}>!</Chip></span>}
      <div className="task-head">
        <span className="fx-anchor">
          <PixelCheckbox checked={task.completed || leaving} ariaLabel={`${task.completed ? t('uncompleteTask') : t('completeTask')}: ${task.title}`} onChange={() => (task.completed ? actions.uncompleteTask(task.id) : onComplete())} label="" />
          {leaving && <Sparkles count={task.experienceReward} />}
        </span>
        <button className="task-title" onClick={() => setExpanded(e => !e)} disabled={leaving} aria-expanded={expanded} aria-controls={moreId}>{task.title}</button>
      </div>
      <div id={moreId} className={`task-more ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="task-more-in">
          <Icon name={`${task.category.toLowerCase()}_active`} size={16} alt={task.category} />
          <p className={task.description ? 'task-desc' : 'task-desc muted'}>{task.description || t('noDescription')}</p>
          <button type="button" className="task-edit" aria-label={t('taskDetails')} tabIndex={expanded ? 0 : -1} onClick={() => navigate(`/tasks/${task.id}`)}><Icon name="target" size={16} /></button>
          {open && <button type="button" className="task-edit" aria-label={t('edit')} tabIndex={expanded ? 0 : -1} onClick={onEdit}><Icon name="pencil_yellow" size={16} /></button>}
        </div>
      </div>
      <div className="row wrap chips">
        <Chip color={p.bg} border={p.border}>{t(PRIORITY_KEY[task.priority])}</Chip>
        <Chip color={DIFFICULTY_COLORS[task.difficulty]}>D{task.difficulty}</Chip>
        {task.dueDate != null && <Chip color={overdue ? 'var(--error)' : 'var(--border-2)'} border={overdue ? '#a04848' : undefined}>{overdue ? `${t('late')} ` : ''}{fmtDate(task.dueDate, locale)}</Chip>}
        {task.estimatedDuration != null && <Chip>{task.estimatedDuration}m</Chip>}
        <Chip color="#b6a432">{task.experienceReward} XP</Chip>
        {(task.completionCount ?? 0) >= 2 && <Chip color="var(--info)">×{task.completionCount}</Chip>}
        {group && <Chip color={group.frame === 'gold' ? '#b6a432' : 'var(--bg-3)'}>{group.name}</Chip>}
        {task.tags.map(t => <Chip key={t} color="var(--bg-3)">#{t}</Chip>)}
      </div>
    </PixelFrame>
  );
}

const CATS: [Category | 'ALL', Key][] = [['ALL', 'all'], ['BODY', 'body'], ['MIND', 'mind'], ['SOUL', 'soul']];
const SORTS: [TaskSort, Key][] = [['newest', 'sortNew'], ['due', 'sortDue'], ['priority', 'sortPrio'], ['difficulty', 'sortDiff'], ['created', 'sortCreatedDate'], ['none', 'noSort']];

export function Tasks() {
  const { t } = useI18n();
  const tasks = useAppState(s => s.tasks);
  const tutorialSeen = useAppState(s => s.user.tutorialSeen);
  const now = useNow(30_000);
  const [category, setCategory] = useState<Category | 'ALL'>('ALL');
  const [sort, setSort] = useState<TaskSort>('newest');
  const [tag, setTag] = useState<string | null>(null);
  const [quick, setQuick] = useState('');
  const [managing, setManaging] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [managingCats, setManagingCats] = useState(false);
  const cats = useAppState(s => s.categories);
  const activeGroup = group && cats.some(c => c.id === group) ? group : null;
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);   // the task whose completion animation is playing
  const flip = useFlip<HTMLDivElement>();
  // Play the glow-and-sparkles effect and let the card fling away first, then complete it; the cards below glide up into its place.
  const complete = (task: Task) => {
    if (leaving) return;
    if (prefersReducedMotion()) { actions.completeTask(task.id); return; }
    setLeaving(task.id);
    setTimeout(() => { flip.mark(task.id); actions.completeTask(task.id); setLeaving(null); }, fxDuration(task.experienceReward));
  };

  const tags = tagCounts(tasks);
  const activeTag = tag && tags.some(x => x.tag === tag) ? tag : null;   // a tag that no longer exists filters nothing
  const presets = quickPresets(tasks).filter(p => !tasks.some(x => !x.completed && x.title.trim().toLowerCase() === p.title.trim().toLowerCase()));   // not while the same chore is already open
  const { open, done } = viewTasks(tasks, { category, sort, showCompleted, tag: activeTag, group: activeGroup });
  const doneCount = tasks.filter(x => x.completed).length;

  return (
    <div className="screen" ref={flip.ref}>
      <div className="row between">
        <h1 className="title">{t('chatTasks')}</h1>
        <PixelButton scale={1} onClick={() => setEditing('new')}>{t('newButton')}</PixelButton>
      </div>

      <div className="row wrap" role="group" aria-label={t('categoryFilter')}>
        {CATS.map(([c, k]) => (
          <ChipButton key={c} cat={c.toLowerCase() as 'all' | 'body' | 'mind' | 'soul'} on={category === c} onClick={() => setCategory(c)}>{c === 'ALL' ? t(k) : t(k).toUpperCase()}</ChipButton>
        ))}
      </div>
      <div className="row wrap" role="group" aria-label={t('sort')}>
        <span className="muted small">{t('sort')}</span>
        {SORTS.map(([k, label]) => (
          <button key={k} className={`seg ${sort === k ? 'on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{t(label)}</button>
        ))}
      </div>

      <form className="row wrap" onSubmit={e => { e.preventDefault(); const v = quick.trim(); if (!v) return; actions.addTask({ title: v.slice(0, 80), category: category === 'ALL' ? 'BODY' : category, priority: 'MEDIUM', difficulty: 2, ...(activeTag ? { tags: [activeTag] } : {}) }); setQuick(''); }}>
        <input value={quick} maxLength={80} onChange={e => setQuick(e.target.value)} placeholder={t('quickAddPlaceholder')} aria-label={t('quickAdd')} style={{ flex: 1, minWidth: 0 }} />
        <button type="submit" className="seg on" disabled={!quick.trim()}>{t('quickAdd')}</button>
      </form>
      {presets.length > 0 && (
        <div className="row wrap" role="group" aria-label={t('quickPresets')}>
          <span className="muted small">{t('quickPresets')}</span>
          {presets.map(p => <button key={p.title} className="seg" title={`×${p.count}`} onClick={() => actions.addTask({ title: p.title, category: p.category, priority: p.priority, difficulty: p.difficulty, tags: p.tags })}>+ {p.title}</button>)}
        </div>
      )}

      {tags.length > 0 && (
        <div className="row wrap" role="group" aria-label={t('tagFilter')}>
          <span className="muted small">{t('tagFilter')}</span>
          <button className={`seg ${!activeTag ? 'on' : ''}`} aria-pressed={!activeTag} onClick={() => setTag(null)}>{t('allTags')}</button>
          {tags.slice(0, 12).map(x => <button key={x.tag} className={`seg ${activeTag === x.tag ? 'on' : ''}`} aria-pressed={activeTag === x.tag} onClick={() => setTag(activeTag === x.tag ? null : x.tag)}>#{x.tag}</button>)}
          <button className="seg" onClick={() => setManaging(true)}>{t('manageTags')}</button>
        </div>
      )}

      <div className="row wrap" role="group" aria-label={t('customCategory')}>
        <span className="muted small">{t('customCategory')}</span>
        {cats.length > 0 && <button className={`seg ${!activeGroup ? 'on' : ''}`} aria-pressed={!activeGroup} onClick={() => setGroup(null)}>{t('allTags')}</button>}
        {cats.map(c => <button key={c.id} className={`seg ${activeGroup === c.id ? 'on' : ''}`} aria-pressed={activeGroup === c.id} onClick={() => setGroup(activeGroup === c.id ? null : c.id)}>{c.name}</button>)}
        <button className="seg" onClick={() => setManagingCats(true)}>{t('manageCategories')}</button>
      </div>

      {open.length === 0 && (
        <PixelFrame theme="app" scale={1} className="card">
          <p className="muted">{tasks.length === 0 ? t('createFirstTask') : t('nothingOpen')}</p>
          {tasks.length === 0 && <div className="row"><PixelButton scale={1} onClick={() => navigate('/start')}>{t('startHere')}</PixelButton></div>}
        </PixelFrame>
      )}
      <div className="list cards">
        {open.map(x => <TaskCard key={x.id} task={x} now={now} onEdit={() => setEditing(x)} onComplete={() => complete(x)} leaving={leaving === x.id} />)}
      </div>

      {doneCount > 0 && (
        <PixelCheckbox checked={showCompleted} onChange={setShowCompleted} label={t('showCompleted', { n: doneCount })} />
      )}
      <div className="list cards">
        {done.map(x => <TaskCard key={x.id} task={x} now={now} onEdit={() => {}} onComplete={() => {}} leaving={false} />)}
      </div>

      {!tutorialSeen && tasks.length === 0 && !editing && <FirstTaskTutorial />}
      {managingCats && <CategoryManager onClose={() => setManagingCats(false)} />}
      {managing && <TagManager onClose={() => setManaging(false)} />}
      {editing && <TaskForm task={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
