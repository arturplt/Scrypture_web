import { useRef, useState } from 'react';
import { BUZZ, canVibrate } from '../audio/haptics';
import { actions, useAppState } from '../data/hooks';
import { back, navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { CRT_LEVELS, DEFAULT_APPEARANCE, TEXT_SCALES, UI_SCALES } from '../domain';
import { useUi } from '../ui/useUi';
import { enterFullscreen, exitFullscreen, useFullscreen } from '../ui/fullscreen';
import { useT } from '../i18n/useT';
import { LANGS, LANG_NAMES, LATIN_UNLOCK_TASKS, isLatinUnlocked } from '../i18n';
import { signIn, signOut, signUp, syncNow, useCloud } from '../data/cloud';

/** Optional account: one save on every device. */
function CloudSection() {
  const t = useT();
  const c = useCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go(create: boolean) {
    setBusy(true); setMsg(null);
    if (create) { const r = await signUp(email, password); setMsg(r.error ? { ok: false, text: r.error } : r.confirm ? { ok: true, text: t('syncCheckMail') } : null); }
    else { const e = await signIn(email, password); if (e) setMsg({ ok: false, text: e }); }
    setBusy(false);
  }
  return (
    <section className="list">
      <h2 className="subtitle">{t('syncTitle')}</h2>
      {c.email ? (
        <>
          <div className="small" style={{ lineHeight: 1.6 }}>{t('syncSignedIn', { email: c.email })}</div>
          <div className="small" role="status" style={{ lineHeight: 1.6, color: c.phase === 'error' ? 'var(--body)' : undefined }}>
              {c.phase === 'syncing' ? t('syncBusy') : c.phase === 'error' ? t('syncFailed', { reason: c.error ?? '' }) : c.lastSyncedAt ? t('syncDone', { time: new Date(c.lastSyncedAt).toLocaleTimeString() }) : ''}
            </div>
          <div className="row wrap">
            <PixelButton scale={1} onClick={() => void syncNow()}>{t('syncNow')}</PixelButton>
            <PixelButton scale={1} variant="red" onClick={() => void signOut()}>{t('syncSignOut')}</PixelButton>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" style={{ lineHeight: 1.6 }}>{t('syncNote')}</p>
          <label className="field">{t('syncEmail')}
            <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} aria-label={t('syncEmail')} />
          </label>
          <label className="field">{t('syncPassword')}
            <input type="password" autoComplete="current-password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} aria-label={t('syncPassword')} />
          </label>
          <div className="row wrap">
            <PixelButton scale={1} onClick={() => void go(false)} disabled={busy || !email || password.length < 6}>{t('syncSignIn')}</PixelButton>
            <PixelButton scale={1} onClick={() => void go(true)} disabled={busy || !email || password.length < 6}>{t('syncSignUp')}</PixelButton>
          </div>
          {msg && <div className="small" role="status" style={{ color: msg.ok ? 'var(--soul)' : 'var(--body)', lineHeight: 1.6 }}>{msg.text}</div>}
        </>
      )}
    </section>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings() {
  const t = useT();
  const language = useAppState(s => s.settings.language);
  const tasksDone = useAppState(s => s.stats.totalTasksCompleted);
  const latinOpen = isLatinUnlocked(tasksDone);
  const device = useAppState(s => s.settings.device);
  const crt = useAppState(s => s.settings.crt);
  const volume = useAppState(s => s.settings.volume);
  const reduceMotion = useAppState(s => !!s.settings.reduceMotion);
  const highContrast = useAppState(s => !!s.settings.highContrast);
  const haptics = useAppState(s => s.settings.haptics !== false);
  const wantFullscreen = useAppState(s => s.settings.fullscreen);
  const fs = useFullscreen();
  // enterFullscreen() must start inside the tap, so it is called before anything async
  const toggleFullscreen = () => {
    if (fs.active) { void exitFullscreen(); actions.setSettings({ fullscreen: false }); }
    else { void enterFullscreen(); actions.setSettings({ fullscreen: true }); }
  };
  const textScale = useAppState(s => s.settings.textScale);
  const uiScale = useAppState(s => s.settings.uiScale);
  const { ui: activeUi, maxUi } = useUi();
  const name = useAppState(s => s.user.name);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStats, setConfirmStats] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const say = (ok: boolean, text: string) => setStatus({ ok, text });

  function doExport() {
    download(`scrypture-${new Date().toISOString().slice(0, 10)}.json`, actions.exportData());
    say(true, t('exported'));
  }
  async function pick(f?: File) {
    if (!f) return;
    try { const text = await f.text(); JSON.parse(text); setPendingImport(text); setStatus(null); }
    catch { say(false, t('badJson')); }
    if (file.current) file.current.value = '';
  }
  function doImport() {
    try { actions.importData(pendingImport!); say(true, t('imported')); }
    catch (e) { say(false, t('importFailed', { reason: (e as Error).message })); }
    setPendingImport(null);
  }


  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => back('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('settings')}</h1>
      {name && <div className="muted small">{t('builder', { name })}</div>}
      <label className="field">{t('yourNameLabel')}
        <input defaultValue={name ?? ""} maxLength={20} aria-label={t('yourNameLabel')} placeholder={t('enterYourName')}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== name) actions.setUser({ name: v }); else e.target.value = name ?? ""; }}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
      </label>

      <section className="list">
        <h2 className="subtitle">{t('language')}</h2>
        <div className="langs" role="group" aria-label={t('language')}>
          {LANGS.map(l => {
            const locked = l === 'LA' && !latinOpen;
            return (
              <button key={l} className={`seg ${language === l ? 'on' : ''}`} aria-pressed={language === l} disabled={locked} onClick={() => actions.setSettings({ language: l })}>
                {LANG_NAMES[l]}
              </button>
            );
          })}
        </div>
        {!latinOpen && <div className="muted small" style={{ lineHeight: 1.6 }}>{t('latinLocked', { n: Math.min(tasksDone, LATIN_UNLOCK_TASKS) })}</div>}
      </section>

      <section className="list">
        <h2 className="subtitle">{t('display')}</h2>
        {fs.supported ? (
          <>
            <div className="row"><PixelButton scale={1} variant={fs.active ? 'red' : 'green'} onClick={toggleFullscreen}>{fs.active ? t('fullscreenExit') : t('fullscreenEnter')}</PixelButton></div>
            <p className="muted small" style={{ lineHeight: 1.7 }} role="status">{wantFullscreen ? t('fullscreenOnHint') : t('fullscreenOffHint')}</p>
          </>
        ) : <p className="muted small" style={{ lineHeight: 1.7 }}>{t('fullscreenUnsupported')}</p>}
        <div className="field">{t('deviceCase')}
          <div className="row wrap" role="group" aria-label={t('deviceCase')}>
            {([true, false] as const).map(v => <button key={String(v)} className={`seg ${device === v ? 'on' : ''}`} aria-pressed={device === v} onClick={() => actions.setSettings({ device: v })}>{v ? t('deviceOn') : t('crtOff')}</button>)}
          </div>
        </div>
        <div className="field">{t('crtEffect')}
          <div className="row wrap" role="group" aria-label={t('crtEffect')}>
            {CRT_LEVELS.map(v => <button key={v} className={`seg ${crt === v ? 'on' : ''}`} aria-pressed={crt === v} onClick={() => actions.setSettings({ crt: v })}>{t(v === 'off' ? 'crtOff' : v === 'low' ? 'crtLow' : 'crtHigh')}</button>)}
          </div>
        </div>
      </section>

      <section className="list">
        <div className="field">{t('soundVolume')}
          <div className="row wrap" role="group" aria-label={t('soundVolume')}>
            {[0, 0.3, 0.7, 1].map(v => <button key={v} className={`seg ${volume === v ? 'on' : ''}`} aria-pressed={volume === v} onClick={() => actions.setSettings({ volume: v })}>{v === 0 ? t('soundVolumeOff') : `${Math.round(v * 100)}%`}</button>)}
          </div>
        </div>
        {canVibrate() && <div className="field">{t('haptics')}
          <div className="row wrap" role="group" aria-label={t('haptics')}>
            {[true, false].map(v => <button key={String(v)} className={`seg ${haptics === v ? 'on' : ''}`} aria-pressed={haptics === v} onClick={() => { actions.setSettings({ haptics: v }); if (v) navigator.vibrate?.(BUZZ.hit); }}>{v ? t('hapticsOn') : t('crtOff')}</button>)}
          </div>
        </div>}
      </section>

      <section className="list">
        <h2 className="subtitle">{t('accessibility')}</h2>
        <div className="field">{t('highContrast')}
          <div className="row wrap" role="group" aria-label={t('highContrast')}>
            {[false, true].map(v => <button key={String(v)} className={`seg ${highContrast === v ? 'on' : ''}`} aria-pressed={highContrast === v} onClick={() => actions.setSettings({ highContrast: v })}>{v ? t('motionOn') : t('crtOff')}</button>)}
          </div>
        </div>
        <div className="field">{t('reduceMotion')}
          <div className="row wrap" role="group" aria-label={t('reduceMotion')}>
            {[false, true].map(v => <button key={String(v)} className={`seg ${reduceMotion === v ? 'on' : ''}`} aria-pressed={reduceMotion === v} onClick={() => actions.setSettings({ reduceMotion: v })}>{v ? t('motionOn') : t('crtOff')}</button>)}
          </div>
        </div>
        <div className="field">{t('textSize')}
          <div className="row wrap" role="group" aria-label={t('textSize')}>
            {TEXT_SCALES.map(v => (
              <button key={v} className={`seg ${textScale === v ? 'on' : ''}`} aria-pressed={textScale === v} onClick={() => actions.setSettings({ textScale: v })}>{Math.round(v * 100)}%</button>
            ))}
          </div>
        </div>
        <p className="sample">{t('textSample')}</p>
        <div className="field">{t('interfaceSize')}
          <div className="row wrap" role="group" aria-label={t('interfaceSize')}>
            {UI_SCALES.map(v => (
              <button key={v} className={`seg ${uiScale === v ? 'on' : ''}`} aria-pressed={uiScale === v} disabled={v > maxUi} onClick={() => actions.setSettings({ uiScale: v })}>{v === 0 ? `${t('auto')} (${activeUi}x)` : `${v}x`}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="list">
        <h2 className="subtitle">{t('appearance')}</h2>
        <p className="muted small" style={{ lineHeight: 1.7 }}>{t('appearanceNote')}</p>
        <div className="row wrap">
          <PixelButton scale={1} onClick={() => navigate('/theme')}>{t('themeManager')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={() => actions.setSettings(DEFAULT_APPEARANCE)}>{t('resetAppearance')}</PixelButton>
        </div>
      </section>

      <CloudSection />

      <section className="list">
        <h2 className="subtitle">{t('yourData')}</h2>
        <p className="muted small" style={{ lineHeight: 1.6 }}>{t('dataNote')}</p>
        <div className="row wrap">
          <PixelButton scale={1} onClick={doExport}>{t('export')}</PixelButton>
          <PixelButton scale={1} onClick={() => file.current?.click()}>{t('import')}</PixelButton>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => pick(e.target.files?.[0])} />
        </div>
        {pendingImport && (
          <PixelFrame theme="red_thick" scale={1} className="card">
            <div className="small" style={{ lineHeight: 1.6 }}>{t('importWarn')}</div>
            <div className="row"><PixelButton scale={1} variant="red" onClick={doImport}>{t('replace')}</PixelButton><PixelButton scale={1} onClick={() => setPendingImport(null)}>{t('cancel')}</PixelButton></div>
          </PixelFrame>
        )}
        {status && <div className="small" role="status" style={{ color: status.ok ? 'var(--soul)' : 'var(--body)', lineHeight: 1.6 }}>{status.text}</div>}
      </section>

      <section className="list">
        <h2 className="subtitle">{t('dangerZone')}</h2>
        {confirmReset ? (
          <PixelFrame theme="red_thick" scale={1} className="card">
            <div className="small" style={{ lineHeight: 1.6 }}>{t('resetWarn')}</div>
            <div className="row">
              <PixelButton scale={1} variant="red" onClick={() => { actions.resetAll(); setConfirmReset(false); location.hash = '/'; }}>{t('deleteAll')}</PixelButton>
              <PixelButton scale={1} onClick={() => setConfirmReset(false)}>{t('cancel')}</PixelButton>
            </div>
          </PixelFrame>
        ) : <div className="row"><PixelButton scale={1} variant="red" onClick={() => setConfirmReset(true)}>{t('removeAllData')}</PixelButton></div>}
        {confirmStats ? (
          <PixelFrame theme="red_thick" scale={1} className="card">
            <div className="small" style={{ lineHeight: 1.6 }}>{t('resetStatsWarn')}</div>
            <div className="row">
              <PixelButton scale={1} variant="red" onClick={() => { actions.resetStats(); setConfirmStats(false); }}>{t('resetStats')}</PixelButton>
              <PixelButton scale={1} onClick={() => setConfirmStats(false)}>{t('cancel')}</PixelButton>
            </div>
          </PixelFrame>
        ) : <div className="row"><PixelButton scale={1} variant="red" onClick={() => setConfirmStats(true)}>{t('resetStats')}</PixelButton></div>}
      </section>
    </div>
  );
}
