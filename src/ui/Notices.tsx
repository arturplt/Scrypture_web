import { useEffect, useState } from 'react';
import { SW_UPDATED_EVENT } from '../pwa';
import { useT } from '../i18n/useT';
import { useSaveBlocked } from '../data/hooks';

/** Two small notices that sit above the page: "something went wrong" when code throws inside an event handler or a promise (the page stays usable), and "new version, reload". */
export function Notices() {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [updated, setUpdated] = useState(false);
  const blocked = useSaveBlocked();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const oops = () => { setFailed(true); clearTimeout(timer); timer = setTimeout(() => setFailed(false), 6000); };
    const upd = () => setUpdated(true);
    addEventListener('error', oops); addEventListener('unhandledrejection', oops); addEventListener(SW_UPDATED_EVENT, upd);
    return () => { clearTimeout(timer); removeEventListener('error', oops); removeEventListener('unhandledrejection', oops); removeEventListener(SW_UPDATED_EVENT, upd); };
  }, []);
  return (
    <>
      {failed && <div className="notice notice-bad" role="alert">{t('somethingWrong')}<button type="button" className="seg" onClick={() => setFailed(false)}>{t('closeNotice')}</button></div>}
      {blocked && <div className="notice notice-bad" role="alert">{t('saveNewer')}<button type="button" className="seg on" onClick={() => location.reload()}>{t('reload')}</button></div>}
      {updated && !blocked && <div className="notice" role="status">{t('updateReady')}<button type="button" className="seg on" onClick={() => location.reload()}>{t('reload')}</button></div>}
    </>
  );
}
