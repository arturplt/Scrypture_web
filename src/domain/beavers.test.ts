import { describe, expect, it } from 'vitest';
import { World, GRASS, WATER, DECO_CONIFER, DECO_BUSH, tileKey } from './worldgen';
import { isBerryBush } from './berries';
import { Ecosystem, REGION } from './ecosystem';
import { mulberry32 } from './sanctuary';
import { BeaversManager, FIRE_FLEE, BURN_TIME, TRUST_COME, TRUST_FOLLOW, BREAK_TRUST_LOSS, LEAK_EVERY, damIntact, damBroken, FOOD_FULL, HUNGRY_AT, isHome, stageOf, KIT_AGE, LITTER_WAIT, BROOD_CAP, type Colony, FULL_TIME, MAX_TRUST, DAM_STICKS, DAM_STONES, POND_TILES, POND_TICK, colonyInCell, type Picked } from './beavers';
import { sanitizeBeavers, BURROW_STICKS, ADULT_AGE, OLD_AGE, DEATH_AGE } from './worldsave';
/** The burrow already built, so a test about the dam does not first wait for it. */
const home = (c: Colony) => { c.bsticks = BURROW_STICKS; return c; };

/** A meadow with a one-tile stream running north-south through the middle: the only place to dam is across it. */
function scene(seed = 7) {
  const w = new World(seed);
  for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) w.setTerrain(x, y, GRASS);
  for (let y = -6; y <= 6; y++) w.setTerrain(0, y, WATER);
  const e = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 });
  const picked: Picked = { sticks: new Set(), stones: new Set() };
  return { w, e, picked, m: new BeaversManager(w, e, mulberry32(2), picked) };
}
const run = (m: BeaversManager, seconds: number, until?: () => boolean) => { for (let t = 0; t < seconds; t += 0.2) { m.step(0.2); if (until?.()) return true; } return false; };

