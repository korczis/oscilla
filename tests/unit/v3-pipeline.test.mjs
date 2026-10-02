// V3 end-to-end measurement pipeline: the REAL outputs of every pure module, fed into the next
// one without hand-built shapes, through to an experiment file and back (spec §12, §99-§101,
// §144; docs/v3/architecture.md "Rule"; docs/v3/algorithms.md "Gaps").
//
//   renderStimulus (1.5 s log sweep, 48 kHz)
//   → synthetic system: RBJ low-pass 4 kHz (Q 1/√2) + 590-sample delay + white noise at 30 dB
//     SNR, with a separate stimulus-free noise capture of the same length and σ
//   → checkCapture → align → computeTransfer + computeImpulseResponse   (× 3 runs)
//   → aggregateRuns → assessQuality
//   → createRecipe(renderStimulus().spec) / createExperiment / withResults
//   → configHash + resultHash → JSON → validateExperiment → identical round trip
// plus an RTA path (pink noise → welch → bands → rtaResult → experiment → validate) and a
// calibrated path (frequency profile applied to the transfer and to RTA bands, level
// calibration present: "dB SPL" appears there and nowhere in the uncalibrated outputs).
//
// Modules are imported as namespaces so that a missing export fails only the test that needs
// it. Every numeric tolerance is derived next to its assertion; the noise is seeded, so every
// run is identical.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as algorithmsMod from '../../src/js/measurement/algorithms.js';
import * as stimulusMod from '../../src/js/measurement/stimulus.js';
import * as captureMod from '../../src/js/measurement/capture-checks.js';
import * as alignMod from '../../src/js/measurement/align.js';
import * as transferMod from '../../src/js/measurement/transfer.js';
import * as irMod from '../../src/js/measurement/impulse-response.js';
import * as aggregateMod from '../../src/js/measurement/aggregate.js';
import * as qualityMod from '../../src/js/measurement/quality.js';
import * as spectrumMod from '../../src/js/measurement/spectrum.js';
import * as rtaMod from '../../src/js/measurement/rta.js';
import * as formatMod from '../../src/js/measurement/format.js';
import * as profileMod from '../../src/js/calibration/profile.js';
import * as levelMod from '../../src/js/calibration/level.js';
import * as interpolateMod from '../../src/js/calibration/interpolate.js';
import * as schemaMod from '../../src/js/experiments/schema.js';
import * as hashMod from '../../src/js/experiments/hash.js';
import * as validateMod from '../../src/js/experiments/validate.js';
import * as csvMod from '../../src/js/experiments/csv.js';
import { mulberry32 } from '../../src/js/audio/noise.js';

const { ALGORITHMS } = algorithmsMod;
const SR = 48000;
const F1 = 20;
const F2 = 20000;
const SWEEP_S = 1.5;
const PRE = Math.round(0.25 * SR);
const POST = Math.round(0.5 * SR);
const DELAY = 590; // samples (12.3 ms): the "acoustic" delay of the synthetic system
const FC = 4000;
const SNR_DB = 30;
const RUNS = 3;
const NOW = '2026-10-02T10:00:00.000Z';
const BUILD = Object.freeze({
  version: '3.0.0-test', commit: 'abc1234def5678abc1234def5678abc1234def56',
  shortCommit: 'abc1234', sourceDate: '2026-10-01T00:00:00Z', channel: 'test', dirty: false,
  repository: null,
});
const OPTS = { knownAlgorithms: ALGORITHMS };
const bytes = (seed) => Uint8Array.from({ length: 16 }, (_, i) => (seed * 37 + i * 11) & 255);

// ----------------------------------------------------------------------------- system

/** Seeded zero-mean Gaussian noise (mulberry32 + Box-Muller). */
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

/** RBJ-cookbook low-pass (R. Bristow-Johnson, Audio EQ Cookbook), normalized by a0. */
function lowPassCoefficients(fc, q, sr) {
  const w = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0],
    a: [1, (-2 * c) / a0, (1 - alpha) / a0],
  };
}

