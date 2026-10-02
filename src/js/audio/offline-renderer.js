// Offline rendering for audio export: OfflineAudioContext + caller-supplied schedule.
//
// render(build, { duration, sampleRate, channels }) creates the OfflineAudioContext (this
// module's purpose; it never touches the live AudioContext), creates a master GainNode connected
// to the destination, calls build(ctx, master, { duration, sampleRate }) — which schedules
// everything relative to t = 0 and may return a promise — and resolves with the rendered
// AudioBuffer. The sequencer passes
//   (ctx, dest) => compileSequence(model, ctx, dest, 0)
// so this module has no dependency on it. renderTone / renderSweep build from plain config
// objects with the same envelope, additive and filter modules as live playback, so an export is
// the real configuration, rendered.
//
// Frequencies at or above 0.95 × Nyquist of the render rate are rejected with a RangeError
// (never silently clamped: the export must be what was requested or nothing).

import { applyAdsr, releaseAt, normalizeAdsr } from './envelope.js';
import { buildPeriodicWave } from './additive.js';
import { createFilterStage } from './filters.js';
import { encodeWav } from './wav.js';

export const SAFE_NYQUIST_FACTOR = 0.95;
export const DEFAULT_RENDER = Object.freeze({ sampleRate: 48000, channels: 2, maxDuration: 120 });
const MIN_RATE = 8000;
const MAX_RATE = 192000;

function offlineCtor(explicit) {
  if (explicit) return explicit;
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  return g.OfflineAudioContext || g.webkitOfflineAudioContext || null;
}

/** Validate and complete render options (pure). Throws RangeError with a readable message. */
export function normalizeRenderOptions(options = {}) {
  const sampleRate = Math.round(Number(options.sampleRate) || DEFAULT_RENDER.sampleRate);
  const channels = Math.round(Number(options.channels) || DEFAULT_RENDER.channels);
  const maxDuration = Number(options.maxDuration) || DEFAULT_RENDER.maxDuration;
  const duration = Number(options.duration);
  if (!(sampleRate >= MIN_RATE && sampleRate <= MAX_RATE)) {
    throw new RangeError(`Sample rate ${sampleRate} Hz is outside ${MIN_RATE}–${MAX_RATE} Hz`);
  }
  if (!(channels >= 1 && channels <= 2)) throw new RangeError('Channels must be 1 or 2');
  if (!(duration > 0)) throw new RangeError('Duration must be positive');
  if (duration > maxDuration) throw new RangeError(`Duration is limited to ${maxDuration} s`);
  return { sampleRate, channels, duration, length: Math.ceil(duration * sampleRate) };
}

/** Throw unless f is a positive frequency below 0.95 × Nyquist at sampleRate. */
export function assertRenderableFrequency(f, sampleRate, label = 'Frequency') {
  const safe = (sampleRate / 2) * SAFE_NYQUIST_FACTOR;
  if (!(f > 0)) throw new RangeError(`${label} must be positive`);
  if (f >= safe) {
    throw new RangeError(
      `${label} ${f} Hz is at or above the safe maximum ${safe} Hz for a ${sampleRate} Hz render`,
    );
  }
  return f;
}

/**
 * render(build, options) → Promise<AudioBuffer>
 * options: { duration (s), sampleRate (48000), channels (2), masterGain (1), maxDuration (120),
 *            OfflineAudioContext (constructor override) }
 */
export async function render(build, options = {}) {
  const o = normalizeRenderOptions(options);
  const Ctor = offlineCtor(options.OfflineAudioContext);
  if (!Ctor) throw new Error('OfflineAudioContext is not available in this browser');
  let ctx;
  try {
    ctx = new Ctor({ numberOfChannels: o.channels, length: o.length, sampleRate: o.sampleRate });
  } catch (e) {
    ctx = new Ctor(o.channels, o.length, o.sampleRate); // older constructor form
  }
  const master = ctx.createGain();
  master.gain.value = options.masterGain != null ? options.masterGain : 1;
  master.connect(ctx.destination);
  await build(ctx, master, { duration: o.duration, sampleRate: o.sampleRate });
  return ctx.startRendering();
}

/** Alias of render for a generic schedule callback (e.g. the sequencer compiler). */
export const renderSchedule = render;

