import { useEffect, useState } from 'react';
import { store } from '../data/hooks';

/** A 16x16 floppy disk. k outline, b body, s metal shutter, w label. */
const DISK = [
  'kkkkkkkkkkkkkkk.',
  'kbbsssssssssbbkk',
  'kbbsssskksssbbbk',
  'kbbsssskksssbbbk',
  'kbbsssssssssbbbk',
  'kbbbbbbbbbbbbbbk',
  'kbbbbbbbbbbbbbbk',
  'kbwwwwwwwwwwwwbk',
  'kbwwwwwwwwwwwwbk',
  'kbwkkkkkkkkkkwbk',
  'kbwwwwwwwwwwwwbk',
  'kbwkkkkkkkkkkwbk',
  'kbwwwwwwwwwwwwbk',
  'kbwwwwwwwwwwwwbk',
  'kbbbbbbbbbbbbbbk',
  'kkkkkkkkkkkkkkkk',
];
const COLOR: Record<string, string> = { k: '#1a1a2e', b: '#3b6fd6', s: '#c8ccd6', w: '#f2ecd8' };
const RECTS = DISK.flatMap((row, y) => [...row].flatMap((c, x) => (COLOR[c] ? [<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={COLOR[c]} />] : [])));

/** Shows for a moment above the navigation bar, at the left, whenever the save changes (it is written to storage on every change). */
export function SaveIcon() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let last = store.getState(), timer: ReturnType<typeof setTimeout> | undefined;
    const off = store.subscribe(() => {
      const s = store.getState();
      if (s === last) return;   // an event came or went, nothing was saved
      last = s;
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), 1200);
    });
    return () => { off(); clearTimeout(timer); };
  }, []);
  if (!shown) return null;
  return (
    <svg className="save-icon" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">{RECTS}</svg>
  );
}
