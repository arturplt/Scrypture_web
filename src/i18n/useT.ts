import { useMemo } from 'react';
import { useAppState } from '../data/hooks';
import { DATE_LOCALE, effectiveLang, makeT, type Lang, type TFn } from './index';

/** Current language (after the Latin lock), translator and date locale. */
export function useI18n(): { t: TFn; lang: Lang; locale: string } {
  const saved = useAppState(s => s.settings.language);
  const done = useAppState(s => s.stats.totalTasksCompleted);
  const lang = effectiveLang(saved, done);
  return useMemo(() => ({ t: makeT(lang), lang, locale: DATE_LOCALE[lang] }), [lang]);
}
export const useT = () => useI18n().t;
