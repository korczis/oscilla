// Additive synthesis: harmonic coefficient tables and a PeriodicWave builder whose coefficients
// are exactly what the visualiser draws.
//
// A partial is { n, gain, phase }: the term gain · sin(n·ω·t + phase), gain linear, phase in
// radians. The built-in tables are the Fourier series of unit-amplitude (±1) waveforms,
// truncated to N harmonics:
//   square    (4/π)  Σ_{n odd} sin(nωt)/n
//   sawtooth  (2/π)  Σ_n (−1)^(n+1) sin(nωt)/n          (rising ramp, −1 → +1)
//   triangle  (8/π²) Σ_{n odd} (−1)^((n−1)/2) sin(nωt)/n²
// Negative signs are carried as phase π so gains stay non-negative for the bar display.
//
// PeriodicWave mapping: Web Audio evaluates Σ real[n]·cos(nωt) + imag[n]·sin(nωt), so
// gain·sin(nωt + φ) = gain·sin φ·cos(nωt) + gain·cos φ·sin(nωt) → real[n] = gain·sin φ,
// imag[n] = gain·cos φ; index 0 (DC) stays 0.
//
// Normalisation: the wave is always built with disableNormalization: true. The browser's
// default normalisation rescales every table to a peak of 1, which would make the drawn gains
// differ from what plays and make "−20 dB" meaningless as an absolute level. Instead the
// builder computes the real peak of the summed waveform itself (Gibbs overshoot included) and,
// with normalize: 'peak' (the default), scales the coefficients by 1/peak so the output cannot
// exceed full scale. The scale is returned and visualCoefficients() applies it, so the bars are
// the exact coefficients handed to createPeriodicWave.
// Above the oscillator's Nyquist frequency the browser drops partials (band-limited tables);
// visualCoefficients() flags those as not audible instead of hiding them.

export const MAX_PARTIALS = 256;
export const OFF_DB = -96; // gains at or below this are treated as off
export const ADDITIVE_PRESETS = Object.freeze(['sine', 'square', 'sawtooth', 'triangle', 'custom']);

function clampCount(n) {
  return Math.max(1, Math.min(MAX_PARTIALS, Math.floor(Number(n) || 1)));
}

export function dbToGain(db) {
  return db > OFF_DB ? 10 ** (db / 20) : 0;
}

export function gainToDb(g) {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

/**
 * harmonicSeries(shape, count) → partials for n = 1 … count (zero-gain entries included, so
 * index i is harmonic i + 1). shape: 'sine' | 'square' | 'sawtooth' | 'saw' | 'triangle'.
 */
export function harmonicSeries(shape, count = 10) {
  const N = clampCount(count);
  const out = [];
  for (let n = 1; n <= N; n++) {
    let gain = 0;
    let phase = 0;
    switch (shape) {
      case 'sine':
        gain = n === 1 ? 1 : 0;
        break;
      case 'square':
        gain = n % 2 ? 4 / (Math.PI * n) : 0;
        break;
      case 'saw':
      case 'sawtooth':
        gain = 2 / (Math.PI * n);
        phase = n % 2 ? 0 : Math.PI;
        break;
      case 'triangle':
        gain = n % 2 ? 8 / (Math.PI * Math.PI * n * n) : 0;
        phase = n % 2 && ((n - 1) / 2) % 2 ? Math.PI : 0;
        break;
      default:
        throw new RangeError(`Unknown harmonic shape “${shape}”`);
    }
    out.push({ n, gain, phase });
  }
  return out;
}

/**
 * customSeries(gainsDb, phasesDeg) → partials from per-harmonic gain (dB, ≤ OFF_DB or
 * −Infinity = off) and phase (degrees). Index i is harmonic i + 1.
 */
export function customSeries(gainsDb, phasesDeg = []) {
  const N = clampCount(gainsDb.length);
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = Number(phasesDeg[i]) || 0;
    out.push({ n: i + 1, gain: dbToGain(Number(gainsDb[i])), phase: (p * Math.PI) / 180 });
  }
  return out;
}

