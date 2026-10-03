// V3 pre-release review, quality and DSP group: one regression test per finding, each against
// a known truth (analytic or constructed), each failing on the code before the fix.
//   B1  an empty / digitally silent noise check yields SNR NOT MEASURED, never "200 dB"
//   M1  the pooled SNR is the pooled power ratio (unbiased), with NOT ASSESSED low bands
//   M2  input processing reported on → POOR, unconfirmed → capped at USABLE
//   M8  only unusable captures invalidate a run; quality's clipping/dropout tiers are reachable
//   M5  the IR noise floor is read where the deconvolution sees all of the noise
//   m1  masked smoothing does not leak across a mask edge
//   m2  resolution = max(fs/N, 1/T_capture); SNR resolution = 1/T_noise
//   m9  noise band levels through spectrum.js toneToMeanSquare
//   NIT clipped regions name their sweep frequency; a rail peak without a flat top warns
import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../../src/js/audio/noise.js';
import {
  instantaneousFrequency, renderStimulus,
} from '../../src/js/measurement/stimulus.js';
import {
  SNR_CEIL_DB, TRANSFER_ALGORITHM_V1, computeTransfer, spectralDeconvolution,
} from '../../src/js/measurement/transfer.js';
import {
  IR_ALGORITHMS_V1, computeImpulseResponse,
} from '../../src/js/measurement/impulse-response.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import { smoothFractionalOctave, smoothResponse } from '../../src/js/measurement/smoothing.js';
import {
  QUALITY_ALGORITHM_V2, QUALITY_THRESHOLDS, assessQuality,
} from '../../src/js/measurement/quality.js';
import {
  RUN_INVALIDATING_CODES, assessMeasurement, createMeasurementEngine, summarizeNoise,
} from '../../src/js/measurement/engine.js';
import { welch, toneToMeanSquare } from '../../src/js/measurement/spectrum.js';
import { bandCenters, integrateBands } from '../../src/js/measurement/rta.js';

const SR = 48000;
const T = QUALITY_THRESHOLDS;
const SIXTH = 2 ** (1 / 12) - 2 ** (-1 / 12);

/** Seeded zero-mean Gaussian noise (mulberry32 + Box-Muller). */
function gaussian(seed, n, sigma) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    const m = sigma * Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

const codes = (q) => q.reasons.map((r) => r.code);
const reason = (q, code) => q.reasons.find((r) => r.code === code);
const OFF = Object.freeze({ echoCancellation: false, noiseSuppression: false,
  autoGainControl: false });

// ----------------------------------------------------------------------------- fake io

/**
 * A minimal synchronous-clock io (spec of engine.js): runs = gain · stimulus delayed by
 * `latency` after the pre-roll, plus Gaussian noise of runSigma; the noise check holds
 * noiseSigma (0 = digital silence). `mutate(samples, run)` edits a run capture afterwards.
 */
function fakeIo({ applied = OFF, runSigma = 1e-3, noiseSigma = 1e-3, gain = 0.5, latency = 100,
  mutate = null, testContext = null, noiseSamples = null } = {}) {
  let t = 1;
  let seed = 1;
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: { ok: true, device: { label: 'mic', id: 'x' },
          constraints: { requested: OFF, applied } },
        inputLevel: { peak: 0.01, rmsDb: -70 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' },
        ...(testContext ? { testContext } : {}) };
    },
    async captureNoise(seconds, { onScheduled } = {}) {
      const n = Math.round(seconds * SR);
      const samples = noiseSamples ? noiseSamples(n) : gaussian(seed++, n, noiseSigma);
      if (onScheduled) onScheduled({ captureStartAt: t, captureEndAt: t + seconds });
      t += seconds + 0.1;
      return { sampleRate: SR, samples, startedAt: t, constraints: { requested: OFF, applied },
        device: { label: 'mic', id: 'x' }, ...(testContext ? { testContext } : {}) };
    },
    async runStimulus(stim, { preRollS, postRollS, notBefore, onScheduled } = {}) {
      const run = seed;
      const cs = Math.max(t + 0.05, notBefore ?? 0);
      const pre = Math.round(preRollS * SR);
      const n = stim.samples.length;
      const frames = pre + n + Math.round(postRollS * SR);
      const samples = gaussian(seed++ + 1000, frames, runSigma);
      for (let i = 0; i < n; i++) samples[pre + latency + i] += gain * stim.samples[i];
      if (mutate) mutate(samples, run);
      const times = { captureStartAt: cs, stimulusStartAt: cs + pre / SR,
        stimulusEndAt: cs + (pre + n) / SR, captureEndAt: cs + frames / SR };
      if (onScheduled) onScheduled(times);
      t = times.captureEndAt + 0.01;
      return { sampleRate: SR, samples, startedAt: cs, stimulusStartAt: times.stimulusStartAt,
        constraints: { requested: OFF, applied }, device: { label: 'mic', id: 'x' },
        integrity: { expectedFrames: frames, receivedFrames: frames, discontinuities: 0 },
        ...(testContext ? { testContext } : {}) };
    },
    cancel() {},
    dispose() {},
    async yield() {},
  };
}

