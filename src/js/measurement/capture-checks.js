// Integrity checks on one captured run before any analysis trusts it: clipping, dropouts,
// empty input, non-finite samples. Pure; a Capture is { sampleRate, samples, ... } (see
// docs/v3/architecture.md). The checks look at digital samples only: a capture that passes can
// still be acoustically wrong (wrong device, processing left on), which quality.js judges.
//
// Clipping: a sample is "at the rail" when |x| ≥ clipThreshold; a clip region is a run of at
// least clipMinRun consecutive rail samples, because hard clipping flattens the waveform over
// several samples while a lone full-scale sample is a legitimate transient. Regions closer
// than clipMergeGapS are merged into one overload event. ratio = rail samples inside regions /
// total samples.
//
// Dropouts: a run longer than dropoutMinS whose samples all stay within constantTolerance of
// each other (exact zeros, or a frozen value) that lies inside the capture, i.e. touches
// neither the first nor the last sample. Edge silence (an input that delivers zeros until it
// starts) is not a dropout here: whether the stimulus was covered is decided by alignment.
// Runs at the rail are clipping, not dropouts.
//
// Regions are half-open sample ranges [start, end).

/** |x| at or above this counts as at the rail: −0.18 dBFS, below the softened flat tops that
 *  resampling or a float-converted ADC leave just under 1.0. */
export const CLIP_THRESHOLD = 0.98;
/** Consecutive rail samples needed for clipping: a flat top, not a single transient peak. */
export const CLIP_MIN_RUN = 3;
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

/**
 * checkCapture(capture, opts) → { clipping: { ratio, regions }, dropouts, rms, peak, empty,
 *   invalid, reasons: [{ code, text }] }
 * opts: clipThreshold, clipMinRun, clipMergeGapS, dropoutMinS, constantTolerance, emptyRmsDbfs
 * (defaults: the exported constants). Reason codes: NO_SAMPLES, BAD_SAMPLE_RATE, NON_FINITE,
 * EMPTY, CLIPPING, DROPOUT. invalid ⇔ reasons is non-empty.
 */
export function checkCapture(capture, opts = {}) {
  const clipThreshold = opts.clipThreshold ?? CLIP_THRESHOLD;
  const clipMinRun = opts.clipMinRun ?? CLIP_MIN_RUN;
  const mergeGapS = opts.clipMergeGapS ?? CLIP_MERGE_GAP_S;
  const dropoutMinS = opts.dropoutMinS ?? DROPOUT_MIN_S;
  const tolerance = opts.constantTolerance ?? CONSTANT_TOLERANCE;
  const emptyDbfs = opts.emptyRmsDbfs ?? EMPTY_RMS_DBFS;

  const samples = capture && capture.samples;
  const sampleRate = capture && capture.sampleRate;
  const reasons = [];
  const n = samples ? samples.length : 0;
  if (!n) {
    reasons.push(reason('NO_SAMPLES', 'The capture contains no samples.'));
    return {
      clipping: { ratio: 0, regions: [] },
      dropouts: [],
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
  const clipRuns = [];
  let clipped = 0;
  let railStart = -1;
  const closeRail = (end) => {
    if (railStart >= 0 && end - railStart >= clipMinRun) {
      clipRuns.push({ start: railStart, end });
      clipped += end - railStart;
    }
    railStart = -1;
  };

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
      closeRail(i);
      continue;
    }
    const a = Math.abs(v);
    sumSq += v * v;
    if (a > peak) peak = a;
    if (a >= clipThreshold) {
      if (railStart < 0) railStart = i;
    } else closeRail(i);
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
  closeRail(n);
  closeRun(n);

  const rms = Math.sqrt(sumSq / n);
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const empty = rmsDb < emptyDbfs;
  const regions = mergeRegions(clipRuns, Math.round(mergeGapS * sr));

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

  return {
    clipping: { ratio: clipped / n, regions },
    dropouts,
    rms,
    peak,
    empty,
    invalid: reasons.length > 0,
    reasons,
  };
}
