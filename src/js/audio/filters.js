// Filter Lab stage: BiquadFilterNode with a click-free bypass and a response probe.
//
//   input ─┬─ dry ───────────────────────┐
//          ├─ filterA ─ wetA ────────────┼─ output
//          └─ filterB ─ wetB ────────────┘
//
// Q is LINEAR for every type in this module's API. The Web Audio specification defines the Q of
// "lowpass" and "highpass" in dB (α = sin ω0 / (2·10^(Q/20))) and the Q of the other types as
// linear, so nodeQ() converts: a lowpass with Q = 0.7071 (Butterworth) is set to the node as
// 20·log10(0.7071) = −3.01 dB and is −3 dB at its cutoff.
//
// Click-free changes:
//   - enable/bypass crossfades dry ↔ wet linearly (equal-gain: dry and filtered signals are
//     correlated in the passband, an equal-power fade would bump the level by up to 3 dB);
//   - frequency/Q/gain changes glide with setTargetAtTime (τ = 10 ms);
//   - a type change configures the idle biquad with the new settings and crossfades to it, so
//     the running filter's state is never switched under the signal.
//
// getResponse() calls getFrequencyResponse() on an unconnected probe biquad that holds the
// configured values directly (no glide), so the chart shows the browser's own response for the
// current settings immediately; the audible node reaches the same values within ~50 ms.

export const FILTER_TYPES = Object.freeze(['lowpass', 'highpass', 'bandpass', 'notch', 'peaking']);
export const DEFAULT_FILTER = Object.freeze({
  type: 'lowpass',
  frequency: 1000,
  Q: Math.SQRT1_2,
  gain: 0,
  enabled: true,
});

const SAFE_NYQUIST_FACTOR = 0.95;
const MIN_FREQUENCY = 10;
const GLIDE_TAU_S = 0.01;
const CROSSFADE_S = 0.02;
const identity = (node) => node;

/** Whether the type uses Q (all biquad types here do except shelves). */
export function usesQ(type) {
  return type !== 'lowshelf' && type !== 'highshelf';
}

/** Whether the type uses gain (peaking and shelves). */
export function usesGain(type) {
  return type === 'peaking' || type === 'lowshelf' || type === 'highshelf';
}

/** Web Audio Q value for a linear Q: dB for lowpass/highpass, linear otherwise. */
export function nodeQ(type, qLinear) {
  const q = Math.max(1e-4, Number(qLinear) || DEFAULT_FILTER.Q);
  return type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(q) : q;
}

/** Log-spaced frequencies from minHz to maxHz inclusive (Float32Array, for charts). */
export function logFrequencies(count, minHz, maxHz, out = new Float32Array(count)) {
  const n = Math.max(2, count | 0);
  const a = Math.log(minHz);
  const b = Math.log(maxHz);
  for (let i = 0; i < n; i++) out[i] = Math.exp(a + ((b - a) * i) / (n - 1));
  return out;
}

/** Clamp a filter config to valid values for a sample rate (frequency < 0.95 × Nyquist). */
export function normalizeFilter(cfg, sampleRate) {
  const c = { ...DEFAULT_FILTER, ...cfg };
  const type = FILTER_TYPES.includes(c.type) ? c.type : DEFAULT_FILTER.type;
  const maxF = (sampleRate / 2) * SAFE_NYQUIST_FACTOR;
  return {
    type,
    frequency: Math.min(
      maxF,
      Math.max(MIN_FREQUENCY, Number(c.frequency) || DEFAULT_FILTER.frequency),
    ),
    Q: Math.min(1000, Math.max(1e-4, Number(c.Q) || DEFAULT_FILTER.Q)),
    gain: Math.min(40, Math.max(-40, Number(c.gain) || 0)),
    enabled: c.enabled !== false,
  };
}

function setNow(node, c, t) {
  node.type = c.type;
  node.frequency.setValueAtTime(c.frequency, t);
  node.Q.setValueAtTime(nodeQ(c.type, c.Q), t);
  node.gain.setValueAtTime(c.gain, t);
}

