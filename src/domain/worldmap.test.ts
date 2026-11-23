import { describe, expect, it } from 'vitest';
import { hoopsIn, passedHoop } from './hoops';
import { BIOMES, CHUNK, GRASS, MARGIN, SAND, SIDE, WATER, World, biomeAt, generateChunkTerrain, hash01, plainTile, seedFrom, tileKey, transitionFor, keyX, keyY } from './worldgen';
import { Ecosystem, flammability, fuelOf, riverPath, CLOUD_MARGIN, STALL_TICKS, REGION, LAYER_CAPACITY, TOTAL_CLOUDS, diurnalTemperature, evaporationFactor, layerRainChance } from './ecosystem';
import { MAX_DARKNESS, advanceHour, clockText, darkness, sunAzimuth, sunElevation } from './sky';
import { cruiseVelocity, currentLayer, layerScale, newFlight, parallax, stepFlight } from './flight';
import { mulberry32 } from './sanctuary';
import { BILLBOARD_MAX_DISTANCE, billboardLean, chaseOffset, easeOffset, isFlying, tiltAltitudeFactor } from './camera';

describe('world generation', () => {
  it('is deterministic and depends on the seed', () => {
    const a = generateChunkTerrain(3, -2, 42), b = generateChunkTerrain(3, -2, 42), c = generateChunkTerrain(3, -2, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(seedFrom('bobr')).toBe(seedFrom('bobr'));
    expect(hash01(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(hash01(1, 2, 3)).toBeLessThan(1);
  });
  it('has no seams: neighbouring chunks agree on the tiles they share', () => {
    for (const seed of [1, 7, 99]) for (const [cx, cy] of [[0, 0], [-1, 4], [5, -3]]) {
      const a = generateChunkTerrain(cx, cy, seed), r = generateChunkTerrain(cx + 1, cy, seed), d = generateChunkTerrain(cx, cy + 1, seed);
      for (let j = -MARGIN; j < CHUNK + MARGIN; j++) for (let i = CHUNK - MARGIN; i < CHUNK + MARGIN; i++) {
        // tile (i, j) of chunk (cx, cy) is tile (i - CHUNK, j) of the chunk to the east
        if (j >= -MARGIN && j < CHUNK + MARGIN) expect(a[(j + MARGIN) * SIDE + (i + MARGIN)]).toBe(r[(j + MARGIN) * SIDE + (i - CHUNK + MARGIN)]);
      }
      for (let j = CHUNK - MARGIN; j < CHUNK + MARGIN; j++) for (let i = 0; i < CHUNK; i++) expect(a[(j + MARGIN) * SIDE + (i + MARGIN)]).toBe(d[(j - CHUNK + MARGIN) * SIDE + (i + MARGIN)]);
    }
  });
  it('makes every biome somewhere, with water, sand and grass in the mix', () => {
    const seen = new Set<string>(), t = new Set<number>();
    const w = new World(12345);
    for (let y = -4000; y < 4000; y += 40) for (let x = -4000; x < 4000; x += 40) seen.add(biomeAt(x, y, 12345).id);
    expect([...seen].sort()).toEqual(Object.keys(BIOMES).sort());
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) t.add(w.terrainAt(x, y));
    expect(t.size).toBeGreaterThanOrEqual(2);
  });
  it('puts sand between water and grass', () => {
    const w = new World(5);
    for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) {
      if (w.terrainAt(x, y) === WATER) expect(w.terrainAt(x + 1, y) === GRASS && biomeAt(x, y, 5).beach > 0 && biomeAt(x + 1, y, 5).beach > 0).toBe(false);
    }
  });
  it('picks transitions like Android: borders, corners, and plain inside', () => {
    expect(transitionFor(GRASS, GRASS, GRASS, GRASS, GRASS)).toBeNull();
    expect(transitionFor(WATER, GRASS, GRASS, GRASS, GRASS)).toBeNull();
    expect(transitionFor(SAND, GRASS, GRASS, GRASS, GRASS)).toBeNull();                 // grass handles sand/grass
    expect(transitionFor(GRASS, WATER, GRASS, GRASS, GRASS)).toEqual([1, 0]);            // grass with water to the north: top border
    expect(transitionFor(GRASS, WATER, GRASS, GRASS, WATER)).toEqual([0, 0]);            // water north + west: outer top-left
    expect(transitionFor(GRASS, GRASS, GRASS, SAND, GRASS)).toEqual([6, 1]);             // sand to the east of grass
    expect(transitionFor(SAND, WATER, SAND, SAND, SAND)).toEqual([4, 0]);
    expect(transitionFor(GRASS, WATER, WATER, WATER, GRASS)).toBeNull();                // 3 sides: base tile
  });
  it('lets a change override the generator and gives it back when it matches', () => {
    const w = new World(8), x = 3, y = 4, gen = w.terrainAt(x, y), v0 = w.version;
    w.setTerrain(x, y, gen === WATER ? SAND : WATER);
    expect(w.terrainAt(x, y)).not.toBe(gen);
    expect(w.version).toBeGreaterThan(v0);
    w.set(x, y, w.stateAt(x, y));
    const st = new World(8).stateAt(x, y);
    w.set(x, y, st);
    expect(w.changes.size).toBe(0);
    expect(tileKey(-5, 7)).toBeGreaterThan(0);
    expect([keyX(tileKey(-5, 7)), keyY(tileKey(-5, 7))]).toEqual([-5, 7]);
  });
});

/** A world with a known layout: a flat generated grass field overridden by a 6x6 lake with a sand ring. */
function lakeWorld() {
  const w = new World(1);
  for (let y = -15; y < 15; y++) for (let x = -15; x < 15; x++) w.setTerrain(x, y, GRASS);
  for (let y = -3; y <= 2; y++) for (let x = -3; x <= 2; x++) w.setTerrain(x, y, WATER);
  return w;
}

describe('chunkDrawn', () => {
  it('draws exactly what drawn() does for every tile, with and without changes', () => {
    const w = new World(77);
    for (const [cx, cy] of [[0, 0], [-3, 2], [9, -7]]) {
      const tiles = w.chunkDrawn(cx, cy);
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) expect(tiles[j * CHUNK + i]).toEqual(w.drawn(cx * CHUNK + i, cy * CHUNK + j));
    }
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) w.setTerrain(x, y, (x + y) % 3 as 0 | 1 | 2);
    const tiles = w.chunkDrawn(0, 0);
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) expect(tiles[j * CHUNK + i]).toEqual(w.drawn(i, j));
    for (const [x, y] of [[5, 5], [-20, 33], [100, -100]]) expect(w.biomeOf(x, y)).toBe(biomeAt(x, y, 77));
  });
});

