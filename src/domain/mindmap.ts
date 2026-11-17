/**
 * Mind map: boxes with a label, joined by curved links, on an endless canvas. Ported from Android's Mind Map creator
 * (`MindMapStateManager`, `CurveCalculator`, `HitTestUtility`, `GridSnapUtility`). Pure functions only; the editor lives in
 * `screens/MindMapEditor.tsx`.
 *
 * All lengths are interface units (one unit = one sprite pixel at zoom 1), the same unit the rest of the UI is drawn in.
 *
 * Deliberate differences from Android (see BACKLOG.md): a box is as big as its text (Android: fixed 200x50 that could only
 * grow, in steps of 50), the grid is 8 units (Android: 50), a link leaves a box straight out of its side (Android: an S-curve),
 * and two boxes can be linked only once.
 */

export interface MapNode { id: string; x: number; y: number; w: number; h: number; label: string; theme: string; /** widest line, in characters (unset = automatic) */ cols?: number; /** a longer note about the box */ desc?: string }
export interface MapLink { id: string; from: string; to: string }
export interface MindMap { id: string; name: string; nodes: MapNode[]; links: MapLink[]; updatedAt: number }
export interface MindMapsSave { list: MindMap[] }
export const emptyMindMaps = (): MindMapsSave => ({ list: [] });

export const MM_GRID = 8;
/** The pixel font is monospace: every character is one em wide, so a label's size is known without measuring it. */
export const MM_CHAR = 8, MM_LINE = 10;
/** Frame border plus padding, on each side. */
export const MM_PAD_X = 12, MM_PAD_Y = 11;
export const MM_MIN_W = 48;
export const MM_COLS = 14, MM_MIN_COLS = 3, MM_MAX_COLS = 40;
export const MM_LABEL_MAX = 80, MM_NAME_MAX = 40, MM_DESC_MAX = 500;
export const MAX_MIND_MAPS = 30, MAX_MAP_NODES = 200, MAX_MAP_LINKS = 400;
export const MM_MIN_ZOOM = 0.25, MM_MAX_ZOOM = 3, MM_FIT_MAX_ZOOM = 2;
/** An empty map opens a little enlarged, so the first box's text is easy to read on a phone. */
export const MM_EMPTY_ZOOM = 1.5;
const MM_LIMIT = 100000;   // boxes stay within this distance of the origin

/** Frames a box can use: the same eight as Android's `NodeThemeManager`. */
export const NODE_THEMES = ['green_ornate', 'green_gold_ornamental', 'blue_ornate', 'green', 'blue', 'orange', 'red', 'gold'] as const;
export const DEFAULT_NODE_THEME = 'green_ornate';
export const isNodeTheme = (name: unknown): name is string => typeof name === 'string' && (NODE_THEMES as readonly string[]).includes(name);

interface Pt { x: number; y: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Nearest grid line (+ 0 turns -0 into 0). */
export const snap = (v: number) => Math.round(v / MM_GRID) * MM_GRID + 0;
const snapUp = (v: number) => Math.ceil(v / MM_GRID) * MM_GRID;

export const cleanLabel = (label: string) => label.replace(/\s+/g, ' ').trim().slice(0, MM_LABEL_MAX);
/** A description keeps its line breaks. */
export const cleanDesc = (desc: string) => desc.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, MM_DESC_MAX);
export const cleanMapName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MM_NAME_MAX);
export const clampCols = (cols: number) => clamp(Math.round(cols), MM_MIN_COLS, MM_MAX_COLS);

/**
 * Break a label into lines of at most `cols` characters: at spaces where possible; a word longer than a line starts a new
 * line and is cut there. (The same rule a browser follows, so the field you type in breaks the text like the finished box.)
 */
