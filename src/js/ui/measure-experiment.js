// Experiment from an engine measure() result (spec §50-§53, §99-§104, §160; G20 storage rule).
// Pure (no DOM, no clock, no randomness): the caller passes the timestamp, the ID and the build
// record. Used by the MEASURE workspace (src/js/ui/measure.js) to save a result, and by the test
// fixtures to build experiments the same way.
//
// A TEST CONTEXT capture (capture.js createLoopbackIo, or a synthetic fixture) is recorded in
// every run entry (measurement.runs[i].testContext) and in the environment notes, so a saved
// experiment can never be mistaken for a measurement of a physical system (§146, §249).

import { ALGORITHMS } from '../measurement/algorithms.js';
import { isValidLevelCalibration } from '../calibration/level.js';
import { createExperiment, withResults, resultsFromMeasurement } from '../experiments/schema.js';
import { configHash, withConfigHash, resultHash, withResultHash } from '../experiments/hash.js';

export const DEFAULT_EXPERIMENT_NAME = 'Playback / capture chain';

/**
 * experimentFromResult(result, { now, id, build, name, notes, profile, levelCalibration,
 *   repeatOf }) → a hashed Experiment (validate.js accepts it).
 *   profile           the FrequencyProfile the engine applied (stored as { id, name } only)
 *   levelCalibration  a VALID LevelCalibration in use, else ignored
 */
export function experimentFromResult(result, {
  now, id, build = null, name = '', notes = '', profile = null, levelCalibration = null,
  repeatOf = null,
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
  const freq = result.calibrated && result.calibrated.frequency && profile ? profile : null;
  const lvl = isValidLevelCalibration(levelCalibration) ? levelCalibration : null;
  const noteText = [notes ? String(notes).trim() : '', tcLabel ? `${tcLabel.replace(/\.$/, '')}.`
    : ''].filter(Boolean).join(' ') || null;
  const title = (name && String(name).trim()) || (tc ? 'TEST CONTEXT · digital loopback'
    : DEFAULT_EXPERIMENT_NAME);
  let e = createExperiment({
    recipe: { stimulus: result.recipe.stimulus, repeats: result.recipe.repeats,
      analysis: result.recipe.analysis },
    build, now, id, name: title, sampleRate: result.sampleRate, input: result.input,
    calibration: { frequency: freq, level: lvl }, environment: { notes: noteText }, algorithms,
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
  return withResultHash(e, resultHash(e));
}

/** True when an experiment records a TEST CONTEXT capture (loopback or synthetic). */
export function experimentTestContext(e) {
  const runs = e && e.measurement && Array.isArray(e.measurement.runs) ? e.measurement.runs : [];
  const r = runs.find((x) => x && x.testContext);
  if (r) return r.testContext.label || 'TEST CONTEXT';
  return /^TEST CONTEXT/.test(e && e.name ? e.name : '') ? e.name : null;
}
