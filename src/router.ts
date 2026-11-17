import { useSyncExternalStore } from 'react';

/** Hash router (works on GitHub Pages with no server rewrites): #/tasks, #/habits/<id>, ... */
const subscribe = (cb: () => void) => { addEventListener('hashchange', cb); return () => removeEventListener('hashchange', cb); };
const read = () => location.hash.replace(/^#/, '') || '/';
export const useRoute = () => useSyncExternalStore(subscribe, read);
export const navigate = (path: string) => { location.hash = path; };
export const back = (fallback = '/') => (history.length > 1 ? history.back() : navigate(fallback));
