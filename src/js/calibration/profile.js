// OSCILLA calibration — frequency-response calibration profiles
// (spec §17-§21, §25, §93, §200).
//
// Method: a FrequencyProfile is a list of [hz, db] pairs stating a measuring chain's deviation
// from flat (see interpolate.js for the sign convention). Normalization sorts points ascending by
// frequency, merges exact duplicates (same Hz AND same dB), and rejects everything else that
// would make the profile ambiguous: conflicting duplicates, non-finite values, frequencies
// outside 1 Hz-200 kHz, corrections beyond ±60 dB, fewer than 1 or more than 2000 points.
//
// Sign convention (schema 2): `convention` says what the stated values mean, so a correction is
// never applied with a guessed sign (interpolate.js applies it):
//   'deviation'   the file states the measuring chain's DEVIATION from flat ("+2.1 dB at
//                 10 kHz" = the microphone reads 2.1 dB high there): corrected = observed − value.
//                 This is how measurement-microphone calibration files are distributed, and the
//                 only meaning schema 1 (V3.0) had.
//   'correction'  the file states a CORRECTION TO ADD (an EQ curve, the inverse of the
//                 deviation): corrected = observed + value.
// parse.js decides it from the file or asks the user (it is never guessed for headers such as
// "correction", "gain", "cal" or "eq"); the profile stores it.
//
// Identity (spec §200): `profileId` is the SHA-256 of a canonical JSON serialization of
// { schemaVersion: 1, kind, units, points } after normalization, plus `convention` when it is
// not 'deviation'. The identity format stays the schema-1 one so that every V3.0 profile (a
// deviation profile by definition) keeps the id V3.0 experiments recorded after migration, while
// a 'correction' profile never shares an id with the same points read as a deviation. Name,
// source, notes, file name and import time are deliberately excluded, so renaming or
// re-importing the same data keeps the ID, and any change to a single point or to the convention
// changes it. Numbers serialize through ECMAScript Number::toString (shortest round-trip form),
// which is specified, so the ID is stable across engines.
//
// Migration (schema 1 → 2): migrateProfileDocument() adds convention 'deviation' to a schema-1
// export (or a document without a schema version); the id is unchanged (see Identity).
//
// Provenance (spec §21, §93): nothing is invented. `source` and `notes` are whatever the user
// supplied, else null; `importedAt` is the caller's timestamp, else null. An absent name becomes
// the neutral label UNNAMED_PROFILE, which claims nothing.
//
// Limits: pure; inputs are never mutated; throws CalibrationError (with `.errors`) on invalid
// input instead of repairing it.

import { sha256Hex } from './sha256.js';

export const PROFILE_SCHEMA_VERSION = 2;
/** Schema versions this build reads (1 = V3.0, migrated by migrateProfileDocument). */
export const PROFILE_SCHEMA_VERSIONS = Object.freeze([1, 2]);
/** The identity format of profileId (the schema-1 canonical form, see the header). */
const IDENTITY_SCHEMA_VERSION = 1;
export const PROFILE_KIND = 'frequency';
export const PROFILE_FORMAT = 'oscilla.calibration';
export const PROFILE_UNITS = Object.freeze({ frequency: 'Hz', correction: 'dB' });
export const UNNAMED_PROFILE = 'Unnamed profile';

/** Sign conventions of the stated values (see the header); sign: corrected = observed + sign·v. */
export const PROFILE_CONVENTIONS = Object.freeze({
  deviation: Object.freeze({ id: 'deviation', sign: -1,
    label: "the file states the microphone's deviation (corrected = observed − value)" }),
  correction: Object.freeze({ id: 'correction', sign: 1,
    label: 'the file states a correction to add (corrected = observed + value)' }),
});
/** The convention of a schema-1 profile (V3.0 had no other). */
export const DEFAULT_CONVENTION = 'deviation';

/** The convention of a profile-like object: its own, else 'deviation' (schema 1). */
export function conventionOf(profile) {
  const c = profile && profile.convention !== undefined ? profile.convention : DEFAULT_CONVENTION;
  if (!Object.hasOwn(PROFILE_CONVENTIONS, c)) {
    throw new CalibrationError(`unknown convention ${fmt(c)} (use deviation or correction)`);
  }
  return c;
}

