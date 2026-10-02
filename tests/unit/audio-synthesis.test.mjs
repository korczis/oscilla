import test from 'node:test';
import assert from 'node:assert/strict';
import {
  harmonicSeries,
  customSeries,
  setHarmonic,
  toPeriodicWaveArrays,
  waveformPeak,
  synthesizePeriod,
  buildPeriodicWave,
  createAdditiveOscillator,
  visualCoefficients,
  harmonicsBelowNyquist,
  evaluatePartials,
  dbToGain,
} from '../../src/js/audio/additive.js';
import { mulberry32, fillWhite, noiseSamples, normalizeRms } from '../../src/js/audio/noise.js';
import { createSpectrumAnalyzer } from '../../src/js/analysis/fft.js';
import { panGains, routingGains } from '../../src/js/audio/stereo.js';
import { nodeQ, logFrequencies, normalizeFilter, usesGain } from '../../src/js/audio/filters.js';
import {
  normalizeRenderOptions,
  assertRenderableFrequency,
  fitEnvelope,
  bufferStats,
  render,
} from '../../src/js/audio/offline-renderer.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

// ---------- additive ----------

test('harmonicSeries: Fourier coefficients of square, saw, triangle, sine', () => {
  const sq = harmonicSeries('square', 9);
  for (const p of sq) close(p.gain, p.n % 2 ? 4 / (Math.PI * p.n) : 0);
  const saw = harmonicSeries('sawtooth', 6);
  for (const p of saw) {
    close(p.gain, 2 / (Math.PI * p.n));
    close(p.phase, p.n % 2 ? 0 : Math.PI);
  }
  const tri = harmonicSeries('triangle', 7);
  assert.deepEqual(
    tri.map((p) => p.phase),
    [0, 0, Math.PI, 0, 0, 0, Math.PI],
  );
  for (const p of tri) close(p.gain, p.n % 2 ? 8 / (Math.PI ** 2 * p.n ** 2) : 0);
  assert.deepEqual(
    harmonicSeries('sine', 3).map((p) => p.gain),
    [1, 0, 0],
  );
  assert.throws(() => harmonicSeries('noise', 3), RangeError);
});

test('harmonicSeries: partial sums converge to the ideal waveforms', () => {
  const N = 256; // MAX_PARTIALS; the alternating tail after N terms is below 4/(πN)
  assert.equal(harmonicSeries('square', 5000).length, N, 'capped at MAX_PARTIALS');
  close(evaluatePartials(harmonicSeries('square', N), 0.25), 1, 4 / (Math.PI * N));
  close(evaluatePartials(harmonicSeries('triangle', N), 0.25), 1, 8 / (Math.PI ** 2 * N));
  close(evaluatePartials(harmonicSeries('triangle', 255), 0), 0, 1e-9);
  // sawtooth (rising): x(t) = 2t for t in (-0.5, 0.5) → at t = 0.25: 0.5
  close(evaluatePartials(harmonicSeries('sawtooth', N), 0.25), 0.5, 2 / (Math.PI * N));
});

test('PeriodicWave arrays: real = g·sin φ, imag = g·cos φ, DC zero', () => {
  const { real, imag } = toPeriodicWaveArrays([
    { n: 1, gain: 1, phase: 0 },
    { n: 2, gain: 0.5, phase: Math.PI / 2 },
    { n: 3, gain: 0.25, phase: Math.PI },
  ]);
  assert.equal(real.length, 4);
  assert.equal(real[0], 0);
  assert.equal(imag[0], 0);
  close(imag[1], 1);
  close(real[1], 0);
  close(real[2], 0.5, 1e-7);
  close(imag[2], 0, 1e-7);
  close(imag[3], -0.25, 1e-7);
  // the Web Audio sum Σ real cos + imag sin reproduces evaluatePartials
  const parts = harmonicSeries('triangle', 9);
  const arr = toPeriodicWaveArrays(parts);
  for (const x of [0.1, 0.37, 0.8]) {
    let s = 0;
    for (let n = 1; n < arr.real.length; n++)
      s +=
        arr.real[n] * Math.cos(2 * Math.PI * n * x) + arr.imag[n] * Math.sin(2 * Math.PI * n * x);
    close(s, evaluatePartials(parts, x), 1e-6);
  }
});

