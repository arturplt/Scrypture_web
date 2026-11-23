import { useEffect, useRef, useState, type ReactNode, type CSSProperties, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { releaseWorldPortal } from '../ui/worldPortal';
import { worldExitPath } from './worldEntry';
import { loadLakeDistrict, lakeOverview } from './lakeLoader';
import { createPortal } from 'react-dom';
import { lakeReady, lakeFarLods, tilesToKm, lakeOnMap, lakeSpawnFor, lakeWatersFrom, lakeWaterAt, lakeRoadAt, M6, lakePlaceLabels, lakeData, LAKE_LAND, LAKE_WATER, compass } from '../domain';
import {
  BILLBOARD_MAX_DISTANCE, soakPlane, HULL_DIP, SOFT_SINK, SOFT_BANK, hull, projectLanding, type GlideEnv, tunnelInCell, TUNNEL_CELL, TUNNEL_HALF_WIDTH, TUNNEL_HALF_LENGTH, sticksIn, stonesIn, STICK_PICK_RADIUS, tunnelAt, stepTricks, newTrickState, resetTricks, TRICK_POINTS, newCombo, comboAward, comboStep, comboMult, type TreeRef, naturalWind, addRunScore, landingScore, runPoints, coinsFor, HEIGHT_POINTS, BOOST_PRICE, MAX_BOOSTS, type RunScore, buy as shopBuy, offer as shopOffer, sanitizeUpgrades, launchHeight, launchMinPower, paperDrag, paperRain, TIERS, MAX_STOCK, type Upgrades, type ShopId, CHUNK, DEFAULT_CAMERA_DISTANCE, FLAT_VIEW_MIN_LOOK, FULL_LOOK_AIRSPEED, MAX_TILT_STEP, tiltAltitudeFactor, Ecosystem, MAX_CAMERA_DISTANCE, billboardLean, chaseOffset, easeOffset, isFlying, GRASS, SAND, SHEET, TILE_PX, WATER, World, advanceHour, biomeAt, chunkOf, clockText, currentLayer, darkness, decodeChanges, encodeChanges,
  hash01, keyX, keyY, layerScale, newFlight, parallax, stepFlight, sunElevation, tileKey, valueNoise01, type Cell, type Flight, type FlightMode, type Terrain,
  BASE_TEMPERATURE, STALL_SPEED, boostPlane, BOOST_COOLDOWN, START_BOOSTS, GROUND_ALT, launchPlane, hoopBoost, hoopsIn, passedHoop, TRIM_SPEED, groundEffect, airVertical, newGlider, stepGlider, thermalsIn, throwPlane, soundParams, SILENT, type Glider, type ThermalEnv,
} from '../domain';
import { actions, store, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelButton } from '../ui/PixelButton';
import { PixelFrame } from '../ui/PixelFrame';
import { BurnFire, BURN_SECONDS } from './BurnFire';
import { holdSync } from '../data/cloud';
import { PixelSlider } from '../ui/PixelSlider';
import { createAudioEngine, type AudioEngine } from '../audio/engine';
import { Icon } from '../ui/misc';
import { FlightInstruments } from '../ui/FlightInstruments';
import { emptyInstruments, type Instruments } from '../ui/instrumentDraw';
import { rawUrl } from '../ui/themes';
import { loadPlaneModel } from './planemodel';
import { Slot } from '../ui/Inventory';
import { exitFullscreen, isFullscreen } from '../ui/fullscreen';
import type { Key, TFn } from '../i18n';
import { WorldGL, type ChunkPx, type GroundChunk, GLOW, FX_UV, FX_MARK, FX_SCORCH, FX_FLAME, FX_TUNNEL, FX_WET } from './worldgl';
import { EcoStats } from './EcoStats';
import { FLAME_ASPECT, BOLT_ASPECT, BOLT_TIP, flameSprites, boltSprite, loadFireSprites } from './firesprites';
import { flammability, SCORCH_COOLDOWN, WET_TIME, RAIN_SCALE, rainRadius } from '../domain/ecosystem';
import { BeaversManager, MAX_TRUST, isHome, type Haul } from '../domain/beavers';
import { BerryPatch } from '../domain/berries';
import maleIdleUrl from '../assets/male_idle.png';
import femaleIdleUrl from '../assets/female_idle.png';
import { BEAVER_ASPECT, beaverLook, beaverSprites, loadBeaverSprites } from './beaversprites';
import { MIN_EYE_H, duelLine, duelPose, ZOOM_DEFAULT, ZOOM_RANGE, clampZoom, FREE_TILT_RANGE, flybyStep, newFlyby, nextCamMode, orbitEye, pinchBy, zoomBy, type CamMode } from '../domain/cameraman';
import SHEET_URL from '../assets/world-tiles.png';
import { CLOUD_ASPECT, cirrusSprites, cloudSprites, cloudPick, shadowOf, loadCloudSprites } from './cloudsprites';
import { newSas, nextSasMode, stepSas, type SasMode } from '../domain/sas';
import { STEP_KINDS, defaultStep, deleteSelected, loadPatterns, resetPatterns, stamped, savePatterns, startManeuver, stepManeuver, stepUnit, type Maneuver, type MCtl, type Pattern, type PatternStore } from '../domain/maneuver';
import { endDogfight, foeBearing, shotTolerance, sliderPos, startDogfight, stepDog, tapShot, type Dog, type DogEvent, type SliderSpec } from '../domain/dogfight';
import './world.css';

interface Deco { x: number; y: number; cell: Cell; scale: number }
/** A built chunk: its ground as raw pixels (the 3D view uploads them as they are; the flat view makes a canvas from them the first time it draws the chunk), and its trees, bushes and rocks. */
interface ChunkImg { src: ChunkPx; cv?: HTMLCanvasElement; decos: Deco[]; stale?: boolean }
interface Hud { landed: boolean; hour: number; temp: number; weather: 'heat' | 'cold' | null; x: number; y: number; layer: number; clouds: number; water: number; fps: number; ms: number; biome: string }
type Tool = 'fly' | 'paint';

const TILT_RAD = 1.1;   // radians of tipping per unit of tilt (slider step / 10): the top step, 0.8, is about 50 degrees
/** The slider's 0..16 as a tilt unit (x TILT_RAD radians): steps 1-8 are tenths (up to about 50 degrees), 9-16 go on to about 62 degrees. */
const tiltUnit = (n: number) => (n <= 8 ? n / 10 : 0.8 + (n - 8) * 0.0225);
const TILT_CAP = 0.98;
const MAX_REAL = 320;   // chunks asked for at once in the 3D view (about 80 MB of pictures); past that the far mesh covers the ground
const DECO_VIEW = 100;   // tiles: how far trees, bushes and rocks are built on a hilly world
const HOOP_VIEW = 100;   // tiles: how far hoops, rain clouds and their rain are drawn, whatever the draw distance
const LAKE_START_ALT = 50, LAKE_START_SPEED = 7;   // the Lake District starts in flight: metres above the ground, and ground speed in m/s
const LAKE_THROTTLE_MAX = 20;
const NO_NEED = { stick: false, stone: false, brk: false };
/** What the player on foot stands by and can act on: a dam that still takes pieces, a ripe berry bush, a beaver to feed. */
interface Act { dam: { stick: boolean; stone: boolean; brk: boolean }; bush: { x: number; y: number } | null; beaver: { id: number; sex: 'm' | 'f'; full: boolean; trust: number } | null }
const NO_ACT: Act = { dam: NO_NEED, bush: null, beaver: null };
type PickItem = 'stick' | 'stone' | 'berry';
const WALK_SPEED = 2.6;   // tiles per second on foot (Shift: twice)
const LAUNCH_CAM_T = 5;   // seconds the launch camera runs after a throw
const sstep = (v: number, a: number, b: number) => { const q = Math.max(0, Math.min(1, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
const ACRO_BASE = 128, ACRO_KNOB = 64, ACRO_R = 48;   // the acro sticks in CSS px: the 32 px sprites at 4x (base) and 2x (knob); the knob travels 48 px to reach the rim
const PITCH_TILT = 0.3;   // how far the plane's pitch moves the tilt (the slider's scale: 0.3 = 3 steps), nose up = more
const TERRAIN_COLOR: Record<Terrain, string> = { 0: '#0f6b8c', 1: '#e8c88a', 2: '#4a6b22' };

/** Four decorative cloud layers (Android's CloudManager): noise decides where, each layer drifts and sways at its own pace. */
const DECO_LAYERS = [
  { parallax: 1.1, drift: 1.5, opacity: 0.4, size: 0.8, offset: 0, sway: 8 },
  { parallax: 1.3, drift: 2.5, opacity: 0.7, size: 1.0, offset: 10000, sway: 10 },
  { parallax: 1.6, drift: 3.5, opacity: 0.9, size: 1.2, offset: 20000, sway: 12 },
  { parallax: 2.2, drift: 5.0, opacity: 1.0, size: 1.5, offset: 30000, sway: 14 },
];

/** The plane layer (1 high .. 10 low) each deco layer floats at: the plane is under it while its own layer number is smaller. */
const DECO_ALTITUDE = [8.5, 6.5, 4.5, 2.5];

export function WorldMap({ id }: { id: string }) {
  const w0 = useAppState(s => { const w = s.worlds.list.find(x => x.id === id); return w ? (w.kind ?? 'procedural') : ''; });   // (a primitive: saves and cloud sync must not re-render the whole world screen)
  const { t } = useI18n();
  if (!w0) return <div className="screen"><PixelButton size="compact" scale={1} variant="red" onClick={() => navigate('/games/paperplane')}>{t('back')}</PixelButton><p>{t('worldMissing')}</p></div>;
  return w0 === 'lakedistrict' ? <LakeGate id={id} /> : <WorldView key={id} id={id} />;
}

/** The Lake District's map is an image: wait for it before the world is built. */
function LakeGate({ id }: { id: string }) {
  const { t } = useI18n();
  const map = useAppState(s => s.worlds.list.find(w => w.id === id)?.map) ?? 'lakes';
  const [state, setState] = useState<'wait' | 'ok' | 'fail'>(lakeReady(map) ? 'ok' : 'wait');
  useEffect(() => { if (state === 'wait') loadLakeDistrict(map).then(() => setState('ok'), () => setState('fail')); }, []);
  if (state === 'ok') return <WorldView key={id} id={id} />;
  return <div className="screen"><PixelButton size="compact" scale={1} variant="red" onClick={() => navigate('/games/paperplane')}>{t('back')}</PixelButton><p>{state === 'wait' ? t('worldLakeLoading') : t('worldMissing')}</p></div>;
}

/** Graphics settings: presets and the saved custom values (kept on this device). */
interface Gfx { res: number; auto: boolean; cap: number; density: number; shaders: boolean; clouds: boolean; draw: number }
const GFX_PRESETS: Record<'low' | 'med' | 'high', Gfx> = {
  low: { res: 60, auto: false, cap: 30, density: 40, shaders: false, clouds: false, draw: 50 },
  med: { res: 80, auto: true, cap: 30, density: 70, shaders: false, clouds: true, draw: 75 },
  high: { res: 100, auto: true, cap: 60, density: 100, shaders: true, clouds: true, draw: 100 },
};
const GFX_KEY = 'scrypture:gfx';
const loadGfx = (): Gfx => { try { const r = JSON.parse(localStorage.getItem(GFX_KEY) ?? 'null'); if (r && typeof r.res === 'number') return { ...GFX_PRESETS.high, ...r }; } catch { /* none saved */ } return GFX_PRESETS.high; };

/** Every setting in the menu that is a choice of the pilot's (not the world's and not a debug aid), kept in this browser and brought back on the next visit. */
const PREFS_KEY = 'scrypture:worldPrefs';
const PREF_DEFAULTS = { invertPitch: false, aero: false, freeStall: false, showEco: false, showFps: false, showInst: true, miniHoops: true, miniHeat: true, hints: true, showRivers: false, billboards: false, gl3d: true, windAuto: true, muted: false, tilt: 16, walkDist: 100, mapUiSize: 50, instSize: 50, miniScale: 2, miniSize: 2, camMode: 'chase' as CamMode, secs: { debug: true } as Record<string, boolean> };
type Prefs = typeof PREF_DEFAULTS;
const PREF_RANGE: Partial<Record<keyof Prefs, [number, number]>> = { tilt: [0, 16], walkDist: [25, 200], mapUiSize: [50, 160], instSize: [50, 160], miniScale: [0.5, 64], miniSize: [2, 3] };
function loadPrefs(): Prefs {
  const out: Prefs = { ...PREF_DEFAULTS, secs: { ...PREF_DEFAULTS.secs } };
  try {
    const r = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (!r || typeof r !== 'object') return out;
    for (const k of Object.keys(PREF_DEFAULTS) as (keyof Prefs)[]) {
      const v = r[k], d = PREF_DEFAULTS[k];
      if (k === 'camMode') { if (v === 'chase' || v === 'free' || v === 'flyby') out.camMode = v; }   // (the duel view belongs to a match: it is not brought back)
      else if (k === 'secs') { if (v && typeof v === 'object') out.secs = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean').slice(0, 20)) as Record<string, boolean>; }
      else if (typeof d === 'boolean') { if (typeof v === 'boolean') (out as Record<string, unknown>)[k] = v; }
      else if (typeof d === 'number') { const [lo, hi] = PREF_RANGE[k] ?? [-1e9, 1e9]; if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, unknown>)[k] = Math.max(lo, Math.min(hi, v)); }
    }
  } catch { /* unreadable: the defaults */ }
  return out;
}
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window: not kept */ } };
const gfxPresetOf = (g: Gfx): 'low' | 'med' | 'high' | 'custom' => (['low', 'med', 'high'] as const).find(k => (Object.keys(GFX_PRESETS[k]) as (keyof Gfx)[]).every(x => GFX_PRESETS[k][x] === g[x])) ?? 'custom';

const perfStat = { why: '', r: 0, rMax: 0, lt: 0, ltMax: 0, gcN: 0, heap: 0 };   // (the ?perf readout: React renders, long tasks, heap drops)
function WorldView({ id }: { id: string }) {
  const rStart = performance.now();
  useEffect(() => { perfStat.r++; perfStat.rMax = Math.max(perfStat.rMax, performance.now() - rStart); });
  const { t } = useI18n();
  const saved0 = useRef(store.getState().worlds.list.find(w => w.id === id)!).current;   // read once: a subscription would re-render the screen on every save
  const initial = useRef(saved0.kind === 'lakedistrict' && !lakeOnMap(Math.floor(saved0.plane.x), Math.floor(saved0.plane.y), 4) ? { ...saved0, plane: { ...lakeSpawnFor(saved0.map ?? 'lakes') } } : saved0).current;   // (a Lake District world saved out past the map's edge starts at the spawn again)   // read once: the sim owns the state while open
  const scores = useAppState(s => s.worlds.list.find(w => w.id === id)?.scores) ?? NO_SCORES;   // this world's leaderboard
  const scoresRef = useRef<RunScore[]>(scores); scoresRef.current = scores;
  const coins = useAppState(s => s.inventory.bcoin ?? 0), coinsRef = useRef(coins); coinsRef.current = coins;   // the coins are the app's own BCOIN in the inventory: earned here, spent here, shared with everything else
  const stickRef = useRef(0); stickRef.current = useAppState(s => s.inventory.stick ?? 0);
  const stoneRef = useRef(0); stoneRef.current = useAppState(s => s.inventory.stone ?? 0);
  const berryRef = useRef(0); berryRef.current = useAppState(s => s.inventory.berry ?? 0);
  const [act, setAct] = useState<Act>(NO_ACT), actRef = useRef(act), actKey = useRef('||');   // what the player stands by: the interaction panel shows it
  const newFx = useRef<{ x: number; y: number; a: number; age: number; stone: boolean; berry?: boolean }[]>([]);   // pick-up effects started from a button: the frame loop takes them over
  const giveToDam = (kind: Haul) => { const s = sim.current!; if ((kind === 'stick' ? stickRef.current : stoneRef.current) > 0 && s.beavers.give(s.flight.x, s.flight.y, kind)) actions.addItem(kind, -1); };
  const [pickToast, setPickToast] = useState<{ item: PickItem; from: number; to: number; at: number } | null>(null);
  const pickBush = () => {
    const s = sim.current!, b = actRef.current.bush, n = b ? s.berries.pick(b.x, b.y) : 0, had = berryRef.current;
    if (!b || !n) return;
    for (let i = 0; i < n; i++) newFx.current.push({ x: b.x + 0.5 + (i - (n - 1) / 2) * 0.3, y: b.y + 0.5, a: 0, age: -i * 0.12, stone: false, berry: true });
    actions.addItem('berry', n); actions.saveWorld(id, { berries: s.berries.toSaved() }); s.berries.dirty = false;
    setPickToast(prev => { const fresh = !!prev && prev.item === 'berry' && Date.now() - prev.at < 2200, from = fresh ? prev!.to : had; return { item: 'berry', from, to: from + n, at: Date.now() }; });
    audio.current?.play('ready');
  };
  const feedBeaver = () => {
    const s = sim.current!, b = berryRef.current > 0 ? s.beavers.beaverNear(s.flight.x, s.flight.y) : null;
    if (b && s.beavers.feed(b, s.flight.x)) { actions.addItem('berry', -1); audio.current?.play('ready'); }
  };
  /** What the F key (and the marked button) does here: feed, else pick, else hand a piece to the dam. */
  const primaryAct = (a: Act): 'feed' | 'pick' | 'stick' | 'stone' | null =>
    a.beaver && !a.beaver.full && berryRef.current > 0 ? 'feed' : a.bush ? 'pick' : a.dam.stick && stickRef.current > 0 ? 'stick' : a.dam.stone && stoneRef.current > 0 ? 'stone' : null;
  const breakDam = () => {
    const s = sim.current!, got = s.beavers.breakDam(s.flight.x, s.flight.y);
    if (!got) return;
    if (got.sticks) actions.addItem('stick', got.sticks);
    if (got.stones) actions.addItem('stone', got.stones);
    audio.current?.play('ready');
  };
  const interact = () => { const k = primaryAct(actRef.current); if (k === 'feed') feedBeaver(); else if (k === 'pick') pickBush(); else if (k) giveToDam(k); };
  const interactRef = useRef(interact); interactRef.current = interact;
  const addCoins = (n: number) => { coinsRef.current = Math.max(0, coinsRef.current + n); actions.addItem('bcoin', n); };
  useEffect(() => { if ((initial.coins ?? 0) > 0) { actions.addItem('bcoin', initial.coins!); actions.saveWorld(id, { coins: 0 }); } }, []);   // coins an earlier version kept inside the world move to the inventory
  const buyBoost = () => { const g = sim.current!.glider; if (!g.landed || coinsRef.current < BOOST_PRICE || g.boostCharges >= MAX_BOOSTS) return; addCoins(-BOOST_PRICE); g.boostCharges++; };
  const [up, setUpState] = useState<Upgrades>(() => sanitizeUpgrades(initial.shop)), upRef = useRef(up);   // what was bought in the shop (kept per world)
  const setUpgrades = (u: Upgrades) => { upRef.current = u; setUpState(u); sim.current!.glider.dragK = paperDrag(u.paper); actions.saveWorld(id, { shop: u }); };
  const buyItem = (what: ShopId) => { if (!sim.current!.glider.landed) return; const r = shopBuy(what, upRef.current, coinsRef.current); if (r) { addCoins(-r.cost); setUpgrades(r.up); } };
  const runStat = useRef({ startZ: 40, peakZ: 40 });   // where this run's flight began and the highest it got: the climb scores
  const [shopOpen, setShopOpen] = useState(false);   // the boost shop (from the result popup or the button beside Throw)
  const [burnPop, setBurnPop] = useState<{ n: number; key: number } | null>(null), burnedRef = useRef(initial.burned ?? 0), deadRef = useRef(false), respawnReq = useRef(false);   // fire or lightning got the plane: GAME OVER with how many times it has burned
  const [runResult, setRunResult] = useState<{ hoops: number; metres: number; height: number; bonus: number; soft: boolean; water: boolean; saved: 'insurance' | 'float' | null; dbl: number; coins: number; key: number; trick: number; tag?: { pts: number; you: number; ai: number }; tricks: { name: string; n: number; pts: number }[] } | null>(null);   // the popup after a run: how it ended and what it scored
  const sim = useRef<{ world: World; eco: Ecosystem; beavers: BeaversManager; berries: BerryPatch; flight: Flight; glider: Glider; hour: number; explored: Set<number> } | null>(null);
  if (!sim.current) {
    const world = new World(initial.seed, decodeChanges(initial.changes), initial.kind ?? 'procedural');
    const flight = newFlight(initial.plane.x, initial.plane.y);
    flight.heading = initial.plane.heading; flight.pitch = initial.plane.pitch;
    const eco = new Ecosystem(world, Math.random, { ...initial.wind });
    const picked = { sticks: new Set<string>(initial.sticks ?? []), stones: new Set<string>(initial.stones ?? []) };   // what has been taken off the ground, by the player or a beaver
    sim.current = { world, eco, beavers: new BeaversManager(world, eco, Math.random, picked, initial.beavers), berries: new BerryPatch(world, initial.berries), flight, glider: newGlider(initial.plane.x, -initial.plane.y, initial.plane.heading), hour: initial.hour, explored: new Set(initial.explored) };
    sim.current.beavers.dayNight = true;   // the beavers keep to the sky's clock
    { const g0 = sim.current.glider; g0.z = 0; g0.vx = g0.vy = g0.vz = 0; g0.landed = true; g0.impact = null; }   // every visit starts on the ground (on foot, Throw ready), no touchdown popup
    sim.current.glider.boostCharges = initial.boosts ?? START_BOOSTS;   // the boosts left from last time
    sim.current.glider.dragK = paperDrag(sanitizeUpgrades(initial.shop).paper);   // and the paper bought in the shop
  }
  const root = useRef<HTMLDivElement>(null);
  const viaApi = useRef(false);
  const [full, setFull] = useState(false);
  const autoFull = useAppState(st => st.settings.fullscreen);   // the app's own setting: go full screen on the first tap (also in Settings)
  const [panelOpen, setPanelOpen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const bigMap = useRef<HTMLCanvasElement>(null);   // the full-screen map (minimap zoom 3 to 5): time stops while it is open
  const liftMsg = useRef<HTMLDivElement>(null);   // "+1.8 m/s" above the last instrument while the plane climbs in rising air
  const liftHint = useRef<HTMLDivElement>(null), liftArrow = useRef<HTMLImageElement>(null), liftDist = useRef<HTMLSpanElement>(null);
  const hoopHint = useRef<HTMLDivElement>(null), hoopArrow = useRef<HTMLImageElement>(null), hoopDist = useRef<HTMLSpanElement>(null);   // and to the nearest hoop not yet flown   // the arrow to the nearest air lift
  const sheet = useRef<HTMLImageElement | null>(null);
  const chunks = useRef(new Map<number, ChunkImg>());
  const keys = useRef(new Set<string>());
  const stick = useRef({ dx: 0, dy: 0 }), lookStick = useRef({ dx: 0, dy: 0 }), yawStick = useRef({ dx: 0, dy: 0 });   // (the second joystick: on foot it looks round; in the free view the left one is the rudder)
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const prefs0 = useRef(loadPrefs()).current;   // the pilot's saved settings
  const [mode, setMode] = useState<FlightMode>('glide');
  const [invertPitch, setInvertPitch] = useState(prefs0.invertPitch);
  const [debugLiftV, setDebugLiftV] = useState(initial.kind === 'lakedistrict' ? 1.6 : 3), [throttle, setThrottle] = useState(0);   // debug: the updraft's strength in m/s, and a throttle (0..100 %) pushing along the nose
  const [debugLift, setDebugLift] = useState(initial.kind === 'lakedistrict');   // debug: a constant 3 m/s updraft everywhere
  const [aero, setAero] = useState(prefs0.aero);   // loops, rolls and inverted flight
  const [freeStall, setFreeStall] = useState(prefs0.freeStall);   // let a hard pull stall the plane
  const [showEco, setShowEco] = useState(prefs0.showEco);   // the ecosystem stats window (a toggle in the menu)
  const [showFps, setShowFps] = useState(prefs0.showFps);   // the frames-per-second box beside the menu button (a toggle in the menu)
  const [showInfo, setShowInfo] = useState(false);   // the "i" button in the menu: the how-to-control texts
  const [hideUi, setHideUi] = useState(false);   // the eye button: everything but the view (and the stick) goes away
  const setZoomTo = (v: number) => { const m = camEffRef.current; setZoomPos(v); camZoom.current[m] = posToZoom(m, v); };
  const zoomDrag = (e: React.PointerEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(), pad = r.width / 2; setZoomTo(Math.max(0, Math.min(1, 1 - (e.clientY - r.top - pad) / Math.max(1, r.height - 2 * pad)))); };   // (up is closer)
  const [trimPitch, setTrimPitch] = useState(0), [trimRoll, setTrimRoll] = useState(0), [trimYaw, setTrimYaw] = useState(0);   // glide trim, -50..50 % of the stick: held hands-off, like a trim tab
  const [showInst, setShowInst] = useState(prefs0.showInst);
  const [miniHoops, setMiniHoops] = useState(prefs0.miniHoops), [miniHeat, setMiniHeat] = useState(prefs0.miniHeat);   // what the little map shows: the hoops, and the hot air (thermals)
  const [secs, setSecs] = useState<Record<string, boolean>>(prefs0.secs);   // the settings sheet's sections: all folded except the debug one
  const toggleSec = (id: string) => setSecs(m => ({ ...m, [id]: !m[id] }));
  const [pats, setPats] = useState<PatternStore>(loadPatterns);   // flight patterns: chains of steps flown on one button (X)
  const patsRef = useRef(pats); patsRef.current = pats;
  const man = useRef<Maneuver | null>(null);   // the pattern being flown, null when the pilot has the stick
  const dog = useRef<Dog | null>(null);   // the dogfight tag match, null when there is none
  const [dogOn, setDogOn] = useState(false);
  const [dogShot, setDogShot] = useState<{ key: number; specs: SliderSpec[] } | null>(null);   // the skill shot, open while the sliders sweep
  const dogLast = useRef({ you: 0, ai: 0 });   // the tag tally of the current run (it goes into the run's score summary when the plane lands)
  const dogHint = useRef<HTMLDivElement>(null), dogArrow = useRef<HTMLImageElement>(null), dogDist = useRef<HTMLSpanElement>(null), dogHud = useRef<HTMLDivElement>(null), dogMsgEl = useRef<HTMLDivElement>(null), dogMsgTimer = useRef(0);
  const dogTxt = useRef({ chase: '', flee: '', lock: '', hit: '', hurt: '', miss: '', dodged: '', incoming: '', tag: '', win: '', lose: '' });
  dogTxt.current = { chase: t('worldDogChase'), flee: t('worldDogFlee'), lock: t('worldDogLock'), hit: t('worldDogHit'), hurt: t('worldDogHurt'), miss: t('worldDogMiss'), dodged: t('worldDogDodged'), incoming: t('worldDogIncoming'), tag: t('worldDogTag'), win: t('worldDogWin'), lose: t('worldDogLose') };
  useEffect(() => { savePatterns(pats); }, [pats]);
  const [watersOpen, setWatersOpen] = useState(false);   // the Lake District's list of waters (tap the place name)
  const [planeSizeI, setPlaneSizeI] = useState(() => { try { const v = Number(localStorage.getItem('scrypture.planeSize')); return Number.isInteger(v) && v >= 0 && v < PLANE_SIZES.length ? v : 0; } catch { return 0; } }), planeLenRef = useRef(PLANE_SIZES[planeSizeI]);   // how long the paper plane is drawn: you choose (starts at a real 0.3 m)
  planeLenRef.current = PLANE_SIZES[planeSizeI];
  const [walkDist, setWalkDist] = useState(prefs0.walkDist);   // on foot (hilly worlds): how far the real chunks reach, % of the usual 200 tiles
  const gfx0 = useRef(loadGfx()).current;
  const [resScale, setResScale] = useState(gfx0.res), [resAuto, setResAuto] = useState(gfx0.auto), [fpsCap, setFpsCap] = useState(gfx0.cap), [decoDensity, setDecoDensity] = useState(gfx0.density);   // graphics: render resolution (%), whether it also drops by itself when slow, frame cap, how many trees, bushes and rocks (%)
  const [drawDist, setDrawDist] = useState(gfx0.draw);   // draw distance, % of the usual cap (320 tiles) on how far the ground is drawn
  const [mapUiSize, setMapUiSize] = useState(prefs0.mapUiSize);   // the minimap and the boxes beside it (biome, clock, wind, temperature, zoom), %
  const [instSize, setInstSize] = useState(prefs0.instSize);   // the flight instrument's size, % (the menu's slider)
  const [onFoot, setOnFoot] = useState(false), [fullUi, setFullUi] = useState(false);   // on foot (landed) the screen is cleared like the eye button does, leaving the joystick, Throw and Shop along the bottom; the eye brings the rest back
  const footRef = useRef(false);
  const lookUi = onFoot && !fullUi && mode === 'glide';   // (then dragging the view looks round and up and down; the joystick walks)
  const lookCam = useRef({ on: false, pitch: 0 });
  // the cameraman (see cameraman.ts): chase, free view or flyby, changed with C or the camera button; the wheel (or a pinch in the free view) zooms the one that is on
  const [camMode, setCamMode] = useState<CamMode>(prefs0.camMode);
  const instStick = useRef<{ cx: number; cy: number; r: number; x: number; y: number; id: number } | null>(null);   // free view: a finger on the attitude indicator flies pitch and roll, only while it is down
  useEffect(() => { const up = (e: PointerEvent) => { if (instStick.current?.id === e.pointerId) instStick.current = null; }; window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); }; }, []);
  const lookFly = camMode === 'free' && mode === 'glide', lookYaw = useRef(0), freeTilt = useRef(1.1);   // free view: dragging the view turns the camera round the plane (and tips it) instead of steering; the keys still fly
  const camZoom = useRef({ ...ZOOM_DEFAULT }), camZoomNow = useRef({ ...ZOOM_DEFAULT }), camEffRef = useRef<CamMode>('chase'), poseOkRef = useRef(true);   // (what the wheel has asked for, and where the view has eased to)
  const duelAng = useRef<number | null>(null), duelTilt = useRef(0.85), flyby = useRef(newFlyby()), poseK = useRef(0), lastPose = useRef({ x: 0, y: 0, h: 10 }), pinch = useRef({ pts: new Map<number, { x: number; y: number }>(), d: 0 });
  // the tilt slider (next to the zoom slider): what it tips depends on the view. Chase: the ground's tilt (the menu's Tilt, 0..16); free and duel: the camera's angle from straight down. Up is nearer the horizon.
  const [tiltPos, setTiltPos] = useState(0);
  const tiltPosRef = useRef<() => number>(() => 0);
  const tiltPin = useRef<number | null>(null), tiltEff = useRef(0);   // chase tilt: the tilt in use now (steps), which fades with height; pinned = the slider holds it at every height
  const tiltPosNow = () => { const m = live.current.camMode, [lo, hi] = FREE_TILT_RANGE; return m === 'free' ? (freeTilt.current - lo) / (hi - lo) : m === 'duel' ? (duelTilt.current - lo) / (hi - lo) : m === 'flyby' ? 0 : tiltEff.current / 16; };   // (the slider shows the tilt in use now, not the one asked for: that fades away with height)
  const setTiltTo = (v: number) => { const m = live.current.camMode, [lo, hi] = FREE_TILT_RANGE, k = Math.max(0, Math.min(1, v)); setTiltPos(k); if (m === 'free') freeTilt.current = lo + k * (hi - lo); else if (m === 'duel') duelTilt.current = lo + k * (hi - lo); else if (m === 'chase') { const n = Math.round(k * 16); tiltPin.current = n; setTilt(n); } };   // (dragged: the tilt is held at every height, instead of fading to flat by 190 m)
  tiltPosRef.current = tiltPosNow;
  const tiltDrag = (e: React.PointerEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(), pad = r.width / 2; setTiltTo(1 - (e.clientY - r.top - pad) / Math.max(1, r.height - 2 * pad)); };
  const cycleCam = () => setCamMode(m => { if (live.current.mode !== 'glide' || !poseOkRef.current) return 'chase'; if (dog.current) return m === 'chase' ? 'duel' : m === 'duel' ? 'free' : 'chase'; return m === 'chase' ? 'free' : 'chase'; });   // (chase and free; in a dogfight chase, duel and free)   // (the button and the C key swap chase and free; the flyby is still chosen in the settings)
  const cycleCamRef = useRef(cycleCam); cycleCamRef.current = cycleCam;
  // the zoom slider (phones): 0..1, up = closer, on a log scale over the range of whichever camera is on; it follows the wheel and the pinch too
  const [zoomPos, setZoomPos] = useState(0.5);
  const zoomToPos = (m: CamMode, z: number) => { const [a, b] = ZOOM_RANGE[m], k = Math.log(z / a) / Math.log(b / a); return m === 'chase' ? k : 1 - k; };
  const posToZoom = (m: CamMode, v: number) => { const [a, b] = ZOOM_RANGE[m], k = m === 'chase' ? v : 1 - v; return clampZoom(m, a * Math.pow(b / a, k)); };
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const id = window.setInterval(() => { const m = camEffRef.current; setZoomPos(p => { const n = zoomToPos(m, camZoom.current[m]); return Math.abs(n - p) > 0.004 ? n : p; }); setTiltPos(p => { const n = tiltPosRef.current(); return Math.abs(n - p) > 0.004 ? n : p; }); }, 250);
    return () => clearInterval(id);
  }, []);
  const launchCam = useRef<{ t: number; x: number; y: number; eyeH: number; pitch: number } | null>(null);   // after a throw: the camera stays where it was held while the plane flies out of it, then swings in behind and backs off
  const lookLast = useRef<{ x: number; y: number; id: number } | null>(null);
  lookCam.current.on = lookUi;
  const [hints, setHints] = useState(prefs0.hints);
  const volume = useAppState(s => s.settings.volume);   // 0 = sound off (Settings); the menu button mutes just this world
  const [muted, setMuted] = useState(prefs0.muted);
  const audio = useRef<AudioEngine | null>(null);
  const sfx = useRef({ boost: 0, cd: 0, landed: true, streak: 0, streakAt: -99 });   // last frame's values, to find the moments sounds start
  const inst = useRef<Instruments>(emptyInstruments());
  const aim = useRef<{ on: boolean; t: number; x0: number | null; dx: number }>({ on: false, t: 0, x0: null, dx: 0 });   // the ground launch: hold to aim and charge, let go to throw
  const wasLanded = useRef(false), floated = useRef(false);   // a crash (the moment it lands) resets the trims and the mouse steering
  const [mouseFly, setMouseFly] = useState(false);   // click the attitude indicator: the mouse flies pitch and roll
  const mouse = useRef({ x: 0, y: 0 });
  const lastTap2 = useRef<{ t: number; x: number; y: number } | null>(null);   // the last touch on the view, for the double tap
  const dual = useRef(new Map<number, { side: 'L' | 'R'; x0: number; y0: number; x: number; y: number }>());   // acro: one finger per half of the view, like an FPV drone's two sticks (left: yaw, right: pitch and roll)
  const acroEl = useRef<{ L: HTMLDivElement | null; R: HTMLDivElement | null }>({ L: null, R: null });
  const touchStick = useRef<{ x: number; y: number; id: number } | null>(null);   // a finger down on the view: the stick starts where it touched and goes away when it lifts
  const [speed, setSpeed] = useState(3);
  const [pitch, setPitch] = useState(initial.plane.pitch);
  const [wind, setWind] = useState({ ...initial.wind });
  const [windAuto, setWindAuto] = useState(prefs0.windAuto);   // natural wind: strength and direction drift over time (the dial, the sliders or a double tap take over)
  const altZoom = useRef(1);   // 1 near the ground, down to 0.15 high up (smooth)
  const [miniScale, setMiniScale] = useState(Math.min(prefs0.miniScale, BIG_MAP_SCALE / 2));   // world tiles per minimap pixel (a world never opens on the full-screen map, which stops time)
  const miniDirty = useRef(false);
  const [miniSize, setMiniSize] = useState(prefs0.miniSize);   // minimap size multiplier: 2 (standard) or 3; double tap toggles
  const lastTap = useRef(0);
  const [decoClouds, setDecoClouds] = useState(gfx0.clouds);
  const [showRivers, setShowRivers] = useState(prefs0.showRivers);
  const [billboards, setBillboards] = useState(prefs0.billboards);
  const [camDist, setCamDist] = useState(DEFAULT_CAMERA_DISTANCE);
  const [gl3d, setGl3d] = useState(prefs0.gl3d);   // tilt / behind plane are drawn through WebGL (a real camera); off = the flat canvas, tipped by the browser
  const [shaders, setShaders] = useState(gfx0.shaders);   // the 3D view's extras: living water, sunlight, glow and sun rays
  const gfxNow: Gfx = { res: resScale, auto: resAuto, cap: fpsCap, density: decoDensity, shaders, clouds: decoClouds, draw: drawDist };
  const gfxPreset = gfxPresetOf(gfxNow);
  const applyGfx = (g: Gfx) => { setResScale(g.res); setResAuto(g.auto); setFpsCap(g.cap); setDecoDensity(g.density); setShaders(g.shaders); setDecoClouds(g.clouds); setDrawDist(g.draw); };
  useEffect(() => { try { localStorage.setItem(GFX_KEY, JSON.stringify(gfxNow)); } catch { /* not saved */ } }, [resScale, resAuto, fpsCap, decoDensity, shaders, decoClouds, drawDist]);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const camAng = useRef(0);
  const planeH = useRef(0);   // the height (tiles above the ground) the plane was drawn at last frame: the chase camera looks at it
  const planeY = useRef(0);   // where the plane was on the stage last frame (px from the top)
  const camTilt = useRef(0);   // the tilt in use now (the slider's value, changed by the plane's pitch)
  const [tilt, setTilt] = useState(prefs0.tilt);   // 0 = flat; 1..16 = how far the ground tips away; starts at the top and fades to flat by 190 m
  useEffect(() => { savePrefs({ invertPitch, aero, freeStall, showEco, showFps, showInst, miniHoops, miniHeat, hints, showRivers, billboards, gl3d, windAuto, muted, tilt, walkDist, mapUiSize, instSize, miniScale, miniSize, camMode, secs }); }, [invertPitch, aero, freeStall, showEco, showFps, showInst, miniHoops, miniHeat, hints, showRivers, billboards, gl3d, windAuto, muted, tilt, walkDist, mapUiSize, instSize, miniScale, miniSize, camMode, secs]);   // every choice in the menu is remembered
  const camOff = useRef({ x: 0, y: 0 });
  const camZRef = useRef<number | null>(null);   // the height above the ground the camera works from: eased on hills, or the view would breathe with every bump
  const camPos = useRef({ x: initial.plane.x, y: initial.plane.y });
  const [paused, setPaused] = useState(false);
  const [tool, setTool] = useState<Tool>('fly');
  const [brush, setBrush] = useState<Terrain>(WATER);
  const [radius, setRadius] = useState(1);
  // numbers on screen live in a ref and are read by tiny components on a timer, so the 4-times-a-second update never re-renders this whole screen
  const hudRef = useRef<Hud>({ landed: false, hour: initial.hour, temp: 20, weather: null, x: 0, y: 0, layer: 5, clouds: 0, water: 0, fps: 0, ms: 0, biome: '' });
  const knobEl = useRef<HTMLImageElement>(null);
  const setKnob = (k: { x: number; y: number }) => { if (knobEl.current) knobEl.current.style.transform = `translate(${k.x * Number(knobEl.current.dataset.travel ?? 45)}%, ${k.y * Number(knobEl.current.dataset.travel ?? 45)}%)`; };
  const live = useRef({ mouseFly, invertPitch, freeStall, aero, debugLift, debugLiftV, throttle, drawDist, walkDist, camMode, trimPitch, trimRoll, trimYaw, hideUi: hideUi || lookUi, lookUi, resScale, resAuto, fpsCap, decoDensity, lookFly, showInst, windAuto, aimText: t('worldAim'), turbText: t('worldTurb'), geText: t('worldGroundEffect'), mowerText: t('worldTrickMower'), invertedText: t('worldTrickInverted'), skimText: t('worldTrickSkim'), comboText: t('worldCombo'), slalomTrick: t('worldTrickSlalom'), stallTrick: t('worldTrickStall'), thermalTrick: t('worldTrickThermal'), rollTrick: t('worldTrickRoll'), loopTrick: t('worldTrickLoop'), immelmanTrick: t('worldTrickImmelman'), splitSTrick: t('worldTrickSplitS'), turn90Trick: t('worldTrickTurn90'), uTurnTrick: t('worldTrickUTurn'), miniHoops, miniHeat, hints, glideKeys: t('worldGlideKeys'), boostText: t('worldBoost'), hoopsText: t('worldHoops'), bestText: t('worldBest'), hoopText: t('worldHoop'), landedText: t('worldLanded'), stallText: t('worldStall'), wetText: t('worldWet'), liftText: (n: string) => t('worldLift', { n }), miniScale, mode, speed, pitch, wind, decoClouds, showRivers, billboards, camDist, tilt, gl3d, shaders, paused, tool, brush, radius, volume: muted ? 0 : volume });
  live.current = { mouseFly, invertPitch, freeStall, aero, debugLift, debugLiftV, throttle, drawDist, walkDist, camMode, trimPitch, trimRoll, trimYaw, hideUi: hideUi || lookUi, lookUi, resScale, resAuto, fpsCap, decoDensity, lookFly, showInst, windAuto, aimText: t('worldAim'), turbText: t('worldTurb'), geText: t('worldGroundEffect'), mowerText: t('worldTrickMower'), invertedText: t('worldTrickInverted'), skimText: t('worldTrickSkim'), comboText: t('worldCombo'), slalomTrick: t('worldTrickSlalom'), stallTrick: t('worldTrickStall'), thermalTrick: t('worldTrickThermal'), rollTrick: t('worldTrickRoll'), loopTrick: t('worldTrickLoop'), immelmanTrick: t('worldTrickImmelman'), splitSTrick: t('worldTrickSplitS'), turn90Trick: t('worldTrickTurn90'), uTurnTrick: t('worldTrickUTurn'), miniHoops, miniHeat, hints, glideKeys: t('worldGlideKeys'), boostText: t('worldBoost'), hoopsText: t('worldHoops'), bestText: t('worldBest'), hoopText: t('worldHoop'), landedText: t('worldLanded'), stallText: t('worldStall'), wetText: t('worldWet'), liftText: (n: string) => t('worldLift', { n }), miniScale, mode, speed, pitch, wind, decoClouds, showRivers, billboards, camDist, tilt, gl3d, shaders, paused, tool, brush, radius, volume: muted ? 0 : volume };

  useEffect(() => { const s = sim.current!; s.flight.mode = mode; s.flight.speed = speed; s.flight.pitch = pitch; }, [mode, speed, pitch]);
  const startedLanded = useRef(false);
  useEffect(() => {   // picking glide throws the plane from where it is, the way it points
    const s = sim.current!;
    if (mode === 'glide' && !startedLanded.current) {   // (opening the world: no throw, the plane starts landed, Throw ready)
      startedLanded.current = true;
      if (s.world.kind === 'lakedistrict' && !initial.plane.landed) { throwPlane(s.glider, s.flight.x, -s.flight.y, s.flight.heading, LAKE_START_ALT, LAKE_START_SPEED, 0); s.flight.glideAlt = LAKE_START_ALT; s.flight.glideLanded = false; }   // the Lake District opens in the air: 50 m up, 7 m/s, level (unless it was saved on the ground: then it stays there, on foot)
      else { s.glider.landed = true; s.glider.z = 0; s.glider.vx = s.glider.vy = s.glider.vz = 0; s.glider.impact = null; s.flight.glideAlt = 0; s.flight.glideLanded = true; }
      runStat.current = { startZ: s.glider.z, peakZ: s.glider.z };
    } else if (mode === 'glide') { throwPlane(s.glider, s.flight.x, -s.flight.y, s.flight.heading); s.flight.glideAlt = s.glider.z; s.flight.glideLanded = false; runStat.current = { startZ: s.glider.z, peakZ: s.glider.z }; }
  }, [mode]);
  useEffect(() => { miniDirty.current = true; }, [miniScale, miniHoops, miniHeat]);
  useEffect(() => { sim.current!.eco.wind = { ...wind }; }, [wind]);

  // full screen: the browser's own full screen on the whole screen when it can, else a fixed layer over the app
  const toggleFull = async () => {
    if (full) { setFull(false); setPanelOpen(false); if (viaApi.current) { viaApi.current = false; await exitFullscreen(); } return; }
    setFull(true);
    const el = root.current as (HTMLElement & { requestFullscreen?: (o?: object) => Promise<void> }) | null;
    try { if (el?.requestFullscreen) { await el.requestFullscreen({ navigationUI: 'hide' }); viaApi.current = true; } } catch { /* keep the fixed layer */ }
  };
  useEffect(() => {   // leaving with Esc / back also leaves our mode
    const onChange = () => { if (viaApi.current && !document.fullscreenElement) { viaApi.current = false; setFull(false); setPanelOpen(false); } };
    document.addEventListener('fullscreenchange', onChange);
    return () => { document.removeEventListener('fullscreenchange', onChange); if (viaApi.current && isFullscreen()) void exitFullscreen(); };
  }, []);

  // load the sheet, build the shadow sprite
  const shadowSprite = useRef<HTMLCanvasElement | null>(null);
  const stickImg = useRef<HTMLImageElement | null>(null), leafImgs = useRef<(HTMLImageElement | null)[]>([null, null, null]), stoneImg = useRef<HTMLImageElement | null>(null), berryImg = useRef<HTMLImageElement | null>(null);   // the ground stick, then the autumn leaf, the maple leaf and the pollen
  const planeModel = useRef<Awaited<ReturnType<typeof loadPlaneModel>> | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      sheet.current = img;
      const sh = document.createElement('canvas'); sh.width = sh.height = TILE_PX;
      const g = sh.getContext('2d')!;
      g.drawImage(img, SHEET.cloud[0] * TILE_PX, SHEET.cloud[1] * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, TILE_PX, TILE_PX);
      shadowSprite.current = sh;
      const loadImg = (name: string, put: (im: HTMLImageElement) => void) => new Promise<void>(res => { const im = new Image(); im.onload = () => { put(im); res(); }; im.onerror = () => res(); im.src = rawUrl(name); });
      const sdone = Promise.all([loadImg('stick', im => { stickImg.current = im; }), loadImg('leaf', im => { leafImgs.current[0] = im; }), loadImg('leaf_maple', im => { leafImgs.current[1] = im; }), loadImg('pollen', im => { leafImgs.current[2] = im; }), loadImg('stone', im => { stoneImg.current = im; }), loadImg('berry', im => { berryImg.current = im; })]);
      Promise.all([loadCloudSprites(), loadFireSprites(), loadBeaverSprites(), loadPlaneModel().then(m => { planeModel.current = m; }).catch(e => console.warn('plane model:', e)), sdone]).finally(() => { setReady(true); });   // (the world starts once the plane model is in too, so the flat sprite never shows first)
    };
    img.onerror = () => setFailed(true);
    img.src = SHEET_URL;
  }, []);

  // the ground launch: pressing Throw (or Space) on the ground holds the plane 1 m up while you aim (slide sideways, A / D, or the mouse), the longer the hold the harder the throw; letting go launches it
  const startAim = (x0: number | null = null) => { const s = sim.current!; if (live.current.mode !== 'glide' || !s.glider.landed || aim.current.on) return; aim.current = { on: true, t: 0, x0, dx: 0 }; s.glider.z = launchHeight(upRef.current.launch); setRunResult(null); setShopOpen(false); };
  const releaseAim = () => {
    const a = aim.current; if (!a.on) return; aim.current = { on: false, t: 0, x0: null, dx: 0 };
    const s = sim.current!; launchCam.current = { t: 0, x: s.flight.x, y: s.flight.y, eyeH: 0.55, pitch: 0.03 + lookCam.current.pitch };
    launchPlane(s.glider, s.flight.x, -s.flight.y, s.glider.psi, Math.max(launchMinPower(upRef.current.launch), aimPower(a.t)), launchHeight(upRef.current.launch)); s.flight.glideLanded = false;
    runStat.current = { startZ: launchHeight(upRef.current.launch), peakZ: launchHeight(upRef.current.launch) };   // a new flight: height is counted from where it started
  };
  // Space: in the air a boost of speed and lift; on the ground it starts the aim (and the key coming up throws)
  const dogMsg = (text: string) => { const el = dogMsgEl.current; if (!el) return; el.textContent = text; el.style.display = 'block'; clearTimeout(dogMsgTimer.current); dogMsgTimer.current = window.setTimeout(() => { el.style.display = 'none'; }, 1600); };
  const dogEvents = (evs: DogEvent[]) => {   // what happened in the match this frame: sounds, banners, the result
    const D = dog.current, tx = dogTxt.current, parts: string[] = [];
    for (const e of evs) {
      if (e === 'shotOpen' && D?.shot) { setDogShot({ key: Date.now(), specs: D.shot.specs }); audio.current?.play('blip'); }
      else if (e === 'incoming') { parts.push(tx.incoming); audio.current?.play('blip'); }
      else if (e === 'hit') { parts.push(tx.hit); setDogShot(null); audio.current?.play('hit'); }
      else if (e === 'hurt') { parts.push(tx.hurt); setDogShot(null); audio.current?.play('crash', 0.3); }
      else if (e === 'miss') { parts.push(tx.miss); setDogShot(null); audio.current?.play('shot'); }
      else if (e === 'dodged') { parts.push(tx.dodged); audio.current?.play('ready'); }
      else if (e === 'swap' && D) parts.push(D.role === 'chase' ? tx.chase : tx.flee);
      else if (e === 'over' && D) {
        parts.push(D.winner === 'you' ? tx.win : tx.lose); setDogShot(null); setDogOn(false); dog.current = null; setCamMode(m => (m === 'duel' ? 'chase' : m));   // (the match is over: its tag points wait for the run's summary)
      }
    }
    if (parts.length) dogMsg(parts.join(' - '));
  };
  const dogEvRef = useRef(dogEvents); dogEvRef.current = dogEvents;
  const dogTap = () => { const s = sim.current, D = dog.current; if (!s || !D || D.phase !== 'shot' || D.shot?.who !== 'you') return false; dogEvents(tapShot(D, s.glider)); return true; };
  const dogToggle = () => { const s = sim.current; if (!s || live.current.mode !== 'glide') return; if (dog.current) { dog.current = null; setDogOn(false); setDogShot(null); setCamMode(m => (m === 'duel' ? 'chase' : m)); return; } if (s.glider.landed || aim.current.on) return; dog.current = startDogfight(s.glider, 'chase'); setDogOn(true); if (poseOkRef.current) setCamMode('duel');   // (the duel view shows both planes)
  dogMsg(dogTxt.current.chase); audio.current?.play('ready'); };
  const dogToggleRef = useRef(dogToggle); dogToggleRef.current = dogToggle;
  const spaceNow = (x0?: number) => { const s = sim.current!; if (live.current.mode !== 'glide') return; if (dogTap()) return; if (s.glider.landed) startAim(x0 ?? null); else boostPlane(s.glider); };
  const throwRef = useRef(spaceNow); throwRef.current = spaceNow;
  const patternNow = () => { const s = sim.current; if (!s || live.current.mode !== 'glide') return; if (man.current) { man.current = null; return; } const p = patsRef.current.patterns[patsRef.current.sel]; if (s.glider.landed || aim.current.on || !p || !p.steps.length) return; man.current = startManeuver(p, s.glider); };
  const patternRef = useRef(patternNow); patternRef.current = patternNow;
  const [armed, setArmed] = useState(false);   // ARM: pressing a pattern in the editor flies it at once (instead of just picking it)
  const firePattern = (p: Pattern) => { const s = sim.current; if (!s || live.current.mode !== 'glide' || s.glider.landed || aim.current.on || !p.steps.length) return; man.current = startManeuver(p, s.glider); };
  const [, setSasMode] = useState<SasMode>('off'), sasRef = useRef(newSas('off'));   // stability assist (T): the plane holds its climb angle and bank, the stick only asks for a change
  const cycleSas = () => setSasMode(m => { const n = nextSasMode(m, !!dog.current); sasRef.current.mode = n; sasRef.current.engaged = false; return n; });
  const cycleSasRef = useRef(cycleSas); cycleSasRef.current = cycleSas;
  useEffect(() => {   // where the mouse is, in stage pixels; Esc lets go of it
    const move = (e: PointerEvent) => {
      if (lookCam.current.on && (e.buttons > 0 || e.pointerType === 'touch') && stage.current?.contains(e.target as Node)) {   // looking round: the drag turns the bobr and tips the view
        const g = sim.current?.glider, l = lookLast.current, mx = l && l.id === e.pointerId ? e.clientX - l.x : 0, my = l && l.id === e.pointerId ? e.clientY - l.y : 0;   // (measured here: a finger's pointer events carry no movement of their own everywhere)
        lookLast.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        if (g?.landed && !aim.current.on) { g.psi -= mx * 0.006; lookCam.current.pitch = Math.max(-1.1, Math.min(1.2, lookCam.current.pitch - my * 0.005)); }
      }
      if (live.current.lookFly && sim.current && !sim.current.glider.landed && (e.buttons > 0 || e.pointerType === 'touch') && stage.current?.contains(e.target as Node)) {   // looking round in flight
        const l = lookLast.current, mx = l && l.id === e.pointerId ? e.clientX - l.x : 0, my = l && l.id === e.pointerId ? e.clientY - l.y : 0;
        lookLast.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        const pn = pinch.current;
        if (pn.pts.has(e.pointerId)) pn.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pn.pts.size >= 2) {   // two fingers: spreading them brings the camera in
          const [a, b] = [...pn.pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pn.d > 20 && d > 20) camZoom.current.free = pinchBy('free', camZoom.current.free, d / pn.d);
          pn.d = d;
        } else {
          const ly = lookYaw.current - mx * 0.006; lookYaw.current = Math.atan2(Math.sin(ly), Math.cos(ly));   // (all the way round: past straight behind it carries on)
          freeTilt.current = Math.max(FREE_TILT_RANGE[0], Math.min(FREE_TILT_RANGE[1], freeTilt.current - my * 0.005));
        }
      }
      if (aim.current.on && aim.current.x0 !== null) aim.current.dx = Math.max(-1, Math.min(1, (e.clientX - aim.current.x0) / 40));   // aiming from a button: slide sideways to turn
      const r = stage.current?.getBoundingClientRect(); if (!r) return;
      if (e.pointerType === 'touch' && !stage.current!.contains(e.target as Node)) return;   // a finger on a button or slider does not steer
      { const d = dual.current.get(e.pointerId); if (d) { d.x = e.clientX - r.left; d.y = e.clientY - r.top; return; } }
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const press = (e: PointerEvent) => {
      const r = stage.current?.getBoundingClientRect();
      if (e.pointerType === 'touch' && live.current.lookFly && stage.current?.contains(e.target as Node)) { pinch.current.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch.current.d = 0; }
      if (e.pointerType === 'mouse' && e.button === 0 && live.current.mouseFly && !live.current.lookFly && live.current.mode === 'glide' && stage.current?.contains(e.target as Node)) { throwRef.current(e.clientX); return; }   // flying with the mouse: a click is the boost (on the ground it starts the aim)
      if ((e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button === 0 && live.current.tool !== 'paint')) && live.current.mode === 'glide' && stage.current?.contains(e.target as Node)) {   // a double tap (or double click) on the view is the boost (on the ground it starts the aim)
        const lt = lastTap2.current, x = e.clientX, y = e.clientY;
        if (lt && e.timeStamp - lt.t < 320 && Math.hypot(x - lt.x, y - lt.y) < 60) { lastTap2.current = null; throwRef.current(x); } else lastTap2.current = { t: e.timeStamp, x, y };
      }
      const lookingNow = lookCam.current.on && !!sim.current?.glider.landed && !aim.current.on, grab = !lookingNow && !live.current.lookFly && (e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button === 0 && !live.current.mouseFly && live.current.tool !== 'paint'));   // a finger, or the mouse button, grabs the stick wherever it lands
      if (r && e.pointerType === 'touch' && live.current.aero && live.current.mode === 'glide' && !lookingNow && !live.current.lookFly && stage.current!.contains(e.target as Node)) {   // acro: the left half of the view is the yaw stick, the right half the pitch and roll stick, each where the finger lands
        const x = e.clientX - r.left, y = e.clientY - r.top, side = x < r.width / 2 ? 'L' : 'R';
        if (![...dual.current.values()].some(d => d.side === side)) dual.current.set(e.pointerId, { side, x0: x, y0: y, x, y });
        return;
      }
      if (r && grab && !touchStick.current && stage.current!.contains(e.target as Node)) touchStick.current = { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
    };
    const lift = (e: PointerEvent) => { lookLast.current = null; pinch.current.pts.delete(e.pointerId); pinch.current.d = 0; releaseAim(); if (touchStick.current?.id === e.pointerId) touchStick.current = null; dual.current.delete(e.pointerId); const r = stage.current?.getBoundingClientRect(); if (r && e.pointerType === 'touch') mouse.current = { x: r.width / 2, y: r.height / 2 }; };   // finger up: the stick springs back to the middle, so the plane levels itself
    const wheel = (e: WheelEvent) => {   // the wheel zooms whichever camera is on: up is always closer to the plane
      if (live.current.tool !== 'fly' || !stage.current?.contains(e.target as Node)) return;
      e.preventDefault();
      const m = camEffRef.current; camZoom.current[m] = zoomBy(m, camZoom.current[m], e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    };
    addEventListener('wheel', wheel, { passive: false });
    addEventListener('pointermove', move); addEventListener('pointerdown', move); addEventListener('pointerdown', press); addEventListener('pointerup', lift); addEventListener('pointercancel', lift);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMouseFly(false); };
    addEventListener('keydown', esc);
    return () => { removeEventListener('wheel', wheel); removeEventListener('pointermove', move); removeEventListener('pointerdown', move); removeEventListener('pointerdown', press); removeEventListener('pointerup', lift); removeEventListener('pointercancel', lift); removeEventListener('keydown', esc); };
  }, []);
  // keyboard: arrows / WASD fly (in glide: W/S pitch, A/D roll, Q/E yaw, Space throws), Q / E lower / raise the plane otherwise, P pauses
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e'].includes(k)) { keys.current.add(k); e.preventDefault(); }
      else if (k === 'shift') keys.current.add(k);
      else if (k === ' ') { e.preventDefault(); if (!e.repeat) throwRef.current(); }
      else if (k === 'p') setPaused(p => !p);
      else if (k === 'f' && !e.repeat && !e.ctrlKey && !e.metaKey) interactRef.current();
      else if (k === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey) cycleCamRef.current();
      else if (k === 'x' && !e.repeat && !e.ctrlKey && !e.metaKey) patternRef.current();
      else if (k === 'g' && !e.repeat && !e.ctrlKey && !e.metaKey) dogToggleRef.current();
      else if (k === 't' && !e.repeat && !e.ctrlKey && !e.metaKey) cycleSasRef.current();
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.key.toLowerCase()); if (e.key === ' ') releaseAim(); };
    addEventListener('keydown', down); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);

  // the game loop
  useEffect(() => {
    if (!ready) return;
    const cv = canvas.current!, el = stage.current!, ctx = cv.getContext('2d')!, img = sheet.current!;
    const s = sim.current!;
    let raf = 0, last = performance.now(), windT = 0, windT0 = Math.floor(Math.random() * 600), windAcc = 0, windSync = 0, windShown = { letter: -1, strength: -9 }, liftAcc = 0, hoopAcc = 0, hoopBest: { x: number; y: number; d: number } | null = null, liftBest: { x: number; y: number; r: number; d: number } | null = null, hudAcc = 0, miniAcc = 99, lastMiniH = 0, saveAcc = 0, frames = 0, fpsAcc = 0, fps = 0, anim = 0, tilt = 0, fpvK = 0, walkPh = 0, lookTrim = 1, lastLayer = 5, skyOff = DECO_LAYERS.map(() => ({ x: 0, y: 0 })), sphOff = SKY_BANDS.map(() => ({ x: 0, y: 0 })), lastMini = { x: 1e9, y: 1e9 };
    let W = 1, H = 1, dpr = 1;
    let styleKey = '';
    const glCv = glCanvas.current!;
    let glr: WorldGL | null = null, glFailed = false, glFrames = 0;
    const hoopsDone = new Set<string>();   // the hoops passed this visit
    // the 3D canvas drops its resolution when frames are slow (and creeps back up when they are quick): fill rate is what runs out first on a phone
    let autoK = 1, glScale = 1, frameEma = 1 / 60, scaleClock = 0, lastScaleChange = 0;
    const pickedSticks = sim.current!.beavers.picked.sticks, pickedStones = sim.current!.beavers.picked.stones;   // shared with the beavers: what they take is gone for the player
    const pickFx: { x: number; y: number; a: number; age: number; stone: boolean; berry?: boolean }[] = [];   // a stick that has just been picked up: it hops up, spins and fades
    // things drifting in the air: autumn and maple leaves that fall from the trees and tumble, pollen that floats up off bushes; all are carried by the wind, pollen
    // closely and leaves loosely, and a wind tunnel (see windtunnel.ts) sweeps them along its line
    type Mote = { x: number; y: number; h: number; vx: number; vy: number; vh: number; kind: 0 | 1 | 2; rot: number; rv: number; ph: number; age: number; life: number; grounded: number };
    const motes: Mote[] = []; let moteAcc = 0;
    // every trick flown in this run, by name: how many times and what it paid (shown when the plane is down)
    const runTricks = new Map<string, { n: number; pts: number }>();
    const noteTrick = (name: string, pts: number, fresh: boolean) => { const e = runTricks.get(name) ?? { n: 0, pts: 0 }; if (fresh) e.n++; e.pts += pts; runTricks.set(name, e); };
    let tagPts = 0;   // this run's dogfight tag points
    let landEnv: GlideEnv | null = null, landT = 0, landAt: { x: number; y: number; kind: 'crash' | 'splash' | 'soft' | 'skim' | 'far' } | null = null, landShow: { x: number; y: number } | null = null, lakeTick = 0, trickPts = 0, mowT = 0, mowGain = 0, skimT = 0, skimGain = 0, invT = 0, invGain = 0, combo = newCombo(), splash: { x: number; y: number; h: number; vx: number; vy: number; vh: number; life: number }[] = [], tricks = newTrickState(), trickMsg = '', trickMsgT = 0, hoopCount = 0, flown = 0, bestHoops = Math.max(0, ...scoresRef.current.map(r => r.hoops)), bestFlown = Math.max(0, ...scoresRef.current.map(r => r.metres)), hoopFlash = 0, prevP: { x: number; y: number; h: number } | null = null;
    // The stage's real size, never 0: if layout has not settled (or the observer missed a change) fall back to the box around it or the window.
    const measure = () => {
      const r = el.getBoundingClientRect(), p = el.parentElement;
      return { w: Math.round(r.width) || el.clientWidth || p?.clientWidth || window.innerWidth, h: Math.round(r.height) || el.clientHeight || p?.clientHeight || window.innerHeight };
    };
    const fit = () => {
      const d = Math.min(2, window.devicePixelRatio || 1), m = measure();   // above 2x the extra pixels cost fill rate and show nothing
      dpr = d; W = m.w; H = m.h;
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    addEventListener('resize', fit);
    let syncAcc = 0;

    // A chunk is built in slices (a few rows of tiles at a time, see `stepChunk`), straight into a pixel array: each tile is a 16 x 16 block, already laid over the water
    // colour, copied row by row. No canvas: drawing tiles on a canvas and reading it back for the 3D view cost a 256 KB read-back per chunk, and the canvases were heavy to free.
    const CPX = CHUNK * TILE_PX;
    const tileBlocks = new Map<number, Uint8ClampedArray>();   // (sheet cell, road or not) -> its 16 x 16 pixels over water
    const blockCv = document.createElement('canvas'); blockCv.width = blockCv.height = TILE_PX;
    const blockG = blockCv.getContext('2d', { willReadFrequently: true })!; blockG.imageSmoothingEnabled = false;
    const tileBlock = (col: number, row: number, road: boolean) => {
      const k = ((col * 256 + row) << 1) | (road ? 1 : 0);
      let b = tileBlocks.get(k);
      if (!b) {   // made once per kind of tile, exactly as the chunk canvas used to draw it: water underneath (water and shore tiles are partly see-through), the tile, a road darkened like tarmac
        const g = blockG; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, TILE_PX, TILE_PX);
        if (road) {
          const t = document.createElement('canvas'); t.width = t.height = TILE_PX; const tg = t.getContext('2d')!; tg.imageSmoothingEnabled = false;
          tg.drawImage(img, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
          tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = 'rgba(34,32,38,0.68)'; tg.fillRect(0, 0, TILE_PX, TILE_PX);
          g.fillStyle = TERRAIN_COLOR[0]; g.fillRect(0, 0, TILE_PX, TILE_PX); g.drawImage(t, 0, 0);
        } else { g.fillStyle = TERRAIN_COLOR[0]; g.fillRect(0, 0, TILE_PX, TILE_PX); g.drawImage(img, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX); }
        b = g.getImageData(0, 0, TILE_PX, TILE_PX).data; tileBlocks.set(k, b);
      }
      return b;
    };
    const pxPool: Uint8ClampedArray<ArrayBuffer>[] = [];   // pixel arrays of dropped chunks, used again (256 KB each)
    const freeChunk = (ch: ChunkImg | undefined) => { if (ch && pxPool.length < 24) pxPool.push(ch.src.px); };
    const dropChunk = (key: number) => { freeChunk(chunks.current.get(key)); chunks.current.delete(key); };
    /** The flat view's canvas for a chunk, made from its pixels the first time it is drawn. */
    const chunkCanvas = (ch: ChunkImg) => {
      if (!ch.cv) { const c = document.createElement('canvas'); c.width = c.height = CPX; c.getContext('2d')!.putImageData(new ImageData(ch.src.px, CPX, CPX), 0, 0); ch.cv = c; }
      return ch.cv;
    };
    function* buildChunkGen(cx: number, cy: number): Generator<void, ChunkImg> {
      const px = pxPool.pop() ?? new Uint8ClampedArray(CPX * CPX * 4), row = TILE_PX * 4, stride = CPX * 4;
      const decos: Deco[] = [];
      const road = s.world.kind === 'lakedistrict';
      const tiles = s.world.chunkDrawn(cx, cy);
      yield;
      for (let j = 0; j < CHUNK; j++) { if (j > 0 && j % 4 === 0) yield; for (let i = 0; i < CHUNK; i++) {
        const x = cx * CHUNK + i, y = cy * CHUNK + j, d = tiles[j * CHUNK + i];
        const b = tileBlock(d.ground[0], d.ground[1], road && s.world.terrainAt(x, y) === SAND && !!lakeRoadAt(x, y));
        for (let r = 0, o = (j * TILE_PX * CPX + i * TILE_PX) * 4; r < TILE_PX; r++, o += stride) px.set(b.subarray(r * row, r * row + row), o);
        if (d.deco) decos.push({ x, y, cell: d.deco, scale: d.scale });
      } }
      return { src: { px, size: CPX }, decos };
    }
    const miniCache = new MiniCache();
    const building = new Map<number, Generator<void, ChunkImg>>();
    /** Work on a chunk until `endAt` (ms, performance.now) or until it is done (at least one slice); true when it is finished and stored. */
    const stepChunk = (cx: number, cy: number, endAt: number): boolean => {
      const key = tileKey(cx, cy);
      let gen = building.get(key);
      if (!gen) { if (building.size > 80) building.clear(); gen = buildChunkGen(cx, cy); building.set(key, gen); }
      let r = gen.next();
      while (!r.done && performance.now() < endAt) r = gen.next();
      if (!r.done) return false;
      freeChunk(chunks.current.get(key)); chunks.current.set(key, r.value); building.delete(key); return true;
    };

    // thermals: warm bare ground makes the strongest rising air, water and forest the weakest; heat waves help, cold snaps hurt
    const heatAt = (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y), t = s.world.terrainAt(ix, iy);
      if (t === WATER) return 0;
      const b = s.world.biomeOf(ix, iy).id;
      return t === SAND ? (b === 'desert' ? 1 : 0.75) : b === 'forest' ? 0.3 : b === 'wetland' ? 0.35 : 0.6;
    };
    const tEnv: ThermalEnv = { seed: s.world.seed, hour: 0, warm: 1, heatAt };
    const thermalEnv = () => { tEnv.hour = s.hour; tEnv.warm = Math.max(0.6, Math.min(1.4, 1 + (s.eco.temperature - BASE_TEMPERATURE) / 25)); return tEnv; };

    let flyHeld = false, lastRunAt = 0, workMs = 0, workN = 0, lastStrike = 0, flashK = 0;
    if (/perf/.test(location.href)) { try { new PerformanceObserver(l => { for (const e of l.getEntries()) { perfStat.lt++; perfStat.ltMax = Math.max(perfStat.ltMax, e.duration); } }).observe({ entryTypes: ['longtask'] }); } catch { /* no long-task support */ } }
    const mark = (k: string) => { if (!perf.on) return; const t = performance.now(); perf.ph[k] = (perf.ph[k] ?? 0) + (t - perf.pt); perf.pt = t; };   // (?perf: where the frame's time goes, averaged over 2 s)
    const perf = { on: /perf/.test(location.href), lastNow: 0, gap: 0, work: 0, build: 0, persist: 0, ground: 0, gpu: 0, mini: 0, builtN: 0, since: 0, txt: '', f: { work: 0, build: 0, built: 0, ground: 0, persist: 0, gpu: 0, mini: 0, ev: '' }, gpuWait: !/nogpu/.test(location.href), hitches: [] as string[], ph: {} as Record<string, number>, pt: 0, n: 0, avg: '' };   // (add `perf` to the address, e.g. ?perf: the worst frame in each 2 seconds, and what took the time)
    let mapWasOpen = false, bigFill: BigMapFill | null = null, uploadBoost = 0;
    /** One frame of the full-screen map: fill more of it (a few ms), then build and upload the ground round the plane and read chunks for the small minimap, so closing the map finds them ready. */
    const mapFrame = (scale: number) => {
      const bc = bigMap.current!, t0 = performance.now(), f = s.flight;
      const mw = Math.max(40, Math.round(bc.clientWidth / 2)), mh = Math.max(40, Math.round(bc.clientHeight / 2)), fx = Math.round(f.x), fy = Math.round(f.y);   // (a map pixel is 2 x 2 screen pixels)
      const g = bc.getContext('2d')!;
      if (!bigFill || bigFill.w !== mw || bigFill.h !== mh || bigFill.scale !== scale || bigFill.x !== fx || bigFill.y !== fy) {
        bc.width = mw; bc.height = mh; bigFill = { w: mw, h: mh, scale, x: fx, y: fy, row: 0, img: g.createImageData(mw, mh) };
        bigFill.img.data.fill(10); for (let o = 3; o < bigFill.img.data.length; o += 4) bigFill.img.data[o] = 255;
      }
      const B = bigFill, d = B.img.data, row0 = B.row;
      while (B.row < mh && performance.now() - t0 < 6) {   // a few rows at a time: a chunk the small minimap already read is used as it is, the rest is sampled point by point
        const j = B.row++, y = Math.floor(fy + (j - mh / 2) * scale), cy = chunkOf(y);
        let lastKey = NaN, seen = false, terr: Uint8Array | undefined;
        for (let i = 0; i < mw; i++) {
          const x = Math.floor(fx + (i - mw / 2) * scale), cx = chunkOf(x), key = tileKey(cx, cy), o = (j * mw + i) * 4;
          if (key !== lastKey) { lastKey = key; seen = s.explored.has(key); terr = seen ? miniCache.terr.get(key) : undefined; }
          if (!seen) continue;
          const tt = terr ? terr[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as Terrain : s.world.mapSample(x, y), c = MINI_RGB[tt];
          const tk = tt === GRASS ? Math.min(0.85, s.world.mapTrees(x, y, Math.ceil(scale)) * 7) : 0;   // trees: the pixel darkens toward the tree green by how many stand in its patch
          d[o] = c[0] + (TREE_RGB[0] - c[0]) * tk; d[o + 1] = c[1] + (TREE_RGB[1] - c[1]) * tk; d[o + 2] = c[2] + (TREE_RGB[2] - c[2]) * tk;
        }
      }
      if (B.row > row0 || row0 === 0) {
        g.putImageData(B.img, 0, 0);
        const px = mw / 2, py = mh / 2, dx = Math.cos(f.heading), dy = -Math.sin(f.heading), qx = -dy, qy = dx;   // the plane
        g.beginPath(); g.moveTo(px + dx * 7, py + dy * 7); g.lineTo(px - dx * 4 + qx * 4.5, py - dy * 4 + qy * 4.5); g.lineTo(px - dx * 1.5, py - dy * 1.5); g.lineTo(px - dx * 4 - qx * 4.5, py - dy * 4 - qy * 4.5); g.closePath();
        g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineJoin = 'round'; g.stroke();
        if (B.row < mh) { g.fillStyle = '#ffd54f'; g.fillRect(0, mh - 2, Math.round(mw * B.row / mh), 2); }   // (how far the filling has got)
      }
      // the ground round the plane, nearest first: built, then (3D view) uploaded, a few ms each
      const pcx = chunkOf(f.x), pcy = chunkOf(f.y), R = s.world.kind === 'lakedistrict' ? 4 : 7, ring: GroundChunk[] = [];
      const near: [number, number][] = [];
      for (let cy = pcy - R; cy <= pcy + R; cy++) for (let cx = pcx - R; cx <= pcx + R; cx++) if (Math.hypot(cx - pcx, cy - pcy) <= R + 0.5) near.push([cx, cy]);
      near.sort((a, b) => Math.hypot(a[0] - pcx, a[1] - pcy) - Math.hypot(b[0] - pcx, b[1] - pcy));
      const t1 = performance.now();
      for (const [cx, cy] of near) { if (performance.now() - t1 > 6) break; const ch = chunks.current.get(tileKey(cx, cy)); if (!ch || ch.stale) stepChunk(cx, cy, t1 + 6); }
      if (glr) { for (const [cx, cy] of near) { const ch = chunks.current.get(tileKey(cx, cy)); if (ch) ring.push({ key: tileKey(cx, cy), cx, cy, src: ch.src }); } glr.preload(ring, CHUNK, 4); }
      // the small minimap's chunks round the plane (out to what its widest zoom shows), so it is whole when the map closes
      const t2 = performance.now(), MR = Math.ceil(52 * (BIG_MAP_SCALE / 2) / CHUNK) + 1;
      for (let r = 0; r <= MR && performance.now() - t2 < 3; r++) for (let cy = pcy - r; cy <= pcy + r; cy++) for (let cx = pcx - r; cx <= pcx + r; cx++) {
        if (Math.max(Math.abs(cx - pcx), Math.abs(cy - pcy)) !== r) continue;   // (ring by ring, nearest first)
        const key = tileKey(cx, cy);
        if (s.explored.has(key) && !miniCache.terr.has(key) && performance.now() - t2 < 3) miniCache.terr.set(key, s.world.chunkTerrain(cx, cy));
      }
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      { const cap = live.current.fpsCap; if (cap > 0 && now - lastRunAt < 1000 / cap - 2) return; lastRunAt = now; }   // (the frame cap: a steady 30 feels smoother than a 22-40 that keeps jumping)
      const w0 = performance.now();
      if (perf.on) {
        const gp = perf.lastNow ? now - perf.lastNow : 0;
        if (gp > 0) perf.gap = Math.max(perf.gap, gp);
        if (gp > 100) { const o = perf.f; perf.hitches.unshift(`${gp.toFixed(0)}ms w${o.work.toFixed(0)} ch${o.build.toFixed(0)}/${o.built} gr${o.ground.toFixed(0)} sv${o.persist.toFixed(0)} mk${(glr?.oneMs ?? 0).toFixed(0)} up${glr?.oneN ?? 0} mi${o.mini.toFixed(1)} gpu${o.gpu.toFixed(0)}${o.ev} @${(now / 1000).toFixed(1)}s`); perf.hitches.length = Math.min(perf.hitches.length, 5); }   // (the gap before this frame: what the frame before it was doing)
        perf.f = { work: 0, build: 0, built: 0, ground: 0, persist: 0, gpu: 0, mini: 0, ev: '' }; if (glr) { glr.oneMs = 0; glr.oneN = 0; }
        perf.lastNow = now; perf.pt = performance.now(); perf.n++;
      }
      syncAcc += 1;
      if (syncAcc >= 20) { syncAcc = 0; const m = measure(); if (m.w !== W || m.h !== H || Math.min(2, window.devicePixelRatio || 1) !== dpr) fit(); }   // belt and braces: a canvas that disagrees with its box is refitted within a third of a second
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const L = live.current, f = s.flight, decoK = s.world.kind === 'lakedistrict' ? Math.max(LAKE_DECO_MIN, LAKE_DECO_M / (lakeData()?.tileM ?? 50)) : 1, treeTopM = 4 * decoK / 0.18, planeK = f.mode === 'glide' ? planeLenRef.current / (s.world.kind === 'lakedistrict' ? lakeData()?.tileM ?? 50 : 1) / 2.4 : 1, camK = f.mode === 'glide' ? Math.max(planeK, CAM_MIN) : 1, camC = f.mode === 'glide' ? chaseCamScale(planeK, PLANE_SIZES[0] / (s.world.kind === 'lakedistrict' ? lakeData()?.tileM ?? 50 : 1) / 2.4) : 1;   // camC: the chase camera's own scale (see chaseCamScale): the plane grows and shrinks on screen with the size setting   // (every camera's distances shrink with the plane, but not below LAKE_CAM_MIN: the plane flies a tile a metre, so a camera that close would see the ground rush by)
      hull.k = planeK;
      // the full-screen map (minimap zoom 3 to 5): time stops, nothing is drawn behind it, and the frame goes on filling the map and building the ground round the plane instead
      { const open = L.miniScale >= BIG_MAP_SCALE && !!bigMap.current;
        if (open) { mapFrame(L.miniScale); workMs += performance.now() - w0; workN++; mapWasOpen = true; return; }
        if (mapWasOpen) { mapWasOpen = false; bigFill = null; miniDirty.current = true; uploadBoost = 90; } }
      const simDt = L.paused ? 0 : dt;   // the world's own clock: everything that lives in it (the plane, the beavers, the weather, the score) runs on this; the camera and the menus go on with the real one
      // the 3D view (WebGL) takes over while tilt or the behind-plane view is on; the flat canvas stays for everything else
      const camEff: CamMode = L.mode === 'glide' && !glFailed && L.tool === 'fly' ? L.camMode : 'chase';   // (the free view and the flyby are for the glider, in the 3D view)
      camEffRef.current = camEff; poseOkRef.current = !glFailed;
      for (const m of ['chase', 'free', 'flyby', 'duel'] as const) camZoomNow.current[m] += (camZoom.current[m] - camZoomNow.current[m]) * (1 - Math.exp(-12 * dt));
      const wantGL = (L.gl3d || camEff !== 'chase') && !glFailed && L.tool === 'fly';
      if (wantGL && !glr && sheet.current && shadowSprite.current) { glr = WorldGL.create(glCv, sheet.current, shadowSprite.current, [...cloudSprites, ...cirrusSprites], [stickImg.current, ...leafImgs.current, stoneImg.current, berryImg.current], { flames: flameSprites, bolt: boltSprite.current }, beaverSprites); if (!glr) glFailed = true; else { if (planeModel.current) glr.setModel(planeModel.current); if (s.world.kind === 'lakedistrict') glr.terrain = (x, y) => s.world.heightAt(x, y); glr.setFar(lakeFarLods()); } }
      const useGL = wantGL && !!glr;
      if (glr) { glr.drawK = L.drawDist / 100; glr.walkK = L.walkDist / 100; }
      glCv.style.display = useGL ? 'block' : 'none';
      // the launch camera: runs for LAUNCH_CAM_T seconds after a throw (p = how far it has backed off, 0 at the throw, 1 when it hands over to the normal view)
      { const l = launchCam.current; if (l) { l.t += dt; if (l.t > LAUNCH_CAM_T || f.mode !== 'glide' || s.glider.landed) launchCam.current = null; } }
      // a throw is a landing played backwards: the eye starts at the plane's nose (it is held at the eye), and as the plane climbs the eye slides back behind it, then the chase view takes over. No special launch camera.
      const launchActive = false, lcT = 99, lcP = 1;
      // chase view: the world turns (CSS rotate on the canvas) so the plane's heading points up; eased along the shortest way round
      const poseOn = camEff !== 'chase' && useGL && f.mode === 'glide' && !footRef.current;   // the free view or the flyby: the camera stands where the cameraman puts it
      const chasePoseOn = camEff === 'chase' && useGL && f.mode === 'glide' && !footRef.current;   // the chase view in 3D is an orbit round the plane itself (like the free view, always behind it), not a ground point scaled by the 2D map's zoom
      const viewChase = L.tool === 'fly', chaseOn = viewChase && !useGL;
      f.course = f.mode === 'glide' ? (s.glider.landed ? s.glider.psi : s.glider.course) : f.heading;   // the way the view looks: the heading, but for a glider it holds through loops and rolls (see glider.ts)
      if (viewChase) { let d = (f.course - Math.PI / 2 - camAng.current) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; camAng.current += d * (1 - Math.exp(-(poseOn || launchActive ? 14 : 5) * dt)); } else camAng.current = 0;
      const rot = useGL ? 0 : camAng.current;   // (the flat canvas's own turn; the 3D camera takes the angle itself)
      anim += simDt; frames++; fpsAcc += dt;   // (the scenery clouds are time and stop with it; the skybox is drawn by the shader on the real clock and keeps moving)
      if (frames === 8) releaseWorldPortal();   // a few frames are on screen: the cover can fade
      if (L.windAuto && L.wind.enabled && !L.paused) {                                // natural wind: wander on a slow curve, written to the sim at once and to the dial twice a second
        windT += dt; windAcc += dt;
        if (windAcc >= 0.25) {
          windAcc = 0; const nw = naturalWind(s.world.seed, windT + windT0); s.eco.wind = { ...s.eco.wind, strength: nw.strength, dir: nw.dir }; L.wind = { ...L.wind, strength: nw.strength, dir: nw.dir };
          // the dial turns and changes colour straight on the element; React (a re-render of this whole screen, a visible hitch) is only told when what it prints changes: the letter, or the strength by half a step
          const dEl = windDial.current; if (dEl) { dEl.style.setProperty('--dir', `${-nw.dir}rad`); dEl.style.setProperty('--h', String(Math.round(200 - nw.strength * 22))); }
          const letter = Math.round((((nw.dir * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8;
          if (letter !== windShown.letter || Math.abs(nw.strength - windShown.strength) >= 1) { windShown = { letter, strength: nw.strength }; setWind(w => ({ ...w, strength: nw.strength, dir: nw.dir })); }
        }
      }
      frameEma += (dt - frameEma) * 0.04; scaleClock += dt;
      if (useGL && scaleClock >= 1) {
        scaleClock = 0;
        if (L.resAuto) { if (frameEma > 0.036 && autoK > 0.4) autoK = Math.max(0.4, autoK * 0.85); else if (frameEma < 0.024 && autoK < 1) autoK = Math.min(1, autoK / 0.85); }   // (a slow phone: fewer trees, bushes and rocks to draw, too; the same ones are dropped each time)
        if (frameEma > 0.03 && glScale > 0.5) { glScale = Math.max(0.5, glScale * 0.85); lastScaleChange = anim; }
        else if (frameEma < 0.0185 && glScale < 1 && anim - lastScaleChange > 4) { glScale = Math.min(1, glScale / 0.85); lastScaleChange = anim; }
      }
      if (fpsAcc >= 1) { fps = frames; frames = 0; fpsAcc = 0; }

      // input: joystick or keys
      let dx = stick.current.dx, dy = stick.current.dy;
      const k = keys.current;
      if (k.size) { dx += (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0); dy += (k.has('arrowdown') || k.has('s') ? 1 : 0) - (k.has('arrowup') || k.has('w') ? 1 : 0); }
      if (rot !== 0 && f.mode !== 'glide') { const sx = dx, sy = dy; dx = sx * Math.cos(rot) + sy * Math.sin(rot); dy = -sx * Math.sin(rot) + sy * Math.cos(rot); }   // the stick points on the screen, the plane flies in the world
      const climb = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);                   // E up (lower layer number), Q down
      if (climb && f.mode !== 'glide') { const np = Math.max(-45, Math.min(45, f.pitch + climb * 40 * dt)); f.pitch = np; setPitch(Math.round(np * 10) / 10); }
      if (!L.paused) s.hour = advanceHour(s.hour, dt);
      const gl = s.glider;
      const tenv = thermalEnv();
      let layer: number, walking = false;
      if (f.mode === 'glide') {
        // W / S pitch (W pushes the nose down like a stick), A / D roll, Q / E yaw; the touch stick does pitch and roll
        let mx = 0, my = 0;
        // the stick: with mouse flying on it is the mouse (or a finger) relative to the middle of the view; otherwise a finger on the view makes a stick right where it touched
        const ts = L.mouseFly ? null : touchStick.current;
        if (!L.lookFly && (L.mouseFly || ts)) {
          const R = Math.min(W, H) * 0.3, ddx = mouse.current.x - (ts ? ts.x : W / 2), ddy = mouse.current.y - (ts ? ts.y : H / 2), len = Math.hypot(ddx, ddy) / R;   // a round stick: full deflection at the outer ring, a small dead spot in the middle
          if (len > 0.08) { const k2 = Math.min(1, len) / len; mx = (ddx / R) * k2; my = (ddy / R) * k2; }
        }
        if (instStick.current && gl.landed) instStick.current = null;   // landing takes the instrument off the screen, so its finger-up never comes: the stick would stay held and walk by itself
        if (instStick.current) {   // a finger on the instrument: the offset from its middle is the stick (full at its rim)
          const st = instStick.current, ddx = (st.x - st.cx) / st.r, ddy = (st.y - st.cy) / st.r, len = Math.hypot(ddx, ddy);
          if (len > 0.1) { const k2 = Math.min(1, len) / len; mx = ddx * k2; my = ddy * k2; }
        }
        let dyaw = 0;
        if (L.aero && dual.current.size) {   // the two acro sticks: a short throw (a fifth of the screen) is full deflection, with a small dead spot
          const R = ACRO_R, dz = (a: number) => (Math.abs(a) < 0.08 ? 0 : Math.max(-1, Math.min(1, a)));
          for (const d of dual.current.values()) { const ax = dz((d.x - d.x0) / R), ay = dz((d.y - d.y0) / R); if (d.side === 'L') dyaw = ax; else { mx = ax; my = ay; } }
        }
        const pull = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0) + stick.current.dy + my;
        const roll = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + stick.current.dx + mx;
        const yaw = Math.max(-1, Math.min(1, (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0) + dyaw + yawStick.current.dx));
        if (aim.current.on && gl.landed) { aim.current.t += dt; gl.psi -= Math.max(-1, Math.min(1, roll + aim.current.dx)) * 2.2 * dt; gl.z = launchHeight(upRef.current.launch); }   // holding the plane up at the launch height (1 m on the ground, higher with the shop's launchers), turning it to where it will go
        // landed: the plane turns into the bobr, who walks about in first person (W / S forward and back, A / D turn, Q / E sidestep); Space picks the plane up to throw it again
        walking = useGL && gl.landed && !aim.current.on && !L.paused;
        if (gl.landed && !aim.current.on && !L.paused && (lookStick.current.dx || lookStick.current.dy)) { gl.psi -= lookStick.current.dx * 2.4 * dt; lookCam.current.pitch = Math.max(-1.1, Math.min(1.2, lookCam.current.pitch - lookStick.current.dy * 1.6 * dt)); }   // the look joystick turns the bobr and tips the view
        if (walking) {
          const fwd = -pull, turn = roll, side = yaw, run = k.has('shift') ? 2 : 1, moving = Math.hypot(fwd, side) > 0.05;
          gl.psi -= turn * 1.9 * dt;
          if (moving) {
            const sp = WALK_SPEED * run * dt, hx = Math.cos(gl.psi), hy = Math.sin(gl.psi);
            let vx = (hx * fwd + hy * side) * sp, vy = (hy * fwd - hx * side) * sp;
            const lm = Math.hypot(vx, vy); if (lm > sp) { vx *= sp / lm; vy *= sp / lm; }
            if (s.world.kind === 'lakedistrict') {                              // hills: steep ground is a climb (slower), a cliff is a wall
              const rise = (s.world.heightAt(gl.x + vx, -(gl.y + vy)) - s.world.heightAt(gl.x, -gl.y)) / (lm || 1);
              if (rise > 1.0) { vx = 0; vy = 0; } else if (rise > 0) { const k = 1 / (1 + rise * 1.6); vx *= k; vy *= k; }
            }
            const wet = (x: number, y: number) => s.world.terrainAt(Math.round(x), Math.round(-y)) === WATER;
            if (!wet(gl.x + vx, gl.y + vy) || wet(gl.x, gl.y)) { gl.x += vx; gl.y += vy; walkPh += dt * 7 * run; }   // (no wading in: only out of the water you landed in)
          }
        }
        if (walking || (useGL && aim.current.on && gl.landed)) camAng.current = gl.psi - Math.PI / 2;                      // the eyes look the way the bobr faces, at once
        const hilly = s.world.kind === 'lakedistrict', ridgeLift = (x: number, y: number, wx: number, wy: number, agl: number) => {   // the wind climbing a slope: the air over the windward side of a fell rises (slope soaring), fading with height
          const e = 0.6, gx = (s.world.groundZAt(x + e, -y) - s.world.groundZAt(x - e, -y)) / (2 * e), gy = (s.world.groundZAt(x, -(y + e)) - s.world.groundZAt(x, -(y - e))) / (2 * e);
          return Math.max(-3, Math.min(8, (wx * gx + wy * gy) * 0.8)) * Math.max(0, 1 - agl / 70);
        };
        const wv = s.eco.windSpeed * 1.5, wd = s.eco.wind.dir, gLayer = () => 1 + (1 - Math.max(0, Math.min(1, gl.z / 120))) * 9;   // (the plane's cloud layer from its height: above a cloud it is out of that cloud's rain)
        let mc: MCtl | null = null;   // a flight pattern flies the plane until it is done, the pilot moves the stick hard, or the plane lands
        if (man.current) { if (gl.landed || aim.current.on || Math.max(Math.abs(pull), Math.abs(roll), Math.abs(yaw)) > 0.6) man.current = null; else { mc = stepManeuver(man.current, gl, simDt); if (!mc) man.current = null; } }
        let sc: { pitch: number; roll: number; yaw: number; aero?: boolean } | null = null;   // the stability assist flies the stick's changes (not while a pattern flies, or on the ground: it takes the plane's attitude again afterwards)
        const sasOn = sasRef.current.mode !== 'off';
        if (sasOn && !mc && !gl.landed && !aim.current.on) sc = stepSas(sasRef.current, gl, { pitch: L.invertPitch ? -pull : pull, roll, yaw }, simDt, L.throttle / 100, dog.current && dog.current.phase !== 'over' ? dog.current.ai : null); else if (sasOn) sasRef.current.engaged = false;
        stepGlider(gl, mc ? { pitch: mc.pitch, roll: mc.roll, yaw: mc.yaw, aero: mc.aero, thrust: L.throttle / 100 } : sc ? { pitch: sc.pitch, roll: sc.roll, yaw: Math.max(-1, Math.min(1, sc.yaw + L.trimYaw / 100)), freeStall: L.freeStall, aero: sc.aero ?? L.aero, thrust: L.throttle / 100 } : { pitch: Math.max(-1, Math.min(1, (L.invertPitch ? -pull : pull) + L.trimPitch / 100)), roll: Math.max(-1, Math.min(1, roll + L.trimRoll / 100)), yaw: Math.max(-1, Math.min(1, yaw + L.trimYaw / 100)), freeStall: L.freeStall, aero: L.aero, thrust: L.throttle / 100 }, (landEnv = { windX: Math.cos(wd) * wv, windY: Math.sin(wd) * wv, ground: hilly ? (x, y) => s.world.groundZAt(x, -y) : undefined, air: (x, y, t) => { if (L.debugLift) return L.debugLiftV; const r = s.eco.rainAt(x, -y, gLayer()) * paperRain(upRef.current.paper); return airVertical(tenv, x, -y, t) + (hilly ? ridgeLift(x, y, wv * Math.cos(wd), wv * Math.sin(wd), gl.z) : 0) + s.eco.fireHeat(x, -y) * 6 - r * (3.2 + 1.6 * Math.sin(t * 7.3 + x * 0.9) * Math.sin(t * 5.1 + y * 0.7)); }, turb: (x, y) => s.eco.rainAt(x, -y, gLayer()) * paperRain(upRef.current.paper), heat: (x, y) => Math.max(Math.max(0, gl.airLift) / 5, s.eco.fireHeat(x, -y), tunnelAt(s.world.seed, x, -y).k) }), simDt);   // under rain the air sinks and is gusty: the plane is dragged down and jolted
        if (!gl.landed) floated.current = false;
        else if (wasLanded.current && !floated.current && gl.wet < 1 && s.world.terrainAt(Math.round(f.x), Math.round(f.y)) === WATER) soakPlane(gl);   // standing in water (spawned in it, or it rose under the plane): soaked, whatever the landing was (a float upgrade only saves the touchdown itself)
        { const rn = s.eco.rainAt(gl.x, -gl.y, gLayer()) * paperRain(upRef.current.paper); if (rn > 0.05 && !L.paused) gl.wet = Math.min(1, gl.wet + rn * dt / 12); }   // rain soaks the paper too (a thick cloud in about ten seconds), and it dries as before
        if (!gl.landed && gl.z < 6) {   // flying into a tree or a bush is a crash: a standing plant is a few metres tall (by its size) and fills the middle of its tile
          const tx = Math.floor(gl.x), ty = Math.floor(-gl.y), dc = s.world.drawn(tx, ty).deco, top = dc === SHEET.bush ? 1.3 : dc === SHEET.conifer ? 4.5 : dc === SHEET.deciduous ? 4 : 0;
          if (top > 0 && gl.z < top * decoK * (dc === SHEET.bush ? SMALL_DECO_K : 1) * s.world.stateAt(tx, ty).s && Math.hypot(gl.x - tx - 0.5, -gl.y - ty - 0.5) < 0.38 * decoK * (dc === SHEET.bush ? SMALL_DECO_K : 1)) {
            gl.impact = { sink: 5, speed: Math.hypot(gl.vx, gl.vy), bank: Math.abs(gl.phi) }; gl.landed = true; gl.vx = gl.vy = gl.vz = 0; gl.z = Math.max(0, gl.z - 0.5);
          }
        }
        f.x = gl.x; f.y = -gl.y; f.heading = gl.psi; f.course = gl.landed ? gl.psi : gl.course; f.glideAlt = gl.z; f.glideLanded = gl.landed;
        { const D = dog.current;   // dogfight tag: the AI plane flies in the same air; landing ends the match
          if (D && D.phase !== 'over') { if (gl.landed) { endDogfight(D); dogEvRef.current(['over']); } else if (!L.paused) { const before = D.score, evs = stepDog(D, gl, { ...(landEnv as GlideEnv), heat: (x, y) => s.eco.fireHeat(x, -y) }, dt), gain = D.score - before; if (gain > 0) tagPts += gain; dogLast.current = { you: D.tally.you, ai: D.tally.ai }; dogEvRef.current(evs); } } }   // tag points (time spent fleeing or chasing, and hits) are kept apart: they are a part of the run's score summary
        if (!gl.landed && gl.z > runStat.current.peakZ) runStat.current.peakZ = gl.z;
        if (gl.landed && !wasLanded.current) { if (perf.on) perf.f.ev += ' LAND'; setTrimPitch(0); setTrimRoll(0); setTrimYaw(0); setMouseFly(false);
          {
            const ls = landingScore(gl.impact, s.world.terrainAt(Math.round(f.x), Math.round(f.y)) === WATER), now = Date.now();   // a soft landing earns points, a hard one costs them
            let u = upRef.current, bonus = ls.bonus, saved: 'insurance' | 'float' | null = null;
            if (bonus < 0) {                                                     // what was bought in the shop softens a bad landing (water: the float first)
              if (ls.water && u.float > 0) { bonus = 0; saved = 'float'; u = { ...u, float: u.float - 1 }; }
              else if (u.insurance > 0) { bonus = 0; saved = 'insurance'; u = { ...u, insurance: u.insurance - 1 }; }
            }
            floated.current = saved === 'float';
            if (ls.water && saved !== 'float') soakPlane(gl);                   // down in the water: the paper is soaked, and the next throw is a heavy one until it dries
            const trickSum = Math.round(trickPts), trickList = [...runTricks].map(([name, v]) => ({ name, n: v.n, pts: Math.round(v.pts) })).filter(x => x.pts > 0);
            if (trickList.length) trickList[trickList.length - 1].pts += trickSum - trickList.reduce((a, x) => a + x.pts, 0);   // (the rows add up to what was paid)
            bonus += trickSum;   // tricks flown in the run count with the landing bonus
            const tagSum = Math.round(tagPts); bonus += tagSum;   // and so do the tag points (shown as their own row)
            const climb = Math.max(0, Math.round(runStat.current.peakZ - runStat.current.startZ));            // how far above the launch point it got
            const base = Math.max(0, hoopCount * 100 + Math.round(flown) + climb * HEIGHT_POINTS + bonus);
            let dbl = 0; if (u.double > 0 && base > 0) { dbl = base; u = { ...u, double: u.double - 1 }; }   // score x2: the whole run counts twice
            if (u !== upRef.current) setUpgrades(u);
            const next = addRunScore(scoresRef.current, hoopCount, flown, now, bonus + dbl, climb);                    // the finished run goes on the leaderboard
            if (next !== scoresRef.current) { scoresRef.current = next; actions.saveWorld(id, { scores: next }); }
            const earned = coinsFor(runPoints(hoopCount, flown, bonus + dbl, climb)); if (earned > 0) addCoins(earned);
            if (hoopCount > 0 || flown >= 10 || climb >= 5 || trickList.length || tagSum > 0) setRunResult({ hoops: hoopCount, metres: Math.round(flown), height: climb, bonus, soft: ls.soft, water: ls.water, saved, dbl, coins: earned, key: now, trick: trickSum, tag: tagSum > 0 ? { pts: tagSum, you: dogLast.current.you, ai: dogLast.current.ai } : undefined, tricks: trickList });
          }
          bestHoops = Math.max(bestHoops, hoopCount); bestFlown = Math.max(bestFlown, flown);   // a crash ends the run: the score is kept as the best, the run starts again from nothing
          hoopCount = 0; flown = 0; trickPts = 0; tagPts = 0; dogLast.current = { you: 0, ai: 0 }; runTricks.clear(); mowT = 0; mowGain = 0; skimT = 0; skimGain = 0; invT = 0; invGain = 0; combo = newCombo(); resetTricks(tricks, gl); hoopsDone.clear();  }   // (the boosts in hand carry over to the next run)
        if (f.mode === 'glide' && !L.paused && !deadRef.current && ((gl.z < 8 && s.eco.fireHeat(f.x, f.y) > (gl.landed ? 0.3 : 0.5)) || s.eco.strikes.some(b => b.age < 0.8 && Math.hypot(b.x - f.x, b.y - f.y) < 1.5))) {   // in the flames, or struck by a bolt: the screen is swallowed by fire, GAME OVER; the Respawn button brings it back to the very start
          deadRef.current = true; burnedRef.current++; actions.saveWorld(id, { burned: burnedRef.current }); setBurnPop({ n: burnedRef.current, key: Date.now() }); setPaused(true); audio.current?.play('crash', 1);
        }
        if (respawnReq.current) {   // Respawn pressed
          respawnReq.current = false; deadRef.current = false;
          const o = s.world.kind === 'lakedistrict' ? lakeSpawnFor(initial.map ?? 'lakes') : { x: 0, y: 0, heading: Math.PI / 2, pitch: 0 };
          f.x = o.x; f.y = o.y; f.heading = o.heading; f.course = o.heading; gl.wet = 0; gl.boost = 0; gl.impact = null;
          if (s.world.kind === 'lakedistrict') { throwPlane(gl, f.x, -f.y, f.heading, LAKE_START_ALT, LAKE_START_SPEED, 0); f.glideAlt = LAKE_START_ALT; f.glideLanded = false; }
          else { gl.x = f.x; gl.y = -f.y; gl.psi = f.heading; gl.landed = true; gl.z = 0; gl.vx = gl.vy = gl.vz = 0; f.glideAlt = 0; f.glideLanded = true; }
          runStat.current = { startZ: gl.z, peakZ: gl.z };
          hoopCount = 0; flown = 0; trickPts = 0; tagPts = 0; dogLast.current = { you: 0, ai: 0 }; runTricks.clear(); mowT = 0; mowGain = 0; skimT = 0; skimGain = 0; invT = 0; invGain = 0; combo = newCombo(); resetTricks(tricks, gl); hoopsDone.clear();
        }
        wasLanded.current = gl.landed;
        layer = currentLayer(f);
        dx = 0; dy = 0;
        const i = inst.current;
        i.airspeed = gl.landed ? 0 : gl.airspeed; i.stallSpeed = STALL_SPEED; i.bestGlide = TRIM_SPEED; i.altitude = gl.z; i.vsi = gl.vsi; i.energyRate = gl.energyRate;
        i.heading = (((90 - (gl.psi * 180) / Math.PI) % 360) + 360) % 360; i.pitch = gl.pitch; i.bank = gl.phi; i.turnRate = gl.turnRate; i.slip = -gl.rud; i.stalled = gl.stalled && !gl.landed; i.load = gl.load; i.landed = gl.landed; i.mouse = L.mouseFly;
        { const D = dog.current; if (D && D.phase !== 'over' && !gl.landed) { const b = foeBearing(gl, D.ai); i.foe = { theta: b.theta, phi: b.phi, dist: b.dist, hunter: D.role === 'flee', lock: D.cooldown > 0 ? 0 : Math.min(1, D.lock / (D.role === 'chase' ? 1 : 1.4)) }; } else i.foe = null; }   // the dogfight opponent on the instrument
        {   // sound: wind in two ears, the stall whistle, rain (nothing while paused)
          const rainHere = s.eco.rainAt(f.x, f.y, layer) * paperRain(upRef.current.paper);
          const au = audio.current, sf = sfx.current;
          au?.update(L.paused ? SILENT : soundParams(gl, { windX: Math.cos(s.eco.wind.dir) * s.eco.windSpeed * 1.5, windY: Math.sin(s.eco.wind.dir) * s.eco.windSpeed * 1.5, air: () => 0 }, rainHere, rainHere, { hour: s.hour, charge: aim.current.on && gl.landed ? Math.max(0.05, aimPower(aim.current.t)) : 0 }), L.volume);
          if (!L.paused) {
            if (gl.boost > 0 && sf.boost <= 0) au?.play('boost');                       // Space: the kick
            if (gl.boostCd <= 0 && sf.cd > 0 && !gl.landed && !sf.landed) au?.play('ready');            // the pause is over: boost ready again
            if (!gl.landed && sf.landed) au?.play('throw');                              // let go: the throw
            if (gl.landed && !sf.landed && gl.impact) {                                  // touchdown: how hard, and on what
              const hard = gl.impact.sink > 4 || gl.impact.bank > 0.7, water = s.world.terrainAt(Math.round(f.x), Math.round(f.y)) === WATER;
              au?.play(water ? 'splash' : hard ? 'crash' : 'land', Math.min(1, gl.impact.sink / 6));
            }
          }
          sf.boost = gl.boost; sf.cd = gl.boostCd; sf.landed = gl.landed;
        }
      } else { layer = stepFlight(f, { dx, dy }, simDt); audio.current?.update(SILENT, 0); }

      // 3rd-person camera: the view eases to a point ahead of the plane while it flies, and back when it stops
      const flying = isFlying(f, Math.hypot(dx, dy) > 0.01);
      // how far ahead it looks grows with speed (0 when slow); the tilt starts at the slider's value and fades to flat at 190 m, so the floor follows it
      const camZ = (camZRef.current = s.world.kind !== 'lakedistrict' || gl.landed || camZRef.current === null || Math.abs(gl.z - camZRef.current) > 150 ? gl.z : camZRef.current + (gl.z - camZRef.current) * (1 - Math.exp(-dt / 1.5)));
      const altK = f.mode === 'glide' ? (s.world.kind === 'lakedistrict' ? 0.8 : tiltAltitudeFactor(camZ)) : 1;   // (over the fells the view keeps most of its tilt: looking straight down, the hills read as flat ground)
      // (the view no longer follows the plane's pitch or speed: the tilt is the slider's value (fading with height) and nothing looks ahead, so the picture, and the ground it needs, stay the same)
      const pn = 0, dive = 0;
      const tiltSet = tiltPin.current ?? L.tilt, tiltNow = L.tool === 'fly' ? (tiltPin.current !== null ? tiltPin.current : L.tilt * altK * (1 - 0.5 * dive)) : 0;
      tiltEff.current = chasePoseOn ? L.tilt : tiltNow;   // (in the 3D chase view the tilt is the camera's angle behind the plane and does not fade with height)
      { const foot = f.mode === 'glide' && useGL && gl.landed && !aim.current.on; if (foot !== footRef.current) { footRef.current = foot; setOnFoot(foot); if (!foot) setFullUi(false); } }
      const lookingFly = L.lookFly && f.mode === 'glide' && !gl.landed && useGL;
      if ((!lookCam.current.on || !walking) && !lookingFly) lookCam.current.pitch *= Math.exp(-6 * dt);
      if (!lookingFly) { lookYaw.current *= Math.exp(-6 * dt); if (Math.abs(lookYaw.current) < 0.001) lookYaw.current = 0; }   // (not looking: the view settles back level)
      // low and slow: the camera climbs to the plane's nose (the view you have on foot, the same eye) and stays there, so touching down changes nothing
      const lowSlow = useGL && !poseOn && f.mode === 'glide' && !gl.landed && !aim.current.on ? (1 - sstep(camZ, treeTopM, treeTopM * 2)) : 0;   // (low and nothing else: speed and pitch no longer decide when the eye comes down to the nose)   // (not while it stands on its tail or flies upside down: the eye has no roll)
      const aiming = useGL && f.mode === 'glide' && gl.landed && aim.current.on;   // holding the plane up to throw: the same eye as on foot, and the path it will fly is drawn
      fpvK += (((walking || aiming) ? 1 : launchActive ? (lcT < 0.35 ? 1 : 0) : lowSlow) - fpvK) * (1 - Math.exp(-4 * dt));
      if (!walking && fpvK > 0.002 && f.mode === 'glide') {                       // the view turns to where the plane points as it comes in (on foot it already does)
        let da = (f.course - Math.PI / 2 - camAng.current) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
        camAng.current += da * (1 - Math.exp(-8 * dt * fpvK));
      }
      const camX = f.x, camY = f.y;   // (the camera looks at the plane: nothing looks ahead of it)
      camPos.current = { x: camX, y: camY };

      // tilted ground: the canvas is drawn flat but bigger than the stage and tipped back by the browser (CSS perspective + rotateX, done on
      // the GPU, so it costs almost nothing). It is as tall as needed to still fill the stage after the tip: far rows need more ground, near
      // rows less, so the plane's row (CX, CY) sits at the stage's middle and the canvas reaches further up than down. Not while painting.
      // the slider sets the tilt; the plane's pitch moves it: nose up tips the ground further away (you see ahead), nose down brings the view
      // over the top of the ground. The canvas is sized for the largest tilt it can reach, so only the CSS transform changes per frame.
      const sliderOn = L.tool === 'fly' && tiltSet > 0, taBase = sliderOn ? tiltUnit(tiltNow) : 0, taMaxV = sliderOn ? Math.min(TILT_CAP, tiltUnit(tiltSet) + PITCH_TILT) : 0, taMax = useGL ? 0 : taMaxV;
      const taTarget = sliderOn ? Math.max(Math.min(0.03, taBase), Math.min(taMaxV, taBase + Math.max(0, pn) * PITCH_TILT * altK)) : 0;   // (nose up adds to the tilt, fading with the height; nose down is the dive above)
      camTilt.current = sliderOn ? camTilt.current + (taTarget - camTilt.current) * (1 - Math.exp(-4 * dt)) : 0;
      const ta = camTilt.current, th = ta * TILT_RAD, thMax = taMax * TILT_RAD;   // (the 3D camera tips by th too)
      let VW = W, VH = H, CX = W / 2, CY = H / 2, persp = 0;
      if (taMax > 0) {
        persp = 1.1 * Math.max(W, H);
        const c = Math.cos(thMax), sn = Math.sin(thMax), far = (H / 2 * persp) / (persp * c - H / 2 * sn), near = Math.max(H / 2, (H / 2 * persp) / (persp * c + H / 2 * sn));   // (a steep tilt needs more below the plane's row than a flat one)
        const sTop = persp / (persp + far * sn);
        if (chaseOn) {   // it turns, so the canvas must cover a circle round the plane's row: the farthest corner of the stage, seen from the ground
          const R = Math.max(Math.hypot(W / 2 / sTop, far), Math.hypot(W / 2, near));
          VW = VH = Math.ceil(2 * R) + 2; CX = CY = VW / 2;
        } else { VW = Math.ceil(W / sTop) + 2; CX = VW / 2; CY = Math.ceil(far) + 1; VH = CY + Math.ceil(near) + 2; }
      } else if (chaseOn) { VW = VH = Math.ceil(Math.hypot(W, H)) + 2; CX = CY = VW / 2; }
      const big = taMax > 0 || chaseOn;
      // a big canvas costs fill rate: at most 1 device pixel per CSS pixel, and at most ~1.6 million pixels (the art is blocky anyway)
      const bs = big ? Math.max(0.35, Math.min(dpr, 1, Math.sqrt(1.6e6 / (VW * VH)))) : dpr;
      const bw = Math.max(1, Math.round(VW * bs)), bh = Math.max(1, Math.round(VH * bs));
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;
      const key = big ? `${VW}|${VH}|${CX}|${CY}|${W}|${H}` : '';
      const st = cv.style;
      if (key !== styleKey) {
        styleKey = key;
        if (big) { st.inset = 'auto'; st.width = `${VW}px`; st.height = `${VH}px`; st.left = `${W / 2 - CX}px`; st.top = `${H / 2 - CY}px`; st.transformOrigin = `${CX}px ${CY}px`; }
        else { st.inset = ''; st.width = ''; st.height = ''; st.left = ''; st.top = ''; st.transformOrigin = ''; }
      }
      const tf = big ? `${taMax > 0 ? `perspective(${persp}px) rotateX(${th}rad) ` : ''}${chaseOn ? `rotate(${rot}rad)` : ''}` : '';
      if (st.transform !== tf) st.transform = tf;
      const g = ctx;
      // screen -> canvas for a vector: the canvas may be turned (chase view), but clouds stand like banners, facing the screen, and their
      // height offset and falling rain stay screen-vertical
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const scr = (vx: number, vy: number): [number, number] => [vx * cr + vy * sr, -vx * sr + vy * cr];
      // the higher it flies the farther the view pulls back (from ~80 m, on down to 0.15x at about 1 km), eased so it never jumps, or the plane fills the screen
      const altZoomTarget = f.mode === 'glide' ? Math.max(0.15, 1 / (1 + Math.max(0, camZ - 80) / 160)) : 1;
      altZoom.current += (altZoomTarget - altZoom.current) * (1 - Math.exp(-2.5 * dt));
      // however small the plane is next to the map's tiles (0.3 m on the 50 m map), the camera sits at most CHASE_DEFAULT_LENGTHS plane lengths behind it at the usual zoom (the wheel's zoom is relative to that), and at most as close as CHASE_MIN_LENGTHS (the wheel stops there instead of winding up unseen)
      const planeLen = 2.4 * planeK, dRef = (H / 2) * camC / (TILE_PX * altZoom.current * Math.tan(0.36));   // dRef: the chase distance at a zoom of 1
      const fitK = f.mode === 'glide' ? Math.max(1, dRef / ZOOM_DEFAULT.chase / (CHASE_DEFAULT_LENGTHS * planeLen)) : 1;
      const chaseCap = f.mode !== 'glide' ? ZOOM_RANGE.chase[1] : chasePoseOn ? Math.max(ZOOM_RANGE.chase[0], ZOOM_DEFAULT.chase * CHASE_DEFAULT_LENGTHS / CHASE_MIN_LENGTHS) : Math.max(ZOOM_RANGE.chase[0], dRef / (CHASE_MIN_LENGTHS * planeLen * fitK));
      if (camZoom.current.chase > chaseCap) camZoom.current.chase = chaseCap;
      const zoom = Math.min(camZoomNow.current.chase, chaseCap);   // (the wheel, in the chase view)
      const Tn = TILE_PX * zoom * fitK * altZoom.current / camC;
      // after a throw the camera starts close behind the plane and backs off to the normal distance (and from a flat look down the line of flight to the normal tilt)
      const Dn = (H / 2) / (Tn * Math.tan(0.36)), Dl = launchActive ? Math.min(Dn, 6.5 * camC) + (Dn - Math.min(Dn, 6.5 * camC)) * lcP : Dn;
      const T = launchActive ? (H / 2) / (Dl * Math.tan(0.36)) : Tn, tiltNormal = th, tiltNow2 = launchActive ? 1.2 + (tiltNormal - 1.2) * lcP : tiltNormal;
      const ox = CX - camX * T, oy = CY - camY * T;
      let Tv = T;   // pixels a tile at the plane, as the camera in use sees it (the free view and the flyby set their own)
      let cx0 = 0, cx1 = 0, cy0 = 0, cy1 = 0;
      let vis: (x: number, y: number, m: number) => boolean = () => true, chunkVis: (cx: number, cy: number) => boolean = () => true;
      let fp: ReturnType<WorldGL['footprint']> | null = null;
      if (useGL) {
        // the 3D camera: the visible ground (clamped at the reach, where everything has faded into the sky) says which chunks are needed
        const aUp = camAng.current + (gl.landed ? 0 : lookYaw.current);   // (the look button turns the view round the plane, or the eye's head)
        const upX = -Math.sin(aUp), upY = -Math.cos(aUp), tiltV = gl.landed ? tiltNow2 : Math.max(0.05, Math.min(1.45, tiltNow2 + lookCam.current.pitch * 0.9));
        const lookHstd = f.mode === 'glide' ? planeH.current : (1 - 0.5 * camC) * Math.min(25, 4 + (10 - layer) * 2);   // (the camera looks at the plane itself, at the height it is drawn at, so it sits in the middle of the view)
        void camZ;   // (the last part: the plane's height above the ground, less its eased value, is exactly what the ground's bumps take away, so the look point stays on the plane's own smooth height and the plane does not bob on screen)   // (half way up with the plane: it still looks high above the ground, and stays in view)
        // the free view and the flyby put the eye where the cameraman says, looking at the plane; coming and going, the view eases between that and the chase view
        const poseWant = (poseOn || chasePoseOn) && !gl.landed && !launchActive;
        poseK.current += ((poseWant ? 1 : 0) - poseK.current) * (1 - Math.exp(-8 * dt)); if (!poseWant && poseK.current < 0.002) poseK.current = 0;
        if (camEff !== 'flyby') flyby.current.on = false;
        let tgt: [number, number, number] = [camX, camY, lookHstd], eyeV: [number, number, number] | undefined;
        if (poseK.current > 0) {
          let pt = { x: f.x, y: f.y, h: Math.min(120, gl.z * 0.18) };
          if (poseWant && camEff === 'duel') {   // the duel view: the middle of the pair, seen from behind you along the line to the opponent
            const D = dog.current, foe = D && D.phase !== 'over' ? { x: D.ai.x, y: -D.ai.y, h: Math.min(120, D.ai.z * 0.18) } : null, ln = duelLine(pt, foe, [Math.cos(f.heading), -Math.sin(f.heading)]);
            if (duelAng.current === null) duelAng.current = ln.ang; else { let d = ln.ang - duelAng.current; d = Math.atan2(Math.sin(d), Math.cos(d)); duelAng.current += d * (1 - Math.exp(-3 * dt)); }
            const dp = duelPose(pt, foe, duelAng.current, duelTilt.current, camZoomNow.current.duel, camK, MIN_EYE_H * camK);
            lastPose.current = { ...dp.eye, h: Math.max(MIN_EYE_H * camK, dp.eye.h + s.world.heightAt(dp.target.x, dp.target.y) - s.world.heightAt(dp.eye.x, dp.eye.y)) }; pt = dp.target;
          } else if (poseWant && camEff === 'chase') {   // the chase view: the camera sits behind the plane and above it, at an angle (the tilt slider) and a distance (the wheel, in plane lengths) that do not depend on the height or on the ground
            const lenP = 2.4 * planeK, zc = Math.min(camZoomNow.current.chase, chaseCap), radC = Math.max(CHASE_MIN_LENGTHS * lenP, CHASE_DEFAULT_LENGTHS * lenP * ZOOM_DEFAULT.chase / zc), angC = Math.max(0.05, Math.min(1.45, tiltUnit(L.tilt) * TILT_RAD + lookCam.current.pitch * 0.9));
            const e = orbitEye(pt, upX, upY, angC, radC, MIN_EYE_H * camK);
            lastPose.current = { ...e, h: Math.max(MIN_EYE_H * camK, e.h + s.world.heightAt(pt.x, pt.y) - s.world.heightAt(e.x, e.y)) };
          } else if (poseWant && camEff === 'free') { const e = orbitEye(pt, upX, upY, freeTilt.current, camZoomNow.current.free * camK * Math.min(1, CHASE_DEFAULT_LENGTHS * 2.4 * planeK / (ZOOM_DEFAULT.free * camK)), MIN_EYE_H * camK); lastPose.current = { ...e, h: Math.max(MIN_EYE_H * camK, e.h + s.world.heightAt(pt.x, pt.y) - s.world.heightAt(e.x, e.y)) }; }   // (hills: the eye's height is above the ground under the eye, so it is the plane's own height plus the orbit's rise, whatever the ground does between them: the camera stays put in the air, not riding up and down the slopes)
          else if (poseWant) { const fb = flyby.current; if (flybyStep(fb, pt, gl.vx, -gl.vy, Math.cos(f.heading), -Math.sin(f.heading), camZoomNow.current.flyby * camK, camK)) fb.h = Math.max(MIN_EYE_H * camK, fb.h + s.world.heightAt(pt.x, pt.y) - s.world.heightAt(fb.x, fb.y)); lastPose.current = { x: fb.x, y: fb.y, h: fb.h }; }
          if (camEff !== 'duel') duelAng.current = null;
          const pe = lastPose.current, k = sstep(poseK.current, 0, 1), Dstd = (H / 2) / (T * Math.tan(0.36)), sT = Math.sin(tiltV), cT = Math.cos(tiltV);
          const sx = camX - upX * Dstd * sT, sy = camY - upY * Dstd * sT, sh = lookHstd + Dstd * cT;   // (where the chase view's eye is)
          eyeV = [sx + (pe.x - sx) * k, sy + (pe.y - sy) * k, sh + (pe.h - sh) * k];
          tgt = [camX + (pt.x - camX) * k, camY + (pt.y - camY) * k, lookHstd + (pt.h - lookHstd) * k];
          Tv = (H / 2) / (Math.max(0.5, Math.hypot(eyeV[0] - tgt[0], eyeV[1] - tgt[1], eyeV[2] - tgt[2])) * Math.tan(0.36));
        }
        glr!.setCamera({ x: tgt[0], y: tgt[1], upX, upY, tilt: tiltV, T, W, H, eye: eyeV, lockTo: f.mode === 'glide' && !gl.landed && !eyeV ? [f.x, f.y] : undefined, fullView: true, fpv: fpvK > 0.002 ? (() => {
          if (launchActive) { const l = launchCam.current!; return { k: fpvK, x: l.x, y: l.y, eyeH: l.eyeH, pitch: l.pitch }; }   // (just thrown: the eye stays where the plane was held)
          const onFoot = walking || aiming;
          // on foot: the eye at the bobr; in the air: at the plane's nose, as high as the plane is, looking where it points (the nose offset and the height go to the on-foot values as it touches down)
          const airK = onFoot ? 0 : sstep(gl.z, 0, 3);
          // coming down, the eye starts behind the plane (it stays in view) and slides forward the nearer the ground gets, to the nose at about 2 m, where the plane is out of sight
          const near = onFoot ? 1 : 1 - sstep(gl.z, treeTopM * 0.4, treeTopM), ahead = onFoot ? 0 : (-2.5 * (1 - near) + 0.5 * airK * near) * camK;
          return { k: fpvK, x: f.x + Math.cos(f.heading) * ahead, y: f.y - Math.sin(f.heading) * ahead, eyeH: 0.55 * camK + (onFoot ? (walking ? Math.sin(walkPh) * 0.025 * camK : 0) : gl.z * 0.18 + 0.3 * camK * (1 - near)), pitch: 0.03 + lookCam.current.pitch + (onFoot ? 0 : gl.pitch * 0.7 * airK) };
        })() : undefined, lookH: tgt[2] });
        fp = glr!.footprint();
        // everything round the plane is always wanted, whatever the camera looks at (looking up, or from off to one side, the polygon of rays can miss the ground under the plane, and with it every sprite standing there)
        const NEARC = 3, NR = NEARC * CHUNK, pcx = chunkOf(f.x), pcy = chunkOf(f.y);
        cx0 = Math.min(chunkOf(fp.minX) - 1, pcx - NEARC); cx1 = Math.max(chunkOf(fp.maxX) + 1, pcx + NEARC); cy0 = Math.min(chunkOf(fp.minY) - 1, pcy - NEARC); cy1 = Math.max(chunkOf(fp.maxY) + 1, pcy + NEARC);
        const rawFp = fp;
        fp = { minX: Math.min(rawFp.minX, f.x - NR), maxX: Math.max(rawFp.maxX, f.x + NR), minY: Math.min(rawFp.minY, f.y - NR), maxY: Math.max(rawFp.maxY, f.y + NR), inside: (x: number, y: number, m: number) => (Math.abs(x - f.x) <= NR + m && Math.abs(y - f.y) <= NR + m) || rawFp.inside(x, y, m) };
        const wide = fp;
        const base = (cx: number, cy: number) => wide.inside((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK, CHUNK * 0.75);
        // At a long draw distance more chunks are in view than the chunk budget holds (the held ones are dropped, farthest first, then asked for again: the edge of the real ground jumped about every frame). So ask only for the nearest MAX_REAL; the far mesh covers the rest, and the limit eases (4 tiles a frame), never jumps.
        const ds: number[] = [];
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (base(cx, cy)) ds.push(Math.hypot((cx + 0.5) * CHUNK - camX, (cy + 0.5) * CHUNK - camY));
        ds.sort((a, b) => a - b);
        const want = ds.length > MAX_REAL ? ds[MAX_REAL - 1] : 1e5, cur = glr!.capD;
        glr!.capD = cur + Math.max(-4, Math.min(4, want - cur));
        const capD = glr!.capD;
        chunkVis = (cx: number, cy: number) => base(cx, cy) && Math.hypot((cx + 0.5) * CHUNK - camX, (cy + 0.5) * CHUNK - camY) <= capD;
      } else {
        // What the stage really shows, as a quad on the canvas: its four corners taken back through the tip and the turn. The canvas is a bigger
        // rectangle than that, so everything (ground chunks, trees, clouds, the ecosystem's watched area) is only handled where this quad reaches.
        const quad: number[] = [];
        for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const xp = qx * W / 2, yp = qy * H / 2;
          let u = xp, v = yp;
          if (taMax > 0) { const sn = Math.sin(th), c = Math.cos(th); v = (yp * persp) / (c * persp + yp * sn); u = (xp * (persp - v * sn)) / persp; }
          const [a, b] = scr(u, v);
          quad.push(CX + a, CY + b);
        }
        const edge: number[] = [];   // per edge: from x, y, direction x, y, length
        for (let i = 0; i < 4; i++) { const x0 = quad[i * 2], y0 = quad[i * 2 + 1], x1 = quad[((i + 1) % 4) * 2], y1 = quad[((i + 1) % 4) * 2 + 1]; edge.push(x0, y0, x1 - x0, y1 - y0, Math.hypot(x1 - x0, y1 - y0) || 1); }
        /** Is a thing at canvas (x, y), reaching `m` px round it, anywhere near what the stage shows? */
        vis = (x: number, y: number, m: number) => {
          if (!big) return true;
          for (let i = 0; i < 20; i += 5) if ((edge[i + 2] * (y - edge[i + 1]) - edge[i + 3] * (x - edge[i])) / edge[i + 4] < -m) return false;
          return true;
        };
        let qx0 = 1e9, qx1 = -1e9, qy0 = 1e9, qy1 = -1e9;
        for (let i = 0; i < 8; i += 2) { qx0 = Math.min(qx0, quad[i]); qx1 = Math.max(qx1, quad[i]); qy0 = Math.min(qy0, quad[i + 1]); qy1 = Math.max(qy1, quad[i + 1]); }
        cx0 = chunkOf(camX + (qx0 - CX) / T) - 1; cx1 = chunkOf(camX + (qx1 - CX) / T) + 1; cy0 = chunkOf(camY + (qy0 - CY) / T) - 1; cy1 = chunkOf(camY + (qy1 - CY) / T) + 1;
        chunkVis = (cx: number, cy: number) => vis(ox + (cx + 0.5) * CHUNK * T, oy + (cy + 0.5) * CHUNK * T, CHUNK * T * 0.72);
      }
      s.eco.hour = s.hour;
      if (useGL) { const w0 = chunkOf(camX - 26) - 1, w1 = chunkOf(camX + 26) + 1, v0 = chunkOf(camY - 26) - 1, v1 = chunkOf(camY + 26) + 1; s.eco.setWatchedArea(Math.max(cx0 - 1, w0) * CHUNK, Math.max(cy0 - 1, v0) * CHUNK, (Math.min(cx1 + 2, w1 + 2)) * CHUNK - 1, (Math.min(cy1 + 2, v1 + 2)) * CHUNK - 1); }   // (far ground is only looked at)
      else s.eco.setWatchedArea((cx0 - 1) * CHUNK, (cy0 - 1) * CHUNK, (cx1 + 2) * CHUNK - 1, (cy1 + 2) * CHUNK - 1);
      s.beavers.step(simDt);                                                                                // the beavers fetch and build
      if (s.beavers.dirty) { s.beavers.dirty = false; actions.saveWorld(id, { sticks: [...pickedSticks], stones: [...pickedStones], beavers: s.beavers.toSaved() }); }
      s.beavers.player = walking ? { x: f.x, y: f.y, berries: berryRef.current } : null;   // (trusting colonies come to a player who holds berries)
      s.berries.step(simDt);                                                                                // picked bushes ripen again
      if (s.berries.dirty) { s.berries.dirty = false; actions.saveWorld(id, { berries: s.berries.toSaved() }); }
      {   // what the player on foot stands by (told to the panel only when it changes)
        const n = walking ? s.beavers.needsAt(f.x, f.y) : NO_NEED, bush = walking ? s.berries.near(f.x, f.y) : null, bv = walking ? s.beavers.beaverNear(f.x, f.y) : null, trust = bv ? s.beavers.colonies.get(bv.colony)?.trust ?? 0 : 0;
        const key = `${n.stick ? 1 : 0}${n.stone ? 1 : 0}${n.brk ? 1 : 0}|${bush ? `${bush.x},${bush.y}` : ''}|${bv ? `${bv.id}:${bv.full > 0 ? 1 : 0}:${trust}` : ''}`;
        if (key !== actKey.current) { actKey.current = key; const a: Act = { dam: n, bush, beaver: bv ? { id: bv.id, sex: bv.sex, full: bv.full > 0, trust } : null }; actRef.current = a; setAct(a); }
      }
      mark('before'); s.eco.step(simDt); s.eco.easeClouds(simDt); mark('eco');                                                              // the world keeps living while you fly
      for (const key of s.eco.dirty) { const old = chunks.current.get(key); if (old) old.stale = true; miniCache.terr.delete(key); }   // (the minimap's copy of that chunk is made again too)   // keep showing the old picture until the new one is ready
      s.eco.dirty.clear();
      for (const b of s.eco.strikes) if (b.id > lastStrike) {            // a new bolt: the flash and the thunder, both weaker with distance
        lastStrike = b.id;
        const near = Math.max(0, 1 - Math.hypot(b.x - f.x, b.y - f.y) / 45);
        flashK = Math.max(flashK, 0.25 + 0.75 * near); audio.current?.play('thunder', near);
      }
      flashK = Math.max(0, flashK - dt * 3.5);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (cx >= cx0 + 1 && cx <= cx1 - 1 && cy >= cy0 + 1 && cy <= cy1 - 1) s.explored.add(tileKey(cx, cy));

      if (useGL) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); }   // this canvas is only the overlay now: night, text, the wind dial
      else {
        g.setTransform(bs, 0, 0, bs, 0, 0);
        g.imageSmoothingEnabled = false;
        g.fillStyle = TERRAIN_COLOR[0]; g.fillRect(0, 0, VW, VH);
      }

      mark('camera');
      // ground: chunks that never existed are built first, then changed ones, within ~6 ms a frame (at least one);
      // a changed chunk keeps its old picture on screen meanwhile, so nothing flashes
      const decos: Deco[] = [], glChunks: GroundChunk[] = [];
      const missing: [number, number][] = [], stale: [number, number][] = [];
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!chunkVis(cx, cy)) continue;
        const ch = chunks.current.get(tileKey(cx, cy));
        if (!ch) missing.push([cx, cy]); else if (ch.stale) stale.push([cx, cy]);
      }
      const t0 = performance.now();
      let built = 0;
      const nearest = (a: [number, number], b: [number, number]) => Math.hypot((a[0] + 0.5) * CHUNK - camX, (a[1] + 0.5) * CHUNK - camY) - Math.hypot((b[0] + 0.5) * CHUNK - camX, (b[1] + 0.5) * CHUNK - camY);
      missing.sort(nearest);                                                         // the ground under you first, the horizon last
      const budget = frames < 150 ? 14 : aim.current.on && f.mode === 'glide' ? 8 : 3.5;   // (the first couple of seconds fill the screen quickly; after that the ground is built a few ms a frame)                  // (holding a throw: the view is about to drop to the ground, so build faster)
      for (const [cx, cy] of [...missing, ...stale]) {
        if (performance.now() - t0 >= budget) break;
        if (stepChunk(cx, cy, t0 + budget)) built++;
      }
      if (glr) { let cover = Infinity; for (const [cx, cy] of missing) if (!chunks.current.has(tileKey(cx, cy))) cover = Math.min(cover, Math.hypot((cx + 0.5) * CHUNK - camX, (cy + 0.5) * CHUNK - camY) - CHUNK); glr.cover = Math.min(Math.max(0, cover), glr.capD); }   // (the far mesh covers the ground whose chunks are not built yet: no gap between the chunks and the far hills)
      // keep the ground round the plane built ahead of time (a few chunks a frame, nearest first), so a throw or a landing, which brings the eye down to the ground, finds it there and does not draw it in from nothing
      if (f.mode === 'glide' && useGL && performance.now() - t0 < 3) {
        // (only the ring right round the plane and a wedge ahead of it, 60 degrees either side of the course: what is behind is not where a throw or a landing looks)
        const R = s.world.kind === 'lakedistrict' ? 3 : 6, pcx = chunkOf(f.x), pcy = chunkOf(f.y), near: [number, number][] = [], hx = Math.cos(f.course), hy = -Math.sin(f.course);
        for (let cy = pcy - R; cy <= pcy + R; cy++) for (let cx = pcx - R; cx <= pcx + R; cx++) {
          const dx = cx - pcx, dy = cy - pcy, dd = Math.hypot(dx, dy);
          if (dd > R + 0.5 || dd > 1.5 && (dx * hx + dy * hy) / dd < 0.5) continue;
          if (!chunks.current.has(tileKey(cx, cy))) near.push([cx, cy]);
        }
        near.sort((a, b) => Math.hypot(a[0] - pcx, a[1] - pcy) - Math.hypot(b[0] - pcx, b[1] - pcy));
        for (const [cx, cy] of near) { if (performance.now() - t0 > 4) break; if (stepChunk(cx, cy, t0 + 4)) built++; }
      }
      if (perf.on) { perf.build = Math.max(perf.build, performance.now() - t0); perf.builtN += built; perf.f.build = performance.now() - t0; perf.f.built = built; mark('chunks'); }
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!chunkVis(cx, cy)) continue;
        const ch = chunks.current.get(tileKey(cx, cy));
        if (ch) { if (useGL) glChunks.push({ key: tileKey(cx, cy), cx, cy, src: ch.src }); else g.drawImage(chunkCanvas(ch), ox + cx * CHUNK * T, oy + cy * CHUNK * T, CHUNK * T, CHUNK * T); for (const d of ch.decos) decos.push(d); }
      }
      if (chunks.current.size > (cx1 - cx0 + 1) * (cy1 - cy0 + 1) * 3) {                // drop the far chunks; they rebuild exactly from the seed
        for (const key of chunks.current.keys()) { const x = keyX(key), y = keyY(key); if (x < Math.min(cx0, chunkOf(f.x) - 6) - 3 || x > Math.max(cx1, chunkOf(f.x) + 6) + 3 || y < Math.min(cy0, chunkOf(f.y) - 6) - 3 || y > Math.max(cy1, chunkOf(f.y) + 6) + 3) dropChunk(key); }
      }
      const heldCap = Math.max(240, Math.ceil(glChunks.length * 1.25) + 40);   // (never fewer than what is on screen, or they would be dropped and rebuilt every frame)
      if (chunks.current.size > heldCap) {   // a hard cap: every chunk's picture is 256 KB of memory, and a phone has to hold the GPU copies as well; the farthest from the plane go first
        const far = [...chunks.current.keys()].sort((a, b) => Math.hypot(keyX(b) - chunkOf(f.x), keyY(b) - chunkOf(f.y)) - Math.hypot(keyX(a) - chunkOf(f.x), keyY(a) - chunkOf(f.y)));
        for (const k of far.slice(0, chunks.current.size - (heldCap - 40))) dropChunk(k);
      }

      // shared by both views: the plane's state, thermals, the sky's drift
      const glide = f.mode === 'glide';
      const alt = glide ? gl.z : 0;
      const ps = T * 2 * layerScale(layer);
      const skyT = useGL ? TILE_PX * 2 : T, skyZoom = useGL ? 2 : zoom;   // (in the 3D view the sky is laid out in the world, not on the screen: zooming the camera must not slide or squash it)
      const vLayer = dt > 0 ? (layer - lastLayer) / dt : 0; lastLayer = layer;
      tilt += ((glide ? Math.max(-1, Math.min(1, gl.pitch / 0.5)) : Math.max(-1, Math.min(1, -vLayer / 3))) - tilt) * Math.min(1, dt * 6);
      const thermals = glide && L.hints ? (useGL ? thermalsIn(tenv, Math.max(fp!.minX, camX - 40), Math.max(fp!.minY, camY - 40), Math.min(fp!.maxX, camX + 40), Math.min(fp!.maxY, camY + 40), gl.t, 20) : thermalsIn(tenv, camX - CX / T, camY - CY / T, camX + (VW - CX) / T, camY + (VH - CY) / T, gl.t, 20)) : [];
      {
        const wv = s.eco.windSpeed, wd = s.eco.wind.dir;
        DECO_LAYERS.forEach((cfg, li) => {
          const calm = wv < 0.02, v = (calm ? cfg.drift * skyZoom * 0.5 : wv * skyT * (cfg.parallax / 1.5)) * 0.35;   // (a slow drift: the sky clouds are scenery)
          skyOff[li].x += (calm ? 1 : Math.cos(wd)) * v * simDt; skyOff[li].y += (calm ? 0 : -Math.sin(wd)) * v * simDt;   // (the scenery clouds stop when time does; the skybox bands below keep drifting)
        });
        SKY_BANDS.forEach((b, bi) => { const v = (calm0(wv) ? 1 : 0.4 + wv * 2) * b.drift; sphOff[bi].x += (calm0(wv) ? 1 : Math.cos(wd)) * v * simDt; sphOff[bi].y += (calm0(wv) ? 0 : -Math.sin(wd)) * v * simDt; });
      }
      // lakes: flying (not landed) over a named lake counts for the lake achievements; checked a few times a second
      if (glide && !gl.landed && s.world.kind === 'lakedistrict' && (lakeTick = (lakeTick + 1) % 6) === 0) {
        if (lakeWaterAt(Math.round(f.x), Math.round(f.y)) === LAKE_WATER) {
          const w = lakeWatersFrom(f.x, f.y)[0];
          if (w && w.tiles < 12) actions.flewOverLake(w.name);
        } else if (lakeRoadAt(f.x, f.y, 0.8) === M6) actions.flewOverLake(M6);   // (the M6 is remembered in the same list)
      }
      // hoops: passed when the plane's path since the last frame goes through the disc (heights in tiles, as drawn: 0.18 per metre when gliding)
      {
        const hl = glide ? gl.z * 0.18 : 4 + (10 - layer) * 2, pv = prevP;
        prevP = { x: f.x, y: f.y, h: hl }; hoopFlash = Math.max(0, hoopFlash - dt);
        if (pv && !(glide && gl.landed) && Math.hypot(f.x - pv.x, f.y - pv.y) < 4) {          // (a throw or a jump is not a flight through anything)
          flown += Math.hypot(f.x - pv.x, f.y - pv.y);                                      // the distance flown, in tiles (= metres)
          for (const hp of hoopsIn(s.world.seed, Math.min(pv.x, f.x) - 5, Math.min(pv.y, f.y) - 5, Math.max(pv.x, f.x) + 5, Math.max(pv.y, f.y) + 5)) {
            if (hoopsDone.has(hp.key) || !passedHoop(hp, pv.x, pv.y, pv.h, f.x, f.y, hl)) continue;
            hoopsDone.add(hp.key); hoopCount++; hoopFlash = 1.4; miniDirty.current = true;
            { const sf = sfx.current; sf.streak = anim - sf.streakAt < 8 ? Math.min(12, sf.streak + 1) : 0; sf.streakAt = anim; audio.current?.play('hoop', sf.streak / 12); }   // a chime that climbs with hoops flown in quick succession
            if (glide) { gl.boostCd = 0; hoopBoost(gl); }                                       // a reward: the boost is ready again, and a kick of ground speed
          }
        }
      }
      {   // drifting leaves and pollen
        const wsp = L.wind.enabled ? L.wind.strength * 0.45 : 0, wdx = Math.cos(L.wind.dir), wdy = -Math.sin(L.wind.dir), seed = s.world.seed, dm = Math.max(0.001, Math.min(dt, 0.1));
        if (T >= 9 && !L.paused) {
          moteAcc += dm * 7;
          while (moteAcc >= 1 && motes.length < 110) {
            moteAcc -= 1;
            let x = 0, y = 0, h = 0, kind: 0 | 1 | 2 = 2, found = false;
            if (Math.random() < 0.12) {   // now and then one starts inside a wind tunnel in view, so its line shows
              for (let tries = 0; tries < 8 && !found; tries++) { x = camX + (Math.random() * 2 - 1) * CX / T; y = camY + (Math.random() * 2 - 1) * CY / T; if (tunnelAt(seed, x, y).k > 0.3) { found = true; h = 0.4 + Math.random() * 1.5; kind = Math.random() < 0.5 ? 2 : (Math.random() < 0.5 ? 0 : 1); } }
            }
            if (!found && decos.length) {
              const d = decos[Math.floor(Math.random() * decos.length)], tree = d.cell === SHEET.deciduous, bush = d.cell === SHEET.bush;
              if (!tree && !bush) continue;
              x = d.x + 0.5 + (Math.random() - 0.5) * 0.8; y = d.y + 0.5 + (Math.random() - 0.5) * 0.4;
              if (tree && Math.random() < 0.8) { kind = Math.random() < 0.6 ? 1 : 0; h = 2.2 + Math.random() * 2; } else { kind = 2; h = (tree ? 2 : 0.4) + Math.random() * 0.6; }
              found = true;
            }
            if (found) motes.push({ x, y, h, vx: 0, vy: 0, vh: 0, kind, rot: Math.random() * 6.28, rv: (Math.random() - 0.5) * 3, ph: Math.random() * 6.28, age: 0, life: kind === 2 ? 8 + Math.random() * 6 : 12 + Math.random() * 6, grounded: 0 });
          }
        }
        const range = Math.max(CX, CY) / T + 12;
        for (let i = motes.length - 1; i >= 0; i--) {
          const m = motes[i]; m.age += dm;
          if (m.age > m.life || Math.hypot(m.x - camX, m.y - camY) > range || T < 9) { motes.splice(i, 1); continue; }
          let tx = wdx * wsp, ty = wdy * wsp;
          const tn = tunnelAt(seed, m.x, m.y);
          if (tn.k > 0.01) { const sg = tn.dx * wdx + tn.dy * wdy >= 0 ? 1 : -1, tk = tn.k * (m.kind === 2 ? 1 : 0.8); tx += (tn.dx * sg * 9 - tx) * tk; ty += (tn.dy * sg * 9 - ty) * tk; }   // inside a tunnel the air runs along it
          if (m.grounded > 0) { m.grounded += dm; m.vx *= 0.8; m.vy *= 0.8; m.vh = 0; if (m.grounded > 1.5) m.age = m.life + 1; m.x += m.vx * dm; m.y += m.vy * dm; continue; }
          if (m.kind === 2) {   // pollen: follows the air closely, sways, and rises a little
            const k = Math.min(1, dm * 3), sw = Math.sin(m.age * 1.7 + m.ph) * 0.35;
            m.vx += (tx - wdy * sw - m.vx) * k; m.vy += (ty + wdx * sw - m.vy) * k; m.vh += (0.12 + Math.sin(m.age * 0.9 + m.ph) * 0.12 - m.vh) * Math.min(1, dm * 2);
          } else {              // leaves: lag behind the wind, flutter from side to side, tumble and sink
            const k = Math.min(1, dm * 1.3), fl = Math.sin(m.age * 3 + m.ph) * 0.9;
            m.vx += (tx * 0.6 - wdy * fl - m.vx) * k; m.vy += (ty * 0.6 + wdx * fl - m.vy) * k; m.vh += (-(0.4 + 0.25 * Math.sin(m.age * 2.1 + m.ph)) - m.vh) * Math.min(1, dm * 2);
            m.rot += m.rv * dm * (1 + Math.hypot(m.vx, m.vy) * 0.3);
          }
          m.x += m.vx * dm; m.y += m.vy * dm; m.h += m.vh * dm;
          if (m.h <= 0.03) { m.h = 0.03; if (m.kind !== 2) m.grounded = 0.001; else m.vh = 0.1; }
        }
      }
      {   // tricks. LAWN MOWER and WATER SKIM pay by the metre while skimming under 2.5 m (land or lake); the manoeuvres, the slalom, the stall hang and the thermal climb pay when done. Tricks in quick succession build the combo multiplier.
        trickMsgT = Math.max(0, trickMsgT - dt);
        if (newFx.current.length) pickFx.push(...newFx.current.splice(0));
        for (let i = pickFx.length - 1; i >= 0; i--) { pickFx[i].age += dt; if (pickFx[i].age > 0.7) pickFx.splice(i, 1); }
        if (walking) {   // sticks lying about: walk over one to pick it up
          for (const st of sticksIn(s.world.seed, f.x - 1, f.y - 1, f.x + 1, f.y + 1)) {
            if (pickedSticks.has(st.key) || Math.hypot(st.x - f.x, st.y - f.y) > STICK_PICK_RADIUS || s.world.terrainAt(Math.round(st.x), Math.round(st.y)) === WATER) continue;
            pickedSticks.add(st.key); pickFx.push({ x: st.x, y: st.y, a: st.angle, age: 0, stone: false }); actions.addItem('stick', 1); actions.saveWorld(id, { sticks: [...pickedSticks] }); setPickToast(prev => { const fresh = !!prev && prev.item === 'stick' && Date.now() - prev.at < 2200, from = fresh ? prev!.to : stickRef.current; return { item: 'stick', from, to: from + 1, at: Date.now() }; }); audio.current?.play('ready');
          }
        }
        if (walking) {   // stones stand about too
          for (const st of stonesIn(s.world.seed, f.x - 1, f.y - 1, f.x + 1, f.y + 1)) {
            if (pickedStones.has(st.key) || Math.hypot(st.x - f.x, st.y - f.y) > STICK_PICK_RADIUS || s.world.terrainAt(Math.round(st.x), Math.round(st.y)) === WATER) continue;
            pickedStones.add(st.key); pickFx.push({ x: st.x, y: st.y, a: 0, age: 0, stone: true }); actions.addItem('stone', 1); actions.saveWorld(id, { stones: [...pickedStones] });
            setPickToast(prev => { const fresh = !!prev && prev.item === 'stone' && Date.now() - prev.at < 2200, from = fresh ? prev!.to : stoneRef.current; return { item: 'stone', from, to: from + 1, at: Date.now() }; }); audio.current?.play('ready');
          }
        }
        const low = glide && !gl.landed && gl.z < GROUND_ALT + 2.5 && gl.airspeed > 3, wet = low && s.world.terrainAt(Math.round(f.x), Math.round(f.y)) === WATER, mow = low && !wet, hdx0 = Math.cos(f.heading), hdy0 = -Math.sin(f.heading);
        const mult = comboMult(combo), add = gl.airspeed * simDt * 0.5 * mult;
        if (mow) { mowT += simDt; trickPts += add; noteTrick(L.mowerText, add, mowGain === 0); mowGain += add; } else { mowT = Math.max(0, mowT - simDt * 2); if (mowT <= 0) mowGain = 0; }
        if (wet) {
          if (skimT <= 0) audio.current?.play('splash', 0.35);
          skimT += simDt; trickPts += add; noteTrick(L.skimText, add, skimGain === 0); skimGain += add;
          for (let i = 0; i < 2; i++) { const a = Math.random() * Math.PI - Math.PI / 2, sp = 0.6 + Math.random() * 1.2; splash.push({ x: f.x - hdx0 * 0.4, y: f.y - hdy0 * 0.4, h: 0.1, vx: (-hdx0 * Math.cos(a) + hdy0 * Math.sin(a)) * sp, vy: (-hdy0 * Math.cos(a) - hdx0 * Math.sin(a)) * sp, vh: 2 + Math.random() * 2.5, life: 0.8 }); }
        } else { skimT = Math.max(0, skimT - simDt * 2); if (skimT <= 0) skimGain = 0; }
        for (let i = splash.length - 1; i >= 0; i--) { const q = splash[i]; q.life -= simDt; if (q.life <= 0) { splash.splice(i, 1); continue; } q.x += q.vx * simDt; q.y += q.vy * simDt; q.h = Math.max(0, q.h + q.vh * simDt); q.vh -= 9 * simDt; }
        const inv = glide && !gl.landed && Math.abs(gl.phi) > 2.2 && gl.airspeed > 3 && gl.z > 2;   // upside down: 15 points a second
        if (inv) { invT += simDt; const ia = 15 * simDt * mult; trickPts += ia; noteTrick(L.invertedText, ia, invGain === 0); invGain += ia; } else { invT = Math.max(0, invT - simDt * 2); if (invT <= 0) invGain = 0; }
        if (glide && !gl.landed && gl.wet > 0.1 && Math.random() < gl.wet * 0.5) splash.push({ x: f.x + (Math.random() - 0.5) * 0.8, y: f.y + (Math.random() - 0.5) * 0.8, h: Math.min(20, gl.z * 0.18), vx: 0, vy: 0, vh: 0, life: 0.5 });   // a wet plane drips
        comboStep(combo, simDt, mow || wet || inv);
        if (glide) {
          const trees: TreeRef[] = [];
          if (!gl.landed && gl.z < 8) { const cx = Math.floor(f.x), cy = Math.floor(f.y); for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) { const tx = cx + xx, ty = cy + yy, dc = s.world.drawn(tx, ty).deco, top = dc === SHEET.conifer ? 4.5 : dc === SHEET.deciduous ? 4 : 0; if (top > 0) trees.push({ key: tx * 100003 + ty, x: tx + 0.5, y: ty + 0.5, top: top * decoK * s.world.stateAt(tx, ty).s }); } }
          for (const k of L.paused ? [] : stepTricks(tricks, gl, dt, { px: f.x, py: f.y, hx: hdx0, hy: hdy0, lift: L.debugLift ? 0 : gl.airLift, trees })) {
            const aw = comboAward(combo, TRICK_POINTS[k]), nm = k === 'roll' ? L.rollTrick : k === 'loop' ? L.loopTrick : k === 'immelman' ? L.immelmanTrick : k === 'splitS' ? L.splitSTrick : k === 'slalom' ? L.slalomTrick : k === 'stallHang' ? L.stallTrick : k === 'turn90' ? L.turn90Trick : k === 'uTurn' ? L.uTurnTrick : L.thermalTrick;
            trickPts += aw.pts; noteTrick(nm, aw.pts, true); trickMsg = `${nm} +${aw.pts}${aw.mult > 1 ? ` x${aw.mult}` : ''}`; trickMsgT = 2.4;
          }
        }
      }
      const placeLabels: { x: number; y: number; text: string; d: number; summit: boolean }[] = [];   // the Lake District's lake and fell names, over the places they name
      const hoopLabels: { x: number; y: number; text: string; size: number; done: boolean }[] = [];   // each hoop's height, on the stage, drawn over its middle
      let pp: [number, number] = [W / 2, H / 2], pg: [number, number] = [W / 2, H / 2];   // the plane and its shadow on the stage

      if (useGL) {
        // ---- the 3D view: the same things the flat map draws, placed in the world and seen through the camera ----------------------
        const G = glr!, ffp = fp!, cdrop = G.cell(SHEET.drop[0], SHEET.drop[1]), cplane = G.cell(SHEET.plane[0], SHEET.plane[1]);
        const at = G.atlas, cells = at.clouds.slice(0, cloudSprites.length), pickCell = (n: number) => cells[Math.abs(Math.floor(n)) % cells.length], ex = G.eye[0], ey = G.eye[1], lim2 = (G.reach * 0.98) * (G.reach * 0.98);
        const dens = L.decoDensity * (L.resAuto ? autoK : 1), px0 = f.x, py0 = f.y;   // (how far things are drawn is measured from the plane, not from the camera: the free view's camera stands off to one side, and the distance would change with where it is)
        const far = (x: number, y: number) => (x - px0) * (x - px0) + (y - py0) * (y - py0) > lim2;
        // heights above the ground, in tiles: layer 10 (low) 4 .. layer 1 (high) 22, for the plane and the clouds alike, so a plane on layer 5 flies between
        // the clouds of layer 4 and 6. Nothing goes above the camera (it hangs about 28 tiles up, lower when it is tipped back).
        const capH = Math.max(-G.eye[2] * 0.88, fpvK > 0.002 || poseK.current > 0 ? 24 : 0);   // (on foot the eye is low, but the clouds still hang where they did)
        const cloudH = (ly: number) => 4 + (10 - ly) * 2;   // (the clouds hang where they hang, however close the camera comes: zoomed in under them they are simply out of the view)
        const eyeH = -G.eye[2], nearFade = (x: number, y: number, h: number) => Math.max(0, Math.min(1, (Math.hypot(x - ex, y - ey, h - eyeH) - 3) / 8));   // (a cloud the camera is passing through thins out instead of filling the screen)
        { const rc = L.resScale / 100; glScale = L.resAuto ? Math.min(glScale, rc) : rc; }   // (the resolution setting is the ceiling; with auto on it still drops by itself when frames are slow)
        G.resize(W, H, dpr * glScale, glCv);
        { G.setHour(s.hour); const dk = darkness(sunElevation(s.hour)); G.night = dk > 0 ? [6 / 255, 10 / 255, 36 / 255, dk] : [0, 0, 0, 0]; }   // (the night tint is done on the GPU in this view)
        G.fx = L.shaders;
        G.begin();
        if (uploadBoost > 0) uploadBoost--;
        G.uploadMax = frames < 150 || aim.current.on || uploadBoost > 0 ? 6 : frameEma < 0.02 ? 2 : 1;   // (chunk textures a frame: plenty while the screen fills, a throw drops the eye to the ground or the big map has just closed, then one or two)
        { const g0 = performance.now(); G.ground(glChunks, CHUNK); if (perf.on) { perf.ground = Math.max(perf.ground, performance.now() - g0); perf.f.ground = performance.now() - g0; mark('ground'); } }
        if (++glFrames % 40 === 0) G.prune(k => chunks.current.has(k));

        if (L.showRivers) for (const rk of s.eco.riverTiles) { const rx = keyX(rk) + 0.5, ry = keyY(rk) + 0.5; if (far(rx, ry) || !ffp.inside(rx, ry, 1)) continue; G.flat('decal', rx, ry, 0.02, 0.5, 0.5, 0, -1, at.dot, 0.51, 0.9, 1, 0.45); }
        for (const c of s.eco.clouds) {                                               // cloud shadows on the ground
          const hh = cloudH(c.rl ?? c.layer), sx = (c.rx ?? c.x) + hh * 0.25, sy = (c.ry ?? c.y) + hh * 0.4, size = 2 * c.size;
          if (far(sx, sy) || !ffp.inside(sx, sy, size)) continue;
          if (cells.length) G.flat('decal', sx, sy, 0.01, size * 1.7, size * 1.7 * CLOUD_ASPECT, 0, -1, at.cloudShadows[Math.abs(Math.floor(c.id)) % cells.length], 0, 0, 0, 0.22 * (c.fade ?? 1));   // (the shadow of the very picture that is up there)
        }
        for (const pf of pickFx) {   // the picked-up stick pops up, spins and fades
          if (pf.age < 0) continue;
          const u = pf.age / 0.7, e = 1 - (1 - u) * (1 - u), spin = pf.a + u * 9;
          if (pf.berry) G.board('blend', pf.x, pf.y, 0.3 + e * 1.3, 0.5 + 0.2 * e, 0.5 + 0.2 * e, true, at.berry, 1, 1, 1, 1 - u * u);
          else if (pf.stone) G.board('blend', pf.x, pf.y, 0.05 + e * 1.6, 1 + 0.4 * e, 1 + 0.4 * e, true, at.stone, 1, 1, 1, 1 - u * u);
          else G.flat('blend', pf.x, pf.y, 0.1 + e * 1.8, 1.3 + 0.5 * e, 1.3 + 0.5 * e, Math.cos(spin), Math.sin(spin), at.stick, 1, 1, 1, 1 - u * u, 0.9 * e, 0.8 * e);
        }
        for (const m of motes) {   // leaves tumble (rolling and pitching as they flutter), pollen is a small speck facing the camera
          const a = Math.min(1, m.age * 1.5, (m.life - m.age) * 0.8) * (m.kind === 2 ? 0.9 : 1);
          if (m.kind === 2) G.board('blend', m.x, m.y, m.h, 0.34, 0.34, false, at.pollen, 1, 1, 1, a);
          else if (m.grounded > 0) G.flat('decal', m.x, m.y, 0.03, 0.7, 0.7, Math.cos(m.rot), Math.sin(m.rot), m.kind === 1 ? at.maple : at.leaf, 1, 1, 1, Math.min(1, 1.5 - m.grounded));
          else G.flat('blend', m.x, m.y, m.h, 0.7, 0.7, Math.cos(m.rot), Math.sin(m.rot), m.kind === 1 ? at.maple : at.leaf, 1, 1, 1, a, Math.sin(m.age * 3 + m.ph) * 0.9, Math.cos(m.age * 2.3 + m.ph) * 0.6);
        }
        mark('gl-setup');
        if (Tv >= 9) for (const st of stonesIn(s.world.seed, ffp.minX, ffp.minY, ffp.maxX, ffp.maxY)) {   // stones stand up like banners, facing the camera (a sprite that lies flat would show only its edge)
          if (pickedStones.has(st.key) || far(st.x, st.y) || !ffp.inside(st.x, st.y, 1) || s.world.terrainAt(Math.round(st.x), Math.round(st.y)) === WATER) continue;
          if (L.billboards) G.flat('decal', st.x, st.y - 0.04, 0.015, 0.7, 0.22, 0, -1, at.shadow, 0, 0, 0, 0.22);
          G.board('solid', st.x, st.y, -(stoneImg.current ? itemBottomPad(stoneImg.current) : 0) * 1.1, 1.1, 1.1, true, at.stone);   // (sunk by the empty rows under the stone, so it sits on the ground)
        }
        if (Tv >= 9) for (const st of sticksIn(s.world.seed, ffp.minX, ffp.minY, ffp.maxX, ffp.maxY)) {   // sticks lying on the ground (gone once picked up)
          if (pickedSticks.has(st.key) || far(st.x, st.y) || !ffp.inside(st.x, st.y, 1) || s.world.terrainAt(Math.round(st.x), Math.round(st.y)) === WATER) continue;
          G.flat('decal', st.x, st.y, 0.03, 1.3, 1.3, Math.cos(st.angle), Math.sin(st.angle), at.stick, 1, 1, 1, 1);   // the stick item's own picture, lying at its angle
        }
        if (Tv >= 9) {   // the beavers' works: the burrow is a heap of sticks with a stone on it, a dam is its sticks laid across the water with its stones on top (stand-ins until their own pictures come)
          for (const c of s.beavers.colonies.values()) {
            if (far(c.bx, c.by) || !ffp.inside(c.bx, c.by, 2)) continue;
            // a lodge with height: sticks standing up and facing the camera, stacked in three rows that narrow to the top (3, 2, 1), every other one mirrored
            const flip = { u0: at.stick.u1, v0: at.stick.v0, u1: at.stick.u0, v1: at.stick.v1 };
            let n = 0;
            if (c.bsticks < 1) G.flat('decal', c.bx, c.by + 0.2, 0.02, 1.6, 1.2, 0, -1, at.dot, 0.2, 0.14, 0.08, 0.7);   // a bare spot: trodden earth where the burrow will stand
            for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++, n++) {
              if (n >= c.bsticks) continue;                                   // one stick of the lodge for each laid: 3 (bottom row), then 2, then 1 on top
              const j = hash01(c.bx, c.by, n, 411) - 0.5, sx = (i - (2 - row) / 2) * 0.75 + j * 0.2, sh = 0.72 + 0.12 * hash01(c.bx, c.by, n, 416);
              G.board('solid', c.bx + sx, c.by + (hash01(c.bx, c.by, n, 417) - 0.5) * 0.5, row * 0.55 - 0.15, 1.5, 1.5, true, n % 2 ? flip : at.stick, sh, sh, sh);
            }
            if (isHome(c)) G.board('solid', c.bx, c.by + 0.3, -0.1, 0.8, 0.8, true, at.stone, 0.3, 0.25, 0.22);   // the way in: a dark hole at the front (only once it is a home)
          }
          for (const d of s.beavers.damTiles()) {
            if (far(d.x, d.y) || !ffp.inside(d.x, d.y, 2)) continue;
            for (let i = 0; i < d.sticks; i++) { const a = hash01(d.x, d.y, i, 412) * Math.PI; G.flat('decal', d.x + (hash01(d.x, d.y, i, 413) - 0.5) * 0.4, d.y + (hash01(d.x, d.y, i, 414) - 0.5) * 0.4, 0.04 + i * 0.01, 1.5, 1.5, Math.cos(a), Math.sin(a), at.stick); }
            for (let i = 0; i < d.stones; i++) G.board('solid', d.x + (hash01(d.x, d.y, i, 415) - 0.5) * 0.5, d.y + 0.1, -0.1, 0.8, 0.8, true, at.stone);
          }
          if (at.beavers.length) for (const b of s.beavers.beavers) {
            if (b.inside || far(b.x, b.y) || !ffp.inside(b.x, b.y, 2)) continue;
            const look = beaverLook(b), cell = at.beavers[look.cell], side = b.hx * G.R[0] + b.hy * G.R[1] >= 0 ? 1 : -1, uv = side > 0 ? cell : { u0: cell.u1, v0: cell.v0, u1: cell.u0, v1: cell.v1 };   // the pictures look to their right: mirrored when the beaver is headed to the left of the screen (which way that is in the world depends on where the camera looks)
            const swim = s.world.terrainAt(Math.round(b.x), Math.round(b.y)) === WATER, hop = b.eat > 0 ? Math.abs(Math.sin(b.eat * 14)) * 0.07 : b.state === 'gnaw' ? Math.abs(Math.sin(b.timer * 12)) * 0.06 : look.hops && b.moving && !swim ? Math.abs(Math.sin(b.phase * 9)) * 0.12 * look.size : 0, bw = 1.5 * look.size, bh = bw * BEAVER_ASPECT;   // (eating: it nods over the berry)
            if (L.billboards && !swim) G.flat('decal', b.x, b.y - 0.04, 0.015, 1.1, 0.3, 0, -1, at.shadow, 0, 0, 0, 0.22);
            G.board('solid', b.x, b.y, hop - (swim ? bh * 0.3 : 0), bw, bh, true, uv);                 // (swimming: sunk to the shoulders)
            if (b.eat > 0) { const dx = ex - b.x, dy = ey - b.y, dl = Math.hypot(dx, dy) || 1; G.board('solid', b.x + (dx / dl) * 0.06 + G.R[0] * side * 0.45, b.y + (dy / dl) * 0.06 + G.R[1] * side * 0.45, swim ? 0 : bh * 0.2, 0.4, 0.4, true, at.berry); }   // the berry it was handed
            else if (b.carry) { const dx = ex - b.x, dy = ey - b.y, dl = Math.hypot(dx, dy) || 1; G.board('solid', b.x + (dx / dl) * 0.06 + G.R[0] * side * 0.45, b.y + (dy / dl) * 0.06 + G.R[1] * side * 0.45, hop + (swim ? 0 : bh * 0.25), 0.6, 0.6, true, b.carry === 'stick' ? at.stick : at.stone); }   // what it carries, held out in front
          }
        }
        mark('stones-sticks');
        if (Tv >= 9) for (const d of decos) {                                          // trees, bushes and rocks stand on their tile, facing the camera (not when zoomed far out: they are a pixel or two, and thousands of them cost more than the ground)
          const wx = d.x + 0.5, wy = d.y + 1, ds = d.scale * decoK * (d.cell === SHEET.conifer || d.cell === SHEET.deciduous ? 1 : SMALL_DECO_K);   // (bushes and rocks are a fraction of a tree)
          if (hash01(d.x, d.y, 5) * 100 >= dens) continue;   // (the density setting thins the trees, bushes and rocks out, the same ones each time)
          if (far(wx, wy) || !ffp.inside(wx, wy, ds) || (s.world.kind === 'lakedistrict' && (wx - px0) * (wx - px0) + (wy - py0) * (wy - py0) > DECO_VIEW * DECO_VIEW)) continue;   // (on the hilly world trees, bushes and rocks are only built to 100 tiles: past that they are a pixel or two)
          if (L.billboards) G.flat('decal', wx, wy - 0.04, 0.015, ds * 0.64, ds * 0.2, 0, -1, at.shadow, 0, 0, 0, 0.22);
          G.board('solid', wx, wy, -bottomPad(img, d.cell) * ds, ds, ds, true, G.cell(d.cell[0], d.cell[1]));   // (sunk by the empty rows under the art, so a bush or rock sits on the ground instead of hovering)
          if (d.cell === SHEET.bush && s.berries.ripeBush(d.x, d.y)) {   // ripe berries hang on the bush, a touch nearer the eye than its leaves
            const dx = ex - wx, dy = ey - wy, dl = Math.hypot(dx, dy) || 1, nx = dx / dl, ny = dy / dl;
            for (let i = 0; i < 3; i++) { const o = BERRY_SPOTS[i]; G.board('solid', wx + nx * 0.05 - ny * o[0] * ds, wy + ny * 0.05 + nx * o[0] * ds, o[1] * ds, 0.2 * ds, 0.2 * ds, true, at.berry); }
          }
        }

        // thermals: haze on the hot ground, dust rising in it, a small cumulus on top of the strong ones
        for (const th of thermals) {
          const k = Math.min(1, th.w / 4);
          G.flat('decal', th.x, th.y, 0.03, th.r * 2, th.r * 2, 0, -1, at.haze, 1, 1, 1, 0.34 * k);
          for (let i = 0; i < 16; i++) {
            const ph = (anim * (0.22 + 0.2 * k) + hash01(i, th.x | 0, th.y | 0, 5)) % 1, a = hash01(i, th.x | 0, th.y | 0, 6) * Math.PI * 2, d = Math.sqrt(hash01(i, th.x | 0, th.y | 0, 7)) * th.r * 0.55 * (1 - ph * 0.3);
            G.board('blend', th.x + Math.cos(a) * d + Math.sin(anim * 2 + i) * 0.06, th.y + Math.sin(a) * d * 0.7, ph * th.r * 0.5, 0.14, 0.14, false, at.dot, 1, 0.94, 0.78, Math.sin(ph * Math.PI) * 0.9);
          }
          if (th.w >= 1.6 && th.age >= 0.12 && th.age <= 0.92) {
            const sz = 1.3 + th.w * 0.22, al = Math.min(0.85, (th.w - 1.4) * 0.35);
            if (cells.length) G.board('blend', th.x, th.y, 6, sz * 2.2, sz * 2.2 * CLOUD_ASPECT, false, pickCell(Math.round(th.x * 7 + th.y * 13)), 1, 1, 1, al);
          }
        }

        // the paper plane: flat in the air, nose along its heading, banked and pitched like the glider (or the layer change), with its shadow below
        const gPhi = glide && !gl.landed ? gl.phi : 0, gPitch = glide && !gl.landed ? gl.pitch : 0;                 // lying flat once landed
        const clear = glide ? (Math.min(HULL_DIP, Math.abs(Math.sin(gPhi)) + Math.abs(Math.sin(gPitch))) + 0.06) * planeK : 0;       // the quad is 2 wide: a tilted wing tip or nose would dip this far below the ground, so lift it by that much
        const planeCap0 = Math.max(0.55 * -G.eye[2], 0), planeCap = planeCap0 + (120 - planeCap0) * sstep(poseK.current, 0, 1);   // (the free view and the flyby may look up at it: then it flies as high as it is)   // (looking straight down the plane must stay well below the camera: the nearer it is, the more a look-ahead shifts it on screen, until it slides off the view or under the instrument)
        const hP = glide ? Math.max(clear, Math.min(alt * 0.18, planeCap)) : Math.min(cloudH(layer), capH), hdx = Math.cos(f.heading), hdy = -Math.sin(f.heading);
        if (glide) planeH.current = hP;   // (the chase camera looks at this)
        const shx = f.x + hP * 0.12, shy = f.y + hP * 0.25;
        {
          const sa = glide ? Math.max(0.12, 0.34 - alt / 500) : 0.25, ssz = 2 * planeK * (glide ? 1 - Math.min(0.35, alt / 300) : 1);
          if (fpvK < 0.3 && !G.hasModel) G.flat('decal', shx, shy, 0.02, ssz * (glide ? Math.max(0.35, Math.cos(gl.phi)) : 1), ssz, hdx, hdy, at.shadow, 0, 0, 0, sa);
          for (const q of splash) G.board('blend', q.x, q.y, q.h, 0.32, 0.32, false, cdrop, 0.85, 0.95, 1, Math.min(0.9, q.life * 1.5));   // the spray of a water skim
          if (fpvK < 0.3 || (!walking && !aiming && !launchActive && !gl.landed && gl.z > 2.5) || (launchActive && Math.hypot(f.x - launchCam.current!.x, f.y - launchCam.current!.y) > 5)) { if (G.hasModel) G.drawModel(f.x, f.y, hP, hdx, hdy, glide ? gPhi : 0, glide ? gPitch : tilt * 0.35, 2.4 * planeK, sa, 0.12, 0.25, glide && !gl.landed ? { f: gl.fwd, u: gl.top } : undefined); else G.flat('solid', f.x, f.y, hP, 2 * planeK, 2 * planeK, hdx, hdy, cplane, 1, 1, 1, 1, glide ? gPhi : 0, glide ? gPitch : tilt * 0.35); }
          { const D = dog.current; if (D && D.phase !== 'over' && glide && G.hasModel) { const a = D.ai; G.drawModel(a.x, -a.y, Math.max(0.1, Math.min(a.z * 0.18, planeCap + 4)), Math.cos(a.psi), -Math.sin(a.psi), a.phi, a.pitch, 2.4 * 1.8 * planeK, sa, 0.12, 0.25, { f: a.fwd, u: a.top }, D.role === 'flee' ? [1, 0.45, 0.4] : [0.5, 0.65, 1]); } }   // the opponent: red when it hunts you, blue when you hunt it
        }

        // where the plane comes down if the controls are let go now: a copy of it is flown on with the real physics (thermals, wind, the hills, trees) every half second, and a ring shows where it ends
        if (glide && !gl.landed && !L.hideUi && landEnv && !L.paused) {
          landT -= dt;
          if (landT <= 0) {
            landT = 0.5;
            const env = landEnv;
            const blocked = (x: number, y: number, z: number) => {   // (the same trees and bushes that crash the plane for real)
              if (z > treeTopM * 1.1) return false;
              const tx = Math.floor(x), ty = Math.floor(-y), dc = s.world.drawn(tx, ty).deco, bush = dc === SHEET.bush, top = bush ? 1.3 : dc === SHEET.conifer ? 4.5 : dc === SHEET.deciduous ? 4 : 0;
              return top > 0 && z < top * decoK * (bush ? SMALL_DECO_K : 1) * s.world.stateAt(tx, ty).s && Math.hypot(x - tx - 0.5, -y - ty - 0.5) < 0.38 * decoK * (bush ? SMALL_DECO_K : 1);
            };
            const r = projectLanding(gl, { pitch: 0, roll: 0, yaw: 0, freeStall: false, aero: false, thrust: L.throttle / 100 }, env, { maxT: 45, dt: 0.5, blocked });
            const wet = r.end !== 'blocked' && s.world.terrainAt(Math.round(r.x), Math.round(-r.y)) === WATER, softHit = !!r.impact && r.impact.sink <= SOFT_SINK && r.impact.bank <= SOFT_BANK;
            landAt = { x: r.x, y: -r.y, kind: r.end === 'time' ? 'far' : r.end === 'blocked' ? 'crash' : wet ? (softHit ? 'skim' : 'splash') : softHit ? 'soft' : 'crash' };   // red: a crash (or a tree); blue: a splash; green: a soft landing; flashing green and blue: a soft touch on the water (the tail drags)
          }
          if (landAt) {
            if (!landShow || Math.hypot(landShow.x - landAt.x, landShow.y - landAt.y) > 40) landShow = { x: landAt.x, y: landAt.y };
            const k = 1 - Math.exp(-8 * dt); landShow.x += (landAt.x - landShow.x) * k; landShow.y += (landAt.y - landShow.y) * k;
            const dist = Math.hypot(landShow.x - ex, landShow.y - ey), sz = Math.max(0.25, Math.min(4, dist * 0.03)), flash = Math.sin(anim * 9) > 0;   // (the farther off, the bigger, so it can be seen)
            const col: [number, number, number] = landAt.kind === 'crash' ? [1, 0.2, 0.15] : landAt.kind === 'splash' ? [0.25, 0.55, 1] : landAt.kind === 'soft' ? [0.3, 1, 0.4] : landAt.kind === 'skim' ? (flash ? [0.3, 1, 0.4] : [0.25, 0.55, 1]) : [0.85, 0.85, 0.85];
            {   // (no draw-distance cut: it is a marker, you must see it however far the ground is drawn)
              // a pointer made of eight spinning cuboids, each a little narrower than the one above, ending in a point on the landing spot
              const x0 = landShow.x, y0 = landShow.y, gz = G.groundH(x0, y0), spin = anim * 1.6, N = 8, hl = sz * 0.24, bob = 0.15 * sz * (1 + Math.sin(anim * 3));
              for (let i = 0; i < N; i++) {
                const w = sz * 0.3 * Math.pow(1 - i / N, 1.25) + sz * 0.012, zc = -(gz + bob + (N - 1 - i) * hl + hl / 2), a0 = spin + i * 0.2;
                for (let k = 0; k < 4; k++) {
                  const a = a0 + k * Math.PI / 2, ca = Math.cos(a), sa2 = Math.sin(a), sh = 0.62 + 0.38 * Math.cos(a - 0.9);
                  G.quad('solid', x0 + ca * w, y0 + sa2 * w, zc, -sa2 * w, ca * w, 0, 0, 0, -hl / 2, at.dot, col[0] * sh, col[1] * sh, col[2] * sh, 1);
                }
                G.quad('solid', x0, y0, zc - hl / 2, Math.cos(a0) * w, Math.sin(a0) * w, 0, -Math.sin(a0) * w, Math.cos(a0) * w, 0, at.dot, col[0], col[1], col[2], 1);
              }
            }
          }
        } else { landAt = null; landShow = null; landT = 0; }
        mark('decos');
        // water-cycle clouds and the rain under them
        G.skyMode = true;
        {
          const dirX = Math.cos(L.wind.dir), dirY = -Math.sin(L.wind.dir), reach = L.wind.enabled ? L.wind.strength : 0;
          for (const c of s.eco.clouds) {
            const size = 2 * c.size, rl = c.rl ?? c.layer, hh = cloudH(rl), fd = c.fade ?? 1;
            if (far((c.rx ?? c.x), (c.ry ?? c.y)) || !ffp.inside((c.rx ?? c.x), (c.ry ?? c.y), size + reach + 3) || Math.hypot((c.rx ?? c.x) - px0, (c.ry ?? c.y) - py0) > HOOP_VIEW) continue;   // (clouds and their rain are seen to 100 tiles, like hoops)
            if (cells.length) G.board('blend', (c.rx ?? c.x), (c.ry ?? c.y), hh, size * 1.7, size * 1.7 * CLOUD_ASPECT, false, pickCell(c.id), 1, 1, 1, Math.min(1, 0.45 + rl * 0.06 + Math.min(0.3, c.water * 0.3)) * fd * nearFade((c.rx ?? c.x), (c.ry ?? c.y), hh));
            if (c.raining) {
              const rx = (c.rx ?? c.x) + dirX * reach, ry = (c.ry ?? c.y) + dirY * reach, spread = (0.8 + 2.4 * c.rain) * RAIN_SCALE, rainA = 0.9 * Math.min(1, c.rain * 4) * fd;
              for (let i = 0; i < 16; i++) {
                const a = hash01(c.id, i, 1) * Math.PI * 2, r = Math.sqrt(hash01(c.id, i, 2)) * spread, fall = (anim * 1.4 + hash01(c.id, i, 3)) % 1;
                G.board('blend', rx - dirX * reach * (1 - fall) + Math.cos(a) * r, ry - dirY * reach * (1 - fall) + Math.sin(a) * r, (1 - fall) * hh, 1, 1, false, cdrop, 1, 1, 1, rainA);   // (the drops leave the cloud and are blown downwind as they fall: slanted by the wind's direction, more the stronger it blows)
              }
            }
          }
        }
        G.skyMode = false;

        // fire: a flame on every burning tile with its glow on the ground, and the bolts from cloud to ground; both shine at night
        for (const [k, t0] of s.eco.scorched) {                                       // charred ground where a fire went out, fading as it recovers
          const wx = keyX(k) + 0.5, wy = keyY(k) + 0.5;
          if (far(wx, wy) || !ffp.inside(wx, wy, 1)) continue;
          const sk = Math.max(0, 1 - (s.eco.now - t0) / SCORCH_COOLDOWN);
          if (L.shaders) G.flat('decal', wx, wy, 0.012, 1.7, 1.7, 0, -1, FX_UV, FX_SCORCH, sk, hash01(keyX(k), keyY(k), 7), 1 + FX_MARK);   // (drawn by the shader: char, ash and embers, in a ragged patch)
          else G.flat('decal', wx, wy, 0.012, 1.04, 1.04, 0, -1, at.dot, 0.07, 0.05, 0.04, 0.62 * sk);
        }
        if (L.shaders) for (const [k, until] of s.eco.wetUntil) {                     // grass the rain has wetted: dark, with the sky's sheen, puddles and glints, drying off as the tile does
          const tx = keyX(k), ty = keyY(k), wx = tx + 0.5, wy = ty + 0.5;
          if (far(wx, wy) || !ffp.inside(wx, wy, 1) || s.world.terrainAt(tx, ty) === WATER) continue;
          G.flat('decal', wx, wy, 0.011, 1.7, 1.7, 0, -1, FX_UV, FX_WET, Math.max(0, Math.min(1, (until - s.eco.now) / WET_TIME)), hash01(tx, ty, 8), 1 + FX_MARK);
        }
        if (L.shaders) {                                                              // wind tunnels: streaks of air running along each corridor, the way it blows today
          const wdx2 = Math.cos(L.wind.dir), wdy2 = -Math.sin(L.wind.dir), R = Math.min(G.reach, 260) + TUNNEL_HALF_LENGTH;
          for (let j = Math.floor((G.eye[1] - R) / TUNNEL_CELL); j <= Math.floor((G.eye[1] + R) / TUNNEL_CELL); j++) for (let i = Math.floor((G.eye[0] - R) / TUNNEL_CELL); i <= Math.floor((G.eye[0] + R) / TUNNEL_CELL); i++) {
            const tn = tunnelInCell(s.world.seed, i, j); if (!tn || Math.hypot(tn.x - G.eye[0], tn.y - G.eye[1]) > R || !ffp.inside(tn.x, tn.y, TUNNEL_HALF_LENGTH)) continue;
            const ax = Math.cos(tn.angle), ay = Math.sin(tn.angle);
            G.flat('blend', tn.x, tn.y, 1.4, TUNNEL_HALF_WIDTH * 2, TUNNEL_HALF_LENGTH * 2, ax, ay, FX_UV, FX_TUNNEL, ax * wdx2 + ay * wdy2 >= 0 ? 1 : -1, hash01(i, j, 5), 1 + FX_MARK);
          }
        }
        if (at.flames.length || L.shaders) for (const fr of s.eco.fires.values()) {
          const wx = fr.x + 0.5, wy = fr.y + 0.7;
          if (far(wx, wy) || !ffp.inside(wx, wy, 2)) continue;
          const k = Math.min(1, fr.age * 3, 0.35 + fr.fuel * 0.6) * (0.9 + Math.min(0.9, fr.total * 0.09)), fi = (Math.floor(anim * 9) + fr.x * 3 + fr.y * 5) % at.flames.length;
          G.flat('decal', wx, wy - 0.2, 0.025, 2.6 * k, 2.6 * k, 0, -1, at.haze, 1, 1, 1, 0.55 + 0.15 * Math.sin(anim * 13 + fr.x) + GLOW);
          if (L.shaders) G.board('blend', wx, wy, 0, 1.5 * k, 2.25 * k, true, FX_UV, FX_FLAME, 0, hash01(fr.x, fr.y, 3), 1 + GLOW + FX_MARK);   // (a flame the shader draws: it licks and throws sparks)
          else G.board('blend', wx, wy, 0, 1.25 * k, 1.25 * k * FLAME_ASPECT, true, at.flames[Math.abs(fi)], 1, 1, 1, 1 + GLOW);
        }
        if (at.bolt) for (const b of s.eco.strikes) {
          if (far(b.x, b.y) || (b.age > 0.12 && Math.floor(b.age * 30) % 2 === 0)) continue;   // it flickers after the first instant
          const hh = Math.max(6, cloudH(b.layer)), w = Math.max(hh * 1.15, hh / BOLT_ASPECT * 0.6);
          G.board('blend', b.x + G.R[0] * w * (0.5 - BOLT_TIP), b.y + G.R[1] * w * (0.5 - BOLT_TIP), 0, w, hh, true, at.bolt, 1, 1, 1, 1 + GLOW);
          G.flat('decal', b.x, b.y, 0.03, 4, 4, 0, -1, at.haze, 0.7, 0.85, 1, 0.8 + GLOW);
        }

        // the sky: clouds in a sphere round the plane (cumulus low, stratocumulus in the middle, cirrus high), fixed to the world and drifting with the wind
        G.skyMode = true;
        if (L.decoClouds && at.clouds.length) emitSkyClouds((x, y, z, w, sprite, al) => {
          const p = G.project(x, y, -z); if (!p) return;
          const dist = Math.hypot(x - ex, y - ey, z - eyeH), half = (w / 2) / Math.max(dist, 1) * H * 1.6, m = half + 40;
          if (p[0] < -m || p[0] > W + m || p[1] < -m || p[1] > H + m) return;   // (a cloud wholly off the screen is never built)
          G.board('blend', x, y, z, w, w * CLOUD_ASPECT, false, at.clouds[sprite], 1, 1, 1, al * nearFade(x, y, z));
        }, s.world.seed, f.x, f.y, hP, anim, sphOff);
        G.skyMode = false;
        // hoops: upright discs standing in the air, gold until the plane has flown through, then a faint green; a shadow on the ground shows where
        mark('beavers-clouds');
        for (const hp of hoopsIn(s.world.seed, ffp.minX - 5, ffp.minY - 5, ffp.maxX + 5, ffp.maxY + 5)) {
          if (far(hp.x, hp.y) || !ffp.inside(hp.x, hp.y, hp.r + 2) || (hp.x - px0) * (hp.x - px0) + (hp.y - py0) * (hp.y - py0) > HOOP_VIEW * HOOP_VIEW) continue;   // (hoops are seen to 100 tiles, however far the ground is drawn)
          const done = hoopsDone.has(hp.key), tx = -Math.sin(hp.angle), ty = Math.cos(hp.angle);
          G.quad('blend', hp.x, hp.y, -hp.h - G.groundH(hp.x, hp.y), tx * hp.r, ty * hp.r, 0, 0, 0, -hp.r, at.ring, done ? 0.4 : 1, done ? 1 : 0.78, done ? 0.5 : 0.15, done ? 0.45 : 0.85 + 0.15 * Math.sin(anim * 3 + hp.x));
          G.flat('decal', hp.x, hp.y, 0.02, hp.r * 0.75, hp.r * 2, tx, ty, at.ring, 0, 0, 0, done ? 0.16 : 0.3);   // the shadow of an upright ring is a squashed ring on the ground, as wide as the hoop and not as deep
          const hc = G.projectAgl(hp.x, hp.y, hp.h), he = G.projectAgl(hp.x, hp.y, hp.h + hp.r);
          if (hc && he && hc[0] > -40 && hc[0] < W + 40 && hc[1] > -40 && hc[1] < H + 40) hoopLabels.push({ x: hc[0], y: hc[1], text: `${realAlt(hp.h / 0.18)} m`, size: Math.max(10, Math.min(22, Math.abs(he[1] - hc[1]) * 0.45)), done });
        }
        // the names of the lakes and fells, floating over them, as far off as they can be read
        if (s.world.kind === 'lakedistrict' && (!L.hideUi || L.lookUi)) {
          const tileM = lakeData()?.tileM ?? 50;
          for (const pl of lakePlaceLabels()) {
            const d = Math.hypot(pl.x - f.x, pl.y - f.y) * tileM, max = pl.kind === 'lake' ? 14000 : 9000;
            if (d > max || d < 60) continue;
            const c = G.projectAgl(pl.x, pl.y, pl.kind === 'lake' ? 5 : 7);
            if (c && c[0] > 40 && c[0] < W - 40 && c[1] > 20 && c[1] < H - 20) placeLabels.push({ x: c[0], y: c[1], text: pl.kind === 'summit' ? `${pl.name} ${pl.m} m` : pl.name, d: d / max, summit: pl.kind === 'summit' });
          }
        }
        G.end();
        mark('hoops-model-end'); if (perf.on && perf.gpuWait) { perf.f.gpu = G.gpuWaitMs(); perf.gpu = Math.max(perf.gpu, perf.f.gpu); mark('gpuwait'); }   // (it makes the frame wait for the GPU, so the readout itself slows things down a little; ?perf=nogpu leaves it out)
        pp = G.projectAgl(f.x, f.y, hP) ?? pp; pg = G.projectAgl(shx, shy, 0) ?? pg; planeY.current = pp[1];
      } else {
      // the river lines the clouds are drawn to (a debug view in Android, a toggle here)
      if (L.showRivers) {
        g.fillStyle = 'rgba(130,230,255,0.45)';
        for (const rk of s.eco.riverTiles) {
          const rx = ox + keyX(rk) * T, ry = oy + keyY(rk) * T;
          if (rx < -T || ry < -T || rx > VW || ry > VH) continue;
          g.fillRect(rx + T * 0.25, ry + T * 0.25, T * 0.5, T * 0.5);
        }
      }

      // cloud shadows on the ground
      g.globalAlpha = 0.22;
      for (const c of s.eco.clouds) {
        const size = T * 2 * c.size, sx = ox + (c.rx ?? c.x) * T + c.layer * 1.4 * zoom, sy = oy + (c.ry ?? c.y) * T + c.layer * 2.4 * zoom;   // the sun stays put in the world, so the shadow turns with the ground (as in the 3D view)
        if (sx < -size || sy < -size || sx > VW + size || sy > VH + size || !vis(sx, sy, size)) continue;
        if (cloudSprites.length) { const w = size * 1.7, h = w * CLOUD_ASPECT; g.save(); g.translate(sx, sy); g.rotate(-rot); g.drawImage(shadowOf(cloudPick(c.id)), -w / 2, -h / 2, w, h); g.restore(); }   // like a billboard's shadow: its spot turns with the ground, its shape stays upright like the cloud
      }
      g.globalAlpha = 1;

      // trees, bushes and rocks (they overlap their neighbours, so they are drawn by row)
      decos.sort((a, b) => a.y - b.y);
      for (const d of decos) {
        const sz = T * d.scale, sx = ox + (d.x + 0.5) * T, sy = oy + (d.y + 1 + bottomPad(img, d.cell) * d.scale) * T;
        if (sx < -sz || sx > VW + sz || sy < 0 || sy > VH + sz * 2 || !vis(sx, sy - sz / 2, sz)) continue;
        if (L.billboards) {                                                   // billboards: lean away from the middle of the view, from the base
          const ddx = sx - CX, ddy = sy - CY;                                 // (in the screen's frame: the world may be turned)
          const lean = billboardLean(ddx * Math.cos(rot) - ddy * Math.sin(rot), ddx * Math.sin(rot) + ddy * Math.cos(rot), layer, BILLBOARD_MAX_DISTANCE * (zoom / 2));
          const w = sz * lean.scale;
          g.fillStyle = 'rgba(0,0,0,0.22)';                                 // the shadow stays on the ground (on the tile) while the tree leans off it
          g.beginPath(); g.ellipse(sx, sy - w * 0.04, w * 0.32, w * 0.1, -rot, 0, Math.PI * 2); g.fill();
          g.save();
          g.translate(sx, sy); g.rotate(-rot);                               // upright on the screen
          g.transform(1, 0, -lean.shear, lean.stretch, 0, 0);               // x' = x - shear * y (y is negative above the base)
          g.drawImage(img, d.cell[0] * TILE_PX, d.cell[1] * TILE_PX, TILE_PX, TILE_PX, -w / 2, -w, w, w);
          g.restore();
        } else if (rot !== 0) { g.save(); g.translate(sx, sy); g.rotate(-rot); g.drawImage(img, d.cell[0] * TILE_PX, d.cell[1] * TILE_PX, TILE_PX, TILE_PX, -sz / 2, -sz, sz, sz); g.restore(); }
        else g.drawImage(img, d.cell[0] * TILE_PX, d.cell[1] * TILE_PX, TILE_PX, TILE_PX, sx - sz / 2, sy - sz, sz, sz);   // grows up from the tile's bottom edge
        if (T >= 9 && d.cell === SHEET.bush && berryImg.current && s.berries.ripeBush(d.x, d.y)) {   // ripe berries on the bush
          const bs = sz * 0.2, base = sy - bottomPad(img, d.cell) * sz;
          for (const o of BERRY_SPOTS) g.drawImage(berryImg.current, sx + o[0] * sz - bs / 2, base - o[1] * sz - bs, bs, bs);
        }
      }

      // hoops, seen from straight above: a standing disc is a line across its facing
      for (const hp of hoopsIn(s.world.seed, camX - CX / T - 5, camY - CY / T - 5, camX + (VW - CX) / T + 5, camY + (VH - CY) / T + 5)) {
        const hx = ox + hp.x * T, hy = oy + hp.y * T;
        if (!vis(hx, hy, hp.r * T + 8)) continue;
        const tx = -Math.sin(hp.angle) * hp.r * T, ty = Math.cos(hp.angle) * hp.r * T, done = hoopsDone.has(hp.key);
        g.strokeStyle = done ? 'rgba(120,255,140,0.5)' : '#ffc233'; g.lineWidth = 4 * zoom / 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(hx - tx, hy - ty); g.lineTo(hx + tx, hy + ty); g.stroke();
        hoopLabels.push({ x: hx, y: hy, text: `${realAlt(hp.h / 0.18)} m`, size: 13, done });   // (canvas pixels for now; turned into stage pixels below)
      }

      // thermals: a warm haze over the hot ground with dust rising in it; the stronger the lift, the redder and busier
      for (const th of thermals) {
        const cxp = ox + th.x * T, cyp = oy + th.y * T, rr = th.r * T, k = Math.min(1, th.w / 4);
        const gr = g.createRadialGradient(cxp, cyp, 0, cxp, cyp, rr);
        gr.addColorStop(0, `rgba(255,150,40,${0.34 * k})`); gr.addColorStop(0.6, `rgba(255,190,80,${0.14 * k})`); gr.addColorStop(1, 'rgba(255,200,100,0)');
        g.fillStyle = gr; g.fillRect(cxp - rr, cyp - rr, rr * 2, rr * 2);
        g.fillStyle = 'rgba(255,240,200,0.8)';
        for (let i = 0; i < 16; i++) {                                                     // motes rising and drifting inwards
          const ph = (anim * (0.22 + 0.2 * k) + hash01(i, th.x | 0, th.y | 0, 5)) % 1, a = hash01(i, th.x | 0, th.y | 0, 6) * Math.PI * 2, d = Math.sqrt(hash01(i, th.x | 0, th.y | 0, 7)) * rr * 0.55 * (1 - ph * 0.3);
          g.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
          g.fillRect(cxp + Math.cos(a) * d + Math.sin(anim * 2 + i) * 2, cyp + Math.sin(a) * d * 0.7 - ph * rr * 0.9, 2 * zoom, 2 * zoom);
        }
        g.globalAlpha = 1;
      }

      // optional decorative clouds (off by default, like Android)
      // each deco layer sits at a plane layer (nearest sky layer = high altitude); the ones below the plane go under it, the rest over it
      // the sky slides with the wind (speed and direction); with no wind it keeps its slow eastward drift. Integrated per frame so changing the wind never makes it jump
      const decoBelow = (li: number) => layer < DECO_ALTITUDE[li];
      if (L.decoClouds) drawDecoClouds(g, s.world.seed, f.x, f.y, 2 * CX, 2 * CY, T, zoom, anim, skyOff, li => decoBelow(li), rot);

      // the clouds of the water cycle, then the rain under them; clouds higher than the plane (lower layer number) are drawn after it
      const drawWater = (above: boolean) => {
      const dirX = Math.cos(L.wind.dir), dirY = -Math.sin(L.wind.dir), reach = L.wind.enabled ? L.wind.strength : 0;
      for (const c of s.eco.clouds) {
        if ((c.layer < layer) !== above) continue;
        const size = T * 2 * c.size, lo = scr(0, -c.layer * 2 * zoom), sx = ox + (c.rx ?? c.x) * T + lo[0], sy = oy + (c.ry ?? c.y) * T + lo[1];
        if (sx < -size || sy < -size || sx > VW + size || sy > VH + size * 3 || !vis(sx, sy, size * 1.5 + (reach + 3) * T)) continue;
        g.globalAlpha = Math.min(1, 0.45 + c.layer * 0.06 + Math.min(0.3, c.water * 0.3));
        if (cloudSprites.length) {
          const sp = cloudPick(c.id), w = size * 1.7, h = w * CLOUD_ASPECT;
          if (rot !== 0) { g.save(); g.translate(sx, sy); g.rotate(-rot); g.drawImage(sp, -w / 2, -h / 2, w, h); g.restore(); }
          else g.drawImage(sp, sx - w / 2, sy - h / 2, w, h);
        }
        if (c.raining) {
          const rx = ox + ((c.rx ?? c.x) + dirX * reach) * T, ry = oy + ((c.ry ?? c.y) + dirY * reach) * T, spread = rainRadius(c.rain) * T;
          g.globalAlpha = 0.9;
          for (let i = 0; i < 16; i++) {
            const a = hash01(c.id, i, 1) * Math.PI * 2, r = Math.sqrt(hash01(c.id, i, 2)) * spread, fall = (anim * 1.4 + hash01(c.id, i, 3)) % 1;
            const fo = scr(0, -(1 - fall) * T * 2.5), px = rx - dirX * reach * T * (1 - fall) + Math.cos(a) * r + fo[0], py = ry - dirY * reach * T * (1 - fall) + Math.sin(a) * r + fo[1];
            if (rot !== 0) { g.save(); g.translate(px, py); g.rotate(-rot); g.drawImage(img, SHEET.drop[0] * TILE_PX, SHEET.drop[1] * TILE_PX, TILE_PX, TILE_PX, -T / 2, -T / 2, T, T); g.restore(); }
            else g.drawImage(img, SHEET.drop[0] * TILE_PX, SHEET.drop[1] * TILE_PX, TILE_PX, TILE_PX, px - T / 2, py - T / 2, T, T);
          }
        }
      }
      g.globalAlpha = 1;
      };
      // fire and lightning (flat view): a flame standing on each burning tile, the bolt with its tip on the struck tile
      for (const [k, t0] of s.eco.scorched) {                                         // charred ground, fading as it recovers
        const sx = ox + keyX(k) * T, sy = oy + keyY(k) * T;
        if (sx < -T || sy < -T || sx > VW || sy > VH) continue;
        g.fillStyle = `rgba(18,13,10,${(0.62 * Math.max(0, 1 - (s.eco.now - t0) / SCORCH_COOLDOWN)).toFixed(3)})`; g.fillRect(sx, sy, T + 0.5, T + 0.5);
      }
      if (flameSprites.length) for (const fr of s.eco.fires.values()) {
        const fx = ox + (fr.x + 0.5) * T, fy = oy + (fr.y + 0.9) * T;
        if (fx < -T * 2 || fy < -T * 2 || fx > VW + T * 2 || fy > VH + T * 3 || !vis(fx, fy, T * 2)) continue;
        const k = Math.min(1, fr.age * 3, 0.35 + fr.fuel * 0.6) * (0.9 + Math.min(0.9, fr.total * 0.09)), w = T * 1.25 * k, h = w * FLAME_ASPECT;
        g.save(); g.translate(fx, fy); g.rotate(-rot);
        g.globalAlpha = 0.35; g.fillStyle = '#ff9a28'; g.beginPath(); g.ellipse(0, -T * 0.25, w * 0.9, w * 0.55, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        g.drawImage(flameSprites[Math.abs(Math.floor(anim * 9) + fr.x * 3 + fr.y * 5) % flameSprites.length], -w / 2, -h, w, h); g.restore();
      }
      drawWater(false);
      if (boltSprite.current) for (const b of s.eco.strikes) {
        if (b.age > 0.12 && Math.floor(b.age * 30) % 2 === 0) continue;
        const bx = ox + b.x * T, by = oy + b.y * T, w = T * 7, h = w * BOLT_ASPECT;
        g.save(); g.translate(bx, by); g.rotate(-rot); g.drawImage(boltSprite.current, -w * BOLT_TIP, -h, w, h); g.restore();
      }

      // the paper plane, always in the middle of the view
      // nose tips up or down while the altitude changes (layers per second -> -1..1, smoothed); in glide it is the real pitch
      const px = ox + f.x * T, py = oy + f.y * T + (glide ? -alt * 0.35 * zoom : (layer - 5.5) * 8);   // where it really is (behind the middle in 3rd person)
      if (glide) {                                                                          // its shadow falls straight below it, so height and bank show on the ground
        g.save(); g.translate(px + alt * 0.12 * zoom, oy + f.y * T); g.rotate(Math.PI / 2 - f.heading);
        const sps = ps * (1 - Math.min(0.35, alt / 300)); g.globalAlpha = Math.max(0.12, 0.34 - alt / 500); g.scale(Math.max(0.35, Math.cos(gl.phi)), 1);
        g.drawImage(shadowSprite.current!, -sps / 2, -sps / 2, sps, sps); g.restore();
      }
      for (const pf of pickFx) {   // the picked-up stick pops up, spins and fades
        const im = stickImg.current; if ((!im && !pf.stone) || pf.berry || pf.age < 0) continue;
        const u = pf.age / 0.7, e = 1 - (1 - u) * (1 - u), sz = T * (pf.stone ? 1 + 0.4 * e : 1.3 + 0.5 * e);
        if (pf.stone) { const si = stoneImg.current; if (si) { g.globalAlpha = 1 - u * u; g.drawImage(si, ox + pf.x * T - sz / 2, oy + pf.y * T - e * T * 1.2 - sz, sz, sz); } continue; }
        g.globalAlpha = 1 - u * u; g.save(); g.translate(ox + pf.x * T, oy + pf.y * T - e * T * 1.2); g.rotate(pf.a + u * 9); if (im) g.drawImage(im, -sz / 2, -sz / 2, sz, sz); g.restore();
      }
      g.globalAlpha = 1;
      for (const m of motes) {   // drifting leaves and pollen
        const im = leafImgs.current[m.kind]; if (!im) continue;
        const a = Math.min(1, m.age * 1.5, (m.life - m.age) * 0.8) * (m.kind === 2 ? 0.9 : 1), sz = T * (m.kind === 2 ? 0.34 : 0.7);
        g.globalAlpha = m.grounded > 0 ? Math.min(1, 1.5 - m.grounded) : a;
        g.save(); g.translate(ox + m.x * T, oy + m.y * T - m.h * 10 * zoom);
        if (m.kind !== 2) { g.rotate(m.rot); g.scale(1, 0.6 + 0.4 * Math.abs(Math.cos(m.age * 3 + m.ph))); }
        g.drawImage(im, -sz / 2, -sz / 2, sz, sz); g.restore();
      }
      g.globalAlpha = 1;
      if (T >= 9 && stoneImg.current) for (const st of stonesIn(s.world.seed, camX - CX / T - 1, camY - CY / T - 1, camX + (VW - CX) / T + 1, camY + (VH - CY) / T + 1)) {   // stones stand upright
        if (pickedStones.has(st.key) || s.world.terrainAt(Math.round(st.x), Math.round(st.y)) === WATER) continue;
        g.drawImage(stoneImg.current, ox + st.x * T - T * 0.45, oy + st.y * T - T * 0.9 + itemBottomPad(stoneImg.current) * T * 0.9, T * 0.9, T * 0.9);
      }
      if (T >= 9) for (const st of sticksIn(s.world.seed, camX - CX / T - 1, camY - CY / T - 1, camX + (VW - CX) / T + 1, camY + (VH - CY) / T + 1)) {   // sticks on the ground
        if (pickedSticks.has(st.key) || s.world.terrainAt(Math.round(st.x), Math.round(st.y)) === WATER) continue;
        const img2 = stickImg.current; if (!img2) continue;
        g.save(); g.translate(ox + st.x * T, oy + st.y * T); g.rotate(st.angle); g.drawImage(img2, -T * 0.65, -T * 0.65, T * 1.3, T * 1.3); g.restore();
      }
      if (T >= 9) {   // the beavers and what they built (see the 3D view for what stands in for what)
        const si = stickImg.current, sn = stoneImg.current;
        const stickAt = (x: number, y: number, a: number, k: number) => { if (!si) return; g.save(); g.translate(ox + x * T, oy + y * T); g.rotate(a); g.drawImage(si, -T * k / 2, -T * k / 2, T * k, T * k); g.restore(); };
        for (const c of s.beavers.colonies.values()) {
          if (c.bsticks < 1) { g.fillStyle = 'rgba(50,36,20,0.7)'; g.beginPath(); g.ellipse(ox + c.bx * T, oy + (c.by + 0.2) * T, T * 0.8, T * 0.55, 0, 0, Math.PI * 2); g.fill(); }   // a bare spot
          for (let i = 0; i < c.bsticks; i++) { const a = i * 0.8 + hash01(c.bx, c.by, i, 411) * 0.5; stickAt(c.bx + Math.cos(a * 2.1) * 0.25, c.by + Math.sin(a * 1.7) * 0.25, a, 1.5); }
          if (sn && isHome(c)) g.drawImage(sn, ox + c.bx * T - T * 0.45, oy + c.by * T - T * 0.7, T * 0.9, T * 0.9);
        }
        for (const d of s.beavers.damTiles()) {
          for (let i = 0; i < d.sticks; i++) stickAt(d.x + (hash01(d.x, d.y, i, 413) - 0.5) * 0.4, d.y + (hash01(d.x, d.y, i, 414) - 0.5) * 0.4, hash01(d.x, d.y, i, 412) * Math.PI, 1.5);
          if (sn) for (let i = 0; i < d.stones; i++) g.drawImage(sn, ox + (d.x + (hash01(d.x, d.y, i, 415) - 0.5) * 0.5) * T - T * 0.4, oy + d.y * T - T * 0.5, T * 0.8, T * 0.8);
        }
        if (beaverSprites.length) for (const b of s.beavers.beavers) {
          if (b.inside) continue;
          const look = beaverLook(b), im = beaverSprites[look.cell], bw = T * 1.5 * look.size, bh = bw * BEAVER_ASPECT;
          const hop = b.state === 'gnaw' ? Math.abs(Math.sin(b.timer * 12)) * 0.06 * T : look.hops && b.moving ? Math.abs(Math.sin(b.phase * 9)) * 0.12 * look.size * T : 0;
          g.save(); g.translate(ox + b.x * T, oy + b.y * T - hop); g.scale(b.face, 1); g.drawImage(im, -bw / 2, -bh, bw, bh);
          const ci = b.carry === 'stick' ? si : b.carry === 'stone' ? sn : null; if (ci) g.drawImage(ci, bw * 0.15, -bh * 0.75, T * 0.6, T * 0.6);
          g.restore();
        }
      }
      for (const q of splash) { const sz = T * 0.32; g.globalAlpha = Math.min(0.9, q.life * 1.5); g.drawImage(img, SHEET.drop[0] * TILE_PX, SHEET.drop[1] * TILE_PX, TILE_PX, TILE_PX, ox + q.x * T - sz / 2, oy + q.y * T - q.h * 8 * zoom - sz / 2, sz, sz); }   // the spray of a water skim
      g.globalAlpha = 1;
      {
        g.save();
        g.translate(px, py); g.rotate(Math.PI / 2 - f.heading);          // the sprite points up (north)
        if (!glide) { g.globalAlpha = 0.25; g.drawImage(shadowSprite.current!, -ps / 2 + 6 * zoom, -ps / 2 + 14 * zoom, ps, ps); }   // its shadow on the ground
        const len = 1 - Math.abs(tilt) * 0.3;                                  // foreshortened along its length: nose up or down, seen from above
        g.globalAlpha = 1; g.scale((1 + Math.abs(tilt) * 0.06) * (glide ? Math.max(0.4, Math.abs(Math.cos(gl.phi))) : 1), len);
        g.drawImage(img, SHEET.plane[0] * TILE_PX, SHEET.plane[1] * TILE_PX, TILE_PX, TILE_PX, -ps / 2, -ps / 2, ps, ps);
        g.restore();
      }

      // clouds above the plane drift over it, so it reads as flying between them
      if (L.decoClouds) drawDecoClouds(g, s.world.seed, f.x, f.y, 2 * CX, 2 * CY, T, zoom, anim, skyOff, li => !decoBelow(li), rot);
      drawWater(true);

      // small cumulus on top of the strong thermals: look up for them
      for (const th of thermals) {
        if (th.w < 1.6 || th.age < 0.12 || th.age > 0.92) continue;
        const sz = T * (1.3 + th.w * 0.22), co = scr(0, -(100 * 0.35 + 10) * zoom), cxp = ox + th.x * T + co[0], cyp = oy + th.y * T + co[1];
        g.globalAlpha = Math.min(0.85, (th.w - 1.4) * 0.35);
        g.save(); g.translate(cxp, cyp); g.rotate(-rot);                       // facing the screen
        if (cloudSprites.length) { const w = sz * 2.2, h = w * CLOUD_ASPECT; g.drawImage(cloudPick(Math.round(th.x * 7 + th.y * 13)), -w / 2, -h / 2, w, h); }
        g.restore();
        g.globalAlpha = 1;
      }

      // text and the dial are laid out in the stage's own frame: on the (bigger, maybe turned) canvas that is a translate and a counter-rotation
      const toStage = (x: number, y: number): [number, number] => { const ex = x - CX, ey = y - CY; return [W / 2 + ex * Math.cos(rot) - ey * Math.sin(rot), H / 2 + ex * Math.sin(rot) + ey * Math.cos(rot)]; };
      pp = toStage(px, py); pg = toStage(px + alt * 0.12 * zoom, oy + f.y * T);
      for (const hl of hoopLabels) { const [lx, ly] = toStage(hl.x, hl.y); hl.x = lx; hl.y = ly; }
      for (const pl of placeLabels) { const [lx, ly] = toStage(pl.x, pl.y); pl.x = lx; pl.y = ly; }
      }
      // night
      const dark = darkness(sunElevation(s.hour));
      if (dark > 0 && !useGL) { ctx.fillStyle = `rgba(6,10,36,${dark})`; ctx.fillRect(0, 0, VW, VH); }
      if (flashK > 0.01) { ctx.fillStyle = `rgba(225,238,255,${(flashK * 0.4).toFixed(3)})`; ctx.fillRect(0, 0, VW, VH); }   // lightning lights the whole view for a moment

      ctx.save(); ctx.translate(CX, CY); ctx.rotate(-rot); ctx.translate(-W / 2, -H / 2);
      // glide messages: stall, lift, landed, and the keys for a few seconds
      if (glide) {
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        const say = (txt: string, y: number, size: number, color: string) => {
          if (L.hideUi) return;
          ctx.font = `${size}px ${PXF}`;
          const wide = ctx.measureText(txt).width; if (wide > W - 16) ctx.font = `${Math.max(8, Math.floor((size * (W - 16)) / wide))}px ${PXF}`;   // never wider than the screen
          ctx.strokeText(txt, W / 2, y); ctx.fillStyle = color; ctx.fillText(txt, W / 2, y);
        };
        // actual height above the ground, right above the plane, with a thin line down to its shadow
        if (!gl.landed && !L.hideUi && fpvK < 0.5) {   // (not from the nose: the plane is not in view then)
          ctx.textAlign = 'center'; ctx.font = `11px ${PXF}`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          const label = `${realAlt(gl.z)} m`, ly = pp[1] - ps * 0.6; ctx.strokeText(label, pp[0], ly); ctx.fillStyle = gl.z < 10 ? '#ff8a80' : '#fff'; ctx.fillText(label, pp[0], ly);
        }
        if (gl.wet > 0.02 && (!L.hideUi || L.lookUi)) {   // soaked paper: how wet it still is (under the plane in the air, under the message on the ground)
          const wl = `${L.wetText} ${Math.max(1, Math.round(gl.wet * 100))}%`;
          if (gl.landed) say(wl, H * 0.36, 12, '#81d4fa');
          else if (fpvK < 0.5) { ctx.font = `10px ${PXF}`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(wl, pp[0], pp[1] + ps * 0.75); ctx.fillStyle = '#81d4fa'; ctx.fillText(wl, pp[0], pp[1] + ps * 0.75); }
          else say(wl, H * 0.42, 11, '#81d4fa');
        }
        if (gl.boost > 0 && !gl.landed) say(L.boostText, H * 0.37, 16, '#ffb74d');
        if (gl.landed && aim.current.on) {   // the aim: (flat view) an arrow along the way it will fly; the power shows on the Throw button
          const pw = aimPower(aim.current.t);
          if (!useGL) { const ax = Math.cos(f.heading), ay = -Math.sin(f.heading), len = 28 + 90 * pw; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pp[0], pp[1]); ctx.lineTo(pp[0] + ax * len, pp[1] + ay * len); ctx.stroke(); ctx.setLineDash([]); }
          say(L.aimText, H * 0.3, 14, '#ffd54f');
        } else if (gl.landed) say(L.landedText, H * 0.3, 16, '#fff');
        else if (mowT > 0.5) say(`${L.mowerText} +${Math.round(mowGain)}`, H * 0.3, 14, '#9ccc65');
        else if (invT > 0.5) say(`${L.invertedText} +${Math.round(invGain)}`, H * 0.3, 14, '#ce93d8');
        else if (skimT > 0.5) say(`${L.skimText} +${Math.round(skimGain)}`, H * 0.3, 14, '#4dd0e1');
        else if (gl.stalled && Math.floor(anim * 4) % 2 === 0) say(L.stallText, H * 0.3, 18, '#ff5252');
        else if (s.eco.rainAt(f.x, f.y, layer) > 0.25 && Math.floor(anim * 3) % 2 === 0) say(L.turbText, H * 0.3, 14, '#80d8ff');
        if (combo.n >= 1 && combo.t > 0 && !gl.landed) say(`${L.comboText} x${comboMult(combo).toFixed(1)}`, H * 0.14, 11, '#ff8a65');
        if (trickMsgT > 0 && !gl.landed) { ctx.globalAlpha = Math.min(1, trickMsgT); say(trickMsg, H * 0.18, 16, '#ffd54f'); ctx.globalAlpha = 1; }
        if (!gl.landed && gl.airspeed > 2) { const ge = groundEffect(gl.z); if (ge > 0.05) { ctx.globalAlpha = Math.min(1, 0.4 + ge); say(L.geText, H * 0.24, 10, '#4dd0e1'); ctx.globalAlpha = 1; } }   // ground effect: the cushion under the wing
        {   // the acro sticks: a joystick sprite where each finger landed, its knob following the finger (the left one only goes sideways)
          const R = ACRO_R;
          for (const side of ['L', 'R'] as const) {
            const el2 = acroEl.current[side]; if (!el2) continue;
            const d = L.aero && !gl.landed ? [...dual.current.values()].find(v => v.side === side) : undefined;
            if (!d) { if (el2.style.display !== 'none') el2.style.display = 'none'; continue; }
            let ox = d.x - d.x0, oy = side === 'L' ? 0 : d.y - d.y0; const m = Math.hypot(ox, oy); if (m > R) { ox = (ox / m) * R; oy = (oy / m) * R; }
            el2.style.display = 'block'; el2.style.left = `${d.x0}px`; el2.style.top = `${d.y0}px`; el2.style.setProperty('--s', `${ACRO_BASE}px`); el2.style.setProperty('--k', `${ACRO_KNOB}px`);
            (el2.lastElementChild as HTMLElement).style.transform = `translate(${ox}px, ${oy}px)`;
          }
        }
        const tsd = L.mouseFly ? null : touchStick.current;
        if ((L.mouseFly || tsd) && !gl.landed) {   // the stick, like a space game's flight reticle: a ring round its middle (the view's middle, or where the finger touched), a cursor ring on a line out to the mouse or finger
          const R = Math.min(W, H) * 0.3, cx = tsd ? tsd.x : W / 2, cy = tsd ? tsd.y : H / 2;
          let ox = mouse.current.x - cx, oy = mouse.current.y - cy; const d = Math.hypot(ox, oy); if (d > R) { ox = (ox / d) * R; oy = (oy / d) * R; }
          ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2); ctx.stroke();   // only the inner ring
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.stroke();
          if (Math.hypot(ox, oy) > R * 0.08) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ox, cy + oy); ctx.stroke(); }
          ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 14, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        if (W > 520 && H > 500 && (anim < 12 || gl.landed)) say(L.glideKeys, H * 0.22, 8, 'rgba(255,255,255,0.9)');
        ctx.restore();
      }

      // hoops passed, and a flash when one has just been flown through (the hoops' heights stay even when the controls are hidden)
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      for (const hl of hoopLabels) {                                                    // each hoop's height, right in its middle
        ctx.font = `${Math.max(8, Math.round(hl.size * 0.6))}px ${PXF}`; ctx.globalAlpha = hl.done ? 0.55 : 1;
        ctx.strokeText(hl.text, hl.x, hl.y); ctx.fillStyle = hl.done ? '#9cff8a' : '#ffd54f'; ctx.fillText(hl.text, hl.x, hl.y);
      }
      if (placeLabels.length) {                                                          // lake and fell names: nearest first, one that would sit on another is left out
        const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
        for (const pl of placeLabels.sort((a, b) => a.d - b.d)) {
          const size = Math.round(10 - 3 * pl.d); ctx.font = `${size}px ${PXF}`;
          const w = ctx.measureText(pl.text).width, r = { x0: pl.x - w / 2 - 4, y0: pl.y - size, x1: pl.x + w / 2 + 4, y1: pl.y + size };
          if (taken.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
          taken.push(r);
          ctx.globalAlpha = 1 - 0.55 * pl.d; ctx.strokeText(pl.text, pl.x, pl.y); ctx.fillStyle = pl.summit ? '#ffe082' : '#81d4fa'; ctx.fillText(pl.text, pl.x, pl.y);
        }
      }
      ctx.globalAlpha = 1;
      if (!L.hideUi) {
      ctx.font = `10px ${PXF}`; { const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`), label = `${L.hoopsText} ${hoopCount}  |  ${dist(flown)}`; ctx.strokeText(label, W / 2, 24); ctx.fillStyle = '#ffd54f'; ctx.fillText(label, W / 2, 24);
        if (bestHoops > 0 || bestFlown > 0) { ctx.font = `8px ${PXF}`; const best = `${L.bestText} ${Math.max(bestHoops, hoopCount)}  |  ${dist(Math.max(bestFlown, flown))}`; ctx.strokeText(best, W / 2, 42); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(best, W / 2, 42); } }
      if (hoopFlash > 0) { ctx.globalAlpha = Math.min(1, hoopFlash); ctx.font = `18px ${PXF}`; ctx.strokeText(L.hoopText, W / 2, H * 0.44); ctx.fillStyle = '#ffd54f'; ctx.fillText(L.hoopText, W / 2, H * 0.44); }
      }
      ctx.restore();

      // wind arrow
      if (!L.hideUi) {
      ctx.save(); ctx.translate(W - 28, 28); ctx.globalAlpha = L.wind.enabled ? 0.9 : 0.35;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();
      if (L.wind.enabled && L.wind.strength > 0.05) {
        const len = 5 + L.wind.strength * 1.1;
        ctx.rotate(-L.wind.dir + rot); ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.lineTo(len - 5, -4); ctx.moveTo(len, 0); ctx.lineTo(len - 5, 4); ctx.stroke();
      }
      ctx.restore();
      } else if (glide && !gl.landed) {                                                  // the controls are hidden: your height still shows, at the top of the screen
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.font = `14px ${PXF}`;
        const hm = `${realAlt(gl.z)} m`; ctx.strokeText(hm, W / 2, 26); ctx.fillStyle = gl.z < 10 ? '#ff8a80' : '#fff'; ctx.fillText(hm, W / 2, 26); ctx.restore();
      }
      if (glide && !gl.landed && gl.airLift > 0.4 && (L.hideUi || !L.showInst)) {   // no instruments on screen: rising air is shown on the view itself, as chevrons climbing above the plane and the climb rate at the top
        const k = Math.min(1, gl.airLift / 3);
        ctx.save(); ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
        for (let i = 0; i < 3; i++) {
          const ph = (anim * 1.4 + i / 3) % 1, y = pp[1] - ps * 0.9 - ph * (34 + 18 * k), a = Math.sin(ph * Math.PI) * (0.5 + 0.5 * k);
          ctx.globalAlpha = a; ctx.strokeStyle = '#9cff8a'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(pp[0] - 10, y + 5); ctx.lineTo(pp[0], y - 5); ctx.lineTo(pp[0] + 10, y + 5); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.font = `10px ${PXF}`;
        const lm = `+${gl.airLift.toFixed(1)} m/s`; ctx.strokeText(lm, W / 2, L.hideUi ? 48 : 26); ctx.fillStyle = '#9cff8a'; ctx.fillText(lm, W / 2, L.hideUi ? 48 : 26);
        ctx.restore();
      }

      ctx.restore();

      // paint-tool preview
      if (L.tool === 'paint' && hoverTile.current) {
        const { x, y } = hoverTile.current;
        ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 2;
        ctx.strokeRect(ox + (x - L.radius + 1) * T, oy + (y - L.radius + 1) * T, (L.radius * 2 - 1) * T, (L.radius * 2 - 1) * T);
      }

      // the arrow to the nearest rising air: relative to the nose (up = straight ahead), with the distance; gone when no lift is near or the plane is in it
      if (liftHint.current) {
        let show = false;
        if (glide && L.hints && !gl.landed) {
          liftAcc += dt;
          if (liftAcc > 0.15) { liftAcc = 0; liftBest = null; let bd = 1e9, fd = 1e9, fall: { x: number; y: number; r: number; d: number } | null = null; for (const th of thermalsIn(thermalEnv(), f.x - 90, f.y - 90, f.x + 90, f.y + 90, gl.t, 0)) { if (th.w < 0.5) continue; const d = Math.hypot(th.x - f.x, th.y - f.y); if (inCone(f, th.x, th.y) && d < bd) { bd = d; liftBest = { x: th.x, y: th.y, r: th.r, d }; } if (d < fd) { fd = d; fall = { x: th.x, y: th.y, r: th.r, d }; } } liftBest = liftBest ?? fall; }
          const b = liftBest;
          if (b) { const d = Math.hypot(b.x - f.x, b.y - f.y); if (d > b.r * 0.7) {
            show = true; const bearing = Math.atan2(-(b.y - f.y), b.x - f.x);
            liftArrow.current!.style.transform = `rotate(${(Math.atan2(Math.sin(f.course - bearing), Math.cos(f.course - bearing)) * 180) / Math.PI}deg)`; liftDist.current!.textContent = `${realDist(d)} m`;
          } }
        } else liftBest = null;
        liftHint.current.style.display = show ? 'flex' : 'none';
      }
      if (liftMsg.current) {
        const up = glide && !gl.landed && gl.airLift > 0.4;
        if (up) liftMsg.current.textContent = `+${gl.airLift.toFixed(1)} m/s`;
        liftMsg.current.style.display = up ? 'block' : 'none';
      }
      if (hoopHint.current) {                                                            // the arrow to the nearest hoop still to fly (any flight mode)
        hoopAcc += dt;
        if (hoopAcc > 0.3) { hoopAcc = 0; hoopBest = null; let bd = 1e9, fd = 1e9, fall: { x: number; y: number; d: number } | null = null; for (const hp of hoopsIn(s.world.seed, f.x - 150, f.y - 150, f.x + 150, f.y + 150)) { if (hoopsDone.has(hp.key)) continue; const d = Math.hypot(hp.x - f.x, hp.y - f.y); if (inCone(f, hp.x, hp.y) && d < bd) { bd = d; hoopBest = { x: hp.x, y: hp.y, d }; } if (d < fd) { fd = d; fall = { x: hp.x, y: hp.y, d }; } } hoopBest = hoopBest ?? fall; }
        const hb = hoopBest, ok = !!hb && !(glide && gl.landed);
        if (ok) { const bearing = Math.atan2(-(hb!.y - f.y), hb!.x - f.x), d = Math.hypot(hb!.x - f.x, hb!.y - f.y); hoopArrow.current!.style.transform = `rotate(${(Math.atan2(Math.sin(f.course - bearing), Math.cos(f.course - bearing)) * 180) / Math.PI}deg)`; hoopDist.current!.textContent = `${realDist(d)} m`; }
        hoopHint.current.style.display = ok ? 'flex' : 'none';
      }
      { const D = dog.current, on = !!D && D.phase !== 'over' && f.mode === 'glide' && !gl.landed;   // dogfight: the arrow to the other plane, the role, the tally and the lock
        if (dogHint.current) {
          if (on && D) { const a = D.ai, ay = -a.y, bearing = Math.atan2(-(ay - f.y), a.x - f.x), d = Math.hypot(a.x - f.x, ay - f.y); dogArrow.current!.style.transform = `rotate(${(Math.atan2(Math.sin(f.course - bearing), Math.cos(f.course - bearing)) * 180) / Math.PI}deg)`; dogDist.current!.textContent = `${realDist(d)} m`; }
          dogHint.current.style.display = on ? 'flex' : 'none';
        }
        if (dogHud.current) {
          if (on && D) { const tx = dogTxt.current, txt = `${D.role === 'chase' ? tx.chase : tx.flee}  ${D.tally.you}-${D.tally.ai}  ${Math.round(D.score)}${D.lock > 0 ? `  ${tx.lock} ${Math.min(100, Math.round(D.lock / (D.role === 'chase' ? 1 : 1.4) * 100))}%` : ''}`; if (dogHud.current.textContent !== txt) dogHud.current.textContent = txt; dogHud.current.dataset.role = D.role; }
          dogHud.current.style.display = on ? 'block' : 'none';
        }
      }
      // HUD numbers 4x a second, the minimap when we moved or the world changed (on a frame that built or uploaded no chunk, unless it has waited a second)
      hudAcc += dt; miniAcc += dt; saveAcc += dt;
      if (hudAcc >= 0.25) {
        hudAcc = 0;
        hudRef.current = { landed: glide && gl.landed, ms: workN ? Math.round((workMs / workN) * 10) / 10 : 0, hour: s.hour, temp: s.eco.temperature, weather: s.eco.weather?.kind ?? null, x: Math.round(f.x), y: Math.round(f.y), layer: Math.round(layer * 10) / 10, clouds: s.eco.clouds.length, water: s.eco.waterTiles, fps, biome: s.world.biomeOf(Math.round(f.x), Math.round(f.y)).id };
        workMs = 0; workN = 0;
      }
      if (mini.current && (miniAcc > 1 || built === 0 && (!useGL || !glr || glr.lastMade === 0)) && (miniDirty.current || miniAcc > 0.15 && Math.abs(Math.atan2(Math.sin(f.course - lastMiniH), Math.cos(f.course - lastMiniH))) > 0.12 || miniAcc > 0.4 && (Math.hypot(f.x - lastMini.x, f.y - lastMini.y) >= 4 || miniAcc > 2))) {   // at most 2.5 times a second
         miniDirty.current = false; miniAcc = 0; lastMini = { x: f.x, y: f.y }; lastMiniH = f.course; {
          const span = 52 * L.miniScale, marks: MiniMark[] = [];   // the hoops (gold, green once flown) and, in the glider, the thermals (hot air, orange) that are on the little map
          if (L.miniHoops) for (const hp of hoopsIn(s.world.seed, f.x - span, f.y - span, f.x + span, f.y + span)) marks.push({ x: hp.x, y: hp.y, kind: hoopsDone.has(hp.key) ? 'done' : 'hoop', r: hp.r });
          if (glide && L.hints && L.miniHeat) for (const th of thermalsIn(thermalEnv(), f.x - span, f.y - span, f.x + span, f.y + span, gl.t, 0)) if (th.w > 0.3) marks.push({ x: th.x, y: th.y, kind: 'heat', r: th.r });
          const m0 = performance.now(); if (drawMinimap(mini.current, miniCache, s.world, s.explored, f, cx0, cx1, cy0, cy1, L.miniScale, marks)) miniDirty.current = true;   // (true: some chunks were left for the next draw)
          if (perf.on) { perf.f.mini = performance.now() - m0; perf.mini = Math.max(perf.mini, perf.f.mini); } }
        }
      mark('overlay');
      { const fl = f.mode === 'glide' && !gl.landed; if (fl !== flyHeld) { flyHeld = fl; holdSync(fl); if (!fl && saveAcc >= 10) saveAcc = 45; } }   // (in flight the cloud sync waits and the periodic save is put off: both come when the plane lands)
      if (saveAcc >= 45 && !flyHeld) { saveAcc = 0; const p0 = performance.now(); persist(); if (perf.on) { perf.persist = Math.max(perf.persist, performance.now() - p0); perf.f.persist = performance.now() - p0; } }
      if (perf.on) {
        perf.work = Math.max(perf.work, performance.now() - w0); perf.f.work = performance.now() - w0;
        if (now - perf.since > 2000) {   // the readout, a few short lines (worst values of the last 2 s)
          const hp = ((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576; if (perfStat.heap - hp > 2) perfStat.gcN++; perfStat.heap = hp;
          const avg = Object.entries(perf.ph).map(([k, v]) => `${k} ${(v / Math.max(1, perf.n)).toFixed(1)}`);
          perf.txt = [
            `gap ${perf.gap.toFixed(0)}  work ${perf.work.toFixed(0)}  gpu ${perf.gpu.toFixed(0)}`,
            `chunks ${perf.build.toFixed(0)}ms/${perf.builtN}  ground ${perf.ground.toFixed(0)}  mk ${(glr?.madeMs ?? 0).toFixed(0)}/${glr?.madeN ?? 0}  save ${perf.persist.toFixed(0)}  mini ${perf.mini.toFixed(1)}`,
            `chunks held ${chunks.current.size} (~${(chunks.current.size / 4).toFixed(0)}MB)  gl tex ${glr?.texCount ?? 0} (~${((glr?.texCount ?? 0) * 0.35).toFixed(0)}MB)`,
            `instrument ${((window as unknown as { __instMs?: number }).__instMs ?? 0).toFixed(1)}ms (own 30 Hz loop)`,
            `react ${perfStat.r}/${perfStat.rMax.toFixed(0)}  long ${perfStat.lt}/${perfStat.ltMax.toFixed(0)}  heap ${hp.toFixed(0)} gc ${perfStat.gcN}`,
            `why ${perfStat.why}`,
            `avg ms/frame:`,
            avg.slice(0, 3).join('  '), avg.slice(3, 6).join('  '), avg.slice(6, 9).join('  '), avg.slice(9).join('  '),
          ].filter(Boolean).join('\n');
          (window as unknown as { __instMs?: number }).__instMs = 0;
          perfStat.why = ''; perfStat.r = perfStat.rMax = perfStat.lt = perfStat.ltMax = perfStat.gcN = 0; perf.ph = {}; perf.n = 0; perf.since = now;
          perf.gap = perf.work = perf.build = perf.persist = perf.ground = perf.gpu = perf.mini = 0; perf.builtN = 0; if (glr) { glr.madeMs = 0; glr.madeN = 0; glr.oneMs = 0; }
        }
        (window as unknown as { __perfTxt?: string }).__perfTxt = perf.txt;
        ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = `8px ${PXF}`; ctx.fillStyle = '#0009'; const lines = [...perf.txt.split('\n'), ...perf.hitches.map(h => '! ' + h)]; ctx.fillRect(4, H / 2 - 12, Math.min(W - 8, 400), 14 + lines.length * 11); ctx.fillStyle = '#fff'; lines.forEach((ln, i) => ctx.fillText(ln, 8, H / 2 + i * 11)); ctx.restore();
      }
      workMs += performance.now() - w0; workN++;
    };

    let savedExplored = -1;   // (the explored list is big: it is only written, and so only synced to the cloud, when it grew)
    const persist = () => {
      const f = s.flight;
      const grew = s.explored.size !== savedExplored; savedExplored = s.explored.size; actions.saveWorld(id, { boosts: s.glider.boostCharges, changes: encodeChanges(s.world.changes), hour: s.hour, wind: { ...s.eco.wind }, plane: { x: f.x, y: f.y, heading: f.heading, pitch: f.pitch, ...(s.glider.landed ? { landed: true } : {}) }, ...(grew ? { explored: [...s.explored].slice(0, 20000) } : {}), beavers: s.beavers.toSaved(), berries: s.berries.toSaved() });
    };
    raf = requestAnimationFrame(frame);
    const onHide = () => persist();
    addEventListener('pagehide', onHide);
    const eng = createAudioEngine(); audio.current = eng;   // the browser only lets sound start after a key or a touch
    const unlock = () => eng?.unlock();
    const blip = (e: Event) => { if (e.target instanceof Element && e.target.closest('button')) eng?.play('blip'); };   // every button in the world screen clicks
    addEventListener('keydown', unlock); addEventListener('pointerdown', unlock); addEventListener('click', blip);
    return () => { holdSync(false); removeEventListener('keydown', unlock); removeEventListener('pointerdown', unlock); removeEventListener('click', blip); eng?.dispose(); audio.current = null; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('resize', fit); removeEventListener('pagehide', onHide); persist(); };
  }, [ready, id]);

  // paint tool
  const hoverTile = useRef<{ x: number; y: number } | null>(null);
  const painting = useRef(false);
  const tileUnder = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect(), c = camPos.current, T = TILE_PX * camZoomNow.current.chase * altZoom.current;
    return { x: Math.floor((e.clientX - r.left - r.width / 2) / T + c.x), y: Math.floor((e.clientY - r.top - r.height / 2) / T + c.y) };
  };
  const paintAt = (x: number, y: number) => {
    const { brush: b, radius: rad } = live.current, s = sim.current!;
    for (let j = -(rad - 1); j <= rad - 1; j++) for (let i = -(rad - 1); i <= rad - 1; i++) if (s.world.terrainAt(x + i, y + j) !== b) s.eco.paint(x + i, y + j, b);
  };
  const onStageDown = (e: RPointerEvent) => { if (live.current.tool !== 'paint') return; painting.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const p = tileUnder(e); hoverTile.current = p; paintAt(p.x, p.y); };
  const onStageMove = (e: RPointerEvent) => { if (live.current.tool !== 'paint') return; const p = tileUnder(e); hoverTile.current = p; if (painting.current) paintAt(p.x, p.y); };
  const onStageUp = () => { painting.current = false; };

  // joystick
  const joy = useRef<HTMLDivElement>(null);
  const joyActive = useRef(false);
  const moveStick = (e: RPointerEvent) => {
    const r = joy.current!.getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - r.left - R) / (R * 0.8), dy = (e.clientY - r.top - R) / (R * 0.8);
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    stick.current = { dx, dy }; setKnob({ x: dx, y: dy });
  };
  const windActive = useRef(false);
  const lastWindTap = useRef(0);
  const windDial = useRef<HTMLDivElement>(null);
  /** Dragging the dial: the angle is the wind direction, the distance from the centre is its strength (0..10). */
  const setWindFromPointer = (e: RPointerEvent) => {
    const r = windDial.current!.getBoundingClientRect(), R = r.width / 2;
    const dx = e.clientX - r.left - R, dy = e.clientY - r.top - R, m = Math.hypot(dx, dy) / R;
    const strength = m > 1.05 ? 10 : Math.min(9, Math.round(Math.min(m, 1) * 18) / 2);   // 10 only by sliding out past the rim
    setWindAuto(false); setWind(w => ({ ...w, enabled: strength > 0, strength, dir: strength > 0 ? Math.atan2(-dy, dx) : w.dir }));
  };
  const releaseStick = () => { joyActive.current = false; stick.current = { dx: 0, dy: 0 }; setKnob({ x: 0, y: 0 }); };

  const layer = currentLayer({ ...sim.current!.flight, mode, pitch });
  const MODES: [FlightMode, Key][] = [['glide', 'worldGlide'], ['manual', 'worldManual'], ['off', 'worldOff']];
  const compass = (deg: number) => ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  const windLetter = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][Math.round((((wind.dir * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8];
  const windHue = wind.enabled ? Math.round(200 - wind.strength * 22) : 210;   // calm blue -> green -> yellow -> orange -> pink at full strength
  const windDeg = Math.round(((wind.dir * 180 / Math.PI) % 360 + 360) % 360);

  /** The Lightning button: a bolt comes down a few tiles ahead of the plane, on the best fuel it can find there (a tree if there is one), from the nearest cloud. */
  const ecoOf = useRef(() => sim.current?.eco ?? null).current;   // (stable, so the stats window does not restart its reader on every render)
  const strikeNow = () => {
    const s = sim.current; if (!s) return;
    const f = s.flight, hx = Math.cos(f.heading), hy = -Math.sin(f.heading);
    let bx = Math.floor(f.x + hx * 6), by = Math.floor(f.y + hy * 6), bv = -1;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(f.x + hx * 7 + (Math.random() - 0.5) * 10), y = Math.floor(f.y + hy * 7 + (Math.random() - 0.5) * 10), v = flammability(s.world.stateAt(x, y)) + Math.random() * 0.1;
      if (v > bv) { bv = v; bx = x; by = y; }
    }
    let from: (typeof s.eco.clouds)[number] | undefined, bd = 15;
    for (const c of s.eco.clouds) { const d = Math.hypot(c.x - bx, c.y - by); if (d < bd) { bd = d; from = c; } }
    s.eco.strike(bx + 0.5, by + 0.5, from, true);
  };
  const pickBrush = (tt: Terrain) => {
    if (tool === 'paint' && brush === tt) setRadius(r => (r >= 4 ? 1 : r + 1));   // tapping the chosen tile again grows the brush
    setBrush(tt); setTool('paint');
  };
  const TILE_CELL: Record<Terrain, readonly [number, number]> = { 0: SHEET.water, 1: SHEET.sand, 2: SHEET.grass };

  const perfWhy = useRef<Record<string, unknown>>({});   // (?perf: which state made this screen render again)
  useEffect(() => {
    if (!/perf/.test(location.href)) return;
    const now: Record<string, unknown> = { scores, coins, act, pickToast, up, mode, trimPitch, trimRoll, trimYaw, pitch, wind, zoomPos, onFoot, fullUi, burnPop, runResult, paused, camMode, hideUi, instSize, shopOpen, miniScale };
    const ch = Object.keys(now).filter(k => perfWhy.current[k] !== undefined && perfWhy.current[k] !== now[k]);
    perfWhy.current = now; if (ch.length) perfStat.why = [...new Set([...perfStat.why.split(','), ...ch])].filter(Boolean).join(',');
  });
  return (
    <div ref={root} onDragStart={e => e.preventDefault()} className={`screen world ${panelOpen ? 'open' : ''} ${hideUi || lookUi ? 'hideui' : ''} ${lookUi ? 'lookui' : ''}`} style={{ '--sheet-img': `url(${SHEET_URL})`, '--mz': miniSize } as CSSProperties}>
      <div ref={stage} className={`world-stage ${tool === 'paint' ? 'paint' : ''}`} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}>
        <canvas ref={glCanvas} className="world-gl" aria-hidden="true" style={{ display: 'none' }} />
        <canvas ref={canvas} role="img" aria-label={t('world')} />
        {(['L', 'R'] as const).map(side => (
          <div key={side} ref={el2 => { acroEl.current[side] = el2; }} className="acro-stick" style={{ display: 'none' }} aria-hidden="true">
            <img className="world-joybase" src={rawUrl('joystick_base')} alt="" draggable={false} />
            <img className="world-knob" src={rawUrl('joystick_knob')} alt="" draggable={false} />
          </div>
        ))}
        {!ready && <div className="world-msg">{failed ? t('worldLoadFail') : '...'}</div>}
      </div>

      {(act.beaver || act.bush || act.dam.stick || act.dam.stone || act.dam.brk) && (
        <ActPanel act={act} sticks={stickRef.current} stones={stoneRef.current} berries={berryRef.current} primary={primaryAct(act)} onGive={giveToDam} onBreak={breakDam} onPick={pickBush} onFeed={feedBeaver} t={t} />
      )}
      {pickToast && <PickToast key={pickToast.at} item={pickToast.item} from={pickToast.from} to={pickToast.to} onDone={() => setPickToast(p => (p && p.at === pickToast.at ? null : p))} />}

      {/* the eye: hides every control, label and instrument so only the view is left; tap again to bring them back */}
      <div className="wui wui-hide"><PixelFrame as="button" theme="bronze" scale={1} className="wui-btn" aria-pressed={hideUi} aria-label={t('worldHideUi')} title={t('worldHideUi')} onClick={() => (lookUi ? setFullUi(true) : onFoot && fullUi ? setFullUi(false) : setHideUi(v => !v))}><Icon name="symbol_eye" size={24} alt="" /></PixelFrame>
        {mode === 'glide' && !onFoot && <PixelFrame as="button" theme="bronze" scale={1} className="wui-btn wui-lookbtn" aria-pressed={camMode !== 'chase'} aria-label={t('worldCamTip')} title={t('worldCamTip')} onClick={cycleCam}><span>{t(camMode === 'chase' ? 'worldCamChase' : camMode === 'free' ? 'worldCamFree' : camMode === 'duel' ? 'worldCamDuel' : 'worldCamFlyby')}</span></PixelFrame>}
        <div className="wui-camsl">
          <div className="wui-zoom" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); zoomDrag(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) zoomDrag(e); }}><PixelSlider color="red" min={0} max={1} step={0.005} value={zoomPos} label={t('worldCamZoom')} onChange={setZoomTo} /></div>
          {mode === 'glide' && !onFoot && camMode !== 'flyby' && <div className="wui-zoom wui-tiltsl" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); tiltDrag(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) tiltDrag(e); }}><PixelSlider color="green" min={0} max={1} step={0.005} value={Math.max(0, Math.min(1, tiltPos))} label={t('worldTilt')} onChange={setTiltTo} /></div>}
        </div></div>

      {/* top left: close */}
      <div className={`wui wui-tl ${lookUi ? 'wui-keep' : ''}`}>
        <div className="wui-row">
          <PixelButton size="compact" scale={1} variant="red" className="wui-exit" aria-label={t('worldClose')} onClick={() => navigate(worldExitPath())}><Icon name={lookUi ? 'home' : 'symbol_cross'} size={24} alt="" /></PixelButton>   {/* (on foot it is the home button, the one thing kept of the top left) */}
        </div>
      </div>

      {/* under the close button: the settings menu and the zoom */}
      <div className="wui wui-tl2">
        <div className="wui-row">
          <PixelFrame as="button" theme="bronze" scale={1} className="wui-round" aria-label={t('worldControls')} aria-pressed={panelOpen} onClick={() => setPanelOpen(o => !o)}><span /><span /><span /></PixelFrame>
        </div>
      </div>

      {/* top right: minimap in a wooden frame, temperature, menu */}
      <div className="wui wui-tr" style={{ transform: `scale(${mapUiSize / 100})`, transformOrigin: 'top right' }}>
        <PixelFrame theme="wood_steel" scale={1} className="wui-mapframe" style={{ '--mz': miniSize } as CSSProperties}>
          <div className="wui-mapbox">
            <canvas ref={mini} className="world-mini" width={100} height={100} aria-label={t('worldMap')} role="img"
              onPointerUp={e => { const n = e.timeStamp; if (n - lastTap.current < 320) { lastTap.current = 0; setMiniSize(v => (v >= 3 ? 2 : 3)); } else lastTap.current = n; }} />
            <div className="wui-minizoom">
              <PixelFrame as="button" theme="green_ornate" scale={1} className="wui-mini" aria-label={t('worldMapZoomIn')} onClick={() => setMiniScale(v => Math.max(1, v / 2))}><Icon name="symbol_plus" size={16} alt="" /></PixelFrame>
              <PixelFrame as="button" theme="green_ornate" scale={1} className="wui-mini" aria-label={t('worldMapZoomOut')} onClick={() => setMiniScale(v => Math.min(16, v * 2))}><Icon name="symbol_minus" size={16} alt="" /></PixelFrame>
            </div>
          </div>
            <PixelFrame as={initial.kind === 'lakedistrict' ? 'button' : undefined} theme="green_ornate" scale={1} className="wui-banner wui-mapbanner" onClick={initial.kind === 'lakedistrict' ? () => setWatersOpen(v => !v) : undefined}><span className="wui-ellip"><HudText hud={hudRef} pick={h => initial.kind === 'lakedistrict' ? placeText(h.x, h.y, t).toUpperCase() : t(`worldBiome_${h.biome || 'grassland'}` as Key).toUpperCase()} /></span></PixelFrame>
            {watersOpen && initial.kind === 'lakedistrict' && root.current && createPortal(<WatersList hud={hudRef} t={t} onClose={() => setWatersOpen(false)} />, root.current)}
            <div ref={windDial} className="wui-dial" role="slider" aria-label={t('worldWind')} aria-valuemin={0} aria-valuemax={10} aria-valuenow={wind.strength} aria-valuetext={`${windLetter} ${wind.strength}`}
              style={{ '--dir': `${-wind.dir}rad`, '--h': windHue, '--base': `url(${rawUrl('joystick_base')})` } as CSSProperties} data-on={wind.enabled && wind.strength > 0}
              onPointerDown={e => {
                if (e.timeStamp - lastWindTap.current < 320) { lastWindTap.current = 0; windActive.current = false; setWindAuto(false); setWind(w => ({ ...w, enabled: false, strength: 0 })); return; }   // double tap: no wind
                lastWindTap.current = e.timeStamp; windActive.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setWindFromPointer(e);
              }}
              onPointerMove={e => { if (windActive.current) setWindFromPointer(e); }} onPointerUp={() => { windActive.current = false; }} onPointerCancel={() => { windActive.current = false; }}>
              <i className="wui-dialleaf" />
              <span className="wui-dialdisc"><b>{windLetter}</b><em>{wind.enabled ? wind.strength : 0}</em></span>
            </div>
          <PixelFrame theme="bronze" scale={1} className="wui-temp"><span className="wui-temptxt"><span><HudText hud={hudRef} pick={h => clockText(h.hour)} /></span><span><HudText hud={hudRef} pick={h => `${Math.round(h.temp)}°`} /></span></span></PixelFrame>
        </PixelFrame>
      </div>

      {/* bottom left: the menu with the sky clouds, zoom out and draw buttons beside it, the fps box; the tile buttons above while drawing */}
      <div className="wui wui-bl">
        {tool === 'paint' && (
          <div className="wui-row wui-tools">
            {([WATER, SAND, GRASS] as Terrain[]).map(tt => (
              <PixelFrame key={tt} as="button" theme={tool === 'paint' && brush === tt ? 'green_ornate' : 'bronze'} scale={1} className="wui-btn wui-tile" aria-pressed={tool === 'paint' && brush === tt}
                aria-label={`${t(tt === WATER ? 'worldWater' : tt === SAND ? 'worldSand' : 'worldGrass')} ${radius}`} onClick={() => pickBrush(tt)}
                style={{ '--cx': TILE_CELL[tt][0], '--cy': TILE_CELL[tt][1], '--sheet': `url(${SHEET_URL})` } as CSSProperties}><i /><b>{radius}</b></PixelFrame>
            ))}
          </div>
        )}
        <div className="wui-row">
        {showFps && <PixelFrame theme="green_ornate" scale={1} className="wui-count" aria-label={t('worldFps')}><HudText hud={hudRef} pick={h => String(h.fps)} /></PixelFrame>}
        </div>
      </div>

      {/* bottom middle: flight mode and the joystick */}
      <div className="wui wui-bm">
        <div className="wui-modebar">
          {mode === 'glide' && !onFoot && !showInst && <BoostButton cls="wui-boostrow" label={t('worldBoost')} cooldown={() => (sim.current ? sim.current.glider.boostCd / BOOST_COOLDOWN : 0)} charges={() => sim.current?.glider.boostCharges ?? 0} onBoost={x => throwRef.current(x)} />}
        </div>
        {mode === 'glide' && !onFoot ? (showInst && (   // (the instrument is for flying: on foot the joystick takes its place)
          <div className="world-instwrap" style={{ '--is': instSize / 100 } as CSSProperties}>
            <div ref={liftMsg} className="world-liftmsg" style={{ display: 'none' }} />
            <FlightInstruments data={inst} label={t('worldInstruments')} />
            {!lookFly && <PatternButton cls="wui-pattern" label={t('worldPattern')} name={() => pats.patterns[pats.sel]?.name ?? ''} running={() => man.current !== null} onPress={() => patternRef.current()} />}
            {!lookFly && <PatternButton cls="wui-sas" label={t('worldSas')} hint="T" icon="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" name={() => sasRef.current.mode} running={() => sasRef.current.mode !== 'off'} onPress={() => cycleSasRef.current()} />}
            {!lookFly && <PixelFrame as="button" theme={aero ? 'red_thick' : 'bronze'} scale={1} className="wui-acro" style={{ '--bw': 5 } as CSSProperties} aria-pressed={aero} aria-label={t('worldAero')} title={t('worldAero')} onClick={() => setAero(v => !v)}><span>ACRO</span></PixelFrame>}
            {!lookFly && <BoostButton cls="wui-boostrow wui-boostside" label={t('worldBoost')} cooldown={() => (sim.current ? sim.current.glider.boostCd / BOOST_COOLDOWN : 0)} charges={() => sim.current?.glider.boostCharges ?? 0} onBoost={x => throwRef.current(x)} />}
            <button type="button" className="world-mousebtn" aria-label={t('worldMouseFly')} title={t('worldMouseFly')}
              onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.setPointerCapture(e.pointerId); instStick.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2, x: e.clientX, y: e.clientY, id: e.pointerId }; }}
              onPointerMove={e => { const st = instStick.current; if (st && st.id === e.pointerId) { st.x = e.clientX; st.y = e.clientY; } }}
              onPointerUp={e => { if (instStick.current?.id === e.pointerId) instStick.current = null; }} onPointerCancel={e => { if (instStick.current?.id === e.pointerId) instStick.current = null; }} />
          </div>
        )) : !lookUi && (
        <div ref={joy} className="world-joy" role="group" aria-label={t('worldJoystick')}
          onPointerDown={e => { joyActive.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); moveStick(e); }}
          onPointerMove={e => { if (joyActive.current) moveStick(e); }} onPointerUp={releaseStick} onPointerCancel={releaseStick}>
          <img className="world-joybase" src={rawUrl('joystick_base')} alt="" draggable={false} />
          <img ref={knobEl} className="world-knob" src={rawUrl('joystick_knob')} alt="" draggable={false} />
        </div>
        )}
      </div>

      {/* the free view: dragging the picture turns the camera, so the plane is flown with two joysticks: left yaw, right pitch and roll, with ACRO and the boost above them */}
      {mode === 'glide' && !onFoot && lookFly && (
        <div className="wui world-fjoys">
          <div className="world-fjbtns">
            <PatternButton cls="world-fjpattern" label={t('worldPattern')} name={() => pats.patterns[pats.sel]?.name ?? ''} running={() => man.current !== null} onPress={() => patternRef.current()} />
            <PatternButton cls="world-fjpattern" label={t('worldSas')} hint="T" icon="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" name={() => sasRef.current.mode} running={() => sasRef.current.mode !== 'off'} onPress={() => cycleSasRef.current()} />
            <PixelFrame as="button" theme={aero ? 'red_thick' : 'bronze'} scale={1} className="wui-acro world-fjacro" style={{ '--bw': 5 } as CSSProperties} aria-pressed={aero} aria-label={t('worldAero')} title={t('worldAero')} onClick={() => setAero(v => !v)}><span>ACRO</span></PixelFrame>
            <BoostButton cls="world-fjboost" label={t('worldBoost')} cooldown={() => (sim.current ? sim.current.glider.boostCd / BOOST_COOLDOWN : 0)} charges={() => sim.current?.glider.boostCharges ?? 0} onBoost={x => throwRef.current(x)} />
          </div>
          <div className="world-fjrow">
            <LookStick stick={yawStick} bare label={t('worldYaw')} />
            <LookStick stick={stick} bare label={t('worldJoystick')} />
          </div>
        </div>
      )}
      {/* glide: the throw button after landing (the instruments replace the stick above) and the throw button after landing */}
      {mode === 'glide' && !onFoot && <BoostButton cls="wui wui-boost" label={t('worldBoost')} cooldown={() => (sim.current ? sim.current.glider.boostCd / BOOST_COOLDOWN : 0)} charges={() => sim.current?.glider.boostCharges ?? 0} onBoost={x => throwRef.current(x)} />}
      <div ref={hoopHint} className="wui wui-hint wui-hint-hoop" style={{ display: 'none' }} aria-label={t('worldHoops')}>
        <img ref={hoopArrow} src={rawUrl('arrow_stone_up')} alt="" draggable={false} /><span ref={hoopDist} />
      </div>
      {mode === 'glide' && (
        <div ref={liftHint} className="wui wui-hint wui-hint-lift" style={{ display: 'none' }} aria-label={t('worldLiftHint')}>
          <img ref={liftArrow} src={rawUrl('arrow_stone_up')} alt="" draggable={false} /><span ref={liftDist} />
        </div>
      )}
      {burnPop && <BurnPopup key={burnPop.key} n={burnPop.n} onRespawn={() => { respawnReq.current = true; setBurnPop(null); setPaused(false); }} t={t} />}
      <div ref={dogHint} className="wui wui-hint wui-hint-dog" style={{ display: 'none' }} aria-label={t('worldDogfight')}>
        <img ref={dogArrow} src={rawUrl('arrow_stone_up')} alt="" draggable={false} /><span ref={dogDist} />
      </div>
      <div ref={dogHud} className="wui wui-doghud" style={{ display: 'none' }} role="status" />
      <div ref={dogMsgEl} className="wui wui-dogmsg" style={{ display: 'none' }} role="status" />
      {dogShot && <ShotMinigame key={dogShot.key} specs={dogShot.specs} getT={() => dog.current?.shot?.t ?? 0} getQ={() => dog.current?.shot?.q ?? 0} onTap={() => { dogTap(); }} label={t('worldDogTap')} />}
      {runResult && <RunPopup key={runResult.key} run={runResult} onClose={() => setRunResult(null)} onShop={() => { setRunResult(null); setShopOpen(true); }} t={t} />}
      {mode === 'glide' && <PreflightShop hud={hudRef} aiming={() => aim.current.on} open={shopOpen} onClose={() => setShopOpen(false)} coins={coins} boosts={() => sim.current?.glider.boostCharges ?? 0} up={up} onBuyBoost={buyBoost} onBuy={buyItem} t={t} />}
      {mode === 'glide' && <ThrowButton hud={hudRef} label={t('worldThrow')} shopLabel={t('worldShop')} looking={lookUi} trail={<LookStick stick={lookStick} label={t('worldLook')} />} lead={(
        <div ref={joy} className="world-joy world-joy-look" role="group" aria-label={t('worldJoystick')}
          onPointerDown={e => { joyActive.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); moveStick(e); }}
          onPointerMove={e => { if (joyActive.current) moveStick(e); }} onPointerUp={releaseStick} onPointerCancel={releaseStick}>
          <img className="world-joybase" src={rawUrl('joystick_base')} alt="" draggable={false} />
          <img ref={knobEl} className="world-knob" data-travel="20" src={rawUrl('joystick_knob')} alt="" draggable={false} />
        </div>)} hidden={shopOpen} power={() => (aim.current.on ? Math.max(launchMinPower(upRef.current.launch), aimPower(aim.current.t)) : null)} onPress={x => startAim(x)} onShop={() => setShopOpen(true)} />}

      {showEco && <EcoStats eco={ecoOf} beavers={() => sim.current?.beavers ?? null} onClose={() => setShowEco(false)} t={t} />}

      {/* the menu: everything else */}
      {panelOpen && (
        <PixelFrame theme="bevelled_stone_and_gold_pixel_frame" scale={1} className="world-sheet" role="dialog" aria-label={t('worldControls')}>
          <div className="world-sheet-head row between"><h2 className="subtitle">{t('worldControls')}</h2><span className="row"><PixelButton size="compact" scale={1} variant={showInfo ? 'green' : 'red'} aria-pressed={showInfo} aria-label={t('worldInfo')} title={t('worldInfo')} onClick={() => setShowInfo(v => !v)}>i</PixelButton><PixelButton size="compact" scale={1} variant="red" onClick={() => setPanelOpen(false)}>{t('worldClose')}</PixelButton></span></div>
          <div className="world-sheet-scroll">
            {/* always wanted: the screen, the clock, the sound */}
            <div className="row world-tools">
            <PixelButton size="compact" scale={1} variant={full ? 'green' : 'red'} aria-pressed={full} onClick={toggleFull}>{full ? t('worldExitFull') : t('worldFullscreen')}</PixelButton>
            <PixelButton size="compact" scale={1} variant={autoFull ? 'green' : 'red'} aria-pressed={autoFull} title={t('fullscreenOnHint')} onClick={() => actions.setSettings({ fullscreen: !autoFull })}>{t('worldAutoFull')}</PixelButton>
            <PixelButton size="compact" scale={1} variant={paused ? 'green' : 'red'} aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? t('worldResume') : t('worldPause')}</PixelButton>
            <PixelButton size="compact" scale={1} variant={muted || volume === 0 ? 'red' : 'green'} aria-pressed={!muted && volume > 0} onClick={() => setMuted(v => !v)}>{t(muted || volume === 0 ? 'worldSoundOff' : 'worldSound')}</PixelButton>
            </div>
          <div className="world-panels">
            <Sec id="flight" title={t('worldFlight')} open={!!secs["flight"]} onToggle={toggleSec}>
              <div className="row">{MODES.map(([m, label]) => <PixelButton key={m} size="compact" scale={1} variant={mode === m ? 'green' : 'red'} aria-pressed={mode === m} onClick={() => setMode(m)}>{t(label)}</PixelButton>)}</div>
              <div className="row world-tools">
                <PixelButton size="compact" scale={1} variant={aero ? 'green' : 'red'} aria-pressed={aero} title={t('worldAero')} onClick={() => setAero(v => !v)}>ACRO</PixelButton>
                <PixelButton size="compact" scale={1} variant={dogOn ? 'green' : 'red'} aria-pressed={dogOn} title={t('worldDogfight')} onClick={() => dogToggle()}>TAG (G)</PixelButton>
                <PixelButton size="compact" scale={1} variant={invertPitch ? 'green' : 'red'} aria-pressed={invertPitch} onClick={() => setInvertPitch(v => !v)}>{t('worldInvert')}</PixelButton>
              </div>
              {showInfo && <div className="muted small">{t('worldGlideHelp')}</div>}
              {showInfo && <div className="muted small">{t('worldHelp')}</div>}
            </Sec>
            <Sec id="patterns" title={t('worldPatterns')} open={!!secs["patterns"]} onToggle={toggleSec}>
              <PatternEditor store={pats} set={f => setPats(s => stamped(f(s)))} t={t} armed={armed} onArm={() => setArmed(v => !v)} onFire={firePattern} editOpen={!!secs["patedit"]} onToggleEdit={toggleSec} />
            </Sec>
            <Sec id="camera" title={t('worldSecCamera')} open={!!secs["camera"]} onToggle={toggleSec}>
              <div className="row">{(['chase', 'free', 'flyby', 'duel'] as const).map(m => <PixelButton key={m} size="compact" scale={1} variant={camMode === m ? 'green' : 'red'} aria-pressed={camMode === m} onClick={() => setCamMode(m)}>{t(m === 'chase' ? 'worldCamChase' : m === 'free' ? 'worldCamFree' : m === 'duel' ? 'worldCamDuel' : 'worldCamFlyby')}</PixelButton>)}</div>
              <div className="world-slider"><span>{t('worldPlaneSize')}</span><PixelSlider min={0} max={PLANE_SIZES.length - 1} step={1} value={planeSizeI} onChange={v => { setPlaneSizeI(v); try { localStorage.setItem('scrypture.planeSize', String(v)); } catch { /* private window: the choice just is not kept */ } }} label={t('worldPlaneSize')} valueText={`${PLANE_SIZES[planeSizeI]} m`} /><b>{PLANE_SIZES[planeSizeI]} m</b></div>
              {initial.kind === 'lakedistrict' && <div className="world-slider"><span>{t('worldWalkDist')}</span><PixelSlider min={25} max={200} step={25} value={walkDist} onChange={setWalkDist} label={t('worldWalkDist')} valueText={`${walkDist}%`} /><b>{walkDist}</b></div>}
              <div className="world-slider"><span>{t('worldTilt')}</span><PixelSlider min={0} max={16} step={1} value={tilt} onChange={v => { tiltPin.current = null; setTilt(v); }} label={t('worldTilt')} valueText={String(tilt)} /><b>{tilt}</b></div>
              {showInfo && <div className="muted small">{t('worldCamTip')}</div>}
            </Sec>
            <Sec id="graphics" title={t('worldSecGraphics')} open={!!secs["graphics"]} onToggle={toggleSec}>
              <div className="row world-tools">
                {(['low', 'med', 'high'] as const).map(k => <PixelButton key={k} size="compact" scale={1} variant={gfxPreset === k ? 'green' : 'red'} aria-pressed={gfxPreset === k} onClick={() => applyGfx(GFX_PRESETS[k])}>{t(k === 'low' ? 'worldGfxLow' : k === 'med' ? 'worldGfxMed' : 'worldGfxHigh')}</PixelButton>)}
                <PixelButton size="compact" scale={1} variant={gfxPreset === 'custom' ? 'green' : 'red'} aria-pressed={gfxPreset === 'custom'} disabled>{t('worldGfxCustom')}</PixelButton>
              </div>
              <div className="world-slider"><span>{t('worldRes')}</span><PixelSlider min={40} max={100} step={5} value={resScale} onChange={setResScale} label={t('worldRes')} valueText={`${resScale}%`} /><b>{resScale}%</b></div>
              <div className="row world-tools"><PixelButton size="compact" scale={1} variant={resAuto ? 'green' : 'red'} aria-pressed={resAuto} onClick={() => setResAuto(v => !v)}>{t('worldResAuto')}</PixelButton></div>
              <div className="world-slider"><span>{t('worldFpsCap')}</span><PixelSlider min={0} max={3} step={1} value={[0, 30, 45, 60].indexOf(fpsCap) < 0 ? 0 : [0, 30, 45, 60].indexOf(fpsCap)} onChange={v => setFpsCap([0, 30, 45, 60][v])} label={t('worldFpsCap')} valueText={fpsCap ? String(fpsCap) : t('worldFpsOff')} /><b>{fpsCap ? fpsCap : t('worldFpsOff')}</b></div>
              <div className="world-slider"><span>{t('worldDrawDist')}</span><PixelSlider min={10} max={initial.kind === 'lakedistrict' ? 500 : 150} step={10} value={drawDist} onChange={setDrawDist} label={t('worldDrawDist')} valueText={`${drawDist}%`} /><b>{drawDist}</b></div>
              <div className="world-slider"><span>{t('worldDecoDensity')}</span><PixelSlider min={20} max={100} step={10} value={decoDensity} onChange={setDecoDensity} label={t('worldDecoDensity')} valueText={`${decoDensity}%`} /><b>{decoDensity}%</b></div>
              <div className="row world-tools">
                <PixelButton size="compact" scale={1} variant={shaders ? 'green' : 'red'} aria-pressed={shaders} onClick={() => setShaders(v => !v)}>{t('worldShaders')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={decoClouds ? 'green' : 'red'} aria-pressed={decoClouds} onClick={() => setDecoClouds(c => !c)}>{t('worldClouds')}</PixelButton>
              </div>
            </Sec>
            <Sec id="display" title={t('worldSecDisplay')} open={!!secs["display"]} onToggle={toggleSec}>
              <div className="row world-tools">
              <PixelButton size="compact" scale={1} variant={gl3d ? 'green' : 'red'} aria-pressed={gl3d} onClick={() => setGl3d(v => !v)}>{t('worldGl3d')}</PixelButton>
              <PixelButton size="compact" scale={1} variant={billboards ? 'green' : 'red'} aria-pressed={billboards} onClick={() => setBillboards(v => !v)}>{t('worldBillboards')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={showInst ? 'green' : 'red'} aria-pressed={showInst} onClick={() => setShowInst(v => !v)}>{t('worldInstruments')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={hints ? 'green' : 'red'} aria-pressed={hints} onClick={() => setHints(v => !v)}>{t('worldThermalHints')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={miniHoops ? 'green' : 'red'} aria-pressed={miniHoops} onClick={() => setMiniHoops(v => !v)}>{t('worldMiniHoops')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={miniHeat ? 'green' : 'red'} aria-pressed={miniHeat} onClick={() => setMiniHeat(v => !v)}>{t('worldMiniHeat')}</PixelButton>
              </div>
              <div className="world-slider"><span>{t('worldMapUiSize')}</span><PixelSlider min={50} max={160} step={10} value={mapUiSize} onChange={setMapUiSize} label={t('worldMapUiSize')} valueText={`${mapUiSize}%`} /><b>{mapUiSize}%</b></div>
              <div className="world-slider"><span>{t('worldInstSize')}</span><PixelSlider min={50} max={160} step={10} value={instSize} onChange={setInstSize} label={t('worldInstSize')} valueText={`${instSize}%`} /><b>{instSize}%</b></div>
            </Sec>
            <Sec id="world" title={t('worldSecWorld')} open={!!secs["world"]} onToggle={toggleSec}>
              <TimeSlider hud={hudRef} label={t('worldTime')} onSet={h => { if (sim.current) { sim.current.hour = h; hudRef.current = { ...hudRef.current, hour: h }; } }} />
              <div className="row world-tools">
              <PixelButton size="compact" scale={1} variant={tool === 'paint' ? 'green' : 'red'} aria-pressed={tool === 'paint'} onClick={() => setTool(x => (x === 'paint' ? 'fly' : 'paint'))}>{t('worldPaint')}</PixelButton>
              <PixelButton size="compact" scale={1} onClick={strikeNow}>{t('worldStrike')}</PixelButton>
              </div>
              <div className="world-slider"><span>{t('worldRadius')}</span><PixelSlider min={1} max={4} step={1} value={radius} onChange={setRadius} label={t('worldRadius')} valueText={String(radius)} /><b>{radius}</b></div>
              {showInfo && <div className="muted small">{t('worldPaintHint')}</div>}
              <div className="muted small">{t('worldLayer', { n: Math.round(layer * 10) / 10, p: Math.round(parallax(layer) * 100) })}</div>
            </Sec>
            <Sec id="wind" title={t('worldWind')} open={!!secs["wind"]} onToggle={toggleSec}>
              <div className="row"><PixelButton size="compact" scale={1} variant={wind.enabled ? 'green' : 'red'} aria-pressed={wind.enabled} onClick={() => setWind(w => ({ ...w, enabled: !w.enabled }))}>{wind.enabled ? t('worldWindOn') : t('worldWindOff')}</PixelButton><PixelButton size="compact" scale={1} variant={windAuto ? 'green' : 'red'} aria-pressed={windAuto} onClick={() => setWindAuto(v => !v)}>{t('worldWindNatural')}</PixelButton></div>
              <div className="world-slider"><span>{t('worldStrength')}</span><PixelSlider min={0} max={10} step={0.5} value={wind.strength} onChange={v => { setWindAuto(false); setWind(w => ({ ...w, strength: v })); }} label={t('worldStrength')} valueText={String(wind.strength)} /><b>{wind.strength}</b></div>
              <div className="world-slider"><span>{t('worldDirection')}</span><PixelSlider min={0} max={359} step={5} value={windDeg} onChange={v => { setWindAuto(false); setWind(w => ({ ...w, dir: (v * Math.PI) / 180 })); }} label={t('worldDirection')} valueText={`${windDeg}`} /><b>{compass(windDeg)}</b></div>
              {showInfo && <div className="muted small">{t('worldWindHint')}</div>}
            </Sec>
            <Sec id="debug" title={t('worldSecDebug')} open={!!secs["debug"]} onToggle={toggleSec}>
              <div className="row world-tools">
                <PixelButton size="compact" scale={1} variant={debugLift ? 'green' : 'red'} aria-pressed={debugLift} onClick={() => setDebugLift(v => !v)}>{t('worldDebugLift')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={freeStall ? 'green' : 'red'} aria-pressed={freeStall} onClick={() => setFreeStall(v => !v)}>{t('worldFreeStall')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={showRivers ? 'green' : 'red'} aria-pressed={showRivers} onClick={() => setShowRivers(r => !r)}>{t('worldRivers')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={showFps ? 'green' : 'red'} aria-pressed={showFps} onClick={() => setShowFps(v => !v)}>{t('worldFps')}</PixelButton>
                <PixelButton size="compact" scale={1} variant={showEco ? 'green' : 'red'} aria-pressed={showEco} onClick={() => setShowEco(v => !v)}>{t('worldEcoButton')}</PixelButton>
              </div>
              <div className="world-slider"><span>{t('worldDebugLiftV')}</span><PixelSlider min={-5} max={15} step={0.1} value={debugLiftV} onChange={v => setDebugLiftV(Math.round(v * 10) / 10)} label={t('worldDebugLiftV')} valueText={`${debugLiftV} m/s`} /><b>{debugLiftV}</b></div>
              <div className="world-slider"><span>{t('worldThrottle')}</span><PixelSlider min={0} max={initial.kind === 'lakedistrict' ? LAKE_THROTTLE_MAX : 100} step={initial.kind === 'lakedistrict' ? 1 : 5} value={throttle} onChange={setThrottle} label={t('worldThrottle')} valueText={`${throttle}%`} /><b>{throttle}</b></div>
              <div className="muted small"><HudText hud={hudRef} pick={h => `${h.x}, ${h.y} - ${t('worldStats', { clouds: h.clouds, water: h.water })} - ${h.fps} fps, ${h.ms} ms, ${canvas.current?.width ?? 0}x${canvas.current?.height ?? 0}px`} /></div>
            </Sec>
            <Sec id="scores" title={t('worldLeaderboard')} open={!!secs["scores"]} onToggle={toggleSec}>
              {scores.length === 0 ? <div className="muted small">{t('worldNoScores')}</div> : (
                <ol className="world-scores">
                  {scores.map((r, i) => (
                    <li key={`${r.at}-${i}`}><b>{i + 1}</b><span>{r.points}</span><span>{r.hoops} {t('worldHoops')}</span><span>{r.metres < 1000 ? `${r.metres} m` : `${(r.metres / 1000).toFixed(2)} km`}</span></li>
                  ))}
                </ol>
              )}
            </Sec>
          </div>
          </div>
        </PixelFrame>
      )}
      {miniScale >= BIG_MAP_SCALE && (
        <div className="world-bigmap" role="dialog" aria-label={t('worldMap')}>
          <canvas ref={bigMap} className="world-bigmap-cv" aria-label={t('worldMap')} role="img" />
          <div className="world-bigmap-bar">
            <PixelFrame theme="green_ornate" scale={1} className="wui-banner">{t('paused')}</PixelFrame>
            <PixelFrame as="button" theme="green_ornate" scale={1} className="wui-mini" aria-label={t('worldMapZoomIn')} onClick={() => setMiniScale(v => Math.max(1, v / 2))}><Icon name="symbol_plus" size={16} alt="" /></PixelFrame>
            <PixelFrame as="button" theme="green_ornate" scale={1} className="wui-mini" aria-label={t('worldMapZoomOut')} onClick={() => setMiniScale(v => Math.min(16, v * 2))}><Icon name="symbol_minus" size={16} alt="" /></PixelFrame>
            <PixelFrame as="button" theme="green_ornate" scale={1} className="wui-mini" aria-label={t('close')} onClick={() => setMiniScale(BIG_MAP_SCALE / 2)}><Icon name="symbol_cross" size={16} alt="" /></PixelFrame>
          </div>
        </div>
      )}
    </div>
  );
}

/** After landing: a Throw button (Space does the same), so a phone can fly again. */
/** The boost button for a phone held sideways: a square with a double chevron; a dark cover drains away over the cooldown (written straight to the style, no re-render). */
function BoostButton({ cls, label, cooldown, charges, onBoost }: { cls: string; label: string; cooldown: () => number; charges: () => number; onBoost: (clientX: number) => void }) {
  const el = useRef<HTMLButtonElement>(null), cnt = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let was = true, off = 0;
    const id = setInterval(() => {
      const c = Math.max(0, Math.min(1, cooldown())), steps = Math.ceil(c * 10) / 10, n = charges(), ready = c <= 0 && n > 0, b = el.current;   // the cover drains in ten chunky steps, like pixel art
      if (!b) return;
      b.style.setProperty('--cd', String(steps)); b.setAttribute('data-ready', ready ? 'true' : 'false'); if (cnt.current) cnt.current.textContent = String(n);
      if (ready && !was) { b.setAttribute('data-shine', 'true'); clearTimeout(off); off = window.setTimeout(() => b.removeAttribute('data-shine'), 750); }   // ready again: a shine sweeps over the frame
      was = ready;
    }, 60);
    return () => { clearInterval(id); clearTimeout(off); };
  }, [cooldown]);
  return (
    <div className={cls}>
      <PixelFrame ref={el} as="button" theme="green_ornate" scale={1} className="wui-boostbtn" aria-label={label} title={label} data-ready="true" onPointerDown={e => onBoost(e.clientX)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" strokeLinejoin="miter" /></svg>
        <span className="wui-boostcd" /><span className="wui-boostshine" /><span ref={cnt} className="wui-boostn">0</span>
      </PixelFrame>
    </div>
  );
}

/** The skill shot: three sliders (up-down, left-right, diagonal) sweep through the middle at different paces and offsets; tap when all three are in the middle. They are lit while inside the zone. */
function ShotMinigame({ specs, getT, getQ, onTap, label }: { specs: SliderSpec[]; getT: () => number; getQ: () => number; onTap: () => void; label: string }) {
  const marks = useRef<(HTMLSpanElement | null)[]>([]), zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const R = 62, tick = () => {
      const t = getT(), tol = shotTolerance(getQ());
      if (zone.current) zone.current.style.setProperty('--tol', String(tol));
      specs.forEach((sp, i) => {
        const m = marks.current[i]; if (!m) return;
        const p = sliderPos(sp, t), dx = sp.axis === 'h' ? p : sp.axis === 'd' ? p * 0.7071 : 0, dy = sp.axis === 'v' ? p : sp.axis === 'd' ? -p * 0.7071 : 0;
        m.style.transform = `translate(${Math.round(dx * R)}px, ${Math.round(dy * R)}px)`; m.dataset.on = Math.abs(p) <= tol ? 'true' : 'false';
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [specs]);
  return (
    <div className="wui world-shot" role="button" aria-label={label} tabIndex={0} onPointerDown={e => { e.stopPropagation(); onTap(); }} onKeyDown={e => { if (e.key === 'Enter') onTap(); }}>
      <div className="world-shot-title">{label}</div>
      <div ref={zone} className="world-shot-pad">
        <i className="world-shot-track v" /><i className="world-shot-track h" /><i className="world-shot-track d" />
        <b className="world-shot-zone" />
        {specs.map((sp, i) => <span key={i} ref={el => { marks.current[i] = el; }} className={`world-shot-mark ${sp.axis}`} />)}
      </div>
    </div>
  );
}

/** One section of the settings sheet: a header that folds the body away and back (the height eases, nothing is focusable while it is folded). */
function Sec({ id, title, open, onToggle, children, nested }: { id: string; title: string; open: boolean; onToggle: (id: string) => void; children: ReactNode; nested?: boolean }) {
  const bodyId = `world-sec-${id}`;
  return (
    <div className={`${nested ? 'world-sec-nested' : 'card world-card'} world-sec${open ? ' open' : ''}`}>
      <button type="button" className="world-sec-head" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)}><span className="subtitle">{title}</span><i className="world-sec-chev" aria-hidden="true" /></button>
      <div id={bodyId} className="world-sec-body" aria-hidden={!open} {...(open ? {} : ({ inert: '' } as Record<string, string>))}><div className="world-sec-in">{children}</div></div>
    </div>
  );
}

/** The pattern button: flies the selected flight pattern (X); pressing it again hands the stick back. Lit while a pattern runs (written straight to the DOM, no re-render). */
function PatternButton({ cls, label, name, running, onPress, hint = 'X', icon }: { cls: string; label: string; name: () => string; running: () => boolean; onPress: () => void; hint?: string; icon?: string }) {
  const el = useRef<HTMLButtonElement>(null), txt = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const id = setInterval(() => { const b = el.current; if (!b) return; b.setAttribute('data-run', running() ? 'true' : 'false'); const n = name().slice(0, 7).toUpperCase(); if (txt.current && txt.current.textContent !== n) txt.current.textContent = n; }, 100);
    return () => clearInterval(id);
  }, [name, running]);
  return (
    <div className={cls}>
      <PixelFrame ref={el} as="button" theme="bronze" scale={1} className="wui-patbtn" style={{ '--bw': 5 } as CSSProperties} aria-label={label} title={`${label} (${hint})`} data-run="false" onPointerDown={e => { e.stopPropagation(); onPress(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon ?? 'M12 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 16v4'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" /></svg>
        <span ref={txt} className="wui-patname" />
      </PixelFrame>
    </div>
  );
}

/** The flight pattern editor (flight menu): pick the pattern the X button flies, and chain its steps. */
function PatternEditor({ store, set, t, armed, onArm, onFire, editOpen, onToggleEdit }: { store: PatternStore; set: (f: (s: PatternStore) => PatternStore) => void; t: TFn; armed: boolean; onArm: () => void; onFire: (p: Pattern) => void; editOpen: boolean; onToggleEdit: (id: string) => void }) {
  const p = store.patterns[store.sel];
  const edit = (f: (p: Pattern) => Pattern) => set(s => ({ ...s, patterns: s.patterns.map((q, i) => (i === s.sel ? f(q) : q)) }));
  return (
    <div className="world-patterns">
      <div className="row">
        <PixelButton size="compact" scale={1} variant={armed ? 'green' : 'red'} aria-pressed={armed} title={t('worldPatternArmHint')} onClick={onArm}>ARM</PixelButton>
        {store.patterns.map((q, i) => <PixelButton key={i} size="compact" scale={1} variant={i === store.sel ? 'green' : 'red'} aria-pressed={i === store.sel} onClick={() => { set(s => ({ ...s, sel: i })); if (armed) onFire(q); }}>{q.name}</PixelButton>)}
        {store.patterns.length < 32 && <PixelButton size="compact" scale={1} variant="red" onClick={() => set(s => ({ ...s, patterns: [...s.patterns, { name: `P${s.patterns.length + 1}`, repeat: 1, steps: [defaultStep('turn')] }], sel: s.patterns.length }))}>+</PixelButton>}
      </div>
      {p && <Sec id="patedit" nested title={t('worldPatternEdit')} open={editOpen} onToggle={onToggleEdit}>
        <div className="row">
          <input className="world-patname" value={p.name} maxLength={14} aria-label={t('worldPatterns')} onChange={e => edit(q => ({ ...q, name: e.target.value }))} />
          <PixelButton size="compact" scale={1} variant="red" onClick={() => edit(q => ({ ...q, repeat: q.repeat >= 9 ? 1 : q.repeat + 1 }))}>{t('worldPatternRepeat')} x{p.repeat}</PixelButton>
          {store.patterns.length > 1 && <PixelButton size="compact" scale={1} variant="red" onClick={() => set(deleteSelected)}>{t('worldPatternDel')}</PixelButton>}
          <PixelButton size="compact" scale={1} variant="red" onClick={() => set(resetPatterns)}>{t('worldPatternReset')}</PixelButton>
        </div>
        {p.steps.map((st, i) => {
          const u = stepUnit(st.kind), signed = st.kind === 'turn' || st.kind === 'roll', max = u === 's' ? 10 : 720;
          return (
            <div className="row world-patstep" key={i}>
              <PixelButton size="compact" scale={1} variant="green" onClick={() => edit(q => ({ ...q, steps: q.steps.map((x, j) => (j === i ? defaultStep(STEP_KINDS[(STEP_KINDS.indexOf(x.kind) + 1) % STEP_KINDS.length]) : x)) }))}>{i + 1}. {st.kind}</PixelButton>
              {u ? <PixelSlider label={st.kind} valueText={`${st.amount}${u === 'deg' ? '°' : 's'}`} min={signed ? -max : 0} max={max} step={u === 's' ? 0.5 : 15} value={st.amount} onChange={v => edit(q => ({ ...q, steps: q.steps.map((x, j) => (j === i ? { ...x, amount: v } : x)) }))} /> : <span />}
              <PixelButton size="compact" scale={1} variant="red" disabled={i === 0} onClick={() => edit(q => { const a = [...q.steps]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return { ...q, steps: a }; })}>↑</PixelButton>
              <PixelButton size="compact" scale={1} variant="red" onClick={() => edit(q => ({ ...q, steps: q.steps.filter((_, j) => j !== i) }))}>×</PixelButton>
            </div>
          );
        })}
        {p.steps.length < 12 && <div className="row"><PixelButton size="compact" scale={1} variant="red" onClick={() => edit(q => ({ ...q, steps: [...q.steps, defaultStep('turn')] }))}>{t('worldPatternStep')}</PixelButton></div>}
        <div className="muted small">{t('worldPatternHelp')}</div>
      </Sec>}
    </div>
  );
}

/** The run's result: a framed pixel popup that counts the points up row by row (hoops, distance, then the landing bonus or the crash penalty, then the total). */
/** Where the three berries hang on a ripe bush: [sideways, height], in bush sizes from the middle of its foot. */
const BERRY_SPOTS: readonly (readonly [number, number])[] = [[-0.2, 0.22], [0.03, 0.4], [0.22, 0.2]];

/**
 * The interaction panel, shown on foot beside something to act on: one card per thing (a beaver, a berry bush, a dam), each with
 * its picture, its name and state, and the buttons for what can be done with it. A button shows the item it uses and how many
 * are in the bag; the one the F key presses is marked.
 */
function ActPanel({ act, sticks, stones, berries, primary, onGive, onBreak, onPick, onFeed, t }: { act: Act; sticks: number; stones: number; berries: number; primary: 'feed' | 'pick' | 'stick' | 'stone' | null; onGive: (k: Haul) => void; onBreak: () => void; onPick: () => void; onFeed: () => void; t: (k: Key, v?: Record<string, string | number>) => string }) {
  const btn = (kind: 'feed' | 'pick' | 'stick' | 'stone', label: string, item: PickItem, n: number | null, off: boolean, go: () => void) => (
    <PixelButton size="compact" scale={1} className="wui-actbtn" disabled={off} onClick={go}>
      <img className="pixel" src={rawUrl(item)} alt="" draggable={false} /><span>{label}</span>{n !== null && <b>x{n}</b>}{primary === kind && <kbd aria-hidden="true">F</kbd>}
    </PixelButton>
  );
  const bv = act.beaver;
  return (
    <div className="wui wui-keep wui-act" role="group" aria-label={t('worldActTitle')}>
      {bv && (
        <PixelFrame theme="bronze" scale={1} className="wui-actcard">
          <img className="pixel wui-actpic" src={bv.sex === 'f' ? femaleIdleUrl : maleIdleUrl} alt="" draggable={false} />
          <div className="wui-actinfo">
            <b>{t('worldActBeaver')}</b>
            <span className="wui-pips" role="img" aria-label={`${t('worldActTrust')} ${bv.trust}/${MAX_TRUST}`}>{Array.from({ length: MAX_TRUST }, (_, i) => <i key={i} data-on={i < bv.trust} />)}</span>
            <em data-full={bv.full}>{t(bv.full ? 'worldActFull' : 'worldActHungry')}</em>
          </div>
          {btn('feed', t('worldActFeed'), 'berry', berries, bv.full || berries < 1, onFeed)}
        </PixelFrame>
      )}
      {act.bush && (
        <PixelFrame theme="bronze" scale={1} className="wui-actcard">
          <img className="pixel wui-actpic" src={rawUrl('berry')} alt="" draggable={false} />
          <div className="wui-actinfo"><b>{t('worldActBush')}</b><em data-full="true">{t('worldActRipe')}</em></div>
          {btn('pick', t('worldActPick'), 'berry', null, false, onPick)}
        </PixelFrame>
      )}
      {(act.dam.stick || act.dam.stone || act.dam.brk) && (
        <PixelFrame theme="bronze" scale={1} className="wui-actcard">
          <img className="pixel wui-actpic" src={rawUrl('stick')} alt="" draggable={false} />
          <div className="wui-actinfo"><b>{t('worldActDam')}</b>{(act.dam.stick || act.dam.stone) && <em>{t('worldActBuilding')}</em>}</div>
          {act.dam.stick && btn('stick', t('worldActGive'), 'stick', sticks, sticks < 1, () => onGive('stick'))}
          {act.dam.stone && btn('stone', t('worldActGive'), 'stone', stones, stones < 1, () => onGive('stone'))}
          {act.dam.brk && <PixelButton size="compact" scale={1} className="wui-actbtn" onClick={onBreak}><img className="pixel" src={rawUrl('symbol_cross')} alt="" draggable={false} /><span>{t('worldActBreak')}</span></PixelButton>}
        </PixelFrame>
      )}
    </div>
  );
}

/** The slot that pops up when an item is picked up: it shows the old count, then ticks to the new one with a "+1" rising from it. */
function PickToast({ item, from, to, onDone }: { item: PickItem; from: number; to: number; onDone: () => void }) {
  const [n, setN] = useState(from);
  useEffect(() => { const a = setTimeout(() => setN(to), 350), b = setTimeout(onDone, 2200); return () => { clearTimeout(a); clearTimeout(b); }; }, []);
  return (
    <div className="wui wui-keep wui-pick" aria-live="polite">
      <Slot key={n} id={item} n={n} />
      {n === to && <b className="wui-pickplus" key="plus">+{to - from}</b>}
    </div>
  );
}

/** Fire got the plane: flames rise from the bottom and swallow the screen, then GAME OVER with the burned counter and a Respawn button. */
function BurnPopup({ n, onRespawn, t }: { n: number; onRespawn: () => void; t: (k: any) => string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = setTimeout(() => setShown(true), BURN_SECONDS * 1000 + 300); return () => clearTimeout(id); }, []);
  return (
    <div className="world-burn" role="alertdialog" aria-label={t('worldBurnedOver')}>
      <BurnFire />
      {shown && (
        <div className="world-burnwrap">
          <PixelFrame theme="bevelled_stone_and_gold_pixel_frame" scale={1} className="world-popbox world-burnbox">
            <div className="world-poptitle bad">{t('worldBurnedOver')}</div>
            <ul className="world-poprows"><li className="total"><span>{t('worldBurnedBy')}</span><b>{t('worldBurnedCount')} x{n}</b></li></ul>
            <div className="world-popbtns"><PixelButton size="compact" scale={1} variant="red" autoFocus style={{ touchAction: 'none' }} onClick={onRespawn}>{t('worldRespawn')}</PixelButton></div>
          </PixelFrame>
        </div>
      )}
    </div>
  );
}
function RunPopup({ run, onClose, onShop, t }: { run: { hoops: number; metres: number; height: number; bonus: number; soft: boolean; water: boolean; saved: 'insurance' | 'float' | null; dbl: number; coins: number; trick: number; tag?: { pts: number; you: number; ai: number }; tricks: { name: string; n: number; pts: number }[] }; onClose: () => void; onShop: () => void; t: (k: Key, v?: Record<string, string | number>) => string }) {
  const [el, setEl] = useState(0);
  useEffect(() => { const t0 = performance.now(); const id = setInterval(() => setEl((performance.now() - t0) / 1000), 60); return () => clearInterval(id); }, []);
  const total = runPoints(run.hoops, run.metres, run.bonus + run.dbl, run.height);
  const rows: { label: string; v: number; tone?: 'good' | 'bad' | 'gold' }[] = [
    { label: `${t('worldHoops')} x${run.hoops}`, v: run.hoops * 100 },
    { label: t('worldRunDistance'), v: run.metres },
    { label: `${t('worldRunHeight')} ${run.height} m`, v: run.height * HEIGHT_POINTS },
    { label: run.saved === 'float' ? t('worldRunFloated') : run.saved === 'insurance' ? t('worldRunInsured') : run.soft ? t('worldRunLanding') : run.water ? t('worldRunWater') : t('worldRunCrash'), v: run.bonus - run.trick - (run.tag?.pts ?? 0), tone: run.soft || run.saved ? 'good' : 'bad' },
    ...(run.tag ? [{ label: `${t('worldDogTag')} ${run.tag.you}-${run.tag.ai}`, v: run.tag.pts, tone: 'good' as const }] : []),
    ...run.tricks.map(k => ({ label: k.n > 1 ? `${k.name} x${k.n}` : k.name, v: k.pts, tone: 'good' as const })),   // every trick flown, and what it paid
    ...(run.dbl > 0 ? [{ label: t('worldRunDouble'), v: run.dbl, tone: 'good' as const }] : []),
    { label: t('worldRunTotal'), v: total, tone: 'gold' },
  ];
  const gap = rows.length > 7 ? 0.35 : 0.7;   // (a long list of tricks goes by quicker)
  const shown = (i: number, v: number) => { const f = Math.min(1, Math.max(0, (el - 0.5 - i * gap) / 0.6)); return Math.round(v * (Math.floor(f * 10) / 10)); };   // counts up in ten chunky steps
  const done = el > 0.5 + (rows.length - 1) * gap + 0.6;
  useEffect(() => { if (!done) return; const id = setTimeout(onClose, 3500); return () => clearTimeout(id); }, [done]);   // (the score stays a few seconds, then gets out of the way: the bobr is already walking)
  return (
    <div className="world-popup" role="status">
      <PixelFrame theme="bevelled_stone_and_gold_pixel_frame" scale={1} className="world-popbox">
        <div className={`world-poptitle ${run.soft ? 'good' : 'bad'}`}>{run.soft ? t('worldRunSoft') : run.water ? t('worldRunSplash') : t('worldRunHard')}</div>
        <ul className="world-poprows">
          {rows.map((r, i) => {
            const on = el >= 0.5 + i * gap, v = shown(i, r.v);
            return <li key={i} className={`${r.tone ?? ''} ${i === rows.length - 1 ? 'total' : ''}`} style={{ visibility: on ? 'visible' : 'hidden' }}><span>{r.label}</span><b>{v > 0 && i >= 3 && i < rows.length - 1 ? '+' : ''}{v}</b>{i === rows.length - 1 && coinsFor(v) > 0 && <em className="world-popcoins">+{coinsFor(v)}<img src={rawUrl('coin')} alt="" draggable={false} /></em>}</li>;
          })}
        </ul>
        <div className="world-popbtns" style={{ visibility: done ? 'visible' : 'hidden' }}>
          <PixelButton size="compact" scale={1} variant="green" style={{ touchAction: 'none' }} onClick={onClose}>{t('worldRunOk')}</PixelButton>
          <PixelButton size="compact" scale={1} variant="red" style={{ touchAction: 'none' }} onClick={onShop}>{t('worldShop')}</PixelButton>
        </div>
      </PixelFrame>
    </div>
  );
}

/** The shop: on the ground, before the throw. Boosts, the launch and paper tiers, and the one-run extras, each for coins. */
function PreflightShop({ hud, aiming, open, onClose, coins, boosts, up, onBuyBoost, onBuy, t }: { hud: MutableRefObject<Hud>; aiming: () => boolean; open: boolean; onClose: () => void; coins: number; boosts: () => number; up: Upgrades; onBuyBoost: () => void; onBuy: (id: ShopId) => void; t: (k: Key) => string }) {
  const [state, setState] = useState({ landed: false, aiming: false, boosts: 0 });
  useEffect(() => { const id = setInterval(() => setState(p => { const n = { landed: hud.current.landed, aiming: aiming(), boosts: boosts() }; return n.landed === p.landed && n.aiming === p.aiming && n.boosts === p.boosts ? p : n; }), 150); return () => clearInterval(id); }, [hud, aiming, boosts]);
  if (!open || !state.landed || state.aiming) return null;
  type Row = { key: string; name: string; desc: string; price: number | null; can: boolean; buy: () => void };
  const tierRow = (id: 'launch' | 'paper', Name: string): Row => {
    const n = up[id], max = TIERS[id].prices.length, o = shopOffer(id, up, coins);
    return { key: id, name: t(`worldShop${Name}${Math.min(n + 1, max)}` as Key), desc: t(`worldShop${Name}Desc` as Key), price: o.price, can: o.canBuy, buy: () => onBuy(id) };
  };
  const stockRow = (id: 'insurance' | 'float' | 'double', Name: string): Row => {
    const o = shopOffer(id, up, coins);
    return { key: id, name: `${t(`worldShop${Name}` as Key)} x${up[id]}`, desc: t(`worldShop${Name}Desc` as Key), price: o.price, can: o.canBuy, buy: () => onBuy(id) };
  };
  const rows: Row[] = [
    { key: 'boost', name: `${t('worldBoost')} x${state.boosts}`, desc: t('worldShopBoostDesc'), price: BOOST_PRICE, can: coins >= BOOST_PRICE && state.boosts < MAX_BOOSTS, buy: onBuyBoost },
    tierRow('launch', 'Launch'), tierRow('paper', 'Paper'),
    stockRow('insurance', 'Insurance'), stockRow('float', 'Float'), stockRow('double', 'Double'),
  ];
  return (
    <div className="wui wui-shop">
      <PixelFrame theme="bevelled_stone_and_gold_pixel_frame" scale={1} className="world-shopbox" aria-label={t('worldShop')}>
        <div className="world-shophead">
          <span className="world-shopcoins"><img src={rawUrl('coin')} alt="" draggable={false} />{coins}</span>
          <span className="world-shoptitle">{t('worldShop')}</span>
          <PixelButton size="compact" scale={1} variant="red" aria-label={t('worldClose')} style={{ touchAction: 'none' }} onClick={onClose}>x</PixelButton>
        </div>
        <ul className="world-shoplist">
          {rows.map(r => (
            <li key={r.key}>
              <span className="world-shopname"><b>{r.name}</b><small>{r.desc}</small></span>
              {r.price === null
                ? <span className="world-shopmax">{t('worldShopMax')}</span>
                : <PixelButton size="compact" scale={1} variant={r.can ? 'green' : 'red'} disabled={!r.can} style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); r.buy(); }}>{r.price}<img className="world-shopcoin" src={rawUrl('coin')} alt="" draggable={false} /></PixelButton>}
            </li>
          ))}
        </ul>
      </PixelFrame>
    </div>
  );
}

function ThrowButton({ hud, label, shopLabel, looking, lead, trail, hidden, power, onPress, onShop }: { hud: MutableRefObject<Hud>; lead?: ReactNode; label: string; shopLabel: string; looking: boolean; trail?: ReactNode; hidden: boolean; power: () => number | null; onPress: (clientX: number) => void; onShop: () => void }) {
  const [landed, setLanded] = useState(false);
  useEffect(() => { const id = setInterval(() => setLanded(hud.current.landed), 200); return () => clearInterval(id); }, [hud]);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {   // while the throw is held, the button itself is the power meter: it fills left to right as the power swings up and down
    const id = setInterval(() => { const p = power(), w = wrap.current; if (!w) return; if (p === null) w.removeAttribute('data-aim'); else { w.setAttribute('data-aim', p < 0.7 ? 'low' : p < 0.95 ? 'mid' : 'high'); w.style.setProperty('--pw', String(p)); } }, 50);
    return () => clearInterval(id);
  }, [power, landed, hidden]);
  if (!landed || hidden) return null;
  return <div className="wui wui-throw"><div className="wui-row">{looking && lead}<div className="world-throwcol"><span ref={wrap} className="world-throwwrap"><PixelButton size="compact" scale={1} variant="green" style={{ touchAction: 'none' }} onPointerDown={e => onPress(e.clientX)}>{label}</PixelButton><span className="world-throwfill" /></span><PixelButton size="compact" scale={1} variant="red" style={{ touchAction: 'none' }} onClick={onShop}>{shopLabel}</PixelButton></div>{looking && trail}</div></div>;
}

/** The second joystick, on foot: a stick for looking round (sideways turns, up and down tips the view). Its own knob, written to `stick`. */
function LookStick({ stick, label, bare }: { stick: MutableRefObject<{ dx: number; dy: number }>; label: string; bare?: boolean }) {
  const box = useRef<HTMLDivElement>(null), knob = useRef<HTMLImageElement>(null), on = useRef(false);
  const set = (dx: number, dy: number) => { stick.current = { dx, dy }; if (knob.current) knob.current.style.transform = `translate(${dx * 20}%, ${dy * 20}%)`; };
  const move = (e: RPointerEvent) => { const r = box.current!.getBoundingClientRect(), R = r.width / 2; let dx = (e.clientX - r.left - R) / (R * 0.8), dy = (e.clientY - r.top - R) / (R * 0.8); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } set(dx, dy); };
  const up = () => { on.current = false; set(0, 0); };
  useEffect(() => () => { stick.current = { dx: 0, dy: 0 }; }, [stick]);
  return (
    <div ref={box} className="world-joy world-joy-look" role="group" aria-label={label} style={bare ? { margin: 0 } : { marginRight: 0, marginLeft: 'calc(28 * var(--u))' }}
      onPointerDown={e => { on.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e); }} onPointerMove={e => { if (on.current) move(e); }} onPointerUp={up} onPointerCancel={up}>
      <img className="world-joybase" src={rawUrl('joystick_base')} alt="" draggable={false} />
      <img ref={knob} className="world-knob" data-travel="20" src={rawUrl('joystick_knob')} alt="" draggable={false} />
    </div>
  );
}

/** A piece of text from the HUD numbers, re-read 4 times a second; only this tiny component re-renders when it changes. */
/** The time of day: follows the clock while it runs, and sets it when you drag. */
function TimeSlider({ hud, label, onSet }: { hud: MutableRefObject<Hud>; label: string; onSet: (hour: number) => void }) {
  const [val, setVal] = useState(() => hud.current.hour);
  const touched = useRef(0);
  useEffect(() => {
    const id = setInterval(() => { if (performance.now() - touched.current > 800) setVal(hud.current.hour); }, 250);
    return () => clearInterval(id);
  }, [hud]);
  const v = Math.max(0, Math.min(24, ((val % 24) + 24) % 24));
  return <div className="world-slider"><span>{label}</span><PixelSlider min={0} max={24} step={0.25} value={v} onChange={h => { touched.current = performance.now(); setVal(h); onSet(h >= 24 ? 0 : h); }} label={label} valueText={clockText(v)} /><b>{clockText(v)}</b></div>;
}

/** Where the plane is, in words: over a named water, or how far and which way from the nearest one. */
function placeText(x: number, y: number, t: TFn): string {
  const w = lakeWatersFrom(x, y)[0];
  if (!w) return '';
  return w.tiles < 12 && lakeWaterAt(x, y) !== LAKE_LAND ? t('worldPlaceOver' as Key, { name: w.name }) : t('worldPlaceNear' as Key, { km: tilesToKm(w.tiles).toFixed(1), dir: compass(w.dx, w.dy), name: w.name });
}
/** Every named water, nearest first, with its distance and direction from the plane. */
function WatersList({ hud, t, onClose }: { hud: MutableRefObject<Hud>; t: TFn; onClose: () => void }) {
  const [pos, setPos] = useState({ x: hud.current.x, y: hud.current.y });
  useEffect(() => { const id = setInterval(() => setPos(p => (p.x === hud.current.x && p.y === hud.current.y ? p : { x: hud.current.x, y: hud.current.y })), 500); return () => clearInterval(id); }, [hud]);
  const list = lakeWatersFrom(pos.x, pos.y);
  return (
    <PixelFrame theme="green_ornate" scale={1} className="wui-waters" onClick={onClose} style={{ position: 'absolute', top: 70, right: 8, zIndex: 30, maxHeight: '60%', overflowY: 'auto', padding: '8px 10px', maxWidth: '85%' }}>
      <div>{t('worldHere' as Key, { x: pos.x, y: pos.y })}</div>
      <div className="muted small">{t('worldWaters' as Key).toUpperCase()}</div>
      {list.map(w => <div key={w.name} className="small">{w.name} - {tilesToKm(w.tiles).toFixed(1)} km {compass(w.dx, w.dy)}</div>)}
    </PixelFrame>
  );
}
function HudText({ hud, pick }: { hud: MutableRefObject<Hud>; pick: (h: Hud) => string }) {
  const [text, setText] = useState(() => pick(hud.current));
  useEffect(() => {
    const read = () => { const n = pick(hud.current); setText(p => (p === n ? p : n)); };
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [hud, pick]);
  return <>{text}</>;
}

// ---- helpers ------------------------------------------------------------------------------------------------------------

/** How much of a sheet cell is empty under its art (0..1 of the cell's height): bushes and rocks do not reach the cell's bottom, so drawn at the tile's base they would hover. */
const padCache = new WeakMap<HTMLImageElement, Map<number, number>>();
/** The share of an item picture's height that is empty under the art (so a stone stands on the ground instead of floating above it). */
const itemPadCache = new WeakMap<HTMLImageElement, number>();
function itemBottomPad(img: HTMLImageElement): number {
  const hit = itemPadCache.get(img); if (hit !== undefined) return hit;
  let pad = 0;
  try {
    const w = img.naturalWidth || 64, h = img.naturalHeight || 64, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true })!; c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, w, h).data;
    let last = h - 1; for (; last > 0; last--) { let any = false; for (let x = 0; x < w && !any; x++) any = d[(last * w + x) * 4 + 3] > 40; if (any) break; }
    pad = (h - 1 - last) / h;
  } catch { pad = 0; }
  itemPadCache.set(img, pad); return pad;
}
function bottomPad(img: HTMLImageElement, cell: readonly [number, number]): number {
  let m = padCache.get(img); if (!m) padCache.set(img, m = new Map());
  const key = cell[1] * 64 + cell[0], hit = m.get(key); if (hit !== undefined) return hit;
  let pad = 0;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = TILE_PX;
    const c = cv.getContext('2d', { willReadFrequently: true })!; c.drawImage(img, cell[0] * TILE_PX, cell[1] * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
    const d = c.getImageData(0, 0, TILE_PX, TILE_PX).data;
    let last = TILE_PX - 1; for (; last > 0; last--) { let any = false; for (let x = 0; x < TILE_PX && !any; x++) any = d[(last * TILE_PX + x) * 4 + 3] > 40; if (any) break; }
    pad = (TILE_PX - 1 - last) / TILE_PX;
  } catch { pad = 0; }
  m.set(key, pad); return pad;
}

// the decorative sky: low-frequency noise picks the cloud banks, a share of the cells inside a bank hold one whole cloud picture (bigger toward the core).
// Drift shifts the noise field itself, so the sky is endless and fills in from every edge. The 3D view and the flat canvas share these numbers.
const DECO_KEEP = 0.3, DECO_W0 = 2.6, DECO_W1 = 1.6;

const calm0 = (wv: number) => wv < 0.02;
/** The 3D sky: three kinds of cloud, each in its own band of heights (tiles above the ground), generated inside a sphere of SKY_R tiles round the plane
 *  (so a climbing plane leaves the cumulus behind and meets the stratocumulus, then the cirrus). Each band is a drifting grid of cells: noise picks the banks,
 *  and a share of the cells in a bank hold one cloud at a jittered spot. `sprite` indexes the atlas's clouds: 0..2 cumulus, 3..5 stratocumulus, 6..7 cirrus. */
const SKY_R = 360;
const SKY_MIN_BASE = 24;   // the lowest the underside of any sky cloud may hang above the ground (tiles)   // about 2 km: a tile is some 5.5 m of height
const SKY_BANDS = [
  { cell: 34, z0: 30, z1: 60, nz: 2, w: [18, 36], keep: 0.34, alpha: 0.92, s0: 0, s1: 3, drift: 0.9, off: 0 },
  { cell: 70, z0: 70, z1: 140, nz: 2, w: [50, 100], keep: 0.34, alpha: 0.8, s0: 3, s1: 6, drift: 1.8, off: 5000 },
  { cell: 120, z0: 170, z1: 300, nz: 2, w: [120, 210], keep: 0.4, alpha: 0.58, s0: 6, s1: 8, drift: 3.2, off: 9000 },
];
function emitSkyClouds(emit: (x: number, y: number, z: number, w: number, sprite: number, alpha: number) => void, seed: number, px: number, py: number, pz: number, anim: number, off: { x: number; y: number }[]) {
  SKY_BANDS.forEach((b, bi) => {
    const dz = (b.z1 - b.z0) / b.nz;
    for (let zi = 0; zi < b.nz; zi++) {
      const u0 = Math.floor((px - SKY_R - off[bi].x) / b.cell) - 1, u1 = Math.ceil((px + SKY_R - off[bi].x) / b.cell) + 1;
      const v0 = Math.floor((py - SKY_R - off[bi].y) / b.cell) - 1, v1 = Math.ceil((py + SKY_R - off[bi].y) / b.cell) + 1;
      for (let nv = v0; nv <= v1; nv++) for (let nu = u0; nu <= u1; nu++) {
        const bank = valueNoise01((nu + b.off) * 0.2, (nv + b.off) * 0.2, seed + zi * 131);
        if (bank < 0.45 || hash01(nu, nv, seed, 60 + bi * 4 + zi) > b.keep) continue;
        const x = (nu + hash01(nu, nv, bi * 2 + zi, 11)) * b.cell + off[bi].x, y = (nv + hash01(nu, nv, bi * 2 + zi, 12)) * b.cell + off[bi].y;
        const w = (b.w[0] + hash01(nu, nv, bi * 2 + zi, 15) * (b.w[1] - b.w[0])) * (0.85 + 0.3 * Math.min(1, (bank - 0.45) / 0.3));
        const z = Math.max(SKY_MIN_BASE + w * CLOUD_ASPECT * 0.5, b.z0 + (zi + hash01(nu, nv, bi * 2 + zi, 13)) * dz + Math.sin(anim * 0.1 + hash01(nu, nv, bi, 14) * 10) * 1.5);   // (never lower than the minimum, underside included)
        const d = Math.hypot(x - px, y - py, z - pz);
        if (d > SKY_R) continue;
        const edge = 1 - sstep(d, SKY_R * 0.8, SKY_R);                    // (a cloud fades in at the rim of the sphere instead of popping)
        emit(x, y, z, w, b.s0 + Math.floor(hash01(nu, nv, bi * 2 + zi, 16) * (b.s1 - b.s0)), b.alpha * edge);
      }
    }
  });
}

/** The decorative sky on the flat canvas. */
function drawDecoClouds(ctx: CanvasRenderingContext2D, seed: number, fx: number, fy: number, W: number, H: number, T: number, zoom: number, anim: number, skyOff: { x: number; y: number }[], include: (li: number) => boolean, rot = 0) {
  if (!cloudSprites.length) return;
  const CELL = T * 3;                                                            // one cell = 3 ground tiles
  DECO_LAYERS.forEach((cfg, li) => {
    if (!include(li)) return;
    const px = fx * T * cfg.parallax, py = fy * T * cfg.parallax;               // higher parallax = nearer = slides faster under you
    const shift = skyOff[li].x, whole = Math.floor(shift / CELL), frac = shift - whole * CELL;
    const shiftY = skyOff[li].y, wholeY = Math.floor(shiftY / CELL), fracY = shiftY - wholeY * CELL;
    const reach = T * (2.4 + 1.6 * cfg.size);                                    // a cloud spills this far out of its cell
    const u0 = Math.floor((px - W / 2 - reach - frac) / CELL), u1 = Math.ceil((px + W / 2 + reach - frac) / CELL);
    const v0 = Math.floor((py - H / 2 - reach - fracY) / CELL), v1 = Math.ceil((py + H / 2 + reach - fracY) / CELL);
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      const nu = u - whole, nv = v - wholeY;                                                      // field coordinate: moves right as time passes
      const bank = valueNoise01((nu + cfg.offset) * 0.18, (nv + cfg.offset) * 0.18, seed);
      if (bank < 0.58 || hash01(nu, nv, seed, 50 + li) > DECO_KEEP) continue;      // banks only, and only some cells of a bank
      const mass = Math.min(1, (bank - 0.58) / 0.25);                           // 0 at the edge of a bank .. 1 at its core
      const cx = u * CELL + frac - px + W / 2 + CELL / 2;
      const sway = Math.sin(anim * (0.05 + li * 0.02) * 2 * Math.PI + hash01(nu, nv, li, 9) * 10) * cfg.sway * 0.12 * zoom;
      const cy = v * CELL + fracY - py + H / 2 + CELL / 2 + sway;
      if (rot === 0 ? cx < -reach || cx > W + reach || cy < -reach || cy > H + reach : Math.hypot(cx - W / 2, cy - H / 2) > Math.hypot(W, H) / 2 + reach) continue;   // a cloud wholly off the screen is never drawn (a turned view: outside the circle round it)
      const w = T * cfg.size * (DECO_W0 + mass * DECO_W1), h = w * CLOUD_ASPECT, sp = cloudPick(hash01(nu, nv, li, 91) * 1000);
      ctx.globalAlpha = cfg.opacity;
      if (rot !== 0) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(-rot); ctx.drawImage(sp, -w / 2, -h / 2, w, h); ctx.restore(); }   // clouds face the screen
      else ctx.drawImage(sp, cx - w / 2, cy - h / 2, w, h);
    }
  });
  ctx.globalAlpha = 1;
}

/** 100x100 minimap, 2 tiles per pixel: explored land is drawn dim, the part near the plane bright, the rest stays black (Android's two-pass minimap). */
/** Is the point inside a very wide V ahead of the plane (80 degrees either side of its heading)? The arrows pick the nearest target in it, so they name the next one on the way. */
/** The launch power meter: while the throw is held it swings up and down (0.25 .. 1, a full swing in 2.4 s); where it is when you let go is the power. */
const aimPower = (t: number) => { const p = (t / 1.2) % 2; return 0.25 + 0.75 * (p < 1 ? p : 2 - p); };
/** The pixel font for every bit of text drawn on the canvas. */
const NO_SCORES: RunScore[] = [];
/** Real metres for the labels: on the Lake District maps a tile is `tileM` metres on the ground, and the glider's own height metre is drawn 0.18 tiles tall, i.e. 0.18 * tileM / stretch real metres; elsewhere a tile is a metre, so a height is its drawn tiles (sim metres x 0.18). */
const realDist = (tiles: number) => Math.round(tiles * (lakeData()?.tileM ?? 1));
const realAlt = (simM: number) => { const d = lakeData(); return Math.round(d ? simM * 0.18 * d.tileM / d.stretch : simM * 0.18); };   // (flat world: a tile is a metre, and a sim metre of height is drawn 0.18 tiles tall)
/** Trees, bushes and rocks on the Lake District maps are drawn at about real size against the 50 m tiles (about 10 to 40 m tall) instead of 1 to 4 tiles; other worlds keep the old size. */
/** The plane lengths you can choose between (m): a real paper plane first. */
const PLANE_SIZES = [0.3, 0.5, 0.8, 1.2, 2, 3, 4, 6, 8];
const SMALL_DECO_K = 0.3;   // bushes and rocks are drawn this fraction of a tree's size (a bush is about a metre, a stone less)
const CHASE_DEFAULT_LENGTHS = 14;   // plane lengths: the farthest the cameras sit from the plane at their usual zoom
const CHASE_MIN_LENGTHS = 2.2;   // plane lengths: how close the chase camera can be to the plane at full zoom
const CAM_EXP = 0.6;   // how fast the chase camera backs off as the plane gets bigger: 0 = one fixed distance, 1 = the plane keeps one size on screen
/** The chase camera's scale for a plane of scale `planeK`, given the scale `ref` of the smallest setting. The smallest sizes all sit at one distance (the plane is simply smaller on screen); bigger ones push the camera out a little, smoothly, so it is never inside the plane and the plane still looks bigger the bigger it is set. */
const chaseCamScale = (planeK: number, ref: number) => { const r = Math.max(CAM_MIN, ref); return Math.max(r, r * Math.pow(Math.max(planeK, 1e-6) / r, CAM_EXP)); };
const CAM_MIN = 0.1;   // the camera's distances (chase, free, flyby, nose view) follow the plane's size, down to this fraction of the usual
const LAKE_DECO_MIN = 0.25;   // ...but never below this many tiles per unit of scale, or on the 50 m map they shrink to a few pixels
const LAKE_DECO_M = 10;   // metres per unit of decoration scale (so scale 1..4 is 10..40 m): the factor is this over the map's metres per tile (1.0 on Coniston at 10 m), floored at LAKE_DECO_MIN (so 0.25 on the 50 m map, where 10 / 50 would be 0.2)
const PXF = "'Press Start 2P', ui-monospace, monospace";
const CONE = (80 * Math.PI) / 180;
const inCone = (f: Flight, x: number, y: number) => Math.abs(Math.atan2(Math.sin(Math.atan2(-(y - f.y), x - f.x) - f.course), Math.cos(Math.atan2(-(y - f.y), x - f.x) - f.course))) <= CONE;

interface MiniMark { x: number; y: number; kind: 'hoop' | 'done' | 'heat'; r: number }
/** The minimap's memory: each explored chunk's 16 x 16 terrain, read once (the eco marks a changed chunk and it is read again), and one image reused for every draw. */
class MiniCache { terr = new Map<number, Uint8Array>(); img: ImageData | null = null; }
const MINI_RGB: Record<Terrain, [number, number, number]> = { 0: [15, 107, 140], 1: [232, 200, 138], 2: [74, 107, 34] };
const TREE_RGB = [22, 62, 24];   // the full-screen map's tree green
const MINI_NEW_MAX = 24;   // chunks read per draw at most (a big jump of the map fills in over a few draws, not one long frame)
const MINI_NEW_MS = 2;   // ...and for at most this long
/** Minimap zoom (tiles per pixel) from which the map opens full screen and time stops (zoom steps 3 to 5): one pixel is a quarter chunk or more, far too many chunks to read while flying. */
const BIG_MAP_SCALE = 4;
/** The full-screen map's state: filled a few rows a frame, from the plane's spot at the time it opened. */
interface BigMapFill { w: number; h: number; scale: number; x: number; y: number; row: number; img: ImageData }
/** Draw the minimap; true when some chunks were not read yet and it should be drawn again soon. */
function drawMinimap(cv: HTMLCanvasElement, cache: MiniCache, world: World, explored: Set<number>, f: Flight, cx0: number, cx1: number, cy0: number, cy1: number, scale: number, marks: MiniMark[] = []): boolean {
  if (world.kind === 'lakedistrict') {   // the whole map, shrunk to fit (see lakeOverview), with the plane on it
    const ov = lakeOverview(), g = cv.getContext('2d')!;
    if (ov) {
      const k = Math.min(100 / ov.width, 100 / ov.height), w = ov.width * k, h = ov.height * k, ox = (100 - w) / 2, oy = (100 - h) / 2;
      g.fillStyle = '#0a1a2a'; g.fillRect(0, 0, 100, 100); g.imageSmoothingEnabled = true; g.drawImage(ov, ox, oy, w, h);
      const px = ox + (f.x + (ov.width >> 1) + 0.5) * k, py = oy + (f.y + (ov.height >> 1) + 0.5) * k, dx = Math.cos(f.heading), dy = -Math.sin(f.heading), qx = -dy, qy = dx;
      g.beginPath(); g.moveTo(px + dx * 6, py + dy * 6); g.lineTo(px - dx * 3.5 + qx * 3.5, py - dy * 3.5 + qy * 3.5); g.lineTo(px - dx * 1.2, py - dy * 1.2); g.lineTo(px - dx * 3.5 - qx * 3.5, py - dy * 3.5 - qy * 3.5); g.closePath();
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineJoin = 'round'; g.stroke();
      return false;
    }
  }
  const g = cv.getContext('2d')!;
  if (!cache.img) cache.img = g.createImageData(100, 100);
  const img = cache.img, d = img.data, fx = Math.round(f.x), fy = Math.round(f.y), t0 = performance.now();
  if (cache.terr.size > 6000) cache.terr.clear();   // (a long flight: forget it all rather than grow without end)
  const direct = scale >= CHUNK / 2;   // (zoomed far out a chunk is a pixel or two: read those tiles straight, reading whole chunks would be far more work)
  let made = 0, left = false, lastKey = NaN, seen = false, terr: Uint8Array | null | undefined = null, near = false, bx = 0, by = 0;
  for (let j = 0; j < 100; j++) { const y = Math.floor(fy + (j - 50) * scale), cy = chunkOf(y); for (let i = 0; i < 100; i++) {
    const x = Math.floor(fx + (i - 50) * scale), cx = chunkOf(x), key = tileKey(cx, cy), o = (j * 100 + i) * 4;
    if (key !== lastKey) {   // (the same chunk for many pixels in a row: looked up once)
      lastKey = key; bx = cx * CHUNK; by = cy * CHUNK; seen = explored.has(key); terr = null;
      if (seen && !direct) {
        terr = cache.terr.get(key);
        if (!terr) {
          if (made < MINI_NEW_MAX && (made === 0 || performance.now() - t0 < MINI_NEW_MS)) { made++; terr = world.chunkTerrain(cx, cy); cache.terr.set(key, terr); }
          else { left = true; seen = false; }
        }
      }
      near = cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1;
    }
    if (!seen) { d[o] = d[o + 1] = d[o + 2] = 10; d[o + 3] = 255; continue; }
    const c = MINI_RGB[terr ? terr[(y - by) * CHUNK + (x - bx)] as Terrain : world.mapSample(x, y)], k = near ? 1 : 0.55;
    d[o] = c[0] * k; d[o + 1] = c[1] * k; d[o + 2] = c[2] * k; d[o + 3] = 255;
  } }
  g.putImageData(img, 0, 0);
  for (const m of marks) {
    const i = (m.x - f.x) / scale + 50, j = (m.y - f.y) / scale + 50;
    if (i < -4 || i > 104 || j < -4 || j > 104) continue;
    if (m.kind === 'heat') { const rr = Math.max(2.5, Math.min(7, m.r / scale)); g.fillStyle = 'rgba(255,140,40,0.45)'; g.fillRect(Math.round(i - rr), Math.round(j - rr / 2), Math.round(rr * 2), Math.round(rr)); g.fillStyle = 'rgba(255,200,90,0.9)'; g.fillRect(Math.round(i) - 1, Math.round(j) - 1, 3, 3); }
    else { g.fillStyle = m.kind === 'done' ? 'rgba(140,255,140,0.7)' : '#ffd54f'; g.fillRect(Math.round(i) - 2, Math.round(j) - 1, 5, 3); g.fillStyle = m.kind === 'done' ? 'rgba(20,80,20,0.9)' : '#7a4a00'; g.fillRect(Math.round(i) - 1, Math.round(j), 3, 1); }
  }
  const dx = Math.cos(f.heading), dy = -Math.sin(f.heading), px = -dy, py = dx;   // the plane: an arrow pointing the way it flies (north is up)
  g.beginPath(); g.moveTo(50 + dx * 7, 50 + dy * 7); g.lineTo(50 - dx * 4 + px * 4.5, 50 - dy * 4 + py * 4.5); g.lineTo(50 - dx * 1.5, 50 - dy * 1.5); g.lineTo(50 - dx * 4 - px * 4.5, 50 - dy * 4 - py * 4.5); g.closePath();
  g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineJoin = 'round'; g.stroke();
  return left;
}

/** Warm what a world needs (sprites, plane model, the tile sheet) so opening one from Home does not wait on them. */
export function preloadWorld() {
  loadCloudSprites().catch(() => {}); loadFireSprites().catch(() => {}); loadBeaverSprites().catch(() => {}); loadPlaneModel().catch(() => {});
  const im = new Image(); im.src = SHEET_URL;
}
