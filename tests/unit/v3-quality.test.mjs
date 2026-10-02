// V3 measurement quality assessment (src/js/measurement/quality.js, spec §64-§71, §143,
// §156-§158, §220-§222; ADR 0025).
//
// Fixtures run through the real pipeline: renderStimulus() log sweep → a synthetic system
// (gain, RBJ-cookbook low-pass) plus seeded Gaussian noise → checkCapture() →
// computeTransfer() with a separate noise capture → aggregateRuns(). The expected statuses
// follow from the documented rules and from the noise levels chosen here:
//   σ = 1e-3   clean: median SNR ≈ 55 dB, every grid point reliable;
//   σ = 0.15   low SNR: the pink sweep sinks into white noise above ≈ 1.3 kHz (USABLE);
//   σ = 0.3    very low SNR: median below 10 dB (POOR).
// 1 s sweeps at 48 kHz keep the whole file well under a few seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStimulus } from '../../src/js/measurement/stimulus.js';
import {
  computeTransfer,
  VALID_MIN_SNR_DB,
  VALIDITY_SMOOTHING_FRACTION,
} from '../../src/js/measurement/transfer.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import { aggregateRuns } from '../../src/js/measurement/aggregate.js';
import { smoothFractionalOctave } from '../../src/js/measurement/smoothing.js';
import { ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import { formatFrequencyWithResolution } from '../../src/js/measurement/format.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { correctionCurve, coverage } from '../../src/js/calibration/interpolate.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import {
  assessQuality,
  summarizeQuality,
  maskRuns,
  maskRanges,
  QUALITY_THRESHOLDS,
  QUALITY_ALGORITHM,
  REASON_CODES,
  INVALIDATING_CODES,
} from '../../src/js/measurement/quality.js';

const SR = 48000;
const F1 = 20;
const F2 = 20000;
const PRE = Math.round(0.1 * SR);
const POST = Math.round(0.4 * SR);
const T = QUALITY_THRESHOLDS;

// ----------------------------------------------------------------------------- fixtures

const STIM = renderStimulus({
  kind: 'log-sweep', sampleRate: SR, duration: 1, f1: F1, f2: F2, level: 0.5,
}).samples;
const LEN = PRE + STIM.length + POST;

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

/** RBJ-cookbook second-order low-pass (Bristow-Johnson, Audio EQ Cookbook). */
function lowPass(x, fc, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 - c) / 2 / a0;
  const b1 = (1 - c) / a0;
  const a1 = (-2 * c) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** One measured run: system(placed sweep) + noise; transfer with a separate noise capture. */
function measure({ sigma = 1e-3, seed = 1, gainDb = 0, system = null, noise = true } = {}) {
  const placed = new Float32Array(LEN);
  const g = 10 ** (gainDb / 20);
  for (let i = 0; i < STIM.length; i++) placed[PRE + i] = g * STIM[i];
  const sys = system ? system(placed) : placed;
  const captured = gaussian(seed, LEN, sigma);
  for (let i = 0; i < LEN; i++) captured[i] += sys[i];
  const transfer = computeTransfer({
    stimulus: STIM, captured, sampleRate: SR, f1: F1, f2: F2,
    noise: noise ? gaussian(seed + 7919, LEN, sigma) : null,
  });
  return { transfer, check: checkCapture({ sampleRate: SR, samples: captured }) };
}

function repeated(gainsDb, sigma = 1e-3) {
  const runs = gainsDb.map((gainDb, i) => measure({ sigma, seed: 100 + i, gainDb }));
  return {
    runs,
    capture: runs.map((r) => r.check),
    transfer: runs[0].transfer,
    aggregate: aggregateRuns(runs.map((r) => r.transfer.magnitudeDb)),
  };
}

/** A sine of amplitude amp (hard-clipped to ±1) with an optional louder burst. */
function sineCapture({ amp = 0.5, burstAmp = 0, burstCycles = 0, f = 1000, seconds = 1 } = {}) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const burstStart = Math.round(n / 2);
  const burstEnd = burstStart + Math.round((burstCycles * SR) / f);
  for (let i = 0; i < n; i++) {
    const a = i >= burstStart && i < burstEnd ? burstAmp : amp;
    x[i] = Math.max(-1, Math.min(1, a * Math.sin((2 * Math.PI * f * i) / SR)));
  }
  return { sampleRate: SR, samples: x };
}