/** Copy of partials with harmonic n changed ({ gainDb?, gain?, phaseDeg?, phase? }). */
export function setHarmonic(partials, n, change = {}) {
  const out = partials.map((p) => ({ ...p }));
  while (out.length < n && out.length < MAX_PARTIALS)
    out.push({ n: out.length + 1, gain: 0, phase: 0 });
  const p = out[n - 1];
  if (!p) return out;
  if (change.gainDb != null) p.gain = dbToGain(change.gainDb);
  else if (change.gain != null) p.gain = Math.max(0, Number(change.gain) || 0);
  if (change.phaseDeg != null) p.phase = ((Number(change.phaseDeg) || 0) * Math.PI) / 180;
  else if (change.phase != null) p.phase = Number(change.phase) || 0;
  return out;
}

/** Instantaneous value of the partial sum at cycle position x in [0, 1). */
export function evaluatePartials(partials, x, scale = 1) {
  let s = 0;
  const w = 2 * Math.PI * x;
  for (const p of partials) if (p.gain) s += p.gain * Math.sin(p.n * w + p.phase);
  return s * scale;
}

/** One period of the waveform sampled at `length` points (Float32Array). */
export function synthesizePeriod(
  partials,
  length = 512,
  scale = 1,
  out = new Float32Array(length),
) {
  for (let i = 0; i < length; i++) out[i] = evaluatePartials(partials, i / length, scale);
  return out;
}

/** Peak |x| of the summed waveform over one period (dense sampling; Gibbs overshoot included). */
export function waveformPeak(partials, resolution = 4096) {
  const maxN = partials.reduce((m, p) => (p.gain ? Math.max(m, p.n) : m), 1);
  const len = Math.max(resolution, maxN * 32);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const v = Math.abs(evaluatePartials(partials, i / len));
    if (v > peak) peak = v;
  }
  return peak;
}

/** real/imag arrays for createPeriodicWave (length = highest harmonic + 1, index 0 = DC = 0). */
export function toPeriodicWaveArrays(partials, scale = 1) {
  const maxN = partials.reduce((m, p) => Math.max(m, p.n), 1);
  const real = new Float32Array(maxN + 1);
  const imag = new Float32Array(maxN + 1);
  for (const p of partials) {
    if (!(p.n >= 1) || !p.gain) continue;
    real[p.n] = p.gain * scale * Math.sin(p.phase);
    imag[p.n] = p.gain * scale * Math.cos(p.phase);
  }
  return { real, imag };
}

/**
 * buildPeriodicWave(ctx, partials, { normalize = 'peak', headroom = 1 }) →
 *   { wave, real, imag, scale, peak, outputPeak }
 * normalize 'peak': scale = headroom / peak (output peak = headroom); 'none': scale = 1.
 * peak is the unscaled waveform peak; outputPeak = peak · scale. A silent table (all gains 0)
 * returns wave: null.
 */
export function buildPeriodicWave(ctx, partials, options = {}) {
  const normalize = options.normalize || 'peak';
  const headroom = options.headroom > 0 ? options.headroom : 1;
  const peak = waveformPeak(partials);
  if (!(peak > 0)) return { wave: null, real: null, imag: null, scale: 0, peak: 0, outputPeak: 0 };
  const scale = normalize === 'none' ? 1 : headroom / peak;
  const { real, imag } = toPeriodicWaveArrays(partials, scale);
  const wave = ctx ? ctx.createPeriodicWave(real, imag, { disableNormalization: true }) : null;
  return { wave, real, imag, scale, peak, outputPeak: peak * scale };
}

/**
 * visualCoefficients(partials, { scale = 1, fundamentalHz, sampleRate }) → bars
 *   [{ n, frequencyHz, gain, gainDb, phase, phaseDeg, audible }]
 * gain is the coefficient actually given to the PeriodicWave (scale applied). audible is false
 * for partials at or above the Nyquist frequency of the running context (the browser drops
 * them), null when the fundamental or sample rate is unknown.
 */
export function visualCoefficients(partials, options = {}) {
  const scale = options.scale != null ? options.scale : 1;
  const f0 = options.fundamentalHz;
  const nyq = options.sampleRate > 0 ? options.sampleRate / 2 : null;
  return partials.map((p) => {
    const gain = p.gain * scale;
    const frequencyHz = f0 > 0 ? f0 * p.n : null;
    const deg = ((((p.phase * 180) / Math.PI) % 360) + 360) % 360;
    return {
      n: p.n,
      frequencyHz,
      gain,
      gainDb: gainToDb(gain),
      phase: p.phase,
      phaseDeg: deg,
      audible: frequencyHz != null && nyq != null ? frequencyHz < nyq : null,
    };
  });
}

