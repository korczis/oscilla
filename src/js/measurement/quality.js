// Data-driven measurement quality assessment (spec §64-§71, §143, §156-§158, §198-§199,
// §220-§222, §237, §249; ADR 0025). Algorithm IDs: 'oscilla.confidence.v3' (default),
// 'oscilla.confidence.v2' and 'oscilla.confidence.v1' (retained, reproduced exactly for stored
// assessments; ADR 0024).
//
// Method. A pure rule table maps measured metrics to one of four statuses and ALWAYS returns
// the reasons, passing and failing alike, each backed by the number it was derived from. There
// is no score and no "confidence" percentage: a status means exactly the rules below. Inputs
// are the outputs of the modules that measured them — checkCapture() (capture-checks.js) per
// run, computeTransfer() (transfer.js), aggregateRuns() (aggregate.js) and the calibration
// state (calibration/interpolate.js coverage, calibration/level.js) — never raw guesses.
//
// Versioning (§199). Every threshold in QUALITY_THRESHOLDS and every rule in this header belong
// to a rule set named by its algorithm ID (QUALITY_RULESETS). Changing any threshold, a rule, or
// which codes invalidate mints a new ID; a stored status stays as assessed, and
// assessQuality({ algorithm }) recomputes it under the rule set it names.
//   v1  the rules below without the two v2 additions.
//   v2  v1 plus (a) DISCONTINUITY (capture-checks.js oscilla.discontinuity.v1): a sample
//       discontinuity inside the sweep window invalidates (DISCONTINUITY_IN_SWEEP, like a
//       dropout there: the samples are not the system's response), one outside it warns, none
//       is 'ok', and a capture check without a `discontinuities` list is NOT MEASURED (warn);
//       without a sweepWindow every discontinuity counts as inside. (b) OUTPUT CHAIN NOTES:
//       `chainNotes` is pure data about the playback chain reported by the platform layer (no
//       browser sniffing here), currently { limiterDeviationAboveHz }: every grid point above
//       that frequency is marked unreliable and OUTPUT_CHAIN_DEVIATION (dimension range) warns
//       when the measured or requested range reaches above it (ok when it does not). Added for
//       the spike's Firefox 155 reading above 18 kHz (docs/v3/spike-audioworklet-worker.md,
//       G12), since traced to a look-ahead replay that audio-engine.js feedLimiter removes; no
//       platform layer sets the note today. Thresholds are unchanged.
//   v3  v2 plus the fixes of the V3 pre-release review (B1, M1, M2, m2, m5, NITs):
//       (a) SNR NOT MEASURED instead of a number when there is no noise power to divide by:
//           the noise check (input `noiseCheck`, its checkCapture() result) is EMPTY (RMS below
//           EMPTY_RMS_DBFS, digital silence included), or the transfer has no SNR although it
//           had a noise capture (transfer.v2: zero noise power in some band), or a stored SNR
//           sits at transfer.js SNR_CEIL_DB (transfer.v1 stored 200 dB for Pn = 0). Then
//           SNR_NOT_MEASURED warns (caps USABLE) and no SNR value is reported. Decision: a
//           silent noise check is NOT invalidating — the runs are valid captures and only the
//           SNR is unknown; it is how a digital loopback looks, and for a microphone it points
//           at a gate or input processing, which rule (c) judges from the applied constraints.
//       (b) the SNR pooled over 1/6 octave is the POOLED POWER RATIO (ΣPy − ΣPn)/ΣPn
//           (transfer.v2 snrPooledDb), never the mean of per-point ratios v1/v2 used, which is
//           biased high by E[1/Pn] > 1/E[Pn] (+3-4 dB below 150 Hz with a 1 s noise check).
//           snrMedianDb is the median of that pooled SNR over the ASSESSED points. A point is
//           NOT ASSESSED when its pooling band holds fewer than minSnrObservations independent
//           noise observations: B·T_noise < 10 with B = (2^(1/12) − 2^(−1/12))·f, i.e.
//           f < 10·snrResolutionHz/0.1155 (86.6 Hz for a 1 s noise check, 20 Hz needs 4.3 s).
//           Not-assessed points are not reliable (no SNR evidence) and SNR_NOT_ASSESSED warns
//           (a NOT MEASURED code: caps USABLE, never pushes towards POOR). A transfer.v1 has
//           neither snrPooledDb nor snrResolutionHz: its snrDb is pooled as in v2 and every
//           point counts as assessed (documented fallback for re-assessing stored v1 data).
//       (c) INPUT PROCESSING (input `inputProcessing`, the applied constraints): any of
//           echoCancellation / noiseSuppression / autoGainControl reported true → INPUT_PROCESSING
//           fail (POOR: the capture is the processed signal, not the microphone's); any not
//           confirmed (null/absent) → INPUT_PROCESSING_NOT_CONFIRMED warn (caps USABLE); all
//           false → ok; 'test-context' (a digital loopback, no input chain) → ok; null (no
//           constraints reported at all) → NOT_CONFIRMED. Omitted (undefined) the rule is not
//           applied: a caller without a microphone path; engine.js assessMeasurement always
//           passes it.
//       (d) resolution: metrics.resolutionHz defaults to transfer.resolutionHz =
//           max(fs/N, 1/T_capture) (the zero-padded bin spacing claims more than the capture
//           resolves); metrics.snrResolutionHz = 1/T_noise and metrics.snrAssessedFromHz are
//           added.
//       (e) texts: repeatability reads "median run-to-run SD x dB" (or "absolute deviation"
//           for the median aggregation), a statistic, not a ± bound; clipping names the sweep
//           frequency of the clipped regions when the stimulus spec and sweep window are given
//           (input `stimulus`, stimulus.js instantaneousFrequency); and a capture whose peak
//           reaches the rail (≥ CLIP_THRESHOLD) without a CLIP_MIN_RUN flat top warns
//           CLIPPING_NOT_EXCLUDED instead of CLIPPING ok (a NOT MEASURED code: absence of the
//           evidence "no clipping", capped at USABLE, never pushed towards POOR).
//           A sine of amplitude A hard-clipped at rail r stays at the rail for acos(r/A)/π of
//           each period, i.e. fewer than CLIP_MIN_RUN samples above f = acos(r/A)·fs/
//           (π·CLIP_MIN_RUN): ≈ 2.4 kHz at 48 kHz for 1 dB of overdrive, 5.3 kHz for 6 dB. Such
//           short flat tops are deliberately not clip regions in capture-checks.js (a lone
//           full-scale sample is a legitimate transient; CLIP_MIN_RUN stays 3), so the rail
//           peak is the only trace of high-frequency clipping and is reported, not ignored.
//       Thresholds are unchanged except the new minSnrObservations.
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
//   | INVALID | any invalidating code (the rule set's invalidating codes, always 'fail')      |
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
// without a sweepWindow every interior dropout is treated as inside), in v2 a sample
// discontinuity inside the sweep window (same window rule), non-finite analysis output
// (transfer grid, magnitude, SNR, phase or the aggregate centre), and an empty validRange.
// An INVALID assessment keeps only its 'fail' reasons (no passing reason is offered as evidence
// for a meaningless result), and its reliable mask is all zero: it must not be drawn as
// authoritative.
//
// Per-frequency masks (§156-§158, §221-§222), on the transfer grid:
//   reliable[i]    with an SNR estimate: the 1/6-octave pooled SNR ≥ reliableMinSnrDb AND
//                  f ≤ SAFE_NYQUIST_FRACTION·Nyquist (v3: AND the point is assessed). v1/v2
//                  pool as the power mean of the linear per-point SNR (smoothFractionalOctave
//                  on snrDb), which equals transfer.js's pooled (Py − Pn)/Pn only in
//                  expectation of a noise-free Pn and is biased high otherwise (v3 header,
//                  (b)); v3 uses that pooled power ratio itself (transfer.v2 snrPooledDb). Bands the stimulus did not excite hold only noise and fail the SNR
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
import { CLIP_MIN_RUN, CLIP_THRESHOLD, EMPTY_RMS_DBFS } from './capture-checks.js';
import { formatDb, formatFrequencyWithResolution } from './format.js';
import { smoothFractionalOctave } from './smoothing.js';
import { SAFE_NYQUIST_FRACTION, instantaneousFrequency } from './stimulus.js';
import { SNR_CEIL_DB } from './transfer.js';
import { RELATIVE_UNIT, isValidLevelCalibration } from '../calibration/level.js';

