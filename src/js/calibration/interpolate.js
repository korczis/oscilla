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
// Sign convention (profile.js PROFILE_CONVENTIONS, stored in the profile, never guessed):
//   'deviation'  (default; schema 1 had no other) the profile states the measuring chain's
//                DEVIATION from flat — "+2.1 dB at 10 kHz" means the microphone reads 2.1 dB high
//                there, the way measurement-microphone calibration files are distributed:
//                corrected = observed + CORRECTION_SIGN · value = observed − value;
//   'correction' the profile states a CORRECTION TO ADD (an EQ curve):
//                corrected = observed + value.
// correctionAt / correctionCurve return the STATED value; the dB actually added is
// conventionSign(profile) · value (appliedCorrectionDb, previewConvention).
//
// Limits: assumes a normalized FrequencyProfile from profile.js (sorted, unique, finite).
// Pure; inputs are never mutated. Magnitude only — phase calibration is out of scope.
//
// RTA bands: applyFrequencyCorrectionToBands (end of file) applies a profile to band levels as a
// power-weighted correction across each band, flags uncovered bands and never extrapolates.

import { ALGORITHMS } from '../measurement/algorithms.js';
import { PROFILE_CONVENTIONS, conventionOf } from './profile.js';
import { meanSquarePower } from '../measurement/rta.js';
import { ZERO_POWER_DB } from '../measurement/transfer.js';

export const CALIBRATION_ALGORITHM = ALGORITHMS.calibration;
/** Sign of the 'deviation' convention (the default): corrected = observed − value. */
export const CORRECTION_SIGN = PROFILE_CONVENTIONS.deviation.sign;
export const CORRECTION_CONVENTION = 'profile-states-deviation:corrected=observed-correction';
/** Machine-readable text of each convention (corrected = observed ± value). */
export const CONVENTION_RULES = Object.freeze({
  deviation: CORRECTION_CONVENTION,
  correction: 'profile-states-correction:corrected=observed+correction',
});

/** +1 or −1: corrected = observed + conventionSign(profile) · stated value. */
export function conventionSign(profile) {
  return PROFILE_CONVENTIONS[conventionOf(profile)].sign;
}
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

// Correction in dB at hz inside the coverage [first, last point] (the caller checks coverage):
// the numeric core of evaluate(), allocation-free for the per-bin band loops below.
function interpolateDb(pts, hz) {
  const last = pts.length - 1;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= hz) lo = mid;
    else hi = mid - 1;
  }
  const p0 = pts[lo];
  const f0 = p0[0];
  if (f0 === hz || lo === last) return p0[1];
  const p1 = pts[lo + 1]; // index access, not destructuring: no iterator in the per-bin loop
  const t = (Math.log10(hz) - Math.log10(f0)) / (Math.log10(p1[0]) - Math.log10(f0));
  return p0[1] + t * (p1[1] - p0[1]);
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
  // Binary search for the last point with frequency <= hz, then log-frequency interpolation.
  return { db: interpolateDb(pts, hz), covered: true, held: false };
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
  const sign = conventionSign(profile);
  const n = magnitudeDb.length;
  const correctedDb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = correctionDb[i];
    correctedDb[i] = Number.isNaN(c) ? magnitudeDb[i] : magnitudeDb[i] + sign * c;
  }
  return {
    algorithm: CALIBRATION_ALGORITHM,
    profileId: profile.id ?? null,
    convention: conventionOf(profile),
    correctedDb,
    covered,
    coverage: coverage(profile),
    extrapolate: policy,
  };
}

/**
 * previewConvention(profile, { hz, observedDb = 0 }) → { hz, statedDb, addedDb, observedDb,
 *   correctedDb, convention, text } | null
 * The one-point preview shown at import (M4): what the profile does to a reading at hz under
 * its convention. hz defaults to the profile point with the largest |value| (the most telling
 * point; the first point when all are 0). null when hz is outside the profile's coverage.
 */
