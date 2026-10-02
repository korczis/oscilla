// V3 MEASURE / EXPERIMENTS view models (src/js/measurement/views/*.js) built from REAL results:
// the pipeline fixtures of v3-pipeline.test.mjs (a rendered log sweep through a synthetic
// system — RBJ low-pass 4 kHz + delay + seeded white noise at 30 dB SNR — checkCapture, align,
// computeTransfer, computeImpulseResponse, aggregateRuns, assessQuality, calibration profiles,
// experiments) and the event streams of the real MeasurementEngine driven by a fake io (the
// pattern of v3-engine.test.mjs). Nothing in the views is hand-built to match an assertion.
//
// Asserted: labels (no "SPL" anywhere in a view without a valid level calibration; "dB SPL"
// with CALIBRATED only with one, and only for LEVELS, never a transfer ratio; SMOOTHED /
// NORMALIZED present whenever derived), unreliable segments split exactly at mask edges,
// cursor formatting at the local resolution, summaries equal to the data, announcements once
// per stage, flow statuses for blocked / warn preflight, the compare delta refused outside the
// overlap of the valid ranges and for non-equivalent experiments.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import { renderStimulus } from '../../src/js/measurement/stimulus.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import { align } from '../../src/js/measurement/align.js';
import { computeTransfer } from '../../src/js/measurement/transfer.js';
import { computeImpulseResponse } from '../../src/js/measurement/impulse-response.js';
import { aggregateRuns, aggregateResult } from '../../src/js/measurement/aggregate.js';
import { assessQuality, maskRuns, summarizeQuality } from '../../src/js/measurement/quality.js';
import { welch } from '../../src/js/measurement/spectrum.js';
import {
  bandCenters, bandPowers, rtaResult, createRtaAverager, integrateBands, meanSquarePower,
} from '../../src/js/measurement/rta.js';
import { formatFrequencyWithResolution } from '../../src/js/measurement/format.js';
import { displayStepHz } from '../../src/js/analysis/peak-detector.js';
import {
  createMeasurementEngine, assessMeasurement, validateRecipe, MEASUREMENT_LEVELS,
} from '../../src/js/measurement/engine.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import {
  createLevelCalibration, RELATIVE_UNIT, RELATIVE_SCALE_LABEL,
} from '../../src/js/calibration/level.js';
import {
  applyFrequencyCorrection, applyFrequencyCorrectionToBands,
} from '../../src/js/calibration/interpolate.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import { createMemoryStore } from '../../src/js/experiments/store.js';
import { TRANSFER_RATIO_UNIT } from '../../src/js/experiments/csv.js';
import { mulberry32 } from '../../src/js/audio/noise.js';

import * as common from '../../src/js/measurement/views/common.js';
import {
  buildResponseView, RATIO_NOT_LEVEL_NOTE,
} from '../../src/js/measurement/views/response-chart.js';
import { buildIrView } from '../../src/js/measurement/views/ir-chart.js';
import { buildRtaView } from '../../src/js/measurement/views/rta-chart.js';
import {
  initialQualityBar, reduceQualityBar, qualityBarView, qualityPanel, QUALITY_BAR_ITEMS,
} from '../../src/js/measurement/views/quality-bar.js';
import { announce, ANNOUNCEMENTS } from '../../src/js/measurement/views/announcements.js';
import {
  measureFlow, expertFields, recipeFromFields, CHARACTERIZE_PLAYBACK_CHAIN,
  OUTPUT_LEVEL_CHOICES, safetyNotes, FLOW_STEPS,
} from '../../src/js/measurement/views/measure-flow.js';
import {
  experimentSummary, experimentListRows,
} from '../../src/js/measurement/views/experiment-summary.js';
import { buildCompareView } from '../../src/js/measurement/views/compare-view.js';

const SR = 48000;
const F1 = 20;
const F2 = 20000;
const SWEEP_S = 1.5;
const PRE = Math.round(0.25 * SR);
const POST = Math.round(0.5 * SR);
const DELAY = 590;
const FC = 4000;
const SNR_DB = 30;
const RUNS = 3;
const NOW = '2026-10-02T10:00:00.000Z';
const BUILD = Object.freeze({
  version: '3.0.0-test', commit: 'abc1234def5678abc1234def5678abc1234def56',
  shortCommit: 'abc1234', sourceDate: '2026-10-01T00:00:00Z', channel: 'test', dirty: false,
  repository: null,
});
const bytes = (seed) => Uint8Array.from({ length: 16 }, (_, i) => (seed * 37 + i * 11) & 255);

// ----------------------------------------------------------------------------- helpers

/** Every string reachable in a view (values and keys; typed arrays and functions skipped). */
function strings(x, out = [], seen = new Set()) {
  if (typeof x === 'string') out.push(x);
  else if (x && typeof x === 'object' && !ArrayBuffer.isView(x) && !seen.has(x)) {
    seen.add(x);
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      strings(v, out, seen);
    }
  }
  return out;
}
const allText = (...views) => views.flatMap((v) => strings(v)).join('\n');

// ----------------------------------------------------------------------------- system

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

function lowPass(fc, q, sr) {
  const w = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0],
    a: [1, (-2 * c) / a0, (1 - alpha) / a0] };
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

const COEF = lowPass(FC, Math.SQRT1_2, SR);

/** One sweep configuration through the synthetic system: stimulus, runs, aggregate. */
function measureSystem({ f1 = F1, f2 = F2, seconds = SWEEP_S, seed = 0, runs = RUNS } = {}) {
  const stim = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: seconds, f1, f2,
    level: 0.5 });
  const len = PRE + stim.samples.length + POST;
  const placed = new Float64Array(len);
  for (let i = 0; i < stim.samples.length; i++) placed[PRE + DELAY + i] = stim.samples[i];
  const clean = biquad(COEF, placed);
  let s = 0;
  for (let i = 0; i < stim.samples.length; i++) s += clean[PRE + DELAY + i] ** 2;
  const sigma = Math.sqrt(s / stim.samples.length) / 10 ** (SNR_DB / 20);
  const list = Array.from({ length: runs }, (_, r) => {
    const noise = gaussian(1000 + seed * 100 + r, len, sigma);
    const captured = new Float32Array(len);
    for (let i = 0; i < len; i++) captured[i] = clean[i] + noise[i];
    const noiseCapture = Float32Array.from(gaussian(5000 + seed * 100 + r, len, sigma));
    const check = checkCapture({ sampleRate: SR, samples: captured, preRoll: 0.25,
      postRoll: 0.5, startedAt: 0 });
    const alignment = align(stim.samples, captured, SR, { maxLagS: 0.5 });
    const transfer = computeTransfer({ stimulus: stim.samples, captured, sampleRate: SR,
      f1: stim.spec.f1, f2: stim.spec.f2, noise: noiseCapture, alignment });
    const ir = r === 0 ? computeImpulseResponse({ stimulus: stim.samples, captured,
      sampleRate: SR, f1: stim.spec.f1, f2: stim.spec.f2, lagSamples: alignment.lagSamples })
      : null;
    return { check, alignment, transfer, ir };
  });
  const aggregate = aggregateRuns(list.map((r) => r.transfer.magnitudeDb));
  return { stim, runs: list, aggregate };
}

