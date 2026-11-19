import { useSyncExternalStore } from 'react';
import { createClient } from '@supabase/supabase-js';
import { store } from './hooks';
import { planSync } from './syncPlan';
import { mergeSaves, snapshotOf, type Snap } from './merge';
import { normalize } from './storage';
import { CLOUD_KEY, CLOUD_URL } from './cloudConfig';

/**
 * Optional account sync. The whole save is one JSON row per user in `public.saves`.
 * Signed out, the app works exactly as before (localStorage only).
 */
export interface CloudView {
  email: string | null;
  phase: 'signedOut' | 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  error: string | null;
}

const sb = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'scrypture:auth' } });

// ---- what this device knows about the cloud copy (kept in localStorage, next to the save)
const META_KEY = 'scrypture:sync';
interface Meta { base: string | null; dirty: boolean; uid: string | null; /** the save as of the last sync (for telling deletions apart) */ snap: Snap | null; /** when this device last changed its save */ at: number }
function readMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null');
    if (m && typeof m === 'object') return { base: typeof m.base === 'string' ? m.base : null, dirty: m.dirty !== false, uid: typeof m.uid === 'string' ? m.uid : null, snap: m.snap && typeof m.snap === 'object' ? m.snap : null, at: typeof m.at === 'number' ? m.at : 0 };
  } catch { /* unreadable: start over */ }
  return { base: null, dirty: true, uid: null, snap: null, at: 0 };
}
const writeMeta = (m: Meta) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ } };

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
let lastState = store.getState();

const untouched = () => { const s = store.getState(); return !s.user.onboarded && s.tasks.length === 0 && s.habits.length === 0; };

async function fetchStamp(): Promise<string | null> {
  const { data, error } = await sb.from('saves').select('updated_at').eq('user_id', uid!).maybeSingle();
  if (error) throw error;
  return data ? (data.updated_at as string) : null;
}

async function fetchRow() {
  const { data, error } = await sb.from('saves').select('state, updated_at').eq('user_id', uid!).single();
  if (error) throw error;
  return data;
}

/** Replace this device's save with the cloud copy. */
async function pull(meta: Meta) {
  const data = await fetchRow();
  applying = true;
  try { store.actions.importData(JSON.stringify(data.state)); } finally { applying = false; lastState = store.getState(); }
  writeMeta({ ...meta, base: data.updated_at as string, dirty: false, uid, snap: snapshotOf(store.getState()) });
}

/** Both sides changed: combine them item by item, keep the result here and send it up. */
async function mergeIn(meta: Meta) {
  const row = await fetchRow();
  const merged = mergeSaves(store.getState(), normalize(row.state), meta.snap, meta.at, Date.parse(row.updated_at as string) || 0);
  applying = true;
  try { store.actions.importData(JSON.stringify(merged)); } finally { applying = false; lastState = store.getState(); }
  writeMeta({ ...meta, base: row.updated_at as string, dirty: true, uid });
  if (!(await push(row.updated_at as string))) again = true;
}

/** Write this device's save to the cloud, only if nobody changed it since `remote`. False when someone did. */
async function push(remote: string | null): Promise<boolean> {
  const meta = readMeta();
  const snap = store.getState();
  const fields = { state: snap, version: snap.version, updated_at: new Date().toISOString() };
  let stamp: string;
  if (remote === null) {
    const { data, error } = await sb.from('saves').insert({ user_id: uid, ...fields }).select('updated_at').single();
    if (error) { if (error.code === '23505') return false; throw error; }
    stamp = data.updated_at as string;
  } else {
    const { data, error } = await sb.from('saves').update(fields).eq('user_id', uid!).eq('updated_at', remote).select('updated_at');
    if (error) throw error;
    if (!data?.length) return false;
    stamp = data[0].updated_at as string;
  }
  const changed = store.getState() !== snap;   // edited while the request was on its way
  writeMeta({ ...meta, base: stamp, dirty: changed, uid, snap: snapshotOf(snap) });
  if (changed) again = true;
  return true;
}

async function syncOnce(): Promise<void> {
  let meta = readMeta();
  if (meta.uid !== uid) meta = { base: null, dirty: true, uid, snap: null, at: meta.at };   // another account was used on this device before
  const remote = await fetchStamp();
  const plan = planSync({ remote, base: meta.base, dirty: meta.dirty, untouched: untouched() });
  if (plan === 'merge') await mergeIn(meta);
  else if (plan === 'pull') await pull(meta);
  else if (plan === 'push') { if (!(await push(remote))) again = true; }
  else writeMeta(meta);
}

export async function syncNow(): Promise<void> {
  if (!uid) return;
  if (running) { again = true; return; }
  running = true;
  setView({ phase: 'syncing', error: null });
  try {
    do {
      again = false;
      await syncOnce();
    } while (again);
    setView({ phase: 'idle', lastSyncedAt: Date.now() });
  } catch (e) {
    setView({ phase: 'error', error: message(e) });
  } finally { running = false; }
}

// ---- when to sync
const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void syncNow(), ms); };

store.subscribe(() => {
  const s = store.getState();
  if (s === lastState) return;
  lastState = s;
  if (applying) return;
  writeMeta({ ...readMeta(), dirty: true, at: Date.now() });
  if (uid) schedule(3000);
});
if (typeof document !== 'undefined') {
  // leaving the page: save now; coming back: pick up what the other device did
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); void syncNow(); });
  window.addEventListener('online', () => void syncNow());
}

sb.auth.onAuthStateChange((_event, session) => {
  // not inside the callback itself: supabase-js can deadlock on calls made from it
  setTimeout(() => {
    const next = session?.user.id ?? null;
    setView({ email: session?.user.email ?? null });
    if (next === uid) return;
    uid = next;
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
