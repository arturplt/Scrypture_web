import { describe, expect, it } from 'vitest';
import { createStore } from './store';
import { mergeInventory, mergeProfile, mergeSaves, snapshotOf, takeCloudProfile } from './merge';

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

describe('mergeProfile inventory', () => {
  const base = { stick: 3, stone: 4, bcoin: 10 };
  it('adds up what each device picked up or spent since the last sync', () => {
    const { pc, phone } = pair();
    pc.actions.addItem('stick', 2); phone.actions.addItem('stick', 1); phone.actions.addItem('berry', 3); pc.actions.addItem('stone', -1);
    const m = mergeProfile(pc.getState(), phone.getState(), null, 2, 1, { ...pc.getState().inventory, stick: 0, stone: 0 });
    expect(m.inventory).toMatchObject({ stick: 3, stone: 0, berry: 3 });
    const k = mergeProfile({ ...pc.getState(), inventory: { stick: 5, stone: 3, bcoin: 10 } }, { ...phone.getState(), inventory: { stick: 4, stone: 4, bcoin: 12 } }, null, 2, 1, base);
    expect(k.inventory).toEqual({ stick: 6, stone: 3, bcoin: 12 });
  });
  it('never goes below zero, and without a last-sync record the larger amount is kept', () => {
    const { pc, phone } = pair();
    const a = { ...pc.getState(), inventory: { hay: 0 } }, b = { ...phone.getState(), inventory: { hay: 0 } };
    expect(mergeProfile(a, b, null, 2, 1, { hay: 1 }).inventory.hay).toBe(0);
    expect(mergeProfile({ ...a, inventory: { stick: 5 } }, { ...b, inventory: { stick: 7 } }, null, 2, 1, null).inventory.stick).toBe(7);
  });
});

describe('takeCloudProfile (this device has not changed its profile since the last sync)', () => {
  const rich = { bcoin: 1956, hay: 161, berry: 71, stick: 204, stone: 211 }, poor = { bcoin: 7, hay: 9, stick: 15, stone: 5 };
  it('without a last-sync record the larger inventory survives, and the device must upload it', () => {
    const { pc, phone } = pair();
    const here = { ...pc.getState(), inventory: rich }, cloud = { ...phone.getState(), inventory: poor };
    const r = takeCloudProfile(here, cloud, null);
    expect(r.state.inventory).toEqual(rich);
    expect(r.raised).toBe(true);
    expect(r.state.stats).toEqual(cloud.stats);   // everything else is the cloud's
  });
  it('with a record the cloud is taken whole: what the other device spent stays spent', () => {
    const { pc, phone } = pair();
    const r = takeCloudProfile({ ...pc.getState(), inventory: rich }, { ...phone.getState(), inventory: poor }, rich);
    expect(r.state.inventory).toEqual(poor);
    expect(r.raised).toBe(false);
  });
  it('without a record, a cloud that has everything already needs no upload', () => {
    const { pc, phone } = pair();
    const r = takeCloudProfile({ ...pc.getState(), inventory: poor }, { ...phone.getState(), inventory: rich }, null);
    expect(r.state.inventory).toEqual(rich);
    expect(r.raised).toBe(false);
  });
  it('the exact overwrite seen: a device that knew less (newer clock) no longer wipes the richer cloud', () => {
    const { pc, phone } = pair();
    const m = mergeProfile({ ...phone.getState(), inventory: poor }, { ...pc.getState(), inventory: rich }, null, 9e9, 1, null);
    expect(m.inventory).toEqual(rich);
    expect(mergeInventory(poor, rich, null)).toEqual(rich);
  });
});

describe('merging again after a failed upload', () => {
  it('with the cloud copy as the base, what was merged is not counted twice (this once made the XP double on every retry)', () => {
    const { pc, phone, a, b, snap } = pair();
    pc.actions.completeTask(a.id);                       // the cloud (pc) earned XP
    phone.actions.completeTask(b.id);                    // the phone earned some too
    const cloud1 = pc.getState();
    const merged1 = mergeProfile(phone.getState(), cloud1, snap.stats, 2, 1);
    // the upload failed because the cloud moved on: it gained a little more, and the merge runs again on the already merged state
    pc.actions.addTask(input('More')); pc.actions.completeTask(pc.getState().tasks.find(t => t.title === 'More')!.id);
    const cloud2 = pc.getState();
    const merged2 = mergeProfile(merged1, cloud2, cloud1.stats, 2, 1);   // base = the cloud copy that was merged
    const earned = (s: { totalExperiencePoints: number }) => s.totalExperiencePoints - snap.stats.totalExperiencePoints;
    const pcGain = earned(cloud2.stats), phoneGain = earned(phone.getState().stats);
    expect(earned(merged1.stats)).toBe(earned(cloud1.stats) + phoneGain);
    expect(earned(merged2.stats)).toBe(pcGain + phoneGain);
    // the old base (from before both) would have counted the first merge's cloud share twice
    expect(mergeProfile(merged1, cloud2, snap.stats, 2, 1).stats.totalExperiencePoints).toBeGreaterThan(merged2.stats.totalExperiencePoints);
  });
});

describe('a runaway save comes back to whole, bounded numbers', () => {
  it('normalize clamps XP, stats and items, and recomputes the level', async () => {
    const { normalize } = await import('./storage');
    const s = normalize({ version: 1, user: { name: 'A', onboarded: true, tutorialSeen: true }, stats: { level: 10, totalExperiencePoints: 2.144929644337742e53, body: 4.5, mind: 1.787e52, soul: 1, totalTasksCompleted: 1.787e52 }, inventory: { bcoin: 1.2455e60, hay: 3.7 } });
    expect(s.stats.totalExperiencePoints).toBe(1_000_000_000);
    expect(s.stats.body).toBe(4); expect(s.stats.mind).toBe(1_000_000_000); expect(s.stats.level).toBe(10);
    expect(s.inventory).toEqual({ bcoin: 1_000_000_000, hay: 3 });
  });
});

describe('reset stats', () => {
  it('zeroes XP, level and counters but keeps tasks', () => {
    const s = mk(); const t = s.actions.addTask(input('Keep')); s.actions.completeTask(t.id);
    expect(s.getState().stats.totalExperiencePoints).toBeGreaterThan(0);
    s.actions.resetStats();
    expect(s.getState().stats).toEqual({ level: 1, totalExperiencePoints: 0, body: 0, mind: 0, soul: 0, totalTasksCompleted: 0 });
    expect(s.getState().tasks).toHaveLength(1);
  });
});

describe('a reset survives sync', () => {
  it('the reset side wins the stats, with or without a base, and the other side follows', () => {
    const { pc, phone, a } = pair();
    pc.actions.completeTask(a.id);                      // the cloud (pc) has XP
    const cloud = pc.getState();
    phone.actions.importData(pc.actions.exportData());
    phone.actions.resetStats();
    const dev = phone.getState();
    for (const base of [null, cloud.stats]) {
      const m = mergeProfile(dev, cloud, base, 2, 1);
      expect(m.stats.totalExperiencePoints).toBe(0); expect(m.statsReset).toBe(1);
      // the other device, still on the old count, merging with the reset cloud copy
      expect(mergeProfile(cloud, m, cloud.stats, 3, 2).stats.totalExperiencePoints).toBe(0);
    }
  });
});
