// T017 (truth-table rows MSR-18, MSR-30): a frequency profile that covers none of the measured
// points corrects nothing (no extrapolation, ADR 0020), so it is no correction. The response
// view keeps RAW primary, badges UNCALIBRATED, summarises the RAW extremes and says the profile
// covers none of the measured range; the RTA band modes badge from the coverage mask exactly as
// the FFT mode does. Built from REAL pieces: a rendered 100 Hz-10 kHz log sweep through a
// pass-through with seeded noise (checkCapture, align, computeTransfer, assessQuality), real
// profiles (createFrequencyProfile, applyFrequencyCorrection) and the live RTA (createLiveRta).
//
// Negative cases: a partly covering profile keeps CALIBRATED plus the uncovered note; the FFT
// mode is unchanged; the stored result and an experiment's result hash do not change.
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderStimulus } from '../../src/js/measurement/stimulus.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import { align } from '../../src/js/measurement/align.js';
import { computeTransfer } from '../../src/js/measurement/transfer.js';
import { assessQuality } from '../../src/js/measurement/quality.js';
import { ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { createLiveRta } from '../../src/js/measurement/live-rta.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { applyFrequencyCorrection } from '../../src/js/calibration/interpolate.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import * as common from '../../src/js/measurement/views/common.js';
import { buildResponseView } from '../../src/js/measurement/views/response-chart.js';
import { buildRtaView } from '../../src/js/measurement/views/rta-chart.js';

const SR = 48000;
const F1 = 100;
const F2 = 10000;
const PRE = Math.round(0.25 * SR);
const POST = Math.round(0.5 * SR);
const DELAY = 240;
const SNR_DB = 40;
const CAL = 'CALIBRATED (frequency)';
const UNCAL_FREQ = 'UNCALIBRATED (frequency)';

function gaussian(seed, n, sigma) {
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    const m = sigma * Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/** One 100 Hz-10 kHz sweep through a pass-through (gain 0.5, a delay, seeded noise). */
const SWEEP = (() => {
  const stim = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: 1, f1: F1, f2: F2,
    level: 0.5 });
  const len = PRE + stim.samples.length + POST;
  const clean = new Float64Array(len);
  for (let i = 0; i < stim.samples.length; i++) clean[PRE + DELAY + i] = 0.5 * stim.samples[i];
  let p = 0;
  for (let i = 0; i < stim.samples.length; i++) p += clean[PRE + DELAY + i] ** 2;
  const sigma = Math.sqrt(p / stim.samples.length) / 10 ** (SNR_DB / 20);
  const noise = gaussian(11, len, sigma);
  const captured = Float32Array.from(clean, (x, i) => x + noise[i]);
  const noiseCapture = Float32Array.from(gaussian(12, len, sigma));
  const check = checkCapture({ sampleRate: SR, samples: captured, preRoll: 0.25, postRoll: 0.5,
    startedAt: 0 });
  const alignment = align(stim.samples, captured, SR, { maxLagS: 0.5 });
  const transfer = computeTransfer({ stimulus: stim.samples, captured, sampleRate: SR,
    f1: stim.spec.f1, f2: stim.spec.f2, noise: noiseCapture, alignment });
  return { stim, check, alignment, transfer };
})();
const T = SWEEP.transfer;

const HIGH = createFrequencyProfile({ name: 'Covers 12-16 kHz only',
  points: [[12000, 1], [16000, 2]] });
const ONE_POINT = createFrequencyProfile({ name: 'One point at 1 kHz', points: [[1000, 3]] });
const PARTLY = createFrequencyProfile({ name: 'Covers 1-16 kHz',
  points: [[1000, 0], [4000, 1], [16000, 2]] });
const ULTRA = createFrequencyProfile({ name: 'Covers 30-40 kHz only',
  points: [[30000, 1], [40000, 2]] });
const AUDIBLE = createFrequencyProfile({ name: 'Covers 100 Hz-8 kHz',
  points: [[100, 0.5], [1000, 0], [4000, 1], [8000, 2]] });

/** The engine-result shape (engine.js measure()) with `profile` applied, as the engine does. */
function resultWith(profile) {
  const frequency = profile ? { ...applyFrequencyCorrection(T.magnitudeDb, T.frequencies,
    profile), name: profile.name } : null;
  const quality = assessQuality({ capture: [SWEEP.check], transfer: T, aggregate: null,
    calibration: { frequency, level: null } });
  return { state: S.COMPLETE, sampleRate: SR, recipe: { stimulus: SWEEP.stim.spec, repeats: 1 },
    transfer: T, ir: null, aggregate: null, calibrated: { frequency, level: null }, quality };
}

