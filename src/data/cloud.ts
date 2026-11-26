import { useSyncExternalStore } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { store } from './hooks';
import { applyRows, hashOf, itemHashes, keyOf, localChanges, profileOf, withLists, type Row } from './items';
import { paceMs } from './syncPace';
import { mergeProfile, mergeSaves, takeCloudProfile } from './merge';
import { normalize } from './storage';
import type { AppState } from './state';
import type { UserStats } from '../domain';
import { CLOUD_KEY, CLOUD_URL } from './cloudConfig';

/**
 * Optional account sync. Every list entry (task, habit, note ...) is its own row in `public.items`; everything else
 * (settings, pet, counters ...) is one small row in `public.profile`. Signed out, the app works exactly as before.
 * The pure rules are in items.ts and merge.ts.
 */
export interface CloudView {
  email: string | null;
  phase: 'signedOut' | 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  error: string | null;
}

const sb = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'scrypture:auth' } });

// ---- what this device knows about the cloud (kept in localStorage, next to the save)
const META_KEY = 'scrypture:sync2';
interface Meta {
  uid: string | null;
  /** fingerprint of every item as of the last sync (to find what changed here, and what was deleted here) */
  hashes: Record<string, string>;
  /** the latest item change pulled so far */
  cursor: string | null;
  /** the profile row's version stamp as of the last sync, and a fingerprint of this device's profile then */
  profileStamp: string | null;
  profileHash: string | null;
  /** the counters (XP ...) as of the last sync, so progress made on two devices can be added up */
  statsBase: UserStats | null;
  /** the inventory as of the last sync, for the same reason (what each device picked up or spent since is added up) */
  invBase: Record<string, number> | null;
  /** an older all-in-one cloud save has been looked at (and merged in) */
  legacyDone: boolean;
  /** when this device last changed its save (the later side wins settings and the like) */
  at: number;
}
const EMPTY: Meta = { uid: null, hashes: {}, cursor: null, profileStamp: null, profileHash: null, statsBase: null, invBase: null, legacyDone: false, at: 0 };
function readMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null');
    if (m && typeof m === 'object') return { ...EMPTY, ...m, hashes: m.hashes && typeof m.hashes === 'object' ? m.hashes : {} };
    const old = JSON.parse(localStorage.getItem('scrypture:sync') ?? 'null');   // the all-in-one version kept its change time here
    if (old && typeof old.at === 'number') return { ...EMPTY, at: old.at };
  } catch { /* unreadable: start over */ }
  return { ...EMPTY };
}
function patchMeta(p: Partial<Meta>): Meta {
  const m = { ...readMeta(), ...p };
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ }
  return m;
}

// ---- observable status for the UI
let view: CloudView = { email: null, phase: 'signedOut', lastSyncedAt: null, error: null };
const listeners = new Set<() => void>();
const setView = (p: Partial<CloudView>) => { view = { ...view, ...p }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const useCloud = () => useSyncExternalStore(subscribe, () => view);
const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));

// ---- sync
let uid: string | null = null;
let running = false, again = false, applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** When this device last wrote to the cloud (the brake against two copies overwriting each other, see syncPace.ts) */
const uploads: number[] = [];
const noteUpload = () => { const now = Date.now(); uploads.push(now); while (uploads.length > 20 || (uploads.length && now - uploads[0] > 120_000)) uploads.shift(); };
let lastState = store.getState();

/** Put a save from the cloud into the app (not counted as a change made here). */
function applyState(next: AppState) {
  if (JSON.stringify(next) === JSON.stringify(store.getState())) return;
  applying = true;
  try { store.actions.importData(JSON.stringify(next)); } finally { applying = false; lastState = store.getState(); }
}

type CloudRow = Row & { updated_at: string };
const PAGE = 500;
/** Item changes since `cursor`, oldest first. Looks back a few seconds before it: a row written by a slow request can show up late. */
async function fetchItems(cursor: string | null): Promise<CloudRow[]> {
  const since = cursor ? new Date((Date.parse(cursor) || 0) - 5000).toISOString() : null;
  const all: CloudRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('items').select('kind, id, data, deleted, updated_at').eq('user_id', uid!).order('updated_at', { ascending: true }).range(from, from + PAGE - 1);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...(data as CloudRow[]));
    if (data.length < PAGE) return all;
  }
}

