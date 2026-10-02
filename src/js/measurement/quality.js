// Data-driven measurement quality assessment (spec §64-§71, §143, §156-§158, §198-§199,
// §220-§222, §237, §249; ADR 0025). Algorithm ID: 'oscilla.confidence.v1'.
//
// Method. A pure rule table maps measured metrics to one of four statuses and ALWAYS returns
// the reasons, passing and failing alike, each backed by the number it was derived from. There
// is no score and no "confidence" percentage: a status means exactly the rules below. Inputs
// are the outputs of the modules that measured them — checkCapture() (capture-checks.js) per
// run, computeTransfer() (transfer.js), aggregateRuns() (aggregate.js) and the calibration
// state (calibration/interpolate.js coverage, calibration/level.js) — never raw guesses.
//
// Versioning (§199). Every threshold in QUALITY_THRESHOLDS and every rule in this header belong
// to ALGORITHMS.quality = 'oscilla.confidence.v1'. Changing any threshold, a rule, or which
// codes invalidate mints a new ID (oscilla.confidence.v2); a stored status stays as assessed.
//
// Reasons: { code, scope, severity: 'ok'|'warn'|'fail', text, value, unit, range? }.
//   scope 'quality'      integrity and precision of the measurement; decides the status.
//   scope 'calibration'  what the numbers may be labelled as (frequency profile coverage,
//                        absolute level). Never changes the status: an uncalibrated response is
//                        a valid RELATIVE measurement of the whole chain, and its unit says so
//                        (RELATIVE_UNIT "dB relative (dBFS-like)"); the calibration state is
//                        reported beside the status (metrics.frequencyCalibrated /
//                        levelCalibrated, the calibrated mask and the summary), not folded into
//                        it.
//   value is a finite number for every 'ok' reason (positive evidence is always numeric); it is
//   null only for a quantity that was NOT MEASURED or is absent (SNR without a noise capture,
//   no level calibration, digital silence), and the text says so (§249).
//
// Status rules. Only scope 'quality' reasons count. Each code belongs to one dimension
// (REASON_CODES): capture (clipping, dropouts, integrity), snr (median SNR), range (coverage
// and the low-SNR bands that explain it — one symptom, counted once), repeatability,
// resolution, analysis. "Measured warns" are warns of codes that report a measured problem,
// i.e. not the NOT_MEASURED codes, counted per distinct dimension:
//
//   | status  | rule                                                                          |
//   |---------|-------------------------------------------------------------------------------|
//   | INVALID | any invalidating code (INVALIDATING_CODES, always severity 'fail')            |
//   | POOR    | not INVALID, and any other 'fail', or measured warns in ≥ poorWarnCount       |
//   |         | distinct dimensions                                                           |
//   | USABLE  | not POOR, and at least one 'warn' (NOT_MEASURED included)                     |
//   | GOOD    | every quality reason is 'ok'                                                  |
//
// GOOD therefore requires positive evidence on every dimension: a measured SNR (a noise-floor
// capture), at least minRunsForRepeatability runs, coverage of the requested range, no clipping
// and no dropout. A missing measurement is a warn — never silently "fine" — but it is absence
// of evidence, not evidence of a problem, so it caps the status at USABLE without pushing it
// towards POOR. Measured problems in independent dimensions compound (each widens the error
// bound), hence POOR from poorWarnCount of them.
//
// Invalidating conditions (§220): no capture checks, no samples, invalid sample rate, NaN or
// infinite samples, no captured signal (RMS below capture-checks EMPTY_RMS_DBFS), severe
// clipping (ratio ≥ clipInvalidRatio), a dropout inside the sweep window (capture underrun;
// without a sweepWindow every interior dropout is treated as inside), non-finite analysis
// output (transfer grid, magnitude, SNR, phase or the aggregate centre), and an empty validRange.
// An INVALID assessment keeps only its 'fail' reasons (no passing reason is offered as evidence
// for a meaningless result), and its reliable mask is all zero: it must not be drawn as
// authoritative.
//
// Per-frequency masks (§156-§158, §221-§222), on the transfer grid:
//   reliable[i]    with an SNR estimate: the 1/6-octave pooled SNR ≥ reliableMinSnrDb AND
//                  f ≤ SAFE_NYQUIST_FRACTION·Nyquist. The pool is the power mean of the linear
//                  per-point SNR (smoothFractionalOctave on snrDb), equal to transfer.js's
//                  pooled (Py − Pn)/Pn when the noise floor is locally flat across the 1/6
//                  octave. Bands the stimulus did not excite hold only noise and fail the SNR
//                  test by themselves; above the stimulus clamp (stimulus.js never generates
//                  there) a clean digital loopback could still show sweep leakage above the
//                  noise while |X|² sits below the regularization ε, hence the explicit limit.
//                  With good SNR the regularized estimate is unbiased (ε is −60 dB re max|X|²
//                  in band), so a point need not lie in transfer.validRange — the longest run
//                  only — to be reliable: a notch does not condemn the response beyond it.
//                  Without an SNR estimate: inside transfer.validRange (stimulus coverage only).
//   calibrated[i]  the frequency profile's `covered` flag when it is on the same grid, else
//                  fLo ≤ f ≤ fHi of the profile coverage; no extrapolation (interpolate.js).
//   Ranges are the contiguous runs of a mask, as [fLo, fHi] grid frequencies.
//
// SNR metrics: snrMedianDb is the median per-point SNR over the whole requested grid (bands the
// stimulus missed pull it down, as they should); snrMinDb is the minimum pooled SNR inside
// validRange, the worst point of the range offered as valid. coverageFraction is validRange's
// width in octaves over the requested range's width in octaves (log-frequency, like the grid).
//
// Text: frequencies through format.js formatFrequencyWithResolution at the coarser of the bin
// resolution and the local grid spacing (a range edge is a grid point; no digit finer than
// that); levels through formatDb as calibration/level.js RELATIVE_UNIT ("dB relative
// (dBFS-like)", the one uncalibrated label) unless a valid LevelCalibration applies;
// SNR and spreads are ratios, printed as plain dB: whole dB in passing reasons, one decimal in
// warn/fail reasons (so 19.6 dB never reads as "20 dB" next to a 20 dB limit), and a passing
// "agree within ±x dB" rounds x UP to 0.1 dB (an upper bound stays an upper bound). Never
// "high confidence" (§65).
//
// Pure: no DOM, no Web Audio, no globals, no clock; inputs are never mutated.

