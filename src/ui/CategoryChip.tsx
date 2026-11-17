import { PixelFrame } from './PixelFrame';
import { LIGHT_FRAMES, frameOr } from './themes';
import { categoryFrameId, type CustomCategory } from '../domain';

/** A custom category's name in its own frame. The frame belongs to the chip only; the cards stay as the theme manager sets them. */
export function CategoryChip({ category }: { category: Pick<CustomCategory, 'name' | 'frame'> }) {
  return (
    <PixelFrame as="span" theme={frameOr(categoryFrameId(category.frame, 8), 'app')} scale={1} className={`cat-chip ${LIGHT_FRAMES.has(category.frame) ? 'light' : ''}`}>{category.name}</PixelFrame>
  );
}
