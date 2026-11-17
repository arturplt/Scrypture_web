import { NOTE_SIZES, isNoteAlign, type NoteAlign, type Run } from '../domain';

/** DOM <-> runs for the contenteditable note editor. We draw one `<div>` per line (with data-a for its alignment) holding spans with data-s / data-c. */

type Fmt = { s?: number; c?: string };
export interface Doc { runs: Run[]; aligns: NoteAlign[] }

/** A `<br>` that only holds an empty line open (alone in a `<div>`, possibly inside a format span): the line itself is the break. */
function soleInLine(br: HTMLElement): boolean {
  let n: HTMLElement = br;
  while (n.parentElement && n.parentElement.childNodes.length === 1) {
    n = n.parentElement;
    if (/^(DIV|P)$/.test(n.tagName)) return true;
  }
  return false;
}

/** Read the text, formats and line alignments out of the editor (or a cloned fragment of it). Each `<div>` starts a new line (browsers also add them on Enter, copying the alignment). */
export function collect(root: Node): Doc {
  const runs: Run[] = [];
  const aligns: NoteAlign[] = [];
  let line = 0, started = false;
  const push = (t: string, f: Fmt, a: NoteAlign) => {
    if (!t) return;
    runs.push({ t, ...f });
    for (const ch of t) if (ch === '\n') aligns[++line] = a;
  };
  const walk = (n: Node, f: Fmt, a: NoteAlign) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) { push((c as Text).data.replace(/​/g, ''), f, a); started = true; continue; }
      if (!(c instanceof HTMLElement)) continue;
      if (c.tagName === 'BR') { if (!soleInLine(c)) { push('\n', f, a); started = true; } continue; }
      const g: Fmt = { ...f };
      if (c.dataset.s !== undefined) g.s = Number(c.dataset.s);
      if (c.dataset.c) g.c = c.dataset.c;
      let b = a;
      if (/^(DIV|P)$/.test(c.tagName)) {
        if (isNoteAlign(c.dataset.a)) b = c.dataset.a;
        if (started) push('\n', f, b); else aligns[0] = b;
        started = true;
      }
      walk(c, g, b);
    }
  };
  walk(root, {}, 'left');
  for (let i = 0; i <= line; i++) aligns[i] ??= 'left';
  return { runs, aligns };
}

/** Draw the text into the editor: a `<div>` per line. */
export function render(root: HTMLElement, runs: Run[], aligns: NoteAlign[] = []) {
  root.replaceChildren();
  const lines: Run[][] = [[]];
  for (const r of runs) r.t.split('\n').forEach((part, i) => { if (i) lines.push([]); if (part) lines[lines.length - 1].push({ ...r, t: part }); });
  lines.forEach((pieces, i) => {
    const div = document.createElement('div');
    const a = aligns[i] ?? 'left';
    if (a && a !== 'left') { div.dataset.a = a; div.style.textAlign = a; }
    for (const r of pieces) {
      const span = document.createElement('span');
      if (r.s !== undefined) { span.dataset.s = String(r.s); span.style.fontSize = `var(--fs-${NOTE_SIZES[r.s]})`; }
      if (r.c) { span.dataset.c = r.c; span.style.color = r.c; }
      span.textContent = r.t;
      div.append(span);
    }
    if (!pieces.length) div.append(document.createElement('br'));
    root.append(div);
  });
}

/** A text position (characters) for a point in the editor. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  if (!(node instanceof Node)) return 0;
  r.setEnd(node, offset);
  return collect(r.cloneContents()).runs.reduce((n, x) => n + x.t.length, 0);
}

/** Select a character range of a just-rendered editor. */
export function select(root: HTMLElement, from: number, to: number) {
  const find = (want: number): [Node, number] => {
    let at = 0;
    const divs = Array.from(root.children);
    for (let i = 0; i < divs.length; i++) {
      if (i) at += 1;   // the line break before this line
      const len = divs[i].textContent?.length ?? 0;
      if (want > at + len) { at += len; continue; }
      const walker = document.createTreeWalker(divs[i], NodeFilter.SHOW_TEXT);
      let left = want - at;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) { const l = (n as Text).length; if (left <= l) return [n, left]; left -= l; }
      return [divs[i], 0];
    }
    return [root, root.childNodes.length];
  };
  const [a, ao] = find(from), [b, bo] = find(to);
  const range = document.createRange();
  range.setStart(a, ao);
  range.setEnd(b, bo);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