const SYS = measureSystem();
const T0 = SYS.runs[0].transfer;
// The engine combines repeated runs the same way: magnitude = aggregate centre, SNR = the worst
// run per point, valid range = where every run is valid (engine.js combineTransfers).
const COMBINED = (() => {
  const ts = SYS.runs.map((r) => r.transfer);
  const snrDb = new Float64Array(T0.snrDb.length);
  for (let i = 0; i < snrDb.length; i++) snrDb[i] = Math.min(...ts.map((t) => t.snrDb[i]));
  const lo = Math.max(...ts.map((t) => t.validRange[0]));
  const hi = Math.min(...ts.map((t) => t.validRange[1]));
  return { ...T0, magnitudeDb: SYS.aggregate.centreDb, phaseDeg: null, snrDb,
    validRange: [lo, hi], runs: RUNS, aggregation: 'mean' };
})();
// A chain note marks everything above 12 kHz unreliable: a guaranteed mask edge inside the
// measured range (quality.js v2, OUTPUT_CHAIN_DEVIATION).
const CHAIN = { limiterDeviationAboveHz: 12000 };
const QUALITY = assessQuality({ capture: SYS.runs.map((r) => r.check), transfer: COMBINED,
  aggregate: SYS.aggregate, calibration: { frequency: null, level: null }, chainNotes: CHAIN });
/** The engine-result shape (engine.js measure()) from the real pieces. */
const RESULT = {
  state: S.COMPLETE, sampleRate: SR, recipe: { stimulus: SYS.stim.spec, repeats: RUNS },
  transfer: COMBINED, ir: SYS.runs[0].ir, aggregate: SYS.aggregate,
  calibrated: { frequency: null, level: null }, quality: QUALITY,
};

const PROFILE = createFrequencyProfile({ name: 'View test microphone',
  points: [[100, 0.5], [1000, 0], [4000, 1], [8000, 2]] });
const LEVEL = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30.5, conditions: 'synthetic', createdAt: '2026-10-02T09:00:00.000Z' });

function calibratedResult() {
  const c = applyFrequencyCorrection(COMBINED.magnitudeDb, COMBINED.frequencies, PROFILE);
  const frequency = { ...c, name: PROFILE.name };
  const quality = assessQuality({ capture: SYS.runs.map((r) => r.check), transfer: COMBINED,
    aggregate: SYS.aggregate, calibration: { frequency, level: null }, chainNotes: CHAIN });
  return { ...RESULT, calibrated: { frequency, level: null }, quality };
}

function experimentOf(sys, quality, { id = 1, name = 'MacBook speakers — desk',
  calibration = null } = {}) {
  const t = sys.runs[0].transfer;
  const recipe = schema.createRecipe({ stimulus: sys.stim.spec, repeats: sys.runs.length,
    analysis: { pointsPerOctave: 48, aggregate: sys.aggregate.method } });
  const created = schema.createExperiment({ recipe, build: BUILD, now: NOW,
    id: schema.newExperimentId(bytes(id)), name, sampleRate: SR, calibration,
    algorithms: { transfer: t.algorithm, ir: ALGORITHMS.ir, align: ALGORITHMS.align,
      clip: ALGORITHMS.clip, discontinuity: ALGORITHMS.discontinuity,
      quality: quality.algorithm, aggregate: ALGORITHMS.aggregate } });
  const measured = schema.withResults(created, {
    startedAt: '2026-10-02T10:00:01.000Z',
    runs: sys.runs.map((r, index) => ({ index, alignment: { algorithm: r.alignment.algorithm,
      lagSamples: r.alignment.lagSamples, peakCorrelation: r.alignment.peakCorrelation,
      polarity: r.alignment.polarity } })),
    quality,
    results: { transfer: null, ir: sys.runs[0].ir, rta: null,
      aggregate: aggregateResult(sys.aggregate, t.frequencies) },
  });
  const c = hash.withConfigHash(measured, hash.configHash(measured));
  return hash.withResultHash(c, hash.resultHash(c));
}

const EXP_A = experimentOf(SYS, QUALITY);

// ----------------------------------------------------------------------------- fake engine io

function createFakeIo({ system = (x) => biquad(COEF, x), noiseAmp = 1e-4, facts = {},
  hooks = {} } = {}) {
  let t = 1;
  let epoch = 0;
  const rng = mulberry32(99);
  const rnd = () => rng() - 0.5;
  const chunkS = 0.05;
  const io = {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted',
        input: { ok: true, device: { label: null, id: null }, constraints: {
          requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } } },
        inputLevel: { peak: 0.001, rmsDb: -80 },
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' }, ...facts };
    },
    async captureNoise(seconds, { onScheduled, onChunk } = {}) {
      const cs = t + 0.04;
      const frames = Math.round(seconds * SR);
      onScheduled && onScheduled({ captureStartAt: cs, captureEndAt: cs + seconds });
      await advance(cs, cs + seconds, frames, onChunk);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = noiseAmp * rnd();
      return { sampleRate: SR, samples, preRoll: 0, postRoll: 0, startedAt: cs,
        constraints: { requested: null, applied: null }, device: { label: null, id: null } };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled, onChunk } = {}) {
      const cs = Math.max(t + 0.04, notBefore == null ? -Infinity : notBefore);
      const n = stimulus.samples.length;
      const ss = cs + preRollS;
      const se = ss + n / SR;
      const ce = se + postRollS;
      const frames = Math.round((ce - cs) * SR);
      onScheduled && onScheduled({ captureStartAt: cs, stimulusStartAt: ss, stimulusEndAt: se,
        captureEndAt: ce });
      await advance(cs, ce, frames, onChunk);
      const x = new Float64Array(frames);
      const off = Math.round(preRollS * SR) + 123;
      for (let i = 0; i < n && off + i < frames; i++) x[off + i] = stimulus.samples[i];
      const y = system(x);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = Math.max(-1, Math.min(1, y[i]
        + noiseAmp * rnd()));
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt: cs,
        stimulusStartAt: ss, constraints: { requested: {}, applied: { echoCancellation: false,
          noiseSuppression: false, autoGainControl: false } }, device: { label: null, id: null },
        integrity: { expectedFrames: frames, receivedFrames: frames, discontinuities: 0 } };
    },
    cancel() { epoch += 1; },
    dispose() {},
    async yield() {},
  };
  async function advance(from, to, frames, onChunk) {
    const my = epoch;
    while (t < to - 1e-12) {
      await null;
      if (epoch !== my) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' });
      t = Math.min(to, Math.max(t, from - 0.04) + chunkS);
      onChunk && onChunk({ frames: Math.max(0, Math.min(frames, Math.round((t - from) * SR))),
        framesTotal: frames });
      if (hooks.tick) await hooks.tick();
    }
  }
  return io;
}

