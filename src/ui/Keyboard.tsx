import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ButtonLook, StyledButton } from './PixelButton';
import { useAppState } from '../data/hooks';
import { useT } from '../i18n/useT';
import { backspace, closeKeyboard, enter, startKeyboard, toggleSystemKeyboard, typeText, useKeyboardTarget, useSystemKeyboard } from './keyboard';
import './keyboard.css';

const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
/** Hold a letter for its Polish variants. */
const ALTS: Record<string, string[]> = { a: ['ą'], c: ['ć'], e: ['ę'], l: ['ł'], n: ['ń'], o: ['ó'], s: ['ś'], z: ['ź', 'ż'] };
const SYMBOLS = ['1234567890', '-/:;()&@"', '.,?!\'#%+='];

/** One key = one 9-slice button in the Theme manager's keyboard style. It never takes focus from the field it types into. */
function Key({ children, onPress, repeat, wide = 1, fn, label, on, tap, alts, onAlt }: { children: React.ReactNode; onPress: () => void; repeat?: boolean; wide?: number; fn?: boolean; label?: string; on?: boolean; tap?: boolean; alts?: string[]; onAlt?: (c: string) => void }) {
  const keys = useAppState(s => s.settings.buttons);
  const timer = useRef<number>();
  const [pop, setPop] = useState<string[] | null>(null);   // the variants shown while a letter is held
  const [hot, setHot] = useState('');
  const stop = () => { clearTimeout(timer.current); clearInterval(timer.current); };
  useEffect(() => stop, []);
  const pick = (e: React.PointerEvent) => document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-alt]')?.getAttribute('data-alt') ?? '';
  return (
    <StyledButton look={fn ? keys.keysFn : keys.keys} fallback={fn ? 'button_red' : 'button_green'} size="compact" scale={1} type="button" data-kb
      className={`kb-key ${on ? 'on' : ''} ${pop ? 'held' : ''}`} style={{ flexGrow: wide }} aria-label={label} aria-pressed={on}
      onPointerDown={e => {
        e.preventDefault();
        if (tap) return;   // acts on click instead: only a completed tap may raise the phone's own keyboard
        if (alts) { timer.current = window.setTimeout(() => setPop(alts), 320); return; }   // typed on release, so a hold can pick a variant instead
        onPress();
        if (repeat) timer.current = window.setTimeout(() => { timer.current = window.setInterval(onPress, 60); }, 380);
      }}
      onContextMenu={e => e.preventDefault()}
      onPointerMove={pop ? e => setHot(pick(e)) : undefined}
      onClick={tap ? onPress : undefined}
      onPointerUp={e => {
        stop();
        if (!alts) return;
        const v = pop ? pick(e) : '';
        setPop(null); setHot('');
        if (v) onAlt?.(v); else onPress();
      }}
      onPointerLeave={() => { if (!pop) stop(); }} onPointerCancel={() => { stop(); setPop(null); setHot(''); }}>
      {children}
      {pop && <span className="kb-pop" aria-hidden>{pop.map(a => <span key={a} data-alt={a}><ButtonLook look={hot === a ? keys.keysFn : keys.keys} fallback={hot === a ? 'button_red' : 'button_green'} size="compact" scale={1}>{a}</ButtonLook></span>)}</span>}
    </StyledButton>
  );
}

/** Pins an element to the bottom of what is visible (above the phone's own keyboard when that is open). */
function useVisualBottom(ref: React.RefObject<HTMLElement>, active: boolean) {
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv || !ref.current) return;
    const el = ref.current;
    const place = () => { el.style.bottom = `${Math.max(0, window.innerHeight - (vv.offsetTop + vv.height))}px`; };
    place(); vv.addEventListener('resize', place); vv.addEventListener('scroll', place);
    return () => { vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); };
  }, [ref, active]);
}

export function Keyboard() {
  const target = useKeyboardTarget();
  const system = useSystemKeyboard();
  const t = useT();
  const [shift, setShift] = useState<'off' | 'once' | 'caps'>('off');
  const [symbols, setSymbols] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(startKeyboard, []);
  useVisualBottom(panel, !!target && system);

  // Start each field lower-case, but capitalised at the start of a sentence.
  useEffect(() => { if (target) { setSymbols(false); setShift(target.value ? 'off' : 'once'); } }, [target]);

  // Reserve the keyboard's height so the page can scroll the field above it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!target || system || !panel.current) { root.style.removeProperty('--kb-h'); return; }
    let raf = 0;   // deferred: changing the page padding inside the observer callback trips "ResizeObserver loop" errors
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => panel.current && root.style.setProperty('--kb-h', `${panel.current.offsetHeight}px`)); });
    ro.observe(panel.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.style.removeProperty('--kb-h'); };
  }, [target, system]);

  if (!target) return null;

  // With the phone's own keyboard in use, only a small switch-back button floats above it.
  if (system) {
    return (
      <div ref={panel} className="kb kb-mini" data-kb>
        <Key fn tap wide={0} label={t('kbOwn')} onPress={toggleSystemKeyboard}>⌨</Key>
      </div>
    );
  }

  const upper = shift !== 'off';
  const put = (c: string) => { typeText(upper ? c.toUpperCase() : c); if (shift === 'once') setShift('off'); };
  const rows = symbols ? SYMBOLS : LETTERS;

  return (
    <div ref={panel} className="kb" data-kb>
      {rows.map((row, i) => (
        <div key={i} className="kb-row">
          {i === 2 && !symbols && <Key fn wide={1.5} on={shift !== 'off'} label="shift" onPress={() => setShift(s => s === 'off' ? 'once' : s === 'once' ? 'caps' : 'off')}>{shift === 'caps' ? '⇪' : '⇧'}</Key>}
          {[...row].map(c => <Key key={c} onPress={() => put(c)} alts={symbols ? undefined : ALTS[c]} onAlt={a => put(a)}>{symbols ? c : upper ? c.toUpperCase() : c}</Key>)}
          {i === 2 && <Key fn wide={1.5} repeat label="backspace" onPress={backspace}>⌫</Key>}
        </div>
      ))}
      <div className="kb-row">
        <Key fn wide={1.5} onPress={() => setSymbols(s => !s)}>{symbols ? 'ABC' : '123'}</Key>
        <Key fn tap wide={1} label={t('kbSystem')} onPress={toggleSystemKeyboard}>⌨</Key>
        <Key wide={4} label="space" onPress={() => typeText(' ')}>{' '}</Key>
        <Key fn wide={1.5} label="enter" onPress={enter}>↵</Key>
        <Key fn wide={1} label="close" onPress={closeKeyboard}>▼</Key>
      </div>
    </div>
  );
}