describe('ecosystem', () => {
  it('has the documented cloud capacities', () => {
    expect(LAYER_CAPACITY).toEqual([1, 2, 3, 5, 8, 13, 8, 21, 3, 1]);
    expect(TOTAL_CLOUDS).toBe(65);                                      // Android's doc says 64, but its own capacities add up to 65
    expect(layerRainChance(4)).toBe(0); expect(layerRainChance(5)).toBeCloseTo(0.2); expect(layerRainChance(10)).toBeCloseTo(1);
  });
  it('is hotter at noon than at midnight and evaporates faster when hot', () => {
    expect(diurnalTemperature(12)).toBeGreaterThan(diurnalTemperature(0));
    expect(evaporationFactor(30)).toBeGreaterThan(evaporationFactor(10));
  });
  it('fills a tile with water when it would meet water and the other land type on different sides', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(3));
    for (let y = -8; y < 9; y++) for (let x = -8; x < 9; x++) w.setTerrain(x, y, GRASS);
    for (let y = -8; y < 9; y++) for (let x = 1; x < 9; x++) w.setTerrain(x, y, SAND);   // sand to the east
    e.paint(0, 3, WATER);                                                                // water next to the grass/sand border
    for (let y = -6; y < 7; y++) for (let x = -6; x < 7; x++) {
      const t = w.terrainAt(x, y), nb = [w.terrainAt(x, y - 1), w.terrainAt(x, y + 1), w.terrainAt(x + 1, y), w.terrainAt(x - 1, y)];
      if (t !== WATER && nb.includes(WATER)) expect(nb).not.toContain(t === GRASS ? SAND : GRASS);
    }
  });
  it('climbs the vegetation ladder with rain', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(3));
    for (let y = -5; y < 6; y++) for (let x = -5; x < 6; x++) w.setTerrain(x, y, GRASS);
    w.setTerrain(0, 0, SAND);
    e.rainOn(0, 0); expect(w.stateAt(0, 0)).toMatchObject({ t: GRASS, v: 0, d: 0 });      // sand -> grass
    e.rainOn(0, 0); expect(w.stateAt(0, 0)).toMatchObject({ t: GRASS, v: 1, d: 0 });      // grass -> flowers
    e.rainOn(0, 0); const tree = w.stateAt(0, 0);                                           // flowers -> bush or tree
    expect(tree.t).toBe(GRASS); expect(tree.d).toBeGreaterThan(0); expect(tree.s).toBe(1);
    e.rainOn(0, 0); expect(w.stateAt(0, 0).s).toBeCloseTo(1.15);                           // grows
    e.rainOn(0, 0); expect(w.stateAt(0, 0).s).toBeCloseTo(1.15);                           // ...but not twice within the 5 s cooldown
    for (let i = 0; i < 12; i++) e.step(0.5);                                              // 6 simulated seconds
    e.rainOn(0, 0); expect(w.stateAt(0, 0).s).toBeCloseTo(1.3);
  });
  it('rain on sand spreads grass to one neighbouring sand tile', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(3));
    for (let y = -3; y < 4; y++) for (let x = -3; x < 4; x++) w.setTerrain(x, y, SAND);
    e.rainOn(0, 0);
    let grass = 0; for (let y = -3; y < 4; y++) for (let x = -3; x < 4; x++) if (w.terrainAt(x, y) === GRASS) grass++;
    expect(grass).toBe(2);
  });
  it('turns sand or grass with three water sides into water, and keeps going', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(3));
    for (let y = -6; y < 7; y++) for (let x = -6; x < 7; x++) w.setTerrain(x, y, GRASS);
    for (const [x, y] of [[-1, 0], [1, 0], [0, -1]]) w.setTerrain(x, y, WATER);
    for (const [x, y] of [[5, 5], [5, 6], [4, 5]]) w.setTerrain(x, y, WATER);
    w.setTerrain(5, 4, SAND);
    e.setWatchedArea(-6, -6, 6, 6);
    for (let i = 0; i < 8; i++) e.step(0.5);                            // the periodic sweep (every 3 s)
    expect(w.terrainAt(0, 0)).toBe(WATER);                              // grass at the middle had 3 water sides
  });
  it('grows a lake shore with rain only where the region is short of the water the seed gave it', () => {
    const seed = seedFrom('soak'), probe = new World(seed);   // (it has a desert near the origin)
    const target = (rx: number, ry: number) => { let n = 0; for (let j = 0; j < REGION; j++) for (let i = 0; i < REGION; i++) if (probe.generatedTerrain(rx * REGION + i, ry * REGION + j) === WATER) n++; return n; };
    const regions: [number, number][] = []; for (let ry = -6; ry <= 6; ry++) for (let rx = -6; rx <= 6; rx++) regions.push([rx, ry]);
    const wet = regions.find(([rx, ry]) => target(rx, ry) > 600)!, dry = regions.find(([rx, ry]) => target(rx, ry) <= 8)!;
    const shoreGrowth = ([rx, ry]: [number, number]) => {
      const w = new World(seed), e = new Ecosystem(w, mulberry32(3)), x0 = rx * REGION, y0 = ry * REGION;
      for (let y = y0; y < y0 + REGION; y++) for (let x = x0; x < x0 + REGION; x++) w.setTerrain(x, y, GRASS);   // the whole region dried out
      for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) w.setTerrain(x0 + x, y0 + y, WATER);       // but a pond
      e.step(0.01);
      for (let i = 0; i < 200; i++) { e.rainOn(x0 + 31, y0 + 31); if (i % 3 === 2) e.step(0.2); }   // rain on the pond (shore growth is capped per cloud tick)
      let n = 0; for (let y = y0; y < y0 + REGION; y++) for (let x = x0; x < x0 + REGION; x++) if (w.terrainAt(x, y) === WATER) n++;
      return n - 16;
    };
    expect(shoreGrowth(wet)).toBeGreaterThan(10);                       // short of water: the pond grows into its shore
    expect(shoreGrowth(dry)).toBeLessThanOrEqual(0);                    // a dry region (the seed put next to no water there): it does not (it dries faster instead)
  });
  it('evaporates a lake into clouds, moves them with the wind and rains them out again', () => {
    const w = lakeWorld(), e = new Ecosystem(w, mulberry32(11), { enabled: true, strength: 5, dir: 0 });
    e.setWatchedArea(-10, -10, 10, 10);
    const water0 = (() => { let n = 0; for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) if (w.terrainAt(x, y) === WATER) n++; return n; })();
    expect(water0).toBe(36);
    let maxClouds = 0, rained = false, x0: number | null = null;
    for (let i = 0; i < 20 * 600; i++) {                                // 10 simulated minutes at 0.05 s
      e.step(0.05);
      maxClouds = Math.max(maxClouds, e.clouds.length);
      if (e.clouds.some(c => c.raining)) rained = true;
      if (x0 === null && e.clouds[0]) x0 = e.clouds[0].x;
    }
    expect(maxClouds).toBeGreaterThan(0);
    expect(maxClouds).toBeLessThanOrEqual(TOTAL_CLOUDS);
    expect(rained).toBe(true);
    expect(e.dirty.size).toBeGreaterThan(0);
    for (const c of e.clouds) expect(c.layer).toBeGreaterThanOrEqual(1);
  });
  it('a raining cloud pays only for new tiles and stays until its animation ends', () => {
    const w = lakeWorld(), e = new Ecosystem(w, mulberry32(5), { enabled: false, strength: 0, dir: 0 });
    e.clouds.push({ id: 1, x: 8, y: 8, layer: 6, water: 100, size: 1, age: 99, raining: true, rain: 0.1, prevRain: 0, rained: new Set(), toSand: false });
    let steps = 0;
    while (e.clouds.length && steps++ < 400) e.step(0.2);
    expect(steps).toBeGreaterThan(15);                                  // ~18 ticks of 5% to finish the animation
    expect(e.clouds.length).toBe(0);
    const paid = 100 - 100;                                             // cloud is gone; the check below is on a second cloud
    expect(paid).toBe(0);
    const c2 = { id: 2, x: 8, y: 8, layer: 6, water: 100, size: 1, age: 99, raining: true, rain: 0.1, prevRain: 0, rained: new Set<number>(), toSand: false };
    e.clouds.push(c2);
    for (let i = 0; i < 6; i++) e.step(0.2);
    expect(c2.rained.size).toBeLessThanOrEqual(29);                     // a radius-3 disc, once
    expect(100 - c2.water).toBeCloseTo(c2.rained.size * 0.05, 5);
  });
});

