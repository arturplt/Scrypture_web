import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  FIELD_H, FIELD_W, HITS_PER_LEVEL, RETICLE_REACH, THROWER, ITEM_SPRITE, type ItemId, PLAY_COST_STONE, bobrStage, canThrow, initGame, isGameOver, speedBonus, setAngle, setPower, step, summarize, throwRock,
  type GameMode, type GameState, type Rewards,
} from '../domain';
import { actions, useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelSlider } from '../ui/PixelSlider';
import { Icon, Modal } from '../ui/misc';
import { uiPlay } from '../audio/uiSound';
import { addHit, drawGame, loadSprites, newFx, tickFx, type Fx, type Sprites } from '../ui/rockDraw';

interface Hud { score: number; level: number; throws: number; left: number; combo: number; power: number; angle: number; canThrow: boolean; time: number; speed: number }
const readHud = (g: GameState): Hud => ({
  score: g.score, level: g.level, throws: g.throwsRemaining, left: Math.max(0, g.level * HITS_PER_LEVEL - g.targetsHit),
  combo: g.combo, power: g.power, angle: g.angle, canThrow: canThrow(g), time: g.timeLeft === Infinity ? -1 : Math.ceil(g.timeLeft),
  speed: g.timeLeft === Infinity ? 1 : speedBonus(g.clock - g.lastHitAt),
});
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every(k => a[k] === b[k]);

interface Outcome { rewards: Rewards; newHighScore: boolean; score: number; level: number; targetsHit: number }

const MIN_SHOOT_POWER = 0.1;

