// Integrity checks on one captured run before any analysis trusts it: clipping, dropouts,
// discontinuities, empty input, non-finite samples. Pure; a Capture is { sampleRate, samples,
// ... } (see docs/v3/architecture.md). The checks look at digital samples only: a capture that
// passes can still be acoustically wrong (wrong device, processing left on), which quality.js
// judges.
//
// Clipping: a sample is "at the rail" when |x| ≥ clipThreshold; clipping is at least
// clipMinRun rail samples within clipWindowS, because a lone full-scale sample is a legitimate
// transient while an overloaded input keeps returning to the rail. 'oscilla.clip.v2' (V382)
// takes 1 ms: above a few kHz a flat top spans one or two samples, so an overload of a
// high-frequency tone puts its rail samples a few samples apart but never three in a row
// (a 1 dB overload of a sweep above 5 kHz left 5.1 % of the samples at the rail and no v1
// region). 'oscilla.clip.v1' (consecutive rail samples only) is the same rule with a window of
// clipMinRun − 1 samples and is still selectable (opts.algorithm). A region spans the rail
// samples it groups; regions closer than clipMergeGapS are merged into one overload event.
// ratio = rail samples inside regions / total samples.
//
// Dropouts: a run longer than dropoutMinS whose samples all stay within constantTolerance of
// each other (exact zeros, or a frozen value) that lies inside the capture, i.e. touches
// neither the first nor the last sample. Edge silence (an input that delivers zeros until it
// starts) is not a dropout here: whether the stimulus was covered is decided by alignment.
// Runs at the rail are clipping, not dropouts.
//
// Discontinuities (spec §68; ID 'oscilla.discontinuity.v1'): a STEP between consecutive samples
// far larger than the signal's own local slope allows — a splice, a lost buffer joined
// end-to-end, a jump in level. Statistic, for the boundary between samples b − 1 and b with
// d[i] = x[i] − x[i−1]:
//   rms_local = RMS of d over [b − W, b + W] excluding [b − H, b + H]    W = 5 ms, H = 2
//   flagged when |d[b]| ≥ DISCONTINUITY_RATIO · rms_local (8) and |d[b]| ≥ 2^−12, and the
//   levels on both sides persist: sign(d[b])·(x[b+w] − x[b−1]) > |d[b]|/2 and
//   sign(d[b])·(x[b] − x[b−1−w]) > |d[b]|/2 for w = 1 … H.
// Why: the local RMS of d measures the slope the signal actually has there (its local
// bandwidth × amplitude); for any single sinusoid max|d| = √2·rms(d), whatever its frequency,
// so a full-scale tone just below Nyquist (|d| up to 2) is never a discontinuity, while a 2·A
// splice in a 440 Hz tone is ≈ 49× its local rms(d). For Gaussian noise P(|d| ≥ 8σ_d) ≈ 1e-15
// per sample. The persistence test separates a step from a transient: a 1- or 2-sample spike
// returns to its old level (the clipping check above likewise treats a lone full-scale sample
// as legitimate); with ratio 8 a sinusoid's own slope moves the level by at most
// 2·√2/8 = 0.35·|d[b]| within H = 2 samples, less than the |d[b]|/2 a step must keep. The
// 2^−12 (−72 dBFS) floor ignores LSB-sized steps in near-silence, where rms_local → 0.
// Steps already explained elsewhere are not reported again: any rail sample in
// [b − 1 − H, b + H] (clipping), a boundary of a reported dropout, and the onset or end of edge
// silence (a constant run touching the first or last sample, left to alignment as above).
// A step smeared over several samples by a filter after the splice is not single-sample and
// may be missed; the check is a detector of digital splices, not a proof of continuity.
//
// Regions are half-open sample ranges [start, end); a discontinuity region is [b − 1, b + 1),
// the two samples the step lies between (merged when they touch), with its largest `jump`
// and `ratio` (|d[b]|/rms_local, null when rms_local is 0).
// The result carries `algorithms: { clip, discontinuity }`, the IDs of the checks it ran.

import { ALGORITHMS } from './algorithms.js';

/** |x| at or above this counts as at the rail: −0.18 dBFS, below the softened flat tops that
 *  resampling or a float-converted ADC leave just under 1.0. */
