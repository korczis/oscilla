// The experiment model (spec §50-§53, §99-§104, §131, §160-§161, §176-§177; contract
// docs/v3/architecture.md "experiments/schema.js"). Pure: plain data in, plain data out; no
// DOM, no Web Audio, no globals, no clock and no randomness — callers pass `now`, `id` (see
// newExperimentId) and `build` (the build-info record; this module never imports it).
//
// RECIPE = what to do: { stimulus: StimulusSpec, repeats, analysis } (§103). The stimulus is
// stored in the normalized form of measurement/stimulus.js (every field, null where the kind
// does not use it, including band-noise `color` and chirp `law`), and its limits are
// stimulus.js's own constants (DURATION_LIMITS per kind, SAMPLE_RATE_LIMITS, fade ≤ duration/4,
// MIN_FREQUENCY_HZ ≤ f ≤ safeMaxFrequency(sampleRate) = 0.95 × Nyquist), imported rather than
// copied, so createRecipe({ stimulus: renderStimulus(spec).spec }).stimulus deep-equals the
// rendered spec. An omitted seed/color/law stays null (stimulus.js then uses its default).
// EXPERIMENT = what was done plus the result:
//   { kind: 'oscilla-experiment', schemaVersion, oscillaVersion, oscillaCommit, experimentId,
//     name, recipe, output: { level }, input: { device: { label, id }, constraints:
//     { requested, applied } }, calibration: { frequency: { id, name }|null, level|null },
//     environment: { notes }, measurement: { startedAt, sampleRate, runs: [] }, quality,
//     algorithms: { role: id }, results: { transfer, ir, rta, aggregate? },
//     provenance: { configHash, resultHash, createdAt, repeatOf, build } }
// provenance.resultHash (hash.js resultHash, spec §101) is null until stamped and is cleared by
// withResults whenever the results change; validate.js verifies it on import.
// results.aggregate (G16) is optional: an aggregate.js aggregateResult() (centre, envelope,
// spread, repeatability of repeated runs on their grid), added with withResults({ results:
// { aggregate } }); createExperiment leaves it absent, so experiments without repeats and files
// written before it existed keep their exact form and result hash.
// Repeated measurements (G20, aggregate.js "Storage rule"): results.aggregate is the primary
// response; results.transfer is the aggregate centre marked derivedFrom: 'aggregate' (or null),
// never one run's transfer; individual runs only on request in the optional
// results.runTransfers [{ run, transfer }] (≤ LIMITS.runTransfers). resultsFromMeasurement()
// turns an engine result into exactly that block.
// Unknown values are null, never guessed (§52). Result arrays are typed arrays in memory and
// EncodedArray objects (encode.js) in a file; serializeExperiment converts.
//
//   createRecipe(spec) -> Recipe                      (throws RangeError on an invalid recipe)
//   createExperiment({ recipe, build, now, id, name, sampleRate, input, calibration,
//     environment, algorithms }) -> Experiment
//   withResults(experiment, { startedAt, sampleRate, runs, quality, algorithms, results })
//   repeatExperiment(experiment, { now, id, build, sampleRate }) -> a NEW Experiment (§104)
//   resultsFromMeasurement(result, { runTransfers }) -> { transfer, ir, rta, aggregate?,
//     runTransfers? }                                (an engine.js measure() result, G20)
//   newExperimentId(randomBytes16) -> UUIDv4 string
//   serializeExperiment(e) -> JSON-safe object;  experimentToJson(e, space?) -> string
//   summarizeExperiment(e) -> string[]               (§161)
//   createChecker(), checkRecipe(c, value, path)     (shared with validate.js)

import { CONFIG_FILE_VERSION } from '../ui/config-file.js';
import { PRESET_SCHEMA_VERSION } from '../core/constants.js';
import { sig } from '../core/math.js';
import { encodeArray } from './encode.js';
import { PROFILE_SCHEMA_VERSION } from '../calibration/profile.js';
import {
  DURATION_LIMITS, MIN_FREQUENCY_HZ, SAMPLE_RATE_LIMITS, STIMULUS_KINDS, safeMaxFrequency,
} from '../measurement/stimulus.js';
import {
  RELATIVE_SCALE_LABEL, RELATIVE_UNIT, isValidLevelCalibration,
} from '../calibration/level.js';
import { aggregateResult, transferFromAggregate } from '../measurement/aggregate.js';

