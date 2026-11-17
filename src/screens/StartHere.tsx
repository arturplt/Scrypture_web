import { useEffect, useState } from 'react';
import {
  FREQUENCY, PERIODS, STAT_ORDER, benchmarkXP, starterTaskInput, fmtMinutes, isHabitAdded, isTaskAdded, nextStarter, starterHabitsFor, starterTasksFor, timesDone,
  type Category, type Period, type StarterHabit, type StarterTask, type Task, type Topic,
} from '../domain';
import { actions, useAppState } from '../data/hooks';
import { back } from '../router';
import { useI18n } from '../i18n/useT';
import type { Key } from '../i18n';
import { PRIORITY_KEY } from '../i18n';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Icon } from '../ui/misc';
import { DIFFICULTY_COLORS, PRIORITY_COLORS } from '../ui/colors';

const TOPIC_KEY: Record<Topic, Key> = { home: 'home', garden: 'topicGarden', free: 'topicFree', career: 'career', skills: 'skills' };
const STAT_KEY: Record<Category, Key> = { BODY: 'body', MIND: 'mind', SOUL: 'soul' };
const PERIOD_KEY: Record<Period, Key> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };
/** what counts as easy for a beginner: difficulty 0-2 (15 minutes or less) */
const EASY_MAX = 2;
const EFFORT_KEY: Record<1 | 2 | 3, Key> = { 1: 'effortLight', 2: 'effortSteady', 3: 'effortBig' };

function Chevron({ open }: { open: boolean }) {
  return <img className="chev" src={`/assets/raw/${open ? 'arrow_stone_up' : 'arrow_stone_down'}.png`} alt="" />;
}

function TaskRow({ s, recommended = false, tasks, onAdd }: { s: StarterTask; recommended?: boolean; tasks: Task[]; onAdd: (s: StarterTask) => void }) {
  const { t } = useI18n();
  const title = t(s.title), added = isTaskAdded(s.id, title, tasks), done = timesDone(s.id, tasks), p = PRIORITY_COLORS[s.priority];
  return (
    <div className={`sh-row ${recommended ? 'next' : ''}`}>
      <div className="sh-main">
        <div className="sh-title">{recommended && <span className="sh-star" aria-hidden>★ </span>}{title}</div>
        <div className="muted small sh-desc">{t(s.desc)}</div>
        <div className="row wrap chips">
          {s.topic && <Chip color="var(--bg-3)">{t(TOPIC_KEY[s.topic]).toUpperCase()}</Chip>}
          <Chip color={p.bg} border={p.border}>{t(PRIORITY_KEY[s.priority])}</Chip>
          <Chip color={DIFFICULTY_COLORS[s.difficulty]}>D{s.difficulty}</Chip>
          <Chip color="var(--bg-3)">{benchmarkXP(s.difficulty)} XP</Chip>
          <Chip>{fmtMinutes(s.minutes)}</Chip>
          {done > 0 && <Chip color="var(--info)">{t('doneTimes', { n: done })}</Chip>}
        </div>
      </div>
      {added ? <span className="sh-added" aria-label={t('added')}>✓ {t('added')}</span>
        : <button type="button" className="seg on sh-add" onClick={() => onAdd(s)} aria-label={`${t('add')}: ${title}`}>+ {t('add')}</button>}
    </div>
  );
}

