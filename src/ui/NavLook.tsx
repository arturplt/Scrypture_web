import { Icon } from './misc';
import { NAV_DEFS } from './navItems';
import { usePlateAttrs } from './navPlates';
import { PixelFrame } from './PixelFrame';
import { frameOr } from './themes';
import { useAppState } from '../data/hooks';

/**
 * Non-interactive sample of a navigation-bar style (Settings): the second icon is the active tab. It is drawn in the chosen
 * navigation frame (at the same border size as the real bar), so the previews show what the real bar would look like with that frame.
 */
export function NavLook({ active, plate = 'wood', plateScale = 2, items = ['home', 'tasks', 'habits'] }: { active: string; plate?: string; plateScale?: number; items?: string[] }) {
  const navFrame = useAppState(s => s.settings.nav.frame);
  const defs = NAV_DEFS.filter(d => items.includes(d.id)).slice(0, 4);
  const pa = usePlateAttrs(plate, plateScale);
  return (
    <PixelFrame as="span" theme={frameOr(navFrame, 'wood_steel')} scale={1} className="nav-frame nav-look" data-active={active} data-plate-dark={pa['data-plate-dark']} aria-hidden
      style={pa.style}>
      {defs.map((d, i) => <span key={d.id} className={`nav-btn ${i === 1 ? 'active' : ''}`}><Icon name={d.icon} size={d.size} /></span>)}
    </PixelFrame>
  );
}