describe('beavers', () => {
  it('places colonies from the seed, the same every time', () => {
    let n = 0;
    for (let j = -5; j < 5; j++) for (let i = -5; i < 5; i++) { const c = colonyInCell(9, i, j); if (c) n++; expect(colonyInCell(9, i, j)).toEqual(c); }
    expect(n).toBeGreaterThan(30); expect(n).toBeLessThan(90);
  });
  it('settles a pair by a stream and picks a dam across it', () => {
    const { w, m } = scene(), c = m.found('t', 0, 0)!;
    expect(c.dam.length).toBe(1); expect(w.terrainAt(c.dam[0].x, c.dam[0].y)).toBe(WATER);
    expect(w.terrainAt(c.bx, c.by)).not.toBe(WATER);
    expect(m.beavers.map(b => b.sex)).toEqual(['m', 'f']);
  });
  it('finds nothing to dam on dry land', () => {
    const w = new World(7);
    for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) w.setTerrain(x, y, GRASS);
    const m = new BeaversManager(w, new Ecosystem(w, mulberry32(1)), mulberry32(2));
    expect(m.found('t', 0, 0)).toBeNull(); expect(m.beavers.length).toBe(0);
  });
  it('a beaver takes a stick or stone off the ground, and then the player cannot', () => {
    const { m, picked } = scene(); m.found('t', 0, 0);
    expect(run(m, 120, () => picked.sticks.size + picked.stones.size > 0)).toBe(true);
    expect(m.beavers.filter(b => b.carry).length).toBe(1);
    expect(m.tally.hauled).toBe(1); expect(m.dirty).toBe(true);
  });
  it('two beavers never go for the same piece', () => {
    const { m } = scene(); m.found('t', 0, 0);
    run(m, 60, () => { const [a, b] = m.beavers; if (a.item && b.item) expect(`${a.item.kind}:${a.item.key}`).not.toBe(`${b.item.kind}:${b.item.key}`); return false; });
  });
  it('builds the dam at the set cost and takes no more than it needs', () => {
    const { m, picked } = scene(), c = home(m.found('t', 0, 0)!);
    expect(run(m, 600, () => c.done)).toBe(true);
    expect(c.dam[0]).toMatchObject({ sticks: DAM_STICKS, stones: DAM_STONES });
    expect(m.tally.damsDone).toBe(1);
    run(m, 60);
    expect(picked.sticks.size).toBe(DAM_STICKS); expect(picked.stones.size).toBe(DAM_STONES);
  });
  it('the player can hand pieces to a dam nearby, until it is full', () => {
    const { m } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0];
    expect(m.give(d.x + 30, d.y, 'stick')).toBe(false);                 // too far away
    expect(m.needsAt(d.x + 1, d.y)).toEqual({ stick: true, stone: true, brk: false });
    expect(m.give(d.x + 1, d.y, 'stick')).toBe(true); expect(m.give(d.x + 1, d.y, 'stick')).toBe(true);
    expect(m.give(d.x + 1, d.y, 'stick')).toBe(false);
    expect(m.give(d.x + 1, d.y, 'stone')).toBe(true);
    expect(c.done).toBe(true); expect(m.give(d.x + 1, d.y, 'stone')).toBe(false);
    expect(m.needsAt(d.x + 1, d.y)).toEqual({ stick: false, stone: false, brk: true });
  });
  it('a finished dam holds water: the region wants more and a pond grows', () => {
    const { m, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0];
    const before = e.waterShortage(c.px, c.py);
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    expect(e.waterShortage(c.px, c.py) - before).toBeCloseTo(POND_TILES / (REGION * REGION));
    run(m, POND_TICK * 6);
    expect(e.tally.toWaterBy.dam).toBeGreaterThan(0); expect(m.tally.pond).toBeGreaterThan(0);
  });
  it('saves its dams and takes them up again', () => {
    const { m, w, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0];
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    const saved = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved())));
    expect(saved.dams).toEqual([[d.x, d.y, DAM_STICKS, DAM_STONES]]);
    const m2 = new BeaversManager(w, e, mulberry32(2), undefined, saved);
    expect(m2.damTiles().length).toBe(1);                               // drawn before its colony is back
    const c2 = m2.found('t', 0, 0)!;
    expect(c2.done).toBe(true); expect(c2.dam[0]).toMatchObject({ x: d.x, y: d.y });
    expect(m2.damTiles().length).toBe(1);
  });
  it('a half-built dam comes back as long as it was', () => {
    const w = new World(7);
    for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) w.setTerrain(x, y, GRASS);
    for (let y = -6; y <= 6; y++) for (let x = 0; x <= 2; x++) w.setTerrain(x, y, WATER);   // a stream three tiles wide
    const e = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 });
    const m = new BeaversManager(w, e, mulberry32(2)), c = home(m.found('t', 0, 0)!);
    expect(c.dam.length).toBe(3);
    expect(m.toSaved().dams).toEqual([]);                               // nothing laid yet: nothing to save
    m.give(c.dam[0].x, c.dam[0].y, 'stick');
    const saved = sanitizeBeavers(m.toSaved());
    expect(saved.dams.length).toBe(3); expect(m.damTiles().length).toBe(1);
    const c2 = new BeaversManager(w, e, mulberry32(2), undefined, saved).found('t', 0, 0)!;
    expect(c2.dam.map(d => [d.x, d.y, d.sticks])).toEqual(c.dam.map(d => [d.x, d.y, d.sticks])); expect(c2.done).toBe(false);
  });
  it('drops bad saved data', () => {
    expect(sanitizeBeavers(null).dams).toEqual([]);
    expect(sanitizeBeavers({ dams: [[1, 2, 3], 'x', [1.5, 2, 1, 1], [3, 4, 99, -2], [3, 4, 1, 1]] }).dams).toEqual([[3, 4, 9, 0]]);
  });
  it('a fed beaver stops to eat, is full for a while, and its colony trusts the player more', () => {
    const { m } = scene(), c = m.found('t', 0, 0)!, b = m.beaverNear(c.bx, c.by)!;
    expect(b).toBeTruthy(); expect(m.beaverNear(c.bx + 30, c.by)).toBeNull();
    const at = [b.x, b.y];
    expect(m.feed(b, b.x + 1)).toBe(true); expect(b.face).toBe(1);
    expect(m.feed(b)).toBe(false);                                      // full: no second helping
    expect(c.trust).toBe(1); expect(m.tally.fed).toBe(1);
    m.step(0.5); expect([b.x, b.y]).toEqual(at);                        // eating: it stays put
    run(m, FULL_TIME + 2); expect(b.full).toBe(0); expect(m.feed(b)).toBe(true);
    for (let i = 0; i < 10; i++) { b.full = 0; m.feed(b); }
    expect(c.trust).toBe(MAX_TRUST);
  });
  it('trust is saved and comes back with the colony', () => {
    const { w, e, m } = scene(), c = m.found('t', 0, 0)!;
    m.feed(m.beavers[0]); m.feed(m.beavers[1]);
    const saved = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved())));
    expect(saved.trust).toEqual([['t', 2]]);
    const m2 = new BeaversManager(w, e, mulberry32(2), undefined, saved);
    expect(m2.toSaved().trust).toEqual([['t', 2]]);                     // kept while the colony is away
    expect(m2.found('t', 0, 0)!.trust).toBe(c.trust);
    expect(sanitizeBeavers({ dams: [], trust: [['a', 99], ['a', 1], [3, 1], 'x'] }).trust).toEqual([['a', 5]]);
  });
  it('the pair builds the burrow before the dam, and the player can give it sticks', () => {
    const { m, picked } = scene(), c = m.found('t', 0, 0)!;
    expect(isHome(c)).toBe(false);
    expect(m.needsAt(c.bx, c.by).stick).toBe(true); expect(m.needsAt(c.bx + 30, c.by).stick).toBe(false);
    expect(m.give(c.bx, c.by, 'stick')).toBe(true); expect(c.bsticks).toBe(1);
    expect(m.give(c.bx, c.by, 'stone')).toBe(false);                    // a burrow takes no stones
    run(m, 400, () => isHome(c));
    expect(isHome(c)).toBe(true); expect(c.bsticks).toBe(BURROW_STICKS);
    expect(c.dam.every(d => d.sticks === 0)).toBe(true);                 // every stick so far went to the burrow
    expect(m.needsAt(c.bx, c.by).stick).toBe(false);
    run(m, 600, () => c.done);
    expect(c.done).toBe(true); expect(picked.sticks.size).toBeGreaterThan(0);
  });
  it('a built burrow is saved, kept in place, and a beaver rests inside it out of sight', () => {
    const { w, e, m } = scene(), c = home(m.found('t', 0, 0)!);
    c.dam.forEach(d => { d.sticks = 2; d.stones = 1; });
    const saved = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved())));
    expect(saved.burrows).toEqual([['t', c.bx, c.by, BURROW_STICKS]]);
    const c2 = new BeaversManager(w, e, mulberry32(9), undefined, saved).found('t', 0, 0)!;
    expect([c2.bx, c2.by, c2.bsticks]).toEqual([c.bx, c.by, BURROW_STICKS]);
    let hidden = 0;
    run(m, 120, () => { if (m.beavers.some(b => b.inside)) hidden++; return false; });
    expect(hidden).toBeGreaterThan(0);
    const b = m.beavers[0]; b.inside = true; expect(m.beaverNear(b.x, b.y)).not.toBe(b);   // cannot be fed while inside
    expect(sanitizeBeavers({ dams: [], burrows: [['a', 1, 2, 99], ['a', 1, 2, 1], ['b', 1.5, 2, 1], [3, 1, 1, 1]] }).burrows).toEqual([['a', 1, 2, BURROW_STICKS]]);
  });
  it('stages follow from age', () => {
    expect([0, KIT_AGE - 1].map(stageOf)).toEqual(['baby', 'baby']); expect([KIT_AGE, ADULT_AGE - 1].map(stageOf)).toEqual(['young', 'young']); expect(stageOf(ADULT_AGE)).toBe('adult');
  });
  /** Small conifers across the meadow, to gnaw: the beavers feed on them as they run for minutes. */
  const grove = (w: World) => { for (let y = -12; y <= 12; y += 2) for (let x = 3; x <= 13; x += 2) w.set(x, y, { t: GRASS, v: 0, d: DECO_CONIFER, s: 1 }); };
  it('a pair with a home and a finished dam has a litter, kits grow up, and the next litter waits until they have', () => {
    const { w, m } = scene(), c = home(m.found('t', 0, 0)!);
    grove(w);
    c.dam.forEach(d => { d.sticks = DAM_STICKS; d.stones = DAM_STONES; }); c.done = true;
    expect(m.beavers.length).toBe(2);
    run(m, LITTER_WAIT - 5); expect(m.beavers.length).toBe(2);
    run(m, 10);
    const kits = m.beavers.filter(b => stageOf(b.age) === 'baby');
    expect(kits.length).toBeGreaterThanOrEqual(1); expect(kits.length).toBeLessThanOrEqual(3); expect(m.tally.born).toBe(kits.length); expect(m.dirty).toBe(true);
    const mine = () => m.beavers.filter(b => b.colony === 't'), n = mine().length;
    run(m, LITTER_WAIT + 10); expect(mine().length).toBe(n);              // one litter at a time
    run(m, 2 * ADULT_AGE, () => mine().every(b => stageOf(b.age) === 'adult')); expect(mine().every(b => stageOf(b.age) === 'adult')).toBe(true);
    run(m, LITTER_WAIT + 10); expect(mine().length).toBeLessThanOrEqual(BROOD_CAP);   // (the grown young have left, or the next litter is on its way)
    expect(m.tally.born).toBeGreaterThan(kits.length);
  });
  it('no litter without a home or a finished dam', () => {
    const { m } = scene(), c = m.found('t', 0, 0)!;
    run(m, 200, () => c.done); const had = m.beavers.length;
    expect(had).toBe(2);
  });
  it('kits stay by a parent and the young carry sticks only', () => {
    const { m } = scene(), c = home(m.found('t', 0, 0)!), [dad] = m.beavers;
    (m as any).spawn(c, 'm', 0); const kit = m.beavers[2];
    run(m, 60, () => { expect(kit.carry).toBeNull(); return false; });
    expect(Math.hypot(kit.x - dad.x, kit.y - dad.y)).toBeLessThan(12);
    kit.age = KIT_AGE + 1; kit.state = 'idle'; kit.timer = 0;
    run(m, 120, () => { expect(kit.carry === 'stone').toBe(false); return false; });
  });
  it('kits and young are saved with the colony and come back with their age', () => {
    const { w, e, m } = scene(), c = home(m.found('t', 0, 0)!);
    expect(m.toSaved().pop).toEqual([]);                                 // the plain seed pair is not saved
    (m as any).spawn(c, 'f', 30); (m as any).spawn(c, 'm', 200);
    const saved = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved())));
    expect(saved.pop!.length).toBe(4);
    const m2 = new BeaversManager(w, e, mulberry32(3), undefined, saved); m2.found('t', 0, 0);
    expect(m2.beavers.map(b => [b.sex, stageOf(b.age)]).sort()).toEqual(m.beavers.map(b => [b.sex, stageOf(b.age)]).sort());
    expect(sanitizeBeavers({ dams: [], pop: [['a', 2, 5], ['a', 1, 99999], ['a', 0, 'x'], [1, 0, 0]] }).pop).toEqual([['a', 1, DEATH_AGE]]);
  });
  it('the old slow down and stop hauling, then die; a colony left with nobody is abandoned and kept so', () => {
    const { w, e, m } = scene(), c = m.found('t', 0, 0)!;
    m.beavers.forEach(b => { b.age = OLD_AGE + 1; });
    expect(stageOf(m.beavers[0].age)).toBe('old');
    run(m, 200); expect(m.tally.hauled).toBe(0);                        // too old to haul
    m.beavers.forEach(b => { b.age = DEATH_AGE - 1; });
    run(m, 5);
    expect(m.beavers.length).toBe(0); expect(m.tally.died).toBe(2); expect(c.abandoned).toBe(true);
    const saved = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved())));
    expect(saved.abandoned).toEqual(['t']);
    const m2 = new BeaversManager(w, e, mulberry32(2), undefined, saved), c2 = m2.found('t', 0, 0)!;
    expect(c2.abandoned).toBe(true); expect(m2.beavers.length).toBe(0);   // does not get a fresh pair from the seed
  });
  it('a grown young beaver leaves for a colony that lacks its sex; one short of its sex at home stays', () => {
    const { m } = scene(), home = m.found('h', 0, 0)!, far = m.found('far', 0, 10, false)!;
    expect(far).not.toBeNull(); expect(far.pending).toBe(true);
    const sp = (c: Colony, sex: 'm' | 'f', age: number) => { (m as any).spawn(c, sex, age); return m.beavers[m.beavers.length - 1]; };
    sp(far, 'm', ADULT_AGE);                                             // a lone adult male waits at the far colony
    const girl = sp(home, 'f', ADULT_AGE - 1);                           // home has both parents: she leaves when she is grown
    run(m, 120, () => girl.colony === 'far');                           // (both burrows lie by the one stream, so it is a short walk)
    expect(girl.colony).toBe('far'); expect(far.pending).toBe(false); expect(m.tally.left).toBe(1);
    m.beavers.filter(b => b.colony === 'h' && b.sex === 'm' && b.age >= ADULT_AGE).forEach(b => { b.age = DEATH_AGE; }); run(m, 1);   // the father dies
    const boy = sp(home, 'm', ADULT_AGE - 1); run(m, 3);
    expect(boy.state).not.toBe('leave'); expect(boy.colony).toBe('h');   // it stays to fill his place
  });
  it('a hungry beaver gnaws a tree a step at a time, a tree gnawed through gives a stick for the burrow, and bushes with berries are left alone', () => {
    const { w, m } = scene(), c = m.found('t', 0, 0)!, [dad] = m.beavers;
    let by = 0; while (!isBerryBush(w.seed, 5, by)) by++;
    w.set(5, by, { t: GRASS, v: 0, d: DECO_BUSH, s: 1 });                  // a berry bush: the player's
    dad.food = 10; run(m, 20); expect(m.tally.gnawed).toBe(0);
    w.set(6, 0, { t: GRASS, v: 0, d: DECO_CONIFER, s: 2 });
    dad.state = 'idle'; dad.timer = 0; dad.food = 10;
    run(m, 30, () => m.tally.gnawed > 0);
    expect(m.tally.gnawed).toBe(1); expect(w.stateAt(6, 0)).toMatchObject({ d: DECO_CONIFER, s: 1 });   // one step smaller
    expect(dad.food).toBeGreaterThan(100);
    dad.state = 'idle'; dad.timer = 0; dad.food = 10; const had = c.bsticks;
    run(m, 30, () => m.tally.gnawed > 1);
    expect(w.stateAt(6, 0).d).toBe(0);                                      // gone
    run(m, 30, () => c.bsticks > had); expect(c.bsticks).toBeGreaterThan(had);   // and its stick went to the burrow
    expect(HUNGRY_AT).toBeLessThan(FOOD_FULL);
  });
  it('a hungry colony does not breed', () => {
    const { m } = scene(), c = home(m.found('t', 0, 0)!);
    c.dam.forEach(d => { d.sticks = DAM_STICKS; d.stones = DAM_STONES; }); c.done = true;
    run(m, LITTER_WAIT * 3, () => { m.beavers.forEach(b => { b.food = 0; }); return false; });   // nothing to eat anywhere
    expect(m.tally.born).toBe(0);
  });
  it('with the clock on they sleep in the burrow by day and work by night', () => {
    const { m, e } = scene(), c = home(m.found('t', 0, 0)!);
    m.dayNight = true; e.hour = 12;
    run(m, 60); expect(m.beavers.every(b => b.inside)).toBe(true); expect(m.tally.hauled).toBe(0);
    e.hour = 23;
    run(m, 120, () => m.tally.hauled > 0); expect(m.tally.hauled).toBeGreaterThan(0);
    expect(c.done || m.beavers.some(b => !b.inside)).toBe(true);
    const off = scene(); off.e.hour = 12; off.m.found('t', 0, 0); run(off.m, 120, () => off.m.tally.hauled > 0);
    expect(off.m.tally.hauled).toBeGreaterThan(0);                          // (the clock is off by default: tests and the soak run round the clock)
  });
  it('a standing dam loses sticks and the beavers mend it', () => {
    const { m, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0];
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    expect(c.done).toBe(true); expect(damIntact(c)).toBe(true);
    run(m, LEAK_EVERY + 5); expect(m.tally.leaked).toBeGreaterThan(0); expect(damIntact(c)).toBe(false);
    expect(m.needsAt(d.x, d.y).stick).toBe(true);                        // and the player can top it up
    run(m, 600, () => damIntact(c)); expect(damIntact(c)).toBe(true);
    expect(c.done).toBe(true); void e;
  });
  it('an abandoned dam is not mended, gives way, and takes its pond water off the region again', () => {
    const { m, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0], before = e.waterShortage(c.px, c.py);
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    expect(e.waterShortage(c.px, c.py)).toBeGreaterThan(before);
    m.beavers.splice(0); c.abandoned = true;
    run(m, LEAK_EVERY * 10, () => damBroken(c));
    expect(damBroken(c)).toBe(true); expect(c.done).toBe(false); expect(m.tally.damsBroken).toBe(1);
    expect(e.waterShortage(c.px, c.py)).toBeLessThanOrEqual(before + 1e-9);   // (less by the pond tiles already grown)
    expect(e.waterShortage(c.px, c.py)).toBeGreaterThan(before - 20 / 256);
    run(m, LEAK_EVERY * 5); expect(m.tally.damsBroken).toBe(1);          // (it breaks once)
  });
  it('heavy rain over the dam makes it leak four times as fast', () => {
    const { m, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0];
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    m.beavers.splice(0); c.abandoned = true;
    run(m, LEAK_EVERY - 1); expect(m.tally.leaked).toBe(0);
    (e.clouds as any[]).push({ id: 99, x: c.px, y: c.py, layer: 6, water: 1, size: 2, age: 50, raining: true, rain: 0.9, prevRain: 0.9, rained: new Set(), toSand: false });
    run(m, LEAK_EVERY / 4 + 1); expect(m.tally.leaked).toBeGreaterThan(0);
  });
  it('a saved dam that has leaked still holds water, a broken one does not, and the pond target is not doubled', () => {
    const { m, w, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0];
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    d.sticks = 1;
    const saved = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved())));
    const e2 = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 });
    const c2 = new BeaversManager(w, e2, mulberry32(2), undefined, saved).found('t', 0, 0)!;
    const b0 = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 }).waterShortage(c2.px, c2.py);
    expect(c2.done).toBe(true); expect(e2.waterShortage(c2.px, c2.py)).toBeGreaterThan(b0);
    d.sticks = 0;
    const saved2 = sanitizeBeavers(JSON.parse(JSON.stringify(m.toSaved()))), e3 = new Ecosystem(w, mulberry32(1), { enabled: false, strength: 0, dir: 0 });
    const c3 = new BeaversManager(w, e3, mulberry32(2), undefined, saved2).found('t', 0, 0)!;
    expect(c3.done).toBe(false); void e;
  });
  const fire = (e: { fires: Map<number, any> }, x: number, y: number) => e.fires.set(tileKey(x, y), { x, y, fuel: 9, total: 9, age: 0 });
  it('beavers near a fire run for the water, and go back to work when it is out', () => {
    const { w, e, m } = scene(), c = m.found('t', 0, 0)!, b = m.beavers[0];
    b.x = c.bx + 3; b.y = c.by; b.state = 'idle'; b.timer = 99; b.carry = 'stick';
    fire(e, Math.round(b.x) + 2, Math.round(b.y));
    m.step(0.2);
    expect(b.state).toBe('flee'); expect(b.carry).toBeNull();
    run(m, 20, () => w.terrainAt(Math.round(b.x), Math.round(b.y)) === WATER && b.state !== 'flee');
    expect(w.terrainAt(Math.round(b.x), Math.round(b.y))).toBe(WATER);
    e.fires.clear(); run(m, 10);
    expect(b.state).not.toBe('flee');
    expect(FIRE_FLEE).toBeGreaterThan(0);
  });
  it('a fire at the burrow burns it down and the pair build it again', () => {
    const { e, m } = scene(), c = home(m.found('t', 0, 0)!);
    m.beavers[0].inside = true; m.beavers[0].state = 'inside'; m.beavers[0].timer = 99;
    fire(e, c.bx, c.by);
    run(m, BURN_TIME + 1);
    expect(c.bsticks).toBe(0); expect(isHome(c)).toBe(false); expect(m.tally.burnt).toBe(1); expect(m.beavers[0].inside).toBe(false);
    e.fires.clear();
    run(m, 600, () => isHome(c)); expect(isHome(c)).toBe(true);
  });
  it('the player can break a dam for half its pieces back; the pond drains and the colony trusts them less', () => {
    const { m, e } = scene(), c = home(m.found('t', 0, 0)!), d = c.dam[0], before = e.waterShortage(c.px, c.py);
    expect(m.breakDam(d.x, d.y)).toBeNull(); expect(m.needsAt(d.x, d.y).brk).toBe(false);
    m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stick'); m.give(d.x, d.y, 'stone');
    c.trust = 3; expect(m.needsAt(d.x, d.y).brk).toBe(true);
    expect(m.breakDam(d.x, d.y)).toEqual({ sticks: 1, stones: 1 });
    expect(c.done).toBe(false); expect(c.dam.every(t => t.sticks === 0 && t.stones === 0)).toBe(true);
    expect(c.trust).toBe(3 - BREAK_TRUST_LOSS); expect(e.waterShortage(c.px, c.py)).toBeCloseTo(before);
    expect(m.breakDam(d.x, d.y)).toBeNull();
  });
  it('a trusting colony comes to a player with berries, and its kits follow them', () => {
    const { m } = scene(), c = home(m.found('t', 0, 0)!);
    c.trust = TRUST_COME; m.player = { x: c.bx + 6, y: c.by + 2, berries: 1 };
    let near = false; run(m, 60, () => { near ||= m.beavers.some(b => Math.hypot(b.x - m.player!.x, b.y - m.player!.y) < 2.5); return near; });
    expect(near).toBe(true);
    c.trust = TRUST_FOLLOW; (m as any).spawn(c, 'f', 0); const kit = m.beavers[m.beavers.length - 1];
    m.player = { x: c.bx + 10, y: c.by, berries: 0 };
    let close = false; run(m, 80, () => { close ||= Math.hypot(kit.x - m.player!.x, kit.y - m.player!.y) < 5; return close; });
    expect(close).toBe(true);
    const lone = scene(), c2 = home(lone.m.found('t', 0, 0)!); lone.m.player = { x: c2.bx + 6, y: c2.by + 2, berries: 1 };   // no trust: it makes no difference
    let came = false; run(lone.m, 60, () => { came ||= lone.m.beavers.some(b => Math.hypot(b.x - lone.m.player!.x, b.y - lone.m.player!.y) < 1.5); return false; });
    expect(came).toBe(false);
  });
});
