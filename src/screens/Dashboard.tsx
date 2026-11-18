import { bobrNudge, todaySummary, nextSteps, fmtClock, minutesOfDay, bobrStage, completedToday, emotionNow, happinessNow, hungerAt, progressToNextLevel, xpForNextLevel, MAX_LEVEL } from '../domain';
import { PenGame } from '../ui/PenGame';
import { preloadWorld } from './WorldMap';
import { flyIntoWorld } from '../ui/worldPortal';
import { enterWorldFromHome } from './worldEntry';
import { useAppState, actions } from '../data/hooks';
import { useNow } from '../hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tradeFor, willTrade, type GameMode } from '../domain';
import { useNavBadges } from '../ui/navBadges';
import { NAV_DEFS } from '../ui/navItems';
import { useT } from '../i18n/useT';
import { setAppDrawer } from '../ui/appDrawer';
import { useLongPress } from '../ui/misc';
import { wisdomAt } from '../data/wisdom';
import { navigate } from '../router';
import { FrameDensity, PixelFrame } from '../ui/PixelFrame';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { Chip, Icon, StatBox } from '../ui/misc';
import { BobrPen } from '../ui/BobrPen';
import { PenScene } from '../ui/PenScene';
import { Inventory, TradeBar, TradeSlot } from '../ui/Inventory';
import { frameOr } from '../ui/themes';

/** Home as a game menu: every piece of information and every destination sits in its own frame. */
/** Menu sprites shown big and frameless on Home (their height in interface units, 1x), by sprite name. */
const BIG_ICON: Record<string, number> = { apps: 156 };

