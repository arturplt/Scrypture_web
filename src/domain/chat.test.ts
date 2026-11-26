import { describe, expect, it } from 'vitest';
import { GUIDE, chatGreeting, ideaDifficulty, STARTER_TASKS, HUNGER_FULL_MS, chatOptions, chatReply, initialFlow, seedAchievements, initialStats, MOTIVATION_COUNT, FACT_COUNT, JOKE_COUNT, QUOTE_COUNT, TIP_COUNT, type ChatContext, type ChatFlow, type Task } from './index';
import { makeT } from '../i18n';

const mk = (id: string, o: Partial<Task> = {}): Task => ({
  id, title: id, category: 'BODY', priority: 'LOW', difficulty: 0, completed: false, experienceReward: 5,
  statRewards: { body: 1, mind: 0, soul: 0 }, tags: [], createdAt: 0, updatedAt: 0, ...o,
});
const ctx = (o: Partial<ChatContext> = {}): ChatContext => ({
  stats: initialStats(), tasks: [], habits: [], achievements: seedAchievements(), userName: 'Artur', now: 1_000_000_000_000, t: makeT('EN'), ...o,
});
const ids = (c: ChatContext, f: ChatFlow = initialFlow()) => chatOptions(c, f).map(o => o.id);
/** Walk the suggestion flow with the given option ids. */
function walk(c: ChatContext, picks: string[]) {
  let f = initialFlow(), reply = '', done: string | undefined;
  for (const p of picks) { const r = chatReply(p, c, f); f = r.flow; reply = r.reply; done = r.completeTaskId ?? done; }
  return { f, reply, done };
}

describe('chat options', () => {
  it('main menu depends on context', () => {
    expect(ids(ctx())).toEqual(['guide_ask', 'next_ask', 'today_ask', 'suggest_task_ask', 'idea_ask', 'pushups_ask', 'motivation_ask', 'quote_ask', 'tip_ask', 'stats_ask', 'achievements_ask', 'improve_ask', 'xp_ask', 'bobr_ask', 'close_chat']);
    const full = ctx({ tasks: [mk('a')], habits: [{ id: 'h', title: 'h', category: 'BODY', frequency: 'DAILY', streak: 0, bestStreak: 0, lastCompleted: null, createdAt: 0, updatedAt: 0 }] });
    expect(ids(full)).toContain('tasks_ask'); expect(ids(full)).toContain('habits_ask');
  });
  it('achievement menu has counts and hides minigame ones', () => {
    const c = ctx();
    const opts = chatOptions(c, chatReply('achievements_ask', c, initialFlow()).flow);
    expect(opts.map(o => o.text)).toEqual(['In Progress (0)', 'Completed (0)', 'Locked (11)', 'Not Started (11)', 'Go Back']);
  });
});

describe('guide', () => {
  it('lists every feature, reads one, and offers to open it', () => {
    const c = ctx();
    const open = chatReply('guide_ask', c, initialFlow());
    expect(open.flow.mode).toBe('guide');
    expect(ids(c, open.flow)).toEqual([...GUIDE.map(g => `guide_${g.id}`), 'go_back']);
    const tasks = chatReply('guide_tasks', c, open.flow);
    expect(tasks.reply).toContain('quick task');
    expect(tasks.flow.guideId).toBe('tasks');
    expect(ids(c, tasks.flow)[0]).toBe('guide_go');
    expect(ids(c, tasks.flow)).not.toContain('guide_tasks');
    expect(chatReply('guide_go', c, tasks.flow).go).toBe('/tasks');
    expect(ids(c, chatReply('guide_chat', c, open.flow).flow)).not.toContain('guide_go');
    expect(chatReply('go_back', c, tasks.flow).flow.mode).toBe('main');
  });
});

