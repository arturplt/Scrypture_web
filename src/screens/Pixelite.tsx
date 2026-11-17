import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelCheckbox } from '../ui/misc';
import { setPendingFrameFile } from './FrameEditor';
import { FRAME_THEMES } from '../ui/themes';
import {
  MAX_GRID, MAX_OUTPUT, OUTPUT_SIZES, ZOOM_MAX, ZOOM_MIN, clampOutput, detectGridSize, detectOutputSize, exportName, extractPalette,
  outputDims, rgbCss, sampleGrid, shadeWithPalette, snapOutput, defaultCuts, detectContentBounds, sliceFrame, type Bounds, type OutputSize, type Rgb,
  SAMPLE_MODES, alphaCleanup, cleanStray, medianDenoise, sharpen, type SampleMode,
  EXPORT_FORMATS, EXPORT_MIME, borderColor, frameFileNames, exportFileName, removeBackground, sheetFrames, type ExportFormat,
} from '../domain/pixelite';
import { makeZip } from '../domain/zip';
import { DEFAULT_DELAY, MIN_DELAY, decodeGif, encodeGif, isGif, type GifFrame } from '../domain/gif';
import { NudgeRange } from '../ui/NudgeRange';
import { PixelEditor } from './PixelEditor';
import type { Pixels } from '../domain/pixeledit';
import { NameDialog } from '../ui/NameDialog';
import { setNavPreview } from '../ui/navPreview';
import { CAN_ADD_TO_COLLECTION, addToCollection, suggestName } from './frameCollection';
import './pixelite.css';

const SPARE = 1;   // transparent ring around a 9-slice frame (50x50 output = 48x48 frame)
type LineKey = `${'crop' | 'cut'}.${'l' | 't' | 'r' | 'b'}`;
interface Loaded { name: string; width: number; height: number; data: Uint8ClampedArray; frames: GifFrame[] }
const CANVASES = ['checker', 'white', 'black', 'grey'] as const;
type Canvas = (typeof CANVASES)[number];
const loadCanvas = (): Canvas => { try { const v = localStorage.getItem('pixelite:canvas'); return (CANVASES as readonly string[]).includes(v ?? '') ? (v as Canvas) : 'checker'; } catch { return 'checker'; } };
const hex = (c: Rgb) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
const unhex = (s: string): Rgb => ({ r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) });