/** Experiment file schema (§131-§132: V3.0 starts at 1, independent of the product version). */
export const EXPERIMENT_SCHEMA_VERSION = 1;
/** Calibration record schema (FrequencyProfile / LevelCalibration, calibration/profile.js). */
export const CALIBRATION_SCHEMA_VERSION = PROFILE_SCHEMA_VERSION;
/** Instrument config file schema (ui/config-file.js CONFIG_FILE_VERSION). */
export const CONFIG_SCHEMA_VERSION = CONFIG_FILE_VERSION;
export const EXPERIMENT_KIND = 'oscilla-experiment';
export const EXPERIMENT_FILE_EXTENSION = '.oscilla.json';

/** The four independent version axes (§131); the product version comes from `build`. */
export const SCHEMA_VERSIONS = Object.freeze({
  experiment: EXPERIMENT_SCHEMA_VERSION,
  calibration: CALIBRATION_SCHEMA_VERSION,
  config: CONFIG_SCHEMA_VERSION,
  preset: PRESET_SCHEMA_VERSION,
});

const durations = Object.values(DURATION_LIMITS);

/** Documented limits (§174, architecture "Limits"); stimulus limits are stimulus.js's. */
export const LIMITS = Object.freeze({
  sampleRate: SAMPLE_RATE_LIMITS,
  sweepDurationS: DURATION_LIMITS['log-sweep'],
  /** Envelope of every kind's DURATION_LIMITS; each kind is checked against its own. */
  stimulusDurationS: Object.freeze([Math.min(...durations.map((d) => d[0])),
    Math.max(...durations.map((d) => d[1]))]),
  repeats: Object.freeze([1, 10]),
  runs: 64,
  /** results.runTransfers entries (G20): at most one per repeat. */
  runTransfers: 10,
  frequencyHz: Object.freeze([0, 192000]),
  levelDigital: Object.freeze([0, 1]),
  dbAbs: 400,
  timeS: 3600,
  nameChars: 200,
  notesChars: 10000,
  textChars: 2000,
  labelChars: 256,
  idChars: 128,
  calibrationPoints: 2000,
  plainArray: 65536,
  qualityReasons: 256,
  algorithmRoles: 32,
});

export { STIMULUS_KINDS };
const STIMULUS_FIELDS = ['kind', 'sampleRate', 'duration', 'level', 'f', 'f1', 'f2', 'fade',
  'seed', 'color', 'law'];
const STIMULUS_USES = {
  sine: ['f'], 'log-sweep': ['f1', 'f2'], chirp: ['f1', 'f2', 'law'],
  'band-noise': ['f1', 'f2', 'seed', 'color'], white: ['seed'], pink: ['seed'],
};
/** Allowed values of the option fields (stimulus.js normalizeStimulus). */
const STIMULUS_OPTIONS = { color: ['white', 'pink'], law: ['log', 'linear'] };

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;
export const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
export const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
export const ALGORITHM_ID_PATTERN = /^oscilla(\.[a-z0-9-]+)+\.v[0-9]+$/;
export const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

export const UNKNOWN = 'Unknown';
export const UNKNOWN_DEVICE = 'Unknown / browser did not expose device label';