describe('replies', () => {
  it('stats before and after progress', () => {
    expect(chatReply('stats_ask', ctx(), initialFlow()).reply).toContain("I don't have your stats yet");
    const c = ctx({ stats: { ...initialStats(), level: 2, totalExperiencePoints: 120, body: 60, totalTasksCompleted: 3 } });
    const r = chatReply('stats_ask', c, initialFlow()).reply;
    expect(r).toContain('Level 2'); expect(r).toContain('130 XP to level 3'); expect(r).toContain('Body strongest!'); expect(r).toContain('Tasks: 3');
  });
  it('tasks summary', () => {
    const day = new Date(2026, 0, 10).getTime();
    const c = ctx({ now: new Date(2026, 0, 12).getTime(), tasks: [mk('a', { dueDate: day }), mk('b', { priority: 'CRITICAL' }), mk('c', { completed: true })] });
    expect(chatReply('tasks_ask', c, initialFlow()).reply).toBe('Tasks left: 2\n\nDone: 1!\n\nOverdue! 1!\n\nHigh priority: 1\n');
    expect(chatReply('tasks_ask', ctx({ tasks: [mk('c', { completed: true })] }), initialFlow()).reply).toBe('No tasks!\n\nDam perfect!');
  });
  it('favourite task is the one done most often, and only offered once something was done', () => {
    expect(ids(ctx({ tasks: [mk('a')] }))).not.toContain('favourite_ask');
    const c = ctx({ tasks: [mk('a', { completionCount: 2 }), mk('b', { completionCount: 5, lastCompletedAt: 1_000_000_000_000 }), mk('c')] });
    expect(ids(c)).toContain('favourite_ask');
    const reply = chatReply('favourite_ask', c, initialFlow()).reply;
    expect(reply).toContain("'b'");
    expect(reply).toContain('Done 5 times');
  });
  it('motivation picks from the list', () => {
    const first = chatReply('motivation_ask', ctx(), initialFlow(), () => 0).reply;
    const last = chatReply('motivation_ask', ctx(), initialFlow(), () => 0.999).reply;
    expect(first).toBe('You are a Master Builder! Your dam stands strong.');
    expect(last).toBe('A small task finished beats a perfect plan that never starts.');
    expect(MOTIVATION_COUNT).toBe(41);
  });
  it('habits reply', () => {
    const h = { id: 'h', title: 'Stretch', category: 'BODY', frequency: 'DAILY', streak: 3, bestStreak: 5, lastCompleted: 1, createdAt: 0, updatedAt: 0 } as const;
    expect(chatReply('habits_ask', ctx({ habits: [h] }), initialFlow()).reply).toBe("Habits strong!\n\nBest: 5 days\n\nActive: 1\n\n'Stretch'\n3 days streak!");
  });
});

