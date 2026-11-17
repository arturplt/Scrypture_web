import { describe, expect, it } from 'vitest';
import {
  boardDays, boardHours, eventLength, layoutDay, placeEvent, resizeEvent, snapMinutes,
  MAX_EVENTS, SHORTLIST_MAX, addDays, chatGreeting, chatOptions, chatReply, cleanEvent, dayPlan, eventsOn, fmtClock, initialFlow, initialStats, minutesOfDay, monthGrid, monthMarks,
  nextSteps, parseClock, pruneShortlist, sanitizePlanner, seedAchievements, shortlistTasks, shortlistWith, sortEvents, todaySummary,
  type ChatContext, type ChatFlow, type Habit, type PlanData, type PlanEvent, type Task,
} from './index';
import { makeT } from '../i18n';

const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();   // November 2026
const NOW = at(16, 10, 0), TODAY = at(16), DAY = 86_400_000;
const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, title: id, category: 'MIND', priority: 'LOW', difficulty: 0, completed: false, experienceReward: 5,
  statRewards: { body: 0, mind: 1, soul: 0 }, tags: [], createdAt: 0, updatedAt: 0, ...o,
});
const habit = (id: string, lastCompleted: number | null = null): Habit => ({ id, title: id, category: 'BODY', frequency: 'DAILY', streak: 0, bestStreak: 0, lastCompleted, createdAt: 0, updatedAt: 0 });
const ev = (id: string, o: Partial<PlanEvent> = {}): PlanEvent => ({ id, title: id, day: TODAY, done: false, createdAt: 0, ...o });
const data = (o: Partial<PlanData> = {}): PlanData => ({ events: [], shortlist: [], tasks: [], habits: [], ...o });

describe('days', () => {
  it('a month view is six whole weeks starting on Monday', () => {
    const g = monthGrid(2026, 10);   // 1 November 2026 is a Sunday
    expect(g).toHaveLength(42);
    expect(new Date(g[0]).getDay()).toBe(1);
    expect(new Date(g[0]).getDate()).toBe(26);          // Monday 26 October
    expect(g).toContain(at(1)); expect(g).toContain(at(30));
    for (let i = 1; i < 42; i++) expect(g[i]).toBe(addDays(g[i - 1], 1));
    expect(new Date(monthGrid(2026, 10, 0)[0]).getDay()).toBe(0);
  });
  it('adds days across a month end and reads clock times', () => {
    expect(addDays(at(30), 1)).toBe(new Date(2026, 11, 1).getTime());
    expect(addDays(at(1), -1)).toBe(new Date(2026, 9, 31).getTime());
    expect(fmtClock(570)).toBe('09:30'); expect(fmtClock(0)).toBe('00:00');
    expect(parseClock('9:30')).toBe(570); expect(parseClock('23:59')).toBe(1439);
    expect(parseClock('24:00')).toBeUndefined(); expect(parseClock('soon')).toBeUndefined();
    expect(minutesOfDay(NOW)).toBe(600);
  });
});

describe('activities', () => {
  it('tidies an activity and refuses one without a title or day', () => {
    expect(cleanEvent({ title: '  Dentist  ', day: at(16, 15, 30), time: 930.4, minutes: 0, category: 'SOUL', note: '  bring card ' }))
      .toEqual({ title: 'Dentist', day: TODAY, time: 930, category: 'SOUL', note: 'bring card' });
    expect(cleanEvent({ title: '   ', day: TODAY })).toBeNull();
    expect(cleanEvent({ title: 'x' })).toBeNull();
    expect(cleanEvent({ title: 'x', day: TODAY, time: 5000, category: 'WORK' as never })).toEqual({ title: 'x', day: TODAY });
  });
  it('a day lists the untimed ones first, then by time', () => {
    const list = [ev('late', { time: 900 }), ev('any'), ev('early', { time: 480 }), ev('tomorrow', { day: TODAY + DAY, time: 1 })];
    expect(eventsOn(list, NOW).map(e => e.id)).toEqual(['any', 'early', 'late']);
    expect(sortEvents(list).map(e => e.id)).toEqual(['any', 'early', 'late', 'tomorrow']);
  });
  it('the month view counts open activities and open tasks per day', () => {
    const m = monthMarks({ events: [ev('a'), ev('b', { done: true }), ev('c', { day: at(20) })], tasks: [task('t', { dueDate: TODAY }), task('u', { dueDate: TODAY, completed: true }), task('v')] });
    expect(m.get(TODAY)).toEqual({ events: 1, tasks: 1 });
    expect(m.get(at(20))).toEqual({ events: 1, tasks: 0 });
    expect(m.size).toBe(2);
  });
});