import { ALGORITHMS } from './algorithms.js';
import { EMPTY_RMS_DBFS } from './capture-checks.js';
import { formatDb, formatFrequencyWithResolution } from './format.js';
import { smoothFractionalOctave } from './smoothing.js';
import { SAFE_NYQUIST_FRACTION } from './stimulus.js';
import { RELATIVE_UNIT, isValidLevelCalibration } from '../calibration/level.js';

export const QUALITY_ALGORITHM = ALGORITHMS.quality;

export const QUALITY_THRESHOLDS = Object.freeze({
  /** Rail-sample ratio at or above which the run is INVALID: with mild overdrive only ~20-25 %
   *  of each cycle reaches the rail, so 1 % means several % of the capture was overdriven — a
   *  sustained overload whose response is the clipper's, not the system's. */
  clipInvalidRatio: 0.01,
  /** Rail-sample ratio at or above which clipping is a POOR-class fail: a tenth of the invalid
   *  limit is still a sustained overload event rather than an isolated flat top. */
  clipPoorRatio: 0.001,
  /** Median SNR for an 'ok' SNR reason: noise amplitude ≤ 0.1 × signal bounds the magnitude
   *  error to +0.83 / −0.92 dB (20·log10(1 ± 0.1)). */
  snrGoodDb: 20,
  /** Median SNR below which the SNR reason fails (POOR): 10 dB bounds the error to
   *  +2.4 / −3.3 dB; equals transfer.js VALID_MIN_SNR_DB. */
  snrUsableDb: 10,
  /** Pooled SNR for a grid point to be "reliable" (noise-floor margin per band): equals
   *  transfer.js VALID_MIN_SNR_DB so the reliable mask and validRange use one criterion. */
  reliableMinSnrDb: 10,
  /** Pooling bandwidth 1/N octave for the reliable mask: transfer.js
   *  VALIDITY_SMOOTHING_FRACTION, so a single-point dip does not fragment the mask. */
  reliablePoolingFraction: 6,
  /** Repeatability (median per-point spread across runs) for an 'ok' reason: the same ~1 dB
   *  bound that snrGoodDb gives, so SNR and run-to-run scatter limit the error alike. */
  repeatabilityGoodDb: 1,
  /** Repeatability above which it fails (POOR): beyond ±3 dB (a factor of two in power) a
   *  3 dB response feature cannot be told from run-to-run scatter. */
  repeatabilityUsableDb: 3,
  /** Runs needed to measure repeatability at all; with fewer it is NOT MEASURED (warn). */
  minRunsForRepeatability: 2,
  /** Coverage fraction (octaves of validRange / octaves requested) for an 'ok' reason: on a
   *  10-octave 20 Hz-20 kHz request this tolerates losing one octave (e.g. room noise below
   *  40 Hz). */
  coverageGoodFraction: 0.9,
  /** Coverage fraction below which coverage fails (POOR): less than half of the requested
   *  octaves were measured, so most of the question asked is unanswered. */
  coverageUsableFraction: 0.5,
  /** Fraction of the reliable range a frequency profile must cover for "calibrated": all of
   *  it; anything less is "partly calibrated" and the mask says where. */
  frequencyCalibratedFraction: 1,
  /** Bin resolution must be finer than this 1/N-octave bandwidth at the lowest reliable
   *  frequency (the pooling bandwidth); coarser means the low end is under-resolved. */
  resolutionBandFraction: 6,
  /** Distinct dimensions with measured warns that together make a result POOR: three
   *  independent marginal problems compound beyond what "usable" promises. */
  poorWarnCount: 3,
  /** Narrowest low-SNR band (octaves) that gets its own LOW_SNR_BAND reason: the pooling
   *  bandwidth, since a narrower dip is less than one independent pooled observation. Every
   *  band, however narrow, stays in metrics.unreliableRanges and the mask. */
  lowSnrBandMinOctaves: 1 / 6,
  /** Low-SNR bands named as separate reasons (the widest ones); every band stays in
   *  metrics.unreliableRanges and the mask. A display limit, not a rule. */
  maxBandReasons: 3,
});

const Q = 'quality';
const C = 'calibration';

