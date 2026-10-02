// OSCILLA calibration — frequency-correction interpolation and application (spec §18-§19,
// §158, §222).
//
// Method: piecewise linear in dB over log10(frequency). Between points f0 < f < f1,
//   t = (log10 f - log10 f0) / (log10 f1 - log10 f0),  c(f) = c0 + t · (c1 - c0).
// At a profile point the stored value is returned exactly (no arithmetic). Log-frequency
// interpolation matches how calibration data is sampled (roughly uniform per octave), so a
// straight line between 1 kHz and 10 kHz does not spend nine tenths of its slope above 2 kHz
// as linear-Hz interpolation would (spec §19).
//
// Coverage (spec §158, §222): a profile covers [first point, last point] only. Outside it the
// default policy 'none' yields no correction and marks the frequency uncovered; 'hold' (explicit
// opt-in) repeats the edge value but still marks it uncovered (`held: true`), so a chart can
// say "calibrated to 15 kHz" and never present held values as calibrated. 0 Hz and negative
// frequencies are below every profile (minimum 1 Hz).
//
// Sign convention: a profile states the measuring chain's DEVIATION from flat — "+2.1 dB at
// 10 kHz" means the microphone reads 2.1 dB high there. This is the convention measurement-
// microphone calibration files are distributed in (they publish the microphone's response), so
//   corrected = observed + CORRECTION_SIGN · correction = observed − correction.
// A profile holding the inverse (an EQ curve) must be negated before import; it is never
// guessed.
//
// Limits: assumes a normalized FrequencyProfile from profile.js (sorted, unique, finite).
// Pure; inputs are never mutated. Magnitude only — phase calibration is out of scope.

import { ALGORITHMS } from '../measurement/algorithms.js';

export const CALIBRATION_ALGORITHM = ALGORITHMS.calibration;
export const CORRECTION_SIGN = -1;
export const CORRECTION_CONVENTION = 'profile-states-deviation:corrected=observed-correction';
export const EXTRAPOLATION_POLICIES = Object.freeze(['none', 'hold']);

function pointsOf(profile) {
  if (!profile || profile.kind !== 'frequency' || !Array.isArray(profile.points)
    || profile.points.length === 0) {
    throw new TypeError('a normalized frequency profile with at least one point is required');
  }
  return profile.points;
}

function policyOf(opts) {
  const policy = opts && opts.extrapolate !== undefined ? opts.extrapolate : 'none';
  if (!EXTRAPOLATION_POLICIES.includes(policy)) {
    throw new RangeError(`extrapolate must be 'none' or 'hold', got ${String(policy)}`);
  }
  return policy;
}

// Covered frequency range [fLo, fHi] in Hz.
export function coverage(profile) {
  const pts = pointsOf(profile);
  return [pts[0][0], pts[pts.length - 1][0]];
}

// Core evaluation shared by the scalar and vector forms. Returns { db, covered, held } or null.
function evaluate(pts, hz, policy) {
  if (typeof hz !== 'number' || Number.isNaN(hz)) {
    throw new TypeError(`frequency must be a number, got ${String(hz)}`);
  }
  const last = pts.length - 1;
  const fLo = pts[0][0];
  const fHi = pts[last][0];
  if (hz < fLo || hz > fHi) {
    if (policy === 'none') return null;
    return { db: hz < fLo ? pts[0][1] : pts[last][1], covered: false, held: true };
  }
  // Binary search for the last point with frequency <= hz.
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= hz) lo = mid;
    else hi = mid - 1;
  }
  const [f0, c0] = pts[lo];
  if (f0 === hz || lo === last) return { db: c0, covered: true, held: false };
  const [f1, c1] = pts[lo + 1];
  const t = (Math.log10(hz) - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0));
  return { db: c0 + t * (c1 - c0), covered: true, held: false };
}

// Correction at one frequency: null when uncovered under 'none' (the default), otherwise
// { correctionDb, covered, held }.
export function correctionAt(profile, hz, opts) {
  const r = evaluate(pointsOf(profile), hz, policyOf(opts));
  return r && { correctionDb: r.db, covered: r.covered, held: r.held };
}

// Correction sampled at many frequencies. correctionDb is NaN where no value applies
// ('none' outside coverage); covered[i] is 1 only inside the profile's range.
export function correctionCurve(profile, frequencies, opts) {
  const pts = pointsOf(profile);
  const policy = policyOf(opts);
  const n = frequencies.length;
  const correctionDb = new Float64Array(n);
  const covered = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = evaluate(pts, frequencies[i], policy);
    correctionDb[i] = r ? r.db : NaN;
    covered[i] = r && r.covered ? 1 : 0;
  }
  return { correctionDb, covered };
}

// Apply a frequency profile to a magnitude spectrum (dB, relative). Returns a new array;
// bins outside coverage are left uncorrected under 'none' and always flagged covered = 0.
// Under 'hold' they receive the edge correction but remain flagged uncovered.
export function applyFrequencyCorrection(magnitudeDb, frequencies, profile, opts) {
  if (!magnitudeDb || !frequencies || magnitudeDb.length !== frequencies.length) {
    throw new RangeError('magnitudeDb and frequencies must have the same length');
  }
  const policy = policyOf(opts);
  const { correctionDb, covered } = correctionCurve(profile, frequencies, { extrapolate: policy });
  const n = magnitudeDb.length;
  const correctedDb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = correctionDb[i];
    correctedDb[i] = Number.isNaN(c) ? magnitudeDb[i] : magnitudeDb[i] + CORRECTION_SIGN * c;
  }
  return {
    algorithm: CALIBRATION_ALGORITHM,
    profileId: profile.id ?? null,
    correctedDb,
    covered,
    coverage: coverage(profile),
    extrapolate: policy,
  };
}
