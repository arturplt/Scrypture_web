import { useState, type ReactNode } from 'react';
import {
  COMMON_EXERCISES, EXERCISE_TYPES, MAX_EXERCISES, MAX_WORKOUTS, REST_CHOICES, WORKOUT_PRESETS, exerciseProgress, progressMeasure, restLength, showWeight, weightKg, weightStep, type WeightUnit, elapsedMs, exerciseLibrary, exercisePR, exerciseSummary, formatClock, pushupSummary, rollingAverages, roundHalf,
  setDefaults, setInputs, setProgress, workoutBodyPoints, type Exercise, type ExerciseSet, type ExerciseType, type PlannedExercise, type Workout,
} from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { useI18n } from '../i18n/useT';
import { DATE_LOCALE, type Key } from '../i18n';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { Chip, Icon, Modal, PickBox } from '../ui/misc';
import { NameDialog } from '../ui/NameDialog';
import './exercise.css';

const TYPE_KEY: Record<ExerciseType, Key> = { WEIGHT_TRAINING: 'exTypeWeight', BODYWEIGHT: 'exTypeBody', CARDIO: 'exTypeCardio', OTHER: 'exTypeOther' };
/** One colour per kind of exercise, used for its tag and the stripe on its card. */
const TYPE_COLOR: Record<ExerciseType, string> = { WEIGHT_TRAINING: '#cf565c', BODYWEIGHT: '#b6a432', CARDIO: '#3c898f', OTHER: '#8a8560' };
const PRESET_KEY: Record<string, Key> = { full: 'exPresetFull', upper: 'exPresetUpper', lower: 'exPresetLower', cardio: 'exPresetCardio', bodyweight: 'exPresetBody', push: 'exPresetPush', pull: 'exPresetPull', legs: 'exPresetLegs' };
/** The tracker's own frame: Android draws all of it in chiselled grey stone. */
const STONE = 'grey_stone_chiseld';
const GREEN = '#4f8a3c', GREY = '#5a5644', GOLD = '#b6a432';
/** Set boxes: done is bright green, still to do is plain grey. */
const SET_DONE = '#7bd35f', SET_TODO = '#8a8672';

type Sheet = null | 'settings' | 'quick' | 'presets' | 'library' | 'add' | 'finish' | 'discard';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const setCount = (w: Workout) => w.exercises.reduce((n, e) => n + e.sets.length, 0);
/** "x10 60kg 1:30": what a set holds, shortest form, with the weight in the chosen unit. */
const setText = (s: ExerciseSet, e: Exercise, unit: WeightUnit = 'kg') =>
  [s.reps !== undefined ? `x${s.reps}` : '', e.type === 'WEIGHT_TRAINING' && s.weight ? `${showWeight(s.weight, unit)}${unit}` : '', s.duration ? mmss(s.duration / 1000) : ''].filter(Boolean).join(' ');
const useUnit = () => useAppState(s => s.exercise.unit ?? 'kg');

/** A number with a minus and a plus button on either side (Android uses stone arrows). */
function Stepper({ label, value, step, min = 0, show, onChange }: { label: string; value: number; step: number; min?: number; show?: (n: number) => string; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(min, Math.round(n * 100) / 100));
  return (
    <div className="ex-step" role="group" aria-label={label}>
      <span className="ex-step-label">{label}</span>
      <PixelButton scale={1} size="compact" variant="red" aria-label={`${label} -`} disabled={value <= min} onClick={() => set(value - step)}><Icon name="symbol_minus" size={16} /></PixelButton>
      <strong className="ex-val" aria-live="polite">{show ? show(value) : value}</strong>
      <PixelButton scale={1} size="compact" aria-label={`${label} +`} onClick={() => set(value + step)}><Icon name="symbol_plus" size={16} /></PixelButton>
    </div>
  );
}

/** A picture, a line of text and an optional second line, as one big button. */
function Tile({ icon, label, hint, disabled, onClick }: { icon?: string; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <PixelFrame as="button" theme={STONE} scale={1} className={`ex-tile ${icon ? '' : 'ex-tile-plain'}`} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick}>
      {icon && <Icon name={icon} size={24} />}
      <span className="ex-tile-text"><span>{label}</span>{hint && <span className="muted">{hint}</span>}</span>
    </PixelFrame>
  );
}