/** Pixelite: load a picture, lay a grid over it, and every grid cell becomes one pixel of the output. */
export function Pixelite() {
  const { t } = useI18n();
  const [img, setImg] = useState<Loaded | null>(null);
  const [palette, setPalette] = useState<Rgb[]>([]);
  const [grid, setGrid] = useState(8);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [coords, setCoords] = useState(true);
  const [dragOffset, setDragOffset] = useState(false);
  const [shading, setShading] = useState(0);
  const [sampleMode, setSampleMode] = useState<SampleMode>('average');
  const [alphaCut, setAlphaCut] = useState(0);
  const [denoise, setDenoise] = useState(false);
  const [sharpenAmt, setSharpenAmt] = useState(0);
  const [stray, setStray] = useState(false);
  const [live, setLive] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<OutputSize>('64x64');
  const [custom, setCustom] = useState({ w: 64, h: 64 });
  const [scale, setScale] = useState<1 | 2 | 4>(2);
  const [canvasBg, setCanvasBg] = useState<Canvas>(loadCanvas);
  useEffect(() => {   // CSS picks the backdrop up from <html>, so the bottom bar and the editor follow too
    const root = document.documentElement;
    if (canvasBg === 'checker') delete root.dataset.pxBg; else root.dataset.pxBg = canvasBg;
    try { localStorage.setItem('pixelite:canvas', canvasBg); } catch { /* private mode: just not remembered */ }
    return () => { delete root.dataset.pxBg; };
  }, [canvasBg]);
  const [msg, setMsg] = useState('');
  const [sliceMode, setSliceMode] = useState(false);
  const [crop, setCrop] = useState<Bounds>({ l: 0, t: 0, r: 1, b: 1 });
  const [cuts, setCuts] = useState<Bounds>({ l: 0, t: 0, r: 1, b: 1 });
  const [art, setArt] = useState<Pixels[] | null>(null);   // set while editing frames by hand: the finished frames, one per timeline frame
  const [cur, setCur] = useState(0);              // the frame on screen
  const [playing, setPlaying] = useState(false);
  const [fmt, setFmt] = useState<ExportFormat>('png');
  const [bgOn, setBgOn] = useState(false);          // remove background
  const [bgKey, setBgKey] = useState<Rgb | null>(null);   // null: the picture's border colour
  const [bgTol, setBgTol] = useState(10);
  const [bgEdge, setBgEdge] = useState(true);       // only background touching the edge
  const [pickBg, setPickBg] = useState(false);
  const [corner, setCorner] = useState(16);   // the app cuts frames at 16 ("Normal" corner size)
  const lineDrag = useRef<LineKey | null>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const prevRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const frameFileRef = useRef<HTMLInputElement>(null);

  const outSrc = useMemo(() => outputDims(size, custom.w, custom.h, img ? snapOutput(img.width, img.height, grid, offset.x, offset.y) : undefined), [size, custom, img, grid, offset]);
  const out = art ? { width: art[0].width, height: art[0].height } : outSrc;

  const start = useCallback((name: string, width: number, height: number, frames: GifFrame[]) => {
    const data = frames[0].data;
    setImg({ name, width, height, data, frames });
    setPalette(extractPalette(data));
    setGrid(detectGridSize(width, height));
    setSize(detectOutputSize(width, height));
    const cb = detectContentBounds(data, width, height);
    setCrop(cb); setCuts(defaultCuts(cb));
    setOffset({ x: 0, y: 0 }); setShading(0); setSampleMode('average'); setAlphaCut(0); setDenoise(false); setSharpenAmt(0); setStray(false); setZoom(1); setPan({ x: 0, y: 0 }); setMsg('');
    setCur(0); setPlaying(false); setBgKey(null); setPickBg(false); setArt(null);
  }, []);
  const load = useCallback(async (file: File) => {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (isGif(buf)) { const g = decodeGif(buf); start(file.name, g.width, g.height, g.frames); return; }
    } catch { setMsg(t('pxLoadFailed')); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const c = document.createElement('canvas');
      c.width = image.naturalWidth; c.height = image.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      URL.revokeObjectURL(url);
      start(file.name, c.width, c.height, [{ data, delay: DEFAULT_DELAY }]);
    };
    image.onerror = () => { URL.revokeObjectURL(url); setMsg(t('pxLoadFailed')); };
    image.src = url;
  }, [t, start]);

  const [picking, setPicking] = useState(false);
  /** The source frames after denoise and sharpen (they work on the full-size picture, so keep the result until those settings change). */
  const prepared = useMemo(() => !img ? [] : img.frames.map(f => {
    let d: Uint8ClampedArray = f.data;
    if (denoise) d = medianDenoise(d, img.width, img.height);
    if (sharpenAmt > 0) d = sharpen(d, img.width, img.height, sharpenAmt);
    return d;
  }), [img, denoise, sharpenAmt]);
  const bgColor = useMemo(() => bgKey ?? (img ? borderColor(img.data, img.width, img.height) : null), [bgKey, img]);
  /** One frame of the finished pixel art at its real size. */
  const renderFrame = useCallback((n: number, bake = false): ImageData | null => {
    if (!img) return null;
    let d: ImageData;
    if (art && !bake) { const f = art[Math.min(n, art.length - 1)]; d = new ImageData(new Uint8ClampedArray(f.data), f.width, f.height); }
    else {
      const k = Math.min(n, img.frames.length - 1), src = prepared[k];
      if (sliceMode) d = new ImageData(sliceFrame(img.frames[k].data, img.width, crop, cuts, out.width, out.height, SPARE, corner), out.width, out.height);
      else {
        const px = sampleGrid(src, img.width, img.height, grid, offset.x, offset.y, out.width, out.height, sampleMode);
        alphaCleanup(px, alphaCut);
        shadeWithPalette(px, palette, shading);
        if (stray) cleanStray(px, out.width, out.height);
        d = new ImageData(px, out.width, out.height);
      }
    }
    if (bgOn && bgColor && !bake) removeBackground(d.data, d.width, d.height, bgColor, bgTol, bgEdge);   // on top of hand edits too, so it can be switched off again
    return d;
  }, [img, art, prepared, grid, offset, out, palette, shading, sampleMode, alphaCut, stray, sliceMode, crop, cuts, corner, bgOn, bgColor, bgTol, bgEdge]);
  const render = useCallback(() => renderFrame(cur), [renderFrame, cur]);

  // the big picture with its grid
  useEffect(() => {
    const c = mainRef.current;
    if (!c || !img) return;
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    const shownSrc = (live ? prepared[Math.min(cur, prepared.length - 1)] : img.frames[Math.min(cur, img.frames.length - 1)].data) as Uint8ClampedArray<ArrayBuffer>;
    if (bgOn && bgColor && !sliceMode) {   // show the background removal here too (at full size), so you can judge it where you edit
      const copy = new ImageData(new Uint8ClampedArray(shownSrc), img.width, img.height);
      removeBackground(copy.data, img.width, img.height, bgColor, bgTol, bgEdge);
      ctx.putImageData(copy, 0, 0);
    } else ctx.putImageData(new ImageData(shownSrc, img.width, img.height), 0, 0);
    if (live && shading > 0) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      shadeWithPalette(d.data, palette, shading);
      ctx.putImageData(d, 0, 0);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, Math.round(1 / zoom));
    ctx.font = `${Math.max(8, Math.round(12 / zoom))}px monospace`;
    const mod = (n: number) => ((n % grid) + grid) % grid;
    ctx.beginPath();
    if (!sliceMode && grid * zoom >= 4) {   // 1-pixel cells would just cover the picture in white
    for (let x = mod(offset.x); x <= img.width; x += grid) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, img.height); }
    for (let y = mod(offset.y); y <= img.height; y += grid) { ctx.moveTo(0, y + .5); ctx.lineTo(img.width, y + .5); }
    }
    ctx.stroke();
    if (sliceMode) {   // crop box (cyan) and the four cut lines (yellow)
      const lw = Math.max(1, Math.round(2 / zoom));
      ctx.lineWidth = lw;
      const line = (x0: number, y0: number, x1: number, y1: number, col: string) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
      for (const x of [crop.l, crop.r]) line(x, crop.t, x, crop.b, '#0ff');
      for (const y of [crop.t, crop.b]) line(crop.l, y, crop.r, y, '#0ff');
      for (const x of [cuts.l, cuts.r]) line(x, crop.t, x, crop.b, '#ff0');
      for (const y of [cuts.t, cuts.b]) line(crop.l, y, crop.r, y, '#ff0');
    }
    if (!sliceMode && coords && grid * zoom >= 14) {   // numbers only when the cells are big enough to hold them
      for (let x = mod(offset.x); x < img.width; x += grid) ctx.fillText(String(Math.round((x - offset.x) / grid)), x + 2, 12 / zoom + 2);
      for (let y = mod(offset.y); y < img.height; y += grid) ctx.fillText(String(Math.round((y - offset.y) / grid)), 2, y + 12 / zoom + 2);
    }
  }, [img, prepared, cur, grid, offset, coords, live, shading, palette, zoom, sliceMode, crop, cuts, bgOn, bgColor, bgTol, bgEdge]);

  // the result
  useEffect(() => {
    const c = prevRef.current, d = render();
    if (!c || !d) return;
    const tmp = document.createElement('canvas');
    tmp.width = d.width; tmp.height = d.height;
    tmp.getContext('2d')!.putImageData(d, 0, 0);
    c.width = d.width * scale; c.height = d.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, c.width, c.height);
    setNavPreview(tmp.toDataURL('image/png'), d.height * scale);   // the same result, kept in view in the navigation bar
  }, [render, scale]);
  useEffect(() => { if (!img) setNavPreview(null); return () => setNavPreview(null); }, [img]);

  const count = img?.frames.length ?? 1;
  useEffect(() => {   // play the timeline
    if (!playing || !img || count < 2) return;
    const id = setTimeout(() => setCur(c => (c + 1) % count), img.frames[Math.min(cur, count - 1)].delay);
    return () => clearTimeout(id);
  }, [playing, cur, count, img]);
  const editing = !!art;
  useEffect(() => {   // keyboard: Space plays / pauses, Left and Right pick the frame (not while a field has the keys)
    if (!img || count < 2) return;
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat) setPlaying(p => !p); }
      else if (e.key === ',' || e.key === '.' || (!editing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {   // while editing the arrows belong to the editor (they move the selection)
        e.preventDefault(); setPlaying(false);
        const fwd = e.key === '.' || e.key === 'ArrowRight';
        setCur(c => (c + (fwd ? 1 : count - 1)) % count);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && !typing(e)) e.preventDefault(); };   // stops a focused button also "clicking" on release
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [img, count, editing]);
  const setDelay = (n: number, ms: number, all = false) => setImg(i => i && ({ ...i, frames: i.frames.map((f, k) => all || k === n ? { ...f, delay: ms } : f) }));
  const removeFrame = (n: number) => {
    if (!img || count < 2) return;
    setImg({ ...img, frames: img.frames.filter((_, k) => k !== n) });
    setArt(a => a && a.filter((_, k) => k !== n));
    setCur(c => Math.max(0, Math.min(c > n ? c - 1 : c, count - 2)));
  };
  const duplicateFrame = (n: number) => {
    if (!img) return;
    const copy = <T,>(a: T[], make: (x: T) => T) => [...a.slice(0, n + 1), make(a[n]), ...a.slice(n + 1)];
    setImg({ ...img, frames: copy(img.frames, f => ({ ...f, data: new Uint8ClampedArray(f.data) })) });
    setArt(a => a && copy(a, f => ({ ...f, data: new Uint8ClampedArray(f.data) })));
    setCur(n + 1);
  };
  /** The hand-edited frames as they look with background removal on top. */
  const shown = useMemo(() => art && (bgOn && bgColor ? art.map((_, n) => { const d = renderFrame(n)!; return { width: d.width, height: d.height, data: d.data as Uint8ClampedArray<ArrayBuffer> }; }) : art), [art, bgOn, bgColor, renderFrame]);
  const startEdit = () => {   // bake what the settings make now into frames that can be painted on
    if (!img) return;
    setPlaying(false);
    setArt(img.frames.map((_, n) => { const d = renderFrame(n, true)!; return { width: d.width, height: d.height, data: d.data as Uint8ClampedArray<ArrayBuffer> }; }));
  };
  const toCanvas = (d: ImageData) => { const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d')!.putImageData(d, 0, 0); return c; };
  const canvasBlob = (c: HTMLCanvasElement, mime: string) => new Promise<Blob | null>(res => c.toBlob(res, mime, 1));
  /** The picture in the chosen format (all frames for GIF and the sprite sheet, the shown frame otherwise). */
  const toBlob = async (f: ExportFormat = fmt): Promise<Blob | null> => {
    if (!img) return null;
    if (f === 'gif') {
      const ds = img.frames.map((fr, n) => ({ d: renderFrame(n)!, delay: fr.delay }));
      return new Blob([encodeGif(out.width, out.height, ds.map(x => ({ data: x.d.data, delay: x.delay })))], { type: 'image/gif' });
    }
    if (f === 'frames') {
      const names = frameFileNames(img.name, img.frames.length);
      const files = await Promise.all(img.frames.map(async (_, n) => {
        const blob = await canvasBlob(toCanvas(renderFrame(n)!), 'image/png');
        return { name: names[n], data: new Uint8Array(await blob!.arrayBuffer()) };
      }));
      return new Blob([makeZip(files)], { type: 'application/zip' });
    }
    if (f === 'sheet') {
      const ds = img.frames.map((_, n) => renderFrame(n)!);
      return canvasBlob(toCanvas(new ImageData(sheetFrames(ds.map(d => d.data), out.width, out.height), out.width * ds.length, out.height)), 'image/png');
    }
    const d = render();
    if (!d) return null;
    const c = toCanvas(d);
    if (f === 'jpg') {   // no transparency in a JPEG: put the picture on white
      const flat = document.createElement('canvas'); flat.width = c.width; flat.height = c.height;
      const x = flat.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
      return canvasBlob(flat, EXPORT_MIME.jpg);
    }
    return canvasBlob(c, EXPORT_MIME[f]);
  };
  const download = async () => {
    const blob = await toBlob();
    if (!blob || !img) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = exportFileName(out.width, out.height, img.name, fmt);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const [naming, setNaming] = useState(false);
  const addCollection = async (name: string) => {
    setNaming(false);
    const d = render();
    if (!d || !img) return;
    const c = document.createElement('canvas');
    c.width = d.width; c.height = d.height;
    c.getContext('2d')!.putImageData(d, 0, 0);
    const r = await addToCollection(c, name);
    setMsg('error' in r ? t(r.error) : t('feAdded', { name: r.name }));
  };
  const copy = async () => {
    const blob = await toBlob('png');
    if (!blob) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setMsg(t('pxCopied')); }
    catch { setMsg(t('pxCopyFailed')); }
  };

  /** Move one crop/cut line, keeping every line in order and inside the picture. */
  const setLine = useCallback((key: LineKey, v: number) => {
    if (!img) return;
    const [g, k] = key.split('.') as ['crop' | 'cut', 'l' | 't' | 'r' | 'b'];
    const W = img.width, H = img.height, c = crop, u = cuts;
    const lim = { 'crop.l': [0, u.l - 1], 'cut.l': [c.l + 1, u.r - 1], 'cut.r': [u.l + 1, c.r - 1], 'crop.r': [u.r + 1, W],
      'crop.t': [0, u.t - 1], 'cut.t': [c.t + 1, u.b - 1], 'cut.b': [u.t + 1, c.b - 1], 'crop.b': [u.b + 1, H] }[key];
    const n = Math.max(lim[0], Math.min(lim[1], Math.round(v)));
    if (g === 'crop') setCrop(o => ({ ...o, [k]: n })); else setCuts(o => ({ ...o, [k]: n }));
  }, [img, crop, cuts]);
  const toImage = (e: { clientX: number; clientY: number }) => {
    const r = mainRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * img!.width, y: (e.clientY - r.top) / r.height * img!.height };
  };
  /** The slice line under the pointer (within ~8 screen pixels), if any. */
  const hitLine = (e: { clientX: number; clientY: number }): LineKey | null => {
    const p = toImage(e), tol = 8 / zoom;
    const cands: [LineKey, number][] = [['crop.l', crop.l - p.x], ['crop.r', crop.r - p.x], ['cut.l', cuts.l - p.x], ['cut.r', cuts.r - p.x],
      ['crop.t', crop.t - p.y], ['crop.b', crop.b - p.y], ['cut.t', cuts.t - p.y], ['cut.b', cuts.b - p.y]];
    let best: LineKey | null = null, bd = tol;
    for (const [k, d] of cands) if (Math.abs(d) <= bd) { bd = Math.abs(d); best = k; }
    return best;
  };

  // pointer: pan the picture, or in "drag offset" mode slide the grid over it
  const down = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pickBg && img) {
      const p = toImage(e), x = Math.floor(p.x), y = Math.floor(p.y);
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
        const d = img.frames[Math.min(cur, count - 1)].data, i = (y * img.width + x) * 4;
        if (d[i + 3] > 0) { setBgKey({ r: d[i], g: d[i + 1], b: d[i + 2] }); setBgOn(true); }
      }
      setPickBg(false);
      return;
    }
    if (sliceMode && img) { const k = hitLine(e); if (k) { lineDrag.current = k; return; } }
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const move = (e: ReactPointerEvent) => {
    if (lineDrag.current && img) { const p = toImage(e), k = lineDrag.current; setLine(k, k.endsWith('l') || k.endsWith('r') ? p.x : p.y); return; }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    if (dragOffset && img) setOffset(o => ({ x: Math.round(o.x + dx / zoom), y: Math.round(o.y + dy / zoom) }));
    else setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  };
  const up = () => { drag.current = null; lineDrag.current = null; };
  const zoomBy = (f: number) => setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z * f).toFixed(3))));
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {   // wheel needs a non-passive listener to stop the page scrolling
    const el = stageRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 0.9 : 1.1); };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, [img]);

  const SIDE = { l: 'pxLeft', t: 'pxTop', r: 'pxRight', b: 'pxBottom' } as const;
  const num = (label: string, value: number, set: (n: number) => void, min: number, max: number) => (
    <label className="field px-field">{label}: {value}
      <NudgeRange min={min} max={max} value={value} onChange={set} label={label} />
    </label>
  );

  return (
    <div className="screen px">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/apps')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('pixelite')}</h1>

      {!img ? (
        <PixelFrame theme="gold_thick" scale={1} className="card px-drop"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) load(f); }}>
          <div className="muted small">{t('pixeliteHint')}</div>
          <div className="row">
            <PixelButton scale={1} onClick={() => fileRef.current?.click()}>{t('pxLoad')}</PixelButton>
            <PixelButton scale={1} aria-expanded={picking} onClick={() => setPicking(p => !p)}>{t('pxChooseFrame')}</PixelButton>
          </div>
          <div className="muted small">{t('pxDrop')}</div>
          {picking && <>
            <div className="row"><PixelButton scale={1} onClick={() => frameFileRef.current?.click()}>{t('feOpenFile')}</PixelButton></div>
            <div className="muted small">{t('pxFramePick')}</div>
            <div className="px-frames">
              {Object.keys(FRAME_THEMES).map(f => (
                <button key={f} type="button" className="px-frame" onClick={() => navigate(`/apps/pixelite/frame/${f}`)} aria-label={f}>
                  <img src={`/assets/frames/${f}.png`} alt="" />
                  <span>{f.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </div>
          </>}
          {msg && <div role="status">{msg}</div>}
        </PixelFrame>
      ) : (
        <>
          <PixelFrame theme="app" scale={1} className="card">
            <div className="row between">
              <span className="small">{img.name} ({img.width}x{img.height})</span>
              <PixelButton scale={1} variant="red" onClick={() => { setImg(null); setPalette([]); setArt(null); }}>{t('pxNew')}</PixelButton>
            </div>
            {!art && <>
            <div ref={stageRef} className={`px-stage ${dragOffset || pickBg ? 'px-grab' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <canvas ref={mainRef} className="px-main" aria-label={t('pixelite')} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />
            </div>
            <div className="row">
              <PixelButton scale={1} onClick={() => zoomBy(1 / 1.25)}>-</PixelButton>
              <span className="small">{t('pxZoom')} {Math.round(zoom * 100)}%</span>
              <PixelButton scale={1} onClick={() => zoomBy(1.25)}>+</PixelButton>
              <PixelButton scale={1} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{t('pxResetView')}</PixelButton>
            </div>
            </>}
          </PixelFrame>

          {!art && <PixelFrame theme="app" scale={1} className="card">
            <PixelCheckbox checked={sliceMode} onChange={on => { setSliceMode(on); if (on) setSize('50x50'); }} label={t('pxSliceMode')} />
            {sliceMode && <>
              <div className="muted small">{t('pxSliceHint')}</div>
              {num(t('pxSliceCorner'), corner, setCorner, 1, 23)}
              {(['l', 't', 'r', 'b'] as const).map(k => num(`${t('pxCut')} ${t(SIDE[k])}`, cuts[k], v => setLine(`cut.${k}`, v), 0, k === 'l' || k === 'r' ? img.width : img.height))}
              {(['l', 't', 'r', 'b'] as const).map(k => num(`${t('pxCrop')} ${t(SIDE[k])}`, crop[k], v => setLine(`crop.${k}`, v), 0, k === 'l' || k === 'r' ? img.width : img.height))}
              <PixelButton scale={1} onClick={() => { const cb = detectContentBounds(img.data, img.width, img.height); setCrop(cb); setCuts(defaultCuts(cb)); }}>{t('pxSliceReset')}</PixelButton>
            </>}
          </PixelFrame>}

          {!sliceMode && !art && <PixelFrame theme="app" scale={1} className="card">
            <h2 className="subtitle">{t('pxGrid')}</h2>
            {num(t('pxGridSize'), grid, setGrid, 1, MAX_GRID)}
            {num(t('pxOffsetX'), offset.x, x => setOffset(o => ({ ...o, x })), -img.width, img.width)}
            {num(t('pxOffsetY'), offset.y, y => setOffset(o => ({ ...o, y })), -img.height, img.height)}
            <PixelCheckbox checked={coords} onChange={setCoords} label={t('pxCoords')} />
            <PixelCheckbox checked={dragOffset} onChange={setDragOffset} label={t('pxDragOffset')} />
            <div className="row">
              <PixelButton scale={1} onClick={() => { const s = snapOutput(img.width, img.height, grid, offset.x, offset.y); setSize('custom'); setCustom({ w: s.width, h: s.height }); }}>{t('pxSnap')}</PixelButton>
              <PixelButton scale={1} onClick={() => setOffset({ x: 0, y: 0 })}>{t('pxResetGrid')}</PixelButton>
            </div>
          </PixelFrame>}

          {count > 1 && <PixelFrame theme="app" scale={1} className="card">
            <h2 className="subtitle">{t('pxTimeline')}</h2>
            <div className="row">
              <PixelButton scale={1} onClick={() => setPlaying(p => !p)}>{playing ? t('pxPause') : t('pxPlay')}</PixelButton>
              <PixelButton scale={1} onClick={() => { setPlaying(false); setCur(c => (c + count - 1) % count); }}>{'<'}</PixelButton>
              <span className="small">{t('pxFrameOf', { n: cur + 1, total: count })}</span>
              <PixelButton scale={1} onClick={() => { setPlaying(false); setCur(c => (c + 1) % count); }}>{'>'}</PixelButton>
            </div>
            <div className="px-timeline" role="listbox" aria-label={t('pxTimeline')}>
              {img.frames.map((f, n) => <FrameThumb key={n} frame={shown ? { ...f, data: shown[n].data } : f} width={art ? art[0].width : img.width} height={art ? art[0].height : img.height} active={n === cur} label={`${n + 1}`} onClick={() => { setPlaying(false); setCur(n); }} />)}
            </div>
            {num(t('pxDelay'), img.frames[Math.min(cur, count - 1)].delay, v => setDelay(cur, v), MIN_DELAY, 1000)}
            <div className="row">
              <PixelButton scale={1} onClick={() => setDelay(cur, img.frames[Math.min(cur, count - 1)].delay, true)}>{t('pxDelayAll')}</PixelButton>
              <PixelButton scale={1} onClick={() => duplicateFrame(cur)}>{t('pxDupFrame')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => removeFrame(cur)}>{t('pxDeleteFrame')}</PixelButton>
            </div>
            <div className="muted small">{t('pxKeysHint')}</div>
            <div className="muted small">{t('pxTotalTime', { s: (img.frames.reduce((a, f) => a + f.delay, 0) / 1000).toFixed(2) })}</div>
          </PixelFrame>}

          <PixelFrame theme="app" scale={1} className="card px-edit">
            {art ? <>
              <PixelEditor art={art} shown={shown ?? art} cur={cur} setArt={f => setArt(a => a && f(a))} setCur={n => { setPlaying(false); setCur(n); }} palette={palette} />
              <PixelButton scale={1} variant="red" onClick={() => setArt(null)}>{t('pxEditStop')}</PixelButton>
            </> : <>
              <PixelButton scale={1} onClick={startEdit}>{t('pxEdit')}</PixelButton>
              <div className="muted small">{t('pxEditIntro')}</div>
            </>}
          </PixelFrame>

          <PixelFrame theme="app" scale={1} className="card">
            <PixelCheckbox checked={bgOn} onChange={setBgOn} label={t('pxRemoveBg')} />
            {bgOn && <>
              <div className="row">
                <label className="field px-field">{t('pxBgColor')}
                  <input type="color" value={bgColor ? hex(bgColor) : '#ffffff'} onChange={e => setBgKey(unhex(e.target.value))} />
                </label>
                {!art && <PixelButton scale={1} aria-pressed={pickBg} onClick={() => setPickBg(p => !p)}>{t('pxBgPick')}</PixelButton>}
                <PixelButton scale={1} onClick={() => setBgKey(null)}>{t('pxBgAuto')}</PixelButton>
              </div>
              {pickBg && <div className="muted small">{t('pxBgPickHint')}</div>}
              {num(t('pxBgTolerance'), bgTol, setBgTol, 0, 100)}
              <PixelCheckbox checked={bgEdge} onChange={setBgEdge} label={t('pxBgEdge')} />
              {!bgColor && <div className="muted small">{t('pxBgNone')}</div>}
            </>}
          </PixelFrame>

          {!sliceMode && !art && <PixelFrame theme="app" scale={1} className="card">
            <h2 className="subtitle">{t('pxFilters')}</h2>
            <div className="muted small">{t('pxFiltersHint')}</div>
            <label className="field">{t('pxSampling')}
              <select value={sampleMode} onChange={e => setSampleMode(e.target.value as SampleMode)}>
                {SAMPLE_MODES.map(m => <option key={m} value={m}>{t(`pxSample_${m}` as const)}</option>)}
              </select>
            </label>
            {num(t('pxAlphaCut'), alphaCut, setAlphaCut, 0, 100)}
            {num(t('pxSharpen'), sharpenAmt, setSharpenAmt, 0, 100)}
            <PixelCheckbox checked={denoise} onChange={setDenoise} label={t('pxDenoise')} />
            <PixelCheckbox checked={stray} onChange={setStray} label={t('pxStray')} />
          </PixelFrame>}

          {!sliceMode && !art && <PixelFrame theme="app" scale={1} className="card">
            <h2 className="subtitle">{t('pxShading')}</h2>
            {num(t('pxIntensity'), shading, setShading, 0, 100)}
            <PixelCheckbox checked={live} onChange={setLive} label={t('pxLive')} />
            {palette.length > 0 && <>
              <div className="muted small">{t('pxPalette')}</div>
              <div className="px-swatches">{palette.map((c, i) => <span key={i} className="px-swatch" style={{ background: rgbCss(c) }} title={rgbCss(c)} />)}</div>
            </>}
          </PixelFrame>}

          <PixelFrame theme="app" scale={1} className="card">
            <h2 className="subtitle">{t('pxOutput')}</h2>
            <label className="field">{t('pxSize')}
              <select value={size} disabled={!!art} onChange={e => setSize(e.target.value as OutputSize)}>
                {OUTPUT_SIZES.filter(s => !(sliceMode && s === 'snap')).map(s => <option key={s} value={s}>{s === 'custom' ? t('pxCustom') : s === 'snap' ? t('pxSnapSize') : s}</option>)}
              </select>
            </label>
            {size === 'custom' && <div className="row">
              <label className="field px-field">{t('pxWidth')}<input type="number" min={1} max={MAX_OUTPUT} value={custom.w} onChange={e => setCustom(c => ({ ...c, w: clampOutput(Number(e.target.value)) }))} /></label>
              <label className="field px-field">{t('pxHeight')}<input type="number" min={1} max={MAX_OUTPUT} value={custom.h} onChange={e => setCustom(c => ({ ...c, h: clampOutput(Number(e.target.value)) }))} /></label>
            </div>}
            <div className="row">
              <span className="small">{t('pxScale')}</span>
              {([1, 2, 4] as const).map(s => <PixelButton key={s} scale={1} aria-pressed={scale === s} onClick={() => setScale(s)}>{s}x</PixelButton>)}
            </div>
            <div className="row">
              <span className="small">{t('pxCanvas')}</span>
              {CANVASES.map(c => <PixelButton key={c} scale={1} aria-pressed={canvasBg === c} onClick={() => setCanvasBg(c)}>{t(`pxCanvas_${c}` as const)}</PixelButton>)}
            </div>
            <div className="px-preview"><canvas ref={prevRef} aria-label={`${out.width}x${out.height}`} /></div>
            <div className="muted small">{out.width}x{out.height}{sliceMode && ` (${out.width - 2 * SPARE}x${out.height - 2 * SPARE} + ${SPARE}px)`}</div>
            <label className="field">{t('pxExportAs')}
              <select value={fmt} onChange={e => setFmt(e.target.value as ExportFormat)}>
                {EXPORT_FORMATS.filter(f => count > 1 || (f !== 'sheet' && f !== 'frames')).map(f => <option key={f} value={f}>{t(`pxFmt_${f}` as const)}</option>)}
              </select>
            </label>
            {fmt === 'jpg' && <div className="muted small">{t('pxJpgNote')}</div>}
            {fmt === 'gif' && count < 2 && <div className="muted small">{t('pxGifOne')}</div>}
            <div className="row">
              <PixelButton scale={1} onClick={download}>{t('pxExport')}</PixelButton>
              <PixelButton scale={1} onClick={copy}>{t('pxCopy')}</PixelButton>
              {CAN_ADD_TO_COLLECTION && out.width === 50 && out.height === 50 && <PixelButton scale={1} onClick={() => setNaming(true)}>{t('feAddCollection')}</PixelButton>}
            </div>
            {msg && <div role="status" className="small">{msg}</div>}
          </PixelFrame>
        </>
      )}
      <NameDialog open={naming} title={t('feAddName')} initial={suggestName(img?.name.replace(/\.[^/.]+$/, '') ?? '')} okLabel={t('feAddCollection')} cancelLabel={t('cancel')} onSubmit={addCollection} onClose={() => setNaming(false)} />
      <input ref={frameFileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setPendingFrameFile(f); navigate('/apps/pixelite/frame/file'); } e.target.value = ''; }} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
    </div>
  );
}

/** One small picture on the timeline. */
function FrameThumb({ frame, width, height, active, label, onClick }: { frame: GifFrame; width: number; height: number; active: boolean; label: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const tmp = document.createElement('canvas'); tmp.width = width; tmp.height = height;
    tmp.getContext('2d')!.putImageData(new ImageData(frame.data, width, height), 0, 0);
    const k = Math.min(1, 64 / Math.max(width, height));
    c.width = Math.max(1, Math.round(width * k)); c.height = Math.max(1, Math.round(height * k));
    c.getContext('2d')!.drawImage(tmp, 0, 0, c.width, c.height);
  }, [frame, width, height]);
  return (
    <button type="button" role="option" aria-selected={active} className={`px-thumb ${active ? 'on' : ''}`} onClick={onClick}>
      <canvas ref={ref} /><span>{label}</span>
    </button>
  );
}
