// White and pink noise from a looped AudioBuffer (the Filter Lab input), deterministic for a
// given seed.
//
// PRNG: mulberry32 (32-bit state, period 2^32), adequate for audio noise and reproducible.
// White: uniform in [−1, 1) (flat expected power spectrum).
// Pink: Paul Kellet's refined filter (seven first-order sections, ±0.05 dB of −3 dB/octave above
// ~10 Hz at 44.1 kHz; the deviation at 48 kHz is of the same order). The filter is run over the
// buffer twice and only the second pass is kept: its state at sample 0 is then the state after
// the last sample, so the loop point is seamless (no low-frequency step at the seam).
// Both colours are scaled to the same RMS (−14 dBFS by default, peak kept below 0.99) so
// switching colour in the lab does not change the level by itself.

import { applyAdsr, releaseAt, MIN_SEGMENT_S } from './envelope.js';

const DEFAULT_RMS = 0.2;
const FADE_S = 0.02;
const FLOOR = 1e-4;

/** mulberry32 PRNG: returns () → float in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fillWhite(out, rng) {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Pink noise into out (Kellet filter over uniform white, seamless when looped). */
export function fillPink(out, rng) {
  const n = out.length;
  const white = new Float32Array(n);
  fillWhite(white, rng);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const w = white[i];
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      if (pass === 1) out[i] = y;
    }
  }
  return out;
}

/** Scale in place to the target RMS, then down if the peak would exceed maxPeak. */
export function normalizeRms(data, rms = DEFAULT_RMS, maxPeak = 0.99) {
  let s = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    s += data[i] * data[i];
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  const cur = Math.sqrt(s / data.length);
  if (!(cur > 0)) return { rms: 0, peak: 0, scale: 0 };
  let k = rms / cur;
  if (peak * k > maxPeak) k = maxPeak / peak;
  for (let i = 0; i < data.length; i++) data[i] *= k;
  return { rms: cur * k, peak: peak * k, scale: k };
}

/** Noise samples (Float32Array) for color 'white' | 'pink'. */
export function noiseSamples(length, { color = 'white', seed = 1, rms = DEFAULT_RMS } = {}) {
  const out = new Float32Array(length);
  const rng = mulberry32(seed);
  if (color === 'pink') fillPink(out, rng);
  else if (color === 'white') fillWhite(out, rng);
  else throw new RangeError(`Unknown noise colour “${color}”`);
  normalizeRms(out, rms);
  return out;
}

/**
 * createNoiseBuffer(ctx, { color, seconds = 4, seed = 1, channels = 1, rms }) → AudioBuffer
 * Each channel uses seed + channel index (decorrelated, still reproducible).
 */
export function createNoiseBuffer(ctx, options = {}) {
  const seconds = Math.max(0.1, options.seconds || 4);
  const channels = Math.max(1, Math.min(2, options.channels || 1));
  const length = Math.round(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const data = noiseSamples(length, { ...options, seed: (options.seed || 1) + ch });
    buffer.copyToChannel(data, ch);
  }
  return buffer;
}

/**
 * createNoiseSource(ctx, { color = 'white', seed, seconds, level = 1, track, source }) → source
 * track(node) is called for every node, source(node) additionally for every buffer source.
 *   { input: null, output, start(t?), stop(t?), update({ level, color }), dispose(), playing }
 * start/stop fade over 20 ms from/to a 1e-4 floor; a new AudioBufferSourceNode is created per
 * start (they are single-use). Changing colour regenerates the buffer and crossfades it in on
 * the next start. dispose() stops immediately and disconnects (call stop() first to fade).
 */
export function createNoiseSource(ctx, options = {}) {
  const track = options.track || ((node) => node);
  const source = options.source || ((node) => node);
  let cfg = { color: 'white', seed: 1, seconds: 4, level: 1, ...options };
  delete cfg.track;
  delete cfg.source;
  let buffer = createNoiseBuffer(ctx, cfg);
  const output = track(ctx.createGain());
  // fade: start/stop envelope (envelope.js, click-free hold on stop); output: user level.
  const fade = track(ctx.createGain());
  fade.connect(output);
  output.gain.setValueAtTime(Math.max(FLOOR, cfg.level), ctx.currentTime);
  let src = null;
  let stopAt = Infinity;

  function start(t = ctx.currentTime) {
    if (src && t < stopAt) return; // already running
    src = source(track(ctx.createBufferSource()));
    src.buffer = buffer;
    src.loop = true;
    src.connect(fade);
    src.start(t);
    stopAt = Infinity;
    applyAdsr(fade.gain, t, { a: FADE_S, d: MIN_SEGMENT_S, s: 1, r: FADE_S }, 1);
  }

  function stop(t = ctx.currentTime) {
    if (!src) return;
    const { endTime } = releaseAt(fade.gain, t, FADE_S);
    stopAt = endTime + 0.005;
    const s = src;
    s.stop(stopAt);
    s.onended = () => {
      try {
        s.disconnect();
      } catch (e) {
        /* ignore */
      }
      if (src === s) src = null;
    };
  }

  return {
    input: null,
    output,
    start,
    stop,
    get playing() {
      return !!src && ctx.currentTime < stopAt;
    },
    get buffer() {
      return buffer;
    },
    update(next = {}) {
      const prev = cfg;
      cfg = { ...cfg, ...next };
      if (cfg.color !== prev.color || cfg.seed !== prev.seed || cfg.seconds !== prev.seconds) {
        buffer = createNoiseBuffer(ctx, cfg);
        if (src && ctx.currentTime < stopAt) {
          const t = ctx.currentTime;
          stop(t);
          start(t + FADE_S + 0.005);
        }
      }
      if (cfg.level !== prev.level) {
        output.gain.setTargetAtTime(Math.max(FLOOR, cfg.level), ctx.currentTime, 0.015);
      }
      return { ...cfg };
    },
    dispose() {
      if (src) {
        src.onended = null;
        try {
          src.stop();
        } catch (e) {
          /* already stopped */
        }
        try {
          src.disconnect();
        } catch (e) {
          /* ignore */
        }
        src = null;
      }
      try {
        fade.disconnect();
      } catch (e) {
        /* ignore */
      }
      try {
        output.disconnect();
      } catch (e) {
        /* ignore */
      }
    },
  };
}