describe('shortlist', () => {
  const tasks = [task('a'), task('b'), task('done-today', { completed: true, lastCompletedAt: NOW - 1000 }), task('done-before', { completed: true, lastCompletedAt: NOW - 2 * DAY })];
  it('keeps open tasks and those ticked today, in order', () => {
    expect(pruneShortlist(['b', 'gone', 'done-before', 'a', 'b', 'done-today'], tasks, NOW)).toEqual(['b', 'a', 'done-today']);
    expect(shortlistTasks(['done-today', 'a'], tasks, NOW).map(t => t.id)).toEqual(['done-today', 'a']);
  });
  it('adds only open tasks, once, up to the limit', () => {
    expect(shortlistWith(['a'], tasks, 'b', NOW)).toEqual(['a', 'b']);
    expect(shortlistWith(['a'], tasks, 'a', NOW)).toBeNull();
    expect(shortlistWith([], tasks, 'done-today', NOW)).toBeNull();
    expect(shortlistWith([], tasks, 'nope', NOW)).toBeNull();
    const many = Array.from({ length: SHORTLIST_MAX + 1 }, (_, i) => task(`t${i}`));
    expect(shortlistWith(many.slice(0, SHORTLIST_MAX).map(t => t.id), many, `t${SHORTLIST_MAX}`, NOW)).toBeNull();
  });
});

describe('a day and what to do next', () => {
  const p = data({
    events: [ev('standup', { time: 615 }), ev('dinner', { time: 1140 }), ev('tidy desk'), ev('yesterday', { day: TODAY - DAY })],
    tasks: [task('late', { dueDate: TODAY - DAY }), task('short'), task('due', { dueDate: TODAY }), task('big', { priority: 'CRITICAL' }), task('someday'), task('next week', { dueDate: at(23) })],
    shortlist: ['short'], habits: [habit('stretch'), habit('read', NOW - 1000)],
  });
  it('today shows activities, tasks due, late tasks and habits left', () => {
    const d = dayPlan(p, NOW, NOW);
    expect(d.isToday).toBe(true);
    expect(d.events.map(e => e.id)).toEqual(['tidy desk', 'standup', 'dinner']);
    expect(d.tasks.map(t => t.id)).toEqual(['due']);
    expect(d.late.map(t => t.id)).toEqual(['late']);
    expect(d.habits.map(h => h.id)).toEqual(['stretch']);
    const later = dayPlan(p, at(23), NOW);
    expect(later).toMatchObject({ isToday: false, late: [], habits: [] });
    expect(later.tasks.map(t => t.id)).toEqual(['next week']);
  });
  it('sums today up, counting a task once', () => {
    const s = todaySummary(p, NOW);
    expect(s).toMatchObject({ events: 3, shortlist: 1, dueToday: 1, late: 1, habitsLeft: 1, total: 6 });
    expect(s.nextEvent?.id).toBe('standup');
    expect(todaySummary(data({ tasks: [task('x', { dueDate: TODAY })], shortlist: ['x'] }), NOW).total).toBe(1);
    expect(todaySummary(data(), NOW)).toMatchObject({ total: 0, nextEvent: undefined });
  });
  it('orders what to do: on now, late, shortlist, due today, any-time activities, habits, urgent', () => {
    expect(nextSteps(p, NOW).map(s => `${s.why}:${s.id}`)).toEqual(['now:standup', 'late:late', 'shortlist:short', 'today:due', 'planned:tidy desk', 'habit:stretch', 'urgent:big']);
  });
  it('an activity counts as now from half an hour before until it ends', () => {
    const one = (time: number, minutes?: number) => nextSteps(data({ events: [ev('e', { time, minutes })] }), NOW).length;
    expect(one(630)).toBe(1);      // starts in 30 minutes
    expect(one(631)).toBe(0);
    expect(one(540, 60)).toBe(1);  // 09:00 for an hour: ends now
    expect(one(540, 59)).toBe(0);
    expect(nextSteps(data({ events: [ev('e', { time: 600, done: true })] }), NOW)).toEqual([]);
  });
});

