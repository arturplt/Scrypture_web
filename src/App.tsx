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
import { startReminders } from './audio/reminders';
import { UndoBar } from './ui/UndoBar';
import { useViewport } from './ui/viewport';
import { SaveIcon } from './ui/SaveIcon';
import { Notices } from './ui/Notices';
import { Keyboard } from './ui/Keyboard';
import { useI18n } from './i18n/useT';
import { useLayoutEffect, useRef, useState } from 'react';
import { useEffect } from 'react';
import { useUi } from './ui/useUi';
import { useChipVars } from './ui/chips';
import { boxSprite, boxVars } from './ui/boxSprite';
import { GESTURE_EVENTS, enterFullscreen, fullscreenSupported, isFullscreen } from './ui/fullscreen';
import { usePlateAttrs } from './ui/navPlates';
import { DeviceShell } from './ui/DeviceShell';
import { FrameDensity } from './ui/PixelFrame';
import { useNavPreview } from './ui/navPreview';
import { NAV_DEFS, isActivePath, navDefsIn } from './ui/navItems';
import { useNavBadges } from './ui/navBadges';
import { AppDrawerHost, setAppDrawer } from './ui/appDrawer';
import { useLongPress } from './ui/misc';
import { LIGHT_FRAMES, frameOr, resolveFrame } from './ui/themes';
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

/** One nav-bar button. Apps opens the XL drawer on a tap and the described list on a press and hold. */
function NavButton({ d, active, label, size, badge, showLabel }: { d: (typeof NAV_DEFS)[number]; active: boolean; label: string; size: number; badge?: string | number | null; showLabel: boolean }) {
  const held = useRef(false);
  const hold = useLongPress(d.id === 'apps' ? () => { held.current = true; navigate('/apps'); } : undefined);
  return (
    <button className={`nav-btn ${active ? 'active' : ''}`} {...hold} aria-label={label} aria-current={active ? 'page' : undefined}
      onClick={() => { if (held.current) { held.current = false; return; } if (d.id === 'apps') setAppDrawer(true); else navigate(d.path); }}>
      <Icon name={d.icon} size={size} />
      {badge && <span className="menu-badge"><Chip color="#b6a432">{badge}</Chip></span>}
      {showLabel && <span className="nav-label">{label}</span>}
    </button>
  );
}

