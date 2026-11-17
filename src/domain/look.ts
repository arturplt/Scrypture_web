/** Appearance + accessibility options (pure, so they can be validated and tested). */

export const TEXT_SCALES = [1, 1.25, 1.5, 2] as const;
/** 0 = automatic (from the screen size), otherwise a fixed whole-number scale. */
export const UI_SCALES = [0, 1, 2, 3] as const;
/** How a frame's long sides are drawn: one stretched tile (original), tiled, mirror-tiled (seamless), or mirror-tiled with weathering. */
export const FRAME_EDGES = ['stretch', 'repeat', 'mirror', 'random'] as const;
export type FrameEdges = (typeof FRAME_EDGES)[number];
/** Whether textured frame centres (stone, wood) are weathered too; only used with mirror/random edges. */
export const FRAME_CENTERS = ['clean', 'random'] as const;
/** How a filter button's wide edges and centre are drawn: the sprite's tile repeated, mirrored, or randomly flipped. */
export const CHIP_EDGES = ['repeat', 'mirror', 'random'] as const;
/** The category filter chips (ALL / BODY / MIND / SOUL) can each have their own chip style; 'same' = the general filter-button style. */
export const CHIP_CATS = ['all', 'body', 'mind', 'soul'] as const;
export type ChipCat = (typeof CHIP_CATS)[number];
export type ChipsCat = Record<ChipCat, string>;
export const DEFAULT_CHIPS_CAT: ChipsCat = { all: 'same', body: 'same', mind: 'same', soul: 'same' };
export type ChipEdges = (typeof CHIP_EDGES)[number];
export type FrameCenter = (typeof FRAME_CENTERS)[number];
export type TextScale = (typeof TEXT_SCALES)[number];
export type UiScale = (typeof UI_SCALES)[number];

/** Per-element styles: the tick box, the cards and the creation dialogs. Frame values are a frame name or 'app' (= the main frame). */
export interface Elements {
  tick: string; task: string; habit: string; done: string; taskDialog: string; habitDialog: string;
  /** Home screen frames (all default to the main frame): level card, Body/Mind/Soul boxes, Bóbr pen, hunger / happiness cards, menu tiles, inventory */
  dashLevel: string; dashBody: string; dashMind: string; dashSoul: string; dashPen: string; dashHunger: string; dashHappiness: string; dashMenu: string; dashInventory: string;
  /** Bóbr's nudge line on Home */ dashNudge: string;
  /** the Categories and Tags dialogs */ manageDialog: string;
  /** the hover tip on the Body and Mind boxes */ tip: string;
  /** inventory slots: 'classic' (the original slot sprite) or a frame */ slot: string;
  /** Planner: the side cards (shortlist, month, habits), the board, and an activity card */ plCard: string; plBoard: string; plEvent: string;
}
export const DEFAULT_ELEMENTS: Elements = { tick: 'classic', task: 'app', habit: 'app', done: 'grey_stone_chiseld', taskDialog: 'wood_gold_gem', habitDialog: 'wood_gold_gem',
  dashLevel: 'app', dashBody: 'app', dashMind: 'app', dashSoul: 'app', dashPen: 'app', dashHunger: 'app', dashHappiness: 'app', dashMenu: 'app', dashInventory: 'app', dashNudge: 'app', manageDialog: 'wood_gold_gem', tip: 'wood_gold_gem', slot: 'classic', plCard: 'app', plBoard: 'app', plEvent: 'blue' };

/** Navigation bar: which destinations appear (Home is always kept), how the active one is marked, and whether labels show. */
export const NAV_ITEMS = ['home', 'tasks', 'habits', 'plan', 'start', 'chat', 'trophies', 'apps', 'settings'] as const;
export const NAV_ACTIVE = ['outline', 'glow', 'plate', 'underline', 'lift'] as const;
export const NAV_LABELS = ['icons', 'both'] as const;
export interface NavSettings { frame: string; active: string; plate: string; items: string[]; labels: string }
export const DEFAULT_NAV: NavSettings = { frame: 'wood_steel', active: 'outline', plate: 'wood', items: ['home', 'tasks', 'habits'], labels: 'icons' };

/** Valid, de-duplicated items in the fixed canonical order, always including Home. */
export function sanitizeNavItems(raw: unknown): string[] {
  const asked = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : DEFAULT_NAV.items);
  asked.add('home');
  return NAV_ITEMS.filter(id => asked.has(id));
}

