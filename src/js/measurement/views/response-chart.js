// Frequency-response chart view model (spec §33-§36, §120, §150, §156-§158, §223). Pure.
//
//   buildResponseView(source, options) -> ResponseView
//     source   an engine result (engine.js measure(): transfer, aggregate, calibrated, quality,
//              recipe) or an Experiment (experiments/schema.js: results.transfer or
//              results.aggregate, quality, calibration)
//     options  { smoothing = 0 (none) | 24 | 12 | 6 | 3 (1/N octave, smoothing.js),
//                normalization = null | { mode: 'at-frequency', hz }
//                                | { mode: 'band-mean', lo, hi },
//                useCalibration = true, showEnvelope = true,
//                profile = null      the FrequencyProfile for an Experiment (it stores only the
//                                    profile's { id, name }); applied only when the ids match
//                levelCalibration = null  only to say that it does not apply to a ratio }
//
//   ResponseView = { x: Float64Array (Hz), axes: { x, y }, series: [SeriesDescriptor],
//     bands: [{ id, upper, lower, role, alpha, label }], markers: { requestedRange,
//     calibratedRange, reliableRanges, unreliableRanges }, badges: [text], notes: [text],
//     primary, reliability: { source, label }, authoritative, quality, summary,
//     readout(index) -> CursorReadout, readoutAt(hz) -> CursorReadout }
//   SeriesDescriptor = { id, label, kind (QUANTITY_KINDS), role (MEASUREMENT_ROLES key), values:
//     (number|null)[] aligned to x (null = gap), width, dash, alpha, show, reliable: bool|null,
//     derivation: null | { smoothing, normalization, algorithms } }
//
// The existing uPlot code (src/js/charts) builds options from this: x scale distr 3 / log 10
// over axes.x.range, y over axes.y.range with axes.y.ticks; one uPlot series per descriptor
// (stroke = withAlpha(theme[MEASUREMENT_ROLES[role].token], alpha), dash, width), a uPlot band
// per `bands` entry, and draw-hook rectangles for markers. Nothing in this module draws.
//
// Honesty (spec §24, §98, G19): a transfer magnitude is a RATIO (capture / stimulus, dB re a
// unity digital transfer). The y axis therefore reads TRANSFER_RATIO_UNIT, never "dB SPL",
// whatever level calibration exists. RAW is always kept; CALIBRATED appears only where the
// frequency profile covers (no extrapolation, §158); a smoothed or normalized view says so in
// every series label it touches (§34-§35). Unreliable stretches (quality mask, §156, §221) are
// separate dashed, faded series; an INVALID result is drawn as not authoritative.
//
// View options never fail a result (M6 of the V3 review): a normalization whose reference lies
// outside the measured grid (0 dB at 1 kHz for a 2-20 kHz sweep, a band without points) is not
// applied; the view says so in `normalizationNote` and in its notes, and
// normalizationAvailability() lets the UI disable such an option beforehand.
//
// Master gain (M9): every transfer magnitude includes 20·log10(master output gain) (capture.js:
// the stimulus passes the master gain stage); the view states it in its notes when the source
// records the gain (engine result preflight facts output.gain, experiment output.masterGain).
//
// Phase (m3): readouts carry the phase where the transfer has one; buildPhaseView() is the
// phase-over-frequency view (degrees, wrapped, reliability split as for the magnitude) and
// phaseUnavailableText() the reason when there is none (transfer.js PHASE_REASONS).

import {
  smoothResponse, smoothFractionalOctave, normalizeResponse,
} from '../smoothing.js';
import { formatFrequencyWithResolution } from '../format.js';
import { applyFrequencyCorrection } from '../../calibration/interpolate.js';
import { isValidLevelCalibration } from '../../calibration/level.js';
import { TRANSFER_RATIO_UNIT } from '../../experiments/csv.js';
import { PHASE_REASONS } from '../transfer.js';
import {
  QUANTITY_KINDS as K, UNAVAILABLE, LINE_STYLES, DASH, ratioDbText, gridResolutionHz,
  gridFrequencyText, rangeText, nearestIndex, toPlotArray, splitByMask, extent, dbAxisRange,
  frequencyAxis, maskOn, isDrawable, qualityStatusPresentation,
} from './common.js';

/** Y-axis title of a raw (not normalized) response. */
export const RESPONSE_Y_LABEL = 'Magnitude · dB relative';
/** Y-axis title of a normalized response. */
export const RESPONSE_Y_LABEL_NORMALIZED = 'NORMALIZED magnitude · dB re reference';
/** Shown when a valid level calibration exists: it does not turn a ratio into dB SPL. */
export const RATIO_NOT_LEVEL_NOTE = 'The response is a ratio (capture / stimulus): a level '
  + 'calibration applies to levels, not to this curve.';

