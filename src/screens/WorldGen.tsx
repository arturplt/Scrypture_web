import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PlanetGL, type PickHit } from './planetgl';
import { PlanetClient, type PlanetParams } from './planetClient';
import { enterWorldFromHome } from './worldEntry';
import type { WorkerLike } from './chunkClient';
import { seedFrom } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelSlider } from '../ui/PixelSlider';
import { CUBE_N, cubeRadius, netToDir } from '../domain/cube';
import { DEFAULT_GEN, GEN_RANGE, isDefaultGen, sanitizeGen, type GenNumberKey, type GenParams } from '../domain/genparams';
import { PLANET_DETAILS, defaultBand, withPlanet } from '../domain/planetmesh';
import { SculptModel } from '../domain/sculpt';
import { LAYER_TILES } from './planetgl';
import { findTerraceSpawn, setRealTerrain } from '../domain/terrace';
import './worldgen.css';

const DETAILS = PLANET_DETAILS.filter(n => n >= 32);
/** Triangles a mesh may have, by quality preset: Low and Balanced are sized for weak integrated GPUs; High is for the others (detail 128 has 200k triangles before any terrace is cut). */
const QUALITY = { low: 100_000, balanced: 200_000, high: 600_000 } as const;
type Quality = keyof typeof QUALITY;
const randomSeed = () => Math.floor(Math.random() * 4294967296);
const seedOf = (text: string): number => (text.trim() ? (/^\d+$/.test(text.trim()) ? Number(text.trim()) >>> 0 : seedFrom(text.trim())) : 0);

const SLIDERS: { key: GenNumberKey; label: 'genSea' | 'genContinents' | 'genMountains' | 'genPeaks' | 'genHills' | 'genMoisture' | 'genCold'; step: number; group: 'planet' | 'terrain' | 'climate'; fmt: (v: number) => string }[] = [
  { key: 'sea', label: 'genSea', step: 0.01, group: 'planet', fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) },
  { key: 'continents', label: 'genContinents', step: 0.05, group: 'planet', fmt: v => '×' + v.toFixed(2) },
  { key: 'mountains', label: 'genMountains', step: 0.05, group: 'terrain', fmt: v => '×' + v.toFixed(2) },
  { key: 'peaks', label: 'genPeaks', step: 0.05, group: 'terrain', fmt: v => '×' + v.toFixed(2) },
  { key: 'hills', label: 'genHills', step: 0.05, group: 'terrain', fmt: v => '×' + v.toFixed(2) },
  { key: 'moisture', label: 'genMoisture', step: 0.01, group: 'climate', fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) },
  { key: 'cold', label: 'genCold', step: 1, group: 'climate', fmt: v => '-' + v.toFixed(0) },
];

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="wg-sec" open={open}><summary>▸ {title}</summary>{children}</details>;
}
function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return <div className="wg-row"><div className="wg-lab"><span>{label}</span>{value !== undefined && <span className="wg-val">{value}</span>}</div>{children}</div>;
}

/**
 * The world generator: the whole terraced planet to look over (PlanetGL, built by the preview worker), sliders for the terrain and the climate, and Create and fly, which opens a real game world made from exactly
 * these settings (they are saved with it, see genparams.ts). The view settings (detail, terrace thickness, height exaggeration) only change the preview.
 */
