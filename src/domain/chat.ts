import type { Achievement, Habit, Task, UserStats } from './types';
import { achievementProgress } from './achievements';
import { bobrStage, xpForNextLevel } from './levels';
import { isOverdue } from './tasks';
import { fmtClock, nextSteps, shortlistTasks, todaySummary, dayPlan, type NextStep, type PlanData, type PlanEvent } from './planner';
import { emotionNow, hungerAt, happinessNow, type BobrVitals, type Emotion } from './bobr';
import { STARTER_TASKS, STAT_ORDER, benchmarkFor, benchmarkXP, fmtMinutes, isTaskAdded, type StarterTask } from './starter';
import type { Category } from './types';
import { achievementText, type Key, type TFn } from '../i18n';

/** Port of Android ChatViewModel. Pure: (context, flow, option) -> (reply, next flow). All text goes through `ctx.t`. */

export interface DialogOption { id: string; text: string }
export interface ChatContext { stats: UserStats; tasks: Task[]; habits: Habit[]; achievements: Achievement[]; userName: string | null; now: number; t: TFn;
  /** the planner's activities and shortlist (left out = none) */
  events?: readonly PlanEvent[]; shortlist?: readonly string[];
  /** Bóbr himself and what is in the bag (left out = a content Bóbr and an empty bag) */
  bobr?: BobrVitals & { feedings: number; trades?: number; treatUntil?: number; mischiefUntil?: number }; inventory?: Readonly<Record<string, number>> }
export interface ChatFlow {
  mode: 'main' | 'achievements' | 'suggest' | 'next' | 'bobr' | 'idea' | 'guide';   // next: working through what to do now, one thing at a time; bobr: talking about Bóbr himself; idea: new tasks from the catalogue
  /** guide: the topic being read (an id from GUIDE) */
  guideId?: string;
  /** idea: the suggestion on offer (a Start Here id); `previous` holds the ones already offered */
  ideaId?: string;
  /** next: the thing on offer (a task, habit or activity id); `previous` holds what was already offered */
  nextId?: string;
  step: 1 | 2 | 3 | 4; // suggestion: 1 feeling, 2 time, 3 willingness, 4 suggested
  feeling?: string; time?: string; will?: string; // option ids
  suggestedTaskId?: string;
  rerolls: number;
  previous: string[];
  /** the joke / quote / tip / fact / pep talk just shown, so the next one is a different one */
  lastLine?: string;
}
export const initialFlow = (): ChatFlow => ({ mode: 'main', step: 1, rerolls: 0, previous: [] });
export const MAX_REROLLS = 2;

