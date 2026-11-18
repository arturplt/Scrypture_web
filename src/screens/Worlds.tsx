import { useEffect, useState } from 'react';
import { enterWorldFromHome } from './worldEntry';
import { MAX_WORLDS, seedFrom } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelCheckbox } from '../ui/misc';
import { Icon } from '../ui/misc';

/** Bóbr world list (Android's WorldListScreen): make a world from a name and a seed, open it, delete it. */
export function Worlds() {
  useEffect(() => enterWorldFromHome(false), []);   // coming through the list: closing a world comes back here
  const { t, lang } = useI18n();
  const worlds = useAppState(s => s.worlds.list);
  const [name, setName] = useState('');
  const [seedText, setSeedText] = useState('');
  const [note, setNote] = useState('');
  const [lake, setLake] = useState(false), [coniston, setConiston] = useState(false);
  const create = () => {
    const seed = seedText.trim() ? (/^\d+$/.test(seedText.trim()) ? Number(seedText.trim()) >>> 0 : seedFrom(seedText.trim())) : Math.floor(Math.random() * 4294967296);
    const id = actions.createWorld(name.trim() || t('worldDefaultName', { n: worlds.length + 1 }), seed, lake ? 'lakedistrict' : 'procedural', coniston ? 'coniston' : 'lakes');
    if (!id) { setNote(t('worldFull')); return; }
    navigate(`/games/paperplane/play/${id}`);
  };
  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/games')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('world')}</h1>
      <div className="muted small">{t('worldHint')}</div>
      <PixelFrame theme="gold_thick" scale={1} className="card">
        <h2 className="subtitle">{t('worldNew')}</h2>
        <input className="field" type="text" maxLength={40} value={name} placeholder={t('worldName')} aria-label={t('worldName')} onChange={e => setName(e.target.value)} />
        <input className="field" type="text" maxLength={40} value={seedText} placeholder={t('worldSeed')} aria-label={t('worldSeed')} onChange={e => setSeedText(e.target.value)} />
        <div className="muted small">{t('worldSeedHint')}</div>
        <PixelCheckbox big checked={lake} onChange={setLake} label={t('worldLake')} />
        {lake && <PixelCheckbox big checked={coniston} onChange={setConiston} label={t('worldLakeConiston')} />}
        {lake && <div className="muted small">{t(coniston ? 'worldLakeCreditLidar' : 'worldLakeCredit')}</div>}
        <PixelButton scale={1} onClick={create}>{t('worldCreate')}</PixelButton>
        {note && <div role="status" className="muted small">{note}</div>}
      </PixelFrame>
      <PixelFrame theme="gold_thick" scale={1} className="card">
        <h2 className="subtitle">{t('worldList')} ({worlds.length}/{MAX_WORLDS})</h2>
        {worlds.length === 0 && <div className="muted small">{t('worldNone')}</div>}
        {[...worlds].sort((a, b) => b.playedAt - a.playedAt).map(w => (
          <div key={w.id} className="row between world-item">
            <div className="row"><Icon name="home" size={32} alt="" /><div><strong>{w.name}</strong>
              <div className="muted small">{t('worldSeedIs', { seed: w.seed })} - {t('worldChanges', { n: w.changes.length })} - {new Date(w.playedAt).toLocaleDateString(lang === 'PL' ? 'pl-PL' : 'en-GB')}</div></div></div>
            <div className="row">
              <PixelButton scale={1} onClick={() => navigate(`/games/paperplane/play/${w.id}`)}>{t('worldOpen')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => actions.deleteWorld(w.id)}>{t('delete')}</PixelButton>
            </div>
          </div>
        ))}
      </PixelFrame>
    </div>
  );
}
