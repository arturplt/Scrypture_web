import { completedToday, todaySummary } from '../domain';
import { useAppState } from '../data/hooks';
import { useNow } from '../hooks';

/** The counters shown on a destination's icon (open tasks, habits to do today, planned today, unlocked trophies), by path. Same numbers on Home tiles and on the nav bar. */
export function useNavBadges(): Record<string, string | null> {
  const tasks = useAppState(s => s.tasks);
  const habits = useAppState(s => s.habits);
  const achievements = useAppState(s => s.achievements);
  const planner = useAppState(s => s.planner);
  const now = useNow(30_000);
  const open = tasks.filter(x => !x.completed).length;
  const todo = habits.filter(h => !completedToday(h, now)).length;
  const planned = todaySummary({ ...planner, tasks, habits }, now).total;
  const n = (v: number) => (v ? String(v) : null);
  return { '/tasks': n(open), '/habits': n(todo), '/plan': n(planned), '/achievements': String(achievements.filter(a => a.unlocked).length) };
}
