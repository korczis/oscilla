import test from 'node:test';
import assert from 'node:assert/strict';
import { createFft } from '../../src/js/analysis/fft.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import {
  ALGORITHMS,
  KNOWN_ALGORITHM_IDS,
  RETAINED_ALGORITHMS,
  VARIANT_OF,
  describeAlgorithm,
  isKnownAlgorithm,
} from '../../src/js/measurement/algorithms.js';
import {
  MEASUREMENT_STATES as S,
  TRANSITIONS,
  ACTIVE_STATES,
  HISTORY_LIMIT,
  IllegalTransitionError,
  createMeasurementMachine,
} from '../../src/js/measurement/state-machine.js';
import {
  normalizeStimulus,
  renderStimulus,
  inverseSweep,
  sweepConstant,
  instantaneousFrequency,
  StimulusError,
  SAFE_NYQUIST_FRACTION,
  BAND_EDGE_TAPER_OCT,
} from '../../src/js/measurement/stimulus.js';
import {
  windowFn,
  powerSpectrum,
  welch,
  nextPow2,
  binHz,
  toDb,
  createPowerSpectrumAnalyzer,
} from '../../src/js/measurement/spectrum.js';
import {
  checkCapture,
  CLIP_THRESHOLD,
  CLIP_MIN_RUN,
  DROPOUT_MIN_S,
} from '../../src/js/measurement/capture-checks.js';
import { align } from '../../src/js/measurement/align.js';

const SR = 48000;

// ---------- helpers ----------

/** Linear convolution by FFT (test-only; the modules under test never convolve). */
function convolve(x, h) {
  const len = x.length + h.length - 1;
  const n = nextPow2(len);
  const fft = createFft(n);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(x);
  br.set(h);
  fft.forward(ar, ai);
  fft.forward(br, bi);
  for (let k = 0; k < n; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k];
    const i = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = r;
    ai[k] = -i;
  }
  fft.forward(ar, ai);
  const y = new Float64Array(len);
  for (let i = 0; i < len; i++) y[i] = ar[i] / n;
  return y;
}

/** |DFT| of x zero-padded to n at bin k. */
function dftMagnitudeAt(x, n, k) {
  const fft = createFft(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft.forward(re, im);
  return Math.hypot(re[k], im[k]);
}

function sine(f, n, amp = 1, phase = 0.3, sr = SR) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr + phase);
  return x;
}

function uniformNoise(n, rms, seed) {
  const rng = mulberry32(seed);
  const x = new Float32Array(n);
  // Uniform in [−a, a) has RMS a/√3.
  const a = rms * Math.sqrt(3);
  for (let i = 0; i < n; i++) x[i] = (rng() * 2 - 1) * a;
  return x;
}

