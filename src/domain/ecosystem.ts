/**
 * Bóbr world map, part 2: the living world. Ported from Android's `EcosystemManager` using its documentation
 * (ECOSYSTEM_DOCUMENTATION.md, ECOSYSTEM_FLAWS_AND_FIXES.md) rather than line by line: the water cycle (evaporation ->
 * clouds in 10 layers -> wind -> rain -> terrain change) and the vegetation ladder SAND -> GRASS -> flowers -> bush/tree -> bigger tree.
 *
 * Differences from Android, on purpose (also in BACKLOG.md):
 *  - Android's own review lists seven bugs in the rain code; they are fixed here by design: a cloud remembers which tiles it
 *    already rained on and only pays for new ones (no 20x repeated tiles), it stays visible until its animation ends, it never
 *    rains with an empty belly, wind on/off is a single flag, rain lands `wind strength` tiles downwind (not `10x`, which put it
 *    100 tiles off-screen) with no extra "travel bonus", and clouds are looked up by their live layer.
 *  - Time-based, not coroutine-based: `step(dt)` is a pure state update, so the whole thing is deterministic under test with a seeded RNG.
 *  - It keeps running while the plane flies (Android paused it for phone performance).
 *  - Android's evaporation numbers were "fast for testing" but still needed minutes; `EVAP_SPEED` speeds them up so a lake visibly
 *    shrinks while you watch.
 */
import { Pond, POND_MAX, type PondEnv } from './hydrology';
import { setPondSurface, lakeWaterAt, LAKE_WATER, LAKE_RIVER } from './lakedistrict';
import { hash01, GRASS, SAND, WATER, DECO_BUSH, DECO_CONIFER, DECO_DECIDUOUS, CHUNK, tileKey, keyX, keyY, plainTile, type World, type Terrain, type TileState, chunkOf } from './worldgen';

export const LAYER_CAPACITY = [1, 2, 3, 5, 8, 13, 8, 21, 3, 1];       // layers 1..10
export const TOTAL_CLOUDS = LAYER_CAPACITY.reduce((a, b) => a + b, 0);   // 65 (Android's docs say 64; its capacities sum to 65)
export const BASE_EVAPORATION = 0.15;
export const EVAP_SPEED = 4;                     // multiplies the evaporation points per second (Android: "fast for testing")
export const EVAPORATION_THRESHOLD = 20;
export const MIN_BODY = 2;                       // smaller puddles never evaporate
export const CLOUD_TICK = 0.2;                   // seconds per cloud update (Android: 200 ms)
export const GROWTH_COOLDOWN = 5;                // seconds between two growths of one tree
export const GROWTH_STEP = 0.15;
export const MAX_SCALE = 4;
export const WIND_TILES_PER_STRENGTH = 0.2;      // cloud speed, tiles/second per unit of wind (0..10)
export const BASE_TEMPERATURE = 20;

export const RIVER_TICK = 0.5;                  // seconds between river planning / flow steps (Android: 500 ms)
export const MIGRATE_TICK = 0.2;                 // single water tiles walk every 200 ms, at most 10 per round
export const MAX_RIVER_TILES = 2000;
export const PUDDLE_MIN = 4, PUDDLE_MAX = 64, PUDDLE_REACH = 20;   // puddles of 4..64 tiles link to the nearest one within 20 tiles
export const FLOOD_CHANCE = 0.01, RIVER_FLOOD_CHANCE = 0.9;        // a rained-on tile turns to water: 1%, or 90% on a river line
export const CLOUD_MARGIN = 24;                 // a cloud this far outside the watched area comes back in on the upwind side
export const REGION = 32;                        // the water budget is kept per 32x32 tiles
export const BUDGET_SPAN = 0.03;                 // a region this far (as a share of its tiles) from its water target gets the full push back
export const REFILL_CHANCE = 0.1;                // rain on land near a lake grows that lake's shore this often (times the region's shortage)
export const SHORE_CHANCE = 0.3;                 // rain on water grows the shore at most this often (times how much water the region is short of)
export const IMPORT_EVERY = 20, IMPORT_BELOW = 6;   // every 20 s, while fewer than 6 clouds are up, one drifts in from upwind (dry land would never see rain otherwise)
// Hilly worlds: rain runs downhill (see `runoff`). A packet of runoff walks to lower ground; tiles it crosses often turn into streams.
export const RUNOFF_BASE = 0.12, RUNOFF_SLOPE = 0.5;   // chance a rained-on tile sheds a packet: this plus RUNOFF_SLOPE per metre of drop to its lowest neighbour (at most 0.7 in all)
export const MAX_PACKETS = 80, PACKET_STEPS = 80;      // packets walking at once, and how far one goes
export const STREAM_AT = 3, TRICKLE_CAP = 12, TRICKLE_DECAY = 0.04, DRY_AT = 0.5;   // passes before a tile turns to stream; the most a tile counts; lost per second; below this a stream dries
export const MAX_STREAM_TILES = 1500;
// Irrigation: water and runoff-wet ground feed the land around them, which climbs the vegetation ladder there (see `irrigate`).
export const IRRIGATE_TICK = 1, IRRIGATE_SOURCES = 8;   // seconds between irrigation rounds; shore tiles worked per round (runoff and stream tiles come on top)
export const IRRIGATE_CHANCE = 0.15, IRRIGATE_REACH = 2;   // chance a source irrigates one tile this round; how far (tiles)
// Becks: a line of runoff crossed over and over turns into a narrow stream with stones on its banks (hilly worlds, see `makeBeck`): one tile wide, one line at a time, no other beck within BECK_GAP tiles, never beside sand.
export const BECK_AT = 8, MAX_BECK_TILES = 300, BECK_GAP = 10;       // crossings before a tile in a line turns to beck; becks alive at once
export const BANK_ROCK = 0.45, WATER_ROCK = 0.05;     // chance a grass tile beside a new beck tile becomes a rock; chance an irrigation round near water puts a rock instead of growth
// Tarns: a hollow (or a small real tarn) is a pond with a water level that rain raises and the sun lowers (see `tarnAt`).
export const TARN_VOL = 0.5, TARN_RAIN = 0.05;        // volume (tile-metres) a packet of runoff adds, and rain falling straight on a tarn
export const TARN_EVAP = 0.0006;                      // volume a tarn loses per tile of its area per second
export const TARN_BODY_MAX = 150, MAX_TARNS = 60;     // a real lake bigger than this is left alone; tarns alive at once
export const TARN_MIN_TILES = 6, TARN_MAX_TILES = 40, TARN_MIN_DEPTH = 1;   // a hollow must hold 6 to 40 tiles and be a metre deep at its rim (the map is full of one-tile dips and shallow valley floors that are not tarns)
export const PIT_DEPTH = 0.02;                        // metres every neighbour must stand above a hollow for it to hold water
export const STALL_TICKS = 120;                  // a channel that has not grown for this many river ticks (60 s) is given up
export const FIRE_TICK = 0.25;                  // seconds per fire update
export const MAX_FIRES = 400;                    // tiles burning at once (more simply do not catch)
export const SPREAD_RATE = 0.3;                  // chance per second that a fully flammable neighbour catches, before wind and heat
export const STRIKE_CHANCE = 0.04;               // per cloud tick, for a big cloud raining hard on a mild day
export const STRIKE_LIFE = 0.5;                  // seconds a bolt is shown
export const WET_TIME = 8;                       // seconds a rained-on tile stays too wet to burn
export const DAMP_TIME = 45;                      // after the wet (WET_TIME) the ground stays damp this long: fire spreads less and less easily as it dries
export const SHORE_DAMP = [0.7, 0.5];            // ground next to water (1 tile away) or near it (2 tiles away) is this damp all the time
export const DAMP_BLOCK = 0.9;                   // a fully damp tile catches this much less often
export const FIRE_PULL = 0.3, FIRE_PULL_REACH = 30, FIRE_PULL_FULL = 1.5;   // big fires pull every cloud: strength, reach (tiles), and the pull sum (n^1.5 / d^2) at which it is full
export const FIRE_RAIN_K = 10;                   // a cloud starts raining 1 + (fires near it) / this times as often; fires near it also stand in for its age
export const FIRE_NEAR = 10;                     // tiles: fires this close to a cloud's rain count as "near"
export const FIRE_CLOUD_MIN = 12;                // a fire block (8x8) with this many fires burning makes its own cloud now and then
export const FIRE_CLOUD_COOLDOWN = 25;           // seconds before the same block makes another
export const FIRE_CLOUD_CAP = 6;                 // fire clouds alive at once
export const SCORCH_COOLDOWN = 45;
export const RAIN_SCALE = 2.6;                    // how much wider the rain falls than the original 1 / 2 / 3 tile radii
/** The radius (tiles) rain falls over, growing as the cloud's rain does (`rain` 0..1). */
export const rainRadius = (rain: number) => (rain < 0.4 ? 1 : rain < 0.75 ? 2 : 3) * RAIN_SCALE;               // seconds before a burnt tile can burn again
const CELL = 8;                                  // sand is summed per 8x8 block for the cloud attraction

/** A planned channel from a smaller puddle to a bigger one; water grows along `path` one tile per tick. */
export interface Connection { from: number; to: number; path: [number, number][]; done: boolean; stalled?: number }

export interface Wind { enabled: boolean; strength: number; dir: number }   // dir in radians: 0 east, pi/2 north
export const defaultWind = (): Wind => ({ enabled: true, strength: 2, dir: 0 });
export interface Cloud {
  id: number; x: number; y: number; layer: number; water: number; size: number; age: number;
  raining: boolean; rain: number; prevRain: number; rained: Set<number>;
  /** Half the clouds are drawn to sand (heat rising), like Android's attraction types; all are drawn to rivers. */
  toSand: boolean;
  /** Made by a big fire (see `FIRE_CLOUD_MIN`). */
  fire?: boolean;
  /** Cached attraction pull (recomputed every few ticks, applied every tick). */
  ax?: number; ay?: number;
  /** Slowly changing wander, and the eased position the picture is drawn at (the simulation steps five times a second; the picture glides between steps). */
  wx?: number; wy?: number; rx?: number; ry?: number;
  /** What is drawn, eased: the layer as a fraction (so a change of layer glides) and how present the cloud is (0..1: it fades in when it arrives or wraps, out as its rain ends). */
  rl?: number; fade?: number;
}
export interface Random01 { (): number }
/** One burning tile: `fuel` seconds left of `total`. */
export interface Fire { x: number; y: number; fuel: number; total: number; age: number }
/** A lightning bolt, shown for `STRIKE_LIFE` seconds: from the cloud at (cx, cy) on `layer` down to the middle of tile (x, y). */
export interface Strike { id: number; x: number; y: number; cx: number; cy: number; layer: number; age: number; lit: boolean }

/** How easily a tile catches fire (0 = never): water and sand never, grass poorly, bushes and trees well. */
export function flammability(st: TileState): number {
  if (st.t !== GRASS) return 0;
  if (st.d === DECO_BUSH) return 0.6;
  if (st.d === DECO_CONIFER) return 0.85;
  if (st.d === DECO_DECIDUOUS) return 0.7;
  return st.v === 1 ? 0.18 : st.v === 2 ? 0.05 : 0.12;               // flowers, a rock in the grass, plain grass
}
/** Seconds a tile burns: grass flashes over, a bush lasts longer, a tree longer still the bigger it has grown. */
export const fuelOf = (st: TileState) => (st.d === DECO_BUSH ? 5 : st.d ? 6 + 2 * st.s : st.v === 1 ? 2.5 : 2);
const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const NEIGH8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Sun-driven temperature: warmest at noon, coldest at midnight, plus heat waves and cold snaps. */
export const diurnalTemperature = (hour: number) => BASE_TEMPERATURE + 6 * Math.sin(((hour - 6) / 24) * 2 * Math.PI);
export const evaporationFactor = (temp: number) => Math.max(0.25, Math.min(2.5, 1 + (temp - BASE_TEMPERATURE) / 15));
/** Chance weight that a cloud starts raining by layer: none below 5, 20% at 5 up to 100% at 10. */
export const layerRainChance = (layer: number) => (layer < 5 ? 0 : 0.2 + (0.8 * (layer - 5)) / 5);