function engineRecipe(over = {}) {
  return { stimulus: { kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000,
    ...(over.stimulus || {}) }, repeats: over.repeats ?? 1,
  analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0.2,
    ...(over.analysis || {}) } };
}

function makeEngine(ioOpts = {}) {
  const events = [];
  const io = createFakeIo(ioOpts);
  const engine = createMeasurementEngine({ io, onEvent: (e) => events.push(e),
    assess: assessMeasurement });
  return { io, engine, events };
}

// Real engine runs shared by several tests (computed once).
const RUN_OK = (async () => {
  const m = makeEngine();
  const result = await m.engine.measure(engineRecipe({ repeats: 3 }));
  return { ...m, result };
})();
const RUN_CLIP = (async () => {
  const m = makeEngine({ system: (x) => Float64Array.from(x, (v) => 8 * v) });
  const result = await m.engine.measure(engineRecipe({ repeats: 2 }));
  return { ...m, result };
})();

// ----------------------------------------------------------------------------- response chart

test('response view: RAW primary, ratio axis, no SPL anywhere without level calibration',
  () => {
    const v = buildResponseView(RESULT);
    assert.equal(v.primary, 'raw');
    assert.equal(v.axes.y.unit, TRANSFER_RATIO_UNIT);
    assert.equal(v.axes.x.scale, 'log');
    assert.deepEqual(v.axes.x.uplot, { distr: 3, log: 10 });
    assert.ok(v.badges.includes('UNCALIBRATED'));
    assert.ok(v.series.every((s) => s.values.length === v.x.length));
    const ids = v.series.map((s) => s.id);
    assert.deepEqual(ids, ['envelope-upper', 'envelope-lower', 'raw', 'raw-unreliable']);
    assert.equal(v.bands.length, 1, 'three runs: a spread band');
    assert.match(v.series.find((s) => s.id === 'raw').label, /RAW · OBSERVED · mean of 3 runs/);
    const readouts = Array.from({ length: 20 }, (_, k) => v.readout(Math.floor(k
      * (v.x.length - 1) / 19)));
    assert.doesNotMatch(allText(v, readouts), /SPL/);
    // The y range holds every drawn value.
    const e = common.extent(v.series.map((s) => s.values));
    assert.ok(v.axes.y.range[0] <= e[0] && v.axes.y.range[1] >= e[1]);
  });

test('response view: SMOOTHED and NORMALIZED labels whenever derived; RAW kept', () => {
  const before = Float64Array.from(COMBINED.magnitudeDb);
  const sm = buildResponseView(RESULT, { smoothing: 6 });
  const view = sm.series.find((s) => s.id === 'view');
  assert.equal(view.kind, 'SMOOTHED');
  assert.match(view.label, /SMOOTHED: 1\/6 octave/);
  assert.equal(view.derivation.smoothing.algorithm, ALGORITHMS.smoothing);
  assert.ok(sm.badges.includes('SMOOTHED'));
  assert.ok(sm.series.some((s) => s.id === 'raw' && s.alpha < 1), 'RAW kept as context');

  const nm = buildResponseView(RESULT, { normalization: { mode: 'at-frequency', hz: 1000 } });
  assert.equal(nm.axes.y.kind, 'NORMALIZED');
  assert.match(nm.axes.y.label, /NORMALIZED/);
  for (const s of nm.series) assert.match(s.label, /NORMALIZED/, s.id);
  assert.ok(nm.badges.includes('NORMALIZED'));
  // 0 dB at 1 kHz on the normalized curve (interpolated in log f at the reference).
  const at = common.interpLogF(nm.x, nm.series.find((s) => s.id === 'view')
    .values.map((x, i) => x ?? nm.series.find((q) => q.id === 'view-unreliable').values[i]),
  1000);
  assert.ok(Math.abs(at) < 1e-9, `${at}`);
  // RAW context is the raw magnitude shifted by the same reference, never modified.
  const ref = nm.series.find((s) => s.id === 'view').derivation.normalization.referenceDb;
  const raw = nm.series.find((s) => s.id === 'raw');
  raw.values.forEach((x, i) => {
    if (x !== null) assert.ok(Math.abs(x - (COMBINED.magnitudeDb[i] - ref)) < 1e-9);
  });
  assert.deepEqual(COMBINED.magnitudeDb, before, 'source not mutated');
  assert.match(nm.readoutAt(1000).lines.join(' '), /NORMALIZED: 0 dB at 1 kHz/);
  assert.doesNotMatch(allText(sm, nm), /SPL/);
});

test('response view: unreliable segments split exactly at the quality mask edges', () => {
  const v = buildResponseView(RESULT);
  const mask = QUALITY.mask.reliable;
  const rel = v.series.find((s) => s.id === 'raw');
  const unrel = v.series.find((s) => s.id === 'raw-unreliable');
  assert.equal(rel.dash, null);
  assert.deepEqual(unrel.dash, [4, 4]);
  assert.ok(unrel.alpha < rel.alpha, 'faded and dashed: not colour alone');
  const runs = maskRuns(mask);
  assert.ok(runs.length >= 1 && mask.includes(0), 'the chain note leaves unreliable points');
  let edges = 0;
  for (let i = 0; i < mask.length; i++) {
    const drawable = common.isDrawable(COMBINED.magnitudeDb[i]);
    const nextToUnreliable = (i > 0 && !mask[i - 1]) || (i < mask.length - 1 && !mask[i + 1]);
    assert.equal(rel.values[i] !== null, !!mask[i] && drawable, `reliable @${i}`);
    assert.equal(unrel.values[i] !== null, drawable && (!mask[i] || nextToUnreliable),
      `unreliable @${i}`);
    if (mask[i] && nextToUnreliable) {
      edges++;
      assert.equal(rel.values[i], unrel.values[i], 'the edge point joins both');
    }
  }
  assert.ok(edges >= 1);
  // Above the 12 kHz chain note nothing is drawn solid.
  v.x.forEach((f, i) => { if (f > 12000) assert.equal(rel.values[i], null); });
  assert.ok(v.markers.unreliableRanges.some(([lo, hi]) => lo <= 12100 && hi > 12000));
  assert.ok(v.notes.some((n) => /Dashed, faded stretches are unreliable/.test(n)));
  // splitByMask segments are the mask runs.
  const split = common.splitByMask(COMBINED.magnitudeDb, mask);
  assert.deepEqual(split.segments.filter((s) => s.reliable).map((s) => [s.from, s.to]), runs);
});

