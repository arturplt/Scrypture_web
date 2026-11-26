/**
 * The front camera as a one-number sensor for the Pushups screen: how bright the picture is, ~15 times a second.
 * Each frame is shrunk to 16 x 16 pixels in a canvas and averaged; nothing is shown, kept or sent anywhere.
 */
export interface PushupCamera { stop(): void }

export const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Why the camera did not start, in words the screen can show. 'insecure' is the usual one on a phone: browsers hide the camera from plain http pages that are not localhost. */
export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'none' | 'busy' | 'other';
export class CameraError extends Error { constructor(readonly problem: CameraProblem) { super(problem); } }
export function cameraProblem(e: unknown): CameraProblem {
  if (e instanceof CameraError) return e.problem;
  const name = e instanceof DOMException || (e && typeof e === 'object' && 'name' in e) ? String((e as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'other';
}

/** Brightness (0..255) of 16 x 16 RGBA pixels, weighted like the eye sees it. */
export function meanLuma(rgba: ArrayLike<number>): number {
  let sum = 0;
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n; i++) sum += 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return n ? sum / n : 0;
}

/** Ask for the camera (call from a tap) and report the brightness. Rejects when there is none or it is refused. */
export async function startCamera(onLuma: (luma: number) => void, hz = 15): Promise<PushupCamera> {
  if (!cameraSupported()) throw new CameraError(typeof isSecureContext === 'boolean' && !isSecureContext ? 'insecure' : 'unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 160 }, height: { ideal: 120 } }, audio: false });
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  video.srcObject = stream;
  document.body.appendChild(video);   // some browsers do not run a video that is not in the page
  const stopStream = () => { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; video.remove(); };
  try { await video.play(); } catch (e) { stopStream(); throw e; }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { stopStream(); throw new Error('no canvas'); }
  const timer = setInterval(() => {
    if (video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, 16, 16);
    onLuma(meanLuma(ctx.getImageData(0, 0, 16, 16).data));
  }, Math.round(1000 / hz));
  return { stop() { clearInterval(timer); stopStream(); } };
}

/** Keep the screen awake while exercising (a phone on the floor would dim and lock). Resolves to a release function; does nothing where unsupported. */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    return () => { lock?.release().catch(() => {}); };
  } catch { return () => {}; }
}
