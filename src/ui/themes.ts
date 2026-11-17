// Mirrors Android PixelFrameThemeRegistry. Frame files are 48x48 (see scripts/prepare-frames.mjs).
import customFrames from './customFrames.json';

const BUILT_IN_FRAMES = {
  blue: '#00a8ff', green: '#4caf50', orange: '#ff9800', gold: '#ffd700', red: '#e53935',
  bronze: '#cd7f32', green_gold_ornamental: '#d4af37', space: '#6a0daD',
  blue_ornate: '#00a8ff', green_ornate: '#4caf50', gold_ornate: '#ffd700', gold_thick: '#ffd700', gold_thin: '#ffd700',
  red_thick: '#e53935', wood_gold_gem: '#d4af37', wood_steel: '#8a8560', wood_tiger: '#b67332',
  tech: '#3c898f', blue_steel: '#3b4a6b', blue_turq: '#3c898f', blue_purple: '#6a0dad',
  grey_gun: '#8a8560', grey_stone_chiseld: '#8a8560', green_bev: '#4caf50', stone_block: '#8a8560',
} as const;
/** Frames added with "Add to collection" (scripts/frame-collection.mjs): name -> accent colour and whether the centre is bright. */
const CUSTOM = customFrames as Record<string, { accent: string; light: boolean }>;
// One shared object, kept on globalThis: when Vite hot-reloads this module (the registry file changed) every screen still sees the same,
// up-to-date list, and a frame added while the app is open can show up at once.
const LIVE = globalThis as unknown as { __scryptureFrames?: Record<string, string>; __scryptureLight?: Set<string>; __scryptureButtons?: string[] };
export const FRAME_THEMES: Record<string, string> = (LIVE.__scryptureFrames ??= {});
Object.assign(FRAME_THEMES, BUILT_IN_FRAMES, Object.fromEntries(Object.entries(CUSTOM).map(([k, v]) => [k, v.accent])));
export type FrameTheme = string;
export type FrameEdges = 'stretch' | 'repeat' | 'mirror' | 'random';
const EDGE_DIR: Record<FrameEdges, string> = { stretch: 'frames', repeat: 'frames', mirror: 'frames-mirror', random: 'frames-random' };
const EDGES = new Set<string>(['stretch', 'repeat', 'mirror', 'random']);
/** Source image of a frame for the chosen edge style (mirror/random are pre-built wide-edge versions). */
export const frameUrl = (name: string, edges: string = 'stretch', center: string = 'clean') => {
  const e = (EDGES.has(edges) ? edges : 'mirror') as FrameEdges;
  // a weathered centre exists only as part of the pre-built mirror/random images
  const suffix = center === 'random' && (e === 'mirror' || e === 'random') ? '-c' : '';
  return `url(/assets/${EDGE_DIR[e]}${suffix}/${name}.png)`;
};
/** The border-image-repeat keyword to use with it. */
export const edgeRepeat = (edges: string) => (edges === 'stretch' ? 'stretch' : 'repeat');
export const rawUrl = (name: string) => `/assets/raw/${name}.png`;

/**
 * A frame id is `name`, optionally with a colour variant and its own edge / centre style:  `name[~hue][:edges[:center]]`
 * e.g. `gold~120`, `gold:repeat`, `gold~120:mirror:random`, `gold::random` (centre only). A part left out follows the global
 * choice (Theme manager > frame). Colour variants are built in the browser from the original sprite (see tintFrame.ts).
 */
export const FRAME_HUES = [0, 60, 120, 180, 240, 300] as const;
const EDGE_IDS = ['stretch', 'repeat', 'mirror', 'random'], CENTER_IDS = ['clean', 'random'];
/** Corner size: how wide a frame's border is drawn, in interface units (the sprite's corner is 16 wide: 8 = half, 16 = as drawn, 32 = double, 64 = quadruple). */
export const FRAME_SCALES = [8, 16, 32, 64] as const;
/** Corner size of a chip: how many units each sprite pixel is drawn (the default is 2). */
export const CHIP_SCALES = [1, 2, 3, 4] as const;
export interface FrameParts { name: string; hue: number; edges?: string; center?: string; scale?: string }
export const splitFrame = (id: string): FrameParts => {
  const [head, edges, center, scale] = id.split(':'), [name, h] = head.split('~');
  // 4 (the old Tiny corner) no longer exists: settings saved with it now mean Normal
  return { name, hue: Number(h) || 0, edges: edges || undefined, center: center || undefined, scale: scale === '4' ? '16' : scale || undefined };
};
export const buildFrame = ({ name, hue, edges, center, scale }: FrameParts): string => {
  const parts = [edges ?? '', center ?? '', scale ?? ''];
  while (parts.length && !parts[parts.length - 1]) parts.pop();   // trailing parts left out
  return `${name}${hue ? `~${hue}` : ''}${parts.length ? `:${parts.join(':')}` : ''}`;
};
/** A frame id as chosen in the Theme manager, made safe for a small backdrop: clean stretched edges unless chosen, and never below 1x (corner size 16 or more). */
export const backdropFrame = (id: string, fallback: FrameTheme | 'app' = 'wood_gold_gem'): string => {
  const p = splitFrame(frameOr(id, fallback));
  return buildFrame({ ...p, edges: p.edges ?? 'stretch', center: p.center ?? 'clean', scale: String(Math.max(16, Number(p.scale) || 16)) });
};
/** `name~hue` keeping the id's own edge / centre choice. */
export const withHue = (name: string, hue: number) => buildFrame({ name, hue });