/** 1 s sweep, 0.25 s pre-roll, 0.5 s post-roll: the stimulus starts at capture sample 12000
 *  (+ latency 100), the certain sweep window is [36000, 60000), the aligned one ≈ [12100,
 *  60100), the capture holds 84000 samples. */
const PRE_S = 0.25;
const POST_S = 0.5;
function recipe({ repeats = 2, noiseCheckS = 5 } = {}) {
  return { stimulus: { kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000,
    fade: 0.01 }, repeats, analysis: { noiseCheckS, preRollS: PRE_S, postRollS: POST_S,
    gapS: 0.1 } };
}

async function measure(ioOpts, recipeOpts) {
  const engine = createMeasurementEngine({ io: fakeIo(ioOpts), assess: assessMeasurement });
  return engine.measure(recipe(recipeOpts));
}

// ----------------------------------------------------------------------------- baseline

test('baseline: clean capture, processing off, 5 s noise check → GOOD', async () => {
  const r = await measure({});
  assert.equal(r.state, 'COMPLETE');
  assert.equal(r.quality.status, 'GOOD', JSON.stringify(r.quality.reasons.filter((x) =>
    x.severity !== 'ok' && x.scope === 'quality')));
  assert.equal(reason(r.quality, 'INPUT_PROCESSING').severity, 'ok');
});

// ----------------------------------------------------------------------------- B1

test('B1: a digitally silent noise check is SNR NOT MEASURED, never "200 dB" GOOD', async () => {
  const r = await measure({ noiseSigma: 0 });
  assert.equal(r.state, 'COMPLETE', 'not invalidating (documented decision)');
  assert.equal(r.noise.checks.empty, true);
  // transfer.v2 derives no SNR from a noise capture without noise power.
  assert.equal(r.transfer.snrDb, null);
  assert.equal(r.transfer.snrPooledDb, null);
  for (const run of r.runs) assert.equal(run.transfer.snrDb, null);
  const q = r.quality;
  assert.notEqual(q.status, 'GOOD');
  assert.equal(q.status, 'USABLE');
  const nm = reason(q, 'SNR_NOT_MEASURED');
  assert.equal(nm.severity, 'warn');
  assert.equal(nm.value, null);
  assert.match(nm.text, /noise check is empty \(digital silence\) while the runs carry signal/);
  assert.equal(q.metrics.snrMedianDb, null);
  assert.equal(q.metrics.snrMinDb, null);
  for (const x of q.reasons) assert.doesNotMatch(x.text, /200 dB/, x.text);
  assert.ok(!codes(q).includes('SNR_MEDIAN'));
});

