import { useAppState } from '../data/hooks';
import { useI18n } from '../i18n/useT';
import { back } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';

const TOP = 10;

export function RockLeaderboard() {
  const { t, locale } = useI18n();
  const sessions = useAppState(s => s.rockGame.sessions).slice(0, TOP);
  return (
    <div className="screen">
      <div className="row between"><PixelButton scale={1} variant="red" onClick={() => back('/games')}>{t('back')}</PixelButton></div>
      <h1 className="title">{t('leaderboard')}</h1>
      {sessions.length === 0 ? (
        <PixelFrame theme="app" scale={1} className="card">
          <div>{t('noScoresYet')}</div>
          <div className="muted small">{t('playGameToSetFirstScore')}</div>
        </PixelFrame>
      ) : (
        <ol className="list cards rock-board">
          {sessions.map((s, i) => (
            <li key={s.id}>
              <PixelFrame theme={i === 0 ? 'gold_thick' : 'grey_stone_chiseld'} scale={1} className="rock-row">
                <span className="rock-rank">#{i + 1}</span>
                <span className="rock-pts">{s.score}</span>
                <span className="muted small">{t('level')} {s.level} · {s.targetsHit} {t('targets')} · {t(s.mode === 'PRACTICE' ? 'modePractice' : s.mode === 'TIMETRIAL' ? 'modeTimeTrial' : 'modeArcade')}</span>
                <span className="muted small">{new Date(s.at).toLocaleDateString(locale)}</span>
              </PixelFrame>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