// ---------------------------------------------------------------- checker (shared)

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && !ArrayBuffer.isView(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const CTRL_SINGLE = /[\u0000-\u001f\u007f]/;
const CTRL_MULTI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Collects { path, text } errors (plus `code` when add() is given one, e.g. 'corrupt'). Each
 * check returns true when the value is acceptable. Used by createRecipe and by validate.js, so
 * a builder and an import agree on the rules.
 */
export function createChecker(maxErrors = 100) {
  const errors = [];
  const add = (path, text, code) => {
    if (errors.length < maxErrors) errors.push(code ? { path, text, code } : { path, text });
    return false;
  };
  const c = {
    errors,
    add,
    full: () => errors.length >= maxErrors,
    obj(v, path, { nullable = false } = {}) {
      if (v === null && nullable) return true;
      return isPlainObject(v) || add(path, `must be an object${nullable ? ' or null' : ''}`);
    },
    keys(v, path, required, optional = []) {
      if (!c.obj(v, path)) return false;
      let ok = true;
      for (const k of Object.keys(v)) {
        if (!required.includes(k) && !optional.includes(k)) {
          ok = add(join(path, k), 'unknown field');
        }
      }
      for (const k of required) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) ok = add(join(path, k), 'missing');
      }
      return ok;
    },
    num(v, path, lo, hi, { integer = false, nullable = false } = {}) {
      if (v === null && nullable) return true;
      if (typeof v !== 'number') return add(path, `must be a number${nullable ? ' or null' : ''}`);
      if (!Number.isFinite(v)) return add(path, `must be a finite number (got ${v})`);
      if (integer && !Number.isInteger(v)) return add(path, 'must be an integer');
      if (v < lo || v > hi) return add(path, `must be between ${lo} and ${hi}`);
      return true;
    },
    str(v, path, max, { nullable = false, pattern = null, multiline = false, min = 0 } = {}) {
      if (v === null && nullable) return true;
      if (typeof v !== 'string') return add(path, `must be a string${nullable ? ' or null' : ''}`);
      if (v.length < min) return add(path, 'must not be empty');
      if (v.length > max) return add(path, `longer than ${max} characters`);
      if ((multiline ? CTRL_MULTI : CTRL_SINGLE).test(v)) {
        return add(path, 'contains control characters');
      }
      if (pattern && !pattern.test(v)) return add(path, 'has an invalid format');
      return true;
    },
    bool(v, path, { nullable = false } = {}) {
      if (v === null && nullable) return true;
      return typeof v === 'boolean'
        || add(path, `must be true or false${nullable ? ' or null' : ''}`);
    },
    oneOf(v, path, list, { nullable = false } = {}) {
      if (v === null && nullable) return true;
      return list.includes(v) || add(path, `must be one of ${list.join(', ')}`);
    },
    iso(v, path, { nullable = false } = {}) {
      if (v === null && nullable) return true;
      if (!c.str(v, path, 32, { pattern: ISO_PATTERN })) return false;
      return Number.isFinite(Date.parse(v)) || add(path, 'is not a valid timestamp');
    },
    range(v, path, lo, hi, { nullable = false, strict = true } = {}) {
      if (v === null && nullable) return true;
      if (!Array.isArray(v) || v.length !== 2) return add(path, 'must be a [low, high] pair');
      if (!c.num(v[0], `${path}[0]`, lo, hi) || !c.num(v[1], `${path}[1]`, lo, hi)) return false;
      return (strict ? v[0] < v[1] : v[0] <= v[1]) || add(path, 'low must be below high');
    },
    /** A bounded generic JSON value; returns a clean copy or undefined when rejected. */
    json(v, path, lim = {}) {
      return jsonCopy(c, v, path, { depth: 4, keys: 64, array: 256, string: 200, ...lim });
    },
  };
  return c;
}

function join(path, key) {
  return path ? `${path}.${key}` : key;
}