/** Least-squares slope of dB against log2(f) over the bins in [fLo, fHi]. */
function slopeDbPerOctave(power, sr, fftSize, fLo, fHi) {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let n = 0;
  for (let k = 1; k < power.length - 1; k++) {
    const f = (k * sr) / fftSize;
    if (f < fLo || f > fHi) continue;
    const x = Math.log2(f);
    const y = toDb(power[k]);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    n++;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

function meanPowerDb(power, sr, fftSize, inBand) {
  let s = 0;
  let n = 0;
  for (let k = 1; k < power.length - 1; k++) {
    if (!inBand((k * sr) / fftSize)) continue;
    s += power[k];
    n++;
  }
  return toDb(s / n);
}

// ---------- algorithms ----------

test('algorithms: frozen contract IDs, known/unknown, described by family and version', () => {
  assert.ok(Object.isFrozen(ALGORITHMS));
  assert.equal(ALGORITHMS.ir, 'oscilla.ir.log-sweep.v3');
  for (const [role, id] of Object.entries(ALGORITHMS)) {
    assert.ok(isKnownAlgorithm(id), id);
    const family = VARIANT_OF[role] || role;
    const version = Number(id.slice(id.lastIndexOf('.v') + 2));
    assert.deepEqual({ ...describeAlgorithm(id) }, { id, family, version });
  }
  // Superseded IDs stay known and keep their family (ADR 0024).
  for (const [role, ids] of Object.entries(RETAINED_ALGORITHMS)) {
    for (const id of ids) {
      assert.ok(isKnownAlgorithm(id), id);
      assert.ok(KNOWN_ALGORITHM_IDS.includes(id), id);
      assert.equal(describeAlgorithm(id).family, VARIANT_OF[role] || role);
      assert.ok(describeAlgorithm(id).version < describeAlgorithm(ALGORITHMS[role]).version);
    }
  }
  assert.equal(ALGORITHMS.quality, 'oscilla.confidence.v4');
  assert.equal(describeAlgorithm('oscilla.confidence.v1').family, 'quality');
  // A variant reports the role it is an alternative for (ADR 0024: distinct IDs per method).
  assert.equal(describeAlgorithm('oscilla.ir.farina-inverse.v1').family, 'ir');
  assert.equal(describeAlgorithm('oscilla.window.blackman-harris.v1').family, 'window');
  assert.equal(isKnownAlgorithm('oscilla.transfer.v4'), false);
  assert.deepEqual(
    { ...describeAlgorithm('oscilla.transfer.v2') },
    { id: 'oscilla.transfer.v2', family: 'transfer', version: 2 },
  );
  for (const bad of ['transfer', 'oscilla.transfer', 'oscilla.Transfer.v1', 'x.ir.v1', 7, null])
    assert.equal(describeAlgorithm(bad), null, String(bad));
  assert.equal(isKnownAlgorithm(null), false);
});

// ---------- state machine ----------

/** Shortest legal path from IDLE to `target` (BFS over the table). */
function pathTo(target) {
  const prev = new Map([[S.IDLE, null]]);
  const queue = [S.IDLE];
  while (queue.length) {
    const s = queue.shift();
    if (s === target) break;
    for (const t of TRANSITIONS[s]) {
      if (!prev.has(t)) {
        prev.set(t, s);
        queue.push(t);
      }
    }
  }
  const path = [];
  for (let s = target; s !== S.IDLE; s = prev.get(s)) path.unshift(s);
  return path;
}

function machineAt(state) {
  const m = createMeasurementMachine();
  for (const s of pathTo(state)) m.go(s);
  assert.equal(m.state, state);
  return m;
}

test('state machine: every state is reachable and every listed edge is legal', () => {
  const all = Object.values(S);
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...all].sort());
  assert.ok(Object.isFrozen(TRANSITIONS) && Object.isFrozen(TRANSITIONS[S.IDLE]));
  let edges = 0;
  for (const from of all) {
    for (const to of TRANSITIONS[from]) {
      const m = machineAt(from);
      assert.ok(m.can(to), `${from} → ${to}`);
      const entry = m.go(to, { at: 1.5 });
      assert.equal(m.state, to);
      assert.deepEqual({ ...entry.info }, { at: 1.5 });
      edges++;
    }
  }
  assert.ok(edges >= 30, `${edges} edges`);
});

test('state machine: every edge not in the table throws IllegalTransitionError', () => {
  const all = Object.values(S);
  for (const from of all) {
    for (const to of [...all, 'BOGUS']) {
      if (TRANSITIONS[from].includes(to)) continue;
      const m = machineAt(from);
      assert.equal(m.can(to), false, `${from} → ${to}`);
      assert.throws(
        () => m.go(to),
        (e) => e instanceof IllegalTransitionError && e.from === from && e.to === to,
      );
      assert.equal(m.state, from, 'a refused edge leaves the state unchanged');
    }
  }
});

test('state machine: named cases (ANALYZING → MEASURING, IDLE → MEASURING, no self-loop)', () => {
  const m = machineAt(S.ANALYZING);
  assert.throws(() => m.go(S.MEASURING), { code: 'ILLEGAL_TRANSITION' });
  assert.throws(() => createMeasurementMachine().go(S.MEASURING), IllegalTransitionError);
  assert.throws(() => machineAt(S.READY).go(S.READY), IllegalTransitionError);
  assert.throws(() => machineAt(S.ERROR).go(S.PREFLIGHT), IllegalTransitionError);
});

