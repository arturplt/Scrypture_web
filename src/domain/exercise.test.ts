import { describe, expect, it } from 'vitest';
import {
  bodyPoints, elapsedMs, exerciseSummary, setProgress, exerciseLibrary, exercisePR, formatClock, lastWeight, newExercise, rollingAverages, sanitizeExerciseSave, setDefaults, setInputs, workoutBodyPoints, showWeight, weightKg, weightStep, exerciseProgress, progressMeasure, restLength,
  type Workout,
} from './exercise';

let n = 0;
const ids = () => `x${++n}`;
const workout = (over: Partial<Workout> = {}): Workout => ({ id: `w${++n}`, startTime: 0, completed: true, pausedMs: 0, bodyPointsAwarded: 0, exercises: [], ...over });
/** a finished workout with one exercise whose sets are [reps, kg] */
const lifted = (start: number, name: string, sets: [number, number][]): Workout =>
  workout({ startTime: start, duration: 1, exercises: [{ id: ids(), name, type: 'WEIGHT_TRAINING', sets: sets.map(([reps, weight], i) => ({ id: ids(), setNumber: i + 1, reps, weight, completed: true, completedAt: start + i })) }] });

describe('body points (Android formula)', () => {
  it('1 per 5 minutes (max 20), 1 per exercise (max 10), 1 per 5 sets (max 10)', () => {
    expect(bodyPoints(15 * 60_000, 1, 1)).toBe(4);              // quick 15 minute run
    expect(bodyPoints(60 * 60_000, 5, 20)).toBe(21);            // gym session
    expect(bodyPoints(90 * 60_000, 8, 30)).toBe(32);
    expect(bodyPoints(999 * 60_000, 99, 999)).toBe(40);          // the cap
    expect(bodyPoints(0, 0, 0)).toBe(0);
    expect(bodyPoints(4 * 60_000 + 59_000, 0, 4)).toBe(0);
  });
  it('counts a workout\'s exercises and every set', () => {
    const w = workout({ exercises: [newExercise(ids, { name: 'Squats', type: 'WEIGHT_TRAINING', sets: 5 }), newExercise(ids, { name: 'Running', type: 'CARDIO', sets: 5 })] });
    expect(workoutBodyPoints(w, 10 * 60_000)).toBe(2 + 2 + 2);
  });
});