const DISPERSION_WORDS = Object.freeze({
  std: '±1 standard deviation of the run levels',
  'p10-p90': '10th–90th percentile of the runs',
});

const isExperiment = (s) => !!s && s.kind === 'oscilla-experiment';

/** Why a transfer has no phase, in words (transfer.js PHASE_REASONS). */
export const PHASE_REASON_TEXT = Object.freeze({
  [PHASE_REASONS.NOT_REQUESTED]: 'phase was not requested (expert analysis setting "Phase")',
  [PHASE_REASONS.NO_ALIGNMENT]: 'no alignment of capture and stimulus was available',
  [PHASE_REASONS.ALIGNMENT_NOT_ROBUST]: 'the alignment was not robust enough for a meaningful '
    + 'phase (peak correlation below 0.5)',
  [PHASE_REASONS.AGGREGATED]: 'the aggregate of repeated runs has no phase (the phases of '
    + 'separate runs are not averaged; each run keeps its own)',
});

/** The master output gain a source records (a linear gain > 0), or null. */
export function masterGainOf(src) {
  if (!src || typeof src !== 'object') return null;
  let g = null;
  if (isExperiment(src)) g = src.output ? src.output.masterGain : null;
  else {
    const f = src.preflight && src.preflight.facts;
    g = f && f.output ? f.output.gain : null;
    if (!(g > 0) && src.testContext) g = src.testContext.chainGain;
  }
  return typeof g === 'number' && Number.isFinite(g) && g > 0 ? g : null;
}

/** "Includes the master output gain 0.08 (−21.9 dB) …" */
export function masterGainText(g) {
  const db = 20 * Math.log10(g);
  return `Every magnitude includes the master output gain ${+g.toPrecision(3)} `
    + `(${db < 0 ? '−' : '+'}${Math.abs(db).toFixed(1)} dB = 20·log10 gain) on top of the `
    + 'playback / capture path.';
}

/**
 * normalizationAvailability(frequencies, spec) → { ok, reason }
 * Whether a normalization (smoothing.js normalizeResponse spec) has a reference inside the
 * grid: 'at-frequency' needs hz within [f_first, f_last], 'band-mean' at least one point in
 * [lo, hi]. null spec (none) is always available.
 */
export function normalizationAvailability(frequencies, spec) {
  if (!spec) return { ok: true, reason: null };
  const n = frequencies ? frequencies.length : 0;
  if (!n) return { ok: false, reason: 'there is no response to normalize' };
  const lo = frequencies[0];
  const hi = frequencies[n - 1];
  const hz = (v) => (v >= 1000 ? `${+(v / 1000).toPrecision(4)} kHz` : `${+v.toPrecision(4)} Hz`);
  const span = `the response covers ${hz(lo)}–${hz(hi)}`;
  if (spec.mode === 'at-frequency') {
    return spec.hz >= lo && spec.hz <= hi ? { ok: true, reason: null }
      : { ok: false, reason: `${hz(spec.hz)} is outside the measured range (${span})` };
  }
  if (spec.mode === 'band-mean') {
    for (let i = 0; i < n; i++) {
      if (frequencies[i] >= spec.lo && frequencies[i] <= spec.hi) return { ok: true, reason: null };
    }
    return { ok: false, reason: `no measured point lies in ${hz(spec.lo)}–${hz(spec.hi)} `
      + `(${span})` };
  }
  return { ok: false, reason: 'unknown normalization' };
}

