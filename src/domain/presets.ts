import { DEFAULT_APPEARANCE, sanitizeAppearance, type Appearance, type Preset } from './look';

/** Ready-made looks. Anything a preset leaves out stays at the default; `sanitizeAppearance` also guards against a typo here. */
const make = (id: string, name: string, o: Partial<Appearance>): Preset => ({ id, name, look: sanitizeAppearance({ ...DEFAULT_APPEARANCE, ...o }) });

/** Only the default look ships built in; everything else is a preset the player saves. */
export const BUILTIN_PRESETS: Preset[] = [
  make('forest', 'Forest', {}),
];