function biquad({ b, a }, x) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Complex H(e^jω) of the biquad at f Hz: [re, im]. */
function biquadResponse({ b, a }, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const ev = (c) => [c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w),
    -c[1] * Math.sin(w) - c[2] * Math.sin(2 * w)];
  const [nr, ni] = ev(b);
  const [dr, di] = ev(a);
  const d = dr * dr + di * di;
  return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
}

const COEF = lowPassCoefficients(FC, Math.SQRT1_2, SR);
const STIM = stimulusMod.renderStimulus({
  kind: 'log-sweep', sampleRate: SR, duration: SWEEP_S, f1: F1, f2: F2, level: 0.5,
});
const LEN = PRE + STIM.samples.length + POST;

/** Noise-free system output: the sweep at PRE + DELAY through the low-pass. */
const CLEAN = (() => {
  const placed = new Float64Array(LEN);
  for (let i = 0; i < STIM.samples.length; i++) placed[PRE + DELAY + i] = STIM.samples[i];
  return biquad(COEF, placed);
})();
/** σ for 30 dB SNR against the RMS of the system output while the sweep plays. */
const SIGMA = (() => {
  let s = 0;
  const n = STIM.samples.length;
  for (let i = 0; i < n; i++) s += CLEAN[PRE + DELAY + i] ** 2;
  return Math.sqrt(s / n) / 10 ** (SNR_DB / 20);
})();

function runOnce(index) {
  const noise = gaussian(1000 + index, LEN, SIGMA);
  const captured = new Float32Array(LEN);
  for (let i = 0; i < LEN; i++) captured[i] = CLEAN[i] + noise[i];
  const noiseCapture = Float32Array.from(gaussian(5000 + index, LEN, SIGMA));
  const check = captureMod.checkCapture({ sampleRate: SR, samples: captured, preRoll: 0.25,
    postRoll: 0.5, startedAt: 0 });
  const alignment = alignMod.align(STIM.samples, captured, SR, { maxLagS: 0.5 });
  const transfer = transferMod.computeTransfer({
    stimulus: STIM.samples, captured, sampleRate: SR, f1: F1, f2: F2, noise: noiseCapture,
    alignment, options: { phase: true },
  });
  const ir = irMod.computeImpulseResponse({
    stimulus: STIM.samples, captured, sampleRate: SR, f1: F1, f2: F2,
    lagSamples: alignment.lagSamples,
  });
  return { captured, check, alignment, transfer, ir };
}

const RUN = Array.from({ length: RUNS }, (_, i) => runOnce(i));
const AGGREGATE = aggregateMod.aggregateRuns(RUN.map((r) => r.transfer.magnitudeDb));
const QUALITY = qualityMod.assessQuality({
  capture: RUN.map((r) => r.check), transfer: RUN[0].transfer, aggregate: AGGREGATE,
  calibration: { frequency: null, level: null },
});

/** JSON-safe per-run record built from the real check and alignment results. */
function runRecord(r, index) {
  return {
    index,
    alignment: { algorithm: r.alignment.algorithm, lagSamples: r.alignment.lagSamples,
      peakCorrelation: r.alignment.peakCorrelation, polarity: r.alignment.polarity },
    capture: { algorithms: r.check.algorithms, rms: r.check.rms, peak: r.check.peak,
      clippingRatio: r.check.clipping.ratio, reasons: r.check.reasons.map((x) => x.code) },
  };
}

function sweepExperiment({ calibration = null, quality = QUALITY, id = 1 } = {}) {
  const t = RUN[0].transfer;
  const ir = RUN[0].ir;
  const recipe = schemaMod.createRecipe({ stimulus: STIM.spec, repeats: RUNS,
    analysis: { pointsPerOctave: 48, phase: true, aggregate: AGGREGATE.method } });
  const created = schemaMod.createExperiment({
    recipe, build: BUILD, now: NOW, id: schemaMod.newExperimentId(bytes(id)),
    name: 'Pipeline: low-pass 4 kHz, 30 dB SNR', sampleRate: SR,
    input: { device: { label: null, id: null },
      constraints: { requested: { echoCancellation: false }, applied: null } },
    calibration,
    algorithms: {
      transfer: t.algorithm, ir: ir.algorithm, align: RUN[0].alignment.algorithm,
      clip: RUN[0].check.algorithms.clip, discontinuity: RUN[0].check.algorithms.discontinuity,
      quality: quality.algorithm,
    },
  });
  const measured = schemaMod.withResults(created, {
    startedAt: '2026-10-02T10:00:01.000Z', runs: RUN.map(runRecord), quality,
    results: { transfer: t, ir, rta: null },
  });
  const configured = hashMod.withConfigHash(measured, hashMod.configHash(measured));
  return hashMod.withResultHash(configured, hashMod.resultHash(configured));
}