test('state machine: abort from every active state, no-op elsewhere; reset; history', () => {
  for (const s of ACTIVE_STATES) {
    const m = machineAt(s);
    const entry = m.abort('user');
    assert.equal(m.state, S.ABORTED, s);
    assert.equal(entry.from, s);
    assert.equal(entry.info.reason, 'user');
  }
  const changes = [];
  const m = createMeasurementMachine({ onChange: (e) => changes.push(`${e.from}>${e.to}`) });
  assert.equal(m.abort('x'), null, 'abort from IDLE does nothing');
  for (const s of [S.PREFLIGHT, S.NOISE_CHECK, S.READY, S.ARMED, S.MEASURING]) m.go(s);
  m.abort('stop pressed');
  assert.equal(m.state, S.ABORTED);
  assert.equal(m.abort('again'), null, 'a second abort is harmless');
  const h = m.history;
  assert.equal(h.length, 6);
  assert.deepEqual(
    h.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(Object.isFrozen(h[0]));
  h.length = 0;
  assert.equal(m.history.length, 6, 'history getter returns a copy');
  m.reset();
  assert.equal(m.state, S.IDLE);
  assert.equal(m.history.length, 0);
  assert.equal(changes.at(-1), 'ABORTED>IDLE');
  assert.equal(changes.length, 7);
  assert.equal(m.reset(), null, 'reset at IDLE does not notify');
  assert.equal(changes.length, 7);
});

test('state machine: repeats loop MEASURING → ARMED and the history stays bounded', () => {
  const m = machineAt(S.MEASURING);
  for (let i = 0; i < HISTORY_LIMIT; i++) {
    m.go(S.ARMED);
    m.go(S.MEASURING);
  }
  m.go(S.ANALYZING);
  m.go(S.COMPLETE, { resultId: 'r1' });
  assert.equal(m.history.length, HISTORY_LIMIT);
  assert.equal(m.history.at(-1).to, S.COMPLETE);
});

// ---------- stimulus: normalization ----------

test('stimulus: frequencies clamp to 0.95 × Nyquist at 44.1, 48 and 96 kHz', () => {
  for (const sr of [44100, 48000, 96000]) {
    const safe = (sr / 2) * SAFE_NYQUIST_FRACTION;
    const hi = normalizeStimulus({ kind: 'sine', sampleRate: sr, f: 30000 });
    if (30000 > safe) {
      assert.equal(hi.clampedTo, safe, `${sr}`);
      assert.equal(hi.spec.f, safe);
    } else {
      assert.equal(hi.clampedTo, null, `${sr}`);
      assert.equal(hi.spec.f, 30000);
    }
    const sw = normalizeStimulus({ kind: 'log-sweep', sampleRate: sr, f1: 20, f2: 60000 });
    assert.equal(sw.clampedTo, safe);
    assert.equal(sw.spec.f2, safe);
    assert.equal(sw.spec.f1, 20);
    const ok = normalizeStimulus({ kind: 'sine', sampleRate: sr, f: 1000 });
    assert.equal(ok.clampedTo, null);
    // Idempotent: a clamped spec normalizes to itself with nothing more to clamp.
    const again = normalizeStimulus(sw.spec);
    assert.deepEqual({ ...again.spec }, { ...sw.spec });
    assert.equal(again.clampedTo, null);
  }
  // 44.1 kHz: 0.95 × 22050 = 20947.5 Hz exactly.
  assert.equal(normalizeStimulus({ kind: 'sine', sampleRate: 44100, f: 22000 }).spec.f, 20947.5);
  const r = renderStimulus({ kind: 'chirp', sampleRate: 44100, f1: 100, f2: 40000 });
  assert.equal(r.clampedTo, 20947.5);
});

test('stimulus: validation throws coded errors instead of changing values', () => {
  const bad = [
    [{ kind: 'square', sampleRate: SR }, 'UNKNOWN_KIND'],
    [{ kind: 'sine' }, 'BAD_SAMPLE_RATE'],
    [{ kind: 'sine', sampleRate: 1000 }, 'BAD_SAMPLE_RATE'],
    [{ kind: 'log-sweep', sampleRate: SR, duration: 0.5 }, 'BAD_DURATION'],
    [{ kind: 'log-sweep', sampleRate: SR, duration: 31 }, 'BAD_DURATION'],
    [{ kind: 'sine', sampleRate: SR, level: 1.2 }, 'BAD_LEVEL'],
    [{ kind: 'sine', sampleRate: SR, level: 0 }, 'BAD_LEVEL'],
    [{ kind: 'sine', sampleRate: SR, f: 0.5 }, 'BAD_FREQUENCY'],
    [{ kind: 'log-sweep', sampleRate: SR, f1: 2000, f2: 1000 }, 'BAD_FREQUENCY'],
    // f1 above the safe maximum clamps to it and then equals the clamped f2.
    [{ kind: 'band-noise', sampleRate: SR, f1: 46000, f2: 47000 }, 'BAD_FREQUENCY'],
    [{ kind: 'sine', sampleRate: SR, duration: 1, fade: 0.5 }, 'BAD_FADE'],
    [{ kind: 'band-noise', sampleRate: SR, color: 'blue' }, 'BAD_OPTION'],
    [{ kind: 'chirp', sampleRate: SR, law: 'cubic' }, 'BAD_OPTION'],
  ];
  for (const [spec, code] of bad) {
    assert.throws(
      () => normalizeStimulus(spec),
      (e) => e instanceof StimulusError && e.code === code,
      JSON.stringify(spec),
    );
  }
  assert.throws(() => inverseSweep({ kind: 'sine', sampleRate: SR }), { code: 'BAD_OPTION' });
  const { spec } = normalizeStimulus({ kind: 'pink', sampleRate: SR, seed: 3.6 });
  assert.equal(spec.seed, 4);
  assert.equal(spec.f, null);
  assert.ok(Object.isFrozen(spec));
});

test('stimulus: length, fades, level and determinism for every kind', () => {
  const kinds = ['sine', 'log-sweep', 'white', 'pink', 'band-noise', 'chirp'];
  for (const kind of kinds) {
    const spec = { kind, sampleRate: SR, level: 0.25, seed: 9, f1: 200, f2: 4000 };
    const a = renderStimulus(spec);
    const b = renderStimulus(spec);
    assert.equal(a.samples.length, Math.round(a.spec.duration * SR), kind);
    assert.deepEqual(a.samples, b.samples, `${kind} is deterministic`);
    assert.equal(Math.abs(a.samples[0]), 0, `${kind} fades in from 0`);
    assert.equal(Math.abs(a.samples.at(-1)), 0, `${kind} fades out to 0`);
    let peak = 0;
    for (const v of a.samples) peak = Math.max(peak, Math.abs(v));
    // Tones have amplitude `level` (sampled peak at most level, within float32 rounding);
    // noises are peak-normalized to it.
    assert.ok(peak <= 0.25 * (1 + 1e-6), `${kind} peak ${peak}`);
    if (kind !== 'chirp') assert.ok(peak > 0.25 * 0.999, `${kind} peak ${peak}`);
  }
  const p1 = renderStimulus({ kind: 'pink', sampleRate: SR, seed: 1 }).samples;
  const p2 = renderStimulus({ kind: 'pink', sampleRate: SR, seed: 2 }).samples;
  assert.notDeepEqual(p1, p2, 'different seeds give different realizations');
});

// ---------- stimulus: log sweep ----------

/**
 * Mean frequency between the first and last zero crossing inside [t0, t1]: k half periods
 * between crossings at ta and tb mean a phase advance of kπ, so f̄ = k / (2(tb − ta)) exactly.
 * Crossings are located by linear interpolation between the samples around the sign change.
 */
function zeroCrossingFrequency(x, sr, t0, t1) {
  const times = [];
  for (let i = Math.max(1, Math.ceil(t0 * sr)); i <= Math.floor(t1 * sr); i++) {
    const a = x[i - 1];
    const b = x[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) times.push((i - 1 + a / (a - b)) / sr);
  }
  const ta = times[0];
  const tb = times.at(-1);
  return { f: (times.length - 1) / (2 * (tb - ta)), ta, tb };
}

test('stimulus: log-sweep instantaneous frequency at start, middle and end', () => {
  const spec = normalizeStimulus({
    kind: 'log-sweep',
    sampleRate: SR,
    duration: 2,
    f1: 50,
    f2: 5000,
  }).spec;
  const x = renderStimulus(spec).samples;
  const L = sweepConstant(spec);
  assert.ok(Math.abs(L - 2 / Math.log(100)) < 1e-12);
  const T = spec.duration;
  const w = 0.05;
  const windows = [
    [spec.fade, spec.fade + w],
    [T / 2 - w / 2, T / 2 + w / 2],
    [T - spec.fade - w, T - spec.fade],
  ];
  for (const [t0, t1] of windows) {
    const { f, ta, tb } = zeroCrossingFrequency(x, SR, t0, t1);
    const tm = (ta + tb) / 2;
    const fInst = spec.f1 * Math.exp(tm / L);
    assert.equal(instantaneousFrequency(spec, tm), fInst);
    // Tolerance from L: the mean of f1·e^{t/L} over a span D exceeds its value at the midpoint
    // by the factor sinh(D/2L)/(D/2L) ≈ 1 + (D/L)²/24. Crossing times carry the linear-
    // interpolation error of a sine, ≤ h²/24 sample with h = 2πf/sr rad per sample, at both
    // ends of D. Doubled for margin.
    const D = tb - ta;
    const h = (2 * Math.PI * f) / SR;
    const timing = (2 * (h * h)) / 24 / (D * SR);
    const tol = 2 * fInst * ((D / L) ** 2 / 24 + timing);
    assert.ok(Math.abs(f - fInst) <= tol, `t=${tm.toFixed(3)} f=${f} expected ${fInst} ±${tol}`);
    // Stricter: against the exact mean of the Farina law over [ta, tb] only the crossing-time
    // error remains (the phase advance between the crossings is f1·L·(e^{tb/L} − e^{ta/L})).
    const fMean = (spec.f1 * L * (Math.exp(tb / L) - Math.exp(ta / L))) / D;
    assert.ok(Math.abs(f - fMean) <= 2 * fInst * timing, `mean ${f} vs ${fMean}`);
  }
  // The sweep spans f1 … f2: the start window sits within a fade + window of f1, the end one
  // within as much of f2 (frequency ratio e^{(fade + w)/L}).
  const span = Math.exp((spec.fade + w) / L);
  const first = zeroCrossingFrequency(x, SR, ...windows[0]).f;
  const last = zeroCrossingFrequency(x, SR, ...windows[2]).f;
  assert.ok(first >= spec.f1 && first <= spec.f1 * span, `start ${first}`);
  assert.ok(last <= spec.f2 && last >= spec.f2 / span, `end ${last}`);
});

test('stimulus: sweep ⊛ inverse is a band-limited impulse with unit gain at band centre', () => {
  for (const sr of [44100, 48000]) {
    const spec = { kind: 'log-sweep', sampleRate: sr, duration: 2, f1: 20, f2: 20000, level: 0.5 };
    const x = renderStimulus(spec).samples;
    const inv = inverseSweep(spec);
    assert.deepEqual(inv, inverseSweep(normalizeStimulus(spec).spec), 'same normalized spec');
    assert.equal(inv.length, x.length);
    const y = convolve(x, inv);
    let peak = 0;
    let at = -1;
    for (let i = 0; i < y.length; i++) {
      if (Math.abs(y[i]) > peak) {
        peak = Math.abs(y[i]);
        at = i;
      }
    }
    // Linear convolution of a length-N signal with its time reverse aligns every frequency at
    // index N − 1; ±1 sample allows for the parity of the band-limited peak.
    assert.ok(Math.abs(at - (x.length - 1)) <= 1, `peak at ${at}, expected ${x.length - 1}`);
    // Outside ±5 ms every sample is ≥ 40 dB below the peak. This bounds the level of the
    // residue (pre-echo, sinc tails of the band edges), measured −60 dB here. The integrated
    // energy outside the window cannot reach −40 dB for any band-limited impulse: the missing
    // band below f1 = 20 Hz alone is a low-pass "hole" carrying ≈ 2·f1/sr of energy against a
    // peak² of ≈ (2(f2 − f1)/sr)², about −29 dB, and almost all of it lies beyond 5 ms.
    const win = Math.round(0.005 * sr);
    let outside = 0;
    for (let i = 0; i < y.length; i++) {
      if (Math.abs(i - at) > win) outside = Math.max(outside, Math.abs(y[i]));
    }
    const residueDb = 20 * Math.log10(outside / peak);
    assert.ok(residueDb <= -40, `residue ${residueDb} dB`);
    // Unit gain at the band centre √(f1·f2). The stationary-phase scale is exact up to
    // O(1/(2π·fc·L)) ≈ 1e-3 (0.008 dB) at fc = 632 Hz; 0.05 dB is six times that.
    const n = nextPow2(y.length);
    const fc = Math.sqrt(20 * 20000);
    const g = dftMagnitudeAt(y, n, Math.round((fc * n) / sr));
    assert.ok(Math.abs(20 * Math.log10(g)) <= 0.05, `centre gain ${20 * Math.log10(g)} dB`);
  }
});

// ---------- stimulus: noise colours ----------

test('stimulus: pink noise PSD slope is −3 dB/octave ± 0.5 over 100 Hz - 10 kHz (Welch)', () => {
  const fftSize = 8192;
  for (const seed of [1, 2024]) {
    const x = renderStimulus({ kind: 'pink', sampleRate: SR, duration: 10, seed }).samples;
    const { power, segments } = welch(x, { fftSize, overlap: 0.5 });
    assert.ok(segments > 100);
    // Theory −10·log10(2) = −3.01 dB/octave. Statistical error of the fit with ~116 averaged
    // segments and ~1700 bins is ~0.02 dB/octave and Kellet's filter ripple (±0.05 dB) adds
    // < 0.02 dB/octave over 6.6 octaves; ±0.5 (the requirement) leaves room for seeds.
    const slope = slopeDbPerOctave(power, SR, fftSize, 100, 10000);
    assert.ok(Math.abs(slope + 10 * Math.log10(2)) <= 0.5, `seed ${seed}: slope ${slope}`);
  }
  // White stays flat (the test would catch a colour mix-up).
  const w = renderStimulus({ kind: 'white', sampleRate: SR, duration: 10 }).samples;
  const slope = slopeDbPerOctave(welch(w, { fftSize }).power, SR, fftSize, 100, 10000);
  assert.ok(Math.abs(slope) <= 0.5, `white slope ${slope}`);
});

test('stimulus: band-noise is ≥ 30 dB lower outside the band than inside', () => {
  const fftSize = 8192;
  for (const color of ['white', 'pink']) {
    const spec = { kind: 'band-noise', sampleRate: SR, duration: 4, f1: 1000, f2: 4000, color };
    const x = renderStimulus(spec).samples;
    const { power } = welch(x, { fftSize, window: 'blackman-harris' });
    // In-band excludes the edge tapers; out-of-band starts one octave from the band, beyond the
    // Blackman-Harris main lobe (±4 bins ≈ 23 Hz) and the taper.
    const t = 2 ** BAND_EDGE_TAPER_OCT;
    const inside = meanPowerDb(power, SR, fftSize, (f) => f >= 1000 * t && f <= 4000 / t);
    const outside = meanPowerDb(power, SR, fftSize, (f) => (f > 20 && f < 500) || f > 8000);
    assert.ok(inside - outside >= 30, `${color}: in ${inside} out ${outside}`);
    if (color === 'pink') {
      const slope = slopeDbPerOctave(power, SR, fftSize, 1000 * t, 4000 / t);
      // Shaped 1/√f in magnitude: −3.01 dB/octave; ±0.5 as for the pink-noise test.
      assert.ok(Math.abs(slope + 10 * Math.log10(2)) <= 0.5, `band pink slope ${slope}`);
    }
  }
});

// ---------- spectrum ----------

test('spectrum: window gains and helpers', () => {
  const h = windowFn('hann', 1024);
  const bh = windowFn('blackman-harris', 1024);
  for (const w of [h, bh]) {
    let s = 0;
    let s2 = 0;
    for (const v of w.samples) {
      s += v;
      s2 += v * v;
    }
    assert.ok(Math.abs(s / 1024 - w.coherentGain) < 1e-12, w.name);
    assert.ok(Math.abs(s2 / 1024 - w.noisePowerGain) < 1e-12, w.name);
  }
  assert.ok(Math.abs(h.enbwBins - 1.5) < 1e-12);
  assert.ok(Math.abs(bh.enbwBins - 2.0044) < 1e-4);
  assert.throws(() => windowFn('kaiser', 16), RangeError);
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(1000), 1024);
  assert.equal(nextPow2(1024), 1024);
  assert.equal(binHz(48000, 8192), 48000 / 8192);
  assert.equal(toDb(0), -Infinity);
  assert.equal(toDb(1), 0);
});