/** Button size = how thick the frame border is drawn: large (the full 16px tile), medium (12), compact (8). */
/** The hardware-case look: a casing around the whole app, and how strong the CRT / low-res LCD screen effect is. */
export const CRT_LEVELS = ['off', 'low', 'high'] as const;
export type CrtLevel = (typeof CRT_LEVELS)[number];

export const BUTTON_SIZES = ['large', 'medium', 'compact'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];
export const BUTTON_SLICE: Record<ButtonSize, number> = { large: 16, medium: 12, compact: 8 };
/** Frames whose corner decorations (gems, brackets, stone blocks, ornaments) would be cut by a thin border. */
export const DECORATED_FRAMES: ReadonlySet<string> = new Set(['stone_block', 'wood_gold_gem', 'wood_steel', 'gold_ornate']);
export const MIN_DECORATED_SLICE = 12;

/** Border slice (and thickness) for a button: the size's slice, but never thinner than 12 for decorated frames. */
export function buttonSlice(frame: string, size: string): number {
  const base = BUTTON_SLICE[size as ButtonSize] ?? BUTTON_SLICE.compact;
  return DECORATED_FRAMES.has(frame) ? Math.max(base, MIN_DECORATED_SLICE) : base;
}

export interface Look {
  device: boolean;
  crt: string;
  deviceFrame: string;
  textScale: number;
  uiScale: number;
  frameEdges: string;
  buttonSize: string;
  frameCenter: string;
  chips: string;
  chipEdges: string;
  chipsCat: ChipsCat;
  elements: Elements;
  nav: NavSettings;
  buttons: { primary: string; secondary: string; keys: string; keysFn: string };
  bars: { xp: string; hunger: string; happiness: string };
  /** The player's saved looks (see Preset). */
  presets: Preset[];
}
export const DEFAULT_LOOK: Look = {
  device: false,
  crt: 'low',
  deviceFrame: 'grey_gun',
  textScale: 1,
  uiScale: 0,
  frameEdges: 'random',
  buttonSize: 'compact',
  frameCenter: 'clean',
  chips: 'wood',
  chipEdges: 'random',
  chipsCat: DEFAULT_CHIPS_CAT,
  elements: DEFAULT_ELEMENTS,
  nav: DEFAULT_NAV,
  buttons: { primary: 'button_green', secondary: 'button_red', keys: 'button_green', keysFn: 'button_red' },
  bars: { xp: 'gold', hunger: 'boxes_red', happiness: 'boxes_green' }, // hunger/happiness as boxes like Android
  presets: [],
};

const oneOf = <T extends number>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.length > 0 && v.length < 40 ? v : fallback);

/** Clamp anything loaded from storage/import to valid values (unknown style names are resolved at render time). */
export function sanitizeLook(raw: Partial<Record<keyof Look, unknown>> | undefined): Look {
  const r = (raw ?? {}) as { device?: unknown; crt?: unknown; deviceFrame?: unknown; textScale?: unknown; uiScale?: unknown; frameEdges?: unknown; buttonSize?: unknown; frameCenter?: unknown; chips?: unknown; chipEdges?: unknown; chipsCat?: Record<string, unknown>; presets?: unknown; elements?: Record<string, unknown>; nav?: Record<string, unknown>; buttons?: Record<string, unknown>; bars?: Record<string, unknown> };
  const d = DEFAULT_LOOK;
  return {
    device: typeof r.device === 'boolean' ? r.device : d.device,
    crt: (CRT_LEVELS as readonly unknown[]).includes(r.crt) ? (r.crt as string) : d.crt,
    deviceFrame: str(r.deviceFrame, d.deviceFrame),
    textScale: oneOf(r.textScale, TEXT_SCALES, d.textScale),
    uiScale: oneOf(r.uiScale, UI_SCALES, d.uiScale),
    frameEdges: (FRAME_EDGES as readonly unknown[]).includes(r.frameEdges) ? (r.frameEdges as string) : d.frameEdges,
    buttonSize: (BUTTON_SIZES as readonly unknown[]).includes(r.buttonSize) ? (r.buttonSize as string) : d.buttonSize,
    frameCenter: (FRAME_CENTERS as readonly unknown[]).includes(r.frameCenter) ? (r.frameCenter as string) : d.frameCenter,
    chips: str(r.chips, d.chips),
    chipsCat: Object.fromEntries(CHIP_CATS.map(c => [c, str(r.chipsCat?.[c], 'same')])) as ChipsCat,
    presets: sanitizePresets(r.presets),
    chipEdges: (CHIP_EDGES as readonly unknown[]).includes(r.chipEdges) ? (r.chipEdges as string) : d.chipEdges,
    nav: {
      frame: str(r.nav?.frame, DEFAULT_NAV.frame),
      plate: str(r.nav?.plate, DEFAULT_NAV.plate),
      active: (NAV_ACTIVE as readonly unknown[]).includes(r.nav?.active) ? (r.nav!.active as string) : DEFAULT_NAV.active,
      items: sanitizeNavItems(r.nav?.items),
      labels: (NAV_LABELS as readonly unknown[]).includes(r.nav?.labels) ? (r.nav!.labels as string) : DEFAULT_NAV.labels,
    },
    elements: Object.fromEntries(Object.entries(DEFAULT_ELEMENTS).map(([k, v]) => [k, str(r.elements?.[k], v)])) as unknown as Elements,
    buttons: { primary: str(r.buttons?.primary, d.buttons.primary), secondary: str(r.buttons?.secondary, d.buttons.secondary), keys: str(r.buttons?.keys, d.buttons.keys), keysFn: str(r.buttons?.keysFn, d.buttons.keysFn) },
    bars: { xp: str(r.bars?.xp, d.bars.xp), hunger: str(r.bars?.hunger, d.bars.hunger), happiness: str(r.bars?.happiness, d.bars.happiness) },
  };
}