function roundTrip(experiment) {
  const json = schemaMod.experimentToJson(experiment);
  const v = validateMod.validateExperiment(json, OPTS);
  assert.ok(v.ok, `validation failed: ${v.ok ? '' : schemaMod.formatErrors(v.errors)}`);
  assert.deepStrictEqual(v.experiment, experiment, 'validated experiment equals the original');
  assert.equal(schemaMod.experimentToJson(v.experiment), json, 'byte-identical re-export');
  return { json, imported: v.experiment };
}

// ----------------------------------------------------------------------------- sweep path

test('pipeline: capture checks pass a clean synthetic capture and stamp their IDs', () => {
  for (const { check } of RUN) {
    assert.equal(check.invalid, false, JSON.stringify(check.reasons));
    assert.deepEqual(check.discontinuities, [], 'a filtered sweep in noise has no step');
    assert.equal(check.algorithms.clip, ALGORITHMS.clip);
    assert.equal(check.algorithms.discontinuity, ALGORITHMS.discontinuity);
  }
});

test('pipeline: alignment finds the system delay and is robust enough for phase', (t) => {
  // The correlation peak sits at the delay plus at most the low-pass group delay, which for a
  // 2nd-order Butterworth is √2/(2π·fc) = 56.3 µs = 2.70 samples at DC and less above: 4
  // samples bound it with sub-sample noise jitter to spare.
  for (const { alignment } of RUN) {
    assert.equal(alignment.algorithm, ALGORITHMS.align);
    assert.ok(Math.abs(alignment.lagSamples - (PRE + DELAY)) <= 4, `${alignment.lagSamples}`);
    assert.equal(alignment.polarity, 1);
    assert.ok(alignment.peakCorrelation >= transferMod.PHASE_MIN_CORRELATION,
      `ρ = ${alignment.peakCorrelation}`);
  }
  t.diagnostic(RUN.map(({ alignment: a }) => `lag ${(a.lagSamples - PRE - DELAY).toFixed(3)} ` +
    `samples after the delay, ρ ${a.peakCorrelation.toFixed(4)}`).join('; '));
});

test('pipeline: transfer magnitude and phase match the analytic low-pass where SNR allows', (t) => {
  const r = RUN[0].transfer;
  assert.equal(r.algorithm, ALGORITHMS.transfer);
  assert.ok(r.phaseDeg instanceof Float64Array, `phase reason: ${r.phaseReason}`);
  assert.equal(r.phaseReason, null);
  assert.equal(r.alignment.algorithm, ALGORITHMS.align);
  assert.equal(r.alignment.peakCorrelation, RUN[0].alignment.peakCorrelation);
  assert.ok(r.validRange !== null);
  // Noise adds a random complex term of relative RMS ρ = 10^(−snr/20) to each grid point
  // (snr: that point's estimated SNR), so |error| ≤ 20·log10(1 + 3ρ) dB in magnitude and
  // (180/π)·3ρ degrees in phase at three standard deviations of one bin; band averaging over
  // the point's bins only tightens this. Phase adds 2° for the angle spread inside a 1/48-octave
  // band (as in v3-transfer-ir) and the residual lag δ = lag − (PRE + DELAY), removed
  // analytically.
  const delta = RUN[0].alignment.lagSamples - (PRE + DELAY);
  let worstMag = 0;
  let worstPhase = 0;
  let worstUse = 0;
  let count = 0;
  r.frequencies.forEach((f, i) => {
    if (f < 50 || f > 10000 || r.snrDb[i] < 10) return;
    count++;
    const rho = 10 ** (-r.snrDb[i] / 20);
    const [re, im] = biquadResponse(COEF, f, SR);
    const magErr = Math.abs(r.magnitudeDb[i] - 10 * Math.log10(re * re + im * im));
    const bound = 20 * Math.log10(1 + 3 * rho);
    assert.ok(magErr <= bound, `${f.toFixed(1)} Hz: ${magErr} dB`);
    worstMag = Math.max(worstMag, magErr);
    worstUse = Math.max(worstUse, magErr / bound);
    if (f > 5000) return;
    const expected = (Math.atan2(im, re) * 180) / Math.PI + (360 * f * delta) / SR;
    const d = Math.abs(((r.phaseDeg[i] - expected + 540) % 360 + 360) % 360 - 180);
    assert.ok(d <= 2 + (180 / Math.PI) * 3 * rho, `${f.toFixed(1)} Hz: phase ${d}°`);
    worstPhase = Math.max(worstPhase, d);
  });
  assert.ok(count > 200, `${count} grid points checked`);
  t.diagnostic(`max |ΔH| ${worstMag.toFixed(3)} dB, max |Δφ| ${worstPhase.toFixed(2)}°, ` +
    `largest share of the magnitude bound used ${(100 * worstUse).toFixed(0)} %, ${count} points`);
});

