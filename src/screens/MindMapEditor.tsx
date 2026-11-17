import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import {
  DEFAULT_NODE_THEME, MAX_MAP_NODES, MM_CHAR, MM_DESC_MAX, MM_GRID, MM_LABEL_MAX, MM_PAD_X, NODE_THEMES, addLink, addNode, childSpot, cleanLabel, colsForRight, curvePath,
  findNode, fitView, freeSpot, linkAt, linkCurves, mapBounds, moveBranch, moveNode, nodeAt, nodeSize, raiseNode, startOfDay, collapseView, branchOf, removeLink, removeNode, setNodeCols, setNodeDesc,
  setNodeLabel, setNodeTheme, tidyMap, zoomAt, type MapNode, type MapView, type MindMap,
} from '../domain';
import { actions, store, useAppState } from '../data/hooks';
import { newId } from '../data/id';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/misc';
import { LIGHT_FRAMES } from '../ui/themes';
import { useUi } from '../ui/useUi';
import { useViewport } from '../ui/viewport';
import './mindmap.css';

const LIST = '/apps/mindmap';
const UNDO_LIMIT = 50, DRAG_START = 5, DOUBLE_TAP_MS = 400;
/** Text being typed is shown at least this big (px), zooming in if needed. */
const TYPE_MIN_PX = 12;
/** A box frame: plain edges and centre, and a border half as wide as the sprite's (8 units), so small boxes are not mostly border. */
const frameOf = (theme: string) => `${theme}:stretch:clean:16`;

type Sel = { node: string } | { link: string } | null;
/** Typing straight into a box. `before` is the map to go back to (for a new box: the map without it). */
interface Typing { id: string; raw: string; before: MindMap; fresh: boolean }
type Gesture =
  | { mode: 'pan'; sx: number; sy: number; moved: boolean }
  | { mode: 'node'; id: string; sx: number; sy: number; wx: number; wy: number; ox: number; oy: number; moved: boolean; before: MindMap }
  | { mode: 'resize'; id: string; before: MindMap }
  | { mode: 'pinch'; dist: number; mx: number; my: number };
interface TypeApi { change(raw: string): void; finish(then?: 'child'): void; cancel(): void }

export function MindMapEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const exists = useAppState(s => s.mindMaps.list.some(m => m.id === id));
  if (!exists) return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate(LIST)}>{t('back')}</PixelButton></div>
      <div className="muted small" role="status">{t('mmMissing')}</div>
    </div>
  );
  return <Editor key={id} id={id} />;
}

/** The boxes and links. Memoised: panning and zooming only move the layer they sit in. */
const Layer = memo(function Layer({ map, hidden, sel, linking, typing, api }: { map: MindMap; hidden: Map<string, number>; sel: Sel; linking: string | null; typing: Typing | null; api: MutableRefObject<TypeApi> }) {
  const selNode = sel && 'node' in sel ? findNode(map, sel.node) : undefined;
  const curves = linkCurves(map);
  return (
    <>
      <svg className="mm-links" aria-hidden>
        {map.links.map(l => {
          const c = curves.get(l.id);
          return c ? <path key={l.id} className={`mm-link ${sel && 'link' in sel && sel.link === l.id ? 'on' : ''}`} d={curvePath(c)} /> : null;
        })}
      </svg>
      {map.nodes.map(n => {
        const lines = nodeSize(n.label, n.cols).lines, typed = typing?.id === n.id ? typing : null;
        return (
          <PixelFrame key={n.id} theme={frameOf(n.theme)} scale={1} data-node={n.id} tabIndex={typed ? -1 : 0} role="button" aria-label={n.desc ? `${n.label}. ${n.desc}` : n.label} aria-pressed={selNode === n}
            className={`mm-node ${LIGHT_FRAMES.has(n.theme) ? 'light' : ''} ${selNode === n ? 'on' : ''} ${linking === n.id ? 'src' : ''}`}
            style={{ '--x': n.x, '--y': n.y, '--w': n.w, '--h': n.h } as CSSProperties}>
            {typed ? (
              // the box is sized by the app's own line breaking; the field is exactly as wide as the widest line, so the browser breaks the text the same way
              <textarea className="mm-type" autoFocus value={typed.raw} maxLength={MM_LABEL_MAX} rows={lines.length} spellCheck={false} autoCapitalize="sentences" enterKeyHint="done"
                style={{ '--tw': n.w - 2 * MM_PAD_X, '--tl': lines.length } as CSSProperties}
                onFocus={e => { const end = e.currentTarget.value.length; e.currentTarget.setSelectionRange(end, end); }}
                onChange={e => api.current.change(e.target.value)} onBlur={() => api.current.finish()}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); api.current.finish(); }
                  else if (e.key === 'Tab') { e.preventDefault(); api.current.finish('child'); }
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.current.cancel(); }
                }} />
            ) : lines.map((line, i) => <span key={i}>{line}</span>)}
            {n.desc && <i className="mm-mark" aria-hidden />}
            {hidden.has(n.id) && <b className="mm-fold" aria-hidden>+{hidden.get(n.id)}</b>}
          </PixelFrame>
        );
      })}
      {selNode && !linking && !typing && <span className="mm-handle" style={{ '--x': selNode.x + selNode.w, '--y': selNode.y + selNode.h / 2 } as CSSProperties} />}
    </>
  );
});

