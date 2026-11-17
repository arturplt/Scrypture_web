import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n/useT';
import type { Key } from '../i18n';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelCheckbox } from '../ui/misc';
import { FRAME_THEMES } from '../ui/themes';
import { blit, clearRect, cloneData, extract, flip, floodFill, inRect, rectBetween, rotatePixels, scalePixels, type Pixels, type Rect, type Rgba } from '../domain/pixeledit';
import { NameDialog } from '../ui/NameDialog';
import { CAN_ADD_TO_COLLECTION, addToCollection, suggestName } from './frameCollection';
import './pixelite.css';
import { NudgeRange } from '../ui/NudgeRange';

type Tool = 'brush' | 'eraser' | 'fill' | 'picker' | 'select' | 'clone' | 'transform';
/** Transform box: centre, size before rotating, and clockwise angle in radians. */
interface XfBox { cx: number; cy: number; w: number; h: number; ang: number }
type Handle = 'rotate' | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
const TOOLS: { id: Tool; label: Key; key: string }[] = [
  { id: 'brush', label: 'feBrush', key: 'b' }, { id: 'eraser', label: 'feEraser', key: 'e' }, { id: 'fill', label: 'feFill', key: 'g' },
  { id: 'picker', label: 'fePicker', key: 'i' }, { id: 'select', label: 'feSelect', key: 'm' }, { id: 'clone', label: 'feClone', key: 's' }, { id: 'transform', label: 'feTransform', key: 't' },
];
const ZOOMS = [1, 2, 4, 8, 16] as const;
const SLICES = [4, 8, 12, 16] as const;
const UNDO_MAX = 50;
const hex2 = (n: number) => n.toString(16).padStart(2, '0');
interface Float { img: Pixels; x: number; y: number }
type Drag =
  | { kind: 'paint'; last: { x: number; y: number }; shift?: { dx: number; dy: number; base: Pixels } }
  | { kind: 'select'; anchor: { x: number; y: number } }
  | { kind: 'move'; start: { x: number; y: number }; from: { x: number; y: number } };

/** A file chosen on the Pixelite screen, waiting for the editor (route `.../frame/file`) to pick it up. */
let pendingFile: File | null = null;
export const setPendingFrameFile = (f: File | null) => { pendingFile = f; };
const FROM_FILE = 'file';

/**
 * Touch up a frame sprite and see where its 9-slice cuts fall. Brush, eraser, fill, colour picker, rectangle select
 * (drag to move, Ctrl/Alt-drag to copy, Ctrl+C/X/V), clone stamp, flips, undo/redo, PNG export. No scaling tools.
 */
