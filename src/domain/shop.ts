/**
 * The shop: what coins (BCOIN in the inventory) buy. Boosts are bought one at a time (see worldsave: BOOST_PRICE); everything else is here.
 *  - tiers, bought once in order and kept: LAUNCH (where the throw starts: Stepstool, Ladder, Paperplane launcher) and PAPER (a slicker plane);
 *  - consumables, used up by the next run that needs them: insurance (a crash costs nothing), float (a water landing costs nothing), double score.
 * Upgrades are kept per world. Adding an item: add it to SHOP (and to Upgrades / emptyUpgrades) and give its names the i18n keys.
 */
import { GROUND_ALT } from './glider';

export type TierId = 'launch' | 'paper';
export type ConsumableId = 'insurance' | 'float' | 'double';
export type ShopId = TierId | ConsumableId;
export interface Upgrades { launch: number; paper: number; insurance: number; float: number; double: number }
export const emptyUpgrades = (): Upgrades => ({ launch: 0, paper: 0, insurance: 0, float: 0, double: 0 });

/** Tier items: the price of each tier in order (so `prices.length` tiers). Consumables: one price, at most MAX_STOCK in hand. */
export const TIERS: Record<TierId, { prices: number[] }> = {
  launch: { prices: [3, 8, 20] },
  paper: { prices: [4, 10, 25] },
};
export const CONSUMABLES: Record<ConsumableId, { price: number }> = {
  insurance: { price: 3 },
  float: { price: 4 },
  double: { price: 6 },
};
export const MAX_STOCK = 5;

/** Where the throw starts, by launch tier: the ground (1 m), a Stepstool (5 m), a Ladder (15 m), the Paperplane launcher (30 m). */
export const launchHeight = (tier: number) => [GROUND_ALT, 5, 15, 30][Math.max(0, Math.min(3, tier))];
/** The weakest throw a launch tier allows (the Paperplane launcher never throws weakly). */
export const launchMinPower = (tier: number) => (tier >= 3 ? 0.6 : 0.25);
/** Paper tiers: less drag (a flatter glide) and less pushed about by rain. */
export const paperDrag = (tier: number) => 1 - 0.08 * Math.max(0, Math.min(3, tier));
export const paperRain = (tier: number) => 1 - 0.2 * Math.max(0, Math.min(3, tier));

/** Can this be bought now, and what does it cost? `null` price = nothing left to buy. */
export function offer(id: ShopId, up: Upgrades, coins: number): { price: number | null; canBuy: boolean } {
  if (id === 'launch' || id === 'paper') {
    const price = TIERS[id].prices[up[id]] ?? null;
    return { price, canBuy: price !== null && coins >= price };
  }
  const price = CONSUMABLES[id].price;
  return { price, canBuy: coins >= price && up[id] < MAX_STOCK };
}

/** Buy one: returns the new upgrades and the coins to take, or null when it cannot be bought. */
export function buy(id: ShopId, up: Upgrades, coins: number): { up: Upgrades; cost: number } | null {
  const o = offer(id, up, coins);
  if (!o.canBuy || o.price === null) return null;
  return { up: { ...up, [id]: up[id] + 1 }, cost: o.price };
}

export function sanitizeUpgrades(raw: unknown): Upgrades {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.round(v))) : 0);
  return { launch: n(r.launch, TIERS.launch.prices.length), paper: n(r.paper, TIERS.paper.prices.length), insurance: n(r.insurance, MAX_STOCK), float: n(r.float, MAX_STOCK), double: n(r.double, MAX_STOCK) };
}