const CLEAN = repeated([0, 0, 0]);
const LOW = measure({ sigma: 0.15, seed: 5 });
const VERY_LOW = measure({ sigma: 0.3, seed: 6 });
const LOWPASS = measure({ seed: 77, system: (x) => lowPass(lowPass(x, 1000), 1000) });
const NO_NOISE = measure({ seed: 9, noise: false });

const byCode = (q, code) => q.reasons.filter((r) => r.code === code);
const one = (q, code) => {
  const list = byCode(q, code);
  assert.equal(list.length, 1, `expected exactly one ${code}, got ${list.length}`);
  return list[0];
};
const fmtAt = (q, hz) => {
  const ratio = q.mask.frequencies[1] / q.mask.frequencies[0];
  return formatFrequencyWithResolution(hz, Math.max(q.metrics.resolutionHz, hz * (ratio - 1)));
};

/** Every reason is complete and backed by a value; INVALID carries only failures. */
function assertWellFormed(q) {
  assert.equal(q.algorithm, ALGORITHMS.quality);
  assert.ok(['GOOD', 'USABLE', 'POOR', 'INVALID'].includes(q.status));
  assert.ok(q.reasons.length > 0, 'no status without reasons');
  for (const r of q.reasons) {
    const def = REASON_CODES[r.code];
    assert.ok(def, `unknown code ${r.code}`);
    assert.equal(r.scope, def.scope);
    assert.ok(['ok', 'warn', 'fail'].includes(r.severity));
    assert.equal(typeof r.text, 'string');
    assert.ok(r.text.length > 0);
    assert.ok(Object.hasOwn(r, 'value'), `${r.code} has no value`);
    assert.equal(typeof r.unit, 'string');
    assert.ok(r.unit.length > 0, `${r.code} has no unit`);
    if (r.severity === 'ok') assert.ok(Number.isFinite(r.value), `${r.code} ok needs a number`);
    if (r.value === null) {
      assert.notEqual(r.severity, 'ok');
      assert.match(r.text, /not measured|no |silence|not valid/);
    } else assert.ok(Number.isFinite(r.value), `${r.code} value ${r.value}`);
    if (r.range) {
      assert.equal(r.range.length, 2);
      assert.ok(r.range[0] <= r.range[1]);
    }
    assert.doesNotMatch(r.text, /confiden/i);
    if (def.invalidating) assert.equal(r.severity, 'fail');
  }
  const order = { fail: 0, warn: 1, ok: 2 };
  for (let i = 1; i < q.reasons.length; i++)
    assert.ok(order[q.reasons[i - 1].severity] <= order[q.reasons[i].severity], 'sorted');
  if (q.status === 'INVALID') {
    assert.ok(q.reasons.every((r) => r.severity === 'fail'));
    assert.ok(q.reasons.some((r) => REASON_CODES[r.code].invalidating));
    assert.ok(q.mask.reliable.every((v) => v === 0));
    assert.deepEqual(q.metrics.reliableRanges, []);
  }
  assert.equal(q.mask.reliable.length, q.mask.frequencies.length);
  assert.equal(q.mask.calibrated.length, q.mask.frequencies.length);
  const summary = summarizeQuality(q);
  assert.ok(summary.startsWith(`Measurement quality: ${q.status.toLowerCase()}.`), summary);
  assert.doesNotMatch(summary, /confiden/i);
  if (!q.metrics.levelCalibrated) {
    assert.doesNotMatch(summary, /SPL/);
    for (const r of q.reasons) assert.doesNotMatch(r.text, /SPL/, r.text);
  }
}

// ----------------------------------------------------------------------------- thresholds

