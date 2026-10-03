// Shared building blocks for Studio node-type definitions (spec §28, §79). Pure; no DOM, no Web
// Audio, no globals. Definitions are frozen plain data plus a pure `summary(params)` formatter;
// they never hold audio nodes (§28) — `compiler` is a 'module.js#export' key naming the existing
// builder the graph compiler will adapt (resolved by a later issue, checked by the unit tests).
//
// Parameter definition (§79): { key, label, type: 'number'|'integer'|'enum'|'boolean'|'list'|'id',
//   min, max, step, unit, scale: 'linear'|'log', options: [[value, label]], default, nullable,
//   automatable, modulatable, modDepth /* default modulation depth, parameter unit */,
//   softRange /* [lo, hi] Inspector display range inside [min, max] */,
//   minLength, maxLength /* list */, pattern /* id */ }
// Ranges are model validity ranges, independent of any running AudioContext: frequencies may be
// stored up to FREQUENCY_MAX_HZ and the compiler clamps them to 0.95 × Nyquist of the context it
// runs on (project rule audio-engine-discipline), as the sequencer compiler already does.

import { SAFE_NYQUIST_FRACTION, SAMPLE_RATE_LIMITS } from '../../measurement/stimulus.js';
import { formatFrequency } from '../../core/frequency.js';
import { sig } from '../../core/math.js';
import { HEX64_PATTERN } from '../../experiments/schema.js';

/** Highest storable frequency: 0.95 × Nyquist of the highest accepted sample rate (384 kHz). */
export const FREQUENCY_MAX_HZ = (SAMPLE_RATE_LIMITS[1] / 2) * SAFE_NYQUIST_FRACTION;
/** Inspector display range for audio frequencies (the model accepts the full range). */
export const AUDIBLE_SOFT_RANGE = Object.freeze([20, 20000]);

export const CATEGORIES = Object.freeze({
  SOURCES: 'SOURCES',
  MODULATION: 'MODULATION',
  PROCESSING: 'PROCESSING',
  ANALYSIS: 'ANALYSIS',
  OUTPUT: 'OUTPUT',
  MEASUREMENT: 'MEASUREMENT',
});

/** Clip kinds of the timeline (§84); a node type lists the kinds that may target it. */
export const CLIP_KINDS = Object.freeze(['pattern', 'event', 'measurement']);

/** Library order and labels (§29-§30). */
export const CATEGORY_ORDER = Object.freeze([
  Object.freeze({ id: 'SOURCES', label: 'Sources' }),
  Object.freeze({ id: 'MODULATION', label: 'Modulation' }),
  Object.freeze({ id: 'PROCESSING', label: 'Processing' }),
  Object.freeze({ id: 'ANALYSIS', label: 'Analysis' }),
  Object.freeze({ id: 'OUTPUT', label: 'Output' }),
  Object.freeze({ id: 'MEASUREMENT', label: 'Measurement' }),
]);

const BASE = {
  step: null, unit: '', scale: 'linear', options: null, nullable: false, automatable: false,
  modulatable: false, modDepth: null, softRange: null, minLength: null, maxLength: null,
  pattern: null,
};

function freezeParam(p) {
  const out = { ...BASE, ...p };
  if (out.options) out.options = Object.freeze(out.options.map((o) => Object.freeze([...o])));
  if (out.softRange) out.softRange = Object.freeze([...out.softRange]);
  if (Array.isArray(out.default)) out.default = Object.freeze([...out.default]);
  return Object.freeze(out);
}

/** A continuous number parameter. */
export function numberParam(key, label, opts) {
  return freezeParam({ key, label, type: 'number', min: -Infinity, max: Infinity, ...opts });
}

/** An integer parameter. */
export function integerParam(key, label, opts) {
  return freezeParam({ key, label, type: 'integer', step: 1, ...opts });
}

/** A choice among `options` ([[value, label], ...]). */
export function enumParam(key, label, options, def, opts = {}) {
  return freezeParam({ key, label, type: 'enum', options, default: def, ...opts });
}

/** A true/false parameter. */
export function boolParam(key, label, def, opts = {}) {
  return freezeParam({ key, label, type: 'boolean', default: def, ...opts });
}

/** A bounded list of numbers (e.g. step values). */
export function listParam(key, label, opts) {
  return freezeParam({ key, label, type: 'list', ...opts });
}

/** A reference to a stored record by its SHA-256 id (or null), e.g. a calibration profile. */
export function idParam(key, label, opts = {}) {
  return freezeParam({ key, label, type: 'id', nullable: true, default: null,
    pattern: HEX64_PATTERN, ...opts });
}

/** A frequency parameter (Hz, logarithmic). */
export function frequencyParam(key, label, def, opts = {}) {
  return numberParam(key, label, {
    min: 1, max: FREQUENCY_MAX_HZ, unit: 'Hz', scale: 'log', default: def,
    softRange: AUDIBLE_SOFT_RANGE, ...opts,
  });
}

/** A linear level 0..max (relative digital level, never SPL). */
export function levelParam(key, label, def, opts = {}) {
  return numberParam(key, label, { min: 0, max: 1, step: 0.01, default: def, ...opts });
}

/** A time in seconds. */
export function secondsParam(key, label, def, min, max, opts = {}) {
  return numberParam(key, label, { min, max, step: 0.001, unit: 's', default: def, ...opts });
}

// ---------------------------------------------------------------- summary formatting

export const hz = (f) => formatFrequency(f);
export const num = (v, digits = 3) => sig(v, digits);
export const pct = (v) => `${Math.round(v * 100)} %`;
export const secs = (s) => (s < 1 ? `${sig(s * 1000, 3)} ms` : `${sig(s, 3)} s`);

/** The label of an enum value, or the raw value. */
export function optionLabel(def, key, value) {
  const p = def.params.find((x) => x.key === key);
  const o = p && p.options ? p.options.find((x) => x[0] === value) : null;
  return o ? o[1] : String(value);
}

/** Join summary parts with the OSCILLA separator (§75). */
export function parts(...xs) {
  return xs.filter((x) => x !== null && x !== undefined && x !== '').join(' · ');
}

/**
 * Freeze a node definition. Defaults: no inputs/outputs, no clip kinds, unlimited instances,
 * all capabilities false except serializable.
 */
export function defineNode(def) {
  return Object.freeze({
    aliases: [],
    inputs: [],
    outputs: [],
    params: [],
    clipKinds: [],
    reuses: [],
    maxInstances: null,
    sounding: false,
    summing: false,
    ...def,
    capabilities: Object.freeze({
      realtime: false, offline: false, measurement: false, requiresInputPermission: false,
      serializable: true, ...def.capabilities,
    }),
    help: Object.freeze({ ...def.help }),
  });
}
