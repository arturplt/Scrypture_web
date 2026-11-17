import { useState } from 'react';
import { CATEGORY_FRAMES, categoryFrameId, DEFAULT_CATEGORY_FRAME, MAX_CATEGORIES, MAX_CATEGORY_NAME, categoryCounts, categoryNameFree } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { Modal } from '../ui/misc';
import { PixelButton } from '../ui/PixelButton';
import { PixelFrame } from '../ui/PixelFrame';
import { useT } from '../i18n/useT';
import { frameOr } from '../ui/themes';
import './categories.css';

/** Your own task categories: a name and a frame for the cards. Add, rename, change the frame, or delete (its tasks keep going without one). */
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const cats = useAppState(s => s.categories);
  const dialog = useAppState(s => s.settings.elements.manageDialog);
  const tasks = useAppState(s => s.tasks);
  const habits = useAppState(s => s.habits);
  const rows = categoryCounts(cats, tasks, habits);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [frame, setFrame] = useState(DEFAULT_CATEGORY_FRAME);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const start = (id: string | 'new', n = '', f = DEFAULT_CATEGORY_FRAME) => { setEditing(id); setName(n); setFrame(f); setError(false); };
  const save = () => {
    const ok = editing === 'new' ? actions.addCategory(name, frame) !== null : !!editing && actions.updateCategory(editing, { name, frame });
    if (ok) setEditing(null); else setError(true);
  };
  const free = categoryNameFree(cats, name, editing && editing !== 'new' ? editing : undefined);
  return (
    <Modal open onClose={onClose} theme={frameOr(dialog, 'wood_gold_gem')} title={t('manageCategories')}>
      {rows.length === 0 && editing !== 'new' && <p className="muted">{t('noCategories')}</p>}
      <div className="list">
        {rows.map(c => editing === c.id ? null : (
          <div key={c.id} className="row between wrap cat-row">
            <span className="row"><PixelFrame theme={categoryFrameId(c.frame)} scale={1} className="cat-swatch" /><span>{c.name} <span className="muted small">({c.count})</span></span></span>
            {confirm === c.id
              ? <span className="row"><button type="button" className="seg on" onClick={() => { actions.deleteCategory(c.id); setConfirm(null); }}>{t('confirmDeleteCategory')}</button><button type="button" className="seg" onClick={() => setConfirm(null)}>{t('cancel')}</button></span>
              : <span className="row"><button type="button" className="seg" onClick={() => start(c.id, c.name, c.frame)}>{t('edit')}</button><button type="button" className="seg" onClick={() => setConfirm(c.id)}>{t('delete')}</button></span>}
          </div>
        ))}
      </div>
      {editing ? (
        <form className="form" onSubmit={e => { e.preventDefault(); if (free) save(); }}>
          <label className="field">{t('categoryName')}
            <input autoFocus value={name} maxLength={MAX_CATEGORY_NAME} onChange={e => { setName(e.target.value); setError(false); }} />
          </label>
          <div className="field">{t('categoryFrame')}
            <div className="cat-frames" role="group" aria-label={t('categoryFrame')}>
              {CATEGORY_FRAMES.map(f => <PixelFrame key={f} as="button" theme={categoryFrameId(f)} scale={1} className={`cat-pick ${frame === f ? 'on' : ''}`} aria-pressed={frame === f} aria-label={f.replace(/_/g, ' ')} onClick={e => { e.preventDefault(); setFrame(f); }} />)}
            </div>
          </div>
          {(error || (name.trim() && !free)) && <p className="small" role="alert">{t('categoryNameTaken')}</p>}
          <div className="row">
            <PixelButton scale={1} type="submit" disabled={!free}>{t('save')}</PixelButton>
            <PixelButton scale={1} variant="red" type="button" onClick={() => setEditing(null)}>{t('cancel')}</PixelButton>
          </div>
        </form>
      ) : (
        <div className="row">
          <PixelButton scale={1} disabled={cats.length >= MAX_CATEGORIES} onClick={() => start('new')}>{t('addCategory')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={onClose}>{t('close')}</PixelButton>
        </div>
      )}
    </Modal>
  );
}