export function wrapLabel(label: string, cols: number = MM_COLS): string[] {
  const max = Math.max(1, Math.floor(cols));
  const lines: string[] = [];
  let line = '';
  for (let word of label.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length <= max) { line += ` ${word}`; continue; }
    if (line) lines.push(line);
    while (word.length > max) { lines.push(word.slice(0, max)); word = word.slice(max); }
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * The size of a box that just fits its label, and the lines to draw in it. A wrap width chosen by hand never cuts a word
 * that fits on an automatic line: the box stops getting narrower at its longest word.
 */
export function nodeSize(label: string, cols?: number): { w: number; h: number; lines: string[] } {
  const longest = label.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  const lines = wrapLabel(label, cols === undefined ? MM_COLS : Math.max(cols, Math.min(longest, MM_COLS)));
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return { w: Math.max(MM_MIN_W, snapUp(2 * MM_PAD_X + widest * MM_CHAR)), h: snapUp(2 * MM_PAD_Y + lines.length * MM_LINE), lines };
}

function sized(n: Omit<MapNode, 'w' | 'h'>): MapNode {
  const { w, h } = nodeSize(n.label, n.cols);
  return { ...n, w, h };
}

// ---- editing (immutable: every function returns a new map, or the same one when nothing changed) ---------------------

export const findNode = (m: MindMap, id: string) => m.nodes.find(n => n.id === id);

export function addNode(m: MindMap, id: string, label: string, x: number, y: number, theme: string = DEFAULT_NODE_THEME): MindMap {
  if (m.nodes.length >= MAX_MAP_NODES || findNode(m, id)) return m;
  const n = sized({ id, x: snap(x), y: snap(y), label: cleanLabel(label), theme: isNodeTheme(theme) ? theme : DEFAULT_NODE_THEME });
  return { ...m, nodes: [...m.nodes, n] };
}

function patchNode(m: MindMap, id: string, change: (n: MapNode) => MapNode): MindMap {
  const old = findNode(m, id);
  if (!old) return m;
  const next = change(old);
  const same = next.x === old.x && next.y === old.y && next.w === old.w && next.h === old.h && next.label === old.label && next.theme === old.theme && next.cols === old.cols && next.desc === old.desc;
  return same ? m : { ...m, nodes: m.nodes.map(n => (n === old ? next : n)) };
}

export const moveNode = (m: MindMap, id: string, x: number, y: number) =>
  patchNode(m, id, n => ({ ...n, x: clamp(snap(x), -MM_LIMIT, MM_LIMIT), y: clamp(snap(y), -MM_LIMIT, MM_LIMIT) }));
export const setNodeLabel = (m: MindMap, id: string, label: string) => patchNode(m, id, n => sized({ ...n, label: cleanLabel(label) }));
export const setNodeTheme = (m: MindMap, id: string, theme: string) => patchNode(m, id, n => (isNodeTheme(theme) ? { ...n, theme } : n));
export const setNodeDesc = (m: MindMap, id: string, desc: string) => patchNode(m, id, n => {
  const { desc: _old, ...rest } = n, d = cleanDesc(desc);
  return d ? { ...rest, desc: d } : rest;
});
/** How wide the box may get before its text wraps. */
export const setNodeCols = (m: MindMap, id: string, cols: number) => patchNode(m, id, n => sized({ ...n, cols: clampCols(cols) }));
/** The wrap width that puts the right edge of a box nearest to `right` (dragging the resize handle). */
export const colsForRight = (n: MapNode, right: number) => clampCols((right - n.x - 2 * MM_PAD_X) / MM_CHAR);

/** A box and everything under it: the boxes reached by following links away from it (a link points from parent to child). */
export function branchOf(m: MindMap, id: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const l of m.links) { const k = kids.get(l.from); if (k) k.push(l.to); else kids.set(l.from, [l.to]); }
  const out = new Set([id]), todo = [id];
  while (todo.length) for (const k of kids.get(todo.pop()!) ?? []) if (!out.has(k)) { out.add(k); todo.push(k); }
  return out;
}

/** Move a box to (x, y) and carry its whole branch along by the same distance. */
export function moveBranch(m: MindMap, id: string, x: number, y: number): MindMap {
  const n = findNode(m, id);
  if (!n) return m;
  const dx = clamp(snap(x), -MM_LIMIT, MM_LIMIT) - n.x, dy = clamp(snap(y), -MM_LIMIT, MM_LIMIT) - n.y;
  if (!dx && !dy) return m;
  const ids = branchOf(m, id);
  return { ...m, nodes: m.nodes.map(b => (ids.has(b.id) ? { ...b, x: clamp(b.x + dx, -MM_LIMIT, MM_LIMIT), y: clamp(b.y + dy, -MM_LIMIT, MM_LIMIT) } : b)) };
}

/** Delete a box and every link that touches it. */
export function removeNode(m: MindMap, id: string): MindMap {
  if (!findNode(m, id)) return m;
  return { ...m, nodes: m.nodes.filter(n => n.id !== id), links: m.links.filter(l => l.from !== id && l.to !== id) };
}

/** Draw a box above the others (the last one in the list is on top). */
export function raiseNode(m: MindMap, id: string): MindMap {
  const n = findNode(m, id);
  return !n || m.nodes[m.nodes.length - 1] === n ? m : { ...m, nodes: [...m.nodes.filter(x => x !== n), n] };
}