test('spectrum: full-scale bin-centred sine reads 0 dB ± 0.05 (Hann, Blackman-Harris)', () => {
  const fftSize = 4096;
  const k = 100;
  const x = sine((k * SR) / fftSize, fftSize, 1);
  const copy = Float32Array.from(x);
  for (const window of ['hann', 'blackman-harris']) {
    const p = powerSpectrum(x, { fftSize, window });
    assert.equal(p.length, fftSize / 2 + 1);
    // Exact in theory (periodic window, bin-centred tone); float32 input rounding is ~1e-6 dB.
    // 0.05 dB is far below the errors this guards against: the one-sided factor (6 dB), the
    // coherent gain (6-9 dB) or scalloping (≥ 0.8 dB).
    assert.ok(Math.abs(toDb(p[k])) <= 0.05, `${window}: ${toDb(p[k])} dB`);
  }
  // Half a bin off centre the Hann reading drops by its scalloping loss, 1.42 dB.
  const off = powerSpectrum(sine(((k + 0.5) * SR) / fftSize, fftSize, 1), { fftSize });
  const scallop = toDb(Math.max(off[k], off[k + 1]));
  assert.ok(Math.abs(scallop + 1.4236) < 0.01, `scalloping ${scallop}`);
  // −20 dB amplitude reads −20 dB; offset reads a later frame; input not mutated.
  const quiet = sine((k * SR) / fftSize, 2 * fftSize, 0.1);
  assert.ok(Math.abs(toDb(powerSpectrum(quiet, { fftSize, offset: fftSize })[k]) + 20) < 0.05);
  assert.deepEqual(x, copy);
});