/** The default rule set for new assessments: 'oscilla.confidence.v3'. */
export const QUALITY_ALGORITHM = ALGORITHMS.quality;
/** The retained first rule set (no discontinuity rule, no chain notes). */
export const QUALITY_ALGORITHM_V1 = 'oscilla.confidence.v1';
/** The retained second rule set (v1 + discontinuities + chain notes). */
export const QUALITY_ALGORITHM_V2 = 'oscilla.confidence.v2';
/** Relative width of a 1/6-octave pooling band: 2^(1/12) − 2^(−1/12). */
const SIXTH_OCTAVE_WIDTH = 2 ** (1 / 12) - 2 ** (-1 / 12);

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
  /** v3 only: independent noise observations (time-bandwidth product B·T_noise) a pooling band
   *  needs for its SNR to count as assessed. 10 bounds the pooled noise estimate's scatter to
   *  ≈ 4.34/√10 = 1.4 dB, inside the 2.4 dB error band that the 10 dB reliability margin
   *  already allows (snrUsableDb). */
  minSnrObservations: 10,
});

const Q = 'quality';
const C = 'calibration';

/** Reason-code definition: scope, status dimension, invalidating, reports a NOT MEASURED. */
const code = (scope, dimension, invalidating = false, notMeasured = false) =>
  Object.freeze({ scope, dimension, invalidating, notMeasured });