/** A stored experiment of the sweep that names `profile` as its frequency calibration. */
function experimentWith(profile) {
  const quality = assessQuality({ capture: [SWEEP.check], transfer: T, aggregate: null,
    calibration: { frequency: null, level: null } });
  const recipe = schema.createRecipe({ stimulus: SWEEP.stim.spec, repeats: 1,
    analysis: { pointsPerOctave: 48 } });
  const created = schema.createExperiment({ recipe, now: '2026-10-29T10:00:00.000Z',
    id: schema.newExperimentId(Uint8Array.from({ length: 16 }, (_, i) => (i * 23 + 7) & 255)),
    name: 'T017 sweep', sampleRate: SR, calibration: { frequency: profile, level: null },
    algorithms: { transfer: T.algorithm, align: ALGORITHMS.align, quality: quality.algorithm } });
  const measured = schema.withResults(created, {
    startedAt: '2026-10-29T10:00:01.000Z',
    runs: [{ index: 0, alignment: { algorithm: SWEEP.alignment.algorithm,
      lagSamples: SWEEP.alignment.lagSamples, peakCorrelation: SWEEP.alignment.peakCorrelation,
      polarity: SWEEP.alignment.polarity } }],
    quality,
    results: { transfer: T, ir: null, rta: null, aggregate: null },
  });
  const c = hash.withConfigHash(measured, hash.configHash(measured));
  return hash.withResultHash(c, hash.resultHash(c));
}

/** "Frequency response (observed, uncalibrated): maximum … minimum …" of the RAW curve. */
function rawExtremesSummary(v, quality) {
  const f = v.x;
  const mask = quality.mask.reliable;
  let hi = -1;
  let lo = -1;
  for (let pass = 0; pass < 2 && lo < 0; pass++) {
    T.magnitudeDb.forEach((x, i) => {
      if ((pass === 0 && !mask[i]) || !common.isDrawable(x)) return;
      if (hi < 0 || x > T.magnitudeDb[hi]) hi = i;
      if (lo < 0 || x < T.magnitudeDb[lo]) lo = i;
    });
  }
  const binHz = T.resolutionHz > 0 ? T.resolutionHz : T.binHz;
  return `maximum ${common.ratioDbText(T.magnitudeDb[hi])} at `
    + `${common.gridFrequencyText(f, hi, binHz)}, minimum ${common.ratioDbText(T.magnitudeDb[lo])}`
    + ` at ${common.gridFrequencyText(f, lo, binHz)}`;
}

function assertNoCoverage(v, label) {
  assert.equal(v.primary, 'raw', `${label}: RAW is primary`);
  assert.ok(!v.badges.includes(CAL), `${label}: ${v.badges.join(' | ')}`);
  assert.ok(v.badges.includes('UNCALIBRATED'), `${label}: ${v.badges.join(' | ')}`);
  assert.ok(v.summary.startsWith('Frequency response (observed, uncalibrated): maximum'),
    `${label}: ${v.summary}`);
  assert.doesNotMatch(v.summary, /\(calibrated\)|no measured points/, label);
  assert.equal(v.markers.calibratedRange, null, label);
  assert.ok(v.series.every((s) => s.kind !== common.QUANTITY_KINDS.CALIBRATED
    && !/CALIBRATED/.test(s.label)), `${label}: no series claims CALIBRATED`);
  const note = v.notes.find((n) => /covers none of the measured range/.test(n));
  assert.ok(note, `${label}: ${v.notes.join(' | ')}`);
  assert.match(note, /no extrapolation/);
  assert.match(note, /RAW is shown, uncalibrated/);
  const r = v.readoutAt(1000);
  assert.equal(r.calibrated, false);
  assert.equal(r.corrected, 'not covered by the profile (uncalibrated)');
}

test('fixture: a 100 Hz-10 kHz sweep on a 319-point grid that neither profile covers', () => {
  assert.equal(T.frequencies.length, 319);
  assert.ok(T.frequencies[0] >= F1 && T.frequencies[T.frequencies.length - 1] <= F2);
  for (const p of [HIGH, ONE_POINT]) {
    const c = applyFrequencyCorrection(T.magnitudeDb, T.frequencies, p);
    assert.equal(c.covered.reduce((a, b) => a + b, 0), 0, p.name);
  }
});