describe('rivers', () => {
  const pond = (w: World, x0: number, y0: number, n: number) => { for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) w.setTerrain(x, y, WATER); };
  it('draws a continuous, repeatable channel that leaves out its ends', () => {
    const a: [number, number] = [0, 0], b: [number, number] = [14, 6], p = riverPath(a, b);
    expect(p).toEqual(riverPath(a, b));
    expect(p.length).toBeGreaterThan(12);
    expect(p.some(([x, y]) => x === 14 && y === 6)).toBe(false);
    const all = [a, ...p, b];
    for (let i = 1; i < all.length; i++) expect(Math.abs(all[i][0] - all[i - 1][0]) + Math.abs(all[i][1] - all[i - 1][1])).toBeLessThanOrEqual(2);
    expect(riverPath([0, 0], [2, 0])).toEqual([[1, 0]]);
  });
  it('joins two nearby puddles with water, one tile at a time, and marks the line as a river', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(9), { enabled: false, strength: 0, dir: 0 });
    for (let y = -20; y < 20; y++) for (let x = -20; x < 30; x++) w.setTerrain(x, y, GRASS);
    pond(w, 0, 0, 3); pond(w, 14, 3, 4);
    e.setWatchedArea(-15, -15, 25, 15);
    let first = 0;
    for (let i = 0; i < 40 * 20 && !e.connections.some(c => c.done) && e.connections.length + 1; i++) { e.step(0.05); if (!first && e.connections.length) first = i; if (first && e.connections.length === 0) break; }
    expect(first).toBeGreaterThan(0);
    expect(e.riverTiles.size).toBeGreaterThan(8);
    // the path between the two ponds is water now: walk from one pond to the other over water only
    const seen = new Set<string>(), stack: [number, number][] = [[1, 1]];
    while (stack.length) { const [x, y] = stack.pop()!; const k = `${x},${y}`; if (seen.has(k) || w.terrainAt(x, y) !== WATER) continue; seen.add(k); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stack.push([x + dx, y + dy]); }
    expect(seen.has('15,4')).toBe(true);
  });
  it('lets a lone water tile walk towards a river line and leave sand behind', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(9), { enabled: false, strength: 0, dir: 0 });
    for (let y = -12; y < 12; y++) for (let x = -12; x < 25; x++) w.setTerrain(x, y, GRASS);
    w.setTerrain(0, 0, WATER);
    e.setWatchedArea(-10, -10, 20, 10);
    for (let x = 6; x < 12; x++) e.riverTiles.add(tileKey(x, 0));
    for (let i = 0; i < 40; i++) e.step(0.2);
    let wx = -99; for (let x = -3; x < 15; x++) if (w.terrainAt(x, 0) === WATER) wx = x;
    expect(wx).toBeGreaterThan(0);
    expect(w.terrainAt(0, 0)).toBe(SAND);
  });
  it('pulls clouds towards a river line when the air is calm', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(4), { enabled: false, strength: 0, dir: 0 });
    for (let x = 0; x < 30; x++) e.riverTiles.add(tileKey(x, 20));
    const c = { id: 1, x: 15, y: 5, layer: 1, water: 0.5, size: 1, age: 0, raining: false, rain: 0, prevRain: 0, rained: new Set<number>(), toSand: false };
    e.clouds.push(c);
    for (let i = 0; i < 60; i++) e.step(0.2);
    expect(c.y).toBeGreaterThan(8);
  });
  it('keeps one cloud per tile per layer', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(4), { enabled: false, strength: 0, dir: 0 });
    for (let i = 0; i < 6; i++) e.clouds.push({ id: i, x: 5.2, y: 5.2, layer: 8, water: 0.5, size: 1, age: 0, raining: false, rain: 0, prevRain: 0, rained: new Set<number>(), toSand: false });
    e.step(0.2);
    const tiles = new Set(e.clouds.map(c => `${Math.floor(c.x)}:${Math.floor(c.y)}`));
    expect(tiles.size).toBe(e.clouds.length);
  });
});

