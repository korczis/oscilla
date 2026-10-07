// Deterministic TEST CONTEXT experiments for the V3 UI suite (tests/browser/v3-ui.cjs) and the
// MEASURE visual reference: the real MeasurementEngine (engine.js) runs in Node on a synthetic
// io whose "capture" is the rendered stimulus through a known digital biquad plus seeded noise,
// with a fixed clock; the experiments are built by the same pure function the MEASURE workspace
// uses (src/js/ui/measure-experiment.js). Every run is marked testContext 'synthetic', and the
// names say TEST CONTEXT: nothing here is presented as a measurement of a physical system.
//
//   measure(ioOpts, recipe) -> Promise<result>   one COMPLETE engine.measure() on the synthetic
//                                                io (also used by fixtures/large-library.mjs)
//   buildFixtures() -> Promise<{ a, b, c }>   each { experiment, json, name }
//     a  low-pass 6 kHz, 3 runs                       (reference)
//     b  the same system 0.9 dB quieter, same recipe   (equivalent to a: A − B is shown)
//     c  a different sweep range                       (not equivalent: A − B is refused)
//     older  A as the build before ADR 0040's 2026-10-05 resolution could save it: a level
//            calibration made AFTER the uncalibrated run recorded as used, hashes stamped over
//            it (a contradicted calibration claim; json only, never built by the app now)
//     white  A's results under a white-noise recipe: a stimulus this build's engine cannot
//            measure (ledger D4; a schema-3 file from elsewhere, json only, never built by the
//            app)

import { createMeasurementEngine, assessMeasurement } from '../../../src/js/measurement/engine.js';
import { mulberry32 } from '../../../src/js/audio/noise.js';
import { experimentToJson, normalizeCalibration } from '../../../src/js/experiments/schema.js';
import {
  configHash, withConfigHash, resultHash, withResultHash, RESULT_HASH_VERSION,
} from '../../../src/js/experiments/hash.js';
import { createLevelCalibration } from '../../../src/js/calibration/level.js';
import { normalizeStimulus } from '../../../src/js/measurement/stimulus.js';
import { derivedRef } from '../../../src/js/experiments/definition.js';
import { experimentFromResult } from '../../../src/js/ui/measure-experiment.js';

// timing-allow: the synthetic io's own sample rate; these fixtures never open an AudioContext
export const SR = 48000;
export const NOW = '2026-10-02T10:00:00.000Z';
const NOW_MS = Date.parse(NOW);
export const FIXTURE_LABEL = 'TEST CONTEXT: synthetic digital system (computed in a test, not '
  + 'measured)';
export const FIXTURE_BUILD = Object.freeze({ version: '0.0.0-fixture', channel: 'test' });

/** RBJ low-pass biquad coefficients (normalized). */
function lowpass(f0, q, sr) {
  const w = 2 * Math.PI * f0 / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0,
    a1: -2 * c / a0, a2: (1 - alpha) / a0 };
}

function filter(x, k, gain) {
  const y = new Float32Array(x.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = k.b0 * x[i] + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = gain * v;
  }
  return y;
}

function noise(seed, n, amp) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() - 0.5) * amp;
  return out;
}

/** The synthetic io: engine.js io contract, audio clock simulated, captures deterministic. */
function syntheticIo({ f0 = 6000, gain = 0.25, seed = 1, runGainsDb = [0, 0.3, -0.3] } = {}) {
  let t = 1;
  let run = 0;
  const k = lowpass(f0, Math.SQRT1_2, SR);
  const tc = { kind: 'synthetic', label: FIXTURE_LABEL };
  const device = { label: null, id: null };
  const constraints = { requested: null, applied: null };
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'not-required', input: { ok: true, device, constraints },
        inputLevel: { peak: 0.0005, rmsDb: -72 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' },
        testContext: tc };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.1;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: noise(seed * 101, Math.round(seconds * SR), 1e-3),
        preRoll: 0, postRoll: 0, startedAt, constraints, device, testContext: tc };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled }) {
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const frames = pre + x.length + Math.round(postRollS * SR);
      const samples = noise(seed * 1000 + run, frames, 1e-3);
      const g = gain * 10 ** ((runGainsDb[run % runGainsDb.length] || 0) / 20);
      const y = filter(x, k, g);
      for (let i = 0; i < y.length; i++) samples[pre + i] += y[i];
      run += 1;
      const startedAt = Math.max(t + 0.1, notBefore ?? -Infinity);
      const times = { captureStartAt: startedAt, stimulusStartAt: startedAt + preRollS,
        stimulusEndAt: startedAt + preRollS + x.length / SR,
        captureEndAt: startedAt + frames / SR };
      if (onScheduled) onScheduled(times);
      t = times.captureEndAt;
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt,
        stimulusStartAt: times.stimulusStartAt, constraints, device, testContext: tc };
    },
    cancel() {},
    dispose() {},
  };
}

