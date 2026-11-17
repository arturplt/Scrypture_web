/**
 * Exercise tracker (port of Android's ExerciseTracker: WorkoutEntity / ExerciseEntity / ExerciseSetEntity).
 * Android keeps three tables; here a workout holds its exercises and an exercise holds its sets, which saves and exports as one piece.
 * Pure rules only: nothing here reads the clock or the store.
 */

export type ExerciseType = 'WEIGHT_TRAINING' | 'CARDIO' | 'BODYWEIGHT' | 'OTHER';
export const EXERCISE_TYPES: ExerciseType[] = ['WEIGHT_TRAINING', 'BODYWEIGHT', 'CARDIO'];   // the three the libraries list (Android hides OTHER)

export interface ExerciseSet {
  id: string;
  setNumber: number;
  reps?: number;
  /** kg */
  weight?: number;
  /** ms, for timed sets (cardio, planks) */
  duration?: number;
  completed: boolean;
  completedAt?: number;
}
export interface Exercise { id: string; name: string; type: ExerciseType; sets: ExerciseSet[] }
export interface Workout {
  id: string;
  name?: string;
  startTime: number;
  endTime?: number;
  /** ms actually trained: the clock time without the paused stretches (set when it is finished) */
  duration?: number;
  completed: boolean;
  /** total ms spent paused so far */
  pausedMs: number;
  /** set while paused: when the pause began */
  pausedAt?: number;
  bodyPointsAwarded: number;
  exercises: Exercise[];
}
export interface ExerciseSave { workouts: Workout[] }
export const emptyExerciseSave = (): ExerciseSave => ({ workouts: [] });

export const MAX_WORKOUTS = 500;
export const MAX_EXERCISES = 30;
export const MAX_SETS = 20;
export const REST_SECONDS = 60;
/** How many finished workouts the averages look back over (Android: 10). */
export const AVERAGE_WORKOUTS = 10;

// ---- the libraries (Android: ExerciseLibrarySelectionDialog and WorkoutLibraryScreen)

export const COMMON_EXERCISES: Record<'WEIGHT_TRAINING' | 'CARDIO' | 'BODYWEIGHT', string[]> = {
  WEIGHT_TRAINING: ['Bench Press', 'Squats', 'Deadlifts', 'Shoulder Press', 'Barbell Rows', 'Bicep Curls', 'Tricep Extensions', 'Leg Press', 'Lat Pulldowns', 'Chest Flyes'],
  CARDIO: ['Running', 'Cycling', 'Swimming', 'Rowing', 'Elliptical', 'Jump Rope', 'Walking', 'HIIT'],
  BODYWEIGHT: ['Push-ups', 'Pull-ups', 'Sit-ups', 'Planks', 'Burpees', 'Lunges', 'Dips', 'Mountain Climbers'],
};

export interface PlannedExercise { name: string; type: ExerciseType; sets: number; reps?: number; weight?: number }
export interface WorkoutPreset { id: string; name: string; exercises: PlannedExercise[] }
const W = (name: string, sets: number, reps?: number): PlannedExercise => ({ name, type: 'WEIGHT_TRAINING', sets, reps });
const B = (name: string, sets: number, reps?: number): PlannedExercise => ({ name, type: 'BODYWEIGHT', sets, reps });
const C = (name: string): PlannedExercise => ({ name, type: 'CARDIO', sets: 1 });

export const WORKOUT_PRESETS: WorkoutPreset[] = [
  { id: 'full', name: 'Full Body', exercises: [W('Squats', 3, 10), W('Bench Press', 3, 8), W('Deadlifts', 3, 5), B('Pull-ups', 3, 8), B('Planks', 3)] },
  { id: 'upper', name: 'Upper Body', exercises: [W('Bench Press', 4, 8), W('Shoulder Press', 3, 10), W('Barbell Rows', 3, 10), W('Bicep Curls', 3, 12), W('Tricep Extensions', 3, 12)] },
  { id: 'lower', name: 'Lower Body', exercises: [W('Squats', 4, 10), W('Deadlifts', 3, 5), W('Leg Press', 3, 12), B('Lunges', 3, 12)] },
  { id: 'cardio', name: 'Cardio', exercises: [C('Running'), C('Cycling'), C('Rowing')] },
  { id: 'bodyweight', name: 'Bodyweight', exercises: [B('Push-ups', 3, 15), B('Pull-ups', 3, 10), B('Sit-ups', 3, 20), B('Planks', 3), B('Burpees', 3, 10)] },
  { id: 'push', name: 'Push Day', exercises: [W('Bench Press', 4, 8), W('Shoulder Press', 3, 10), W('Chest Flyes', 3, 12), W('Tricep Extensions', 3, 12)] },
  { id: 'pull', name: 'Pull Day', exercises: [W('Deadlifts', 3, 5), W('Barbell Rows', 4, 8), W('Lat Pulldowns', 3, 10), W('Bicep Curls', 3, 12), B('Pull-ups', 3, 10)] },
  { id: 'legs', name: 'Legs Day', exercises: [W('Squats', 4, 8), W('Leg Press', 3, 12), W('Deadlifts', 3, 6), B('Lunges', 3, 12), B('Planks', 3)] },
];

