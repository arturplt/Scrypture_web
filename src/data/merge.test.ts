import { describe, expect, it } from 'vitest';
import { createStore } from './store';
import { mergeSaves, snapshotOf } from './merge';

const mk = (start = 1000) => { let t = start; return createStore(null, () => (t += 1000)); };
const input = (title: string) => ({ title, category: 'BODY' as const, priority: 'MEDIUM' as const, difficulty: 2 });
/** two devices that start from the same save */
function pair() {
  const pc = mk(1000), phone = mk(500000);
  const a = pc.actions.addTask(input('Shared')), b = pc.actions.addTask(input('Doomed'));
  phone.actions.importData(pc.actions.exportData());
  return { pc, phone, a, b, snap: snapshotOf(pc.getState()) };
}

describe('mergeSaves', () => {
  it('completing on one device and adding on the other keeps both', () => {
    const { pc, phone, a, snap } = pair();
    pc.actions.completeTask(a.id);
    phone.actions.addTask(input('Phone only'));
    const m = mergeSaves(phone.getState(), pc.getState(), snap, 2, 1);
    expect(m.tasks.map(t => t.title).sort()).toEqual(['Doomed', 'Phone only', 'Shared']);
    expect(m.tasks.find(t => t.title === 'Shared')!.completed).toBe(true);
    expect(m.stats.totalTasksCompleted).toBe(1);
    expect(m.stats.totalExperiencePoints).toBe(pc.getState().stats.totalExperiencePoints);
  });
  it('a deletion on one side sticks; the same task is not brought back', () => {
    const { pc, phone, b, snap } = pair();
    phone.actions.deleteTask(b.id);
    pc.actions.addTask(input('Later'));
    const m = mergeSaves(pc.getState(), phone.getState(), snap, 1, 2);
    expect(m.tasks.map(t => t.title).sort()).toEqual(['Later', 'Shared']);
  });
  it('the later edit of the same task wins', () => {
    const { pc, phone, a, snap } = pair();
    pc.actions.updateTask(a.id, { title: 'PC title' });
    phone.actions.updateTask(a.id, { title: 'Phone title' });   // the phone clock runs ahead
    expect(mergeSaves(pc.getState(), phone.getState(), snap, 1, 2).tasks.find(t => t.id === a.id)!.title).toBe('Phone title');
    expect(mergeSaves(phone.getState(), pc.getState(), snap, 2, 1).tasks.find(t => t.id === a.id)!.title).toBe('Phone title');
  });
  it('XP earned on both sides adds up', () => {
    const { pc, phone, a, b, snap } = pair();
    pc.actions.completeTask(a.id); phone.actions.completeTask(b.id);
    const m = mergeSaves(pc.getState(), phone.getState(), snap, 2, 1);
    expect(m.stats.totalTasksCompleted).toBe(2);
    expect(m.stats.totalExperiencePoints).toBe(pc.getState().stats.totalExperiencePoints + phone.getState().stats.totalExperiencePoints);
    expect(m.tasks.every(t => t.completed)).toBe(true);
  });
  it('without a last-sync record nothing is deleted and the larger progress is kept', () => {
    const { pc, phone, a } = pair();
    phone.actions.deleteTask(a.id);
    pc.actions.completeTask(a.id);
    const m = mergeSaves(pc.getState(), phone.getState(), null, 2, 1);
    expect(m.tasks.some(t => t.id === a.id)).toBe(true);
    expect(m.stats.totalTasksCompleted).toBe(1);
  });
});
