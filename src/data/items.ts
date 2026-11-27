import { AREAS, pruneShortlist, stampOf, type Item } from './merge';
import type { AppState } from './state';

/**
 * Per-item sync, the pure part: which items changed on this device, and how rows from the cloud are applied to a save.
 * An item is one entry of a list (a task, a habit, a note ...) and is identified by `kind` + `id`.
 */
export interface Row { kind: string; id: string; /** null for a deletion */ data: Item | null; deleted: boolean }

/** JSON with sorted keys: the same value always gives the same text, even after a round trip through Postgres jsonb (which reorders keys). */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().filter(k => (x as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x) ?? 'null';
}
/** A short fingerprint of a value (to see whether it changed since the last sync). */
export function hashOf(x: unknown): string {
  const s = stable(x);
  let h = 5381, g = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = ((h << 5) + h + c) | 0; g = ((g << 5) ^ (g >>> 27) ^ c) | 0; }
  return `${(h >>> 0).toString(36)}${(g >>> 0).toString(36)}.${s.length}`;
}
/** The lists that go to the cloud. Worlds stay on this device: one world is up to a few MB, and every save of it would cost egress on every device. */
export const SYNCED = AREAS.filter(a => a.key !== 'worlds');
export const keyOf = (kind: string, id: string) => `${kind}/${id}`;

/** key -> fingerprint of every item in the save. */
export function itemHashes(s: AppState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of SYNCED) for (const x of a.get(s)) out[keyOf(a.key, x.id)] = hashOf(x);
  return out;
}

/** What to send: items new or changed since `synced`, and items that were synced and are gone now. */
export function localChanges(s: AppState, synced: Record<string, string>): { upserts: Row[]; deletes: Row[] } {
  const upserts: Row[] = [], seen = new Set<string>();
  for (const a of SYNCED) for (const x of a.get(s)) {
    const k = keyOf(a.key, x.id);
    seen.add(k);
    if (synced[k] !== hashOf(x)) upserts.push({ kind: a.key, id: x.id, data: x, deleted: false });
  }
  const deletes = Object.keys(synced).filter(k => !seen.has(k) && SYNCED.some(a => k.startsWith(`${a.key}/`))).map(k => { const i = k.indexOf('/'); return { kind: k.slice(0, i), id: k.slice(i + 1), data: null, deleted: true }; });
  return { upserts, deletes };
}

/** The save without its lists of items: what goes in the small profile row. */
export const profileOf = (s: AppState): AppState => AREAS.reduce((out, a) => a.set(out, []), s);
/** A profile from the cloud with this device's lists put back. */
export const withLists = (profile: AppState, lists: AppState): AppState => pruneShortlist(AREAS.reduce((out, a) => a.set(out, a.get(lists)), profile));

/**
 * Apply rows pulled from the cloud. `synced` holds the fingerprints from the last sync, so an item changed here since then
 * is told apart from one that is simply old:
 *  - unchanged here: the cloud copy replaces it (or removes it);
 *  - changed here: the later edit wins (a tie keeps ours), and an edit beats a deletion;
 *  - deleted here after the last sync: stays deleted (the row is probably our own earlier upload).
 * Returns the new save and the keys whose state now equals the cloud's (their fingerprints are to be refreshed).
 */
export function applyRows(s: AppState, rows: Row[], synced: Record<string, string>): { state: AppState; taken: string[] } {
  const taken: string[] = [];
  let out = s;
  for (const a of SYNCED) {
    const mine = rows.filter(r => r.kind === a.key);
    if (!mine.length) continue;
    let list = [...a.get(out)];
    for (const r of mine) {
      const k = keyOf(a.key, r.id), at = list.findIndex(x => x.id === r.id), local = at >= 0 ? list[at] : null;
      const dirty = local ? synced[k] !== hashOf(local) : false;   // never synced counts as changed
      if (r.deleted || !r.data) {
        if (local && !dirty) { list.splice(at, 1); taken.push(k); }
        else if (!local) taken.push(k);
        continue;
      }
      if (!local) { if (synced[k] === undefined) { list.push(r.data); taken.push(k); } continue; }   // else: deleted here since the last sync
      if (hashOf(local) === hashOf(r.data)) { taken.push(k); continue; }   // already the same
      if (dirty && stampOf(local) >= stampOf(r.data)) continue;
      list[at] = r.data; taken.push(k);
    }
    out = a.set(out, list);
  }
  return { state: pruneShortlist(out), taken };
}
