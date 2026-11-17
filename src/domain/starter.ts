import type { Key } from '../i18n';
import type { Category, Frequency, Habit, Priority, Task } from './types';
import { calculateXP } from './xp';

/**
 * "Start Here" suggestions. Android's catalogue (Daily / Weekly / Monthly), the best tiny starters of the old web app (make
 * your bed, drink a glass of water, look at a plant...) and the ones added to fill the scale up to difficulty 9.
 */
export type Period = 'daily' | 'weekly' | 'monthly';
export const PERIODS: Period[] = ['daily', 'weekly', 'monthly'];
export const STAT_ORDER: Category[] = ['MIND', 'BODY', 'SOUL'];
export type Topic = 'home' | 'garden' | 'free' | 'career' | 'skills';

/**
 * The benchmark scale. A suggestion's difficulty is not picked by feel: it follows from how long the thing takes
 * (DIFFICULTY_MINUTES: the longest a task of that difficulty lasts), moved one step up for hard physical effort or one step
 * down for pure leisure. Its priority follows from the difficulty, so the XP climbs with every step:
 *   D0 5 · D1 6 · D2 12 · D3 13 · D4 15 · D5 23 · D6 28 · D7 36 · D8 54 · D9 75 XP.
 * Every stat has at least two suggestions on every step, so any task of your own can be measured against them.
 */
