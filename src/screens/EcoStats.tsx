/**
 * The world map's optional "Ecosystem" window: what the simulated area holds right now (a census), how that changed over the last
 * minutes (a small chart), and the running totals of what the simulation did. It reads the ecosystem twice a second while open and
 * costs nothing while closed. Toggled from the menu ("Eco stats").
 */
import { useEffect, useRef, useState } from 'react';
import { census, type Census } from '../domain/ecostats';
import type { BeaversManager } from '../domain/beavers';
import { WATER_CAUSES, type Ecosystem, type EcoTally, type WaterCause } from '../domain/ecosystem';
import { clockText } from '../domain/sky';
import { PixelFrame } from '../ui/PixelFrame';
import type { Key } from '../i18n';

type T = (k: Key, p?: Record<string, string | number>) => string;

const READ_MS = 500;
const HISTORY_EVERY = 5;          // seconds between chart samples
const HISTORY_LEN = 72;           // 6 minutes of chart

/** Land kinds, in the order of the stacked bar and the chart, with their map colours. */
const KINDS = [
  { key: 'water', label: 'worldWater', color: '#3a8fd8' },
  { key: 'sand', label: 'worldSand', color: '#e3c27a' },
  { key: 'grass', label: 'worldGrass', color: '#6cbf4a' },
  { key: 'flowers', label: 'worldEcoFlowers', color: '#e889c8' },
  { key: 'bushes', label: 'worldEcoBushes', color: '#3f8a3a' },
  { key: 'trees', label: 'worldEcoTrees', color: '#245c2c' },
] as const satisfies readonly { key: keyof Census; label: Key; color: string }[];

const TOTALS = [
  ['evaporated', 'worldEcoEvaporated'], ['toWater', 'worldEcoToWater'], ['fromWater', 'worldEcoFromWater'], ['rained', 'worldEcoRained'],
  ['grown', 'worldEcoGrown'], ['imported', 'worldEcoImported'], ['strikes', 'worldEcoStrikes'], ['ignited', 'worldEcoIgnited'], ['burnt', 'worldEcoBurnt'],
] as const satisfies readonly [Count, Key][];

/** The plain counters of the tally (not the per-rule split). */
type Count = Exclude<keyof EcoTally, 'toWaterBy'>;
const CAUSE_LABEL: Record<WaterCause, Key> = { rain: 'worldEcoByRain', shore: 'worldEcoByShore', surrounded: 'worldEcoBySurrounded', settle: 'worldEcoBySettle', river: 'worldEcoByRiver', walk: 'worldEcoByWalk', paint: 'worldEcoByPaint', dam: 'worldEcoByDam' };

interface Snap { c: Census; tally: EcoTally; at: number; hour: number; area: { w: number; h: number } }
interface Sample { at: number; water: number; sand: number; green: number; wood: number }

