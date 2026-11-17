/**
 * The sound engine: everything is synthesized with Web Audio (no sample files), driven by the numbers from `soundParams`.
 * - wind: two noise channels, one per ear, each low-passed by speed and wobbled by gusts;
 * - stall whistle: a thin tone that climbs towards the stall and warbles once stalled;
 * - rain: a high, hissing noise bed;
 * - lift shimmer, paper flutter, birds by day / crickets by night near the ground, a charge tone while aiming;
 * - one-shots (`play`): touchdown, splash, boost, boost ready, hoop chime, throw, UI blip.
 * The AudioContext is only created on a user gesture (`unlock`), and `dispose` closes it again.
 */
import { SILENT, type SoundParams } from '../domain/soundmap';

export type SoundEvent = 'land' | 'crash' | 'splash' | 'boost' | 'ready' | 'hoop' | 'throw' | 'blip' | 'thunder';

export interface AudioEngine {
  /** Create / resume the AudioContext. Call from a user gesture (key, click, touch). */
  unlock(): void;
  /** A one-shot sound. `n` is a streak / strength 0..1 where it matters (hoop streak, how hard the landing was). */
  play(ev: SoundEvent, n?: number): void;
  /** Follow the sound numbers; volume 0..1 (0 = muted). Safe to call every frame, before `unlock` it does nothing. */
  update(p: SoundParams, volume: number): void;
  dispose(): void;
}

const SMOOTH = 0.08;   // seconds: how fast the parameters follow (no zipper noise)

function noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (pink) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; } else d[i] = w * 0.6;
  }
  // crossfade the end into the start so the loop has no click
  const n = Math.min(2048, d.length >> 2);
  for (let i = 0; i < n; i++) { const k = i / n; d[d.length - n + i] = d[d.length - n + i] * (1 - k) + d[i] * k; }
  return buf;
}