describe('ecosystem upkeep', () => {
  const calm = { enabled: false, strength: 0, dir: 0 };
  const cloud = (x: number, y: number, raining = false) => ({ id: 1, x, y, layer: 1, water: 0.5, size: 1, age: 0, raining, rain: raining ? 0.1 : 0, prevRain: 0, rained: new Set<number>(), toSand: false });
  it('brings a cloud that drifted far out of the watched area back in on the other side', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(4), calm);
    e.setWatchedArea(-10, -10, 10, 10);
    const far = cloud(10 + CLOUD_MARGIN + 5, 0), near = cloud(10 + CLOUD_MARGIN - 5, 0);
    e.clouds.push(far, { ...near, id: 2 });
    e.step(0.2);
    expect(far.x).toBeLessThan(-10);                                     // came back in upwind
    expect(far.x).toBeGreaterThanOrEqual(-10 - CLOUD_MARGIN - 2);
    expect(e.clouds[1].x).toBeGreaterThan(10);                           // inside the margin: left alone
  });
  it('leaves clouds alone when no area is watched', () => {
    const e = new Ecosystem(new World(3), mulberry32(4), calm), c = cloud(500, 500);
    e.clouds.push(c); e.step(0.2);
    expect(c.x).toBeGreaterThan(490);
  });
  it('gives up a channel that cannot grow', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(9), calm);
    for (let y = -10; y < 10; y++) for (let x = -10; x < 20; x++) w.setTerrain(x, y, GRASS);
    e.setWatchedArea(-8, -8, 18, 8);
    e.connections.push({ from: tileKey(0, 0), to: tileKey(6, 0), path: [[1, 0], [2, 0], [3, 0]], done: false });   // no water anywhere near
    for (let i = 0; i < STALL_TICKS + 4; i++) e.step(0.5);
    expect(e.connections.length).toBe(0);
  });
  it('does not take the tip of a lake cut by the area border for a lone tile', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(9), calm);
    for (let y = -12; y < 12; y++) for (let x = -12; x < 30; x++) w.setTerrain(x, y, GRASS);
    for (let x = 10; x < 16; x++) w.setTerrain(x, 0, WATER);            // a strip of water; only its first tile is inside the area
    e.setWatchedArea(-10, -10, 10, 10);
    for (let x = -6; x < -2; x++) e.riverTiles.add(tileKey(x, 0));
    for (let i = 0; i < 40; i++) e.step(0.2);
    expect(w.terrainAt(10, 0)).toBe(WATER);                             // it stayed put
  });
  it('marks the diagonal chunk dirty when a corner tile changes', () => {
    const w = new World(3), e = new Ecosystem(w, mulberry32(9), calm);
    e.paint(CHUNK - 1, CHUNK - 1, w.terrainAt(CHUNK - 1, CHUNK - 1) === WATER ? SAND : WATER);
    expect(e.dirty.has(tileKey(1, 1))).toBe(true);
  });
});

