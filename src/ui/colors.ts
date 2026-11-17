import type { Priority, Rarity } from '../domain';

/** From Android Color.kt */
export const PRIORITY_COLORS: Record<Priority, { bg: string; border: string }> = {
  LOW: { bg: '#2d6b3b', border: '#3a8a4a' },
  MEDIUM: { bg: '#b6a432', border: '#d4af37' },
  HIGH: { bg: '#b89000', border: '#8a8560' },
  CRITICAL: { bg: '#7b3b3b', border: '#a04848' },
};
/** Difficulty 0-9 gradient (easy -> hard). */
export const DIFFICULTY_COLORS = ['#2d6b3b', '#3a8a4a', '#4a9a5a', '#6c6747', '#8a8560', '#b6a432', '#d4af37', '#b67332', '#a04848', '#7b3b3b'];
export const RARITY_COLORS: Record<Rarity, string> = { COMMON: '#8a8560', UNCOMMON: '#4a9a5a', RARE: '#4a7ab5', EPIC: '#9a5ab5', LEGENDARY: '#f5c387' };
export const STAT_COLORS = { body: 'var(--body)', mind: 'var(--mind)', soul: 'var(--soul)' } as const;
/** Difficulty 0-9 -> frame tint: easy green, through yellow, to hard red (hue 130 -> -6). */
export const difficultyTint = (d: number) => `hsl(${Math.round(130 - Math.max(0, Math.min(9, d)) * 14.4)} 80% 50%)`;
/** Category -> frame border colour (the app's Body / Mind / Soul colours). */
export const CATEGORY_TINT: Record<'BODY' | 'MIND' | 'SOUL', string> = { BODY: '#cf565c', MIND: '#3c898f', SOUL: '#f5c387' };
/** Urgent task -> the colour its glow pulses and its frame warms toward. */
export const URGENCY_TINT = { soon: '#ff9800', overdue: '#ff3b30' } as const;
