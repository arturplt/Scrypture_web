/**
 * A mind map as a PNG picture, for saving or sharing. The boxes are drawn as plain bordered rectangles in their frame's
 * colours (the pixel-art frames are CSS border images, which a canvas cannot borrow), with the labels in the app's pixel font.
 */
import { MM_LINE, MM_PAD_X, MM_PAD_Y, arrowHead, curvePath, linkCurves, mapBounds, nodeSize, type MindMap } from '../domain';

/** Fill, border and text colour per box frame, picked from each frame's sprite. */
const THEME_COLOURS: Record<string, [string, string, string]> = {
  green_ornate: ['#2f5a2a', '#9fcf5a', '#f4f1dc'], green_gold_ornamental: ['#2f5a2a', '#e5b844', '#f4f1dc'], blue_ornate: ['#1f3f6b', '#8fc3ff', '#f4f1dc'],
  green: ['#3b7a32', '#1d3d19', '#f4f1dc'], blue: ['#2c5ea8', '#16305a', '#f4f1dc'], orange: ['#d9822b', '#6b3a10', '#1e1408'], red: ['#b23a3a', '#561616', '#f4f1dc'], gold: ['#e5b844', '#6b4f10', '#1e1408'],
};
const BG = '#1b1f1a', LINK = '#e8e5d2';
/** Pixels per map unit, and the empty border round the map (units). */
const SCALE = 2, MARGIN = 24;

/** Draw the map onto a new canvas. Null for a map with no boxes. */
export async function mapPicture(m: MindMap): Promise<HTMLCanvasElement | null> {
  const b = mapBounds(m);
  if (!b) return null;
  // the font may not have been used on this page yet: a canvas would quietly fall back to another one
  try { await document.fonts.load(`${8 * SCALE}px 'Press Start 2P'`); } catch { /* draw with whatever font there is */ }
  const w = b.right - b.left + 2 * MARGIN, h = b.bottom - b.top + 2 * MARGIN;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SCALE); c.height = Math.ceil(h * SCALE);
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = BG; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(SCALE, 0, 0, SCALE, (MARGIN - b.left) * SCALE, (MARGIN - b.top) * SCALE);
  g.strokeStyle = LINK; g.lineWidth = 1.5; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const cv of linkCurves(m).values()) g.stroke(new Path2D(curvePath(cv) + arrowHead(cv)));
  g.font = `8px 'Press Start 2P', monospace`; g.textBaseline = 'top';
  for (const n of m.nodes) {
    const [fill, edge, text] = THEME_COLOURS[n.theme] ?? THEME_COLOURS.green_ornate;
    g.fillStyle = fill; g.fillRect(n.x, n.y, n.w, n.h);
    g.strokeStyle = edge; g.lineWidth = 3; g.strokeRect(n.x + 1.5, n.y + 1.5, n.w - 3, n.h - 3);
    g.fillStyle = text;
    const lines = nodeSize(n.label, n.cols).lines, top = n.y + MM_PAD_Y + (n.h - 2 * MM_PAD_Y - lines.length * MM_LINE) / 2 + 1;
    lines.forEach((line, i) => g.fillText(line, n.x + MM_PAD_X, top + i * MM_LINE));
  }
  return c;
}

/** Save the map as `<name>.png`. Returns false when there was nothing to draw. */
export async function downloadMapPicture(m: MindMap): Promise<boolean> {
  const c = await mapPicture(m);
  if (!c) return false;
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
  if (!blob) return false;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${m.name.replace(/[\\/:*?"<>|]+/g, '_') || 'mind-map'}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}