test('waveformPeak and peak normalisation (Gibbs overshoot included)', () => {
  const sq = harmonicSeries('square', 10);
  const peak = waveformPeak(sq);
  assert.ok(peak > 1.05 && peak < 1.25, `square-10 peak ${peak}`);
  const fake = { createPeriodicWave: (r, i, o) => ({ r, i, o }) };
  const b = buildPeriodicWave(fake, sq);
  assert.equal(b.wave.o.disableNormalization, true);
  close(b.outputPeak, 1);
  close(b.scale, 1 / peak);
  const none = buildPeriodicWave(fake, sq, { normalize: 'none' });
  assert.equal(none.scale, 1);
  assert.equal(buildPeriodicWave(fake, customSeries([-Infinity, -200])).wave, null);
  const period = synthesizePeriod(sq, 1024, b.scale);
  assert.ok(Math.max(...period.map(Math.abs)) <= 1 + 1e-6);
});

test('custom tables, setHarmonic, visual coefficients equal what plays', () => {
  const c = customSeries([0, -6, -Infinity], [0, 90, 0]);
  close(c[1].gain, dbToGain(-6));
  close(c[1].phase, Math.PI / 2);
  assert.equal(c[2].gain, 0);
  const c2 = setHarmonic(c, 5, { gainDb: -12, phaseDeg: 180 });
  assert.equal(c2.length, 5);
  close(c2[4].gain, 10 ** (-12 / 20));
  assert.equal(c[1].gain, dbToGain(-6), 'immutable');
  const bars = visualCoefficients(c2, { scale: 0.5, fundamentalHz: 5000, sampleRate: 48000 });
  close(bars[0].gain, 0.5);
  close(bars[0].gainDb, 20 * Math.log10(0.5));
  assert.equal(bars[4].audible, false, '25 kHz is above Nyquist');
  assert.equal(bars[3].audible, true);
  close(bars[4].phaseDeg, 180);
  assert.equal(visualCoefficients(c2)[0].audible, null);
  assert.equal(harmonicsBelowNyquist(5000, 48000), 4);
  assert.equal(harmonicsBelowNyquist(6000, 48000), 3, '24 kHz equals Nyquist: excluded');
});

test('additive oscillator: coefficients always describe the wave that plays', () => {
  const waves = [];
  const param = { setValueAtTime() {}, setTargetAtTime() {} };
  const osc = {
    frequency: param,
    setPeriodicWave: (w) => waves.push(w),
    start() {},
    stop() {},
    disconnect() {},
  };
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createOscillator: () => osc,
    createPeriodicWave: (real, imag, o) => ({ real, imag, o }),
  };
  const tracked = [];
  const add = createAdditiveOscillator(ctx, harmonicSeries('square', 5), {
    frequency: 1000,
    track: (n) => (tracked.push(n), n),
  });
  assert.equal(tracked.length, 1);
  assert.equal(waves.length, 1);
  close(add.coefficients[0].gain, (4 / Math.PI) * add.scale);
  add.update({ partials: customSeries([-Infinity, -Infinity]) });
  assert.equal(add.silentRequest, true);
  assert.equal(waves.length, 1, 'silent table: previous wave kept');
  close(add.coefficients[0].gain, (4 / Math.PI) * add.scale, 1e-12);
  add.update({ frequency: 9000 });
  assert.equal(add.coefficients[2].audible, false, '27 kHz above Nyquist');
  const silent = createAdditiveOscillator(ctx, customSeries([-Infinity]), { frequency: 100 });
  assert.equal(silent.silentRequest, true);
  assert.deepEqual(
    silent.coefficients.map((c) => c.gain),
    [1],
    'explicit unit sine installed',
  );
});

// ---------- noise ----------

test('noise: deterministic PRNG, RMS normalisation, pink slope ≈ −3 dB/octave', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const w = fillWhite(new Float32Array(1000), mulberry32(1));
  assert.ok(w.every((x) => x >= -1 && x < 1));
  const white = noiseSamples(1 << 17, { color: 'white', seed: 3 });
  const pink = noiseSamples(1 << 17, { color: 'pink', seed: 3 });
  const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  close(rms(white), 0.2, 1e-4);
  close(rms(pink), 0.2, 1e-4);
  assert.ok(pink.reduce((m, v) => Math.max(m, Math.abs(v)), 0) < 0.99);
  // averaged band powers: pink loses ~3 dB per octave, white ~0
  const N = 4096;
  const an = createSpectrumAnalyzer(N);
  const band = (sig, f0) => {
    let s = 0;
    let n = 0;
    const spec = new Float64Array(N / 2);
    for (let off = 0; off + N <= sig.length; off += N) {
      const d = an.compute(sig, off);
      for (let k = 0; k < N / 2; k++) spec[k] += 10 ** (d[k] / 10);
    }
    const bin = 48000 / N;
    for (let k = Math.ceil(f0 / bin); k < (2 * f0) / bin; k++) {
      s += spec[k];
      n++;
    }
    return 10 * Math.log10(s / n);
  };
  const pinkSlope = band(pink, 4000) - band(pink, 500);
  const whiteSlope = band(white, 4000) - band(white, 500);
  console.log(
    `# pink 500 Hz → 4 kHz: ${pinkSlope.toFixed(2)} dB (3 octaves), ` +
      `white ${whiteSlope.toFixed(2)} dB`,
  );
  assert.ok(Math.abs(pinkSlope + 9) < 1, `pink slope ${pinkSlope} over 3 octaves`);
  assert.ok(Math.abs(whiteSlope) < 1);
  assert.deepEqual(normalizeRms(new Float32Array(4)), { rms: 0, peak: 0, scale: 0 });
  assert.throws(() => noiseSamples(10, { color: 'brown' }), RangeError);
});