test('response view: cursor readout at the local resolution, RAW and CALIBRATED, SNR', () => {
  const v = buildResponseView(RESULT);
  for (const hz of [31.5, 1000, 4000, 15000]) {
    const r = v.readoutAt(hz);
    const i = r.index;
    const res = common.gridResolutionHz(v.x, i, COMBINED.binHz);
    assert.ok(res >= COMBINED.binHz && res > 0);
    assert.equal(r.frequency.text, formatFrequencyWithResolution(v.x[i], res));
    // No digit finer than the resolution's power-of-ten step.
    const step = displayStepHz(res);
    const m = /^([\d.]+) (k?Hz)$/.exec(r.frequency.text);
    const value = Number(m[1]) * (m[2] === 'kHz' ? 1000 : 1);
    const decimals = (m[1].split('.')[1] || '').length;
    const unitStep = m[2] === 'kHz' ? step / 1000 : step;
    assert.equal(decimals, Math.max(0, -Math.round(Math.log10(unitStep))), r.frequency.text);
    assert.ok(Math.abs(value - v.x[i]) <= step / 2 + 1e-9, `${r.frequency.text} vs ${v.x[i]}`);
    assert.equal(r.corrected, 'UNCALIBRATED');
    assert.match(r.snr, /^−?\d+ dB$|^NOT MEASURED$/);
    assert.match(r.spread, /^±[\d.]+ dB \(3 runs\)$/);
    assert.equal(r.reliability, QUALITY.mask.reliable[i] ? 'reliable' : 'unreliable');
  }
  // A coarser resolution prints fewer digits: 18437.238194 Hz at 5.86 Hz vs at 46.9 Hz.
  assert.equal(formatFrequencyWithResolution(18437.238194, 5.86), '18.437 kHz');
  assert.equal(formatFrequencyWithResolution(18437.238194, 46.9), '18.44 kHz');
  assert.equal(v.readout(-1), null);
  assert.equal(v.readout(v.x.length), null);
});

test('response view: the summary equals the extremes of the reliable data', () => {
  const v = buildResponseView(RESULT);
  const mask = QUALITY.mask.reliable;
  let hi = -1;
  let lo = -1;
  COMBINED.magnitudeDb.forEach((x, i) => {
    if (!mask[i] || !common.isDrawable(x)) return;
    if (hi < 0 || x > COMBINED.magnitudeDb[hi]) hi = i;
    if (lo < 0 || x < COMBINED.magnitudeDb[lo]) lo = i;
  });
  const expected = `maximum ${common.ratioDbText(COMBINED.magnitudeDb[hi])} at `
    + `${common.gridFrequencyText(v.x, hi, COMBINED.binHz)}, minimum `
    + `${common.ratioDbText(COMBINED.magnitudeDb[lo])} at `
    + `${common.gridFrequencyText(v.x, lo, COMBINED.binHz)}, measurement quality: `
    + `${QUALITY.status.toLowerCase()}.`;
  assert.ok(v.summary.startsWith('Frequency response (observed, uncalibrated): '), v.summary);
  assert.ok(v.summary.endsWith(expected), `${v.summary}\n${expected}`);
  // The 4 kHz low-pass: the maximum is in the pass band, the minimum near the reliable top.
  assert.ok(v.x[hi] < FC && v.x[lo] > FC);
  assert.ok(v.summary.length < 200, 'never lists points');
});

test('response view: CALIBRATED only where the profile covers; coverage stated (§158)', () => {
  const r = calibratedResult();
  const v = buildResponseView(r);
  assert.equal(v.primary, 'corrected');
  assert.ok(v.badges.includes('CALIBRATED (frequency)'));
  const cov = r.calibrated.frequency.covered;
  const corr = v.series.find((s) => s.id === 'corrected');
  const corrU = v.series.find((s) => s.id === 'corrected-unreliable');
  v.x.forEach((f, i) => {
    if (!cov[i]) {
      assert.equal(corr.values[i], null);
      assert.equal(corrU.values[i], null);
    }
  });
  const raw = v.series.find((s) => s.id === 'raw');
  assert.ok(raw.values.some((x, i) => x !== null && !cov[i]), 'RAW still shows uncovered');
  assert.match(v.markers.calibratedRange.label,
    /^calibrated 100 Hz–8\.0+ kHz, uncalibrated below 100 Hz, uncalibrated above 8\.0+ kHz/);
  assert.ok(v.notes.includes(v.markers.calibratedRange.label));
  assert.match(v.readoutAt(15000).corrected, /not covered/);
  const inside = v.readoutAt(1000);
  assert.equal(inside.calibrated, true);
  assert.equal(inside.corrected, common.ratioDbText(r.calibrated.frequency.correctedDb[
    inside.index]));
  // A valid level calibration never turns the ratio into dB SPL.
  const withLevel = buildResponseView(r, { levelCalibration: LEVEL });
  assert.ok(withLevel.notes.includes(RATIO_NOT_LEVEL_NOTE));
  assert.doesNotMatch(allText(withLevel), /dB SPL/);
  assert.equal(withLevel.axes.y.unit, TRANSFER_RATIO_UNIT);
});

test('response view from an experiment: profile needed for CALIBRATED, else UNAVAILABLE', () => {
  const e = experimentOf(SYS, QUALITY, { id: 7, calibration: { frequency: PROFILE, level: null } });
  const without = buildResponseView(e);
  assert.equal(without.primary, 'raw');
  assert.ok(without.notes.some((n) => /is not loaded: the CALIBRATED curve is UNAVAILABLE/
    .test(n)));
  const withProfile = buildResponseView(e, { profile: PROFILE });
  assert.equal(withProfile.primary, 'corrected');
  const wrong = buildResponseView(e, { profile: createFrequencyProfile({ name: 'other',
    points: [[20, 0], [20000, 0]] }) });
  assert.equal(wrong.primary, 'raw', 'a different profile id is never applied');
  // The aggregate-only experiment reads its resolution and validity from the quality metrics.
  const plain = buildResponseView(EXP_A);
  assert.equal(plain.reliability.source, 'quality');
  assert.doesNotMatch(allText(without, plain), /SPL/);
});

test('response view: INVALID is not authoritative; no quality → reliability not assessed', () => {
  const invalid = buildResponseView({ ...RESULT, quality: { ...QUALITY, status: 'INVALID' } });
  assert.equal(invalid.authoritative, false);
  assert.ok(invalid.badges.some((b) => /INVALID/.test(b)));
  assert.ok(invalid.series.every((s) => s.alpha <= 0.45));
  const noQ = buildResponseView({ ...RESULT, quality: null });
  assert.equal(noQ.reliability.source, 'validRange');
  assert.match(noQ.summary, /measurement quality: not assessed\.$/);
  const bare = buildResponseView({ ...RESULT, quality: null,
    transfer: { ...COMBINED, validRange: null } });
  assert.equal(bare.reliability.source, 'none');
  assert.ok(bare.series.find((s) => s.id === 'raw').values.every((x) => x === null),
    'nothing drawn solid when reliability is unknown');
  assert.equal(buildResponseView({ transfer: null, aggregate: null }), null);
});

// ----------------------------------------------------------------------------- IR chart

