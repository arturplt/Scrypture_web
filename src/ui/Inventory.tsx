import { ITEM_IDS, ITEM_LABEL, ITEM_SPRITE, tradeFor, willTrade, type Emotion, type ItemId } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { PixelFrame } from './PixelFrame';
import { PixelButton } from './PixelButton';
import { useT } from '../i18n/useT';
import { useUi } from './useUi';
import { backdropFrame, frameOr } from './themes';
import { useLongPress } from './misc';
import { useState } from 'react';

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

/** The whole inventory: all item slots (tap hay or a berry to feed him) and the hunger hint. `onStoneHold`: press and hold the stone to start a rock game; `paidAt`: when stone was last paid for one (a "-n" floats off the slot). */
export function Inventory({ emotion, frame = 'app', onStoneHold, stoneCost = 0, paidAt = 0 }: { emotion: Emotion; frame?: string; onStoneHold?: () => void; stoneCost?: number; paidAt?: number }) {
  const t = useT();
  const inv = useAppState(s => s.inventory);
  const [gone, setGone] = useState(0);   // the "-n" float that has finished (so it is not drawn again)
  const stoneHold = useLongPress(onStoneHold);
  const paid = paidAt > gone ? paidAt : 0;
  const hungry = emotion === 'HUNGRY';
  const hay = inv.hay ?? 0, berry = inv.berry ?? 0;
  return (
    <PixelFrame theme={frameOr(frame, 'app')} scale={1} className="card">
      <div className="inv">
        {ITEM_IDS.map(id => id === 'hay' && hungry && hay > 0
          ? <Slot key={id} id={id} n={hay} as="button" onClick={() => actions.feedBobr()} aria-label={t('feedAria')} />
          : id === 'berry' && berry > 0   // a berry is a treat: he takes one any time
          ? <Slot key={id} id={id} n={berry} as="button" glow={hungry} onClick={() => actions.feedBerry()} aria-label={t('feedBerryAria')} title={t('feedBerryAria')} />
          : id === 'stone' && onStoneHold
          ? <span key={id} className="slot-hold" {...stoneHold} title={t('holdStoneAria')} aria-label={t('holdStoneAria')}><Slot id={id} n={inv[id] ?? 0} />{paid > 0 && <b key={paid} className="slot-cost" aria-hidden onAnimationEnd={() => setGone(paidAt)}>-{stoneCost}</b>}</span>
          : <Slot key={id} id={id} n={inv[id] ?? 0} />)}
      </div>
      {hungry && <div className="small" style={{ color: 'var(--body)' }}>{hay > 0 ? t('hungryTapHay') : berry > 0 ? t('hungryTapBerry') : t('hungryCollectHay')}</div>}
    </PixelFrame>
  );
}

type Deal = ReturnType<typeof tradeFor>;

/** Today's trade slot beside Bóbr: what he asks for on his left, what he gives on his right. Nothing while he is not in the mood. */
export function TradeSlot({ emotion, deal, side }: { emotion: Emotion; deal: Deal; side: 'left' | 'right' }) {
  if (!willTrade(emotion)) return <div className="pen-slots" />;
  return <div className={`pen-slots pen-slots-${side}`}><Slot id={side === 'left' ? deal.request : deal.offer} n={1} /></div>;
}

/** The trade button, laid over the pen's bottom border (shown while the trade is open: tap Bóbr to open or close it). */
export function TradeBar({ deal }: { deal: Deal }) {
  const t = useT();
  const inv = useAppState(s => s.inventory);
  const have = (inv[deal.request] ?? 0) >= 1;
  return <div className="trade-bar"><span className="trade-arrow" aria-hidden>→</span><PixelButton scale={1} disabled={!have} onClick={() => actions.trade()}>{t('trade')}</PixelButton></div>;
}
