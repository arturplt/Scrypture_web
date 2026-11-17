import {
  addXP, emotionNow, BERRY_TREAT_MS, happinessNow, hungerAt, tradeFor, willTrade, type ItemId, canRefund, revokeTaskCompletion, UNDO_WINDOW_MS, applyTaskCompletion, calculateXP, checkAchievements, completeHabit as completeHabitRule,
  MAX_CATEGORIES, setSlotTime, placeInList, withoutGroup, categoryNameFree, cleanCategoryName, isCategoryFrame, DEFAULT_CATEGORY_FRAME, completedToday, moveInList, TASK_CHEER_MS, MISCHIEF_MS, cleanTag, retag, habitReward, QUICK_START_MS, applyReward, revokeReward, eventReward, cleanEvent, MAX_WORKOUTS, MAX_EXERCISES, elapsedMs, newExercise, cleanWorkoutName, workoutBodyPoints, type PlannedExercise, type Workout, placeEvent, resizeEvent, repeatEvents, seriesFrom, addDays, dayDiff, moveHabit, type HabitPlan, type Span, MAX_EVENTS, pruneShortlist, shortlistWith, type NewEvent, cleanMapName, MAX_MIND_MAPS, MAX_NOTES, newNote, cleanNoteTitle, cleanNoteBody, type Note, clampNoteSize, isHexColor, normalizeRuns, runsText, type Run, type NoteAlign, cleanAligns, newMindMap, type MindMap, MAX_LEVELS, MAX_WORLDS, newSavedWorld, type SavedWorld, type Block, statRewards, calculateRewards, recordGame, type RockResult, type Rewards, type Category, type Frequency, type Habit, type Priority, type Task,
} from '../domain';
import { defaultState, type AppEvent, type AppState, type ChatMessage } from './state';
import { newId } from './id';
import { browserKV, exportJSON, importJSON, loadState, saveState, type KV } from './storage';

export interface NewTask {
  title: string; category: Category; priority: Priority; difficulty: number;
  description?: string; dueDate?: number; tags?: string[]; estimatedDuration?: number;
  /** extra core attributes the task trains (each +1 stat), besides its category */
  coreAttributes?: Category[];
  /** ids of its custom categories */
  groups?: string[];
  /** time of day on its due date (minutes after midnight) */
  scheduledTime?: number;
  /** id of the Start Here suggestion it came from */
  origin?: string;
}
export interface NewHabit { title: string; category: Category; frequency: Frequency; description?: string; origin?: string; /** ids of its custom categories */ groups?: string[] }

