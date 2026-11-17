import { actions } from '../data/hooks';
import { Modal } from './misc';
import { PixelButton } from './PixelButton';
import { useT } from '../i18n/useT';
import { navigate } from '../router';

export function FirstTaskTutorial() {
  const t = useT();
  const close = () => actions.setUser({ tutorialSeen: true });
  return (
    <Modal open onClose={close} title={t('createFirstTask')} theme="gold_thick">
      <p className="story">{t('tutorialBody')}</p>
      <div className="row wrap">
        <PixelButton onClick={() => { close(); navigate('/start'); }}>{t('startHere')}</PixelButton>
        <PixelButton variant="red" onClick={close}>{t('gotIt')}</PixelButton>
      </div>
    </Modal>
  );
}
