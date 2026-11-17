import { achievementProgress, type Achievement, type AchievementCategory } from '../domain';
import { useAppState } from '../data/hooks';
import { back } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { Chip, Icon } from '../ui/misc';
import { RARITY_COLORS } from '../ui/colors';
import { useI18n } from '../i18n/useT';
import { RARITY_KEY, achievementText, type Key } from '../i18n';

const GROUPS: [AchievementCategory, Key][] = [['TASK', 'chatTasks'], ['STREAK', 'groupStreaks'], ['STAT', 'groupGrowth'], ['SPECIAL', 'minigame']];

function Medal({ a }: { a: Achievement }) {
  const { t } = useI18n();
  if (!a.unlocked) return <Icon name="lock" size={32} alt={t('chatLocked')} />;
  const medal = a.rarity === 'LEGENDARY' || a.rarity === 'EPIC' ? 'gold' : a.rarity === 'RARE' ? 'silver' : 'bronze';
  return <Icon name={`achievement_${medal}`} size={32} alt={t('unlocked')} />;
}

function Card({ a, progress }: { a: Achievement; progress: { current: number; target: number } | null }) {
  const { t, locale } = useI18n();
  const x = achievementText(t, a);
  return (
    <PixelFrame theme={a.unlocked ? 'gold_thick' : 'grey_stone_chiseld'} scale={1} className={`ach ${a.unlocked ? '' : 'locked'}`}>
      <div className="ach-head">
        <Medal a={a} />
        <div className="ach-text">
          <div>{x.title}</div>
          <div className="muted small">{x.description}</div>
        </div>
      </div>
      <div className="row wrap chips">
        <Chip color="var(--bg-3)" border={RARITY_COLORS[a.rarity]}>{t(RARITY_KEY[a.rarity]).toUpperCase()}</Chip>
        {a.unlocked && a.unlockedAt && <span className="muted small">{new Date(a.unlockedAt).toLocaleDateString(locale)}</span>}
      </div>
      {!a.unlocked && progress && (
        <div className="meter"><span>{progress.current}/{progress.target}</span><PixelProgressBar value={progress.current} max={progress.target} scale={1} label={x.title} /></div>
      )}
    </PixelFrame>
  );
}

export function Achievements() {
  const { t } = useI18n();
  const achievements = useAppState(s => s.achievements);
  const rock = useAppState(s => s.rockGame.stats);
  const stats = useAppState(s => s.stats);
  const habits = useAppState(s => s.habits);
  const ctx = { stats, maxHabitStreak: habits.reduce((m, h) => Math.max(m, h.streak, h.bestStreak), 0), rock };
  const unlocked = achievements.filter(a => a.unlocked).length;

  return (
    <div className="screen">
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => back('/')}>{t('back')}</PixelButton>
      </div>
      <h1 className="title">{t('achievements')}</h1>
      <div className="muted small">{t('unlockedCount', { done: unlocked, total: achievements.length })}</div>
      <PixelProgressBar value={unlocked} max={achievements.length} look="gold" scale={1} label={t('achievementsUnlockedAria')} />

      {GROUPS.map(([cat, label]) => {
        const items = achievements.filter(a => a.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} className="list cards">
            <h2 className="subtitle">{t(label)}</h2>
            {items.map(a => <Card key={a.id} a={a} progress={achievementProgress(a.condition, ctx)} />)}
          </section>
        );
      })}
    </div>
  );
}
