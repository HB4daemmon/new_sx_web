/**
 * Procedural sound effects (WebAudio, no audio assets). Everything is
 * synthesised on demand, so the game ships no sound files and stays offline-safe.
 * The context is created lazily on the first user gesture (browser autoplay rules).
 */
export type SfxName =
  | 'hit' | 'heavy' | 'crit' | 'rage' | 'ko' | 'heal' | 'shield'
  | 'click' | 'reward' | 'breakthrough' | 'victory' | 'defeat';

const STORAGE_KEY = 'suishi-shanhai-sfx-v1';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readEnabled();
let lastPlayed = new Map<SfxName, number>();

function readEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function sfxEnabled(): boolean {
  return enabled;
}

export function setSfxEnabled(value: boolean): void {
  enabled = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Storage may be unavailable (private mode); the toggle still works this session.
  }
  if (master) master.gain.value = value ? 0.5 : 0;
}

/** Call from a user gesture; creates/resumes the audio context. */
export function unlockSfx(): void {
  const Ctor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!context) {
      context = new Ctor() as AudioContext;
      master = context.createGain();
      master.gain.value = enabled ? 0.5 : 0;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function envelope(ctx: AudioContext, node: GainNode, at: number, peak: number, attack: number, decay: number): void {
  node.gain.setValueAtTime(0.0001, at);
  node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

function tone(ctx: AudioContext, at: number, type: OscillatorType, from: number, to: number, peak: number, attack: number, decay: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + attack + decay);
  envelope(ctx, gain, at, peak, attack, decay);
  osc.connect(gain).connect(master!);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

function burst(ctx: AudioContext, at: number, filter: BiquadFilterType, freq: number, peak: number, decay: number, q = 1): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, decay + 0.05);
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = freq;
  biquad.Q.value = q;
  const gain = ctx.createGain();
  envelope(ctx, gain, at, peak, 0.004, decay);
  src.connect(biquad).connect(gain).connect(master!);
  src.start(at);
  src.stop(at + decay + 0.05);
}

const MIN_GAP_MS: Partial<Record<SfxName, number>> = { hit: 45, heavy: 60, click: 30, heal: 90, shield: 90 };

export function playSfx(name: SfxName, intensity = 1): void {
  if (!enabled || !context || !master || context.state !== 'running') return;
  const nowMs = performance.now();
  const gap = MIN_GAP_MS[name] ?? 0;
  if (gap && nowMs - (lastPlayed.get(name) ?? -Infinity) < gap) return;
  lastPlayed.set(name, nowMs);
  const ctx = context;
  const t = ctx.currentTime + 0.005;
  const k = Math.max(0.3, Math.min(1.6, intensity));
  try {
    switch (name) {
      case 'hit':
        burst(ctx, t, 'bandpass', 1800, 0.35 * k, 0.09, 0.8);
        tone(ctx, t, 'sine', 160, 60, 0.45 * k, 0.004, 0.12);
        break;
      case 'heavy':
        burst(ctx, t, 'lowpass', 900, 0.5 * k, 0.16);
        tone(ctx, t, 'sine', 110, 38, 0.7 * k, 0.004, 0.22);
        break;
      case 'crit':
        burst(ctx, t, 'highpass', 2500, 0.4, 0.12);
        tone(ctx, t, 'sine', 120, 40, 0.8, 0.003, 0.25);
        tone(ctx, t + 0.01, 'triangle', 1760, 1320, 0.18, 0.003, 0.35);
        tone(ctx, t + 0.01, 'triangle', 2637, 2200, 0.08, 0.003, 0.3);
        break;
      case 'rage':
        burst(ctx, t, 'bandpass', 600, 0.25, 0.45, 0.5);
        tone(ctx, t + 0.05, 'sawtooth', 70, 140, 0.12, 0.25, 0.25);
        tone(ctx, t + 0.42, 'sine', 98, 92, 0.5, 0.005, 1.2);
        tone(ctx, t + 0.42, 'sine', 196, 190, 0.18, 0.005, 0.9);
        break;
      case 'ko':
        tone(ctx, t, 'sine', 82, 40, 0.9, 0.005, 1.4);
        tone(ctx, t, 'sine', 164, 120, 0.25, 0.005, 1.1);
        burst(ctx, t, 'lowpass', 500, 0.6, 0.5);
        break;
      case 'heal':
        tone(ctx, t, 'sine', 880, 1175, 0.12, 0.01, 0.35);
        tone(ctx, t + 0.07, 'sine', 1319, 1568, 0.08, 0.01, 0.35);
        break;
      case 'shield':
        tone(ctx, t, 'triangle', 520, 780, 0.1, 0.01, 0.2);
        break;
      case 'click':
        tone(ctx, t, 'triangle', 900, 600, 0.06, 0.002, 0.05);
        break;
      case 'reward':
        [784, 988, 1175].forEach((f, i) => tone(ctx, t + i * 0.07, 'triangle', f, f, 0.12, 0.005, 0.4));
        break;
      case 'breakthrough':
        [392, 523, 659, 784, 1047].forEach((f, i) => tone(ctx, t + i * 0.09, 'triangle', f, f * 1.01, 0.16, 0.01, 0.6));
        burst(ctx, t + 0.5, 'lowpass', 400, 0.7, 1.2);
        tone(ctx, t + 0.5, 'sine', 60, 35, 0.8, 0.01, 1.4);
        break;
      case 'victory':
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ctx, t + i * 0.12, 'triangle', f, f, 0.18, 0.01, 0.9));
        tone(ctx, t, 'sine', 98, 92, 0.5, 0.005, 2);
        break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, i) => tone(ctx, t + i * 0.22, 'sine', f, f * 0.98, 0.15, 0.02, 0.8));
        tone(ctx, t, 'sine', 65, 40, 0.6, 0.01, 2);
        break;
    }
  } catch {
    // Audio is decoration; never let it break the game.
  }
}