test('B1: an EMPTY noise check below −90 dBFS (not zero) is NOT MEASURED too', async () => {
  const r = await measure({ noiseSigma: 1e-5 }); // −100 dBFS
  assert.equal(r.noise.checks.empty, true);
  assert.ok(r.transfer.snrDb instanceof Float64Array, 'the transfer can still compute a ratio');
  const nm = reason(r.quality, 'SNR_NOT_MEASURED');
  assert.match(nm.text, /noise check is empty \(RMS −100\.\d dB relative/);
  assert.equal(r.quality.status, 'USABLE');
});

test('B1: transfer.v2 never stores the ceiling; v3 rejects a stored v1 ceiling', () => {
  const x = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: 1, f1: 20,
    f2: 20000, level: 0.5 }).samples;
  const y = gaussian(3, x.length + 9600, 1e-3);
  for (let i = 0; i < x.length; i++) y[2400 + i] += 0.5 * x[i];
  const silent = new Float32Array(SR);
  const base = { stimulus: x, captured: y, sampleRate: SR, f1: 20, f2: 20000, noise: silent };
  const t2 = computeTransfer(base);
  assert.equal(t2.snrDb, null);
  assert.equal(t2.snrPooledDb, null);
  assert.equal(t2.snrResolutionHz, SR / silent.length);
  // The retained v1 method reproduces the old behaviour: the 200 dB ceiling, stored.
  const t1 = computeTransfer({ ...base, options: { algorithm: TRANSFER_ALGORITHM_V1 } });
  assert.ok(t1.snrDb.every((v) => v === SNR_CEIL_DB));
  const check = checkCapture({ sampleRate: SR, samples: y });
  const q2 = assessQuality({ capture: check, transfer: t1, algorithm: QUALITY_ALGORITHM_V2 });
  assert.equal(reason(q2, 'SNR_MEDIAN').text, '200 dB median SNR', 'the v2 defect, retained');
  const q3 = assessQuality({ capture: check, transfer: t1 });
  assert.match(reason(q3, 'SNR_NOT_MEASURED').text, /200 dB ceiling/);
  assert.equal(q3.metrics.snrMedianDb, null);
  const q3v2 = assessQuality({ capture: check, transfer: t2 });
  assert.match(reason(q3v2, 'SNR_NOT_MEASURED').text, /no noise power in at least one band/);
});

test('B1: a NaN noise capture invalidates (NOISE_CAPTURE_INVALID), never NaN SNR', async () => {
  const r = await measure({ noiseSamples: (n) => Float32Array.from({ length: n },
    (_, i) => (i === 100 ? NaN : 1e-3)) });
  assert.equal(r.state, 'INVALID');
  assert.equal(r.reasons[0].code, 'NOISE_CAPTURE_INVALID');
});

// ----------------------------------------------------------------------------- M1

test('M1: the pooled SNR is the pooled power ratio, within 1 dB of the analytic truth', () => {
  // White noise σ in capture and noise check; known gain g. Truth per grid point:
  // g²·|X|²_band / (len(y)·σ²), pooled over 1/6 octave as a power mean (Pn is flat).
  const sr = 16000;
  const x = renderStimulus({ kind: 'log-sweep', sampleRate: sr, duration: 10, level: 0.25,
    f1: 20, f2: 7000, fade: 0.01 }).samples;
  const pre = 8000;
  const len = pre + x.length + 24000;
  const sigma = 0.01;
  const g = 0.02;
  const probe = [30, 45, 70, 100, 150];
  const acc = probe.map(() => ({ v1: 0, v2: 0 }));
  let truth = null;
  let f = null;
  const trials = 6;
  for (let k = 0; k < trials; k++) {
    const y = gaussian(10 + k, len, sigma);
    for (let i = 0; i < x.length; i++) y[pre + i] += g * x[i];
    const noise = gaussian(50 + k, sr, sigma); // a 1 s noise check
    const base = { stimulus: x, captured: y, sampleRate: sr, f1: 20, f2: 7000, noise };
    const t2 = computeTransfer(base);
    const t1 = computeTransfer({ ...base, options: { algorithm: TRANSFER_ALGORITHM_V1 } });
    f = t2.frequencies;
    if (!truth) {
      const dec = spectralDeconvolution({ ...base });
      const edge = 2 ** (1 / 96);
      const band = (ff) => {
        const a = Math.ceil(ff / edge / dec.binHz);
        const b = Math.ceil((ff * edge) / dec.binHz) - 1;
        let s = 0;
        for (let j = a; j <= b; j++) s += dec.xPow[j];
        return s / (b - a + 1);
      };
      truth = smoothFractionalOctave(f, Float64Array.from(f, (ff) =>
        10 * Math.log10((g * g * band(ff)) / (len * sigma * sigma))), 6);
    }
    const meanOfRatios = smoothFractionalOctave(f, t1.snrDb, 6); // quality v1/v2 pooling
    probe.forEach((hz, j) => {
      const i = f.findIndex((v) => v >= hz);
      acc[j].v1 += meanOfRatios[i] / trials;
      acc[j].v2 += t2.snrPooledDb[i] / trials;
    });
  }
  let bias1 = 0;
  probe.forEach((hz, j) => {
    const i = f.findIndex((v) => v >= hz);
    const err2 = acc[j].v2 - truth[i];
    assert.ok(Math.abs(err2) <= 1, `${hz} Hz: pooled ${acc[j].v2.toFixed(2)} vs truth `
      + `${truth[i].toFixed(2)} dB`);
    bias1 += (acc[j].v1 - truth[i]) / probe.length;
  });
  // The old pooling (mean of per-point ratios over one periodogram) was biased high.
  assert.ok(bias1 > 2, `v1/v2 mean-of-ratios bias ${bias1.toFixed(2)} dB`);
});