describe('task suggestion flow', () => {
  const tasks = [mk('cheap', { experienceReward: 5 }), mk('big', { experienceReward: 60 }), mk('hi', { priority: 'HIGH', experienceReward: 20 }), mk('mid', { experienceReward: 10 })];
  it('walks the three questions and offers actions', () => {
    const c = ctx({ tasks });
    let r = chatReply('suggest_task_ask', c, initialFlow());
    expect(r.reply).toBe('How do you feel?');
    expect(ids(c, r.flow)).toEqual(['feeling_good', 'feeling_okay', 'feeling_tired', 'feeling_stressed', 'feeling_energetic', 'cancel_task_suggestion']);
    r = chatReply('feeling_good', c, r.flow); expect(r.flow.step).toBe(2);
    r = chatReply('time_15min', c, r.flow); expect(r.flow.step).toBe(3);
    r = chatReply('will_yes', c, r.flow);
    expect(r.flow.step).toBe(4);
    expect(r.reply).toContain('Feeling: Good'); expect(r.reply).toContain('Short task'); expect(r.reply).toContain('You got this!');
    expect(ids(c, r.flow)).toEqual(['complete_task', 'reroll_task', 'go_back']);
    expect(chatOptions(c, r.flow)[1].text).toBe('Reroll (2/2)');
  });
  it('tired -> cheapest, energetic -> high priority first, otherwise first pending', () => {
    const c = ctx({ tasks });
    expect(walk(c, ['suggest_task_ask', 'feeling_tired', 'time_5min', 'will_yes']).f.suggestedTaskId).toBe('cheap');
    expect(walk(c, ['suggest_task_ask', 'feeling_energetic', 'time_5min', 'will_yes']).f.suggestedTaskId).toBe('hi');
    expect(walk(c, ['suggest_task_ask', 'feeling_good', 'time_5min', 'will_no']).f.suggestedTaskId).toBe('cheap');
  });
  it('overdue task wins for neutral moods', () => {
    const c = ctx({ now: new Date(2026, 0, 12).getTime(), tasks: [mk('a'), mk('late', { dueDate: new Date(2026, 0, 1).getTime() })] });
    const r = walk(c, ['suggest_task_ask', 'feeling_okay', 'time_30min', 'will_maybe']);
    expect(r.f.suggestedTaskId).toBe('late'); expect(r.reply).toContain('Overdue!');
  });
  it('rerolls skip previous suggestions and stop after 2', () => {
    const c = ctx({ tasks: [mk('a'), mk('b'), mk('c'), mk('d')] });
    const seen: string[] = [];
    let { f } = walk(c, ['suggest_task_ask', 'feeling_okay', 'time_5min', 'will_yes']); seen.push(f.suggestedTaskId!);
    for (let i = 0; i < 2; i++) { const r = chatReply('reroll_task', c, f); f = r.flow; seen.push(f.suggestedTaskId!); }
    expect(new Set(seen).size).toBe(3);
    expect(f.rerolls).toBe(2);
    expect(ids(c, f)).toEqual(['complete_task', 'go_back']);
    expect(chatReply('reroll_task', c, f).reply).toContain('No more rerolls!');
  });
  it('runs out of tasks while rerolling', () => {
    const c = ctx({ tasks: [mk('a')] });
    const { f } = walk(c, ['suggest_task_ask', 'feeling_okay', 'time_5min', 'will_yes']);
    expect(chatReply('reroll_task', c, f).reply).toContain('No more tasks');
  });
  it('no tasks -> rest message, no complete option', () => {
    const c = ctx(); const { f, reply } = walk(c, ['suggest_task_ask', 'feeling_tired', 'time_5min', 'will_yes']);
    expect(reply).toContain('Rest or'); expect(ids(c, f)).not.toContain('complete_task');
  });
  it('complete_task returns the id once, handles already-done', () => {
    const c = ctx({ tasks });
    const { f } = walk(c, ['suggest_task_ask', 'feeling_tired', 'time_5min', 'will_yes']);
    const r = chatReply('complete_task', c, f);
    expect(r.completeTaskId).toBe('cheap'); expect(r.reply).toBe('Task completed!\n+5 XP'); expect(r.flow.mode).toBe('main');
    const done = ctx({ tasks: tasks.map(t => (t.id === 'cheap' ? { ...t, completed: true } : t)) });
    expect(chatReply('complete_task', done, f).reply).toBe('Task already\ncompleted!');
  });
  it('cancel resets to main', () => {
    expect(chatReply('cancel_task_suggestion', ctx(), { ...initialFlow(), mode: 'suggest' }).flow.mode).toBe('main');
  });
});

describe('achievement sub-menu replies', () => {
  it('in progress / completed / locked / not started', () => {
    const stats = { ...initialStats(), totalTasksCompleted: 3, totalExperiencePoints: 50 };
    const c = ctx({ stats, achievements: seedAchievements().map(a => (a.id === 'first_task' ? { ...a, unlocked: true, unlockedAt: 5 } : a)) });
    const f = chatReply('achievements_ask', c, initialFlow()).flow;
    expect(chatReply('achievements_in_progress', c, f).reply).toContain('Task Master\nComplete 10 tasks\n3/10');
    expect(chatReply('achievements_completed', c, f).reply).toBe('Completed:\n\nFirst Step\nComplete your first task\n\n');
    expect(chatReply('achievements_locked', c, f).reply).toContain('To unlock: Complete 10 tasks');
    expect(chatReply('achievements_not_started', c, f).reply).toContain('Week Warrior');
    expect(chatReply('achievements_back', c, f).flow.mode).toBe('main');
    expect(chatReply('achievements_completed', ctx(), f).reply).toContain('No achievements\ncompleted yet!');
  });
});

