import { useState } from 'react';
import { CATEGORY_FRAMES, categoryFrameId, DEFAULT_CATEGORY_FRAME, MAX_CATEGORIES, MAX_CATEGORY_NAME, categoryNameFree } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { PixelFrame } from '../ui/PixelFrame';
import { useT } from '../i18n/useT';
import './categories.css';

/** The category row of the task and habit forms: pick one (or none) and make a new one on the spot, with a name and a frame. */
export function CategoryPicker({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const t = useT();
  const cats = useAppState(s => s.categories);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [frame, setFrame] = useState(DEFAULT_CATEGORY_FRAME);
  const free = categoryNameFree(cats, name);
  const add = () => {
    if (!free) return;
    const id = actions.addCategory(name, frame);
    if (id) { onChange(id); setAdding(false); setName(''); }
  };
  return (
    <div className="field">{t('customCategory')}
      <div className="row wrap" role="group" aria-label={t('customCategory')}>
        <button type="button" className={`seg ${!value ? 'on' : ''}`} aria-pressed={!value} onClick={() => onChange(undefined)}>{t('noCustomCategory')}</button>
        {cats.map(c => <button type="button" key={c.id} className={`seg ${value === c.id ? 'on' : ''}`} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>{c.name}</button>)}
        {!adding && cats.length < MAX_CATEGORIES && <button type="button" className="seg" onClick={() => setAdding(true)}>+ {t('addCategory')}</button>}
      </div>
      {adding && (
        <div className="cat-new">
          <input value={name} maxLength={MAX_CATEGORY_NAME} aria-label={t('categoryName')} placeholder={t('categoryName')} autoFocus
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <div className="cat-frames" role="group" aria-label={t('categoryFrame')}>
            {CATEGORY_FRAMES.map(f => <PixelFrame key={f} as="button" theme={categoryFrameId(f)} scale={1} className={`cat-pick ${frame === f ? 'on' : ''}`} aria-pressed={frame === f} aria-label={f.replace(/_/g, ' ')} onClick={e => { e.preventDefault(); setFrame(f); }} />)}
          </div>
          {name.trim() && !free && <p className="small" role="alert">{t('categoryNameTaken')}</p>}
          <div className="row">
            <button type="button" className="seg on" disabled={!free} onClick={add}>{t('save')}</button>
            <button type="button" className="seg" onClick={() => { setAdding(false); setName(''); }}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