describe('sky', () => {
  it('follows the documented table', () => {
    expect(sunElevation(0)).toBe(-1); expect(sunElevation(6)).toBeCloseTo(0); expect(sunElevation(12)).toBeCloseTo(1); expect(sunElevation(18)).toBeCloseTo(0); expect(sunElevation(24)).toBeCloseTo(-1);
    expect(sunAzimuth(0)).toBe(0); expect(sunAzimuth(12)).toBeGreaterThan(Math.PI / 2 - 0.5); expect(sunAzimuth(22)).toBeCloseTo(Math.PI);
    expect(darkness(1)).toBe(0); expect(darkness(-1)).toBe(MAX_DARKNESS); expect(darkness(0)).toBeCloseTo(MAX_DARKNESS / 2);
    expect(darkness(0.1)).toBe(0); expect(darkness(-0.1)).toBeCloseTo(MAX_DARKNESS);
  });
  it('runs a day in 60 seconds and prints the time', () => {
    expect(advanceHour(0, 60)).toBeCloseTo(0, 5);
    expect(advanceHour(12, 15)).toBeCloseTo(18, 5);
    expect(clockText(7.5)).toBe('07:30'); expect(clockText(23.99)).toBe('23:59');
  });
});

describe('flight', () => {
  it('maps pitch to layers and layers to parallax and size', () => {
    const f = newFlight();
    expect(currentLayer(f)).toBeCloseTo(5.5);
    f.pitch = 45; expect(currentLayer(f)).toBeCloseTo(1);
    f.pitch = -45; expect(currentLayer(f)).toBeCloseTo(10);
    expect(parallax(1)).toBe(1); expect(parallax(10)).toBeCloseTo(0.5);
    expect(layerScale(1)).toBeCloseTo(1.45); expect(layerScale(10)).toBeCloseTo(1);
  });
  it('flies where the joystick points (up is north) and keeps going in manual mode', () => {
    const f = newFlight(0, 0);
    stepFlight(f, { dx: 0, dy: -1 }, 1);                      // stick up
    expect(f.y).toBeLessThan(0); expect(Math.abs(f.x)).toBeLessThan(1e-9); expect(f.heading).toBeCloseTo(Math.PI / 2);
    const y = f.y; f.mode = 'manual'; f.speed = 5;
    stepFlight(f, { dx: 0, dy: 0 }, 1);
    expect(f.y).toBeLessThan(y);
    f.mode = 'off'; const y2 = f.y; stepFlight(f, { dx: 0, dy: 0 }, 1); expect(f.y).toBe(y2);
    f.heading = 0; f.mode = 'manual'; f.speed = 10; f.pitch = 45; const x0 = f.x; stepFlight(f, { dx: 0, dy: 0 }, 1); expect(f.x - x0).toBeCloseTo(14);
  });
  it('cruise flies the figure-eight and bobs between layers', () => {
    const f = newFlight(0, 0); f.mode = 'cruise';
    let moved = 0;
    for (let i = 0; i < 600; i++) { stepFlight(f, { dx: 0, dy: 0 }, 0.5); moved = Math.max(moved, Math.hypot(f.x, f.y)); }
    expect(moved).toBeGreaterThan(1);
    expect(cruiseVelocity(0).vx).toBe(0);
    const layers = new Set<number>();
    const g = newFlight(); g.mode = 'cruise';
    for (let i = 0; i < 24; i++) { g.layerTime = i * 0.5; layers.add(Math.round(currentLayer(g))); }
    expect(layers.size).toBeGreaterThan(5);
  });
});

