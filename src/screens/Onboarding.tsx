import { useEffect, useState } from 'react';
import { actions, useAppState } from '../data/hooks';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { useT } from '../i18n/useT';
import { LANGS, LANG_NAMES, type Key } from '../i18n';
import { PenScene } from '../ui/PenScene';

type Page = { kind: 'language' | 'name' | 'story'; title: Key; message: Key };
const PAGES: Page[] = [
  { kind: 'language', title: 'chooseYourLanguage', message: 'chooseYourLanguageMessage' },
  { kind: 'name', title: 'whatsYourName', message: 'whatsYourNameMessage' },
  { kind: 'story', title: 'welcomeBuilder', message: 'welcomeBuilderMessage' },
  { kind: 'story', title: 'buildYourDam', message: 'buildYourDamMessage' },
  { kind: 'story', title: 'levelUpTitle', message: 'levelUpMessage' },
  { kind: 'story', title: 'grimoriumTitle', message: 'grimoriumMessage' },
  { kind: 'story', title: 'trackYourProgress', message: 'trackYourProgressMessage' },
];

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Typewriter text; tap it to reveal everything at once. */
function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(reduceMotion() ? text.length : 0);
  useEffect(() => {
    if (reduceMotion()) { setN(text.length); return; }
    setN(0);
    const timer = setInterval(() => setN(v => { if (v >= text.length) { clearInterval(timer); return v; } return v + 1; }), 25);
    return () => clearInterval(timer);
  }, [text]);
  return <p className="story" onClick={() => setN(text.length)} aria-label={text}>{text.slice(0, n)}<span className="muted">{n < text.length ? '_' : ''}</span></p>;
}

export function Onboarding() {
  const t = useT();
  const language = useAppState(s => s.settings.language);
  const [page, setPage] = useState(0);
  const [name, setName] = useState('');
  const [say, setSay] = useState<string | null>(null);   // Bóbr's reply to a tap on the locked Latin button
  const clean = name.trim();
  const p = PAGES[page];
  const last = page === PAGES.length - 1;
  const canNext = p.kind !== 'name' || clean.length > 0;
  const title = say ?? t(p.title, { name: clean || 'Builder' });

  function next() {
    if (!canNext) return;
    if (p.kind === 'name') actions.setUser({ name: clean });
    if (last) { actions.setUser({ onboarded: true }); navigate('/tasks'); return; }
    setSay(null); setPage(page + 1);
  }

  return (
    <div className="onboarding">
      <PixelFrame theme="green_bev" scale={1} className="ob-sprite">
        <PenScene />
        <PixelFrame theme="green_bev" scale={1} className="ob-bubble" role="heading" aria-level={1}>{title}</PixelFrame>
        <img className="pixel ob-bobr" src="/assets/raw/bobr_ancient.png" alt="Ancient Bóbr" />
      </PixelFrame>
      <PixelFrame theme="green_bev" scale={1} className="ob-body">
        {p.kind !== 'language' && <Typewriter text={t(p.message)} />}
        {p.kind === 'name' && (
          <input value={name} maxLength={20} onChange={e => setName(e.target.value)} placeholder={t('enterYourName')} autoFocus
            onKeyDown={e => e.key === 'Enter' && next()} aria-label={t('enterYourName')} />
        )}
        {p.kind === 'language' && (
          <div className="langs" role="group" aria-label={t('language')}>
            {LANGS.map(l => {
              const locked = l === 'LA';   // Latin unlocks after 10 tasks, so it can never be picked here: Bóbr says so instead
              return (
                <button key={l} className={`seg ${language === l ? 'on' : ''}`} aria-pressed={language === l} aria-disabled={locked || undefined} style={locked ? { opacity: 0.55 } : undefined}
                  onClick={() => { if (locked) { setSay(t('latinLockedShort')); return; } setSay(null); actions.setSettings({ language: l }); }}>
                  {LANG_NAMES[l]}
                </button>
              );
            })}
          </div>
        )}
      </PixelFrame>

      <div className="row between">
        <PixelButton scale={1} size="compact" variant="red" disabled={page === 0} onClick={() => { setSay(null); setPage(page - 1); }}>{t('previous')}</PixelButton>
        <div className="dots" aria-hidden>{PAGES.map((_, i) => <span key={i} className={i === page ? 'on' : ''} />)}</div>
        <PixelButton scale={1} size="compact" disabled={!canNext} onClick={next}>{last ? t('begin') : t('next')}</PixelButton>
      </div>
    </div>
  );
}
