import { useState } from 'react';
import { isOverdue } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { back, navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Icon } from '../ui/misc';
import { DIFFICULTY_COLORS, PRIORITY_COLORS } from '../ui/colors';
import { PRIORITY_KEY } from '../i18n';
import { useI18n } from '../i18n/useT';
import { TaskForm } from './TaskForm';

/** One task in full: description, difficulty, rewards, how often it was done, and previous / next (open tasks first, newest first). */
export function TaskDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const tasks = useAppState(s => s.tasks);
  const now = useNow(30_000);
  const [editing, setEditing] = useState(false);
  const task = tasks.find(x => x.id === id);

  if (!task) return (
    <div className="screen">
      <h1 className="title">{t('chatTasks')}</h1>
      <p className="muted">{t('taskGone')}</p>
      <PixelButton scale={1} onClick={() => navigate('/tasks')}>{t('back')}</PixelButton>
    </div>
  );

  const order = [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt);
  const at = order.findIndex(x => x.id === id), prev = order[at - 1], next = order[at + 1];
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const p = PRIORITY_COLORS[task.priority], late = isOverdue(task, now);
  const times = task.completionCount ?? 0;
  const sr = task.statRewards;

  return (
    <div className="screen narrow">
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => back('/tasks')}>{t('back')}</PixelButton>
        {!task.completed && <PixelButton scale={1} onClick={() => setEditing(true)}>{t('edit')}</PixelButton>}
      </div>
      <h1 className="title" style={{ overflowWrap: 'anywhere' }}>{task.title}</h1>
      <div className="row"><Icon name={`${task.category.toLowerCase()}_active`} size={32} alt={task.category} /><span className="muted small">{task.completed ? t('chatTaskCompleted') : ''}</span></div>

      <PixelFrame theme="app" scale={1} className="card">
        <p className={task.description ? 'task-desc' : 'task-desc muted'} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.description || t('noDescription')}</p>
      </PixelFrame>

      <div className="row wrap chips">
        <Chip color={p.bg} border={p.border}>{t(PRIORITY_KEY[task.priority])}</Chip>
        <Chip color={DIFFICULTY_COLORS[task.difficulty]}>D{task.difficulty}</Chip>
        {task.estimatedDuration != null && <Chip>{task.estimatedDuration}m</Chip>}
        {task.tags.map(g => <Chip key={g} color="var(--bg-3)">#{g}</Chip>)}
      </div>
      <div className="muted small">{task.dueDate != null ? <span style={late ? { color: 'var(--error)' } : undefined}>{t('dueOn', { date: date(task.dueDate) })}</span> : t('noDue')}</div>

      <div className="row stats">
        <PixelFrame theme="app" scale={1} className="stat-card"><div className="muted small">{t('rewardsLabel').toUpperCase()}</div><div className="big">{task.experienceReward} XP</div>
          <div className="muted small">{[sr.body && `${t('body')} +${sr.body}`, sr.mind && `${t('mind')} +${sr.mind}`, sr.soul && `${t('soul')} +${sr.soul}`].filter(Boolean).join(' · ')}</div></PixelFrame>
        <PixelFrame theme="green_gold_ornamental" scale={1} className="stat-card"><div className="muted small">{t('doneTimes', { n: times }).toUpperCase()}</div>
          <div className="muted small">{task.lastCompletedAt ? t('lastDone', { date: date(task.lastCompletedAt) }) : t('neverDone')}</div></PixelFrame>
      </div>

      {!task.completed
        ? <PixelButton onClick={() => actions.completeTask(task.id)}>{t('completeTask')}</PixelButton>
        : <PixelButton onClick={() => actions.uncompleteTask(task.id)}>{t('uncompleteTask')}</PixelButton>}

      <div className="row between">
        <PixelButton scale={1} disabled={!prev} onClick={() => prev && navigate(`/tasks/${prev.id}`)}>{'<'} {t('prevTask')}</PixelButton>
        <PixelButton scale={1} disabled={!next} onClick={() => next && navigate(`/tasks/${next.id}`)}>{t('nextTask')} {'>'}</PixelButton>
      </div>
      {editing && <TaskForm task={task} onClose={() => setEditing(false)} />}
    </div>
  );
}