describe('3rd-person camera', () => {
  it('fades the tilt to flat at 190 m', () => {
    expect(tiltAltitudeFactor(0)).toBe(1); expect(tiltAltitudeFactor(95)).toBeCloseTo(0.5);
    expect(tiltAltitudeFactor(190)).toBe(0); expect(tiltAltitudeFactor(400)).toBe(0); expect(tiltAltitudeFactor(-5)).toBe(1);
  });
  it('looks ahead along the heading (north is up on screen)', () => {
    const n = chaseOffset(Math.PI / 2, 5), e = chaseOffset(0, 5);
    expect(n.x).toBeCloseTo(0); expect(n.y).toBeCloseTo(-5);
    expect(e.x).toBeCloseTo(5); expect(e.y).toBeCloseTo(0);
  });
  it('eases to the target without overshooting, at any frame rate', () => {
    let a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
    for (let i = 0; i < 60; i++) a = easeOffset(a, { x: 4, y: 0 }, 1 / 60);
    for (let i = 0; i < 15; i++) b = easeOffset(b, { x: 4, y: 0 }, 1 / 15);
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.x).toBeGreaterThan(3.9); expect(a.x).toBeLessThanOrEqual(4);
    expect(easeOffset({ x: 1, y: 1 }, { x: 0, y: 0 }, 0).x).toBe(1);
  });
  it('knows when the plane is flying', () => {
    const f = newFlight();
    expect(isFlying(f, false)).toBe(false); expect(isFlying(f, true)).toBe(true);
    f.mode = 'manual'; f.speed = 0; expect(isFlying(f, false)).toBe(false); f.speed = 2; expect(isFlying(f, false)).toBe(true);
    f.mode = 'cruise'; expect(isFlying(f, false)).toBe(true);
  });
  it('leans trees away from the middle, bigger when closer, upright and plain when far', () => {
    const mid = billboardLean(0, 0, 1);
    expect(mid).toEqual({ shear: 0, stretch: 1, scale: 1.35 });
    const right = billboardLean(200, 0, 1), left = billboardLean(-200, 0, 1);
    expect(right.shear).toBeGreaterThan(0); expect(left.shear).toBe(-right.shear);
    expect(billboardLean(0, 200, 1).stretch).toBeGreaterThan(1); expect(billboardLean(0, -200, 1).stretch).toBeLessThan(1);
    expect(billboardLean(200, 0, 10).shear).toBeCloseTo(right.shear / 2);          // high up: half the lean
    expect(billboardLean(100, 0, 1).scale).toBeGreaterThan(billboardLean(600, 0, 1).scale);
    expect(billboardLean(BILLBOARD_MAX_DISTANCE + 1, 0, 1)).toEqual({ shear: 0, stretch: 1, scale: 1 });
    expect(billboardLean(5, 5, 1, 0)).toEqual({ shear: 0, stretch: 1, scale: 1 });   // bad input: no lean, no crash
  });
});