export const CLIP_THRESHOLD = 0.98;
/** Rail samples needed for clipping: a flat top, not a single transient peak. */
export const CLIP_MIN_RUN = 3;
/** clip.v2: the clipMinRun rail samples lie within this span (1 ms: a few periods at 3 kHz). */
export const CLIP_WINDOW_S = 0.001;
/** Clipping algorithms checkCapture implements (opts.algorithm; ALGORITHMS.clip by default). */
export const CLIP_ALGORITHM_IDS = Object.freeze(['oscilla.clip.v1', 'oscilla.clip.v2']);
/** Clip regions closer than this merge (5 ms ≈ half a period at 100 Hz: one overload). */
export const CLIP_MERGE_GAP_S = 0.005;
/** Shortest constant run reported as a dropout: 20 ms (960 frames at 48 kHz) is shorter than a
 *  lost 1024-frame callback and far longer than any real input stays within the tolerance. */
export const DROPOUT_MIN_S = 0.02;
/** Peak-to-peak spread that still counts as constant: 2^−20 ≈ −120 dBFS, below the noise of
 *  any working converter, so a live input never satisfies it for 20 ms. */
export const CONSTANT_TOLERANCE = 2 ** -20;
/** RMS below this is an empty capture: −90 dBFS (20·log10 re 1.0) is under the self-noise of
 *  any connected microphone input, so lower means muted, disconnected or digital silence. */
export const EMPTY_RMS_DBFS = -90;
/** A step must reach this multiple of the local RMS sample-to-sample difference (see the
 *  header: √2 for any sinusoid, 1e-15 tail probability for Gaussian noise). */
export const DISCONTINUITY_RATIO = 8;
/** Half-width of the window for the local RMS of d: 5 ms holds ≥ 5 periods above 1 kHz and
 *  follows a sweep's changing frequency (a 20 Hz-20 kHz, 1 s sweep moves 0.05 octave). */
export const DISCONTINUITY_WINDOW_S = 0.005;
/** Samples each side of a step that must stay at their level (rejects 1-2 sample spikes). */
export const DISCONTINUITY_HOLD = 2;
/** Fraction of the step those samples must keep (a step, not a return to the old level). */
export const DISCONTINUITY_HOLD_FRACTION = 0.5;
/** Smallest step reported: 2^−12 ≈ −72 dBFS, 8 LSB of 16-bit audio, far above dither. */
export const DISCONTINUITY_MIN_JUMP = 2 ** -12;
/** IDs of the checks this module runs (stamped into every result). */
export const CAPTURE_CHECK_ALGORITHMS = Object.freeze({
  clip: ALGORITHMS.clip,
  discontinuity: ALGORITHMS.discontinuity,
});

const reason = (code, text) => Object.freeze({ code, text });

