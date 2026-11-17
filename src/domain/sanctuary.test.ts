import { describe, expect, it } from 'vitest';
import {
  GRID, LAYERS, TILES, TILE_WATER, drawOrder, fillLayer, generateIsland, gridToWorld, inBounds, placeBlock, removeBlock, sanitizeBlocks, sanitizeSanctuarySave, tileById, toBlocks, toWorld, topBlock, worldToGrid,
} from './sanctuary';

describe('sanctuary tiles', () => {
  it('has unique ids, all inside the 192x288 sheet, matching Android ids', () => {
    expect(new Set(TILES.map(t => t.id)).size).toBe(TILES.length);
    for (const t of TILES) { expect(t.sx + 32).toBeLessThanOrEqual(192); expect(t.sy + 32).toBeLessThanOrEqual(288); }
    expect(tileById(1)).toMatchObject({ name: 'Cube', palette: 'green', sx: 0, sy: 0 });
    expect(tileById(19)).toMatchObject({ palette: 'gray', sy: 96 });
    expect(tileById(54)).toMatchObject({ name: 'Wall East', palette: 'orange', sx: 160, sy: 256 });
    expect(tileById(55)?.type).toBe('water');
    expect(TILES).toHaveLength(52);
  });
});

describe('sanctuary projection', () => {
  it('maps cells to the screen and back on every layer', () => {
    for (const z of [0, 3]) for (const [x, y] of [[0, 0], [5, 9], [23, 23], [10, 0]]) {
      const p = gridToWorld(x, y, z);
      expect(worldToGrid(p.x, p.y, z)).toEqual({ x, y });
      expect(worldToGrid(p.x + 3, p.y - 2, z)).toEqual({ x, y });   // anywhere inside the diamond
    }
    expect(worldToGrid(9999, 0, 0)).toBeNull();
  });
  it('draws far and low blocks first', () => {
    const o = drawOrder([[2, 2, 0, 1], [0, 0, 1, 1], [0, 0, 0, 1], [1, 0, 0, 1]]);
    expect(o.map(b => b.slice(0, 3).join())).toEqual(['0,0,0', '0,0,1', '1,0,0', '2,2,0']);
  });
});

describe('sanctuary editing', () => {
  it('places, replaces, removes and rejects bad cells', () => {
    const w = toWorld([]);
    expect(placeBlock(w, 1, 1, 0, 1)).toBe(true);
    expect(placeBlock(w, 1, 1, 0, 1)).toBe(false);          // same tile: no change
    expect(placeBlock(w, 1, 1, 0, 19)).toBe(true);          // replaced
    expect(w.size).toBe(1);
    expect(placeBlock(w, GRID, 0, 0, 1)).toBe(false);
    expect(placeBlock(w, 0, 0, LAYERS, 1)).toBe(false);
    expect(placeBlock(w, 0, 0, 0, 9999)).toBe(false);       // unknown tile
    expect(removeBlock(w, 1, 1, 0)).toBe(true);
    expect(removeBlock(w, 1, 1, 0)).toBe(false);
  });
  it('fills a layer and finds the top of a column', () => {
    const w = toWorld([]);
    fillLayer(w, 0, 8); fillLayer(w, 1, 1);
    expect(w.size).toBe(GRID * GRID * 2);
    expect(topBlock(w, 3, 4)?.[2]).toBe(1);
    expect(topBlock(toWorld([]), 0, 0)).toBeUndefined();
  });
});

describe('island generator', () => {
  it('is deterministic, in bounds, has water at the corners and land in the middle', () => {
    const a = generateIsland({ seed: 42 }), b = generateIsland({ seed: 42 }), c = generateIsland({ seed: 43 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.every(([x, y, z, t]) => inBounds(x, y, z) && !!tileById(t))).toBe(true);
    const w = toWorld(a);
    expect(w.get(0)?.[3]).toBe(TILE_WATER);                       // corner (0,0,0)
    expect(topBlock(w, 12, 12)?.[3]).not.toBe(TILE_WATER);        // centre is land
    expect(new Set(a.map(([x, y]) => `${x},${y}`)).size).toBe(GRID * GRID);   // every column has something
  });
});

describe('sanctuary saving', () => {
  it('drops junk, duplicates and out-of-range blocks', () => {
    expect(sanitizeBlocks([[0, 0, 0, 1], [0, 0, 0, 19], [99, 0, 0, 1], 'x', [1, 1, 1], [1.5, 0, 0, 1], [2, 2, 0, 12345]])).toEqual([[0, 0, 0, 19]]);
    expect(sanitizeBlocks('nope')).toEqual([]);
  });
  it('normalises a whole save', () => {
    expect(sanitizeSanctuarySave(null)).toEqual({ levels: [], draft: [] });
    const s = sanitizeSanctuarySave({ levels: [{ id: 'a', name: '  Home  ', blocks: [[1, 1, 0, 1]], updatedAt: 5 }, { name: 'no id' }, 7], draft: [[2, 2, 0, 8]] });
    expect(s.levels).toEqual([{ id: 'a', name: 'Home', blocks: [[1, 1, 0, 1]], updatedAt: 5 }]);
    expect(s.draft).toEqual([[2, 2, 0, 8]]);
    expect(toBlocks(toWorld(s.draft))).toEqual(s.draft);
  });
});
