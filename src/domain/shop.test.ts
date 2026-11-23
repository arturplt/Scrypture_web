import { describe, expect, it } from 'vitest';
import { buy, emptyUpgrades, launchHeight, launchMinPower, MAX_STOCK, offer, paperDrag, paperRain, sanitizeUpgrades, TIERS } from './shop';
import { newGlider, stepGlider, launchPlane, GROUND_ALT, type GlideEnv, type GlideControls } from './glider';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const none: GlideControls = { pitch: 0, roll: 0, yaw: 0 };

describe('shop', () => {
  it('tiers are bought in order, each for its price, until the last', () => {
    let up = emptyUpgrades(), coins = 100;
    for (let i = 0; i < TIERS.launch.prices.length; i++) {
      const r = buy('launch', up, coins)!; expect(r.cost).toBe(TIERS.launch.prices[i]); up = r.up; coins -= r.cost;
    }
    expect(up.launch).toBe(3); expect(offer('launch', up, coins).price).toBeNull(); expect(buy('launch', up, coins)).toBeNull();
  });
  it('you cannot buy without the coins, and consumables stop at the stock limit', () => {
    expect(buy('paper', emptyUpgrades(), 1)).toBeNull();
    let up = emptyUpgrades();
    for (let i = 0; i < MAX_STOCK; i++) up = buy('insurance', up, 99)!.up;
    expect(up.insurance).toBe(MAX_STOCK); expect(buy('insurance', up, 99)).toBeNull();
  });
  it('launch tiers raise the throw (Stepstool 5 m, Ladder 15 m, Paperplane launcher 30 m and never weak); paper tiers cut drag and rain', () => {
    expect([0, 1, 2, 3].map(launchHeight)).toEqual([GROUND_ALT, 5, 15, 30]);
    expect(launchMinPower(2)).toBeLessThan(launchMinPower(3));
    expect(paperDrag(3)).toBeLessThan(paperDrag(1)); expect(paperRain(3)).toBeLessThan(paperRain(0));
  });
  it('a launch from a ladder flies higher, and slicker paper glides farther', () => {
    const lo = newGlider(0, 0, 0, 100), hi = newGlider(0, 0, 0, 100);
    launchPlane(lo, 0, 0, 0, 0.7, launchHeight(0)); launchPlane(hi, 0, 0, 0, 0.7, launchHeight(2));
    let pl = 0, ph = 0; for (let i = 0; i < 60 * 40; i++) { stepGlider(lo, none, still, 1 / 60); stepGlider(hi, none, still, 1 / 60); pl = Math.max(pl, lo.z); ph = Math.max(ph, hi.z); }
    expect(ph).toBeGreaterThan(pl + 10);
    const a = newGlider(0, 0, 0, 100), b = newGlider(0, 0, 0, 100); b.dragK = paperDrag(3);
    for (let i = 0; i < 60 * 300 && !(a.landed && b.landed); i++) { stepGlider(a, none, still, 1 / 60); stepGlider(b, none, still, 1 / 60); }
    expect(Math.hypot(b.x, b.y)).toBeGreaterThan(Math.hypot(a.x, a.y) + 15);
  });
  it('is cleaned on load', () => {
    expect(sanitizeUpgrades({ launch: 9, paper: -1, rocket: 7, insurance: 'x', float: 2.4, double: 99, heatshield: 3 })).toEqual({ launch: 3, paper: 0, rocket: 3, insurance: 0, float: 2, double: MAX_STOCK, heatshield: 3 });
    expect(sanitizeUpgrades(null)).toEqual(emptyUpgrades());
  });
  it('sells the rocket stage in three tiers, in order, and keeps it', () => {
    let up = emptyUpgrades(), coins = 1000;
    for (let i = 0; i < TIERS.rocket.prices.length; i++) { const r = buy('rocket', up, coins)!; expect(r.cost).toBe(TIERS.rocket.prices[i]); up = r.up; coins -= r.cost; }
    expect(up.rocket).toBe(3); expect(buy('rocket', up, coins)).toBeNull(); expect(offer('rocket', up, coins).price).toBeNull();
  });
  it('sells heat shields as a stock', () => {
    let up = emptyUpgrades(); for (let i = 0; i < MAX_STOCK; i++) up = buy('heatshield', up, 100)!.up;
    expect(up.heatshield).toBe(MAX_STOCK); expect(buy('heatshield', up, 100)).toBeNull();
  });
});
