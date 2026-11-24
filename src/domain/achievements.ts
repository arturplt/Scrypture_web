import { emptyRockStats, type RockStats } from './rockgame';
import type { Achievement, AchievementCategory, Rarity, UserStats } from './types';

type Def = [condition: string, title: string, description: string, category: AchievementCategory, rarity: Rarity];

const DEFS: Def[] = [
  ['first_task', 'First Step', 'Complete your first task', 'TASK', 'COMMON'],
  ['ten_tasks', 'Task Master', 'Complete 10 tasks', 'TASK', 'UNCOMMON'],
  ['fifty_tasks', 'Productivity Pro', 'Complete 50 tasks', 'TASK', 'RARE'],
  ['hundred_tasks', 'Task Legend', 'Complete 100 tasks', 'TASK', 'EPIC'],
  ['level_5', 'Rising Star', 'Reach Level 5', 'STAT', 'UNCOMMON'],
  ['level_10', 'Master Builder', 'Reach Level 10', 'STAT', 'LEGENDARY'],
  ['streak_7', 'Week Warrior', 'Maintain a 7-day habit streak', 'STREAK', 'UNCOMMON'],
  ['streak_30', 'Month Master', 'Maintain a 30-day habit streak', 'STREAK', 'EPIC'],
  ['body_100', 'Body Builder', 'Reach 100 Body points', 'STAT', 'RARE'],
  ['mind_100', 'Mind Master', 'Reach 100 Mind points', 'STAT', 'RARE'],
  ['soul_100', 'Soul Seeker', 'Reach 100 Soul points', 'STAT', 'RARE'],
  // Rock-throwing minigame (evaluated when the game is ported)
  ['rock_game_first', 'First Throw', 'Complete your first rock throwing game', 'SPECIAL', 'COMMON'],
  ['rock_game_bullseye_10', 'Bullseye', 'Hit 10 perfect center shots', 'SPECIAL', 'UNCOMMON'],
  ['rock_game_combo_10', 'Combo Master', 'Achieve a 10x combo', 'SPECIAL', 'RARE'],
  ['rock_game_speed_30s', 'Speed Demon', 'Complete a level in under 30 seconds', 'SPECIAL', 'UNCOMMON'],
  ['rock_game_score_1000', 'High Score', 'Reach 1000 points in a single game', 'SPECIAL', 'RARE'],
  ['rock_game_perfect_level', 'Perfectionist', 'Complete a level without missing a throw', 'SPECIAL', 'UNCOMMON'],
  ['rock_game_max_distance', 'Distance King', 'Hit a far-away target from near the edge of the field', 'SPECIAL', 'RARE'],
  // Lake District: flying over its named waters
  ['lake_first', 'Over the Water', 'Fly over a lake in the Lake District', 'SPECIAL', 'COMMON'],
  ['lake_5', 'Lake Hopper', 'Fly over 5 different lakes', 'SPECIAL', 'UNCOMMON'],
  ['lake_10', 'Lakeland Explorer', 'Fly over 10 different lakes', 'SPECIAL', 'RARE'],
  ['lake_windermere', 'Queen of the Lakes', 'Fly over Windermere', 'SPECIAL', 'UNCOMMON'],
  ['lake_ullswater', 'Ullswater Steamer', 'Fly over Ullswater', 'SPECIAL', 'UNCOMMON'],
  ['road_m6', 'Motorway Overpass', 'Fly over the M6 motorway', 'SPECIAL', 'UNCOMMON'],
  ['lake_coniston', 'Coniston Crossing', 'Fly over Coniston Water', 'SPECIAL', 'COMMON'],
  // Paperplane: the rocket stage
  ['orbit_first', 'Low Orbit', 'Reach orbit with the paper plane', 'SPECIAL', 'RARE'],
  ['orbit_10', 'Frequent Orbiter', 'Reach orbit 10 times', 'SPECIAL', 'EPIC'],
];

export const seedAchievements = (): Achievement[] =>
  DEFS.map(([condition, title, description, category, rarity]) =>
    ({ id: condition, condition, title, description, category, rarity, unlocked: false, unlockedAt: null }));

export interface AchievementContext {
  stats: UserStats;
  maxHabitStreak: number;
  /** Rock-throwing progress; absent means no games played. */
  rock?: RockStats;
  /** Named Lake District waters flown over. */
  lakes?: string[];
  /** Paperplane flights that reached orbit (all worlds). */
  orbits?: number;
}