test('spectrum: Welch averages linear power, not dB', () => {
  const fftSize = 1024;
  const sigma = 0.1;
  const x = uniformNoise(fftSize * 64, sigma, 5);
  const copy = Float32Array.from(x);
  const res = welch(x, { fftSize, overlap: 0.5 });
  assert.equal(res.hop, 512);
  assert.equal(res.segments, 127);
  assert.deepEqual(x, copy, 'input not mutated');
  // Identical to the mean of the per-segment spectra.
  const an = createPowerSpectrumAnalyzer(fftSize, 'hann');
  const mean = new Float64Array(fftSize / 2 + 1);
  let meanDb = 0;
  for (let s = 0; s < res.segments; s++) {
    const p = an.compute(x, s * res.hop);
    for (let k = 0; k < mean.length; k++) mean[k] += p[k] / res.segments;
    meanDb += toDb(p[200]) / res.segments;
  }
  // Same sums in a different order: equal to double-precision rounding (relative 1e-12).
  for (const k of [1, 200, 511]) assert.ok(Math.abs(res.power[k] - mean[k]) <= 1e-12 * mean[k]);
  // Expected per-bin power of white noise on the tone scale: 4σ²·ENBW/N. Averaged over 510
  // bins × 127 segments (≈ 3·10⁴ partly correlated χ² values) the relative standard error is
  // ≈ 1 %, 0.04 dB; 0.25 dB is six standard errors.
  let s = 0;
  for (let k = 1; k < fftSize / 2; k++) s += res.power[k];
  const expected = (4 * sigma * sigma * 1.5) / fftSize;
  assert.ok(Math.abs(toDb(s / (fftSize / 2 - 1)) - toDb(expected)) < 0.25);
  // Averaging dB instead would read low by 10·γ/ln 10 = 2.51 dB (γ: Euler's constant) for a
  // χ²₂ variable; with 127 segments one bin's estimate scatters by ≈ 5.6/√127 = 0.5 dB, so the
  // gap lies within 2.51 ± 1.5 dB (three standard errors).
  const gap = toDb(res.power[200]) - meanDb;
  assert.ok(gap > 1 && gap < 4, `dB-average bias ${gap}`);
  assert.throws(() => welch(new Float32Array(100), { fftSize }), RangeError);
});

