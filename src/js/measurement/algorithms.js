// Stable algorithm identifiers persisted in measurement results and experiments (spec §43,
// §199). An ID names a method and its version, never an implementation detail: a change that
// can alter a stored number gets a new version (`.v2`), and old IDs stay meaningful so a stored
// experiment says which method produced it.
//
// ID grammar: oscilla.<family>[.<variant>].v<integer>, lowercase, '-' inside segments.
// `family` in describeAlgorithm() is the key of ALGORITHMS whose ID shares the name (so
// 'oscilla.confidence.v1' belongs to family 'quality'), except that a VARIANT key (an
// alternative method of another role, VARIANT_OF) reports that role: the Farina-inverse IR is
// family 'ir', the Blackman-Harris window family 'window'. An unknown but well-formed ID falls
// back to its first name segment, so a result written by a newer build can still be grouped.
//
// Every key is a role an experiment may record in its `algorithms` map; the plain role keys
// (transfer, ir, window, ...) name the default method, variants name the alternative one. Which
// module stamps which ID into its result is listed in docs/v3/algorithms.md ("Algorithm
// registry").
//
// Superseded versions (ADR 0024: "old IDs stay in the registry as long as stored data may carry
// them") are listed in RETAINED_ALGORITHMS by role. They are still implemented — e.g.
// quality.js assessQuality({ algorithm: 'oscilla.confidence.v1' }) reproduces a v1 assessment
// exactly, transfer.js computeTransfer({ options: { algorithm: 'oscilla.transfer.v1' } }) a v1
// transfer and impulse-response.js computeImpulseResponse({ algorithm:
// 'oscilla.ir.log-sweep.v1' }) a v1 IR — so isKnownAlgorithm() is true for them and KNOWN_ALGORITHM_IDS (the allow-list for
// importing stored experiments) contains them, but ALGORITHMS names only the default each role
// uses for new results.

export const ALGORITHMS = Object.freeze({
  transfer: 'oscilla.transfer.v2',
  ir: 'oscilla.ir.log-sweep.v2',
  irFarina: 'oscilla.ir.farina-inverse.v2',
  rta: 'oscilla.rta.v1',
  smoothing: 'oscilla.smoothing.fractional-octave.v1',
  normalization: 'oscilla.normalization.v1',
  align: 'oscilla.align.xcorr.v1',
  clip: 'oscilla.clip.v1',
  discontinuity: 'oscilla.discontinuity.v1',
  quality: 'oscilla.confidence.v4',
  calibration: 'oscilla.calibration.log-interp.v1',
  window: 'oscilla.window.hann.v1',
  windowBlackmanHarris: 'oscilla.window.blackman-harris.v1',
  aggregate: 'oscilla.aggregate.v1',
});

/** Superseded IDs by role, still implemented for stored results (newest last). */
export const RETAINED_ALGORITHMS = Object.freeze({
  transfer: Object.freeze(['oscilla.transfer.v1']),
  ir: Object.freeze(['oscilla.ir.log-sweep.v1']),
  irFarina: Object.freeze(['oscilla.ir.farina-inverse.v1']),
  quality: Object.freeze(['oscilla.confidence.v1', 'oscilla.confidence.v2',
    'oscilla.confidence.v3']),
});

/** Variant keys of ALGORITHMS and the role (family) whose alternative method they are. */
export const VARIANT_OF = Object.freeze({ irFarina: 'ir', windowBlackmanHarris: 'window' });

const ID_PATTERN = /^oscilla\.([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.v([1-9][0-9]*)$/;

/** Name part of an ID without its version: 'oscilla.ir.log-sweep.v1' → 'ir.log-sweep'. */
function stemOf(id) {
  const m = ID_PATTERN.exec(id);
  return m ? m[1] : null;
}

const FAMILY_BY_STEM = new Map(
  Object.entries(ALGORITHMS).map(([k, id]) => [stemOf(id), VARIANT_OF[k] || k]),
);
/** Every ID this build implements: the current defaults and the retained superseded ones. */
export const KNOWN_ALGORITHM_IDS = Object.freeze([
  ...Object.values(ALGORITHMS),
  ...Object.values(RETAINED_ALGORITHMS).flat(),
]);
const KNOWN = new Set(KNOWN_ALGORITHM_IDS);

/** True only for an ID this build implements exactly (name and version), current or
 *  retained. */
export function isKnownAlgorithm(id) {
  return typeof id === 'string' && KNOWN.has(id);
}

/**
 * describeAlgorithm(id) → { id, family, version } | null
 * null for anything that is not a well-formed OSCILLA algorithm ID. A well-formed ID of
 * another version (e.g. 'oscilla.transfer.v2') is described, not rejected; use
 * isKnownAlgorithm() to ask whether this build can reproduce it.
 */
export function describeAlgorithm(id) {
  if (typeof id !== 'string') return null;
  const m = ID_PATTERN.exec(id);
  if (!m) return null;
  const stem = m[1];
  const family = FAMILY_BY_STEM.get(stem) || stem.split('.')[0];
  return Object.freeze({ id, family, version: Number(m[2]) });
}