/** Rows in groups that stay well under the request size limit. */
function chunks(rows: Row[], maxBytes = 600_000, maxRows = 100): Row[][] {
  const out: Row[][] = []; let cur: Row[] = [], size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r.data ?? null).length + 100;
    if (cur.length && (size + n > maxBytes || cur.length >= maxRows)) { out.push(cur); cur = []; size = 0; }
    cur.push(r); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function syncOnce(): Promise<void> {
  let meta = readMeta();
  if (meta.uid !== uid) meta = patchMeta({ ...EMPTY, uid, at: meta.at });   // another account was used on this device before

  // 0. an account that still has the older all-in-one save: merge it in once (it is left in place as a backup)
  if (!meta.legacyDone) {
    const { count, error } = await sb.from('items').select('id', { count: 'exact', head: true }).eq('user_id', uid!);
    if (error) throw error;
    if (!count) {
      const { data, error: e2 } = await sb.from('saves').select('state, updated_at').eq('user_id', uid!).maybeSingle();
      if (e2) throw e2;
      if (data) applyState(mergeSaves(store.getState(), normalize(data.state), null, meta.at, Date.parse(data.updated_at as string) || 0));
    }
    meta = patchMeta({ legacyDone: true });
  }

  // 1. items changed elsewhere
  const rows = await fetchItems(meta.cursor);
  if (rows.length) {
    const { state, taken } = applyRows(store.getState(), rows, meta.hashes);
    applyState(state);
    const now = itemHashes(store.getState()), hashes = { ...meta.hashes };
    for (const k of taken) { if (k in now) hashes[k] = now[k]; else delete hashes[k]; }
    meta = patchMeta({ hashes, cursor: rows[rows.length - 1].updated_at });
  }

  // 2. the profile, if it changed elsewhere
  const { data: prof, error: pe } = await sb.from('profile').select('data, updated_at').eq('user_id', uid!).maybeSingle();
  if (pe) throw pe;
  if (prof && prof.updated_at !== meta.profileStamp) {
    const cloud = normalize(prof.data), here = store.getState();
    const clean = meta.profileHash !== null && meta.profileHash === hashOf(profileOf(here));
    const taken = clean ? takeCloudProfile(here, cloud, meta.invBase) : null;
    applyState(withLists(taken ? taken.state : mergeProfile(here, cloud, meta.statsBase, meta.at, Date.parse(prof.updated_at as string) || 0, meta.invBase), here));
    // (`raised`: this device kept more than the cloud has, so its profile is not the cloud's: no fingerprint, and step 4 uploads it)
    // After a merge the counters of this device include what the cloud had, so what has been merged must not be counted again if the upload below fails and the merge
    // runs once more: the base is now the cloud's own copy (then "device minus base" is only what this device earned, "cloud minus base" only what is new there)
    meta = patchMeta({ profileStamp: prof.updated_at as string, ...(taken ? (taken.raised ? { profileHash: null } : { profileHash: hashOf(profileOf(store.getState())), statsBase: store.getState().stats, invBase: { ...store.getState().inventory } }) : { statsBase: cloud.stats, invBase: { ...cloud.inventory } }) });
  } else if (prof && meta.invBase === null && meta.profileHash !== null && meta.profileHash === hashOf(profileOf(store.getState()))) {
    meta = patchMeta({ invBase: { ...store.getState().inventory } });   // same as the cloud: from here on what each device gains or spends can be added up
  }

  // 3. items changed here
  const snap = store.getState();
  const { upserts, deletes } = localChanges(snap, meta.hashes);
  for (const batch of chunks([...upserts, ...deletes])) {
    const { error } = await sb.from('items').upsert(batch.map(r => ({ user_id: uid, kind: r.kind, id: r.id, data: r.data, deleted: r.deleted })), { onConflict: 'user_id,kind,id' });
    if (error) throw error;
    noteUpload();
    const hashes = { ...readMeta().hashes };
    for (const r of batch) { if (r.deleted) delete hashes[keyOf(r.kind, r.id)]; else hashes[keyOf(r.kind, r.id)] = hashOf(r.data); }
    meta = patchMeta({ hashes });
  }
  if (upserts.length + deletes.length && store.getState() !== snap) again = true;   // edited while the request was on its way

  // 4. the profile, if it changed here (only if nobody saved it since we looked)
  const snap2 = store.getState(), ph = hashOf(profileOf(snap2));
  if (ph !== meta.profileHash || meta.profileStamp === null) {
    let stamp: string;
    if (meta.profileStamp === null) {
      const { data, error } = await sb.from('profile').insert({ user_id: uid, data: profileOf(snap2) }).select('updated_at').single();
      if (error) { if (error.code === '23505') { again = true; return; } throw error; }
      stamp = data.updated_at as string;
    } else {
      const { data, error } = await sb.from('profile').update({ data: profileOf(snap2) }).eq('user_id', uid!).eq('updated_at', meta.profileStamp).select('updated_at');
      if (error) throw error;
      if (!data?.length) { again = true; return; }   // someone saved it in between: look again
      stamp = data[0].updated_at as string;
    }
    noteUpload();
    patchMeta({ profileStamp: stamp, profileHash: ph, statsBase: snap2.stats, invBase: { ...snap2.inventory } });
    if (store.getState() !== snap2) again = true;
  }
}