test('noise: pink loop seam is continuous (state carried over)', () => {
  const p = noiseSamples(48000, { color: 'pink', seed: 9 });
  // the step across the seam is no larger than typical sample-to-sample steps
  const steps = [];
  for (let i = 1; i < p.length; i++) steps.push(Math.abs(p[i] - p[i - 1]));
  steps.sort((x, y) => x - y);
  const p999 = steps[Math.floor(steps.length * 0.999)];
  assert.ok(Math.abs(p[0] - p[p.length - 1]) < p999);
});

// ---------- stereo / filter helpers ----------

test('stereo: equal-power pan law and routing gains', () => {
  const c = panGains(0);
  close(c.left, Math.SQRT1_2);
  close(c.right, Math.SQRT1_2);
  close(panGains(-1).left, 1);
  close(panGains(-1).right, 0, 1e-12);
  close(panGains(1).right, 1);
  for (const p of [-0.7, 0.2, 0.9]) {
    const g = panGains(p);
    close(g.left ** 2 + g.right ** 2, 1);
  }
  assert.deepEqual(routingGains({ mode: 'split' }), {
    aL: 1,
    aR: 0,
    bL: 0,
    bR: 1,
    stereo: 1,
    mono: 0,
  });
  const m = routingGains({ mode: 'mono', panA: 0, panB: 0, levelA: 0.5 });
  assert.equal(m.mono, 1);
  assert.equal(m.stereo, 0);
  close(m.aL, 0.5 * Math.SQRT1_2);
});

test('filters: linear Q → node Q (dB for lowpass/highpass), log frequencies, clamping', () => {
  close(nodeQ('lowpass', Math.SQRT1_2), -3.0103, 1e-4);
  close(nodeQ('highpass', 1), 0);
  close(nodeQ('bandpass', 2), 2);
  close(nodeQ('peaking', 0.5), 0.5);
  const f = logFrequencies(5, 10, 100000);
  close(f[0], 10, 1e-4);
  close(f[2], 1000, 1e-2);
  close(f[4], 100000, 1);
  const c = normalizeFilter({ type: 'bogus', frequency: 30000, Q: 0 }, 48000);
  assert.equal(c.type, 'lowpass');
  assert.equal(c.frequency, 22800);
  assert.ok(usesGain('peaking') && !usesGain('notch'));
});

// ---------- offline renderer (pure parts) ----------

test('offline renderer: validation, safe-maximum rejection, envelope fit, stats', async () => {
  assert.deepEqual(normalizeRenderOptions({ duration: 1, sampleRate: 44100, channels: 1 }), {
    sampleRate: 44100,
    channels: 1,
    duration: 1,
    length: 44100,
  });
  assert.throws(() => normalizeRenderOptions({ duration: 0 }), RangeError);
  assert.throws(() => normalizeRenderOptions({ duration: 1, sampleRate: 1000 }), RangeError);
  assert.throws(() => normalizeRenderOptions({ duration: 500 }), /limited/);
  assert.throws(() => assertRenderableFrequency(22800, 48000), /safe maximum/);
  assert.equal(assertRenderableFrequency(22799, 48000), 22799);
  const fit = fitEnvelope({ a: 1, d: 1, s: 0.5, r: 2 }, 2);
  close(fit.adsr.a + fit.adsr.d + fit.adsr.r, 1.8, 1e-9);
  close(fit.releaseStart, 2 - fit.adsr.r);
  const st = bufferStats({
    numberOfChannels: 1,
    getChannelData: () => Float32Array.from([0.5, -1.5, 0]),
  });
  close(st.peak, 1.5);
  assert.equal(st.clippedSamples, 1);
  await assert.rejects(
    render(() => {}, { duration: 1, OfflineAudioContext: null }),
    /not available/,
  );
});
