import { useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Icon } from '../ui/misc';

/** Games menu: today just the rock-throwing minigame. */
export function Games() {
  const { t } = useI18n();
  const stats = useAppState(s => s.rockGame.stats);
  const stone = useAppState(s => s.inventory.stone ?? 0);
  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('games')}</h1>
      <PixelFrame theme="gold_thick" scale={1} className="card rock-menu">
        <div className="row"><Icon name="target" size={32} alt="" /><h2 className="subtitle">{t('rockThrowing')}</h2></div>
        <div className="muted small">{t('minigame')}</div>
        {stats.gamesPlayed > 0 && <>
          <div>{t('score').toUpperCase()}: {stats.highScore}</div>
          <div className="muted small">{t('rockGameStats', { n: stats.gamesPlayed, level: stats.bestLevel, combo: stats.longestCombo })}</div>
        </>}
        <PixelButton scale={1} onClick={() => navigate('/games/play/arcade')}>{t('arcadeMode')}</PixelButton>
        <div className="muted small">{t('arcadeHint')}</div>
        <PixelButton scale={1} onClick={() => navigate('/games/play/practice')}>{t('practiceMode')}</PixelButton>
        <div className="muted small">{t('practiceHint')}</div>
        <PixelButton scale={1} onClick={() => navigate('/games/play/timetrial')}>{t('timeTrialMode')}</PixelButton>
        <div className="muted small">{t('timeTrialHint')}</div>
        <PixelButton scale={1} onClick={() => navigate('/games/leaderboard')}><Icon name="leaderboard" size={16} alt="" /> {t('leaderboard')}</PixelButton>
        <div className="row"><Icon name="stone" size={32} alt="" /><span className="muted small">{t('rockStonePrice', { n: 5 })} ({stone})</span></div>
      </PixelFrame>
      <PixelFrame theme="gold_thick" scale={1} className="card">
        <div className="row"><Icon name="home" size={32} alt="" /><h2 className="subtitle">{t('world')}</h2></div>
        <div className="muted small">{t('worldHint')}</div>
        <PixelButton scale={1} onClick={() => navigate('/games/paperplane')}>{t('openApp')}</PixelButton>
      </PixelFrame>
    </div>
  );
}
