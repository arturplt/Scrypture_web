import { describe, expect, it } from 'vitest';
import { explainXp, noteXp } from './xpWhy';
import { createStore } from './store';

describe('where XP came from', () => {
  it('names the newest payout of that size, adds up several, and admits when it does not know', () => {
    const t0 = 1_000_000;
    noteXp('task', 15, 'Walk', t0); noteXp('habit', 10, 'Stretch', t0 + 1);
    expect(explainXp(15, t0 + 5).name).toBe('Walk');
    expect(explainXp(25, t0 + 5).kind).toBe('habit');       // both paid at once
    expect(explainXp(777, t0 + 5).kind).toBe('other');
    expect(explainXp(15, t0 + 10 * 60_000).kind).toBe('other');   // too old to blame
  });
  it('the store notes the task that paid, and XP arriving by import as sync', () => {
    let t = 1000; const s = createStore(null, () => (t += 1000));
    const task = s.actions.addTask({ title: 'Read', category: 'MIND', priority: 'MEDIUM', difficulty: 2 });
    s.actions.completeTask(task.id);
    const gain = s.getState().stats.totalExperiencePoints;
    expect(explainXp(gain)).toMatchObject({ kind: 'task', name: 'Read' });
    const other = createStore(null, () => (t += 1000));
    const before = other.getState().stats.totalExperiencePoints;
    other.actions.importData(s.actions.exportData());
    expect(other.getState().stats.totalExperiencePoints - before).toBe(gain);
    expect(explainXp(gain).kind).toBe('sync');   // the newest note of that size
  });
});