export function RockGame({ mode }: { mode: GameMode }) {
  const { t } = useI18n();
  const stage = useAppState(s => bobrStage(s.stats.level));
  const stone = useAppState(s => s.inventory.stone ?? 0);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [failed, setFailed] = useState(false);
  const game = useRef<GameState>(null as unknown as GameState);
  if (!game.current) game.current = initGame(mode, Date.now(), Math.random);   // once, not on every render
  const fx = useRef<Fx>(newFx());
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const finished = useRef(false);
  const [hud, setHud] = useState(() => readHud(game.current));
  const [paused, setPaused] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [needStone, setNeedStone] = useState(false);
  const [run, setRun] = useState(0);

  const sync = useCallback(() => { const h = readHud(game.current); setHud(p => (sameHud(p, h) ? p : h)); }, []);
  const comboLabel = t('comboPrefix');
  const redraw = useCallback(() => {
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx || !sprites) return;
    ctx.setTransform(c.width / FIELD_W, 0, 0, c.height / FIELD_H, 0, 0);
    drawGame(ctx, game.current, sprites, fx.current, comboLabel);
  }, [sprites, comboLabel]);

  useEffect(() => { let live = true; loadSprites(stage).then(s => live && setSprites(s), () => live && setFailed(true)); return () => { live = false; }; }, [stage]);

  // keep the canvas's pixel size in step with how big it is shown (sharp on high-density screens)
  useEffect(() => {
    const el = field.current, c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  const endGame = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    game.current = { ...game.current, paused: true };
    const sum = summarize(game.current);
    const r = actions.finishRockGame(sum);
    uiPlay('land', 0.8);
    setOutcome({ ...r, score: sum.score, level: sum.level, targetsHit: sum.targetsHit });
    sync();
  }, [sync]);

  // the game loop
  useEffect(() => {
    if (!sprites || paused || outcome) { redraw(); return; }
    let raf = 0, last = performance.now();
    const frame = (ts: number) => {
      const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
      const r = step(game.current, dt, Date.now(), Math.random);
      game.current = r.state;
      r.hits.forEach(h => { addHit(fx.current, h); uiPlay(h.bullseye ? 'hoop' : 'ready', Math.min(1, h.combo / 8)); });
      if (r.levelUp) uiPlay('hoop', 1);
      if (r.levelUp) fx.current.banner = { text: t('levelComplete'), age: 0 };
      tickFx(fx.current, dt);
      redraw(); sync();
      if (isGameOver(r.state)) { endGame(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sprites, paused, outcome, run, redraw, sync, endGame, t]);

  const pause = useCallback((p: boolean) => { game.current = { ...game.current, paused: p }; setPaused(p); sync(); }, [sync]);
  // never leave a game running in a hidden tab
  useEffect(() => {
    const onHide = () => { if (document.hidden && !finished.current) pause(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [pause]);

  const shoot = () => {
    const g = game.current;
    if (!canThrow(g)) return;
    game.current = g.power > MIN_SHOOT_POWER ? { ...throwRock(g), power: g.power } : g;
    if (game.current.rocks.length > g.rocks.length) uiPlay('throw');
    sync();
  };
  const aimTo = (angle: number, power: number) => { game.current = setPower(setAngle(game.current, angle), power); redraw(); sync(); };

  /** Point the reticle at a screen position: the angle and power follow, and the sliders with them. */
  const aimAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left) * (FIELD_W / r.width) - THROWER.x, dy = THROWER.y - (e.clientY - r.top) * (FIELD_H / r.height);
    aimTo(Math.atan2(dy, dx) * 180 / Math.PI, Math.hypot(dx, dy) / RETICLE_REACH);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!canThrow(game.current) || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = true; field.current?.classList.add('aiming');
    aimAt(e);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag.current) aimAt(e); };
  const up = (cancelled: boolean) => () => {
    if (!drag.current) return;
    drag.current = false; field.current?.classList.remove('aiming');
    if (!cancelled) shoot();
    sync();
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const g = game.current, big = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowUp') aimTo(g.angle + big, g.power);
    else if (e.key === 'ArrowDown') aimTo(g.angle - big, g.power);
    else if (e.key === 'ArrowRight') aimTo(g.angle, g.power + 0.02 * big);
    else if (e.key === 'ArrowLeft') aimTo(g.angle, g.power - 0.02 * big);
    else if (e.key === ' ' || e.key === 'Enter') shoot();
    else return;
    e.preventDefault();
  };

  /** Start over for PLAY_COST_STONE stone. Returns false (and says why) when there is not enough. */
  const playAgain = () => {
    if (!actions.spendStone(PLAY_COST_STONE)) { setNeedStone(true); return; }
    game.current = initGame(mode, Date.now(), Math.random);
    fx.current = newFx(); finished.current = false;
    setOutcome(null); setPaused(false); setRun(n => n + 1); sync();
  };
  const quit = () => navigate('/');   // leaving a game goes home

  if (failed) return <div className="screen"><p role="alert">{t('rockLoadFailed')}</p><PixelButton scale={1} variant="red" onClick={quit}>{t('back')}</PixelButton></div>;

  const throwsText = hud.throws === Infinity ? '∞' : String(hud.throws);
  return (
    <div className="screen rock">
      <div className="rock-top">
        <PixelFrame theme="app" scale={1} className="rock-hud" aria-live="off">
          <div><span className="muted small">{t('score').toUpperCase()}</span><b>{hud.score}</b></div>
          <div><span className="muted small">{t('level').toUpperCase()}</span><b>{hud.level}</b></div>
          {hud.time >= 0
            ? <div><span className="muted small">{t('timeLeft').toUpperCase()}</span><b>{hud.time}s{hud.speed > 1 && <span className="gold"> x{hud.speed}</span>}</b></div>
            : <div><span className="muted small">{t('rocks').toUpperCase()}</span><b>{throwsText}</b></div>}
          <div><span className="muted small">{t('targets').toUpperCase()}</span><b>{hud.left}</b></div>
        </PixelFrame>
        <PixelButton scale={1} onClick={() => pause(true)} aria-label={t('pause')} disabled={!!outcome}><Icon name="pause" size={16} alt="" /></PixelButton>
      </div>

      <div className="rock-main">
        <PixelFrame theme="grey_stone_chiseld" scale={1} className="rock-frame">
          <div className="rock-field" ref={field} tabIndex={0} role="application" aria-label={t('rockFieldLabel')}
            onPointerDown={down} onPointerMove={move} onPointerUp={up(false)} onPointerCancel={up(true)} onKeyDown={key}>
            <canvas ref={canvas} />
            {!sprites && <div className="rock-loading muted">…</div>}
          </div>
        </PixelFrame>
        <div className="rock-vslider"><PixelSlider value={hud.angle} min={0} max={90} step={1} onChange={a => aimTo(a, game.current.power)} label={t('angle')} valueText={`${Math.round(hud.angle)}°`} />
          <b>{Math.round(hud.angle)}°</b></div>
        <div className="rock-power">
          <PixelSlider value={hud.power} color="red" onChange={p => aimTo(game.current.angle, p)} label={t('power')} valueText={`${Math.round(hud.power * 100)}%`} />
          <b>{Math.round(hud.power * 100)}%</b></div>
        <PixelButton scale={1} variant="red" className="rock-shoot" onClick={shoot} disabled={!hud.canThrow} aria-label={t('shoot')}><Icon name="stone" size={32} alt="" /></PixelButton>
      </div>

      <Modal open={paused && !outcome} onClose={() => pause(false)} title={t('paused')}>
        <div className="col-actions">
          <PixelButton scale={1} onClick={() => pause(false)}>{t('resume')}</PixelButton>
          {mode !== 'ARCADE' && <PixelButton scale={1} onClick={endGame}>{t('finishGame')}</PixelButton>}
          <PixelButton scale={1} onClick={playAgain}>{t('restart')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={quit}>{t('quit')}</PixelButton>
          <span className="muted small">{t('rockStonePrice', { n: PLAY_COST_STONE })}</span>
        </div>
      </Modal>

      {/* Escape / outside tap do nothing here: an achievement or level-up popup can sit on top of this one, and dismissing it must not also leave the results. */}
      <Modal open={!!outcome} onClose={() => {}} title={t('gameOver')}>
        {outcome && (
          <div className="rock-over">
            {outcome.newHighScore && <p className="rock-new-high" role="status">{t('newHighScore')}</p>}
            <div className="rock-score">{outcome.score}</div>
            <dl className="rock-results">
              <dt>{t('levelReached')}</dt><dd>{outcome.level}</dd>
              <dt>{t('targetsHit')}</dt><dd>{outcome.targetsHit}</dd>
              <dt>{t('xpEarned')}</dt><dd>+{outcome.rewards.xp}</dd>
              {(outcome.rewards.body + outcome.rewards.mind + outcome.rewards.soul) > 0 && <>
                <dt>{t('statPoints')}</dt><dd>{t('body')} +{outcome.rewards.body} · {t('mind')} +{outcome.rewards.mind} · {t('soul')} +{outcome.rewards.soul}</dd></>}
            </dl>
            {outcome.rewards.items.length > 0 && <div className="row wrap">{outcome.rewards.items.map(id => <Icon key={id} name={ITEM_SPRITE[id as ItemId] ?? id} size={32} alt={id} />)}</div>}
            <div className="col-actions">
              <PixelButton scale={1} onClick={playAgain}>{t('playAgain')}</PixelButton>
              <PixelButton scale={1} variant="red" onClick={quit}>{t('home')}</PixelButton>
              <span className="muted small">{t('rockStonePrice', { n: PLAY_COST_STONE })} ({stone})</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={needStone} onClose={() => setNeedStone(false)} title={t('rockThrowing')}>
        <p role="alert">{t('needStones', { n: PLAY_COST_STONE })}</p>
        <PixelButton scale={1} onClick={() => setNeedStone(false)}>{t('back')}</PixelButton>
      </Modal>
    </div>
  );
}