test('IR view: ms re the direct peak, absolute offset kept, window non-destructive', () => {
  const ir = SYS.runs[0].ir;
  const copy = Float32Array.from(ir.samples);
  const v = buildIrView(ir, { window: [-1, 20] });
  const zero = v.x.indexOf(0);
  assert.ok(zero >= 0, 'the peak sample is at 0 ms');
  assert.equal(v.series[0].values[zero], ir.samples[ir.peakIndex]);
  assert.equal(v.origin.absolutePeakS, ir.captureOffsetS + ir.peakTimeS);
  assert.ok(Math.abs(v.origin.absolutePeakS * SR - (PRE + DELAY)) <= 4);
  assert.equal(v.axes.x.unit, 'ms');
  assert.equal(v.windowRegion.startIndex, Math.round((ir.peakTimeS - 0.001) * SR));
  assert.match(v.windowRegion.label, /view only/);
  assert.deepEqual(ir.samples, copy, 'IR never cropped or modified');
  assert.ok(v.decimation.points <= 4000 + 1);
  // Decimation keeps the extremes.
  const max = Math.max(...v.series[0].values);
  assert.equal(max, Math.max(...ir.samples));
  assert.match(v.summary, /^Impulse response: direct peak \d+\.\d{2} ms after the capture start/);
  assert.match(v.summary, /original scale/);
  assert.doesNotMatch(allText(v), /SPL|NORMALIZED/);
});

test('IR view: dB and normalized views are labelled NORMALIZED', () => {
  const ir = SYS.runs[0].ir;
  const n = buildIrView(ir, { scale: 'db', normalize: true });
  assert.equal(n.series[0].kind, 'NORMALIZED');
  assert.match(n.series[0].label, /NORMALIZED: dB re IR peak/);
  assert.ok(n.badges.includes('NORMALIZED'));
  assert.equal(n.axes.y.range[1], 0);
  assert.equal(Math.max(...n.series[0].values.filter((x) => x !== null)), 0);
  const lin = buildIrView(ir, { normalize: true });
  assert.match(lin.axes.y.label, /NORMALIZED: relative amplitude \(peak = 1\.0\)/);
  assert.equal(Math.max(...lin.series[0].values.map(Math.abs)), 1);
  assert.match(n.summary, /display NORMALIZED/);
  assert.equal(buildIrView(null), null);
});

// ----------------------------------------------------------------------------- RTA chart

const PINK = renderStimulus({ kind: 'pink', sampleRate: SR, duration: 3, level: 0.5, seed: 11 });
const RTA_FFT = 8192;
const RTA_BIN = SR / RTA_FFT;
const SPECTRUM = welch(PINK.samples, { fftSize: RTA_FFT, window: 'hann' });

test('RTA view: bars are the band power over the band edges; relative unless calibrated', () => {
  const bands = bandCenters('third', 25, 16000, SR);
  const levels = bandPowers(SPECTRUM, RTA_BIN, bands);
  const rta = rtaResult({ sampleRate: SR, resolution: 'third', bands, levelsDb: levels,
    fftSize: RTA_FFT, window: SPECTRUM.window });
  const v = buildRtaView({ rta, binHz: RTA_BIN, averaging: { mode: 'fast' } });
  assert.equal(v.mode, 'third');
  assert.equal(v.bars.length, bands.length);
  v.bars.forEach((b, i) => {
    assert.equal(b.lo, bands[i].lo);
    assert.equal(b.hi, bands[i].hi);
    assert.equal(b.value, rta.levelsDb[i]);
  });
  assert.ok(v.bars[0].underResolved, '25 Hz third-octave spans < 2 bins at 5.86 Hz');
  assert.equal(v.bars.at(-1).underResolved, false);
  assert.equal(v.axes.y.label, RELATIVE_SCALE_LABEL);
  assert.equal(v.axes.y.unit, RELATIVE_UNIT);
  assert.ok(v.badges.includes('UNCALIBRATED'));
  assert.match(v.notes.join(' '), /not IEC-verified/);
  let hi = v.bars[0];
  for (const b of v.bars) if (b.value > hi.value) hi = b;
  assert.ok(v.summary.includes(`highest band ${hi.nominal >= 1000 ? `${hi.nominal / 1000}`
    : hi.nominal}`), v.summary);
  assert.ok(v.summary.includes(hi.text));
  assert.doesNotMatch(allText(v), /SPL/);

  // Octave bands integrate the same spectrum: band power is additive (three thirds = one
  // octave within rounding), so the octave bar equals the power sum of its thirds.
  const oct = bandCenters('octave', 31.5, 8000, SR);
  const ov = buildRtaView({ rta: rtaResult({ sampleRate: SR, resolution: 'octave', bands: oct,
    levelsDb: bandPowers(SPECTRUM, RTA_BIN, oct) }) });
  assert.equal(ov.mode, 'octave');
  const ms = meanSquarePower(SPECTRUM);
  const thirds = bandCenters('third', 800, 1250, SR);
  const sum = integrateBands(ms, RTA_BIN, thirds).reduce((a, b) => a + b, 0);
  const kHz = ov.bars.find((b) => b.nominal === 1000);
  assert.ok(Math.abs(kHz.value - 10 * Math.log10(sum)) < 0.01, `${kHz.value}`);
});

test('RTA view: peak hold, freeze, dB SPL only under a valid level calibration', () => {
  const bands = bandCenters('third', 25, 16000, SR);
  const avg = createRtaAverager({ mode: 'slow', peakHold: true });
  const ms = meanSquarePower(SPECTRUM);
  const p = integrateBands(ms, RTA_BIN, bands);
  avg.push(p, 0.1);
  const louder = p.map((x) => x * 4);
  let out = avg.push(louder, 0.1);
  avg.freeze();
  out = avg.push(p.map(() => 0), 0.1);
  const rta = rtaResult({ sampleRate: SR, resolution: 'third', bands, levelsDb: out.levelsDb });
  const v = buildRtaView({ rta, peakDb: out.peakDb, frozen: avg.frozen, averaging: avg });
  assert.ok(v.badges.includes('FROZEN'));
  assert.match(v.summary, /; frozen\.$/);
  assert.equal(v.peaks.length, bands.length);
  v.peaks.forEach((pk) => assert.ok(pk.value >= v.bars[pk.index].value - 1e-9));
  assert.deepEqual(v.peaks[0].dash, [3, 3]);
  assert.doesNotMatch(allText(v), /SPL/);

  const cal = buildRtaView({ rta, levelCalibration: LEVEL,
    correction: applyFrequencyCorrectionToBands(rta, PROFILE, { power: SPECTRUM,
      binHz: RTA_BIN }) });
  assert.ok(cal.badges.includes('CALIBRATED'));
  assert.equal(cal.axes.y.unit, 'dB SPL');
  assert.match(cal.summary, /dB SPL/);
  const b1k = cal.bars.find((b) => b.nominal === 1000);
  assert.equal(b1k.covered, true);
  assert.ok(Math.abs(b1k.value - (b1k.rawDb + LEVEL.offsetDb)) < 0.05,
    'profile ~0 dB at 1 kHz; the offset makes it dB SPL');
  assert.equal(cal.bars[0].covered, false, '25 Hz outside the 100 Hz-8 kHz profile');
  assert.match(cal.notes.join(' '), /no extrapolation/);
  // An invalid level calibration is not applied.
  const bad = buildRtaView({ rta, levelCalibration: { ...LEVEL, offsetDb: LEVEL.offsetDb + 1 } });
  assert.doesNotMatch(allText(bad), /SPL/);
});

