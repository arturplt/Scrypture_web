/** Notes: short written notes, each with a title and a body. Pure functions only; the screen lives in `screens/Notes.tsx`. */

/** `size`: index into NOTE_SIZES (default 2); `color`: a #rrggbb text colour, or unset for the normal text colour. */
export interface Note { id: string; title: string; body: string; updatedAt: number; size?: number; color?: string; /** alignment of each line of the text (unset = all left) */ aligns?: NoteAlign[]; /** formatted text: pieces with their own size / colour (only when something is formatted; `body` is always the plain text) */ runs?: Run[] }
/** A piece of text with its own size (index into NOTE_SIZES) and colour; unset = the note's default. */
export interface Run { t: string; s?: number; c?: string }
export interface NotesSave { list: Note[] }
export const emptyNotes = (): NotesSave => ({ list: [] });

export const NOTE_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type NoteAlign = (typeof NOTE_ALIGNS)[number];
export const isNoteAlign = (a: unknown): a is NoteAlign => (NOTE_ALIGNS as readonly unknown[]).includes(a);

/** One alignment per line, without trailing lefts; undefined when every line is left. */
export function cleanAligns(raw: unknown): NoteAlign[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NoteAlign[] = raw.slice(0, 2000).map(a => (isNoteAlign(a) ? a : 'left'));
  while (out.length && out[out.length - 1] === 'left') out.pop();
  return out.length ? out : undefined;
}
/** The line (counting from 0) a text position is on. */
export const lineOf = (text: string, pos: number) => text.slice(0, Math.max(0, pos)).split('\n').length - 1;
/** The lines a selection touches: the caret's line when nothing is selected; a selection ending right after a line break leaves the next line out. */
export function linesOf(text: string, from: number, to: number): [number, number] {
  const a = lineOf(text, from);
  return [a, to > from ? Math.max(a, lineOf(text, text[to - 1] === '\n' ? to - 1 : to)) : a];
}
/** Align the lines `first..last`. */
export function alignLines(aligns: NoteAlign[] | undefined, first: number, last: number, a: NoteAlign): NoteAlign[] | undefined {
  const out = [...(aligns ?? [])];
  for (let i = 0; i <= last; i++) if (out[i] === undefined) out[i] = 'left';
  for (let i = first; i <= last; i++) out[i] = a;
  return cleanAligns(out);
}

export const NOTE_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;   // the --fs-* tokens
export const DEFAULT_NOTE_SIZE = 1;
export const clampNoteSize = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < NOTE_SIZES.length ? n : DEFAULT_NOTE_SIZE);
export const isHexColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** The interface colours (mirrors tokens.css) that notes can be written in. */
export const UI_COLORS = ['#e8e5d2', '#b6a432', '#cf565c', '#3c898f', '#f5c387', '#3b4a6b'] as const;

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = (v: number[]) => '#' + v.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
/** Opposite: every channel inverted (white <-> black, red <-> cyan). */
export const oppositeColor = (c: string) => hex(rgb(c).map(x => 255 - x));
/** Complementary: the same colour with its hue turned half way round the colour wheel. */
export function complementColor(c: string): string {
  const [r, g, b] = rgb(c).map(x => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return hex([r, g, b].map(x => x * 255));   // grey: no hue to turn
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60 + 180) % 360 + 360) % 360;
  const k = (n: number) => { const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k0(n), 1)); };
  const k0 = (n: number) => Math.min(((n + h / 30) % 12) - 3, 9 - ((n + h / 30) % 12));
  return hex([k(0), k(8), k(4)].map(x => x * 255));
}
/** Three rows of swatches: the interface colours, their opposites and their complements. */
export const notePalette = () => [[...UI_COLORS], UI_COLORS.map(oppositeColor), UI_COLORS.map(complementColor)] as string[][];


