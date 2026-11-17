export type Emotion = 'HAPPY' | 'NEUTRAL' | 'SLEEPY' | 'EXCITED' | 'HUNGRY' | 'MISCHIEVOUS' | 'SAD';

/** ASCII frames from Android EmoticonAnimations (plain ASCII so Press Start 2P can draw them). */
export const EMOTICONS: Record<Emotion, { frames: string[]; ms: number }> = {
  HAPPY: { frames: ['(^_^)', '(^o^)', '(^_^)', 'XD'], ms: 500 },
  NEUTRAL: { frames: ['(._.)', '(-_-)', '(._.)', '(-_-)', '(._.)'], ms: 600 },
  SLEEPY: { frames: ['(-_-)zZ', '(=__=)', '(-_-)zZ', '(-_-)zz'], ms: 700 },
  EXCITED: { frames: ['\\(^o^)/', '\\(^O^)/', '\\(^o^)/', '\\o/'], ms: 350 },
  HUNGRY: { frames: ['(o_o)', '(O_O)', '(o_o)', '(>_<)'], ms: 500 },
  MISCHIEVOUS: { frames: ['(^_~)', '(~_^)', '(^_~)', '(-_-~)'], ms: 500 },
  SAD: { frames: ['(T_T)', '(;_;)', '(T_T)', '(-_-)'], ms: 600 },
};

export const HUNGER_FULL_MS = 5 * 60 * 1000; // hunger reaches 1.0 five minutes after the last interaction

export const hungerAt = (lastInteraction: number, now: number) =>
  Math.min(1, Math.max(0, (now - lastInteraction) / HUNGER_FULL_MS));

/** A berry is a treat: Bóbr is excited for this long after one. */
export const BERRY_TREAT_MS = 60_000;

/** Bóbr cheers for this long after you finish a task or a habit. */
export const TASK_CHEER_MS = 20_000;
/** After a level-up or an achievement he is playful for this long (when he is fed and content). */
export const MISCHIEF_MS = 60_000;

export interface EmotionInput { hunger: number; happiness: number; hour: number; excited?: boolean; mischievous?: boolean }

/** Derived mood. Thresholds from Android: hungry >= 0.8, sad <= 0.2 (recovers above 0.3). */
export function emotionFor({ hunger, happiness, hour, excited, mischievous }: EmotionInput): Emotion {
  if (excited) return 'EXCITED';
  if (hunger >= 0.8) return 'HUNGRY';
  if (happiness <= 0.2) return 'SAD';
  if (hour >= 23 || hour < 6) return 'SLEEPY';
  if (mischievous && hunger < 0.5 && happiness > 0.5) return 'MISCHIEVOUS';
  if (happiness >= 0.8 && hunger < 0.5) return 'HAPPY';
  return 'NEUTRAL';
}

// ---- happiness (lazy: computed from the last stored value, no timers needed) -------------------
/** Android decays happiness 1%/s (+0.5%/s * hunger) while Bóbr is not freshly happy. */
export const HAPPY_GRACE_MS = 30_000;       // no decay for 30s after feeding/interaction
export const HAPPINESS_DECAY_PER_S = 0.01;
export const HUNGER_DECAY_PER_S = 0.005;

export interface BobrVitals { happiness: number; happinessAt: number; lastInteraction: number }
/** Bóbr's mood right now, from what is saved about him (`treatUntil`: excited until then, after a berry). */
export function emotionNow(b: BobrVitals & { treatUntil?: number; mischiefUntil?: number }, now: number): Emotion {
  return emotionFor({ hunger: hungerAt(b.lastInteraction, now), happiness: happinessNow(b, now), hour: new Date(now).getHours(), excited: (b.treatUntil ?? 0) > now, mischievous: (b.mischiefUntil ?? 0) > now });
}

export function happinessNow(b: BobrVitals, now: number): number {
  const start = Math.max(b.happinessAt, b.lastInteraction + HAPPY_GRACE_MS);
  if (now <= start) return clamp01(b.happiness);
  let h = b.happiness;
  const seconds = Math.min(Math.floor((now - start) / 1000), 200); // empty well before 200s
  for (let i = 0; i < seconds && h > 0; i++) {
    const hunger = hungerAt(b.lastInteraction, start + i * 1000);
    h -= HAPPINESS_DECAY_PER_S + hunger * HUNGER_DECAY_PER_S;
  }
  return clamp01(h);
}
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ---- items & trades ---------------------------------------------------------------------------
export const ITEM_IDS = ['bcoin', 'stone', 'hay', 'stick', 'berry'] as const;
export type ItemId = (typeof ITEM_IDS)[number];
export const ITEM_SPRITE: Record<ItemId, string> = { bcoin: 'coin', stone: 'stone', hay: 'hay', stick: 'stick', berry: 'berry' };
export const ITEM_LABEL: Record<ItemId, string> = { bcoin: 'BCOIN', stone: 'STONE', hay: 'HAY', stick: 'STICK', berry: 'BERRY' };

export const TRADE_PERIOD_MS = 60_000;
export const SPAWN_MIN_MS = 8_000, SPAWN_MAX_MS = 15_000, SPAWN_TTL_MS = 20_000, MAX_SPAWNED = 6;

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];

/**
 * Berries only grow in the world: they are picked from bushes on foot (see berries.ts). So they never appear around Bóbr at
 * home and he neither asks for one nor hands one out in a trade.
 */
export const HOME_ITEMS: readonly ItemId[] = ITEM_IDS.filter(i => i !== 'berry');

const ALL_TRADES = HOME_ITEMS.flatMap(request => HOME_ITEMS.filter(o => o !== request).map(offer => ({ request, offer })));

/**
 * Bóbr's current offer: wants `request`, gives `offer`. Stable for a whole minute, new the next.
 * Even and odd minutes draw from disjoint halves of the 12 possible trades (berries are not traded), so a trade never repeats back to back.
 */
export function tradeFor(now: number): { request: ItemId; offer: ItemId; expiresAt: number } {
  const slot = Math.floor(now / TRADE_PERIOD_MS);
  const half = ALL_TRADES.filter((_, i) => i % 2 === slot % 2);
  return { ...pick(mulberry32(slot * 2654435761), half), expiresAt: (slot + 1) * TRADE_PERIOD_MS };
}

/** Bóbr only trades when in a good mood (Android: not sleepy, sad or hungry). */
export const willTrade = (e: Emotion) => e !== 'SLEEPY' && e !== 'SAD' && e !== 'HUNGRY';
