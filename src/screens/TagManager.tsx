import { useState } from 'react';
import { cleanTag, tagCounts } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { Modal } from '../ui/misc';
import { PixelButton } from '../ui/PixelButton';
import { useT } from '../i18n/useT';

/** Every tag in use, with how many tasks have it: rename (an existing name merges) or delete it from all tasks. */
export function TagManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const tasks = useAppState(s => s.tasks);
  const tags = tagCounts(tasks);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const save = () => { if (editing && cleanTag(name)) actions.renameTag(editing, name); setEditing(null); };
  return (
    <Modal open onClose={onClose} title={t('manageTags')}>
      {tags.length === 0 && <p className="muted">{t('noTags')}</p>}
      <div className="list">
        {tags.map(({ tag, count }) => (
          <div key={tag} className="row between wrap">
            {editing === tag ? (
              <form className="row" onSubmit={e => { e.preventDefault(); save(); }}>
                <input autoFocus value={name} maxLength={20} aria-label={t('renameTag')} onChange={e => setName(e.target.value)} />
                <button type="submit" className="seg on">{t('save')}</button>
              </form>
            ) : (
              <span>#{tag} <span className="muted small">({count})</span></span>
            )}
            {editing !== tag && (confirm === tag
              ? <span className="row"><button type="button" className="seg on" onClick={() => { actions.deleteTag(tag); setConfirm(null); }}>{t('confirmDeleteTag')}</button><button type="button" className="seg" onClick={() => setConfirm(null)}>{t('cancel')}</button></span>
              : <span className="row">
                  <button type="button" className="seg" onClick={() => { setEditing(tag); setName(tag); }}>{t('renameTag')}</button>
                  <button type="button" className="seg" onClick={() => setConfirm(tag)}>{t('deleteTag')}</button>
                </span>)}
          </div>
        ))}
      </div>
      <PixelButton scale={1} onClick={onClose}>{t('close')}</PixelButton>
    </Modal>
  );
}