function Editor({ id }: { id: string }) {
  const { t } = useI18n();
  const { ui } = useUi();
  const size = useViewport();
  const name = useAppState(s => s.mindMaps.list.find(m => m.id === id)?.name ?? '');
  // the store's copy is read once: from then on this screen owns the map and saves every finished edit
  const [map, setMap] = useState<MindMap>(() => store.getState().mindMaps.list.find(m => m.id === id)!);
  const [sel, setSel] = useState<Sel>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());   // boxes whose branch is folded away (not saved)
  const shown = useMemo(() => collapseView(map, collapsed), [map, collapsed]);
  const [linking, setLinking] = useState<string | null>(null);   // the box a new link starts from
  const [typing, setTypingState] = useState<Typing | null>(null);
  const [details, setDetails] = useState<string | null>(null);   // the box whose text, description and frame are open in the dialog
  const [solo, setSolo] = useState(false);                       // dragging moves one box, not its whole branch
  const [undoable, setUndoable] = useState(0);
  const [note, setNote] = useState('');

  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const view = useRef<MapView>({ x: 0, y: 0, zoom: 1 });
  const undoStack = useRef<MindMap[]>([]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef({ at: 0, key: '', x: 0, y: 0 });
  // pointer and key handlers read the latest values through this, so they never go stale
  const live = useRef({ shown, map, sel, linking, ui, typing, details, solo });
  live.current = { shown, map, sel, linking, ui, typing, details, solo };

  // ---- view
  const applyView = useCallback(() => {
    const v = view.current, st = stage.current, w = world.current;
    if (!st || !w) return;
    const k = live.current.ui * v.zoom;
    w.style.transform = `translate(${Math.round(v.x)}px, ${Math.round(v.y)}px) scale(${v.zoom})`;
    w.style.setProperty('--mm-k', String(k));   // px per unit (not --k: frames use that name): link lines use it to stay visible when zoomed far out
    let cell = 2 * MM_GRID * k;   // a dot every second grid line, fewer when zoomed far out
    while (cell < 12) cell *= 2;
    st.style.backgroundSize = `${cell}px ${cell}px`;
    st.style.backgroundPosition = `${Math.round(v.x) - cell / 2}px ${Math.round(v.y) - cell / 2}px`;
  }, []);
  const setView = useCallback((v: MapView) => { view.current = v; applyView(); }, [applyView]);
  const fit = useCallback(() => {
    const st = stage.current;
    if (!st) return;
    const u = live.current.ui;
    setView(fitView(mapBounds(live.current.map), st.clientWidth, st.clientHeight, u, { top: 56 * u, right: 12 * u, bottom: 64 * u, left: 12 * u }));
  }, [setView]);
  useLayoutEffect(() => { fit(); }, [fit]);                      // opens showing the whole map
  useLayoutEffect(() => { applyView(); }, [ui, size, applyView]);  // the grid follows the interface scale
  const zoomCentre = (f: number) => { const st = stage.current; if (st) setView(zoomAt(view.current, st.clientWidth / 2, st.clientHeight / 2, f)); };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const scale = () => live.current.ui * view.current.zoom;   // px per unit
  const toMap = (p: { x: number; y: number }) => ({ x: (p.x - view.current.x) / scale(), y: (p.y - view.current.y) / scale() });
  /** Pan just enough to bring a box on screen (a new child can land outside the view). */
  const reveal = (n: MapNode) => {
    const st = stage.current;
    if (!st) return;
    const k = scale(), v = view.current, u = live.current.ui, pad = 16 * u;
    const left = v.x + n.x * k, right = v.x + (n.x + n.w) * k, top = v.y + n.y * k, bottom = v.y + (n.y + n.h) * k;
    const dx = left < pad ? pad - left : right > st.clientWidth - pad ? st.clientWidth - pad - right : 0;
    const dy = top < 56 * u ? 56 * u - top : bottom > st.clientHeight - 64 * u ? st.clientHeight - 64 * u - bottom : 0;
    if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
  };

  // ---- editing: `put` shows a map, `commit` also makes it an undo step and saves it
  const put = (m: MindMap) => { live.current.map = m; setMap(m); };
  const save = (m: MindMap) => actions.updateMindMap(id, { nodes: m.nodes, links: m.links });
  const record = (before: MindMap) => {
    undoStack.current.push(before);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setUndoable(undoStack.current.length);
    save(live.current.map);
  };
  const commit = (next: MindMap): boolean => {
    const before = live.current.map;
    if (next === before) return false;
    put(next);
    record(before);
    return true;
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setUndoable(undoStack.current.length);
    put(prev);
    save(prev);
    setSel(null); setLinking(null);
  };
  const say = (text: string) => setNote(text);
  useEffect(() => { if (!note) return; const h = window.setTimeout(() => setNote(''), 2500); return () => clearTimeout(h); }, [note]);

  // ---- typing in a box: every key shows at once, the finished text is one undo step
  const setTyping = (ty: Typing | null) => { live.current.typing = ty; setTypingState(ty); };
  const startTyping = (nid: string, before: MindMap = live.current.map, fresh = false) => {
    const n = findNode(live.current.map, nid);
    if (!n) return;
    setLinking(null);
    setSel({ node: nid });
    if (scale() * MM_CHAR < TYPE_MIN_PX) {   // too small to read: zoom in on the box
      const k = scale(), v = view.current;
      setView(zoomAt(v, v.x + (n.x + n.w / 2) * k, v.y + (n.y + n.h / 2) * k, TYPE_MIN_PX / MM_CHAR / k));
    }
    reveal(n);
    setTyping({ id: nid, raw: n.label, before, fresh });
  };
  const typeApi = useRef<TypeApi>(null as unknown as TypeApi);
  typeApi.current = {
    change(value) {
      const ty = live.current.typing;
      if (!ty) return;
      const raw = value.replace(/[\r\n]+/g, ' ').slice(0, MM_LABEL_MAX);
      setTyping({ ...ty, raw });
      put(setNodeLabel(live.current.map, ty.id, raw));
      const n = findNode(live.current.map, ty.id);
      if (n) reveal(n);
    },
    finish(then) {
      const ty = live.current.typing;
      if (!ty) return;   // already finished (Enter, then the field losing focus)
      setTyping(null);
      if (!cleanLabel(ty.raw)) {   // nothing typed: a new box goes away, an old one keeps its text
        put(ty.before);
        if (ty.fresh) setSel(null);
        return;
      }
      if (live.current.map !== ty.before) record(ty.before);
      if (then === 'child') addBox(ty.id);
    },
    cancel() {
      const ty = live.current.typing;
      if (!ty) return;
      setTyping(null);
      put(ty.before);
      if (ty.fresh) setSel(null);
    },
  };

  /** A new empty box, ready to type in: a child of `parent`, else at `at`, else in the middle of the screen. */
  const addBox = (parent?: string, at?: { x: number; y: number }) => {
    const m = live.current.map;
    if (m.nodes.length >= MAX_MAP_NODES) { say(t('mmBoxesFull', { n: MAX_MAP_NODES })); return; }
    const nid = newId(), box = nodeSize(''), from = parent ? findNode(m, parent) : undefined;
    let spot: { x: number; y: number } | null;
    if (from) spot = childSpot(m, from.id, '');
    else {
      const st = stage.current!, c = at ?? toMap({ x: st.clientWidth / 2, y: st.clientHeight / 2 });
      spot = freeSpot(m, c.x - box.w / 2, c.y - box.h / 2, box.w, box.h);
    }
    if (!spot) return;
    let next = addNode(m, nid, '', spot.x, spot.y, from?.theme ?? DEFAULT_NODE_THEME);
    if (from) next = addLink(next, newId(), from.id, nid);
    if (next === m) return;
    put(next);
    startTyping(nid, m, true);
  };

  const selectedNode = sel && 'node' in sel ? findNode(map, sel.node) : undefined;
  const deleteSelected = () => {
    const s = live.current.sel;
    if (!s) return;
    commit('node' in s ? removeNode(live.current.map, s.node) : removeLink(live.current.map, s.link));
    setSel(null);
  };
  const submitDetails = (label: string, desc: string, theme: string) => {
    const nid = details, m = live.current.map;
    setDetails(null);
    if (!nid) return;
    const text = cleanLabel(label);
    commit(setNodeTheme(setNodeDesc(text ? setNodeLabel(m, nid, text) : m, nid, desc), nid, theme));
  };

  // ---- taps
  const doubleTap = (key: string, p: { x: number; y: number }) => {
    const now = performance.now(), l = lastTap.current;
    const twice = now - l.at < DOUBLE_TAP_MS && l.key === key && Math.hypot(p.x - l.x, p.y - l.y) < 24;
    lastTap.current = twice ? { at: 0, key: '', x: 0, y: 0 } : { at: now, key, x: p.x, y: p.y };
    return twice;
  };
  const tapNode = (nid: string, p: { x: number; y: number }) => {
    const { linking: from, map: m } = live.current;
    if (from) {
      setLinking(null);
      if (from === nid) return;
      if (!commit(addLink(m, newId(), from, nid))) say(t('mmLinkExists'));
      return;
    }
    if (doubleTap(nid, p)) { startTyping(nid); return; }
    setSel({ node: nid });
  };
  const tapEmpty = (p: { x: number; y: number }) => {
    if (live.current.linking) { setLinking(null); return; }
    const w = toMap(p), l = linkAt(live.current.shown.map, w.x, w.y, Math.max(6, 14 / scale()));
    if (l) { setSel({ link: l.id }); return; }
    if (doubleTap('', p)) { addBox(undefined, w); return; }
    setSel(null);
  };

  // ---- pointer: drag a box to move it (with its branch), drag the background to pan, two fingers pinch-zoom and pan, the wheel zooms
  const onHandle = (w: { x: number; y: number }) => {
    const { sel: s, map: m, linking: from } = live.current;
    const n = s && 'node' in s && !from ? findNode(m, s.node) : undefined;
    const reach = Math.max(6, 16 / scale());
    return n && Math.abs(w.x - (n.x + n.w)) <= reach && Math.abs(w.y - (n.y + n.h / 2)) <= reach ? n : undefined;
  };
  const revert = () => { const g = gesture.current; if (g && (g.mode === 'node' || g.mode === 'resize') && live.current.map !== g.before) put(g.before); };
  const onDown = (e: RPointerEvent) => {
    if (e.target instanceof Element && e.target.closest('textarea')) return;   // placing the caret in the box being typed in
    if (e.button === 2) return;
    typeApi.current.finish();   // a press anywhere else ends typing (before the gesture reads the map)
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not an active pointer: carry on without capture */ }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {   // a second finger turns whatever was happening into a pinch
      revert();
      const [a, b] = [...pointers.current.values()];
      gesture.current = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.current.size > 2) return;
    const w = toMap(p), m = live.current.map;
    const grip = e.button === 0 ? onHandle(w) : undefined;
    const n = e.button === 0 && !grip ? nodeAt(live.current.shown.map, w.x, w.y) : undefined;
    if (grip) gesture.current = { mode: 'resize', id: grip.id, before: m };
    else if (n) gesture.current = { mode: 'node', id: n.id, sx: p.x, sy: p.y, wx: w.x, wy: w.y, ox: n.x, oy: n.y, moved: false, before: m };
    else gesture.current = { mode: 'pan', sx: p.x, sy: p.y, moved: false };
  };
  const onMove = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e), g = gesture.current;
    pointers.current.set(e.pointerId, p);
    if (!g) return;
    if (g.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let v = view.current;
      if (g.dist > 0 && d > 0) v = zoomAt(v, mx, my, d / g.dist);
      setView({ ...v, x: v.x + mx - g.mx, y: v.y + my - g.my });
      g.dist = d; g.mx = mx; g.my = my;
    } else if (g.mode === 'pan') {
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < DRAG_START) return;
      g.moved = true;
      setView({ ...view.current, x: view.current.x + p.x - prev.x, y: view.current.y + p.y - prev.y });
    } else if (g.mode === 'node') {
      if (live.current.linking) return;   // while linking, a press on a box only picks it
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < DRAG_START) return;
      if (!g.moved) { g.moved = true; setSel({ node: g.id }); }
      // always worked out from where the drag began, so the branch keeps its shape; Shift or Alt (or the hand button) moves the one box
      const w = toMap(p), alone = live.current.solo !== (e.shiftKey || e.altKey);
      const next = (alone ? moveNode : moveBranch)(g.before, g.id, g.ox + w.x - g.wx, g.oy + w.y - g.wy);
      const now = findNode(live.current.map, g.id), then = findNode(next, g.id);
      if (now && then && (now.x !== then.x || now.y !== then.y)) put(next);
    } else {
      const n = findNode(live.current.map, g.id);
      if (!n) return;
      const next = setNodeCols(live.current.map, g.id, colsForRight(n, toMap(p).x));
      if (next !== live.current.map) put(next);
    }
  };
  const onUp = (e: RPointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {   // one finger of a pinch lifted: the other carries on panning
      if (g?.mode === 'pinch' && pointers.current.size === 1) { const [r] = [...pointers.current.values()]; gesture.current = { mode: 'pan', sx: r.x, sy: r.y, moved: true }; }
      return;
    }
    gesture.current = null;
    if (!g || g.mode === 'pinch') return;
    if (g.mode === 'pan') { if (!g.moved) tapEmpty(p); return; }
    if (g.mode === 'node' && !g.moved) { tapNode(g.id, p); return; }
    if (live.current.map !== g.before) { if (g.mode === 'node') put(raiseNode(live.current.map, g.id)); record(g.before); }
  };
  const onCancel = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    revert();
    if (pointers.current.size === 0) gesture.current = null;
  };
  useEffect(() => {   // wheel needs a non-passive listener to stop the page scrolling
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); setView(zoomAt(view.current, p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  // keyboard: Enter types in the selected box (there, Tab adds a child), Delete removes, arrows move, N adds a box, F fits, + and - zoom, Ctrl+Z undoes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (live.current.details || live.current.typing || (e.target instanceof Element && e.target.closest('input, textarea, .modal'))) return;
      const s = live.current.sel, node = s && 'node' in s ? findNode(live.current.map, s.node) : undefined;
      const key = e.key.toLowerCase(), onButton = e.target instanceof Element && !!e.target.closest('button');
      if ((e.key === 'Enter' || e.key === ' ') && onButton) return;   // that key presses the button
      if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undo(); }
      else if (e.ctrlKey || e.metaKey) return;
      else if (e.key === 'Escape') { if (live.current.linking) setLinking(null); else setSel(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s) { e.preventDefault(); deleteSelected(); }
      else if ((e.key === 'Enter' || e.key === 'F2') && node) { e.preventDefault(); startTyping(node.id); }
      else if (e.key.startsWith('Arrow') && node) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -MM_GRID : e.key === 'ArrowRight' ? MM_GRID : 0, dy = e.key === 'ArrowUp' ? -MM_GRID : e.key === 'ArrowDown' ? MM_GRID : 0;
        const alone = live.current.solo !== (e.shiftKey || e.altKey);
        const next = (alone ? moveNode : moveBranch)(live.current.map, node.id, node.x + dx, node.y + dy);
        if (commit(next)) reveal(findNode(next, node.id)!);
      }
      else if (key === 'n') { e.preventDefault(); addBox(); }
      else if (key === 'f') fit();
      else if (e.key === '+' || e.key === '=') zoomCentre(1.25);
      else if (e.key === '-') zoomCentre(1 / 1.25);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const detailed = details ? findNode(map, details) : undefined;
  return (
    <div className="mm">
      <div ref={stage} className={`mm-stage ${linking ? 'linking' : ''}`} role="application" aria-label={name} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
        onContextMenu={e => e.preventDefault()}
        onFocus={e => { const nid = (e.target as HTMLElement).dataset?.node; if (nid && !live.current.linking && !live.current.typing) { setSel({ node: nid }); const n = findNode(live.current.map, nid); if (n) reveal(n); } }}>
        <div ref={world} className="mm-world"><Layer map={shown.map} hidden={shown.hidden} sel={sel} linking={linking} typing={typing} api={typeApi} /></div>
        {map.nodes.length === 0 && <div className="mm-hint muted small">{t('mmStart')}<br />{t('mmHelp')}</div>}
      </div>

      <div className="mm-bar mm-top">
        <button type="button" className="mm-ib" aria-label={t('back')} title={t('back')} onClick={() => navigate(LIST)}><Icon name="arrow_stone_left" size={32} /></button>
        <h1 className="mm-name">{name}</h1>
        <button type="button" className="mm-ib mm-undo" aria-label={t('undo')} title={t('undo')} disabled={undoable === 0} onClick={undo}><Icon name="symbol_reset" size={32} /></button>
        <button type="button" className="mm-ib" aria-label={t('mmZoomOut')} title={t('mmZoomOut')} onClick={() => zoomCentre(1 / 1.25)}><Icon name="symbol_minus" size={32} /></button>
        <button type="button" className="mm-ib" aria-label={t('mmZoomIn')} title={t('mmZoomIn')} onClick={() => zoomCentre(1.25)}><Icon name="symbol_plus" size={32} /></button>
        <button type="button" className="mm-ib" aria-label={t('mmFit')} title={t('mmFit')} onClick={fit}><Icon name="symbol_eye_opened" size={32} /></button>
      </div>
      <button type="button" className={`mm-ib mm-solo ${solo ? 'on' : ''}`} aria-pressed={solo} aria-label={t('mmSolo')} title={t('mmSolo')} onClick={() => setSolo(v => !v)}><Icon name="symbol_hand" size={32} /></button>

      <div className="mm-bar mm-bottom">
        {note && <div className="mm-note small" role="status">{note}</div>}
        {selectedNode?.desc && !linking && !typing && (
          <button type="button" className="mm-desc small" aria-label={`${t('description')}: ${selectedNode.desc}`} onClick={() => setDetails(selectedNode.id)}>{selectedNode.desc}</button>
        )}
        {linking ? <>
          <div className="mm-note small" role="status">{t('mmLinkHint')}</div>
          <PixelButton scale={1} size="compact" variant="red" onClick={() => setLinking(null)}>{t('cancel')}</PixelButton>
        </> : typing ? (
          // onPointerDown keeps the focus in the box, so the field does not finish by itself before the click arrives
          <PixelButton scale={1} size="compact" onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()} onClick={() => typeApi.current.finish()}>{t('mmDone')}</PixelButton>
        ) : selectedNode ? <>
          <PixelButton scale={1} size="compact" onClick={() => setDetails(selectedNode.id)}>{t('edit')}</PixelButton>
          <PixelButton scale={1} size="compact" onClick={() => addBox(selectedNode.id)}>{t('mmChild')}</PixelButton>
          {(collapsed.has(selectedNode.id) || branchOf(map, selectedNode.id).size > 1) &&
            <PixelButton scale={1} size="compact" onClick={() => setCollapsed(c => { const n = new Set(c); if (!n.delete(selectedNode.id)) n.add(selectedNode.id); return n; })}>{collapsed.has(selectedNode.id) ? t('mmExpand') : t('mmCollapse')}</PixelButton>}
          <PixelButton scale={1} size="compact" disabled={map.nodes.length < 2} onClick={() => setLinking(selectedNode.id)}>{t('mmLink')}</PixelButton>
          <PixelButton scale={1} size="compact" onClick={() => { actions.addTask({ title: selectedNode.label, category: 'MIND', priority: 'MEDIUM', difficulty: 2, description: selectedNode.desc }); say(t('mmMadeTask', { title: selectedNode.label })); }}>{t('mmToTask')}</PixelButton>
          <PixelButton scale={1} size="compact" onClick={() => { actions.addEvent({ title: selectedNode.label, day: startOfDay(Date.now()), note: selectedNode.desc }); say(t('mmMadeEvent', { title: selectedNode.label })); }}>{t('mmToEvent')}</PixelButton>
          <PixelButton scale={1} size="compact" variant="red" onClick={deleteSelected}>{t('delete')}</PixelButton>
        </> : sel ? (
          <PixelButton scale={1} size="compact" variant="red" onClick={deleteSelected}>{t('mmDeleteLink')}</PixelButton>
        ) : (<>
          <PixelButton scale={1} size="compact" onClick={() => addBox()}>{t('mmAdd')}</PixelButton>
          <PixelButton scale={1} size="compact" disabled={map.nodes.length < 2} onClick={() => { if (commit(tidyMap(live.current.map))) requestAnimationFrame(fit); }}>{t('mmTidy')}</PixelButton>
        </>)}
      </div>

      <NodeDialog open={!!detailed} label={detailed?.label ?? ''} desc={detailed?.desc ?? ''} theme={detailed?.theme ?? DEFAULT_NODE_THEME} onSubmit={submitDetails} onClose={() => setDetails(null)} />
    </div>
  );
}