/** Every reason code, its scope and whether it invalidates (part of the v1 rule set). */
const code = (scope, dimension, invalidating = false, notMeasured = false) =>
  Object.freeze({ scope, dimension, invalidating, notMeasured });

/** Every reason code: scope, status dimension, whether it invalidates, whether it reports a
 *  quantity that was not measured (part of the v1 rule set). */
export const REASON_CODES = Object.freeze({
  CAPTURE_MISSING: code(Q, 'capture', true),
  NO_SAMPLES: code(Q, 'capture', true),
  BAD_SAMPLE_RATE: code(Q, 'capture', true),
  NON_FINITE_CAPTURE: code(Q, 'capture', true),
  NO_SIGNAL: code(Q, 'capture', true),
  CLIPPING_SEVERE: code(Q, 'capture', true),
  CLIPPING: code(Q, 'capture'),
  DROPOUT_IN_SWEEP: code(Q, 'capture', true),
  DROPOUT: code(Q, 'capture'),
  NON_FINITE_ANALYSIS: code(Q, 'analysis', true),
  NO_VALID_RANGE: code(Q, 'range', true),
  SNR_MEDIAN: code(Q, 'snr'),
  SNR_NOT_MEASURED: code(Q, 'snr', false, true),
  LOW_SNR_BAND: code(Q, 'range'),
  COVERAGE: code(Q, 'range'),
  REPEATABILITY: code(Q, 'repeatability'),
  REPEATABILITY_NOT_MEASURED: code(Q, 'repeatability', false, true),
  RESOLUTION: code(Q, 'resolution'),
  FREQUENCY_CALIBRATION: code(C, 'calibration'),
  LEVEL_CALIBRATION: code(C, 'calibration'),
});

export const INVALIDATING_CODES = Object.freeze(
  Object.keys(REASON_CODES).filter((code) => REASON_CODES[code].invalidating),
);

export const QUALITY_STATUSES = Object.freeze(['GOOD', 'USABLE', 'POOR', 'INVALID']);

const MINUS = '−';
const SEVERITY_ORDER = { fail: 0, warn: 1, ok: 2 };
const DEFAULT_GRID_RATIO = 2 ** (1 / 48);

// ----------------------------------------------------------------------------- helpers

/** Plain dB (a ratio, not a level) with U+2212 for negatives and no "−0". */
function ratioDb(value, decimals = 0) {
  const text = value.toFixed(decimals);
  if (Number(text) === 0) return text.replace('-', '');
  return text.replace('-', MINUS);
}