// ----------------------------------------------------------------------------- quality

test('quality panel: status with ordered reasons, ✓/!/✗ glyphs, no colour-only meaning', () => {
  const p = qualityPanel(QUALITY);
  assert.equal(p.status, QUALITY.status);
  assert.equal(p.summary, summarizeQuality(QUALITY));
  assert.equal(p.reasons.length, QUALITY.reasons.length);
  p.reasons.forEach((r, i) => {
    assert.equal(r.code, QUALITY.reasons[i].code);
    assert.equal(r.glyph, { ok: '✓', warn: '!', fail: '✗' }[QUALITY.reasons[i].severity]);
    assert.ok(r.icon && r.shape && r.text);
    assert.equal(r.line, `${r.glyph} ${r.text}`);
  });
  assert.ok(p.reasons.some((r) => r.code === 'OUTPUT_CHAIN_DEVIATION' && r.glyph === '!'));
  assert.ok(p.groups.calibration.every((r) => r.scope === 'calibration'));
  assert.ok(p.metrics.find((m) => m.id === 'level').text === 'UNCALIBRATED');
  assert.doesNotMatch(allText(p), /SPL/);
  const none = qualityPanel(null);
  assert.equal(none.statusText, 'NOT ASSESSED');
  const shapes = new Set(Object.values(common.STATUS_PRESENTATION).map((s) => s.shape));
  assert.equal(shapes.size, Object.keys(common.STATUS_PRESENTATION).length, 'one shape each');
});

test('quality bar: INPUT / NOISE / CLIPPING / SIGNAL / CAPTURE from real engine events',
  async () => {
    const { events, result } = await RUN_OK;
    assert.equal(result.state, S.COMPLETE, JSON.stringify(result.reasons));
    let st = initialQualityBar();
    const captureTexts = [];
    for (const e of events) {
      st = reduceQualityBar(st, e);
      const c = qualityBarView(st).items.find((x) => x.id === 'capture');
      if (/%$/.test(c.value)) captureTexts.push(Number(c.value.replace(' %', '')));
    }
    const view = qualityBarView(st);
    assert.deepEqual(view.items.map((i) => i.id), QUALITY_BAR_ITEMS);
    const by = Object.fromEntries(view.items.map((i) => [i.id, i]));
    assert.equal(by.input.text, 'INPUT OK');
    assert.equal(by.noise.text, 'NOISE GOOD');
    assert.equal(by.clipping.text, 'CLIPPING NONE');
    assert.equal(by.signal.text, 'SIGNAL RECEIVED');
    assert.equal(by.capture.text, 'CAPTURE COMPLETE');
    for (const i of view.items) assert.ok(i.glyph && i.icon && i.shape && i.className, i.id);
    assert.ok(captureTexts.length > 10, 'CAPTURE n % while measuring');
    for (let k = 1; k < captureTexts.length; k++) assert.ok(captureTexts[k] >= captureTexts[k - 1]);
    assert.doesNotMatch(allText(view), /SPL/);
  });

test('quality bar: clipping fails with shape and text; live chunks drive SIGNAL', async () => {
  const { events } = await RUN_CLIP;
  let st = initialQualityBar();
  for (const e of events) st = reduceQualityBar(st, e);
  const clip = qualityBarView(st).items.find((i) => i.id === 'clipping');
  assert.equal(clip.status, 'fail');
  assert.equal(clip.text, 'CLIPPING DETECTED');
  assert.equal(clip.shape, 'osc-q-shape--octagon');
  assert.equal(clip.glyph, '✗');
  // Before any run check the bar never claims "NONE".
  const fresh = qualityBarView(initialQualityBar()).items.find((i) => i.id === 'clipping');
  assert.equal(fresh.text, 'CLIPPING NOT CHECKED YET');
  // A capture chunk carrying live checks (peak, rmsDb) during the sweep.
  let s2 = reduceQualityBar(initialQualityBar(), { type: 'noise', rmsDb: -70, peak: 0.001,
    reasons: [] });
  s2 = reduceQualityBar(s2, { type: 'progress', phase: 'sweep', run: 0, overall: 0.4,
    capture: { frames: 1, framesTotal: 2, peak: 0.3, rmsDb: -25 } });
  const items = Object.fromEntries(qualityBarView(s2).items.map((i) => [i.id, i]));
  assert.equal(items.signal.text, 'SIGNAL ACTIVE');
  assert.equal(items.clipping.text, 'CLIPPING NONE');
  assert.equal(items.capture.text, 'CAPTURE 40 %');
  const s3 = reduceQualityBar(s2, { type: 'progress', phase: 'sweep', run: 0, overall: 0.5,
    capture: { frames: 1, framesTotal: 2, peak: 0.995, rmsDb: -65 } });
  const i3 = Object.fromEntries(qualityBarView(s3).items.map((i) => [i.id, i]));
  assert.equal(i3.clipping.text, 'CLIPPING DETECTED');
  assert.equal(i3.signal.text, 'SIGNAL WEAK');
});

// ----------------------------------------------------------------------------- announcements

test('announcements: one message per stage from a real 3-run measurement, no chatter',
  async () => {
    const { events } = await RUN_OK;
    assert.ok(events.filter((e) => e.type === 'progress').length > 50);
    assert.equal(events.filter((e) => e.type === 'state' && e.to === S.MEASURING).length, 3);
    const msgs = announce(events);
    assert.deepEqual(msgs.map((m) => m.text), [ANNOUNCEMENTS.started, ANNOUNCEMENTS.noise,
      ANNOUNCEMENTS.sweep, ANNOUNCEMENTS.complete]);
    assert.equal(new Set(msgs.map((m) => m.stage)).size, msgs.length);
  });