test('pipeline: the IR peak is at the system delay; IR IDs name the method', () => {
  const { ir, alignment } = RUN[0];
  assert.equal(ir.algorithm, ALGORITHMS.ir);
  assert.equal(ir.method, 'spectral');
  // The peak of a 2nd-order Butterworth impulse response is at √2/(8·fc) = 44 µs = 2.1 samples
  // after the delay; the lag already contains part of the group delay, so ±4 samples.
  const absolute = Math.round((ir.captureOffsetS + ir.peakTimeS) * SR);
  assert.ok(Math.abs(absolute - (PRE + DELAY)) <= 4, `peak at ${absolute}`);
  assert.ok(ir.captureOffsetS <= alignment.lagSamples / SR);
});

test('pipeline: aggregate and quality consume the real results', (t) => {
  assert.equal(AGGREGATE.runs, RUNS);
  assert.ok(Number.isFinite(AGGREGATE.repeatabilityDb));
  assert.equal(QUALITY.algorithm, ALGORITHMS.quality);
  assert.notEqual(QUALITY.status, 'INVALID', JSON.stringify(QUALITY.reasons));
  assert.equal(QUALITY.metrics.runs, RUNS);
  for (const code of ['CLIPPING', 'DROPOUT', 'SNR_MEDIAN', 'REPEATABILITY']) {
    assert.ok(QUALITY.reasons.some((x) => x.code === code), code);
  }
  t.diagnostic(qualityMod.summarizeQuality(QUALITY));
});

test('pipeline: the rendered stimulus spec is the recipe stimulus, unchanged', () => {
  const recipe = schemaMod.createRecipe({ stimulus: STIM.spec, repeats: RUNS });
  assert.deepStrictEqual(recipe.stimulus, { ...STIM.spec });
  for (const spec of [
    { kind: 'band-noise', sampleRate: SR, duration: 2, f1: 100, f2: 8000, color: 'pink' },
    { kind: 'chirp', sampleRate: SR, duration: 0.005, law: 'linear' },
    { kind: 'sine', sampleRate: 44100, f: 30000 },
  ]) {
    const rendered = stimulusMod.renderStimulus(spec).spec;
    assert.deepStrictEqual(schemaMod.createRecipe({ stimulus: rendered }).stimulus,
      { ...rendered }, spec.kind);
  }
});