export const FIXTURE_RECIPE = Object.freeze({
  stimulus: Object.freeze({ kind: 'log-sweep', duration: 2, level: 'low', f1: 20, f2: 20000 }),
  repeats: 3,
  analysis: Object.freeze({ noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0.2,
    phase: false, aggregation: 'mean' }),
});

export async function measure(ioOpts, recipe) {
  const engine = createMeasurementEngine({ io: syntheticIo(ioOpts), assess: assessMeasurement,
    clock: { wall: () => NOW_MS, mono: () => 0 } });
  const result = await engine.measure(JSON.parse(JSON.stringify(recipe)));
  if (result.state !== 'COMPLETE') {
    throw new Error(`fixture measurement ${result.state}: ${JSON.stringify(result.reasons)}`);
  }
  return result;
}

async function fixture(id, name, ioOpts, recipe = FIXTURE_RECIPE) {
  const result = await measure(ioOpts, recipe);
  const experiment = experimentFromResult(result, { now: NOW, id, build: FIXTURE_BUILD, name,
    notes: 'Synthetic low-pass system; used by the automated UI tests and the visual reference.' });
  return { experiment, json: experimentToJson(experiment), name, result };
}

export async function buildFixtures() {
  const a = await fixture('fixture-a', 'TEST CONTEXT · synthetic A (low-pass 6 kHz)',
    { f0: 6000, seed: 1 });
  const b = await fixture('fixture-b', 'TEST CONTEXT · synthetic B (0.9 dB quieter)',
    { f0: 6000, seed: 2, gain: 0.25 * 10 ** (-0.9 / 20) });
  const c = await fixture('fixture-c', 'TEST CONTEXT · synthetic C (other sweep range)',
    { f0: 6000, seed: 3 }, { ...FIXTURE_RECIPE, stimulus: { ...FIXTURE_RECIPE.stimulus, f1: 50 } });
  const level = normalizeCalibration({ level: createLevelCalibration({ referenceHz: 1000,
    referenceDbSpl: 94, observedDbRelative: -32.5, conditions: 'made after the run', createdAt:
    NOW, method: 'manual', input: null }) }).level;
  let o = { ...a.experiment, experimentId: 'fixture-older',
    name: 'TEST CONTEXT · synthetic A, level calibration added after the run (older version)',
    calibration: { ...a.experiment.calibration, level } };
  o = withConfigHash(o, configHash(o));
  o = withResultHash(o, resultHash(o), RESULT_HASH_VERSION);
  const older = { experiment: o, json: experimentToJson(o), name: o.name, result: null };
  const { requested, ...played } = a.experiment.recipe; // eslint-disable-line no-unused-vars
  const recipe = { ...played, stimulus: normalizeStimulus({ kind: 'white', sampleRate: SR,
    duration: played.stimulus.duration, level: played.stimulus.level }).spec };
  let w = { ...a.experiment, experimentId: 'fixture-white', recipe, definition: derivedRef(recipe),
    name: 'TEST CONTEXT · white-noise record (a stimulus this version cannot measure)' };
  w = withConfigHash(w, configHash(w));
  w = withResultHash(w, resultHash(w), RESULT_HASH_VERSION);
  // Written as a schema-3 file (no hash covers the schema version): every build since ADR 0043
  // reads it, so the same file shows what an earlier build did with it.
  const white = { experiment: w, json: experimentToJson({ ...w, schemaVersion: 3 }), name: w.name,
    result: null };
  return { a, b, c, older, white };
}