/**
 * The frame an id really draws: the name and hue ('app' = the main frame, whose own hue counts unless the id sets one), and the
 * edge / centre style (the id's own choice, else the global one).
 */
export function resolveFrame(id: string, mainFrame: string, globalEdges: string, globalCenter: string): { name: string; hue: number; edges: string; center: string; scale?: number } {
  const p = splitFrame(id), main = splitFrame(mainFrame);
  const isApp = p.name === 'app';
  const valid = (v?: string) => ((FRAME_SCALES as readonly number[]).includes(Number(v)) ? Number(v) : undefined);
  const scale = valid(p.scale) ?? (isApp ? valid(main.scale) : undefined);   // 'app' also inherits the main frame's corner size
  return { name: isApp ? main.name : p.name, hue: isApp ? (p.hue || main.hue) : p.hue, edges: p.edges ?? globalEdges, center: p.center ?? globalCenter, scale };
}

/** A frame id from settings, checked: 'app' (main frame) or a known theme with allowed hue / edges / centre, else the fallback (an imported file may hold anything). */
export const frameOr = (id: string, fallback: FrameTheme | 'app'): string => {
  const { name, hue, edges, center, scale } = splitFrame(id);
  const ok = (name === 'app' || name in FRAME_THEMES) && (FRAME_HUES as readonly number[]).includes(hue) && (!edges || EDGE_IDS.includes(edges)) && (!center || CENTER_IDS.includes(center)) && (!scale || (FRAME_SCALES as readonly number[]).includes(Number(scale)));
  return ok ? id : fallback;
};

// ---- buttons ---------------------------------------------------------------------------------
/** Frames bright enough that cream text is hard to read on them (see scripts/frame-luminance.mjs). */
export const LIGHT_FRAMES: Set<string> = (LIVE.__scryptureLight ??= new Set());
['gold', 'gold_ornate', 'wood_steel', 'wood_tiger', 'blue_steel', 'tech', ...Object.entries(CUSTOM).filter(([, v]) => v.light).map(([k]) => k)].forEach(n => LIGHT_FRAMES.add(n));
/** A button style is one of the two native button sprites (with a pressed state) or any frame. */
export const BUTTON_STYLES: string[] = (LIVE.__scryptureButtons ??= []);
BUTTON_STYLES.splice(0, BUTTON_STYLES.length, 'button_green', 'button_red', ...Object.keys(FRAME_THEMES));

/** Make a frame that was just added to the collection usable straight away, without reloading the page. */
export function registerFrame(name: string, accent: string, light: boolean): void {
  FRAME_THEMES[name] = accent;
  if (light) LIGHT_FRAMES.add(name); else LIGHT_FRAMES.delete(name);
  if (!BUTTON_STYLES.includes(name)) BUTTON_STYLES.push(name);
}

export interface ResolvedButton { frame: string; pressed: string; fx: boolean; dark: boolean; hue: number; edges?: string; center?: string; scale?: number }
export type NativeButton = 'button_green' | 'button_red';
/** A button style id may carry a colour variant (`gold~120`). */
export function resolveButton(style: string, fallback: NativeButton): ResolvedButton {
  const { name, hue: h, edges, center, scale: sc } = splitFrame(style);
  const scale = (FRAME_SCALES as readonly number[]).includes(Number(sc)) ? Number(sc) : undefined;
  const ok = BUTTON_STYLES.includes(name) && (FRAME_HUES as readonly number[]).includes(h) && (!edges || EDGE_IDS.includes(edges)) && (!center || CENTER_IDS.includes(center)) && (!sc || scale !== undefined);
  const s = ok ? name : fallback, hue = ok ? h : 0, own = ok ? { edges, center, scale } : {};
  if (s === 'button_green' || s === 'button_red') { const c = s.slice('button_'.length); return { frame: `${c}_button`, pressed: `${c}_button_pressed`, fx: false, dark: false, hue, ...own }; }
  return { frame: s, pressed: s, fx: true, dark: LIGHT_FRAMES.has(s), hue, ...own };
}
