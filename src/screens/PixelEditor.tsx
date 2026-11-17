import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n/useT';
import { PixelButton } from '../ui/PixelButton';
import { PixelCheckbox } from '../ui/misc';
import { NudgeRange } from '../ui/NudgeRange';
import { blit, clearRect, cloneData, extract, flip, floodFill, inRect, type Pixels, type Rect, type Rgba } from '../domain/pixeledit';
import { rgbCss, type Rgb } from '../domain/pixelite';

type Tool = 'pencil' | 'eraser' | 'fill' | 'pick' | 'select' | 'move';
const TOOLS: { id: Tool; key: 'pxPencil' | 'feEraser' | 'feFill' | 'fePicker' | 'feSelect' | 'pxToolMove' }[] = [
  { id: 'pencil', key: 'pxPencil' }, { id: 'eraser', key: 'feEraser' }, { id: 'fill', key: 'feFill' },
  { id: 'pick', key: 'fePicker' }, { id: 'select', key: 'feSelect' }, { id: 'move', key: 'pxToolMove' },
];
interface Snap { idx: number; px: Pixels }
const hex = (c: Rgb) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
const toRgba = (s: string): Rgba => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
const asCanvas = (p: Pixels) => { const c = document.createElement('canvas'); c.width = p.width; c.height = p.height; c.getContext('2d')!.putImageData(new ImageData(p.data, p.width, p.height), 0, 0); return c; };

