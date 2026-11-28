/**
 * The `?perf` readout as a small DOM panel: sections that fold (their open/closed state is kept in this browser), labels in a dim colour and the values that matter coloured by how bad they are.
 * The game builds `Section`s every 2 s and calls `update`; `toText` gives the same content as plain text (`window.__perfTxt`, for scripts).
 */

export type Tone = 'n' | 'good' | 'warn' | 'bad' | 'dim';
/** A label (a plain string) or a value with a tone. */
export type Part = string | readonly [string, Tone?];
export type Row = readonly Part[];
export interface Section {
  id: string; title: string;
  /** Shown on the section's header line even when it is folded: the one or two numbers that tell if it is healthy. */
  head?: Row;
  rows: Row[];
  /** Open the first time the panel is shown. */
  open?: boolean;
}

const COLOR: Record<Tone, string> = { n: '#fff', good: '#6f6', warn: '#fc3', bad: '#f55', dim: '#889' };
const LABEL = '#9ab';
const KEY = 'scrypture:perfopen';

/** `n` coloured by how big it is: up to `warn` is good, up to `bad` is warn, above is bad (`lowIsBad`: the other way round, for fps). */
export function tone(n: number, warn: number, bad: number, lowIsBad = false): Tone {
  if (!isFinite(n)) return 'dim';
  if (lowIsBad) return n >= warn ? 'good' : n >= bad ? 'warn' : 'bad';
  return n <= warn ? 'good' : n <= bad ? 'warn' : 'bad';
}

/** A value part: `v(12.3, 1, 'warn')` is "12.3" with that tone; a number is shown with `digits` decimals. */
export const v = (n: number | string, tn: Tone = 'n', digits = 0): Part => [typeof n === 'number' ? (isFinite(n) ? n.toFixed(digits) : '-') : n, tn];

const partText = (p: Part): string => (typeof p === 'string' ? p : p[0]);
export const rowText = (r: Row): string => r.map(partText).join('');
export function toText(sections: readonly Section[], hitches: readonly string[] = []): string {
  const out: string[] = [];
  for (const s of sections) { out.push(`[${s.title}]` + (s.head ? ' ' + rowText(s.head) : '')); for (const r of s.rows) out.push(rowText(r)); }
  if (hitches.length) { out.push('[Hitches]'); for (const h of hitches) out.push('! ' + h); }
  return out.join('\n');
}

function readOpen(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; } }
function writeOpen(o: Record<string, boolean>) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private window: not kept */ } }

function fill(el: HTMLElement, row: Row) {
  const nodes: Node[] = [];
  for (const p of row) {
    const sp = document.createElement('span'), isStr = typeof p === 'string';
    sp.textContent = isStr ? p : p[0]; sp.style.color = isStr ? LABEL : COLOR[p[1] ?? 'n'];
    nodes.push(sp);
  }
  el.replaceChildren(...nodes);
}

export class PerfPanel {
  private root: HTMLDivElement;
  private secs = new Map<string, { det: HTMLDetailsElement; title: HTMLElement; head: HTMLElement; body: HTMLDivElement; name: string }>();
  private hitchSec: { det: HTMLDetailsElement; title: HTMLElement; body: HTMLDivElement; name: string } | null = null;
  private open = readOpen();

  constructor(font: string, parent: HTMLElement = document.body) {
    const r = this.root = document.createElement('div');
    r.setAttribute('data-perf-panel', '');
    r.style.cssText = `position:fixed;left:4px;top:96px;width:min(460px,calc(100vw - 8px));max-height:calc(100vh - 200px);overflow:auto;background:rgba(0,0,0,.74);padding:3px 4px;font:8px/11px ${font};color:#fff;z-index:2147483000;pointer-events:none;white-space:pre-wrap;word-break:break-word;`;
    parent.appendChild(r);
  }

  /** A folding section: its header (arrow, title, and `head` numbers) and its body. */
  private mk(id: string) {
    const det = document.createElement('details'), sum = document.createElement('summary'), title = document.createElement('span'), head = document.createElement('span'), body = document.createElement('div');
    sum.style.cssText = 'cursor:pointer;pointer-events:auto;user-select:none;padding:1px 0;list-style:none;'; head.style.marginLeft = '6px'; title.style.color = '#fff';
    body.style.cssText = 'pointer-events:auto;padding-left:6px;';
    sum.addEventListener('pointerdown', e => e.stopPropagation()); sum.addEventListener('click', e => e.stopPropagation());
    sum.append(title, head); det.append(sum, body); this.root.appendChild(det);
    const e = { det, title, head, body, name: '' };
    det.addEventListener('toggle', () => { this.open[id] = det.open; writeOpen(this.open); title.textContent = (det.open ? '▼ ' : '▶ ') + e.name; });
    return e;
  }

  update(sections: readonly Section[], hitches: readonly string[] = []) {
    for (const s of sections) {
      let e = this.secs.get(s.id);
      if (!e) { e = this.mk(s.id); e.det.open = this.open[s.id] ?? !!s.open; this.secs.set(s.id, e); }
      e.name = s.title; e.title.textContent = (e.det.open ? '▼ ' : '▶ ') + s.title;
      fill(e.head, s.head ?? []);
      e.body.replaceChildren(...s.rows.map(r => { const d = document.createElement('div'); fill(d, r); return d; }));
    }
    // the hitch list: the last few frames that were slow, and what each was doing
    if (hitches.length || this.hitchSec) {
      if (!this.hitchSec) { const e = this.mk('hitches'); e.det.open = this.open.hitches ?? true; this.hitchSec = e; }
      const h = this.hitchSec;
      h.name = `Hitches (${hitches.length})`; h.title.textContent = (h.det.open ? '▼ ' : '▶ ') + h.name; h.title.style.color = hitches.length ? COLOR.warn : COLOR.dim;
      h.body.replaceChildren(...hitches.map(t => { const d = document.createElement('div'); d.textContent = t; d.style.color = COLOR.bad; return d; }));
    }
  }

  dispose() { this.root.remove(); this.secs.clear(); this.hitchSec = null; }
}