test('response view: a profile covering no measured point reads UNCALIBRATED (MSR-18)', () => {
  for (const p of [HIGH, ONE_POINT]) {
    const r = resultWith(p);
    const v = buildResponseView(r);
    assertNoCoverage(v, p.name);
    const plain = buildResponseView(r, { useCalibration: false });
    assert.ok(v.summary.includes(rawExtremesSummary(v, r.quality)), v.summary);
    assert.equal(v.summary, plain.summary, 'the RAW summary, as without the profile');
    assert.match(v.notes.find((n) => /covers none/.test(n)), new RegExp(`"${p.name}"`));
    // A derived view of it is a derived view of OBSERVED, not of CALIBRATED.
    const sm = buildResponseView(r, { smoothing: 6 });
    assert.ok(!sm.badges.includes(CAL));
    assert.match(sm.series.find((s) => s.id === 'view').label, / · OBSERVED$/);
    assert.ok(!sm.series.some((s) => s.id === 'corrected'));
  }
});

test('response view from an experiment: the loaded uncovering profile reads UNCALIBRATED', () => {
  const e = experimentWith(ONE_POINT);
  assertNoCoverage(buildResponseView(e, { profile: ONE_POINT }), 'experiment');
});

test('response view: a partly covering profile keeps CALIBRATED and the uncovered note', () => {
  const r = resultWith(PARTLY);
  const v = buildResponseView(r);
  assert.equal(v.primary, 'corrected');
  assert.ok(v.badges.includes(CAL));
  assert.match(v.markers.calibratedRange.label,
    /^calibrated 1\.0+ kHz–\d.*, uncalibrated below 1\.0+ kHz \(no extrapolation\)$/);
  assert.ok(v.notes.includes(v.markers.calibratedRange.label));
  assert.ok(!v.notes.some((n) => /covers none/.test(n)));
  assert.match(v.summary, /^Frequency response \(calibrated\): maximum/);
  assert.equal(v.readoutAt(2000).calibrated, true);
  assert.equal(v.readoutAt(200).calibrated, false);
});

test('views never change the stored result or its hash', () => {
  const r = resultWith(HIGH);
  const before = structuredClone(r);
  buildResponseView(r);
  buildResponseView(r, { smoothing: 3, normalization: { mode: 'at-frequency', hz: 1000 } });
  assert.deepEqual(r, before);
  const e = experimentWith(ONE_POINT);
  const stored = structuredClone(e);
  buildResponseView(e, { profile: ONE_POINT });
  buildResponseView(e, { profile: ONE_POINT, smoothing: 6 });
  assert.deepEqual(e, stored);
  assert.equal(hash.resultHash(e), e.provenance.resultHash);
});

function liveView(profile, mode) {
  const live = createLiveRta({ sampleRate: SR, mode, averaging: 'instant', profile });
  const n = 8192;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * (i / SR) + 0.3);
  live.push(x, 0.016);
  return buildRtaView({ ...live.viewInput(), fixedRange: true });
}

test('live RTA band modes badge from the coverage mask, as FFT mode does (MSR-30)', () => {
  for (const mode of ['third', 'octave']) {
    const v = liveView(ULTRA, mode);
    assert.ok(v.badges.includes(UNCAL_FREQ), `${mode}: ${v.badges.join(' | ')}`);
    assert.ok(!v.badges.includes(CAL), `${mode}: ${v.badges.join(' | ')}`);
    assert.ok(v.bars.every((b) => !b.covered && b.kind !== common.QUANTITY_KINDS.CALIBRATED));
    assert.ok(v.notes.some((n) => /profile covers none of the bands/.test(n)
      && /no extrapolation/.test(n)), v.notes.join(' | '));
    assert.ok(!v.notes.some((n) => /Bands outside the frequency profile/.test(n)));
    // A covering profile still badges CALIBRATED and marks its uncovered bands.
    const c = liveView(AUDIBLE, mode);
    assert.ok(c.badges.includes(CAL), `${mode}: ${c.badges.join(' | ')}`);
    assert.ok(c.notes.some((n) => /Bands outside the frequency profile are uncorrected/.test(n)));
    assert.ok(!c.notes.some((n) => /covers none/.test(n)));
  }
  // FFT mode, unchanged: UNCALIBRATED without a covered bin, CALIBRATED with one.
  assert.ok(liveView(ULTRA, 'fft').badges.includes(UNCAL_FREQ));
  assert.ok(liveView(AUDIBLE, 'fft').badges.includes(CAL));
});