test('thresholds are frozen, named, and consistent with transfer.js validity', () => {
  assert.equal(QUALITY_ALGORITHM, 'oscilla.confidence.v2');
  assert.ok(Object.isFrozen(QUALITY_THRESHOLDS));
  assert.ok(Object.isFrozen(REASON_CODES));
  for (const [k, v] of Object.entries(QUALITY_THRESHOLDS))
    assert.ok(Number.isFinite(v), `${k} must be a number`);
  assert.equal(T.reliableMinSnrDb, VALID_MIN_SNR_DB);
  assert.equal(T.snrUsableDb, VALID_MIN_SNR_DB);
  assert.equal(T.reliablePoolingFraction, VALIDITY_SMOOTHING_FRACTION);
  assert.ok(T.clipPoorRatio < T.clipInvalidRatio);
  assert.ok(T.snrUsableDb < T.snrGoodDb);
  assert.ok(T.repeatabilityGoodDb < T.repeatabilityUsableDb);
  assert.ok(T.coverageUsableFraction < T.coverageGoodFraction);
  for (const c of INVALIDATING_CODES) assert.equal(REASON_CODES[c].scope, 'quality');
  assert.ok(!INVALIDATING_CODES.includes('FREQUENCY_CALIBRATION'));
});

// ----------------------------------------------------------------------------- §143 cases