/**
 * Automatic interface scale: the biggest whole number that still leaves a phone-sized logical screen
 * (>= 360 wide and >= 460 tall) so sprites stay crisp and nothing gets cramped. Capped at 3.
 */
export function autoUiScale(width: number, height: number): 1 | 2 | 3 {
  const n = Math.floor(Math.min(width / 360, height / 460));
  return (n >= 3 ? 3 : n >= 2 ? 2 : 1);
}

/** Largest scale that still leaves a usable logical screen (>= 160 wide), so a saved/imported choice can't break a small device. */
export const maxUiScale = (width: number): 1 | 2 | 3 => { const n = Math.floor(width / 160); return n >= 3 ? 3 : n >= 2 ? 2 : 1; };

export type Layout = 'compact' | 'medium' | 'wide';
/**
 * Side navigation rail instead of a bottom bar: on wide layouts, and on short screens that are wide enough to spare the
 * space (landscape phones). A narrow column, however short, keeps the bottom bar.
 */
export const needsRail = (layout: Layout, logicalHeight: number) => layout === 'wide' || (layout === 'medium' && logicalHeight < 520);

/** Layout from the *logical* width (viewport width / interface scale): phone column, tablet, desktop. */
export function layoutFor(logicalWidth: number): Layout {
  return logicalWidth < 560 ? 'compact' : logicalWidth < 900 ? 'medium' : 'wide';
}

/** How many of `boxes` boxes are lit for a 0..max value (a tiny non-zero value rounds to 0 on purpose). */
export function boxCount(value: number, max = 1, boxes = 10): number {
  if (!(max > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, value / max)) * boxes);
}


// ---- presets: a named, complete look -------------------------------------------------------------------------------------
/** Everything the Theme manager styles. Text size and interface size are accessibility, not looks, so a preset never changes them. */
export interface Appearance extends Omit<Look, 'textScale' | 'uiScale' | 'presets'> { frameTheme: string }
export interface Preset { id: string; name: string; look: Appearance }
export const MAX_PRESETS = 12;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A valid Appearance from anything (a saved preset, an import): every part clamped, missing parts default. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const o = isObj(raw) ? raw : {};
  const { textScale: _t, uiScale: _u, presets: _p, ...rest } = sanitizeLook(o as Partial<Record<keyof Look, unknown>>);
  return { ...rest, frameTheme: str(o.frameTheme, 'green_bev') };
}
/** The current look of a settings object, as a preset body. */
export const appearanceOf = (settings: unknown): Appearance => sanitizeAppearance(settings);
export const DEFAULT_APPEARANCE: Appearance = sanitizeAppearance({});

export function sanitizePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).slice(0, MAX_PRESETS).map((p, i) => ({
    id: typeof p.id === 'string' && p.id.length > 0 && p.id.length < 40 ? p.id : `preset-${i}`,
    name: (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Preset').slice(0, 24),
    look: sanitizeAppearance(p.look),
  }));
}
