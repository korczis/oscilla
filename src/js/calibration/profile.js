// OSCILLA calibration — frequency-response calibration profiles
// (spec §17-§21, §25, §93, §200).
//
// Method: a FrequencyProfile is a list of [hz, db] pairs stating a measuring chain's deviation
// from flat (see interpolate.js for the sign convention). Normalization sorts points ascending by
// frequency, merges exact duplicates (same Hz AND same dB), and rejects everything else that
// would make the profile ambiguous: conflicting duplicates, non-finite values, frequencies
// outside 1 Hz-200 kHz, corrections beyond ±60 dB, fewer than 1 or more than 2000 points.
//
// Identity (spec §200): `profileId` is the SHA-256 of a canonical JSON serialization of
// { schemaVersion, kind, units, points } after normalization. Name, source, notes, file name
// and import time are deliberately excluded, so renaming or re-importing the same data keeps
// the ID, and any change to a single point changes it. Numbers serialize through ECMAScript
// Number::toString (shortest round-trip form), which is specified, so the ID is stable across
// engines.
//
// Provenance (spec §21, §93): nothing is invented. `source` and `notes` are whatever the user
// supplied, else null; `importedAt` is the caller's timestamp, else null. An absent name becomes
// the neutral label UNNAMED_PROFILE, which claims nothing.
//
// Limits: pure; inputs are never mutated; throws CalibrationError (with `.errors`) on invalid
// input instead of repairing it.

import { sha256Hex } from './sha256.js';

export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_KIND = 'frequency';
export const PROFILE_FORMAT = 'oscilla.calibration';
export const PROFILE_UNITS = Object.freeze({ frequency: 'Hz', correction: 'dB' });
export const UNNAMED_PROFILE = 'Unnamed profile';

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

function canonicalString(points) {
  // Fixed key order; this string is the identity of the profile (spec §200).
  return JSON.stringify({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    kind: PROFILE_KIND,
    units: { frequency: PROFILE_UNITS.frequency, correction: PROFILE_UNITS.correction },
    points,
  });
}

function checkedPoints(points) {
  const r = normalizePoints(points);
  if (r.errors.length) {
    throw new CalibrationError(`invalid calibration points: ${r.errors[0].text}`
      + (r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ''), r.errors);
  }
  return r.points;
}

// Deterministic profile ID: 64 hex characters of SHA-256 over the canonical normalized points.
// Accepts a FrequencyProfile (or any object with `points`); name and metadata are ignored.
export function profileId(profile) {
  if (!profile || typeof profile !== 'object') throw new CalibrationError('profile required');
  if (profile.kind !== undefined && profile.kind !== PROFILE_KIND) {
    throw new CalibrationError(`not a frequency profile (kind ${fmt(profile.kind)})`);
  }
  return sha256Hex(canonicalString(checkedPoints(profile.points)));
}

// Build a normalized FrequencyProfile (docs/v3/architecture.md). Throws CalibrationError.
export function createFrequencyProfile({ name, source, notes, points, importedAt } = {}) {
  const normalized = checkedPoints(points);
  const label = optionalText(name, 'name', PROFILE_LIMITS.maxNameLength) ?? UNNAMED_PROFILE;
  if (importedAt !== undefined && importedAt !== null && typeof importedAt !== 'string') {
    throw new CalibrationError('importedAt must be a string timestamp or null');
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    kind: PROFILE_KIND,
    id: sha256Hex(canonicalString(normalized)),
    name: label,
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
  };
  if (p.source !== null) out.source = p.source;
  out.units = { ...p.units };
  out.points = p.points.map(([hz, db]) => [hz, db]);
  out.notes = p.notes;
  out.importedAt = p.importedAt;
  return out;
}
