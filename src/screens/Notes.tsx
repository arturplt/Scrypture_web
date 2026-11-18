import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_NOTE_SIZE, MAX_NOTES, NOTE_BODY_MAX, NOTE_SIZES, NOTE_TITLE_MAX, NOTE_ALIGNS, UI_COLORS, alignLines, applyFormat, linesOf, type NoteAlign, clampNoteSize, colorAt, noteRuns, notePalette, runsText, sizeAt } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { NameDialog } from '../ui/NameDialog';
import { Icon } from '../ui/misc';
import { Modal } from '../ui/Modal';
import { collect, offsetOf, render, select } from './noteEditor';
import './notes.css';

const ALIGN_LABEL = { left: 'noteAlignLeft', center: 'noteAlignCenter', right: 'noteAlignRight', justify: 'noteJustify' } as const;
// four lines of an 8x8 icon: where each line starts and ends
const ALIGN_ICON = { left: 'M1 1h6v1H1zM1 3h4v1H1zM1 5h6v1H1zM1 7h3v1H1z', center: 'M1 1h6v1H1zM2 3h4v1H2zM1 5h6v1H1zM2 7h4v1H2z', right: 'M1 1h6v1H1zM3 3h4v1H3zM1 5h6v1H1zM4 7h3v1H4z', justify: 'M1 1h6v1H1zM1 3h6v1H1zM1 5h6v1H1zM1 7h6v1H1z' };

export const notePath = (id: string) => `/apps/notes/${id}`;

/** The notes list, or (with an id) one note to read and edit. Every keystroke is saved. */
export function Notes({ id }: { id?: string }) {
  return id ? <NoteEditor id={id} /> : <NoteList />;
}

function NoteList() {
  const { t } = useI18n();
  const notes = useAppState(s => s.notes.list);
  const [naming, setNaming] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const full = notes.length >= MAX_NOTES;
  const doomed = notes.find(n => n.id === deleting);
  const create = (title: string) => { setNaming(false); const made = actions.createNote(title); if (made) navigate(notePath(made)); };
  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('notes')}</h1>
      <div className="muted small">{t('notesHint')}</div>
      <div className="row"><PixelButton scale={1} disabled={full} onClick={() => setNaming(true)}>{t('noteNew')}</PixelButton></div>
      {full && <div className="muted small" role="status">{t('noteFull', { n: MAX_NOTES })}</div>}
      <PixelFrame theme="gold_thick" scale={1} className="card">
        <h2 className="subtitle">{t('notes')} ({notes.length}/{MAX_NOTES})</h2>
        {notes.length === 0 && <div className="muted small">{t('noteNone')}</div>}
        {[...notes].sort((a, b) => b.updatedAt - a.updatedAt).map(n => (
          <div key={n.id} className="row between note-row">
            <div className="note-row-name"><strong>{n.title || t('noteUntitled')}</strong><div className="muted small note-snip">{n.body.split('\n')[0].slice(0, 60)}</div></div>
            <div className="row">
              <PixelButton scale={1} onClick={() => navigate(notePath(n.id))}>{t('openApp')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => setDeleting(n.id)}>{t('delete')}</PixelButton>
            </div>
          </div>
        ))}
      </PixelFrame>
      <NameDialog open={naming} title={t('noteName')} initial={t('noteNewName')} okLabel={t('mmCreate')} cancelLabel={t('cancel')} onSubmit={create} onClose={() => setNaming(false)} />
      <Modal open={!!doomed} onClose={() => setDeleting(null)} title={t('delete')} theme="app">
        <p className="small note-ask">{t('noteDeleteAsk', { name: doomed?.title || t('noteUntitled') })}</p>
        <div className="row">
          <PixelButton scale={1} variant="red" onClick={() => { if (deleting) actions.deleteNote(deleting); setDeleting(null); }}>{t('delete')}</PixelButton>
          <PixelButton scale={1} onClick={() => setDeleting(null)}>{t('cancel')}</PixelButton>
        </div>
      </Modal>
    </div>
  );
}

function NoteEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const note = useAppState(s => s.notes.list.find(n => n.id === id));
  const root = useRef<HTMLDivElement>(null);
  const runs = useRef(note ? noteRuns(note) : []);
  const aligns = useRef<NoteAlign[]>(note?.aligns ?? []);
  const sel = useRef({ from: 0, to: 0 });
  const [len, setLen] = useState(note?.body.length ?? 0);
  const [, again] = useState(0);
  const [picking, setPicking] = useState(false);
  const found = !!note;
  // draw the text once; later edits happen in the page itself, so the caret is never disturbed
  useLayoutEffect(() => { if (root.current && note) render(root.current, runs.current, aligns.current); }, [found]);   // eslint-disable-line react-hooks/exhaustive-deps
  // remember the selection as character offsets (buttons are pressed while it is still there, but touch can lose it)
  useEffect(() => {
    const on = () => {
      const el = root.current, s = getSelection();
      if (!el || !s || !s.rangeCount || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) return;
      try {
        const r = s.getRangeAt(0);
        if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return;   // a range can end outside the editor (e.g. while dragging)
        sel.current = { from: offsetOf(el, r.startContainer, r.startOffset), to: offsetOf(el, r.endContainer, r.endOffset) };
        again(n => n + 1);
      } catch { /* the browser gave a range we cannot measure; keep the last selection */ }
    };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);
  if (!note) return <div className="screen"><PixelButton scale={1} variant="red" onClick={() => navigate('/apps/notes')}>{t('back')}</PixelButton><div className="muted small">{t('noteNone')}</div></div>;
  const dflt = clampNoteSize(note.size ?? DEFAULT_NOTE_SIZE);
  const { from, to } = sel.current;
  const hasSel = from !== to;
  const save = (next: typeof runs.current, nextAligns = aligns.current) => { runs.current = next; aligns.current = nextAligns; setLen(runsText(next).length); actions.updateNote(id, { runs: next, aligns: nextAligns }); };
  const onInput = () => { if (root.current) { const d = collect(root.current); save(d.runs, d.aligns); } };
  // alignment is per line: the lines the selection touches (or the caret's line)
  const align = (a: NoteAlign) => {
    const el = root.current;
    if (!el) return;
    const [first, last] = linesOf(runsText(runs.current), from, to);
    const next = alignLines(aligns.current, first, last, a) ?? [];
    save(runs.current, next);
    render(el, runs.current, next);
    el.focus();
    select(el, from, to);
  };
  const curAlign = aligns.current[linesOf(runsText(runs.current), from, to)[0]] ?? 'left';
  // a selection takes the format; with only a caret, the whole note's default changes
  const format = (patch: { s?: number | null; c?: string | null }) => {
    const el = root.current;
    if (!hasSel || !el) { actions.updateNote(id, { ...(patch.s != null ? { size: patch.s } : {}), ...(patch.c !== undefined ? { color: patch.c } : {}) }); return; }
    const next = applyFormat(runs.current, from, to, patch);
    save(next);
    render(el, next, aligns.current);
    el.focus();
    select(el, from, to);
  };
  const curColor = hasSel ? colorAt(runs.current, from + 1, note.color ?? UI_COLORS[0]) : note.color ?? UI_COLORS[0];
  const curSize = hasSel ? sizeAt(runs.current, from + 1, dflt) : dflt;
  return (
    <div className="screen note-screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/apps/notes')}>{t('back')}</PixelButton></div>
      <input type="text" className="field note-title" value={note.title} maxLength={NOTE_TITLE_MAX} placeholder={t('noteUntitled')} aria-label={t('noteName')}
        onChange={e => actions.updateNote(id, { title: e.target.value })} />
      <div className="note-bar" onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}>
        <div className="row note-tools">
          <PixelButton scale={1} disabled={curSize <= 0} onClick={() => format({ s: curSize - 1 })} aria-label={t('noteSmaller')}>-</PixelButton>
          <span className="small" aria-live="polite">{t('noteSize')} {curSize + 1}/{NOTE_SIZES.length}</span>
          <PixelButton scale={1} disabled={curSize >= NOTE_SIZES.length - 1} onClick={() => format({ s: curSize + 1 })} aria-label={t('noteBigger')}>+</PixelButton>
        </div>
        <div className="row note-tools">
          <button type="button" className="note-swatch" style={{ background: curColor }} aria-label={`${t('noteColor')} ${curColor}`} aria-expanded={picking} onClick={() => setPicking(v => !v)} />
          <button type="button" className="mm-ib" aria-label={t('noteColorReset')} title={t('noteColorReset')} onClick={() => { format({ c: null }); setPicking(false); }}><Icon name="symbol_reset" size={32} /></button>
          {NOTE_ALIGNS.map(a => {
            const on = curAlign === a;
            return (
              <button key={a} type="button" className={`mm-ib note-justify ${on ? 'on' : ''}`} aria-label={t(ALIGN_LABEL[a])} title={t(ALIGN_LABEL[a])} aria-pressed={on} onClick={() => align(a)}>
                <svg viewBox="0 0 8 8" width="100%" height="100%" shapeRendering="crispEdges" aria-hidden="true"><path d={ALIGN_ICON[a]} fill="currentColor" /></svg>
              </button>
            );
          })}
        </div>
        {picking && (
          <div className="note-line" role="group" aria-label={t('noteColor')}>
            {[...new Set(notePalette().flat())].filter(c => c !== curColor).map(c => <button key={c} type="button" className="note-swatch" style={{ background: c }} aria-label={c} onClick={() => { format({ c }); setPicking(false); }} />)}
          </div>
        )}
        <div className="muted small">{hasSel ? t('noteFmtSel') : t('noteFmtAll')}</div>
      </div>
      <div ref={root} className={`field note-body ${len === 0 ? 'empty' : ''}`} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={t('notes')} data-placeholder={t('noteBody')}
        style={{ fontSize: `var(--fs-${NOTE_SIZES[dflt]})`, ...(note.color ? { color: note.color } : {}) }}
        onInput={onInput} onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} />
      <div className="muted small">{len}/{NOTE_BODY_MAX}</div>
    </div>
  );
}
