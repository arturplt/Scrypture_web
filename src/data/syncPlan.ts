/** What to do when this device syncs with the cloud copy. Pure, so the rules can be tested. */
export type SyncPlan = 'push' | 'pull' | 'none' | 'merge';

export interface SyncInput {
  /** the cloud copy's version stamp, or null when the account has no save yet */
  remote: string | null;
  /** the stamp of the cloud copy this device last pulled or pushed (null: never synced with this account) */
  base: string | null;
  /** this device changed its save since then */
  dirty: boolean;
  /** this device has nothing worth keeping (a fresh install) */
  untouched: boolean;
}

export function planSync({ remote, base, dirty, untouched }: SyncInput): SyncPlan {
  if (remote === null) return 'push';                       // first save of the account
  if (base === remote) return dirty ? 'push' : 'none';      // cloud unchanged since we last looked
  if (base === null) return untouched ? 'pull' : 'merge'; // first sign-in here: both sides may have data
  return dirty ? 'merge' : 'pull';                       // cloud changed elsewhere: take it, unless we changed too (then combine both)
}