/** The exercises to pick from: the common ones plus anything logged before, by type, without repeats (Android's getAllUniqueExercises, merged with the common list). */
export function exerciseLibrary(workouts: Workout[]): Record<ExerciseType, string[]> {
  const out: Record<ExerciseType, string[]> = { WEIGHT_TRAINING: [...COMMON_EXERCISES.WEIGHT_TRAINING], BODYWEIGHT: [...COMMON_EXERCISES.BODYWEIGHT], CARDIO: [...COMMON_EXERCISES.CARDIO], OTHER: [] };
  for (const w of workouts) for (const e of w.exercises) {
    const list = out[e.type];
    if (!list.some(n => n.toLowerCase() === e.name.toLowerCase())) list.push(e.name);
  }
  for (const t of Object.keys(out) as ExerciseType[]) out[t].sort((a, b) => a.localeCompare(b));
  return out;
}

// ---- time

/** Milliseconds trained so far: the clock time minus every pause, including the one in progress. */
export function elapsedMs(w: Workout, now: number): number {
  if (w.completed) return w.duration ?? 0;
  const paused = w.pausedMs + (w.pausedAt !== undefined ? Math.max(0, now - w.pausedAt) : 0);
  return Math.max(0, now - w.startTime - paused);
}
/** 1:05:09 or 05:09 */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** What was done in the last `days` days: finished workouts, minutes trained and Body points earned. */
export function exerciseSummary(workouts: Workout[], now: number, days = 7): { workouts: number; minutes: number; points: number } {
  const recent = workouts.filter(w => w.completed && w.startTime > now - days * 86_400_000);
  return { workouts: recent.length, minutes: Math.round(recent.reduce((n, w) => n + (w.duration ?? 0), 0) / 60_000), points: recent.reduce((n, w) => n + w.bodyPointsAwarded, 0) };
}
/** Sets done and sets in all, for the progress bar of a workout. */
export function setProgress(w: Workout): { done: number; total: number } {
  const sets = w.exercises.flatMap(e => e.sets);
  return { done: sets.filter(s => s.completed).length, total: sets.length };
}

// ---- body points (Android: WorkoutRepository.calculateBodyPoints; 1 per 5 minutes up to 20, 1 per exercise up to 10, 1 per 5 sets up to 10)

export function bodyPoints(durationMs: number, exercises: number, sets: number): number {
  const d = Math.min(20, Math.floor(Math.max(0, durationMs) / (5 * 60_000)));
  return d + Math.min(10, exercises) + Math.min(10, Math.floor(sets / 5));
}
export const workoutBodyPoints = (w: Workout, durationMs: number) => bodyPoints(durationMs, w.exercises.length, w.exercises.reduce((n, e) => n + e.sets.length, 0));

// ---- history lookups (only finished workouts count, like Android)

const finished = (workouts: Workout[]) => workouts.filter(w => w.completed).sort((a, b) => b.startTime - a.startTime);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const doneSets = (workouts: Workout[], name: string) => workouts.flatMap(w => w.exercises.filter(e => sameName(e.name, name)).flatMap(e => e.sets.filter(s => s.completed)));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Average reps / weight / duration of one set number over the last finished workouts that did this exercise. */
export function rollingAverages(workouts: Workout[], name: string, setNumber: number, limit = AVERAGE_WORKOUTS): { reps?: number; weight?: number; duration?: number } {
  const sets = doneSets(finished(workouts).slice(0, limit), name).filter(s => s.setNumber === setNumber);
  const reps = avg(sets.flatMap(s => (s.reps === undefined ? [] : [s.reps])));
  const weight = avg(sets.flatMap(s => (s.weight === undefined ? [] : [s.weight])));
  const duration = avg(sets.flatMap(s => (s.duration === undefined ? [] : [s.duration])));
  return { reps: reps === undefined ? undefined : Math.trunc(reps), weight, duration: duration === undefined ? undefined : Math.trunc(duration) };
}
/** The heaviest completed set ever logged in a finished workout, if any had a weight. */
export function exercisePR(workouts: Workout[], name: string): number | undefined {
  const ws = doneSets(finished(workouts), name).flatMap(s => (s.weight === undefined ? [] : [s.weight]));
  return ws.length ? Math.max(...ws) : undefined;
}
/** The weight of the most recently completed set of this exercise (the active workout counts too). */
export function lastWeight(workouts: Workout[], name: string): number | undefined {
  const sets = doneSets(workouts, name).filter(s => s.weight !== undefined).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return sets[0]?.weight;
}
export const roundHalf = (x: number) => Math.round(x * 2) / 2;