export const runsText = (runs: Run[]) => runs.map(r => r.t).join('');
const sameFmt = (a: Run, b: Run) => a.s === b.s && a.c === b.c;
/** Drop empty and invalid pieces, join neighbours with the same format, and cut the text to the size limit. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  let left = NOTE_BODY_MAX;
  for (const r of runs) {
    if (left <= 0) break;
    const t = r.t.replace(/\r\n?/g, '\n').slice(0, left);
    if (!t) continue;
    left -= t.length;
    const run: Run = { t, ...(r.s !== undefined && Number.isInteger(r.s) && r.s >= 0 && r.s < NOTE_SIZES.length ? { s: r.s } : {}), ...(isHexColor(r.c) ? { c: r.c.toLowerCase() } : {}) };
    const last = out[out.length - 1];
    if (last && sameFmt(last, run)) last.t += run.t; else out.push(run);
  }
  return out;
}
/** Give the text between `from` and `to` a new size and/or colour (null removes it, undefined leaves it). */
export function applyFormat(runs: Run[], from: number, to: number, patch: { s?: number | null; c?: string | null }): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = pos, b = pos + r.t.length;
    pos = b;
    const lo = Math.max(from, a), hi = Math.min(to, b);
    if (lo >= hi) { out.push(r); continue; }
    if (lo > a) out.push({ ...r, t: r.t.slice(0, lo - a) });
    const mid: Run = { t: r.t.slice(lo - a, hi - a), s: r.s, c: r.c };
    if (patch.s !== undefined) mid.s = patch.s ?? undefined;
    if (patch.c !== undefined) mid.c = patch.c ?? undefined;
    out.push(Object.fromEntries(Object.entries(mid).filter(([, v]) => v !== undefined)) as unknown as Run);
    if (hi < b) out.push({ ...r, t: r.t.slice(hi - a) });
  }
  return normalizeRuns(out);
}
/** The size in force at a text position (the piece before it when at a boundary). */
export function sizeAt(runs: Run[], pos: number, fallback: number): number {
  let end = 0;
  for (const r of runs) { end += r.t.length; if (pos <= end) return r.s ?? fallback; }
  return fallback;
}
/** The colour in force at a text position (the piece before it when at a boundary), or the fallback. */
export function colorAt(runs: Run[], pos: number, fallback: string): string {
  let end = 0;
  for (const r of runs) { end += r.t.length; if (pos <= end) return r.c ?? fallback; }
  return fallback;
}
/** The runs of a note: its formatted pieces, or its plain body as one piece. */
export const noteRuns = (n: Note): Run[] => (n.runs?.length ? n.runs : n.body ? [{ t: n.body }] : []);

export const MAX_NOTES = 100, NOTE_TITLE_MAX = 40, NOTE_BODY_MAX = 5000;

export const cleanNoteTitle = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, NOTE_TITLE_MAX);
/** A body keeps its line breaks. */
export const cleanNoteBody = (body: string) => body.replace(/\r\n?/g, '\n').slice(0, NOTE_BODY_MAX);

export const newNote = (id: string, title: string, now: number): Note => ({ id, title: cleanNoteTitle(title), body: '', updatedAt: now });

export function sanitizeNotes(raw: unknown): NotesSave {
  const list: Note[] = [];
  const src = typeof raw === 'object' && raw !== null && Array.isArray((raw as { list?: unknown }).list) ? (raw as { list: unknown[] }).list : [];
  for (const r of src) {
    if (typeof r !== 'object' || r === null) continue;
    const n = r as Record<string, unknown>;
    if (typeof n.id !== 'string' || !n.id || list.some(x => x.id === n.id)) continue;
    const runs = Array.isArray(n.runs) ? normalizeRuns(n.runs.filter((x): x is Run => typeof x === 'object' && x !== null && typeof (x as Run).t === 'string')) : [];
    const formatted = runs.some(r => r.s !== undefined || r.c !== undefined);
    list.push({ id: n.id, title: cleanNoteTitle(typeof n.title === 'string' ? n.title : ''), body: formatted ? runsText(runs) : cleanNoteBody(typeof n.body === 'string' ? n.body : ''), ...(formatted ? { runs } : {}),
      updatedAt: typeof n.updatedAt === 'number' && Number.isFinite(n.updatedAt) ? n.updatedAt : 0,
      ...(n.size !== undefined && clampNoteSize(n.size) !== DEFAULT_NOTE_SIZE ? { size: clampNoteSize(n.size) } : {}), ...(isHexColor(n.color) ? { color: n.color.toLowerCase() } : {}), ...(cleanAligns(n.aligns) ? { aligns: cleanAligns(n.aligns) } : {}) });
    if (list.length >= MAX_NOTES) break;
  }
  return { list };
}

/** Text folded for searching: lower case, without accents (Bóbr = bobr) and with the Polish ł as l. */
export const foldText = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/gi, 'l').toLowerCase();

/**
 * The notes that contain every word of `query` (in the title or the text), newest first, those with it in the title ahead of
 * those with it only in the text. `snippet` is the line of the text round the first word found there (up to 60 characters),
 * or the text's first line when only the title matched. An empty query keeps every note in newest-first order.
 */
export function searchNotes(notes: readonly Note[], query: string): { note: Note; snippet: string }[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const out = notes.map(note => {
    const title = foldText(note.title), body = foldText(note.body), both = `${title}\n${body}`;
    if (!words.every(w => both.includes(w))) return null;
    const lines = note.body.split('\n'), first = words.map(w => foldText(note.body).indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0];
    let line = lines[0] ?? '';
    if (first !== undefined) {   // folding never changes the length of a line, so the same position finds the line in the original
      let at = 0;
      for (const l of lines) { if (first <= at + l.length) { line = l; break; } at += l.length + 1; }
      const col = Math.max(0, first - (at)); // position inside that line
      const start = Math.max(0, Math.min(col - 20, line.length - 60));
      return { note, snippet: (start > 0 ? '…' : '') + line.slice(start, start + 60), inTitle: words.every(w => title.includes(w)) };
    }
    return { note, snippet: line.slice(0, 60), inTitle: true };
  }).filter((x): x is { note: Note; snippet: string; inTitle: boolean } => !!x);
  return out.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.note.updatedAt - a.note.updatedAt).map(({ note, snippet }) => ({ note, snippet }));
}