test('M1: points below 10/(0.1155·T_noise) are NOT ASSESSED, not reliable, cap USABLE',
  async () => {
    const r = await measure({}, { noiseCheckS: 1 });
    const q = r.quality;
    const fA = (T.minSnrObservations * SR) / (SR * 1 * SIXTH); // 1 s noise check
    assert.ok(Math.abs(q.metrics.snrAssessedFromHz - fA) < 1e-9);
    assert.ok(Math.abs(fA - 86.51) < 0.01, String(fA));
    assert.equal(q.metrics.snrResolutionHz, 1);
    const na = reason(q, 'SNR_NOT_ASSESSED');
    assert.equal(na.severity, 'warn');
    assert.equal(na.unit, 'Hz');
    assert.ok(na.range[1] < fA && na.range[0] === q.mask.frequencies[0]);
    assert.match(na.text, /^SNR not assessed below 87 Hz: the 1 s noise check gives fewer /);
    assert.match(na.text, /\(4\.4 s would assess from 20\.0 Hz\)$/);
    q.mask.frequencies.forEach((f, i) => { if (f < fA) assert.equal(q.mask.reliable[i], 0); });
    assert.equal(q.status, 'USABLE', 'NOT ASSESSED caps at USABLE, does not push to POOR');
    // A long enough check assesses everything.
    const r5 = await measure({}, { noiseCheckS: 5 });
    assert.ok(r5.quality.metrics.snrAssessedFromHz < 20);
    assert.ok(!codes(r5.quality).includes('SNR_NOT_ASSESSED'));
  });

// ----------------------------------------------------------------------------- M2

test('M2: input processing reported on → POOR; unconfirmed → USABLE; off/test → ok',
  async () => {
    const on = await measure({ applied: { echoCancellation: true, noiseSuppression: true,
      autoGainControl: false } });
    const p = reason(on.quality, 'INPUT_PROCESSING');
    assert.equal(p.severity, 'fail');
    assert.equal(p.value, 2);
    assert.match(p.text, /echo cancellation and noise suppression reported on/);
    assert.equal(on.quality.status, 'POOR');
    const unknown = await measure({ applied: { echoCancellation: false,
      noiseSuppression: false } });
    const u = reason(unknown.quality, 'INPUT_PROCESSING_NOT_CONFIRMED');
    assert.equal(u.severity, 'warn');
    assert.match(u.text, /automatic gain control not reported/);
    assert.equal(unknown.quality.status, 'USABLE');
    const none = await measure({ applied: null });
    assert.equal(reason(none.quality, 'INPUT_PROCESSING_NOT_CONFIRMED').value, null);
    assert.equal(none.quality.status, 'USABLE');
    const loop = await measure({ applied: null, testContext: { kind: 'digital-loopback',
      label: 'TEST CONTEXT' } });
    assert.equal(reason(loop.quality, 'INPUT_PROCESSING').severity, 'ok');
    assert.match(reason(loop.quality, 'INPUT_PROCESSING').text, /digital test context/);
    // Omitted by a direct caller: the rule is not applied.
    const t = on.transfer;
    assert.ok(!codes(assessQuality({ capture: on.captureChecks, transfer: t }))
      .some((c) => c.startsWith('INPUT_PROCESSING')));
    assert.throws(() => assessQuality({ capture: on.captureChecks, transfer: t,
      inputProcessing: 'on' }), TypeError);
  });