export function Dashboard() {
  const stats = useAppState(s => s.stats);
  const bobr = useAppState(s => s.bobr);
  const bars = useAppState(s => s.settings.bars);
  const el = useAppState(s => s.settings.elements);
  const fr = (id: string) => frameOr(id, 'app');
  const tasks = useAppState(s => s.tasks);
  const habits = useAppState(s => s.habits);
  const achievements = useAppState(s => s.achievements);
  const planner = useAppState(s => s.planner);
  const now = useNow(1000);
  const t = useT();

  const hunger = hungerAt(bobr.lastInteraction, now);
  const happiness = happinessNow(bobr, now);
  const emotion = emotionNow(bobr, now);
  const left = xpForNextLevel(stats.level, stats.totalExperiencePoints);

  const [noMood, setNoMood] = useState(false);   // a pop-up that fades on its own when he refuses
  useEffect(() => { if (!noMood) return; const id = setTimeout(() => setNoMood(false), 1800); return () => clearTimeout(id); }, [noMood]);
  const [trading, setTrading] = useState(false);   // tapping Bóbr opens / closes the trade (slots, arrow, button)
  const [step, setStep] = useState<null | 'main' | 'mode'>(null);   // tapping Bóbr first offers trade or play, then (play) which game
  const lastStep = useRef<'main' | 'mode'>('main');   // what the choices show while they fade out
  if (step) lastStep.current = step;
  const [game, setGame] = useState<GameMode | null>(null);   // the rock game, played in the pen
  const [penCard, setPenCard] = useState<HTMLElement | null>(null);
  const penRowRef = useCallback((el: HTMLElement | null) => setPenCard(el ? el.closest<HTMLElement>('.pen-card') : null), []);
  const deal = tradeFor(now);
  const worlds = useAppState(s => s.worlds.list);
  const flyNow = (btn: HTMLElement) => {   // the world played last, else the list of worlds
    const last = worlds.reduce<(typeof worlds)[number] | null>((b, w) => (!b || w.playedAt > b.playedAt ? w : b), null);
    enterWorldFromHome(true);
    const to = last ? `/games/paperplane/play/${last.id}` : '/games/paperplane';
    if (last) flyIntoWorld(btn.closest('.pen-card'), () => navigate(to), preloadWorld); else navigate(to);
  };
  const flyLake = () => {   // press and hold on the plane: the Lake District (the one played last, else a new one)
    const lakes = worlds.filter(w => w.kind === 'lakedistrict');
    const last = lakes.reduce<(typeof lakes)[number] | null>((b, w) => (!b || w.playedAt > b.playedAt ? w : b), null);
    const id = last?.id ?? actions.createWorld(t('worldLake'), Math.floor(Math.random() * 2 ** 31), 'lakedistrict');
    if (!id) { navigate('/games/paperplane'); return; }   // (the list of worlds is full)
    enterWorldFromHome(true);
    navigate(`/games/paperplane/play/${id}`);
  };
  const appsHeld = useRef(false);
  const appsHold = useLongPress(() => { appsHeld.current = true; navigate('/apps'); });   // press and hold: the list with descriptions
  const badges = useNavBadges();
  const navItems = useAppState(s => s.settings.nav.items);
  const inNav = new Set(NAV_DEFS.filter(d => navItems.includes(d.id)).map(d => d.path));   // what the nav bar already shows is not repeated here
  const nudge = bobrNudge({ ...planner, tasks, habits }, now);
  const nudgeText = !nudge ? '' : nudge.kind === 'now' ? t('nudgeNow', { title: nudge.title }) : nudge.kind === 'soon' ? t('nudgeSoon', { title: nudge.title, n: nudge.minutes }) : t('nudgeLate', { n: nudge.n });
  /** The planner box: the nudge if any, else mostly what is coming up (rotating each minute), with an anecdote every fourth minute. */
  const upcoming: string[] = [];
  const nextEv = todaySummary({ ...planner, tasks, habits }, now).nextEvent;
  if (nextEv && nextEv.time != null && nextEv.time > minutesOfDay(now)) upcoming.push(t('upNextEvent', { time: fmtClock(nextEv.time), title: nextEv.title }));
  for (const st of nextSteps({ ...planner, tasks, habits }, now).slice(0, 4)) {
    if (st.kind === 'event') upcoming.push(t('upNextTask', { title: st.event.title }));
    else if (st.kind === 'task') upcoming.push(t('upNextTask', { title: st.task.title }));
    else upcoming.push(t('upNextHabit', { title: st.habit.title }));
  }
  const minute = Math.floor(now / 60000);
  const boxText = nudgeText || (upcoming.length && minute % 4 !== 3 ? upcoming[(minute - Math.floor((minute + 1) / 4)) % upcoming.length] : wisdomAt(now).text);
  /** The menu: destination, sprite, label and an optional counter badge. */
  const menu = [
    { path: '/tasks', icon: 'task', label: t('chatTasks'), badge: badges['/tasks'] ?? null },
    { path: '/habits', icon: 'habit', label: t('chatHabits'), badge: badges['/habits'] ?? null },
    { path: '/apps', icon: 'apps', label: t('apps'), badge: null },
  ].filter(m => !inNav.has(m.path));

  return (
    <FrameDensity.Provider value="slim">
    <div className="screen dash">
      <div className="col col-a">
        <PixelFrame theme={fr(el.dashLevel)} scale={1} className="card level-card">
          <div className="level-main">
            <div className="row between">
              <span>{t('level').toUpperCase()} {stats.level}</span>
              <span className="muted">{stats.level >= MAX_LEVEL ? t('max') : t('xpToGo', { n: left })}</span>
            </div>
            <PixelProgressBar value={progressToNextLevel(stats.level, stats.totalExperiencePoints)} max={1} look={bars.xp} label={t('experiencePoints')} />
            <div className="muted small xp-total">{t('xpTotal', { n: stats.totalExperiencePoints })}</div>
          </div>
          <button type="button" className="cal-tile level-trophy" onClick={() => navigate('/achievements')} aria-label={t('trophies')}>
            <Icon name="thropy" size={48} />
            {badges['/achievements'] && <span className="menu-badge"><Chip color="#b6a432">{badges['/achievements']}</Chip></span>}
          </button>
        </PixelFrame>

        <div className="stats3">
          <StatBox stat="body" value={stats.body} frame={el.dashBody} onLongPress={() => navigate('/apps/exercise')} tip={t('holdBodyTip')} />
          <StatBox stat="mind" value={stats.mind} frame={el.dashMind} onLongPress={() => navigate('/apps/mindmap')} tip={t('holdMindTip')} />
          <StatBox stat="soul" value={stats.soul} frame={el.dashSoul} onLongPress={() => navigate('/apps/notes')} tip={t('holdSoulTip')} />
        </div>

        <PixelFrame theme={fr(el.dashPen)} scale={1} className="card pen-card">
          <PenScene />
          <div className="pen-row" ref={penRowRef}>
            {trading ? <TradeSlot emotion={emotion} deal={deal} side="left" /> : <div className="pen-slots" />}
            <BobrPen stage={bobrStage(stats.level)} emotion={emotion} onBobr={() => { if (trading) setTrading(false); else setStep(v => (v ? null : 'main')); }} bobrLabel={t('trade')} bobrOn={trading || !!step} onChat={() => navigate('/chat')} chatLabel={t('chatButton')} choice={{ open: !!step && !trading && !game,
              left: (step ?? lastStep.current) === 'main'
                ? { icon: 'trade', wide: true, label: t('trade'), onClick: () => { setStep(null); if (willTrade(emotion)) setTrading(true); else setNoMood(true); } }
                : { icon: 'arcade', label: t('arcadeMode'), text: t('arcadeMode'), onClick: () => { setStep(null); setGame('ARCADE'); } },
              right: (step ?? lastStep.current) === 'main'
                ? { icon: 'joystick', label: t('games'), onClick: () => setStep('mode'), onHold: () => { setStep(null); navigate('/games'); } }
                : { icon: 'timetrial', label: t('timeTrialMode'), text: t('timeTrialMode'), onClick: () => { setStep(null); setGame('TIMETRIAL'); } } }} onSign={() => navigate('/start')} signLabel={t('startHere')} onFly={flyNow} onFlyHold={flyLake} flyLabel={t('world')} />
            {trading ? <TradeSlot emotion={emotion} deal={deal} side="right" /> : <div className="pen-slots" />}
          </div>
          {trading && willTrade(emotion) && <TradeBar deal={deal} />}
          {game && penCard && <PenGame card={penCard} mode={game} onClose={() => setGame(null)} />}
          {noMood && <div className="mood-pop" role="status">{t('noTradeMoodPop')}</div>}
        </PixelFrame>
        <PixelFrame as="button" theme={fr(el.dashNudge)} scale={1} className="card nudge" onClick={() => navigate('/plan')} aria-label={t('planner')}>
          <Icon name="calendar" size={54} />
          <span className="nudge-text">{boxText}</span>
          {badges['/plan'] && <span className="menu-badge"><Chip color="#b6a432">{badges['/plan']}</Chip></span>}
        </PixelFrame>

        <div className="needs">
          <PixelFrame theme={fr(el.dashHunger)} scale={1} className="card"><div className="meter"><span>{t('hunger').toUpperCase()}</span><PixelProgressBar value={hunger} max={1} look={bars.hunger} scale={1} label={t('hunger')} /></div></PixelFrame>
          <PixelFrame theme={fr(el.dashHappiness)} scale={1} className="card"><div className="meter"><span>{t('happiness').toUpperCase()}</span><PixelProgressBar value={happiness} max={1} look={bars.happiness} scale={1} label={t('happiness')} /></div></PixelFrame>
        </div>
        <Inventory emotion={emotion} frame={el.dashInventory} />
      </div>

      <div className="col col-b">
        <nav className="menu-grid" aria-label={t('mainNav')}>
          {menu.map(m => BIG_ICON[m.icon] ? (
            <button key={m.path} type="button" className="cal-tile" onClick={() => (m.icon === 'apps' ? (appsHeld.current ? (appsHeld.current = false) : setAppDrawer(true)) : navigate(m.path))} {...(m.icon === 'apps' ? appsHold : {})} aria-label={m.label}>
              <Icon name={m.icon} size={BIG_ICON[m.icon]} />
              {m.badge && <span className="menu-badge"><Chip color="#b6a432">{m.badge}</Chip></span>}
            </button>
          ) : (
            <PixelFrame key={m.path} as="button" theme={fr(el.dashMenu)} scale={1} className="menu-tile" onClick={() => navigate(m.path)}>
              <Icon name={m.icon} size={32} />
              <span>{m.label}</span>
              {m.badge && <span className="menu-badge"><Chip color="#b6a432">{m.badge}</Chip></span>}
            </PixelFrame>
          ))}
        </nav>
      </div>
    </div>
    </FrameDensity.Provider>
  );
}