describe('Bóbr himself', () => {
  const NOW = new Date(2026, 0, 1, 12).getTime();
  const vitals = (o = {}) => ({ happiness: 1, happinessAt: NOW, lastInteraction: NOW, feedings: 2, ...o });
  const hungry = vitals({ lastInteraction: NOW - HUNGER_FULL_MS });
  const at = (o: Partial<ChatContext> = {}) => ctx({ now: NOW, bobr: vitals(), ...o });
  const open = (c: ChatContext) => chatReply('bobr_ask', c, initialFlow());

  it('says how he is, with hunger, happiness and how often he was fed', () => {
    const r = open(at());
    expect(r.flow.mode).toBe('bobr');
    expect(r.reply).toContain('I feel great!'); expect(r.reply).toContain('Hunger: 0%'); expect(r.reply).toContain('Happiness: 100%'); expect(r.reply).toContain('Fed: 2 times');
    expect(open(at({ bobr: hungry })).reply).toContain('The bag is empty');
    expect(open(at({ bobr: hungry, inventory: { hay: 1 } })).reply).toContain('You have hay');
    expect(open(at({ bobr: hungry, inventory: { hay: 1, berry: 1 } })).reply).toContain('You have a berry');
    expect(open(at({ bobr: vitals({ treatUntil: NOW + 1 }) })).reply).toContain('A BERRY!');
  });
  it('offers a berry whenever there is one, hay only when he is hungry', () => {
    expect(ids(at(), open(at()).flow)).toEqual(['berries_ask', 'fact_ask', 'joke_ask', 'go_back']);
    const fed = at({ inventory: { berry: 3, hay: 2 } });
    expect(chatOptions(fed, open(fed).flow).map(o => o.text)).toEqual(['Give a berry (3)', 'Where do berries grow?', 'Tell me about beavers', 'Tell me a joke', 'Go Back']);
    const starving = at({ bobr: hungry, inventory: { berry: 3, hay: 2 } });
    expect(ids(starving, open(starving).flow)).toEqual(['feed_berry', 'feed_hay', 'berries_ask', 'fact_ask', 'joke_ask', 'go_back']);
  });
  it('feeding tells the screen what to give and stays in the conversation', () => {
    const c = at({ inventory: { berry: 1 } }), f = open(c).flow;
    expect(chatReply('feed_berry', c, f, () => 0)).toMatchObject({ feed: 'berry', flow: { mode: 'bobr' } });
    const none = chatReply('feed_berry', at(), f);
    expect(none.feed).toBeUndefined(); expect(none.reply).toContain('no berries'); expect(none.reply).toContain('only grow out in the world');
    expect(chatReply('feed_hay', at({ inventory: { hay: 1 } }), f).feed).toBeUndefined();                       // not hungry: keeps the hay
    expect(chatReply('feed_hay', at({ bobr: hungry, inventory: { hay: 1 } }), f).feed).toBe('hay');
  });
  it('knows where berries grow and every fact exists', () => {
    expect(chatReply('berries_ask', at({ inventory: { berry: 4 } }), initialFlow()).reply).toContain('Berries in the bag: 4');
    const facts = new Set(Array.from({ length: FACT_COUNT }, (_, i) => chatReply('fact_ask', at(), initialFlow(), () => (i + 0.5) / FACT_COUNT).reply));
    expect(facts.size).toBe(FACT_COUNT);
    for (const f of facts) expect(f).not.toContain('chatFact');
  });
  it('every joke, quote and tip exists, and asking again never repeats the last one', () => {
    for (const [id, n] of [['joke_ask', JOKE_COUNT], ['quote_ask', QUOTE_COUNT], ['tip_ask', TIP_COUNT], ['motivation_ask', MOTIVATION_COUNT]] as const) {
      const lines = new Set(Array.from({ length: n }, (_, i) => chatReply(id, at(), initialFlow(), () => (i + 0.5) / n).reply));
      expect(lines.size, id).toBe(n);
      for (const l of lines) expect(l).not.toMatch(/^chat|^motivational/);
      const first = chatReply(id, at(), initialFlow(), () => 0);
      expect(chatReply(id, at(), first.flow, () => 0).reply, id).not.toBe(first.reply);
    }
    expect(chatReply('quote_ask', at(), initialFlow(), () => 0).reply).toContain('— Seneca');
  });
  it('the greeting mentions being hungry', () => {
    expect(chatGreeting(at())).not.toContain('hungry');
    expect(chatGreeting(at({ bobr: hungry }))).toContain("I'm hungry");
  });
});