// ----------------------------------------------------------------------------- M8

const flatTop = (at, len, v = 0.999) => (s) => { for (let i = at; i < at + len; i++) s[i] = v; };

test('M8: run-level invalidation is limited to unusable captures', () => {
  assert.deepEqual([...RUN_INVALIDATING_CODES].sort(), ['BAD_SAMPLE_RATE', 'DROPOUT_IN_SWEEP',
    'EMPTY', 'FRAMES_MISSING', 'NON_FINITE', 'NO_INPUT', 'NO_SAMPLES']);
});

test('M8: one 4-sample flat top → CLIPPING warn (USABLE), not a discarded run', async () => {
  const r = await measure({ mutate: flatTop(30000, 4) });
  assert.equal(r.state, 'COMPLETE');
  assert.equal(r.runs.length, 2);
  assert.ok(r.captureChecks.every((c) => !c.invalid && c.reasons.some((x) =>
    x.code === 'CLIPPING')));
  const c = reason(r.quality, 'CLIPPING');
  assert.equal(c.severity, 'warn');
  // NIT: the region is named at its sweep frequency (aligned window starts at 12100).
  const hz = instantaneousFrequency(r.stimulus.spec, (30000 - 12100) / SR);
  assert.ok(hz > 250 && hz < 275, String(hz)); // 20 Hz · 1000^0.373 ≈ 263 Hz
  assert.match(c.text, /\(2 regions, at ≈ 26\d Hz of the sweep\) \(worst: run 1 of 2\)$/);
  assert.equal(r.quality.status, 'USABLE');
});

test('M8: sustained clipping (≥ 0.1 %) → CLIPPING fail (POOR), still COMPLETE', async () => {
  const mutate = (s) => { for (let k = 0; k < 30; k++) flatTop(14000 + k * 1500, 8)(s); };
  const r = await measure({ mutate });
  assert.equal(r.state, 'COMPLETE');
  const c = reason(r.quality, 'CLIPPING');
  assert.equal(c.severity, 'fail');
  assert.ok(c.value >= 0.1 && c.value < 1, String(c.value));
  assert.equal(r.quality.status, 'POOR');
});

test('M8: severe clipping (≥ 1 %) → INVALID through the assessment, all runs captured',
  async () => {
    const r = await measure({ gain: 8 });
    assert.equal(r.state, 'INVALID');
    assert.equal(r.runs.length, 2);
    assert.equal(r.reasons[0].code, 'CLIPPING_SEVERE');
  });

test('M8: dropouts: outside the sweep warn; certainly inside invalidates the run; inside the '
  + 'aligned window invalidates through quality', async () => {
  const zero = (a, b) => (s) => s.fill(0, a, b);
  const outside = await measure({ mutate: zero(70000, 71500) });
  assert.equal(outside.state, 'COMPLETE');
  assert.equal(reason(outside.quality, 'DROPOUT').severity, 'warn');
  const certain = await measure({ mutate: zero(40000, 41500) });
  assert.equal(certain.state, 'INVALID');
  assert.equal(certain.runs.length, 1, 'stopped at the first run');
  assert.equal(certain.reasons[0].code, 'DROPOUT_IN_SWEEP');
  assert.match(certain.reasons[0].text, /samples 36000-60000/);
  const aligned = await measure({ mutate: zero(20000, 21500) });
  assert.equal(aligned.runs.length, 2, 'not certain at run level (latency unknown)');
  assert.equal(aligned.state, 'INVALID');
  assert.ok(aligned.reasons.some((x) => x.code === 'DROPOUT_IN_SWEEP'));
});

