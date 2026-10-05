// V3 pre-release review fixes — calibration, UI and provenance group (M3, M4, M6, M7, M9, M11,
// m3, m4, m6, m7). Every test here failed (or could not run: missing API) before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';

import { measureReferenceLevel, referenceBand } from '../../src/js/calibration/reference.js';
import {
  createLevelCalibration, isValidLevelCalibration, levelCalibrationApplies, levelLabel,
  inputBinding, LEVEL_SCALE, LEVEL_SCHEMA_VERSION,
} from '../../src/js/calibration/level.js';
import { hashDeviceId, isHashedDeviceId } from '../../src/js/calibration/device-id.js';
import { parseCalibrationText, conventionFromHeader } from '../../src/js/calibration/parse.js';
import {
  createFrequencyProfile, exportProfile, profileId, migrateProfileDocument,
  PROFILE_SCHEMA_VERSION,
} from '../../src/js/calibration/profile.js';
import {
  applyFrequencyCorrection, applyFrequencyCorrectionToBands, previewConvention,
} from '../../src/js/calibration/interpolate.js';
import { summarizeNoise, createMeasurementEngine, assessMeasurement, INPUT_PROCESSING_NOTE }
  from '../../src/js/measurement/engine.js';
import { bandCenters } from '../../src/js/measurement/rta.js';
import { logGrid } from '../../src/js/measurement/transfer.js';
import {
  buildResponseView, buildPhaseView, normalizationAvailability, PHASE_REASON_TEXT,
} from '../../src/js/measurement/views/response-chart.js';
import { buildIrView } from '../../src/js/measurement/views/ir-chart.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { exportableExperiment, transferCsvOptions } from '../../src/js/ui/experiments.js';
import { readFileText, FileTooLargeError } from '../../src/js/ui/exporters.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import {
  experimentToJson, formatErrors, serializeExperiment, normalizeInput, sanitizeForExport,
  summarizeExperiment,
} from '../../src/js/experiments/schema.js';
import {
  resultHash, withResultHash, RESULT_HASH_VERSION,
} from '../../src/js/experiments/hash.js';
import { compareExperiments } from '../../src/js/experiments/compare.js';
import { transferCsv, irCsv, csvMeta } from '../../src/js/experiments/csv.js';
import { KNOWN_ALGORITHM_IDS, ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import { mulberry32 } from '../../src/js/audio/noise.js';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const clone = (v) => JSON.parse(JSON.stringify(v));
const sine = (amp, hz, sr, seconds) => Float32Array.from({ length: Math.round(sr * seconds) },
  (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

// ---------------------------------------------------------------------------- M3 level

test('M3: the reference reading is the 1 kHz third-octave band on the MEASURE mean-square scale',
  () => {
    const sr = 48000;
    for (const amp of [0.9, 0.1, 0.01]) {
      const r = measureReferenceLevel({ sampleRate: sr, samples: sine(amp, 1000, sr, 3) });
      assert.equal(r.ok, true, r.errors.join(' '));
      // A sine of peak A reads 20·log10(A) − 3.01 dB (mean square A²/2).
      assert.ok(Math.abs(r.observedDbRelative - (20 * Math.log10(amp) - 10 * Math.log10(2)))
        < 0.01, `${amp}: ${r.observedDbRelative}`);
      assert.equal(r.scale, LEVEL_SCALE.id);
      assert.equal(r.band.nominal, 1000);
    }
    // The SAME scale as the MEASURE noise bands (engine summarizeNoise): equal within 0.01 dB.
    const x = sine(0.3, 1000, sr, 3);
    const noise = summarizeNoise({ sampleRate: sr, samples: x });
    const k = bandCenters('third', 20, 20000, sr).findIndex((b) => b.nominal === 1000);
    const r = measureReferenceLevel({ sampleRate: sr, samples: x });
    assert.ok(Math.abs(noise.bands.levelsDb[k] - r.observedDbRelative) < 0.01);
    assert.equal(referenceBand(1000, sr).nominal, 1000);
  });

test('M3: no reference tone, clipping or a short capture is refused, never stored', () => {
  const sr = 48000;
  const rnd = mulberry32(3);
  const noise = Float32Array.from({ length: sr * 2 }, () => (rnd() - 0.5) * 0.2);
  const n = measureReferenceLevel({ sampleRate: sr, samples: noise });
  assert.equal(n.ok, false);
  assert.equal(n.observedDbRelative, null);
  assert.match(n.errors.join(' '), /not a reference tone/);
  const clipped = sine(1.2, 1000, sr, 1).map((v) => Math.max(-1, Math.min(1, v)));
  assert.match(measureReferenceLevel({ sampleRate: sr, samples: clipped }).errors.join(' '),
    /clipped/);
  assert.match(measureReferenceLevel({ sampleRate: sr, samples: new Float32Array(100) })
    .errors.join(' '), /too short/);
  assert.equal(measureReferenceLevel({ sampleRate: sr, samples: new Float32Array(sr) }).ok, false);
  assert.throws(() => measureReferenceLevel({ samples: [1, 2] }), TypeError);
});

const FACTS = Object.freeze({
  device: { label: 'USB mic', id: 'raw-device-id-0123456789' },
  constraints: { requested: { echoCancellation: false },
    applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1, sampleRate: 48000, deviceId: 'raw-device-id-0123456789' } },
  sampleRate: 48000,
});

test('M3: a calibration records its scale, method and hashed input, and voids on another input',
  () => {
    const cal = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
      observedDbRelative: -30, createdAt: '2026-10-03T00:00:00Z', method: 'captured',
      input: FACTS });
    assert.equal(cal.schemaVersion, LEVEL_SCHEMA_VERSION);
    assert.equal(cal.scale, 'band-mean-square');
    assert.equal(cal.method, 'captured');
    assert.equal(cal.input.deviceId, hashDeviceId(FACTS.device.id));
    assert.ok(isHashedDeviceId(cal.input.deviceId));
    assert.doesNotMatch(JSON.stringify(cal), /raw-device-id/, 'the raw deviceId is never stored');
    assert.deepEqual(cal.input, { deviceId: cal.input.deviceId, sampleRate: 48000,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
    assert.equal(isValidLevelCalibration(cal), true);
    // The same input: applies; any recorded difference voids it with the reason.
    assert.deepEqual(levelCalibrationApplies(cal, FACTS),
      { applies: true, checked: true, reason: null, differences: [] });
    const other = clone(FACTS);
    other.device.id = 'another-device';
    other.sampleRate = 44100;
    other.constraints.applied.autoGainControl = true;
    const a = levelCalibrationApplies(cal, other);
    assert.equal(a.applies, false);
    assert.deepEqual(a.differences.map((d) => d.field), ['deviceId', 'sampleRate',
      'autoGainControl']);
    assert.match(a.reason, /^UNCALIBRATED: .*a different input device.*sample rate 48000 Hz at /);
    assert.match(a.reason, /automatic gain control off at calibration, on now/);
    const label = levelLabel(cal, other);
    assert.equal(label.indicator, 'UNCALIBRATED');
    assert.equal(label.reason, a.reason);
    assert.equal(levelLabel(cal, FACTS).indicator, 'CALIBRATED');
    // Unknown current input: nothing to compare (the workspace runs the setup check first).
    assert.equal(levelCalibrationApplies(cal, null).checked, false);
    // A schema-1 (V3.0) record stays a valid stored calibration; a schema-2 record needs its
    // scale and a well-formed binding.
    const v1 = { schemaVersion: 1, kind: 'level', referenceHz: 1000, referenceDbSpl: 94,
      observedDbRelative: -30, offsetDb: 124, conditions: null, createdAt: 'x' };
    assert.equal(isValidLevelCalibration(v1), true);
    assert.equal(isValidLevelCalibration({ ...cal, scale: 'dbfs-peak' }), false);
    assert.equal(isValidLevelCalibration({ ...cal, input: { ...cal.input, deviceId: 'raw' } }),
      false);
    assert.equal(inputBinding(null), null);
    assert.equal(inputBinding(cal.input).deviceId, cal.input.deviceId, 'idempotent');
  });

// ---------------------------------------------------------------------------- M4 sign

test('M4: headers that do not state the sign need an explicit choice; the choice is applied',
  () => {
    for (const h of ['correction_db', 'Gain(dB)', 'EQ', 'cal', 'calibration', 'value']) {
      assert.equal(conventionFromHeader(h), null, h);
      const r = parseCalibrationText(`Hz,${h}\n20,4\n1000,0\n10000,2\n`, { name: 'x' });
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      assert.equal(r.needsConvention, true, h);
      assert.equal(r.profile, null, 'nothing is loaded without the choice');
      assert.match(r.previews.deviation.text, /becomes −4\.00 dB/);
      assert.match(r.previews.correction.text, /becomes \+4\.00 dB/);
    }
    for (const h of ['SPL(dB)', 'dB', 'deviation', 'response', 'magnitude']) {
      assert.equal(conventionFromHeader(h), 'deviation', h);
    }
    const head = 'frequency_hz,correction_db\n20,4\n1000,0\n10000,2\n';
    const dev = parseCalibrationText(head, { convention: 'deviation' }).profile;
    const cor = parseCalibrationText(head, { convention: 'correction' }).profile;
    assert.equal(dev.convention, 'deviation');
    assert.equal(cor.convention, 'correction');
    assert.notEqual(dev.id, cor.id, 'the profile id covers the convention');
    const f = Float64Array.from([20, 10000]);
    const zero = new Float64Array(2);
    assert.deepEqual([...applyFrequencyCorrection(zero, f, dev).correctedDb], [-4, -2]);
    assert.deepEqual([...applyFrequencyCorrection(zero, f, cor).correctedDb], [4, 2]);
    const bands = bandCenters('octave', 31.5, 8000, 48000);
    const rta = { bands, levelsDb: new Float64Array(bands.length) };
    const bd = applyFrequencyCorrectionToBands(rta, dev);
    const bc = applyFrequencyCorrectionToBands(rta, cor);
    bands.forEach((b, i) => {
      if (bd.covered[i]) assert.ok(Math.abs(bd.correctionDb[i] + bc.correctionDb[i]) < 0.5);
    });
    // Headerless files and explicit response headers keep the deviation reading, said so.
    const plain = parseCalibrationText('20 4\n1000 0\n');
    assert.equal(plain.profile.convention, 'deviation');
    assert.match(plain.convention.text, /no column header/);
    assert.match(plain.preview.text, /^At 20 Hz the file states \+4\.00 dB; a reading of 0\.00 dB /);
    assert.equal(previewConvention(cor, { hz: 10000 }).correctedDb, 2);
    assert.equal(parseCalibrationText(head, { convention: 'sideways' }).ok, false);
  });

test('M4: profile schema 2 stores the convention; schema 1 migrates with its id unchanged', () => {
  assert.equal(PROFILE_SCHEMA_VERSION, 2);
  const points = [[20, 1.5], [1000, 0], [16000, -2]];
  const p = createFrequencyProfile({ name: 'm', points });
  // The identity format of a deviation profile is the schema-1 one, so V3.0 ids still match
  // (the golden calibration fixture's profileId is unchanged).
  const exported = exportProfile(p);
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.convention, 'deviation');
  const v1 = { ...exported, schemaVersion: 1 };
  delete v1.convention;
  const m = migrateProfileDocument(v1);
  assert.equal(m.ok, true);
  assert.equal(m.migrated, true);
  assert.equal(m.doc.convention, 'deviation');
  const back = parseCalibrationText(JSON.stringify(v1));
  assert.equal(back.ok, true);
  assert.equal(back.profile.id, p.id);
  assert.equal(back.profile.id, profileId({ points }));
  assert.ok(back.warnings.some((w) => /schema 1 profile migrated/.test(w.text)));
  assert.equal(migrateProfileDocument({ ...v1, convention: 'correction' }).ok, false);
  assert.equal(migrateProfileDocument({ ...exported, schemaVersion: 3 }).ok, false);
  const c = exportProfile({ ...p, convention: 'correction' });
  const cBack = parseCalibrationText(JSON.stringify(c));
  assert.equal(cBack.profile.convention, 'correction');
  assert.equal(cBack.profile.id, c.id);
  assert.notEqual(c.id, p.id);
});

// ---------------------------------------------------------------------------- M6 / m3 views

const GRID = logGrid(2000, 20000);
const transferSource = (over = {}) => ({
  transfer: { algorithm: ALGORITHMS.transfer, sampleRate: 48000, frequencies: GRID,
    magnitudeDb: new Float64Array(GRID.length), phaseDeg: null, phaseReason: 'NOT_REQUESTED',
    snrDb: null, validRange: [GRID[0], GRID.at(-1)], requestedRange: [GRID[0], GRID.at(-1)],
    fftSize: 1 << 18, binHz: 48000 / (1 << 18), ...over },
  quality: null, recipe: { stimulus: { f1: 2000, f2: 20000 } },
  preflight: { facts: { output: { gain: 0.08 } } },
});

test('M6: a normalization outside the measured grid is not applied and never throws', () => {
  const src = transferSource();
  for (const spec of [{ mode: 'at-frequency', hz: 1000 }, { mode: 'band-mean', lo: 500,
    hi: 1900 }]) {
    assert.equal(normalizationAvailability(GRID, spec).ok, false);
    let v;
    assert.doesNotThrow(() => { v = buildResponseView(src, { normalization: spec }); });
    assert.equal(v.normalizationApplied, false);
    assert.ok(v.badges.includes('NORMALIZATION NOT APPLIED'));
    assert.ok(v.notes.some((n) => /^NORMALIZATION not applied: .*outside|no measured point/
      .test(n)));
    assert.ok(!v.badges.includes('NORMALIZED'));
  }
  const ok = buildResponseView(src, { normalization: { mode: 'at-frequency', hz: 5000 } });
  assert.equal(ok.normalizationApplied, true);
  assert.equal(normalizationAvailability(GRID, null).ok, true);
});

test('M9: the response view states the master gain included in every magnitude', () => {
  const v = buildResponseView(transferSource());
  assert.ok(v.notes.some((n) => /master output gain 0\.08 \(−21\.9 dB = 20·log10 gain\)/
    .test(n)));
  assert.equal(v.masterGain, 0.08);
});

test('m3: phase readout and phase view where present; the reason where absent', () => {
  const phaseDeg = Float64Array.from(GRID, (f) => ((-f / 50) % 360 + 540) % 360 - 180);
  const src = transferSource({ phaseDeg, phaseReason: null });
  const v = buildResponseView(src);
  assert.equal(v.phase.available, true);
  assert.ok(v.readout(5).lines.some((l) => /^Phase [−+]?\d+\.\d°$/.test(l)));
  const pv = buildPhaseView(src);
  assert.equal(pv.available, true);
  assert.deepEqual(pv.axes.y.range, [-180, 180]);
  assert.equal(pv.series[0].values.length, GRID.length);
  assert.match(pv.readout(5).lines[1], /^Phase /);
  const none = buildPhaseView(transferSource());
  assert.equal(none.available, false);
  assert.equal(none.series.length, 0);
  assert.equal(none.reason, `Phase NOT MEASURED: ${PHASE_REASON_TEXT.NOT_REQUESTED}.`);
  assert.match(buildResponseView(transferSource()).phase.text, /NOT MEASURED: phase was not/);
  assert.ok(!buildResponseView(transferSource()).readout(5).lines.some((l) => /^Phase/.test(l)));
});

// ---------------------------------------------------------------------------- M7 IR

test('M7: the IR is sliced to the visible span before decimation', () => {
  const sr = 48000;
  const n = Math.round(11.505 * sr);
  const samples = new Float32Array(n);
  const peak = 240;
  samples[peak] = 0.4;
  samples[peak + 48] = 0.2;
  samples[peak + 96] = -0.1;
  const ir = { algorithm: ALGORITHMS.ir, method: 'spectral', sampleRate: sr, samples,
    peakIndex: peak, peakTimeS: peak / sr, captureOffsetS: 0.495, noiseFloorDb: -150,
    window: null };
  const inRange = (v, r) => Array.from(v.x).filter((t) => t >= r[0] && t <= r[1]).length;
  const direct = buildIrView(ir, { range: [-2, 20] });
  // 22 ms at 48 kHz = 1056 samples, all drawn (no decimation); before the fix: 6 points.
  assert.equal(direct.decimation.factor, 1);
  assert.ok(inRange(direct, [-2, 20]) >= 1056, `${inRange(direct, [-2, 20])}`);
  // The reflections at 1 ms and 2 ms are distinct points with their exact amplitudes.
  const at = (v, ms) => v.series[0].values[Array.from(v.x).findIndex((t) => Math.abs(t - ms)
    < 1e-9)];
  assert.ok(Math.abs(at(direct, 1) - 0.2) < 1e-7);
  assert.ok(Math.abs(at(direct, 2) + 0.1) < 1e-7);
  const early = buildIrView(ir, { range: [-5, 200] });
  assert.ok(inRange(early, [-5, 200]) > 1900);
  assert.ok(early.decimation.factor <= 5);
  const full = buildIrView(ir, { range: 'full' });
  assert.equal(full.decimation.visibleSamples, n);
  assert.deepEqual(full.axes.x.range, [-peak * 1000 / sr, (n - 1 - peak) * 1000 / sr]);
  assert.ok(full.x.length <= 4000);
  assert.throws(() => buildIrView(ir, { range: [5, 5] }), RangeError);
});

// ---------------------------------------------------------------------------- M9 / M11 / m7

const SR = 8000;
function micIo() {
  let t = 1;
  let run = 0;
  const applied = { echoCancellation: true, noiseSuppression: false, autoGainControl: false,
    channelCount: 1, deviceId: 'raw-mic-id-abcdef' };
  const device = { label: 'USB mic', id: 'raw-mic-id-abcdef' };
  const constraints = { requested: { echoCancellation: false, deviceId: { exact:
    'raw-mic-id-abcdef' } }, applied };
  const noise = (seed, len) => {
    const r = mulberry32(seed);
    return Float32Array.from({ length: len }, () => (r() - 0.5) * 2e-3);
  };
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: { ok: true, device, constraints }, inputLevel: null,
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' } };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: noise(5, Math.round(seconds * SR)), startedAt,
        preRoll: 0, postRoll: 0, constraints, device };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const samples = noise(10 + run, pre + x.length + Math.round(postRollS * SR));
      for (let i = 0; i < x.length; i++) samples[pre + i] += 0.5 * x[i];
      run += 1;
      const startedAt = Math.max(t + 0.01, notBefore ?? -Infinity);
      t = startedAt + samples.length / SR;
      return { sampleRate: SR, samples, startedAt, stimulusStartAt: startedAt + preRollS,
        preRoll: preRollS, postRoll: postRollS, constraints, device };
    },
    cancel() {},
    dispose() {},
  };
}