/** Paint, erase, fill, pick, select and move on one frame of the finished animation. Every edit can be undone. */
export function PixelEditor({ art, shown, cur, setArt, setCur, palette }: { art: Pixels[]; /** what to draw: the same frames with background removal on top */ shown: Pixels[]; cur: number; setArt: (f: (a: Pixels[]) => Pixels[]) => void; setCur: (n: number) => void; palette: Rgb[] }) {
  const { t } = useI18n();
  const frame = art[Math.min(cur, art.length - 1)];
  const { width: W, height: H } = frame;
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#e04040');
  const [brush, setBrush] = useState(1);
  const [sel, setSel] = useState<Rect | null>(null);
  const [onion, setOnion] = useState(true);
  const [cell, setCell] = useState(() => Math.max(1, Math.min(16, Math.floor(360 / Math.max(W, H)))));
  const [, bump] = useState(0);
  const undo = useRef<Snap[]>([]), redo = useRef<Snap[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<null | { kind: 'draw'; work: Pixels; last: { x: number; y: number } } | { kind: 'select'; from: { x: number; y: number } } | { kind: 'move'; from: { x: number; y: number }; lifted: Pixels; cleared: Pixels; rect: Rect }>(null);
  const idx = Math.min(cur, art.length - 1);

  const put = useCallback((i: number, px: Pixels) => setArt(a => a.map((f, k) => k === i ? px : f)), [setArt]);
  const remember = (i: number, px: Pixels) => { undo.current.push({ idx: i, px }); if (undo.current.length > 80) undo.current.shift(); redo.current = []; bump(n => n + 1); };
  const doUndo = useCallback(() => {
    const s = undo.current.pop();
    if (!s) return;
    redo.current.push({ idx: s.idx, px: art[s.idx] });
    put(s.idx, s.px); setCur(s.idx); bump(n => n + 1);
  }, [art, put, setCur]);
  const doRedo = useCallback(() => {
    const s = redo.current.pop();
    if (!s) return;
    undo.current.push({ idx: s.idx, px: art[s.idx] });
    put(s.idx, s.px); setCur(s.idx); bump(n => n + 1);
  }, [art, put, setCur]);

  // the canvas: the previous frame faintly underneath (onion skin), then this frame
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (onion && idx > 0 && shown[idx - 1].width === W) { ctx.globalAlpha = 0.3; ctx.drawImage(asCanvas(shown[idx - 1]), 0, 0); ctx.globalAlpha = 1; }
    ctx.drawImage(asCanvas(shown[idx] ?? frame), 0, 0);
  }, [frame, shown, idx, onion, W, H]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / r.width * W), y: Math.floor((e.clientY - r.top) / r.height * H) };
  };
  const clampPt = (p: { x: number; y: number }) => ({ x: Math.max(0, Math.min(W - 1, p.x)), y: Math.max(0, Math.min(H - 1, p.y)) });
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => {
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x, b.x) - x0 + 1, h: Math.max(a.y, b.y) - y0 + 1 };
  };
  /** A square brush dab (`brush` px), centred on the point, clipped to the picture. */
  const dab = (px: Pixels, p: { x: number; y: number }, rgba: Rgba) => {
    const o = Math.floor((brush - 1) / 2);
    for (let y = p.y - o; y < p.y - o + brush; y++) for (let x = p.x - o; x < p.x - o + brush; x++)
      if (x >= 0 && y >= 0 && x < W && y < H) px.data.set(rgba, (y * W + x) * 4);
  };
  const line = (px: Pixels, a: { x: number; y: number }, b: { x: number; y: number }, rgba: Rgba) => {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let i = 0; i <= n; i++) dab(px, { x: Math.round(a.x + (b.x - a.x) * (n ? i / n : 0)), y: Math.round(a.y + (b.y - a.y) * (n ? i / n : 0)) }, rgba);
  };

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = at(e);
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) { if (tool === 'select') setSel(null); return; }
    if (tool === 'pick') {
      const i = (p.y * W + p.x) * 4;
      if (frame.data[i + 3] > 0) setColor(hex({ r: frame.data[i], g: frame.data[i + 1], b: frame.data[i + 2] }));
      return;
    }
    if (tool === 'fill') {
      const work = cloneData(frame);
      if (floodFill(work, p.x, p.y, toRgba(color))) { remember(idx, frame); put(idx, work); }
      return;
    }
    if (tool === 'pencil' || tool === 'eraser') {
      const work = cloneData(frame);
      remember(idx, frame);
      dab(work, p, tool === 'eraser' ? [0, 0, 0, 0] : toRgba(color));
      drag.current = { kind: 'draw', work, last: p };
      put(idx, { ...work });
      return;
    }
    if (tool === 'select') { drag.current = { kind: 'select', from: p }; setSel({ x: p.x, y: p.y, w: 1, h: 1 }); return; }
    if (tool === 'move') {
      const rect = sel ?? { x: 0, y: 0, w: W, h: H };   // no selection: move the whole picture
      if (!inRect(rect, p.x, p.y) && sel) return;
      const cleared = cloneData(frame); clearRect(cleared, rect);
      remember(idx, frame);
      drag.current = { kind: 'move', from: p, lifted: extract(frame, rect), cleared, rect };
    }
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    if (d.kind === 'draw') {
      const q = clampPt(p);
      line(d.work, d.last, q, tool === 'eraser' ? [0, 0, 0, 0] : toRgba(color));
      d.last = q; put(idx, { ...d.work });
    } else if (d.kind === 'select') setSel(rectOf(d.from, clampPt(p)));
    else {
      const dx = p.x - d.from.x, dy = p.y - d.from.y;
      const next = cloneData(d.cleared);
      blit(next, d.lifted, d.rect.x + dx, d.rect.y + dy);
      put(idx, next);
      setSel({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy });
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'select') setSel(s => (s && s.w === 1 && s.h === 1 ? null : s));   // a plain click clears the selection
  };

  const target = sel ?? { x: 0, y: 0, w: W, h: H };
  const edit = (fn: (px: Pixels) => void) => { const work = cloneData(frame); fn(work); remember(idx, frame); put(idx, work); };
  const flipSel = (horizontal: boolean) => edit(px => { const part = flip(extract(frame, target), horizontal); clearRect(px, target); blit(px, part, target.x, target.y, false); });
  const clearSel = () => edit(px => clearRect(px, target));
  const copyNext = () => {
    if (idx + 1 >= art.length) return;
    remember(idx + 1, art[idx + 1]);
    put(idx + 1, cloneData(frame)); setCur(idx + 1);
  };

  const lastNudge = useRef({ idx: -1, at: 0 });
  const nudge = (dx: number, dy: number) => {
    const lifted = extract(frame, target), moved = cloneData(frame);
    clearRect(moved, target); blit(moved, lifted, target.x + dx, target.y + dy);
    const now = Date.now();
    if (lastNudge.current.idx !== idx || now - lastNudge.current.at > 700) remember(idx, frame);   // one undo step for a burst of key presses
    lastNudge.current = { idx, at: now };
    put(idx, moved);
    if (sel) setSel({ ...sel, x: sel.x + dx, y: sel.y + dy });
  };
  useEffect(() => {   // keyboard: Ctrl+Z / Ctrl+Y / Delete / Esc (not while typing in a field)
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (e.key === 'Delete' && sel) { e.preventDefault(); clearSel(); }
      else if (e.key === 'Escape') setSel(null);
      else if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey) {   // nudge the selection (the whole frame when nothing is selected); Shift = 4 px
        e.preventDefault();
        const n = e.shiftKey ? 4 : 1;
        nudge(e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const swatches = useMemo(() => palette.slice(0, 16), [palette]);
  return (
    <div className="pe">
      <div className="muted small">{t('pxEditHint')}</div>
      <div className="row pe-tools">
        {TOOLS.map(x => <PixelButton key={x.id} scale={1} aria-pressed={tool === x.id} onClick={() => setTool(x.id)}>{t(x.key)}</PixelButton>)}
      </div>
      <div className="row">
        <label className="field px-field">{t('feColor')}<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
        <label className="field px-field">{t('feSize')}: {brush}<NudgeRange min={1} max={8} value={brush} onChange={setBrush} /></label>
      </div>
      {swatches.length > 0 && <div className="px-swatches">{swatches.map((c, i) => <button key={i} type="button" className="px-swatch pe-sw" style={{ background: rgbCss(c) }} aria-label={hex(c)} onClick={() => setColor(hex(c))} />)}</div>}
      <div className="row pe-tools">
        <PixelButton scale={1} disabled={!undo.current.length} onClick={doUndo}>{t('feUndo')}</PixelButton>
        <PixelButton scale={1} disabled={!redo.current.length} onClick={doRedo}>{t('feRedo')}</PixelButton>
        <PixelButton scale={1} onClick={() => flipSel(true)}>{t('feFlipH')}</PixelButton>
        <PixelButton scale={1} onClick={() => flipSel(false)}>{t('feFlipV')}</PixelButton>
        <PixelButton scale={1} onClick={clearSel}>{t('feDelete')}</PixelButton>
        <PixelButton scale={1} disabled={idx + 1 >= art.length} onClick={copyNext}>{t('pxCopyNext')}</PixelButton>
      </div>
      <div className="row">
        <PixelCheckbox checked={onion} onChange={setOnion} label={t('pxOnion')} />
        <PixelButton scale={1} onClick={() => setCell(c => Math.max(1, c - 1))}>-</PixelButton>
        <span className="small">{t('feZoom')} {cell}x</span>
        <PixelButton scale={1} onClick={() => setCell(c => Math.min(32, c + 1))}>+</PixelButton>
      </div>
      <div className="fe-stage">
        <div className="fe-board" style={{ width: W * cell, height: H * cell }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <canvas ref={canvas} aria-label={`${W}x${H}`} style={{ width: W * cell, height: H * cell }} />
          {sel && <span className="fe-sel" style={{ left: sel.x * cell, top: sel.y * cell, width: sel.w * cell, height: sel.h * cell }} />}
        </div>
      </div>
    </div>
  );
}