test('pipeline: sweep experiment → hashes → JSON → validate → identical', () => {
  const e = sweepExperiment();
  assert.match(e.provenance.configHash, /^[0-9a-f]{64}$/);
  assert.match(e.provenance.resultHash, /^[0-9a-f]{64}$/);
  const { json, imported } = roundTrip(e);
  assert.equal(hashMod.configHash(imported), e.provenance.configHash);
  assert.equal(hashMod.resultHash(imported), e.provenance.resultHash);
  // One flipped base64 digit inside the transfer magnitude: still a well-formed array, but the
  // result hash no longer matches, so the import is rejected as corrupt.
  const doc = JSON.parse(json);
  const data = doc.results.transfer.magnitudeDb.data;
  const at = data.length >> 1;
  doc.results.transfer.magnitudeDb.data = data.slice(0, at) + (data[at] === 'A' ? 'B' : 'A')
    + data.slice(at + 1);
  const v = validateMod.validateExperiment(JSON.stringify(doc), OPTS);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.path === 'provenance.resultHash' && x.code === 'corrupt'
    && /corrupt/.test(x.text)), JSON.stringify(v.errors));
});

// ----------------------------------------------------------------------------- RTA path

const PINK = stimulusMod.renderStimulus({ kind: 'pink', sampleRate: SR, duration: 3,
  level: 0.5, seed: 11 });
const RTA_FFT = 8192;
const RTA_BIN_HZ = SR / RTA_FFT;
const RTA_BANDS = rtaMod.bandCenters('third', 25, 16000, SR);
const SPECTRUM = spectrumMod.welch(PINK.samples, { fftSize: RTA_FFT, window: 'hann' });

function rtaExperiment() {
  const levelsDb = rtaMod.bandPowers(SPECTRUM, RTA_BIN_HZ, RTA_BANDS);
  const rta = rtaMod.rtaResult({ sampleRate: SR, resolution: 'third', bands: RTA_BANDS,
    levelsDb, fftSize: RTA_FFT, window: SPECTRUM.window });
  const check = captureMod.checkCapture({ sampleRate: SR, samples: PINK.samples });
  const quality = qualityMod.assessQuality({ capture: check, requestedRange: [25, 16000],
    resolutionHz: RTA_BIN_HZ });
  const recipe = schemaMod.createRecipe({ stimulus: PINK.spec,
    analysis: { rta: 'third', fftSize: RTA_FFT, window: SPECTRUM.window, overlap: 0.5 } });
  const created = schemaMod.createExperiment({ recipe, build: BUILD, now: NOW, id: 'rta-1',
    name: 'Pipeline: pink-noise RTA', sampleRate: SR,
    algorithms: { rta: rta.algorithm, window: rta.windowAlgorithm, clip: check.algorithms.clip,
      discontinuity: check.algorithms.discontinuity, quality: quality.algorithm } });
  const measured = schemaMod.withResults(created, { quality, results: { rta } });
  return { rta, e: hashMod.withResultHash(measured, hashMod.resultHash(measured)) };
}

test('pipeline RTA: welch output feeds bandPowers on one documented power scale', () => {
  const levels = rtaMod.bandPowers(SPECTRUM, RTA_BIN_HZ, RTA_BANDS);
  const ms = spectrumMod.toneToMeanSquare(SPECTRUM.power, SPECTRUM.window);
  const direct = rtaMod.bandPowers(ms, RTA_BIN_HZ, RTA_BANDS);
  assert.equal(SPECTRUM.scale, 'tone');
  for (let i = 0; i < levels.length; i++) assert.equal(levels[i], direct[i]);
  // Kellet pink at 48 kHz: ±0.05 dB of −3 dB/octave above ~11 Hz for the expected spectrum, so
  // third-octave bands are flat in expectation. One 3 s realization with Welch averaging
  // scatters a band of B Hz by ≈ 4.34/√(B·T_eff) dB; at 100 Hz (B = 23 Hz, ~70 s·Hz) that is
  // 0.5 dB, so ±1.5 dB around the median (3σ) holds from 100 Hz to 10 kHz.
  const inRange = RTA_BANDS.map((b, i) => [b, levels[i]])
    .filter(([b]) => b.nominal >= 100 && b.nominal <= 10000);
  const sorted = inRange.map(([, l]) => l).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  for (const [b, l] of inRange) assert.ok(Math.abs(l - median) <= 1.5, `${b.nominal}: ${l}`);
});