const RESULT = await createMeasurementEngine({ io: micIo(), assess: assessMeasurement,
  clock: { wall: () => 0, mono: () => 0 } }).measure({
  // f2 above 0.95 × Nyquist (3800 Hz at 8 kHz): stimulus.js clamps it.
  stimulus: { kind: 'log-sweep', duration: 1, level: 'low', f1: 50, f2: 3900 },
  repeats: 1, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0 },
});
const BUILD = { version: '9.9.9-test', commit: 'abcdef1234567', channel: 'test' };
const EXP = experimentFromResult(RESULT, { now: '2026-10-03T10:00:00.000Z', id: 'review-1',
  build: BUILD, requested: { f1: 50, f2: 3900 } });

test('M9: master gain, result notes, requested f2 and the full algorithm map are stored', () => {
  assert.equal(RESULT.state, 'COMPLETE', JSON.stringify(RESULT.reasons));
  assert.equal(EXP.output.masterGain, 0.08);
  assert.deepEqual(EXP.measurement.notes, [INPUT_PROCESSING_NOTE]);
  assert.deepEqual(EXP.recipe.requested, { f1: 50, f2: 3900 });
  assert.ok(EXP.recipe.stimulus.f2 < 3900, 'the played f2 is the clamped one');
  assert.equal(EXP.algorithms.discontinuity, ALGORITHMS.discontinuity);
  assert.equal(EXP.algorithms.clip, ALGORITHMS.clip);
  const v = validateExperiment(experimentToJson(EXP), OPTS);
  assert.ok(v.ok, v.ok ? '' : formatErrors(v.errors));
  assert.deepStrictEqual(v.experiment, EXP);
  assert.equal(experimentToJson(v.experiment), experimentToJson(EXP), 'byte-identical');
  const lines = summarizeExperiment(EXP);
  assert.ok(lines.includes('Master output gain: 0.08 (-21.9 dB, included in every magnitude)'));
  assert.ok(lines.some((l) => /^Requested: up to 3\.9 kHz \(limited to /.test(l)));
  assert.ok(lines.includes(`Note: ${INPUT_PROCESSING_NOTE}`));
  // Invalid optional fields are rejected.
  for (const [mutate, path] of [
    [(d) => { d.output.masterGain = 0; }, 'output.masterGain'],
    [(d) => { d.output.masterGain = 2; }, 'output.masterGain'],
    [(d) => { d.measurement.notes = [''] }, 'measurement.notes[0]'],
    [(d) => { d.recipe.requested = { f1: 50 }; }, 'recipe.requested.f2'],
  ]) {
    const d = clone(serializeExperiment(EXP));
    mutate(d);
    const r = validateExperiment(d, OPTS);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.path === path), `${path}: ${JSON.stringify(r.errors)}`);
  }
  // Compare: a different master gain makes the set not equivalent.
  const other = { ...EXP, experimentId: 'review-2', output: { ...EXP.output, masterGain: 0.16 } };
  const c = compareExperiments([EXP, other]);
  assert.equal(c.compatible, false);
  assert.ok(c.warnings.some((w) => /different master output gains/.test(w)));
});