test('clean high-SNR repeated response is GOOD with matching reasons', () => {
  const q = assessQuality(CLEAN);
  assertWellFormed(q);
  assert.equal(q.status, 'GOOD');
  assert.equal(one(q, 'CLIPPING').text, 'no clipping');
  assert.equal(one(q, 'CLIPPING').value, 0);
  assert.equal(one(q, 'DROPOUT').severity, 'ok');
  const snr = one(q, 'SNR_MEDIAN');
  assert.equal(snr.severity, 'ok');
  assert.ok(q.metrics.snrMedianDb > 40, `median SNR ${q.metrics.snrMedianDb}`);
  assert.equal(snr.value, q.metrics.snrMedianDb);
  assert.equal(snr.text, `${Math.round(snr.value)} dB median SNR`);
  const rep = one(q, 'REPEATABILITY');
  assert.equal(rep.severity, 'ok');
  assert.equal(rep.value, CLEAN.aggregate.repeatabilityDb);
  assert.match(rep.text, /^3 runs agree within ±0\.1 dB \(median standard deviation/);
  const cov = one(q, 'COVERAGE');
  assert.equal(cov.severity, 'ok');
  assert.deepEqual(cov.range, CLEAN.transfer.validRange);
  assert.equal(one(q, 'RESOLUTION').value, CLEAN.transfer.binHz);
  assert.equal(q.metrics.clippingRatio, 0);
  assert.equal(q.metrics.dropouts, 0);
  assert.equal(q.metrics.runs, 3);
  assert.deepEqual(q.metrics.coverage, CLEAN.transfer.validRange);
  assert.equal(q.metrics.reliableRanges.length, 1);
  assert.equal(q.metrics.reliableRanges[0][0], F1);
  assert.ok(q.metrics.reliableRanges[0][1] > 19000);
  assert.ok(q.metrics.snrMinDb >= T.reliableMinSnrDb);
  // Calibration is reported beside the status, never folded into it.
  assert.equal(one(q, 'FREQUENCY_CALIBRATION').severity, 'warn');
  assert.equal(one(q, 'LEVEL_CALIBRATION').severity, 'warn');
  const s = summarizeQuality(q);
  assert.match(s,
    /^Measurement quality: good\. \d+ dB median SNR; reliable 20\.0 Hz-.+ kHz; uncalibrated\.$/);
});

test('low-SNR response is USABLE and names the band lost in the noise', () => {
  const q = assessQuality({ capture: LOW.check, transfer: LOW.transfer });
  assertWellFormed(q);
  assert.equal(q.status, 'USABLE');
  const snr = one(q, 'SNR_MEDIAN');
  assert.equal(snr.severity, 'warn');
  assert.ok(snr.value >= T.snrUsableDb && snr.value < T.snrGoodDb, `SNR ${snr.value}`);
  assert.match(snr.text, /^\d+\.\d dB median SNR \(GOOD needs ≥ 20 dB\)$/);
  const bands = byCode(q, 'LOW_SNR_BAND');
  assert.ok(bands.length >= 1);
  const top = bands[bands.length - 1];
  assert.equal(top.severity, 'warn');
  assert.ok(top.range[0] > 500 && top.range[0] < 5000, `band starts at ${top.range[0]}`);
  assert.ok(top.range[1] > 19000);
  assert.ok(top.value < T.reliableMinSnrDb);
  assert.ok(top.text.startsWith(`${fmtAt(q, top.range[0])}-${fmtAt(q, top.range[1])} `), top.text);
  assert.match(top.text, /above the noise floor/);
  // The named band is exactly an unreliable range of the mask.
  assert.ok(q.metrics.unreliableRanges.some(([lo, hi]) =>
    lo === top.range[0] && hi === top.range[1]));
  assert.equal(one(q, 'COVERAGE').severity, 'warn');
  assert.equal(one(q, 'REPEATABILITY_NOT_MEASURED').value, 1);
  const s = summarizeQuality(q);
  assert.match(s, /^Measurement quality: usable\. \d+\.\d dB median SNR; reliable /);
  assert.match(s, /Main issue: /);
});

test('very low SNR is POOR with a failing SNR reason', () => {
  const q = assessQuality({ capture: VERY_LOW.check, transfer: VERY_LOW.transfer });
  assertWellFormed(q);
  assert.equal(q.status, 'POOR');
  const snr = one(q, 'SNR_MEDIAN');
  assert.equal(snr.severity, 'fail');
  assert.ok(snr.value < T.snrUsableDb);
  assert.match(snr.text, /below the 10 dB minimum for USABLE/);
});

test('severely clipped sine is INVALID with the clipping values of checkCapture', () => {
  const check = checkCapture(sineCapture({ amp: 1.5 }));
  assert.ok(check.clipping.ratio >= T.clipInvalidRatio);
  const q = assessQuality({ capture: check, transfer: CLEAN.transfer });
  assertWellFormed(q);
  assert.equal(q.status, 'INVALID');
  const r = one(q, 'CLIPPING_SEVERE');
  assert.equal(r.value, check.clipping.ratio * 100);
  assert.equal(r.unit, '%');
  const nr = check.clipping.regions.length;
  assert.ok(r.text.includes(`(${nr} region${nr === 1 ? '' : 's'})`), r.text);
  assert.equal(q.metrics.clippingRatio, check.clipping.ratio);
  assert.equal(q.metrics.clippingRegions, check.clipping.regions.length);
  // No passing reason is offered for a meaningless result.
  assert.equal(byCode(q, 'SNR_MEDIAN').length, 0);
  assert.match(summarizeQuality(q), /^Measurement quality: invalid\. severe clipping at /);
});

test('mild clipping warns, sustained clipping fails (POOR), each with its values', () => {
  const mild = checkCapture(sineCapture({ burstAmp: 1.2, burstCycles: 2 }));
  assert.ok(mild.clipping.ratio > 0 && mild.clipping.ratio < T.clipPoorRatio);
  const qm = assessQuality({ ...CLEAN, capture: [mild, CLEAN.capture[1], CLEAN.capture[2]] });
  assertWellFormed(qm);
  assert.equal(qm.status, 'USABLE');
  const rm = one(qm, 'CLIPPING');
  assert.equal(rm.severity, 'warn');
  assert.equal(rm.value, mild.clipping.ratio * 100);
  assert.equal(rm.text,
    `clipping at ${Number((mild.clipping.ratio * 100).toPrecision(2))} % of samples ` +
      `(${mild.clipping.regions.length} region${mild.clipping.regions.length === 1 ? '' : 's'})` +
      ' (worst: run 1 of 3)');

  const sustained = checkCapture(sineCapture({ burstAmp: 1.2, burstCycles: 20 }));
  assert.ok(sustained.clipping.ratio >= T.clipPoorRatio);
  assert.ok(sustained.clipping.ratio < T.clipInvalidRatio);
  const qs = assessQuality({ ...CLEAN, capture: sustained });
  assertWellFormed(qs);
  assert.equal(qs.status, 'POOR');
  assert.equal(one(qs, 'CLIPPING').severity, 'fail');
});

test('high-variance runs give a repeatability warn (±2 dB) or fail (±4 dB)', () => {
  const warn = repeated([0, 2, -2]);
  const q = assessQuality(warn);
  assertWellFormed(q);
  assert.equal(q.status, 'USABLE');
  const r = one(q, 'REPEATABILITY');
  assert.equal(r.severity, 'warn');
  assert.ok(Math.abs(r.value - 2) < 0.05, `repeatability ${r.value}`);
  assert.equal(r.value, q.metrics.repeatabilityDb);
  assert.match(r.text, /^3 runs differ by ±2\.0 dB/);

  const fail = repeated([0, 4, -4]);
  const qf = assessQuality(fail);
  assertWellFormed(qf);
  assert.equal(qf.status, 'POOR');
  assert.equal(one(qf, 'REPEATABILITY').severity, 'fail');
});

test('missing calibration: reasons say uncalibrated, levelCalibrated false, never SPL', () => {
  const q = assessQuality({ ...CLEAN, calibration: { frequency: null, level: null } });
  assertWellFormed(q);
  assert.equal(q.metrics.levelCalibrated, false);
  assert.equal(q.metrics.frequencyCalibrated, false);
  assert.equal(q.metrics.calibratedRange, null);
  assert.ok(q.mask.calibrated.every((v) => v === 0));
  for (const code of ['FREQUENCY_CALIBRATION', 'LEVEL_CALIBRATION']) {
    const r = one(q, code);
    assert.equal(r.severity, 'warn');
    assert.equal(r.scope, 'calibration');
    assert.match(r.text, /uncalibrated/);
  }
  assert.match(one(q, 'LEVEL_CALIBRATION').text, /dB relative/);
  const s = summarizeQuality(q);
  assert.match(s, /uncalibrated\.$/);
  assert.doesNotMatch(JSON.stringify(q.reasons) + s, /SPL/);
});

test('valid level calibration is reported with its offset; only then may SPL appear', () => {
  const level = createLevelCalibration({
    referenceHz: 1000, referenceDbSpl: 94, observedDbRelative: -30.5,
    createdAt: '2026-10-02T00:00:00Z',
  });
  const q = assessQuality({ ...CLEAN, calibration: { frequency: null, level } });
  assertWellFormed(q);
  assert.equal(q.metrics.levelCalibrated, true);
  const r = one(q, 'LEVEL_CALIBRATION');
  assert.equal(r.severity, 'ok');
  assert.equal(r.value, 124.5);
  assert.match(r.text, /offset \+124\.5 dB from a 94\.0 dB SPL reference at 1\.000 kHz/);
  assert.match(summarizeQuality(q), /no microphone calibration, level calibrated/);
  // A tampered calibration is not valid and is not labelled SPL.
  const bad = assessQuality({ ...CLEAN, calibration: { level: { ...level, offsetDb: 99 } } });
  assert.equal(bad.metrics.levelCalibrated, false);
  assert.match(one(bad, 'LEVEL_CALIBRATION').text, /not valid: uncalibrated/);
});

test('calibrated mask respects profile coverage (20 Hz-16 kHz: uncalibrated above)', () => {
  const profile = createFrequencyProfile({ points: [[20, 1], [1000, 0], [16000, 2]] });
  const f = CLEAN.transfer.frequencies;
  const { covered } = correctionCurve(profile, f);
  const q = assessQuality({
    ...CLEAN, calibration: { frequency: { covered, coverage: coverage(profile) } },
  });
  assertWellFormed(q);
  assert.deepEqual(Array.from(q.mask.calibrated), Array.from(covered));
  for (let i = 0; i < f.length; i++) assert.equal(q.mask.calibrated[i], f[i] <= 16000 ? 1 : 0);
  assert.equal(q.metrics.frequencyCalibrated, false);
  const last = f.findLast((x) => x <= 16000);
  assert.deepEqual(q.metrics.calibratedRange, [20, last]);
  const r = one(q, 'FREQUENCY_CALIBRATION');
  assert.equal(r.severity, 'warn');
  assert.deepEqual(r.range, [20, last]);
  assert.equal(r.text, `microphone calibration covers ${fmtAt(q, 20)}-${fmtAt(q, last)}; ` +
    'uncalibrated above');
  assert.ok(r.value > 90 && r.value < 100);
  assert.equal(q.status, 'GOOD', 'calibration coverage never changes the status');
  // The calibrated range is stated on the grid: its last point at or below 16 kHz.
  assert.ok(summarizeQuality(q).endsWith(
    `; microphone calibrated ${fmtAt(q, 20)}-${fmtAt(q, last)} only, levels relative.`));

  // Same result from the coverage range alone (covered on another grid).
  const byRange = assessQuality({
    ...CLEAN, calibration: { frequency: { covered: new Uint8Array(3), coverage: [20, 16000] } },
  });
  assert.deepEqual(Array.from(byRange.mask.calibrated), Array.from(covered));

  // A profile spanning the whole reliable range calibrates it.
  const full = createFrequencyProfile({ points: [[10, 0], [24000, 0]] });
  const qf = assessQuality({
    ...CLEAN, calibration: { frequency: correctionCurve(full, f), level: null },
  });
  assert.equal(qf.metrics.frequencyCalibrated, true);
  assert.equal(one(qf, 'FREQUENCY_CALIBRATION').severity, 'ok');
  assert.equal(one(qf, 'FREQUENCY_CALIBRATION').value, 100);
});

test('partial frequency coverage warns with the actual valid range', () => {
  const q = assessQuality({ capture: LOWPASS.check, transfer: LOWPASS.transfer });
  assertWellFormed(q);
  const vr = LOWPASS.transfer.validRange;
  assert.ok(vr[1] > 1000 && vr[1] < 10000, `valid range ends at ${vr[1]}`);
  const r = one(q, 'COVERAGE');
  assert.equal(r.severity, 'warn');
  assert.deepEqual(r.range, vr);
  assert.deepEqual(q.metrics.coverage, vr);
  const fraction = Math.log2(vr[1] / vr[0]) / Math.log2(F2 / F1);
  assert.ok(Math.abs(q.metrics.coverageFraction - fraction) < 1e-12);
  assert.ok(Math.abs(r.value - 100 * fraction) < 1e-9);
  assert.match(r.text, new RegExp(`^valid range ${fmtAt(q, vr[0])}-${fmtAt(q, vr[1])} covers ` +
    `${Math.floor(100 * fraction)} % of the octaves requested \\(20\\.0 Hz-20\\.0 kHz\\)`));
  assert.equal(q.status, 'USABLE');
  assert.ok(byCode(q, 'LOW_SNR_BAND').some((b) => b.range[1] > 19000));
});

test('requested range above Nyquist is reported, never truncated silently', () => {
  const sr = 32000;
  const stim = renderStimulus({
    kind: 'log-sweep', sampleRate: sr, duration: 1, f1: 20, f2: 15000, level: 0.5,
  }).samples;
  const y = gaussian(3, stim.length + sr, 1e-3);
  for (let i = 0; i < stim.length; i++) y[i + 1000] += stim[i];
  const transfer = computeTransfer({
    stimulus: stim, captured: y, sampleRate: sr, f1: 20, f2: 15000,
    noise: gaussian(4, stim.length + sr, 1e-3),
  });
  const q = assessQuality({
    capture: checkCapture({ sampleRate: sr, samples: y }), transfer, requestedRange: [20, 20000],
  });
  assertWellFormed(q);
  assert.deepEqual(q.metrics.requestedRange, [20, 20000]);
  assert.match(one(q, 'COVERAGE').text, /above 16\.0 kHz \(Nyquist\) nothing can be measured/);
});

test('empty capture, digital silence and missing capture checks are INVALID', () => {
  const none = assessQuality({
    capture: checkCapture({ sampleRate: SR, samples: new Float32Array(0) }),
  });
  assertWellFormed(none);
  assert.equal(none.status, 'INVALID');
  assert.equal(one(none, 'NO_SAMPLES').value, 1);

  const silent = assessQuality({
    capture: checkCapture({ sampleRate: SR, samples: new Float32Array(SR) }),
  });
  assertWellFormed(silent);
  assert.equal(silent.status, 'INVALID');
  const r = one(silent, 'NO_SIGNAL');
  assert.equal(r.value, null);
  assert.match(r.text, /digital silence/);

  const quiet = checkCapture(sineCapture({ amp: 1e-5 }));
  const qq = assessQuality({ capture: quiet });
  assert.equal(qq.status, 'INVALID');
  const rq = one(qq, 'NO_SIGNAL');
  assert.ok(Math.abs(rq.value - 20 * Math.log10(quiet.rms)) < 1e-9);
  assert.equal(rq.unit, 'dB relative (dBFS-like)');
  assert.match(rq.text, /below −90\.0 dB relative \(dBFS-like\)/);

  const missing = assessQuality({ transfer: CLEAN.transfer });
  assertWellFormed(missing);
  assert.equal(missing.status, 'INVALID');
  one(missing, 'CAPTURE_MISSING');
  assert.match(summarizeQuality(missing), /^Measurement quality: invalid\. no capture checks/);
});

test('dropout inside the sweep invalidates; outside the sweep window it warns', () => {
  const x = gaussian(11, SR, 0.05);
  x.fill(0, 30000, 31500); // 31 ms constant run inside the capture
  const check = checkCapture({ sampleRate: SR, samples: x });
  assert.equal(check.dropouts.length, 1);
  const inside = assessQuality({ ...CLEAN, capture: check });
  assertWellFormed(inside);
  assert.equal(inside.status, 'INVALID');
  assert.equal(one(inside, 'DROPOUT_IN_SWEEP').value, 1);
  const windowed = assessQuality({ ...CLEAN, capture: check, sweepWindow: [24000, 29000] });
  assertWellFormed(windowed);
  assert.equal(windowed.status, 'USABLE');
  assert.equal(one(windowed, 'DROPOUT').severity, 'warn');
  const covering = assessQuality({ ...CLEAN, capture: check, sweepWindow: [[0, SR]] });
  assert.equal(covering.status, 'INVALID');
});

test('non-finite analysis output and an empty valid range are INVALID', () => {
  const t = CLEAN.transfer;
  const magnitudeDb = Float64Array.from(t.magnitudeDb);
  magnitudeDb[10] = NaN;
  const q = assessQuality({ ...CLEAN, transfer: { ...t, magnitudeDb } });
  assertWellFormed(q);
  assert.equal(q.status, 'INVALID');
  const r = one(q, 'NON_FINITE_ANALYSIS');
  assert.equal(r.value, 1);
  assert.equal(r.unit, 'points');

  const snrDb = Float64Array.from(t.snrDb);
  snrDb[0] = Infinity;
  assert.equal(assessQuality({ ...CLEAN, transfer: { ...t, snrDb } }).status, 'INVALID');

  const centreDb = Float64Array.from(CLEAN.aggregate.centreDb);
  centreDb[3] = NaN;
  const qa = assessQuality({ ...CLEAN, aggregate: { ...CLEAN.aggregate, centreDb } });
  assert.equal(qa.status, 'INVALID');

  const qv = assessQuality({ ...CLEAN, transfer: { ...t, validRange: null } });
  assertWellFormed(qv);
  assert.equal(qv.status, 'INVALID');
  assert.equal(one(qv, 'NO_VALID_RANGE').value, 0);
});

test('without a noise capture SNR is NOT MEASURED and reliability is the valid range', () => {
  const q = assessQuality({ capture: NO_NOISE.check, transfer: NO_NOISE.transfer });
  assertWellFormed(q);
  assert.equal(q.status, 'USABLE');
  const r = one(q, 'SNR_NOT_MEASURED');
  assert.equal(r.value, null);
  assert.equal(q.metrics.snrMedianDb, null);
  assert.deepEqual(q.metrics.reliableRanges, [NO_NOISE.transfer.validRange]);
  assert.match(summarizeQuality(q), /SNR not measured/);
});

test('RTA-only assessment: no transfer, resolution judged against the requested range', () => {
  const q = assessQuality({
    capture: checkCapture(sineCapture()), requestedRange: [20, 20000], resolutionHz: SR / 8192,
  });
  assertWellFormed(q);
  assert.equal(q.mask.frequencies.length, 0);
  one(q, 'SNR_NOT_MEASURED');
  const r = one(q, 'RESOLUTION');
  assert.equal(r.severity, 'warn');
  assert.equal(r.value, SR / 8192);
  assert.match(r.text, /^frequency resolution 5\.9 Hz is coarser than 1\/6 octave below /);
  assert.equal(q.metrics.resolutionHz, SR / 8192);
  assert.equal(q.status, 'USABLE');
});

// ----------------------------------------------------------------------------- masks

test('maskRuns / maskRanges return contiguous inclusive runs', () => {
  const m = Uint8Array.from([0, 1, 1, 0, 1, 0, 0, 1, 1, 1]);
  assert.deepEqual(maskRuns(m), [[1, 2], [4, 4], [7, 9]]);
  const f = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.deepEqual(maskRanges(f, m), [[20, 30], [50, 50], [80, 100]]);
  assert.deepEqual(maskRuns(new Uint8Array(4)), []);
  assert.deepEqual(maskRuns(Uint8Array.from([1, 1])), [[0, 1]]);
});

test('reliable mask is the pooled SNR test; ranges partition the grid', () => {
  for (const fx of [CLEAN, LOW, VERY_LOW, LOWPASS]) {
    const q = assessQuality({ capture: fx.capture || fx.check, transfer: fx.transfer });
    const f = fx.transfer.frequencies;
    const pooled = smoothFractionalOctave(f, fx.transfer.snrDb, T.reliablePoolingFraction);
    for (let i = 0; i < f.length; i++)
      assert.equal(q.mask.reliable[i], pooled[i] >= T.reliableMinSnrDb ? 1 : 0, `point ${i}`);
    assert.deepEqual(q.metrics.reliableRanges, maskRanges(f, q.mask.reliable));
    const all = [...q.metrics.reliableRanges, ...q.metrics.unreliableRanges]
      .sort((a, b) => a[0] - b[0]);
    assert.equal(all[0][0], f[0]);
    assert.equal(all[all.length - 1][1], f[f.length - 1]);
    for (let k = 1; k < all.length; k++) {
      const prev = f.indexOf(all[k - 1][1]);
      assert.equal(f[prev + 1], all[k][0], 'ranges are adjacent and disjoint');
    }
  }
});

// ----------------------------------------------------------------------------- purity

function snapshot(value) {
  return structuredClone(value);
}

test('inputs are not mutated and the output is deterministic', () => {
  const profile = createFrequencyProfile({ points: [[20, 1], [16000, 2]] });
  const input = {
    ...repeated([0, 1, -1]),
    calibration: {
      frequency: { ...correctionCurve(profile, CLEAN.transfer.frequencies), coverage: [20, 16000] },
      level: null,
    },
  };
  delete input.runs;
  const before = snapshot(input);
  const a = assessQuality(input);
  const b = assessQuality(input);
  assert.deepEqual(snapshot(input), before);
  assert.deepEqual(a, b);
  assert.equal(summarizeQuality(a), summarizeQuality(b));
  assert.notEqual(a.mask.frequencies, input.transfer.frequencies, 'grid is copied');
  assert.throws(() => assessQuality({ capture: { samples: [] } }), TypeError);
  assert.throws(() => assessQuality({ capture: CLEAN.capture, transfer: { frequencies: [1] } }),
    TypeError);
});