/** render then encodeWav: → Promise<{ buffer, wav: ArrayBuffer, stats }> */
export async function renderToWav(build, options = {}, wavOptions = {}) {
  const buffer = await render(build, options);
  return { buffer, wav: encodeWav(buffer, wavOptions), stats: bufferStats(buffer) };
}

/** Peak, RMS and clipping of a rendered buffer (pure; works on AudioBuffer-like objects). */
export function bufferStats(buffer) {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let clipped = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a > 1) clipped++;
      sum += d[i] * d[i];
    }
    n += d.length;
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  return {
    peak,
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rms,
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
    clippedSamples: clipped,
  };
}

/**
 * Fit an ADSR into a note of total length `duration` (release included): a + d + r may use at
 * most 90 % of it, scaled proportionally when longer. Returns { adsr, releaseStart }.
 */
export function fitEnvelope(adsr, duration) {
  const e = normalizeAdsr(adsr);
  const budget = duration * 0.9;
  const used = e.a + e.d + e.r;
  const k = used > budget ? budget / used : 1;
  const fitted = { a: e.a * k, d: e.d * k, s: e.s, r: e.r * k };
  return { adsr: normalizeAdsr(fitted), releaseStart: duration - fitted.r };
}

function connectVoice(ctx, dest, cfg, duration, setFrequency) {
  const osc = ctx.createOscillator();
  const partials = cfg.partials;
  if (partials && partials.length) {
    const b = buildPeriodicWave(ctx, partials, { normalize: cfg.normalize || 'peak' });
    if (!b.wave) throw new RangeError('The additive table is silent');
    osc.setPeriodicWave(b.wave);
  } else {
    osc.type = cfg.waveform || 'sine';
  }
  setFrequency(osc.frequency);
  const env = ctx.createGain();
  const level = ctx.createGain();
  level.gain.value = cfg.gain != null ? Math.max(0, cfg.gain) : 0.5;
  const fit = fitEnvelope(cfg.envelope || { a: 0.005, d: 0.001, s: 1, r: 0.02 }, duration);
  applyAdsr(env.gain, 0, fit.adsr, 1);
  releaseAt(env.gain, fit.releaseStart, fit.adsr.r);
  osc.connect(env);
  env.connect(level);
  let tail = level;
  if (cfg.filter && cfg.filter.enabled !== false) {
    const stage = createFilterStage(ctx, cfg.filter);
    level.connect(stage.input);
    tail = stage.output;
  }
  tail.connect(dest);
  osc.start(0);
  osc.stop(duration);
}

/**
 * Tone build function for render().
 * cfg: { frequency, duration, waveform ('sine' | 'square' | 'sawtooth' | 'triangle'),
 *        partials (additive table, overrides waveform), gain (linear, default 0.5),
 *        envelope { a, d, s, r }, filter (filters.js config) }
 */
export function toneBuilder(cfg) {
  return (ctx, dest, { duration, sampleRate }) => {
    assertRenderableFrequency(cfg.frequency, sampleRate);
    connectVoice(ctx, dest, cfg, duration, (p) => p.setValueAtTime(cfg.frequency, 0));
  };
}

/**
 * Sweep build function for render(): the oscillator frequency moves from startHz to endHz over
 * the whole duration, 'log' (exponential ramp, constant octaves per second) or 'linear'.
 * cfg: { startHz, endHz, duration, curve = 'log', waveform, partials, gain, envelope, filter }
 */
export function sweepBuilder(cfg) {
  return (ctx, dest, { duration, sampleRate }) => {
    assertRenderableFrequency(cfg.startHz, sampleRate, 'Start frequency');
    assertRenderableFrequency(cfg.endHz, sampleRate, 'End frequency');
    connectVoice(ctx, dest, cfg, duration, (p) => {
      p.setValueAtTime(cfg.startHz, 0);
      if (cfg.curve === 'linear') p.linearRampToValueAtTime(cfg.endHz, duration);
      else p.exponentialRampToValueAtTime(cfg.endHz, duration);
    });
  };
}

/** Render a tone config: → Promise<AudioBuffer>. cfg as toneBuilder plus render options. */
export function renderTone(cfg) {
  return render(toneBuilder(cfg), cfg);
}

/** Render a sweep config: → Promise<AudioBuffer>. cfg as sweepBuilder plus render options. */
export function renderSweep(cfg) {
  return render(sweepBuilder(cfg), cfg);
}
