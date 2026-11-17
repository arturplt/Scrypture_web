import { todaySummary, bobrStage, completedToday, emotionNow, happinessNow, hungerAt, progressToNextLevel, xpForNextLevel, MAX_LEVEL } from '../domain';
import { useAppState } from '../data/hooks';
import { useNow } from '../hooks';
import { useT } from '../i18n/useT';
import { navigate } from '../router';
import { FrameDensity, PixelFrame } from '../ui/PixelFrame';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { Chip, Icon, StatBox } from '../ui/misc';
import { BobrPen } from '../ui/BobrPen';
import { Inventory } from '../ui/Inventory';
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

  const openTasks = tasks.filter(x => !x.completed).length;
  const habitsToDo = habits.filter(h => !completedToday(h, now)).length;
  const unlocked = achievements.filter(a => a.unlocked).length;
  const planned = todaySummary({ ...planner, tasks, habits }, now).total;   // activities and to-dos still open today
  /** The menu: destination, sprite, label and an optional counter badge. */
  const menu = [
    { path: '/tasks', icon: 'task', label: t('chatTasks'), badge: openTasks ? String(openTasks) : null },
    { path: '/habits', icon: 'habit', label: t('chatHabits'), badge: habitsToDo ? String(habitsToDo) : null },
    { path: '/plan', icon: 'box_checked', label: t('planner'), badge: planned ? String(planned) : null },
    { path: '/start', icon: 'target', label: t('startHere'), badge: null },
    { path: '/chat', icon: 'chat_bubble_blue', label: t('chatButton'), badge: null },
    { path: '/games', icon: 'joystick_knob', label: t('games'), badge: null },
    { path: '/achievements', icon: 'achievement_gold', label: t('trophies'), badge: String(unlocked) },
    { path: '/apps', icon: 'pencil_yellow', label: t('apps'), badge: null },
    { path: '/settings', icon: 'rearrange', label: t('settings'), badge: null },
  ];

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
          <StatBox stat="body" value={stats.body} frame={el.dashBody} onLongPress={() => navigate('/apps/exercise')} />
          <StatBox stat="mind" value={stats.mind} frame={el.dashMind} onLongPress={() => navigate('/apps/mindmap')} />
          <StatBox stat="soul" value={stats.soul} frame={el.dashSoul} />
        </div>

        <PixelFrame theme={fr(el.dashPen)} scale={1} className="card pen-card"><BobrPen stage={bobrStage(stats.level)} emotion={emotion} /></PixelFrame>

        <div className="needs">
          <PixelFrame theme={fr(el.dashHunger)} scale={1} className="card"><div className="meter"><span>{t('hunger').toUpperCase()}</span><PixelProgressBar value={hunger} max={1} look={bars.hunger} scale={1} label={t('hunger')} /></div></PixelFrame>
          <PixelFrame theme={fr(el.dashHappiness)} scale={1} className="card"><div className="meter"><span>{t('happiness').toUpperCase()}</span><PixelProgressBar value={happiness} max={1} look={bars.happiness} scale={1} label={t('happiness')} /></div></PixelFrame>
        </div>
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
        <Inventory emotion={emotion} now={now} frame={el.dashInventory} />
      </div>
    </div>
    </FrameDensity.Provider>
  );
}