export const linked = (m: MindMap, a: string, b: string) => m.links.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
/** Two different, existing boxes that are not linked yet (in either direction). */
export const canLink = (m: MindMap, from: string, to: string) =>
  from !== to && m.links.length < MAX_MAP_LINKS && !!findNode(m, from) && !!findNode(m, to) && !linked(m, from, to);
export const addLink = (m: MindMap, id: string, from: string, to: string): MindMap =>
  (canLink(m, from, to) && !m.links.some(l => l.id === id) ? { ...m, links: [...m.links, { id, from, to }] } : m);
export const removeLink = (m: MindMap, id: string): MindMap => (m.links.some(l => l.id === id) ? { ...m, links: m.links.filter(l => l.id !== id) } : m);

// ---- placing new boxes ---------------------------------------------------------------------------------------------

const GAP = MM_GRID;
const overlaps = (m: MindMap, x: number, y: number, w: number, h: number) =>
  m.nodes.some(n => x < n.x + n.w + GAP && x + w + GAP > n.x && y < n.y + n.h + GAP && y + h + GAP > n.y);

/** The nearest free place at or below (x, y) for a box of this size. */
export function freeSpot(m: MindMap, x: number, y: number, w: number, h: number): Pt {
  const p = { x: snap(x), y: snap(y) };
  for (let i = 0; i < MAX_MAP_NODES * 4 && overlaps(m, p.x, p.y, w, h); i++) p.y += MM_GRID;
  return p;
}

/** Where a new child of `parentId` goes: to the right of its parent and level with its middle, or under the children already there. */
export function childSpot(m: MindMap, parentId: string, label: string): Pt | null {
  const p = findNode(m, parentId);
  if (!p) return null;
  const { w, h } = nodeSize(cleanLabel(label));
  return freeSpot(m, p.x + p.w + 4 * MM_GRID, p.y + (p.h - h) / 2, w, h);
}

// ---- links ---------------------------------------------------------------------------------------------------------

export interface Curve { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }

/** Where a link leaves box `a` towards box `b`: the middle of the side that faces it, and which way that side points. */
export function anchor(a: MapNode, b: MapNode): { x: number; y: number; nx: number; ny: number } {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? { x: a.x + a.w / 2, y: a.y, nx: 0, ny: -1 } : { x: a.x + a.w / 2, y: a.y + a.h, nx: 0, ny: 1 };
  return dx < 0 ? { x: a.x, y: a.y + a.h / 2, nx: -1, ny: 0 } : { x: a.x + a.w, y: a.y + a.h / 2, nx: 1, ny: 0 };
}

/** The cubic curve between two boxes: it leaves and arrives at right angles to the sides it touches. */
export function linkCurve(a: MapNode, b: MapNode): Curve {
  return curveBetween(anchor(a, b), anchor(b, a));
}
type Anchor = ReturnType<typeof anchor>;
function curveBetween(p: Anchor, q: Anchor): Curve {
  const d = clamp(Math.hypot(q.x - p.x, q.y - p.y) * 0.4, MM_GRID, 8 * MM_GRID);
  return { x0: p.x, y0: p.y, x1: p.x + p.nx * d, y1: p.y + p.ny * d, x2: q.x + q.nx * d, y2: q.y + q.ny * d, x3: q.x, y3: q.y };
}
/**
 * The curve of every link in the map. Links that share a side of a box are spread evenly along it, in the order of the boxes
 * they lead to, so they neither start from one point nor cross each other on the way out.
 */
