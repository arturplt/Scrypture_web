import { useSyncExternalStore } from 'react';
import { useT } from '../i18n/useT';
import { AppDrawer } from '../screens/Apps';

/** The XL app drawer pop-up, openable from anywhere (the dashboard icon and the nav bar). */
let open = false;
const subs = new Set<() => void>();
export const setAppDrawer = (v: boolean) => { open = v; subs.forEach(f => f()); };
const useOpen = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => open);

export function AppDrawerHost() {
  const t = useT();
  const on = useOpen();
  if (!on) return null;
  return (
    <div className="drawer-pop" onClick={() => setAppDrawer(false)} role="dialog" aria-label={t('apps')}>
      <div onClick={e => e.stopPropagation()}><AppDrawer onPick={() => setAppDrawer(false)} /></div>
    </div>
  );
}