describe('ideas and the scale', () => {
  it('explains XP with one example for each difficulty', () => {
    const r = chatReply('xp_ask', ctx(), initialFlow()).reply;
    for (const line of ['D0 · 5 XP', 'D4 · 15 XP', 'D9 · 75 XP']) expect(r).toContain(line);
    expect(r.match(/D\d · /g)).toHaveLength(10);
  });
  it('offers a suggestion for the weakest stat at the builder\'s level, and adds it', () => {
    expect([1, 5, 10, 99].map(ideaDifficulty)).toEqual([0, 4, 9, 9]);
    const c = ctx({ stats: { ...initialStats(), level: 4, body: 9, mind: 2, soul: 9 } });
    const r = chatReply('idea_ask', c, initialFlow());
    const idea = STARTER_TASKS.find(s => s.id === r.flow.ideaId)!;
    expect(idea).toMatchObject({ stat: 'MIND', difficulty: 3 });
    expect(r.reply).toContain('Your Mind could use some work'); expect(r.reply).toContain('D3 · 13 XP');
    expect(ids(c, r.flow)).toEqual(['idea_add', 'idea_other', 'idea_easier', 'idea_harder', 'go_back']);
    const added = chatReply('idea_add', c, r.flow);
    expect(added.addStarterId).toBe(idea.id); expect(added.flow.mode).toBe('main');
  });
  it('another, easier and harder never repeat an idea or one already on the list', () => {
    const c = ctx({ stats: { ...initialStats(), level: 4, mind: -1 }, tasks: [mk('x', { origin: 'new:read20' })] });
    let r = chatReply('idea_ask', c, initialFlow());
    const seen = [r.flow.ideaId!];
    const d = () => STARTER_TASKS.find(s => s.id === r.flow.ideaId)!.difficulty;
    expect(d()).toBe(3);
    r = chatReply('idea_other', c, r.flow); expect(d()).toBe(3); seen.push(r.flow.ideaId!);
    r = chatReply('idea_harder', c, r.flow); expect(d()).toBe(4); seen.push(r.flow.ideaId!);
    r = chatReply('idea_easier', c, r.flow); expect(d()).toBe(3); seen.push(r.flow.ideaId!);
    expect(new Set(seen).size).toBe(4); expect(seen).not.toContain('new:read20');
    for (let i = 0; i < 40 && r.flow.mode === 'idea'; i++) r = chatReply('idea_other', c, r.flow);                 // runs dry in the end
    expect(r.reply).toContain('no more ideas'); expect(r.flow.mode).toBe('main');
  });
  it('the bottom of the scale has no "easier", the top no "harder"', () => {
    expect(ids(ctx(), chatReply('idea_ask', ctx(), initialFlow()).flow)).not.toContain('idea_easier');
    const top = ctx({ stats: { ...initialStats(), level: 10 } });
    expect(ids(top, chatReply('idea_ask', top, initialFlow()).flow)).not.toContain('idea_harder');
  });
});

describe('pushups with Bóbr', () => {
  const session = (reps: number, score: number) => ({ id: `p${reps}`, name: 'Push-ups', startTime: 1, completed: true, pausedMs: 0, bodyPointsAwarded: 1, score, exercises: [{ id: 'e', name: 'Push-ups', type: 'BODYWEIGHT' as const, sets: [{ id: 's', setNumber: 1, reps, completed: true }] }] });
  it('is on the main menu and offers the screen after a word about the record', () => {
    const first = chatReply('pushups_ask', ctx(), initialFlow());
    expect(first.reply).toMatch(/camera/i);
    expect(ids(ctx(), first.flow)).toEqual(['pushups_go', 'go_back']);
    const rec = chatReply('pushups_ask', ctx({ workouts: [session(35, 520)] }), initialFlow());
    expect(rec.reply).toContain('520');
    expect(rec.reply).toContain('35');
  });
  it('opens the pushups screen on go, and go back returns to the menu', () => {
    const r = chatReply('pushups_go', ctx(), { ...initialFlow(), mode: 'pushups' });
    expect(r.go).toBe('/apps/exercise/pushups');
    expect(r.flow.mode).toBe('main');
    expect(chatReply('go_back', ctx(), { ...initialFlow(), mode: 'pushups' }).flow.mode).toBe('main');
  });
});