/** The pieces of a response, from an engine result or an experiment. */
export function responseSource(src, { profile = null, useCalibration = true } = {}) {
  if (!src || typeof src !== 'object') throw new TypeError('response source must be an object');
  const exp = isExperiment(src);
  const quality = src.quality || null;
  let frequencies = null;
  let rawDb = null;
  let snrDb = null;
  let validRange = null;
  let binHz = null;
  let sampleRate = null;
  let agg = null;
  let requestedRange = null;
  let phaseDeg = null;
  let phaseReason = null;
  const transfer = exp ? src.results && src.results.transfer : src.transfer;
  const aggregate = exp ? src.results && src.results.aggregate : src.aggregate;
  if (transfer) {
    frequencies = transfer.frequencies;
    rawDb = transfer.magnitudeDb;
    snrDb = transfer.snrDb || null;
    validRange = transfer.validRange || null;
    // transfer.v2 resolutionHz = max(binHz, fs / capture length): the true resolution, coarser
    // than the zero-padded bin spacing; frequencies are printed to it (§97).
    binHz = transfer.resolutionHz > 0 ? transfer.resolutionHz : transfer.binHz || null;
    sampleRate = transfer.sampleRate || null;
    requestedRange = transfer.requestedRange || null;
    phaseDeg = transfer.phaseDeg && transfer.phaseDeg.length === transfer.frequencies.length
      ? transfer.phaseDeg : null;
    phaseReason = phaseDeg ? null : transfer.phaseReason || null;
  } else if (aggregate && aggregate.frequencies) {
    frequencies = aggregate.frequencies;
    rawDb = aggregate.centreDb;
    phaseReason = PHASE_REASONS.AGGREGATED;
  }
  if (aggregate && aggregate.centreDb && frequencies
    && aggregate.centreDb.length === frequencies.length) agg = aggregate;
  if (!frequencies || !rawDb) return null;
  const metrics = quality && quality.metrics ? quality.metrics : null;
  if (!binHz && metrics && metrics.resolutionHz > 0) binHz = metrics.resolutionHz;
  if (!validRange && metrics && Array.isArray(metrics.coverage)) validRange = metrics.coverage;
  if (!requestedRange && metrics && Array.isArray(metrics.requestedRange))
    requestedRange = metrics.requestedRange;
  const stim = src.recipe && src.recipe.stimulus;
  if (!requestedRange && stim && stim.f1 > 0 && stim.f2 > stim.f1)
    requestedRange = [stim.f1, stim.f2];
  if (!sampleRate) sampleRate = exp ? src.measurement && src.measurement.sampleRate
    : src.sampleRate || null;

  // Frequency correction: the engine applied it (result.calibrated.frequency); an experiment
  // stores only { id, name }, so the caller supplies the profile and the ids must match.
  let correction = null;
  let correctionNote = null;
  if (useCalibration) {
    if (!exp && src.calibrated && src.calibrated.frequency) {
      const c = src.calibrated.frequency;
      correction = { correctedDb: c.correctedDb, covered: c.covered, coverage: c.coverage,
        name: c.name || null, algorithm: c.algorithm };
    } else if (exp && src.calibration && src.calibration.frequency) {
      const ref = src.calibration.frequency;
      if (profile && profile.id === ref.id) {
        const c = applyFrequencyCorrection(rawDb, frequencies, profile);
        correction = { correctedDb: c.correctedDb, covered: c.covered, coverage: c.coverage,
          name: ref.name || profile.name || null, algorithm: c.algorithm };
      } else {
        correctionNote = `Frequency profile "${ref.name || UNAVAILABLE.UNKNOWN}" is not loaded: `
          + `the CALIBRATED curve is ${UNAVAILABLE.UNAVAILABLE}; RAW is shown.`;
      }
    }
  }
  const levelCalibration = exp ? src.calibration && src.calibration.level : null;
  return {
    experiment: exp, frequencies, rawDb, snrDb, validRange, binHz, sampleRate,
    requestedRange, aggregate: agg, quality, correction, correctionNote, levelCalibration,
    phaseDeg, phaseReason, masterGain: masterGainOf(src),
    runs: agg && Number.isInteger(agg.runs) ? agg.runs
      : (transfer && Number.isInteger(transfer.runs) ? transfer.runs : 1),
    method: agg ? agg.method : null,
  };
}

function reliabilityMask(s) {
  const n = s.frequencies.length;
  const q = s.quality;
  if (q && q.mask && q.mask.frequencies && q.mask.frequencies.length === n) {
    const m = maskOn(q.mask.reliable, n);
    if (m) {
      return { mask: m, source: 'quality', label: `reliability from the quality assessment `
        + `(${q.algorithm || UNAVAILABLE.UNKNOWN})` };
    }
  }
  if (s.validRange) {
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const f = s.frequencies[i];
      m[i] = f >= s.validRange[0] && f <= s.validRange[1] ? 1 : 0;
    }
    return { mask: m, source: 'validRange', label: 'reliability from the valid range only '
      + `(quality ${UNAVAILABLE.NOT_ASSESSED})` };
  }
  return { mask: null, source: 'none', label: `reliability ${UNAVAILABLE.NOT_ASSESSED}: `
    + 'every point is drawn as unreliable' };
}

function series(id, label, kind, role, values, style, extra = {}) {
  return { id, label, kind, role, values, width: style.width, dash: style.dash, alpha: style.alpha,
    show: true, reliable: null, derivation: null, ...extra };
}

/**
 * The analysis grid of a log-spaced response, '1/48-octave bands' (V383: each point is the power
 * mean of its band, transfer.js, so "unsmoothed" overstated the detail; null off a log grid).
 */
function gridText(f) {
  if (!f || f.length < 2 || !(f[0] > 0) || !(f[1] > f[0])) return null;
  const ppo = Math.round(1 / Math.log2(f[1] / f[0]));
  return ppo > 0 ? `1/${ppo}-octave bands` : null;
}