export function createAudioEngine(): AudioEngine | null {
  const Ctor: typeof AudioContext | undefined = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!Ctor) return null;
  let ctx: AudioContext | null = null;
  let nodes: ReturnType<typeof build> | null = null;

  function build(c: AudioContext) {
    const master = c.createGain(); master.gain.value = 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    const muffle = c.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 16000; muffle.Q.value = 0.5;   // high up the whole mix dulls
    master.connect(muffle); muffle.connect(comp); comp.connect(c.destination);
    const pink = noiseBuffer(c, 3, true), white = noiseBuffer(c, 2, false);
    const start = (b: AudioBuffer, offset: number, rate = 1) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(0, offset); return s; };

    // wind: one chain per ear, hard-panned, from slightly different noise (offset and rate) so the ears are not the same hiss
    const ear = (side: -1 | 1, offset: number, rate: number, lfoHz: number) => {
      const src = start(pink, offset, rate), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.value = 300;
      const gain = c.createGain(); gain.gain.value = 0;
      const pan = c.createStereoPanner(); pan.pan.value = side;
      const lfo = c.createOscillator(); lfo.frequency.value = lfoHz; const depth = c.createGain(); depth.gain.value = 0; lfo.connect(depth); depth.connect(gain.gain); lfo.start();
      src.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(master);
      return { src, lp, gain, depth, lfo, pan };
    };
    const L = ear(-1, 0, 1, 0.37), R = ear(1, 1.3, 0.93, 0.53);

    // stall whistle: a sine and a quiet octave above it, with a vibrato that gets deep when stalled
    const wGain = c.createGain(); wGain.gain.value = 0;
    const wBand = c.createBiquadFilter(); wBand.type = 'bandpass'; wBand.Q.value = 3; wBand.frequency.value = 1500;
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sine'; o2.type = 'triangle';
    const o2g = c.createGain(); o2g.gain.value = 0.25;
    const vib = c.createOscillator(); vib.frequency.value = 7; const vibDepth = c.createGain(); vibDepth.gain.value = 0;
    vib.connect(vibDepth); vibDepth.connect(o1.detune); vibDepth.connect(o2.detune);
    o1.connect(wBand); o2.connect(o2g); o2g.connect(wBand); wBand.connect(wGain); wGain.connect(master);
    o1.frequency.value = o2.frequency.value = 1200; o2.frequency.value = 2400;
    o1.start(); o2.start(); vib.start();

    // rain: hiss, mid-high
    const rSrc = start(white, 0.4), rHp = c.createBiquadFilter(); rHp.type = 'highpass'; rHp.frequency.value = 2200;
    const rLp = c.createBiquadFilter(); rLp.type = 'lowpass'; rLp.frequency.value = 9000;
    const rGain = c.createGain(); rGain.gain.value = 0; rSrc.connect(rHp); rHp.connect(rLp); rLp.connect(rGain); rGain.connect(master);

    // lift shimmer: two soft sines (a fifth apart) with a slow tremolo, rising with the lift
    const sGain = c.createGain(); sGain.gain.value = 0;
    const s1 = c.createOscillator(), s2 = c.createOscillator(); s1.frequency.value = 392; s2.frequency.value = 588;
    const tre = c.createOscillator(); tre.frequency.value = 3.2; const treD = c.createGain(); treD.gain.value = 0; tre.connect(treD); treD.connect(sGain.gain);
    s1.connect(sGain); s2.connect(sGain); sGain.connect(master); s1.start(); s2.start(); tre.start();

    // paper flutter: bright noise chopped quickly and unevenly
    const fSrc = start(white, 0.9, 1.1), fBand = c.createBiquadFilter(); fBand.type = 'bandpass'; fBand.frequency.value = 3400; fBand.Q.value = 0.8;
    const fGain = c.createGain(); fGain.gain.value = 0;
    const fLfo = c.createOscillator(); fLfo.type = 'square'; fLfo.frequency.value = 19; const fDepth = c.createGain(); fDepth.gain.value = 0; fLfo.connect(fDepth); fDepth.connect(fGain.gain);
    fSrc.connect(fBand); fBand.connect(fGain); fGain.connect(master); fLfo.start();

    // crickets: a high tone chirping in quick bursts
    const cGain = c.createGain(); cGain.gain.value = 0;
    const cOsc = c.createOscillator(); cOsc.frequency.value = 4300; const cLfo = c.createOscillator(); cLfo.frequency.value = 13; const cDepth = c.createGain(); cDepth.gain.value = 0;
    cLfo.connect(cDepth); cDepth.connect(cGain.gain); cOsc.connect(cGain); cGain.connect(master); cOsc.start(); cLfo.start();

    // the throw charging: a tone that climbs with the power
    const hGain = c.createGain(); hGain.gain.value = 0; const hOsc = c.createOscillator(); hOsc.type = 'triangle'; hOsc.frequency.value = 220; hOsc.connect(hGain); hGain.connect(master); hOsc.start();

    return { master, muffle, sGain, s1, s2, treD, fGain, fDepth, fLfo, cGain, cDepth, hGain, hOsc, L, R, o1, o2, wGain, wBand, vib, vibDepth, rGain };
  }

  let nextChirp = 0, nextCricket = 0, vol = 0;
  /** a swept tone, optionally delayed */
  const tone = (f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, pan = 0) => {
    if (!ctx || !nodes) return; const c = ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain(), pn = c.createStereoPanner();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    pn.pan.value = pan; o.connect(g); g.connect(pn); pn.connect(nodes.master); o.start(t); o.stop(t + dur + 0.05);
  };
  /** a burst of noise through a swept filter */
  const burst = (dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 1, attack = 0.01) => {
    if (!ctx || !nodes) return; const c = ctx, t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuffer(c, Math.max(0.2, dur), false); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(nodes.master); src.start(t); src.stop(t + dur + 0.05);
  };
  const chirp = () => { const pn = Math.random() * 1.6 - 0.8, f = 2400 + Math.random() * 1800, n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(f * (1 + 0.1 * i), f * (1.25 + 0.1 * i), 0.07, 0.05, 'sine', i * 0.1, pn); };
  const cricket = () => { const pn = Math.random() * 1.6 - 0.8, f = 4000 + Math.random() * 600, n = 3 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(f, f, 0.04, 0.012, 'sine', i * 0.07, pn); };
  const set = (p: AudioParam, v: number, tc = SMOOTH) => { if (ctx) p.setTargetAtTime(v, ctx.currentTime, tc); };

  return {
    unlock() {
      try {
        if (!ctx) { ctx = new Ctor(); nodes = build(ctx); }
        if (ctx.state === 'suspended') void ctx.resume();
      } catch { ctx = null; nodes = null; }
    },
    update(p, volume) {
      if (!ctx || !nodes) return;
      const n = nodes, on = volume > 0, q = on ? p : SILENT; vol = volume;
      set(n.master.gain, on ? Math.min(1, volume) * 0.9 : 0, 0.12);
      for (const [e, g] of [[n.L, q.windL], [n.R, q.windR]] as const) {
        set(e.gain.gain, g * 0.55);
        set(e.lp.frequency, q.windHz);
        set(e.depth.gain, q.gust * g * 0.4);
      }
      set(n.wGain.gain, q.whistle * 0.12, q.whistle > 0 ? 0.05 : 0.01);   // cut at once when it stops (landed)
      set(n.o1.frequency, q.whistleHz); set(n.o2.frequency, q.whistleHz * 2); set(n.wBand.frequency, q.whistleHz);
      set(n.vibDepth.gain, 15 + q.warble * 160, 0.1); set(n.vib.frequency, 6 + q.warble * 4, 0.2);
      set(n.rGain.gain, q.rain * 0.22, 0.3);
      set(n.muffle.frequency, 16000 - 12500 * q.muffle, 0.3);
      set(n.sGain.gain, q.lift * 0.05, 0.4); set(n.treD.gain, q.lift * 0.03, 0.4); set(n.s1.frequency, 392 + 90 * q.lift, 0.5); set(n.s2.frequency, 588 + 135 * q.lift, 0.5);
      set(n.fGain.gain, q.flutter * 0.03, 0.1); set(n.fDepth.gain, q.flutter * 0.03, 0.1); set(n.fLfo.frequency, 14 + Math.random() * 14, 0.05);
      set(n.hGain.gain, q.charge > 0 ? 0.05 : 0, 0.05); set(n.hOsc.frequency, 200 + 700 * q.charge, 0.05);
      if (q.crickets > 0.1 && ctx.currentTime > nextCricket) { cricket(); nextCricket = ctx.currentTime + 2 + Math.random() * 5 / q.crickets; }   // now and then, not a steady tone
      if (q.birds > 0.1 && ctx.currentTime > nextChirp) { chirp(); nextChirp = ctx.currentTime + 1.2 + Math.random() * 3.5 / q.birds; }
    },
    play(ev, n = 0.5) {
      if (!ctx || !nodes || vol <= 0) return;
      const k = Math.max(0, Math.min(1, n));
      switch (ev) {
        case 'land': burst(0.3, 'lowpass', 1400, 300, 0.25 + 0.2 * k, 0.7); tone(140, 60, 0.18, 0.2); break;                    // a soft paper thump
        case 'crash': burst(0.6, 'lowpass', 2200, 200, 0.6, 0.7); burst(0.35, 'highpass', 3500, 1500, 0.2); tone(110, 40, 0.35, 0.4); break;   // a hard hit and a crumple
        case 'splash': burst(0.9, 'bandpass', 2400, 500, 0.45, 0.9, 0.03); burst(0.5, 'lowpass', 900, 250, 0.3); break;
        case 'boost': burst(0.7, 'bandpass', 350, 3000, 0.35, 1.2, 0.15); tone(180, 700, 0.5, 0.12, 'sawtooth'); break;
        case 'ready': tone(1320, 1320, 0.07, 0.08, 'sine'); tone(1760, 1760, 0.09, 0.07, 'sine', 0.06); break;
        case 'hoop': { const base = 523 * 2 ** (Math.floor(k * 12) / 12); [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, base * m, 0.22, 0.1, 'triangle', i * 0.06)); break; }   // a rising chime, higher with each hoop in a row
        case 'throw': burst(0.4, 'bandpass', 300, 2200, 0.3, 1.5, 0.1); break;
        case 'thunder': burst(0.18, 'highpass', 3000, 900, 0.1 + 0.3 * k, 0.7, 0.005); burst(1.6 + 1.2 * k, 'lowpass', 260 + 500 * k, 45, 0.25 + 0.5 * k, 0.6, 0.03); tone(70, 32, 1.4, 0.15 + 0.25 * k, 'sine', 0.05); break;   // the crack, then the long roll (n = how near)
        case 'blip': tone(880, 660, 0.05, 0.05, 'square'); break;
      }
    },
    dispose() { const c = ctx; ctx = null; nodes = null; if (c) void c.close().catch(() => {}); },
  };
}