/** Highest harmonic number below Nyquist for a fundamental (0 when f0 ≥ Nyquist). */
export function harmonicsBelowNyquist(fundamentalHz, sampleRate) {
  if (!(fundamentalHz > 0) || !(sampleRate > 0)) return 0;
  const nyq = sampleRate / 2;
  let n = Math.floor(nyq / fundamentalHz);
  if (n * fundamentalHz >= nyq) n--;
  return Math.max(0, n);
}

/**
 * createAdditiveOscillator(ctx, partials, { frequency = 440, normalize, headroom, track,
 *                                            source }) → voice part
 *   { input: null, output, oscillator, coefficients, scale, start(t), stop(t),
 *     update({ partials, frequency }), dispose() }
 * An OscillatorNode playing buildPeriodicWave(partials). coefficients is
 * visualCoefficients(...) for exactly the table that plays (refreshed by update). The output is
 * the oscillator itself: connect it to the voice's envelope gain. track(node) / source(node) are
 * called for the oscillator (V1 voice accounting; default identity). An all-zero table cannot
 * be a PeriodicWave: the oscillator keeps its previous wave, coefficients keep describing that
 * wave (what plays), and silentRequest becomes true so the engine can mute the voice.
 */
export function createAdditiveOscillator(ctx, partials, options = {}) {
  const track = options.track || ((node) => node);
  const source = options.source || ((node) => node);
  const osc = source(track(ctx.createOscillator()));
  let current = { partials, frequency: options.frequency || 440 };
  let built = null;
  let coefficients = [];

  let playing = null; // partials of the wave the oscillator actually holds
  let silentRequest = false;

  function refreshCoefficients() {
    coefficients = visualCoefficients(playing || [], {
      scale: built ? built.scale : 0,
      fundamentalHz: current.frequency,
      sampleRate: ctx.sampleRate,
    });
  }

  function rebuild() {
    const b = buildPeriodicWave(ctx, current.partials, options);
    silentRequest = !b.wave;
    if (b.wave) {
      osc.setPeriodicWave(b.wave);
      built = b;
      playing = current.partials.map((p) => ({ ...p }));
    } else if (!built) {
      // silent from the start: install an explicit unit sine so "what plays" is defined
      const sine = harmonicSeries('sine', 1);
      built = buildPeriodicWave(ctx, sine, { normalize: 'none' });
      osc.setPeriodicWave(built.wave);
      playing = sine;
    }
    refreshCoefficients();
  }

  const nyqSafe = (ctx.sampleRate / 2) * 0.95;
  osc.frequency.setValueAtTime(Math.min(nyqSafe, current.frequency), ctx.currentTime);
  rebuild();
  let started = false;
  let stopped = false;

  return {
    input: null,
    output: osc,
    oscillator: osc,
    get coefficients() {
      return coefficients;
    },
    get scale() {
      return built ? built.scale : 0;
    },
    get build() {
      return built;
    },
    get silentRequest() {
      return silentRequest;
    },
    start(t = ctx.currentTime) {
      if (!started) {
        osc.start(t);
        started = true;
      }
    },
    stop(t = ctx.currentTime) {
      if (started && !stopped) {
        osc.stop(t);
        stopped = true;
      }
    },
    update(next = {}) {
      if (next.frequency != null && next.frequency > 0) {
        current.frequency = Math.min(nyqSafe, next.frequency);
        osc.frequency.setTargetAtTime(current.frequency, ctx.currentTime, 0.015);
      }
      if (next.partials) {
        current = { ...current, partials: next.partials };
        rebuild();
      } else if (next.frequency != null) {
        refreshCoefficients(); // audibility flags depend on the fundamental
      }
      return coefficients;
    },
    dispose() {
      if (started && !stopped) {
        try {
          osc.stop();
        } catch (e) {
          /* already stopped */
        }
      }
      stopped = true;
      try {
        osc.disconnect();
      } catch (e) {
        /* ignore */
      }
    },
  };
}