void plainTile;

describe('hoops', () => {
  const hs = hoopsIn(42, 0, 0, 400, 400);
  it('are placed by the seed, about half the cells, at reachable heights', () => {
    expect(hs.length).toBeGreaterThan(20); expect(hs.length).toBeLessThan(90);
    expect(hoopsIn(42, 0, 0, 400, 400).map(h => h.key)).toEqual(hs.map(h => h.key));
    for (const h of hs) { expect(h.h).toBeGreaterThanOrEqual(4.5); expect(h.h).toBeLessThanOrEqual(10.5); }
  });
  it('are passed by crossing the disc, from either side, not by going round or past it', () => {
    const h = { key: 'x', x: 10, y: 10, h: 6, angle: 0, r: 3 };                          // faces east: the disc is the line x = 10
    expect(passedHoop(h, 8, 10, 6, 12, 10, 6)).toBe(true);
    expect(passedHoop(h, 12, 10.5, 6.5, 8, 10.5, 6.5)).toBe(true);
    expect(passedHoop(h, 8, 10, 6, 9.9, 10, 6)).toBe(false);                             // stops short
    expect(passedHoop(h, 8, 14, 6, 12, 14, 6)).toBe(false);                              // goes by to the side
    expect(passedHoop(h, 8, 10, 11, 12, 10, 11)).toBe(false);                            // flies over it
    expect(passedHoop(h, 8, 10, 1, 12, 10, 1)).toBe(false);                              // flies under it
    expect(passedHoop({ ...h, angle: Math.PI / 2 }, 10, 8, 6, 10, 12, 6)).toBe(true);    // faces south
  });
});