const Stat = ({ value, label }: { value: ReactNode; label: string }) => (
  <PixelFrame theme={STONE} scale={1} className="ex-stat"><strong>{value}</strong><span className="muted">{label}</span></PixelFrame>
);

/** Exercise tracker (Android: ExerciseTrackerScreen, opened by holding Body on Home). */
export function Exercise() {
  const { t } = useI18n();
  const workouts = useAppState(s => s.exercise.workouts);
  const restSecs = useAppState(s => restLength(s.exercise)), unit = useUnit();
  const active = workouts.find(w => !w.completed);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [chart, setChart] = useState<string | null>(null);   // the exercise whose progress is shown
  const [note, setNote] = useState<string | null>(null);
  const [restUntil, setRestUntil] = useState(0);
  const now = useNow(1000);
  const full = workouts.length >= MAX_WORKOUTS;
  const week = exerciseSummary(workouts, now);

  const start = (name?: string, planned: PlannedExercise[] = []) => {
    setSheet(null); setNote(null);
    if (!actions.startWorkout(name, planned)) setNote(t('exFull', { n: MAX_WORKOUTS }));
  };

  return (
    <div className="screen ex" role="region" aria-label={t('exercise')}>
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton>
        <PixelButton scale={1} onClick={() => setSheet('settings')}>{t('settings')}</PixelButton>
      </div>
      {note && <div className="ex-note" role="status"><Chip color={GOLD}>{note}</Chip></div>}

      {active ? (
        <ActiveWorkout w={active} now={now} restUntil={restUntil} restSecs={restSecs} onRest={() => setRestUntil(Date.now() + restSecs * 1000)} onSkipRest={() => setRestUntil(0)}
          onAdd={() => setSheet('add')} onFinish={() => setSheet('finish')} onDiscard={() => setSheet('discard')} />
      ) : (
        <>
          <section aria-label={t('exWeek')} className="ex-block">
            <h2 className="ex-label">{t('exWeek')}</h2>
            <div className="ex-stats3">
              <Stat value={week.workouts} label={t('exStatWorkouts')} />
              <Stat value={week.minutes} label={t('exStatMinutes')} />
              <Stat value={`+${week.points}`} label={t('exStatPoints')} />
            </div>
          </section>
          <div className="ex-tiles">
            <Tile icon="symbol_play" label={t('exStart')} disabled={full} onClick={() => start()} />
            <Tile label={t('exPushups')} disabled={full} onClick={() => navigate('/apps/exercise/pushups')} />
            <Tile icon="pencil_yellow" label={t('exQuick')} disabled={full} onClick={() => setSheet('quick')} />
            <Tile icon="task" label={t('exWorkoutLibrary')} hint={t('exPresetCount', { n: WORKOUT_PRESETS.length })} disabled={full} onClick={() => setSheet('presets')} />
            <Tile icon="sort" label={t('exLibrary')} onClick={() => setSheet('library')} />
          </div>
          {full && <div className="muted small" role="status">{t('exFull', { n: MAX_WORKOUTS })}</div>}
          <History workouts={workouts} onChart={setChart} />
        </>
      )}

      <Modal open={sheet === 'settings'} onClose={() => setSheet(null)} title={t('settings')} theme="app">
        <div className="ex-dialog">
        <section className="ex-block ex-prefs" aria-label={t('exSettings')}>
            <div className="ex-types" role="group" aria-label={t('exUnit')}>
              <span className="muted small">{t('exUnit')}</span>
              {(['kg', 'lb'] as const).map(u => <button type="button" key={u} className={`seg ${u === unit ? 'on' : ''}`} aria-pressed={u === unit} onClick={() => actions.setExerciseSettings({ unit: u })}>{u}</button>)}
            </div>
            <div className="ex-types" role="group" aria-label={t('exRestLength')}>
              <span className="muted small">{t('exRestLength')}</span>
              {REST_CHOICES.map(n => <button type="button" key={n} className={`seg ${n === restSecs ? 'on' : ''}`} aria-pressed={n === restSecs} onClick={() => actions.setExerciseSettings({ restSeconds: n })}>{mmss(n)}</button>)}
            </div>
        </section>
        <div className="row"><PixelButton scale={1} onClick={() => setSheet(null)}>{t('exClose')}</PixelButton></div>
        </div>
      </Modal>
      <QuickLog open={sheet === 'quick'} onClose={() => setSheet(null)} onSaved={n => { setSheet(null); setNote(t('exEarned', { n: n ?? 0 })); }} />
      <Presets open={sheet === 'presets'} onClose={() => setSheet(null)} onStart={p => start(t(PRESET_KEY[p.id]), p.exercises)} />
      <Library open={sheet === 'library'} onClose={() => setSheet(null)} workouts={workouts} onChart={n => { setSheet(null); setChart(n); }} />
      {chart && <Progress name={chart} workouts={workouts} onClose={() => setChart(null)} />}
      <AddExercise open={sheet === 'add'} onClose={() => setSheet(null)} workouts={workouts} onAdd={p => { if (active) actions.addExercise(active.id, p); setSheet(null); }} />
      <Modal open={sheet === 'finish' && !!active} onClose={() => setSheet(null)} title={t('exFinish')} theme="app">
        {active && <p className="small ex-ask">{t('exFinishAsk', { n: workoutBodyPoints(active, elapsedMs(active, Date.now())) })}</p>}
        <div className="row">
          <PixelButton scale={1} onClick={() => { if (active) { const n = actions.finishWorkout(active.id); setNote(t('exEarned', { n })); } setSheet(null); setRestUntil(0); }}>{t('exFinish')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={() => setSheet(null)}>{t('cancel')}</PixelButton>
        </div>
      </Modal>
      <Modal open={sheet === 'discard' && !!active} onClose={() => setSheet(null)} title={t('exDiscard')} theme="app">
        <p className="small ex-ask">{t('exDiscardAsk')}</p>
        <div className="row">
          <PixelButton scale={1} variant="red" onClick={() => { if (active) actions.deleteWorkout(active.id); setSheet(null); setRestUntil(0); }}>{t('exDiscard')}</PixelButton>
          <PixelButton scale={1} onClick={() => setSheet(null)}>{t('cancel')}</PixelButton>
        </div>
      </Modal>
    </div>
  );
}

/** Finished workouts, newest first; tap one to see what was in it. */
function History({ workouts, onChart }: { workouts: Workout[]; onChart: (name: string) => void }) {
  const { t, lang } = useI18n();
  const unit = useUnit();
  const [editing, setEditing] = useState<string | null>(null);   // the finished workout whose sets can be tapped to change
  const [fixing, setFixing] = useState<{ w: Workout; e: Exercise; s: ExerciseSet } | null>(null);
  const [renaming, setRenaming] = useState<Workout | null>(null);
  const [shown, setShown] = useState(10);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const doomed = workouts.find(w => w.id === deleting);
  const done = workouts.filter(w => w.completed);
  const date = (ms: number) => new Date(ms).toLocaleDateString(DATE_LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section className="ex-block" aria-label={t('exHistory')}>
      <h2 className="ex-label">{t('exHistory')} ({done.length})</h2>
      {done.length === 0 && <PixelFrame theme={STONE} scale={1} className="ex-empty"><Icon name="body_inactive" size={32} /><span className="muted small">{t('exNone')}</span></PixelFrame>}
      {done.slice(0, shown).map(w => {
        const on = open === w.id, push = pushupSummary(w);
        return (
          <PixelFrame key={w.id} theme={STONE} scale={1} className="ex-hist">
            <button type="button" className="ex-hist-head" aria-expanded={on} onClick={() => setOpen(on ? null : w.id)}>
              <span className="ex-hist-name">{w.name ?? t('exWorkout')}</span>
              <span className="muted">{date(w.startTime)}</span>
              <img className="chev" src={`/assets/raw/${on ? 'arrow_stone_up' : 'arrow_stone_down'}.png`} alt="" />
            </button>
            <div className="row ex-wrap ex-chips">
              <Chip color={GREY}>{t('exMin', { n: Math.round((w.duration ?? 0) / 60_000) })}</Chip>
              {push ? <>
                <Chip color={GREY}>{t('exPushRepsN', { n: push.reps })}</Chip>
                {push.perMin !== null && <Chip color={GREY}>{t('exPushPace', { n: push.perMin })}</Chip>}
                <Chip color={GREY}>{t('exPushScoreN', { n: push.score })}</Chip>
              </> : <Chip color={GREY}>{t('exSummary', { n: w.exercises.length, s: setCount(w) })}</Chip>}
              {w.bodyPointsAwarded > 0 && <Chip color={GOLD}>{t('exEarned', { n: w.bodyPointsAwarded })}</Chip>}
            </div>
            {on && (
              <div className="ex-hist-body">
                {w.exercises.map(e => (
                  <div key={e.id} className="ex-line" style={{ '--c': TYPE_COLOR[e.type] } as React.CSSProperties}>
                    <button type="button" className="ex-link" title={t('exProgress')} onClick={() => onChart(e.name)}>{e.name}</button>
                    {editing === w.id ? (
                      <span className="ex-sets ex-sets-small">
                        {e.sets.filter(s => s.completed).map(s => <PickBox key={s.id} color={SET_DONE} selected={false} onClick={() => setFixing({ w, e, s })}><span className="ex-set"><strong>{s.setNumber}</strong><span>{setText(s, e, unit) || '✓'}</span></span></PickBox>)}
                      </span>
                    ) : <span className="muted">{e.sets.map(s => setText(s, e, unit) || '✓').join(' · ')}</span>}
                  </div>
                ))}
                {editing === w.id && <div className="muted small">{t('exEditHint')}</div>}
                <div className="row">
                  <PixelButton scale={1} size="compact" onClick={() => setEditing(editing === w.id ? null : w.id)}>{editing === w.id ? t('exStopEdit') : t('edit')}</PixelButton>
                  <PixelButton scale={1} size="compact" variant="red" onClick={() => setRenaming(w)}>{t('mmRename')}</PixelButton>
                  <PixelButton scale={1} size="compact" variant="red" onClick={() => setDeleting(w.id)}>{t('delete')}</PixelButton>
                </div>
              </div>
            )}
          </PixelFrame>
        );
      })}
      {done.length > shown && <PixelButton scale={1} onClick={() => setShown(shown + 10)}>{t('exMore')}</PixelButton>}
      {fixing && <SetDialog w={fixing.w} e={fixing.e} s={fixing.s} onClose={() => setFixing(null)}
        onSave={v => { actions.editLoggedSet(fixing.w.id, fixing.e.id, fixing.s.id, v); setFixing(null); }} />}
      <NameDialog open={!!renaming} title={t('mmRename')} initial={renaming?.name ?? t('exWorkout')} okLabel={t('exSave')} cancelLabel={t('cancel')}
        onSubmit={name => { if (renaming) actions.renameWorkout(renaming.id, name); setRenaming(null); }} onClose={() => setRenaming(null)} />
      <Modal open={!!doomed} onClose={() => setDeleting(null)} title={t('delete')} theme="app">
        <p className="small ex-ask">{t('exDeleteAsk', { name: doomed?.name ?? t('exWorkout') })}</p>
        <div className="row">
          <PixelButton scale={1} variant="red" onClick={() => { if (deleting) actions.deleteWorkout(deleting); setDeleting(null); }}>{t('delete')}</PixelButton>
          <PixelButton scale={1} onClick={() => setDeleting(null)}>{t('cancel')}</PixelButton>
        </div>
      </Modal>
    </section>
  );
}

function ActiveWorkout({ w, now, restUntil, restSecs, onRest, onSkipRest, onAdd, onFinish, onDiscard }:
  { w: Workout; now: number; restUntil: number; restSecs: number; onRest: () => void; onSkipRest: () => void; onAdd: () => void; onFinish: () => void; onDiscard: () => void }) {
  const { t } = useI18n();
  const paused = w.pausedAt !== undefined;
  const rest = Math.max(0, Math.ceil((restUntil - now) / 1000));
  const p = setProgress(w);
  return (
    <>
      <PixelFrame theme={STONE} scale={1} className={`ex-clock ${paused ? 'paused' : ''}`}>
        <div className="row between">
          <span className="ex-clock-name">{w.name ?? t('exWorkout')}</span>
          {paused ? <Chip color={GOLD}>{t('exPaused')}</Chip> : <Chip color={GREEN}>{t('exEarned', { n: workoutBodyPoints(w, elapsedMs(w, now)) })}</Chip>}
        </div>
        <div className="ex-time" role="timer" aria-label={t('exElapsed')}>{formatClock(elapsedMs(w, now))}</div>
        {p.total > 0 && (
          <div className="ex-meter">
            <PixelProgressBar value={p.done} max={p.total} look="seg_green" scale={1} label={t('exSetsDone', { n: p.done, total: p.total })} />
            <span className="muted">{t('exSetsDone', { n: p.done, total: p.total })}</span>
          </div>
        )}
        {rest > 0 && (
          <div className="ex-restbox" role="status">
            <div className="row between"><span className="ex-rest">{t('exRest', { s: rest })}</span><PixelButton scale={1} size="compact" variant="red" onClick={onSkipRest}>{t('exSkipRest')}</PixelButton></div>
            <PixelProgressBar value={rest} max={restSecs} look="seg_blue" scale={1} label={t('exRest', { s: rest })} />
          </div>
        )}
        <div className="ex-two">
          <PixelButton scale={1} variant={paused ? 'green' : 'red'} onClick={() => (paused ? actions.resumeWorkout(w.id) : actions.pauseWorkout(w.id))}>
            <Icon name={paused ? 'symbol_play' : 'symbol_pause'} size={16} /> {paused ? t('exResume') : t('exPause')}
          </PixelButton>
          <PixelButton scale={1} disabled={w.exercises.length >= MAX_EXERCISES} onClick={onAdd}><Icon name="symbol_plus" size={16} /> {t('exAddExercise')}</PixelButton>
        </div>
      </PixelFrame>

      {w.exercises.length === 0 && <PixelFrame theme={STONE} scale={1} className="ex-empty"><Icon name="body_inactive" size={32} /><span className="muted small">{t('exNoExercises')}</span></PixelFrame>}
      <div className="ex-cards">{w.exercises.map(e => <ExerciseCard key={e.id} w={w} e={e} onLogged={onRest} />)}</div>

      <div className="ex-two ex-end">
        <PixelButton scale={1} onClick={onFinish}>{t('exFinish')}</PixelButton>
        <PixelButton scale={1} variant="red" onClick={onDiscard}>{t('exDiscard')}</PixelButton>
      </div>
    </>
  );
}

/** One exercise: its sets as boxes to tap. The next open set is lit; a finished exercise turns green. */
function ExerciseCard({ w, e, onLogged }: { w: Workout; e: Exercise; onLogged: () => void }) {
  const { t } = useI18n();
  const [logging, setLogging] = useState<string | null>(null);
  const doneN = e.sets.filter(s => s.completed).length;
  const next = e.sets.find(s => !s.completed);
  const target = e.sets.find(s => s.id === logging), unit = useUnit();
  return (
    <PixelFrame theme={STONE} scale={1} className={`ex-card ${next ? '' : 'done'}`} style={{ '--c': TYPE_COLOR[e.type] } as React.CSSProperties}>
      <div className="row between ex-card-head">
        <div className="ex-card-name">
          <h2>{e.name}</h2>
          <span className="ex-type">{t(TYPE_KEY[e.type])} · {doneN}/{e.sets.length}</span>
        </div>
        <button type="button" className="ex-x" aria-label={`${t('exRemove')}: ${e.name}`} onClick={() => actions.removeExercise(w.id, e.id)}><Icon name="bin" size={24} /></button>
      </div>
      <div className="ex-sets">
        {e.sets.map(s => {
          const text = setText(s, e, unit);
          return (
            <PickBox key={s.id} color={s.completed ? SET_DONE : SET_TODO} selected={s.id === next?.id} onClick={() => setLogging(s.id)}>
              <span className="ex-set" aria-label={t('exSetN', { n: s.setNumber })}>
                <strong>{s.completed ? '✓' : s.setNumber}</strong>
                {text && <span>{text}</span>}
              </span>
            </PickBox>
          );
        })}
      </div>
      {next && <PixelButton scale={1} onClick={() => setLogging(next.id)}>{t('exLogSet', { n: next.setNumber })}</PixelButton>}
      {target && <SetDialog w={w} e={e} s={target} onClose={() => setLogging(null)}
        onSave={v => { actions.completeSet(w.id, e.id, target.id, v); setLogging(null); onLogged(); }} />}
    </PixelFrame>
  );
}

/** Log one set: reps, weight and time, whichever the exercise has (Android walks through them one at a time). */
function SetDialog({ e, s, onClose, onSave }: { w: Workout; e: Exercise; s: ExerciseSet; onClose: () => void; onSave: (v: { reps?: number; weight?: number; duration?: number }) => void }) {
  const { t } = useI18n();
  const all = useAppState(st => st.exercise.workouts), unit = useUnit();
  const inputs = setInputs(e);
  const d = s.completed ? { reps: s.reps ?? 0, weight: s.weight ?? 0, seconds: Math.round((s.duration ?? 0) / 1000) } : setDefaults(all, e, s);   // a set already logged opens with what it holds
  // the weight is typed in the chosen unit; an untouched weight keeps its exact kg (showing 132.5 lb and back would move 60 kg a little)
  const [reps, setReps] = useState(d.reps), [weight, setWeight] = useState(showWeight(d.weight, unit)), [secs, setSecs] = useState(d.seconds);
  const kg = weight === showWeight(d.weight, unit) ? d.weight : weightKg(weight, unit);
  const pr = exercisePR(all, e.name), av = rollingAverages(all, e.name, s.setNumber);
  const none = !inputs.reps && !inputs.weight && !inputs.time;
  return (
    <Modal open onClose={onClose} title={e.name} theme="app">
      <div className="ex-dialog">
        <div className="row"><Chip color={TYPE_COLOR[e.type]}>{t('exSetN', { n: s.setNumber })} / {e.sets.length}</Chip></div>
        {inputs.reps && <Stepper label={t('exReps')} value={reps} step={1} min={0} onChange={setReps} />}
        {inputs.weight && <Stepper label={t('exWeightIn', { unit })} value={weight} step={weightStep(unit)} min={0} onChange={n => setWeight(roundHalf(n))} />}
        {inputs.weight && (
          <div className="ex-pravg">
            <div><span className="muted">{t('exPR')}</span><strong>{pr === undefined ? '--' : showWeight(pr, unit)}</strong></div>
            <div><span className="muted">{t('exAvg')}</span><strong>{av.weight === undefined ? '--' : showWeight(av.weight, unit)}</strong></div>
          </div>
        )}
        {inputs.time && <Stepper label={t('exTime')} value={secs} step={5} min={0} show={mmss} onChange={setSecs} />}
        {none && <div className="muted small">{t('exNothing')}</div>}
        <div className="ex-two">
          <PixelButton scale={1} onClick={() => onSave({ ...(inputs.reps ? { reps } : {}), ...(inputs.weight ? { weight: kg } : {}), ...(inputs.time ? { duration: secs * 1000 } : {}) })}>{t('exDone')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
        </div>
      </div>
    </Modal>
  );
}

/** Weights / calisthenics / cardio, as the app's own toggle chips. */
function TypePick({ value, onChange }: { value: ExerciseType; onChange: (t: ExerciseType) => void }) {
  const { t } = useI18n();
  return (
    <div className="ex-types" role="group" aria-label={t('exType')}>
      {EXERCISE_TYPES.map(x => <button type="button" key={x} className={`seg ${x === value ? 'on' : ''}`} aria-pressed={x === value} onClick={() => onChange(x)}>{t(TYPE_KEY[x])}</button>)}
    </div>
  );
}

/** The names to choose from, plus a field for one that is not listed. */
function NamePick({ names, value, onChange }: { names: string[]; value: string; onChange: (n: string) => void }) {
  const { t } = useI18n();
  return (
    <>
      <div className="ex-pick" role="group" aria-label={t('exLibrary')}>
        {names.map(n => <button type="button" key={n} className={`seg ${n === value ? 'on' : ''}`} aria-pressed={n === value} onClick={() => onChange(n)}>{n}</button>)}
      </div>
      <label className="field"><span className="muted">{t('exName')}</span><input type="text" value={value} maxLength={40} onChange={e => onChange(e.target.value)} /></label>
    </>
  );
}

/** Pick a known exercise or type your own, set how many sets and reps, add it to the running workout. */
function AddExercise({ open, onClose, workouts, onAdd }: { open: boolean; onClose: () => void; workouts: Workout[]; onAdd: (p: { name: string; type: ExerciseType; sets: number; reps?: number }) => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<ExerciseType>('WEIGHT_TRAINING');
  const [name, setName] = useState('');
  const [sets, setSets] = useState(3), [reps, setReps] = useState(8);
  const timed = type === 'CARDIO';
  return (
    <Modal open={open} onClose={onClose} title={t('exAddExercise')} theme="app">
      <div className="ex-dialog">
        <TypePick value={type} onChange={x => { setType(x); setName(''); if (x === 'CARDIO') setSets(1); }} />
        <NamePick names={exerciseLibrary(workouts)[type]} value={name} onChange={setName} />
        <Stepper label={t('exSets')} value={sets} step={1} min={1} onChange={n => setSets(Math.min(20, n))} />
        {!timed && <Stepper label={t('exReps')} value={reps} step={1} min={0} onChange={setReps} />}
        <div className="ex-two">
          <PixelButton scale={1} disabled={!name.trim()} onClick={() => { onAdd({ name, type, sets, reps: timed || reps === 0 ? undefined : reps }); setName(''); }}>{t('exAdd')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
        </div>
      </div>
    </Modal>
  );
}

/** One exercise logged after the fact (Android: QuickLogDialog). */
function QuickLog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (points: number | null) => void }) {
  const { t } = useI18n();
  const workouts = useAppState(s => s.exercise.workouts), unit = useUnit();
  const [type, setType] = useState<ExerciseType>('CARDIO');
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(30), [sets, setSets] = useState(3), [reps, setReps] = useState(10), [weight, setWeight] = useState(0);
  const lifting = type === 'WEIGHT_TRAINING', cardio = type === 'CARDIO';
  return (
    <Modal open={open} onClose={onClose} title={t('exQuick')} theme="app">
      <div className="ex-dialog">
        <TypePick value={type} onChange={x => { setType(x); setName(''); }} />
        <NamePick names={exerciseLibrary(workouts)[type]} value={name} onChange={setName} />
        <Stepper label={t('exMinutes')} value={minutes} step={5} min={0} onChange={setMinutes} />
        {!cardio && <Stepper label={t('exSets')} value={sets} step={1} min={1} onChange={n => setSets(Math.min(20, n))} />}
        {!cardio && <Stepper label={t('exReps')} value={reps} step={1} min={0} onChange={setReps} />}
        {lifting && <Stepper label={t('exWeightIn', { unit })} value={weight} step={weightStep(unit)} min={0} onChange={n => setWeight(roundHalf(n))} />}
        <div className="ex-two">
          <PixelButton scale={1} disabled={!name.trim()} onClick={() => onSaved(actions.quickLog({ name, type, minutes, sets: cardio ? 1 : sets, reps: cardio || reps === 0 ? undefined : reps, weight: lifting && weight > 0 ? weightKg(weight, unit) : undefined }))}>{t('exSave')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
        </div>
      </div>
    </Modal>
  );
}

/** Ready-made workouts to start from (Android: WorkoutLibraryScreen). */
function Presets({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (p: (typeof WORKOUT_PRESETS)[number]) => void }) {
  const { t } = useI18n();
  const [sel, setSel] = useState<string | null>(null);
  const p = WORKOUT_PRESETS.find(x => x.id === sel);
  return (
    <Modal open={open} onClose={() => { setSel(null); onClose(); }} title={p ? t(PRESET_KEY[p.id]) : t('exWorkoutLibrary')} theme="app">
      <div className="ex-dialog">
        {!p && (
          <div className="ex-presets">
            {WORKOUT_PRESETS.map(x => (
              <PixelFrame as="button" key={x.id} theme={STONE} scale={1} className="ex-preset" onClick={() => setSel(x.id)}>
                <span>{t(PRESET_KEY[x.id])}</span>
                <span className="muted">{t('exSummary', { n: x.exercises.length, s: x.exercises.reduce((n, e) => n + e.sets, 0) })}</span>
              </PixelFrame>
            ))}
          </div>
        )}
        {p && (
          <>
            <div className="ex-hist-body">
              {p.exercises.map((x, i) => (
                <div key={i} className="ex-line" style={{ '--c': TYPE_COLOR[x.type] } as React.CSSProperties}>
                  <span>{x.name}</span><span className="muted">{x.sets}{x.reps ? ` x ${x.reps}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="ex-two">
              <PixelButton scale={1} onClick={() => { setSel(null); onStart(p); }}><Icon name="symbol_play" size={16} /> {t('exStart')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => setSel(null)}>{t('back')}</PixelButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Everything you can pick, by type, with the ones you added yourself marked (Android: ExerciseLibraryScreen). */
function Library({ open, onClose, workouts, onChart }: { open: boolean; onClose: () => void; workouts: Workout[]; onChart: (name: string) => void }) {
  const { t } = useI18n();
  const lib = exerciseLibrary(workouts);
  const own = (type: ExerciseType, n: string) => !(COMMON_EXERCISES as Record<string, string[]>)[type]?.includes(n);
  return (
    <Modal open={open} onClose={onClose} title={t('exLibrary')} theme="app">
      <div className="ex-dialog">
        {EXERCISE_TYPES.map(type => (
          <section key={type} className="ex-lib" style={{ '--c': TYPE_COLOR[type] } as React.CSSProperties}>
            <h2 className="ex-label">{t(TYPE_KEY[type])} ({lib[type].length})</h2>
            <div className="row ex-wrap ex-chips">{lib[type].map(n => <button type="button" key={n} className="ex-chipbtn" title={t('exProgress')} onClick={() => onChart(n)}><Chip color={own(type, n) ? GREEN : GREY}>{n}</Chip></button>)}</div>
          </section>
        ))}
        <div className="row between"><span className="row muted small"><Chip color={GREEN}>{t('exOwn')}</Chip></span><PixelButton scale={1} variant="red" onClick={onClose}>{t('exClose')}</PixelButton></div>
      </div>
    </Modal>
  );
}

/** How one exercise went over time: a line through its heaviest set (or most reps, or longest set) in each finished workout. */
function Progress({ name, workouts, onClose }: { name: string; workouts: Workout[]; onClose: () => void }) {
  const { t, lang } = useI18n();
  const unit = useUnit();
  const all = exerciseProgress(workouts, name), points = all.slice(-30), measure = progressMeasure(points);
  const value = (p: (typeof points)[number]) => (measure === 'best' ? showWeight(p.best ?? 0, unit) : measure === 'reps' ? p.reps ?? 0 : Math.round((p.duration ?? 0) / 1000));
  const show = (v: number) => (measure === 'best' ? `${v}${unit}` : measure === 'reps' ? `x${v}` : mmss(v));
  const vs = points.map(value), hi = Math.max(1, ...vs), lo = Math.min(hi, ...vs), W = 240, H = 90, P = 6;
  const x = (i: number) => (points.length < 2 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1)), y = (v: number) => H - P - ((v - lo) / Math.max(1e-9, hi - lo || hi)) * (H - 2 * P);
  const date = (ms: number) => new Date(ms).toLocaleDateString(DATE_LOCALE[lang], { day: 'numeric', month: 'short' });
  return (
    <Modal open onClose={onClose} title={name} theme="app">
      <div className="ex-dialog">
        {!measure ? <div className="muted small">{t('exNoProgress')}</div> : (<>
          <div className="muted small">{t(measure === 'best' ? 'exChartBest' : measure === 'reps' ? 'exChartReps' : 'exChartTime')}</div>
          <svg className="ex-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}: ${vs.map(show).join(', ')}`}>
            <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="ex-chart-axis" />
            {points.length > 1 && <polyline className="ex-chart-line" points={vs.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />}
            {vs.map((v, i) => <rect key={i} className="ex-chart-dot" x={x(i) - 2} y={y(v) - 2} width={4} height={4} />)}
          </svg>
          <div className="row between small"><span className="muted">{date(points[0].at)}</span><span className="muted">{date(points[points.length - 1].at)}</span></div>
          <div className="ex-pravg">
            <div><span className="muted">{t('exChartFirst')}</span><strong>{show(vs[0])}</strong></div>
            <div><span className="muted">{t('exChartLast')}</span><strong>{show(vs[vs.length - 1])}</strong></div>
            <div><span className="muted">{t('exPR')}</span><strong>{show(Math.max(...vs))}</strong></div>
          </div>
          <div className="muted small">{t('exChartCount', { n: all.length })}</div>
        </>)}
        <div className="row"><PixelButton scale={1} variant="red" onClick={onClose}>{t('exClose')}</PixelButton></div>
      </div>
    </Modal>
  );
}