export function createStore(kv: KV | null = browserKV(), clock: () => number = Date.now, genId: () => string = newId) {
  let state: AppState = loadState(kv, clock());
  const openedAt = clock();
  /** The quick start bonus is for the first habit ticked in a session. */
  let quickStartUsed = false;
  let events: AppEvent[] = [];
  /** The most recent completion (task or habit), offered for undo until `until` (transient, not saved). A habit keeps how it was before. */
  let undo: { taskId: string; until: number } | { habitId: string; prev: Habit; prevStats: AppState['stats']; prevQuick: boolean; until: number } | null = null;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach(l => l());
  function set(next: AppState) { state = next; saveState(kv, state); emit(); }
  const pushEvents = (...e: AppEvent[]) => {
    events = [...events, ...e];
    // Bóbr reacts: cheers at a finished task or habit, plays about at a level-up or an achievement (state is saved by the set() that follows)
    const now = clock(), b = state.bobr;
    const cheer = e.some(x => x.type === 'taskComplete'), play = e.some(x => x.type === 'levelUp' || x.type === 'achievement');
    if (cheer || play) state = { ...state, bobr: { ...b, ...(cheer ? { treatUntil: Math.max(b.treatUntil ?? 0, now + TASK_CHEER_MS) } : {}), ...(play ? { mischiefUntil: now + MISCHIEF_MS } : {}) } };
  };

  /** Re-evaluate achievements against the given state, record unlock events. */
  function withAchievements(s: AppState): AppState {
    const maxHabitStreak = s.habits.reduce((m, h) => Math.max(m, h.streak, h.bestStreak), 0);
    const r = checkAchievements(s.achievements, { stats: s.stats, maxHabitStreak, rock: s.rockGame.stats }, clock());
    r.newlyUnlocked.forEach(a => pushEvents({ type: 'achievement', achievement: a }));
    return { ...s, achievements: r.achievements, ...(r.newlyUnlocked.length ? { bobr: state.bobr } : {}) };   // pushEvents above made him playful
  }

  function editWorkout(id: string, f: (w: Workout) => Workout) {
    set({ ...state, exercise: { workouts: state.exercise.workouts.map(w => (w.id === id ? f(w) : w)) } });
  }

  const actions = {
    // ---- tasks
    addTask(input: NewTask): Task {
      const now = clock();
      const task: Task = {
        id: genId(), title: input.title.trim(), category: input.category, description: input.description,
        priority: input.priority, difficulty: input.difficulty, completed: false,
        experienceReward: calculateXP(input.priority, input.difficulty),
        statRewards: statRewards(input.coreAttributes ?? [], input.category),
        dueDate: input.dueDate, tags: input.tags ?? [], groups: input.groups?.length ? input.groups : undefined, scheduledTime: input.scheduledTime, estimatedDuration: input.estimatedDuration, completionCount: 0, origin: input.origin, createdAt: now, updatedAt: now,
      };
      set({ ...state, tasks: [task, ...state.tasks] });
      return task;
    },
    updateTask(id: string, patch: Partial<NewTask>) {
      set({
        ...state,
        tasks: state.tasks.map(t => {
          if (t.id !== id || t.completed) return t; // completed tasks are frozen (rewards already paid)
          const { coreAttributes, ...fields } = patch;
          const m: Task = { ...t, ...fields };
          m.experienceReward = calculateXP(m.priority, m.difficulty);
          if (fields.category || coreAttributes) m.statRewards = statRewards(coreAttributes ?? [], m.category);
          return { ...m, updatedAt: clock() };
        }),
      });
    },
    /** Rename a tag on every task (an existing name merges); an empty new name removes the tag. */
    renameTag(from: string, to: string) {
      const clean = cleanTag(to);
      set({ ...state, tasks: state.tasks.map(t => (t.tags.includes(from) ? { ...t, tags: retag(t.tags, from, clean), updatedAt: clock() } : t)) });
    },
    deleteTag(tag: string) { actions.renameTag(tag, ''); },
    /** Custom task categories: a name and a frame. Returns the new id, or null when the name is empty, taken or the list is full. */
    addCategory(name: string, frame: string): string | null {
      const list = state.categories;
      if (list.length >= MAX_CATEGORIES || !categoryNameFree(list, name)) return null;
      const id = genId();
      set({ ...state, categories: [...list, { id, name: cleanCategoryName(name), frame: isCategoryFrame(frame) ? frame : DEFAULT_CATEGORY_FRAME }] });
      return id;
    },
    /** Rename a category and/or change its frame; false when the name is empty or already taken. */
    updateCategory(id: string, patch: { name?: string; frame?: string }): boolean {
      const cur = state.categories.find(c => c.id === id);
      if (!cur) return false;
      if (patch.name !== undefined && !categoryNameFree(state.categories, patch.name, id)) return false;
      const next = { ...cur, ...(patch.name !== undefined ? { name: cleanCategoryName(patch.name) } : {}), ...(patch.frame !== undefined && isCategoryFrame(patch.frame) ? { frame: patch.frame } : {}) };
      set({ ...state, categories: state.categories.map(c => (c.id === id ? next : c)) });
      return true;
    },
    /** Delete a category; its tasks and habits stay, just without one. */
    deleteCategory(id: string) {
      const now = clock();
      set({ ...state, categories: state.categories.filter(c => c.id !== id), tasks: state.tasks.map(t => (t.groups?.includes(id) ? { ...t, groups: withoutGroup(t.groups, id), updatedAt: now } : t)),
        habits: state.habits.map(h => (h.groups?.includes(id) ? { ...h, groups: withoutGroup(h.groups, id), updatedAt: now } : h)) });
    },
    deleteTask(id: string) { set({ ...state, tasks: state.tasks.filter(t => t.id !== id) }); },
    /** Complete a task: pays XP + stats, bumps counters, checks achievements, offers undo. No-op if it is already done. */
    completeTask(id: string) {
      const task = state.tasks.find(t => t.id === id);
      if (!task || task.completed) return;
      const now = clock();
      const done: Task = { ...task, completed: true, completionCount: (task.completionCount ?? 0) + 1, lastCompletedAt: now, lastReward: { xp: task.experienceReward, statRewards: task.statRewards }, updatedAt: now };
      const r = applyTaskCompletion(state.stats, task);
      pushEvents({ type: 'taskComplete', taskId: id, xp: task.experienceReward });
      if (r.leveledUp) pushEvents({ type: 'levelUp', level: r.leveledUp });
      undo = { taskId: id, until: now + UNDO_WINDOW_MS };
      set(withAchievements({ ...state, stats: r.stats, tasks: state.tasks.map(t => (t.id === id ? done : t)) }));
    },
    /**
     * Untick a completed task so it can be completed again. Within the undo window (10 s) it was a mistake, so the rewards
     * are taken back; later it simply resets and keeps what it paid. Unlocked achievements are never taken away.
     * Returns whether rewards were refunded.
     */
    uncompleteTask(id: string): boolean {
      const task = state.tasks.find(t => t.id === id);
      if (!task || !task.completed) return false;
      const now = clock();
      const refund = canRefund(task, now);
      const reset: Task = { ...task, completed: false, lastReward: undefined, updatedAt: now,
        ...(refund ? { completionCount: Math.max(0, (task.completionCount ?? 1) - 1), lastCompletedAt: undefined } : {}) };
      if (undo && 'taskId' in undo && undo.taskId === id) undo = null;
      set({ ...state, stats: refund ? revokeTaskCompletion(state.stats, task.lastReward!) : state.stats, tasks: state.tasks.map(t => (t.id === id ? reset : t)) });
      return refund;
    },
    /** Hide the undo offer without undoing. */
    dismissUndo() { undo = null; emit(); },

    // ---- habits
    addHabit(input: NewHabit): Habit {
      const now = clock();
      const habit: Habit = { id: genId(), title: input.title.trim(), category: input.category, frequency: input.frequency, description: input.description?.trim() || undefined, streak: 0, bestStreak: 0, lastCompleted: null, origin: input.origin, groups: input.groups?.length ? input.groups : undefined, createdAt: now, updatedAt: now };
      set({ ...state, habits: [habit, ...state.habits] });
      return habit;
    },
    updateHabit(id: string, patch: Partial<NewHabit>) {
      set({ ...state, habits: state.habits.map(h => (h.id === id ? { ...h, ...patch, updatedAt: clock() } : h)) });
    },
    deleteHabit(id: string) { set({ ...state, habits: state.habits.filter(h => h.id !== id) }); },
    completeHabit(id: string) {
      const h = state.habits.find(x => x.id === id);
      if (!h || completedToday(h, clock())) return; // once per day
      const now = clock(), next = completeHabitRule(h, now);
      const quick = !quickStartUsed && now - openedAt <= QUICK_START_MS;
      const reward = habitReward(h, next.streak, quick);
      const r = applyReward(state.stats, reward.xp, reward.statRewards);
      undo = { habitId: id, prev: h, prevStats: state.stats, prevQuick: quickStartUsed, until: now + UNDO_WINDOW_MS };
      quickStartUsed = true;
      pushEvents({ type: 'taskComplete', taskId: id, xp: reward.xp });
      if (r.leveledUp) pushEvents({ type: 'levelUp', level: r.leveledUp });
      set(withAchievements({ ...state, stats: r.stats, habits: state.habits.map(x => (x.id === id ? next : x)) }));
    },
    /** Take back today's completion of a habit within the undo window (10 s): streak, best streak and last-done date go back. Unlocked achievements stay. */
    undoHabit(id: string): boolean {
      if (!undo || !('habitId' in undo) || undo.habitId !== id || clock() > undo.until) return false;
      const { prev, prevStats, prevQuick } = undo;
      undo = null;
      quickStartUsed = prevQuick;
      set({ ...state, stats: prevStats, habits: state.habits.map(x => (x.id === id ? { ...prev, updatedAt: clock() } : x)) });
      return true;
    },

    // ---- stats / inventory / chat / user
    addXP(xp: number) {
      const r = addXP(state.stats, xp);
      if (r.leveledUp) pushEvents({ type: 'levelUp', level: r.leveledUp });
      set(withAchievements({ ...state, stats: r.stats }));
    },
    addItem(itemId: string, amount = 1) {
      set({ ...state, inventory: { ...state.inventory, [itemId]: Math.max(0, (state.inventory[itemId] ?? 0) + amount) } });
    },
    /** Tapping a spawned item. */
    collectItem(itemId: ItemId) { actions.addItem(itemId, 1); },
    /** Feed one hay to a hungry Bóbr: hunger timer resets, happiness refills. */
    feedBobr(): boolean {
      const now = clock(), b = state.bobr;
      if (hungerAt(b.lastInteraction, now) < 0.8 || (state.inventory.hay ?? 0) < 1) return false;
      set({ ...state, inventory: { ...state.inventory, hay: state.inventory.hay - 1 },
        bobr: { ...b, lastInteraction: now, happiness: 1, happinessAt: now, feedings: b.feedings + 1 } });
      return true;
    },
    /** Give Bóbr a berry (picked in the world). A treat, so he takes one any time: hunger resets, happiness refills and he is excited for a while. */
    feedBerry(): boolean {
      const now = clock(), b = state.bobr;
      if ((state.inventory.berry ?? 0) < 1) return false;
      set({ ...state, inventory: { ...state.inventory, berry: state.inventory.berry - 1 },
        bobr: { ...b, lastInteraction: now, happiness: 1, happinessAt: now, feedings: b.feedings + 1, treatUntil: now + BERRY_TREAT_MS } });
      return true;
    },
    /** Accept Bóbr's current offer (give `request`, get `offer`). Happiness +20%. */
    trade(): boolean {
      const now = clock(), b = state.bobr, t = tradeFor(now);
      const happiness = happinessNow(b, now);
      if (!willTrade(emotionNow(b, now))) return false;
      if ((state.inventory[t.request] ?? 0) < 1) return false;
      set({ ...state,
        inventory: { ...state.inventory, [t.request]: state.inventory[t.request] - 1, [t.offer]: (state.inventory[t.offer] ?? 0) + 1 },
        bobr: { ...b, happiness: Math.min(1, happiness + 0.2), happinessAt: now, trades: (b.trades ?? 0) + 1 } });
      return true;
    },
    /** Pay the stone it costs to play again. Returns false (and takes nothing) when there is not enough. */
    spendStone(n: number): boolean {
      if ((state.inventory.stone ?? 0) < n) return false;
      set({ ...state, inventory: { ...state.inventory, stone: state.inventory.stone - n } });
      return true;
    },
    /** A rock-throwing game ended: save it, pay XP, stat points and item drops, check achievements. */
    finishRockGame(result: RockResult): { rewards: Rewards; newHighScore: boolean } {
      const now = clock();
      const rewards = calculateRewards(result.score, result.level, result.targetsHit, result.mode);
      const newHighScore = result.score > 0 && result.score > state.rockGame.stats.highScore;
      const xp = addXP(state.stats, rewards.xp);
      if (xp.leveledUp) pushEvents({ type: 'levelUp', level: xp.leveledUp });
      const inventory = { ...state.inventory };
      for (const id of rewards.items) inventory[id] = (inventory[id] ?? 0) + 1;
      set(withAchievements({
        ...state,
        stats: { ...xp.stats, body: xp.stats.body + rewards.body, mind: xp.stats.mind + rewards.mind, soul: xp.stats.soul + rewards.soul },
        inventory, rockGame: recordGame(state.rockGame, result, genId(), now),
      }));
      return { rewards, newHighScore };
    },
    addChat(msg: Omit<ChatMessage, 'id' | 'at'>) {
      set({ ...state, chat: [...state.chat, { ...msg, id: genId(), at: clock() }].slice(-200) });
    },
    /** Sanctuary: keep the unsaved work so leaving the screen never loses it. */
    setSanctuaryDraft(draft: Block[]) { set({ ...state, sanctuary: { ...state.sanctuary, draft } }); },
    /** Save the blocks as a named level (same name = overwrite). Returns the level id, or null when the list is full. */
    saveSanctuaryLevel(name: string, blocks: Block[]): string | null {
      const clean = name.trim().slice(0, 40) || 'Level';
      const levels = state.sanctuary.levels, same = levels.find(l => l.name.toLowerCase() === clean.toLowerCase());
      if (!same && levels.length >= MAX_LEVELS) return null;
      const lvl = { id: same?.id ?? genId(), name: clean, blocks, updatedAt: clock() };
      set({ ...state, sanctuary: { ...state.sanctuary, levels: same ? levels.map(l => (l.id === same.id ? lvl : l)) : [...levels, lvl] } });
      return lvl.id;
    },
    deleteSanctuaryLevel(id: string) { set({ ...state, sanctuary: { ...state.sanctuary, levels: state.sanctuary.levels.filter(l => l.id !== id) } }); },
    /** Mind maps: make an empty one. Returns its id, or null when the list is full. */
    createMindMap(name: string): string | null {
      if (state.mindMaps.list.length >= MAX_MIND_MAPS) return null;
      const m = newMindMap(genId(), name, clock());
      set({ ...state, mindMaps: { list: [...state.mindMaps.list, m] } });
      return m.id;
    },
    /** Save an edit of a mind map (its boxes and links, or a new name). */
    updateMindMap(id: string, patch: Partial<Pick<MindMap, 'name' | 'nodes' | 'links'>>) {
      const { name, ...rest } = patch;
      const clean = name === undefined ? {} : { name: cleanMapName(name) || 'Mind map' };
      set({ ...state, mindMaps: { list: state.mindMaps.list.map(m => (m.id === id ? { ...m, ...rest, ...clean, updatedAt: clock() } : m)) } });
    },
    deleteMindMap(id: string) { set({ ...state, mindMaps: { list: state.mindMaps.list.filter(m => m.id !== id) } }); },
    /** Notes: make an empty one. Returns its id, or null when the list is full. */
    createNote(title: string): string | null {
      if (state.notes.list.length >= MAX_NOTES) return null;
      const n = newNote(genId(), title, clock());
      set({ ...state, notes: { list: [...state.notes.list, n] } });
      return n.id;
    },
    /** Save an edit of a note (its title or body). */
    updateNote(id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'size'>> & { color?: string | null; aligns?: NoteAlign[]; runs?: Run[] }) {
      let runsPatch = {};
      if (patch.runs) {
        const runs = normalizeRuns(patch.runs);
        const formatted = runs.some(r => r.s !== undefined || r.c !== undefined);
        runsPatch = { body: runsText(runs), runs: formatted ? runs : undefined };
      }
      const clean = { ...(patch.title === undefined ? {} : { title: cleanNoteTitle(patch.title) }), ...(patch.body === undefined ? {} : { body: cleanNoteBody(patch.body), runs: undefined }), ...(patch.size === undefined ? {} : { size: clampNoteSize(patch.size) }), ...(patch.aligns === undefined ? {} : { aligns: cleanAligns(patch.aligns) }), ...(patch.color === undefined ? {} : { color: patch.color && isHexColor(patch.color) ? patch.color.toLowerCase() : undefined }), ...runsPatch };
      set({ ...state, notes: { list: state.notes.list.map(n => (n.id === id ? { ...n, ...clean, updatedAt: clock() } : n)) } });
    },
    deleteNote(id: string) { set({ ...state, notes: { list: state.notes.list.filter(n => n.id !== id) } }); },
    // ---- exercise tracker
    /** Begin a workout, optionally with its exercises planned (a preset). Returns the id; if one is already running that one is returned instead. Null when the history is full. */
    startWorkout(name?: string, planned: PlannedExercise[] = []): string | null {
      const open = state.exercise.workouts.find(w => !w.completed);
      if (open) return open.id;
      if (state.exercise.workouts.length >= MAX_WORKOUTS) return null;
      const w: Workout = { id: genId(), name: cleanWorkoutName(name), startTime: clock(), completed: false, pausedMs: 0, bodyPointsAwarded: 0, exercises: planned.slice(0, MAX_EXERCISES).map(p => newExercise(() => genId(), p)) };
      set({ ...state, exercise: { workouts: [w, ...state.exercise.workouts] } });
      return w.id;
    },
    /** Add an exercise (with its empty sets) to a workout that is still running. */
    addExercise(workoutId: string, planned: PlannedExercise) {
      editWorkout(workoutId, w => (w.completed || w.exercises.length >= MAX_EXERCISES ? w : { ...w, exercises: [...w.exercises, newExercise(() => genId(), planned)] }));
    },
    removeExercise(workoutId: string, exerciseId: string) {
      editWorkout(workoutId, w => (w.completed ? w : { ...w, exercises: w.exercises.filter(e => e.id !== exerciseId) }));
    },
    /** Mark a set done with what was actually lifted or run (reps / kg / ms; left out = keep what it had). */
    completeSet(workoutId: string, exerciseId: string, setId: string, done: { reps?: number; weight?: number; duration?: number } = {}) {
      const now = clock();
      editWorkout(workoutId, w => (w.completed ? w : { ...w, exercises: w.exercises.map(e => (e.id !== exerciseId ? e : { ...e, sets: e.sets.map(s => (s.id !== setId ? s : {
        ...s, ...(done.reps !== undefined ? { reps: done.reps } : {}), ...(done.weight !== undefined ? { weight: done.weight || undefined } : {}), ...(done.duration !== undefined ? { duration: done.duration || undefined } : {}),
        completed: true, completedAt: now })) })) }));
    },
    pauseWorkout(id: string) { const now = clock(); editWorkout(id, w => (w.completed || w.pausedAt !== undefined ? w : { ...w, pausedAt: now })); },
    resumeWorkout(id: string) {
      const now = clock();
      editWorkout(id, w => (w.completed || w.pausedAt === undefined ? w : { ...w, pausedMs: w.pausedMs + Math.max(0, now - w.pausedAt), pausedAt: undefined }));
    },
    /** End a workout: stop the clock, work out the Body points and pay them. Returns the points (0 when it was not running). */
    finishWorkout(id: string): number {
      const w = state.exercise.workouts.find(x => x.id === id);
      if (!w || w.completed) return 0;
      const now = clock(), duration = elapsedMs(w, now), points = workoutBodyPoints(w, duration);
      const done: Workout = { ...w, completed: true, endTime: now, duration, pausedAt: undefined, bodyPointsAwarded: points };
      set(withAchievements({ ...state, stats: { ...state.stats, body: state.stats.body + points }, exercise: { workouts: state.exercise.workouts.map(x => (x.id === id ? done : x)) } }));
      return points;
    },
    /** One exercise logged after the fact: a finished workout of its own ("Quick Log"). `minutes` is the time it took (optional). Returns the Body points, or null when the history is full. */
    quickLog(input: { name: string; type: PlannedExercise['type']; minutes?: number; sets?: number; reps?: number; weight?: number }): number | null {
      if (state.exercise.workouts.length >= MAX_WORKOUTS) return null;
      const now = clock(), ms = input.minutes && input.minutes > 0 ? Math.min(input.minutes, 24 * 60) * 60_000 : 0;
      const ex = newExercise(() => genId(), { name: input.name, type: input.type, sets: input.sets ?? 1, reps: input.reps, weight: input.weight });
      ex.sets = ex.sets.map(s => ({ ...s, completed: true, completedAt: now, duration: input.type !== 'WEIGHT_TRAINING' && ms && ex.sets.length === 1 ? ms : undefined }));
      const w: Workout = { id: genId(), name: 'Quick Log', startTime: now - ms, endTime: now, duration: ms, completed: true, pausedMs: 0, bodyPointsAwarded: 0, exercises: [ex] };
      w.bodyPointsAwarded = workoutBodyPoints(w, ms);
      set(withAchievements({ ...state, stats: { ...state.stats, body: state.stats.body + w.bodyPointsAwarded }, exercise: { workouts: [w, ...state.exercise.workouts] } }));
      return w.bodyPointsAwarded;
    },
    /** Remove a workout from the history (or throw away the running one). Body points already paid stay. */
    deleteWorkout(id: string) { set({ ...state, exercise: { workouts: state.exercise.workouts.filter(w => w.id !== id) } }); },
    // ---- planner
    /** Put an activity on the calendar. Returns its id, or null when it has no title or the calendar is full. */
    addEvent(input: NewEvent, repeat?: Frequency): string | null {
      const { series: _s, repeat: _r, ...plain } = input;   // a new activity never joins an existing series
      const clean = cleanEvent(plain);
      if (!clean || state.planner.events.length >= MAX_EVENTS) return null;
      const id = genId();
      // repeated: one activity per day of the series (as many as fit), so each can be ticked, moved and changed on its own
      const all = repeat ? repeatEvents(clean, repeat, id).slice(0, MAX_EVENTS - state.planner.events.length) : [clean];
      set({ ...state, planner: { ...state.planner, events: [...state.planner.events, ...all.map((e, i) => ({ id: i ? genId() : id, ...e, done: false, createdAt: clock() }))] } });
      return id;
    },
    /** Replace an activity's fields (a field left out is cleared, e.g. no time = any time that day). */
    updateEvent(id: string, input: NewEvent) {
      const clean = cleanEvent(input);
      if (!clean) return;
      set({ ...state, planner: { ...state.planner, events: state.planner.events.map(e => (e.id === id ? { id, ...clean, done: e.done, ...(e.paid ? { paid: e.paid } : {}), createdAt: e.createdAt } : e)) } });
    },
    /** Edit a repeated activity: only this one, or this one and every later one of its series (a changed date shifts them all by as many days). */
    updateEventScope(id: string, input: NewEvent, scope: 'one' | 'all') {
      const e = state.planner.events.find(x => x.id === id);
      if (!e) return;
      if (scope === 'one' || !e.series) { actions.updateEvent(id, { ...input, series: e.series, repeat: e.repeat }); return; }
      const by = dayDiff(e.day, input.day);
      for (const x of seriesFrom(state.planner.events, e)) actions.updateEvent(x.id, { ...input, day: addDays(x.day, by), series: x.series, repeat: x.repeat });
    },
    /** The board: an activity dragged to another day or time (`time` undefined = no time), or stretched to a new length. */
    moveEvent(id: string, day: number, time: number | undefined, scope: 'one' | 'all' = 'one') {
      const e = state.planner.events.find(x => x.id === id);
      if (!e) return;
      if (scope === 'one') { actions.updateEvent(id, placeEvent(e, day, time)); return; }
      // all: every later activity of its series moves by as many days and takes the same time
      const by = dayDiff(e.day, day);
      for (const x of seriesFrom(state.planner.events, e)) actions.updateEvent(x.id, placeEvent(x, addDays(x.day, by), time));
    },
    resizeEvent(id: string, minutes: number) {
      const e = state.planner.events.find(x => x.id === id);
      if (e && e.time != null) actions.updateEvent(id, resizeEvent(e, minutes));
    },
    setPlannerSpan(span: Span) { set({ ...state, planner: { ...state.planner, span } }); },
    /** Tick or untick an activity: ticking pays XP (and a point in its category); unticking takes exactly that back. */
    setEventDone(id: string, done: boolean) {
      const e = state.planner.events.find(x => x.id === id);
      if (!e || e.done === done) return;
      let stats = state.stats;
      let paid = e.paid;
      if (done) {
        const rw = eventReward(e), sr = statRewards([], rw.category);
        const r = applyReward(stats, rw.xp, rw.category ? sr : { body: 0, mind: 0, soul: 0 });
        stats = r.stats; paid = rw;
        pushEvents({ type: 'taskComplete', taskId: id, xp: rw.xp });
        if (r.leveledUp) pushEvents({ type: 'levelUp', level: r.leveledUp });
      } else if (paid) {
        stats = revokeReward(stats, paid.xp, statRewards([], paid.category));
        paid = undefined;
      }
      const upd = { ...e, done, paid }; if (!paid) delete upd.paid;
      set(withAchievements({ ...state, stats, planner: { ...state.planner, events: state.planner.events.map(x => (x.id === id ? upd : x)) } }));
    },
    /** Delete an activity, or (`all`) it and every later one of its series. */
    deleteEvent(id: string, scope: 'one' | 'all' = 'one') {
      const e = state.planner.events.find(x => x.id === id);
      const ids = new Set(e && scope === 'all' ? seriesFrom(state.planner.events, e).map(x => x.id) : [id]);
      set({ ...state, planner: { ...state.planner, events: state.planner.events.filter(x => !ids.has(x.id)) } });
    },
    // ---- habits on the planner
    /** Put a habit on the planner from `plan.start` on (it repeats as often as its frequency says), change its time, or take it off (no plan). */
    setHabitPlan(id: string, plan: HabitPlan | undefined) {
      set({ ...state, habits: state.habits.map(h => { if (h.id !== id) return h; const { plan: _old, ...rest } = h; return plan ? { ...rest, plan, updatedAt: clock() } : { ...rest, updatedAt: clock() }; }) });
    },
    /** Move one occurrence of a planned habit to another day: just that one, or it and all the future ones. */
    /** The time of day of a planned habit: for one occurrence only, or the whole series. */
    setHabitSlotTime(id: string, ruleDay: number, time: number | undefined, scope: 'one' | 'all') {
      const h = state.habits.find(x => x.id === id);
      if (h?.plan) actions.setHabitPlan(id, setSlotTime(h.plan, ruleDay, time, scope));
    },
    moveHabit(id: string, ruleDay: number, toDay: number, scope: 'one' | 'all') {
      const h = state.habits.find(x => x.id === id);
      if (h?.plan) actions.setHabitPlan(id, moveHabit(h.plan, ruleDay, toDay, scope));
    },
    /** Put an open task on the shortlist. False when it is full, already there or not an open task. */
    shortlistAdd(taskId: string): boolean {
      const next = shortlistWith(state.planner.shortlist, state.tasks, taskId, clock());
      if (!next) return false;
      set({ ...state, planner: { ...state.planner, shortlist: next } });
      return true;
    },
    /** Move a task one place up or down the shortlist. */
    shortlistMove(taskId: string, by: -1 | 1) {
      const list = pruneShortlist(state.planner.shortlist, state.tasks, clock());
      set({ ...state, planner: { ...state.planner, shortlist: moveInList(list, taskId, by) } });
    },
    /** Drag and drop: put a to-do at this place in the shortlist. */
    shortlistPlace(taskId: string, index: number) {
      const list = pruneShortlist(state.planner.shortlist, state.tasks, clock());
      set({ ...state, planner: { ...state.planner, shortlist: placeInList(list, taskId, index) } });
    },
    /** Drop a shortlist to-do on a day of the calendar: it gets that date and leaves the shortlist. */
    shortlistToDay(taskId: string, day: number, time?: number) {
      const now = clock();
      set({ ...state,
        tasks: state.tasks.map(t => (t.id === taskId && !t.completed ? { ...t, dueDate: day, scheduledTime: time, updatedAt: now } : t)),
        planner: { ...state.planner, shortlist: pruneShortlist(state.planner.shortlist, state.tasks, now).filter(x => x !== taskId) } });
    },
    shortlistRemove(taskId: string) {
      set({ ...state, planner: { ...state.planner, shortlist: pruneShortlist(state.planner.shortlist, state.tasks, clock()).filter(x => x !== taskId) } });
    },
    /** A quick to-do: an ordinary task (medium priority, easy, due today) that goes straight onto the shortlist when there is room. */
    addTodo(title: string, category: Category): { task: Task; listed: boolean } | null {
      if (!title.trim()) return null;
      const now = clock(), d = new Date(now);
      const task = actions.addTask({ title: title.trim().slice(0, 80), category, priority: 'MEDIUM', difficulty: 2, dueDate: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() });
      return { task, listed: actions.shortlistAdd(task.id) };
    },
    /** Bóbr world map: make a world (name + seed). Returns its id, or null when the list is full. */
    createWorld(name: string, seed: number): string | null {
      if (state.worlds.list.length >= MAX_WORLDS) return null;
      const w = newSavedWorld(genId(), name, seed, clock());
      set({ ...state, worlds: { list: [...state.worlds.list, w] } });
      return w.id;
    },
    /** Save the changes of an open world (called on exit and every few seconds). */
    saveWorld(id: string, patch: Partial<Omit<SavedWorld, 'id'>>) {
      set({ ...state, worlds: { list: state.worlds.list.map(w => (w.id === id ? { ...w, ...patch, playedAt: clock() } : w)) } });
    },
    deleteWorld(id: string) { set({ ...state, worlds: { list: state.worlds.list.filter(w => w.id !== id) } }); },
    setUser(patch: Partial<AppState['user']>) { set({ ...state, user: { ...state.user, ...patch } }); },
    setBobr(patch: Partial<AppState['bobr']>) { set({ ...state, bobr: { ...state.bobr, ...patch } }); },
    setSettings(patch: Partial<AppState['settings']>) { set({ ...state, settings: { ...state.settings, ...patch } }); },

    // ---- events
    dismissEvent() { events = events.slice(1); emit(); },

    // ---- data
    exportData: () => exportJSON(state),
    importData(text: string) { set(importJSON(text, clock())); },
    resetAll() { events = []; set(defaultState(clock())); },
  };

  return {
    getState: () => state,
    /** false when localStorage is blocked (private mode): nothing will be remembered. */
    persistent: kv !== null,
    getEvents: () => events,
    getUndo: () => undo,
    subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
    actions,
  };
}

export type Store = ReturnType<typeof createStore>;
