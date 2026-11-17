import { describe, expect, it } from 'vitest';
import { addRunScore, coinsFor, BOOST_PRICE, MAX_BOOSTS, landingScore, MAX_SCORES, newSavedWorld, runPoints, sanitizeWorlds } from './worldsave';

describe('leaderboard', () => {
  it('scores a hoop as 100 and a metre as 1, ignores runs that went nowhere, keeps the best first and at most ten', () => {
    expect(runPoints(3, 250)).toBe(550);
    let list = addRunScore([], 0, 4, 1);
    expect(list).toEqual([]);                                    // nothing to record
    for (let i = 0; i < 14; i++) list = addRunScore(list, i % 4, 100 + i * 37, 1000 + i);
    expect(list.length).toBe(MAX_SCORES);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].points).toBeGreaterThanOrEqual(list[i].points);
  });
  it('is saved with the world and cleaned on load', () => {
    const w = { ...newSavedWorld('a', 'A', 5, 1), scores: addRunScore([], 2, 300, 7) };
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [w] }))).list[0];
    expect(back.scores).toEqual([{ points: 500, hoops: 2, metres: 300, height: 0, bonus: 0, at: 7 }]);
    const bad = sanitizeWorlds({ list: [{ ...w, scores: [{ hoops: 'x', metres: -5 }, 5, null, { hoops: 1, metres: 20, at: 2 }] }] }).list[0];
    expect(bad.scores!.map(r => r.points)).toEqual([120, 0]);
  });
  it('a soft landing earns points, a hard one costs them (never below zero in total)', () => {
    const soft = landingScore({ sink: 0.8, bank: 0.1 }), softer = landingScore({ sink: 0.2, bank: 0 }), hard = landingScore({ sink: 6, bank: 0.1 }), tilted = landingScore({ sink: 1, bank: 1.2 });
    expect(soft.soft).toBe(true); expect(soft.bonus).toBeGreaterThan(50); expect(softer.bonus).toBeGreaterThan(soft.bonus); expect(softer.bonus).toBeLessThanOrEqual(150);
    expect(hard.soft).toBe(false); expect(hard.bonus).toBeLessThan(0); expect(hard.bonus).toBeGreaterThanOrEqual(-200);
    expect(tilted.soft).toBe(false);
    expect(runPoints(1, 40, hard.bonus)).toBe(Math.max(0, 140 + hard.bonus));
    expect(runPoints(0, 10, -200)).toBe(0);
    expect(addRunScore([], 2, 100, 5, 120)[0].points).toBe(420);
  });
  it('every 100 points is a coin, a boost costs one, and coins are saved with the world', () => {
    expect(coinsFor(99)).toBe(0); expect(coinsFor(100)).toBe(1); expect(coinsFor(1234)).toBe(12); expect(coinsFor(-5)).toBe(0);
    expect(BOOST_PRICE).toBe(1); expect(MAX_BOOSTS).toBeGreaterThan(1);
    const w = { ...newSavedWorld('a', 'A', 5, 1), coins: 7 };
    expect(sanitizeWorlds(JSON.parse(JSON.stringify({ list: [w] }))).list[0].coins).toBe(7);
    expect(sanitizeWorlds({ list: [{ ...w, coins: -3 }] }).list[0].coins).toBe(0);
    expect(sanitizeWorlds({ list: [{ ...w, coins: 'x' }] }).list[0].coins).toBe(0);
  });
  it('landing on water is never soft and costs more than any crash on land', () => {
    const wet = landingScore({ sink: 0.5, bank: 0 }, true), hardLand = landingScore({ sink: 30, bank: 0 });
    expect(wet.soft).toBe(false); expect(wet.water).toBe(true);
    expect(wet.bonus).toBeLessThanOrEqual(-150); expect(wet.bonus).toBeGreaterThanOrEqual(-300);
    expect(wet.bonus).toBeLessThan(landingScore({ sink: 0.5, bank: 2 }).bonus);   // worse than a gentle-ish crash on land
    expect(landingScore({ sink: 30, bank: 0 }, true).bonus).toBeLessThan(hardLand.bonus);
  });
  it('height climbed above the launch point scores 2 points a metre, and is saved with the run', () => {
    expect(runPoints(1, 100, 0, 25)).toBe(100 + 100 + 50);
    const list = addRunScore([], 0, 50, 3, 0, 40);
    expect(list[0].points).toBe(130); expect(list[0].height).toBe(40);
    const back = sanitizeWorlds(JSON.parse(JSON.stringify({ list: [{ ...newSavedWorld('a', 'A', 5, 1), scores: list }] }))).list[0];
    expect(back.scores![0]).toEqual(list[0]);
  });
});