/** Percentage to two significant digits ("0.079", "4.1", "33"). */
function pct(percent) {
  if (percent === 0) return '0';
  return String(Number(percent.toPrecision(2)));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function median(values) {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Contiguous runs of truthy mask entries as [startIndex, endIndex] (inclusive). */
export function maskRuns(mask) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    if (i < mask.length && mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/** Contiguous runs of a mask as frequency ranges [fLo, fHi]. */
export function maskRanges(frequencies, mask) {
  return maskRuns(mask).map(([a, b]) => [frequencies[a], frequencies[b]]);
}

function invertMask(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

function octaves(lo, hi) {
  return hi > lo && lo > 0 ? Math.log2(hi / lo) : 0;
}

/**
 * Frequency text at the coarser of the bin resolution and the local grid spacing: a range edge
 * is a grid point, known to the grid step, never to more digits (format.js rule).
 */
function frequencyFormatter(frequencies, resolutionHz) {
  let ratio = DEFAULT_GRID_RATIO;
  if (frequencies && frequencies.length > 1) {
    const r = frequencies[1] / frequencies[0];
    if (Number.isFinite(r) && r > 1) ratio = r;
  }
  const res = resolutionHz > 0 && Number.isFinite(resolutionHz) ? resolutionHz : 0;
  return (hz) => {
    const step = Math.max(res, hz * (ratio - 1));
    return formatFrequencyWithResolution(hz, step > 0 && Number.isFinite(step) ? step : 1);
  };
}

function rangeText(fmt, lo, hi) {
  return lo === hi ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`;
}

/** Δf to two significant digits through format.js. */
function resolutionText(hz) {
  return formatFrequencyWithResolution(hz, hz / 10);
}

// ----------------------------------------------------------------------------- validation

function isCheckResult(c) {
  return Boolean(c) && typeof c === 'object' && c.clipping && typeof c.clipping === 'object'
    && typeof c.clipping.ratio === 'number' && Array.isArray(c.clipping.regions)
    && Array.isArray(c.dropouts) && Array.isArray(c.reasons);
}

function normalizeCaptures(capture) {
  if (capture === null || capture === undefined) return [];
  const list = Array.isArray(capture) ? capture : [capture];
  list.forEach((c, i) => {
    if (!isCheckResult(c))
      throw new TypeError(`capture ${i} is not a checkCapture() result`);
  });
  return list;
}

function windowFor(sweepWindow, i) {
  if (!sweepWindow) return null;
  if (typeof sweepWindow[0] === 'number') return sweepWindow;
  return sweepWindow[i] || null;
}

function isArrayLike(x) {
  return Boolean(x) && typeof x.length === 'number';
}

function validateTransfer(t) {
  if (!t || typeof t !== 'object' || !isArrayLike(t.frequencies) || !isArrayLike(t.magnitudeDb))
    throw new TypeError('transfer must be a computeTransfer() result or null');
  const n = t.frequencies.length;
  if (t.magnitudeDb.length !== n)
    throw new RangeError('transfer.magnitudeDb and transfer.frequencies differ in length');
  for (const key of ['snrDb', 'phaseDeg']) {
    if (t[key] !== null && t[key] !== undefined && t[key].length !== n)
      throw new RangeError(`transfer.${key} and transfer.frequencies differ in length`);
  }
}

/** Non-finite points of a transfer result: grid, magnitude, SNR and phase. */
function countNonFiniteTransfer(t) {
  let bad = 0;
  const f = t.frequencies;
  for (let i = 0; i < f.length; i++) {
    if (!Number.isFinite(f[i]) || !(f[i] > 0) || (i > 0 && !(f[i] > f[i - 1]))) bad++;
  }
  for (const arr of [t.magnitudeDb, t.snrDb, t.phaseDeg]) {
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
  }
  if (t.validRange && !(Number.isFinite(t.validRange[0]) && Number.isFinite(t.validRange[1])))
    bad++;
  return bad;
}

/** NaN / +Infinity in the aggregate centre (−Infinity is zero power, a legal level). */
function countNonFiniteAggregate(a) {
  if (!a || !isArrayLike(a.centreDb)) return 0;
  let bad = 0;
  for (let i = 0; i < a.centreDb.length; i++) {
    const v = a.centreDb[i];
    if (Number.isNaN(v) || v === Infinity) bad++;
  }
  return bad;
}

// ----------------------------------------------------------------------------- assessment

function assessCaptures(captures, sweepWindow, add) {
  const T = QUALITY_THRESHOLDS;
  const n = captures.length;
  const metrics = { clippingRatio: null, clippingRegions: null, dropouts: null };
  if (!n) {
    add('CAPTURE_MISSING', 'fail', 'no capture checks: capture integrity not measured', 0,
      'runs');
    return metrics;
  }
  const who = (idxs) => {
    if (n === 1) return 'the capture';
    if (idxs.length === n) return `all ${n} runs`;
    return `run${idxs.length > 1 ? 's' : ''} ${idxs.map((i) => i + 1).join(', ')} of ${n}`;
  };
  const withCode = (code) =>
    captures.map((c, i) => (c.reasons.some((r) => r.code === code) ? i : -1)).filter((i) => i >= 0);

  const noSamples = withCode('NO_SAMPLES');
  if (noSamples.length)
    add('NO_SAMPLES', 'fail', `no samples in ${who(noSamples)}`, noSamples.length, 'runs');
  const badRate = withCode('BAD_SAMPLE_RATE');
  if (badRate.length)
    add('BAD_SAMPLE_RATE', 'fail', `no valid sample rate in ${who(badRate)}`, badRate.length,
      'runs');
  const nonFinite = withCode('NON_FINITE');
  if (nonFinite.length)
    add('NON_FINITE_CAPTURE', 'fail', `NaN or infinite samples in ${who(nonFinite)}`,
      nonFinite.length, 'runs');
  const empty = captures
    .map((c, i) => (c.empty && !noSamples.includes(i) ? i : -1))
    .filter((i) => i >= 0);
  if (empty.length) {
    const rms = Math.min(...empty.map((i) => captures[i].rms));
    if (rms > 0) {
      const db = 20 * Math.log10(rms);
      add('NO_SIGNAL', 'fail',
        `no captured signal in ${who(empty)}: RMS ${formatDb(db)}, below ` +
          `${formatDb(EMPTY_RMS_DBFS)}`, db, RELATIVE_UNIT);
    } else {
      add('NO_SIGNAL', 'fail', `no captured signal in ${who(empty)}: digital silence`, null,
        RELATIVE_UNIT);
    }
  }

  let worst = 0;
  let regions = 0;
  captures.forEach((c, i) => {
    regions += c.clipping.regions.length;
    if (c.clipping.ratio > captures[worst].clipping.ratio) worst = i;
  });
  const ratio = captures[worst].clipping.ratio;
  metrics.clippingRatio = ratio;
  metrics.clippingRegions = regions;
  const where = n > 1 ? ` (worst: run ${worst + 1} of ${n})` : '';
  const clipText = `clipping at ${pct(ratio * 100)} % of samples ` +
    `(${plural(regions, 'region')})${where}`;
  if (ratio >= T.clipInvalidRatio) {
    add('CLIPPING_SEVERE', 'fail',
      `severe ${clipText}: at or above ${pct(T.clipInvalidRatio * 100)} % the response is ` +
        'the overload, not the system', ratio * 100, '%');
  } else if (ratio >= T.clipPoorRatio) {
    add('CLIPPING', 'fail', `${clipText}: at or above ${pct(T.clipPoorRatio * 100)} %`,
      ratio * 100, '%');
  } else if (regions > 0) {
    add('CLIPPING', 'warn', clipText, ratio * 100, '%');
  } else {
    add('CLIPPING', 'ok', 'no clipping', 0, '%');
  }

  let inside = 0;
  let outside = 0;
  const insideRuns = [];
  captures.forEach((c, i) => {
    const w = windowFor(sweepWindow, i);
    let runInside = 0;
    for (const d of c.dropouts) {
      if (!w || (d.start < w[1] && d.end > w[0])) runInside++;
      else outside++;
    }
    if (runInside) insideRuns.push(i);
    inside += runInside;
  });
  metrics.dropouts = inside + outside;
  if (inside) {
    const scope = sweepWindow ? 'inside the sweep window' : 'inside the capture (no sweep window ' +
      'given, so treated as inside the sweep)';
    add('DROPOUT_IN_SWEEP', 'fail',
      `capture underrun: ${plural(inside, 'dropout')} ${scope} in ${who(insideRuns)}`, inside,
      'dropouts');
  }
  if (outside)
    add('DROPOUT', 'warn', `${plural(outside, 'dropout')} outside the sweep window`, outside,
      'dropouts');
  if (!inside && !outside) add('DROPOUT', 'ok', 'no dropouts', 0, 'dropouts');
  return metrics;
}

function assessSnr(transfer, fmt, add) {
  const T = QUALITY_THRESHOLDS;
  const f = transfer.frequencies;
  const snr = transfer.snrDb;
  const out = { snrMedianDb: null, snrMinDb: null, pooled: null };
  if (!snr) {
    add('SNR_NOT_MEASURED', 'warn', 'SNR not measured: no noise-floor capture', null, 'dB');
    return out;
  }
  out.pooled = smoothFractionalOctave(f, snr, T.reliablePoolingFraction);
  const med = median(snr);
  out.snrMedianDb = med;
  const r = ratioDb(med, 1);
  if (med >= T.snrGoodDb) add('SNR_MEDIAN', 'ok', `${ratioDb(med)} dB median SNR`, med, 'dB');
  else if (med >= T.snrUsableDb)
    add('SNR_MEDIAN', 'warn', `${r} dB median SNR (GOOD needs ≥ ${T.snrGoodDb} dB)`, med, 'dB');
  else
    add('SNR_MEDIAN', 'fail',
      `${r} dB median SNR, below the ${T.snrUsableDb} dB minimum for USABLE`, med, 'dB');

  const vr = transfer.validRange;
  if (vr) {
    let min = Infinity;
    for (let i = 0; i < f.length; i++)
      if (f[i] >= vr[0] && f[i] <= vr[1] && out.pooled[i] < min) min = out.pooled[i];
    out.snrMinDb = Number.isFinite(min) ? min : null;
  }

  const low = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) low[i] = out.pooled[i] < T.reliableMinSnrDb ? 1 : 0;
  const bands = maskRuns(low)
    .map(([a, b]) => ({ a, b, width: octaves(f[a], f[b]) }))
    .filter((band) => band.width >= T.lowSnrBandMinOctaves - 1e-9)
    .sort((x, y) => y.width - x.width || x.a - y.a)
    .slice(0, T.maxBandReasons)
    .sort((x, y) => x.a - y.a);
  for (const { a, b } of bands) {
    const m = median(out.pooled.subarray(a, b + 1));
    const range = rangeText(fmt, f[a], f[b]);
    const text = m > 0
      ? `${range} only ${ratioDb(m, 1)} dB above the noise floor`
      : `${range} not above the noise floor (${ratioDb(m, 1)} dB SNR)`;
    add('LOW_SNR_BAND', 'warn', `${text} (reliable needs ≥ ${T.reliableMinSnrDb} dB)`, m, 'dB',
      [f[a], f[b]]);
  }
  return out;
}

function assessCoverage(transfer, requested, fmt, add) {
  const T = QUALITY_THRESHOLDS;
  const vr = transfer.validRange;
  const req = rangeText(fmt, requested[0], requested[1]);
  const nyquist = transfer.sampleRate / 2;
  const past = requested[1] > nyquist && Number.isFinite(nyquist)
    ? `; above ${fmt(nyquist)} (Nyquist) nothing can be measured`
    : '';
  if (!vr) {
    add('NO_VALID_RANGE', 'fail',
      `no valid frequency range: no point of the requested ${req} has stimulus coverage and ` +
        `≥ ${T.reliableMinSnrDb} dB SNR`, 0, '%');
    return { coverage: null, coverageFraction: 0 };
  }
  const fraction = octaves(vr[0], vr[1]) / octaves(requested[0], requested[1]);
  const text = `valid range ${rangeText(fmt, vr[0], vr[1])} covers ` +
    `${Math.floor(fraction * 100)} % of the octaves requested (${req})`;
  let severity = 'ok';
  let tail = '';
  if (fraction < T.coverageUsableFraction) {
    severity = 'fail';
    tail = `, below the ${Math.round(T.coverageUsableFraction * 100)} % minimum for USABLE`;
  } else if (fraction < T.coverageGoodFraction) {
    severity = 'warn';
    tail = ` (GOOD needs ≥ ${Math.round(T.coverageGoodFraction * 100)} %)`;
  }
  add('COVERAGE', severity, `${text}${tail}${past}`, fraction * 100, '%', [vr[0], vr[1]]);
  return { coverage: [vr[0], vr[1]], coverageFraction: fraction };
}

function assessRepeatability(aggregate, runs, add) {
  const T = QUALITY_THRESHOLDS;
  const n = aggregate && Number.isInteger(aggregate.runs) ? aggregate.runs : runs;
  if (!aggregate || !(n >= T.minRunsForRepeatability)) {
    const text = n >= T.minRunsForRepeatability
      ? `${n} runs not aggregated: repeatability not measured`
      : `${plural(n, 'run')}: repeatability not measured (GOOD needs ≥ ` +
        `${T.minRunsForRepeatability} runs)`;
    add('REPEATABILITY_NOT_MEASURED', 'warn', text, n, 'runs');
    return null;
  }
  const rep = aggregate.repeatabilityDb;
  if (!Number.isFinite(rep)) {
    add('REPEATABILITY_NOT_MEASURED', 'warn',
      `${n} runs: repeatability undefined (no frequency point has a finite spread)`, n, 'runs');
    return null;
  }
  const kind = aggregate.dispersion === 'std' ? 'standard deviation' : 'absolute deviation';
  const x = ratioDb(rep, 1);
  const basis = `median ${kind} across frequency`;
  if (rep <= T.repeatabilityGoodDb)
    add('REPEATABILITY', 'ok',
      `${n} runs agree within ±${ratioDb(Math.max(0.1, Math.ceil(rep * 10) / 10), 1)} dB ` +
        `(${basis})`, rep, 'dB');
  else if (rep <= T.repeatabilityUsableDb)
    add('REPEATABILITY', 'warn',
      `${n} runs differ by ±${x} dB (${basis}; GOOD needs ≤ ±${T.repeatabilityGoodDb} dB)`, rep,
      'dB');
  else
    add('REPEATABILITY', 'fail',
      `${n} runs differ by ±${x} dB (${basis}), above the ±${T.repeatabilityUsableDb} dB ` +
        'limit for USABLE', rep, 'dB');
  return rep;
}

function assessResolution(resolutionHz, fLow, fmt, add) {
  const T = QUALITY_THRESHOLDS;
  const N = T.resolutionBandFraction;
  const factor = 2 ** (1 / (2 * N)) - 2 ** (-1 / (2 * N));
  const res = resolutionText(resolutionHz);
  if (resolutionHz <= fLow * factor) {
    add('RESOLUTION', 'ok', `frequency resolution ${res} (finer than 1/${N} octave from ` +
      `${fmt(fLow)})`, resolutionHz, 'Hz');
  } else {
    add('RESOLUTION', 'warn', `frequency resolution ${res} is coarser than 1/${N} octave below ` +
      `${fmt(resolutionHz / factor)}`, resolutionHz, 'Hz');
  }
}

function calibratedMask(frequencies, freqCal) {
  const n = frequencies.length;
  const mask = new Uint8Array(n);
  if (!freqCal) return mask;
  if (isArrayLike(freqCal.covered) && freqCal.covered.length === n) {
    for (let i = 0; i < n; i++) mask[i] = freqCal.covered[i] ? 1 : 0;
    return mask;
  }
  const cov = freqCal.coverage;
  if (!Array.isArray(cov) || cov.length !== 2)
    throw new TypeError('calibration.frequency needs `covered` on the transfer grid or ' +
      '`coverage` [fLo, fHi]');
  for (let i = 0; i < n; i++) mask[i] = frequencies[i] >= cov[0] && frequencies[i] <= cov[1];
  return mask;
}

function assessFrequencyCalibration(freqCal, frequencies, calMask, reliable, requested, fmt,
  add) {
  const T = QUALITY_THRESHOLDS;
  if (!freqCal) {
    add('FREQUENCY_CALIBRATION', 'warn',
      'no microphone frequency calibration: uncalibrated, the response includes the ' +
        "microphone's own response", 0, '%');
    return { calibratedRange: null, frequencyCalibrated: false };
  }
  const n = frequencies.length;
  if (!n) {
    // No grid (no transfer): judge the profile coverage against the requested range.
    const cov = freqCal.coverage;
    if (!Array.isArray(cov) || !requested) {
      add('FREQUENCY_CALIBRATION', 'warn',
        'microphone calibration loaded; coverage against the measurement not assessed', null,
        '%');
      return { calibratedRange: cov ? [cov[0], cov[1]] : null, frequencyCalibrated: false };
    }
    const lo = Math.max(cov[0], requested[0]);
    const hi = Math.min(cov[1], requested[1]);
    const fraction = octaves(lo, hi) / octaves(requested[0], requested[1]);
    const ok = fraction >= T.frequencyCalibratedFraction;
    add('FREQUENCY_CALIBRATION', ok ? 'ok' : 'warn',
      `microphone calibration covers ${rangeText(fmt, cov[0], cov[1])}` +
        (ok ? ', the whole requested range' : '; uncalibrated outside it'),
      fraction * 100, '%', [cov[0], cov[1]]);
    return { calibratedRange: [cov[0], cov[1]], frequencyCalibrated: ok };
  }
  const runs = maskRuns(calMask);
  if (!runs.length) {
    add('FREQUENCY_CALIBRATION', 'warn',
      'microphone calibration does not overlap the measured range: uncalibrated', 0, '%');
    return { calibratedRange: null, frequencyCalibrated: false };
  }
  const longest = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  const calibratedRange = [frequencies[longest[0]], frequencies[longest[1]]];
  const base = reliable.some((v) => v) ? reliable : new Uint8Array(n).fill(1);
  let total = 0;
  let covered = 0;
  let below = false;
  let above = false;
  for (let i = 0; i < n; i++) {
    if (!base[i]) continue;
    total++;
    if (calMask[i]) covered++;
    else if (i < longest[0]) below = true;
    else above = true;
  }
  const fraction = total ? covered / total : 0;
  const ok = fraction >= T.frequencyCalibratedFraction;
  const covText = `microphone calibration covers ${rangeText(fmt, ...calibratedRange)}`;
  let text;
  if (ok) text = `${covText}, the whole ${base === reliable ? 'reliable' : 'measured'} range`;
  else if (below && above) text = `${covText}; uncalibrated below and above`;
  else if (below) text = `${covText}; uncalibrated below`;
  else text = `${covText}; uncalibrated above`;
  add('FREQUENCY_CALIBRATION', ok ? 'ok' : 'warn', text, fraction * 100, '%', calibratedRange);
  return { calibratedRange, frequencyCalibrated: ok };
}

function assessLevelCalibration(level, add) {
  if (isValidLevelCalibration(level)) {
    const offset = level.offsetDb;
    const sign = offset > 0 ? '+' : '';
    add('LEVEL_CALIBRATION', 'ok',
      `absolute level calibration: offset ${sign}${ratioDb(offset, 1)} dB from a ` +
        `${formatDb(level.referenceDbSpl, { kind: 'spl' })} reference at ` +
        `${formatFrequencyWithResolution(level.referenceHz, 1)}`, offset, 'dB');
    return true;
  }
  const text = level
    ? `level calibration is not valid: uncalibrated, levels are ${RELATIVE_UNIT}`
    : `no absolute level calibration: uncalibrated, levels are ${RELATIVE_UNIT}`;
  add('LEVEL_CALIBRATION', 'warn', text, null, 'dB');
  return false;
}

function decideStatus(reasons) {
  const T = QUALITY_THRESHOLDS;
  const quality = reasons.filter((r) => REASON_CODES[r.code].scope === Q);
  if (quality.some((r) => r.severity === 'fail' && REASON_CODES[r.code].invalidating))
    return 'INVALID';
  const warns = quality.filter((r) => r.severity === 'warn');
  const measured = new Set(
    warns
      .filter((r) => !REASON_CODES[r.code].notMeasured)
      .map((r) => REASON_CODES[r.code].dimension),
  );
  if (quality.some((r) => r.severity === 'fail') || measured.size >= T.poorWarnCount)
    return 'POOR';
  if (warns.length) return 'USABLE';
  return 'GOOD';
}

/**
 * assessQuality({ capture, transfer, aggregate, calibration, requestedRange, resolutionHz,
 *   sweepWindow }) → QualityAssessment (docs/v3/architecture.md)
 *   capture         checkCapture() result, or an array of them (one per run)
 *   transfer        computeTransfer() result or null (e.g. an RTA-only measurement)
 *   aggregate       aggregateRuns() result or null
 *   calibration     { frequency: { covered: Uint8Array (transfer grid), coverage: [fLo, fHi] }
 *                   | null, level: LevelCalibration | null }
 *   requestedRange  [f1, f2] in Hz; default transfer.requestedRange
 *   resolutionHz    bin resolution Δf; default transfer.binHz
 *   sweepWindow     optional [start, end) samples of the stimulus inside the capture (or one per
 *                   run); dropouts outside it only warn. Without it every interior dropout
 *                   invalidates.
 */
export function assessQuality({
  capture,
  transfer = null,
  aggregate = null,
  calibration = null,
  requestedRange = null,
  resolutionHz = null,
  sweepWindow = null,
} = {}) {
  const captures = normalizeCaptures(capture);
  if (transfer !== null) validateTransfer(transfer);
  const freqCal = calibration && calibration.frequency ? calibration.frequency : null;
  const levelCal = calibration && calibration.level ? calibration.level : null;
  const requested = requestedRange || (transfer && transfer.requestedRange) || null;
  if (requested && !(requested[0] > 0 && requested[1] > requested[0]
    && Number.isFinite(requested[1])))
    throw new RangeError(`requestedRange must be [f1, f2] with 0 < f1 < f2, got ${requested}`);
  let resolution = resolutionHz;
  if (!(resolution > 0) && transfer && transfer.binHz > 0) resolution = transfer.binHz;
  if (!(resolution > 0) || !Number.isFinite(resolution)) resolution = null;

  const frequencies = transfer ? Float64Array.from(transfer.frequencies) : new Float64Array(0);
  const n = frequencies.length;
  const fmt = frequencyFormatter(frequencies, resolution);
  const reasons = [];
  const add = (code, severity, text, value, unit, range) => {
    const r = { code, scope: REASON_CODES[code].scope, severity, text, value, unit };
    if (range) r.range = range;
    reasons.push(r);
  };

  const cap = assessCaptures(captures, sweepWindow, add);

  const nonFinite = (transfer ? countNonFiniteTransfer(transfer) : 0)
    + countNonFiniteAggregate(aggregate);
  if (nonFinite)
    add('NON_FINITE_ANALYSIS', 'fail',
      `numerical failure: ${plural(nonFinite, 'non-finite value')} in the analysis output`,
      nonFinite, 'points');

  let reliable = new Uint8Array(n);
  let snr = { snrMedianDb: null, snrMinDb: null, pooled: null };
  let cov = { coverage: null, coverageFraction: null };
  const transferUsable = transfer && n > 0 && countNonFiniteTransfer(transfer) === 0;
  if (transferUsable) {
    snr = assessSnr(transfer, fmt, add);
    if (requested) cov = assessCoverage(transfer, requested, fmt, add);
    const vr = transfer.validRange;
    const fMax = Number.isFinite(transfer.sampleRate)
      ? (transfer.sampleRate / 2) * SAFE_NYQUIST_FRACTION
      : Infinity;
    for (let i = 0; i < n; i++) {
      const f = frequencies[i];
      reliable[i] = snr.pooled
        ? (snr.pooled[i] >= QUALITY_THRESHOLDS.reliableMinSnrDb && f <= fMax ? 1 : 0)
        : (vr && f >= vr[0] && f <= vr[1] ? 1 : 0);
    }
  } else if (!transfer) {
    add('SNR_NOT_MEASURED', 'warn', 'SNR not measured: no transfer function', null, 'dB');
  }

  const repeatabilityDb = assessRepeatability(aggregate, captures.length, add);

  if (resolution !== null) {
    const firstReliable = reliable.indexOf(1);
    let fLow = null;
    if (firstReliable >= 0) fLow = frequencies[firstReliable];
    else if (n) fLow = frequencies[0];
    else if (requested) fLow = requested[0];
    if (fLow > 0) assessResolution(resolution, fLow, fmt, add);
  }

  const calMask = calibratedMask(frequencies, freqCal);
  const fc = assessFrequencyCalibration(freqCal, frequencies, calMask, reliable, requested, fmt,
    add);
  const levelCalibrated = assessLevelCalibration(levelCal, add);

  const status = decideStatus(reasons);
  if (status === 'INVALID') reliable = new Uint8Array(n);
  const ordered = reasons
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => status !== 'INVALID' || r.severity === 'fail')
    .sort((a, b) => SEVERITY_ORDER[a.r.severity] - SEVERITY_ORDER[b.r.severity] || a.i - b.i)
    .map(({ r }) => r);

  return {
    algorithm: QUALITY_ALGORITHM,
    status,
    reasons: ordered,
    metrics: {
      snrMedianDb: snr.snrMedianDb,
      snrMinDb: snr.snrMinDb,
      clippingRatio: cap.clippingRatio,
      clippingRegions: cap.clippingRegions,
      dropouts: cap.dropouts,
      repeatabilityDb,
      runs: aggregate && Number.isInteger(aggregate.runs) ? aggregate.runs : captures.length,
      requestedRange: requested ? [requested[0], requested[1]] : null,
      coverage: cov.coverage,
      coverageFraction: cov.coverageFraction,
      reliableRanges: maskRanges(frequencies, reliable),
      unreliableRanges: maskRanges(frequencies, invertMask(reliable)),
      calibratedRange: fc.calibratedRange,
      frequencyCalibrated: fc.frequencyCalibrated,
      levelCalibrated,
      resolutionHz: resolution,
    },
    mask: { frequencies, reliable, calibrated: calMask },
  };
}

const STATUS_WORDS = Object.freeze({
  GOOD: 'good',
  USABLE: 'usable',
  POOR: 'poor',
  INVALID: 'invalid',
});

/**
 * summarizeQuality(assessment) → one or two short sentences for screen readers (§150), e.g.
 * "Measurement quality: usable. 27 dB median SNR; reliable 40.0 Hz-15.2 kHz; uncalibrated.
 *  Main issue: 3 runs differ by ±2.0 dB (…)." Never lists points; INVALID names its causes.
 */
export function summarizeQuality(assessment) {
  const { status, reasons, metrics, mask } = assessment;
  const head = `Measurement quality: ${STATUS_WORDS[status]}.`;
  if (status === 'INVALID') {
    const causes = reasons.filter((r) => r.severity === 'fail').slice(0, 2).map((r) => r.text);
    return `${head} ${causes.join('; ')}.`;
  }
  const fmt = frequencyFormatter(mask.frequencies, metrics.resolutionHz);
  const parts = [];
  const snr = metrics.snrMedianDb;
  const snrDecimals = snr !== null && snr >= QUALITY_THRESHOLDS.snrGoodDb ? 0 : 1;
  parts.push(snr === null ? 'SNR not measured' : `${ratioDb(snr, snrDecimals)} dB median SNR`);
  if (mask.frequencies.length) {
    const ranges = metrics.reliableRanges;
    if (!ranges.length) parts.push('no reliable range');
    else {
      const shown = ranges.slice(0, 2).map(([lo, hi]) => rangeText(fmt, lo, hi)).join(' and ');
      const more = ranges.length > 2 ? ` (+${ranges.length - 2} more)` : '';
      parts.push(`reliable ${shown}${more}`);
    }
  }
  const fullFreq = metrics.frequencyCalibrated;
  if (fullFreq && metrics.levelCalibrated) parts.push('calibrated');
  else if (!metrics.calibratedRange && !metrics.levelCalibrated) parts.push('uncalibrated');
  else {
    const cal = [];
    if (metrics.calibratedRange) {
      cal.push(fullFreq
        ? 'microphone calibrated'
        : `microphone calibrated ${rangeText(fmt, ...metrics.calibratedRange)} only`);
    } else cal.push('no microphone calibration');
    cal.push(metrics.levelCalibrated ? 'level calibrated' : 'levels relative');
    parts.push(cal.join(', '));
  }
  let text = `${head} ${parts.join('; ')}.`;
  if (status !== 'GOOD') {
    const issue = reasons.find((r) => r.scope === Q && r.severity !== 'ok');
    if (issue) text += ` Main issue: ${issue.text}.`;
  }
  return text;
}