export function linkCurves(m: MindMap): Map<string, Curve> {
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  interface End { link: string; far: 0 | 1; node: MapNode; at: Anchor; order: number }
  const sides = new Map<string, End[]>(), ends = new Map<string, [Anchor, Anchor]>();
  for (const l of m.links) {
    const a = byId.get(l.from), b = byId.get(l.to);
    if (!a || !b) continue;
    const pa = anchor(a, b), pb = anchor(b, a);
    ends.set(l.id, [pa, pb]);
    const add = (node: MapNode, other: MapNode, at: Anchor, far: 0 | 1) => {
      const key = `${node.id}|${at.nx}|${at.ny}`, e: End = { link: l.id, far, node, at, order: at.nx ? other.y + other.h / 2 : other.x + other.w / 2 };
      const list = sides.get(key);
      if (list) list.push(e); else sides.set(key, [e]);
    };
    add(a, b, pa, 0); add(b, a, pb, 1);
  }
  for (const list of sides.values()) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.order - q.order || (p.link < q.link ? -1 : 1));
    list.forEach((e, i) => {
      const t = (i + 0.5) / list.length, n = e.node, vertical = e.at.nx !== 0;
      const len = vertical ? n.h : n.w, inset = Math.min(4, len / 4), pos = (vertical ? n.y : n.x) + inset + t * (len - 2 * inset);
      ends.get(e.link)![e.far] = vertical ? { ...e.at, y: pos } : { ...e.at, x: pos };
    });
  }
  const out = new Map<string, Curve>();
  for (const [id, [p, q]] of ends) out.set(id, curveBetween(p, q));
  return out;
}
export const curvePath = (c: Curve) => `M${c.x0} ${c.y0}C${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x3} ${c.y3}`;
export function curvePoint(c: Curve, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c.x0 + b * c.x1 + d * c.x2 + e * c.x3, y: a * c.y0 + b * c.y1 + d * c.y2 + e * c.y3 };
}
/** Distance from a point to the curve (measured against 24 straight pieces of it). */
export function curveDistance(c: Curve, x: number, y: number): number {
  let best = Infinity, a = curvePoint(c, 0);
  for (let i = 1; i <= 24; i++) {
    const b = curvePoint(c, i / 24), vx = b.x - a.x, vy = b.y - a.y, len = vx * vx + vy * vy;
    const t = len ? clamp(((x - a.x) * vx + (y - a.y) * vy) / len, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - a.x - vx * t, y - a.y - vy * t));
    a = b;
  }
  return best;
}

// ---- hit tests -----------------------------------------------------------------------------------------------------

/** The topmost box under a point. */
export function nodeAt(m: MindMap, x: number, y: number): MapNode | undefined {
  for (let i = m.nodes.length - 1; i >= 0; i--) {
    const n = m.nodes[i];
    if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
  }
  return undefined;
}

/** The link nearest to a point, if it is within `tolerance`. */
export function linkAt(m: MindMap, x: number, y: number, tolerance: number): MapLink | undefined {
  const curves = linkCurves(m);
  let best: MapLink | undefined, bestD = tolerance;
  for (const l of m.links) {
    const c = curves.get(l.id);
    if (!c) continue;
    const d = curveDistance(c, x, y);
    if (d <= bestD) { best = l; bestD = d; }
  }
  return best;
}

// ---- view ----------------------------------------------------------------------------------------------------------

export interface MapBounds { left: number; top: number; right: number; bottom: number }
export function mapBounds(m: MindMap): MapBounds | null {
  if (!m.nodes.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const n of m.nodes) { left = Math.min(left, n.x); top = Math.min(top, n.y); right = Math.max(right, n.x + n.w); bottom = Math.max(bottom, n.y + n.h); }
  return { left, top, right, bottom };
}

/** Screen position of the map's origin (px) and the zoom. One unit is `ui * zoom` px on screen. */
export interface MapView { x: number; y: number; zoom: number }
export const clampMapZoom = (z: number) => clamp(z, MM_MIN_ZOOM, MM_MAX_ZOOM);

/**
 * The view that shows the whole map, centred in what is left of a `width` x `height` px area after the margins (px) taken by
 * the toolbars. An empty map is shown at `MM_EMPTY_ZOOM` with its origin in the middle.
 */
export function fitView(b: MapBounds | null, width: number, height: number, ui: number, margin: { top: number; right: number; bottom: number; left: number }): MapView {
  const w = Math.max(1, width - margin.left - margin.right), h = Math.max(1, height - margin.top - margin.bottom);
  const cx = margin.left + w / 2, cy = margin.top + h / 2;
  if (!b) return { x: Math.round(cx), y: Math.round(cy), zoom: MM_EMPTY_ZOOM };
  const bw = Math.max(1, b.right - b.left), bh = Math.max(1, b.bottom - b.top);
  const zoom = clamp(Math.min(w / (bw * ui), h / (bh * ui)), MM_MIN_ZOOM, MM_FIT_MAX_ZOOM);
  const k = ui * zoom;
  return { x: Math.round(cx - ((b.left + b.right) / 2) * k), y: Math.round(cy - ((b.top + b.bottom) / 2) * k), zoom };
}

/** Zoom by `factor`, keeping the map point under screen point (px, py) where it is. */
export function zoomAt(v: MapView, px: number, py: number, factor: number): MapView {
  const zoom = clampMapZoom(v.zoom * factor), k = zoom / v.zoom;
  return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

// ---- saving --------------------------------------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function newMindMap(id: string, name: string, now: number): MindMap {
  return { id, name: cleanMapName(name) || 'Mind map', nodes: [], links: [], updatedAt: now };
}