export function WorldGen() {
  const { t } = useI18n();
  const worlds = useAppState(s => s.worlds.list);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<PlanetGL | null>(null), client = useRef<PlanetClient | null>(null);
  const [seedText, setSeedText] = useState(() => String(randomSeed()));
  const [gen, setGen] = useState<GenParams>({ ...DEFAULT_GEN });
  const [detail, setDetail] = useState(64), [band, setBand] = useState(defaultBand(64)), [ex, setEx] = useState(3);
  const [open, setOpen] = useState(true), [quality, setQuality] = useState<Quality>('balanced');
  const budget = QUALITY[quality];
  const [status, setStatus] = useState<{ stage: 'sample' | 'build'; pct: number } | null>(null);
  const [mesh, setMesh] = useState<{ tris: number; N: number } | null>(null);
  const [over, setOver] = useState<{ N: number; k: number; tris: number } | null>(null);
  const [error, setError] = useState(''), [noGL, setNoGL] = useState(false);
  const [spawn, setSpawn] = useState<'checking' | 'ok' | 'none'>('checking');
  // the macro sculpt: the model (float values, undo history) lives here; the settings carry its saved form
  const model = useRef(new SculptModel());
  const [sculptOn, setSculptOn] = useState(false), [raise, setRaise] = useState(true), [radiusDeg, setRadiusDeg] = useState(6), [strength, setStrength] = useState(2), [canUndo, setCanUndo] = useState(false), [hasSculpt, setHasSculpt] = useState(false);
  const brush = useRef({ on: false, raise: true, radius: 6 * Math.PI / 180, strength: 2 });
  brush.current = { on: sculptOn, raise, radius: (radiusDeg * Math.PI) / 180, strength };
  const hover = useRef<[number, number, number] | null>(null), strokeLast = useRef<[number, number, number] | null>(null);
  const dragging = useRef(false), spawnDir = useRef<[number, number, number] | null>(null);
  /** Is the terrace thickness the generator's to choose (until the user touches it)? Then it thickens, a layer at a time, until the mesh fits the budget, and comes back to the default when the ground changes. */
  const bandAuto = useRef(true);
  const detailRef = useRef(64);
  detailRef.current = detail;
  const seed = useMemo(() => seedOf(seedText) || 1, [seedText]);
  const latest = useRef<PlanetParams>({ seed, size: CUBE_N, gen, detail, band });
  latest.current = { seed, size: CUBE_N, gen: isDefaultGen(gen) ? undefined : gen, detail, band };

  /** The model changed: the settings carry its saved form (and an automatic terrace thickness starts again). */
  const commitSculpt = () => { setGen(g => sanitizeGen({ ...g, sculpt: model.current.toSparse() })); setCanUndo(model.current.canUndo); setHasSculpt(!model.current.empty); if (bandAuto.current) setBand(defaultBand(detailRef.current)); };
  /** A brush stroke: a dab at the start, then dabs spaced by how far the brush has travelled over the ball (not by time or frames), so the stroke is the same at any speed. */
  const strokeEvent = (hit: PickHit | null, phase: 'start' | 'move' | 'end') => {
    const b = brush.current, m = model.current;
    if (phase === 'end') { if (strokeLast.current) { m.endStroke(); strokeLast.current = null; dragging.current = false; commitSculpt(); } return; }
    if (!hit) return;
    const dab = (d: [number, number, number]) => m.dab(d, b.radius, b.raise ? b.strength : -b.strength);
    if (phase === 'start') { m.beginStroke(); dragging.current = true; strokeLast.current = hit.dir; if (dab(hit.dir)) commitSculpt(); return; }
    const last = strokeLast.current; if (!last) return;
    const ang = Math.acos(Math.max(-1, Math.min(1, last[0] * hit.dir[0] + last[1] * hit.dir[1] + last[2] * hit.dir[2]))), gap = b.radius * 0.3;
    if (ang < gap) return;
    let moved = false; const n = Math.floor(ang / gap), sa = Math.sin(ang);
    for (let i = 1; i <= n; i++) {   // (along the great circle from the last dab to here, one dab every `gap`)
      const t = (i * gap) / ang, k0 = Math.sin((1 - t) * ang) / sa, k1 = Math.sin(t * ang) / sa;
      const d: [number, number, number] = [last[0] * k0 + hit.dir[0] * k1, last[1] * k0 + hit.dir[1] * k1, last[2] * k0 + hit.dir[2] * k1];
      if (dab(d)) moved = true; if (i === n) strokeLast.current = d;
    }
    if (moved) commitSculpt();
  };
  const strokeRef = useRef(strokeEvent); strokeRef.current = strokeEvent;

  useEffect(() => enterWorldFromHome(false), []);   // (a world made here closes back to the list)

  // the renderer, the worker and their wiring: made once, and freed when the screen goes
  useEffect(() => {
    const cv = canvas.current; if (!cv) return;
    let g: PlanetGL;
    try { g = new PlanetGL(cv, { radius: cubeRadius(CUBE_N), onPick: hit => { hover.current = hit ? hit.dir : null; if (brush.current.on && hit) g.setBrush(hit.dir, brush.current.radius); else if (!brush.current.on) g.setBrush(null); } }); } catch { setNoGL(true); return; }
    g.onStroke = (hit: PickHit | null, phase) => strokeRef.current(hit, phase);
    g.setExaggeration(ex); g.fitGlobe([0.5, 0.3, 0.8]);
    const perf = /[?&]perf\b/.test(location.search), log: { at: number; quick: boolean; N: number; tris: number }[] = [];
    const c = new PlanetClient(() => new Worker(new URL('../workers/planet.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike, {
      onMesh: (m, i) => { if (perf) log.push({ at: performance.now(), quick: i.quick, N: m.N, tris: m.tris }); g.stage(m); setMesh({ tris: m.tris, N: m.N }); setOver(null); setStatus(null); setError(''); },
      onProgress: (stage, frac) => setStatus({ stage, pct: Math.round(frac * 100) }),
      onWarn: (_m, i) => { if (bandAuto.current && i.k < 8) { setBand(i.k + 1); return; } setOver({ N: i.N, k: i.k, tris: i.tris }); setStatus(null); },
      onError: m => setError(m),
      budgetTris: QUALITY.balanced,
    });
    gl.current = g; client.current = c;
    if (perf) (window as unknown as { __worldgen?: unknown }).__worldgen = { client: c, gl: g, log };   // (?perf: for scripts)
    return () => { c.dispose(); g.dispose(); gl.current = null; client.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const push = useCallback((drag: boolean) => { client.current?.set(latest.current, drag); }, []);
  useEffect(() => { push(dragging.current); }, [seed, gen, detail, band, push]);
  useEffect(() => { gl.current?.setExaggeration(ex); }, [ex]);
  useEffect(() => { const g = gl.current; if (!g) return; g.sculptMode = sculptOn; if (!sculptOn) g.setBrush(null); else if (hover.current) g.setBrush(hover.current, brush.current.radius); }, [sculptOn, radiusDeg]);
  const undo = () => { if (model.current.undo()) commitSculpt(); };
  useEffect(() => {
    if (!sculptOn) return;
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) { e.preventDefault(); undo(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sculptOn]);
  // a new quality preset: the next mesh is judged by it, and the ground is built again
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } client.current?.setBudget(budget); setOver(null); bandAuto.current = true; setBand(defaultBand(detailRef.current)); push(false); }, [budget, push]);
  // a slider released: build the chosen detail now, not after the quiet moment
  useEffect(() => {
    const up = () => { if (dragging.current) { dragging.current = false; push(false); } };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [push]);

  // is there ground to start on? Looked for once the settings have settled, as the game does when it makes the world
  useEffect(() => {
    setSpawn('checking'); gl.current?.setMarker(null);
    const h = setTimeout(() => {
      const dir = [0, 0, 0];
      const found = withPlanet(CUBE_N, gen, () => { setRealTerrain(null); const f = findTerraceSpawn(seed); return f && netToDir(f.x + 0.5, f.y + 0.5, dir) ? f : null; });   // (the spot the game starts on: marked on the planet)
      setSpawn(found ? 'ok' : 'none');
      spawnDir.current = found ? [dir[0], dir[1], dir[2]] : null;
      gl.current?.setMarker(spawnDir.current);
    }, 400);
    return () => clearTimeout(h);
  }, [seed, gen]);

  /** The ground changed: an automatic terrace thickness starts again from the default. */
  const groundChanged = () => { if (bandAuto.current) setBand(defaultBand(detailRef.current)); };
  const setParam = (k: GenNumberKey, v: number) => { setGen(g => sanitizeGen({ ...g, [k]: v })); if (k !== 'moisture' && k !== 'cold') groundChanged(); };
  const newSeed = (text: string) => { setSeedText(text); groundChanged(); };
  const clearModel = () => { model.current = new SculptModel(); setCanUndo(false); setHasSculpt(false); };
  const reset = () => { clearModel(); bandAuto.current = true; setGen({ ...DEFAULT_GEN }); setBand(defaultBand(detail)); setEx(3); };
  const randomize = () => {
    const r = (k: GenNumberKey, a: number, b: number) => { const [lo, hi] = GEN_RANGE[k]; return lo + (hi - lo) * (a + Math.random() * (b - a)); };
    clearModel(); newSeed(String(randomSeed()));
    setGen(sanitizeGen({ sea: r('sea', 0.3, 0.65), continents: r('continents', 0.1, 0.7), mountains: r('mountains', 0.2, 0.8), peaks: r('peaks', 0.3, 0.8), hills: r('hills', 0.3, 0.8), moisture: r('moisture', 0.3, 0.7), cold: r('cold', 0, 0.3) }));
  };
  const pickDetail = (n: number) => { bandAuto.current = true; setDetail(n); setBand(defaultBand(n)); };
  const create = () => {
    const id = actions.createWorld(t('worldDefaultName', { n: worlds.length + 1 }), seed, 'terraced', 'lakes', isDefaultGen(gen) ? null : gen);
    if (id) navigate(`/games/paperplane/play/${id}`);
  };
  const dragProps = { onPointerDownCapture: (e: React.PointerEvent) => { if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range') dragging.current = true; } };
  const slider = (s: (typeof SLIDERS)[number]) => <Row key={s.key} label={t(s.label)} value={s.fmt(gen[s.key])}><PixelSlider value={gen[s.key]} min={GEN_RANGE[s.key][0]} max={GEN_RANGE[s.key][1]} step={s.step} label={t(s.label)} valueText={s.fmt(gen[s.key])} onChange={v => setParam(s.key, v)} /></Row>;
  const tiles = Math.round(CUBE_N / detail);

  return (
    <div className="wg">
      <canvas ref={canvas} className="wg-canvas" aria-label={t('genTitle')} />
      <PixelFrame theme="gold_thick" scale={1} className="wg-panel" {...dragProps}>
        <div className="wg-head">
          <PixelButton scale={1} size="compact" variant="red" onClick={() => navigate('/games/paperplane')}>{t('back')}</PixelButton>
          <h1 className="wg-title">{t('genTitle')}</h1>
          <PixelButton scale={1} size="compact" aria-label={t('genFold')} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? '–' : '+'}</PixelButton>
        </div>
        {open && <div className="wg-scroll">
          <div className="muted small">{t('genHint')}</div>
          <Section title={t('genPlanet')}>
            <div className="wg-seed">
              <input className="field" type="text" maxLength={40} value={seedText} aria-label={t('worldSeed')} onChange={e => newSeed(e.target.value)} />
              <PixelButton scale={1} size="compact" aria-label={t('genDice')} title={t('genDice')} onClick={() => newSeed(String(randomSeed()))}>⚄</PixelButton>
            </div>
            {SLIDERS.filter(s => s.group === 'planet').map(slider)}
            <Row label={t('genSize')} value={t('genSizeFixed', { n: CUBE_N })}><span /></Row>
          </Section>
          <Section title={t('genTerrain')}>{SLIDERS.filter(s => s.group === 'terrain').map(slider)}</Section>
          <Section title={t('genClimate')}>{SLIDERS.filter(s => s.group === 'climate').map(slider)}</Section>
          <Section title={t('genSculpt')} open={false}>
            <div className="muted small">{t('genSculptHint')}</div>
            <div className="langs" role="group" aria-label={t('genSculpt')}>
              <button className={`seg ${!sculptOn ? 'on' : ''}`} aria-pressed={!sculptOn} onClick={() => setSculptOn(false)}>{t('genOrbit')}</button>
              <button className={`seg ${sculptOn ? 'on' : ''}`} aria-pressed={sculptOn} onClick={() => setSculptOn(true)}>{t('genSculpt')}</button>
            </div>
            <div className="langs" role="group" aria-label={t('genRaise')}>
              <button className={`seg ${raise ? 'on' : ''}`} aria-pressed={raise} onClick={() => setRaise(true)}>{t('genRaise')}</button>
              <button className={`seg ${!raise ? 'on' : ''}`} aria-pressed={!raise} onClick={() => setRaise(false)}>{t('genLower')}</button>
            </div>
            <Row label={t('genRadius')} value={t('genDegTiles', { deg: radiusDeg, tiles: Math.round((radiusDeg * Math.PI * cubeRadius(CUBE_N)) / 180) })}><PixelSlider value={radiusDeg} min={1} max={25} step={0.5} label={t('genRadius')} onChange={setRadiusDeg} /></Row>
            <Row label={t('genStrength')} value={strength.toFixed(2) + ' (' + (strength * LAYER_TILES).toFixed(1) + ' tiles)'}><PixelSlider value={strength} min={0.25} max={8} step={0.25} label={t('genStrength')} onChange={setStrength} /></Row>
            <div className="wg-btns">
              <PixelButton scale={1} variant="red" disabled={!canUndo} onClick={undo}>{t('genUndo')}</PixelButton>
              <PixelButton scale={1} variant="red" disabled={!hasSculpt} onClick={() => { if (model.current.clear()) commitSculpt(); }}>{t('genClearSculpt')}</PixelButton>
            </div>
          </Section>
          <Section title={t('genView')} open={false}>
            <div className="muted small">{t('genViewOnly')}</div>
            <Row label={t('genDetail')} value={String(detail)}>
              <div className="langs" role="group" aria-label={t('genDetail')}>{DETAILS.map(n => <button key={n} className={`seg ${detail === n ? 'on' : ''}`} aria-pressed={detail === n} onClick={() => pickDetail(n)}>{n}</button>)}</div>
              {detail >= 256 && <div className="muted small">{t('genGuarded')}</div>}
            </Row>
            <Row label={t('genQuality')} value={t(quality === 'low' ? 'genLow' : quality === 'high' ? 'genHigh' : 'genBalanced')}>
              <div className="langs" role="group" aria-label={t('genQuality')}>{(['low', 'balanced', 'high'] as const).map(q => <button key={q} className={`seg ${quality === q ? 'on' : ''}`} aria-pressed={quality === q} onClick={() => setQuality(q)}>{t(q === 'low' ? 'genLow' : q === 'high' ? 'genHigh' : 'genBalanced')}</button>)}</div>
            </Row>
            <Row label={t('genBand')} value={String(band)}><PixelSlider value={band} min={1} max={8} step={1} label={t('genBand')} onChange={v => { bandAuto.current = false; setBand(v); }} /></Row>
            <Row label={t('genExag')} value={'×' + ex.toFixed(1)}><PixelSlider value={ex} min={1} max={12} step={0.5} label={t('genExag')} onChange={setEx} /></Row>
          </Section>
        </div>}
        {open && <>
          <div className="wg-btns">
            <PixelButton scale={1} variant="red" onClick={reset}>{t('genReset')}</PixelButton>
            <PixelButton scale={1} variant="red" onClick={randomize}>{t('genRandom')}</PixelButton>
            <PixelButton scale={1} variant="red" disabled={spawn !== 'ok'} onClick={() => { if (spawnDir.current) gl.current?.lookAt(spawnDir.current, 60, 0.7); }}>{t('genGoStart')}</PixelButton>
            <PixelButton scale={1} disabled={spawn !== 'ok'} onClick={create}>{t('worldCreate')}</PixelButton>
          </div>
        </>}
      </PixelFrame>
      <div className="wg-status" role="status">
        {noGL && <div className="wg-bad">{t('genNoGL')}</div>}
        {error && <div className="wg-bad">{t('genError', { msg: error })}</div>}
        {over && <div className="wg-warn">{t('genOverBudget', { n: over.N, k: over.k, tris: Math.round(over.tris / 1000), max: budget / 1000 })}</div>}
        {spawn === 'none' && <div className="wg-bad">{t('genNoLand')}</div>}
        {spawn === 'checking' && <div>{t('genChecking')}</div>}
        {status && <div>{t(status.stage === 'sample' ? 'genSampling' : 'genBuilding', { pct: status.pct })}</div>}
        {mesh && <div>{t('genMesh', { tris: Math.round(mesh.tris / 1000), n: mesh.N })}</div>}
        {spawn === 'ok' && <div>{t('genStartMark')}</div>}
        <div>{t('genApprox', { tiles })}</div>
      </div>
    </div>
  );
}
