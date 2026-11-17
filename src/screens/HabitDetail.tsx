import { useState } from 'react';
import { completedToday, effectiveStreak } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { back, navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Icon } from '../ui/misc';
import { HabitForm } from './HabitForm';
import { useI18n } from '../i18n/useT';

export function HabitDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const habit = useAppState(s => s.habits.find(h => h.id === id));
  const now = useNow(30_000);
  const [editing, setEditing] = useState(false);

  if (!habit) return (
    <div className="screen">
      <h1 className="title">{t('habit')}</h1>
      <p className="muted">{t('habitGone')}</p>
      <PixelButton scale={1} onClick={() => navigate('/habits')}>{t('back')}</PixelButton>
    </div>
  );

  const done = completedToday(habit, now);
  const streak = effectiveStreak(habit, now);
  const last = habit.lastCompleted ? new Date(habit.lastCompleted).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) : t('never');

  return (
    <div className="screen narrow">
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => back('/habits')}>{t('back')}</PixelButton>
        <PixelButton scale={1} onClick={() => setEditing(true)}>{t('edit')}</PixelButton>
      </div>
      <h1 className="title" style={{ overflowWrap: 'anywhere' }}>{habit.title}</h1>
      <div className="row"><Icon name={`${habit.category.toLowerCase()}_active`} size={32} alt={habit.category} /><span className="muted small">{habit.frequency}</span></div>

      <div className="row stats">
        <PixelFrame theme="app" scale={1} className="stat-card"><div className="muted small">{t('streak').toUpperCase()}</div><div className="big">{streak}</div></PixelFrame>
        <PixelFrame theme="green_gold_ornamental" scale={1} className="stat-card"><div className="muted small">{t('best').toUpperCase()}</div><div className="big">{habit.bestStreak}</div></PixelFrame>
      </div>
      <div className="muted small">{t('lastDone', { date: last })}</div>
      {streak === 0 && habit.bestStreak > 0 && <div className="small" style={{ color: 'var(--body)' }}>{t('streakLost')}</div>}

      <PixelButton disabled={done} onClick={() => actions.completeHabit(habit.id)}>{done ? t('doneToday') : t('completeHabit')}</PixelButton>
      {editing && <HabitForm habit={habit} onClose={() => setEditing(false)} onDeleted={() => navigate('/habits')} />}
    </div>
  );
}