test('M8: a discontinuity after the sweep warns (DISCONTINUITY), COMPLETE', async () => {
  const step = (s) => { for (let i = 75000; i < 84000; i++) s[i] += 0.05; };
  const r = await measure({ mutate: step });
  assert.equal(r.state, 'COMPLETE');
  assert.equal(reason(r.quality, 'DISCONTINUITY').severity, 'warn');
});

test('NIT: a rail peak without a 3-sample flat top → CLIPPING_NOT_EXCLUDED (USABLE)',
  async () => {
    const r = await measure({ mutate: (s) => { s[30000] = 0.99; s[30001] = -0.99; } });
    const c = reason(r.quality, 'CLIPPING_NOT_EXCLUDED');
    assert.equal(c.severity, 'warn');
    assert.equal(c.value, Math.fround(0.99));
    assert.ok(!codes(r.quality).includes('CLIPPING'));
    assert.equal(r.quality.status, 'USABLE');
  });

// ----------------------------------------------------------------------------- M5

test('M5: the IR noise floor matches σ²·Σ|X|²/D²/N, the v1 tail reads far below', () => {
  // Noise in h at a lag where the stimulus lies wholly inside the capture (Parseval):
  // var h = σ² · (1/N) · Σ_k |X[k]|² / (|X[k]|² + ε[k])² over all N bins.
  const x = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: 2, level: 0.25,
    f1: 20, f2: 20000, fade: 0.01 }).samples;
  const pre = 24000;
  const len = pre + x.length + 72000;
  const sigma = 1e-4;
  const capture = (seed) => {
    const y = gaussian(seed, len, sigma);
    for (let i = 0; i < x.length; i++) y[pre + 100 + i] += 0.5 * x[i];
    return y;
  };
  const y = capture(77);
  const args = { stimulus: x, captured: y, sampleRate: SR, f1: 20, f2: 20000,
    lagSamples: pre + 100 };
  const ir = computeImpulseResponse(args);
  const dec = spectralDeconvolution(args);
  let s = 0;
  for (let k = 0; k <= dec.half; k++) {
    const d = dec.xPow[k] + dec.eps[k];
    s += (k === 0 || k === dec.half ? 1 : 2) * (dec.xPow[k] / (d * d));
  }
  const peak = ir.samples[ir.peakIndex];
  const truthDb = 10 * Math.log10((sigma * sigma * s) / dec.fftSize / (peak * peak));
  assert.equal(ir.noiseFloorMethod, 'full-overlap-tail');
  // One estimate scatters by a few tenths of a dB (the tail is ~7000 samples of coloured
  // noise); the power mean over three noise seeds is within 0.5 dB of the truth.
  let p = 0;
  for (const seed of [77, 78, 79]) {
    const r = seed === 77 ? ir : computeImpulseResponse({ ...args, captured: capture(seed) });
    assert.ok(Math.abs(r.noiseFloorDb - truthDb) < 1.5, `seed ${seed}: ${r.noiseFloorDb}`);
    p += 10 ** (r.noiseFloorDb / 10) / 3;
  }
  assert.ok(Math.abs(10 * Math.log10(p) - truthDb) < 0.5,
    `${(10 * Math.log10(p)).toFixed(2)} vs truth ${truthDb.toFixed(2)} dB`);
  const v1 = computeImpulseResponse({ ...args, algorithm: IR_ALGORITHMS_V1.spectral });
  assert.equal(v1.algorithm, 'oscilla.ir.log-sweep.v1');
  assert.ok(!('noiseFloorMethod' in v1));
  assert.ok(v1.noiseFloorDb < truthDb - 20, `v1 ${v1.noiseFloorDb.toFixed(1)} dB`);
  const v2 = computeImpulseResponse({ ...args, algorithm: 'oscilla.ir.log-sweep.v2' });
  assert.deepEqual(v1.samples, v2.samples, 'v1 and v2 differ only in the noise floor');
  // v3 (V382) keeps a longer precursor; from v2's start on its samples are v2's
  const off = Math.round((v2.captureOffsetS - ir.captureOffsetS) * SR);
  assert.ok(off > 0);
  assert.deepEqual(ir.samples.subarray(off), v2.samples, 'v3 = v2 plus an earlier start');
  assert.equal(ir.noiseFloorDb, v2.noiseFloorDb);
  // No full-overlap lags after the peak (no post-roll): no floor, said so.
  const short = Float32Array.from(y.subarray(0, pre + 100 + x.length + 8));
  const none = computeImpulseResponse({ ...args, captured: short });
  assert.equal(none.noiseFloorDb, null);
  assert.equal(none.noiseFloorMethod, 'none');
  assert.throws(() => computeImpulseResponse({ ...args,
    algorithm: IR_ALGORITHMS_V1['farina-inverse'] }), RangeError);
});

