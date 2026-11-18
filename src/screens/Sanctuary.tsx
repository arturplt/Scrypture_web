import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import {
  CELL_H, CELL_W, DEFAULT_TILE, GRID, LAYERS, MAX_LEVELS, PALETTE_COLOR, TILE, TILES, TILE_TYPES, drawOrder, fillLayer, generateIsland,
  gridBounds, gridToWorld, placeBlock, removeBlock, tileById, toBlocks, toWorld, worldToGrid, type Block, type TileType, type BlockWorld,
} from '../domain';
import { actions, store, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { NameDialog } from '../ui/NameDialog';
import type { Key } from '../i18n';
import SHEET_URL from '../assets/isometric-sandbox-sheet.png';
import './sanctuary.css';

type Tool = 'place' | 'erase' | 'move';
interface Cam { x: number; y: number; zoom: number }
const MIN_ZOOM = 0.5, MAX_ZOOM = 6, UNDO_LIMIT = 40;

/** Isometric block builder (Android's Sanctuary): paint tiles on a layered diamond grid, generate an island, save levels. */
export function Sanctuary() {
  const { t } = useI18n();
  const levels = useAppState(s => s.sanctuary.levels);
  const world = useRef<BlockWorld>(null as unknown as BlockWorld);
  if (!world.current) world.current = toWorld(store.getState().sanctuary.draft);   // once, not on every render
  const sheet = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, zoom: 2 });
  const hover = useRef<{ x: number; y: number } | null>(null);
  const sorted = useRef<Block[] | null>(null);          // cached draw order, dropped whenever the blocks change
  const raf = useRef(0);
  const undoStack = useRef<Block[][]>([]);
  const saveTimer = useRef(0);

  const [tool, setTool] = useState<Tool>('place');
  const [tileId, setTileId] = useState(DEFAULT_TILE);
  const [type, setType] = useState<TileType>('cube');
  const [layer, setLayer] = useState(0);
  const [grid, setGrid] = useState(true);
  const [count, setCount] = useState(world.current.size);
  const [undoable, setUndoable] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [naming, setNaming] = useState(false);
  const [note, setNote] = useState('');
  // the draw loop reads these through refs so pointer handlers never go stale
  const live = useRef({ tool, tileId, layer, grid });
  live.current = { tool, tileId, layer, grid };

  const draw = useCallback(() => {
    raf.current = 0;
    const cv = canvas.current, img = sheet.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1, c = cam.current, { layer: lay, grid: showGrid, tool: tl, tileId: tid } = live.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr * c.zoom, 0, 0, dpr * c.zoom, dpr * c.x, dpr * c.y);

    if (showGrid) {   // the diamond floor of the current layer
      ctx.lineWidth = 1 / (dpr * c.zoom);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      for (let i = 0; i <= GRID; i++) {
        const a = gridToWorld(i - 0.5, -0.5, lay), b = gridToWorld(i - 0.5, GRID - 0.5, lay);
        const d = gridToWorld(-0.5, i - 0.5, lay), e = gridToWorld(GRID - 0.5, i - 0.5, lay);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(d.x, d.y); ctx.lineTo(e.x, e.y);
      }
      ctx.stroke();
    }
    if (img) {
      if (!sorted.current) sorted.current = drawOrder(toBlocks(world.current));
      for (const [x, y, z, id] of sorted.current) {
        const tile = tileById(id);
        if (!tile) continue;
        const p = gridToWorld(x, y, z);
        ctx.globalAlpha = z > lay ? 0.3 : 1;   // layers above the one you are editing fade so you can see what you build
        ctx.drawImage(img, tile.sx, tile.sy, TILE, TILE, p.x - TILE / 2, p.y - CELL_H / 2, TILE, TILE);
      }
      ctx.globalAlpha = 1;
    }
    const h = hover.current;
    if (h) {   // the cell under the pointer, with a see-through preview of the tile you are about to place
      const p = gridToWorld(h.x, h.y, lay), tile = tileById(tid);
      if (tl === 'place' && img && tile) { ctx.globalAlpha = 0.55; ctx.drawImage(img, tile.sx, tile.sy, TILE, TILE, p.x - TILE / 2, p.y - CELL_H / 2, TILE, TILE); ctx.globalAlpha = 1; }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - CELL_H / 2); ctx.lineTo(p.x + CELL_W / 2, p.y); ctx.lineTo(p.x, p.y + CELL_H / 2); ctx.lineTo(p.x - CELL_W / 2, p.y); ctx.closePath();
      ctx.lineWidth = 2 / (dpr * c.zoom);
      ctx.strokeStyle = tl === 'erase' ? '#ff5252' : '#ffd54f';
      ctx.stroke();
    }
  }, []);
  const redraw = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(draw); }, [draw]);
  const touched = useCallback(() => {   // the blocks changed: refresh the count and keep the work in progress
    sorted.current = null;
    setCount(world.current.size);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => actions.setSanctuaryDraft(toBlocks(world.current)), 400);
    redraw();
  }, [redraw]);

  const centre = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const b = gridBounds(), w = el.clientWidth, h = el.clientHeight;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(w / (b.right - b.left + 40), h / (b.bottom - b.top + 40))));
    cam.current = { zoom, x: w / 2, y: h / 2 - ((b.top + b.bottom) / 2) * zoom };
    redraw();
  }, [redraw]);

  // load the tile sheet once
  useEffect(() => {
    const img = new Image();
    img.onload = () => { sheet.current = img; setReady(true); redraw(); };
    img.onerror = () => setFailed(true);
    img.src = SHEET_URL;
  }, [redraw]);

  // keep the canvas sharp and the right size, and centre the grid the first time it has a size
  useEffect(() => {
    const el = stage.current, cv = canvas.current;
    if (!el || !cv) return;
    let first = true;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(el.clientWidth * dpr));
      cv.height = Math.max(1, Math.round(el.clientHeight * dpr));
      if (first && el.clientWidth > 0) { first = false; centre(); } else redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [centre, redraw]);

  useEffect(() => { redraw(); }, [tool, tileId, layer, grid, redraw]);
  useEffect(() => () => {   // leaving the screen: flush the draft and stop the loop
    clearTimeout(saveTimer.current); cancelAnimationFrame(raf.current);
    actions.setSanctuaryDraft(toBlocks(world.current));
  }, []);

  // ---- editing
  const snapshot = () => {
    undoStack.current.push(toBlocks(world.current));
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setUndoable(undoStack.current.length);
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    world.current = toWorld(prev);
    setUndoable(undoStack.current.length);
    touched();
  };
  const edit = (fn: (w: BlockWorld) => void) => { snapshot(); fn(world.current); touched(); };

  const stroke = useRef<{ last: string } | null>(null);
  const paint = (cell: { x: number; y: number } | null, erase: boolean) => {
    if (!cell || !stroke.current) return;
    const k = `${cell.x},${cell.y}`;
    if (stroke.current.last === k) return;
    stroke.current.last = k;
    const { layer: z, tileId: id } = live.current;
    if (erase ? removeBlock(world.current, cell.x, cell.y, z) : placeBlock(world.current, cell.x, cell.y, z, id)) touched();
  };

  // ---- pointer: one finger/mouse paints or pans, two fingers pinch-zoom and pan, the wheel zooms
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: 'pan' | 'paint' | 'erase' | 'pinch'; dist: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cellAt = (p: { x: number; y: number }) => {
    const c = cam.current;
    return worldToGrid((p.x - c.x) / c.zoom, (p.y - c.y) / c.zoom, live.current.layer);
  };
  const zoomAt = (p: { x: number; y: number }, factor: number) => {
    const c = cam.current, z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * factor)), k = z / c.zoom;
    cam.current = { zoom: z, x: p.x - (p.x - c.x) * k, y: p.y - (p.y - c.y) * k };
    redraw();
  };
  const zoomCentre = (f: number) => { const el = stage.current; if (el) zoomAt({ x: el.clientWidth / 2, y: el.clientHeight / 2 }, f); };

  const onDown = (e: RPointerEvent) => {
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not an active pointer: carry on without capture */ }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {   // a second finger turns whatever was happening into a pinch
      const [a, b] = [...pointers.current.values()];
      gesture.current = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) };
      stroke.current = null;
      return;
    }
    const tl = live.current.tool;
    if (e.button === 1 || tl === 'move') { gesture.current = { mode: 'pan', dist: 0 }; return; }
    const erase = e.button === 2 || tl === 'erase';
    snapshot();
    stroke.current = { last: '' };
    gesture.current = { mode: erase ? 'erase' : 'paint', dist: 0 };
    paint(cellAt(p), erase);
  };
  const onMove = (e: RPointerEvent) => {
    const p = local(e), prev = pointers.current.get(e.pointerId);
    if (e.pointerType === 'mouse' || !prev) { const h = cellAt(p); if (h?.x !== hover.current?.x || h?.y !== hover.current?.y) { hover.current = h; redraw(); } }
    if (!prev) return;
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist > 0 && d > 0) zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d / g.dist);
      g.dist = d;
    } else if (g.mode === 'pan') {
      cam.current = { ...cam.current, x: cam.current.x + (p.x - prev.x), y: cam.current.y + (p.y - prev.y) };
      redraw();
    } else paint(cellAt(p), g.mode === 'erase');
  };
  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (stroke.current && undoStack.current.length) {   // a stroke that changed nothing should not leave an empty undo step
        const last = undoStack.current[undoStack.current.length - 1];
        if (last.length === world.current.size && sameBlocks(last, world.current)) { undoStack.current.pop(); setUndoable(undoStack.current.length); }
      }
      gesture.current = null; stroke.current = null;
    }
    if (e.pointerType !== 'mouse') { hover.current = null; redraw(); }
  };
  useEffect(() => {   // wheel needs a non-passive listener to stop the page scrolling
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(local(e), e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard: Delete erases the cell under the pointer; [ and ] change layer; Ctrl+Z undoes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === ']' || e.key === 'PageUp') setLayer(l => Math.min(LAYERS - 1, l + 1));
      else if (e.key === '[' || e.key === 'PageDown') setLayer(l => Math.max(0, l - 1));
      else if (e.key.toLowerCase() === 'g') setGrid(g => !g);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && hover.current) { const h = hover.current; if (world.current.has(blockKey(h.x, h.y, live.current.layer))) edit(w => removeBlock(w, h.x, h.y, live.current.layer)); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const save = (name: string) => {
    const id = actions.saveSanctuaryLevel(name, toBlocks(world.current));
    setNaming(false);
    setNote(id ? t('sanSavedAs', { name }) : t('sanFull'));
  };
  const load = (blocks: Block[]) => { snapshot(); world.current = toWorld(blocks); touched(); };

  const tiles = useMemo(() => TILES.filter(x => x.type === type), [type]);
  const types = useMemo(() => TILE_TYPES.filter(ty => TILES.some(x => x.type === ty)), []);
  const cur = tileById(tileId);
  const TOOLS: [Tool, Key][] = [['place', 'sanPlace'], ['erase', 'sanErase'], ['move', 'sanMove']];

  return (
    <div className="screen san">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('sanctuary')}</h1>
      <div className="muted small">{t('sanHelp')}</div>

      <div className="row san-bar">
        {TOOLS.map(([id, label]) => <PixelButton key={id} scale={1} variant={tool === id ? 'green' : 'red'} aria-pressed={tool === id} onClick={() => setTool(id)}>{t(label)}</PixelButton>)}
        <PixelButton scale={1} variant={grid ? 'green' : 'red'} aria-pressed={grid} onClick={() => setGrid(g => !g)}>{t('sanGrid')}</PixelButton>
        <PixelButton scale={1} variant="red" disabled={undoable === 0} onClick={undo}>{t('undo')}</PixelButton>
      </div>
      <div className="row san-bar">
        <PixelButton scale={1} variant="red" disabled={layer === 0} aria-label={`${t('sanLayer', { n: layer })} -`} onClick={() => setLayer(l => Math.max(0, l - 1))}>-</PixelButton>
        <span className="san-layer" aria-live="polite">{t('sanLayer', { n: layer + 1 })} / {LAYERS}</span>
        <PixelButton scale={1} variant="red" disabled={layer >= LAYERS - 1} aria-label={`${t('sanLayer', { n: layer + 2 })} +`} onClick={() => setLayer(l => Math.min(LAYERS - 1, l + 1))}>+</PixelButton>
        <PixelButton scale={1} variant="red" aria-label={`${t('sanZoom')} -`} onClick={() => zoomCentre(1 / 1.3)}>{t('sanZoom')} -</PixelButton>
        <PixelButton scale={1} variant="red" aria-label={`${t('sanZoom')} +`} onClick={() => zoomCentre(1.3)}>{t('sanZoom')} +</PixelButton>
        <PixelButton scale={1} variant="red" onClick={centre}>{t('sanCenter')}</PixelButton>
      </div>

      <div ref={stage} className={`san-stage san-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={e => { if (e.pointerType === 'mouse') { hover.current = null; redraw(); } }} onContextMenu={e => e.preventDefault()}>
        <canvas ref={canvas} aria-label={t('sanctuary')} role="img" />
        {!ready && <div className="san-msg">{failed ? t('sanLoadFail') : '…'}</div>}
      </div>
      <div className="row between muted small"><span>{t('sanBlocks', { n: count })}</span>{note && <span role="status">{note}</span>}</div>

      <PixelFrame theme="gold_thick" scale={1} className="card">
        <div className="row san-types" role="tablist" aria-label={t('sanBlock')}>
          {types.map(ty => <PixelButton key={ty} scale={1} variant={type === ty ? 'green' : 'red'} role="tab" aria-selected={type === ty} onClick={() => setType(ty)}>{t(`sanType_${ty}` as Key)}</PixelButton>)}
        </div>
        <div className="san-tiles">
          {tiles.map(x => (
            <button key={x.id} type="button" className={`san-tile ${x.id === tileId ? 'on' : ''}`} aria-pressed={x.id === tileId} aria-label={`${x.name} (${x.palette})`}
              title={`${x.name} (${x.palette})`} onClick={() => { setTileId(x.id); if (tool !== 'place') setTool('place'); }}
              style={{ '--sx': x.sx, '--sy': x.sy, '--pal': PALETTE_COLOR[x.palette], backgroundImage: `url(${SHEET_URL})` } as CSSProperties} />
          ))}
        </div>
        {cur && <div className="muted small">{cur.name} · {cur.palette}</div>}
        <div className="row san-bar">
          <PixelButton scale={1} onClick={() => edit(w => fillLayer(w, layer, tileId))}>{t('sanFill')}</PixelButton>
          <PixelButton scale={1} onClick={() => { snapshot(); world.current = toWorld(generateIsland({ seed: Math.floor(Math.random() * 1e9) })); setLayer(4); touched(); }}>{t('sanIsland')}</PixelButton>
          <PixelButton scale={1} variant="red" disabled={count === 0} onClick={() => edit(w => w.clear())}>{t('sanClear')}</PixelButton>
          <PixelButton scale={1} onClick={() => setNaming(true)}>{t('sanSave')}</PixelButton>
        </div>
      </PixelFrame>

      <PixelFrame theme="gold_thick" scale={1} className="card">
        <h2 className="subtitle">{t('sanLevels')} ({levels.length}/{MAX_LEVELS})</h2>
        {levels.length === 0 && <div className="muted small">{t('sanNoLevels')}</div>}
        {[...levels].sort((a, b) => b.updatedAt - a.updatedAt).map(l => (
          <div key={l.id} className="row between san-level">
            <div><strong>{l.name}</strong><div className="muted small">{t('sanBlocks', { n: l.blocks.length })}</div></div>
            <div className="row">
              <PixelButton scale={1} onClick={() => load(l.blocks)}>{t('sanLoad')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={() => actions.deleteSanctuaryLevel(l.id)}>{t('delete')}</PixelButton>
            </div>
          </div>
        ))}
      </PixelFrame>

      <NameDialog open={naming} title={t('sanName')} initial={t('sanNew')} okLabel={t('sanSave')} cancelLabel={t('cancel')} onSubmit={save} onClose={() => setNaming(false)} />
    </div>
  );
}

const blockKey = (x: number, y: number, z: number) => (z * GRID + y) * GRID + x;
function sameBlocks(a: Block[], w: BlockWorld): boolean {
  return a.every(b => { const o = w.get(blockKey(b[0], b[1], b[2])); return !!o && o[3] === b[3]; });
}
