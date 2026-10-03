// OSCILLA calibration — absolute level calibration (spec §17, §22-§24, §96, §98).
//
// Method: one explicit reference reading. The user plays a known external reference (typically
// a 94 dB SPL calibrator at 1 kHz) into the microphone, OSCILLA observes its relative level X
// and the offset is Y = referenceDbSpl − X. A later relative reading R on the SAME scale is then
// displayed as R + Y dB SPL. This is a single broadband scalar for the whole input chain; it is
// kept separate from frequency-response calibration (profile.js) and is never derived from it
// (spec §17).
//
// The scale of X (schema 2): OSCILLA has several "dB relative" scales (the MEASURE noise and RTA
// band levels on the mean-square scale, where a full-scale sine reads −3.01 dB; the instrument's
// analyser readings; a dBFS peak scale where it reads 0 dB). An offset is meaningful only on the
// scale X was read on, so a schema-2 calibration names it: LEVEL_SCALE, the one-third-octave
// band level at the reference frequency on the mean-square scale, which is exactly what
// reference.js measureReferenceLevel() returns from a capture of the SAME capture io as MEASURE
// and what the MEASURE noise and RTA bands display. `method` says how X was obtained:
// 'captured' (measured in the level-calibration dialog) or 'manual' (typed by the user, an
// advanced option labelled with the same scale).
//
// The input (schema 2): the offset is valid only for the input it was taken with. `input`
// records { deviceId (hashed, device-id.js), sampleRate, echoCancellation, noiseSuppression,
// autoGainControl, channelCount } from the capture's applied settings (null for an unknown
// value, `input: null` when nothing was known). levelCalibrationApplies(cal, current) compares
// it with the current input and voids the calibration — UNCALIBRATED with the reason — when any
// recorded value differs. Input gain and microphone position are not observable by a browser;
// `conditions` records them in the user's words.
//
// Schema 1 (V3.0) records have no scale and no input; they stay valid as stored records (an
// experiment keeps what it was measured with) but the workspace only creates schema 2.
//
// Labeling (spec §24): only a valid LevelCalibration produces the unit 'dB SPL' with a
// CALIBRATED indicator. Anything else — null, a malformed object, an offset that does not match
// its own inputs — displays RELATIVE_UNIT 'dB relative (dBFS-like)', UNCALIBRATED, on the scale
// RELATIVE_SCALE_LABEL 'Relative level · dBFS-like / analyser-relative scale' (the spec §24
// wording). These two constants are the ONE label of the uncalibrated scale: format.js,
// quality.js, experiments/csv.js and experiments/schema.js import them, and no uncalibrated
// output of those modules contains "SPL" (asserted in tests). There is no default SPL
// calibration anywhere in this module (spec §23).
//
// X is read without frequency correction (reference.js), so the offset already contains the
// input's deviation at referenceHz. A reading that a frequency profile corrected takes the
// offset of levelOffsetWithProfile(), which removes the profile's correction at referenceHz
// again: otherwise that correction is counted twice (V382: a 94 dB calibrator read 92 dB SPL
// under a +2 dB deviation profile).
// Pure; inputs are never mutated; throws RangeError/TypeError on invalid input.

import { hashDeviceId, isHashedDeviceId } from './device-id.js';
import { conventionSign, correctionAt } from './interpolate.js';

/** Current LevelCalibration schema (2: scale, method and input binding). */
export const LEVEL_SCHEMA_VERSION = 2;
/** Every schema this build reads (1 = V3.0 records without scale or input). */
export const LEVEL_SCHEMA_VERSIONS = Object.freeze([1, 2]);
export const LEVEL_KIND = 'level';
export const SPL_UNIT = 'dB SPL';
/** Unit printed after an uncalibrated level value (the one uncalibrated unit label). */
export const RELATIVE_UNIT = 'dB relative (dBFS-like)';
/** Name of the uncalibrated scale for axes, legends and file metadata (spec §24 wording). */
export const RELATIVE_SCALE_LABEL = 'Relative level · dBFS-like / analyser-relative scale';

/** The scale of observedDbRelative in a schema-2 calibration (see the header). */
export const LEVEL_SCALE = Object.freeze({
  id: 'band-mean-square',
  label: 'one-third-octave band level at the reference frequency, dB re digital full scale on '
    + 'the mean-square scale (a full-scale sine reads −3.01 dB; the MEASURE noise and RTA band '
    + 'scale)',
});
export const LEVEL_METHODS = Object.freeze(['captured', 'manual']);
/** Applied input settings a calibration is bound to (besides deviceId and sampleRate). */
export const LEVEL_INPUT_FLAGS = Object.freeze(['echoCancellation', 'noiseSuppression',
  'autoGainControl']);
const BINDING_KEYS = Object.freeze(['deviceId', 'sampleRate', ...LEVEL_INPUT_FLAGS,
  'channelCount']);

