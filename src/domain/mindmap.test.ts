import { describe, expect, it } from 'vitest';
import {
  MAX_MAP_NODES, MAX_MIND_MAPS, MM_FIT_MAX_ZOOM, MM_MAX_ZOOM, MM_MIN_W, MM_MIN_ZOOM, addLink, addNode, anchor, canLink, childSpot, colsForRight, curveDistance, curvePath,
  curvePoint, fitView, freeSpot, linkAt, linkCurve, mapBounds, moveNode, newMindMap, nodeAt, nodeSize, raiseNode, removeLink, removeNode, sanitizeMindMap,
  sanitizeMindMaps, branchOf, cleanDesc, linkCurves, moveBranch, setNodeDesc, setNodeCols, setNodeLabel, setNodeTheme, snap, wrapLabel, zoomAt, type MindMap,
} from './mindmap';

const empty = () => newMindMap('m', 'Test', 0);
/** a (0,0) and b (160,0) side by side, c (0,96) under a */
const three = (): MindMap => addNode(addNode(addNode(empty(), 'a', 'A', 0, 0), 'b', 'B', 160, 0), 'c', 'C', 0, 96);
const NO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };

describe('labels and box size', () => {
  it('wraps at spaces and breaks only words that are too long', () => {
    expect(wrapLabel('learn to play the guitar', 10)).toEqual(['learn to', 'play the', 'guitar']);
    expect(wrapLabel('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrapLabel('', 5)).toEqual(['']);
    for (const l of wrapLabel('a supercalifragilistic word here', 8)) expect(l.length).toBeLessThanOrEqual(8);
  });
  it('a box is as big as its text, on the grid, and never tiny', () => {
    const one = nodeSize('Idea');
    expect(one).toMatchObject({ w: 56, h: 32, lines: ['Idea'] });
    expect(nodeSize('A').w).toBe(MM_MIN_W);
    const two = nodeSize('learn to play the guitar');
    expect(two.lines.length).toBe(2);
    expect(two.h).toBeGreaterThan(one.h);
    for (const s of [one, two]) { expect(s.w % 8).toBe(0); expect(s.h % 8).toBe(0); }
    // far smaller than Android's fixed 200x50 box for a short label
    expect(one.w * one.h).toBeLessThan(200 * 50 / 4);
  });
  it('a narrower wrap width makes a box narrower and taller', () => {
    const m = setNodeCols(addNode(empty(), 'a', 'learn to play the guitar', 0, 0), 'a', 6);
    const wide = nodeSize('learn to play the guitar');
    expect(m.nodes[0].w).toBeLessThan(wide.w);
    expect(m.nodes[0].h).toBeGreaterThan(wide.h);
    expect(colsForRight(m.nodes[0], 24 + 10 * 8)).toBe(10);
    expect(colsForRight(m.nodes[0], -500)).toBe(3);
    // narrower than the longest word: the word stays whole
    expect(nodeSize('Practise chords every day', 3).lines).toEqual(['Practise', 'chords', 'every', 'day']);
    expect(nodeSize('abcdefghijklmnopqrstuvwxyz', 3).lines[0]).toHaveLength(14);
  });
});

describe('editing', () => {
  it('adds boxes on the grid and cleans the label', () => {
    const m = addNode(empty(), 'a', '  two   words ', 13, -13, 'nope');
    expect(m.nodes[0]).toMatchObject({ x: 16, y: -16, label: 'two words', theme: 'green_ornate' });
    expect(snap(-3)).toBe(0);
    expect(Object.is(snap(-3), -0)).toBe(false);
  });
  it('returns the same map when nothing changes', () => {
    const m = three();
    expect(moveNode(m, 'a', 1, 2)).toBe(m);
    expect(setNodeLabel(m, 'a', 'A')).toBe(m);
    expect(setNodeTheme(m, 'a', 'not a theme')).toBe(m);
    expect(moveNode(m, 'zz', 50, 50)).toBe(m);
    expect(removeNode(m, 'zz')).toBe(m);
    expect(moveNode(m, 'a', 40, 8).nodes[0]).toMatchObject({ x: 40, y: 8 });
  });
  it('a new label resizes the box', () => {
    const m = setNodeLabel(three(), 'a', 'a much longer label');
    expect(m.nodes[0].w).toBeGreaterThan(MM_MIN_W);
  });
  it('links once, in either direction, and never to itself', () => {
    let m = addLink(three(), 'l1', 'a', 'b');
    expect(m.links).toHaveLength(1);
    expect(canLink(m, 'a', 'b')).toBe(false);
    expect(canLink(m, 'b', 'a')).toBe(false);
    expect(canLink(m, 'a', 'a')).toBe(false);
    expect(canLink(m, 'a', 'zz')).toBe(false);
    expect(addLink(m, 'l2', 'b', 'a')).toBe(m);
    m = addLink(m, 'l2', 'a', 'c');
    expect(removeLink(m, 'l1').links.map(l => l.id)).toEqual(['l2']);
  });
  it('deleting a box deletes its links', () => {
    const m = removeNode(addLink(addLink(three(), 'l1', 'a', 'b'), 'l2', 'b', 'c'), 'a');
    expect(m.nodes.map(n => n.id)).toEqual(['b', 'c']);
    expect(m.links.map(l => l.id)).toEqual(['l2']);
  });
  it('stops at the box limit', () => {
    let m = empty();
    for (let i = 0; i < MAX_MAP_NODES + 5; i++) m = addNode(m, `n${i}`, 'x', i * 64, 0);
    expect(m.nodes).toHaveLength(MAX_MAP_NODES);
  });
  it('new boxes do not land on top of others', () => {
    const m = three(), a = m.nodes[0];
    const p = freeSpot(m, 0, 0, a.w, a.h);
    expect(p.y).toBeGreaterThanOrEqual(a.y + a.h);
    expect(p.y).toBeLessThan(96);
    const c1 = childSpot(m, 'a', 'kid')!;
    expect(c1.x).toBeGreaterThan(a.x + a.w);
    const m2 = addNode(m, 'k1', 'kid', c1.x, c1.y);
    const c2 = childSpot(m2, 'a', 'kid')!;
    expect(c2.x).toBe(c1.x);
    expect(c2.y).toBeGreaterThan(c1.y);
    expect(childSpot(m, 'zz', 'kid')).toBeNull();
  });
});

describe('branches and descriptions', () => {
  // a -> b -> c, a -> d, and e on its own; c links back to a (a loop must not hang)
  const tree = () => {
    let m = empty();
    for (const [id, x] of [['a', 0], ['b', 96], ['c', 192], ['d', 288], ['e', 384]] as const) m = addNode(m, id, id, x, 0);
    return addLink(addLink(addLink(m, 'l1', 'a', 'b'), 'l2', 'b', 'c'), 'l3', 'a', 'd');
  };
  it('a branch is a box and everything linked under it', () => {
    expect([...branchOf(tree(), 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...branchOf(tree(), 'b')].sort()).toEqual(['b', 'c']);
    expect([...branchOf(tree(), 'e')]).toEqual(['e']);
    const loop = { ...tree(), links: [...tree().links, { id: 'l4', from: 'c', to: 'a' }] };
    expect([...branchOf(loop, 'b')].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('moving a box carries its branch and nothing else', () => {
    const m = moveBranch(tree(), 'b', 96 + 40, 16);
    expect(m.nodes.map(n => [n.id, n.x, n.y])).toEqual([['a', 0, 0], ['b', 136, 16], ['c', 232, 16], ['d', 288, 0], ['e', 384, 0]]);
    expect(moveBranch(tree(), 'b', 97, 1)).toEqual(tree());
    const t = tree();
    expect(moveBranch(t, 'b', 96, 0)).toBe(t);
    expect(moveBranch(t, 'zz', 5, 5)).toBe(t);
  });
  it('a description is kept, trimmed, and removed when emptied', () => {
    const m = setNodeDesc(three(), 'a', '  first line  \r\nsecond  ');
    expect(m.nodes[0].desc).toBe('first line\nsecond');
    expect(m.nodes[0]).toMatchObject({ w: 48, h: 32 });   // the box itself does not grow
    expect('desc' in setNodeDesc(m, 'a', '   ').nodes[0]).toBe(false);
    expect(setNodeDesc(m, 'a', 'first line\nsecond')).toBe(m);
    expect(cleanDesc('x'.repeat(900))).toHaveLength(500);
    expect(sanitizeMindMap({ id: 'm', nodes: [{ id: 'a', label: 'A', desc: ' note ' }, { id: 'b', label: 'B', desc: 5 }] })!.nodes.map(n => n.desc)).toEqual(['note', undefined]);
  });
});

describe('links and hit tests', () => {
  it('a link leaves from the side that faces the other box', () => {
    const [a, b, c] = three().nodes;
    expect(anchor(a, b)).toMatchObject({ x: a.x + a.w, y: a.y + a.h / 2, nx: 1, ny: 0 });
    expect(anchor(b, a)).toMatchObject({ x: b.x, nx: -1 });
    expect(anchor(a, c)).toMatchObject({ y: a.y + a.h, ny: 1 });
    expect(anchor(c, a)).toMatchObject({ y: c.y, ny: -1 });
  });
  it('the curve runs from one side to the other', () => {
    const [a, b] = three().nodes, c = linkCurve(a, b);
    expect(curvePoint(c, 0)).toEqual({ x: a.x + a.w, y: a.y + a.h / 2 });
    expect(curvePoint(c, 1)).toEqual({ x: b.x, y: b.y + b.h / 2 });
    expect(curvePath(c)).toMatch(/^M48 16C/);
    expect(curveDistance(c, 100, 16)).toBeLessThan(0.5);
    expect(curveDistance(c, 100, 60)).toBeGreaterThan(40);
  });
  it('links on the same side of a box are spread out, in the order of the boxes they lead to', () => {
    // a on the left; three boxes stacked to its right, linked in a mixed order
    let m = addNode(empty(), 'a', 'A', 0, 96);
    for (const [id, y] of [['top', 0], ['mid', 96], ['low', 192]] as const) m = addNode(m, id, id, 200, y);
    m = addLink(addLink(addLink(m, 'l-low', 'a', 'low'), 'l-top', 'a', 'top'), 'l-mid', 'a', 'mid');
    const c = linkCurves(m), a = m.nodes[0];
    const ys = ['l-top', 'l-mid', 'l-low'].map(id => c.get(id)!.y0);
    expect(new Set(ys).size).toBe(3);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    for (const y of ys) { expect(y).toBeGreaterThan(a.y); expect(y).toBeLessThan(a.y + a.h); }
    expect(ys[1]).toBe(a.y + a.h / 2);
    for (const id of ['l-top', 'l-mid', 'l-low']) expect(c.get(id)!.x0).toBe(a.x + a.w);
    // a single link on a side still leaves from the middle, exactly like linkCurve
    const one = addLink(three(), 'l1', 'a', 'b');
    expect(linkCurves(one).get('l1')).toEqual(linkCurve(one.nodes[0], one.nodes[1]));
  });
  it('finds the top box and the nearest link', () => {
    let m = addLink(three(), 'l1', 'a', 'b');
    expect(nodeAt(m, 10, 10)?.id).toBe('a');
    expect(nodeAt(m, 100, 10)).toBeUndefined();
    expect(linkAt(m, 100, 18, 6)?.id).toBe('l1');
    expect(linkAt(m, 100, 60, 6)).toBeUndefined();
    m = addNode(m, 'top', 'T', 8, 8);
    expect(nodeAt(m, 20, 20)?.id).toBe('top');
    expect(nodeAt(raiseNode(m, 'a'), 20, 20)?.id).toBe('a');
    expect(raiseNode(m, 'top')).toBe(m);
  });
});

describe('view', () => {
  it('fits the whole map into the free area', () => {
    const m = three(), b = mapBounds(m)!;
    expect(b).toEqual({ left: 0, top: 0, right: 208, bottom: 128 });
    const v = fitView(b, 360, 640, 1, { top: 40, right: 0, bottom: 60, left: 0 });
    const k = v.zoom;
    expect(v.x + b.left * k).toBeGreaterThanOrEqual(0);
    expect(v.x + b.right * k).toBeLessThanOrEqual(360);
    expect(v.y + b.top * k).toBeGreaterThanOrEqual(40);
    expect(v.y + b.bottom * k).toBeLessThanOrEqual(580);
  });
  it('does not blow a small map up, and zooms a huge one out only so far', () => {
    expect(fitView(mapBounds(addNode(empty(), 'a', 'A', 0, 0)), 1920, 1080, 1, NO_MARGIN).zoom).toBe(MM_FIT_MAX_ZOOM);
    const far = addNode(addNode(empty(), 'a', 'A', 0, 0), 'b', 'B', 90000, 0);
    expect(fitView(mapBounds(far), 360, 640, 1, NO_MARGIN).zoom).toBe(MM_MIN_ZOOM);
    expect(fitView(null, 360, 640, 2, NO_MARGIN)).toEqual({ x: 180, y: 320, zoom: 1.5 });
    expect(mapBounds(empty())).toBeNull();
  });
  it('zooms about a point and stays in range', () => {
    const v = zoomAt({ x: 100, y: 50, zoom: 1 }, 200, 100, 2);
    expect(v).toEqual({ zoom: 2, x: 0, y: 0 });   // the map point under (200, 100) is still there
    expect(zoomAt(v, 0, 0, 100).zoom).toBe(MM_MAX_ZOOM);
    expect(zoomAt(v, 0, 0, 0.001).zoom).toBe(MM_MIN_ZOOM);
  });
});

describe('saving', () => {
  it('keeps what is valid and works sizes out again', () => {
    const m = sanitizeMindMap({ id: 'm', name: '  My   map ', updatedAt: 5, nodes: [
      { id: 'a', label: 'A', x: 3, y: 5, w: 9999, h: 9999, theme: 'gold' },
      { id: 'a', label: 'again', x: 0, y: 0 },
      { id: 'b', label: 'B', x: 'left', y: NaN, theme: 7, cols: 999 },
      { label: 'no id' }, null, 'junk',
    ], links: [{ id: 'l1', from: 'a', to: 'b' }, { id: 'l2', from: 'b', to: 'a' }, { id: 'l3', from: 'a', to: 'gone' }, { id: 'l4', from: 'a', to: 'a' }, 4] })!;
    expect(m.name).toBe('My map');
    expect(m.nodes).toEqual([
      { id: 'a', x: 0, y: 8, w: 48, h: 32, label: 'A', theme: 'gold' },
      { id: 'b', x: 0, y: 0, w: 48, h: 32, label: 'B', theme: 'green_ornate', cols: 40 },
    ]);
    expect(m.links).toEqual([{ id: 'l1', from: 'a', to: 'b' }]);
  });
  it('survives garbage and caps the list', () => {
    expect(sanitizeMindMaps(undefined)).toEqual({ list: [] });
    expect(sanitizeMindMaps({ list: 'no' })).toEqual({ list: [] });
    expect(sanitizeMindMap({ name: 'no id' })).toBeNull();
    expect(sanitizeMindMap({ id: 'x' })).toMatchObject({ name: 'Mind map', nodes: [], links: [], updatedAt: 0 });
    const many = { list: Array.from({ length: MAX_MIND_MAPS + 10 }, (_, i) => ({ id: `m${i % (MAX_MIND_MAPS + 5)}`, name: 'x' })) };
    expect(sanitizeMindMaps(many).list).toHaveLength(MAX_MIND_MAPS);
    expect(sanitizeMindMaps({ list: [{ id: 'a' }, { id: 'a' }, 3] }).list).toHaveLength(1);
  });
});
