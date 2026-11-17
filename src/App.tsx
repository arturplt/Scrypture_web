import { useRoute, navigate } from './router';
import { Chip, Icon } from './ui/misc';
import { PixelFrame } from './ui/PixelFrame';
import { Dashboard } from './screens/Dashboard';
import { TaskDetail } from './screens/TaskDetail';
import { Tasks } from './screens/Tasks';
import { Habits } from './screens/Habits';
import { HabitDetail } from './screens/HabitDetail';
import { Achievements } from './screens/Achievements';
import { Chat } from './screens/Chat';
import { StartHere } from './screens/StartHere';
import { Settings } from './screens/Settings';
import { Apps } from './screens/Apps';
import { Pixelite } from './screens/Pixelite';
import { FrameEditor } from './screens/FrameEditor';
import { Games } from './screens/Games';
import { Sanctuary } from './screens/Sanctuary';
import { Planner } from './screens/Planner';
import { Exercise } from './screens/Exercise';
import { MindMaps } from './screens/MindMaps';
import { MindMapEditor } from './screens/MindMapEditor';
import { Notes } from './screens/Notes';
import { EmoticonManager } from './screens/EmoticonManager';
import { Worlds } from './screens/Worlds';
import { WorldMap } from './screens/WorldMap';
import { RockGame } from './screens/RockGame';
import { RockLeaderboard } from './screens/RockLeaderboard';
import { ThemeManager } from './screens/ThemeManager';
import { Onboarding } from './screens/Onboarding';
import { persistent, useAppState } from './data/hooks';
import { EventHost } from './ui/EventHost';
import { startUiSound } from './audio/uiSound';
import { UndoBar } from './ui/UndoBar';
import { Notices } from './ui/Notices';
import { Keyboard } from './ui/Keyboard';
import { useI18n } from './i18n/useT';
import { useLayoutEffect, useRef } from 'react';
import { useEffect } from 'react';
import { useUi } from './ui/useUi';
import { useChipVars } from './ui/chips';
import { boxSprite, boxVars } from './ui/boxSprite';
import { GESTURE_EVENTS, enterFullscreen, fullscreenSupported, isFullscreen } from './ui/fullscreen';
import { usePlateAttrs } from './ui/navPlates';
import { DeviceShell } from './ui/DeviceShell';
import { FrameDensity } from './ui/PixelFrame';
import { useNavPreview } from './ui/navPreview';
import { NAV_DEFS, isActivePath } from './ui/navItems';
import { useNavBadges } from './ui/navBadges';
import { LIGHT_FRAMES, frameOr, resolveFrame, splitFrame } from './ui/themes';
import type { Key } from './i18n';
import './app.css';

function Screen({ route }: { route: string }) {
  if (route === '/tasks') return <Tasks />;
  if (route.startsWith('/tasks/')) return <TaskDetail id={route.slice('/tasks/'.length)} />;
  if (route === '/habits') return <Habits />;
  if (route.startsWith('/habits/')) return <HabitDetail id={route.slice('/habits/'.length)} />;
  if (route === '/achievements') return <Achievements />;
  if (route === '/chat') return <Chat />;
  if (route === '/plan') return <Planner />;
  if (route === '/start') return <StartHere />;
  if (route === '/games') return <Games />;
  if (route === '/games/leaderboard') return <RockLeaderboard />;
  if (route === '/games/play/arcade') return <RockGame key="arcade" mode="ARCADE" />;
  if (route === '/games/play/practice') return <RockGame key="practice" mode="PRACTICE" />;
  if (route === '/games/play/timetrial') return <RockGame key="timetrial" mode="TIMETRIAL" />;
  if (route === '/apps') return <Apps />;
  if (route === '/apps/pixelite') return <Pixelite />;
  if (route === '/apps/sanctuary') return <Sanctuary />;
  if (route === '/apps/exercise') return <Exercise />;
  if (route === '/apps/mindmap') return <MindMaps />;
  if (route.startsWith('/apps/mindmap/')) return <MindMapEditor id={route.slice('/apps/mindmap/'.length)} />;
  if (route === '/apps/emoticons') return <EmoticonManager />;
  if (route === '/apps/notes') return <Notes />;
  if (route.startsWith('/apps/notes/')) return <Notes id={route.slice('/apps/notes/'.length)} />;
  if (route === '/games/paperplane') return <Worlds />;
  if (route.startsWith('/games/paperplane/play/')) return <WorldMap id={route.slice('/games/paperplane/play/'.length)} />;
  if (route.startsWith('/apps/pixelite/frame/')) return <FrameEditor name={route.slice('/apps/pixelite/frame/'.length)} />;
  if (route === '/settings') return <Settings />;
  if (route === '/theme') return <ThemeManager />;
  return <Dashboard />;
}