describe('saving', () => {
  it('keeps what is valid', () => {
    const s = sanitizePlanner({ events: [
      { id: 'a', title: ' A ', day: at(16, 9), time: 60, done: true, createdAt: 7, junk: 1 },
      { id: 'a', title: 'again', day: TODAY }, { id: 'b', title: '', day: TODAY }, { title: 'no id', day: TODAY }, { id: 'c', title: 'no day' }, null,
    ], shortlist: ['x', 'x', 4, '', 'y', ...Array.from({ length: 20 }, (_, i) => `t${i}`)] });
    expect(s.events).toEqual([{ id: 'a', title: 'A', day: TODAY, time: 60, done: true, createdAt: 7 }]);
    expect(s.shortlist).toEqual(['x', 'y', ...Array.from({ length: SHORTLIST_MAX - 2 }, (_, i) => `t${i}`)]);
    expect(SHORTLIST_MAX).toBe(12);
    expect(sanitizePlanner('junk')).toEqual({ events: [], shortlist: [] });
    expect(sanitizePlanner({ events: Array.from({ length: MAX_EVENTS + 20 }, (_, i) => ({ id: `e${i}`, title: 'x', day: TODAY })) }).events).toHaveLength(MAX_EVENTS);
  });
});

describe('Bóbr knows the plan', () => {
  const ctx = (o: Partial<ChatContext> = {}): ChatContext => ({ stats: initialStats(), tasks: [], habits: [], achievements: seedAchievements(), userName: 'Artur', now: NOW, t: makeT('EN'), ...o });
  const busy = () => ctx({
    events: [ev('Standup', { time: 615, note: 'room 2' }), ev('Dinner', { time: 1140 })],
    tasks: [task('Pay rent', { dueDate: TODAY - DAY }), task('Write report', { estimatedDuration: 25 })], shortlist: ['Write report'], habits: [habit('Stretch')],
  });
  it('greets with a line about today only when there is something to do', () => {
    expect(chatGreeting(ctx())).toBe(makeT('EN')('chatGreeting'));
    expect(chatGreeting(busy())).toContain('Today: 2 planned, 2 to do, 1 late.');
  });
  it('tells what is on today', () => {
    expect(chatReply('today_ask', ctx(), initialFlow()).reply).toContain('Nothing planned for today.');
    const r = chatReply('today_ask', busy(), initialFlow());
    expect(r.reply).toBe('Planned:\n10:15 Standup\n19:00 Dinner\n\nShortlist:\n- Write report\n\nLate: 1\nHabits left: 1');
    expect(r.flow.mode).toBe('main');
    // a task that is both shortlisted and due today is named once, not also counted
    const both = ctx({ tasks: [task('A', { dueDate: TODAY }), task('B', { dueDate: TODAY })], shortlist: ['A'] });
    expect(chatReply('today_ask', both, initialFlow()).reply).toBe('Shortlist:\n- A\n\nDue today: 1');
  });
  it('offers one thing at a time, skipping on request, and says when there is no more', () => {
    const c = busy();
    let r = chatReply('next_ask', c, initialFlow());
    expect(r.reply).toBe("On your plan now:\n\n10:15 'Standup'\nroom 2");
    expect(chatOptions(c, r.flow).map(o => o.text)).toEqual(['Done', 'Something else', 'Go Back']);
    r = chatReply('next_skip', c, r.flow);
    expect(r.reply).toBe("This one is late:\n\n'Pay rent'\n5 XP");
    expect(chatOptions(c, r.flow).map(o => o.id)).toEqual(['next_done', 'next_skip', 'go_back']);
    expect(chatOptions(c, r.flow)[0].text).toBe('Complete Task');
    r = chatReply('next_skip', c, r.flow);
    expect(r.reply).toBe("Next on your shortlist:\n\n'Write report'\n5 XP, 25 min");
    r = chatReply('next_skip', c, r.flow);
    expect(r.reply).toContain("'Stretch'");
    r = chatReply('next_skip', c, r.flow);
    expect(r.reply).toContain('That was everything for now.');
    expect(r.flow).toEqual(initialFlow());
    expect(chatReply('next_ask', ctx(), initialFlow())).toMatchObject({ reply: expect.stringContaining('Nothing is waiting.'), flow: initialFlow() });
  });
  it('ticks the thing on offer and goes on to the next', () => {
    const c = busy();
    let f: ChatFlow = chatReply('next_ask', c, initialFlow()).flow;
    let r = chatReply('next_done', c, f);
    expect(r.doneEventId).toBe('Standup');
    expect(r.reply).toMatch(/^Ticked off\.\nWell done!\n\nThis one is late:/);
    f = r.flow;
    r = chatReply('next_done', c, f);
    expect(r.completeTaskId).toBe('Pay rent');
    expect(r.reply).toContain('Next on your shortlist:');
    r = chatReply('next_skip', c, r.flow);
    r = chatReply('next_done', c, r.flow);
    expect(r.completeHabitId).toBe('Stretch');
    expect(r.flow).toEqual(initialFlow());
    // the thing on offer is gone (done elsewhere): move on instead of failing
    expect(chatReply('next_done', ctx(), { ...initialFlow(), mode: 'next', nextId: 'gone', previous: ['gone'] }).reply).toContain('That was everything');
    expect(chatReply('go_back', c, f).flow).toEqual(initialFlow());
  });
});

