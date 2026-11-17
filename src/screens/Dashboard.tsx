import { bobrNudge, todaySummary, bobrStage, completedToday, emotionNow, happinessNow, hungerAt, progressToNextLevel, xpForNextLevel, MAX_LEVEL } from '../domain';
import { useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { useEffect, useState } from 'react';
import { tradeFor, willTrade } from '../domain';
import { useNavBadges } from '../ui/navBadges';
import { NAV_DEFS } from '../ui/navItems';
import { useT } from '../i18n/useT';
import { navigate } from '../router';
import { FrameDensity, PixelFrame } from '../ui/PixelFrame';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { Chip, Icon, StatBox } from '../ui/misc';
import { BobrPen } from '../ui/BobrPen';
import { Inventory, TradeBar, TradeSlot } from '../ui/Inventory';
import { frameOr } from '../ui/themes';

/** Home as a game menu: every piece of information and every destination sits in its own frame. */
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
  const deal = tradeFor(now);
  const badges = useNavBadges();
  const navItems = useAppState(s => s.settings.nav.items);
  const inNav = new Set(NAV_DEFS.filter(d => navItems.includes(d.id)).map(d => d.path));   // what the nav bar already shows is not repeated here
  const nudge = bobrNudge({ ...planner, tasks, habits }, now);
  const nudgeText = !nudge ? '' : nudge.kind === 'now' ? t('nudgeNow', { title: nudge.title }) : nudge.kind === 'soon' ? t('nudgeSoon', { title: nudge.title, n: nudge.minutes }) : t('nudgeLate', { n: nudge.n });
  /** The menu: destination, sprite, label and an optional counter badge. */
  const menu = [
    { path: '/tasks', icon: 'task', label: t('chatTasks'), badge: badges['/tasks'] ?? null },
    { path: '/habits', icon: 'habit', label: t('chatHabits'), badge: badges['/habits'] ?? null },
    { path: '/plan', icon: 'box_checked', label: t('planner'), badge: badges['/plan'] ?? null },
    { path: '/start', icon: 'target', label: t('startHere'), badge: null },
    { path: '/games', icon: 'joystick_knob', label: t('games'), badge: null },
    { path: '/achievements', icon: 'achievement_gold', label: t('trophies'), badge: badges['/achievements'] ?? null },
    { path: '/apps', icon: 'pencil_yellow', label: t('apps'), badge: null },
    { path: '/settings', icon: 'rearrange', label: t('settings'), badge: null },
  ].filter(m => !inNav.has(m.path));

  return (
    <FrameDensity.Provider value="slim">
    <div className="screen dash">
      <div className="col col-a">
        <PixelFrame theme={fr(el.dashLevel)} scale={1} className="card">
          <div className="row between">
            <span>{t('level').toUpperCase()} {stats.level}</span>
            <span className="muted">{stats.level >= MAX_LEVEL ? t('max') : t('xpToGo', { n: left })}</span>
          </div>
          <PixelProgressBar value={progressToNextLevel(stats.level, stats.totalExperiencePoints)} max={1} look={bars.xp} label={t('experiencePoints')} />
          <div className="muted small xp-total">{t('xpTotal', { n: stats.totalExperiencePoints })}</div>
        </PixelFrame>

        <div className="stats3">
          <StatBox stat="body" value={stats.body} frame={el.dashBody} onLongPress={() => navigate('/apps/exercise')} tip={t('holdBodyTip')} />
          <StatBox stat="mind" value={stats.mind} frame={el.dashMind} onLongPress={() => navigate('/apps/mindmap')} tip={t('holdMindTip')} />
          <StatBox stat="soul" value={stats.soul} frame={el.dashSoul} onLongPress={() => navigate('/apps/notes')} tip={t('holdSoulTip')} />
        </div>

        <PixelFrame theme={fr(el.dashPen)} scale={1} className="card pen-card">
          <div className="pen-row">
            {trading ? <TradeSlot emotion={emotion} deal={deal} side="left" /> : <div className="pen-slots" />}
            <BobrPen stage={bobrStage(stats.level)} emotion={emotion} onBobr={() => (willTrade(emotion) ? setTrading(v => !v) : (setTrading(false), setNoMood(true)))} bobrLabel={t('trade')} bobrOn={trading} onChat={() => navigate('/chat')} chatLabel={t('chatButton')} />
            {trading ? <TradeSlot emotion={emotion} deal={deal} side="right" /> : <div className="pen-slots" />}
          </div>
          {trading && willTrade(emotion) && <TradeBar deal={deal} />}
          {noMood && <div className="mood-pop" role="status">{t('noTradeMoodPop')}</div>}
        </PixelFrame>
        {nudge && <PixelFrame as="button" theme={fr(el.dashNudge)} scale={1} className="card nudge" onClick={() => navigate('/plan')}>{nudgeText}</PixelFrame>}

        <div className="needs">
          <PixelFrame theme={fr(el.dashHunger)} scale={1} className="card"><div className="meter"><span>{t('hunger').toUpperCase()}</span><PixelProgressBar value={hunger} max={1} look={bars.hunger} scale={1} label={t('hunger')} /></div></PixelFrame>
          <PixelFrame theme={fr(el.dashHappiness)} scale={1} className="card"><div className="meter"><span>{t('happiness').toUpperCase()}</span><PixelProgressBar value={happiness} max={1} look={bars.happiness} scale={1} label={t('happiness')} /></div></PixelFrame>
        </div>
        <Inventory emotion={emotion} frame={el.dashInventory} />
      </div>

      <div className="col col-b">
        <nav className="menu-grid" aria-label={t('mainNav')}>
          {menu.map(m => (
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