test('announcements: clipping, stop, error, setup check; a new run re-arms', async () => {
  const { events } = await RUN_CLIP;
  assert.deepEqual(announce(events).map((m) => m.text), [ANNOUNCEMENTS.started,
    ANNOUNCEMENTS.noise, ANNOUNCEMENTS.sweep, 'Measurement invalid due to clipping']);
  assert.equal(announce(events).at(-1).politeness, 'assertive');

  // Abort during the sweep.
  let engine = null;
  let aborted = false;
  const m = makeEngine({ hooks: { tick: () => {
    if (!aborted && engine.state === S.MEASURING) { aborted = true; engine.abort('user'); }
  } } });
  engine = m.engine;
  await assert.rejects(engine.measure(engineRecipe()), (e) => e.code === 'ABORTED');
  assert.deepEqual(announce(m.events).map((x) => x.text), [ANNOUNCEMENTS.started,
    ANNOUNCEMENTS.noise, ANNOUNCEMENTS.sweep, ANNOUNCEMENTS.stopped]);

  // Two measurements in a row: each gets its own stages.
  const m2 = makeEngine();
  await m2.engine.measure(engineRecipe({ analysis: { noiseCheckS: 0 } }));
  await m2.engine.measure(engineRecipe({ analysis: { noiseCheckS: 0 } }));
  const texts = announce(m2.events).map((x) => x.text);
  assert.equal(texts.filter((t) => t === ANNOUNCEMENTS.complete).length, 2);
  assert.equal(texts.filter((t) => t === ANNOUNCEMENTS.sweep).length, 2);

  // A preflight that is ready, and one that is blocked.
  const m3 = makeEngine();
  await m3.engine.preflight(engineRecipe());
  assert.deepEqual(announce(m3.events).map((x) => x.text), [ANNOUNCEMENTS.ready]);
  const m4 = makeEngine({ facts: { permission: 'denied' } });
  await m4.engine.preflight(engineRecipe());
  const blocked = announce(m4.events);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].text, 'Setup check failed: microphone permission denied');
});

// ----------------------------------------------------------------------------- flow

test('flow: blocked preflight blocks its step and offers a new setup check', async () => {
  const m = makeEngine({ facts: { permission: 'denied' } });
  const recipe = engineRecipe();
  const report = await m.engine.preflight(recipe);
  assert.equal(report.ready, false);
  const flow = measureFlow({ state: m.engine.state, preflight: report, recipe });
  assert.deepEqual(flow.steps.map((s) => s.id), FLOW_STEPS.map((s) => s.id));
  const by = Object.fromEntries(flow.steps.map((s) => [s.id, s]));
  assert.equal(by.input.status, 'blocked');
  assert.match(by.input.detail, /permission was denied/);
  assert.equal(flow.current, 'input');
  assert.ok(flow.steps.every((s) => s.status !== 'current'), 'nothing after it is current');
  assert.ok(flow.steps.slice(4).every((s) => s.status === 'todo'));
  assert.equal(flow.primaryAction.id, 'preflight');
  assert.equal(flow.ready, false);
});

test('flow: warnings never block; READY → measure → review → save', async () => {
  const m = makeEngine({ facts: {
    input: { ok: true, device: { label: 'USB mic', id: 'x' },
      constraints: { requested: {}, applied: { echoCancellation: null } } },
    output: { gain: 0.3, maxGain: 0.5, audibleVoices: 0 },
  } });
  const recipe = engineRecipe({ stimulus: { level: 'high' } });
  const report = await m.engine.preflight(recipe);
  assert.equal(report.ready, true);
  const flow = measureFlow({ state: m.engine.state, preflight: report, recipe });
  const by = Object.fromEntries(flow.steps.map((s) => [s.id, s]));
  assert.equal(by.input.status, 'warn');
  assert.ok(by.input.reasons.some((r) => r.code === 'INPUT_PROCESSING'));
  assert.match(by.input.detail, /^USB mic, 48000 Hz$/);
  assert.equal(by.calibration.status, 'done');
  assert.match(by.calibration.detail, /UNCALIBRATED/);
  assert.equal(by.stimulus.status, 'warn');
  assert.ok(by.stimulus.reasons.some((r) => r.code === 'HIGH_OUTPUT'));
  assert.match(by.stimulus.detail, /^20 Hz → 20 kHz log sweep, 1 s, HIGH output, 1 run$/);
  assert.equal(by.noise.status, 'current');
  assert.equal(flow.primaryAction.id, 'measure');
  assert.ok(safetyNotes({ recipe, preflight: report }).some((n) => n.id === 'headphones'));

  const result = await m.engine.measure(recipe);
  assert.equal(result.state, S.COMPLETE);
  const done = measureFlow({ state: m.engine.state, preflight: report, recipe, result });
  const d = Object.fromEntries(done.steps.map((s) => [s.id, s]));
  assert.equal(d.noise.status, 'done');
  assert.match(d.noise.detail, /^Background −\d+\.\d dB relative \(dBFS-like\)$/);
  assert.equal(d.measure.status, 'done');
  assert.ok(['done', 'warn'].includes(d.review.status));
  assert.match(d.review.detail, new RegExp(`Quality ${result.quality.status}`));
  assert.equal(d.save.status, 'current');
  assert.equal(done.primaryAction.id, 'save');
  const saved = measureFlow({ state: m.engine.state, preflight: report, recipe, result,
    saved: true });
  assert.ok(saved.steps.every((s) => s.status === 'done' || s.status === 'warn'));
  assert.equal(saved.primaryAction.id, 'repeat');
});

test('flow: an invalid (clipped) run blocks MEASURE; expert mode can bypass', async () => {
  const { engine, result } = await RUN_CLIP;
  const recipe = engineRecipe({ repeats: 2 });
  const flow = measureFlow({ state: engine.state, preflight: result.preflight, recipe, result });
  const by = Object.fromEntries(flow.steps.map((s) => [s.id, s]));
  assert.equal(by.measure.status, 'blocked');
  assert.ok(by.measure.reasons.some((r) => r.code === 'CLIPPING'));
  assert.equal(by.save.status, 'todo');
  assert.equal(flow.primaryAction.id, 'preflight');
  const expert = measureFlow({ state: S.IDLE, recipe, expert: true });
  assert.equal(expert.canBypass, true);
  assert.equal(expert.primaryAction.id, 'measure');
  assert.equal(measureFlow({ state: S.IDLE, recipe }).primaryAction.id, 'preflight');
  assert.equal(measureFlow({ state: S.MEASURING, recipe }).primaryAction.id, 'stop');
});

test('preset CHARACTERIZE PLAYBACK CHAIN: honest wording, valid recipe, levels not SPL', () => {
  const p = CHARACTERIZE_PLAYBACK_CHAIN;
  assert.equal(p.resultLabel, 'OBSERVED PLAYBACK / CAPTURE CHAIN RESPONSE');
  assert.match(p.description, /observed playback\/capture chain response/);
  assert.doesNotMatch(p.description, /speaker response/i);
  const plan = validateRecipe(p.recipe, { sampleRate: SR });
  assert.equal(plan.stimulusSpec.level, MEASUREMENT_LEVELS.low);
  assert.equal(plan.repeats, 3);
  assert.deepEqual(OUTPUT_LEVEL_CHOICES.map((c) => [c.label, c.value]),
    [['LOW', MEASUREMENT_LEVELS.low], ['MEDIUM', MEASUREMENT_LEVELS.medium],
      ['HIGH', MEASUREMENT_LEVELS.high]]);
  const notes = safetyNotes({ recipe: p.recipe });
  assert.deepEqual(notes.map((n) => n.id), ['conservative', 'stop', 'low-frequency',
    'high-frequency']);
  const basic = expertFields({ sampleRate: SR });
  const adv = expertFields({ disclosure: 'advanced', sampleRate: SR });
  assert.ok(basic.groups.every((g) => g.disclosure === 'basic'));
  assert.ok(basic.hidden > 0 && adv.groups.length > basic.groups.length);
  const f2 = adv.groups[0].fields.find((f) => f.id === 'f2');
  assert.equal(f2.max, 0.95 * SR / 2);
  const r = recipeFromFields({ f1: 50, duration: 5, repeats: 5, level: 'medium',
    noiseCheckS: 0 });
  const plan2 = validateRecipe(r, { sampleRate: SR });
  assert.equal(plan2.stimulusSpec.f1, 50);
  assert.equal(plan2.repeats, 5);
  assert.equal(plan2.timing.noiseCheckS, 0);
  assert.equal(p.recipe.stimulus.f1, 20, 'preset not mutated');
  assert.doesNotMatch(allText(p, OUTPUT_LEVEL_CHOICES, notes, adv), /SPL/);
});

