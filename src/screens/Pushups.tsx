import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PUSHUP_CALIBRATE_MS, PUSHUP_SENSITIVITIES, formatClock, liveStreak, newPushupDetector, newPushupSession, pushupBest, pushupCameraRep, pushupCheer, pushupNudge, pushupPress, stepPushupDetector,
  type PushupCheer, type PushupDetector, type PushupGain, type PushupSensitivity, type PushupSession,
} from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { useI18n } from '../i18n/useT';
import type { Key } from '../i18n';
import { navigate } from '../router';
import { buzz } from '../audio/haptics';
import { uiPlay } from '../audio/uiSound';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Chip, Modal } from '../ui/misc';
import { cameraProblem, cameraSupported, keepAwake, startCamera, type CameraProblem, type PushupCamera } from './pushupCamera';
import './pushups.css';

const STONE = 'grey_stone_chiseld';
const GOLD = '#b6a432', GREEN = '#4f8a3c', GREY = '#5a5644';
type Phase = 'intro' | 'calibrating' | 'running' | 'done';
type CamMode = 'camera' | 'button';
type Line = PushupCheer & { id: number; at: number };

const readSens = (): PushupSensitivity => { try { const v = localStorage.getItem('pushupSens'); return v === 'low' || v === 'high' ? v : 'med'; } catch { return 'med'; } };
const WHY_KEY: Record<CameraProblem, Key> = { insecure: 'exPushWhyInsecure', unsupported: 'exPushWhyUnsupported', denied: 'exPushWhyDenied', none: 'exPushWhyNone', busy: 'exPushWhyBusy', other: 'exPushWhyOther' };
const SENS_KEY: Record<PushupSensitivity, Key> = { low: 'exPushSensLow', med: 'exPushSensMed', high: 'exPushSensHigh' };