test('M11: the result hash (v2; v3, v4 since ADR 0040, 0043) covers verdict, calibration, input',
  () => {
  assert.equal(RESULT_HASH_VERSION, 4);
  assert.equal(EXP.provenance.resultHashVersion, 4);
  const doc = clone(serializeExperiment(EXP));
  assert.ok(validateExperiment(doc, OPTS).ok);
  // The review's case: the stored verdict edited to GOOD with the hash left as it was.
  const verdict = clone(doc);
  verdict.quality.status = verdict.quality.status === 'GOOD' ? 'POOR' : 'GOOD';
  for (const [name, d] of [['verdict', verdict]]) {
    const r = validateExperiment(d, OPTS);
    assert.equal(r.ok, false, name);
    assert.ok(r.errors.some((e) => e.code === 'corrupt'), JSON.stringify(r.errors));
  }
  const cal = clone(doc);
  cal.calibration.level = { schemaVersion: 1, kind: 'level', referenceHz: 1000,
    referenceDbSpl: 94, observedDbRelative: -30, offsetDb: 124, conditions: null,
    createdAt: null };
  assert.ok(validateExperiment(cal, OPTS).errors.some((e) => e.code === 'corrupt'));
  const input = clone(doc);
  input.input.constraints.applied.autoGainControl = true;
  assert.ok(validateExperiment(input, OPTS).errors.some((e) => e.code === 'corrupt'));
  // A version-1 file (results only) keeps verifying as version 1.
  const v1 = withResultHash(EXP, resultHash(EXP, { version: 1 }), 1);
  const v1doc = clone(serializeExperiment(v1));
  assert.equal('resultHashVersion' in v1doc.provenance, false);
  assert.ok(validateExperiment(v1doc, OPTS).ok);
  v1doc.quality.status = 'GOOD';
  assert.ok(validateExperiment(v1doc, OPTS).ok, 'v1 never covered the verdict');
  // The mask must lie on the stored response grid.
  const shifted = clone(serializeExperiment(withResultHash({ ...EXP, quality: { ...EXP.quality,
    mask: { ...EXP.quality.mask, frequencies: EXP.quality.mask.frequencies.map((f) => f * 1.01) } }
  }, '0'.repeat(64))));
  shifted.provenance.resultHash = null;
  const r = validateExperiment(shifted, OPTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /^quality\.mask\.frequencies/.test(e.path)), JSON.stringify(
    r.errors));
  // The verdict says who gave it.
  assert.ok(summarizeExperiment(EXP).includes(`Quality: ${EXP.quality.status} (as assessed by `
    + `OSCILLA 9.9.9-test, commit abcdef1, ${EXP.quality.algorithm})`));
});

