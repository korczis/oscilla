// Experiment from an engine measure() result (spec §50-§53, §99-§104, §160; G20 storage rule).
// Pure (no DOM, no clock, no randomness): the caller passes the timestamp, the ID and the build
// record. Used by the MEASURE workspace (src/js/ui/measure.js) to save a result, and by the test
// fixtures to build experiments the same way.
//
// A TEST CONTEXT capture (capture.js createLoopbackIo, or a synthetic fixture) is recorded in
// every run entry (measurement.runs[i].testContext) and in the environment notes, so a saved
// experiment can never be mistaken for a measurement of a physical system (§146, §249).
//
// Provenance (M9, M11 of the V3 review): the experiment also records the master output gain the
// stimulus passed (output.masterGain, from the preflight facts; for a loopback the chain gain),
// the engine's result notes (measurement.notes), the frequencies the user asked for before the
// Nyquist clamp (recipe.requested, from the caller), the full algorithm map (the capture checks'
// clip and discontinuity IDs included), the input with its device id hashed (schema.js
// normalizeInput, §88), and is stamped with the version-3 result hash (results, quality,
// calibration, input, output, the runs with their ids 'run-1'.. and the build; ADR 0040), now
// version 4 (plus the recipe and the definition, ADR 0043).
//
// Definition (ADR 0043): `definition` is the run reference of the definition version the
// measurement was started from (definition.js definitionRef). It is recorded only when the
// recipe that ran is what that version asks for (recipeMismatches); otherwise, and without
// one, the experiment carries the definition derived from its own recipe (derived: true). The
// caller compares the saved reference with the one it passed to say which happened.

import { ALGORITHMS } from '../measurement/algorithms.js';
import { isValidLevelCalibration } from '../calibration/level.js';
import {
  createExperiment, createRecipe, withResults, resultsFromMeasurement,
} from '../experiments/schema.js';
import { recipeMismatches } from '../experiments/definition.js';
import {
  configHash, withConfigHash, resultHash, withResultHash, RESULT_HASH_VERSION,
} from '../experiments/hash.js';

/** The linear master output gain a measure() result records, or null. */
export function resultMasterGain(result) {
  const f = result && result.preflight && result.preflight.facts;
  let g = f && f.output ? f.output.gain : null;
  if (!(typeof g === 'number' && g > 0) && result && result.testContext) {
    g = result.testContext.chainGain;
  }
  return typeof g === 'number' && Number.isFinite(g) && g > 0 && g <= 1 ? g : null;
}

export const DEFAULT_EXPERIMENT_NAME = 'Playback / capture chain';

/**
 * experimentFromResult(result, { now, id, build, name, notes, profile, levelCalibration,
 *   repeatOf, requested }) → a hashed Experiment (validate.js accepts it).
 *   profile           the FrequencyProfile the engine applied (stored as { id, name } only)
 *   levelCalibration  a VALID LevelCalibration in use (the caller has checked that it applies
 *                     to the result's input), else ignored
 *   requested         { f1, f2 } the user asked for (before the Nyquist clamp), or null
 *   definition        the run reference the measurement was started from, or null
 */
export function experimentFromResult(result, {
  now, id, build = null, name = '', notes = '', profile = null, levelCalibration = null,
  repeatOf = null, requested = null, definition = null,
} = {}) {
  if (!result || !result.recipe) {
    throw new TypeError('experimentFromResult needs a measure() result');
  }
  const runs = Array.isArray(result.runs) ? result.runs : [];
  const tc = result.testContext || null;
  const tcLabel = tc ? tc.label || 'TEST CONTEXT' : null;
  const algorithms = {};
  for (const [k, v] of Object.entries(result.algorithms || {})) if (v) algorithms[k] = v;
  if (result.ir && result.ir.algorithm) algorithms.ir = result.ir.algorithm;
  if (runs.length > 1) algorithms.aggregate = ALGORITHMS.aggregate;
  if (result.quality && result.quality.algorithm) algorithms.quality = result.quality.algorithm;
  const checks = [...(Array.isArray(result.captureChecks) ? result.captureChecks : []),
    ...runs.map((r) => r && r.checks)];
  for (const c of checks) {
    if (!c || !c.algorithms) continue;
    for (const [k, v] of Object.entries(c.algorithms)) if (v && !algorithms[k]) algorithms[k] = v;
  }
  const freq = result.calibrated && result.calibrated.frequency && profile ? profile : null;
  const lvl = isValidLevelCalibration(levelCalibration) ? levelCalibration : null;
  const noteText = [notes ? String(notes).trim() : '', tcLabel ? `${tcLabel.replace(/\.$/, '')}.`
    : ''].filter(Boolean).join(' ') || null;
  const title = (name && String(name).trim()) || (tc ? 'TEST CONTEXT · digital loopback'
    : DEFAULT_EXPERIMENT_NAME);
  const req = requested && typeof requested === 'object'
    && (Number.isFinite(requested.f1) || Number.isFinite(requested.f2))
    ? { f1: Number.isFinite(requested.f1) ? requested.f1 : null,
      f2: Number.isFinite(requested.f2) ? requested.f2 : null } : null;
  const recipe = { stimulus: result.recipe.stimulus, repeats: result.recipe.repeats,
    analysis: result.recipe.analysis, requested: req };
  const bound = definition
    && !recipeMismatches(createRecipe(recipe), definition.execution.recipe).length;
  let e = createExperiment({
    recipe, definition: bound ? definition : null,
    build, now, id, name: title, sampleRate: result.sampleRate, input: result.input,
    calibration: { frequency: freq, level: lvl }, environment: { notes: noteText }, algorithms,
    masterGain: resultMasterGain(result), notes: Array.isArray(result.notes) ? result.notes : null,
  });
  const finite = (v) => (Number.isFinite(v) ? v : null);
  e = withResults(e, {
    startedAt: Number.isFinite(result.startedAtMs) ? result.startedAtMs : now,
    runs: runs.map((r) => ({
      run: r.index,
      frames: r.frames,
      sampleRate: r.sampleRate,
      lagSamples: r.alignment ? finite(r.alignment.lagSamples) : null,
      peakCorrelation: r.alignment ? finite(r.alignment.peakCorrelation) : null,
      clippingRatio: r.checks && r.checks.clipping ? finite(r.checks.clipping.ratio) : null,
      ...(tc ? { testContext: { kind: String(tc.kind || 'test'), label: tcLabel } } : {}),
    })),
    quality: result.quality || null,
    results: resultsFromMeasurement(result),
  });
  if (repeatOf) e = { ...e, provenance: { ...e.provenance, repeatOf } };
  e = withConfigHash(e, configHash(e));
  return withResultHash(e, resultHash(e), RESULT_HASH_VERSION);
}

/** True when an experiment records a TEST CONTEXT capture (loopback or synthetic). */
export function experimentTestContext(e) {
  const runs = e && e.measurement && Array.isArray(e.measurement.runs) ? e.measurement.runs : [];
  const r = runs.find((x) => x && x.testContext);
  if (r) return r.testContext.label || 'TEST CONTEXT';
  return /^TEST CONTEXT/.test(e && e.name ? e.name : '') ? e.name : null;
}