export function App() {
  const route = useRoute();
  const playing = route.startsWith('/games/play/') || route.startsWith('/games/paperplane/play/') || route.startsWith('/apps/mindmap/');   // the game wants the whole screen: no bottom bar
  const { t, lang } = useI18n();
  const textScale = useAppState(s => s.settings.textScale);
  const navRef = useRef<HTMLElement>(null);
  const wantFullscreen = useAppState(s => s.settings.fullscreen);
  const chips = useAppState(s => s.settings.chips);
  const chipStyle = useChipVars(chips);
  const nav = useAppState(s => s.settings.nav);
  const badges = useNavBadges();
  const plate = usePlateAttrs(nav.plate, nav.plateScale);
  const mainFrame = useAppState(s => s.settings.frameTheme);
  const navFrame = frameOr(nav.frame, 'wood_steel');
  const navLight = LIGHT_FRAMES.has(resolveFrame(navFrame, mainFrame, '', '').name);   // dark labels on light frames
  const device = useAppState(st => st.settings.device);
  const navPreview = useNavPreview();   // a screen showing its result in the bar (Pixelite)
  const level = useAppState(st => st.stats.level);
  const reduceMotion = useAppState(st => !!st.settings.reduceMotion);
  const highContrast = useAppState(st => !!st.settings.highContrast);
  const { ui, layout, rail: railWanted } = useUi();
  const rail = railWanted && !device;   // inside the device case the navigation is always the bottom row of keys
  // before paint, so the first frame already has the right scale and layout
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(textScale));
    root.style.setProperty('--ui', String(ui));
    root.dataset.layout = layout;
    root.dataset.navlabels = nav.labels;
    for (const [k, v] of Object.entries(chipStyle)) root.style.setProperty(k, String(v));
    if (reduceMotion) root.dataset.motion = 'reduce'; else delete root.dataset.motion;
    if (highContrast) root.dataset.contrast = 'high'; else delete root.dataset.contrast;
    if (rail) root.dataset.rail = ''; else delete root.dataset.rail;
    if (device) root.dataset.device = ''; else delete root.dataset.device;
  }, [textScale, ui, layout, rail, device, chipStyle, nav.labels, reduceMotion, highContrast]);
  // the wide dark rows in Settings use the big box sprite; build its repeating version once
  useEffect(() => { boxSprite('/assets/raw/box_large.png', 3).then(sp => { for (const [k, v] of Object.entries(boxVars('pick', sp))) document.documentElement.style.setProperty(k, v); }, () => {}); }, []);
  useEffect(() => { document.documentElement.lang = lang.toLowerCase(); }, [lang]);
  useEffect(() => startUiSound(), []);
  const onboarded = useAppState(s => s.user.onboarded);
  // Start in full screen: browsers only allow it from a user gesture, so go in on the first tap / key press. If the user
  // leaves full screen later (Esc, back) we do not drag them back in until the next visit.
  useLayoutEffect(() => {   // layout effect: the listener is attached before the first paint, so even an instant tap counts
    if (!wantFullscreen || !fullscreenSupported() || isFullscreen()) return;
    let tries = 0;
    const remove = () => {
      GESTURE_EVENTS.forEach(ev => window.removeEventListener(ev, attempt, true));
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
    async function attempt() { tries++; if ((await enterFullscreen()) || tries >= 3) remove(); }
    // once the page has been in full screen by any route (e.g. the Settings button), the automatic entry has done its job
    function onChange() { if (isFullscreen()) remove(); }
    GESTURE_EVENTS.forEach(ev => window.addEventListener(ev, attempt, true));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return remove;
  }, [wantFullscreen]);

  // Reserve exactly as much room above the bottom bar as it needs (it grows with labels, wrapped rows and big text)
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) { if (playing) document.documentElement.style.setProperty('--nav-clear', '0px'); return; }
    const set = () => { const h = Math.ceil(el.getBoundingClientRect().height); document.documentElement.style.setProperty('--nav-clear', `${h + 8}px`); document.documentElement.style.setProperty('--nav-h', `${h}px`); };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onboarded, playing, device]);
  // Tab switch: the page slides in from the side of the new tab and overshoots a little before settling (the bar's selector slides too, below)
  const prevRoute = useRef(route);
  const contentRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const from = prevRoute.current;
    prevRoute.current = route;
    if (from === route || reduceMotion || !onboarded) return;
    const ids = NAV_DEFS.filter(d => nav.items.includes(d.id));
    const at = (r: string) => ids.findIndex(d => isActivePath(r, d.path));
    const a = at(from), b = at(route);
    const dir = a >= 0 && b >= 0 && a !== b ? Math.sign(b - a) : route.length >= from.length ? 1 : -1;
    const els: [Element | null, number][] = [[contentRef.current, 40]];
    const root = document.documentElement;
    root.style.overflowX = 'clip';
    const anims = els.flatMap(([el, pct]) => el ? [el.animate(
      [{ transform: `translateX(${dir * pct}%)`, opacity: 0.2 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 480, easing: 'cubic-bezier(.3,1.5,.5,1)' })] : []);
    Promise.allSettled(anims.map(x => x.finished)).then(() => { root.style.overflowX = ''; });
    return () => { anims.forEach(x => x.cancel()); root.style.overflowX = ''; };
  }, [route]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the active-tab marker (outline / plate / underline) is one element that glides to the new tab with an overshoot
  const slide = ['outline', 'plate', 'underline'].includes(nav.active);
  const selRef = useRef<HTMLSpanElement>(null);
  const selPlaced = useRef(false);
  useLayoutEffect(() => {
    const frame = navRef.current?.firstElementChild as HTMLElement | null | undefined, sel = selRef.current;
    if (!frame || !sel) { selPlaced.current = false; return; }
    const place = () => {
      const b = frame.querySelector<HTMLElement>('.nav-btn.active');
      if (!b) { sel.style.opacity = '0'; return; }
      sel.style.transition = selPlaced.current && !reduceMotion ? '' : 'none';
      sel.style.opacity = '1';
      sel.style.left = `${b.offsetLeft}px`; sel.style.top = `${b.offsetTop}px`;
      sel.style.width = `${b.offsetWidth}px`; sel.style.height = `${b.offsetHeight}px`;
      selPlaced.current = true;
    };
    place();
    let first = true;   // observe() reports once straight away: that is not a resize, and snapping then would cancel the glide
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } selPlaced.current = false; place(); });
    ro.observe(frame);
    return () => ro.disconnect();
  }, [route, slide, nav.items, nav.labels, nav.plate, navPreview, rail, device, onboarded, playing, reduceMotion]);
  const banner = !persistent && <div className="banner" role="alert">{t('storageWarning')}</div>;
  if (!onboarded) return <div className="app">{banner}<main className="content"><Onboarding /></main></div>;
  const navEl = !playing && (
      <nav className="nav" aria-label={t('mainNav')} ref={navRef}>
        <PixelFrame theme={navFrame} scale={1} className={`nav-frame ${navLight ? 'nav-light' : ''}`} data-active={nav.active} data-labels={nav.labels} data-slide={slide ? '' : undefined} {...plate}>
          {slide && !navPreview && <span className="nav-sel" ref={selRef} aria-hidden="true" />}
          {navPreview ? <>
            <button className="nav-btn" onClick={() => navigate('/apps')} aria-label={t('back')}>
              <Icon name="arrow_stone_left" size={device ? 32 : 48} />
              {nav.labels === 'both' && <span className="nav-label">{t('back')}</span>}
            </button>
            <div className="nav-preview"><img src={navPreview.url} alt="" style={navPreview.height ? { height: navPreview.height } : undefined} /></div>
          </> : NAV_DEFS.filter(d => nav.items.includes(d.id)).map(d => {
            const active = isActivePath(route, d.path);
            return (
              <button key={d.id} className={`nav-btn ${active ? 'active' : ''}`} onClick={() => navigate(d.path)} aria-label={t(d.label)} aria-current={active ? 'page' : undefined}>
                <Icon name={d.icon} size={device ? Math.round(d.size * 0.75) : d.size} />
                {badges[d.path] && <span className="menu-badge"><Chip color="#b6a432">{badges[d.path]}</Chip></span>}
                {nav.labels === 'both' && <span className="nav-label">{t(d.label)}</span>}
              </button>
            );
          })}
        </PixelFrame>
      </nav>);
  const page = <main className="content" id="main" tabIndex={-1} ref={contentRef}><Screen route={route} /></main>;
  const here = NAV_DEFS.find(d => isActivePath(route, d.path));
  const title = route === '/' ? 'Scrypture' : here ? t(here.label) : route.startsWith('/games') ? t('games') : route === '/theme' ? t('themeManager') : route === '/apps/pixelite' ? t('pixelite') : route.startsWith('/habits') ? t('chatHabits') : t('settings');
  return (
    <div className={`app ${playing ? 'playing' : ''}`}>
      {banner}
      {device ? <DeviceShell title={title} level={level} resetKey={route} nav={<FrameDensity.Provider value="slim">{navEl}</FrameDensity.Provider>}>{page}</DeviceShell> : <>{page}{navEl}</>}
      <EventHost />
      <UndoBar />
      <Notices />
      <Keyboard />
    </div>
  );
}
