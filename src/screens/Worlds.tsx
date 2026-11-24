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

const KINDS = [['procedural', 'worldKindFlat'], ['terraced', 'worldKindHills'], ['lakedistrict', 'worldKindLake']] as const;
/** Bóbr world list (Android's WorldListScreen): make a world from a name and a seed, open it, delete it. */
export function Worlds() {
  useEffect(() => enterWorldFromHome(false), []);   // coming through the list: closing a world comes back here
  const { t, lang } = useI18n();
  const worlds = useAppState(s => s.worlds.list);
  const [name, setName] = useState('');
  const [seedText, setSeedText] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'procedural' | 'terraced' | 'lakedistrict'>('procedural'), [coniston, setConiston] = useState(false), [stepped, setStepped] = useState(false);   // (flat, hills or the Lake District: one of the three)
  const lake = kind === 'lakedistrict';
  const create = () => {
    const seed = seedText.trim() ? (/^\d+$/.test(seedText.trim()) ? Number(seedText.trim()) >>> 0 : seedFrom(seedText.trim())) : Math.floor(Math.random() * 4294967296);
    const real = lake && stepped;   // (the real map cut into terraces: a terraced world on the 25 m map, or on Coniston's 10 m one)
    const id = actions.createWorld(name.trim() || t('worldDefaultName', { n: worlds.length + 1 }), seed, real ? 'terraced' : kind, coniston ? 'coniston' : real ? 'lakes25' : 'lakes');
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
        <div className="langs" role="group" aria-label={t('worldKind')}>
          {KINDS.map(([k, label]) => <button key={k} className={`seg ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(label)}</button>)}
        </div>
        <div className="muted small">{t(kind === 'terraced' ? 'worldTerraced' : lake ? 'worldLake' : 'worldKindFlatHint')}</div>
        {lake && <PixelCheckbox big checked={coniston} onChange={setConiston} label={t('worldLakeConiston')} />}
        {lake && <PixelCheckbox big checked={stepped} onChange={setStepped} label={t('worldLakeTerraced')} />}
        {lake && stepped && <div className="muted small">{t('worldLakeTerracedHint')}</div>}
        {lake && <div className="muted small">{t(coniston ? 'worldLakeCreditLidar' : 'worldLakeCredit')}</div>}
        <PixelButton scale={1} onClick={create}>{t('worldCreate')}</PixelButton>
        {note && <div role="status" className="muted small">{note}</div>}
      </PixelFrame>
      <PixelFrame theme="gold_thick" scale={1} className="card">
        <h2 className="subtitle">{t('worldList')} ({worlds.length}/{MAX_WORLDS})</h2>
        {worlds.length === 0 && <div className="muted small">{t('worldNone')}</div>}
        {[...worlds].sort((a, b) => b.playedAt - a.playedAt).map(w => (
          <div key={w.id} className="row between world-item">
            <div className="row"><Icon name="home" size={32} alt="" /><div><strong>{w.name}</strong>{w.kind === 'terraced' && <span className="muted small"> [{t(w.map ? 'worldKindLakeTerraced' : 'worldKindHills')}]</span>}{w.kind === 'lakedistrict' && <span className="muted small"> [{t('worldKindLake')}]</span>}
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