function mergeRegions(regions, gap) {
  const out = [];
  for (const r of regions) {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= gap) last.end = r.end;
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

/** Length of the constant run (peak-to-peak ≤ tolerance) starting at `from` going `step`. */
function edgeRun(samples, from, step, tolerance) {
  const n = samples.length;
  if (!Number.isFinite(samples[from])) return 0;
  let lo = samples[from];
  let hi = lo;
  let len = 1;
  for (let i = from + step; i >= 0 && i < n; i += step) {
    const v = samples[i];
    if (!Number.isFinite(v) || Math.max(hi, v) - Math.min(lo, v) > tolerance) break;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    len++;
  }
  return len;
}

/**
 * Discontinuities (see the header). `skip(b)` is true for boundaries already explained by an
 * edge-silence onset or a dropout. Returns merged regions [{ start, end, jump, ratio }].
 */
function findDiscontinuities(x, sr, o, skip) {
  const n = x.length;
  const H = o.hold;
  const W = Math.max(H + 8, Math.round(o.windowS * sr));
  const out = [];
  const bStart = H + 1;
  const bEnd = n - 1 - H;
  if (!(sr > 0) || bEnd < bStart) return out;
  const dd = (i) => {
    if (i < 1 || i >= n) return 0;
    const v = x[i] - x[i - 1];
    return Number.isFinite(v) ? v * v : 0;
  };
  let outer = 0;
  let inner = 0;
  for (let b = bStart; b <= bEnd; b++) {
    if ((b - bStart) % 1024 === 0) {
      // Exact re-sum every 1024 steps so the rolling sums cannot drift on quiet passages.
      outer = 0;
      for (let i = b - W; i <= b + W; i++) outer += dd(i);
      inner = 0;
      for (let i = b - H; i <= b + H; i++) inner += dd(i);
    } else {
      outer += dd(b + W) - dd(b - W - 1);
      inner += dd(b + H) - dd(b - H - 1);
    }
    const jump = x[b] - x[b - 1];
    const a = Math.abs(jump);
    if (!(a >= o.minJump)) continue;
    const count = Math.min(n - 1, b + W) - Math.max(1, b - W) + 1 - (2 * H + 1);
    if (count <= 0) continue;
    const rms = Math.sqrt(Math.max(0, outer - inner) / count);
    if (a < o.ratio * rms) continue;
    if (skip(b)) continue;
    let ok = true;
    for (let i = b - 1 - H; i <= b + H && ok; i++) {
      if (!Number.isFinite(x[i]) || Math.abs(x[i]) >= o.clipThreshold) ok = false;
    }
    const sign = jump > 0 ? 1 : -1;
    const keep = a * o.holdFraction;
    for (let w = 1; w <= H && ok; w++) {
      if (!(sign * (x[b + w] - x[b - 1]) > keep) || !(sign * (x[b] - x[b - 1 - w]) > keep))
        ok = false;
    }
    if (!ok) continue;
    const ratio = rms > 0 ? a / rms : null;
    const last = out[out.length - 1];
    if (last && b - 1 <= last.end) {
      last.end = b + 1;
      last.jump = Math.max(last.jump, a);
      last.ratio = last.ratio === null || ratio === null ? null : Math.max(last.ratio, ratio);
    } else {
      out.push({ start: b - 1, end: b + 1, jump: a, ratio });
    }
  }
  return out;
}

/**
 * checkCapture(capture, opts) → { algorithms: { clip, discontinuity }, clipping: { ratio,
 *   regions }, dropouts, discontinuities: [{ start, end, jump, ratio }], rms, peak, empty,
 *   invalid, reasons: [{ code, text }] }
 * opts: clipThreshold, clipMinRun, clipMergeGapS, dropoutMinS, constantTolerance, emptyRmsDbfs,
 * discontinuityRatio, discontinuityWindowS, discontinuityHold, discontinuityHoldFraction,
 * discontinuityMinJump (defaults: the exported constants). Reason codes: NO_SAMPLES,
 * BAD_SAMPLE_RATE, NON_FINITE, EMPTY, CLIPPING, DROPOUT, DISCONTINUITY. invalid ⇔ reasons is
 * non-empty.
 */
export function checkCapture(capture, opts = {}) {
  const clipAlgorithm = opts.algorithm ?? ALGORITHMS.clip;
  if (!CLIP_ALGORITHM_IDS.includes(clipAlgorithm)) {
    throw new RangeError(`unknown clipping algorithm ${clipAlgorithm}`);
  }
  const clipThreshold = opts.clipThreshold ?? CLIP_THRESHOLD;
  const clipMinRun = opts.clipMinRun ?? CLIP_MIN_RUN;
  const clipWindowS = opts.clipWindowS ?? CLIP_WINDOW_S;
  const mergeGapS = opts.clipMergeGapS ?? CLIP_MERGE_GAP_S;
  const dropoutMinS = opts.dropoutMinS ?? DROPOUT_MIN_S;
  const tolerance = opts.constantTolerance ?? CONSTANT_TOLERANCE;
  const emptyDbfs = opts.emptyRmsDbfs ?? EMPTY_RMS_DBFS;
  const disc = {
    ratio: opts.discontinuityRatio ?? DISCONTINUITY_RATIO,
    windowS: opts.discontinuityWindowS ?? DISCONTINUITY_WINDOW_S,
    hold: opts.discontinuityHold ?? DISCONTINUITY_HOLD,
    holdFraction: opts.discontinuityHoldFraction ?? DISCONTINUITY_HOLD_FRACTION,
    minJump: opts.discontinuityMinJump ?? DISCONTINUITY_MIN_JUMP,
    clipThreshold,
  };

  const samples = capture && capture.samples;
  const sampleRate = capture && capture.sampleRate;
  const reasons = [];
  const n = samples ? samples.length : 0;
  if (!n) {
    reasons.push(reason('NO_SAMPLES', 'The capture contains no samples.'));
    return {
      algorithms: CAPTURE_CHECK_ALGORITHMS,
      clipping: { ratio: 0, regions: [] },
      dropouts: [],
      discontinuities: [],
      rms: 0,
      peak: 0,
      empty: true,
      invalid: true,
      reasons,
    };
  }
  const rateOk = typeof sampleRate === 'number' && sampleRate > 0 && Number.isFinite(sampleRate);
  if (!rateOk) reasons.push(reason('BAD_SAMPLE_RATE', 'The capture has no valid sample rate.'));
  const sr = rateOk ? sampleRate : 0;

  let sumSq = 0;
  let peak = 0;
  let nonFinite = 0;
  // Clip grouping (see the header): the last clipMinRun rail indices; a rail sample whose
  // (clipMinRun − 1)-th predecessor lies within `span` samples groups them into a region.
  const span = clipAlgorithm === 'oscilla.clip.v1' || !(sampleRate > 0)
    ? clipMinRun - 1
    : Math.max(clipMinRun - 1, Math.round(clipWindowS * sampleRate));
  const clipRuns = [];
  let clipped = 0;
  const recent = [];
  let counted = -1; // last rail index already counted in `clipped`
  const rail = (i) => {
    recent.push(i);
    if (recent.length > clipMinRun) recent.shift();
    if (recent.length < clipMinRun || i - recent[0] > span) return;
    const last = clipRuns[clipRuns.length - 1];
    if (last && recent[0] <= last.end) last.end = i + 1;
    else clipRuns.push({ start: recent[0], end: i + 1 });
    for (const k of recent) if (k > counted) clipped++;
    counted = i;
  };
  const closeRail = () => { recent.length = 0; };

  const dropouts = [];
  const minRun = Math.max(2, Math.ceil(dropoutMinS * sr));
  let runStart = 0;
  let runMin = samples[0];
  let runMax = samples[0];
  const closeRun = (end) => {
    const atRail = Math.max(Math.abs(runMin), Math.abs(runMax)) >= clipThreshold;
    if (rateOk && runStart > 0 && end < n && end - runStart >= minRun && !atRail)
      dropouts.push({ start: runStart, end });
  };

  for (let i = 0; i < n; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) {
      nonFinite++;
      closeRail();
      continue;
    }
    const a = Math.abs(v);
    sumSq += v * v;
    if (a > peak) peak = a;
    if (a >= clipThreshold) rail(i);
    else if (span === clipMinRun - 1) closeRail();
    if (i > 0) {
      const lo = Math.min(runMin, v);
      const hi = Math.max(runMax, v);
      if (hi - lo <= tolerance) {
        runMin = lo;
        runMax = hi;
      } else {
        closeRun(i);
        runStart = i;
        runMin = v;
        runMax = v;
      }
    }
  }
  closeRun(n);

  const rms = Math.sqrt(sumSq / n);
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const empty = rmsDb < emptyDbfs;
  const regions = mergeRegions(clipRuns, Math.round(mergeGapS * sr));

  const lead = edgeRun(samples, 0, 1, tolerance);
  const tail = edgeRun(samples, n - 1, -1, tolerance);
  const skip = (b) => (lead >= 2 && b <= lead) || (tail >= 2 && b >= n - tail)
    || dropouts.some((d) => b >= d.start && b <= d.end);
  const discontinuities = rateOk ? findDiscontinuities(samples, sr, disc, skip) : [];

  if (nonFinite)
    reasons.push(reason('NON_FINITE', `${nonFinite} samples are NaN or infinite.`));
  if (empty)
    reasons.push(
      reason('EMPTY', `Capture RMS ${rmsDb.toFixed(1)} dBFS is below ${emptyDbfs} dBFS.`),
    );
  if (regions.length)
    reasons.push(
      reason(
        'CLIPPING',
        `${clipped} samples (${((100 * clipped) / n).toFixed(3)} %) at the rail in ` +
          `${regions.length} region(s).`,
      ),
    );
  if (dropouts.length)
    reasons.push(reason('DROPOUT', `${dropouts.length} constant run(s) inside the capture.`));
  if (discontinuities.length) {
    const worst = Math.max(...discontinuities.map((d) => d.jump));
    reasons.push(reason('DISCONTINUITY', `${discontinuities.length} discontinuit` +
      `${discontinuities.length === 1 ? 'y' : 'ies'} (sample-to-sample steps up to ` +
      `${worst.toFixed(4)}, ≥ ${disc.ratio}× the local slope).`));
  }

  return {
    algorithms: clipAlgorithm === CAPTURE_CHECK_ALGORITHMS.clip ? CAPTURE_CHECK_ALGORITHMS
      : Object.freeze({ ...CAPTURE_CHECK_ALGORITHMS, clip: clipAlgorithm }),
    clipping: { ratio: clipped / n, regions },
    dropouts,
    discontinuities,
    rms,
    peak,
    empty,
    invalid: reasons.length > 0,
    reasons,
  };
}