describe('the board', () => {
  const D = (n: number) => new Date(2026, 10, n).getTime();   // November 2026: the 16th is a Monday
  const ev = (id: string, time?: number, minutes?: number, day = D(18)): PlanEvent => ({ id, title: id, day, time, minutes, done: false, createdAt: 0 });

  it('shows the day and the ones after it, or its whole week', () => {
    expect(boardDays(D(18) + 5000, 1)).toEqual([D(18)]);
    expect(boardDays(D(18), 3)).toEqual([D(18), D(19), D(20)]);
    expect(boardDays(D(29), 5)).toEqual([D(29), D(30), new Date(2026, 11, 1).getTime(), new Date(2026, 11, 2).getTime(), new Date(2026, 11, 3).getTime()]);
    expect(boardDays(D(18), 7)).toEqual([16, 17, 18, 19, 20, 21, 22].map(D));
    expect(boardDays(D(22), 7)[0]).toBe(D(16));                 // Sunday belongs to the week that started on Monday
    expect(boardDays(D(22), 7, 0)[0]).toBe(D(22));              // unless weeks start on Sunday
  });
  it('a dragged activity lands on quarter hours, inside the day, and keeps the rest', () => {
    const e = { ...ev('a', 600, 90), category: 'BODY' as const, note: 'n' };
    expect(placeEvent(e, D(20) + 99, 608)).toEqual({ title: 'a', day: D(20), time: 615, minutes: 90, category: 'BODY', note: 'n' });
    expect(placeEvent(e, D(18), -40).time).toBe(0);
    expect(placeEvent(e, D(18), 1439).time).toBe(1350);          // 22:30, so its 90 minutes end at midnight
    expect(placeEvent(e, D(18), undefined)).toMatchObject({ time: undefined, minutes: 90 });   // on the top lane: no time, the length is kept
    expect(placeEvent(ev('b'), D(18), 1439).time).toBe(1410);    // no length = half an hour
  });
  it('a stretched block is at least a quarter hour and ends by midnight', () => {
    expect(resizeEvent(ev('a', 600, 30), 52).minutes).toBe(45);
    expect(resizeEvent(ev('a', 600, 30), -500).minutes).toBe(15);
    expect(resizeEvent(ev('a', 1380, 30), 500).minutes).toBe(60);
    expect(snapMinutes(7)).toBe(0); expect(snapMinutes(8)).toBe(15); expect(eventLength(ev('a', 0))).toBe(30);
  });
  it('overlapping blocks share the width, the rest keep all of it', () => {
    const lay = layoutDay([ev('a', 540, 60), ev('b', 570, 60), ev('c', 600, 30), ev('d', 720, 60), ev('loose')]);
    expect(lay.map(p => [p.event.id, p.lane, p.lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1]]);
    expect(layoutDay([])).toEqual([]);
  });
  it('shows 6 to 22, widened for what lies outside on the shown days', () => {
    expect(boardHours([], [D(18)])).toEqual([6, 22]);
    expect(boardHours([ev('a', 300, 30), ev('b', 1380, 45), ev('c', 60, 30, D(25))], [D(18)])).toEqual([5, 24]);
    expect(boardHours([], [D(18)], 23 * 60 + 30)).toEqual([6, 24]);
  });
  it('the chosen span is saved, a broken one dropped', () => {
    expect(sanitizePlanner({ events: [], shortlist: [], span: 7 }).span).toBe(7);
    expect(sanitizePlanner({ events: [], shortlist: [], span: 4 })).toEqual({ events: [], shortlist: [] });
  });
});