test('m7: the raw deviceId is never stored or exported, once or twice', () => {
  const json = experimentToJson(EXP);
  assert.doesNotMatch(json, /raw-mic-id/);
  assert.ok(isHashedDeviceId(EXP.input.device.id));
  assert.equal(EXP.input.device.id, hashDeviceId('raw-mic-id-abcdef'));
  assert.equal('deviceId' in EXP.input.constraints.applied, false);
  // The CHOSEN input (requested deviceId, V322) is kept as provenance, hashed like device.id.
  assert.deepEqual(EXP.input.constraints.requested.deviceId,
    { exact: hashDeviceId('raw-mic-id-abcdef') });
  const n = normalizeInput({ device: { id: '' }, constraints: { applied: { deviceId: 'x' } } });
  assert.equal(n.device.id, hashDeviceId('x'));
  // A record that predates the rule is sanitized on export; its v2 hash is re-stamped.
  const legacy = { ...EXP, input: { device: { label: 'USB mic', id: 'raw-mic-id-abcdef' },
    constraints: { requested: null, applied: { echoCancellation: true,
      deviceId: 'raw-mic-id-abcdef' } } } };
  const stamped = withResultHash(legacy, resultHash(legacy));
  assert.equal(sanitizeForExport(EXP).changed, false);
  const out = exportableExperiment(stamped);
  assert.notEqual(out, stamped);
  const text = experimentToJson(out);
  assert.doesNotMatch(text, /raw-mic-id/);
  const v = validateExperiment(text, OPTS);
  assert.ok(v.ok, v.ok ? '' : formatErrors(v.errors));
  assert.equal(exportableExperiment(EXP), EXP, 'a clean record exports as it is');
});

