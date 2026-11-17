import { useEffect } from 'react';
import { actions, useEvents } from '../data/hooks';
import { RARITY_COLORS } from './colors';
import { Icon, Modal } from './misc';
import { PixelButton } from './PixelButton';
import { useT } from '../i18n/useT';
import { RARITY_KEY, achievementText } from '../i18n';

/** Shows the first queued event: a toast for XP, dialogs for level-ups and achievements. */
export function EventHost() {
  const event = useEvents()[0];
  const t = useT();

  useEffect(() => {
    if (event?.type !== 'taskComplete') return;
    const timer = setTimeout(actions.dismissEvent, 1400);
    return () => clearTimeout(timer);
  }, [event]);

  if (!event) return null;
  if (event.type === 'taskComplete') return <div className="xp-toast" role="status">+{event.xp} XP</div>;

  if (event.type === 'levelUp') return (
    <Modal open onClose={actions.dismissEvent} title={t('levelUp')} theme="gold_thick">
      <div className="celebrate"><div className="big">{t('level').toUpperCase()} {event.level}</div><p className="muted">{t('keepBuildingYourDam')}</p></div>
      <PixelButton onClick={actions.dismissEvent}>{t('continueButton')}</PixelButton>
    </Modal>
  );

  const a = event.achievement;
  const x = achievementText(t, a);
  const medal = a.rarity === 'LEGENDARY' || a.rarity === 'EPIC' ? 'gold' : a.rarity === 'RARE' ? 'silver' : 'bronze';
  return (
    <Modal open onClose={actions.dismissEvent} title={t('achievementUnlocked')} theme="gold_thick">
      <div className="celebrate">
        <Icon name={`achievement_${medal}`} size={64} />
        <div>{x.title}</div>
        <div className="small" style={{ color: RARITY_COLORS[a.rarity] }}>{t(RARITY_KEY[a.rarity]).toUpperCase()}</div>
        <p className="muted small">{x.description}</p>
      </div>
      <PixelButton onClick={actions.dismissEvent}>{t('awesome')}</PixelButton>
    </Modal>
  );
}
