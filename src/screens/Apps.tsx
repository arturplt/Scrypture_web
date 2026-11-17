import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Icon } from '../ui/misc';
import type { Key } from '../i18n';

/** Little tools that live beside the game. */
const APPS: { path: string; icon: string; name: Key; hint: Key }[] = [
  { path: '/apps/pixelite', icon: 'pencil_yellow', name: 'pixelite', hint: 'pixeliteHint' },
  { path: '/apps/sanctuary', icon: 'home', name: 'sanctuary', hint: 'sanctuaryHint' },
  { path: '/apps/exercise', icon: 'body_active', name: 'exercise', hint: 'exerciseHint' },
  { path: '/apps/mindmap', icon: 'mind_active', name: 'mindMap', hint: 'mindMapHint' },
  { path: '/apps/notes', icon: 'soul_active', name: 'notes', hint: 'notesHint' },
];

export function Apps() {
  const { t } = useI18n();
  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('apps')}</h1>
      {APPS.map(a => (
        <PixelFrame key={a.path} theme="gold_thick" scale={1} className="card">
          <div className="row"><Icon name={a.icon} size={32} alt="" /><h2 className="subtitle">{t(a.name)}</h2></div>
          <div className="muted small">{t(a.hint)}</div>
          <PixelButton scale={1} onClick={() => navigate(a.path)}>{t('openApp')}</PixelButton>
        </PixelFrame>
      ))}
    </div>
  );
}
