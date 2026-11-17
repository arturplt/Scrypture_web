import type { Achievement, CustomCategory, Habit, Task, UserStats } from '../domain';
import { DEFAULT_LOOK, emptyExerciseSave, emptyMindMaps, emptyNotes, emptyPlanner, emptyRockSave, emptySanctuarySave, emptyWorlds, initialStats, seedAchievements, type ExerciseSave, type Look, type MindMapsSave, type NotesSave, type PlannerSave, type RockSave, type SanctuarySave, type WorldsSave } from '../domain';

export interface ChatMessage {
  id: string;
  type: 'NORMAL' | 'QUICK_ACTION' | 'SYSTEM';
  fromBobr: boolean;
  text: string;
  at: number;
}

export interface AppState {
  version: number;
  user: { name: string | null; onboarded: boolean; tutorialSeen: boolean };
  tasks: Task[];
  /** your own task categories */
  categories: CustomCategory[];
  habits: Habit[];
  stats: UserStats;
  achievements: Achievement[];
  inventory: Record<string, number>; // itemId -> amount
  chat: ChatMessage[];
  /** Rock-throwing minigame: lifetime stats + the best scores. */
  rockGame: RockSave;
  /** Sanctuary block builder: saved levels + the unsaved work in progress. */
  sanctuary: SanctuarySave;
  /** Mind maps: boxes and the links between them. */
  mindMaps: MindMapsSave;
  notes: NotesSave;
  /** Exercise tracker: the workouts (one may be in progress). */
  exercise: ExerciseSave;
  /** Planner: activities on the calendar and the shortlist of to-dos. */
  planner: PlannerSave;
  /** Bóbr world map: saved worlds (seed + changes + plane + sky). */
  worlds: WorldsSave;
  bobr: { happiness: number; happinessAt: number; lastInteraction: number; feedings: number; /** accepted trades (absent in older saves) */ trades?: number; /** excited until then: a berry was just eaten */ treatUntil?: number; /** playful until then: a level-up or an achievement */ mischiefUntil?: number };
  settings: { frameTheme: string; language: 'EN' | 'LA' | 'PL'; fullscreen: boolean; /** sound volume 0..1 (0 = off) */ volume: number; /** switch off animations */ reduceMotion?: boolean; /** stronger text and border colours */ highContrast?: boolean } & Look;
}

export const CURRENT_VERSION = 1;

export const defaultState = (now = Date.now()): AppState => ({
  version: CURRENT_VERSION,
  user: { name: null, onboarded: false, tutorialSeen: false },
  tasks: [],
  categories: [],
  habits: [],
  stats: initialStats(),
  achievements: seedAchievements(),
  inventory: {},
  chat: [],
  rockGame: emptyRockSave(),
  sanctuary: emptySanctuarySave(),
  mindMaps: emptyMindMaps(),
  notes: emptyNotes(),
  exercise: emptyExerciseSave(),
  planner: emptyPlanner(),
  worlds: emptyWorlds(),
  bobr: { happiness: 1, happinessAt: now, lastInteraction: now, feedings: 0 },
  settings: { frameTheme: 'green_bev', language: 'EN', fullscreen: true, volume: 0.7, reduceMotion: false, highContrast: false, ...DEFAULT_LOOK },
});

/** Transient UI events (not persisted): level-ups and achievement unlocks to celebrate. */
export type AppEvent =
  | { type: 'levelUp'; level: number }
  | { type: 'achievement'; achievement: Achievement }
  | { type: 'taskComplete'; taskId: string; xp: number };
