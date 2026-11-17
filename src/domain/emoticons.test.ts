import { describe, expect, it } from 'vitest';
import { ACTIVE_EMOTIONS, ALL_FEELINGS, EMOTICON_LIST, EMOTICONS, emoticonGroups, emoticonsFor, feelingOf, EMOTICON_EXTRAS, matchesEmoticon, REPERTOIRE, flourishFor, FLOURISH_MAX_LEN } from './index';
import { EMOTICON_LIBRARY } from './emoticonLibrary';

describe('emoticon manager', () => {
  it('is plain printable ASCII, so Press Start 2P can draw it (except the fancy faces)', () => {
    for (const e of EMOTICON_LIST.filter(e => !e.fancy)) expect(e.face).toMatch(/^[\x20-\x7e]+$/);
  });
  it('has no face listed twice, and every feeling has at least two faces', () => {
    const faces = EMOTICON_LIST.map(e => e.face);
    expect(new Set(faces).size).toBe(faces.length);
    for (const f of ALL_FEELINGS) expect(emoticonsFor(f).length).toBeGreaterThanOrEqual(2);
  });
  it('lists every frame Bóbr animates today (a face shared by two moods, like (-_-), is listed once)', () => {
    for (const mood of ACTIVE_EMOTIONS) for (const frame of EMOTICONS[mood].frames) expect(feelingOf(frame)).toBeDefined();
    for (const mood of ACTIVE_EMOTIONS) expect(EMOTICONS[mood].frames.some(f => feelingOf(f) === mood)).toBe(true);
  });
  it('keeps the kaomoji library: named faces under a feeling, the rest as extras', () => {
    expect(EMOTICON_LIST.length).toBeGreaterThan(150);
    expect(EMOTICON_EXTRAS.length).toBeGreaterThan(50);
    expect(feelingOf('( ͡° ͜ʖ ͡°)')).toBe('MISCHIEVOUS');
    expect(EMOTICON_LIBRARY.length).toBeGreaterThan(250);
    expect(EMOTICON_LIST.some(e => e.note.includes('(tableflip)') && e.feeling === 'ANGRY')).toBe(true);
    expect(EMOTICON_EXTRAS.every(x => !feelingOf(x.face))).toBe(true);
  });
  it('searches by face, alias or note', () => {
    expect(matchesEmoticon('', 'x')).toBe(true);
    expect(matchesEmoticon('TABLE', '(tableflip)')).toBe(true);
    expect(matchesEmoticon('zzz', '(tableflip)', 'angry')).toBe(false);
  });
  it('groups every face once', () => {
    expect(emoticonGroups().reduce((n, g) => n + g.faces.length, 0)).toBe(EMOTICON_LIST.length);
  });

  it('gives every mood a repertoire that starts with itself and only holds known feelings', () => {
    for (const mood of ACTIVE_EMOTIONS) {
      expect(REPERTOIRE[mood][0]).toBe(mood);
      for (const f of REPERTOIRE[mood]) expect(ALL_FEELINGS).toContain(f);
    }
  });
  it('flourishes always fit the bubble and belong to the mood\'s repertoire', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const mood of ACTIVE_EMOTIONS) for (let i = 0; i < 200; i++) {
      const e = flourishFor(mood, rand);
      expect(e.face.length).toBeLessThanOrEqual(FLOURISH_MAX_LEN);
      expect(REPERTOIRE[mood]).toContain(e.feeling);
    }
  });
  it('mostly shows the mood itself', () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const own = Array.from({ length: 400 }, () => flourishFor('SAD', rand)).filter(e => e.feeling === 'SAD').length;
    expect(own).toBeGreaterThan(150);
    expect(own).toBeLessThan(400);
  });
});