// ----------------------------------------------------------------------------- experiments

test('experiment summary and list rows (§161, §76)', async () => {
  const s = experimentSummary(EXP_A);
  assert.equal(s.compact, 'MacBook speakers — desk · 20 Hz → 20 kHz log sweep, 1.5 s · 3 runs · '
    + `${QUALITY.status}`);
  assert.deepEqual(s.lines, schema.summarizeExperiment(EXP_A));
  assert.ok(s.lines.some((l) => /Calibration: frequency profile none, level UNCALIBRATED/
    .test(l)));
  assert.ok(s.provenance.some((p) => p.label === 'Result hash' && /^[0-9a-f]{12}…$/.test(p.text)));
  assert.doesNotMatch(allText(s), /SPL/);

  const store = createMemoryStore({ knownAlgorithms: ALGORITHMS });
  await store.put(EXP_A);
  const b = experimentOf(SYS, QUALITY, { id: 2, name: 'Second' });
  await store.put(b);
  const list = experimentListRows(await store.list(), { selected: [EXP_A.experimentId] });
  assert.equal(list.rows.length, 2);
  assert.equal(list.canCompare, false);
  const row = list.rows.find((r) => r.id === EXP_A.experimentId);
  assert.equal(row.createdText, '2026-10-02 10:00 UTC');
  assert.equal(row.statusText, QUALITY.status);
  assert.match(row.sizeText, /KiB|MiB/);
  assert.ok(row.actions.some((a) => a.id === 'delete' && a.destructive));
  const both = experimentListRows(await store.list(), { selected: [EXP_A.experimentId,
    b.experimentId] });
  assert.equal(both.canCompare, true);
  assert.match(experimentListRows([]).empty, /No saved experiments/);
});

// ----------------------------------------------------------------------------- compare

const SYS_B = measureSystem({ seed: 3 });
const QUALITY_B = assessQuality({ capture: SYS_B.runs.map((r) => r.check),
  transfer: SYS_B.runs[0].transfer, aggregate: SYS_B.aggregate,
  calibration: { frequency: null, level: null } });
const EXP_B = experimentOf(SYS_B, QUALITY_B, { id: 3, name: 'Same chain, second session' });

test('compare: equivalent experiments overlay RAW; A − B only over the valid overlap', () => {
  const v = buildCompareView([EXP_A, EXP_B]);
  assert.equal(v.compatible, true, v.warnings.join(' '));
  assert.equal(v.overlay.grid, 'shared');
  assert.deepEqual(v.overlay.series.map((s) => s.id), ['exp-0', 'exp-0-unreliable', 'exp-1',
    'exp-1-unreliable']);
  const a = v.overlay.series[0];
  a.values.forEach((x, i) => {
    if (x !== null) assert.equal(x, EXP_A.results.aggregate.centreDb[i], 'not normalized');
  });
  assert.ok(v.delta.ok, v.delta.reason);
  const ra = QUALITY.metrics.coverage;
  const rb = QUALITY_B.metrics.coverage;
  const lo = Math.max(ra[0], rb[0]);
  const hi = Math.min(ra[1], rb[1]);
  assert.deepEqual(v.delta.range, [lo, hi]);
  for (const f of v.delta.x) assert.ok(f >= lo && f <= hi);
  assert.equal(v.delta.readoutAt(lo / 2), null, 'refused below the overlap');
  assert.equal(v.delta.readoutAt(hi * 1.01), null, 'refused above the overlap');
  const mid = v.delta.readoutAt(1000);
  // Two noisy observations of one system: 30 dB SNR per run, three runs each, so the delta in
  // the pass band is within 20·log10(1 + 2·3·10^(−30/20)) ≈ 1.5 dB.
  assert.ok(Math.abs(mid.value) < 1.5, `${mid.value}`);
  assert.match(v.delta.label, /A − B/);
  assert.match(v.summary, /equivalent configuration/);
  assert.doesNotMatch(allText(v), /SPL/);
});

test('compare: non-equivalent or non-overlapping experiments get no delta', () => {
  const low = measureSystem({ f1: 20, f2: 200, seconds: 1, seed: 5, runs: 1 });
  const high = measureSystem({ f1: 2000, f2: 20000, seconds: 1, seed: 6, runs: 1 });
  const qOf = (sys) => assessQuality({ capture: sys.runs.map((r) => r.check),
    transfer: sys.runs[0].transfer, aggregate: sys.aggregate,
    calibration: { frequency: null, level: null } });
  const eLow = experimentOf(low, qOf(low), { id: 11, name: 'low band' });
  const eHigh = experimentOf(high, qOf(high), { id: 12, name: 'high band' });
  const v = buildCompareView([eLow, eHigh]);
  assert.equal(v.compatible, false);
  assert.ok(v.warnings.some((w) => /different stimuli/.test(w)));
  assert.equal(v.delta.ok, false);
  assert.match(v.delta.reason, /non-equivalent/);
  const d = v.differences.find((x) => x.field === 'recipe.stimulus');
  assert.equal(d.severity, 'warn');
  assert.equal(d.glyph, '!');
  assert.match(d.values[0].text, /20 Hz → 200 Hz log sweep/);
  assert.equal(v.overlay.grid, 'resampled');
  assert.match(v.summary, /NOT EQUIVALENT/);
  const forced = buildCompareView([eLow, eHigh], { allowNonEquivalentDelta: true });
  assert.equal(forced.delta.ok, false);
  assert.match(forced.delta.reason, /do not overlap/);
  // Unknown validity (no quality, no transfer validRange): refused, never the full span.
  const noQ = { ...EXP_B, quality: null };
  const unknown = buildCompareView([EXP_A, noQ]);
  assert.equal(unknown.delta.ok, false);
  assert.match(unknown.delta.reason, /UNKNOWN/);
  assert.doesNotMatch(allText(v, forced, unknown), /SPL/);
});