// ----------------------------------------------------------------------------- m1

test('m1: masked smoothing does not leak across a mask edge; unmasked is unchanged', () => {
  const f = Float64Array.from({ length: 97 }, (_, i) => 100 * 2 ** (i / 24));
  const v = Float64Array.from(f, (hz) => (hz >= 1000 && hz < 2000 ? 20 : 0));
  const mask = Uint8Array.from(f, (hz) => (hz >= 1000 && hz < 2000 ? 0 : 1));
  const plain = smoothFractionalOctave(f, v, 3);
  assert.ok(plain.some((x, i) => mask[i] && x > 1), 'unmasked smoothing leaks +20 dB out');
  const masked = smoothFractionalOctave(f, v, 3, { mask });
  for (let i = 0; i < f.length; i++) {
    if (mask[i]) assert.equal(masked[i], 0, `${f[i]} Hz`);
    else assert.ok(Number.isNaN(masked[i]));
  }
  // Non-finite values are excluded too (NaN-aware), and fraction 0 keeps included values.
  const holes = Float64Array.from(v, (x, i) => (mask[i] ? x : NaN));
  assert.deepEqual(smoothFractionalOctave(f, holes, 3, { mask: new Uint8Array(f.length)
    .fill(1) }), masked);
  assert.deepEqual(smoothFractionalOctave(f, v, 0, { mask }), Float64Array.from(v, (x, i) =>
    (mask[i] ? x : NaN)));
  // Without a mask: bit-identical to the unmasked method.
  assert.deepEqual(smoothFractionalOctave(f, v, 3, {}), plain);
  const view = smoothResponse(f, v, 3, { mask });
  assert.equal(view.masked, true);
  assert.ok(!('masked' in smoothResponse(f, v, 3)));
  assert.throws(() => smoothFractionalOctave(f, v, 3, { mask: [1, 0] }), RangeError);
});

// ----------------------------------------------------------------------------- m2

test('m2: resolution = max(fs/N, 1/T_capture); SNR resolution = 1/T_noise', async () => {
  const r = await measure({}, { noiseCheckS: 2 });
  const t = r.runs[0].transfer;
  const frames = r.runs[0].frames;
  assert.equal(t.resolutionHz, Math.max(t.binHz, SR / frames));
  assert.ok(t.resolutionHz > t.binHz, 'zero padding claims more than the capture resolves');
  assert.equal(r.quality.metrics.resolutionHz, r.transfer.resolutionHz);
  assert.equal(r.quality.metrics.snrResolutionHz, 0.5);
  assert.equal(reason(r.quality, 'RESOLUTION').value, r.transfer.resolutionHz);
});

// ----------------------------------------------------------------------------- m9

test('m9: noise band levels use toneToMeanSquare (DC and Nyquist at 1/ENBW)', () => {
  const samples = gaussian(5, SR, 0.01);
  const s = summarizeNoise({ sampleRate: SR, samples });
  const w = welch(samples, { fftSize: 8192, overlap: 0.5, window: 'hann' });
  const ms = toneToMeanSquare(w.power, 'hann');
  const power = integrateBands(ms, SR / 8192, bandCenters('third', 20, 20000, SR));
  assert.deepEqual(s.bands.levelsDb, Array.from(power, (p) => 10 * Math.log10(p)));
  const direct = welch(samples, { fftSize: 8192, overlap: 0.5, window: 'hann',
    scale: 'mean-square' });
  for (let k = 0; k < ms.length; k++)
    assert.ok(Math.abs(ms[k] - direct.power[k]) <= 1e-12 * direct.power[k] + 1e-30, `bin ${k}`);
});