function fade(param, target, t) {
  param.cancelScheduledValues(t);
  param.setTargetAtTime(target, t, CROSSFADE_S / 3);
}

/**
 * createFilterStage(ctx, cfg, { track }) → { input, output, update(cfg), getResponse(freqHz, out?),
 *                                          dispose(), config, node }
 * track(node) is called for every node created (V1 voice accounting; default identity).
 * cfg: { type, frequency (Hz), Q (linear), gain (dB, peaking), enabled }
 * getResponse(freqHz: Float32Array, out?) → { magDb, phaseDeg, enabled } (Float32Arrays; pass
 *   out = { magDb, phaseDeg } to reuse buffers). Frequencies outside 0…Nyquist give NaN.
 */
export function createFilterStage(ctx, cfg = {}, { track = identity } = {}) {
  const sr = ctx.sampleRate;
  let c = normalizeFilter(cfg, sr);
  const input = track(ctx.createGain());
  const output = track(ctx.createGain());
  const dry = track(ctx.createGain());
  const filters = [track(ctx.createBiquadFilter()), track(ctx.createBiquadFilter())];
  const wets = [track(ctx.createGain()), track(ctx.createGain())];
  const probe = track(ctx.createBiquadFilter());
  let active = 0;
  let disposed = false;
  const t0 = ctx.currentTime;

  input.connect(dry);
  dry.connect(output);
  for (let i = 0; i < 2; i++) {
    input.connect(filters[i]);
    filters[i].connect(wets[i]);
    wets[i].connect(output);
    setNow(filters[i], c, t0);
    wets[i].gain.setValueAtTime(0, t0);
  }
  wets[active].gain.setValueAtTime(c.enabled ? 1 : 0, t0);
  dry.gain.setValueAtTime(c.enabled ? 0 : 1, t0);
  syncProbe();

  // The probe is never automated: plain .value assignments, so getFrequencyResponse() sees
  // exactly the configured values whether or not the context is running.
  function syncProbe() {
    probe.type = c.type;
    probe.frequency.value = c.frequency;
    probe.Q.value = nodeQ(c.type, c.Q);
    probe.gain.value = c.gain;
  }

  function update(next = {}) {
    if (disposed) return { ...c };
    const prev = c;
    c = normalizeFilter({ ...c, ...next }, sr);
    const t = ctx.currentTime;
    if (c.type !== prev.type) {
      const idle = 1 - active;
      setNow(filters[idle], c, t);
      if (c.enabled) {
        fade(wets[active].gain, 0, t);
        fade(wets[idle].gain, 1, t);
      }
      active = idle;
    } else {
      const f = filters[active];
      f.frequency.setTargetAtTime(c.frequency, t, GLIDE_TAU_S);
      f.Q.setTargetAtTime(nodeQ(c.type, c.Q), t, GLIDE_TAU_S);
      f.gain.setTargetAtTime(c.gain, t, GLIDE_TAU_S);
    }
    if (c.enabled !== prev.enabled) {
      fade(wets[active].gain, c.enabled ? 1 : 0, t);
      fade(dry.gain, c.enabled ? 0 : 1, t);
    }
    syncProbe();
    return { ...c };
  }

  function getResponse(freqHz, out) {
    const n = freqHz.length;
    const mag = out && out.magDb && out.magDb.length === n ? out.magDb : new Float32Array(n);
    const ph =
      out && out.phaseDeg && out.phaseDeg.length === n ? out.phaseDeg : new Float32Array(n);
    probe.getFrequencyResponse(freqHz, mag, ph);
    for (let i = 0; i < n; i++) {
      mag[i] = mag[i] > 0 ? 20 * Math.log10(mag[i]) : Number.isNaN(mag[i]) ? NaN : -Infinity;
      ph[i] = (ph[i] * 180) / Math.PI;
    }
    return { magDb: mag, phaseDeg: ph, enabled: c.enabled };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const n of [input, dry, ...filters, ...wets, output, probe]) {
      try {
        n.disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }
  }

  return {
    input,
    output,
    update,
    getResponse,
    dispose,
    get config() {
      return { ...c };
    },
    get node() {
      return filters[active];
    },
  };
}
