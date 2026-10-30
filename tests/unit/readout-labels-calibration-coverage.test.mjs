// T017 (truth table MSR-18, MSR-30): a frequency profile that covers NONE of the measured points
// is no correction. The response view and the RTA band view badge CALIBRATED (frequency) only
// when at least one grid point or band is inside the profile's coverage (ADR 0020: never
// extrapolated); otherwise RAW is primary, the badge reads UNCALIBRATED, the summary gives the
// RAW extremes and a note says the profile covers none of the measured points.
//
// Real pieces only: a rendered 100 Hz-10 kHz log sweep through a delayed, scaled path with
// seeded noise -> align -> computeTransfer (48 points per octave: 319 grid points) ->
// applyFrequencyCorrection and assessQuality, as engine.js applyCalibration builds
// result.calibrated.frequency; the live RTA from live-rta.js with a 30-40 kHz profile.
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderStimulus } from '../../src/js/measurement/stimulus.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import { align } from '../../src/js/measurement/align.js';
import { computeTransfer } from '../../src/js/measurement/transfer.js';
import { assessQuality } from '../../src/js/measurement/quality.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { applyFrequencyCorrection } from '../../src/js/calibration/interpolate.js';
import { createLiveRta, LIVE_RTA_FFT_SIZE } from '../../src/js/measurement/live-rta.js';
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
const CAL = 'CALIBRATED (frequency)';
const UNCAL = `${common.UNAVAILABLE.UNCALIBRATED} (frequency)`;

/** One measured run: the transfer and the capture check of a real sweep. */
const MEASURED = (() => {
  const stim = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: 1, f1: F1, f2: F2,
    level: 0.5 });
  const len = PRE + stim.samples.length + POST;
  const rng = mulberry32(17);
  const noise = () => (rng() - 0.5) * 1e-3;
  const captured = new Float32Array(len);
  for (let i = 0; i < len; i++) captured[i] = noise();
  for (let i = 0; i < stim.samples.length; i++) captured[PRE + DELAY + i] += 0.5 * stim.samples[i];
  const noiseCapture = Float32Array.from({ length: len }, noise);
  const check = checkCapture({ sampleRate: SR, samples: captured, preRoll: 0.25, postRoll: 0.5,
    startedAt: 0 });
  const alignment = align(stim.samples, captured, SR, { maxLagS: 0.5 });
  const transfer = computeTransfer({ stimulus: stim.samples, captured, sampleRate: SR,
    f1: stim.spec.f1, f2: stim.spec.f2, noise: noiseCapture, alignment });
  return { stim, check, transfer };
})();

/** The engine-result shape (engine.js measure / applyCalibration) with `profile` applied. */
function resultWith(profile) {
  const t = MEASURED.transfer;
  const frequency = profile ? { ...applyFrequencyCorrection(t.magnitudeDb, t.frequencies,
    profile), name: profile.name } : null;
  const quality = assessQuality({ capture: [MEASURED.check], transfer: t,
    calibration: { frequency, level: null } });
  return { state: S.COMPLETE, sampleRate: SR, recipe: { stimulus: MEASURED.stim.spec,
    repeats: 1 }, transfer: t, ir: null, aggregate: null,
  calibrated: { frequency, level: null }, quality };
}

const OUT_OF_RANGE = createFrequencyProfile({ name: 'Treble-only microphone',
  points: [[12000, 1], [16000, 2]] });
const ONE_POINT = createFrequencyProfile({ name: 'One-point microphone', points: [[1000, 3]] });
const PARTIAL = createFrequencyProfile({ name: 'Partial microphone',
  points: [[200, 0.5], [1000, 0], [4000, 1]] });

/** Highest and lowest drawable RAW points over the reliable mask (the summary's statistic). */
function rawExtremes(r) {
  const f = r.transfer.frequencies;
  const raw = r.transfer.magnitudeDb;
  const mask = r.quality.mask.reliable;
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < f.length; i++) {
    if (!mask[i] || !common.isDrawable(raw[i])) continue;
    if (hi < 0 || raw[i] > raw[hi]) hi = i;
    if (lo < 0 || raw[i] < raw[lo]) lo = i;
  }
  return { lo, hi };
}

test('fixture: the 100 Hz-10 kHz sweep has 319 grid points; the profiles cover none', () => {
  const f = MEASURED.transfer.frequencies;
  assert.equal(f.length, 319);
  for (const p of [OUT_OF_RANGE, ONE_POINT]) {
    const c = applyFrequencyCorrection(MEASURED.transfer.magnitudeDb, f, p);
    assert.equal(c.covered.reduce((a, b) => a + b, 0), 0, `${p.name} covers no point`);
  }
});

