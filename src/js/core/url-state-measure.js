// MEASURE recipe in the URL hash (spec §102 "URL hash may carry small recipes; never results",
// §103, §160; plan V355). Pure.
//
// Format: the hash parameter `mr` = base64url(JSON) of a small object with fixed wire keys:
//   { v: 1, f1, f2, d (sweep duration s), l ('low'|'medium'|'high'), n (runs),
//     a ('mean'|'median'), nc (noise check s), pr (pre-roll s), po (post-roll s), g (gap s),
//     ph (phase, boolean) }
// It is the recipe the MEASURE setup edits (measure-flow.js recipeFromFields: stimulus range,
// duration, digital output level, repeats, aggregation, timing, phase) and nothing else: no
// result, no calibration, no input device, no name or notes. It coexists with the instrument
// state of url-state.js (`#v=1&m=…&x=…`) in the same hash: each codec reads only its own keys
// (decodeHash ignores `mr`; this module ignores everything else), and withRecipeParam() sets
// `mr` while keeping every other parameter.
//
// Reading a link is an import of untrusted text (spec §58): decodeRecipeLink() refuses the
// whole recipe — never repairs or partly applies it — when the parameter is longer than
// RECIPE_LINK_MAX_CHARS, is not base64url JSON, is not a plain object, has an unknown key or a
// missing or unknown version, or any value is of the wrong type, outside its expert field's
// range (measure-flow.js expertFields at the highest supported sample rate; the engine still
// lowers f2 to 0.95 × Nyquist of the running context and says so), not an allowed choice, or
// when f1 ≥ f2. Absent keys take the CHARACTERIZE PLAYBACK CHAIN preset values (`defaults`).
// Applying a decoded recipe never starts anything (src/js/ui/measure.js).
//
//   encodeRecipeLink(values) -> string                 (the `mr` value)
//   decodeRecipeLink(param, { defaults }) -> { ok: true, values } | { ok: false, errors }
//   recipeParamOf(hash) -> string | null               (the `mr` value of a hash, or null)
//   withRecipeParam(hash, param) -> string              (hash without '#', `mr` set or removed)

import { base64UrlDecode, base64UrlEncode } from './math.js';
import { expertFields } from '../measurement/views/measure-flow.js';
import { SAMPLE_RATE_LIMITS } from '../measurement/stimulus.js';

export const RECIPE_HASH_KEY = 'mr';
export const RECIPE_LINK_VERSION = 1;
/** Longest accepted `mr` value (characters): a full recipe encodes to about 200. */
export const RECIPE_LINK_MAX_CHARS = 1024;

/** Wire key → expert field id, in the (fixed) encoding order. */
export const RECIPE_WIRE_KEYS = Object.freeze({
  f1: 'f1', f2: 'f2', d: 'duration', l: 'level', n: 'repeats', a: 'aggregation',
  nc: 'noiseCheckS', pr: 'preRollS', po: 'postRollS', g: 'gapS', ph: 'phase',
});

/** The expert fields a link may set (id → field), ranges at the highest supported rate. */
export function recipeLinkFields() {
  const all = expertFields({ disclosure: 'advanced', sampleRate: SAMPLE_RATE_LIMITS[1] })
    .groups.flatMap((g) => g.fields);
  const out = {};
  for (const id of Object.values(RECIPE_WIRE_KEYS)) {
    const f = all.find((x) => x.id === id);
    if (f && f.path) out[id] = f;
  }
  return out;
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** The `mr` value of setup values (field id → value); only recipe fields are written. */
export function encodeRecipeLink(values) {
  const fields = recipeLinkFields();
  const doc = { v: RECIPE_LINK_VERSION };
  for (const [wire, id] of Object.entries(RECIPE_WIRE_KEYS)) {
    if (!fields[id] || !values || !Object.hasOwn(values, id)) continue;
    const v = values[id];
    doc[wire] = fields[id].kind === 'toggle' ? !!v : v;
  }
  return base64UrlEncode(JSON.stringify(doc));
}

function checkValue(f, v) {
  if (f.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
    if (v < f.min || v > f.max) return `must be ${f.min}–${f.max}${f.unit ? ` ${f.unit}` : ''}`;
    if (f.id === 'repeats' && !Number.isInteger(v)) return 'must be a whole number';
    return null;
  }
  if (f.kind === 'choice') {
    return (f.choices || []).some((c) => c.value === v) ? null
      : `must be one of ${(f.choices || []).map((c) => c.value).join(', ')}`;
  }
  if (f.kind === 'toggle') return typeof v === 'boolean' ? null : 'must be true or false';
  return 'cannot be set by a link';
}

/**
 * Decode and validate an `mr` value (see the header). `defaults` (field id → value) fill the
 * keys the link does not carry. Never throws.
 */
export function decodeRecipeLink(param, { defaults = {} } = {}) {
  const fail = (...errors) => ({ ok: false, errors });
  if (typeof param !== 'string' || param === '') return fail('the link carries no recipe');
  if (param.length > RECIPE_LINK_MAX_CHARS) {
    return fail(`the recipe is longer than ${RECIPE_LINK_MAX_CHARS} characters`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(param)) return fail('the recipe is not base64url text');
  let doc;
  try {
    doc = JSON.parse(base64UrlDecode(param));
  } catch (e) {
    return fail('the recipe is not valid JSON');
  }
  if (!isPlain(doc)) return fail('the recipe must be an object');
  const keys = Object.keys(doc);
  if (keys.length > Object.keys(RECIPE_WIRE_KEYS).length + 1) return fail('too many keys');
  const errors = [];
  if (doc.v !== RECIPE_LINK_VERSION) {
    errors.push(`unsupported recipe version ${JSON.stringify(doc.v) ?? 'none'} (this OSCILLA `
      + `reads version ${RECIPE_LINK_VERSION})`);
  }
  for (const k of keys) {
    if (k !== 'v' && !Object.hasOwn(RECIPE_WIRE_KEYS, k)) {
      errors.push(`unknown key "${String(k).slice(0, 20)}" (a link carries a recipe only, never `
        + 'results)');
    }
  }
  if (errors.length) return fail(...errors);
  const fields = recipeLinkFields();
  const values = {};
  for (const [wire, id] of Object.entries(RECIPE_WIRE_KEYS)) {
    const f = fields[id];
    if (!f) continue;
    if (Object.hasOwn(doc, wire)) {
      const why = checkValue(f, doc[wire]);
      if (why) errors.push(`${f.label}: ${why}`);
      else values[id] = doc[wire];
    } else if (Object.hasOwn(defaults, id)) values[id] = defaults[id];
  }
  if (!errors.length && typeof values.f1 === 'number' && typeof values.f2 === 'number'
    && !(values.f1 < values.f2)) {
    errors.push('Start frequency must be below the end frequency');
  }
  return errors.length ? fail(...errors) : { ok: true, values };
}

/** The `mr` value of a location hash (with or without '#'), or null. */
export function recipeParamOf(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return null;
  try {
    const q = new URLSearchParams(h);
    return q.has(RECIPE_HASH_KEY) ? q.get(RECIPE_HASH_KEY) : null;
  } catch (e) {
    return null;
  }
}

/** The hash (without '#') with `mr` set to `param` (null removes it); other keys are kept. */
export function withRecipeParam(hash, param) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (param === null || param === undefined) q.delete(RECIPE_HASH_KEY);
  else q.set(RECIPE_HASH_KEY, param);
  return q.toString();
}