// ---------- capture checks ----------

function capture(samples, sampleRate = SR) {
  return { sampleRate, samples, preRoll: 0, postRoll: 0, startedAt: 0 };
}

/** Independent reference: runs of |x| ≥ threshold with length ≥ minRun. */
function railRuns(x, threshold = CLIP_THRESHOLD, minRun = CLIP_MIN_RUN) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= x.length; i++) {
    const rail = i < x.length && Math.abs(x[i]) >= threshold;
    if (rail && start < 0) start = i;
    if (!rail && start >= 0) {
      if (i - start >= minRun) runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

test('capture checks: a clipped sine is detected with its merged region and ratio', () => {
  const x = sine(1000, SR, 0.5);
  for (let i = 12000; i < 24000; i++) x[i] = Math.max(-1, Math.min(1, x[i] * 3));
  const copy = Float32Array.from(x);
  const r = checkCapture(capture(x));
  const runs = railRuns(x);
  const clipped = runs.reduce((s, [a, b]) => s + b - a, 0);
  assert.equal(r.clipping.regions.length, 1, 'one overload event (half cycles merged)');
  assert.deepEqual(r.clipping.regions[0], { start: runs[0][0], end: runs.at(-1)[1] });
  assert.ok(r.clipping.regions[0].start >= 12000 && r.clipping.regions[0].end <= 24000);
  assert.equal(r.clipping.ratio, clipped / x.length);
  assert.equal(r.invalid, true);
  assert.deepEqual(
    r.reasons.map((e) => e.code),
    ['CLIPPING'],
  );
  assert.equal(r.peak, 1);
  assert.deepEqual(x, copy, 'input not mutated');
});

test('capture checks: a single 0.99 spike (or two) is not clipping, three samples are', () => {
  const x = sine(440, SR, 0.3);
  x[5000] = 0.99;
  x[9000] = -0.99;
  x[9001] = -0.99;
  let r = checkCapture(capture(x));
  assert.equal(r.clipping.regions.length, 0);
  assert.equal(r.clipping.ratio, 0);
  assert.equal(r.invalid, false);
  assert.ok(Math.abs(r.peak - 0.99) < 1e-6);
  x[20000] = x[20001] = x[20002] = 1;
  r = checkCapture(capture(x));
  assert.deepEqual(r.clipping.regions, [{ start: 20000, end: 20003 }]);
});

test('capture checks: 50 ms of zeros inside the capture is a dropout, 10 ms is not', () => {
  const x = renderStimulus({ kind: 'pink', sampleRate: SR, duration: 1, level: 0.3 }).samples;
  const gap = x.slice();
  gap.fill(0, 20000, 20000 + 0.05 * SR);
  const r = checkCapture(capture(gap));
  assert.deepEqual(r.dropouts, [{ start: 20000, end: 22400 }]);
  assert.equal(r.invalid, true);
  assert.ok(r.reasons.some((e) => e.code === 'DROPOUT'));
  const short = x.slice();
  short.fill(0, 20000, 20000 + 0.01 * SR);
  assert.equal(checkCapture(capture(short)).dropouts.length, 0);
  // A frozen non-zero value is a dropout too.
  const frozen = x.slice();
  frozen.fill(0.123, 30000, 30000 + Math.ceil(DROPOUT_MIN_S * SR) + 10);
  assert.equal(checkCapture(capture(frozen)).dropouts.length, 1);
  // Leading silence (input not started yet) is not a dropout.
  const lead = x.slice();
  lead.fill(0, 0, 0.1 * SR);
  assert.equal(checkCapture(capture(lead)).dropouts.length, 0);
  assert.equal(checkCapture(capture(lead)).invalid, false);
});

test('capture checks: silence is empty/invalid; non-finite and missing data are invalid', () => {
  const silent = checkCapture(capture(new Float32Array(SR)));
  assert.equal(silent.empty, true);
  assert.equal(silent.invalid, true);
  assert.deepEqual(
    silent.reasons.map((e) => e.code),
    ['EMPTY'],
  );
  assert.equal(silent.dropouts.length, 0, 'all-silent is empty, not a dropout');
  assert.ok(typeof silent.reasons[0].text === 'string');
  // −100 dBFS RMS noise is still empty; −60 dBFS is a live input.
  assert.equal(checkCapture(capture(uniformNoise(SR, 1e-5, 3))).empty, true);
  assert.equal(checkCapture(capture(uniformNoise(SR, 1e-3, 3))).empty, false);
  const nan = uniformNoise(SR, 0.1, 4);
  nan[100] = NaN;
  assert.ok(checkCapture(capture(nan)).reasons.some((e) => e.code === 'NON_FINITE'));
  assert.deepEqual(
    checkCapture(capture(new Float32Array(0))).reasons.map((e) => e.code),
    ['NO_SAMPLES'],
  );
  assert.ok(
    checkCapture({ samples: uniformNoise(100, 0.1, 1) }).reasons.some(
      (e) => e.code === 'BAD_SAMPLE_RATE',
    ),
  );
});

// ---------- alignment ----------

test('align: known delays 0, 123 and 4800 samples, clean and at 0 dB SNR', () => {
  const ref = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: 1, f1: 20 }).samples;
  let refEnergy = 0;
  for (const v of ref) refEnergy += v * v;
  const refRms = Math.sqrt(refEnergy / ref.length);
  const refCopy = ref.slice();
  for (const delay of [0, 123, 4800]) {
    for (const snrDb of [Infinity, 0]) {
      const cap = new Float32Array(ref.length + 9600);
      cap.set(ref, delay);
      if (snrDb !== Infinity) {
        const noise = uniformNoise(cap.length, refRms * 10 ** (-snrDb / 20), 11 + delay);
        for (let i = 0; i < cap.length; i++) cap[i] += noise[i];
      }
      const r = align(ref, cap, SR, { maxLagS: 0.2 });
      // ±0.5 sample (the requirement). The correlation peak of a broadband reference is
      // symmetric about an integer delay, so the clean case is exact; at 0 dB SNR the matched
      // filter gain of N = 48000 samples (47 dB) keeps the peak far above the noise.
      assert.ok(Math.abs(r.lagSamples - delay) <= 0.5, `${delay} @ ${snrDb} dB: ${r.lagSamples}`);
      assert.equal(r.lagSeconds, r.lagSamples / SR);
      assert.equal(r.polarity, 1);
      if (snrDb === Infinity) assert.ok(r.peakCorrelation > 0.999);
      else {
        // Equal noise power in the window: r = E / √(E · 2E) = 1/√2; the cross terms scatter
        // by ≈ 1/√N ≈ 0.005, so ±0.03 is six standard deviations.
        assert.ok(Math.abs(r.peakCorrelation - Math.SQRT1_2) < 0.03, `${r.peakCorrelation}`);
      }
    }
  }
  assert.deepEqual(ref, refCopy, 'reference not mutated');
});

test('align: inverted polarity, lag limit and empty inputs', () => {
  const ref = renderStimulus({ kind: 'pink', sampleRate: SR, duration: 0.5, seed: 4 }).samples;
  const cap = new Float32Array(ref.length + 2000);
  for (let i = 0; i < ref.length; i++) cap[i + 777] = -0.5 * ref[i];
  const r = align(ref, cap, SR);
  assert.ok(Math.abs(r.lagSamples - 777) <= 0.5);
  assert.equal(r.polarity, -1);
  assert.ok(r.peakCorrelation > 0.999, 'scale does not change the normalized peak');
  // A lag limit below the true delay cannot find it and reports a weak correlation.
  const limited = align(ref, cap, SR, { maxLagS: 500 / SR });
  assert.ok(limited.lagSamples <= 500);
  assert.ok(limited.peakCorrelation < 0.5);
  const none = align(ref, new Float32Array(cap.length), SR);
  assert.equal(none.lagSamples, null);
  assert.equal(none.peakCorrelation, 0);
  assert.throws(() => align(new Float32Array(0), cap, SR), RangeError);
});