/** Pushups: the front camera counts each time your face comes close, the big button under your nose makes it a deep one. */
export function Pushups() {
  const { t } = useI18n();
  const workouts = useAppState(s => s.exercise.workouts);
  const best = useMemo(() => pushupBest(workouts), [workouts]);
  const now = useNow(250);
  const [phase, setPhaseState] = useState<Phase>('intro');
  const [cam, setCam] = useState<CamMode>('camera');
  const [sens, setSensState] = useState<PushupSensitivity>(readSens);
  const [s, setS] = useState<PushupSession>(() => newPushupSession(0));
  const [close, setClose] = useState(0);
  const [dark, setDark] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  const [pop, setPop] = useState<{ id: number; text: string } | null>(null);
  const [saved, setSaved] = useState<number | null | undefined>(undefined);   // undefined = not saved yet, null = nothing to save / full
  const [pressed, setPressed] = useState(false);
  const [info, setInfo] = useState(false);
  const [why, setWhy] = useState<CameraProblem | null>(null);   // why the camera is off, when it is
  const [starting, setStarting] = useState(false);   // waiting for the camera permission

  // everything the camera callback needs lives in refs: it outlives any one render
  const phaseRef = useRef<Phase>('intro');
  const sessRef = useRef(s);
  const detRef = useRef<PushupDetector | null>(null);
  const sensRef = useRef(sens);
  const camRef = useRef<PushupCamera | null>(null);
  const releaseRef = useRef<() => void>(() => {});
  const seq = useRef(0);
  const calStart = useRef(0), t0 = useRef(0), t1 = useRef(0);
  const mounted = useRef(true);
  const attempt = useRef(0);   // which Start press the camera answer belongs to

  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const setSens = (v: PushupSensitivity) => { sensRef.current = v; setSensState(v); try { localStorage.setItem('pushupSens', v); } catch { /* private mode */ } };
  const stopSensors = () => { camRef.current?.stop(); camRef.current = null; releaseRef.current(); releaseRef.current = () => {}; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopSensors(); }; }, []);

  const apply = (g: PushupGain) => {
    const prev = sessRef.current;
    sessRef.current = g.s; setS(g.s);
    if (!g.points) return;
    const id = ++seq.current;
    const c = pushupCheer(prev, g);
    setLine({ ...c, id, at: Date.now() });
    setPop({ id, text: `+${g.points}` });
    const big = c.key === 'exPushCheerBeat' || c.key === 'exPushCheer10' || c.key === 'exPushCheer25' || c.key === 'exPushCheerStreak';
    buzz(big ? 'level' : g.upgraded ? 'hit' : 'tap');
    uiPlay(g.upgraded ? 'ready' : 'hoop', Math.min(1, g.s.streak / 15));
  };
  const beginRun = (at: number) => {
    t0.current = at;
    sessRef.current = newPushupSession(best.score); setS(sessRef.current);
    setPhase('running');
  };
  const onLuma = (luma: number) => {
    const d = detRef.current;
    if (!d || phaseRef.current === 'done') return;
    const at = Date.now();
    const r = stepPushupDetector(d, luma, at, sensRef.current);
    detRef.current = r.d;
    setClose(c => (Math.abs(c - r.d.closeness) < 0.02 ? c : r.d.closeness));
    setDark(r.d.dark);
    if (phaseRef.current === 'calibrating' && r.d.phase !== 'calibrating') beginRun(at);
    else if (phaseRef.current === 'running' && r.rep) apply(pushupCameraRep(sessRef.current, at, d.downAt));
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    const mine = ++attempt.current;
    const at = Date.now();
    setSaved(undefined); setLine(null); setPop(null); setWhy(null);
    sessRef.current = newPushupSession(best.score); setS(sessRef.current);
    releaseRef.current = await keepAwake().catch(() => () => {});
    try {
      const c = await startCamera(onLuma);
      if (!mounted.current || attempt.current !== mine) { c.stop(); return; }   // left, or chose "no camera" while it was still asking
      setStarting(false);
      camRef.current = c; setCam('camera');
      detRef.current = newPushupDetector(at); calStart.current = at;
      setPhase('calibrating');
    } catch (e) {
      if (!mounted.current || attempt.current !== mine) return;
      noCamera(cameraProblem(e));
    }
  };
  /** No camera (refused, missing, or skipped): the button alone still counts. */
  const noCamera = (problem: CameraProblem | null = null) => {
    attempt.current++; setStarting(false); setWhy(problem);
    detRef.current = null; setCam('button');
    beginRun(Date.now());
  };
  const finish = () => {
    if (phaseRef.current === 'done') return;
    t1.current = Date.now();
    stopSensors(); detRef.current = null; setClose(0);
    setPhase('done');
  };
  /** Save the session, and let Bóbr say something about it in the chat. */
  const save = () => {
    const n = actions.logPushups({ reps: s.reps, deep: s.deep, score: s.score, ms: elapsed });
    setSaved(n);
    if (n !== null) actions.bobrSays(t(newBest ? 'chatPushBeat' : 'chatPushDone', { reps: s.reps, deep: s.deep, score: s.score, n }));
  };
  const onBack = () => { if (phaseRef.current === 'running' && sessRef.current.reps > 0) finish(); else { stopSensors(); navigate('/apps/exercise'); } };
  const onNose = () => {
    if (phaseRef.current !== 'running') return;
    const d = detRef.current;
    apply(pushupPress(sessRef.current, Date.now(), d ? d.phase : 'off', d?.downAt ?? 0));
  };
  useEffect(() => { if (!pressed) return; const id = setTimeout(() => setPressed(false), 120); return () => clearTimeout(id); }, [pressed]);

  const elapsed = phase === 'running' ? now - t0.current : phase === 'done' ? t1.current - t0.current : 0;
  const nudge = phase === 'running' ? pushupNudge(s, now, t0.current) : null;
  const shown: PushupCheer | null = nudge && (!line || now - line.at > 4000) ? nudge : line;
  const streak = liveStreak(s, now);
  const newBest = s.score > 0 && s.score > s.high;   // against the best from before this session (saving it must not take the flair away)
  const countdown = Math.max(1, Math.ceil((PUSHUP_CALIBRATE_MS - (now - calStart.current)) / 1000));

  const sensBar = (
    <div className="pu-seg" role="group" aria-label={t('exPushSens')}>
      <span className="muted small">{t('exPushSens')}</span>
      {PUSHUP_SENSITIVITIES.map(v => <button type="button" key={v} className={`seg ${v === sens ? 'on' : ''}`} aria-pressed={v === sens} onClick={() => setSens(v)}>{t(SENS_KEY[v])}</button>)}
    </div>
  );

  return (
    <div className="screen pu" data-phase={phase}>
      <div className="row between pu-top">
        <PixelButton scale={1} variant="red" onClick={onBack}>{t('back')}</PixelButton>
        <PixelButton scale={1} size="compact" variant="red" className="pu-i" aria-label={t('exPushInfo')} onClick={() => setInfo(true)}>i</PixelButton>
        {phase !== 'intro' && <Chip color={cam === 'camera' ? GREEN : GREY}>{t(cam === 'camera' ? 'exPushCamOn' : 'exPushCamOff')}</Chip>}
      </div>

      {phase === 'intro' && (
        <PixelFrame theme={STONE} scale={1} className="pu-intro">
          <h1 className="title">{t('exPushups')}</h1>
          {best.score > 0 && <p className="small">{t('exPushBest', { n: best.score })}</p>}
          <PixelButton scale={2} onClick={start} disabled={starting} aria-busy={starting}>{t(starting ? 'exPushWaiting' : 'exPushStart')}</PixelButton>
          {starting && <PixelButton scale={1} variant="red" size="compact" onClick={() => noCamera()}>{t('exPushSkipCam')}</PixelButton>}
        </PixelFrame>
      )}

      {(phase === 'calibrating' || phase === 'running') && (
        <>
          <div className="pu-nose-wrap">
            {pop && <span key={pop.id} className="pu-pop" aria-hidden="true">{pop.text}</span>}
            <PixelButton scale={2} className={`pu-nose ${pressed ? 'hit' : ''}`} disabled={phase !== 'running'} aria-label={t('exPushNose')}
              onPointerDown={e => { if (e.pointerType === 'mouse' && e.button !== 0) return; setPressed(true); onNose(); }}
              onClick={e => { if (e.detail === 0) onNose(); }}>
              {t('exPushNose')}
            </PixelButton>
          </div>
          <div className="pu-stats">
            <PixelFrame theme={STONE} scale={1} className="pu-stat pu-time"><span className="muted">{t('exPushTime')}</span><strong role="timer">{formatClock(elapsed)}</strong></PixelFrame>
            <PixelFrame theme={STONE} scale={1} className="pu-stat"><span className="muted">{t('exPushScore')}</span><strong>{s.score}</strong></PixelFrame>
            <PixelFrame theme={STONE} scale={1} className="pu-stat"><span className="muted">{t('exPushHigh')}</span><strong className={newBest ? 'pu-gold' : ''}>{Math.max(s.high, s.score)}</strong></PixelFrame>
            <PixelFrame theme={STONE} scale={1} className="pu-stat pu-reps"><span className="muted">{t('exPushReps')}</span><strong>{s.reps}</strong>
              <span className="small">{t('exPushDeep')}: {s.deep}{streak > 0 && s.mult > 1 ? ` · x${s.mult}` : ''}</span></PixelFrame>
          </div>

          <div className="pu-cheer" role="status" aria-live="polite">
            {phase === 'calibrating' ? <span key="cal">{t('exPushGetReady', { n: countdown })}</span>
              : shown ? <span key={'id' in shown ? (shown as Line).id : shown.key} className="pu-line">{t(shown.key as Key, shown.params)}</span> : null}
          </div>

          {cam === 'camera' && (
            <div className="pu-sense">
              <div className="pu-meter" role="meter" aria-label={t('exPushSignal')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(close * 100)}><i style={{ width: `${Math.round(close * 100)}%` }} /></div>
              {dark && <span className="small pu-warn">{t('exPushDark')}</span>}
            </div>
          )}

          <PixelButton scale={1} className="pu-finish" disabled={phase !== 'running'} onClick={finish}>{t('exPushFinish')}</PixelButton>
        </>
      )}

      {phase === 'done' && (
        <PixelFrame theme={STONE} scale={1} className="pu-intro pu-done">
          <h1 className="title">{t('exPushDone')}</h1>
          {s.reps === 0 ? <p>{t('exPushNone')}</p> : (
            <div className="pu-sum">
              <div><span className="muted">{t('exPushReps')}</span><strong>{s.reps}</strong></div>
              <div><span className="muted">{t('exPushDeep')}</span><strong>{s.deep}</strong></div>
              <div><span className="muted">{t('exPushScore')}</span><strong>{s.score}</strong></div>
              <div><span className="muted">{t('exPushTime')}</span><strong>{formatClock(elapsed)}</strong></div>
            </div>
          )}
          {newBest && <p className="pu-gold pu-newbest">{t('exPushNewBest')}</p>}
          {saved !== undefined && <p role="status"><Chip color={GOLD}>{saved === null ? t('exPushNotSaved') : t('exEarned', { n: saved })}</Chip></p>}
          <div className="row">
            {saved === undefined && s.reps > 0 && <PixelButton scale={1} onClick={save}>{t('exPushSave')}</PixelButton>}
            {saved === undefined && <PixelButton scale={1} variant="red" onClick={() => { setPhase('intro'); setS(newPushupSession(0)); }}>{s.reps > 0 ? t('exPushDiscard') : t('exPushAgain')}</PixelButton>}
            {saved !== undefined && <PixelButton scale={1} onClick={() => navigate('/apps/exercise')}>{t('back')}</PixelButton>}
            {saved !== undefined && <PixelButton scale={1} variant="red" onClick={() => { setPhase('intro'); setS(newPushupSession(0)); }}>{t('exPushAgain')}</PixelButton>}
          </div>
        </PixelFrame>
      )}
      <Modal open={info} onClose={() => setInfo(false)} title={t('exPushInfoTitle')} theme="app">
        <div className="pu-info">
          <p>{t('exPushIntro')}</p>
          <p className="muted small">{t('exPushPrivacy')}</p>
          {(why || !cameraSupported()) && <p className="small pu-warn">{t(why ? WHY_KEY[why] : isSecureContext === false ? 'exPushWhyInsecure' : 'exPushWhyUnsupported')}</p>}
          {sensBar}
          <PixelButton scale={1} onClick={() => setInfo(false)}>{t('close')}</PixelButton>
        </div>
      </Modal>
    </div>
  );
}