export const DIFFICULTY_MINUTES = [2, 5, 15, 30, 60, 180, 480, 1200, 2400, 6000] as const;
export const DIFFICULTY_PRIORITY: readonly Priority[] = ['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'HIGH', 'CRITICAL', 'CRITICAL'];
/** The difficulty a task of this length has on the scale (before any effort step). */
export const difficultyForMinutes = (m: number) => { const i = DIFFICULTY_MINUTES.findIndex(max => m <= max); return i < 0 ? 9 : i; };
/** What a suggestion of this difficulty pays. */
export const benchmarkXP = (d: number) => calculateXP(DIFFICULTY_PRIORITY[d], d);
/** The difficulties each period offers: small things daily, real projects monthly. */
export const PERIOD_RANGE: Record<Period, [number, number]> = { daily: [0, 4], weekly: [2, 6], monthly: [4, 9] };

export interface StarterTask {
  id: string; period: Period; stat: Category; difficulty: number; priority: Priority; minutes: number; topic?: Topic;
  /** -1 leisure, +1 hard effort: the step the difficulty was moved from what its length alone gives */
  effort: -1 | 0 | 1;
  title: Key; desc: Key;
}
// [period, stat, name, minutes, topic?, effort step?]. Names starting with a capital or a digit are Android's (ids `and:`), `+name` is new (`new:`), the rest came from the old web app (`old:`).
type Row = [Period, Category, string, number, (Topic | null)?, (-1 | 1)?];
const rows: Row[] = [
  // ---- MIND
  ['daily', 'MIND', 'Read1Page', 2], ['daily', 'MIND', 'writeSentence', 2],
  ['daily', 'MIND', 'learnWord', 3], ['daily', 'MIND', 'Write1Idea', 5],
  ['daily', 'MIND', 'solvePuzzle', 10], ['daily', 'MIND', 'Learn3Words', 15], ['daily', 'MIND', 'study15', 15],
  ['daily', 'MIND', '+read20', 20], ['daily', 'MIND', '+deepWork45', 45],
  ['weekly', 'MIND', 'Organize1Drawer', 15, 'home'], ['weekly', 'MIND', '+planWeek', 15],
  ['weekly', 'MIND', 'Learn10Words', 30], ['weekly', 'MIND', 'ReadChapter', 30], ['weekly', 'MIND', 'Network1Person', 30, 'career'],
  ['weekly', 'MIND', 'Try1NewHobby', 45, 'skills'], ['weekly', 'MIND', 'WriteJournalEntry', 45], ['weekly', 'MIND', 'UpdateResume', 60, 'career'],
  ['weekly', 'MIND', 'Learn1NewSkill', 90, 'skills'], ['weekly', 'MIND', '+writeArticle', 120], ['weekly', 'MIND', '+studyAfternoon', 240],
  ['monthly', 'MIND', 'UpdateProfessionalProfile', 60, 'career'], ['monthly', 'MIND', '+monthBudget', 45],
  ['monthly', 'MIND', 'OrganizeRoom', 120, 'home'], ['monthly', 'MIND', 'AttendNetworkingEvent', 180, 'career'],
  ['monthly', 'MIND', 'WriteStory', 240], ['monthly', 'MIND', 'ReadBook', 600], ['monthly', 'MIND', 'BuildProject', 900, 'skills'],
  ['monthly', 'MIND', 'CompleteCourse', 1800], ['monthly', 'MIND', 'Master1NewSkill', 2400, 'skills'],
  ['monthly', 'MIND', '+certExam', 3600, 'career'], ['monthly', 'MIND', '+writeBook', 6000],
  // ---- BODY
  ['daily', 'BODY', 'drinkWater', 1], ['daily', 'BODY', 'Take3Breaths', 1], ['daily', 'BODY', 'Water1Plant', 2, 'garden'],
  ['daily', 'BODY', 'makeBed', 2, 'home'], ['daily', 'BODY', 'pickUp3', 2, 'home'], ['daily', 'BODY', 'wash1Dish', 2, 'home'],
  ['daily', 'BODY', 'Stretch2Min', 2, null, 1], ['daily', 'BODY', '10JumpingJacks', 2, null, 1], ['daily', 'BODY', 'walk5', 5], ['daily', 'BODY', 'plantSeed', 5, 'garden'],
  ['daily', 'BODY', 'Clean1Surface', 10, 'home'], ['daily', 'BODY', '+stretch10', 10],
  ['daily', 'BODY', '20Pushups', 10, null, 1], ['daily', 'BODY', '+walk20', 20], ['daily', 'BODY', '+run30', 30, null, 1],
  ['weekly', 'BODY', '+tidy15', 15, 'home'], ['weekly', 'BODY', 'LongWalk', 30], ['weekly', 'BODY', 'Plant3Seeds', 30, 'garden'],
  ['weekly', 'BODY', 'CompleteWorkout', 45], ['weekly', 'BODY', 'TryNewExercise', 60], ['weekly', 'BODY', 'laundry', 60, 'home'], ['weekly', 'BODY', 'Clean1Room', 60, 'home'],
  ['weekly', 'BODY', '+mealPrep', 120, 'home'], ['weekly', 'BODY', '+longRide', 120], ['weekly', 'BODY', '+dayHike', 300],
  ['monthly', 'BODY', '+healthCheck', 60], ['monthly', 'BODY', 'EstablishExerciseRoutine', 90], ['monthly', 'BODY', 'TryNewSport', 120],
  ['monthly', 'BODY', 'PlantGarden', 240, 'garden'], ['monthly', 'BODY', 'DeepCleanHome', 240, 'home'],
  ['monthly', 'BODY', '+run10k', 900], ['monthly', 'BODY', '+weekendTrek', 960],
  ['monthly', 'BODY', 'CompleteFitnessChallenge', 1800], ['monthly', 'BODY', '+trainingPlan', 2000],
  ['monthly', 'BODY', '+halfMarathon', 3600], ['monthly', 'BODY', '+renovateRoom', 4800, 'home'],
  // ---- SOUL
  ['daily', 'SOUL', 'SmileAtSomeone', 1], ['daily', 'SOUL', 'sayThanks', 1], ['daily', 'SOUL', 'lookPlant', 1, 'garden'],
  ['daily', 'SOUL', 'listenSong', 4], ['daily', 'SOUL', 'DrawSimpleShape', 5], ['daily', 'SOUL', 'playGame', 15, 'free', -1],
  ['daily', 'SOUL', 'shortPoem', 10], ['daily', 'SOUL', 'meditate10', 10], ['daily', 'SOUL', 'DrawSimplePicture', 15], ['daily', 'SOUL', 'cookMeal', 30, 'free', -1],
  ['daily', 'SOUL', '+callFamily', 20], ['daily', 'SOUL', '+hobbyHour', 60, 'free'],
  ['weekly', 'SOUL', 'PracticeGratitude', 10], ['weekly', 'SOUL', 'ConnectWithFriend', 30], ['weekly', 'SOUL', '+writeLetter', 30],
  ['weekly', 'SOUL', 'CreateSomething', 60], ['weekly', 'SOUL', 'visitPlace', 60, 'free'],
  ['weekly', 'SOUL', '+natureAfternoon', 180, 'free'], ['weekly', 'SOUL', '+hostDinner', 240],
  ['monthly', 'SOUL', '+monthReflect', 45], ['monthly', 'SOUL', 'PlanSocialEvent', 180], ['monthly', 'SOUL', 'Volunteer', 240],
  ['monthly', 'SOUL', 'CompleteArtProject', 600], ['monthly', 'SOUL', '+planTrip', 900, 'free'],
  ['monthly', 'SOUL', '+learnPiece', 1800, 'skills'], ['monthly', 'SOUL', '+dailyArtMonth', 1800],
  ['monthly', 'SOUL', '+bigCreative', 4800], ['monthly', 'SOUL', '+communityEvent', 3000],
];
export const STARTER_TASKS: StarterTask[] = rows.map(([period, stat, raw, minutes, topic, step]) => {
  const fresh = raw.startsWith('+'), name = fresh ? raw.slice(1) : raw, android = !fresh && /^[A-Z0-9]/.test(name);
  const effort = step ?? 0, difficulty = Math.max(0, Math.min(9, difficultyForMinutes(minutes) + effort));
  return {
    id: `${fresh ? 'new' : android ? 'and' : 'old'}:${name}`, period, stat, difficulty, priority: DIFFICULTY_PRIORITY[difficulty], minutes, topic: topic ?? undefined, effort,
    title: (android ? `suggestedTask${name}` : `st.${name}`) as Key, desc: (android ? `suggestedTask${name}Desc` : `st.${name}.d`) as Key,
  };
});

/** The suggestion to measure a task of your own against: one of this difficulty for this stat (a plain one before a topical one). */
export function benchmarkFor(difficulty: number, stat: Category): StarterTask | undefined {
  const list = STARTER_TASKS.filter(s => s.difficulty === difficulty && s.stat === stat);
  return list.find(s => !s.topic && s.effort === 0) ?? list[0];
}
/** The fields of the task a suggestion becomes (Start Here and Bóbr's ideas both add it this way). */
export function starterTaskInput(s: StarterTask, t: (k: Key) => string) {
  return { title: t(s.title), description: t(s.desc), category: s.stat, priority: s.priority, difficulty: s.difficulty, estimatedDuration: s.minutes, origin: s.id };
}

/** Habits pay no XP, so their scale is the effort they ask for: 1 a minute or two, 2 a real slot in the day, 3 a commitment. Every period and stat has all three. */
export type HabitEffort = 1 | 2 | 3;
export interface StarterHabit { id: string; period: Period; stat: Category; effort: HabitEffort; name: Key }
const habitRows: [Period, Category, string, HabitEffort][] = [
  ['daily', 'SOUL', 'practiceGratitude', 1], ['daily', 'SOUL', 'meditateDaily', 2], ['daily', 'SOUL', 'screenFreeEvening', 2], ['daily', 'SOUL', 'connectFriends', 3],
  ['weekly', 'SOUL', 'weeklyReflection', 1], ['weekly', 'SOUL', 'natureWeekly', 1], ['weekly', 'SOUL', 'socialConnection', 2], ['weekly', 'SOUL', 'creativePractice', 3],
  ['monthly', 'SOUL', 'monthlyReview', 1], ['monthly', 'SOUL', 'planSocialEvents', 2], ['monthly', 'SOUL', 'dayTripMonthly', 2], ['monthly', 'SOUL', 'volunteerMonthly', 3],
  ['daily', 'MIND', 'planDay', 1], ['daily', 'MIND', 'learnNewWords', 1], ['daily', 'MIND', 'readDaily', 2], ['daily', 'MIND', 'writeJournal', 2], ['daily', 'MIND', 'deepWorkDaily', 3],
  ['weekly', 'MIND', 'readWeekly', 1], ['weekly', 'MIND', 'weeklyLearning', 2], ['weekly', 'MIND', 'writeWeekly', 2], ['weekly', 'MIND', 'weeklyProject', 3],
  ['monthly', 'MIND', 'monthlyPlanning', 1], ['monthly', 'MIND', 'budgetMonthly', 2], ['monthly', 'MIND', 'monthlyReading', 2], ['monthly', 'MIND', 'skillDevelopment', 3],
  ['daily', 'BODY', 'drinkWaterDaily', 1], ['daily', 'BODY', 'stretchRoutine', 1], ['daily', 'BODY', 'walkDaily', 2], ['daily', 'BODY', 'sleepOnTime', 2], ['daily', 'BODY', 'exerciseDaily', 3],
  ['weekly', 'BODY', 'weeklyStretch', 1], ['weekly', 'BODY', 'weeklyActivity', 2], ['weekly', 'BODY', 'mealPrepWeekly', 2], ['weekly', 'BODY', 'weeklyWorkout', 3],
  ['monthly', 'BODY', 'monthlyHealthCheck', 1], ['monthly', 'BODY', 'tryNewExercise', 2], ['monthly', 'BODY', 'monthlyFitness', 3], ['monthly', 'BODY', 'bigHikeMonthly', 3],
];
export const STARTER_HABITS: StarterHabit[] = habitRows.map(([period, stat, slug, effort]) => ({ id: `habit:${period}:${stat}:${slug}`, period, stat, effort, name: `sh.${slug}` as Key }));

export const FREQUENCY: Record<Period, Frequency> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };

