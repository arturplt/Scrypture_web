import { useState } from 'react';
import { DIFFICULTY_XP, PRIORITY_XP, benchmarkFor, cleanTag, fmtMinutes, type Category, type Priority, type Task } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { frameOr } from '../ui/themes';
import { Modal } from '../ui/misc';
import { PixelButton } from '../ui/PixelButton';
import { DIFFICULTY_COLORS, PRIORITY_COLORS } from '../ui/colors';
import { Icon, PickBox } from '../ui/misc';
import { useT } from '../i18n/useT';
import { PRIORITY_KEY } from '../i18n';

const CATS: Category[] = ['BODY', 'MIND', 'SOUL'];
const PRIOS: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const toInput = (ms?: number) => { if (ms == null) return ''; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromInput = (v: string) => { if (!v) return undefined; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

/** `dueDate` is the day a new task starts with (the Planner adds tasks to the day you are looking at). */
export function TaskForm({ task, dueDate, onClose }: { task?: Task; dueDate?: number; onClose: () => void }) {
  const t = useT();
  const dialog = useAppState(s => s.settings.elements.taskDialog);
  const [title, setTitle] = useState(task?.title ?? '');
  const [category, setCategory] = useState<Category>(task?.category ?? 'BODY');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'MEDIUM');
  const [difficulty, setDifficulty] = useState(task?.difficulty ?? 3);
  const [description, setDescription] = useState(task?.description ?? '');
  const [due, setDue] = useState(toInput(task ? task.dueDate : dueDate));
  const [minutes, setMinutes] = useState(task?.estimatedDuration?.toString() ?? '');
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '');
  const cats = useAppState(s => s.categories);
  const [group, setGroup] = useState<string | undefined>(task?.group);
  // extra attributes the task also trains (each +1 stat); an existing task's are what its stat rewards hold beyond its own category
  const [extra, setExtra] = useState<Category[]>(() => (task ? CATS.filter(c => (task.statRewards[c.toLowerCase() as 'body' | 'mind' | 'soul'] ?? 0) - (c === task.category ? 1 : 0) > 0 && c !== task.category) : []));
  const extras = extra.filter(c => c !== category);
  const toggleExtra = (c: Category) => setExtra(x => (x.includes(c) ? x.filter(y => y !== c) : [...x, c]));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const xp = PRIORITY_XP[priority] + DIFFICULTY_XP[difficulty];
  const valid = title.trim().length > 0;
  const like = benchmarkFor(difficulty, category);   // the scale: what a task this hard looks like

  function save() {
    if (!valid) return;
    const fields = {
      title, category, priority, difficulty, coreAttributes: extras,
      description: description.trim() || undefined,
      dueDate: fromInput(due),
      estimatedDuration: minutes ? Math.max(1, parseInt(minutes, 10) || 0) || undefined : undefined,
      tags: [...new Set(tags.split(',').map(cleanTag).filter(Boolean))],
      group: group && cats.some(c => c.id === group) ? group : undefined,
    };
    if (task) actions.updateTask(task.id, fields); else actions.addTask(fields);
    onClose();
  }

  return (
    <Modal open onClose={onClose} theme={frameOr(dialog, 'wood_gold_gem')} title={task ? t('editTaskTitle') : t('createNewTask')}>
      <form className="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="form-body">
        <label className="field">{t('title')}
          <input autoFocus value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder={t('taskPlaceholder')} />
        </label>

        <div className="field">{t('category')}
          <div className="row">
            {CATS.map(c => (
              <button type="button" key={c} className={`catpick ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)} aria-pressed={category === c}>
                <Icon name={`${c.toLowerCase()}_${category === c ? 'active' : 'inactive'}`} size={32} alt={c} />
              </button>
            ))}
          </div>
        </div>

        <div className="field">{t('priority')}
          <div className="row wrap">
            {PRIOS.map(p => (
              <PickBox key={p} color={PRIORITY_COLORS[p].bg} selected={priority === p} onClick={() => setPriority(p)}>{t(PRIORITY_KEY[p])}</PickBox>
            ))}
          </div>
        </div>

        <div className="field">{t('difficulty')} {difficulty}
          <div className="row wrap">
            {DIFFICULTY_COLORS.map((c, i) => (
              <PickBox key={i} color={c} selected={difficulty === i} onClick={() => setDifficulty(i)}>{i}</PickBox>
            ))}
          </div>
          {like && <div className="muted small">{t('difficultyLike', { example: t(like.title), time: fmtMinutes(like.minutes) })}</div>}
        </div>

        <div className="field">{t('alsoTrains')}
          <div className="row wrap">
            {CATS.filter(c => c !== category).map(c => (
              <button type="button" key={c} className={`catpick ${extras.includes(c) ? 'on' : ''}`} onClick={() => toggleExtra(c)} aria-pressed={extras.includes(c)}>
                <Icon name={`${c.toLowerCase()}_${extras.includes(c) ? 'active' : 'inactive'}`} size={32} alt={c} />
              </button>
            ))}
          </div>
        </div>

        <div className="muted small">{extras.length
          ? t('rewardPreviewMulti', { xp, stat: [category, ...extras].map(c => t(c.toLowerCase() as 'body' | 'mind' | 'soul')).join(', ') })
          : t('rewardPreview', { xp, stat: t(category.toLowerCase() as 'body' | 'mind' | 'soul') })}</div>

        <label className="field">{t('dueDate')}
          <input type="date" value={due} onChange={e => setDue(e.target.value)} />
        </label>
        <label className="field">{t('estimatedMinutes')}
          <input inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder={t('optional')} />
        </label>
        {cats.length > 0 && (
          <div className="field">{t('customCategory')}
            <div className="row wrap" role="group" aria-label={t('customCategory')}>
              <button type="button" className={`seg ${!group ? 'on' : ''}`} aria-pressed={!group} onClick={() => setGroup(undefined)}>{t('noCustomCategory')}</button>
              {cats.map(c => <button type="button" key={c.id} className={`seg ${group === c.id ? 'on' : ''}`} aria-pressed={group === c.id} onClick={() => setGroup(c.id)}>{c.name}</button>)}
            </div>
          </div>
        )}
        <label className="field">{t('tags')}
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder={t('tagsPlaceholder')} />
        </label>
        <label className="field">{t('description')}
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </label>

        </div>

        <div className="row wrap form-actions">
          <PixelButton type="submit" disabled={!valid} scale={1}>{task ? t('update') : t('add')}</PixelButton>
          <PixelButton type="button" scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
          {task && (confirmDelete
            ? <PixelButton type="button" scale={1} variant="red" onClick={() => { actions.deleteTask(task.id); onClose(); }}>{t('sure')}</PixelButton>
            : <PixelButton type="button" scale={1} variant="red" onClick={() => setConfirmDelete(true)}>{t('delete')}</PixelButton>)}
        </div>
      </form>
    </Modal>
  );
}