// ---------------------------------------------------------------------------- coordinator notes

test('noise check: 5 s by default in the preset and the field, with the reason in its help',
  async () => {
    const flow = await import('../../src/js/measurement/views/measure-flow.js');
    assert.equal(flow.DEFAULT_NOISE_CHECK_S, 5);
    assert.equal(flow.CHARACTERIZE_PLAYBACK_CHAIN.recipe.analysis.noiseCheckS, 5);
    const field = flow.expertFields({ disclosure: 'advanced' }).groups
      .flatMap((g) => g.fields).find((x) => x.id === 'noiseCheckS');
    assert.equal(field.default, 5);
    assert.match(field.help, /17 Hz for 5 s, 87 Hz for 1 s/);
    assert.match(field.help, /0 skips it/);
    assert.equal(flow.recipeFromFields({}).analysis.noiseCheckS, 5);
    assert.equal(flow.REASON_STEP.ANALYSIS_MEMORY, 'stimulus');
  });

test('IR v2: a missing noise floor reads "not available", never a number', () => {
  const samples = new Float32Array(4800);
  samples[100] = 0.5;
  const v = buildIrView({ algorithm: ALGORITHMS.ir, sampleRate: 48000, samples, peakIndex: 100,
    peakTimeS: 100 / 48000, captureOffsetS: 0, noiseFloorDb: null, window: null },
  { scale: 'db' });
  assert.match(v.summary, /noise tail not available, /);
  assert.ok(v.notes.includes('Noise tail: not available.'));
  assert.ok(v.axes.y.range.every(Number.isFinite));
});

