export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type CoreStat = 'body' | 'mind' | 'soul';
export type Category = 'BODY' | 'MIND' | 'SOUL'; // custom categories come later (CustomCategory)
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
export type AchievementCategory = 'TASK' | 'HABIT' | 'STREAK' | 'STAT' | 'SPECIAL';
export type BobrStage = 'HATCHLING' | 'YOUNG' | 'MATURE';

export interface StatRewards { body: number; mind: number; soul: number }

export interface Task {
  id: string;
  title: string;
  category: Category;
  description?: string;
  priority: Priority;
  difficulty: number; // 0-9
  completed: boolean;
  experienceReward: number;
  statRewards: StatRewards;
  dueDate?: number; // epoch ms
  tags: string[];
  /** ids of the custom categories it belongs to (see categories.ts) */
  groups?: string[];
  estimatedDuration?: number; // minutes
  /** time of day it is planned for on its due date (minutes after midnight): it then shows as a block on the Planner timeline */
  scheduledTime?: number;
  /** How many times it has been completed (a task can be unticked and completed again). */
  completionCount?: number;
  lastCompletedAt?: number;
  /** What the latest completion actually paid, so an undo refunds exactly that even if the task was edited since. */
  lastReward?: { xp: number; statRewards: StatRewards };
  /** Where it came from, e.g. a Start Here suggestion id, so "already added" survives a language change. */
  origin?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Habit {
  id: string;
  title: string;
  category: Category;
  frequency: Frequency;
  streak: number;
  bestStreak: number;
  lastCompleted: number | null; // epoch ms
  description?: string;
  origin?: string;
  /** ids of the custom categories it belongs to (see categories.ts) */
  groups?: string[];
  /** where it sits on the planner (unset = not planned): see habitplan.ts */
  plan?: import('./habitplan').HabitPlan;
  /** the days it was completed on (local midnights), oldest first */
  log?: number[];
  createdAt: number;
  updatedAt: number;
}

export interface UserStats {
  level: number;
  totalExperiencePoints: number;
  body: number;
  mind: number;
  soul: number;
  totalTasksCompleted: number;
}

export interface Achievement {
  id: string; // stable; equals `condition`
  title: string;
  description: string;
  category: AchievementCategory;
  rarity: Rarity;
  condition: string;
  unlocked: boolean;
  unlockedAt: number | null;
}