for (const [what, profile, span] of [['a 12-16 kHz profile', OUT_OF_RANGE, '12.0 kHz–16.0 kHz'],
  ['a one-point 1 kHz profile', ONE_POINT, 'a single point at 1.00 kHz']]) {
  test(`response view: ${what} covering no measured point is UNCALIBRATED`, () => {
    const r = resultWith(profile);
    const v = buildResponseView(r);
    assert.ok(!v.badges.includes(CAL), v.badges.join(' | '));
    assert.ok(v.badges.includes(common.UNAVAILABLE.UNCALIBRATED), v.badges.join(' | '));
    assert.equal(v.primary, 'raw', 'RAW is the primary curve');
    assert.equal(v.series.find((s) => s.id === 'corrected'), undefined, 'no CALIBRATED curve');
    assert.equal(v.markers.calibratedRange, null);
    // The summary gives the RAW extremes, labelled observed and uncalibrated.
    assert.ok(v.summary.startsWith('Frequency response (observed, uncalibrated): maximum '),
      v.summary);
    const { lo, hi } = rawExtremes(r);
    const f = r.transfer.frequencies;
    const binHz = r.transfer.resolutionHz > 0 ? r.transfer.resolutionHz : r.transfer.binHz;
    assert.ok(v.summary.includes(`maximum ${common.ratioDbText(r.transfer.magnitudeDb[hi])} at `
      + `${common.gridFrequencyText(f, hi, binHz)}, minimum `
      + `${common.ratioDbText(r.transfer.magnitudeDb[lo])} at `
      + `${common.gridFrequencyText(f, lo, binHz)}`), v.summary);
    assert.doesNotMatch(v.summary, /no measured points/);
    // The note says why: the profile covers none of the measured points (no extrapolation).
    // It never says the profile lies outside the range: the 1 kHz point is inside it.
    const note = v.notes.find((t) => /covers none of the 319 measured points \(100 Hz–/.test(t));
    assert.ok(note, v.notes.join('\n'));
    assert.ok(note.includes(`"${profile.name}" (${span}) covers`), note);
    assert.match(note, /no extrapolation/);
    // The cursor never reads a CALIBRATED value.
    const at = v.readoutAt(1000);
    assert.equal(at.calibrated, false);
    assert.match(at.corrected, /not covered/);
    // Smoothing still draws the RAW-derived view (no coverage region empties it).
    const sm = buildResponseView(r, { smoothing: 1 / 3 });
    assert.ok(!sm.badges.includes(CAL));
    assert.ok(sm.series.find((s) => s.id === 'view').values.some((x) => x !== null));
  });
}

test('response view: a partly covering profile keeps CALIBRATED and the uncovered note', () => {
  const v = buildResponseView(resultWith(PARTIAL));
  assert.ok(v.badges.includes(CAL));
  assert.equal(v.primary, 'corrected');
  assert.match(v.markers.calibratedRange.label, /^calibrated 200 Hz–4\.0+ kHz, uncalibrated below/);
  assert.ok(v.notes.includes(v.markers.calibratedRange.label));
  assert.ok(!v.notes.some((t) => /covers none of the \d+ measured points/.test(t)));
  assert.match(v.summary, /^Frequency response \(calibrated\): maximum /);
});

test('response view: the stored result is not changed by building the view', () => {
  const r = resultWith(OUT_OF_RANGE);
  const before = JSON.stringify(r, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x));
  buildResponseView(r);
  buildResponseView(r, { smoothing: 1 / 6 });
  const after = JSON.stringify(r, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x));
  assert.equal(after, before);
});

const tone = (sr, n, f, a) => Float32Array.from({ length: n },
  (_, i) => a * Math.sin(2 * Math.PI * f * (i / sr) + 0.3));
const ULTRASONIC = createFrequencyProfile({ name: 'Ultrasonic microphone',
  points: [[30000, 1], [40000, 2]] });

for (const mode of ['third', 'octave']) {
  test(`RTA ${mode} view: a 30-40 kHz profile covering no band reads UNCALIBRATED`, () => {
    const sr = 48000;
    const live = createLiveRta({ sampleRate: sr, mode, averaging: 'fast', profile: ULTRASONIC });
    live.push(tone(sr, LIVE_RTA_FFT_SIZE, 1000, 0.1), 0.016);
    const input = live.viewInput();
    assert.ok(input.correction, 'the live RTA hands the view a correction object');
    assert.ok(Array.from(input.correction.covered).every((c) => c === 0), 'no band covered');
    const v = buildRtaView({ ...input, fixedRange: true });
    assert.ok(v.badges.includes(UNCAL), v.badges.join(' | '));
    assert.ok(!v.badges.includes(CAL), v.badges.join(' | '));
    assert.ok(v.bars.every((b) => !b.covered && b.kind !== 'CALIBRATED'));
    assert.ok(v.notes.some((t) => /covers none of the bands/.test(t)), v.notes.join('\n'));
  });
}

test('RTA FFT view: unchanged, a profile covering no bin reads UNCALIBRATED', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'fft', averaging: 'fast',
    profile: ULTRASONIC });
  live.push(tone(sr, LIVE_RTA_FFT_SIZE, 1000, 0.1), 0.016);
  const v = buildRtaView({ ...live.viewInput(), fixedRange: true });
  assert.equal(v.mode, 'fft');
  assert.ok(v.badges.includes(UNCAL), v.badges.join(' | '));
});

test('RTA third view: a profile covering some bands keeps CALIBRATED and the edge note', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'fast',
    profile: PARTIAL });
  live.push(tone(sr, LIVE_RTA_FFT_SIZE, 1000, 0.1), 0.016);
  const v = buildRtaView({ ...live.viewInput(), fixedRange: true });
  assert.ok(v.badges.includes(CAL));
  assert.ok(v.bars.some((b) => b.covered) && v.bars.some((b) => !b.covered));
  assert.ok(v.notes.includes('Bands outside the frequency profile are uncorrected '
    + '(no extrapolation).'));
  assert.ok(!v.notes.some((t) => /covers none of the bands/.test(t)));
});