test('m1: smoothing stays inside the reliability and coverage regions (smoothing.js mask)',
  async (t) => {
    const { smoothFractionalOctave } = await import('../../src/js/measurement/smoothing.js');
    const probe = smoothFractionalOctave(Float64Array.from([100, 101]),
      Float64Array.from([0, 10]), 3, { mask: Uint8Array.from([1, 0]) });
    if (!Number.isNaN(probe[1])) {
      t.skip('smoothing.js has no NaN-aware mask option in this tree');
      return;
    }
    const f = logGrid(20, 20000);
    const mag = Float64Array.from(f, (x) => (x < 1000 ? 0 : 20));
    const mask = Uint8Array.from(f, (x) => (x < 1000 ? 1 : 0));
    const src = { transfer: { algorithm: ALGORITHMS.transfer, sampleRate: 48000, frequencies: f,
      magnitudeDb: mag, phaseDeg: null, snrDb: null, validRange: [20, 20000],
      requestedRange: [20, 20000], fftSize: 1 << 18, binHz: 48000 / (1 << 18) },
    quality: { algorithm: 'oscilla.confidence.v2', status: 'USABLE', reasons: [], metrics: {},
      mask: { frequencies: f, reliable: mask, calibrated: new Uint8Array(f.length) } },
    recipe: { stimulus: { f1: 20, f2: 20000 } } };
    const v = buildResponseView(src, { smoothing: 3 });
    const prim = v.series.find((d) => d.id === 'view');
    // The last reliable point (just below 1 kHz) is not pulled up by the unreliable +20 dB.
    assert.equal(prim.values[mask.lastIndexOf(1)], 0);
  });

