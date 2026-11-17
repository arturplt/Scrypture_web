import { useState } from 'react';
import type { Category, Frequency, Habit } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { frameOr } from '../ui/themes';
import { Icon, Modal } from '../ui/misc';
import { PixelButton } from '../ui/PixelButton';
import { useT } from '../i18n/useT';

const CATS: Category[] = ['BODY', 'MIND', 'SOUL'];
const FREQS: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export function HabitForm({ habit, onClose, onDeleted }: { habit?: Habit; onClose: () => void; onDeleted?: () => void }) {
  const t = useT();
  const dialog = useAppState(s => s.settings.elements.habitDialog);
  const [title, setTitle] = useState(habit?.title ?? '');
  const [category, setCategory] = useState<Category>(habit?.category ?? 'BODY');
  const [frequency, setFrequency] = useState<Frequency>(habit?.frequency ?? 'DAILY');
  const [description, setDescription] = useState(habit?.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = title.trim().length > 0;

  function save() {
    if (!valid) return;
    if (habit) actions.updateHabit(habit.id, { title: title.trim(), category, frequency, description: description.trim() || undefined });
    else actions.addHabit({ title, category, frequency, description });
    onClose();
  }

  return (
    <Modal open onClose={onClose} theme={frameOr(dialog, 'wood_gold_gem')} title={habit ? t('editHabitTitle') : t('createNewHabit')}>
      <form className="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="form-body">
          <label className="field">{t('title')}
            <input autoFocus value={title} maxLength={60} onChange={e => setTitle(e.target.value)} placeholder={t('habitPlaceholder')} />
          </label>
          <div className="field">{t('category')}
            <div className="row">
              {CATS.map(c => (
                <button type="button" key={c} className={`catpick ${category === c ? 'on' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
                  <Icon name={`${c.toLowerCase()}_${category === c ? 'active' : 'inactive'}`} size={32} alt={c} />
                </button>
              ))}
            </div>
          </div>
          <div className="field">{t('frequency')}
            <div className="row wrap">
              {FREQS.map(f => (
                <button type="button" key={f} className={`seg ${frequency === f ? 'on' : ''}`} aria-pressed={frequency === f} onClick={() => setFrequency(f)}>{t(f.toLowerCase() as 'daily' | 'weekly' | 'monthly').toUpperCase()}</button>
              ))}
            </div>
          </div>
          <label className="field">{t('description')}
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="row wrap form-actions">
          <PixelButton type="submit" disabled={!valid} scale={1}>{habit ? t('update') : t('add')}</PixelButton>
          <PixelButton type="button" scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
          {habit && (confirmDelete
            ? <PixelButton type="button" scale={1} variant="red" onClick={() => { actions.deleteHabit(habit.id); onClose(); onDeleted?.(); }}>{t('sure')}</PixelButton>
            : <PixelButton type="button" scale={1} variant="red" onClick={() => setConfirmDelete(true)}>{t('delete')}</PixelButton>)}
        </div>
      </form>
    </Modal>
  );
}