test('pipeline RTA: rtaResult → experiment → validate → identical; zero power encoded', () => {
  const { rta, e } = rtaExperiment();
  assert.equal(rta.algorithm, ALGORITHMS.rta);
  assert.equal(rta.windowAlgorithm, ALGORITHMS.window);
  roundTrip(e);
  const silent = rtaMod.bandPowers(new Float64Array(RTA_FFT / 2 + 1), RTA_BIN_HZ, RTA_BANDS);
  assert.ok(silent.every((v) => v === -Infinity));
  const zero = rtaMod.rtaResult({ sampleRate: SR, resolution: 'third', bands: RTA_BANDS,
    levelsDb: silent, fftSize: RTA_FFT, window: 'hann' });
  assert.ok(zero.levelsDb.every((v) => v === transferMod.ZERO_POWER_DB));
  const withZero = schemaMod.withResults(e, { results: { rta: zero } });
  roundTrip(hashMod.withResultHash(withZero, hashMod.resultHash(withZero)));
});

// ----------------------------------------------------------------------------- calibrated

const PROFILE = profileMod.createFrequencyProfile({ name: 'Pipeline test microphone',
  points: [[20, 1.5], [100, 0.5], [1000, 0], [8000, 1], [16000, 3]] });
const LEVEL = levelMod.createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30.5, conditions: 'synthetic', createdAt: '2026-10-02T09:00:00.000Z' });

/** Every user-facing text the uncalibrated / calibrated pipeline produces. */
function texts(e, quality, rtaE, display) {
  const meta = csvMod.csvMeta(e);
  return [
    ...schemaMod.summarizeExperiment(e),
    qualityMod.summarizeQuality(quality),
    ...quality.reasons.map((x) => `${x.text} ${x.unit}`),
    csvMod.transferCsv(e.results.transfer, meta, display.csv),
    csvMod.irCsv(e.results.ir, meta),
    csvMod.rtaCsv(rtaE.results.rta, csvMod.csvMeta(rtaE)),
    display.level,
  ].join('\n');
}

test('pipeline calibrated: profile applied to transfer and bands; SPL only when calibrated', () => {
  const t = RUN[0].transfer;
  const corrected = interpolateMod.applyFrequencyCorrection(t.magnitudeDb, t.frequencies,
    PROFILE);
  const { rta, e: rtaE } = rtaExperiment();
  const bandCorr = interpolateMod.applyFrequencyCorrectionToBands(rta, PROFILE,
    { power: SPECTRUM, binHz: RTA_BIN_HZ });
  assert.equal(bandCorr.algorithm, ALGORITHMS.calibration);
  assert.equal(bandCorr.profileId, PROFILE.id);
  rta.bands.forEach((b, i) => {
    const inside = b.lo >= 20 && b.hi <= 16000;
    assert.equal(bandCorr.covered[i], inside ? 1 : 0, `${b.nominal}`);
    if (!inside) assert.equal(bandCorr.correctedDb[i], rta.levelsDb[i], 'never extrapolated');
  });
  const calibrated = qualityMod.assessQuality({
    capture: RUN.map((r) => r.check), transfer: t, aggregate: AGGREGATE,
    calibration: { frequency: corrected, level: LEVEL },
  });
  assert.equal(calibrated.metrics.levelCalibrated, true);
  const calE = sweepExperiment({ calibration: { frequency: PROFILE, level: LEVEL },
    quality: calibrated, id: 2 });
  roundTrip(calE);
  const splDb = Float64Array.from(corrected.correctedDb, (v) => v + LEVEL.offsetDb);
  const calText = texts(calE, calibrated, rtaE, {
    csv: { calibratedDb: splDb },
    level: formatMod.formatDb(levelMod.toDisplayLevel(rta.levelsDb[10], LEVEL).value,
      { kind: levelMod.levelLabel(LEVEL).calibrated ? 'spl' : 'relative' }),
  });
  assert.match(calText, /dB SPL/);
  const uncal = sweepExperiment();
  const uncalText = texts(uncal, QUALITY, rtaE, {
    csv: {},
    level: formatMod.formatDb(levelMod.toDisplayLevel(rta.levelsDb[10], null).value),
  });
  assert.doesNotMatch(uncalText, /SPL/);
  assert.match(uncalText, new RegExp(levelMod.RELATIVE_UNIT.replace(/[()]/g, '\\$&')));
});