export function FrameEditor({ name }: { name: string }) {
  const { t } = useI18n();
  const known = name === FROM_FILE || Object.prototype.hasOwnProperty.call(FRAME_THEMES, name);
  const fileInput = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(name);
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [naming, setNaming] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<Pixels | null>(null);            // the picture being edited
  const original = useRef<Pixels | null>(null);
  const undo = useRef<Pixels[]>([]);
  const redo = useRef<Pixels[]>([]);
  const float = useRef<Float | null>(null);            // pixels lifted out of the picture, being moved or pasted
  const clip = useRef<Pixels | null>(null);
  const drag = useRef<Drag | null>(null);
  const cloneSrc = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState(0);                 // frame width/height in pixels (0 = not loaded)
  const [zoom, setZoom] = useState(8);
  const [tool, setTool] = useState<Tool>('brush');
  const [hex, setHex] = useState('#ffd700');
  const [alpha, setAlpha] = useState(255);
  const [brush, setBrush] = useState(1);
  const [slice, setSlice] = useState<number>(16);
  const [guides, setGuides] = useState(true);
  const [preview, setPreview] = useState('');
  const [counts, setCounts] = useState({ undo: 0, redo: 0, clip: false });
  const [sel, setSelState] = useState<Rect | null>(null);
  const [src, setSrcState] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);   // pixel under the pointer
  const xf = useRef<{ orig: Pixels } | null>(null);              // Transform: the lifted picture at its original size
  const [xfRect, setXfRect] = useState<XfBox | null>(null);        // Transform: where/how big it is now
  const xdrag = useRef<{ h: Handle; start: { x: number; y: number }; r0: XfBox; a0: number } | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);   // where the previous brush/eraser stroke ended: Shift+click draws a straight line from here
  const [shiftHeld, setShiftHeld] = useState(false);
  const patchRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef<Rect | null>(null);
  const setSel = (r: Rect | null) => { selRef.current = r; setSelState(r); };
  const setSrc = (p: { x: number; y: number } | null) => { cloneSrc.current = p; setSrcState(p); };
  const sync = () => setCounts({ undo: undo.current.length, redo: redo.current.length, clip: !!clip.current });

  const show = useCallback(() => {
    const c = canvasRef.current, d = work.current;
    if (!c || !d) return;
    let out = d;
    if (float.current) { out = cloneData(d); blit(out, float.current.img, float.current.x, float.current.y); }
    c.getContext('2d')!.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  }, []);
  const refreshPreview = useCallback(() => { const c = canvasRef.current; if (c && work.current) setPreview(c.toDataURL('image/png')); }, []);

  /** Put a floating selection down for good. */
  const commit = () => {
    if (xf.current) { xf.current = null; setXfRect(null); }
    const f = float.current;
    if (!f || !work.current) return;
    blit(work.current, f.img, f.x, f.y);
    float.current = null;
  };
  const pushUndo = () => {
    undo.current.push(cloneData(work.current!));
    if (undo.current.length > UNDO_MAX) undo.current.shift();
    redo.current = [];
    sync();
  };
  const finish = () => { show(); refreshPreview(); };

  /** Make a picture the one being edited. Frames are square, so anything else is refused. */
  const loadUrl = useCallback((url: string, title: string, revoke: boolean) => {
    const img = new Image();
    img.onload = () => {
      if (revoke) URL.revokeObjectURL(url);
      if (img.naturalWidth !== img.naturalHeight) { setMsg('feNotSquare'); return; }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      original.current = cloneData(d);
      work.current = cloneData(d);
      undo.current = []; redo.current = []; float.current = null; sync();
      setSel(null); setMsg(''); setFailed(false); setLabel(title);
      setSize(d.width);
      if (canvasRef.current && canvasRef.current.width === d.width) { show(); refreshPreview(); }   // same size as before: the size effect won't re-run
    };
    img.onerror = () => { if (revoke) URL.revokeObjectURL(url); if (work.current) setMsg('feLoadFailed'); else setFailed(true); };
    img.src = url;
  }, [show, refreshPreview]);
  const openFile = useCallback((f: File) => loadUrl(URL.createObjectURL(f), f.name.replace(/\.[^/.]+$/, '') || 'frame', true), [loadUrl]);

  useEffect(() => {
    if (!known) return;
    if (name === FROM_FILE) { const f = pendingFile; pendingFile = null; if (f) openFile(f); return; }
    loadUrl(`/assets/frames/${name}.png`, name, false);
  }, [name, known, loadUrl, openFile]);

  useEffect(() => {   // after the canvas has its size
    if (!size) return;
    const c = canvasRef.current!;
    c.width = size; c.height = size;
    show(); refreshPreview();
  }, [size, show, refreshPreview]);

  const color = (): Rgba => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];
  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / r.width * size), y: Math.floor((e.clientY - r.top) / r.height * size) };
  };
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < size && p.y < size;

  /** Paint one brush-sized dot. `kind` brush = colour, eraser = clear, clone = copy from the stroke's base picture. */
  const stamp = (cx: number, cy: number, kind: 'brush' | 'eraser' | 'clone', shift?: { dx: number; dy: number; base: Pixels }) => {
    const d = work.current!, c = kind === 'eraser' ? ([0, 0, 0, 0] as Rgba) : color(), from = -Math.floor((brush - 1) / 2);
    for (let dy = 0; dy < brush; dy++) for (let dx = 0; dx < brush; dx++) {
      const x = cx + from + dx, y = cy + from + dy;
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) continue;
      const i = (y * d.width + x) * 4;
      if (kind === 'clone' && shift) {
        const sx = x - shift.dx, sy = y - shift.dy;
        if (sx < 0 || sy < 0 || sx >= d.width || sy >= d.height) continue;
        d.data.set(shift.base.data.subarray((sy * d.width + sx) * 4, (sy * d.width + sx) * 4 + 4), i);
      } else d.data.set(c, i);
    }
  };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, kind: 'brush' | 'eraser' | 'clone', shift?: { dx: number; dy: number; base: Pixels }) => {   // no gaps when the pointer moves fast
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let k = 0; k <= n; k++) stamp(Math.round(a.x + (b.x - a.x) * k / n), Math.round(a.y + (b.y - a.y) * k / n), kind, shift);
  };

  // ---- selection actions (shared by the buttons and the keyboard) ----
  const lift = (copy: boolean) => {
    const s = selRef.current;
    if (!s || float.current || !work.current) return;
    pushUndo();
    float.current = { img: extract(work.current, s), x: s.x, y: s.y };
    if (!copy) clearRect(work.current, s);
  };
  const doCopy = () => {
    const s = selRef.current;
    const img = float.current ? float.current.img : s && work.current ? extract(work.current, s) : null;
    if (!img) return;
    clip.current = cloneData(img); sync();
  };
  const doDelete = () => {
    const s = selRef.current;
    if (!s || !work.current) return;
    if (float.current) float.current = null;          // already lifted: dropping it deletes it
    else { pushUndo(); clearRect(work.current, s); }
    setSel(null); finish();
  };
  const doCut = () => { doCopy(); doDelete(); };
  const doPaste = () => {
    if (!clip.current || !work.current) return;
    commit();
    pushUndo();
    const s = selRef.current, x = s ? Math.min(s.x + 2, size - 1) : 0, y = s ? Math.min(s.y + 2, size - 1) : 0;
    float.current = { img: cloneData(clip.current), x, y };
    setSel({ x, y, w: clip.current.width, h: clip.current.height });
    setTool('select'); finish();
  };
  const doSelectAll = () => { commit(); setSel({ x: 0, y: 0, w: size, h: size }); setTool('select'); finish(); };
  const doFlip = (horizontal: boolean) => {
    if (!work.current) return;
    const s = selRef.current;
    if (float.current) float.current = { ...float.current, img: flip(float.current.img, horizontal) };
    else {
      pushUndo();
      const r = s ?? { x: 0, y: 0, w: size, h: size };
      blit(work.current, flip(extract(work.current, r), horizontal), r.x, r.y, false);
    }
    finish();
  };
  const doUndo = () => {
    commit();
    const prev = undo.current.pop();
    if (!prev || !work.current) return;
    redo.current.push(cloneData(work.current));
    work.current = prev; setSel(null); sync(); finish();
  };
  const doRedo = () => {
    commit();
    const next = redo.current.pop();
    if (!next || !work.current) return;
    undo.current.push(cloneData(work.current));
    work.current = next; setSel(null); sync(); finish();
  };
  const doReset = () => {
    commit();
    if (!original.current || !work.current) return;
    pushUndo();
    work.current = cloneData(original.current); setSel(null); finish();
  };
  const deselect = () => { commit(); setSel(null); finish(); };

  // ---- transform (the T key or the Transform tool): scale, rotate and move the selection, or the whole picture ----
  const atF = (e: { clientX: number; clientY: number }) => {   // pointer in picture pixels, not rounded
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * size, y: (e.clientY - r.top) / r.height * size };
  };
  const beginTransform = () => {
    if (!work.current) return;
    if (!xf.current) {
      if (!float.current) {
        if (!selRef.current) setSel({ x: 0, y: 0, w: size, h: size });
        lift(false);
      }
      const f = float.current;
      if (!f) return;
      xf.current = { orig: cloneData(f.img) };
      setXfRect({ cx: f.x + f.img.width / 2, cy: f.y + f.img.height / 2, w: f.img.width, h: f.img.height, ang: 0 });
    }
    setTool('transform'); show();
  };
  const applyXf = (b: XfBox) => {
    if (!xf.current || !float.current) return;
    const img = rotatePixels(scalePixels(xf.current.orig, b.w, b.h), b.ang);
    const x = Math.round(b.cx - img.width / 2), y = Math.round(b.cy - img.height / 2);
    float.current = { img, x, y };
    setXfRect(b); setSel({ x, y, w: img.width, h: img.height }); show();
  };
  const cancelTransform = () => {
    if (!xf.current) return;
    xf.current = null; float.current = null; setXfRect(null); setSel(null);
    const prev = undo.current.pop();
    if (prev) work.current = prev;
    sync(); setTool('select'); finish();
  };
  const xDown = (h: Handle) => (e: ReactPointerEvent) => {
    if (!xfRect) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = atF(e);
    xdrag.current = { h, start: p, r0: xfRect, a0: Math.atan2(p.y - xfRect.cy, p.x - xfRect.cx) };
  };
  const xMove = (e: ReactPointerEvent) => {
    const d = xdrag.current;
    if (!d) return;
    const p = atF(e), r0 = d.r0, dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (d.h === 'move') { applyXf({ ...r0, cx: r0.cx + Math.round(dx), cy: r0.cy + Math.round(dy) }); return; }
    if (d.h === 'rotate') {
      let ang = r0.ang + Math.atan2(p.y - r0.cy, p.x - r0.cx) - d.a0;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);   // 15 degree steps
      applyXf({ ...r0, ang }); return;
    }
    // resize in the box's own (rotated) axes, keeping the opposite edge or corner where it is
    const c = Math.cos(r0.ang), s = Math.sin(r0.ang);
    const lx = c * dx + s * dy, ly = -s * dx + c * dy;
    const sx = d.h.includes('e') ? 1 : d.h.includes('w') ? -1 : 0, sy = d.h.includes('s') ? 1 : d.h.includes('n') ? -1 : 0;
    let w = Math.max(1, Math.round(r0.w + sx * lx)), h = Math.max(1, Math.round(r0.h + sy * ly));
    if (!sx) w = r0.w;
    if (!sy) h = r0.h;
    if (e.shiftKey && sx && sy) { const k = Math.max(w / r0.w, h / r0.h); w = Math.max(1, Math.round(r0.w * k)); h = Math.max(1, Math.round(r0.h * k)); }
    const cap = size * 4;
    w = Math.min(cap, w); h = Math.min(cap, h);
    const ax = r0.cx + c * (-sx * r0.w / 2) - s * (-sy * r0.h / 2), ay = r0.cy + s * (-sx * r0.w / 2) + c * (-sy * r0.h / 2);   // the fixed point
    applyXf({ ...r0, w, h, cx: ax + c * (sx * w / 2) - s * (sy * h / 2), cy: ay + s * (sx * w / 2) + c * (sy * h / 2) });
  };
  const xUp = () => { xdrag.current = null; };
  const turn = (deg: number) => { if (xfRect) applyXf({ ...xfRect, ang: deg * Math.PI / 180 }); };
  const degrees = xfRect ? Math.round(xfRect.ang * 180 / Math.PI) : 0;

  // ---- pointer ----
  const down = (e: ReactPointerEvent) => {
    const d = work.current;
    if (!d) return;
    const p = at(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (tool === 'transform') { commit(); setSel(null); setTool('select'); finish(); return; }   // a click outside puts it down
    if (tool === 'select') {
      const s = selRef.current;
      if (s && inside(p) && inRect(s, p.x, p.y)) {
        lift(e.ctrlKey || e.metaKey || e.altKey);   // Ctrl / Alt while starting the drag = move a copy
        drag.current = { kind: 'move', start: p, from: { x: float.current!.x, y: float.current!.y } };
      } else { commit(); setSel(null); drag.current = { kind: 'select', anchor: p }; finish(); }
      return;
    }
    if (!inside(p)) return;
    commit(); setSel(null);
    if (tool === 'picker' || (e.altKey && (tool === 'brush' || tool === 'eraser' || tool === 'fill'))) {   // Alt+click = colour picker, tool stays
      const i = (p.y * d.width + p.x) * 4;
      setHex(`#${hex2(d.data[i])}${hex2(d.data[i + 1])}${hex2(d.data[i + 2])}`); setAlpha(d.data[i + 3]);
      if (tool === 'picker') setTool('brush');
      return;
    }
    if (tool === 'fill') {
      const before = cloneData(d);
      if (floodFill(d, p.x, p.y, color())) { undo.current.push(before); if (undo.current.length > UNDO_MAX) undo.current.shift(); redo.current = []; sync(); finish(); }
      return;
    }
    if (tool === 'clone' && (e.altKey || e.shiftKey || !cloneSrc.current)) { setSrc(p); return; }   // set the source to copy from
    pushUndo();
    if (tool === 'clone') {
      const s = cloneSrc.current!;
      const shift = { dx: p.x - s.x, dy: p.y - s.y, base: cloneData(d) };
      drag.current = { kind: 'paint', last: p, shift };
      stamp(p.x, p.y, 'clone', shift);
    } else {
      drag.current = { kind: 'paint', last: p };
      if (e.shiftKey && lastPt.current) line(lastPt.current, p, tool === 'eraser' ? 'eraser' : 'brush');   // straight line from the last point
      else stamp(p.x, p.y, tool);
      lastPt.current = p;
    }
    show();
  };
  const move = (e: ReactPointerEvent) => {
    const p = at(e);
    setShiftHeld(e.shiftKey);
    setHover(h => (h && h.x === p.x && h.y === p.y ? h : p));
    const dr = drag.current;
    if (!dr) return;
    if (dr.kind === 'paint') { line(dr.last, p, tool === 'clone' ? 'clone' : tool === 'eraser' ? 'eraser' : 'brush', dr.shift); dr.last = p; if (tool !== 'clone') lastPt.current = p; show(); }
    else if (dr.kind === 'select') setSel(rectBetween(dr.anchor, p, size));
    else if (float.current) {
      const f = float.current;
      f.x = dr.from.x + p.x - dr.start.x; f.y = dr.from.y + p.y - dr.start.y;
      setSel({ x: f.x, y: f.y, w: f.img.width, h: f.img.height }); show();
    }
  };
  const up = () => { if (drag.current) { drag.current = null; refreshPreview(); } };

  // ---- keyboard ----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = e => {
    const t0 = e.target as HTMLElement | null;
    if (t0 && /^(INPUT|TEXTAREA|SELECT)$/.test(t0.tagName)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const run = (fn: () => void) => { e.preventDefault(); fn(); };
    if (mod && k === 'z') run(e.shiftKey ? doRedo : doUndo);
    else if (mod && k === 'y') run(doRedo);
    else if (mod && k === 'c') run(doCopy);
    else if (mod && k === 'x') run(doCut);
    else if (mod && k === 'v') run(doPaste);
    else if (mod && k === 'a') run(doSelectAll);
    else if (!mod && (k === 'delete' || k === 'backspace')) run(doDelete);
    else if (!mod && k === 'escape' && xf.current) run(cancelTransform);
    else if (!mod && (k === 'escape' || k === 'enter')) run(() => { deselect(); if (tool === 'transform') setTool('select'); });
    else if (!mod && !e.altKey) { const tl = TOOLS.find(x => x.key === k); if (tl) { if (tl.id === 'transform') beginTransform(); else { commit(); setTool(tl.id); } } }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const addCollection = () => { commit(); show(); setNaming(true); };   // put a floating selection down first, then ask for the name
  const submitName = async (name: string) => {
    setNaming(false);
    const c = canvasRef.current;
    if (!c) return;
    const r = await addToCollection(c, name);
    setNote('error' in r ? t(r.error) : t('feAdded', { name: r.name }));
  };
  const exportPng = () => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = `${label}-edited.png`; a.click();
  };

  const px = size * zoom;
  // where the brush lands, and (clone) where it copies from: the source follows the pointer once a stroke has started
  const painting = tool === 'brush' || tool === 'eraser' || tool === 'clone';
  const reach = -Math.floor((brush - 1) / 2);
  const stroke = drag.current?.kind === 'paint' ? drag.current.shift : undefined;
  const cloneFrom = tool === 'clone' && hover && src ? (stroke ? { x: hover.x - stroke.dx, y: hover.y - stroke.dy } : src) : null;
  const cloneKey = cloneFrom ? `${cloneFrom.x},${cloneFrom.y}` : '';
  useEffect(() => {   // clone preview: the patch that a click here would paint
    const c = patchRef.current, d = work.current;
    if (!c || !d || !cloneFrom) return;
    c.width = brush; c.height = brush;
    const base = drag.current?.kind === 'paint' && drag.current.shift ? drag.current.shift.base : d;
    const out = new ImageData(brush, brush);
    for (let y = 0; y < brush; y++) for (let x = 0; x < brush; x++) {
      const sx = cloneFrom.x + reach + x, sy = cloneFrom.y + reach + y;
      if (sx < 0 || sy < 0 || sx >= base.width || sy >= base.height) continue;
      out.data.set(base.data.subarray((sy * base.width + sx) * 4, (sy * base.width + sx) * 4 + 4), (y * brush + x) * 4);
    }
    c.getContext('2d')!.putImageData(out, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloneKey, brush, hover, counts]);
  const hint = tool === 'transform' ? t('feTransformHint') : tool === 'select' ? t('feSelectHint') : tool === 'clone' ? t('feCloneHint') : '';
  const hasSel = !!sel;
  return (
    <div className="screen px fe">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/apps/pixelite')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('feTitle')}</h1>
      {!known || failed ? <div role="alert">{t('feMissing')}</div> : <>
        <div className="muted small">{t('feHint')} ({label.replace(/_/g, ' ')})</div>
        <PixelFrame theme="app" scale={1} className="card">
          <div className="row fe-tools">
            {TOOLS.map(x => <PixelButton key={x.id} scale={1} aria-pressed={tool === x.id} onClick={() => { if (x.id === 'transform') beginTransform(); else { commit(); setTool(x.id); finish(); } }}>{t(x.label)}</PixelButton>)}
          </div>
          <div className="row fe-tools">
            <PixelButton scale={1} disabled={!counts.undo} onClick={doUndo}>{t('feUndo')}</PixelButton>
            <PixelButton scale={1} disabled={!counts.redo} onClick={doRedo}>{t('feRedo')}</PixelButton>
            <PixelButton scale={1} onClick={() => doFlip(true)}>{t('feFlipH')}</PixelButton>
            <PixelButton scale={1} onClick={() => doFlip(false)}>{t('feFlipV')}</PixelButton>
          </div>
          <div className="row fe-tools">
            <PixelButton scale={1} onClick={doSelectAll}>{t('feSelectAll')}</PixelButton>
            <PixelButton scale={1} disabled={!hasSel} onClick={doCopy}>{t('feCopy')}</PixelButton>
            <PixelButton scale={1} disabled={!hasSel} onClick={doCut}>{t('feCut')}</PixelButton>
            <PixelButton scale={1} disabled={!counts.clip} onClick={doPaste}>{t('fePaste')}</PixelButton>
            <PixelButton scale={1} disabled={!hasSel} onClick={doDelete}>{t('feDelete')}</PixelButton>
          </div>
          {hint && <div className="muted small" role="note">{hint}</div>}
          <div className="fe-stage">
            <div className="fe-board" style={{ width: px, height: px }}>
              <canvas ref={canvasRef} aria-label={name} style={{ width: px, height: px, cursor: tool === 'picker' ? 'copy' : tool === 'select' ? 'cell' : 'crosshair' }}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)} />
              {guides && size > 0 && [slice, size - slice].flatMap(p => [
                <span key={`v${p}`} className="fe-line fe-v" style={{ left: p * zoom }} />,
                <span key={`h${p}`} className="fe-line fe-h" style={{ top: p * zoom }} />,
              ])}
              {xfRect && (
                <div className="fe-xf" style={{ left: (xfRect.cx - xfRect.w / 2) * zoom, top: (xfRect.cy - xfRect.h / 2) * zoom, width: xfRect.w * zoom, height: xfRect.h * zoom, transform: `rotate(${xfRect.ang}rad)` }}
                  onPointerDown={xDown('move')} onPointerMove={xMove} onPointerUp={xUp} onPointerCancel={xUp}>
                  {HANDLES.map(h => {
                    const hs = 10, W = xfRect.w * zoom, H = xfRect.h * zoom;
                    const left = h.includes('w') ? 0 : h.includes('e') ? W - hs : (W - hs) / 2, top = h.includes('n') ? 0 : h.includes('s') ? H - hs : (H - hs) / 2;
                    return <span key={h} className={`fe-handle fe-h-${h}`} style={{ left, top, width: hs, height: hs }}
                      onPointerDown={xDown(h)} onPointerMove={xMove} onPointerUp={xUp} onPointerCancel={xUp} />;
                  })}
                  <span className="fe-handle fe-h-rotate" title={t('feRotate')} style={{ left: (xfRect.w * zoom - 12) / 2, top: 14, width: 12, height: 12 }}
                    onPointerDown={xDown('rotate')} onPointerMove={xMove} onPointerUp={xUp} onPointerCancel={xUp} />
                </div>
              )}
              {sel && !xfRect && <span className="fe-sel" style={{ left: sel.x * zoom, top: sel.y * zoom, width: sel.w * zoom, height: sel.h * zoom }} />}
              {painting && hover && <>
                {tool === 'clone' && cloneFrom && <canvas ref={patchRef} className="fe-patch" style={{ left: (hover.x + reach) * zoom, top: (hover.y + reach) * zoom, width: brush * zoom, height: brush * zoom }} />}
                <span className="fe-brush" style={{ left: (hover.x + reach) * zoom, top: (hover.y + reach) * zoom, width: brush * zoom, height: brush * zoom }} />
              </>}
              {shiftHeld && hover && lastPt.current && (tool === 'brush' || tool === 'eraser') && !drag.current && (
                <svg className="fe-ruler" width={px} height={px}><line x1={(lastPt.current.x + .5) * zoom} y1={(lastPt.current.y + .5) * zoom} x2={(hover.x + .5) * zoom} y2={(hover.y + .5) * zoom} /></svg>
              )}
              {cloneFrom && <span className="fe-brush fe-srcbox" style={{ left: (cloneFrom.x + reach) * zoom, top: (cloneFrom.y + reach) * zoom, width: brush * zoom, height: brush * zoom }} />}
              {tool === 'clone' && src && <span className="fe-src" style={{ left: (src.x + .5) * zoom, top: (src.y + .5) * zoom }} />}
            </div>
          </div>
          {xfRect && <div className="row fe-tools">
            <label className="field px-field">{t('feRotate')}: {degrees}°<NudgeRange min={-180} max={180} value={degrees} onChange={turn} /></label>
            <PixelButton scale={1} onClick={() => turn(degrees - 90 < -180 ? degrees + 270 : degrees - 90)}>-90°</PixelButton>
            <PixelButton scale={1} onClick={() => turn(degrees + 90 > 180 ? degrees - 270 : degrees + 90)}>+90°</PixelButton>
            <PixelButton scale={1} onClick={() => turn(0)}>0°</PixelButton>
          </div>}
          <div className="row fe-tools">
            <span className="small">{t('feZoom')}</span>
            {ZOOMS.map(z => <PixelButton key={z} scale={1} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z}x</PixelButton>)}
          </div>
        </PixelFrame>

        <PixelFrame theme="app" scale={1} className="card">
          <label className="field">{t('feColor')}: {hex}<input type="color" value={hex} onChange={e => setHex(e.target.value)} /></label>
          <label className="field px-field">{t('feAlpha')}: {alpha}<NudgeRange min={0} max={255} value={alpha} onChange={setAlpha} /></label>
          <label className="field px-field">{t('feSize')}: {brush}<NudgeRange min={1} max={8} value={brush} onChange={setBrush} /></label>
        </PixelFrame>

        <PixelFrame theme="app" scale={1} className="card">
          <PixelCheckbox checked={guides} onChange={setGuides} label={t('feGuides')} />
          <div className="row">
            <span className="small">{t('feSlice')}</span>
            {SLICES.map(s => <PixelButton key={s} scale={1} aria-pressed={slice === s} onClick={() => setSlice(s)}>{s}</PixelButton>)}
          </div>
          <div className="muted small">{t('fePreview')}</div>
          {preview && <div className="fe-box" style={{ border: `${slice * 2}px solid transparent`, borderImage: `url(${preview}) ${slice} fill / ${slice * 2}px / 0 stretch` }} />}
          <div className="row">
            <PixelButton scale={1} onClick={() => fileInput.current?.click()}>{t('feOpenFile')}</PixelButton>
            <PixelButton scale={1} disabled={!size} onClick={exportPng}>{t('feExport')}</PixelButton>
            {CAN_ADD_TO_COLLECTION && <PixelButton scale={1} disabled={!size} onClick={addCollection}>{t('feAddCollection')}</PixelButton>}
            <PixelButton scale={1} variant="red" disabled={!size} onClick={doReset}>{t('feReset')}</PixelButton>
          </div>
          {msg && <div role="alert" className="small">{t(msg as Key)}</div>}
          {note && <div role="status" className="small">{note}</div>}
          <NameDialog open={naming} title={t('feAddName')} initial={suggestName(label)} okLabel={t('feAddCollection')} cancelLabel={t('cancel')} onSubmit={submitName} onClose={() => setNaming(false)} />
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        </PixelFrame>
      </>}
    </div>
  );
}