/** Text of the smoothing / normalization applied to the primary curve. */
function derivationText(smoothed, normalized) {
  const parts = [];
  if (smoothed) parts.push(smoothed.label);
  if (normalized) parts.push(normalized.label);
  return parts.join(', ');
}

/**
 * buildResponseView(source, options) → ResponseView (see the header). Returns null when the
 * source has no frequency response (nothing measured: the caller shows NOT MEASURED).
 */
export function buildResponseView(source, options = {}) {
  const {
    smoothing = 0, normalization = null, useCalibration = true, showEnvelope = true,
    profile = null, levelCalibration = null,
  } = options;
  const s = responseSource(source, { profile, useCalibration });
  if (!s) return null;
  const f = s.frequencies;
  const n = f.length;
  const raw = s.rawDb;
  const corr = s.correction;
  const covered = corr ? maskOn(corr.covered, n) : null;
  const base = corr ? corr.correctedDb : raw;
  const baseKind = corr ? K.CALIBRATED : K.OBSERVED;
  const status = s.quality && s.quality.status ? s.quality.status : null;
  const authoritative = status !== 'INVALID';

  // Derived view of the primary curve: normalization offset (shift-invariant, so it commutes
  // with the power-mean smoothing), then smoothing. Both carry their algorithm IDs. A
  // normalization without a reference in the grid is not applied (M6): the view says so.
  let normalized = null;
  let normalizationNote = null;
  if (normalization) {
    const avail = normalizationAvailability(f, normalization);
    if (avail.ok) {
      try {
        normalized = normalizeResponse(f, base, normalization);
        if (!Number.isFinite(normalized.referenceDb)) {
          normalized = null;
          avail.reason = 'the response has no finite level at the reference';
        }
      } catch (e) {
        avail.reason = e.message;
      }
    }
    if (!normalized) {
      normalizationNote = `NORMALIZATION not applied: ${avail.reason}; the curve is shown `
        + 'unnormalized.';
    }
  }
  const offset = normalized ? -normalized.referenceDb : 0;
  const rel = reliabilityMask(s);
  let smoothed = null;
  if (smoothing && smoothing > 0) {
    smoothed = smoothResponse(f, base, smoothing);
    smoothed.smoothedDb = smoothWithinRegions(f, base, smoothing, covered, rel.mask);
  }
  const derived = !!(normalized || smoothed);
  const primaryValues = smoothed ? smoothed.smoothedDb : base;
  const derivation = derived ? {
    smoothing: smoothed ? { fraction: smoothed.fraction, algorithm: smoothed.algorithm,
      label: smoothed.label } : null,
    normalization: normalized ? { mode: normalized.mode, algorithm: normalized.algorithm,
      referenceDb: normalized.referenceDb, label: normalized.label } : null,
  } : null;
  const dText = derivationText(smoothed, normalized);
  const suffix = (text) => (normalized ? `${text} · ${normalized.label}` : text);

  const runs = s.runs;
  const rawName = runs > 1
    ? `RAW · OBSERVED · ${s.method || 'mean'} of ${runs} runs`
    : `RAW · OBSERVED · ${gridText(s.frequencies) || 'unsmoothed'}`;
  const calName = corr ? `CALIBRATED · profile "${corr.name || UNAVAILABLE.UNKNOWN}"` : null;

  const out = [];
  const bands = [];

  // Envelope of repeated runs, placed around the primary base curve (the spread is a dB
  // dispersion of the runs, so the correction and normalization shift it like the centre).
  if (showEnvelope && s.aggregate && s.aggregate.lowerDb && s.aggregate.upperDb) {
    const shift = (arr) => {
      const o = new Array(n);
      for (let i = 0; i < n; i++) {
        const v = arr[i];
        const d = isDrawable(base[i]) && isDrawable(raw[i]) ? base[i] - raw[i] : 0;
        o[i] = Number.isFinite(v) && isDrawable(v) ? v + d + offset : null;
      }
      return o;
    };
    const what = DISPERSION_WORDS[s.aggregate.dispersion] || 'spread of the runs';
    const label = suffix(`RUN SPREAD · ${what} (${runs} runs)`);
    out.push(series('envelope-upper', `${label} · upper`, K.OBSERVED, 'observed',
      shift(s.aggregate.upperDb), { ...LINE_STYLES.envelope }));
    out.push(series('envelope-lower', `${label} · lower`, K.OBSERVED, 'observed',
      shift(s.aggregate.lowerDb), { ...LINE_STYLES.envelope }));
    bands.push({ id: 'envelope', upper: 'envelope-upper', lower: 'envelope-lower',
      role: 'observed', alpha: LINE_STYLES.envelope.alpha, label });
  }

  // RAW is always available. It is the primary curve only when nothing is derived from it.
  const rawIsPrimary = !corr && !derived;
  if (!rawIsPrimary) {
    out.push(series('raw', suffix(rawName), K.OBSERVED, 'observed',
      toPlotArray(raw, null, offset), { ...LINE_STYLES.context }));
  }
  // CALIBRATED context curve (unsmoothed) when the primary is a derived view of it.
  if (corr && derived) {
    out.push(series('corrected', suffix(calName), K.CALIBRATED, 'calibrated',
      toPlotArray(corr.correctedDb, (i) => covered[i] === 1, offset), { ...LINE_STYLES.context }));
  }

  // Primary curve, split at the reliability mask; a calibrated primary is drawn only where
  // the profile covers (gaps elsewhere: RAW is visible there, labelled uncalibrated).
  const include = corr ? (i) => covered[i] === 1 : null;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = include && !include(i) ? NaN : primaryValues[i];
  const split = splitByMask(values, rel.mask, offset);
  let primaryLabel;
  if (derived) {
    primaryLabel = `${dText} · ${corr ? calName : 'OBSERVED'}`;
  } else {
    primaryLabel = corr ? calName : rawName;
  }
  const primaryKind = normalized ? K.NORMALIZED : (smoothed ? K.SMOOTHED : baseKind);
  const role = corr ? 'calibrated' : 'observed';
  const primaryId = derived ? 'view' : (corr ? 'corrected' : 'raw');
  // V383: both derivations named in the summary and the readout, not NORMALIZED alone
  const kindText = smoothed && normalized ? `${K.SMOOTHED} + ${K.NORMALIZED}` : primaryKind;
  out.push(series(primaryId, primaryLabel, primaryKind, role, split.reliable,
    { ...LINE_STYLES.primary }, { reliable: true, derivation, kindText }));
  out.push(series(`${primaryId}-unreliable`, `${primaryLabel} · UNRELIABLE (dashed)`,
    primaryKind, role, split.unreliable, { ...LINE_STYLES.unreliable },
    { reliable: false, derivation }));
  if (!authoritative) {
    for (const d of out) d.alpha = Math.min(d.alpha, LINE_STYLES.unreliable.alpha);
  }

  // Axes.
  const lo = s.requestedRange ? Math.min(s.requestedRange[0], f[0]) : f[0];
  const hi = s.requestedRange ? Math.max(s.requestedRange[1], f[n - 1]) : f[n - 1];
  const y = dbAxisRange(extent(out.map((d) => d.values)));
  const axes = {
    x: frequencyAxis(lo, hi),
    y: { label: normalized ? RESPONSE_Y_LABEL_NORMALIZED : RESPONSE_Y_LABEL,
      unit: normalized ? 'dB re reference (normalized)' : TRANSFER_RATIO_UNIT,
      range: y.range, ticks: y.ticks, kind: normalized ? K.NORMALIZED : baseKind },
  };

  // Markers (§157-§158).
  const metrics = s.quality && s.quality.metrics ? s.quality.metrics : null;
  const reliableRanges = metrics ? metrics.reliableRanges || [] : maskRangesOf(f, rel.mask, 1);
  const unreliableRanges = metrics ? metrics.unreliableRanges || []
    : maskRangesOf(f, rel.mask, 0);
  // The profile's own coverage, limited to the measured span (the grid points inside it are
  // the covered ones; no point outside it is corrected).
  const calibratedRange = corr ? calibratedSpan(f, covered, corr.coverage) : null;
  const markers = {
    requestedRange: s.requestedRange ? { range: [...s.requestedRange], kind: K.REQUESTED,
      label: `REQUESTED ${rangeText(f, s.requestedRange[0], s.requestedRange[1], s.binHz)}` }
      : null,
    calibratedRange: calibratedRange ? { range: calibratedRange, kind: K.CALIBRATED,
      label: calibrationCoverageText(f, calibratedRange, s), role: 'calibrated',
      dash: LINE_STYLES.marker.dash } : null,
    reliableRanges: reliableRanges.map((r) => [r[0], r[1]]),
    unreliableRanges: unreliableRanges.map((r) => [r[0], r[1]]),
  };

  // Badges and notes: always say what the curve is.
  const badges = [corr ? 'CALIBRATED (frequency)' : UNAVAILABLE.UNCALIBRATED];
  if (smoothed) badges.push(smoothed.label.split(':')[0]);
  if (normalized) badges.push('NORMALIZED');
  if (!authoritative) badges.push('INVALID · not authoritative');
  if (normalizationNote) badges.push('NORMALIZATION NOT APPLIED');
  const notes = [];
  if (corr && calibratedRange) notes.push(markers.calibratedRange.label);
  if (s.correctionNote) notes.push(s.correctionNote);
  if (normalizationNote) notes.push(normalizationNote);
  if (dText) notes.push(`Derived view: ${dText}. RAW is kept and exported unchanged.`);
  if (s.masterGain !== null) notes.push(masterGainText(s.masterGain));
  notes.push(capitalize(rel.label) + '.');
  if (unreliableRanges.length) {
    notes.push(`Dashed, faded stretches are unreliable (low SNR, outside the valid range or `
      + `above the output-chain limit): ${unreliableRanges.slice(0, 3)
        .map((r) => rangeText(f, r[0], r[1], s.binHz)).join(', ')}`
      + `${unreliableRanges.length > 3 ? ` (+${unreliableRanges.length - 3} more)` : ''}.`);
  }
  if (isValidLevelCalibration(levelCalibration) || isValidLevelCalibration(s.levelCalibration))
    notes.push(RATIO_NOT_LEVEL_NOTE);

  const view = {
    x: Float64Array.from(f),
    axes,
    series: out,
    bands,
    markers,
    badges,
    notes,
    primary: primaryId,
    reliability: { source: rel.source, label: rel.label },
    authoritative,
    normalizationApplied: !!normalized,
    normalizationNote,
    masterGain: s.masterGain,
    phase: { available: !!s.phaseDeg, reason: s.phaseDeg ? null : s.phaseReason,
      text: s.phaseDeg ? 'Phase available (wrapped, degrees)' : phaseUnavailableText(s) },
    quality: qualityStatusPresentation(status || 'NOT_ASSESSED'),
    summary: '',
    readout: null,
    readoutAt: null,
  };
  view.summary = responseSummary(view, s, { primaryValues, offset, include, mask: rel.mask });
  view.readout = (index) => responseReadout(view, s, index, { primaryValues, offset, include,
    covered, mask: rel.mask, derived, normalized });
  view.readoutAt = (hz) => view.readout(nearestIndex(f, hz));
  return view;
}