/** The flown-over list holds lakes and roads (the M6): only the waters count towards the lake achievements. */
const waterCount = (places: string[]) => places.filter(n => n !== 'M6').length;

/** Same rules as Android AchievementViewModel.checkAndUnlockAchievements (level checks use total XP). */
export function isConditionMet(condition: string, { stats, maxHabitStreak, rock = emptyRockStats(), lakes = [], orbits = 0 }: AchievementContext): boolean {
  switch (condition) {
    case 'first_task': return stats.totalTasksCompleted >= 1;
    case 'ten_tasks': return stats.totalTasksCompleted >= 10;
    case 'fifty_tasks': return stats.totalTasksCompleted >= 50;
    case 'hundred_tasks': return stats.totalTasksCompleted >= 100;
    case 'level_5': return stats.totalExperiencePoints >= 700;
    case 'level_10': return stats.totalExperiencePoints >= 2700;
    case 'streak_7': return maxHabitStreak >= 7;
    case 'streak_30': return maxHabitStreak >= 30;
    case 'body_100': return stats.body >= 100;
    case 'mind_100': return stats.mind >= 100;
    case 'soul_100': return stats.soul >= 100;
    case 'rock_game_first': return rock.gamesPlayed >= 1;
    case 'rock_game_bullseye_10': return rock.bullseyes >= 10;
    case 'rock_game_combo_10': return rock.longestCombo >= 10;
    case 'rock_game_speed_30s': return rock.fastLevel;
    case 'rock_game_score_1000': return rock.highScore >= 1000;
    case 'rock_game_perfect_level': return rock.perfectLevel;
    case 'rock_game_max_distance': return rock.farHit;
    case 'lake_first': return waterCount(lakes) >= 1;
    case 'lake_5': return waterCount(lakes) >= 5;
    case 'lake_10': return waterCount(lakes) >= 10;
    case 'road_m6': return lakes.includes('M6');
    case 'lake_windermere': return lakes.includes('Windermere');
    case 'lake_ullswater': return lakes.includes('Ullswater');
    case 'lake_coniston': return lakes.includes('Coniston Water');
    case 'orbit_first': return orbits >= 1;
    case 'orbit_10': return orbits >= 10;
    default: return false;
  }
}

/** Returns the achievements list with newly met ones unlocked, plus which ones just unlocked. */
export function checkAchievements(list: Achievement[], ctx: AchievementContext, now: number) {
  const newlyUnlocked: Achievement[] = [];
  const next = list.map(a => {
    if (a.unlocked || !isConditionMet(a.condition, ctx)) return a;
    const u = { ...a, unlocked: true, unlockedAt: now };
    newlyUnlocked.push(u);
    return u;
  });
  return { achievements: next, newlyUnlocked };
}

const TARGETS: Record<string, [value: (c: AchievementContext) => number, target: number]> = {
  first_task: [c => c.stats.totalTasksCompleted, 1],
  ten_tasks: [c => c.stats.totalTasksCompleted, 10],
  fifty_tasks: [c => c.stats.totalTasksCompleted, 50],
  hundred_tasks: [c => c.stats.totalTasksCompleted, 100],
  level_5: [c => c.stats.totalExperiencePoints, 700],
  level_10: [c => c.stats.totalExperiencePoints, 2700],
  streak_7: [c => c.maxHabitStreak, 7],
  streak_30: [c => c.maxHabitStreak, 30],
  body_100: [c => c.stats.body, 100],
  mind_100: [c => c.stats.mind, 100],
  soul_100: [c => c.stats.soul, 100],
  rock_game_first: [c => c.rock?.gamesPlayed ?? 0, 1],
  rock_game_bullseye_10: [c => c.rock?.bullseyes ?? 0, 10],
  rock_game_combo_10: [c => c.rock?.longestCombo ?? 0, 10],
  rock_game_score_1000: [c => c.rock?.highScore ?? 0, 1000],
  lake_first: [c => waterCount(c.lakes ?? []), 1],
  lake_5: [c => waterCount(c.lakes ?? []), 5],
  lake_10: [c => waterCount(c.lakes ?? []), 10],
  orbit_10: [c => c.orbits ?? 0, 10],
};

/** Progress toward a count-based achievement, or null when it has no countable progress (speed, perfect-level and distance minigame ones). */
export function achievementProgress(condition: string, ctx: AchievementContext): { current: number; target: number } | null {
  const t = TARGETS[condition];
  if (!t) return null;
  return { current: Math.min(t[0](ctx), t[1]), target: t[1] };
}