const pct = (n: number, of: number) => (of ? (n / of) * 100 : 0);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function EcoStats({ eco, beavers, onClose, t }: { eco: () => Ecosystem | null; beavers?: () => BeaversManager | null; onClose: () => void; t: T }) {
  const bm = beavers?.() ?? null;   // (read as the window redraws, every few seconds with the snapshot)
  const [snap, setSnap] = useState<Snap | null>(null);
  const hist = useRef<Sample[]>([]), minuteAgo = useRef<{ at: number; tally: EcoTally; c: Census }[]>([]);
  useEffect(() => {
    const read = () => {
      const e = eco();
      if (!e) return;
      const a = e.watchedArea;
      if (a.x1 < a.x0) return;
      const c = census(e, a), at = e.now, tally = { ...e.tally, toWaterBy: { ...e.tally.toWaterBy } };
      const h = hist.current, last = h[h.length - 1];
      if (!last || at - last.at >= HISTORY_EVERY || at < last.at) {   // (a clock that went back means a new world)
        if (last && at < last.at) h.length = 0;
        h.push({ at, water: pct(c.water, c.tiles), sand: pct(c.sand, c.tiles), green: pct(c.grass + c.flowers, c.tiles), wood: pct(c.bushes + c.trees, c.tiles) });
        if (h.length > HISTORY_LEN) h.shift();
      }
      const m = minuteAgo.current;
      if (m.length && at < m[m.length - 1].at) m.length = 0;
      m.push({ at, tally, c });
      while (m.length > 1 && at - m[1].at >= 60) m.shift();          // keep the oldest sample that is still at least a minute old
      setSnap({ c, tally, at, hour: e.hour, area: { w: a.x1 - a.x0 + 1, h: a.y1 - a.y0 + 1 } });
    };
    read();
    const id = setInterval(read, READ_MS);
    return () => clearInterval(id);
  }, [eco]);

  const old = minuteAgo.current[0];
  const span = snap && old ? snap.at - old.at : 0;
  const perMin = (k: Count) => (snap && old && span >= 5 ? Math.round(((snap.tally[k] - old.tally[k]) * 60) / span) : null);
  const change = (k: keyof Census) => (snap && old && span >= 5 ? (snap.c[k] as number) - (old.c[k] as number) : null);

  return (
    <PixelFrame theme="bevelled_stone_and_gold_pixel_frame" scale={1} className="eco-win" role="dialog" aria-label={t('worldEcoStats')}>
      <div className="eco-head">
        <h2>{t('worldEcoStats')}</h2>
        <button type="button" className="eco-x" aria-label={t('worldClose')} title={t('worldClose')} onClick={onClose}>x</button>
      </div>
      {!snap ? <div className="eco-muted">{t('worldEcoWaiting')}</div> : (
        <div className="eco-body">
          <section>
            <h3>{t('worldEcoWorld')}</h3>
            <dl className="eco-grid">
              <dt>{t('worldEcoBiome')}</dt><dd>{t(`worldBiome_${snap.c.biome}` as Key)}</dd>
              <dt>{t('worldEcoClock')}</dt><dd>{clockText(snap.hour)}, {Math.round(snap.c.temperature)}°{snap.c.weather ? ` ${t(snap.c.weather === 'heat' ? 'worldHeat' : 'worldCold')}` : ''}</dd>
              <dt>{t('worldEcoRunning')}</dt><dd>{Math.floor(snap.at / 60)}:{String(Math.floor(snap.at % 60)).padStart(2, '0')}</dd>
            </dl>
          </section>

          <section>
            <h3>{t('worldEcoLand', { w: snap.area.w, h: snap.area.h })}</h3>
            <div className="eco-bar" role="img" aria-label={KINDS.map(k => `${t(k.label)} ${Math.round(pct(snap.c[k.key], snap.c.tiles))}%`).join(', ')}>
              {KINDS.map(k => <i key={k.key} style={{ width: `${pct(snap.c[k.key], snap.c.tiles)}%`, background: k.color }} />)}
            </div>
            <table className="eco-table">
              <thead><tr><th /><th>{t('worldEcoTiles')}</th><th>%</th><th>{t('worldEcoPerMin')}</th></tr></thead>
              <tbody>
                {KINDS.map(k => {
                  const d = change(k.key);
                  return (
                    <tr key={k.key}>
                      <th><i className="eco-dot" style={{ background: k.color }} />{t(k.label)}</th>
                      <td>{snap.c[k.key]}</td><td>{Math.round(pct(snap.c[k.key], snap.c.tiles))}</td>
                      <td className={d ? (d > 0 ? 'eco-up' : 'eco-down') : ''}>{d === null ? '-' : signed(d)}</td>
                    </tr>
                  );
                })}
                <tr><th>{t('worldEcoWoodSize')}</th><td colSpan={3}>{snap.c.woodScale ? `${snap.c.woodScale.toFixed(2)}x` : '-'}</td></tr>
              </tbody>
            </table>
            <Chart samples={hist.current} label={t('worldEcoTrend')} names={[t('worldWater'), t('worldSand'), t('worldGrass'), t('worldEcoWood')]} />
          </section>

          <section>
            <h3>{t('worldEcoSky')}</h3>
            <dl className="eco-grid">
              <dt>{t('worldEcoClouds')}</dt><dd>{snap.c.clouds} ({t('worldEcoRaining')} {snap.c.raining})</dd>
              <dt>{t('worldEcoCloudWater')}</dt><dd>{snap.c.cloudWater.toFixed(1)}</dd>
              <dt>{t('worldEcoRivers')}</dt><dd>{snap.c.rivers}</dd>
              <dt>{t('worldEcoChannels')}</dt><dd>{snap.c.channels}</dd>
            </dl>
          </section>

          <section>
            <h3>{t('worldEcoFire')}</h3>
            <dl className="eco-grid">
              <dt>{t('worldEcoBurning')}</dt><dd className={snap.c.burning ? 'eco-hot' : ''}>{snap.c.burning}</dd>
              <dt>{t('worldEcoCharred')}</dt><dd>{snap.c.charred}</dd>
              <dt>{t('worldEcoWet')}</dt><dd>{snap.c.wet}</dd>
            </dl>
          </section>

          <section>
            <h3>{t('worldEcoTotals')}</h3>
            <table className="eco-table">
              <thead><tr><th /><th>{t('worldEcoAll')}</th><th>{t('worldEcoPerMin')}</th></tr></thead>
              <tbody>
                {TOTALS.map(([k, label]) => { const r = perMin(k); return <tr key={k}><th>{t(label)}</th><td>{snap.tally[k]}</td><td>{r === null ? '-' : r}</td></tr>; })}
                {bm && <tr><th>{t('worldEcoBeavers')}</th><td>{bm.beavers.length}</td><td /></tr>}
                {bm && <tr><th>{t('worldEcoHauled')}</th><td>{bm.tally.hauled}</td><td /></tr>}
                {bm && <tr><th>{t('worldEcoDams')}</th><td>{bm.tally.damsDone}</td><td /></tr>}
              </tbody>
            </table>
            <h3>{t('worldEcoWhyWater')}</h3>
            <table className="eco-table">
              <tbody>
                {WATER_CAUSES.map(k => {
                  const n = snap.tally.toWaterBy[k], r = snap && old && span >= 5 ? Math.round(((n - old.tally.toWaterBy[k]) * 60) / span) : null;
                  return <tr key={k}><th>{t(CAUSE_LABEL[k])}</th><td>{n}</td><td>{Math.round(pct(n, snap.tally.toWater))}%</td><td>{r === null ? '-' : r}</td></tr>;
                })}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </PixelFrame>
  );
}

/** Four lines, 0-100% of the area, over the last few minutes (one point every 5 s). */
function Chart({ samples, label, names }: { samples: Sample[]; label: string; names: string[] }) {
  const W = 200, H = 60;
  if (samples.length < 2) return null;
  const t0 = samples[0].at, t1 = samples[samples.length - 1].at, span = Math.max(1, t1 - t0);
  const line = (pick: (s: Sample) => number) => samples.map(s => `${(((s.at - t0) / span) * W).toFixed(1)},${(H - (pick(s) / 100) * H).toFixed(1)}`).join(' ');
  const series = [{ pick: (s: Sample) => s.water, color: KINDS[0].color }, { pick: (s: Sample) => s.sand, color: KINDS[1].color }, { pick: (s: Sample) => s.green, color: KINDS[2].color }, { pick: (s: Sample) => s.wood, color: '#9be07a' }];
  const mins = Math.round(span / 60);
  return (
    <figure className="eco-chart">
      <figcaption>{label} ({mins < 1 ? `${Math.round(span)} s` : `${mins} min`})</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="eco-mid" />
        {series.map((s, i) => <polyline key={i} points={line(s.pick)} fill="none" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="eco-legend">{series.map((s, i) => <span key={i}><i className="eco-dot" style={{ background: s.color }} />{names[i]}</span>)}</div>
    </figure>
  );
}