export interface Weather { kind: 'heat' | 'cold'; left: number }

/** Running totals since the ecosystem started: what the simulation did, not what the map holds (that is `census` in ecostats.ts). */
export interface EcoTally {
  evaporated: number;   // water tiles that dried into a cloud
  rained: number;       // tiles rain fell on (each tile once per cloud)
  toWater: number;      // land tiles that became water, by any cause (rain, rivers, flooding, painting)
  fromWater: number;    // water tiles that became land, by any cause (evaporation, lone tiles walking, painting)
  grown: number;        // steps up the vegetation ladder (sand -> grass -> flowers -> bush/tree -> bigger)
  strikes: number;      // lightning bolts
  ignited: number;      // tiles set alight (by bolts, spreading and embers)
  burnt: number;        // fires that burnt out
  imported: number;     // clouds that drifted in from outside (`IMPORT_EVERY`)
  irrigated: number;    // tiles that water or runoff-wet ground grew (the same steps as rain)
  becks: number;        // tiles runoff turned into a beck
  bankRocks: number;    // rocks put beside becks and other water
  fireClouds: number;   // clouds a big fire made for itself
  fireRain: number;     // clouds that began raining with a fire near them
  doused: number;       // fires put out by rain or wet ground (as opposed to `burnt`: out of fuel)
  damped: number;       // spread, ember and bolt ignitions that damp ground refused
  /** `toWater` split by the rule that did it (each flooded tile counts once, under the rule that started the change). */
  toWaterBy: Record<WaterCause, number>;
}
/**
 * Why a land tile became water: `rain` a rained-on tile flooded (1%, 90% on a river line, plus what that set off), `shore` rain on water
 * grew the nearest shore, `surrounded` the periodic 3-water-sides sweep, `settle` a tile between water and the other land type was filled
 * (no tile art for it), `river` a channel grew, `walk` a lone tile moved, `paint` the paint tool, `dam` a pond grew behind a beaver dam.
 */
export type WaterCause = 'rain' | 'shore' | 'surrounded' | 'settle' | 'river' | 'walk' | 'paint' | 'dam' | 'stream';
export const WATER_CAUSES: WaterCause[] = ['rain', 'shore', 'surrounded', 'settle', 'river', 'walk', 'paint', 'dam', 'stream'];
export const newTally = (): EcoTally => ({ evaporated: 0, rained: 0, toWater: 0, fromWater: 0, grown: 0, strikes: 0, ignited: 0, burnt: 0, imported: 0, irrigated: 0, becks: 0, bankRocks: 0, fireClouds: 0, fireRain: 0, doused: 0, damped: 0, toWaterBy: { rain: 0, shore: 0, surrounded: 0, settle: 0, river: 0, walk: 0, paint: 0, dam: 0, stream: 0 } });

export class Ecosystem {
  readonly world: World;
  wind: Wind;
  clouds: Cloud[] = [];
  hour = 12;
  weather: Weather | null = null;
  /** Tracked water tiles (the area being watched) with their evaporation points. */
  private water = new Map<number, number>();
  private rng: Random01;
  private nextId = 1;
  private clock = 0;
  private cloudAcc = 0;
  private evapAcc = 0;
  private sweepAcc = 0;
  private scanAcc = 99;
  private lastGrow = new Map<number, number>();
  /** The area to simulate, in tiles (inclusive). Set by the view each frame. */
  private area = { x0: 0, y0: 0, x1: -1, y1: -1 };
  private scannedVersion = -1;
  /** The world version after our own last change: anything else touching the world means a rescan. */
  private knownVersion = -1;
  private areaDirty = true;
  /** Lone water tiles (no water neighbour), kept up to date as tiles change instead of searched for. */
  private lone = new Set<number>();
  /** Land tiles that may now have 3 water sides: filled by changes, drained by the flooding sweep. */
  private floodCand = new Set<number>();
  private sweepIter: Iterator<number> | null = null;
  private bodiesCache: { tiles: number[]; cx: number; cy: number; radius: number }[] = [];
  private bodiesAt = -Infinity;
  private riverCells = new Map<number, { n: number; sx: number; sy: number; t: number[] }>();
  private riverVersion = 0;
  private riverBuilt = -1;
  private tickNo = 0;
  private expandBudget = 3;
  private migrateFrom = 0;
  /** Lone tiles that already have a river line planned for them (planning again every round gave the same line). */
  private lonePlanned = new Set<number>();
  private evapPhase = 0;
  /** A scan of a new area runs a few rows per step instead of all at once, so crossing a chunk border never hitches. */
  private job: { y: number; area: { x0: number; y0: number; x1: number; y1: number }; water: Map<number, number>; cells: Map<number, { n: number; sx: number; sy: number }> } | null = null;
  /** River lines: tiles that flood easily and pull clouds towards them. */
  readonly riverTiles = new Set<number>();
  connections: Connection[] = [];
  private sandCells = new Map<number, { n: number; sx: number; sy: number }>();
  private riverAcc = 0;
  /** Hilly worlds: runoff on its way downhill, how often each tile has been crossed lately, and the stream tiles rain made. */
  private packets: { x: number; y: number; n: number }[] = [];
  private trickle = new Map<number, number>();
  /** The stream tiles that are becks (a subset of `streams`: dried by the same rule). */
  private readonly becks = new Map<number, number>();   // tile key -> the id of the line it belongs to
  private beckLines = 0;
  private irrigAcc = 0;
  private cursors = new Map<string, Iterator<number>>();
  readonly streams = new Set<number>();
  /** Tarns: ponds without a dam. `tarnOf` finds the one a tile belongs to; `noTarn` remembers water that is not a small lake. */
  readonly tarns = new Set<{ pond: Pond; vol: number }>();
  private tarnOf = new Map<number, { pond: Pond; vol: number }>();
  private noTarn = new Set<number>();
  private runoffAcc = 0;
  private migrateAcc = 0;
  /** Tiles that changed since the last time the renderer asked (to redraw the chunks that hold them). */
  readonly dirty = new Set<number>();
  /** Burning tiles, by tile key. */
  readonly fires = new Map<number, Fire>();
  /** Bolts still on show (newest last). */
  strikes: Strike[] = [];
  readonly wetUntil = new Map<number, number>();   // tiles the rain has wetted, and until when (the map draws them wet)
  /** Until when each rained-on or runoff tile is still damp (wet time plus `DAMP_TIME`): `moisture` fades with it. */
  private readonly dampUntil = new Map<number, number>();
  /** Fires summed per 8x8 block, for the pull on clouds and for fire clouds; rebuilt at most once per `clock` value. */
  private fireCells = new Map<number, { n: number; sx: number; sy: number }>();
  private fireCellsAt = -1;
  private fireCloudAt = new Map<number, number>();   // block key -> clock until which it makes no new cloud
  /** Charred tiles: tile key -> the time (`now`) the fire on it went out. Forgotten after `SCORCH_COOLDOWN`. */
  readonly scorched = new Map<number, number>();
  private fireAcc = 0;
  private importAcc = 0;
  /** Running totals (see `EcoTally`). */
  readonly tally: EcoTally = newTally();
  /** The rule now changing tiles, for `tally.toWaterBy`. */
  private cause: WaterCause = 'paint';
  /**
   * The water budget, per region: `target` is the water the generator put there (the lakes and seas the seed made), `cur` what is
   * there now. Rain only adds water to a region short of its target, and a region over it evaporates faster, so the map keeps its
   * lakes roughly where they were (they may still wander inside a region). Counted on first use, then kept up to date by `put`.
   */
  private regions = new Map<number, { target: number; cur: number }>();
  /** Extra water tiles a region should hold on top of what the seed gave it (beaver dams), by region key. */
  private targetBonus = new Map<number, number>();
  private by<R>(cause: WaterCause, fn: () => R): R { const was = this.cause; this.cause = cause; try { return fn(); } finally { this.cause = was; } }

  constructor(world: World, rng: Random01 = Math.random, wind: Wind = defaultWind()) {
    this.world = world; this.rng = rng; this.wind = wind;
  }

  get temperature() { return diurnalTemperature(this.hour) + (this.weather ? (this.weather.kind === 'heat' ? 10 : -10) : 0); }
  get windSpeed() { return this.wind.enabled ? this.wind.strength * WIND_TILES_PER_STRENGTH : 0; }
  setWatchedArea(x0: number, y0: number, x1: number, y1: number) {
    const a = this.area;
    if (a.x0 !== x0 || a.y0 !== y0 || a.x1 !== x1 || a.y1 !== y1) { this.area = { x0, y0, x1, y1 }; this.areaDirty = true; }   // only a new area needs a full scan
  }
  get waterTiles() { return this.water.size; }
  /** The area being simulated (inclusive tiles; x1 < x0 until the view has set one). */
  get watchedArea(): { x0: number; y0: number; x1: number; y1: number } { return { ...this.area }; }
  /** Seconds this ecosystem has been running. */
  get now() { return this.clock; }