export const LEVEL_LIMITS = Object.freeze({
  minReferenceHz: 20,
  maxReferenceHz: 20000,
  minReferenceDbSpl: 40,
  maxReferenceDbSpl: 140,
  maxConditionsLength: 2000,
});

// Agreement required between a stored offset and referenceDbSpl − observedDbRelative. The
// subtraction of two doubles of magnitude ≤ ~10^3 is exact to ~1e-13; 1e-9 dB only absorbs
// rounding introduced by a JSON round trip, never a real disagreement.
const OFFSET_TOLERANCE_DB = 1e-9;

function finiteIn(value, lo, hi) {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
}

const isBoolOrNull = (v) => v === null || typeof v === 'boolean';
const isPosOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0);
const posOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * inputBinding(input) → the input a calibration is bound to, or null when nothing is known.
 * input: capture/preflight facts { device: { id }, constraints: { applied }, sampleRate } (an
 * engine result's `input` plus its sampleRate) or an existing binding (returned normalized).
 * The deviceId is stored hashed (device-id.js, spec §88).
 */
export function inputBinding(input) {
  if (!input || typeof input !== 'object') return null;
  const isBinding = Object.hasOwn(input, 'deviceId') && !Object.hasOwn(input, 'device');
  const applied = isBinding ? input : (input.constraints && input.constraints.applied) || {};
  const rawId = isBinding ? input.deviceId
    : (input.device && input.device.id) ?? applied.deviceId ?? null;
  const flag = (k) => (typeof applied[k] === 'boolean' ? applied[k] : null);
  const out = {
    deviceId: typeof rawId === 'string' && rawId ? hashDeviceId(rawId) : null,
    sampleRate: posOrNull(input.sampleRate) ?? posOrNull(applied.sampleRate),
    echoCancellation: flag('echoCancellation'),
    noiseSuppression: flag('noiseSuppression'),
    autoGainControl: flag('autoGainControl'),
    channelCount: posOrNull(applied.channelCount),
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

/** True for null or a binding of inputBinding()'s exact shape. */
export function isInputBinding(b) {
  if (b === null) return true;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (Object.keys(b).length !== BINDING_KEYS.length
    || !BINDING_KEYS.every((k) => Object.hasOwn(b, k))) return false;
  return (b.deviceId === null || isHashedDeviceId(b.deviceId))
    && isPosOrNull(b.sampleRate) && isPosOrNull(b.channelCount)
    && LEVEL_INPUT_FLAGS.every((k) => isBoolOrNull(b[k]));
}

/**
 * Build a LevelCalibration (schema 2, docs/v3/architecture.md). createdAt is the caller's
 * timestamp; method 'captured' | 'manual'; input: capture facts or a binding (inputBinding),
 * null when unknown.
 */
export function createLevelCalibration({
  referenceHz, referenceDbSpl, observedDbRelative, conditions, createdAt, method = 'manual',
  input = null,
} = {}) {
  const L = LEVEL_LIMITS;
  if (!finiteIn(referenceHz, L.minReferenceHz, L.maxReferenceHz)) {
    throw new RangeError(`referenceHz must be within ${L.minReferenceHz} Hz-`
      + `${L.maxReferenceHz / 1000} kHz, got ${String(referenceHz)}`);
  }
  if (!finiteIn(referenceDbSpl, L.minReferenceDbSpl, L.maxReferenceDbSpl)) {
    throw new RangeError(`referenceDbSpl must be within ${L.minReferenceDbSpl}-`
      + `${L.maxReferenceDbSpl} dB SPL, got ${String(referenceDbSpl)}`);
  }
  if (typeof observedDbRelative !== 'number' || !Number.isFinite(observedDbRelative)) {
    throw new RangeError(`observedDbRelative must be finite, got ${String(observedDbRelative)}`);
  }
  if (!LEVEL_METHODS.includes(method)) {
    throw new RangeError(`method must be ${LEVEL_METHODS.join(' or ')}, got ${String(method)}`);
  }
  let cond = null;
  if (conditions !== undefined && conditions !== null) {
    if (typeof conditions !== 'string') throw new TypeError('conditions must be a string');
    const t = conditions.trim();
    if (t.length > L.maxConditionsLength) {
      throw new RangeError(`conditions longer than ${L.maxConditionsLength} characters`);
    }
    cond = t === '' ? null : t;
  }
  if (typeof createdAt !== 'string' || createdAt.trim() === '') {
    throw new TypeError('createdAt must be a non-empty timestamp string supplied by the caller');
  }
  return {
    schemaVersion: LEVEL_SCHEMA_VERSION,
    kind: LEVEL_KIND,
    referenceHz,
    referenceDbSpl,
    observedDbRelative,
    offsetDb: referenceDbSpl - observedDbRelative,
    scale: LEVEL_SCALE.id,
    method,
    input: inputBinding(input),
    conditions: cond,
    createdAt,
  };
}

// True only for a structurally valid calibration whose offset matches its own inputs.
export function isValidLevelCalibration(cal) {
  const L = LEVEL_LIMITS;
  if (!cal || typeof cal !== 'object' || !LEVEL_SCHEMA_VERSIONS.includes(cal.schemaVersion)) {
    return false;
  }
  const base = cal.kind === LEVEL_KIND
    && finiteIn(cal.referenceHz, L.minReferenceHz, L.maxReferenceHz)
    && finiteIn(cal.referenceDbSpl, L.minReferenceDbSpl, L.maxReferenceDbSpl)
    && typeof cal.observedDbRelative === 'number' && Number.isFinite(cal.observedDbRelative)
    && typeof cal.offsetDb === 'number' && Number.isFinite(cal.offsetDb)
    && Math.abs(cal.offsetDb - (cal.referenceDbSpl - cal.observedDbRelative))
      <= OFFSET_TOLERANCE_DB
    && typeof cal.createdAt === 'string' && cal.createdAt.trim() !== '';
  if (!base || cal.schemaVersion === 1) return base;
  return cal.scale === LEVEL_SCALE.id && LEVEL_METHODS.includes(cal.method)
    && isInputBinding(cal.input ?? null);
}

const BINDING_WORDS = Object.freeze({
  deviceId: 'input device', sampleRate: 'sample rate', echoCancellation: 'echo cancellation',
  noiseSuppression: 'noise suppression', autoGainControl: 'automatic gain control',
  channelCount: 'channel count',
});

function bindingValueText(k, v) {
  if (v === null) return 'not reported';
  if (k === 'sampleRate') return `${v} Hz`;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

/**
 * levelCalibrationApplies(cal, current) → { applies, checked, reason, differences }
 * current: the input in use now (capture facts or a binding, inputBinding()), null when it is
 * not known yet. A schema-2 calibration whose recorded input differs in any field from the
 * current one does NOT apply (reason says what differs); without a recorded or a current input
 * nothing can be compared (checked false, applies true for a valid calibration).
 */
export function levelCalibrationApplies(cal, current) {
  if (!isValidLevelCalibration(cal)) {
    return { applies: false, checked: false, reason: 'no valid level calibration',
      differences: [] };
  }
  const was = cal.schemaVersion === 1 ? null : cal.input ?? null;
  const now = current ? inputBinding(current) : null;
  if (!was || !now) return { applies: true, checked: false, reason: null, differences: [] };
  const differences = [];
  for (const k of BINDING_KEYS) {
    if (was[k] !== now[k]) {
      differences.push({ field: k, was: was[k], now: now[k],
        text: k === 'deviceId' ? 'a different input device'
          : `${BINDING_WORDS[k]} ${bindingValueText(k, was[k])} at calibration, `
            + `${bindingValueText(k, now[k])} now` });
    }
  }
  if (!differences.length) return { applies: true, checked: true, reason: null, differences };
  return { applies: false, checked: true, differences,
    reason: `UNCALIBRATED: the level calibration was taken with ${differences.map((d) => d.text)
      .join('; ')}. Calibrate again for this input.` };
}

// Unit label for displayed levels (spec §24). With `current` (the input in use), a calibration
// taken with another input is UNCALIBRATED and `reason` says why (levelCalibrationApplies).
export function levelLabel(levelCalibration, current = null) {
  const a = levelCalibrationApplies(levelCalibration, current);
  if (a.applies) return { unit: SPL_UNIT, calibrated: true, indicator: 'CALIBRATED' };
  const out = { unit: RELATIVE_UNIT, calibrated: false, indicator: 'UNCALIBRATED' };
  if (a.checked) out.reason = a.reason;
  return out;
}

// Display value for a relative level: offset applied only under a valid calibration.
/**
 * The offset to add to a relative reading; `profile`: the frequency profile that corrected the
 * reading (null: an uncorrected reading). The profile's applied correction at referenceHz is
 * taken out of the offset (see the header), so the reference frequency reads referenceDbSpl
 * whatever the profile; a profile that does not cover referenceHz changes nothing there.
 * 0 without a valid calibration.
 */
export function levelOffsetWithProfile(levelCalibration, profile = null) {
  if (!isValidLevelCalibration(levelCalibration)) return 0;
  const offset = levelCalibration.offsetDb;
  if (!profile) return offset;
  const c = correctionAt(profile, levelCalibration.referenceHz);
  return c && c.covered ? offset - conventionSign(profile) * c.correctionDb : offset;
}

export function toDisplayLevel(dbRelative, levelCalibration, { profile = null } = {}) {
  if (typeof dbRelative !== 'number') throw new TypeError('dbRelative must be a number');
  if (isValidLevelCalibration(levelCalibration)) {
    return { value: dbRelative + levelOffsetWithProfile(levelCalibration, profile), unit: SPL_UNIT,
      calibrated: true };
  }
  return { value: dbRelative, unit: RELATIVE_UNIT, calibrated: false };
}
