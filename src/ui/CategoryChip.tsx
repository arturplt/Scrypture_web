import { PixelFrame } from './PixelFrame';
import { LIGHT_FRAMES, frameOr } from './themes';
import { categoryFrameId, type CustomCategory } from '../domain';

/**
 * A custom category's name over its own frame. The frame is a backdrop drawn at full size (never scaled below 1x, so the chip is at
 * least two corners tall) and the text sits on top of it with little padding. The frame belongs to the chip only; cards stay as the theme manager sets them.
 */
export function CategoryChip({ category }: { category: Pick<CustomCategory, 'name' | 'frame'> }) {
  return (
    <span className={`cat-chip ${LIGHT_FRAMES.has(category.frame) ? 'light' : ''}`}>
      <PixelFrame theme={frameOr(categoryFrameId(category.frame, 16), 'app')} scale={1} className="cat-chip-bg" aria-hidden />
      <span className="cat-chip-text">{category.name}</span>
    </span>
  );
}
