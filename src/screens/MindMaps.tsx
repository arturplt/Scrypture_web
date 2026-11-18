import { useState } from 'react';
import { MAX_MIND_MAPS } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { NameDialog } from '../ui/NameDialog';
import { Modal } from '../ui/Modal';
import './mindmap.css';

export const mindMapPath = (id: string) => `/apps/mindmap/${id}`;

/** The saved mind maps: open, rename, delete, or start a new one (Android's MindMapListScreen). */
export function MindMaps() {
  const { t } = useI18n();
  const maps = useAppState(s => s.mindMaps.list);
  const [naming, setNaming] = useState<{ id: string | null } | null>(null);   // id null = a new map
  const [deleting, setDeleting] = useState<string | null>(null);
  const full = maps.length >= MAX_MIND_MAPS;
  const renamed = naming?.id ? maps.find(m => m.id === naming.id) : undefined;
  const doomed = maps.find(m => m.id === deleting);

  const submit = (name: string) => {
    const id = naming?.id;
    setNaming(null);
    if (id) { actions.updateMindMap(id, { name }); return; }
    const made = actions.createMindMap(name);
    if (made) navigate(mindMapPath(made));
  };

  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('mindMap')}</h1>
      <div className="muted small">{t('mindMapHint')}</div>
      <div className="row"><PixelButton scale={1} disabled={full} onClick={() => setNaming({ id: null })}>{t('mmNew')}</PixelButton></div>
      {full && <div className="muted small" role="status">{t('mmFull', { n: MAX_MIND_MAPS })}</div>}

      <PixelFrame theme="gold_thick" scale={1} className="card">
        <h2 className="subtitle">{t('mmMaps')} ({maps.length}/{MAX_MIND_MAPS})</h2>
        {maps.length === 0 && <div className="muted small">{t('mmNone')}</div>}
        {[...maps].sort((a, b) => b.updatedAt - a.updatedAt).map(m => (
          <div key={m.id} className="row between mm-row">
            <div className="mm-row-name"><strong>{m.name}</strong><div className="muted small">{t('mmCount', { n: m.nodes.length, l: m.links.length })}</div></div>
            <div className="row">
              <PixelButton scale={1} onClick={() => navigate(mindMapPath(m.id))}>{t('openApp')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => setNaming({ id: m.id })}>{t('mmRename')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => setDeleting(m.id)}>{t('delete')}</PixelButton>
            </div>
          </div>
        ))}
      </PixelFrame>

      <NameDialog open={!!naming} title={t('mmName')} initial={renamed?.name ?? t('mmNewName')} okLabel={naming?.id ? t('mmSave') : t('mmCreate')} cancelLabel={t('cancel')}
        onSubmit={submit} onClose={() => setNaming(null)} />
      <Modal open={!!doomed} onClose={() => setDeleting(null)} title={t('delete')} theme="app">
        <p className="small mm-ask">{t('mmDeleteAsk', { name: doomed?.name ?? '' })}</p>
        <div className="row">
          <PixelButton scale={1} variant="red" onClick={() => { if (deleting) actions.deleteMindMap(deleting); setDeleting(null); }}>{t('delete')}</PixelButton>
          <PixelButton scale={1} onClick={() => setDeleting(null)}>{t('cancel')}</PixelButton>
        </div>
      </Modal>
    </div>
  );
}