export function previewConvention(profile, { hz = null, observedDb = 0 } = {}) {
  const pts = pointsOf(profile);
  let f = hz;
  if (f === null) {
    let k = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][1]) > Math.abs(pts[k][1])) k = i;
    f = pts[k][0];
  }
  const r = evaluate(pts, f, 'none');
  if (!r) return null;
  const convention = conventionOf(profile);
  const addedDb = conventionSign(profile) * r.db;
  const correctedDb = observedDb + addedDb;
  const fmtDb = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} dB`;
  const fmtHz = (v) => (v >= 1000 ? `${+(v / 1000).toPrecision(4)} kHz` : `${+v.toPrecision(4)} Hz`);
  return {
    hz: f, statedDb: r.db, addedDb, observedDb, correctedDb, convention,
    text: `At ${fmtHz(f)} the file states ${fmtDb(r.db)}; a reading of ${fmtDb(observedDb)} `
      + `becomes ${fmtDb(correctedDb)}: ${PROFILE_CONVENTIONS[convention].label}.`,
  };
}

// ---------------------------------------------------------------- RTA bands (spec §45)
//
// A band level is a sum of power over the band, so a frequency correction that varies inside
// the band must be applied to the power before summing, never as one value at the centre:
//   corrected band power = Σ_k W_k · 10^(−c(f_k)/10),   gain = that / Σ_k W_k
//   correctedDb = levelDb + 10·log10(gain)          (deviation: observed − value; a
//   'correction' profile uses 10^(+c(f)/10), conventionSign)
// with c(f) the log-interpolated profile above. Weights W_k:
//   'spectrum'  given the per-bin power spectrum the band was integrated from (`power`, a
//               mean-square array or a spectrum.js welch() result, and `binHz`): W_k = P[k]·w[k],
//               w[k] the fraction of bin k inside the band (rta.js bin cells), f_k the bin centre
//               clamped into the band, so the correction is weighted by where the band's power
//               actually is. A band whose power is all zero falls back to 'flat'.
//   'flat'      without a spectrum: power assumed uniform in Hz across the band, the band split
//               into BAND_CORRECTION_STEPS equal sub-bands evaluated at their centres (midpoint
//               rule). For a correction linear in log-frequency the midpoint error (∝ 1/M²) over a
//               one-octave band at 12 dB/octave is 3.6e-5 dB with M = 256 (5.8e-4 dB at M = 64),
//               below the 1e-4 dB the tests require.
// A band is covered only when [lo, hi] lies inside the profile coverage; any other band is left
// uncorrected and flagged covered = 0 (never extrapolated, whatever the band overlap). Zero
// power (levels ≤ −300 dB, or −Infinity) stays as it is.

/** Sub-bands of the 'flat' weighting (see above). */
export const BAND_CORRECTION_STEPS = 256;

function bandGainFlat(pts, lo, hi, sign) {
  let s = 0;
  for (let j = 0; j < BAND_CORRECTION_STEPS; j++) {
    const f = lo + ((j + 0.5) * (hi - lo)) / BAND_CORRECTION_STEPS;
    s += 10 ** ((sign * interpolateDb(pts, f)) / 10);
  }
  return s / BAND_CORRECTION_STEPS;
}

function bandGainSpectrum(pts, power, binHz, lo, hi, sign) {
  const a = lo / binHz + 0.5; // band edges in bin-cell units, cell k = [k, k + 1) (rta.js)
  const b = hi / binHz + 0.5;
  const k0 = Math.max(0, Math.floor(a));
  const k1 = Math.min(power.length - 1, Math.ceil(b) - 1);
  let num = 0;
  let den = 0;
  for (let k = k0; k <= k1; k++) {
    const w = (Math.min(b, k + 1) - Math.max(a, k)) * power[k];
    if (!(w > 0)) continue;
    const f = Math.min(hi, Math.max(lo, k * binHz));
    num += w * 10 ** ((sign * interpolateDb(pts, f)) / 10);
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * applyFrequencyCorrectionToBands(rta, profile, { power, binHz, out }) → { algorithm, profileId,
 *   correctedDb: Float64Array, correctionDb: Float64Array, covered: Uint8Array, coverage,
 *   weighting: 'spectrum'|'flat' }
 * rta: { bands: [{ lo, hi, ... }], levelsDb } (an RtaResult or bandAnalysis() plus its bands).
 * correctionDb is the dB added to each covered band (NaN where uncovered). Inputs are not
 * modified; the raw levels stay available beside the corrected ones (§18 overlay).
 * out (optional, for per-frame use without allocation, measurement/live-rta.js): a previous
 * result of the same band count, written in place and returned (its arrays and coverage are
 * reused). Same values as without it.
 */
export function applyFrequencyCorrectionToBands(rta, profile, opts = {}) {
  const pts = pointsOf(profile);
  if (!rta || !Array.isArray(rta.bands) || !rta.levelsDb
    || rta.levelsDb.length !== rta.bands.length) {
    throw new RangeError('rta needs bands and one level per band');
  }
  const useSpectrum = opts.power !== undefined && opts.power !== null;
  let power = null;
  if (useSpectrum) {
    if (!(opts.binHz > 0) || !Number.isFinite(opts.binHz)) {
      throw new RangeError('binHz must be positive when power is given');
    }
    power = meanSquarePower(opts.power);
  }
  const fLo = pts[0][0];
  const fHi = pts[pts.length - 1][0];
  const sign = conventionSign(profile);
  const n = rta.bands.length;
  const out = opts.out && opts.out.correctedDb && opts.out.correctedDb.length === n
    && opts.out.correctionDb && opts.out.correctionDb.length === n
    && opts.out.covered && opts.out.covered.length === n ? opts.out : null;
  const correctedDb = out ? out.correctedDb : new Float64Array(n);
  const correctionDb = out ? out.correctionDb : new Float64Array(n);
  const covered = out ? out.covered : new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const { lo, hi } = rta.bands[i];
    const level = rta.levelsDb[i];
    correctedDb[i] = level;
    correctionDb[i] = NaN;
    covered[i] = 0;
    if (!(lo >= fLo && hi <= fHi && hi > lo)) continue;
    covered[i] = 1;
    let gain = useSpectrum ? bandGainSpectrum(pts, power, opts.binHz, lo, hi, sign) : null;
    if (gain === null) gain = bandGainFlat(pts, lo, hi, sign);
    correctionDb[i] = 10 * Math.log10(gain);
    if (level > ZERO_POWER_DB) correctedDb[i] = level + correctionDb[i];
  }
  if (out) {
    out.algorithm = CALIBRATION_ALGORITHM;
    out.profileId = profile.id ?? null;
    if (!Array.isArray(out.coverage) || out.coverage.length !== 2) out.coverage = [fLo, fHi];
    out.coverage[0] = fLo;
    out.coverage[1] = fHi;
    out.weighting = useSpectrum ? 'spectrum' : 'flat';
    return out;
  }
  return {
    algorithm: CALIBRATION_ALGORITHM,
    profileId: profile.id ?? null,
    correctedDb,
    correctionDb,
    covered,
    coverage: [fLo, fHi],
    weighting: useSpectrum ? 'spectrum' : 'flat',
  };
}
