// The recipe core of the experiment model: the documented limits, the identifier patterns,
// the shared checker, the recipe (checkRecipe, createRecipe) and toIsoTimestamp. Pure: plain
// data in, plain data out; no DOM, no clock, no randomness.
//
// It is the module both schema.js and definition.js import (plan issue E006): schema.js's
// createExperiment derives a run's definition with definition.js derivedRef, and definition.js
// checks an execution with the checker and checkRecipe, so while these lived in schema.js the
// two modules imported each other. This module imports nothing from experiments/, and
// schema.js re-exports every name it exported before, so no importer changes and no value or
// hash changes.
//
//   LIMITS, ID_PATTERN, HEX64_PATTERN, COMMIT_PATTERN, VERSION_PATTERN, ALGORITHM_ID_PATTERN,
//   RUN_ID_PATTERN, ISO_PATTERN, FORBIDDEN_KEYS          (re-exported by schema.js)
//   createChecker(maxErrors?), checkRecipe(c, value, path)   (shared with validate.js)
//   createRecipe(spec) -> Recipe                      (throws RangeError on an invalid recipe)
//   formatErrors(errors) -> "path: text; ..."
//   toIsoTimestamp(now) -> ISO 8601 UTC text
//   isPlainObject(v), CTRL_SINGLE                     (for schema.js; not re-exported)

import {
  DURATION_LIMITS, MIN_FREQUENCY_HZ, SAMPLE_RATE_LIMITS, STIMULUS_KINDS, safeMaxFrequency,
} from '../measurement/stimulus.js';

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
  measurementNotes: 16,
  masterGain: Object.freeze([0, 1]),
});

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
export const RUN_ID_PATTERN = /^run-[1-9][0-9]*$/;
export const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------- checker (shared)

export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && !ArrayBuffer.isView(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const CTRL_SINGLE = /[\u0000-\u001f\u007f]/;
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
  if (!c.keys(value, path, ['stimulus', 'repeats', 'analysis'], ['requested'])) return null;
  const stimulus = checkStimulus(c, value.stimulus, join(path, 'stimulus'));
  const okRepeats = c.num(value.repeats, join(path, 'repeats'), ...LIMITS.repeats,
    { integer: true });
  const analysis = c.json(value.analysis, join(path, 'analysis'));
  if (analysis !== undefined && !isPlainObject(analysis)) {
    c.add(join(path, 'analysis'), 'must be an object');
    return null;
  }
  let requested;
  if (Object.prototype.hasOwnProperty.call(value, 'requested')) {
    const rp = join(path, 'requested');
    if (c.keys(value.requested, rp, ['f1', 'f2'])) {
      const okF = ['f1', 'f2'].map((k) => c.num(value.requested[k], join(rp, k),
        ...LIMITS.frequencyHz, { nullable: true })).every(Boolean);
      if (okF) requested = { f1: value.requested.f1, f2: value.requested.f2 };
    }
    if (requested === undefined) return null;
  }
  if (!stimulus || !okRepeats || analysis === undefined) return null;
  const out = { stimulus, repeats: value.repeats, analysis };
  if (requested !== undefined) out.requested = requested;
  return out;
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
export function createRecipe({ stimulus, repeats = 1, analysis = {}, requested } = {}) {
  const c = createChecker();
  const recipe = checkRecipe(c, requested === undefined || requested === null
    ? { stimulus, repeats, analysis } : { stimulus, repeats, analysis, requested });
  if (!recipe) throw new RangeError(`Invalid recipe: ${formatErrors(c.errors)}`);
  return recipe;
}

/** "path: text; path: text" */
export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.text}`).join('; ');
}

/** ISO 8601 UTC text from an ISO string, a Date or epoch milliseconds (wall clock, §177). */
export function toIsoTimestamp(now) {
  const ms = typeof now === 'string' ? Date.parse(now)
    : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN;
  if (!Number.isFinite(ms)) throw new TypeError('a timestamp (`now`) is required');
  return new Date(ms).toISOString();
}
