/**
 * Planner reminders: a system notification shortly before a timed activity, while the app is open (or installed and
 * running in the background). There is no push server, so a closed app cannot remind; the Planner says so.
 * Which reminders were shown is kept per device in localStorage, so a reload does not repeat them.
 */
import { dueReminders, fmtClock, reminderKey } from '../domain';
import { store } from '../data/hooks';
import { effectiveLang, translate } from '../i18n';
import { buzz } from './haptics';

const SEEN_KEY = 'scrypture.reminded', SEEN_MAX = 200, CHECK_MS = 20_000;

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyAllowed = () => canNotify() && Notification.permission === 'granted';
/** Ask for permission (it must follow a tap). True when notifications may be shown. */
export async function askToNotify(): Promise<boolean> {
  if (!canNotify()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

function loadSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function saveSeen(list: string[]) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_MAX))); } catch { /* private mode: reminders may repeat after a reload */ } }

async function show(title: string, body: string, tag: string) {
  const opts: NotificationOptions = { body, tag, icon: '/icons/icon-192.png' };
  // Android Chrome only shows notifications made through the service worker
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.showNotification(title, opts); return; } } catch { /* fall back to the page's own */ }
  try { new Notification(title, opts); } catch { /* not allowed here */ }
}

/** Check every 20 s (and when the tab comes back) for activities to remind about. Returns the stop function. */
export function startReminders(): () => void {
  const seen = loadSeen();
  const check = () => {
    const s = store.getState(), lead = s.planner.remind;
    if (lead === undefined || !notifyAllowed()) return;
    const due = dueReminders(s.planner.events, Date.now(), lead, new Set(seen));
    if (!due.length) return;
    const lang = effectiveLang(s.settings.language, s.stats.totalTasksCompleted);
    for (const e of due) {
      seen.push(reminderKey(e));
      void show(e.title, translate(lang, 'plRemindBody', { time: fmtClock(e.time!) }), reminderKey(e));
    }
    buzz('level');
    saveSeen(seen);
  };
  check();
  const timer = setInterval(check, CHECK_MS);
  const vis = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
}