/** Text, description and frame of a box. */
function NodeDialog({ open, label, desc, theme, onSubmit, onClose }:
  { open: boolean; label: string; desc: string; theme: string; onSubmit: (label: string, desc: string, theme: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(label);
  const [about, setAbout] = useState(desc);
  const [look, setLook] = useState(theme);
  useEffect(() => { if (open) { setText(label); setAbout(desc); setLook(theme); } }, [open, label, desc, theme]);
  const ok = cleanLabel(text).length > 0;
  const submit = () => { if (ok) onSubmit(text, about, look); };
  return (
    <Modal open={open} onClose={onClose} title={t('mmEditBox')} theme="app">
      <div className="mm-form">
        <label className="field">{t('mmText')}
          <input type="text" value={text} maxLength={MM_LABEL_MAX} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        </label>
        <label className="field">{t('description')}
          <textarea value={about} rows={4} maxLength={MM_DESC_MAX} autoFocus={!desc} onChange={e => setAbout(e.target.value)} />
        </label>
        <div className="field">{t('mmStyle')}
          <div className="mm-themes" role="group" aria-label={t('mmStyle')}>
            {NODE_THEMES.map(th => (
              <PixelFrame key={th} as="button" theme={frameOf(th)} scale={1} className={`mm-theme ${look === th ? 'on' : ''}`} aria-pressed={look === th} aria-label={th.replace(/_/g, ' ')} onClick={() => setLook(th)} />
            ))}
          </div>
        </div>
        <div className="row">
          <PixelButton scale={1} disabled={!ok} onClick={submit}>{t('mmSave')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={onClose}>{t('cancel')}</PixelButton>
        </div>
      </div>
    </Modal>
  );
}
