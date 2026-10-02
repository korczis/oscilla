// Derived views of a magnitude response: fractional-octave smoothing (spec §35) and
// normalization (spec §34). Algorithm ID: 'oscilla.smoothing.fractional-octave.v1'.
//
// smoothFractionalOctave: for each point f_i the result is the POWER mean of the points whose
// frequency lies in the rectangular 1/N-octave window [f_i·2^(−1/2N), f_i·2^(1/2N)],
//   S_i = 10·log10( mean_j 10^(L_j/10) ),
// never a mean of dB values (Hatziantoniou & Mourjopoulos 2000, "Generalized fractional-
// octave smoothing of audio and acoustic responses", JAES 48(4), rectangular case). Every
// point in the window counts once, so on a log-spaced grid (transfer.js) the average is
// uniform in log-frequency. At the ends of the grid the window is truncated to the points
// that exist (no extrapolation). A flat response is a fixed point; fraction 0 returns a copy.
// The raw response is never modified: smoothing is a derived view (§35, §159).
//
// normalizeResponse: subtracts a reference level and labels the result (§34, never silent):
//   'at-frequency'  reference = the response at hz, linear interpolation in log-frequency
//                   between the two neighbouring points (an exact grid point reads itself)
//   'band-mean'     reference = 10·log10(power mean of the points in [lo, hi])

import { ALGORITHMS } from './algorithms.js';

export const SMOOTHING_ALGORITHM = ALGORITHMS.smoothing;
export const SMOOTHING_FRACTIONS = Object.freeze([0, 24, 12, 6, 3]);

function assertSeries(frequencies, magnitudeDb) {
  if (!frequencies || !magnitudeDb || frequencies.length !== magnitudeDb.length)
    throw new RangeError('frequencies and magnitudeDb must have the same length');
  for (let i = 1; i < frequencies.length; i++) {
    if (!(frequencies[i] > frequencies[i - 1]))
      throw new RangeError('frequencies must be strictly increasing');
  }
  if (frequencies.length && !(frequencies[0] > 0))
    throw new RangeError('frequencies must be positive');
}

/** Power-domain 1/fraction-octave smoothing; returns a new Float64Array. */
export function smoothFractionalOctave(frequencies, magnitudeDb, fraction) {
  assertSeries(frequencies, magnitudeDb);
  if (!(fraction === 0 || (Number.isFinite(fraction) && fraction > 0)))
    throw new RangeError(`fraction must be 0 (none) or N > 0 for 1/N octave, got ${fraction}`);
  const n = frequencies.length;
  const out = Float64Array.from(magnitudeDb);
  if (fraction === 0 || n === 0) return out;
  const power = new Float64Array(n);
  for (let i = 0; i < n; i++) power[i] = 10 ** (magnitudeDb[i] / 10);
  const edge = 2 ** (1 / (2 * fraction));
  let lo = 0;
  let hi = 0; // window is [lo, hi)
  for (let i = 0; i < n; i++) {
    while (hi < n && frequencies[hi] <= frequencies[i] * edge) hi++;
    while (frequencies[lo] < frequencies[i] / edge) lo++;
    // Direct sum per window (no running sum, so no drift); a window of equal values returns
    // that value exactly rather than a rounded round trip through the power domain.
    let flat = true;
    let s = 0;
    for (let j = lo; j < hi; j++) {
      s += power[j];
      if (magnitudeDb[j] !== magnitudeDb[lo]) flat = false;
    }
    out[i] = flat ? magnitudeDb[lo] : 10 * Math.log10(s / (hi - lo));
  }
  return out;
}

function interpolateAt(frequencies, magnitudeDb, hz) {
  const n = frequencies.length;
  if (!(hz >= frequencies[0] && hz <= frequencies[n - 1]))
    throw new RangeError(`${hz} Hz is outside the response range`);
  let j = 0;
  while (j < n - 1 && frequencies[j + 1] < hz) j++;
  if (frequencies[j] === hz || j === n - 1) return magnitudeDb[j];
  if (frequencies[j + 1] === hz) return magnitudeDb[j + 1];
  const t = Math.log(hz / frequencies[j]) / Math.log(frequencies[j + 1] / frequencies[j]);
  return magnitudeDb[j] + t * (magnitudeDb[j + 1] - magnitudeDb[j]);
}

function formatHz(hz) {
  return hz >= 1000 ? `${+(hz / 1000).toPrecision(4)} kHz` : `${+hz.toPrecision(4)} Hz`;
}

/**
 * normalizeResponse(frequencies, magnitudeDb, { mode: 'at-frequency', hz }
 *   | { mode: 'band-mean', lo, hi }) -> { normalizedDb, referenceDb, label, mode }
 */
export function normalizeResponse(frequencies, magnitudeDb, spec) {
  assertSeries(frequencies, magnitudeDb);
  if (frequencies.length === 0) throw new RangeError('empty response');
  let referenceDb;
  let label;
  if (spec && spec.mode === 'at-frequency') {
    referenceDb = interpolateAt(frequencies, magnitudeDb, spec.hz);
    label = `NORMALIZED: 0 dB at ${formatHz(spec.hz)}`;
  } else if (spec && spec.mode === 'band-mean') {
    const { lo, hi } = spec;
    if (!(lo > 0) || !(hi > lo)) throw new RangeError(`need 0 < lo < hi, got ${lo}, ${hi}`);
    let s = 0;
    let count = 0;
    for (let i = 0; i < frequencies.length; i++) {
      if (frequencies[i] >= lo && frequencies[i] <= hi) {
        s += 10 ** (magnitudeDb[i] / 10);
        count++;
      }
    }
    if (count === 0) throw new RangeError(`no response points in ${lo}-${hi} Hz`);
    referenceDb = 10 * Math.log10(s / count);
    label = `NORMALIZED: 0 dB = power mean ${formatHz(lo)}-${formatHz(hi)}`;
  } else {
    throw new RangeError("normalization mode must be 'at-frequency' or 'band-mean'");
  }
  const normalizedDb = new Float64Array(magnitudeDb.length);
  for (let i = 0; i < magnitudeDb.length; i++) normalizedDb[i] = magnitudeDb[i] - referenceDb;
  return { mode: spec.mode, normalizedDb, referenceDb, label };
}