function jsonCopy(c, v, path, lim, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    return c.num(v, path, -Number.MAX_VALUE, Number.MAX_VALUE) ? v : undefined;
  }
  if (typeof v === 'string') {
    return c.str(v, path, lim.string, { multiline: true }) ? v : undefined;
  }
  if (depth >= lim.depth) {
    c.add(path, `nested deeper than ${lim.depth} levels`);
    return undefined;
  }
  if (Array.isArray(v)) {
    if (v.length > lim.array) {
      c.add(path, `more than ${lim.array} elements`);
      return undefined;
    }
    const out = [];
    for (let i = 0; i < v.length; i++) {
      const x = jsonCopy(c, v[i], `${path}[${i}]`, lim, depth + 1);
      if (x === undefined) return undefined;
      out.push(x);
    }
    return out;
  }
  if (!isPlainObject(v)) {
    c.add(path, 'is not plain JSON data');
    return undefined;
  }
  const keys = Object.keys(v);
  if (keys.length > lim.keys) {
    c.add(path, `more than ${lim.keys} fields`);
    return undefined;
  }
  const out = {};
  for (const k of keys) {
    if (FORBIDDEN_KEYS.includes(k) || k.length > 64 || CTRL_SINGLE.test(k)) {
      c.add(join(path, k), 'forbidden field name');
      return undefined;
    }
    const x = jsonCopy(c, v[k], join(path, k), lim, depth + 1);
    if (x === undefined) return undefined;
    out[k] = x;
  }
  return out;
}

// ---------------------------------------------------------------- recipe

/**
 * Check a recipe; returns the normalized recipe or null (errors are in c.errors). Fields a
 * stimulus kind does not use are normalized to null (they do not change what is played).
 */
export function checkRecipe(c, value, path = 'recipe') {
  if (!c.keys(value, path, ['stimulus', 'repeats', 'analysis'])) return null;
  const stimulus = checkStimulus(c, value.stimulus, join(path, 'stimulus'));
  const okRepeats = c.num(value.repeats, join(path, 'repeats'), ...LIMITS.repeats,
    { integer: true });
  const analysis = c.json(value.analysis, join(path, 'analysis'));
  if (analysis !== undefined && !isPlainObject(analysis)) {
    c.add(join(path, 'analysis'), 'must be an object');
    return null;
  }
  if (!stimulus || !okRepeats || analysis === undefined) return null;
  return { stimulus, repeats: value.repeats, analysis };
}

function checkStimulus(c, s, path) {
  if (!c.keys(s, path, ['kind', 'duration', 'level', 'fade'],
    STIMULUS_FIELDS.filter((k) => !['kind', 'duration', 'level', 'fade'].includes(k)))) return null;
  if (!c.oneOf(s.kind, join(path, 'kind'), STIMULUS_KINDS)) return null;
  const uses = STIMULUS_USES[s.kind];
  let ok = c.num(s.sampleRate ?? null, join(path, 'sampleRate'), ...SAMPLE_RATE_LIMITS,
    { nullable: true });
  ok = c.num(s.duration, join(path, 'duration'), ...DURATION_LIMITS[s.kind]) && ok;
  let levelOk = c.num(s.level, join(path, 'level'), ...LIMITS.levelDigital);
  if (levelOk && !(s.level > 0)) {
    levelOk = c.add(join(path, 'level'), 'must be above 0 (a digital peak in (0, 1])');
  }
  ok = levelOk && ok;
  ok = ok && c.num(s.fade, join(path, 'fade'), 0, s.duration / 4);
  // Unknown sample rate: the bound at the highest supported rate (stimulus.js needs a rate).
  const fMax = safeMaxFrequency(typeof s.sampleRate === 'number' ? s.sampleRate
    : SAMPLE_RATE_LIMITS[1]);
  const out = { kind: s.kind, sampleRate: s.sampleRate ?? null, duration: s.duration,
    level: s.level, f: null, f1: null, f2: null, fade: s.fade, seed: null, color: null,
    law: null };
  for (const k of ['f', 'f1', 'f2']) {
    if (uses.includes(k)) {
      ok = c.num(s[k], join(path, k), MIN_FREQUENCY_HZ, fMax) && ok;
      out[k] = s[k];
    } else {
      ok = c.num(s[k] ?? null, join(path, k), -Infinity, Infinity, { nullable: true }) && ok;
    }
  }
  if (ok && uses.includes('f2') && !(s.f1 < s.f2)) ok = c.add(join(path, 'f2'), 'must exceed f1');
  if (uses.includes('seed')) {
    ok = c.num(s.seed ?? null, join(path, 'seed'), 0, 4294967295, { integer: true, nullable: true })
      && ok;
    out.seed = s.seed ?? null;
  } else {
    ok = c.num(s.seed ?? null, join(path, 'seed'), -Infinity, Infinity, { nullable: true }) && ok;
  }
  for (const k of ['color', 'law']) {
    const v = s[k] ?? null;
    if (uses.includes(k)) {
      ok = c.oneOf(v, join(path, k), STIMULUS_OPTIONS[k], { nullable: true }) && ok;
      out[k] = v;
    } else if (v !== null) {
      ok = c.add(join(path, k), `is not used by a ${s.kind} stimulus (must be null)`) && ok;
    }
  }
  return ok ? out : null;
}

