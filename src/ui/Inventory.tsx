import { ITEM_IDS, ITEM_LABEL, ITEM_SPRITE, tradeFor, willTrade, type Emotion, type ItemId } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { PixelFrame } from './PixelFrame';
import { PixelButton } from './PixelButton';
import { useT } from '../i18n/useT';
import { useUi } from './useUi';
import { backdropFrame, frameOr } from './themes';

/** One inventory slot: the Android slot sprite with the item in it and its count in the corner. Empty slots show the item dimmed. */
export function Slot({ id, n, as: Tag = 'span', glow = Tag === 'button', ...rest }: { id: ItemId; n: number; as?: 'span' | 'button'; /** bob and glow: "tap me now" */ glow?: boolean } & React.HTMLAttributes<HTMLElement>) {
  const { px } = useUi();
  const style = useAppState(s => s.settings.elements.slot);
  const custom = style !== 'classic';   // a chosen frame is drawn as a backdrop (never below 1x) instead of the original slot sprite
  return (
    <Tag className={`slot ${custom ? 'slot-frame' : ''} ${n === 0 ? 'empty' : ''} ${Tag === 'button' ? 'tap' : ''} ${glow ? 'feed' : ''}`} {...rest}>
      {custom && <PixelFrame as="span" theme={backdropFrame(style, 'app')} scale={1} className="slot-bg" aria-hidden />}
      <img className="pixel" src={`/assets/raw/${ITEM_SPRITE[id]}.png`} width={px(32)} height={px(32)} alt={ITEM_LABEL[id]} />
      <b className="slot-n">{n}</b>
    </Tag>
  );
}

export function Inventory({ emotion, now, frame = 'app' }: { emotion: Emotion; now: number; frame?: string }) {
  const t = useT();
  const inv = useAppState(s => s.inventory);
  const hungry = emotion === 'HUNGRY';
  const hay = inv.hay ?? 0, berry = inv.berry ?? 0;
  const deal = tradeFor(now);
  const can = willTrade(emotion);
  const have = (inv[deal.request] ?? 0) >= 1;

  return (
    <PixelFrame theme={frameOr(frame, 'app')} scale={1} className="card">
      <div className="inv">
        {ITEM_IDS.map(id => id === 'hay' && hungry && hay > 0
          ? <Slot key={id} id={id} n={hay} as="button" onClick={() => actions.feedBobr()} aria-label={t('feedAria')} />
          : id === 'berry' && berry > 0   // a berry is a treat: he takes one any time
          ? <Slot key={id} id={id} n={berry} as="button" glow={hungry} onClick={() => actions.feedBerry()} aria-label={t('feedBerryAria')} title={t('feedBerryAria')} />
          : <Slot key={id} id={id} n={inv[id] ?? 0} />)}
      </div>
      {hungry && <div className="small" style={{ color: 'var(--body)' }}>{hay > 0 ? t('hungryTapHay') : berry > 0 ? t('hungryTapBerry') : t('hungryCollectHay')}</div>}
      <div className="trade">
        {can ? (<>
          <PixelButton scale={1} disabled={!have} onClick={() => actions.trade()}>{t('trade')}</PixelButton>
          <Slot id={deal.request} n={1} /><span>→</span><Slot id={deal.offer} n={1} />
        </>) : <span className="small muted">{t('noTradeMood')}</span>}
      </div>
    </PixelFrame>
  );
}