/** Easiest first (then shortest), keeping the catalogue order for ties. */
export function starterTasksFor(period: Period, stat: Category): StarterTask[] {
  return STARTER_TASKS.map((t, i) => [t, i] as const).filter(([t]) => t.period === period && t.stat === stat)
    .sort(([a, i], [b, j]) => a.difficulty - b.difficulty || a.minutes - b.minutes || i - j).map(([t]) => t);
}
/** Lightest first, keeping the catalogue order for ties. */
export const starterHabitsFor = (period: Period, stat: Category) => STARTER_HABITS.filter(h => h.period === period && h.stat === stat).sort((a, b) => a.effort - b.effort);

const norm = (s: string) => s.trim().toLowerCase();
/** A suggestion counts as "added" while an open task (or any habit) from it exists: matched by origin, or by title as a fallback. */
export function isTaskAdded(id: string, title: string, tasks: Pick<Task, 'origin' | 'title' | 'completed'>[]) {
  return tasks.some(t => !t.completed && (t.origin === id || norm(t.title) === norm(title)));
}
export function isHabitAdded(id: string, name: string, habits: Pick<Habit, 'origin' | 'title'>[]) {
  return habits.some(h => h.origin === id || norm(h.title) === norm(name));
}
/** How many times tasks from this suggestion have been completed (0 if never). */
export function timesDone(id: string, tasks: Pick<Task, 'origin' | 'completed' | 'completionCount'>[]) {
  return tasks.filter(t => t.origin === id).reduce((n, t) => n + (t.completionCount ?? (t.completed ? 1 : 0)), 0);
}
/**
 * The recommended next step: the easiest suggestion that is not on the list yet and has never been done; once everything
 * has been done at least once, the easiest one that is not currently on the list.
 */
export function nextStarter(list: StarterTask[], titleOf: (t: StarterTask) => string, tasks: Pick<Task, 'origin' | 'title' | 'completed' | 'completionCount'>[]): StarterTask | undefined {
  const free = list.filter(s => !isTaskAdded(s.id, titleOf(s), tasks));
  return free.find(s => timesDone(s.id, tasks) === 0) ?? free[0];
}

/** 5 -> "5m", 60 -> "1h", 150 -> "2h 30m", 1800 -> "30h". */
export function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