  private layerCount(layer: number) { let n = 0; for (const c of this.clouds) if (c.layer === layer) n++; return n; }
  /** The chunk of a changed tile needs a redraw, and so does every chunk that draws this tile as a neighbour (edges and corners: transitions look at all 8 sides). */
  private mark(x: number, y: number) {
    const cx = chunkOf(x), cy = chunkOf(y), lx = x - cx * CHUNK, ly = y - cy * CHUNK;
    const ex = lx === 0 ? -1 : lx === CHUNK - 1 ? 1 : 0, ey = ly === 0 ? -1 : ly === CHUNK - 1 ? 1 : 0;
    this.dirty.add(tileKey(cx, cy));
    if (ex) this.dirty.add(tileKey(cx + ex, cy));
    if (ey) this.dirty.add(tileKey(cx, cy + ey));
    if (ex && ey) this.dirty.add(tileKey(cx + ex, cy + ey));
  }
  /** A tile changed by something living in it (a gnawing beaver): the renderer is told, like for any change. */
  edit(x: number, y: number, s: TileState) { this.put(x, y, s); }
  /** Change one tile by hand (the paint tool) and tell the renderer. */
  paint(x: number, y: number, t: Terrain) { this.put(x, y, plainTile(t)); }
  private put(x: number, y: number, s: TileState) {
    const was = this.world.terrainAt(x, y);
    if (this.world.kind === 'lakedistrict' && (s.t === WATER) !== (was === WATER) && this.cause !== 'paint' && this.cause !== 'dam' && this.cause !== 'stream') return;   // a real map's lakes and shores stay where they are: no rain puddles on the fells, no rivers wandering, no drying up (beaver dams and the paint tool still make ponds)
    this.world.set(x, y, s); this.mark(x, y);
    this.knownVersion = this.world.version;
    if (was !== s.t) {
      if (s.t === WATER) { this.tally.toWater++; this.tally.toWaterBy[this.cause]++; } else if (was === WATER) this.tally.fromWater++;
      if (s.t === WATER || was === WATER) { const r = this.regions.get(tileKey(Math.floor(x / REGION), Math.floor(y / REGION))); if (r) r.cur += s.t === WATER ? 1 : -1; }
      this.track(x, y, was, s.t); this.settle(x, y);
    }
  }
  private settling = false;
  private touches(x: number, y: number, t: Terrain) { return this.terrainAt(x + 1, y) === t || this.terrainAt(x - 1, y) === t || this.terrainAt(x, y + 1) === t || this.terrainAt(x, y - 1) === t; }
  /**
   * The tile set has no art for a land tile that meets water on one side and the other land type on another (grass between
   * water and sand, or sand between water and grass). The generator never makes one: its shores are sand at least two tiles deep.
   * So the shore is made sand like that: grass touching water and sand becomes sand, and grass behind a shore sand tile that also
   * touches grass becomes sand too, and the check repeats round every tile changed. Plain shores (grass or sand against water only)
   * are fine and untouched. (It used to fill such tiles with water instead; the phase 0 soak run showed that one rule drowned most
   * of every world within half an hour, see ROADMAP.md.)
   */
  private settle(x: number, y: number) {
    if (this.settling) return;
    this.settling = true;
    const was = this.cause; this.cause = 'settle';
    try {
      const queue: [number, number][] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) queue.push([x + dx, y + dy]);
      let guard = 0;
      while (queue.length && guard++ < 400) {
        const [gx, gy] = queue.shift()!, t = this.terrainAt(gx, gy);
        if (t === WATER || !this.touches(gx, gy, WATER) || !this.touches(gx, gy, t === GRASS ? SAND : GRASS)) continue;
        const turn: [number, number][] = t === GRASS ? [[gx, gy]] : N4.map(([ax, ay]) => [gx + ax, gy + ay] as [number, number]).filter(([ax, ay]) => this.terrainAt(ax, ay) === GRASS);
        for (const [ax, ay] of turn) {
          this.put(ax, ay, plainTile(SAND));
          queue.push([ax, ay]);
          for (const [bx, by] of N4) queue.push([ax + bx, ay + by]);
        }
      }
    } finally { this.settling = false; this.cause = was; }
  }
  private inArea(x: number, y: number) { const a = this.area; return x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1; }
  /** Keep the water set, sand blocks, lone tiles and flooding candidates in step with one changed tile (no rescan). */
  private track(x: number, y: number, was: Terrain, now: Terrain) {
    const k = tileKey(x, y);
    if (was === WATER) this.water.delete(k);
    const job = this.job;
    if (job && y >= job.area.y0 && y < job.y && x >= job.area.x0 && x <= job.area.x1) {   // the part of the new scan already done
      if (was === WATER) job.water.delete(k);
      if (now === WATER) job.water.set(k, 0);
      this.adjustSand(job.cells, x, y, was, now);
    }
    if (!this.inArea(x, y)) return;
    if (now === WATER) this.water.set(k, 0);
    this.adjustSand(this.sandCells, x, y, was, now);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = tileKey(x + dx, y + dy);
      this.refreshLone(x + dx, y + dy, nk);
      if (now === WATER) this.floodCand.add(nk);
    }
  }
  private adjustSand(cells: Map<number, { n: number; sx: number; sy: number }>, x: number, y: number, was: Terrain, now: Terrain) {
    const ck = tileKey(Math.floor(x / CELL), Math.floor(y / CELL));
    if (was === SAND) { const c = cells.get(ck); if (c) { c.n--; c.sx -= x; c.sy -= y; if (c.n <= 0) cells.delete(ck); } }
    if (now === SAND) { const c = cells.get(ck); if (c) { c.n++; c.sx += x; c.sy += y; } else cells.set(ck, { n: 1, sx: x, sy: y }); }
  }
  private refreshLone(x: number, y: number, k = tileKey(x, y)) {
    // `wet`, not the tracked set: water just outside the watched area still counts as a neighbour (a lake cut by the border is not a lone tile)
    if (this.water.has(k) && !this.wet(x + 1, y) && !this.wet(x - 1, y) && !this.wet(x, y + 1) && !this.wet(x, y - 1)) this.lone.add(k); else this.lone.delete(k);
  }
  private terrainAt(x: number, y: number) { return this.world.terrainAt(x, y); }

  // ---- stepping ---------------------------------------------------------------------------------------------------------

  step(dt: number): void {
    dt = Math.min(dt, 0.5);
    this.clock += dt;
    this.stepWeather(dt);
    this.scanAcc += dt;
    if (this.world.version !== this.knownVersion) this.regions.clear();                                    // someone else changed the world: count again
    if (this.areaDirty || this.scanAcc >= 20 || this.world.version !== this.knownVersion) this.startScan();   // normally nothing: changes are tracked as they happen
    if (this.job) this.stepScan(this.scannedVersion < 0 ? 1e9 : 8);                                        // the first scan is done at once, later ones 8 rows a step
    this.evapAcc += dt;
    if (this.evapAcc >= 0.25) { this.evaporate(this.evapAcc * 4); this.evapAcc = 0; }                      // a quarter of the shore each time, at 4x the points
    this.cloudAcc += dt;
    while (this.cloudAcc >= CLOUD_TICK) { this.cloudAcc -= CLOUD_TICK; this.tickNo++; this.stepClouds(CLOUD_TICK); }
    this.importAcc += dt;
    if (this.importAcc >= IMPORT_EVERY) { this.importAcc = 0; this.importCloud(); }
    this.riverAcc += dt;
    if (this.riverAcc >= RIVER_TICK) { this.riverAcc = 0; if (this.hilly) { this.dryStreams(); this.stepTarns(); } else { this.connectPuddles(); this.flowRivers(); } }
    this.migrateAcc += dt;
    if (this.migrateAcc >= MIGRATE_TICK) { this.migrateAcc = 0; if (this.hilly) this.runoff(); else this.migrateSingles(); }
    if (this.strikes.length) { for (const b of this.strikes) b.age += dt; this.strikes = this.strikes.filter(b => b.age < STRIKE_LIFE); }
    this.fireAcc += dt;
    if (this.fireAcc >= FIRE_TICK) { if (this.fires.size) this.stepFires(this.fireAcc); this.fireAcc = 0; }
    this.irrigAcc += dt;
    if (this.irrigAcc >= IRRIGATE_TICK) { this.irrigAcc = 0; this.irrigate(); }
    this.sweepAcc += dt;
    if (this.sweepAcc >= 3) { this.sweepAcc = 0; this.sweepFlooding(); this.pruneGrowth(); }
  }

  /** A growth time older than the cooldown says the same as none at all: forget it, so the map does not grow with every tree ever rained on. */
  private pruneGrowth() {
    for (const [k, at] of this.lastGrow) if (this.clock - at >= GROWTH_COOLDOWN) this.lastGrow.delete(k);
    for (const [k, until] of this.wetUntil) if (until <= this.clock) this.wetUntil.delete(k);
    for (const [k, until] of this.dampUntil) if (until <= this.clock) this.dampUntil.delete(k);
    for (const [k, until] of this.fireCloudAt) if (until <= this.clock) this.fireCloudAt.delete(k);
    for (const [k, at] of this.scorched) if (this.clock - at >= SCORCH_COOLDOWN) this.scorched.delete(k);
  }

  private stepWeather(dt: number) {
    if (this.weather) { this.weather.left -= dt; if (this.weather.left <= 0) this.weather = null; }
    else if (this.rng() < dt / 150) this.weather = { kind: this.rng() < 0.5 ? 'heat' : 'cold', left: 40 + this.rng() * 50 };
  }

  /** Begin (re)scanning the watched area for water and sand. A changed world or area restarts it. */
  private startScan() {
    this.scanAcc = 0; this.areaDirty = false; this.knownVersion = this.world.version;
    this.job = { y: this.area.y0, area: { ...this.area }, water: new Map(), cells: new Map() };
  }
  /** Scan `rows` rows of the running scan; when done the result replaces the tracked sets (keeping evaporation points). */
  private stepScan(rows: number) {
    const job = this.job!, { x0, x1, y1 } = job.area;
    const end = Math.min(y1 + 1, job.y + rows);
    for (let y = job.y; y < end; y++) for (let x = x0; x <= x1; x++) {
      const t = this.terrainAt(x, y);
      if (t === WATER) { const k = tileKey(x, y); job.water.set(k, this.water.get(k) ?? 0); }
      else if (t === SAND) this.adjustSand(job.cells, x, y, WATER, SAND);
    }
    job.y = end;
    if (job.y <= y1) return;
    this.water = job.water; this.sandCells = job.cells; this.job = null;
    this.scannedVersion = this.world.version; this.bodiesAt = -Infinity;
    this.sweepIter = null;                                          // it walked the old map
    this.lone.clear();
    for (const k of this.water.keys()) this.refreshLone(keyX(k), keyY(k), k);
  }

  /** Water bodies by flood fill over the tracked tiles, with centre and radius; recomputed at most once a second. Runs on a flat grid of the tiles' bounding box, not on maps. */
  private bodies(): { tiles: number[]; cx: number; cy: number; radius: number }[] {
    if (this.clock - this.bodiesAt < 1) return this.bodiesCache;
    this.bodiesAt = this.clock;
    const out: { tiles: number[]; cx: number; cy: number; radius: number }[] = [];
    const n = this.water.size;
    if (n === 0) { this.bodiesCache = out; return out; }
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const k of this.water.keys()) { const x = keyX(k), y = keyY(k); if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    const w = maxx - minx + 1, h = maxy - miny + 1, grid = new Uint8Array(w * h), stack = new Int32Array(n + 4);
    const starts: number[] = [];
    for (const k of this.water.keys()) { const i = (keyY(k) - miny) * w + (keyX(k) - minx); grid[i] = 1; starts.push(i); }
    for (const start of starts) {
      if (grid[start] !== 1) continue;
      const tiles: number[] = [], idxs: number[] = [];
      let sp = 0, sx = 0, sy = 0;
      stack[sp++] = start; grid[start] = 2;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i / w) | 0;
        idxs.push(i); sx += x; sy += y;
        if (x + 1 < w && grid[i + 1] === 1) { grid[i + 1] = 2; stack[sp++] = i + 1; }
        if (x > 0 && grid[i - 1] === 1) { grid[i - 1] = 2; stack[sp++] = i - 1; }
        if (y + 1 < h && grid[i + w] === 1) { grid[i + w] = 2; stack[sp++] = i + w; }
        if (y > 0 && grid[i - w] === 1) { grid[i - w] = 2; stack[sp++] = i - w; }
      }
      const cxl = sx / idxs.length, cyl = sy / idxs.length;
      let r2 = 0;
      for (const i of idxs) { const dx = (i % w) - cxl, dy = ((i / w) | 0) - cyl; if (dx * dx + dy * dy > r2) r2 = dx * dx + dy * dy; tiles.push(tileKey(minx + (i % w), miny + ((i / w) | 0))); }
      out.push({ tiles, cx: cxl + minx, cy: cyl + miny, radius: Math.sqrt(r2) });
    }
    this.bodiesCache = out;
    return out;
  }

  private region(x: number, y: number) {
    const rx = Math.floor(x / REGION), ry = Math.floor(y / REGION), k = tileKey(rx, ry);
    let r = this.regions.get(k);
    if (!r) {
      r = { target: this.targetBonus.get(k) ?? 0, cur: 0 };
      for (let j = 0; j < REGION; j++) for (let i = 0; i < REGION; i++) {
        const tx = rx * REGION + i, ty = ry * REGION + j;
        if (this.world.generatedTerrain(tx, ty) === WATER) r.target++;
        if (this.terrainAt(tx, ty) === WATER) r.cur++;
      }
      this.regions.set(k, r);
      if (this.regions.size > 160) this.regions.delete(this.regions.keys().next().value!);   // (only the regions round the player matter)
    }
    return r;
  }
  /**
   * A beaver dam holds water: the region of (x, y) aims for `n` more water tiles than the seed gave it (negative takes it back).
   * The budget rules then let rain and shore growth fill a pond there instead of pulling it back.
   */
  addWaterTarget(x: number, y: number, n: number): void {
    const k = tileKey(Math.floor(x / REGION), Math.floor(y / REGION));
    this.targetBonus.set(k, (this.targetBonus.get(k) ?? 0) + n);
    const r = this.regions.get(k); if (r) r.target += n;
  }
  /** The pond behind a dam at (x, y) grows by one shore tile, if its region still wants water. True if a tile flooded. */
  growPond(x: number, y: number): boolean {
    if (this.wantWater(x, y) <= 0) return false;
    const before = this.tally.toWater;
    this.by('dam', () => this.expandWater(x, y));
    return this.tally.toWater > before;
  }
  /** A hilly world: ponds follow the ground (see hydrology.ts) instead of the region budget. */
  get hilly() { return this.world.kind === 'lakedistrict'; }
  /** What a pond asks about the ground; `ok` says which tiles it may flood (the dam's upstream side). */
  pondEnv(ok: (x: number, y: number) => boolean): PondEnv {
    return { h: (x, y) => this.world.metresAt(x, y), wet: (x, y) => this.terrainAt(x, y) === WATER, ok, lake: (x, y) => lakeWaterAt(x, y) === LAKE_WATER };
  }
  private redrawPond(p: Pond, extra?: [number, number]) {
    setPondSurface(p.tiles, p.level);
    for (const [x, y] of p.tiles) this.mark(x, y);
    if (extra) this.mark(extra[0], extra[1]);
  }
  /** The pond floods its next tile, the whole sheet rising to that ground. True if it did. */
  growHeightPond(p: Pond): boolean {
    const t = p.grow(); if (!t) return false;
    this.by('dam', () => this.put(t[0], t[1], plainTile(WATER)));
    this.redrawPond(p);
    return true;
  }
  /** A full pond (its next ground is a rim over which the water runs out) lets some run on downhill from there: a packet of runoff from just outside the rim. */
  spillHeightPond(p: Pond): void {
    if (p.spill && p.spillTo && this.packets.length < MAX_PACKETS) this.packets.push({ x: p.spillTo[0], y: p.spillTo[1], n: 0 });
  }
  /** The pond gives its highest tile back to the land, if it stands above its cap (a broken dam). True if it did. */
  drainHeightPond(p: Pond): boolean {
    if (!p.over) return false;
    const t = p.shrink(); if (!t) return false;
    setPondSurface([t], null);
    this.by('dam', () => this.put(t[0], t[1], plainTile(this.world.generatedTerrain(t[0], t[1]) === WATER ? SAND : this.world.generatedTerrain(t[0], t[1]))));
    this.redrawPond(p, t);
    return true;
  }
  /** A saved pond coming back: take over the water tiles it had (made water joined to the seed, on its side of the dam). */
  adoptPond(p: Pond): void {
    const found: [number, number][] = [], seen = new Set<number>(), stack: [number, number][] = [[p.sx, p.sy]];
    while (stack.length && found.length < POND_MAX) {
      const [x, y] = stack.pop()!, k = tileKey(x, y);
      if (seen.has(k)) continue; seen.add(k);
      const made = this.terrainAt(x, y) === WATER && this.world.generatedTerrain(x, y) !== WATER;
      if (!made && (x !== p.sx || y !== p.sy)) continue;
      if (made && p.okTile(x, y)) found.push([x, y]);
      for (const [dx, dy] of N4) stack.push([x + dx, y + dy]);
    }
    p.adopt(found); this.redrawPond(p);
  }
  /** How much water the region of (x, y) is short of its target, as a share of its tiles (negative: it has too much). */
  waterShortage(x: number, y: number): number { const r = this.region(x, y); return (r.target - r.cur) / (REGION * REGION); }
  /**
   * How far the region of (x, y) is from its water target, scaled so that +-1 is the full push back: short (or over) by `BUDGET_SPAN`
   * of its tiles, or by a quarter of its own target if that is less (a region of small ponds would otherwise lose most of them before
   * the budget noticed). Positive: it wants water.
   */
  budgetPull(x: number, y: number): number {
    const r = this.region(x, y), span = Math.max(4, Math.min(BUDGET_SPAN * REGION * REGION, 0.25 * r.target));
    return Math.max(-1, Math.min(1, (r.target - r.cur) / span));
  }
  /** 0..1: how hard rain may add water here (0 at or over the region's target). */
  private wantWater(x: number, y: number) { return Math.max(0, this.budgetPull(x, y)); }

  /** Water here, as the tracked set knows it; outside the watched area it asks the world. */
  private wet(x: number, y: number) { return this.water.has(tileKey(x, y)) || (!this.inArea(x, y) && this.terrainAt(x, y) === WATER); }

  /** `dt` is the time since the last call times 4, because each call handles only the quarter of the shore whose tiles hash to this phase. */
  private evaporate(dt: number) {
    const temp = evaporationFactor(this.temperature), phase = this.evapPhase = (this.evapPhase + 1) & 3;
    for (const body of this.bodies()) {
      const size = body.tiles.length;
      if (size < MIN_BODY) continue;
      const sizeFactor = 1 + Math.min(size, 300) / 150;             // larger lakes evaporate faster
      const inner = body.radius * 0.7;
      for (const k of body.tiles) {
        const x = keyX(k), y = keyY(k);
        if (((x * 7 + y * 13) & 3) !== phase) continue;
        if (!this.water.has(k)) continue;                             // dried or changed since the bodies were listed
        if (this.wet(x + 1, y) && this.wet(x - 1, y) && this.wet(x, y + 1) && this.wet(x, y - 1)) continue;   // only the shore evaporates
        if (size > MIN_BODY && Math.hypot(x - body.cx, y - body.cy) < inner) continue;   // big lakes: the outer 30% of the radius
        const pull = this.budgetPull(x, y), budget = pull > 0 ? Math.max(0.05, 1 - pull) : 1 - 2 * pull;   // a region short of water nearly stops drying, one over its target dries faster
        const pts = (this.water.get(k) ?? 0) + BASE_EVAPORATION * EVAP_SPEED * temp * sizeFactor * budget * dt;
        if (pts >= EVAPORATION_THRESHOLD) {   // a grass shore dries to grass: sand there would start a beach all round the lake (see `settle`)
          this.tally.evaporated++;
          if (this.hilly) { this.water.set(k, 0); this.spawnCloud(x + 0.5, y + 0.5, 0.5 + this.rng() * 0.5); continue; }   // a real map's lakes, streams and dam ponds feed clouds but keep their water (streams dry by their own rule, ponds by their level)
          this.put(x, y, plainTile(this.touches(x, y, GRASS) && !this.touches(x, y, SAND) ? GRASS : SAND)); this.spawnCloud(x + 0.5, y + 0.5, 0.5 + this.rng() * 0.5); }
        else this.water.set(k, pts);
      }
    }
  }

  /** A cloud from somewhere else: it appears just outside the watched area on the upwind side (any side in calm air) and blows in. */
  private importCloud() {
    const a = this.area;
    if (a.x1 < a.x0 || this.clouds.length >= IMPORT_BELOW) return;
    const cx = (a.x0 + a.x1 + 1) / 2, cy = (a.y0 + a.y1 + 1) / 2, hw = (a.x1 - a.x0 + 1) / 2, hh = (a.y1 - a.y0 + 1) / 2;
    const dir = this.wind.enabled && this.wind.strength > 0.1 ? this.wind.dir : this.rng() * Math.PI * 2;
    const ux = Math.cos(dir), uy = -Math.sin(dir), back = Math.min(hw / Math.max(1e-6, Math.abs(ux)), hh / Math.max(1e-6, Math.abs(uy))) + 4;   // to the edge of the area, then a little past it
    const side = (this.rng() - 0.5) * 2 * Math.min(hw, hh);
    // straight into a rain layer (6..9): an evaporated cloud starts at the top and only sinks when the layers below fill up, which a few clouds never do
    const layer = [6, 7, 8, 9].find(l => this.layerCount(l) < LAYER_CAPACITY[l - 1]);
    if (!layer) return;
    this.clouds.push({ id: this.nextId++, x: cx - ux * back - uy * side, y: cy - uy * back + ux * side, layer, water: 0.4 + this.rng() * 0.4, size: [1, 1.5, 2][Math.floor(this.rng() * 3)], age: 20, raining: false, rain: 0, prevRain: 0, rained: new Set(), toSand: this.rng() < 0.5 });
    this.tally.imported++;
  }

  private spawnCloud(x: number, y: number, water: number) {
    for (let layer = 1; layer <= 10; layer++) {
      if (this.layerCount(layer) < LAYER_CAPACITY[layer - 1]) {
        this.clouds.push({ id: this.nextId++, x, y, layer, water, size: [1, 1.5, 2][Math.floor(this.rng() * 3)], age: 0, raining: false, rain: 0, prevRain: 0, rained: new Set(), toSand: this.rng() < 0.5 });
        return;
      }
    }
    // every layer is full (65 clouds): the water joins the nearest cloud instead
    let best: Cloud | null = null, bd = Infinity;
    for (const c of this.clouds) { const d = Math.hypot(c.x - x, c.y - y); if (!c.raining && d < bd) { bd = d; best = c; } }
    if (best) best.water += water;
  }

  private stepClouds(dt: number) {
    const dx = Math.cos(this.wind.dir), dy = -Math.sin(this.wind.dir), sp = this.windSpeed;
    this.expandBudget = 3;
    for (const c of this.clouds) {
      c.age += dt;
      c.x += dx * sp * dt; c.y += dy * sp * dt;
      this.attract(c, dt);
      if (!c.raining && c.layer < 10 && this.layerCount(c.layer) >= LAYER_CAPACITY[c.layer - 1] && this.rng() < 0.3 && this.layerCount(c.layer + 1) < LAYER_CAPACITY[c.layer]) c.layer++;
      if (!c.raining && c.water > 0.05 && c.layer >= 5) {
        const rr = this.wind.enabled ? this.wind.strength : 0, near = this.fireNear(c.x + Math.cos(this.wind.dir) * rr, c.y - Math.sin(this.wind.dir) * rr);   // fires near where its rain would land
        const p = layerRainChance(c.layer) * (1 + rr / 20) * Math.min(1, c.water) * Math.min(1, (c.age + near * 2) / 20) * (1 + near / FIRE_RAIN_K) * 0.01;
        for (let i = 0; i < 3; i++) if (this.rng() < p) { c.raining = true; c.rain = 0.1; c.prevRain = 0; if (near > 0) this.tally.fireRain++; break; }
      }
      if (c.raining) {
        this.stepRain(c);
        // thunder: a cloud raining hard throws a bolt now and then, more from a big cloud and on a hot day; it lands in or just outside the rain
        if (c.rain >= 0.25 && this.rng() < STRIKE_CHANCE * (c.size >= 1.5 ? 1 : 0.5) * this.fireWeather()) {
          const reach = this.wind.enabled ? this.wind.strength : 0, a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * (rainRadius(c.rain) + 4);
          this.strike(c.x + Math.cos(this.wind.dir) * reach + Math.cos(a) * r, c.y - Math.sin(this.wind.dir) * reach + Math.sin(a) * r, c);
        }
      }
    }
    this.wrapClouds();
    this.separateClouds();
    this.clouds = this.clouds.filter(c => !(c.raining && c.rain >= 1));   // gone only when the rain animation has finished
  }

  /**
   * A cloud blown far out of the watched area would rain where nobody is looking and still hold one of the 65 places, so the sky over
   * the player slowly emptied. It comes back in on the opposite side instead, like a new cloud arriving on the wind (raining ones finish first).
   */
  private wrapClouds() {
    const a = this.area;
    if (a.x1 < a.x0 || a.y1 < a.y0) return;                         // no area set
    const lox = a.x0 - CLOUD_MARGIN, hix = a.x1 + 1 + CLOUD_MARGIN, loy = a.y0 - CLOUD_MARGIN, hiy = a.y1 + 1 + CLOUD_MARGIN;
    for (const c of this.clouds) {
      if (c.raining) continue;
      if (c.x < lox || c.x >= hix) c.x = lox + ((((c.x - lox) % (hix - lox)) + (hix - lox)) % (hix - lox));
      if (c.y < loy || c.y >= hiy) c.y = loy + ((((c.y - loy) % (hiy - loy)) + (hiy - loy)) % (hiy - loy));
    }
  }

  /** How hard it is raining at a point (0..1): the rain columns under raining clouds (downwind of the cloud, like the drops), a little wider than the drops you see. */
  rainAt(x: number, y: number, layer?: number): number {   // `layer` (10 = ground .. 1 = highest): a plane above a cloud (a lower layer number) is out of its rain
    const reach = this.wind.enabled ? this.wind.strength : 0, dx = Math.cos(this.wind.dir) * reach, dy = -Math.sin(this.wind.dir) * reach;
    let best = 0;
    for (const c of this.clouds) {
      if (!c.raining || (layer !== undefined && layer < c.layer - 0.5)) continue;
      const r = rainRadius(c.rain) + 3, d = Math.hypot(x - (c.x + dx), y - (c.y + dy));
      if (d < r) best = Math.max(best, (1 - d / r) * (0.4 + 0.6 * c.rain));
    }
    return Math.min(1, best * 1.5);
  }

  private stepRain(c: Cloud) {
    c.prevRain = c.rain;
    c.rain = Math.min(1, c.rain + 0.05);
    if (c.water <= 0) return;                                       // an empty cloud finishes its animation but makes no more rain
    const reach = this.wind.enabled ? this.wind.strength : 0;       // rain lands downwind of where the cloud is now
    const rx = Math.floor(c.x + Math.cos(this.wind.dir) * reach), ry = Math.floor(c.y - Math.sin(this.wind.dir) * reach);   // (floor: the tile the point is in; rounding put the rain half a tile off)
    const radius = rainRadius(c.rain), span = Math.ceil(radius);
    const tiles: [number, number][] = [];
    for (let y = -span; y <= span; y++) for (let x = -span; x <= span; x++) if (x * x + y * y <= radius * radius + 0.5) tiles.push([rx + x, ry + y]);
    for (const [x, y] of tiles) {
      const k = tileKey(x, y);
      this.wetten(k); if (this.fires.delete(k)) this.tally.doused++;   // rain puts a fire out and keeps the tile from catching for a while
      if (c.rained.has(k) || c.water <= 0) continue;
      c.rained.add(k); this.tally.rained++;
      c.water -= 0.05;                                              // each new tile pays 5%; tiles already rained on cost nothing
      if (!this.inArea(x, y) && this.area.x1 >= this.area.x0) continue;   // outside the watched area rain changes nothing: nothing evaporates there, so water would only pile up out of sight
      const flood = (this.riverTiles.has(k) ? RIVER_FLOOD_CHANCE : FLOOD_CHANCE) * this.wantWater(x, y);   // rain on a river line nearly always floods it, if the region wants water
      const land = this.terrainAt(x, y) !== WATER;
      if (land && this.rng() < flood) this.by('rain', () => this.floodTile(x, y));
      else {
        if (land && this.expandBudget > 0 && this.rng() < REFILL_CHANCE * this.wantWater(x, y)) {   // a region short of water: rain running off into the nearest lake grows its shore
          const lake = this.nearestWater(x, y, 8);
          if (lake) { this.expandBudget--; this.by('shore', () => this.expandWater(lake[0], lake[1])); }
        }
        this.rainOn(x, y);
      }
      if (land && this.hilly) this.shed(x, y);
      else if (!land && this.hilly) { const tn = this.tarnOf.get(k); if (tn) tn.vol = Math.min(tn.vol + TARN_RAIN, 40); }
    }
  }

  // ---- what rain does to a tile -------------------------------------------------------------------------------------------

  /** The vegetation ladder (Android docs, "Rain Effects on Terrain"). */
  rainOn(x: number, y: number): void {
    const st = this.world.stateAt(x, y);
    if (st.t === WATER) { if (this.expandBudget > 0 && this.rng() < SHORE_CHANCE * this.wantWater(x, y)) { this.expandBudget--; this.by('shore', () => this.expandWater(x, y)); } return; }   // shore growth costs a ring search each: at most 3 per cloud tick
    if (st.t === SAND) { this.tally.grown++; this.put(x, y, plainTile(GRASS)); this.spreadGrass(x, y); return; }
    if (st.d === 0 && st.v === 2) return;                                                                                    // a rock stays a rock (it used to turn to flowers, which wiped every stone a beck had)
    if (st.d === 0 && st.v !== 1) { this.tally.grown++; this.put(x, y, { t: GRASS, v: 1, d: 0, s: 1 }); this.spreadGrass(x, y); return; }   // plain grass -> flowers
    if (st.d === 0) {                                                                                                          // flowers -> grass with a bush or tree
      const kind = [DECO_BUSH, DECO_CONIFER, DECO_DECIDUOUS][Math.floor(this.rng() * 3)];
      this.tally.grown++; this.put(x, y, { t: GRASS, v: 0, d: kind, s: 1 }); return;
    }
    const k = tileKey(x, y), last = this.lastGrow.get(k) ?? -Infinity;                                                        // grow what is there
    if (st.s < MAX_SCALE && this.clock - last >= GROWTH_COOLDOWN) { this.tally.grown++; this.put(x, y, { ...st, s: Math.min(MAX_SCALE, st.s + GROWTH_STEP) }); this.lastGrow.set(k, this.clock); }
    this.spreadGrass(x, y);
  }

  /** Grass spreads to one neighbouring sand tile. */
  private spreadGrass(x: number, y: number) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 3; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }   // a fair shuffle (sorting by a random comparison is not)
    for (const [dx, dy] of dirs) if (this.terrainAt(x + dx, y + dy) === SAND) { this.put(x + dx, y + dy, plainTile(GRASS)); return; }
  }

  /** The nearest water tile within `r` (Manhattan rings), or null. */
  private nearestWater(x: number, y: number, r: number): [number, number] | null {
    for (let d = 1; d <= r; d++) for (let i = 0; i <= d; i++) {
      const j = d - i;
      for (const [dx, dy] of [[i, j], [-i, j], [i, -j], [-i, -j]]) if (this.terrainAt(x + dx, y + dy) === WATER) return [x + dx, y + dy];
    }
    return null;
  }

  /** Rain on water: the nearest sand (else grass) within 10 tiles becomes water, then flooding is checked around it. */
  private expandWater(x: number, y: number) {
    for (const want of [SAND, GRASS] as Terrain[]) {
      for (let r = 1; r <= 10; r++) {
        for (let d = 0; d <= r; d++) {
          const e = r - d;
          for (const [dx, dy] of [[d, e], [-d, e], [d, -e], [-d, -e]]) {
            if (this.terrainAt(x + dx, y + dy) === want) { this.floodTile(x + dx, y + dy); return; }
          }
        }
      }
    }
  }

  private waterNeighbours(x: number, y: number) {
    return +(this.terrainAt(x + 1, y) === WATER) + +(this.terrainAt(x - 1, y) === WATER) + +(this.terrainAt(x, y + 1) === WATER) + +(this.terrainAt(x, y - 1) === WATER);
  }

  /** Turn a tile into water, then keep going: any sand or grass next to it with 3+ water sides becomes water too. */
  private floodTile(x: number, y: number) {
    const queue: [number, number][] = [[x, y]];
    this.put(x, y, plainTile(WATER));
    let guard = 0;
    while (queue.length && guard++ < 200) {
      const [qx, qy] = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy, t = this.terrainAt(nx, ny);
        if (t !== WATER && this.waterNeighbours(nx, ny) >= 3) { this.put(nx, ny, plainTile(WATER)); queue.push([nx, ny]); }
      }
    }
  }

  /**
   * The periodic "surrounded" rule. Only land touching water can have 3 water sides, so instead of scanning around every water tile
   * (tens of thousands of lookups) it checks the tiles next to recent changes plus a rotating slice of the rest of the shore.
   */
  private sweepFlooding() {
    const todo = [...this.floodCand];
    this.floodCand.clear();
    if (!this.sweepIter) this.sweepIter = this.water.keys();
    for (let i = 0; i < 300; i++) {
      const n = this.sweepIter.next();
      if (n.done) { this.sweepIter = null; break; }
      const x = keyX(n.value), y = keyY(n.value);
      todo.push(tileKey(x + 1, y), tileKey(x - 1, y), tileKey(x, y + 1), tileKey(x, y - 1));
    }
    for (const k of todo) {
      const x = keyX(k), y = keyY(k);
      if (this.terrainAt(x, y) !== WATER && this.waterNeighbours(x, y) >= 3) this.by('surrounded', () => this.floodTile(x, y));
    }
  }

  // ---- thunder and fire ---------------------------------------------------------------------------------------------------
  // Not in Android. Lightning from raining clouds sets vegetation alight; fire eats bushes and trees, runs with the wind, dies on
  // water, sand and wet ground, and leaves bare charred grass, which the rain then climbs back up the vegetation ladder.

  /** Hot, dry weather makes fire likelier and faster (0.5 on a cold night .. 1.8 in a heat wave at noon). */
  fireWeather() { return Math.max(0.5, Math.min(1.8, 1 + (this.temperature - BASE_TEMPERATURE) / 20)); }
  /** Wet the tile: too wet to burn for `WET_TIME`, then damp (burning less and less easily) for `DAMP_TIME` more. */
  private wetten(k: number) { this.wetUntil.set(k, this.clock + WET_TIME); this.dampUntil.set(k, this.clock + WET_TIME + DAMP_TIME); }
  /** 0..1: how hard it is to set this tile alight. 1 while wet, fading to 0 as the damp dries; ground beside water is always damp. */
  moisture(x: number, y: number): number {
    if (this.isWet(x, y)) return 1;
    let m = Math.min(1, ((this.dampUntil.get(tileKey(x, y)) ?? -Infinity) - this.clock) / DAMP_TIME);
    if (m < 0) m = 0;
    if (m < SHORE_DAMP[0]) {
      let near = 3;
      for (let dy = -2; dy <= 2 && near > 1; dy++) for (let dx = -2; dx <= 2; dx++) if (this.terrainAt(x + dx, y + dy) === WATER) { near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy))); if (near === 1) break; }
      if (near <= 2) m = Math.max(m, SHORE_DAMP[near - 1]);
    }
    return m;
  }
  /** A chance that already came up (a spread roll, an ember, a bolt) must still get past damp ground; counts the ones that did not. */
  private catches(x: number, y: number): boolean {
    const m = this.moisture(x, y);
    if (m > 0 && this.rng() < m * DAMP_BLOCK) { this.tally.damped++; return false; }
    return true;
  }
  isWet(x: number, y: number) { return (this.wetUntil.get(tileKey(x, y)) ?? -Infinity) > this.clock; }

  /** Set a tile alight. False when it cannot burn: water, sand, wet from rain, burnt a moment ago, already burning, or too many fires. */
  ignite(x: number, y: number): boolean {
    const k = tileKey(x, y);
    if (this.fires.has(k) || this.fires.size >= MAX_FIRES || this.isWet(x, y) || this.scorched.has(k) && this.clock - this.scorched.get(k)! < SCORCH_COOLDOWN) return false;
    const st = this.world.stateAt(x, y);
    if (flammability(st) <= 0) return false;
    const fuel = fuelOf(st);
    this.fires.set(k, { x, y, fuel, total: fuel, age: 0 });
    this.tally.ignited++;
    return true;
  }

  /** A bolt hits the tile holding (x, y). Trees and bushes nearly always catch, grass seldom; `force` always tries. Returns whether a fire started. */
  strike(x: number, y: number, from?: Cloud, force = false): boolean {
    const tx = Math.floor(x), ty = Math.floor(y), fl = flammability(this.world.stateAt(tx, ty));
    const lit = fl > 0 && (force || (this.rng() < fl * 1.6 * this.fireWeather() && this.catches(tx, ty))) && this.ignite(tx, ty);
    this.tally.strikes++;
    this.strikes.push({ id: this.nextId++, x: tx + 0.5, y: ty + 0.5, cx: from ? from.x : tx + 0.5, cy: from ? from.y : ty + 0.5, layer: from ? from.layer : 7, age: 0, lit });
    return lit;
  }

  /** How much fire is under a point (0..1): the hot air over it lifts the plane. */
  fireHeat(x: number, y: number): number {
    if (!this.fires.size) return 0;
    const ix = Math.floor(x), iy = Math.floor(y);
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (this.fires.has(tileKey(ix + dx, iy + dy))) n += 1 / (1 + dx * dx + dy * dy);
    return Math.min(1, n / 1.5);
  }

  private stepFires(dt: number) {
    const ws = this.wind.enabled ? this.wind.strength : 0, wx = Math.cos(this.wind.dir), wy = -Math.sin(this.wind.dir), hot = this.fireWeather();
    const a = this.area, bounded = a.x1 >= a.x0;
    for (const [k, f] of [...this.fires]) {                           // (a copy: spreading adds to the map)
      const st = this.world.stateAt(f.x, f.y);
      const wet = this.isWet(f.x, f.y);
      if (flammability(st) <= 0 || wet || (bounded && (f.x < a.x0 - 8 || f.x > a.x1 + 8 || f.y < a.y0 - 8 || f.y > a.y1 + 8))) { this.fires.delete(k); if (wet) this.tally.doused++; continue; }   // painted over, rained on, or far from anyone watching
      f.age += dt; f.fuel -= dt;
      for (const [dx, dy] of NEIGH8) {
        const nx = f.x + dx, ny = f.y + dy;
        if (this.fires.has(tileKey(nx, ny))) continue;
        const fl = flammability(this.world.stateAt(nx, ny));
        if (fl <= 0) continue;
        const diag = dx !== 0 && dy !== 0, along = (dx * wx + dy * wy) / (diag ? Math.SQRT2 : 1);   // 1 straight downwind .. -1 against it
        if (this.rng() < fl * SPREAD_RATE * dt * hot * Math.max(0.15, 1 + 0.3 * ws * along) * (diag ? 0.6 : 1) && this.catches(nx, ny)) this.ignite(nx, ny);
      }
      if (ws > 2 && f.total > 4 && this.rng() < 0.012 * ws * dt * hot) {   // a burning bush or tree throws an ember a few tiles downwind
        const d = 2 + this.rng() * 2;
        const ex = Math.round(f.x + wx * d), ey = Math.round(f.y + wy * d);
        if (this.catches(ex, ey)) this.ignite(ex, ey);
      }
      if (f.fuel <= 0) { this.fires.delete(k); this.burnOut(f.x, f.y, st); }
    }
    this.makeFireClouds();
  }

  /** Fires summed per 8x8 block (once per clock value; stale by at most a frame). */
  private buildFireCells() {
    if (this.fireCellsAt === this.clock) return;
    this.fireCellsAt = this.clock;
    this.fireCells.clear();
    for (const f of this.fires.values()) {
      const ck = tileKey(Math.floor(f.x / CELL), Math.floor(f.y / CELL));
      const c = this.fireCells.get(ck);
      if (c) { c.n++; c.sx += f.x + 0.5; c.sy += f.y + 0.5; } else this.fireCells.set(ck, { n: 1, sx: f.x + 0.5, sy: f.y + 0.5 });
    }
  }
  /** Fires within `FIRE_NEAR` tiles of a point, counted by block (so a little coarse). */
  private fireNear(x: number, y: number): number {
    if (!this.fires.size) return 0;
    this.buildFireCells();
    let n = 0;
    for (const c of this.fireCells.values()) if (Math.hypot(c.sx / c.n - x, c.sy / c.n - y) <= FIRE_NEAR) n += c.n;
    return n;
  }
  /** The hot air over a big fire lifts a cloud of its own into a rain layer, upwind of the blaze so its rain lands on it. */
  private makeFireClouds() {
    if (this.fires.size < FIRE_CLOUD_MIN) return;
    this.buildFireCells();
    let alive = 0;
    for (const c of this.clouds) if (c.fire) alive++;
    for (const [ck, c] of this.fireCells) {
      if (alive >= FIRE_CLOUD_CAP) return;
      if (c.n < FIRE_CLOUD_MIN || (this.fireCloudAt.get(ck) ?? -Infinity) > this.clock || this.rng() > 0.2) continue;
      const layer = [6, 7, 8, 9].find(l => this.layerCount(l) < LAYER_CAPACITY[l - 1]);
      if (!layer) return;
      const reach = this.wind.enabled ? this.wind.strength : 0;
      this.clouds.push({ id: this.nextId++, x: c.sx / c.n - Math.cos(this.wind.dir) * reach, y: c.sy / c.n + Math.sin(this.wind.dir) * reach, layer, water: 0.4 + Math.min(0.5, c.n * 0.02), size: c.n >= 24 ? 2 : 1.5, age: 20, raining: false, rain: 0, prevRain: 0, rained: new Set(), toSand: false, fire: true });
      this.fireCloudAt.set(ck, this.clock + FIRE_CLOUD_COOLDOWN); this.tally.fireClouds++; alive++;
    }
  }

  /**
   * What a fire leaves: bare grass, charred for a while (the view darkens it, and it cannot burn again until that fades). Not sand: ash
   * tiles dotted through grass would let the first water that touches them run through the whole burnt patch (see `settle`). Rain then
   * climbs the bare grass back up the vegetation ladder.
   */
  private burnOut(x: number, y: number, st: TileState) {
    this.scorched.set(tileKey(x, y), this.clock); this.tally.burnt++;
    if (st.d || st.v === 1) this.put(x, y, plainTile(GRASS));
  }

  // ---- clouds are pulled towards sand and river lines ----------------------------------------------------------------------

  /** Android's sand and river attraction plus a little random wander. Strengths are per 100 ms tick there, so scaled by dt here. */
  private attract(c: Cloud, dt: number) {
    const k = dt / 0.1;
    c.wx = (c.wx ?? 0) + ((this.rng() - 0.5) * 0.1 - (c.wx ?? 0)) * 0.08; c.wy = (c.wy ?? 0) + ((this.rng() - 0.5) * 0.1 - (c.wy ?? 0)) * 0.08;   // (a slow wander: a new random push every tick made the clouds twitch)
    c.x += c.wx * k; c.y += c.wy * k;
    // the pull changes slowly, so each cloud works it out every 5th tick (staggered by id) and applies the last result every tick
    if (c.ax === undefined || (this.tickNo + c.id) % 5 === 0) {
      const calm = !this.wind.enabled || this.wind.strength < 0.1;
      let px = 0, py = 0, ax = 0, ay = 0, w = 0;
      if (c.toSand) {
        const reach = calm ? Infinity : 20;
        for (const cell of this.sandCells.values()) {
          const dx = cell.sx / cell.n - c.x, dy = cell.sy / cell.n - c.y, d = Math.hypot(dx, dy);
          if (d < 0.1 || d > reach) continue;
          const wt = cell.n / (d * d); ax += (dx / d) * wt; ay += (dy / d) * wt; w += wt;
        }
        if (w >= 0.01) { const st = calm ? 0.2 : 0.15; px += (ax / w) * st; py += (ay / w) * st; }
      }
      ax = ay = w = 0;
      const reach = calm ? 30 : 25;
      this.buildRiverCells();
      for (const cell of this.riverCells.values()) {                 // river lines summed per 4x4 block: a few dozen blocks, not thousands of tiles
        const dx = cell.sx / cell.n - c.x, dy = cell.sy / cell.n - c.y, d = Math.hypot(dx, dy);
        if (d < 0.1 || d > reach) continue;
        const wt = cell.n / (d * d); ax += (dx / d) * wt; ay += (dy / d) * wt; w += wt;
      }
      if (w >= 0.01) { const st = calm ? 0.25 : 0.2; px += (ax / w) * st; py += (ay / w) * st; }   // a little stronger than sand: rivers matter more for rain
      if (this.fires.size) {                                         // a big fire pulls every cloud, so that its rain falls on the fire: the pull is stronger the more fire there is and the closer it is
        this.buildFireCells();
        const rr = calm ? 0 : this.wind.strength, ox = Math.cos(this.wind.dir) * rr, oy = -Math.sin(this.wind.dir) * rr;
        let fx = 0, fy = 0, fw = 0;
        for (const cell of this.fireCells.values()) {
          if (cell.n < 3) continue;
          const dx = cell.sx / cell.n - (c.x + ox), dy = cell.sy / cell.n - (c.y + oy), d = Math.hypot(dx, dy);
          if (d < 0.1 || d > FIRE_PULL_REACH) continue;
          const wt = Math.pow(cell.n, 1.5) / (d * d), soft = Math.min(1, d / 3);   // (soft: no overshooting when nearly there)
          fx += (dx / d) * wt * soft; fy += (dy / d) * wt * soft; fw += wt;
        }
        if (fw >= 0.01) { const st = FIRE_PULL * Math.min(1, fw / FIRE_PULL_FULL); px += (fx / fw) * st; py += (fy / fw) * st; }
      }
      c.ax = c.ax === undefined ? px : c.ax + (px - c.ax) * 0.3; c.ay = c.ay === undefined ? py : c.ay + (py - c.ay) * 0.3;   // (eased, so the pull never snaps to a new direction)
    }
    c.x += c.ax * k; c.y += c.ay! * k;
  }

  private buildRiverCells() {
    const stamp = this.riverVersion * 100000 + this.riverTiles.size;
    if (this.riverBuilt === stamp) return;
    this.riverBuilt = stamp;
    const cells = new Map<number, { n: number; sx: number; sy: number; t: number[] }>();
    for (const rk of this.riverTiles) {
      const x = keyX(rk), y = keyY(rk), ck = tileKey(Math.floor(x / 4), Math.floor(y / 4)), c = cells.get(ck);
      if (c) { c.n++; c.sx += x; c.sy += y; c.t.push(rk); } else cells.set(ck, { n: 1, sx: x, sy: y, t: [rk] });
    }
    this.riverCells = cells;
  }

  /** The river tile nearest to (x, y) within `r` tiles, looking only in the 4x4 blocks that can hold one. */
  private nearestRiver(x: number, y: number, r: number, fresh = true): [number, number] | null {
    if (this.riverTiles.size === 0) return null;
    if (fresh) this.buildRiverCells();
    const cx = Math.floor(x / 4), cy = Math.floor(y / 4), span = Math.ceil(r / 4);
    let best: [number, number] | null = null, bd = r * r + 1;
    for (let j = cy - span; j <= cy + span; j++) for (let i = cx - span; i <= cx + span; i++) {
      const cell = this.riverCells.get(tileKey(i, j));
      if (!cell) continue;
      for (const rk of cell.t) { const rx = keyX(rk), ry = keyY(rk), d = (rx - x) ** 2 + (ry - y) ** 2; if (d <= r * r && d < bd) { bd = d; best = [rx, ry]; } }
    }
    return best;
  }

  /** Every frame: the drawn position glides towards the simulated one, so clouds move smoothly instead of in 0.2 s steps and the odd nudge off another cloud. */
  easeClouds(dt: number) {
    const k = Math.min(1, dt * 4), kl = Math.min(1, dt * 1.5), kf = Math.min(1, dt * 1.2);
    for (const c of this.clouds) {
      if (c.rx === undefined || Math.abs(c.rx - c.x) > 20 || Math.abs(c.ry! - c.y) > 20) { c.rx = c.x; c.ry = c.y; c.fade = 0; }   // (new, or carried across the map: it fades in where it is)
      else { c.rx += (c.x - c.rx) * k; c.ry = c.ry! + (c.y - c.ry!) * k; }
      c.rl = c.rl === undefined ? c.layer : c.rl + (c.layer - c.rl) * kl;
      const want = c.raining && c.rain > 0.8 ? 0 : 1;
      c.fade = (c.fade ?? 0) + Math.sign(want - (c.fade ?? 0)) * Math.min(Math.abs(want - (c.fade ?? 0)), kf * (want ? 1 : 2));
    }
  }

  /** One cloud per spot per layer: clouds of a layer that come within 1.2 tiles of each other are pushed gently apart (a small shove each tick, never a jump). */
  private separateClouds() {
    const cs = this.clouds, MIN = 1.2;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (a.layer !== b.layer) continue;
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy);
      if (d >= MIN) continue;
      if (d < 0.01) { const an = (a.id * 2.399 + b.id) % (Math.PI * 2); dx = Math.cos(an); dy = Math.sin(an); } else { dx /= d; dy /= d; }
      const push = (MIN - d) * 0.2;
      a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
    }
    const taken = new Set<string>();                                  // and still one per tile per layer: a cloud left on a taken tile steps off by a fixed angle (its id's), not a random one
    for (const c of cs) {
      let key = `${c.layer}:${Math.floor(c.x)}:${Math.floor(c.y)}`;
      for (let tries = 0; taken.has(key) && tries < 8; tries++) {
        const a = c.id * 2.399 + tries; c.x += Math.cos(a) * 1.1; c.y += Math.sin(a) * 1.1;
        key = `${c.layer}:${Math.floor(c.x)}:${Math.floor(c.y)}`;
      }
      taken.add(key);
    }
  }

  // ---- rain runs downhill (hilly worlds) ---------------------------------------------------------------------------------------

  /** Ground height in metres. */
  private gh(x: number, y: number) { return this.world.metresAt(x, y); }
  /**
   * Where water on (x, y) goes next: the steepest way down of the 8 neighbours (a diagonal step is 1.41 tiles long, so it needs 1.41 times the drop),
   * each slope eased a little up or down by a fixed hash of the tile pair, so near-equal ways down take turns and the line winds instead of running
   * straight along the grid. Null at a pit or on flat ground (nothing lower).
   */
  private downhill(x: number, y: number): [number, number] | null {
    const h = this.gh(x, y); let best: [number, number] | null = null, bs = 0;
    for (const [dx, dy] of N8) {
      const drop = h - this.gh(x + dx, y + dy); if (drop <= 0) continue;
      const score = (drop / (dx && dy ? 1.414 : 1)) * (0.8 + 0.4 * hash01(x, y, (x + dx) * 31 + (y + dy), 5));
      if (score > bs) { bs = score; best = [x + dx, y + dy]; }
    }
    return best;
  }
  /** Rain on land: a steeper tile sheds more of it. A packet of runoff starts from the tile. */
  private shed(x: number, y: number) {
    if (this.packets.length >= MAX_PACKETS) return;
    const nb = this.downhill(x, y); if (!nb) return;                 // a pit keeps its rain
    const drop = this.gh(x, y) - this.gh(nb[0], nb[1]);
    if (this.rng() < RUNOFF_BASE + Math.min(0.58, drop * RUNOFF_SLOPE)) this.packets.push({ x, y, n: 0 });
  }
  /** One step for every packet: it walks to its lowest neighbour and counts the tile; it ends in water, or at a pit (where the count turns the pit to a puddle). */
  private runoff() {
    if (!this.packets.length) return;
    const keep: typeof this.packets = [];
    for (const p of this.packets) {
      const nb = this.downhill(p.x, p.y);
      if (!nb) { this.feedTarn(p.x, p.y); continue; }                 // a hollow: its water collects there
      p.x = nb[0]; p.y = nb[1];
      if (this.terrainAt(p.x, p.y) === WATER) {
        if (this.becks.has(tileKey(p.x, p.y))) { this.cross(p.x, p.y); if (++p.n < PACKET_STEPS) keep.push(p); continue; }   // a beck carries it on downhill, and stays fed
        this.feedTarn(p.x, p.y); continue;                              // it joined a stream, pond or lake (a small lake takes it in)
      }
      this.cross(p.x, p.y);
      if (++p.n < PACKET_STEPS) keep.push(p);
    }
    this.packets = keep;
  }
  private tarnWater(x: number, y: number) { return this.terrainAt(x, y) === WATER && this.tarnOf.has(tileKey(x, y)); }
  /**
   * The tarn at (x, y), made if there is none: a small real lake (up to TARN_BODY_MAX tiles of the map's lake water) starts from its own
   * water, a hollow on land (every neighbour higher) starts empty at its lowest tile. Anything else (a stream, a dam pond, a big lake) is none.
   */
  private tarnAt(x: number, y: number): { pond: Pond; vol: number } | null {
    const k = tileKey(x, y), had = this.tarnOf.get(k);
    if (had || this.noTarn.has(k) || this.tarns.size >= MAX_TARNS || !this.inArea(x, y)) return had ?? null;
    const env = this.pondEnv(() => true);
    let pond: Pond;
    if (this.terrainAt(x, y) === WATER) {
      const body: [number, number][] = [], seen = new Set<number>([k]), stack: [number, number][] = [[x, y]];
      while (stack.length && body.length <= TARN_BODY_MAX) {
        const [bx, by] = stack.pop()!;
        if (this.terrainAt(bx, by) !== WATER || lakeWaterAt(bx, by) !== LAKE_WATER) continue;
        body.push([bx, by]);
        for (const [dx, dy] of N4) { const nk = tileKey(bx + dx, by + dy); if (!seen.has(nk)) { seen.add(nk); stack.push([bx + dx, by + dy]); } }
      }
      if (!body.length || body.length > TARN_BODY_MAX) { if (this.noTarn.size > 20000) this.noTarn.clear(); for (const sk of seen) this.noTarn.add(sk); return null; }
      pond = new Pond(env, body[0][0], body[0][1], Infinity, true); pond.setBase(body);
    } else {
      const h = this.gh(x, y);
      if (N8.some(([dx, dy]) => this.gh(x + dx, y + dy) < h + PIT_DEPTH)) { this.noTarn.add(k); return null; }
      const probe = new Pond(env, x, y, Infinity, true);
      while (probe.tiles.length <= TARN_MAX_TILES && probe.grow()) { /* fills, to see how big the hollow is */ }
      const rim = probe.spill ? this.gh(probe.spill[0], probe.spill[1]) : Infinity;
      if (!probe.spill || probe.tiles.length < TARN_MIN_TILES || probe.tiles.length > TARN_MAX_TILES || rim - h < TARN_MIN_DEPTH) { this.noTarn.add(k); return null; }
      pond = new Pond(env, x, y, Infinity, true);
    }
    const tarn = { pond, vol: 0 };
    this.tarns.add(tarn);
    for (const [tx, ty] of pond.tiles) this.tarnOf.set(tileKey(tx, ty), tarn);
    this.tarnOf.set(k, tarn);
    return tarn;
  }
  /** A packet of runoff reached (x, y): the tarn there takes it in. */
  private feedTarn(x: number, y: number) {
    const t = this.tarnAt(x, y);
    if (t) t.vol = Math.min(t.vol + TARN_VOL, 40);
  }
  /**
   * Every river tick: a tarn loses water to the sun, floods its next tile when it holds enough to lift its whole sheet to that ground, and
   * gives its highest tile back when it has lost enough. A full tarn (its next ground is a rim it would spill over) sends what comes in
   * on as runoff from the spill tile, which feeds a beck.
   */
  private stepTarns() {
    for (const t of this.tarns) {
      const p = t.pond;
      t.vol = Math.max(-20, t.vol - TARN_EVAP * Math.max(1, p.tiles.length) * RIVER_TICK);
      const up = p.cost();
      if (up !== null) {
        if (t.vol >= up) { const x = p.next()!; if (this.growTarn(t, x)) t.vol -= up; }
        else { const dn = p.downCost(); if (dn !== null && t.vol <= -dn) { this.drainTarn(t); t.vol += dn; } }
      } else if (p.spill && p.spillTo && t.vol >= 1) {
        t.vol -= 1;
        if (this.packets.length < MAX_PACKETS) this.packets.push({ x: p.spillTo[0], y: p.spillTo[1], n: 0 });
      } else { const dn = p.downCost(); if (dn !== null && t.vol <= -dn) { this.drainTarn(t); t.vol += dn; } }
    }
  }
  private growTarn(t: { pond: Pond; vol: number }, at: [number, number]): boolean {
    if (!t.pond.grow()) return false;
    this.by('stream', () => this.put(at[0], at[1], plainTile(WATER)));
    this.tarnOf.set(tileKey(at[0], at[1]), t);
    this.redrawPond(t.pond);
    return true;
  }
  private drainTarn(t: { pond: Pond; vol: number }) {
    const tile = t.pond.shrink(); if (!tile) return;
    setPondSurface([tile], null);
    this.tarnOf.delete(tileKey(tile[0], tile[1]));
    this.by('stream', () => this.put(tile[0], tile[1], plainTile(this.world.generatedTerrain(tile[0], tile[1]))));
    this.redrawPond(t.pond, tile);
    if (!t.pond.tiles.length) this.tarns.delete(t);
  }
  /** Is there a natural river (one the map has) on a side of this tile? */
  private touchesRiver(x: number, y: number) {
    return N4.some(([dx, dy]) => this.terrainAt(x + dx, y + dy) === WATER && lakeWaterAt(x + dx, y + dy) === LAKE_RIVER);
  }
  /**
   * A packet crossed a tile: the ground is wet there for as long as it is crossed (wet grass, not water). Only a tile crossed STREAM_AT times
   * lately that touches a natural river turns to water: the runoff has found the river and widens its mouth by that one tile.
   */
  private cross(x: number, y: number) {
    const k = tileKey(x, y), n = Math.min(TRICKLE_CAP, (this.trickle.get(k) ?? 0) + 1);
    this.trickle.set(k, n);
    this.wetten(k);
    if (n >= STREAM_AT && this.terrainAt(x, y) !== WATER && this.streams.size < MAX_STREAM_TILES && this.inArea(x, y) && this.touchesRiver(x, y)) {
      this.by('stream', () => this.put(x, y, plainTile(WATER)));
      if (this.terrainAt(x, y) === WATER) {
        this.streams.add(k); this.riverTiles.add(k); this.riverVersion++;
        let lv = Infinity;                                                          // the tile is a bank, higher than the river: dig it down to the river's own level, or it stands as a blue ledge
        for (const [dx, dy] of N4) if (this.terrainAt(x + dx, y + dy) === WATER && lakeWaterAt(x + dx, y + dy) === LAKE_RIVER) lv = Math.min(lv, this.gh(x + dx, y + dy));
        if (lv < Infinity) { setPondSurface([[x, y]], lv); this.mark(x, y); }
      }
    }
    if (n >= BECK_AT && this.terrainAt(x, y) !== WATER && this.becks.size < MAX_BECK_TILES && this.streams.size < MAX_STREAM_TILES && this.inArea(x, y) && this.inLine(x, y)) { const line = this.beckSpot(x, y); if (line !== null) this.makeBeck(x, y, k, line); }
  }
  /** Part of a line, not a lone busy tile or a blob: two or more neighbours carry runoff (or already are stream) too. */
  private inLine(x: number, y: number) {
    let c = 0;
    for (const [dx, dy] of N8) { const nk = tileKey(x + dx, y + dy); if ((this.trickle.get(nk) ?? 0) >= STREAM_AT - 1 || this.streams.has(nk)) c++; }
    return c >= 2;
  }
  /** The tile becomes water at its own ground level (the beck steps down the slope), and the grass beside it may become stones. */
  /**
   * Where a beck may grow: it is a single line one tile wide. The tile must have no sand within 2 tiles (the shore art would force sand banks),
   * no water beside it except the end of its own line (so it never runs alongside a river, pond or another line), and no tile of another line
   * within BECK_GAP. Returns the line id (a new one when it starts a line), or null.
   */
  private beckSpot(x: number, y: number): number | null {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (this.terrainAt(x + dx, y + dy) === SAND) return null;
    let line: number | null = null;
    const adj: [number, number][] = [];
    for (const [dx, dy] of N8) {
      if (this.terrainAt(x + dx, y + dy) !== WATER) continue;
      const l = this.becks.get(tileKey(x + dx, y + dy));
      if (l === undefined || (line !== null && l !== line)) return null;
      line = l; adj.push([dx, dy]);
      let ends = 0;                                                                    // only the end of a line may be extended, not its middle
      for (const [ex, ey] of N8) if (this.becks.has(tileKey(x + dx + ex, y + dy + ey))) ends++;
      if (ends >= 2) return null;
    }
    if (adj.length > 2 || (adj.length === 2 && Math.max(Math.abs(adj[0][0] - adj[1][0]), Math.abs(adj[0][1] - adj[1][1])) < 2)) return null;
    for (const [bk, l] of this.becks) if (l !== line && Math.hypot(keyX(bk) - x, keyY(bk) - y) <= BECK_GAP) return null;
    return line ?? ++this.beckLines;
  }
  private makeBeck(x: number, y: number, k: number, line: number) {
    this.settling = true;                                                              // (no sand banks: the shore rule would sand the grass beside the water)
    try { this.by('stream', () => this.put(x, y, plainTile(WATER))); } finally { this.settling = false; }
    if (this.terrainAt(x, y) !== WATER) return;
    this.streams.add(k); this.becks.set(k, line); this.riverTiles.add(k); this.riverVersion++; this.tally.becks++;
    setPondSurface([[x, y]], this.gh(x, y)); this.mark(x, y);
    for (const [dx, dy] of N8) this.bankRock(x + dx, y + dy, BANK_ROCK);
  }
  /** A plain or flowery grass tile may become a rock. */
  private bankRock(x: number, y: number, chance: number): boolean {
    const st = this.world.stateAt(x, y);
    if (st.t !== GRASS || st.d || st.v === 2 || !this.inArea(x, y) || this.rng() >= chance) return false;
    this.put(x, y, { t: GRASS, v: 2, d: 0, s: 1 }); this.tally.bankRocks++;
    return true;
  }

  // ---- irrigation -------------------------------------------------------------------------------------------------------------

  /** Up to `n` more values from a source, carrying on where the last call stopped (so a big lake is worked a little at a time). */
  private take(name: string, src: () => Iterator<number>, n: number, out: number[]) {
    let it = this.cursors.get(name) ?? src();
    for (let i = 0; i < n; i++) {
      let r = it.next();
      if (r.done) { it = src(); r = it.next(); if (r.done) break; }
      out.push(r.value);
    }
    this.cursors.set(name, it);
  }
  /** Water and wet ground feed the land around them: a few shore tiles, runoff lines and streams each round pick a tile nearby and give it a rain step. */
  private irrigate() {
    if (this.area.x1 < this.area.x0) return;
    const water: number[] = [], wet: number[] = [];
    this.take('water', () => this.water.keys(), IRRIGATE_SOURCES * 4, water);       // (most of a lake is not shore: look at more than we use)
    this.take('trickle', () => this.trickle.keys(), 6, wet);
    this.take('streams', () => this.streams.values(), 4, wet);
    let used = 0;
    for (const k of water) {
      if (used >= IRRIGATE_SOURCES) break;
      const x = keyX(k), y = keyY(k);
      if (!N4.some(([dx, dy]) => this.terrainAt(x + dx, y + dy) !== WATER)) continue;
      used++; this.irrigateAround(x, y);
    }
    for (const k of wet) if ((this.trickle.get(k) ?? 0) >= 2 || this.streams.has(k)) this.irrigateAround(keyX(k), keyY(k));
  }
  private irrigateAround(x: number, y: number) {
    if (this.rng() >= IRRIGATE_CHANCE) return;
    const r = 1 + Math.floor(this.rng() * IRRIGATE_REACH), a = this.rng() * Math.PI * 2, tx = Math.round(x + Math.cos(a) * r), ty = Math.round(y + Math.sin(a) * r), k = tileKey(tx, ty);
    if (!this.inArea(tx, ty) || this.terrainAt(tx, ty) === WATER || this.fires.has(k) || this.scorched.has(k)) return;
    if (this.bankRock(tx, ty, WATER_ROCK)) return;
    this.tally.irrigated++; this.rainOn(tx, ty);
  }
  /** Counts fade; a stream no longer fed dries back to the ground the generator made. */
  private dryStreams() {
    const f = TRICKLE_DECAY * RIVER_TICK;
    for (const [k, n] of this.trickle) {
      const v = n - f;
      if (v <= 0) { this.trickle.delete(k); continue; }
      this.trickle.set(k, v);
      if (v >= STREAM_AT - 1) this.wetten(k);        // a runnel (crossed again and again) stays wet while it is kept fed; a single trickle dries as the rain's own wet does
    }
    for (const k of this.streams) {
      if ((this.trickle.get(k) ?? 0) >= DRY_AT) continue;
      const x = keyX(k), y = keyY(k);
      this.streams.delete(k); this.becks.delete(k); this.riverTiles.delete(k); this.riverVersion++;
      setPondSurface([[x, y]], null);
      if (this.terrainAt(x, y) === WATER && this.world.generatedTerrain(x, y) !== WATER) this.by('stream', () => this.put(x, y, plainTile(this.world.generatedTerrain(x, y))));
    }
  }

  // ---- rivers (Android: connectWaterBodiesWithPathfinding, flowWaterAlongPaths, migrateSingleTileWaterBodies) -------------------

  private addRiver(path: [number, number][]) {
    const before = this.riverTiles.size;
    for (const [x, y] of path) this.riverTiles.add(tileKey(x, y));
    if (this.riverTiles.size !== before) this.riverVersion++;                   // only a path that adds tiles invalidates the lookup blocks
    if (this.riverTiles.size > MAX_RIVER_TILES) {                    // forget the oldest 500 (a Set remembers insertion order)
      this.riverVersion++; this.lonePlanned.clear();                // the lines some lone tiles were promised may be gone
      let n = 0;
      for (const k of this.riverTiles) { this.riverTiles.delete(k); if (++n >= 500) break; }
    }
  }

  /** Link nearby puddles with a channel: each puddle (4..64 tiles) joins the nearest free one within 20 tiles; lone tiles join a river line. */
  private connectPuddles() {
    this.connections = this.connections.filter(c => !c.done && c.path.length > 0);
    const puddles: { tiles: number[]; set: Set<number>; cx: number; cy: number }[] = [];
    for (const body of this.bodies()) {
      if (body.tiles.length < PUDDLE_MIN || body.tiles.length > PUDDLE_MAX) continue;
      puddles.push({ tiles: body.tiles, set: new Set(body.tiles), cx: Math.trunc(body.cx), cy: Math.trunc(body.cy) });
    }
    const used = new Set<number>();
    for (let i = 0; i < puddles.length; i++) {
      if (used.has(i)) continue;
      let best = -1, bd = PUDDLE_REACH * PUDDLE_REACH + 1;
      for (let j = 0; j < puddles.length; j++) {
        if (j === i || used.has(j)) continue;
        const d = (puddles[j].cx - puddles[i].cx) ** 2 + (puddles[j].cy - puddles[i].cy) ** 2;
        if (d <= PUDDLE_REACH * PUDDLE_REACH && d < bd) { bd = d; best = j; }
      }
      if (best < 0) continue;
      used.add(i); used.add(best);
      const a = puddles[i], b = puddles[best], small = a.tiles.length <= b.tiles.length ? a : b, large = small === a ? b : a;
      const from = tileKey(small.cx, small.cy), to = tileKey(large.cx, large.cy);
      if (this.connections.some(c => (c.from === from && c.to === to) || (c.from === to && c.to === from))) continue;
      const path = riverPath([small.cx, small.cy], [large.cx, large.cy]);
      this.connections.push({ from, to, path, done: false });
      this.addRiver(path);
    }
    // lone water tiles: towards the nearest river line within 20 tiles, else the nearest other lone tile within 40
    const lone = [...this.lone];
    this.buildRiverCells();                                         // once; paths added in the loop below show up next round
    if (this.lonePlanned.size > lone.length + 64) { const live = new Set(lone); for (const k of this.lonePlanned) if (!live.has(k)) this.lonePlanned.delete(k); }
    for (const k of lone) {
      if (this.lonePlanned.has(k)) continue;                        // its line is already drawn
      const x = keyX(k), y = keyY(k);
      let target: [number, number] | null = this.nearestRiver(x, y, 20, false), bd = 1601;
      if (!target) { for (const o of lone) { if (o === k) continue; const d = (keyX(o) - x) ** 2 + (keyY(o) - y) ** 2; if (d <= 1600 && d < bd) { bd = d; target = [keyX(o), keyY(o)]; } } }
      if (target) { this.addRiver(riverPath([x, y], target)); this.lonePlanned.add(k); }
    }
  }

  /** Grow every channel by one tile per tick: the first path tile that touches water becomes water; a fully wet path is done. */
  private flowRivers() {
    for (const c of this.connections) {
      if (c.done) continue;
      if (c.path.every(([x, y]) => this.terrainAt(x, y) === WATER)) { c.done = true; continue; }
      let grew = false;
      for (let i = 0; i < c.path.length; i++) {
        const [x, y] = c.path[i], t = this.terrainAt(x, y);
        if (t === WATER) continue;
        const touches = this.terrainAt(x + 1, y) === WATER || this.terrainAt(x - 1, y) === WATER || this.terrainAt(x, y + 1) === WATER || this.terrainAt(x, y - 1) === WATER;
        if (touches) { this.by('river', () => this.put(x, y, plainTile(WATER))); grew = true; }   // (`put` keeps the tracked water in step)
        break;                                                      // only the first dry tile may grow, one per tick
      }
      c.stalled = grew ? 0 : (c.stalled ?? 0) + 1;
      if (c.stalled >= STALL_TICKS) c.done = true;                  // its puddle dried up or moved: without this, dead channels piled up and were checked for ever
    }
  }

  /** Lone water tiles walk one step per tick towards the nearest river line (20), else sand (5), else other water (15), leaving sand behind. */
  private migrateSingles() {
    if (this.riverTiles.size === 0) return;
    let moved = 0;
    const all = [...this.lone];                                      // kept up to date as tiles change
    const singles = all.length > 24 ? all.slice(this.migrateFrom % all.length).concat(all).slice(0, 24) : all;   // a rotating slice of 24 a round
    this.migrateFrom += 24;
    let farSearches = 0;
    for (const k of singles) {
      if (moved >= 10) break;
      const sx = keyX(k), sy = keyY(k);
      let target: [number, number] | null = this.nearestRiver(sx, sy, 20), bd = 26;
      if (!target) {
        bd = 26;
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const d = dx * dx + dy * dy; if (d <= 25 && d < bd && this.terrainAt(sx + dx, sy + dy) === SAND) { bd = d; target = [sx + dx, sy + dy]; } }
      }
      if (!target && farSearches++ < 3) {                          // the wide search for other water is the costly one: a few tiles per round
        bd = 226;
        for (let dy = -15; dy <= 15; dy++) for (let dx = -15; dx <= 15; dx++) { const d = dx * dx + dy * dy; if (d <= 225 && d < bd && d > 0 && this.water.has(tileKey(sx + dx, sy + dy))) { bd = d; target = [sx + dx, sy + dy]; } }
      }
      if (!target) continue;
      const dx = target[0] - sx, dy = target[1] - sy;
      const mx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0, my = Math.abs(dy) >= Math.abs(dx) ? Math.sign(dy) : 0;
      if (!mx && !my) continue;
      const nx = sx + mx, ny = sy + my, t = this.terrainAt(nx, ny);
      if (t === WATER) continue;
      this.settling = true;                                       // a walking tile leaves a sand trail on purpose: no clean-up here
      try { this.by('walk', () => { this.put(sx, sy, plainTile(SAND)); this.put(nx, ny, plainTile(WATER)); }); } finally { this.settling = false; }
      moved++;
    }
  }
}

