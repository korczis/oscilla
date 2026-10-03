// Derived views of a magnitude response: fractional-octave smoothing (spec §35) and
// normalization (spec §34). Algorithm IDs: 'oscilla.smoothing.fractional-octave.v2'
// (SMOOTHING_ALGORITHM, carried by smoothResponse() views; v1 retained, see below) and
// 'oscilla.normalization.v1'
// (NORMALIZATION_ALGORITHM, carried by normalizeResponse() results and impulse-response.js
// normalizeIr() views). smoothFractionalOctave() returns a bare array for internal use.
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
// Window edges (v2, V382): on a grid with M points per octave the window edges
// f_i·2^(±1/2N) fall exactly on grid points whenever M/N is even (the default 48 points per
// octave with 1/3 or 1/24 octave), and in floating point each edge point was in or out by
// rounding: 1/3-octave windows held 7 or 8 points on either side, 18 centres at 1/24 octave
// had no neighbour at all, and a 6 dB/octave ramp came back with an offset varying by 0.12 dB.
// v2 compares with a relative tolerance of SMOOTHING_EDGE_TOLERANCE, so an edge point is in on
// both sides. v1 (exact comparison) is retained: smoothResponse({ algorithm }), and
// smoothFractionalOctave's default, which transfer.js and quality.js use inside their own
// (separately versioned) methods.
// MASKED smoothing (options.mask; review m1): the same power mean over only the points of the
// window that the mask includes and that are finite; excluded points come out NaN. It is the
// same method on a subset of the points, so it keeps the smoothing ID; without a mask the
// output is unchanged bit for bit. Use it whenever a curve mixes points of different standing
// (calibration-corrected next to uncovered raw points, reliable next to unreliable ones):
// unmasked smoothing pulls each across the edge into the other.
//
// normalizeResponse: subtracts a reference level and labels the result (§34, never silent):
//   'at-frequency'  reference = the response at hz, linear interpolation in log-frequency
//                   between the two neighbouring points (an exact grid point reads itself)
//   'band-mean'     reference = 10·log10(power mean of the points in [lo, hi])

import { ALGORITHMS } from './algorithms.js';

export const SMOOTHING_ALGORITHM = ALGORITHMS.smoothing;
export const NORMALIZATION_ALGORITHM = ALGORITHMS.normalization;
export const SMOOTHING_FRACTIONS = Object.freeze([0, 24, 12, 6, 3]);
/** The retained first smoothing method (exact window edges; see the header). */
export const SMOOTHING_ALGORITHM_V1 = 'oscilla.smoothing.fractional-octave.v1';
/** Every smoothing method this build reproduces (smoothResponse options.algorithm). */
export const SMOOTHING_ALGORITHMS = Object.freeze([SMOOTHING_ALGORITHM_V1, SMOOTHING_ALGORITHM]);
/** v2: relative tolerance of the window edges (a point on an edge is inside). */
export const SMOOTHING_EDGE_TOLERANCE = 1e-9;

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

/**
 * Power-domain 1/fraction-octave smoothing; returns a new Float64Array.
 * options.mask (optional, array-like of the same length): MASKED smoothing. Only points with a
 * truthy mask entry AND a finite value enter any window; every other point is treated as
 * missing (never as 0 dB, never as its raw value). The result is NaN at excluded points and at
 * points whose window holds no included point, so a curve drawn from it has a gap there
 * instead of values leaking across a mask edge (e.g. corrected points next to uncovered raw
 * ones, or unreliable points next to reliable ones). fraction 0 with a mask returns the values
 * at included points and NaN elsewhere. Without `mask` the behaviour is exactly the unmasked
 * smoothing above (same doubles). options.edgeTolerance (default 0, v1): the relative
 * tolerance of the window edges, SMOOTHING_EDGE_TOLERANCE for v2.
 */
