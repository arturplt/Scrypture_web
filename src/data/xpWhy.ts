/**
 * Where XP came from, so Bóbr can say it when the stars fly on Home. Every place that pays XP leaves a note here (not saved: it only has to last
 * until the Home screen shows the gain); XP that arrives any other way (another device or tab, an import) is noted as `sync`.
 */
export type XpKind = 'task' | 'habit' | 'event' | 'sync';
export interface XpNote { kind: XpKind | 'other'; name?: string; xp: number; at: number }

const NOTES: XpNote[] = [];
const KEEP_MS = 5 * 60_000;

export function noteXp(kind: XpKind, xp: number, name?: string, at = Date.now()) {
  if (!(xp > 0)) return;
  NOTES.push({ kind, name, xp, at });
  while (NOTES.length > 20 || (NOTES.length && at - NOTES[0].at > KEEP_MS)) NOTES.shift();
}

/** What a gain of this size was for: the newest note of exactly that size, else the notes added up (several things paid at once), else "other". */
export function explainXp(gain: number, now = Date.now()): XpNote {
  const recent = NOTES.filter(n => now - n.at <= KEEP_MS);
  const exact = [...recent].reverse().find(n => n.xp === gain);
  if (exact) return exact;
  let sum = 0;
  for (let i = recent.length - 1; i >= 0; i--) { sum += recent[i].xp; if (sum === gain) return recent[recent.length - 1]; }
  return { kind: 'other', xp: gain, at: now };
}