export const PROFILE_LIMITS = Object.freeze({
  minPoints: 1,
  maxPoints: 2000,
  minHz: 1,
  maxHz: 200000,
  maxAbsCorrectionDb: 60,
  maxNameLength: 200,
  maxSourceLength: 500,
  maxNotesLength: 10000,
});

export class CalibrationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'CalibrationError';
    this.errors = errors;
  }
}

function pointParts(p) {
  if (Array.isArray(p)) return [p[0], p[1]];
  if (p && typeof p === 'object') return [p.hz, p.db];
  return [undefined, undefined];
}

const fmt = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v) ?? String(v));

// Validate and normalize raw points ([hz, db] pairs or { hz, db } objects).
// Returns { points, errors: [{ index, text }], warnings: [{ index, text }], unsorted }, where
// `index` is the position in the input array. Errors make the result unusable; warnings do not.
export function normalizePoints(input) {
  const L = PROFILE_LIMITS;
  const errors = [];
  const warnings = [];
  if (!Array.isArray(input)) {
    return { points: [], errors: [{ index: null, text: 'points must be an array' }], warnings,
      unsorted: false };
  }
  const items = [];
  input.forEach((p, index) => {
    const [hz, db] = pointParts(p);
    if (typeof hz !== 'number' || typeof db !== 'number') {
      errors.push({ index, text: `point ${index}: frequency and correction must be numbers` });
      return;
    }
    if (!Number.isFinite(hz) || !Number.isFinite(db)) {
      errors.push({ index,
        text: `point ${index}: non-finite value (${fmt(hz)} Hz, ${fmt(db)} dB)` });
      return;
    }
    if (hz < L.minHz || hz > L.maxHz) {
      errors.push({ index,
        text: `point ${index}: frequency ${hz} Hz outside ${L.minHz} Hz-${L.maxHz / 1000} kHz` });
      return;
    }
    if (Math.abs(db) > L.maxAbsCorrectionDb) {
      errors.push({ index,
        text: `point ${index}: correction ${db} dB outside ±${L.maxAbsCorrectionDb} dB` });
      return;
    }
    items.push({ hz, db: db === 0 ? 0 : db, index }); // fold -0 into 0
  });

  let unsorted = false;
  for (let i = 1; i < items.length; i++) {
    if (items[i].hz < items[i - 1].hz) {
      unsorted = true;
      break;
    }
  }
  // Stable sort keeps input order among equal frequencies, so messages cite the first one.
  const sorted = unsorted ? items.slice().sort((a, b) => a.hz - b.hz) : items;
  const points = [];
  const keptIndex = [];
  for (const it of sorted) {
    const prev = points.length ? points[points.length - 1] : null;
    if (prev && prev[0] === it.hz) {
      const first = keptIndex[keptIndex.length - 1];
      if (prev[1] === it.db) {
        warnings.push({ index: it.index,
          text: `point ${it.index}: exact duplicate of point ${first} (${it.hz} Hz) merged` });
      } else {
        errors.push({ index: it.index, text: `point ${it.index}: ${it.hz} Hz appears with `
          + `conflicting corrections (${prev[1]} dB and ${it.db} dB)` });
      }
      continue;
    }
    points.push([it.hz, it.db]);
    keptIndex.push(it.index);
  }
  if (unsorted) {
    warnings.push({ index: null, text: 'points were not in ascending frequency order; sorted' });
  }
  if (errors.length === 0) {
    if (points.length < L.minPoints) {
      errors.push({ index: null, text: 'a profile needs at least one point' });
    } else if (points.length > L.maxPoints) {
      errors.push({ index: null,
        text: `${points.length} points exceed the limit of ${L.maxPoints}` });
    }
  }
  return { points: errors.length ? [] : points, errors, warnings, unsorted };
}

function optionalText(value, field, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CalibrationError(`${field} must be a string`);
  const t = value.trim();
  if (t === '') return null;
  if (t.length > max) throw new CalibrationError(`${field} longer than ${max} characters`);
  return t;
}

function canonicalString(points, convention = DEFAULT_CONVENTION) {
  // Fixed key order; this string is the identity of the profile (spec §200). A deviation
  // profile serializes exactly as in schema 1 (see the header).
  const doc = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    kind: PROFILE_KIND,
    units: { frequency: PROFILE_UNITS.frequency, correction: PROFILE_UNITS.correction },
    points,
  };
  if (convention !== DEFAULT_CONVENTION) doc.convention = convention;
  return JSON.stringify(doc);
}