const FEELINGS: Record<string, Key> = { feeling_good: 'chatFeelingGood', feeling_okay: 'chatFeelingOkay', feeling_tired: 'chatFeelingTired', feeling_stressed: 'chatFeelingStressed', feeling_energetic: 'chatFeelingEnergetic' };
const TIMES: Record<string, Key> = { time_5min: 'chatTime5Min', time_15min: 'chatTime15Min', time_30min: 'chatTime30Min', time_1hour: 'chatTime1Hour', time_more: 'chatTimeMore' };
const WILLS: Record<string, Key> = { will_yes: 'chatYes', will_maybe: 'chatMaybe', will_no: 'chatNo' };
const numbered = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}` as Key);
const MOTIVATION_KEYS: Key[] = [
  'masterBuilderMessage', 'damGrowsMightyMessage', 'progressImpressiveMessage', 'everyTaskAddsStickMessage', 'damGrowsStrongerMessage',
  ...numbered('motivationalMessage', 36),
];
const FACT_KEYS = numbered('chatFact', 20), JOKE_KEYS = numbered('chatJoke', 20), QUOTE_KEYS = numbered('chatQuote', 22), TIP_KEYS = numbered('chatTip', 14);
export const MOTIVATION_COUNT = MOTIVATION_KEYS.length, FACT_COUNT = FACT_KEYS.length, JOKE_COUNT = JOKE_KEYS.length, QUOTE_COUNT = QUOTE_KEYS.length, TIP_COUNT = TIP_KEYS.length;
export const BERRY_THANKS_COUNT = 3;
/** A random line from `keys`, never the one shown just before (asking again always gives a new one). */
function pickLine(keys: readonly Key[], f: ChatFlow, rand: () => number): Key {
  let i = Math.min(keys.length - 1, Math.floor(rand() * keys.length));
  if (keys[i] === f.lastLine) i = (i + 1) % keys.length;
  return keys[i];
}
const MOOD_KEY: Record<Emotion, Key> = { HAPPY: 'chatMoodHappy', NEUTRAL: 'chatMoodNeutral', SLEEPY: 'chatMoodSleepy', EXCITED: 'chatMoodExcited', HUNGRY: 'chatMoodHungry', MISCHIEVOUS: 'chatMoodNeutral', SAD: 'chatMoodSad' };
const STAT_KEY: Record<Category, Key> = { BODY: 'body', MIND: 'mind', SOUL: 'soul' };

// ---- the guide: what every part of the app does ---------------------------------------------------
/** One topic per feature: its button, its explanation, and the screen it lives on (none = nothing to open). */
export const GUIDE: readonly { id: string; name: Key; text: Key; path?: string }[] = [
  { id: 'chat', name: 'chatGuideNameChat', text: 'chatGuideChat' },
  { id: 'levels', name: 'chatGuideNameLevels', text: 'chatGuideLevels', path: '/' },
  { id: 'tasks', name: 'chatGuideNameTasks', text: 'chatGuideTasks', path: '/tasks' },
  { id: 'habits', name: 'chatGuideNameHabits', text: 'chatGuideHabits', path: '/habits' },
  { id: 'plan', name: 'chatGuideNamePlan', text: 'chatGuidePlan', path: '/plan' },
  { id: 'start', name: 'chatGuideNameStart', text: 'chatGuideStart', path: '/start' },
  { id: 'trophies', name: 'chatGuideNameTrophies', text: 'chatGuideTrophies', path: '/achievements' },
  { id: 'home', name: 'chatGuideNameHome', text: 'chatGuideHome', path: '/' },
  { id: 'games', name: 'chatGuideNameGames', text: 'chatGuideGames', path: '/games' },
  { id: 'notes', name: 'chatGuideNameNotes', text: 'chatGuideNotes', path: '/apps/notes' },
  { id: 'mindmap', name: 'chatGuideNameMindmap', text: 'chatGuideMindmap', path: '/apps/mindmap' },
  { id: 'pixelite', name: 'chatGuideNamePixelite', text: 'chatGuidePixelite', path: '/apps/pixelite' },
  { id: 'sanctuary', name: 'chatGuideNameSanctuary', text: 'chatGuideSanctuary', path: '/apps/sanctuary' },
  { id: 'exercise', name: 'chatGuideNameExercise', text: 'chatGuideExercise', path: '/apps/exercise' },
  { id: 'settings', name: 'chatGuideNameSettings', text: 'chatGuideSettings', path: '/settings' },
  { id: 'theme', name: 'chatGuideNameTheme', text: 'chatGuideTheme', path: '/theme' },
];

// ---- Bóbr himself --------------------------------------------------------------------------------
const have = (c: ChatContext, item: string) => c.inventory?.[item] ?? 0;
const moodOf = (c: ChatContext): Emotion => (c.bobr ? emotionNow(c.bobr, c.now) : 'NEUTRAL');
function moodText(c: ChatContext): string {
  const { t } = c, mood = moodOf(c);
  let m = t(MOOD_KEY[mood]);
  if (c.bobr) {
    const pct = (n: number) => Math.round(n * 100);
    m += `\n\n${t('hunger')}: ${pct(hungerAt(c.bobr.lastInteraction, c.now))}%\n${t('happiness')}: ${pct(happinessNow(c.bobr, c.now))}%\n${t('chatFedTimes', { n: c.bobr.feedings })}\n${t('chatTradedTimes', { n: c.bobr.trades ?? 0 })}`;
  }
  if (mood === 'HUNGRY') m += `\n\n${t(have(c, 'berry') ? 'chatHungryHaveBerry' : have(c, 'hay') ? 'chatHungryHaveHay' : 'chatHungryNoFood')}`;
  return m;
}

// ---- ideas: new tasks from the Start Here catalogue ------------------------------------------------
/** The stat that lags behind (Body, then Mind, then Soul on a tie). */
const weakestStat = (c: ChatContext): Category => STAT_ORDER.map(s => s).sort((a, b) => c.stats[a.toLowerCase() as 'body'] - c.stats[b.toLowerCase() as 'body'])[0];
const scaleLine = (c: ChatContext, s: StarterTask) => `D${s.difficulty} · ${benchmarkXP(s.difficulty)} XP · ${fmtMinutes(s.minutes)}`;
/** Offer the suggestion nearest to the wanted difficulty, for the weakest stat, that is not on the task list and was not offered yet. */
function offerIdea(c: ChatContext, f: ChatFlow, want: number): { reply: string; flow: ChatFlow } {
  const { t } = c, stat = weakestStat(c);
  const open = STARTER_TASKS.filter(s => s.stat === stat && !f.previous.includes(s.id) && !isTaskAdded(s.id, t(s.title), c.tasks));
  if (!open.length) return { reply: t('chatIdeaNone'), flow: initialFlow() };
  const pick = open.reduce((a, b) => (Math.abs(b.difficulty - want) < Math.abs(a.difficulty - want) ? b : a));
  return {
    reply: `${t('chatIdeaFor', { stat: t(STAT_KEY[stat]) })}\n\n'${t(pick.title)}'\n${t(pick.desc)}\n\n${scaleLine(c, pick)}`,
    flow: { ...initialFlow(), mode: 'idea', ideaId: pick.id, previous: [...f.previous, pick.id] },
  };
}
/** Where a builder of this level starts on the scale: level 1 at the bottom, one step up per level. */
export const ideaDifficulty = (level: number) => Math.max(0, Math.min(9, level - 1));
/** The whole scale in ten lines, one example per difficulty (the stats take turns). */
function scaleText(c: ChatContext): string {
  const { t } = c;
  const lines = Array.from({ length: 10 }, (_, d) => { const s = benchmarkFor(d, STAT_ORDER[d % 3])!; return `${scaleLine(c, s)}\n${t(s.title)}`; });
  return `${t('chatXpHow')}\n\n${lines.join('\n\n')}\n\n${t('chatXpTip')}`;
}

// ---- achievements helpers -------------------------------------------------------------------
function achCtx(c: ChatContext) { return { stats: c.stats, maxHabitStreak: c.habits.reduce((m, h) => Math.max(m, h.streak, h.bestStreak), 0) }; }
const visibleAch = (c: ChatContext) => c.achievements.filter(a => a.category !== 'SPECIAL'); // minigame ones hidden until ported
function achGroups(c: ChatContext) {
  const all = visibleAch(c), locked = all.filter(a => !a.unlocked), ctx = achCtx(c);
  const prog = (a: Achievement) => achievementProgress(a.condition, ctx);
  return {
    completed: all.filter(a => a.unlocked).sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)),
    locked,
    inProgress: locked.filter(a => (prog(a)?.current ?? 0) > 0),
    notStarted: locked.filter(a => (prog(a)?.current ?? 0) === 0),
    prog,
  };
}

// ---- the plan (shared with the Planner screen) -------------------------------------------------
const planOf = (c: ChatContext): PlanData => ({ events: c.events ?? [], shortlist: c.shortlist ?? [], tasks: c.tasks, habits: c.habits });
const NEXT_WHY: Record<NextStep['why'], Key> = { now: 'chatNextNow', late: 'chatNextLate', shortlist: 'chatNextShort', today: 'chatNextToday', planned: 'chatNextPlanned', habit: 'chatNextHabit', urgent: 'chatNextUrgent' };
function describeStep(c: ChatContext, s: NextStep): string {
  const head = `${c.t(NEXT_WHY[s.why])}\n\n`;
  if (s.kind === 'event') return `${head}${s.event.time != null ? `${fmtClock(s.event.time)} ` : ''}'${s.event.title}'${s.event.note ? `\n${s.event.note}` : ''}`;
  if (s.kind === 'habit') return `${head}'${s.habit.title}'`;
  return `${head}'${s.task.title}'\n${s.task.experienceReward} XP${s.task.estimatedDuration ? `, ${s.task.estimatedDuration} min` : ''}`;
}
/** Offer the most pressing thing not offered yet. */
function offerNext(c: ChatContext, f: ChatFlow, said = ''): { reply: string; flow: ChatFlow } {
  const step = nextSteps(planOf(c), c.now).find(s => !f.previous.includes(s.id));
  const lead = said ? `${said}\n\n` : '';
  if (!step) return { reply: lead + c.t(f.previous.length ? 'chatNextNoMore' : 'chatNextNone'), flow: initialFlow() };
  return { reply: lead + describeStep(c, step), flow: { ...initialFlow(), mode: 'next', nextId: step.id, previous: [...f.previous, step.id] } };
}
function todayText(c: ChatContext): string {
  const { t } = c, p = planOf(c), s = todaySummary(p, c.now);
  if (s.total === 0 && s.habitsLeft === 0) return t('chatTodayEmpty');
  const plan = dayPlan(p, c.now, c.now), short = shortlistTasks(p.shortlist, p.tasks, c.now).filter(x => !x.completed);
  const parts: string[] = [];
  const open = plan.events.filter(e => !e.done);
  if (open.length) parts.push(`${t('chatTodayPlan')}\n${open.map(e => `${e.time != null ? fmtClock(e.time) : '-'} ${e.title}`).join('\n')}`);
  if (short.length) parts.push(`${t('chatTodayShort')}\n${short.map(x => `- ${x.title}`).join('\n')}`);
  const due = plan.tasks.filter(x => !x.completed && !short.includes(x)).length;   // the shortlisted ones are already listed by name
  const counts = [due ? t('chatTodayDue', { n: due }) : '', s.late ? t('chatTodayLate', { n: s.late }) : '', s.habitsLeft ? t('chatTodayHabits', { n: s.habitsLeft }) : ''].filter(Boolean);
  if (counts.length) parts.push(counts.join('\n'));
  return parts.join('\n\n');
}
/** Bóbr's first message: the greeting, plus one line about today when there is anything to do. */
export function chatGreeting(c: ChatContext): string {
  const s = todaySummary(planOf(c), c.now), mood = moodOf(c);
  const aside = mood === 'HUNGRY' ? `\n\n${c.t('chatGreetHungry')}` : mood === 'EXCITED' ? `\n\n${c.t('chatGreetExcited')}` : '';
  return (s.total === 0 ? c.t('chatGreeting') : `${c.t('chatGreeting')}\n\n${c.t('chatTodayLine', { plan: s.events, todo: s.total - s.events, late: s.late })}`) + aside;
}

// ---- options ------------------------------------------------------------------------------
export function chatOptions(c: ChatContext, f: ChatFlow): DialogOption[] {
  const { t } = c;
  const opts = (list: [string, string][]): DialogOption[] => list.map(([id, text]) => ({ id, text }));
  const pick = (m: Record<string, Key>): [string, string][] => Object.entries(m).map(([id, k]) => [id, t(k)]);
  if (f.mode === 'suggest') {
    const cancel: [string, string] = ['cancel_task_suggestion', t('chatCancel')];
    if (f.step === 1) return opts([...pick(FEELINGS), cancel]);
    if (f.step === 2) return opts([...pick(TIMES), cancel]);
    if (f.step === 3) return opts([...pick(WILLS), cancel]);
    const list: [string, string][] = [];
    if (f.suggestedTaskId) list.push(['complete_task', t('completeTask')]);
    if (f.rerolls < MAX_REROLLS) list.push(['reroll_task', t('chatRerollFormat', { remaining: MAX_REROLLS - f.rerolls, total: MAX_REROLLS })]);
    list.push(['go_back', t('chatGoBack')]);
    return opts(list);
  }
  if (f.mode === 'next') {
    const step = nextSteps(planOf(c), c.now).find(s => s.id === f.nextId);
    return opts([...(step ? [['next_done', t(step.kind === 'task' ? 'completeTask' : 'chatNextDone')] as [string, string]] : []), ['next_skip', t('chatNextSkip')], ['go_back', t('chatGoBack')]]);
  }
  if (f.mode === 'idea') {
    const idea = STARTER_TASKS.find(s => s.id === f.ideaId);
    return opts([...(idea ? [['idea_add', t('chatIdeaAdd')], ['idea_other', t('chatIdeaOther')],
      ...(idea.difficulty > 0 ? [['idea_easier', t('chatIdeaEasier')]] : []), ...(idea.difficulty < 9 ? [['idea_harder', t('chatIdeaHarder')]] : [])] as [string, string][] : []), ['go_back', t('chatGoBack')]]);
  }
  if (f.mode === 'guide') {
    const here = GUIDE.find(g => g.id === f.guideId);
    return opts([...(here?.path ? [['guide_go', t('chatGuideGo', { name: t(here.name) })] as [string, string]] : []), ...GUIDE.filter(g => g.id !== f.guideId).map(g => [`guide_${g.id}`, t(g.name)] as [string, string]), ['go_back', t('chatGoBack')]]);
  }
  if (f.mode === 'bobr') {
    const list: [string, string][] = [];
    if (have(c, 'berry')) list.push(['feed_berry', t('chatGiveBerry', { n: have(c, 'berry') })]);
    if (have(c, 'hay') && moodOf(c) === 'HUNGRY') list.push(['feed_hay', t('chatGiveHay', { n: have(c, 'hay') })]);
    list.push(['berries_ask', t('chatBerriesAsk')], ['fact_ask', t('chatFactAsk')], ['joke_ask', t('chatJokeAsk')], ['go_back', t('chatGoBack')]);
    return opts(list);
  }
  if (f.mode === 'achievements') {
    const g = achGroups(c);
    return opts([
      ['achievements_in_progress', t('chatInProgressFormat', { count: g.inProgress.length })], ['achievements_completed', t('chatCompletedFormat', { count: g.completed.length })],
      ['achievements_locked', t('chatLockedFormat', { count: g.locked.length })], ['achievements_not_started', t('chatNotStartedFormat', { count: g.notStarted.length })],
      ['achievements_back', t('chatGoBack')],
    ]);
  }
  const list: [string, string][] = [['guide_ask', t('chatGuideAsk')], ['next_ask', t('chatNext')], ['today_ask', t('chatToday')], ['suggest_task_ask', t('chatSuggestTask')], ['idea_ask', t('chatIdeaAsk')], ['motivation_ask', t('chatMotivateMe')], ['quote_ask', t('chatQuoteAsk')], ['tip_ask', t('chatTipAsk')], ['stats_ask', t('chatMyStats')]];
  if (c.tasks.length) list.push(['tasks_ask', t('chatMyTasks')]);
  if (c.tasks.some(x => (x.completionCount ?? 0) > 0)) list.push(['favourite_ask', t('chatFavouriteAsk')]);
  if (c.habits.length) list.push(['habits_ask', t('chatMyHabits')]);
  if (visibleAch(c).length) list.push(['achievements_ask', t('chatMyAchievements')]);
  list.push(['improve_ask', t('chatHowDoIImprove')], ['xp_ask', t('chatXpAsk')], ['bobr_ask', t('chatBobrAsk')], ['close_chat', t('chatCloseChat')]);
  return opts(list);
}

// ---- suggestion ---------------------------------------------------------------------------
function suggest(c: ChatContext, f: ChatFlow): { message: string; taskId?: string } {
  const { t } = c;
  const pending = c.tasks.filter(x => !x.completed && !f.previous.includes(x.id));
  const overdue = pending.filter(x => isOverdue(x, c.now));
  const high = pending.filter(x => x.priority === 'HIGH' || x.priority === 'CRITICAL');
  let task: Task | undefined;
  let m = `${t('chatBasedOn')}\n\n`;
  if (f.feeling) m += `${t('chatFeelingLabel')} ${t(FEELINGS[f.feeling])}\n`;
  if (f.time) m += `${t('chatTimeLabel')} ${t(TIMES[f.time])}\n`;
  if (f.will) m += `${t('chatWillLabel')} ${t(WILLS[f.will])}\n\n`;
  const line = (x: Task) => `'${x.title}'\n${x.experienceReward} XP\n\n`;

  if (f.feeling === 'feeling_tired' || f.feeling === 'feeling_stressed') {
    m += `${t('chatEasyTask')}\n`;
    if (pending.length) { task = pending.reduce((a, b) => (b.experienceReward < a.experienceReward ? b : a)); m += line(task); }
    else m += `${t('chatRestOrLightTask')}\n\n`;
  } else if (f.feeling === 'feeling_energetic') {
    m += `${t('chatChallenge')}\n`;
    task = high[0] ?? (pending.length ? pending.reduce((a, b) => (b.experienceReward > a.experienceReward ? b : a)) : undefined);
    if (task) m += line(task);
  } else if (overdue.length) {
    task = overdue[0]; m += `${t('chatOverdue')}\n'${task.title}'\n\n`;
  } else if (pending.length) {
    task = pending[0]; m += line(task);
  }
  if (f.time) m += t(f.time === 'time_5min' ? 'chatQuickTask' : f.time === 'time_15min' ? 'chatShortTask' : f.time === 'time_30min' ? 'chatMediumTask' : 'chatLongTask') + '\n';
  if (f.will === 'will_yes') m += `\n${t('chatYouGotThis')}`; else if (f.will === 'will_maybe') m += `\n${t('chatTryIt')}`; else if (f.will === 'will_no') m += `\n${t('chatMaybeLater')}`;
  return { message: m, taskId: task?.id };
}

// ---- replies ------------------------------------------------------------------------------
export interface ChatResult {
  reply: string; flow: ChatFlow; completeTaskId?: string; completeHabitId?: string; doneEventId?: string;
  /** what the chat screen must do: feed Bóbr this, or add this Start Here suggestion to the tasks */
  feed?: 'berry' | 'hay'; addStarterId?: string;
  /** open this screen (the guide's "take me there") */
  go?: string;
}
export function chatReply(id: string, c: ChatContext, f: ChatFlow, rand: () => number = Math.random): ChatResult {
  const { t, stats } = c;
  const same = (reply: string, flow: ChatFlow = f) => ({ reply, flow });
  const dayWord = (n: number) => (n === 1 ? t('day').toLowerCase() : t('days'));
  const bestStreak = () => c.habits.reduce((m, h) => Math.max(m, h.streak, h.bestStreak), 0);
  const WHAT_TO_DO = t('chatWhatWouldYouLikeToDo');
  const ach = (a: Achievement) => achievementText(t, a);

  switch (id) {
    case 'guide_ask': return same(t('chatGuideIntro'), { ...initialFlow(), mode: 'guide' });
    case 'guide_go': {
      const g = GUIDE.find(x => x.id === f.guideId);
      return g?.path ? { reply: t('chatGuideGoing', { name: t(g.name) }), flow: f, go: g.path } : same(WHAT_TO_DO, initialFlow());
    }
    case 'today_ask': return same(todayText(c));
    case 'next_ask': return offerNext(c, initialFlow());
    case 'next_skip': return offerNext(c, f);
    case 'next_done': {   // tick the thing on offer, then go straight on to the one after it
      const step = nextSteps(planOf(c), c.now).find(s => s.id === f.nextId);
      if (!step) return offerNext(c, f);
      if (step.kind === 'task') return { ...offerNext(c, f, `${t('chatTaskCompleted')}\n${t('taskDoneXp', { xp: step.task.experienceReward })}`), completeTaskId: step.id };
      if (step.kind === 'habit') return { ...offerNext(c, f, t('chatNextHabitDone')), completeHabitId: step.id };
      return { ...offerNext(c, f, t('chatNextEventDone')), doneEventId: step.id };
    }
    case 'stats_ask': {
      if (stats.totalTasksCompleted === 0 && stats.totalExperiencePoints === 0) return same(t('chatNoStatsYet', { name: c.userName || 'Builder' }));
      const need = xpForNextLevel(stats.level, stats.totalExperiencePoints);
      const top = Math.max(stats.body, stats.mind, stats.soul);
      const topKey = top === stats.body ? 'body' : top === stats.mind ? 'mind' : 'soul';
      let m = `${t('chatDamGrowingStrong')}\n\n${t('level')} ${stats.level}\n${stats.totalExperiencePoints} XP\n`;
      if (need > 0) m += `\n${t('chatToNextLevel', { need, next: stats.level + 1 })}\n`;
      m += `\n${t('body')}: ${stats.body}\n${t('mind')}: ${stats.mind}\n${t('soul')}: ${stats.soul}\n`;
      if (top > 50) m += `\n${t(topKey)} ${t('strongest')}!\n`;
      const stage = bobrStage(stats.level) === 'HATCHLING' ? 'hatchling' : bobrStage(stats.level) === 'YOUNG' ? 'young' : 'mature';
      m += `\n${t('chatBobrStage', { stage: t(stage).toLowerCase() })}\n\n${t('chatTasksDone', { n: stats.totalTasksCompleted })}`;
      return same(m);
    }
    case 'tasks_ask': {
      const open = c.tasks.filter(x => !x.completed), done = c.tasks.length - open.length;
      const late = open.filter(x => isOverdue(x, c.now)).length, high = open.filter(x => x.priority === 'HIGH' || x.priority === 'CRITICAL').length;
      if (!open.length) return same(`${t('chatNoTasks')}\n\n${t('chatDamPerfect')}`);
      let m = `${t('chatTasksLeft', { n: open.length })}\n`;
      if (done) m += `\n${t('chatDoneCount', { n: done })}\n`;
      if (late) m += `\n${t('chatOverdueCount', { n: late })}\n`;
      if (high) m += `\n${t('chatHighPriority', { n: high })}\n`;
      return same(m);
    }
    case 'favourite_ask': {
      const fav = c.tasks.filter(x => (x.completionCount ?? 0) > 0).sort((a, b) => (b.completionCount ?? 0) - (a.completionCount ?? 0) || (b.lastCompletedAt ?? 0) - (a.lastCompletedAt ?? 0))[0];
      if (!fav) return same(t('chatFavouriteNone'));
      const date = fav.lastCompletedAt ? new Date(fav.lastCompletedAt).toLocaleDateString() : '-';
      return same(t('chatFavouriteIs', { title: fav.title, n: fav.completionCount ?? 0, date }));
    }
    case 'habits_ask': {
      const best = bestStreak();
      if (best <= 0) return same(t('chatStartHabits'));
      const active = c.habits.filter(h => h.streak > 0);
      let m = `${t('chatHabitsStrong')}\n\n${t('best')}: ${best} ${dayWord(best)}\n`;
      if (active.length) {
        const top = active.reduce((a, b) => (b.streak > a.streak ? b : a));
        m += `\n${t('chatActiveCount', { n: active.length })}\n\n'${top.title}'\n${top.streak} ${dayWord(top.streak)} ${t('streak').toLowerCase()}!`;
      }
      return same(m);
    }
    // ---- Bóbr himself
    case 'bobr_ask': return same(moodText(c), { ...initialFlow(), mode: 'bobr' });
    case 'feed_berry': {
      if (!have(c, 'berry')) return same(`${t('chatNoBerries')}\n\n${t('chatBerriesWhere')}`);
      return { reply: t(`chatBerryThanks${1 + Math.floor(rand() * BERRY_THANKS_COUNT)}` as Key), flow: f, feed: 'berry' };
    }
    case 'feed_hay': {
      if (moodOf(c) !== 'HUNGRY' || !have(c, 'hay')) return same(t('chatNotHungry'));
      return { reply: t('chatHayThanks'), flow: f, feed: 'hay' };
    }
    case 'berries_ask': return same(`${t('chatBerriesWhere')}\n\n${t('chatBerriesHave', { n: have(c, 'berry') })}`);
    case 'fact_ask': case 'joke_ask': case 'motivation_ask': case 'quote_ask': case 'tip_ask': {
      const keys = id === 'fact_ask' ? FACT_KEYS : id === 'joke_ask' ? JOKE_KEYS : id === 'quote_ask' ? QUOTE_KEYS : id === 'tip_ask' ? TIP_KEYS : MOTIVATION_KEYS;
      const k = pickLine(keys, f, rand);
      return same(t(k), { ...f, lastLine: k });
    }
    case 'xp_ask': return same(scaleText(c));
    // ---- ideas from the catalogue
    case 'idea_ask': return offerIdea(c, initialFlow(), ideaDifficulty(stats.level));
    case 'idea_other': case 'idea_easier': case 'idea_harder': {
      const d = STARTER_TASKS.find(s => s.id === f.ideaId)?.difficulty ?? ideaDifficulty(stats.level);
      return offerIdea(c, f, Math.max(0, Math.min(9, d + (id === 'idea_easier' ? -1 : id === 'idea_harder' ? 1 : 0))));
    }
    case 'idea_add': {
      const idea = STARTER_TASKS.find(s => s.id === f.ideaId);
      if (!idea) return same(WHAT_TO_DO, initialFlow());
      return { reply: `${t('taskAdded', { taskName: t(idea.title) })}\n\n${t('chatIdeaAdded')}`, flow: { ...initialFlow(), previous: f.previous }, addStarterId: idea.id };
    }
    case 'improve_ask': {
      const pending = c.tasks.filter(x => !x.completed).length, best = bestStreak();
      let m = `${t('chatImprove')}\n\n`;
      if (pending > 5) m += `${t('chatPendingTasks', { n: pending })}\n${t('chatDo2To3Daily')}\n\n`;
      if (best === 0) m += `${t('chatStartHabits').split('\n')[0]}\n\n`;
      else if (best < 7) m += `${t('streak')}: ${best} ${dayWord(best)}\n${t('chatReach7')}\n\n`;
      const low = Math.min(stats.body, stats.mind, stats.soul);
      m += t(low === stats.body ? 'chatBodyLow' : low === stats.mind ? 'chatMindLow' : 'chatSoulLow') + '\n';
      return same(m + `\n${t('chatEveryActionCounts')}`);
    }
    // ---- achievements sub-menu
    case 'achievements_ask': {
      const g = achGroups(c), recent = g.completed.filter(a => (a.unlockedAt ?? 0) > c.now - 7 * 86_400_000).length;
      return same(`${t('chatUnlockedOf', { done: g.completed.length, total: visibleAch(c).length })}\n${recent ? `\n${t('chatThisWeekCount', { n: recent })}\n` : ''}\n${t('chatWhatDoYouWantToSee')}`, { ...f, mode: 'achievements' });
    }
    case 'achievements_in_progress': {
      const g = achGroups(c);
      if (!g.inProgress.length) return same(`${t('chatNoAchievementsInProgress')}\n\n${t('chatStartWorking')}`);
      return same(`${t('chatInProgressHeader')}\n\n` + g.inProgress.map(a => { const p = g.prog(a)!, x = ach(a); return `${x.title}\n${x.description}\n${p.current}/${p.target}\n\n`; }).join(''));
    }
    case 'achievements_completed': {
      const g = achGroups(c);
      if (!g.completed.length) return same(`${t('chatNoAchievementsCompleted')}\n\n${t('chatCompleteTasksToUnlock')}`);
      return same(`${t('chatCompletedHeader')}\n\n` + g.completed.map(a => { const x = ach(a); return `${x.title}\n${x.description}\n\n`; }).join(''));
    }
    case 'achievements_locked': {
      const g = achGroups(c);
      if (!g.locked.length) return same(`${t('chatAllAchievementsUnlocked')}\n\n${t('chatAmazingWork')}`);
      return same(`${t('chatLockedHeader')}\n\n` + g.locked.map(a => { const x = ach(a); return `${x.title}\n${t('chatToUnlock')} ${x.description}\n\n`; }).join(''));
    }
    case 'achievements_not_started': {
      const g = achGroups(c);
      if (!g.notStarted.length) return same(`${t('chatAllAchievementsStarted')}\n\n${t('chatGreatProgress')}`);
      return same(`${t('chatNotStartedHeader')}\n\n` + g.notStarted.map(a => { const x = ach(a); return `${x.title}\n${x.description}\n\n`; }).join(''));
    }
    case 'achievements_back': case 'go_back': case 'cancel_task_suggestion':
      return same(WHAT_TO_DO, initialFlow());
    // ---- suggestion flow
    case 'suggest_task_ask': return same(t('chatHowDoYouFeel'), { ...initialFlow(), mode: 'suggest', step: 1 });
    case 'complete_task': {
      const task = c.tasks.find(x => x.id === f.suggestedTaskId);
      if (!task) return same(WHAT_TO_DO, initialFlow());
      if (task.completed) return same(t('chatTaskAlreadyCompleted'), initialFlow());
      return { reply: `${t('chatTaskCompleted')}\n${t('taskDoneXp', { xp: task.experienceReward })}`, flow: initialFlow(), completeTaskId: task.id };
    }
    case 'reroll_task': {
      if (f.rerolls >= MAX_REROLLS) return same(`${t('chatNoMoreRerolls')}\n\n${t('chatAllAttemptsUsed')}`);
      const r = suggest(c, f);
      if (!r.taskId) return same(`${t('chatNoMoreTasks')}\n\n${t('chatAllTasksSuggested')}`);
      return same(r.message, { ...f, step: 4, suggestedTaskId: r.taskId, rerolls: f.rerolls + 1, previous: [...f.previous, r.taskId] });
    }
  }
  if (id.startsWith('guide_')) {
    const g = GUIDE.find(x => `guide_${x.id}` === id);
    if (g) return same(t(g.text), { ...initialFlow(), mode: 'guide', guideId: g.id });
  }
  if (id in FEELINGS) return same(t('chatHowMuchTime'), { ...f, step: 2, feeling: id });
  if (id in TIMES) return same(t('chatWillYouDoIt'), { ...f, step: 3, time: id });
  if (id in WILLS) {
    const next = { ...f, will: id };
    const r = suggest(c, next);
    return same(r.message, { ...next, step: 4, suggestedTaskId: r.taskId, previous: r.taskId ? [...f.previous, r.taskId] : f.previous });
  }
  return same(WHAT_TO_DO);
}