export async function syncNow(): Promise<void> {
  if (!uid) return;
  if (running) { again = true; return; }
  running = true;
  setView({ phase: 'syncing', error: null });
  try {
    for (let i = 0; i < 5; i++) {   // a few rounds if things changed while we were busy
      again = false;
      await syncOnce();
      if (!again) break;
    }
    setView({ phase: 'idle', lastSyncedAt: Date.now() });
  } catch (e) {
    setView({ phase: 'error', error: message(e) });
  } finally { running = false; }
}

// ---- when to sync
let held = false, heldPending = false;
/** A game can hold the sync while it needs every frame (the paperplane in flight): what changes meanwhile is synced as soon as it is let go. */
export function holdSync(on: boolean) { held = on; if (!on && heldPending) { heldPending = false; schedule(600); } }
const schedule = (ms: number) => { if (held) { heldPending = true; return; } clearTimeout(timer); timer = setTimeout(() => void syncNow(), paceMs(uploads, Date.now(), ms)); };

store.subscribe(() => {
  const s = store.getState();
  if (s === lastState) return;
  lastState = s;
  if (applying) return;
  patchMeta({ at: Date.now() });
  if (uid) schedule(3000);
});
if (typeof document !== 'undefined') {
  // leaving the page: save now; coming back: pick up what the other device did
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); heldPending = false; void syncNow(); });
  window.addEventListener('online', () => void syncNow());
}

// the other device saved: pick it up straight away
let channel: RealtimeChannel | null = null;
function listen() {
  if (channel) { void sb.removeChannel(channel); channel = null; }
  if (!uid) return;
  const poke = () => schedule(400);
  const filter = `user_id=eq.${uid}`;
  channel = sb.channel('scrypture-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter }, poke)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profile', filter }, poke)
    .subscribe();
}

sb.auth.onAuthStateChange((_event, session) => {
  // not inside the callback itself: supabase-js can deadlock on calls made from it
  setTimeout(() => {
    const next = session?.user.id ?? null;
    setView({ email: session?.user.email ?? null });
    if (next === uid) return;
    uid = next;
    listen();
    if (uid) { setView({ phase: 'idle', error: null }); void syncNow(); } else setView({ phase: 'signedOut', error: null, lastSyncedAt: null });
  }, 0);
});

// ---- account actions (return an error text, or null on success)
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  return error ? error.message : null;
}
export async function signUp(email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
  return { error: error ? error.message : null, confirm: !error && !data.session };
}
export async function signOut(): Promise<void> { await sb.auth.signOut(); }