/**
 * Smoothing that never crosses a coverage or reliability edge (m1 of the V3 review): the curve
 * is smoothed separately inside each region — profile-covered AND reliable, profile-covered AND
 * unreliable (uncovered points hold RAW values and are never drawn as CALIBRATED) — with
 * smoothing.js's NaN-aware `mask` option, so a window never mixes a reliable point with an
 * unreliable one or a corrected value with a raw one. Each point takes the value of its own
 * region; a point in no region is NaN (not drawn).
 */
function smoothWithinRegions(f, base, fraction, covered, reliable) {
  const n = f.length;
  const regions = [];
  if (reliable) {
    for (const want of [1, 0]) {
      const m = new Uint8Array(n);
      for (let i = 0; i < n; i++) m[i] = (reliable[i] ? 1 : 0) === want && (!covered || covered[i])
        ? 1 : 0;
      regions.push(m);
    }
  } else if (covered) regions.push(Uint8Array.from(covered, (v) => (v ? 1 : 0)));
  if (!regions.length) return smoothFractionalOctave(f, base, fraction);
  const out = new Float64Array(n).fill(NaN);
  for (const m of regions) {
    if (!m.includes(1)) continue;
    const part = smoothFractionalOctave(f, base, fraction, { mask: m });
    for (let i = 0; i < n; i++) if (m[i]) out[i] = part[i];
  }
  return out;
}