/**
 * Build a normalized recipe: { stimulus, repeats = 1, analysis = {} }. The stimulus is the
 * StimulusSpec as rendered (stimulus.js renderStimulus().spec). Throws RangeError listing every
 * problem; the input is not modified.
 */
export function createRecipe({ stimulus, repeats = 1, analysis = {} } = {}) {
  const c = createChecker();
  const recipe = checkRecipe(c, { stimulus, repeats, analysis });
  if (!recipe) throw new RangeError(`Invalid recipe: ${formatErrors(c.errors)}`);
  return recipe;
}

/** "path: text; path: text" */
export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.text}`).join('; ');
}

// ---------------------------------------------------------------- experiment

/** UUIDv4 text from 16 caller-supplied random bytes (crypto.getRandomValues). Not mutated. */
export function newExperimentId(randomBytes16) {
  const src = randomBytes16;
  if (!src || src.length < 16) throw new TypeError('newExperimentId needs 16 random bytes');
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const v = src[i];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new TypeError('random bytes must be 0..255');
    }
    b[i] = v;
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** ISO 8601 UTC text from an ISO string, a Date or epoch milliseconds (wall clock, §177). */
export function toIsoTimestamp(now) {
  const ms = typeof now === 'string' ? Date.parse(now)
    : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN;
  if (!Number.isFinite(ms)) throw new TypeError('a timestamp (`now`) is required');
  return new Date(ms).toISOString();
}

const strOrNull = (v, max, pattern) => (typeof v === 'string' && v.trim() !== ''
  && v.length <= max && !CTRL_SINGLE.test(v) && (!pattern || pattern.test(v)) ? v : null);

/** The provenance block of a build-info record; anything missing or malformed is null. */
export function normalizeBuild(build) {
  if (!build || typeof build !== 'object') return null;
  const commit = strOrNull(build.commit, 40, COMMIT_PATTERN);
  return {
    version: strOrNull(build.version, 64, VERSION_PATTERN),
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    sourceDate: strOrNull(build.sourceDate, 64, /^[0-9][0-9TZ:.+-]*$/),
    channel: strOrNull(build.channel, 32, /^[A-Za-z0-9._-]+$/),
    dirty: typeof build.dirty === 'boolean' ? build.dirty : null,
    repository: strOrNull(build.repository, LIMITS.labelChars),
  };
}

const plainCopy = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

/** input: { device: { label, id }, constraints: { requested, applied } } — '' labels -> null. */
export function normalizeInput(input) {
  const i = input && typeof input === 'object' ? input : {};
  const d = i.device && typeof i.device === 'object' ? i.device : {};
  const k = i.constraints && typeof i.constraints === 'object' ? i.constraints : {};
  return {
    device: {
      label: strOrNull(d.label, LIMITS.labelChars),
      id: strOrNull(d.id, LIMITS.labelChars),
    },
    constraints: { requested: plainCopy(k.requested), applied: plainCopy(k.applied) },
  };
}

/** calibration: { frequency: FrequencyProfile|{ id, name }|null, level: LevelCalibration|null }. */
export function normalizeCalibration(calibration) {
  const cal = calibration && typeof calibration === 'object' ? calibration : {};
  const f = cal.frequency;
  const l = cal.level;
  return {
    frequency: f && typeof f === 'object' ? { id: f.id, name: f.name } : null,
    level: l && typeof l === 'object' ? {
      schemaVersion: l.schemaVersion, kind: l.kind, referenceHz: l.referenceHz,
      referenceDbSpl: l.referenceDbSpl, observedDbRelative: l.observedDbRelative,
      offsetDb: l.offsetDb, conditions: l.conditions ?? null, createdAt: l.createdAt ?? null,
    } : null,
  };
}

/**
 * A new experiment with empty results. Required: recipe, now, id. build is the build-info
 * record (null -> version and commit Unknown); sampleRate is the AudioContext rate or null.
 * Input and calibration values are taken from the caller as given; validateExperiment is the
 * gate before anything is stored or exported.
 */
export function createExperiment({
  recipe, build = null, now, id, name = '', sampleRate = null, input = null, calibration = null,
  environment = null, algorithms = {},
} = {}) {
  const createdAt = toIsoTimestamp(now);
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new TypeError('createExperiment: id must be a string of 1-128 [A-Za-z0-9._-]');
  }
  if (sampleRate !== null && !(typeof sampleRate === 'number'
    && sampleRate >= LIMITS.sampleRate[0] && sampleRate <= LIMITS.sampleRate[1])) {
    throw new RangeError(`createExperiment: sampleRate must be ${LIMITS.sampleRate.join('-')} Hz`);
  }
  const r = createRecipe(recipe);
  const b = normalizeBuild(build);
  const notes = environment && typeof environment.notes === 'string' ? environment.notes : null;
  return {
    kind: EXPERIMENT_KIND,
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    oscillaVersion: b ? b.version : null,
    oscillaCommit: b ? b.commit : null,
    experimentId: id,
    name: typeof name === 'string' ? name.trim().slice(0, LIMITS.nameChars) : '',
    recipe: r,
    output: { level: r.stimulus.level },
    input: normalizeInput(input),
    calibration: normalizeCalibration(calibration),
    environment: { notes: notes ? notes.slice(0, LIMITS.notesChars) : null },
    measurement: { startedAt: null, sampleRate, runs: [] },
    quality: null,
    algorithms: { ...algorithms },
    results: { transfer: null, ir: null, rta: null },
    provenance: { configHash: null, resultHash: null, createdAt, repeatOf: null, build: b },
  };
}

/**
 * A copy of `experiment` with what was measured. Result typed arrays are referenced, not
 * copied (§172); the input experiment is not modified. A changed configuration (algorithms,
 * sampleRate) clears provenance.configHash, and new results clear provenance.resultHash; hash.js
 * recomputes both.
 */
export function withResults(experiment, patch = {}) {
  const e = experiment;
  const m = e.measurement;
  const changesConfig = patch.algorithms !== undefined || patch.sampleRate !== undefined;
  let provenance = changesConfig ? { ...e.provenance, configHash: null } : e.provenance;
  if (patch.results !== undefined) provenance = { ...provenance, resultHash: null };
  return {
    ...e,
    measurement: {
      startedAt: patch.startedAt !== undefined ? toIsoTimestamp(patch.startedAt) : m.startedAt,
      sampleRate: patch.sampleRate !== undefined ? patch.sampleRate : m.sampleRate,
      runs: patch.runs !== undefined ? patch.runs.map((r) => ({ ...r })) : m.runs,
    },
    quality: patch.quality !== undefined ? patch.quality : e.quality,
    algorithms: patch.algorithms !== undefined ? { ...patch.algorithms } : e.algorithms,
    results: patch.results !== undefined ? { ...e.results, ...patch.results } : e.results,
    provenance,
  };
}

/**
 * resultsFromMeasurement(result, { runTransfers = false }) → the `results` block of an
 * engine.js measure() result under the G20 storage rule:
 *   one run      { transfer: that run's TransferResult, ir, rta: null }   (no aggregate)
 *   ≥ 2 runs     { transfer: transferFromAggregate(aggregate, run transfers) (derivedFrom
 *                'aggregate'), ir, rta: null, aggregate: aggregateResult(...),
 *                runTransfers?: [{ run, transfer }] }
 * runTransfers: false (none), true (every run) or an array of run indices (strictly
 * increasing, each below the run count; at most LIMITS.runTransfers); ignored for one run,
 * whose transfer IS results.transfer. The IR is the representative run's, without the engine's
 * `run` bookkeeping field. A result without a transfer (INVALID before analysis) gives null
 * results. Typed arrays of the run transfers and the IR are referenced, not copied.
 */
export function resultsFromMeasurement(result, { runTransfers = false } = {}) {
  if (!result || typeof result !== 'object') {
    throw new TypeError('resultsFromMeasurement needs an engine measure() result');
  }
  let ir = null;
  if (result.ir) {
    ir = { ...result.ir };
    delete ir.run; // the engine's representative-run index, not part of an IrResult
  }
  const runs = Array.isArray(result.runs) ? result.runs : [];
  if (!result.transfer) return { transfer: null, ir, rta: null };
  if (runs.length < 2) return { transfer: result.transfer, ir, rta: null };
  const transfers = runs.map((r, i) => {
    if (!r || !r.transfer) throw new RangeError(`run ${i} has no transfer`);
    return r.transfer;
  });
  const aggregate = aggregateResult(result.aggregate, transfers[0].frequencies);
  const out = { transfer: transferFromAggregate(aggregate, transfers), ir, rta: null, aggregate };
  let picked = null;
  if (runTransfers === true) picked = runs.map((_, i) => i);
  else if (Array.isArray(runTransfers)) picked = runTransfers;
  else if (runTransfers !== false && runTransfers != null) {
    throw new TypeError('runTransfers must be false, true or an array of run indices');
  }
  if (picked && picked.length) {
    if (picked.length > LIMITS.runTransfers) {
      throw new RangeError(`at most ${LIMITS.runTransfers} run transfers are stored`);
    }
    picked.forEach((k, i) => {
      if (!Number.isInteger(k) || k < 0 || k >= runs.length || (i > 0 && !(k > picked[i - 1]))) {
        throw new RangeError('runTransfers: run indices must be strictly increasing integers '
          + `0-${runs.length - 1}`);
      }
    });
    out.runTransfers = picked.map((k) => ({ run: k, transfer: transfers[k] }));
  }
  return out;
}

/**
 * REPEAT (§104): a NEW experiment with the same recipe, calibration, name, requested input
 * constraints and notes, empty results and provenance.repeatOf = the source id. `build` is
 * the build doing the repeat (not copied: a newer OSCILLA must not claim the old version).
 */
export function repeatExperiment(experiment, { now, id, build = null, sampleRate = null } = {}) {
  const e = experiment;
  if (id === e.experimentId) throw new RangeError('repeatExperiment: the repeat needs a new id');
  const next = createExperiment({
    recipe: plainCopy(e.recipe), build, now, id, name: e.name, sampleRate,
    input: { constraints: { requested: e.input?.constraints?.requested ?? null } },
    calibration: plainCopy(e.calibration), environment: plainCopy(e.environment),
  });
  next.provenance.repeatOf = e.experimentId;
  return next;
}

/** A JSON-safe copy: typed arrays become EncodedArray objects; nothing else changes. */
export function serializeExperiment(e) {
  return serialize(e, 0);
}

function serialize(v, depth) {
  if (depth > 64) throw new TypeError('serializeExperiment: nesting too deep');
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError('serializeExperiment: non-finite number');
    }
    if (['function', 'symbol', 'bigint', 'undefined'].includes(typeof v)) {
      throw new TypeError(`serializeExperiment: ${typeof v} is not JSON`);
    }
    return v;
  }
  if (ArrayBuffer.isView(v)) return encodeArray(v);
  if (Array.isArray(v)) return v.map((x) => serialize(x, depth + 1));
  const out = {};
  for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = serialize(v[k], depth + 1);
  return out;
}

/** The `.oscilla.json` text of an experiment. */
export function experimentToJson(e, space = 0) {
  return JSON.stringify(serializeExperiment(e), null, space);
}

// ---------------------------------------------------------------- summary (§161)

/** "20 Hz", "1 kHz", "15.5 kHz" */
export function formatHz(f) {
  if (typeof f !== 'number' || !Number.isFinite(f)) return UNKNOWN;
  return f >= 1000 ? `${sig(f / 1000, 3)} kHz` : `${sig(f, 3)} Hz`;
}

const fmtS = (s) => (typeof s === 'number' && Number.isFinite(s) ? `${sig(s, 3)} s` : UNKNOWN);

/** "20 Hz → 20 kHz log sweep, 10 s" */
export function describeStimulus(s) {
  if (!s || typeof s !== 'object') return UNKNOWN;
  const d = fmtS(s.duration);
  switch (s.kind) {
    case 'sine': return `${formatHz(s.f)} sine, ${d}`;
    case 'log-sweep': return `${formatHz(s.f1)} → ${formatHz(s.f2)} log sweep, ${d}`;
    case 'chirp': return `${formatHz(s.f1)} → ${formatHz(s.f2)} chirp, ${d}`;
    case 'band-noise': return `${formatHz(s.f1)} – ${formatHz(s.f2)} band noise, ${d}`;
    case 'white': return `white noise, ${d}`;
    case 'pink': return `pink noise, ${d}`;
    default: return UNKNOWN;
  }
}

/**
 * The calibration state in words: frequency profile name or none; "SPL CALIBRATED (…)" only for
 * a valid LevelCalibration (calibration/level.js), otherwise "level UNCALIBRATED (<spec §24
 * scale label>)" — never the string "SPL" without a valid level calibration.
 */
export function describeCalibration(cal) {
  const f = cal && cal.frequency;
  const l = cal && cal.level;
  const freq = f ? `frequency profile "${f.name || UNKNOWN}"` : 'frequency profile none';
  const spl = isValidLevelCalibration(l)
    ? `SPL CALIBRATED (${sig(l.referenceDbSpl, 4)} dB SPL at ${formatHz(l.referenceHz)})`
    : `level UNCALIBRATED (${RELATIVE_SCALE_LABEL})`;
  return `${freq}, ${spl}`;
}

/** Compact text lines (§161). Nothing missing is invented: it reads Unknown/UNCALIBRATED. */
export function summarizeExperiment(e) {
  const s = e.recipe && e.recipe.stimulus;
  const label = e.input && e.input.device && e.input.device.label;
  const runs = e.measurement && Array.isArray(e.measurement.runs) ? e.measurement.runs.length : 0;
  const repeats = e.recipe && typeof e.recipe.repeats === 'number' ? e.recipe.repeats : null;
  const level = e.output && typeof e.output.level === 'number' ? e.output.level : null;
  const sr = e.measurement && e.measurement.sampleRate;
  const levelText = level === null ? UNKNOWN : level === 0 ? 'digital peak 0 (silent)'
    : `digital peak ${sig(level, 3)}, ${(20 * Math.log10(level)).toFixed(1)} ${RELATIVE_UNIT}`;
  return [
    `Name: ${e.name ? e.name : '(unnamed)'}`,
    `Stimulus: ${describeStimulus(s)}`,
    `Output level: ${levelText}`,
    `Input: ${label || UNKNOWN_DEVICE}`,
    `Calibration: ${describeCalibration(e.calibration)}`,
    `Sample rate: ${typeof sr === 'number' ? `${sig(sr, 6)} Hz` : UNKNOWN}`,
    `Runs: ${runs}${repeats !== null ? ` of ${repeats} requested` : ''}`,
    `Quality: ${e.quality && e.quality.status ? e.quality.status : `${UNKNOWN} (not assessed)`}`,
    `OSCILLA ${e.oscillaVersion || UNKNOWN}, commit ${
      e.oscillaCommit ? e.oscillaCommit.slice(0, 7) : UNKNOWN}`,
  ];
}
