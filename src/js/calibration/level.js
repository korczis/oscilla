// OSCILLA calibration — absolute level calibration (spec §17, §22-§24, §96, §98).
//
// Method: one explicit reference reading. The user plays a known external reference (typically
// a 94 dB SPL calibrator at 1 kHz) into the microphone, OSCILLA observes its relative level X
// (dB relative, dBFS-like), and the offset is Y = referenceDbSpl − X. A later relative reading
// R is then displayed as R + Y dB SPL. This is a single broadband scalar for the whole input
// chain; it is kept separate from frequency-response calibration (profile.js) and is never
// derived from it (spec §17).
//
// Labeling (spec §24): only a valid LevelCalibration produces the unit 'dB SPL' with a
// CALIBRATED indicator. Anything else — null, a malformed object, an offset that does not match
// its own inputs — displays 'dB relative (dBFS-like)', UNCALIBRATED. There is no default SPL
// calibration anywhere in this module (spec §23).
//
// Limits: the offset is only valid for the device, input gain, browser processing constraints
// and microphone position it was taken with; `conditions` records those in the user's words.
// The reading X must be taken the same way it will later be applied (with or without frequency
// correction), since a frequency correction at referenceHz would otherwise be counted twice.
// Pure; inputs are never mutated; throws RangeError/TypeError on invalid input.

export const LEVEL_SCHEMA_VERSION = 1;
export const LEVEL_KIND = 'level';
export const SPL_UNIT = 'dB SPL';
export const RELATIVE_UNIT = 'dB relative (dBFS-like)';

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

// Build a LevelCalibration (docs/v3/architecture.md). createdAt is the caller's timestamp.
export function createLevelCalibration({
  referenceHz, referenceDbSpl, observedDbRelative, conditions, createdAt,
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
    conditions: cond,
    createdAt,
  };
}

// True only for a structurally valid calibration whose offset matches its own inputs.
export function isValidLevelCalibration(cal) {
  const L = LEVEL_LIMITS;
  return Boolean(cal) && typeof cal === 'object'
    && cal.schemaVersion === LEVEL_SCHEMA_VERSION
    && cal.kind === LEVEL_KIND
    && finiteIn(cal.referenceHz, L.minReferenceHz, L.maxReferenceHz)
    && finiteIn(cal.referenceDbSpl, L.minReferenceDbSpl, L.maxReferenceDbSpl)
    && typeof cal.observedDbRelative === 'number' && Number.isFinite(cal.observedDbRelative)
    && typeof cal.offsetDb === 'number' && Number.isFinite(cal.offsetDb)
    && Math.abs(cal.offsetDb - (cal.referenceDbSpl - cal.observedDbRelative))
      <= OFFSET_TOLERANCE_DB
    && typeof cal.createdAt === 'string' && cal.createdAt.trim() !== '';
}

// Unit label for displayed levels (spec §24).
export function levelLabel(levelCalibration) {
  return isValidLevelCalibration(levelCalibration)
    ? { unit: SPL_UNIT, calibrated: true, indicator: 'CALIBRATED' }
    : { unit: RELATIVE_UNIT, calibrated: false, indicator: 'UNCALIBRATED' };
}

// Display value for a relative level: offset applied only under a valid calibration.
export function toDisplayLevel(dbRelative, levelCalibration) {
  if (typeof dbRelative !== 'number') throw new TypeError('dbRelative must be a number');
  if (isValidLevelCalibration(levelCalibration)) {
    return { value: dbRelative + levelCalibration.offsetDb, unit: SPL_UNIT, calibrated: true };
  }
  return { value: dbRelative, unit: RELATIVE_UNIT, calibrated: false };
}
