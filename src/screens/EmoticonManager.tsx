import { useState } from 'react';
import { REPERTOIRE, emoticonGroups, EMOTICON_EXTRAS, matchesEmoticon, type Emoticon, EMOTICONS, isPlanned } from '../domain';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';

/** Every ASCII face Bóbr has or will have, grouped by the feeling it stands for. Tap a face to see it large. */
export function EmoticonManager() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Emoticon | null>(null);
  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('emoticons')}</h1>
      <div className="muted small">{t('emoticonsHint')}</div>
      {picked && (
        <PixelFrame theme="gold_thick" scale={1} className="card">
          <div className={`title${picked.fancy ? ' fancy-face' : ''}`} aria-live="polite">{picked.face}</div>
          <div className="small">{picked.note}{EMOTICON_EXTRAS.some(x => x.face === picked.face) ? '' : ` - ${picked.feeling.toLowerCase()}`}</div>
        </PixelFrame>
      )}
      <input type="search" value={q} aria-label={t('emoticonSearch')} placeholder={t('emoticonSearch')} onChange={e => setQ(e.target.value)} />
      {emoticonGroups().map(g => ({ ...g, faces: g.faces.filter(f => matchesEmoticon(q, f.face, f.note, g.feeling)) })).filter(g => g.faces.length > 0 || !q.trim()).map(g => (
        <PixelFrame key={g.feeling} theme="gold_thick" scale={1} className="card">
          <h2 className="subtitle">{g.feeling.toLowerCase()}{g.planned && <span className="muted small"> ({t('emoticonPlanned')})</span>}</h2>
          {!isPlanned(g.feeling) && <div className="muted small">{t('emoticonSpeed', { ms: EMOTICONS[g.feeling as keyof typeof EMOTICONS].ms })} - {t('emoticonAlso')}: {REPERTOIRE[g.feeling as keyof typeof REPERTOIRE].slice(1).map(f => f.toLowerCase()).join(', ')}</div>}
          <div className="row wrap">
            {g.faces.map(f => (
              <button key={f.face} type="button" className={`seg${picked?.face === f.face ? ' on' : ''}${f.fancy ? ' fancy-face' : ''}`} title={f.note} aria-label={`${f.face} ${f.note}`} onClick={() => setPicked(f)}>{f.face}</button>
            ))}
          </div>
        </PixelFrame>
      ))}
      {(['symbol', 'other'] as const).map(kind => {
        const items = EMOTICON_EXTRAS.filter(x => x.kind === kind && matchesEmoticon(q, x.face, ...x.names));
        if (items.length === 0) return null;
        return (
          <PixelFrame key={kind} theme="gold_thick" scale={1} className="card">
            <h2 className="subtitle">{t(kind === 'symbol' ? 'emoticonSymbols' : 'emoticonOther')}</h2>
            <div className="row wrap">
              {items.map(x => {
                const note = x.names.map(n => `(${n})`).join(' ');
                return <button key={x.face} type="button" className={`seg fancy-face${picked?.face === x.face ? ' on' : ''}`} title={note} aria-label={`${x.face} ${note}`} onClick={() => setPicked({ face: x.face, feeling: 'NEUTRAL', note, fancy: true })}>{x.face}</button>;
              })}
            </div>
          </PixelFrame>
        );
      })}
    </div>
  );
}