function capitalize(t) {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function maskRangesOf(f, mask, want) {
  if (!mask) return want ? [] : [[f[0], f[f.length - 1]]];
  const out = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && mask[i] === want;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([f[start], f[i - 1]]);
      start = -1;
    }
  }
  return out;
}

function calibratedSpan(f, covered, coverage) {
  if (!covered.includes(1)) return null;
  const lo = Array.isArray(coverage) ? Math.max(coverage[0], f[0]) : f[covered.indexOf(1)];
  const hi = Array.isArray(coverage) ? Math.min(coverage[1], f[f.length - 1])
    : f[covered.lastIndexOf(1)];
  return [lo, hi];
}

/** "calibrated 20 Hz–15 kHz, uncalibrated above 15 kHz" (spec §158). */
function calibrationCoverageText(f, [lo, hi], s) {
  const at = (hz) => formatFrequencyWithResolution(hz,
    gridResolutionHz(f, nearestIndex(f, hz), s.binHz));
  const parts = [`calibrated ${at(lo)}–${at(hi)}`];
  if (lo > f[0] * 1.000001) parts.push(`uncalibrated below ${at(lo)}`);
  if (hi < f[f.length - 1] * 0.999999) parts.push(`uncalibrated above ${at(hi)}`);
  return `${parts.join(', ')} (no extrapolation)`;
}