export function StartHere() {
  const { t } = useI18n();
  const tasks = useAppState(s => s.tasks);
  const habits = useAppState(s => s.habits);
  const [period, setPeriod] = useState<Period>('daily');
  const [intro, setIntro] = useState(false);
  const [open, setOpen] = useState<Partial<Record<Category, boolean>>>({});
  const [notice, setNotice] = useState('');
  const [topic, setTopic] = useState<Topic | 'all'>('all');
  const [easy, setEasy] = useState(false);
  const keep = (s: StarterTask) => (topic === 'all' || s.topic === topic) && (!easy || s.difficulty <= EASY_MAX);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(timer); }, [notice]);

  const titleOf = (s: StarterTask) => t(s.title);
  function addTask(s: StarterTask) {
    const title = titleOf(s);
    actions.addTask(starterTaskInput(s, t));
    setNotice(t('taskAdded', { taskName: title }));
  }
  function addAllEasy() {
    let n = 0;
    for (const stat of STAT_ORDER) for (const s of starterTasksFor(period, stat)) {
      if (s.difficulty <= EASY_MAX && (topic === 'all' || s.topic === topic) && !isTaskAdded(s.id, titleOf(s), tasks)) { actions.addTask(starterTaskInput(s, t)); n++; }
    }
    setNotice(t('addedN', { n }));
  }
  function addHabit(h: StarterHabit) {
    const name = t(h.name);
    actions.addHabit({ title: name, category: h.stat, frequency: FREQUENCY[h.period], origin: h.id });
    setNotice(t('habitAdded', { habitName: name }));
  }

  return (
    <div className="screen narrow">
      {notice && <div className="xp-toast" role="status" style={{ animationDuration: '2.4s' }}>{notice}</div>}
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => back('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('startHere').toUpperCase()}</h1>

      <div className="pickrow">
        <button type="button" className="pickrow-head" aria-expanded={intro} onClick={() => setIntro(v => !v)}>
          <span className="pickrow-label">{t('gettingStarted')}</span><Chevron open={intro} />
        </button>
        {intro && (
          <div className="pickrow-panel sh-intro">
            <p>{t('startIntro1')}</p><p className="muted">• {t('startIntro2')}</p><p className="muted">• {t('startIntro3')}</p><p className="muted">• {t('startIntro4')}</p>
          </div>
        )}
      </div>

      <div className="row wrap" role="group" aria-label={t('frequency')}>
        {PERIODS.map(p => (
          <button key={p} className={`seg ${period === p ? 'on' : ''}`} aria-pressed={period === p} onClick={() => setPeriod(p)}>{t(PERIOD_KEY[p]).toUpperCase()}</button>
        ))}
      </div>

      <div className="row wrap" role="group" aria-label={t('topicFilter')}>
        {(['all', 'home', 'garden', 'free', 'career', 'skills'] as const).map(k => (
          <button key={k} className={`seg ${topic === k ? 'on' : ''}`} aria-pressed={topic === k} onClick={() => setTopic(k)}>{(k === 'all' ? t('allTopics') : t(TOPIC_KEY[k])).toUpperCase()}</button>
        ))}
        <button className={`seg ${easy ? 'on' : ''}`} aria-pressed={easy} onClick={() => setEasy(v => !v)}>{t('easyOnly').toUpperCase()}</button>
      </div>
      <button type="button" className="seg on" onClick={addAllEasy}>+ {t('addAllEasy')}</button>

      <h2 className="subtitle">{t('suggestedTasks')}</h2>
      {STAT_ORDER.map(stat => {
        const list = starterTasksFor(period, stat).filter(keep), next = nextStarter(list, titleOf, tasks);
        const addedCount = list.filter(s => isTaskAdded(s.id, titleOf(s), tasks)).length, isOpen = !!open[stat];
        return (
          <PixelFrame key={stat} theme="app" scale={1} className="card sh-card">
            <button type="button" className="sh-head" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [stat]: !o[stat] }))}>
              <Icon name={`${stat.toLowerCase()}_active`} size={16} alt={t(STAT_KEY[stat])} />
              <span className="muted small">{t('startAddedCount', { n: addedCount, total: list.length })}</span>
              <Chevron open={isOpen} />
            </button>
            {next ? <TaskRow s={next} recommended tasks={tasks} onAdd={addTask} /> : <div className="small muted">{t('startAllAdded')}</div>}
            {isOpen && <div className="sh-list">{list.filter(s => s !== next).map(s => <TaskRow key={s.id} s={s} tasks={tasks} onAdd={addTask} />)}</div>}
          </PixelFrame>
        );
      })}

      <h2 className="subtitle">{t('suggestedHabits')}</h2>
      {STAT_ORDER.map(stat => (
        <PixelFrame key={stat} theme="app" scale={1} className="card sh-card">
          <div className="sh-head static"><Icon name={`${stat.toLowerCase()}_active`} size={16} alt={t(STAT_KEY[stat])} /></div>
          {starterHabitsFor(period, stat).map(h => {
            const added = isHabitAdded(h.id, t(h.name), habits);
            return (
              <div key={h.id} className="sh-row">
                <div className="sh-main"><div className="sh-title">{t(h.name)}</div><div className="row wrap chips"><Chip>{t(PERIOD_KEY[h.period]).toUpperCase()}</Chip><Chip color={DIFFICULTY_COLORS[[1, 4, 7][h.effort - 1]]}>{t(EFFORT_KEY[h.effort])}</Chip></div></div>
                {added ? <span className="sh-added" aria-label={t('added')}>✓ {t('added')}</span>
                  : <button type="button" className="seg on sh-add" onClick={() => addHabit(h)} aria-label={`${t('add')}: ${t(h.name)}`}>+ {t('add')}</button>}
              </div>
            );
          })}
        </PixelFrame>
      ))}

      <div className="row"><PixelButton scale={1} variant="red" onClick={() => back('/')}>{t('chatGoBack')}</PixelButton></div>
    </div>
  );
}
