import { useSyncExternalStore } from 'react';

/**
 * Own on-screen keyboard: state + text insertion.
 * On touch devices a focused text field gets inputMode="none" (no native keyboard) and becomes the keyboard's target.
 * Force it on a desktop for testing with ?kb=1 (or localStorage.kb = '1').
 */
export type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', '']);
let target: Field | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

const forced = () => { try { return /[?&]kb=1/.test(location.search) || localStorage.getItem('kb') === '1'; } catch { return false; } };
const enabled = () => forced() || matchMedia('(pointer: coarse)').matches;

function isTextField(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
}

/** The player can swap to the phone's own keyboard; the choice is remembered. */
let system = (() => { try { return localStorage.getItem('kbSystem') === '1'; } catch { return false; } })();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useKeyboardTarget = () => useSyncExternalStore(subscribe, () => target, () => null);
export const useSystemKeyboard = () => useSyncExternalStore(subscribe, () => system, () => false);
export const closeKeyboard = () => { const t = target; target = null; emit(); t?.blur(); };

/** Field's own inputMode (numeric, ...) is kept so the system keyboard still gets it. */
function applyMode(el: Field) {
  if (el.dataset.kbMode === undefined) el.dataset.kbMode = el.inputMode === 'none' ? '' : el.inputMode;
  el.inputMode = system ? el.dataset.kbMode as Field['inputMode'] : 'none';
}
let wait = 0;
/** Calls `done` once the phone's own keyboard has gone (the visible area is full height again), or after a short timeout. */
function afterSystemKeyboardGone(done: () => void) {
  const vv = window.visualViewport;
  const gone = () => !vv || window.innerHeight - vv.height < 80;
  let finished = false;
  const end = () => { if (finished) return; finished = true; clearTimeout(timer); vv?.removeEventListener('resize', check); done(); };
  const check = () => { if (gone()) setTimeout(end, 60); };
  const timer = window.setTimeout(end, 900);
  vv?.addEventListener('resize', check);
  check();
}

export function toggleSystemKeyboard() {
  system = !system;
  try { localStorage.setItem('kbSystem', system ? '1' : '0'); } catch { /* private mode */ }
  const el = target;
  if (!el) return emit();
  applyMode(el);
  if (system) { el.blur(); el.focus(); emit(); return; }   // inside the tap, so the phone raises its keyboard
  // Back to the own keyboard: let the phone's keyboard leave first, then slide ours up from below.
  const mine = ++wait;
  target = null; emit(); el.blur();
  afterSystemKeyboardGone(() => { if (mine === wait && !system) { el.focus(); } });
}

/** Writes through the native value setter and fires `input`, so React's onChange sees it. */
function setValue(el: Field, value: string, caret: number) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function typeText(text: string) {
  const el = target; if (!el) return;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  const room = el.maxLength > 0 ? el.maxLength - (el.value.length - (b - a)) : Infinity;
  const s = text.slice(0, Math.max(0, room));
  if (!s) return;
  setValue(el, el.value.slice(0, a) + s + el.value.slice(b), a + s.length);
}

export function backspace() {
  const el = target; if (!el) return;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  if (a !== b) return setValue(el, el.value.slice(0, a) + el.value.slice(b), a);
  if (a === 0) return;
  const cut = el.value.slice(0, a).match(/[\uD800-\uDBFF][\uDC00-\uDFFF]$/) ? 2 : 1;   // do not split a surrogate pair
  setValue(el, el.value.slice(0, a - cut) + el.value.slice(a), a - cut);
}

export function enter() {
  const el = target; if (!el) return;
  if (el instanceof HTMLTextAreaElement) return typeText('\n');
  const key = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
  if (el.dispatchEvent(new KeyboardEvent('keydown', key))) el.form?.requestSubmit();
  el.dispatchEvent(new KeyboardEvent('keyup', key));
  closeKeyboard();
}

let started = false;
export function startKeyboard() {
  if (started || typeof document === 'undefined') return;
  started = true;
  document.addEventListener('focusin', e => {
    if (!enabled() || !isTextField(e.target)) return;
    applyMode(e.target);
    target = e.target; emit();
    if (!system) requestAnimationFrame(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });
  document.addEventListener('focusout', e => {
    if (e.target !== target) return;
    const next = e.relatedTarget as HTMLElement | null;
    if (next?.closest?.('[data-kb]')) return;
    setTimeout(() => { if (document.activeElement !== target) { target = null; emit(); } }, 0);
  });
}