/**
 * Textual summary (spec §150): extremes of the primary curve over its reliable points (all
 * points when nothing is reliable, said so), and the quality status. Never lists points.
 */
function responseSummary(view, s, { primaryValues, offset, include, mask }) {
  const f = s.frequencies;
  let lo = -1;
  let hi = -1;
  let anyReliable = false;
  for (let pass = 0; pass < 2 && lo < 0; pass++) {
    for (let i = 0; i < f.length; i++) {
      if (include && !include(i)) continue;
      if (pass === 0 && !(mask && mask[i])) continue;
      const v = primaryValues[i];
      if (!isDrawable(v)) continue;
      if (pass === 0) anyReliable = true;
      if (lo < 0 || v < primaryValues[lo]) lo = i;
      if (hi < 0 || v > primaryValues[hi]) hi = i;
    }
  }
  const status = view.quality.word;
  const what = view.series.find((d) => d.id === view.primary);
  const kindText = (what.kindText || what.kind).toLowerCase();
  const head = `Frequency response (${kindText}${view.badges.includes(
    UNAVAILABLE.UNCALIBRATED) ? ', uncalibrated' : ''})`;
  if (lo < 0) return `${head}: no measured points; measurement quality: ${status}.`;
  const v = (i) => ratioDbText(primaryValues[i] + offset);
  const where = anyReliable ? '' : ' (no reliable range: over all points)';
  return `${head}: maximum ${v(hi)} at ${gridFrequencyText(f, hi, s.binHz)}, minimum ${v(lo)} `
    + `at ${gridFrequencyText(f, lo, s.binHz)}${where}, measurement quality: ${status}.`;
}

/**
 * CursorReadout = { index, frequency: { hz, text, resolutionHz }, raw: text, corrected: text,
 *   view: text|null, reliability: 'reliable'|'unreliable'|'NOT ASSESSED', snr: text,
 *   spread: text|null, calibrated: bool, lines: [text] }
 * Frequency at the local resolution (§69, §97); RAW and CALIBRATED both (§36); SNR or
 * NOT MEASURED; derived value labelled.
 */
function responseReadout(view, s, index, ctx) {
  const f = s.frequencies;
  if (!(index >= 0 && index < f.length)) return null;
  const i = index;
  const resolutionHz = gridResolutionHz(f, i, s.binHz);
  const freqText = formatFrequencyWithResolution(f[i], resolutionHz);
  const raw = ratioDbText(s.rawDb[i] + ctx.offset);
  let corrected = UNAVAILABLE.UNCALIBRATED;
  let calibrated = false;
  if (s.correction) {
    calibrated = ctx.covered[i] === 1;
    corrected = calibrated ? ratioDbText(s.correction.correctedDb[i] + ctx.offset)
      : 'not covered by the profile (uncalibrated)';
  } else if (s.correctionNote) corrected = UNAVAILABLE.UNAVAILABLE;
  const viewText = ctx.derived && (!ctx.include || ctx.include(i))
    ? ratioDbText(ctx.primaryValues[i] + ctx.offset) : null;
  const reliability = ctx.mask ? (ctx.mask[i] ? 'reliable' : 'unreliable')
    : UNAVAILABLE.NOT_ASSESSED;
  const snr = s.snrDb && Number.isFinite(s.snrDb[i])
    ? ratioDbText(s.snrDb[i], { decimals: 0, sign: false }) : UNAVAILABLE.NOT_MEASURED;
  const phase = s.phaseDeg && Number.isFinite(s.phaseDeg[i]) ? phaseText(s.phaseDeg[i]) : null;
  let spread = null;
  const a = s.aggregate;
  if (a && a.spreadDb && Number.isFinite(a.spreadDb[i]))
    spread = `±${ratioDbText(a.spreadDb[i], { sign: false })} (${a.runs} runs)`;
  const lines = [
    `Frequency ${freqText}`,
    `RAW ${raw}`,
    `CALIBRATED ${corrected}`,
  ];
  if (viewText !== null) {
    const vs = view.series.find((d) => d.id === 'view');
    lines.push(`${vs.kindText || vs.kind} ${viewText}`);
  }
  lines.push(`SNR ${snr}`);
  if (phase) lines.push(`Phase ${phase}`);
  if (spread) lines.push(`Run spread ${spread}`);
  lines.push(`Reliability ${reliability}`);
  if (ctx.normalized) lines.push(ctx.normalized.label);
  return {
    index: i,
    frequency: { hz: f[i], text: freqText, resolutionHz },
    raw,
    corrected,
    view: viewText,
    reliability,
    snr,
    phase,
    spread,
    calibrated,
    lines,
    text: lines.join(' · ') || DASH,
  };
}