function checkedPoints(points) {
  const r = normalizePoints(points);
  if (r.errors.length) {
    throw new CalibrationError(`invalid calibration points: ${r.errors[0].text}`
      + (r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ''), r.errors);
  }
  return r.points;
}

// Deterministic profile ID: 64 hex characters of SHA-256 over the canonical normalized points
// and convention. Accepts a FrequencyProfile (or any object with `points` and an optional
// `convention`, default 'deviation'); name and metadata are ignored.
export function profileId(profile) {
  if (!profile || typeof profile !== 'object') throw new CalibrationError('profile required');
  if (profile.kind !== undefined && profile.kind !== PROFILE_KIND) {
    throw new CalibrationError(`not a frequency profile (kind ${fmt(profile.kind)})`);
  }
  return sha256Hex(canonicalString(checkedPoints(profile.points), conventionOf(profile)));
}

// Build a normalized FrequencyProfile (docs/v3/architecture.md). Throws CalibrationError.
// convention: 'deviation' (default, the schema-1 meaning) or 'correction' (see the header).
export function createFrequencyProfile({
  name, source, notes, points, importedAt, convention = DEFAULT_CONVENTION,
} = {}) {
  const normalized = checkedPoints(points);
  const conv = conventionOf({ convention });
  const label = optionalText(name, 'name', PROFILE_LIMITS.maxNameLength) ?? UNNAMED_PROFILE;
  if (importedAt !== undefined && importedAt !== null && typeof importedAt !== 'string') {
    throw new CalibrationError('importedAt must be a string timestamp or null');
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    kind: PROFILE_KIND,
    id: sha256Hex(canonicalString(normalized, conv)),
    name: label,
    convention: conv,
    source: optionalText(source, 'source', PROFILE_LIMITS.maxSourceLength),
    notes: optionalText(notes, 'notes', PROFILE_LIMITS.maxNotesLength),
    units: { frequency: PROFILE_UNITS.frequency, correction: PROFILE_UNITS.correction },
    points: normalized,
    importedAt: importedAt || null,
  };
}

// Normalized OSCILLA export object (spec §21). `source` appears only when the user gave one;
// `id` is included so a re-import can be checked against its recomputed hash.
export function exportProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new CalibrationError('profile required');
  if (profile.kind !== undefined && profile.kind !== PROFILE_KIND) {
    throw new CalibrationError(`not a frequency profile (kind ${fmt(profile.kind)})`);
  }
  const p = createFrequencyProfile(profile);
  const out = {
    format: PROFILE_FORMAT,
    schemaVersion: p.schemaVersion,
    kind: p.kind,
    id: p.id,
    name: p.name,
    convention: p.convention,
  };
  if (p.source !== null) out.source = p.source;
  out.units = { ...p.units };
  out.points = p.points.map(([hz, db]) => [hz, db]);
  out.notes = p.notes;
  out.importedAt = p.importedAt;
  return out;
}

/**
 * migrateProfileDocument(doc) → { ok: true, doc, from, migrated } | { ok: false, text }
 * Upgrades a parsed OSCILLA profile document to the current schema: schema 1 (or no schema
 * version) gains convention 'deviation', the only meaning schema 1 had (its id is unchanged,
 * see Identity). A newer schema is refused; the input is not modified.
 */
export function migrateProfileDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, text: 'not a profile document' };
  }
  const from = doc.schemaVersion === undefined ? 1 : doc.schemaVersion;
  if (!PROFILE_SCHEMA_VERSIONS.includes(from)) {
    return { ok: false, text: `unsupported schemaVersion ${fmt(doc.schemaVersion)}` };
  }
  if (from === PROFILE_SCHEMA_VERSION) return { ok: true, doc: { ...doc }, from, migrated: false };
  if (doc.convention !== undefined && doc.convention !== DEFAULT_CONVENTION) {
    return { ok: false, text: `a schema-1 profile cannot state convention ${fmt(doc.convention)}` };
  }
  return { ok: true, doc: { ...doc, schemaVersion: PROFILE_SCHEMA_VERSION,
    convention: DEFAULT_CONVENTION }, from, migrated: true };
}
