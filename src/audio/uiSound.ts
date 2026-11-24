/**
 * App-wide sound: a soft click on every button, a blip when XP is paid, a chime for a level-up or an achievement.
 * It uses one lazily created engine (made on the first tap, as browsers require) and follows the Sound setting in
 * Settings (0 = off). The world map has its own engine and plays its own clicks, so this one stays quiet there.
 */
import { createAudioEngine, type AudioEngine, type SoundEvent } from './engine';
import { SILENT } from '../domain/soundmap';
import { store } from '../data/hooks';
import { buzz } from './haptics';

const inWorld = () => location.hash.startsWith('#/games/paperplane/play/');

let current: AudioEngine | null = null;
/** A one-shot from anywhere (the rock game): silent when the volume is 0, in the world map, or before the first tap. */
export function uiPlay(ev: SoundEvent, n?: number) {
  if (current && store.getState().settings.volume > 0 && !inWorld()) current.play(ev, n);
}

export function startUiSound(): () => void {
  let eng: AudioEngine | null = null;
  let seen = store.getEvents().length;
  const volume = () => store.getState().settings.volume;
  const ensure = () => { if (!eng) { eng = createAudioEngine(); current = eng; } eng?.unlock(); eng?.update(SILENT, volume()); return eng; };
  const quiet = () => volume() <= 0 || inWorld();

  const down = () => { if (volume() > 0) ensure(); };
  const click = (e: Event) => {
    if (quiet() || !(e.target instanceof Element) || !e.target.closest('button, [role="button"], [role="checkbox"]')) return;
    ensure()?.play('blip');
  };
  let lastVol = volume();
  const unsub = store.subscribe(() => {
    const v = volume();
    if (v !== lastVol) { lastVol = v; if (eng) eng.update(SILENT, v); }
    const evs = store.getEvents();
    if (evs.length < seen) seen = evs.length;           // events were dismissed
    for (let i = seen; i < evs.length; i++) {
      const e = evs[i];
      // vibration has its own setting, so it does not wait for the sound to be on
      if (e.type === 'taskComplete') buzz('tap'); else if (e.type === 'levelUp' || e.type === 'achievement') buzz('level');
      if (quiet() || !eng) continue;
      if (e.type === 'taskComplete') eng.play('ready');
      else if (e.type === 'levelUp') eng.play('hoop', 0.6);
      else if (e.type === 'achievement') eng.play('hoop', 0.9);
    }
    seen = evs.length;
  });
  addEventListener('pointerdown', down); addEventListener('keydown', down); addEventListener('click', click);
  return () => { unsub(); removeEventListener('pointerdown', down); removeEventListener('keydown', down); removeEventListener('click', click); eng?.dispose(); eng = null; current = null; };
}