/** Keep only valid boxes and links from anything (an old save or an import). Sizes are worked out again from the labels. */
export function sanitizeMindMap(raw: unknown): MindMap | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  let m = newMindMap(raw.id, typeof raw.name === 'string' ? raw.name : '', num(raw.updatedAt));
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!isObj(n) || typeof n.id !== 'string' || !n.id || typeof n.label !== 'string') continue;
    m = addNode(m, n.id, n.label, clamp(num(n.x), -MM_LIMIT, MM_LIMIT), clamp(num(n.y), -MM_LIMIT, MM_LIMIT), isNodeTheme(n.theme) ? n.theme : DEFAULT_NODE_THEME);
    if (typeof n.cols === 'number' && Number.isFinite(n.cols)) m = setNodeCols(m, n.id, n.cols);
    if (typeof n.desc === 'string') m = setNodeDesc(m, n.id, n.desc);
  }
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    if (isObj(l) && typeof l.id === 'string' && l.id && typeof l.from === 'string' && typeof l.to === 'string') m = addLink(m, l.id, l.from, l.to);
  }
  return m;
}

export function sanitizeMindMaps(raw: unknown): MindMapsSave {
  const list: MindMap[] = [];
  for (const r of isObj(raw) && Array.isArray(raw.list) ? raw.list : []) {
    const m = sanitizeMindMap(r);
    if (m && !list.some(x => x.id === m.id)) list.push(m);
    if (list.length >= MAX_MIND_MAPS) break;
  }
  return { list };
}

/**
 * Tidy: lay the map out as a tree running left to right. Roots are boxes nothing links to; a link points from parent to child and
 * a box with several parents sits under the first one reached. Separate trees are stacked, and the whole map keeps its top-left corner.
 */
export function tidyMap(m: MindMap): MindMap {
  if (m.nodes.length < 2) return m;
  const GAP_X = 40, GAP_Y = 16, byId = new Map(m.nodes.map(n => [n.id, n]));
  const kids = new Map<string, string[]>(), hasParent = new Set<string>();
  for (const l of m.links) if (byId.has(l.from) && byId.has(l.to)) { (kids.get(l.from) ?? kids.set(l.from, []).get(l.from)!).push(l.to); hasParent.add(l.to); }
  const order = [...m.nodes].sort((a, b) => a.y - b.y || a.x - b.x).map(n => n.id);   // keeps the current up-down order
  const seen = new Set<string>(), depth = new Map<string, number>(), tree = new Map<string, string[]>(), roots: string[] = [];
  const walk = (root: string) => {
    roots.push(root); seen.add(root); depth.set(root, 0);
    const q = [root];
    while (q.length) {
      const id = q.shift()!;
      const mine = (kids.get(id) ?? []).filter(k => !seen.has(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      for (const k of mine) { seen.add(k); depth.set(k, depth.get(id)! + 1); q.push(k); }
      tree.set(id, mine);
    }
  };
  for (const id of order) if (!hasParent.has(id) && !seen.has(id)) walk(id);
  for (const id of order) if (!seen.has(id)) walk(id);   // what is left sits in a loop: start from its topmost box
  // x: one column per depth, as wide as its widest box
  const colW: number[] = [];
  for (const [id, d] of depth) colW[d] = Math.max(colW[d] ?? 0, byId.get(id)!.w);
  const colX: number[] = []; let x = 0;
  colW.forEach((w, d) => { colX[d] = x; x += w + GAP_X; });
  // y: leaves stack, a parent centres on its children
  const pos = new Map<string, number>(); let cursor = 0;
  const place = (id: string): number => {
    const n = byId.get(id)!, ch = tree.get(id) ?? [], start = cursor;
    if (!ch.length) { const y = cursor; cursor += n.h + GAP_Y; pos.set(id, y); return y + n.h / 2; }
    const mids = ch.map(place), mid = (mids[0] + mids[mids.length - 1]) / 2;
    const y = Math.max(start, mid - n.h / 2);   // never up into the box before it
    pos.set(id, y); cursor = Math.max(cursor, y + n.h + GAP_Y);
    return y + n.h / 2;
  };
  for (const r of roots) { place(r); cursor += GAP_Y * 2; }
  const left = Math.min(...m.nodes.map(n => n.x)), top = Math.min(...m.nodes.map(n => n.y));
  const nodes = m.nodes.map(n => ({ ...n, x: clamp(snap(left + colX[depth.get(n.id)!]), -MM_LIMIT, MM_LIMIT), y: clamp(snap(top + pos.get(n.id)!), -MM_LIMIT, MM_LIMIT) }));
  return nodes.every((n, i) => n.x === m.nodes[i].x && n.y === m.nodes[i].y) ? m : { ...m, nodes };
}
