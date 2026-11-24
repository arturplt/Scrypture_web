import { describe, expect, it } from 'vitest';
import { clampNoteSize, complementColor, notePalette, oppositeColor, sanitizeNotes, searchNotes, type Note } from './notes';

describe('note colours', () => {
  it('opposite inverts every channel', () => {
    expect(oppositeColor('#000000')).toBe('#ffffff');
    expect(oppositeColor('#cf565c')).toBe('#30a9a3');
  });
  it('complement turns the hue half way round and keeps greys', () => {
    expect(complementColor('#ff0000')).toBe('#00ffff');
    expect(complementColor('#3c898f')).toMatch(/^#[0-9a-f]{6}$/);
    expect(complementColor('#808080')).toBe('#808080');
    for (const c of notePalette().flat()) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('size and colour are sanitized', () => {
    expect(clampNoteSize(9)).toBe(1);
    const n = sanitizeNotes({ list: [{ id: 'a', size: 3, color: '#ABCDEF' }, { id: 'b', size: 99, color: 'red' }] }).list;
    expect(n[0]).toMatchObject({ size: 3, color: '#abcdef' });
    expect(n[1].size).toBeUndefined();
    expect(n[1].color).toBeUndefined();
  });
});

import { applyFormat, normalizeRuns, runsText, sizeAt } from './notes';
describe('note runs', () => {
  it('formats a range, splitting and merging pieces', () => {
    const r = applyFormat([{ t: 'hello world' }], 6, 11, { s: 3, c: '#ff0000' });
    expect(r).toEqual([{ t: 'hello ' }, { t: 'world', s: 3, c: '#ff0000' }]);
    expect(applyFormat(r, 6, 11, { s: null, c: null })).toEqual([{ t: 'hello world' }]);
    expect(runsText(applyFormat(r, 2, 8, { s: 4 }))).toBe('hello world');
    expect(sizeAt(r, 7, 1)).toBe(3);
    expect(sizeAt(r, 2, 1)).toBe(1);
  });
  it('normalizes bad pieces', () => {
    expect(normalizeRuns([{ t: '' }, { t: 'a', s: 99, c: 'x' }, { t: 'b' }])).toEqual([{ t: 'ab' }]);
  });
});

import { alignLines, cleanAligns, linesOf } from './notes';
describe('note line alignment', () => {
  it('finds the lines a selection touches', () => {
    const t = 'one\ntwo\nthree';
    expect(linesOf(t, 5, 5)).toEqual([1, 1]);
    expect(linesOf(t, 1, 9)).toEqual([0, 2]);
    expect(linesOf(t, 0, 4)).toEqual([0, 0]);   // ends right after the line break: the next line is not included
  });
  it('aligns only those lines and trims trailing lefts', () => {
    expect(alignLines(undefined, 1, 2, 'center')).toEqual(['left', 'center', 'center']);
    expect(alignLines(['left', 'center'], 1, 1, 'left')).toBeUndefined();
    expect(cleanAligns(['right', 'x', 'left'])).toEqual(['right']);
  });
});

describe('searching notes', () => {
  const n = (id: string, title: string, body: string, updatedAt: number): Note => ({ id, title, body, updatedAt });
  const list = [n('a', 'Shopping', 'milk\nbread and Bóbr snacks', 1), n('b', 'Bóbr ideas', 'a dam of sticks', 2), n('c', 'Łódź trip', 'train at nine', 3), n('d', 'Misc', 'x'.repeat(100) + ' needle ' + 'y'.repeat(100), 4)];
  it('keeps everything, newest first, for an empty query', () => {
    expect(searchNotes(list, '  ').map(r => r.note.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('finds words in title or text, ignoring case and accents, and needs every word', () => {
    expect(searchNotes(list, 'bobr').map(r => r.note.id)).toEqual(['b', 'a']);   // title matches first
    expect(searchNotes(list, 'lodz').map(r => r.note.id)).toEqual(['c']);
    expect(searchNotes(list, 'dam sticks').map(r => r.note.id)).toEqual(['b']);
    expect(searchNotes(list, 'dam bread')).toEqual([]);
  });
  it('shows the line of the first hit in the text, trimmed round it', () => {
    expect(searchNotes(list, 'snacks')[0].snippet).toBe('bread and Bóbr snacks');
    const s = searchNotes(list, 'needle')[0].snippet;
    expect(s.startsWith('…') && s.includes('needle') && s.length <= 61).toBe(true);
    expect(searchNotes(list, 'trip')[0].snippet).toBe('train at nine');   // title match: the text's first line
  });
});
