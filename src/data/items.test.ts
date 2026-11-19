import { describe, expect, it } from 'vitest';
import { createStore } from './store';
import { applyRows, hashOf, itemHashes, localChanges, profileOf, withLists, type Row } from './items';

const mk = (start = 1000) => { let t = start; return createStore(null, () => (t += 1000)); };
const input = (title: string) => ({ title, category: 'BODY' as const, priority: 'MEDIUM' as const, difficulty: 2 });
const row = (kind: string, x: { id: string }, deleted = false): Row => ({ kind, id: x.id, data: deleted ? null : (x as never), deleted });

describe('hashOf', () => {
  it('does not depend on key order or undefined fields', () => {
    expect(hashOf({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(hashOf({ b: { d: [1, 2], c: 2 }, a: 1, z: undefined }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});

describe('localChanges', () => {
  it('sends new and changed items, and deletions of synced items', () => {
    const s = mk(), a = s.actions.addTask(input('A')), b = s.actions.addTask(input('B'));
    const synced = itemHashes(s.getState());
    expect(localChanges(s.getState(), synced)).toEqual({ upserts: [], deletes: [] });
    s.actions.updateTask(a.id, { title: 'A2' });
    s.actions.deleteTask(b.id);
    const c = s.actions.addTask(input('C'));
    const ch = localChanges(s.getState(), synced);
    expect(ch.upserts.map(r => r.id).sort()).toEqual([a.id, c.id].sort());
    expect(ch.deletes).toEqual([{ kind: 'tasks', id: b.id, data: null, deleted: true }]);
  });
});

describe('applyRows', () => {
  it('takes new cloud items, replaces unchanged ones, removes deleted ones', () => {
    const pc = mk(1000), phone = mk(500000);
    const a = pc.actions.addTask(input('A')), b = pc.actions.addTask(input('B'));
    phone.actions.importData(pc.actions.exportData());
    const synced = itemHashes(phone.getState());
    pc.actions.completeTask(a.id);
    pc.actions.deleteTask(b.id);
    const c = pc.actions.addTask(input('C'));
    const pcTasks = pc.getState().tasks;
    const { state, taken } = applyRows(phone.getState(), [row('tasks', pcTasks.find(t => t.id === a.id)!), row('tasks', b, true), row('tasks', c)], synced);
    expect(state.tasks.map(t => t.title).sort()).toEqual(['A', 'C']);
    expect(state.tasks.find(t => t.id === a.id)!.completed).toBe(true);
    expect(taken.length).toBe(3);
  });
  it('keeps what changed here when it is newer, takes the cloud copy when that is newer', () => {
    const pc = mk(1000), phone = mk(500000);
    const a = pc.actions.addTask(input('A'));
    phone.actions.importData(pc.actions.exportData());
    const synced = itemHashes(phone.getState());
    phone.actions.updateTask(a.id, { title: 'Phone' });                 // phone clock is far ahead
    pc.actions.updateTask(a.id, { title: 'PC' });
    const pcRow = row('tasks', pc.getState().tasks[0]);
    expect(applyRows(phone.getState(), [pcRow], synced).state.tasks[0].title).toBe('Phone');
    expect(applyRows(pc.getState(), [row('tasks', phone.getState().tasks[0])], itemHashes(pc.getState())).state.tasks[0].title).toBe('Phone');
  });
  it('an item deleted here stays deleted when its own earlier upload comes back; an edit here beats a cloud deletion', () => {
    const s = mk(), a = s.actions.addTask(input('A')), b = s.actions.addTask(input('B'));
    const synced = itemHashes(s.getState());
    const old = s.getState().tasks.find(t => t.id === a.id)!;
    s.actions.deleteTask(a.id);
    s.actions.updateTask(b.id, { title: 'B edited' });
    const { state } = applyRows(s.getState(), [row('tasks', old), row('tasks', b, true)], synced);
    expect(state.tasks.map(t => t.title)).toEqual(['B edited']);
  });
  it('never synced and the same id on both sides: the later edit wins, nothing is deleted', () => {
    const pc = mk(1000), phone = mk(500000);
    const a = pc.actions.addTask(input('A'));
    phone.actions.importData(pc.actions.exportData());
    const { state } = applyRows(phone.getState(), [row('tasks', a, true)], {});
    expect(state.tasks.length).toBe(1);
  });
  it('drops shortlist entries whose task was removed', () => {
    const s = mk(), a = s.actions.addTask(input('A'));
    s.actions.shortlistAdd(a.id);
    const synced = itemHashes(s.getState());
    expect(applyRows(s.getState(), [row('tasks', a, true)], synced).state.planner.shortlist).toEqual([]);
  });
});

describe('profile', () => {
  it('has no list items, and putting this device\'s lists back restores the save', () => {
    const s = mk(); s.actions.addTask(input('A')); s.actions.addTask(input('B'));
    const p = profileOf(s.getState());
    expect(p.tasks).toEqual([]);
    expect(withLists(p, s.getState())).toEqual(s.getState());
  });
});