// ---------------------------------------------------------------------------- m4 CSV, m6 size

test('m4: the CSV reliable column is the quality mask; corrected and IR units are right', () => {
  const t = EXP.results.transfer;
  const opts = transferCsvOptions(EXP, null);
  assert.equal(opts.reliable, EXP.quality.mask.reliable);
  const csv = transferCsv(t, csvMeta(EXP), opts).split('\n');
  assert.ok(csv.includes('# column reliable: 1 = reliable, 0 = not (quality assessment mask)'));
  const head = csv.findIndex((l) => l.startsWith('frequency_hz,'));
  const rel = csv.slice(head + 1, head + 1 + t.frequencies.length).map((l) => Number(l
    .split(',')[4]));
  assert.deepEqual(rel, Array.from(EXP.quality.mask.reliable));
  // With the experiment's profile loaded, the corrected magnitude is exported.
  const profile = createFrequencyProfile({ name: 'p', points: [[20, 1], [4000, 1]] });
  const withCal = { ...EXP, calibration: { ...EXP.calibration, frequency: { id: profile.id,
    name: 'p' } } };
  const o2 = transferCsvOptions(withCal, profile);
  assert.equal(o2.correctedDb.length, t.frequencies.length);
  assert.equal(o2.correctedDb[3], t.magnitudeDb[3] - 1);
  assert.equal(transferCsvOptions(withCal, createFrequencyProfile({ points: [[20, 2]] }))
    .correctedDb, undefined, 'another profile is never applied');
  // A mask on another grid is not used as the reliable column.
  const off = { ...EXP, quality: { ...EXP.quality, mask: { ...EXP.quality.mask,
    frequencies: EXP.quality.mask.frequencies.map((f) => f + 1) } } };
  assert.equal(transferCsvOptions(off).reliable, undefined);
  const ir = irCsv(EXP.results.ir, csvMeta(EXP));
  assert.match(ir, /# column amplitude: dimensionless transfer ratio/);
  assert.doesNotMatch(ir, /relative to digital full scale/);
});

test('m6: a file over the import limit is refused before it is read', async () => {
  let read = false;
  const huge = { name: 'big.json', size: 64 * 2 ** 20,
    get text() { read = true; return ''; } };
  await assert.rejects(readFileText(huge, { maxBytes: 32 * 2 ** 20, what: '"big.json"' }),
    (e) => e instanceof FileTooLargeError && /"big\.json" is 64\.0 MiB, larger than the 32\.0 MiB/
      .test(e.message));
  assert.equal(read, false);
});