/** The v1 reason codes. */
const V1_CODES = Object.freeze({
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

/** The v2 reason codes: v1 plus discontinuities and the output-chain note. */
const V2_CODES = Object.freeze({
  ...V1_CODES,
  DISCONTINUITY_IN_SWEEP: code(Q, 'capture', true),
  DISCONTINUITY: code(Q, 'capture'),
  DISCONTINUITY_NOT_MEASURED: code(Q, 'capture', false, true),
  OUTPUT_CHAIN_DEVIATION: code(Q, 'range'),
});

/** The v3 reason codes: v2 plus SNR assessment and input processing. */
const V3_CODES = Object.freeze({
  ...V2_CODES,
  SNR_NOT_ASSESSED: code(Q, 'snr', false, true),
  CLIPPING_NOT_EXCLUDED: code(Q, 'capture', false, true),
  INPUT_PROCESSING: code(Q, 'input'),
  INPUT_PROCESSING_NOT_CONFIRMED: code(Q, 'input', false, true),
});

const invalidating = (codes) => Object.freeze(
  Object.keys(codes).filter((k) => codes[k].invalidating),
);

/**
 * Rule sets by algorithm ID (ADR 0024: an ID names one fixed set of rules). Each holds its
 * thresholds, reason codes (scope, dimension, invalidating, not-measured), invalidating codes
 * and which v2 inputs it reads.
 */
export const QUALITY_RULESETS = Object.freeze({
  [QUALITY_ALGORITHM_V1]: Object.freeze({
    algorithm: QUALITY_ALGORITHM_V1, thresholds: QUALITY_THRESHOLDS, reasonCodes: V1_CODES,
    invalidatingCodes: invalidating(V1_CODES), discontinuity: false, chainNotes: false,
    v3: false,
  }),
  [QUALITY_ALGORITHM_V2]: Object.freeze({
    algorithm: QUALITY_ALGORITHM_V2, thresholds: QUALITY_THRESHOLDS, reasonCodes: V2_CODES,
    invalidatingCodes: invalidating(V2_CODES), discontinuity: true, chainNotes: true, v3: false,
  }),
  'oscilla.confidence.v3': Object.freeze({
    algorithm: 'oscilla.confidence.v3', thresholds: QUALITY_THRESHOLDS, reasonCodes: V3_CODES,
    invalidatingCodes: invalidating(V3_CODES), discontinuity: true, chainNotes: true, v3: true,
  }),
});

/** Every reason code of the default rule set (QUALITY_ALGORITHM): scope, status dimension,
 *  whether it invalidates, whether it reports a quantity that was not measured. */
export const REASON_CODES = QUALITY_RULESETS[QUALITY_ALGORITHM].reasonCodes;

export const INVALIDATING_CODES = QUALITY_RULESETS[QUALITY_ALGORITHM].invalidatingCodes;

/** The output-chain note fields assessQuality understands (pure data, see the header). */
export const CHAIN_NOTE_FIELDS = Object.freeze(['limiterDeviationAboveHz']);

/**
 * normalizeChainNotes(notes) → null | { limiterDeviationAboveHz }
 * null/undefined (or no field set) → null. A plain object with only CHAIN_NOTE_FIELDS;
 * limiterDeviationAboveHz is null or a finite frequency > 0 Hz. Anything else throws, so a
 * misspelt note is never silently dropped.
 */
export function normalizeChainNotes(notes) {
  if (notes === null || notes === undefined) return null;
  if (typeof notes !== 'object' || Array.isArray(notes))
    throw new TypeError('chainNotes must be an object such as { limiterDeviationAboveHz }');
  for (const k of Object.keys(notes)) {
    if (!CHAIN_NOTE_FIELDS.includes(k)) throw new RangeError(`unknown chain note '${k}'`);
  }
  const hz = notes.limiterDeviationAboveHz ?? null;
  if (hz !== null && !(typeof hz === 'number' && Number.isFinite(hz) && hz > 0))
    throw new RangeError('chainNotes.limiterDeviationAboveHz must be a frequency > 0 Hz, '
      + `got ${hz}`);
  return hz === null ? null : Object.freeze({ limiterDeviationAboveHz: hz });
}

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

/**
 * v3: ", at ≈ 1.2 kHz of the sweep" / ", at ≈ 1.2-8.5 kHz of the sweep" for the clip regions
 * that lie inside their run's sweep window, from the stimulus spec; '' when unknown.
 */
function clipSweepText(captures, sweepWindow, stimulus) {
  if (!stimulus || !(stimulus.sampleRate > 0) || !(stimulus.duration > 0)) return '';
  let lo = Infinity;
  let hi = -Infinity;
  captures.forEach((c, i) => {
    const w = windowFor(sweepWindow, i);
    if (!w) return;
    for (const r of c.clipping.regions) {
      for (const s of [r.start, r.end - 1]) {
        const t = (s - w[0]) / stimulus.sampleRate;
        if (!(t >= 0 && t <= stimulus.duration)) continue;
        const f = instantaneousFrequency(stimulus, t);
        if (Number.isFinite(f) && f > 0) {
          lo = Math.min(lo, f);
          hi = Math.max(hi, f);
        }
      }
    }
  });
  if (!Number.isFinite(lo)) return '';
  const res = (hz) => formatFrequencyWithResolution(hz, hz / 10);
  return hi / lo < 1.05 ? `, at ≈ ${res(lo)} of the sweep`
    : `, at ≈ ${res(lo)}-${res(hi)} of the sweep`;
}

function assessCaptures(captures, sweepWindow, add, rules, stimulus = null) {
  const T = QUALITY_THRESHOLDS;
  const n = captures.length;
  const metrics = { clippingRatio: null, clippingRegions: null, dropouts: null };
  if (rules.discontinuity) metrics.discontinuities = null;
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
  const sweepAt = rules.v3 && regions > 0 ? clipSweepText(captures, sweepWindow, stimulus) : '';
  const clipText = `clipping at ${pct(ratio * 100)} % of samples ` +
    `(${plural(regions, 'region')}${sweepAt})${where}`;
  const peak = Math.max(...captures.map((c) => (Number.isFinite(c.peak) ? c.peak : 0)));
  if (ratio >= T.clipInvalidRatio) {
    add('CLIPPING_SEVERE', 'fail',
      `severe ${clipText}: at or above ${pct(T.clipInvalidRatio * 100)} % the response is ` +
        'the overload, not the system', ratio * 100, '%');
  } else if (ratio >= T.clipPoorRatio) {
    add('CLIPPING', 'fail', `${clipText}: at or above ${pct(T.clipPoorRatio * 100)} %`,
      ratio * 100, '%');
  } else if (regions > 0) {
    add('CLIPPING', 'warn', clipText, ratio * 100, '%');
  } else if (rules.v3 && peak >= CLIP_THRESHOLD) {
    add('CLIPPING_NOT_EXCLUDED', 'warn', `peak ${Number(peak.toPrecision(3))} reaches the rail ` +
      `(≥ ${CLIP_THRESHOLD}) without a ${CLIP_MIN_RUN}-sample flat top: brief clipping (high ` +
      'sweep frequencies) is not excluded', peak, 'peak');
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
  if (rules.discontinuity) metrics.discontinuities = assessDiscontinuities(captures, sweepWindow,
    who, add);
  return metrics;
}

/** v2: sample discontinuities (capture-checks.js) against the sweep window, like dropouts. */
function assessDiscontinuities(captures, sweepWindow, who, add) {
  let inside = 0;
  let outside = 0;
  let largest = 0;
  const insideRuns = [];
  const unmeasured = [];
  captures.forEach((c, i) => {
    if (!Array.isArray(c.discontinuities)) {
      unmeasured.push(i);
      return;
    }
    const w = windowFor(sweepWindow, i);
    let runInside = 0;
    for (const d of c.discontinuities) {
      if (!w || (d.start < w[1] && d.end > w[0])) {
        runInside++;
        if (Math.abs(d.jump) > largest) largest = Math.abs(d.jump);
      } else outside++;
    }
    if (runInside) insideRuns.push(i);
    inside += runInside;
  });
  const count = (k) => `${k} discontinuit${k === 1 ? 'y' : 'ies'}`;
  if (inside) {
    const scope = sweepWindow ? 'inside the sweep window' : 'inside the capture (no sweep window '
      + 'given, so treated as inside the sweep)';
    add('DISCONTINUITY_IN_SWEEP', 'fail',
      `sample discontinuity: ${count(inside)} ${scope} in ${who(insideRuns)} (largest step ` +
        `${Number(largest.toPrecision(2))} of full scale): the samples there are not the ` +
        "system's response", inside, 'discontinuities');
  }
  if (outside)
    add('DISCONTINUITY', 'warn', `${count(outside)} outside the sweep window`, outside,
      'discontinuities');
  if (unmeasured.length)
    add('DISCONTINUITY_NOT_MEASURED', 'warn',
      `discontinuities not checked in ${who(unmeasured)}: capture checks without a ` +
        'discontinuity list', unmeasured.length, 'runs');
  if (!inside && !outside && !unmeasured.length)
    add('DISCONTINUITY', 'ok', 'no discontinuities', 0, 'discontinuities');
  return unmeasured.length === captures.length ? null : inside + outside;
}

/**
 * v2: mark grid points above an output-chain deviation unreliable (in place) and report it.
 * `top` is the highest frequency the measurement covers (last grid point, else the requested
 * upper edge); returns metrics.outputChainLimitHz.
 */
function assessChainNotes(chain, frequencies, reliable, requested, fmt, add) {
  const lim = chain.limiterDeviationAboveHz;
  const n = frequencies.length;
  const limText = resolutionText(lim);
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (frequencies[i] > lim) {
      if (first < 0) first = i;
      reliable[i] = 0;
    }
  }
  const head = `output chain deviates above ${limText} in this browser`;
  if (n && first >= 0) {
    add('OUTPUT_CHAIN_DEVIATION', 'warn',
      `${head}: ${rangeText(fmt, frequencies[first], frequencies[n - 1])} marked unreliable`,
      lim, 'Hz', [frequencies[first], frequencies[n - 1]]);
  } else if (!n && requested && requested[1] > lim) {
    add('OUTPUT_CHAIN_DEVIATION', 'warn',
      `${head}: the requested range above it (${rangeText(fmt, lim, requested[1])}) is not ` +
        'reliable', lim, 'Hz', [lim, requested[1]]);
  } else {
    add('OUTPUT_CHAIN_DEVIATION', 'ok', `${head}, outside the measured range`, lim, 'Hz');
  }
  return lim;
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

/** Why there is no SNR to report (v3), or null when there is one. */
function snrAbsence(transfer, noiseCheck, captures) {
  const runsCarrySignal = captures.length > 0 && captures.every((c) => !c.empty);
  const tail = runsCarrySignal ? ' while the runs carry signal (a noise gate, input ' +
    'processing or a digital loopback): no SNR is derived from it' : '';
  if (noiseCheck && noiseCheck.empty) {
    const rms = noiseCheck.rms;
    const what = rms > 0
      ? `RMS ${formatDb(20 * Math.log10(rms))}, below ${formatDb(EMPTY_RMS_DBFS)}`
      : 'digital silence';
    return `SNR not measured: the noise check is empty (${what})${tail}`;
  }
  if (!transfer.snrDb) {
    if (Number.isFinite(transfer.snrResolutionHz) || noiseCheck)
      return 'SNR not measured: the noise check holds no noise power in at least one band ' +
        '(digital silence or a gate), so no SNR is derived from it';
    return 'SNR not measured: no noise-floor capture';
  }
  for (let i = 0; i < transfer.snrDb.length; i++) {
    if (transfer.snrDb[i] >= SNR_CEIL_DB)
      return `SNR not measured: the stored SNR sits at the ${SNR_CEIL_DB} dB ceiling (no noise ` +
        'power in the noise check)';
  }
  return null;
}

/**
 * v3 SNR (see the header, v3 (a)-(b)): pooled power ratio, assessed points only.
 * Returns { snrMedianDb, snrMinDb, pooled, assessed, snrResolutionHz, snrAssessedFromHz }.
 */
function assessSnrV3(transfer, noiseCheck, captures, fmt, add) {
  const T = QUALITY_THRESHOLDS;
  const f = transfer.frequencies;
  const n = f.length;
  const res = Number.isFinite(transfer.snrResolutionHz) && transfer.snrResolutionHz > 0
    ? transfer.snrResolutionHz : null;
  const out = { snrMedianDb: null, snrMinDb: null, pooled: null, assessed: null,
    snrResolutionHz: res, snrAssessedFromHz: null };
  const absent = snrAbsence(transfer, noiseCheck, captures);
  if (absent) {
    add('SNR_NOT_MEASURED', 'warn', absent, null, 'dB');
    return out;
  }
  const pooled = transfer.snrPooledDb && transfer.snrPooledDb.length === n
    ? Float64Array.from(transfer.snrPooledDb)
    : smoothFractionalOctave(f, transfer.snrDb, T.reliablePoolingFraction);
  const fA = res ? (T.minSnrObservations * res) / SIXTH_OCTAVE_WIDTH : null;
  const assessed = new Uint8Array(n);
  for (let i = 0; i < n; i++) assessed[i] = fA === null || f[i] >= fA ? 1 : 0;
  out.pooled = pooled;
  out.assessed = assessed;
  out.snrAssessedFromHz = fA;
  const firstAssessed = assessed.indexOf(1);
  if (firstAssessed !== 0) {
    const tNoise = 1 / res;
    const need = T.minSnrObservations / (SIXTH_OCTAVE_WIDTH * f[0]);
    const below = firstAssessed < 0 ? `in the whole measured range (${rangeText(fmt, f[0],
      f[n - 1])})` : `below ${fmt(f[firstAssessed])}`;
    add('SNR_NOT_ASSESSED', 'warn',
      `SNR not assessed ${below}: the ${Number(tNoise.toPrecision(2))} s noise check gives ` +
        `fewer than ${T.minSnrObservations} independent noise observations per 1/6 octave ` +
        `there (${Number(Math.ceil(need * 10) / 10)} s would assess from ${fmt(f[0])})`,
      fA, 'Hz', [f[0], firstAssessed < 0 ? f[n - 1] : f[firstAssessed - 1]]);
  }
  if (firstAssessed < 0) return out;

  const med = median(pooled.filter((_, i) => assessed[i]));
  out.snrMedianDb = med;
  const r = ratioDb(med, 1);
  const basis = '1/6-octave pooled';
  if (med >= T.snrGoodDb)
    add('SNR_MEDIAN', 'ok', `${ratioDb(med)} dB median SNR (${basis})`, med, 'dB');
  else if (med >= T.snrUsableDb)
    add('SNR_MEDIAN', 'warn', `${r} dB median SNR (${basis}; GOOD needs ≥ ${T.snrGoodDb} dB)`,
      med, 'dB');
  else
    add('SNR_MEDIAN', 'fail',
      `${r} dB median SNR (${basis}), below the ${T.snrUsableDb} dB minimum for USABLE`, med,
      'dB');

  const vr = transfer.validRange;
  if (vr) {
    let min = Infinity;
    for (let i = 0; i < n; i++)
      if (assessed[i] && f[i] >= vr[0] && f[i] <= vr[1] && pooled[i] < min) min = pooled[i];
    out.snrMinDb = Number.isFinite(min) ? min : null;
  }

  const low = new Uint8Array(n);
  for (let i = 0; i < n; i++) low[i] = assessed[i] && pooled[i] < T.reliableMinSnrDb ? 1 : 0;
  const bands = maskRuns(low)
    .map(([a, b]) => ({ a, b, width: octaves(f[a], f[b]) }))
    .filter((band) => band.width >= T.lowSnrBandMinOctaves - 1e-9)
    .sort((x, y) => y.width - x.width || x.a - y.a)
    .slice(0, T.maxBandReasons)
    .sort((x, y) => x.a - y.a);
  for (const { a, b } of bands) {
    const m = median(pooled.subarray(a, b + 1));
    const range = rangeText(fmt, f[a], f[b]);
    const text = m > 0
      ? `${range} only ${ratioDb(m, 1)} dB above the noise floor`
      : `${range} not above the noise floor (${ratioDb(m, 1)} dB SNR)`;
    add('LOW_SNR_BAND', 'warn', `${text} (reliable needs ≥ ${T.reliableMinSnrDb} dB)`, m, 'dB',
      [f[a], f[b]]);
  }
  return out;
}

/** v3 (c): input processing from the applied constraints (see the header). */
const PROCESSING_KEYS = Object.freeze([
  ['echoCancellation', 'echo cancellation'],
  ['noiseSuppression', 'noise suppression'],
  ['autoGainControl', 'automatic gain control'],
]);

function assessInputProcessing(ip, add) {
  if (ip === undefined) return null;
  if (ip === 'test-context') {
    add('INPUT_PROCESSING', 'ok', 'no input processing: digital test context (no microphone ' +
      'path)', 0, 'flags');
    return { on: [], unconfirmed: [] };
  }
  if (ip !== null && (typeof ip !== 'object' || Array.isArray(ip)))
    throw new TypeError("inputProcessing must be the applied constraints { echoCancellation, " +
      "noiseSuppression, autoGainControl }, 'test-context' or null");
  if (ip === null) {
    add('INPUT_PROCESSING_NOT_CONFIRMED', 'warn', 'input processing not confirmed off: the ' +
      'browser reported no applied constraints (echo cancellation, noise suppression and ' +
      'automatic gain control may be active)', null, 'flags');
    return { on: null, unconfirmed: null };
  }
  const on = PROCESSING_KEYS.filter(([k]) => ip[k] === true).map(([, w]) => w);
  const unconfirmed = PROCESSING_KEYS.filter(([k]) => ip[k] !== true && ip[k] !== false)
    .map(([, w]) => w);
  const list = (ws) => (ws.length > 1 ? `${ws.slice(0, -1).join(', ')} and ${ws.at(-1)}` : ws[0]);
  if (on.length) {
    add('INPUT_PROCESSING', 'fail', `input processing active: ${list(on)} reported on by the ` +
      "browser, so the capture is the processed signal, not the microphone's", on.length,
    'flags');
  } else if (unconfirmed.length) {
    add('INPUT_PROCESSING_NOT_CONFIRMED', 'warn', `input processing not confirmed off: ` +
      `${list(unconfirmed)} not reported by the browser`, unconfirmed.length, 'flags');
  } else {
    add('INPUT_PROCESSING', 'ok', 'input processing confirmed off (echo cancellation, noise ' +
      'suppression, automatic gain control)', 0, 'flags');
  }
  return { on, unconfirmed };
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

/** v3 (e): repeatability as the statistic it is, "median run-to-run SD x dB". */
function repeatabilityTextV3(n, rep, kind, severity) {
  const T = QUALITY_THRESHOLDS;
  const stat = kind === 'std' ? 'SD' : 'absolute deviation';
  const per = kind === 'std' ? 'standard deviation' : 'absolute deviation from the median';
  const head = `${n} runs: median run-to-run ${stat}`;
  const basis = `per-frequency ${per}, median across frequency`;
  if (severity === 'ok')
    return `${head} ${ratioDb(Math.max(0.1, Math.ceil(rep * 10) / 10), 1)} dB (${basis})`;
  if (severity === 'warn')
    return `${head} ${ratioDb(rep, 1)} dB (${basis}; GOOD needs ≤ ${T.repeatabilityGoodDb} dB)`;
  return `${head} ${ratioDb(rep, 1)} dB (${basis}), above the ${T.repeatabilityUsableDb} dB ` +
    'limit for USABLE';
}

function assessRepeatability(aggregate, runs, add, rules = { v3: false }) {
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
  if (rules.v3) {
    const severity = rep <= T.repeatabilityGoodDb ? 'ok'
      : rep <= T.repeatabilityUsableDb ? 'warn' : 'fail';
    add('REPEATABILITY', severity, repeatabilityTextV3(n, rep,
      aggregate.dispersion === 'std' ? 'std' : 'mad', severity), rep, 'dB');
    return rep;
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

function decideStatus(reasons, codes) {
  const T = QUALITY_THRESHOLDS;
  const quality = reasons.filter((r) => codes[r.code].scope === Q);
  if (quality.some((r) => r.severity === 'fail' && codes[r.code].invalidating))
    return 'INVALID';
  const warns = quality.filter((r) => r.severity === 'warn');
  const measured = new Set(
    warns
      .filter((r) => !codes[r.code].notMeasured)
      .map((r) => codes[r.code].dimension),
  );
  if (quality.some((r) => r.severity === 'fail') || measured.size >= T.poorWarnCount)
    return 'POOR';
  if (warns.length) return 'USABLE';
  return 'GOOD';
}

/**
 * assessQuality({ capture, transfer, aggregate, calibration, requestedRange, resolutionHz,
 *   sweepWindow, chainNotes, algorithm }) → QualityAssessment (docs/v3/architecture.md)
 *   capture         checkCapture() result, or an array of them (one per run)
 *   transfer        computeTransfer() result or null (e.g. an RTA-only measurement)
 *   aggregate       aggregateRuns() result or null
 *   calibration     { frequency: { covered: Uint8Array (transfer grid), coverage: [fLo, fHi] }
 *                   | null, level: LevelCalibration | null }
 *   requestedRange  [f1, f2] in Hz; default transfer.requestedRange
 *   resolutionHz    bin resolution Δf; default transfer.binHz
 *   sweepWindow     optional [start, end) samples of the stimulus inside the capture (or one per
 *                   run); dropouts (and in v2 discontinuities) outside it only warn. Without
 *                   it every interior dropout (discontinuity) invalidates.
 *   chainNotes      v2: optional output-chain facts, { limiterDeviationAboveHz } (see
 *                   normalizeChainNotes); grid points above it are marked unreliable
 *   noiseCheck      v3: the checkCapture() result of the stimulus-free noise capture, or null
 *                   (none taken); an EMPTY one makes the SNR NOT MEASURED
 *   inputProcessing v3: the applied input constraints { echoCancellation, noiseSuppression,
 *                   autoGainControl } (true / false / null each), 'test-context' (digital
 *                   loopback), null (none reported) or undefined (rule not applied)
 *   stimulus        v3: optional stimulus spec (stimulus.js) to name the sweep frequency of
 *                   clipped regions (with sweepWindow)
 *   algorithm       rule set: QUALITY_ALGORITHM (v3, default), QUALITY_ALGORITHM_V2 or
 *                   QUALITY_ALGORITHM_V1, each reproducing its own assessments exactly (v1 reads
 *                   neither discontinuities nor chainNotes; v1 and v2 ignore the v3 inputs)
 */
export function assessQuality({
  capture,
  transfer = null,
  aggregate = null,
  calibration = null,
  requestedRange = null,
  resolutionHz = null,
  sweepWindow = null,
  chainNotes = null,
  noiseCheck = null,
  inputProcessing = undefined,
  stimulus = null,
  algorithm = QUALITY_ALGORITHM,
} = {}) {
  const rules = QUALITY_RULESETS[algorithm];
  if (!rules || !Object.prototype.hasOwnProperty.call(QUALITY_RULESETS, algorithm))
    throw new RangeError(`unknown quality rule set '${algorithm}' (known: ` +
      `${Object.keys(QUALITY_RULESETS).join(', ')})`);
  const codes = rules.reasonCodes;
  const chain = rules.chainNotes ? normalizeChainNotes(chainNotes) : null;
  const captures = normalizeCaptures(capture);
  if (rules.v3 && noiseCheck !== null && noiseCheck !== undefined && !isCheckResult(noiseCheck))
    throw new TypeError('noiseCheck is not a checkCapture() result');
  if (transfer !== null) validateTransfer(transfer);
  const freqCal = calibration && calibration.frequency ? calibration.frequency : null;
  const levelCal = calibration && calibration.level ? calibration.level : null;
  const requested = requestedRange || (transfer && transfer.requestedRange) || null;
  if (requested && !(requested[0] > 0 && requested[1] > requested[0]
    && Number.isFinite(requested[1])))
    throw new RangeError(`requestedRange must be [f1, f2] with 0 < f1 < f2, got ${requested}`);
  let resolution = resolutionHz;
  if (rules.v3 && !(resolution > 0) && transfer && transfer.resolutionHz > 0)
    resolution = transfer.resolutionHz;
  if (!(resolution > 0) && transfer && transfer.binHz > 0) resolution = transfer.binHz;
  if (!(resolution > 0) || !Number.isFinite(resolution)) resolution = null;

  const frequencies = transfer ? Float64Array.from(transfer.frequencies) : new Float64Array(0);
  const n = frequencies.length;
  const fmt = frequencyFormatter(frequencies, resolution);
  const reasons = [];
  const add = (code, severity, text, value, unit, range) => {
    const r = { code, scope: codes[code].scope, severity, text, value, unit };
    if (range) r.range = range;
    reasons.push(r);
  };

  const cap = assessCaptures(captures, sweepWindow, add, rules, stimulus);
  if (rules.v3) assessInputProcessing(inputProcessing, add);

  const nonFinite = (transfer ? countNonFiniteTransfer(transfer) : 0)
    + countNonFiniteAggregate(aggregate);
  if (nonFinite)
    add('NON_FINITE_ANALYSIS', 'fail',
      `numerical failure: ${plural(nonFinite, 'non-finite value')} in the analysis output`,
      nonFinite, 'points');

  let reliable = new Uint8Array(n);
  let snr = { snrMedianDb: null, snrMinDb: null, pooled: null, assessed: null,
    snrResolutionHz: null, snrAssessedFromHz: null };
  let cov = { coverage: null, coverageFraction: null };
  const transferUsable = transfer && n > 0 && countNonFiniteTransfer(transfer) === 0;
  if (transferUsable) {
    snr = rules.v3 ? assessSnrV3(transfer, noiseCheck, captures, fmt, add)
      : assessSnr(transfer, fmt, add);
    if (requested) cov = assessCoverage(transfer, requested, fmt, add);
    const vr = transfer.validRange;
    const fMax = Number.isFinite(transfer.sampleRate)
      ? (transfer.sampleRate / 2) * SAFE_NYQUIST_FRACTION
      : Infinity;
    for (let i = 0; i < n; i++) {
      const f = frequencies[i];
      reliable[i] = snr.pooled
        ? (snr.pooled[i] >= QUALITY_THRESHOLDS.reliableMinSnrDb && f <= fMax
          && (!snr.assessed || snr.assessed[i]) ? 1 : 0)
        : (vr && f >= vr[0] && f <= vr[1] ? 1 : 0);
    }
  } else if (!transfer) {
    add('SNR_NOT_MEASURED', 'warn', 'SNR not measured: no transfer function', null, 'dB');
  }

  const outputChainLimitHz = chain
    ? assessChainNotes(chain, frequencies, reliable, requested, fmt, add)
    : null;

  const repeatabilityDb = assessRepeatability(aggregate, captures.length, add, rules);

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

  const status = decideStatus(reasons, codes);
  if (status === 'INVALID') reliable = new Uint8Array(n);
  const ordered = reasons
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => status !== 'INVALID' || r.severity === 'fail')
    .sort((a, b) => SEVERITY_ORDER[a.r.severity] - SEVERITY_ORDER[b.r.severity] || a.i - b.i)
    .map(({ r }) => r);

  const metrics = {
    snrMedianDb: snr.snrMedianDb,
    snrMinDb: snr.snrMinDb,
    clippingRatio: cap.clippingRatio,
    clippingRegions: cap.clippingRegions,
    dropouts: cap.dropouts,
  };
  if (rules.discontinuity) metrics.discontinuities = cap.discontinuities;
  Object.assign(metrics, {
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
  });
  if (rules.chainNotes) metrics.outputChainLimitHz = outputChainLimitHz;
  if (rules.v3) {
    metrics.snrResolutionHz = snr.snrResolutionHz;
    metrics.snrAssessedFromHz = snr.snrAssessedFromHz;
  }
  return {
    algorithm: rules.algorithm,
    status,
    reasons: ordered,
    metrics,
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
