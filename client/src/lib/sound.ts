// Sons synthétisés (Web Audio), aucun fichier à charger : feutre, éponge, paupières, carillons.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

/** Une note douce, pour les moments heureux. */
function bell(freq: number, delay = 0, gain = 0.07): void {
  tone(freq, 0.9, { gain, delay });
  tone(freq * 3, 0.25, { gain: gain * 0.2, delay });
}

const C4 = 261.63;
const major = (n: number) => C4 * 2 ** ([0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19][n] / 12);

export const sfx = {
  /** Le feutre gratte le tableau. */
  marker: () => {
    noise(0.06, { gain: 0.16, freq: 3400, q: 1.4 });
    noise(0.08, { gain: 0.14, freq: 4200, q: 1.4, delay: 0.08 });
    noise(0.05, { gain: 0.12, freq: 3000, q: 1.4, delay: 0.19 });
  },
  /** L'éponge efface un indice. */
  erase: () => {
    noise(0.14, { gain: 0.18, freq: 1100, q: 0.7, fade: 0.9 });
    noise(0.16, { gain: 0.14, freq: 800, q: 0.7, fade: 0.9, delay: 0.13 });
  },
  /** Une nouvelle carte, et c'est toi qui devines. */
  turn: () => {
    bell(major(4), 0, 0.06);
    bell(major(7), 0.12, 0.06);
  },
  /** Les paupières s'ouvrent. */
  eye: () => {
    tone(220, 0.5, { type: 'triangle', gain: 0.05, slide: 3.2, attack: 0.1 });
    noise(0.4, { gain: 0.06, freq: 1500, q: 0.6, fade: 1 });
  },
  found: () => [0, 2, 4, 7].forEach((n, i) => bell(major(n + 2), i * 0.09, 0.07)),
  missed: () => {
    tone(196, 0.5, { type: 'triangle', gain: 0.08, slide: 0.7 });
    tone(147, 0.7, { type: 'triangle', gain: 0.06, slide: 0.7, delay: 0.16 });
  },
  passed: () => tone(330, 0.3, { type: 'triangle', gain: 0.05, slide: 0.75 }),
  finale: (good: boolean) => {
    const notes = good ? [0, 2, 4, 7, 9, 11] : [4, 2, 0];
    notes.forEach((n, i) => bell(major(n), i * 0.13, 0.065));
  },
  tap: () => tone(880, 0.05, { gain: 0.025, slide: 1.3 }),
};