/** What the set dialog starts at (Android: SetEditDialog.defaultValues): history, then the set before, then the set itself, then a plain default. */
export function setDefaults(workouts: Workout[], ex: Exercise, set: ExerciseSet): { reps: number; weight: number; seconds: number } {
  const prev = ex.sets.find(s => s.setNumber === set.setNumber - 1);
  const av = rollingAverages(workouts, ex.name, set.setNumber);
  return {
    reps: av.reps ?? prev?.reps ?? set.reps ?? 8,
    weight: roundHalf(lastWeight(workouts, ex.name) ?? prev?.weight ?? set.weight ?? 0),
    seconds: Math.round((av.duration ?? prev?.duration ?? set.duration ?? 60_000) / 1000),
  };
}
/** Which values a set asks for, by exercise type (Android: hasRepsSupport / supportsWeight / supportsDuration). */
export function setInputs(ex: Exercise): { reps: boolean; weight: boolean; time: boolean } {
  return { reps: ex.sets.some(s => s.reps !== undefined), weight: ex.type === 'WEIGHT_TRAINING', time: ex.type === 'CARDIO' || ex.type === 'BODYWEIGHT' || ex.sets.some(s => s.duration !== undefined) };
}

// ---- building

export function newExercise(id: (i: number) => string, p: PlannedExercise): Exercise {
  const n = Math.max(1, Math.min(MAX_SETS, Math.trunc(p.sets) || 1));
  return {
    id: id(0), name: cleanExerciseName(p.name), type: p.type,
    sets: Array.from({ length: n }, (_, i) => ({ id: id(i + 1), setNumber: i + 1, reps: p.reps, weight: p.weight, completed: false })),
  };
}
export const cleanExerciseName = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 40);
export const cleanWorkoutName = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || undefined;

// ---- loading a save

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
const TYPES = new Set<string>(['WEIGHT_TRAINING', 'CARDIO', 'BODYWEIGHT', 'OTHER']);

function sanitizeSet(r: unknown, i: number): ExerciseSet | null {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id) return null;
  const reps = num(r.reps), weight = num(r.weight), duration = num(r.duration), completedAt = num(r.completedAt);
  return { id: r.id, setNumber: i + 1, reps: reps === undefined ? undefined : Math.trunc(reps), weight, duration: duration === undefined ? undefined : Math.trunc(duration), completed: r.completed === true, completedAt };
}
function sanitizeExercise(r: unknown): Exercise | null {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') return null;
  const name = cleanExerciseName(r.name);
  if (!name) return null;
  const sets: ExerciseSet[] = [];
  for (const s of Array.isArray(r.sets) ? r.sets : []) {
    const ok = sanitizeSet(s, sets.length);
    if (ok && !sets.some(x => x.id === ok.id)) sets.push(ok);
    if (sets.length >= MAX_SETS) break;
  }
  return { id: r.id, name, type: TYPES.has(r.type) ? r.type : 'OTHER', sets };
}
export function sanitizeWorkout(r: unknown): Workout | null {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id) return null;
  const startTime = num(r.startTime);
  if (startTime === undefined) return null;
  const exercises: Exercise[] = [];
  for (const e of Array.isArray(r.exercises) ? r.exercises : []) {
    const ok = sanitizeExercise(e);
    if (ok && !exercises.some(x => x.id === ok.id)) exercises.push(ok);
    if (exercises.length >= MAX_EXERCISES) break;
  }
  const completed = r.completed === true;
  return {
    id: r.id, name: typeof r.name === 'string' ? cleanWorkoutName(r.name) : undefined, startTime, endTime: num(r.endTime), duration: num(r.duration),
    completed, pausedMs: num(r.pausedMs) ?? 0, pausedAt: completed ? undefined : num(r.pausedAt),
    bodyPointsAwarded: Math.trunc(num(r.bodyPointsAwarded) ?? 0), exercises,
  };
}
/** Keeps at most one unfinished workout (the newest), like Android's "the active workout" query. */
export function sanitizeExerciseSave(raw: unknown): ExerciseSave {
  const list: Workout[] = [];
  for (const r of isObj(raw) && Array.isArray(raw.workouts) ? raw.workouts : []) {
    const w = sanitizeWorkout(r);
    if (w && !list.some(x => x.id === w.id)) list.push(w);
  }
  const open = list.filter(w => !w.completed).sort((a, b) => b.startTime - a.startTime);
  const drop = new Set(open.slice(1).map(w => w.id));
  const workouts = list.filter(w => !drop.has(w.id)).sort((a, b) => b.startTime - a.startTime).slice(0, MAX_WORKOUTS);
  return { workouts };
}
