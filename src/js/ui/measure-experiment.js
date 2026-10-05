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
// calibration, input, output, the runs with their ids 'run-1'.. and the build; ADR 0040).
//
// Evidence as measured (ADR 0040, resolution 2026-10-05): the calibration of the record is the
// one the engine APPLIED, read from result.calibrated (appliedCalibration), never the profile or
// level calibration the workspace has loaded when Save is pressed; a calibration changed or
// created after the run is not recorded as used. environment.notes are the notes as they were
// when the measurement started (measuredEvidence, kept beside the result); text edited later is
// user metadata and goes to annotations.notes (`laterNotes`), which no hash covers.

import { ALGORITHMS } from '../measurement/algorithms.js';
import { isValidLevelCalibration } from '../calibration/level.js';
import {
  createExperiment, withResults, resultsFromMeasurement, annotateExperiment,
} from '../experiments/schema.js';
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

const trimmed = (t) => (typeof t === 'string' ? t.trim() : '');

/**
 * appliedCalibration(result) → frozen { frequency: { id, name } | null, level: LevelCalibration
 * | null }: what the engine applied to this result (engine.js result.calibrated), nothing else.
 */
export function appliedCalibration(result) {
  const c = result && result.calibrated ? result.calibrated : null;
  const f = c && c.frequency && typeof c.frequency.profileId === 'string' ? c.frequency : null;
  const l = c && c.level && c.level.calibrated === true ? c.level.calibration : null;
  return Object.freeze({
    frequency: f ? Object.freeze({ id: f.profileId, name: typeof f.name === 'string' ? f.name
      : '' }) : null,
    level: isValidLevelCalibration(l) ? l : null,
  });
}

/**
 * measuredEvidence(result, { notes }) → frozen { calibration, notes }: the companion of a result
 * kept by MEASURE from the moment it completes; `notes` are the environment notes as they were
 * when the measurement started (null when empty).
 */
export function measuredEvidence(result, { notes = null } = {}) {
  return Object.freeze({ calibration: appliedCalibration(result),
    notes: trimmed(notes) || null });
}

/** A calibration's identity for comparison: profile id and the level calibration's fields. */
const calibrationKey = (cal) => JSON.stringify([cal && cal.frequency ? cal.frequency.id : null,
  cal && cal.level ? cal.level : null]);

/**
 * evidenceChanges(evidence, { calibration, notes, saved }) → texts saying what differs between
 * the evidence of a completed result and the workspace now (`calibration` as
 * appliedCalibration shapes it, `notes` the current text), and what a save records or has
 * recorded (`saved`: null before the result is saved, else { annotation } the stored
 * annotation notes); [] when nothing differs.
 */
export function evidenceChanges(evidence, { calibration = null, notes = '', saved = null } = {}) {
  if (!evidence) return [];
  const out = [];
  if (calibrationKey(evidence.calibration) !== calibrationKey(calibration)) {
    const f = evidence.calibration.frequency;
    out.push('Calibration changed after this measurement; the saved record keeps the '
      + `calibration it was measured with (${f ? `frequency profile "${f.name || f.id}"`
        : 'no frequency profile'}, ${evidence.calibration.level ? 'level calibrated'
        : 'levels relative'}).`);
  }
  const later = trimmed(notes);
  if (later && later !== (evidence.notes || '')) {
    if (!saved) {
      out.push('Notes edited after this measurement started are saved as an annotation; the '
        + 'record keeps the notes it started with.');
    } else if (later === (saved.annotation || '')) {
      out.push('Notes edited after this measurement started are stored as its annotation; the '
        + 'record keeps the notes it started with.');
    } else {
      out.push('These notes are not stored yet: "Update name and notes" saves them as an '
        + 'annotation of the saved run; its record keeps the notes it started with.');
    }
  }
  return out;
}

/**
 * experimentFromResult(result, { now, id, build, name, notes, laterNotes, repeatOf, requested })
 * → a hashed Experiment (validate.js accepts it). Its calibration is appliedCalibration(result).
 *   notes       the environment notes as they were when the measurement started
 *   laterNotes  the notes as they are now; when they differ from `notes` they are stored as
 *               annotations.notes (metadata), never as a measurement condition
 *   requested   { f1, f2 } the user asked for (before the Nyquist clamp), or null
 */
export function experimentFromResult(result, {
  now, id, build = null, name = '', notes = '', laterNotes = null, repeatOf = null,
  requested = null,
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
  const applied = appliedCalibration(result);
  const noteText = [notes ? String(notes).trim() : '', tcLabel ? `${tcLabel.replace(/\.$/, '')}.`
    : ''].filter(Boolean).join(' ') || null;
  const title = (name && String(name).trim()) || (tc ? 'TEST CONTEXT · digital loopback'
    : DEFAULT_EXPERIMENT_NAME);
  const req = requested && typeof requested === 'object'
    && (Number.isFinite(requested.f1) || Number.isFinite(requested.f2))
    ? { f1: Number.isFinite(requested.f1) ? requested.f1 : null,
      f2: Number.isFinite(requested.f2) ? requested.f2 : null } : null;
  let e = createExperiment({
    recipe: { stimulus: result.recipe.stimulus, repeats: result.recipe.repeats,
      analysis: result.recipe.analysis, requested: req },
    build, now, id, name: title, sampleRate: result.sampleRate, input: result.input,
    calibration: applied, environment: { notes: noteText }, algorithms,
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
  e = withResultHash(e, resultHash(e), RESULT_HASH_VERSION);
  const later = trimmed(laterNotes);
  return later && later !== trimmed(notes) ? annotateExperiment(e, { notes: later }) : e;
}

/** True when an experiment records a TEST CONTEXT capture (loopback or synthetic). */
export function experimentTestContext(e) {
  const runs = e && e.measurement && Array.isArray(e.measurement.runs) ? e.measurement.runs : [];
  const r = runs.find((x) => x && x.testContext);
  if (r) return r.testContext.label || 'TEST CONTEXT';
  return /^TEST CONTEXT/.test(e && e.name ? e.name : '') ? e.name : null;
}