/**
 * A gently curved 4-connected line between two tiles, without its ends. Like Android: 1-2 control points pushed sideways by up to
 * 15% of the distance (max 4 tiles), seeded from the end points so the same pair always gets the same river. Unlike Android it
 * skips the "smoothing" pass, which dropped tiles and left gaps the water could not cross.
 */
export function riverPath(a: [number, number], b: [number, number]): [number, number][] {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pts: [number, number][] = [a];
  if (dist > 3) {
    const n = dist < 10 ? 1 : 2, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1), r = hash01(a[0], a[1], b[0] * 31 + b[1], i), off = (r - 0.5) * 2 * Math.min(4, Math.max(1, dist * 0.15));
      pts.push([Math.trunc(a[0] + dx * t + (-dy / len) * off), Math.trunc(a[1] + dy * t + (dx / len) * off)]);
    }
  }
  pts.push(b);
  const out: [number, number][] = [], seen = new Set<number>();
  for (let i = 0; i < pts.length - 1; i++) {
    let [x, y] = pts[i];
    const [x1, y1] = pts[i + 1];
    while (x !== x1 || y !== y1) {                                  // 4-connected: step along the longer remaining axis
      if (Math.abs(x1 - x) >= Math.abs(y1 - y)) x += Math.sign(x1 - x); else y += Math.sign(y1 - y);
      const k = tileKey(x, y);
      if (!seen.has(k) && !(x === b[0] && y === b[1])) { seen.add(k); out.push([x, y]); }
    }
  }
  return out;
}