export function smoothFractionalOctave(frequencies, magnitudeDb, fraction, options = {}) {
  assertSeries(frequencies, magnitudeDb);
  if (!(fraction === 0 || (Number.isFinite(fraction) && fraction > 0)))
    throw new RangeError(`fraction must be 0 (none) or N > 0 for 1/N octave, got ${fraction}`);
  const mask = options && options.mask != null ? options.mask : null;
  const tol = (options && options.edgeTolerance) || 0;
  if (mask !== null) return smoothMasked(frequencies, magnitudeDb, fraction, mask, tol);
  const n = frequencies.length;
  const out = Float64Array.from(magnitudeDb);
  if (fraction === 0 || n === 0) return out;
  const power = new Float64Array(n);
  for (let i = 0; i < n; i++) power[i] = 10 ** (magnitudeDb[i] / 10);
  const edge = 2 ** (1 / (2 * fraction));
  const up = edge * (1 + tol); // a point on either edge is inside (v2)
  let lo = 0;
  let hi = 0; // window is [lo, hi)
  for (let i = 0; i < n; i++) {
    while (hi < n && frequencies[hi] <= frequencies[i] * up) hi++;
    while (frequencies[lo] < frequencies[i] / up) lo++;
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

/** The masked variant of smoothFractionalOctave (see its options.mask). */
function smoothMasked(frequencies, magnitudeDb, fraction, mask, tol = 0) {
  const n = frequencies.length;
  if (!mask || typeof mask.length !== 'number' || mask.length !== n)
    throw new RangeError('mask must have the length of frequencies');
  const use = new Uint8Array(n);
  const power = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    use[i] = mask[i] && Number.isFinite(magnitudeDb[i]) ? 1 : 0;
    if (use[i]) power[i] = 10 ** (magnitudeDb[i] / 10);
  }
  const out = new Float64Array(n).fill(NaN);
  if (fraction === 0) {
    for (let i = 0; i < n; i++) if (use[i]) out[i] = magnitudeDb[i];
    return out;
  }
  const edge = 2 ** (1 / (2 * fraction));
  const up = edge * (1 + tol);
  let lo = 0;
  let hi = 0; // window is [lo, hi)
  for (let i = 0; i < n; i++) {
    while (hi < n && frequencies[hi] <= frequencies[i] * up) hi++;
    while (frequencies[lo] < frequencies[i] / up) lo++;
    if (!use[i]) continue;
    let flat = true;
    let first = null;
    let s = 0;
    let count = 0;
    for (let j = lo; j < hi; j++) {
      if (!use[j]) continue;
      if (first === null) first = magnitudeDb[j];
      else if (magnitudeDb[j] !== first) flat = false;
      s += power[j];
      count++;
    }
    out[i] = flat ? first : 10 * Math.log10(s / count);
  }
  return out;
}

/**
 * smoothResponse(frequencies, magnitudeDb, fraction, { mask, algorithm }) → { kind: 'smoothed',
 *   algorithm, fraction, label, smoothedDb[, masked] }
 * The labelled derived view of smoothFractionalOctave (§35): the raw response is untouched and
 * the view says which smoothing produced it. fraction 0 is an unsmoothed copy. With `mask`
 * (see smoothFractionalOctave) the view is masked: NaN outside the mask, `masked: true`.
 */
export function smoothResponse(frequencies, magnitudeDb, fraction, options = {}) {
  const mask = options && options.mask != null ? options.mask : null;
  const algorithm = (options && options.algorithm) || SMOOTHING_ALGORITHM;
  if (!SMOOTHING_ALGORITHMS.includes(algorithm))
    throw new RangeError(`unknown smoothing method '${algorithm}'`);
  const edgeTolerance = algorithm === SMOOTHING_ALGORITHM_V1 ? 0 : SMOOTHING_EDGE_TOLERANCE;
  const smoothedDb = smoothFractionalOctave(frequencies, magnitudeDb, fraction,
    { mask, edgeTolerance });
  const view = {
    kind: 'smoothed',
    algorithm,
    fraction,
    label: fraction === 0 ? 'RAW: unsmoothed' : `SMOOTHED: 1/${fraction} octave (power mean)`,
    smoothedDb,
  };
  if (mask !== null) view.masked = true;
  return view;
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
 *   | { mode: 'band-mean', lo, hi }) -> { algorithm, mode, normalizedDb, referenceDb, label }
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
  return {
    algorithm: NORMALIZATION_ALGORITHM, mode: spec.mode, normalizedDb, referenceDb, label,
  };
}
