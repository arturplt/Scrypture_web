import { en } from './en';
import { la } from './la';
import { pl } from './pl';

export type Key = keyof typeof en;
export type Lang = 'EN' | 'LA' | 'PL';
export type Params = Record<string, string | number>;
export type TFn = (key: Key, params?: Params) => string;

export const LANGS: Lang[] = ['EN', 'LA', 'PL'];
/** Display names are never translated (each language names itself). */
export const LANG_NAMES: Record<Lang, string> = { EN: 'English', LA: 'Latin', PL: 'Polski' };
/** Latin unlocks after completing this many tasks (Android rule). */
export const LATIN_UNLOCK_TASKS = 10;
/** Intl has no Latin; fall back to a neutral day-month format. */
export const DATE_LOCALE: Record<Lang, string> = { EN: 'en-GB', LA: 'en-GB', PL: 'pl-PL' };

const DICTS: Record<Lang, Record<Key, string>> = { EN: en, LA: la, PL: pl };

/** The order plural forms are written in, per language: English one|other, Polish one|few|many (Latin follows English). */
const PLURAL_ORDER: Record<Lang, string[]> = { EN: ['one', 'other'], LA: ['one', 'other'], PL: ['one', 'few', 'many'] };
const pluralRules = new Map<Lang, Intl.PluralRules>();
/** Which of the written forms a count takes: `{n|# zadanie|# zadania|# zadań}` gives 1 zadanie, 3 zadania, 5 zadań. */
export function pluralIndex(lang: Lang, n: number, forms: number): number {
  let r = pluralRules.get(lang);
  if (!r) pluralRules.set(lang, r = new Intl.PluralRules(lang === 'PL' ? 'pl' : 'en'));
  const i = PLURAL_ORDER[lang].indexOf(r.select(n));
  return Math.min(forms - 1, i < 0 ? forms - 1 : i);   // an unlisted category (a fraction in Polish) takes the last form
}
export function translate(lang: Lang, key: Key, params?: Params): string {
  const s = DICTS[lang][key] ?? en[key] ?? key;
  if (!params) return s;
  // plural forms first ({n|one|few|many}, # for the number), then plain {name} values
  const plural = s.replace(/\{(\w+)\|([^{}]*)\}/g, (m, p, body: string) => {
    const v = params[p];
    if (typeof v !== 'number') return m;
    const forms = body.split('|');
    return forms[pluralIndex(lang, v, forms.length)].replace(/#/g, String(v));
  });
  return plural.replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m));
}
export const makeT = (lang: Lang): TFn => (key, params) => translate(lang, key, params);

export const isLatinUnlocked = (tasksCompleted: number) => tasksCompleted >= LATIN_UNLOCK_TASKS;
/** A saved/imported Latin choice falls back to English while Latin is still locked. */
export const effectiveLang = (lang: Lang, tasksCompleted: number): Lang => (lang === 'LA' && !isLatinUnlocked(tasksCompleted) ? 'EN' : lang);
export const DICTIONARIES = DICTS;

/** Achievement texts are stored in English; show the translated version when we have one. */
export function achievementText(t: TFn, a: { id: string; title: string; description: string }) {
  const k = `ach.${a.id}.title` as Key;
  return k in en ? { title: t(k), description: t(`ach.${a.id}.desc` as Key) } : { title: a.title, description: a.description };
}

export const PRIORITY_KEY = { LOW: 'priorityLow', MEDIUM: 'priorityMedium', HIGH: 'priorityHigh', CRITICAL: 'priorityCritical' } as const satisfies Record<string, Key>;
export const RARITY_KEY = { COMMON: 'rarityCommon', UNCOMMON: 'rarityUncommon', RARE: 'rarityRare', EPIC: 'rarityEpic', LEGENDARY: 'rarityLegendary' } as const satisfies Record<string, Key>;