describe('the clock', () => {
  it('leaves out paused time, including a pause in progress', () => {
    const w = workout({ completed: false, startTime: 1000, pausedMs: 2000 });
    expect(elapsedMs(w, 6000)).toBe(3000);
    expect(elapsedMs({ ...w, pausedAt: 4000 }, 6000)).toBe(1000);   // paused again at 4000: only 1000 trained besides the old pause
    expect(elapsedMs({ ...w, completed: true, duration: 777 }, 99999)).toBe(777);
  });
  it('formats as mm:ss or h:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});

describe('history lookups', () => {
  const history = [lifted(100, 'Bench Press', [[8, 60], [8, 62.5]]), lifted(200, 'bench press', [[10, 70], [6, 80]]), lifted(300, 'Squats', [[5, 100]])];
  it('average per set number over finished workouts, names matched without case', () => {
    expect(rollingAverages(history, 'Bench Press', 1)).toMatchObject({ reps: 9, weight: 65 });
    expect(rollingAverages(history, 'Bench Press', 2)).toMatchObject({ reps: 7, weight: 71.25 });
    expect(rollingAverages(history, 'Rowing', 1)).toEqual({ reps: undefined, weight: undefined, duration: undefined });
  });
  it('only looks back over the last 10 finished workouts', () => {
    const many = [lifted(0, 'Bench Press', [[1, 999]]), ...Array.from({ length: 10 }, (_, i) => lifted(10 + i, 'Bench Press', [[5, 50]]))];
    expect(rollingAverages(many, 'Bench Press', 1).weight).toBe(50);
  });
  it('PR is the heaviest finished set; unfinished sets and workouts do not count', () => {
    expect(exercisePR(history, 'Bench Press')).toBe(80);
    expect(exercisePR(history, 'Rowing')).toBeUndefined();
    const open = lifted(400, 'Bench Press', [[1, 200]]); open.completed = false;
    expect(exercisePR([...history, open], 'Bench Press')).toBe(80);
    expect(lastWeight([...history, open], 'Bench Press')).toBe(200);   // the last weight does include the workout in progress
  });
  it('set defaults: history, then the set before, then the set itself, then 8 reps / 0 kg / 60 s', () => {
    const ex = newExercise(ids, { name: 'Bench Press', type: 'WEIGHT_TRAINING', sets: 3, reps: 5 });
    expect(setDefaults(history, ex, ex.sets[0])).toMatchObject({ reps: 9, weight: 80 });
    const fresh = newExercise(ids, { name: 'Zercher', type: 'WEIGHT_TRAINING', sets: 2 });
    expect(setDefaults([], fresh, fresh.sets[0])).toEqual({ reps: 8, weight: 0, seconds: 60 });
    fresh.sets[0].reps = 12; fresh.sets[0].weight = 41.2;
    expect(setDefaults([], fresh, fresh.sets[1])).toEqual({ reps: 12, weight: 41, seconds: 60 });
  });
  it('which values a set asks for', () => {
    expect(setInputs(newExercise(ids, { name: 'a', type: 'WEIGHT_TRAINING', sets: 1, reps: 5 }))).toEqual({ reps: true, weight: true, time: false });
    expect(setInputs(newExercise(ids, { name: 'a', type: 'CARDIO', sets: 1 }))).toEqual({ reps: false, weight: false, time: true });
    expect(setInputs(newExercise(ids, { name: 'a', type: 'BODYWEIGHT', sets: 1, reps: 5 }))).toEqual({ reps: true, weight: false, time: true });
  });
  it('the library adds what you logged and does not repeat names', () => {
    const lib = exerciseLibrary([...history, workout({ exercises: [{ id: 'e', name: 'Zercher Squat', type: 'WEIGHT_TRAINING', sets: [] }, { id: 'f', name: 'squats', type: 'WEIGHT_TRAINING', sets: [] }] })]);
    expect(lib.WEIGHT_TRAINING).toContain('Zercher Squat');
    expect(lib.WEIGHT_TRAINING.filter(x => x.toLowerCase() === 'squats')).toHaveLength(1);
    expect(lib.CARDIO).toContain('Running');
  });
});

describe('summaries', () => {
  it('adds up the last 7 days of finished workouts', () => {
    const day = 86_400_000, now = 30 * day;
    const ws = [workout({ startTime: now - day, duration: 30 * 60_000, bodyPointsAwarded: 7 }), workout({ startTime: now - 2 * day, duration: 20 * 60_000, bodyPointsAwarded: 5 }),
      workout({ startTime: now - 8 * day, duration: 99 * 60_000, bodyPointsAwarded: 30 }), workout({ startTime: now, completed: false })];
    expect(exerciseSummary(ws, now)).toEqual({ workouts: 2, minutes: 50, points: 12 });
  });
  it('counts sets done out of all sets', () => {
    const w = workout({ exercises: [newExercise(ids, { name: 'a', type: 'CARDIO', sets: 3 })] });
    w.exercises[0].sets[0].completed = true;
    expect(setProgress(w)).toEqual({ done: 1, total: 3 });
  });
});

describe('loading a save', () => {
  it('survives junk and keeps one unfinished workout', () => {
    expect(sanitizeExerciseSave(undefined)).toEqual({ workouts: [] });
    expect(sanitizeExerciseSave({ workouts: 'x' })).toEqual({ workouts: [] });
    const s = sanitizeExerciseSave({ workouts: [
      { id: 'a', startTime: 1, completed: false }, { id: 'b', startTime: 5, completed: false, exercises: [{ id: 'e', name: ' Bench  Press ', type: 'WAT', sets: [{ id: 's', reps: -4, weight: 'x', completed: 1 }, null] }] },
      { id: 'c', startTime: 3, completed: true, bodyPointsAwarded: 7.9 }, { id: 'c', startTime: 9, completed: true }, { id: 'd' }, null,
    ] });
    expect(s.workouts.map(w => w.id)).toEqual(['b', 'c']);
    expect(s.workouts[0].exercises[0]).toMatchObject({ name: 'Bench Press', type: 'OTHER', sets: [{ id: 's', setNumber: 1, reps: undefined, weight: undefined, completed: false }] });
    expect(s.workouts[1].bodyPointsAwarded).toBe(7);
  });
});

describe('units, rest and progress', () => {
  const w = (id: string, at: number, sets: { reps?: number; weight?: number }[]): Workout => ({ id, startTime: at, completed: true, duration: 60_000, pausedMs: 0, bodyPointsAwarded: 0,
    exercises: [{ id: id + 'e', name: 'Squats', type: 'WEIGHT_TRAINING', sets: sets.map((s, i) => ({ id: `${id}s${i}`, setNumber: i + 1, completed: true, ...s })) }] });
  it('shows pounds to the half and keeps kg exact', () => {
    expect(showWeight(60, 'lb')).toBe(132.5);
    expect(showWeight(60)).toBe(60);
    expect(weightKg(100, 'lb')).toBeCloseTo(45.359, 3);
    expect(weightStep('lb')).toBe(5);
  });
  it('charts the heaviest set per workout, oldest first', () => {
    const p = exerciseProgress([w('b', 2, [{ reps: 5, weight: 80 }]), w('a', 1, [{ reps: 8, weight: 60 }, { reps: 6, weight: 70 }])], 'squats');
    expect(p.map(x => x.best)).toEqual([70, 80]);
    expect(p[0].volume).toBe(8 * 60 + 6 * 70);
    expect(progressMeasure(p)).toBe('best');
    expect(progressMeasure(exerciseProgress([w('c', 1, [{ reps: 10 }])], 'Squats'))).toBe('reps');
  });
  it('keeps the unit and a known rest length from a save', () => {
    expect(sanitizeExerciseSave({ workouts: [], unit: 'lb', restSeconds: 90 })).toEqual({ workouts: [], unit: 'lb', restSeconds: 90 });
    expect(sanitizeExerciseSave({ workouts: [], unit: 'stone', restSeconds: 7 })).toEqual({ workouts: [] });
    expect(restLength({})).toBe(60);
  });
});
