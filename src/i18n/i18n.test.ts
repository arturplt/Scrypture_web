import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LATIN_UNLOCK_TASKS, achievementText, effectiveLang, makeT, translate, type Key } from './index';
import { en } from './en';

const keys = Object.keys(en) as Key[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

describe('dictionaries', () => {
  it('every language has exactly the same keys', () => {
    for (const lang of ['LA', 'PL'] as const) expect(Object.keys(DICTIONARIES[lang]).sort()).toEqual(keys.slice().sort());
  });
  it('no empty strings and identical placeholders across languages', () => {
    for (const k of keys) for (const lang of ['EN', 'LA', 'PL'] as const) {
      const s = DICTIONARIES[lang][k];
      expect(s.trim().length, `${lang}.${k} empty`).toBeGreaterThan(0);
      expect(placeholders(s), `${lang}.${k} placeholders`).toBe(placeholders(en[k]));
    }
  });
  it('only uses characters the pixel font can draw (Basic Latin .. Latin Extended-A + a few symbols)', () => {
    const ok = (c: string) => c.codePointAt(0)! <= 0x17f || '•–—…’‘“”'.includes(c);
    for (const k of keys) for (const lang of ['EN', 'LA', 'PL'] as const)
      for (const c of DICTIONARIES[lang][k]) expect(ok(c), `${lang}.${k} has "${c}"`).toBe(true);
  });
  it('translations really differ from English for most keys', () => {
    for (const lang of ['LA', 'PL'] as const) {
      const same = keys.filter(k => DICTIONARIES[lang][k] === en[k]);
      expect(same.length / keys.length).toBeLessThan(0.15);
    }
  });
});

describe('translate', () => {
  it('fills params and keeps unknown placeholders', () => {
    expect(translate('EN', 'xpToGo', { n: 5 })).toBe('5 XP to go');
    expect(translate('PL', 'xpToGo', { n: 5 })).toBe('Jeszcze 5 XP');
    expect(translate('EN', 'xpToGo')).toBe('{n} XP to go');
  });
  it('uses Android strings for shared terms', () => {
    expect(makeT('LA')('task')).toBe('Opus');
    expect(makeT('PL')('body')).toBe('Ciało');
    expect(makeT('EN')('welcomeBuilder', { name: 'Ann' })).toBe('Welcome, Ann!');
  });
  it('Latin stays locked until enough tasks are done', () => {
    expect(effectiveLang('LA', LATIN_UNLOCK_TASKS - 1)).toBe('EN');
    expect(effectiveLang('LA', LATIN_UNLOCK_TASKS)).toBe('LA');
    expect(effectiveLang('PL', 0)).toBe('PL');
  });
  it('achievement texts are translated by id, unknown ones keep their stored text', () => {
    const a = { id: 'ten_tasks', title: 'Task Master', description: 'Complete 10 tasks' };
    expect(achievementText(makeT('PL'), a)).toEqual({ title: 'Mistrz zadań', description: 'Ukończ 10 zadań' });
    expect(achievementText(makeT('EN'), { id: 'x', title: 'T', description: 'D' })).toEqual({ title: 'T', description: 'D' });
  });
});
