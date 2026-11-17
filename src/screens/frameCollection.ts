import type { Key } from '../i18n';
import { registerFrame } from '../ui/themes';

/** "Add to collection" saves into the project's files through the dev server, so it only exists while running `vite`. */
export const CAN_ADD_TO_COLLECTION: boolean = import.meta.env.DEV;

/** Name suggestion: the file or frame name, tidied the way the server will tidy it. */
export const suggestName = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'my_frame';

/** A 50x50 PNG (the frame plus 1px spare) from a 48x48 frame, or the picture itself when it already is 50x50. */
export function frameCanvas50(src: HTMLCanvasElement): HTMLCanvasElement | null {
  if (src.width !== src.height || (src.width !== 48 && src.width !== 50)) return null;
  if (src.width === 50) return src;
  const c = document.createElement('canvas');
  c.width = 50; c.height = 50;
  c.getContext('2d')!.drawImage(src, 1, 1);
  return c;
}

/** Send a frame to the dev server: raw/<name>.9.png plus an entry the Theme manager lists. Returns the saved name or the message key to show. */
export async function addToCollection(src: HTMLCanvasElement, name: string): Promise<{ name: string } | { error: Key }> {
  const c = frameCanvas50(src);
  if (!c) return { error: 'feAddSize' };
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
  if (!blob) return { error: 'feAddFail' };
  try {
    const r = await fetch(`/__frames/add?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    if (r.status === 409) return { error: 'feAddExists' };
    if (!r.ok) return { error: 'feAddFail' };
    const j = await r.json() as { name: string; accent: string; light: boolean };
    registerFrame(j.name, j.accent, j.light);
    return { name: j.name };
  } catch { return { error: 'feAddFail' }; }
}
