import type { Key } from '../i18n';

/**
 * Destinations the navigation bar can show. `size` is the icon height in interface units: a whole multiple of the sprite's
 * own pixel height (2x), so every icon stays crisp even though the sprites differ in size.
 */
export interface NavDef { id: string; path: string; icon: string; size: number; label: Key }
export const NAV_DEFS: NavDef[] = [
  { id: 'home', path: '/', icon: 'home', size: 36, label: 'home' },
  { id: 'tasks', path: '/tasks', icon: 'task', size: 38, label: 'chatTasks' },
  { id: 'habits', path: '/habits', icon: 'habit', size: 32, label: 'chatHabits' },
  { id: 'plan', path: '/plan', icon: 'box_checked', size: 32, label: 'planner' },
  { id: 'start', path: '/start', icon: 'target', size: 32, label: 'startHere' },
  { id: 'chat', path: '/chat', icon: 'chat_bubble_blue', size: 36, label: 'chatButton' },
  { id: 'trophies', path: '/achievements', icon: 'achievement_gold', size: 40, label: 'trophies' },
  { id: 'apps', path: '/apps', icon: 'pencil_yellow', size: 32, label: 'apps' },
  { id: 'settings', path: '/settings', icon: 'rearrange', size: 32, label: 'settings' },
];
export const isActivePath = (route: string, path: string) => route === path || (path !== '/' && route.startsWith(`${path}/`));