function phaseText(deg) {
  return `${deg < 0 ? '−' : deg > 0 ? '+' : ''}${Math.abs(deg).toFixed(1)}°`;
}

/** "Phase NOT MEASURED: <reason>." for a source (responseSource) or a transfer without phase. */
export function phaseUnavailableText(s) {
  const reason = s && s.phaseReason ? PHASE_REASON_TEXT[s.phaseReason] || s.phaseReason : null;
  return `Phase ${UNAVAILABLE.NOT_MEASURED}${reason ? `: ${reason}` : ''}.`;
}

/** Y axis of the phase view: wrapped degrees. */
export const PHASE_Y_LABEL = 'Phase · degrees (wrapped, delay of the alignment removed)';

/**
 * buildPhaseView(source, options) → PhaseView | null
 * The phase of the transfer over frequency (expert view, m3): x as in buildResponseView, y in
 * degrees over [−180, 180], the curve split at the same reliability mask (unreliable stretches
 * dashed and faded). null when the source has no response; a view with `available: false`, no
 * series and `reason` (phaseUnavailableText) when the transfer has no phase. Nothing is
 * smoothed, unwrapped or normalized.
 */
export function buildPhaseView(source) {
  const s = responseSource(source, { useCalibration: false });
  if (!s) return null;
  const f = s.frequencies;
  const n = f.length;
  const lo = s.requestedRange ? Math.min(s.requestedRange[0], f[0]) : f[0];
  const hi = s.requestedRange ? Math.max(s.requestedRange[1], f[n - 1]) : f[n - 1];
  const axes = {
    x: frequencyAxis(lo, hi),
    y: { label: PHASE_Y_LABEL, unit: 'degrees', range: [-180, 180],
      ticks: [-180, -90, 0, 90, 180], kind: K.OBSERVED },
  };
  const status = s.quality && s.quality.status ? s.quality.status : null;
  if (!s.phaseDeg) {
    const reason = phaseUnavailableText(s);
    return { x: Float64Array.from(f), axes, series: [], bands: [], markers: null,
      badges: ['PHASE NOT MEASURED'], notes: [reason], available: false, reason,
      quality: qualityStatusPresentation(status || 'NOT_ASSESSED'),
      summary: `${reason}`, readout: () => null, readoutAt: () => null };
  }
  const rel = reliabilityMask(s);
  const split = splitByMask(s.phaseDeg, rel.mask, 0);
  const authoritative = status !== 'INVALID';
  const label = 'OBSERVED phase · wrapped (−180°, 180°]';
  const series = [
    { id: 'phase', label, kind: K.OBSERVED, role: 'observed', values: split.reliable,
      width: LINE_STYLES.primary.width, dash: LINE_STYLES.primary.dash,
      alpha: authoritative ? LINE_STYLES.primary.alpha : LINE_STYLES.unreliable.alpha,
      show: true, reliable: true, derivation: null },
    { id: 'phase-unreliable', label: `${label} · UNRELIABLE (dashed)`, kind: K.OBSERVED,
      role: 'observed', values: split.unreliable, width: LINE_STYLES.unreliable.width,
      dash: LINE_STYLES.unreliable.dash, alpha: LINE_STYLES.unreliable.alpha, show: true,
      reliable: false, derivation: null },
  ];
  const view = {
    x: Float64Array.from(f), axes, series, bands: [],
    markers: { requestedRange: null, calibratedRange: null, reliableRanges: [],
      unreliableRanges: [] },
    badges: ['PHASE', 'WRAPPED'], notes: [capitalize(rel.label) + '.'], available: true,
    reason: null, quality: qualityStatusPresentation(status || 'NOT_ASSESSED'), summary: '',
    readout: null, readoutAt: null,
  };
  let count = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(s.phaseDeg[i])) count++;
  view.summary = `Phase response (observed, wrapped to ±180°): ${count} points from `
    + `${gridFrequencyText(f, 0, s.binHz)} to ${gridFrequencyText(f, n - 1, s.binHz)}; `
    + `measurement quality: ${view.quality.word}.`;
  view.readout = (index) => {
    if (!(index >= 0 && index < n)) return null;
    const res = gridResolutionHz(f, index, s.binHz);
    const lines = [`Frequency ${formatFrequencyWithResolution(f[index], res)}`,
      `Phase ${Number.isFinite(s.phaseDeg[index]) ? phaseText(s.phaseDeg[index]) : DASH}`,
      `Reliability ${rel.mask ? (rel.mask[index] ? 'reliable' : 'unreliable')
        : UNAVAILABLE.NOT_ASSESSED}`];
    return { index, lines, text: lines.join(' · ') };
  };
  view.readoutAt = (hz) => view.readout(nearestIndex(f, hz));
  return view;
}