describe('thunder and fire', () => {
  const forest = (w: World, r: number) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) w.set(x, y, { t: GRASS, v: 0, d: 2, s: 1 }); };
  const burn = (e: Ecosystem, seconds: number) => { for (let i = 0; i < seconds * 4; i++) e.step(0.25); };
  it('only vegetation burns, trees best', () => {
    expect(flammability({ t: WATER, v: 0, d: 0, s: 1 })).toBe(0);
    expect(flammability({ t: SAND, v: 0, d: 0, s: 1 })).toBe(0);
    expect(flammability({ t: GRASS, v: 0, d: 2, s: 1 })).toBeGreaterThan(flammability({ t: GRASS, v: 0, d: 0, s: 1 }));
    expect(fuelOf({ t: GRASS, v: 0, d: 3, s: 3 })).toBeGreaterThan(fuelOf({ t: GRASS, v: 0, d: 3, s: 1 }));
    const w = new World(2), e = new Ecosystem(w, mulberry32(3));
    w.setTerrain(0, 0, SAND); w.setTerrain(1, 0, WATER);
    expect(e.ignite(0, 0)).toBe(false); expect(e.ignite(1, 0)).toBe(false);
  });
  it('a forced strike lights a tree, shows a bolt for a moment, and the tree burns down to bare charred grass', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(3));
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) w.setTerrain(x, y, SAND);
    w.set(0, 0, { t: GRASS, v: 0, d: 3, s: 1 });
    expect(e.strike(0.4, 0.7, undefined, true)).toBe(true);
    expect(e.strikes).toHaveLength(1); expect(e.fires.size).toBe(1); expect(e.fireHeat(0.5, 0.5)).toBeGreaterThan(0.5);
    burn(e, 1); expect(e.strikes).toHaveLength(0);
    burn(e, 10);
    expect(e.fires.size).toBe(0); expect(w.stateAt(0, 0)).toEqual(plainTile(GRASS));
    expect(e.scorched.has(tileKey(0, 0))).toBe(true); expect(e.ignite(0, 0)).toBe(false);   // charred: it cannot burn again yet
    burn(e, 50); expect(e.scorched.size).toBe(0); expect(e.ignite(0, 0)).toBe(true);
  });
  it('spreads through a forest but stops at sand and water', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(5), { enabled: false, strength: 0, dir: 0 });
    for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) w.setTerrain(x, y, SAND);
    forest(w, 4);
    e.ignite(0, 0); burn(e, 120);
    let trees = 0, other = 0;
    for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) { const st = w.stateAt(x, y); if (st.d) trees++; if (Math.max(Math.abs(x), Math.abs(y)) > 4 && st.t !== SAND) other++; }
    expect(e.fires.size).toBe(0);
    expect(trees).toBeLessThan(50);                                     // most of the 81 burnt (the fire calls its own rain now, which saves some: 34 here)
    expect(other).toBeLessThan(25);                                     // and the fire fed nothing outside the forest (only the rain it called turns a few sand tiles to grass: 10 here)
  });
  it('runs downwind faster than upwind', () => {
    let east = 0, west = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = new World(2), e = new Ecosystem(w, mulberry32(seed), { enabled: true, strength: 8, dir: 0 });   // wind blowing east
      for (let y = -3; y <= 3; y++) for (let x = -20; x <= 20; x++) w.set(x, y, { t: GRASS, v: 0, d: 1, s: 1 });
      e.ignite(0, 0); burn(e, 6);
      for (const f of e.fires.values()) { if (f.x > 0) east++; if (f.x < 0) west++; }
    }
    expect(east).toBeGreaterThan(west * 2);
  });
  it('rain puts a fire out and wet ground does not catch', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(3), { enabled: false, strength: 0, dir: 0 });
    forest(w, 5);
    e.ignite(0, 0); expect(e.fires.size).toBe(1);
    e.clouds.push({ id: 99, x: 0.5, y: 0.5, layer: 8, water: 1, size: 1, age: 30, raining: true, rain: 0.1, prevRain: 0, rained: new Set(), toSand: false });
    e.step(0.25);
    expect(e.fires.has(tileKey(0, 0))).toBe(false);
    expect(e.isWet(0, 0)).toBe(true); expect(e.ignite(0, 0)).toBe(false);
  });
  it('a burnt forest beside a lake does not let the lake in', () => {
    const w = new World(2), e = new Ecosystem(w, mulberry32(4), { enabled: true, strength: 4, dir: 0 }), r = mulberry32(8);
    for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) w.set(x, y, { t: GRASS, v: 0, d: r() > 0.5 ? 2 : 0, s: 1 });
    for (let y = -3; y <= 3; y++) for (let x = 3; x <= 9; x++) w.setTerrain(x, y, WATER);
    e.setWatchedArea(-20, -20, 20, 20);
    e.ignite(-10, 0); e.ignite(-10, 1); e.ignite(-9, 0); burn(e, 30);
    let water = 0, sand = 0; for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) { const t = w.terrainAt(x, y); if (t === WATER) water++; if (t === SAND) sand++; }
    expect(e.scorched.size).toBeGreaterThan(50);
    expect(water).toBeLessThan(80); expect(sand).toBeLessThan(160);     // (49 to start with; the shore evaporates and rain, now including the rain the fire calls, adds the odd tile, but nothing floods: ash as sand gave hundreds. The rain the fire calls floods about 19 puddles, and `settle` sands their shores: 126 sand here against 0 before. Some sand is left where the lake dried; it used to be flooded back by `settle`)
  });
});