export function App() {
  const route = useRoute();
  const playing = route.startsWith('/games/play/') || route.startsWith('/games/paperplane/play/') || route.startsWith('/apps/mindmap/');   // the game wants the whole screen: no bottom bar
  const { t, lang } = useI18n();
  const textScale = useAppState(s => s.settings.textScale);
  const navRef = useRef<HTMLElement>(null);
  const [navHidden, setNavHidden] = useState(() => { try { return localStorage.getItem('navHidden') === '1'; } catch { return false; } });
  const toggleNav = (v: boolean) => { setNavHidden(v); try { localStorage.setItem('navHidden', v ? '1' : '0'); } catch { /* private mode */ } };
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
  // labels under the icons wrap the bar into rows; when that would take three or more (many items, big text, a narrow phone) show the icons alone
  const { w: vw } = useViewport();
  const perRow = Math.max(1, Math.floor((vw / ui - 56) / (68 * textScale)));
  const labels = nav.labels === 'both' && !(!rail && !device && Math.ceil(nav.items.length / perRow) >= 3) ? 'both' : 'icons';
  // before paint, so the first frame already has the right scale and layout
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(textScale));
    root.style.setProperty('--ui', String(ui));
    root.dataset.layout = layout;
    root.dataset.navlabels = labels;
    for (const [k, v] of Object.entries(chipStyle)) root.style.setProperty(k, String(v));
    if (reduceMotion) root.dataset.motion = 'reduce'; else delete root.dataset.motion;
    if (highContrast) root.dataset.contrast = 'high'; else delete root.dataset.contrast;
    if (rail) root.dataset.rail = ''; else delete root.dataset.rail;
    if (device) root.dataset.device = ''; else delete root.dataset.device;
  }, [textScale, ui, layout, rail, device, chipStyle, labels, reduceMotion, highContrast]);
  // the wide dark rows in Settings use the big box sprite; build its repeating version once
  useEffect(() => { boxSprite('/assets/raw/box_large.png', 3).then(sp => { for (const [k, v] of Object.entries(boxVars('pick', sp))) document.documentElement.style.setProperty(k, v); }, () => {}); }, []);
  useEffect(() => { document.documentElement.lang = lang.toLowerCase(); }, [lang]);
  useEffect(() => startUiSound(), []);
  useEffect(() => startReminders(), []);
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
    const set = () => { const h = Math.ceil(el.getBoundingClientRect().height); document.documentElement.style.setProperty('--nav-clear', navHidden && !device && !rail ? '32px' : `${h + 8}px`); document.documentElement.style.setProperty('--nav-h', `${h}px`); };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onboarded, playing, device, rail, navHidden]);
  // Tab switch: the page slides in from the side of the new tab and overshoots a little before settling (the bar's selector slides too, below)
  const prevRoute = useRef(route);
  const contentRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const from = prevRoute.current;
    prevRoute.current = route;
    if (from === route || reduceMotion || !onboarded) return;
    const ids = navDefsIn(nav.items);
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
  }, [route, slide, nav.items, labels, nav.plate, navPreview, rail, device, onboarded, playing, reduceMotion]);
  const banner = !persistent && <div className="banner" role="alert">{t('storageWarning')}</div>;
  // swipe the bar down to tuck it away (the click that ends such a swipe is swallowed). Above the onboarding return: every hook must run on every render, or finishing onboarding crashes the app
  const swipe = useRef<{ y: number; done: boolean } | null>(null);
  if (!onboarded) return <div className="app ob-app">{banner}<main className="content ob-main"><Onboarding /></main><Keyboard /><Notices /></div>;   // (the notices too: a save from a newer app leaves this one at onboarding, and it must say why)
  const swipeProps = {
    onPointerDown: (e: React.PointerEvent) => { swipe.current = { y: e.clientY, done: false }; },
    onPointerMove: (e: React.PointerEvent) => { const s = swipe.current; if (s && !s.done && e.clientY - s.y > 28) { s.done = true; toggleNav(true); } },
    onPointerUp: () => { setTimeout(() => { swipe.current = null; }, 0); },
    onPointerCancel: () => { swipe.current = null; },
    onClickCapture: (e: React.MouseEvent) => { if (swipe.current?.done) { e.preventDefault(); e.stopPropagation(); } },
  };
  const canHide = !device && !rail && !navPreview;
  const navEl = !playing && (
      <nav className={`nav ${canHide && navHidden ? 'nav-hidden' : ''}`} aria-label={t('mainNav')} ref={navRef}>
        {canHide && navHidden && <button type="button" className="nav-toggle" aria-label={t('navShow')} onClick={() => toggleNav(false)}>
          <img src="/assets/raw/arrow_stone_up.png" alt="" />
        </button>}
        <PixelFrame theme={navFrame} scale={1} {...(canHide ? swipeProps : {})} className={`nav-frame ${navLight ? 'nav-light' : ''}`} data-active={nav.active} data-labels={labels} data-slide={slide ? '' : undefined} {...plate}>
          {slide && !navPreview && <span className="nav-sel" ref={selRef} aria-hidden="true" />}
          {navPreview ? <>
            <button className="nav-btn" onClick={() => navigate('/apps')} aria-label={t('back')}>
              <Icon name="arrow_stone_left" size={device ? 32 : 48} />
              {labels === 'both' && <span className="nav-label">{t('back')}</span>}
            </button>
            <div className="nav-preview"><img src={navPreview.url} alt="" style={navPreview.height ? { height: navPreview.height } : undefined} /></div>
          </> : navDefsIn(nav.items).map(d => {
            const active = isActivePath(route, d.path);
            return (
              <NavButton key={d.id} d={d} active={active} label={t(d.label)} size={device ? Math.round(d.size * 0.75) : d.size} badge={badges[d.path]} showLabel={labels === 'both'} />
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
      <AppDrawerHost />
      <UndoBar />
      <SaveIcon />
      <Notices />
      <Keyboard />
    </div>
  );
}
