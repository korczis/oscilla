// MeasurementEngine: DOM-free orchestration of one acoustic measurement around the explicit
// state machine (spec §13, §29-§31, §110-§112, §166-§173, §206, §216-§219; ADR 0018).
//
//   recipe ─► preflight ─► [noise check] ─► N × (pre-roll, sweep, tail) ─► offline analysis
//             (facts →      (stimulus-free   one capture per run, never     align → transfer
//             warnings /    capture: level,  overlapping, gaps between     and IR from the SAME
//             blockers)     spectrum, SNR)   runs on the audio clock)      rendered stimulus →
//                                                                          aggregate → calibration
//                                                                          → assess (optional,
//                                                                            assessMeasurement)
//
// The engine never touches Web Audio, the DOM or Alpine. Everything platform-specific is behind
// an injected `io` adapter (capture.js implements it for the browser; the unit tests use a fake):
//
//   io = {
//     sampleRate,                     the running context's rate (null before it exists)
//     now(),                          the AUDIO clock in seconds (AudioContext.currentTime)
//     preflight() → PreflightFacts,   opens/validates the context, permission, input, worklet
//     captureNoise(seconds, { notBefore, onScheduled, onChunk }) → Capture
//     runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled, onChunk }) → Capture
//     cancel(reason),                 stop everything in flight and release session resources
//                                     (input stream, nodes); idempotent; io stays usable
//     dispose(),                      permanent release
//     yield?(),                       optional: return to the event loop between analysis steps
//     onInterrupt                     optional property the engine sets: the io calls it with
//                                     { code, reason } when the platform interrupts (page hide,
//                                     Escape, device unplugged, context closed)
//   }
//   PreflightFacts = { audioContext: { available, state }, sampleRate, permission:
//     'granted'|'denied'|'prompt'|'unknown'|'not-required', input: { ok, device, constraints,
//     error? }, inputLevel: { peak, rmsDb }|null, output: { gain, maxGain, audibleVoices },
//     worklet: { supported, mode, error? }, testContext?, chainNotes? }
//   chainNotes (optional): pure data about the playback chain that the platform layer has
//     MEASURED or knows from a measured probe, e.g. { limiterDeviationAboveHz: 18000 } when the
//     master limiter of this browser is not transparent above 18 kHz (the spike's Firefox 155
//     reading, docs/v3/spike-audioworklet-worker.md G12, later traced to the look-ahead replay
//     that audio-engine.js feedLimiter removes). The engine never sniffs the browser: it
//     validates the note (quality.js normalizeChainNotes), warns in preflight when the sweep
//     reaches above it, records it as result.chainNotes and passes it to `assess` (context
//     `chainNotes`); assessMeasurement() hands it to assessQuality, which marks the bins above
//     it unreliable.
//   Capture: docs/v3/architecture.md, plus optional stimulusStartAt (audio time),
//     integrity: { expectedFrames, receivedFrames, discontinuities } and testContext.
//
// Timing (§110, §217): no timer drives a phase or a progress value. The io reports when it
// scheduled a capture (absolute audio-clock times) and calls onChunk whenever captured PCM
// arrives (the audio thread's own cadence); the engine then reads io.now() and places it on the
// planned timeline (pre-roll, sweep, tail, gap, analysis). progress() computes the same value on
// demand for a UI frame loop. Overall progress is monotonic; the analysis share of the bar is a
// fixed display weight (ANALYSIS_PROGRESS_WEIGHT), because offline DSP has no audio clock.
//
// Repeats (§219): run k+1 is never scheduled before run k's capture has returned; it is given
// notBefore = end of run k's capture + gapS, so the io starts it on the audio clock after the
// gap. The engine verifies the returned times and fails with an internal error on overlap.
//
// Abort (§111, §218): abort(reason) from any active state → ABORTED, io.cancel(), the pending
// io promise is raced so measure() rejects at once, raw references are dropped and no further
// event is emitted for that measurement. Analysis steps are separated by io.yield() so an abort
// can land between them.
//
// Memory (§87-§89, §172-§173): captures are bounded by the contract limits (sweep ≤ 30 s,
// repeats ≤ 10, capture ≤ 40 s per run) and by limits.maxRawBytes for all runs together. The
// analysis working set is bounded too (gap M10): validateRecipe estimates it from the FFT size
// N = nextPow2(stimulus + capture frames) and the runs (analysis-task.js
// estimateAnalysisMemory) and rejects with MEMORY_LIMIT when N > limits.maxAnalysisFftSize or
// the estimate > limits.maxAnalysisBytes; preflight warns (ANALYSIS_MEMORY) above
// PREFLIGHT_THRESHOLDS.analysisMemoryWarnBytes. Raw PCM of a run is released as soon as its
// analysis no longer needs it (with the Worker it is transferred to the Worker and gone from
// this thread); the result carries raw buffers only with measure(..., { keepRaw: true }) (the
// explicit SAVE RAW choice).
//
// Analysis thread: the injected `analyze`, default defaultAnalyze() of analysis-runner.js (a
// data: URL Worker of the page's analysis library script in the built page, analyzeInline under
// node and in bundles without that script). An abort terminates the Worker (hooks.signal).
//
// Results are relative digital quantities: the transfer magnitude is dB re a unity digital
// transfer (capture/stimulus), noise levels are dB re digital full scale (20·log10 rms, so a
// full-scale sine reads −3.01 dB). dB SPL appears only through a valid LevelCalibration
// (calibration/level.js); a frequency profile corrects the magnitude into a separate CALIBRATED
// curve, the raw one is kept (§24, §159).
//
// result.calibrated is the record of what this run applied, fixed when it completes (ADR 0040,
// resolution 2026-10-05): `frequency` names the profile by profileId (its SHA-256) and name, and
// `level.calibration` is a frozen copy of the LevelCalibration that was applied, or null. An
// experiment takes its calibration from here, never from what the workspace has loaded at Save.

import {
  MEASUREMENT_STATES as S,
  createMeasurementMachine,
  isActiveState,
} from './state-machine.js';
import { normalizeStimulus, renderStimulus, StimulusError } from './stimulus.js';
import { checkCapture, CLIP_THRESHOLD } from './capture-checks.js';
import { aggregateResult, transferFromAggregate } from './aggregate.js';
import { analysisMessage, estimateAnalysisMemory } from './analysis-task.js';
import { defaultAnalyze } from './analysis-runner.js';
import { assessQuality, normalizeChainNotes } from './quality.js';
import { ALGORITHMS } from './algorithms.js';
import { toneToMeanSquare, welch } from './spectrum.js';
import { bandCenters, integrateBands } from './rta.js';
import { normalizePoints } from '../calibration/profile.js';
import { applyFrequencyCorrection } from '../calibration/interpolate.js';
import { isValidLevelCalibration, levelLabel, toDisplayLevel } from '../calibration/level.js';

/** Where the input gain is: the page cannot change it (§238 recovery must be actionable). */
const INPUT_GAIN_WHERE = 'the input gain (in the operating system\'s sound settings or on the '
  + 'audio interface; OSCILLA has no input gain control)';

// ------------------------------------------------------------------------------- constants

/** Typed error codes (spec §112). `text` is the user-facing explanation. */
export const MEASUREMENT_ERRORS = Object.freeze({
  MIC_DENIED: 'Microphone permission was denied. Allow it in the browser’s site settings.',
  MIC_DISCONNECTED: 'The input device was disconnected or stopped during the measurement.',
  CONTEXT_SUSPENDED: 'Audio is suspended. Start the measurement with a click or key press.',
  NO_INPUT: 'No usable input signal: no device, a muted input, or digital silence.',
  CAPTURE_TIMEOUT: 'The capture did not complete in time (audio thread stalled or throttled).',
  ANALYSIS_FAILURE: 'The offline analysis of the captured audio failed.',
  INVALID_CALIBRATION: 'The calibration data is invalid and was not applied.',
  MEMORY_LIMIT: 'The requested captures exceed the memory limit. Shorten or reduce repeats.',
  UNSUPPORTED_WORKLET: 'This browser can capture neither with AudioWorklet nor ScriptProcessor.',
  STORAGE_FAILURE: 'Saving failed (storage unavailable or full).',
  INVALID_RECIPE: 'The measurement settings are invalid.',
  UNSUPPORTED: 'The Web Audio API is not available in this browser.',
  BUSY: 'A measurement is already in progress.',
  ABORTED: 'The measurement was stopped.',
  INTERNAL: 'Internal measurement error.',
});

/** Hard caps of the contract (docs/v3/architecture.md "Limits", spec §172, §174). */
export const CONTRACT_LIMITS = Object.freeze({
  maxSweepS: 30,
  maxRepeats: 10,
  maxCaptureS: 40,
  maxNoiseS: 10,
  // All raw captures of one measurement together (Float32 mono). 10 runs of 32 s at 96 kHz
  // need 123 MB; the cap stops a 192 kHz recipe from asking for a quarter gigabyte.
  maxRawBytes: 128 * 1024 * 1024,
  // Analysis working set (gap M10, analysis-task.js ANALYSIS_MEMORY_MODEL). 2^22 points admit
  // every recipe at 44.1/48 kHz (30 s sweep + 10 s of pre/post-roll: 3.36 Mi frames), about
  // 20 s sweeps at 96 kHz and 9 s at 192 kHz with the default timing; a 2^23-point analysis
  // peaked at 0.96-1.1 GB. The byte budget bounds the estimate (10 runs of the largest 48 kHz
  // recipe: about 0.8 GiB).
  maxAnalysisFftSize: 2 ** 22,
  maxAnalysisBytes: 1024 * 1024 * 1024,
});

/** Default capture window and pacing (spec §216, §219, §31). */
export const DEFAULT_TIMING = Object.freeze({
  preRollS: 0.5,
  postRollS: 1.5,
  gapS: 0.5,
  noiseCheckS: 1,
});

/** Bounds of the timing parameters (seconds). */
export const TIMING_LIMITS = Object.freeze({
  preRollS: Object.freeze([0.05, 5]),
  postRollS: Object.freeze([0.1, 10]),
  gapS: Object.freeze([0, 10]),
  noiseCheckS: Object.freeze([0.25, 10]), // or exactly 0 = skip the noise check
});

/**
 * Conservative digital stimulus levels (spec §152, §208): the peak of the rendered stimulus
 * before the engine's master gain, never a sound pressure.
 */
export const MEASUREMENT_LEVELS = Object.freeze({ low: 0.125, medium: 0.25, high: 0.5 });
export const DEFAULT_LEVEL = MEASUREMENT_LEVELS.medium;

/** Preflight thresholds. */
export const PREFLIGHT_THRESHOLDS = Object.freeze({
  // Effective digital output peak (stimulus level × master gain) above which headphone users are
  // warned (§153): −18 dBFS.
  highOutputPeak: 0.125,
  // Largest effective output peak at which the master limiter was measured transparent in every
  // target browser (−20 dBFS; spec §207, gap G12, docs/v3/spike-audioworklet-worker.md):
  // Firefox's DynamicsCompressor compresses ≥ 8 kHz by up to 4.7 dB at a 0.25 peak.
  limiterTransparentPeak: 0.1,
  // Background RMS above this (dB re full scale) makes a low-SNR measurement likely (§30).
  noisyRmsDb: -40,
  // Estimated analysis working set above which preflight warns (ANALYSIS_MEMORY): a 30 s sweep
  // at 48 kHz (2^22 points, about 0.73 GiB estimated) warns, a 10 s sweep (2^21) does not.
  analysisMemoryWarnBytes: 512 * 1024 * 1024,
  clipPeak: CLIP_THRESHOLD,
});

/** Share of the overall progress bar given to the offline analysis (display weight only). */
export const ANALYSIS_PROGRESS_WEIGHT = 0.1;

export const INPUT_PROCESSING_NOTE = 'Input processing may have been applied by browser/device.';

/**
 * Run-check codes that invalidate a run before any analysis (review M8): the capture holds no
 * usable samples (NO_SAMPLES, BAD_SAMPLE_RATE, NON_FINITE, EMPTY / NO_INPUT), lost frames
 * (FRAMES_MISSING), or a dropout certainly inside the sweep (DROPOUT_IN_SWEEP, see
 * runChecks). CLIPPING, DISCONTINUITY and other dropouts do NOT: quality.js grades them
 * (CLIPPING ok/warn/fail, CLIPPING_SEVERE and the in-sweep dropout/discontinuity rules
 * invalidate there, against the aligned sweep window).
 */
export const RUN_INVALIDATING_CODES = Object.freeze(['NO_SAMPLES', 'BAD_SAMPLE_RATE',
  'NON_FINITE', 'EMPTY', 'NO_INPUT', 'FRAMES_MISSING', 'DROPOUT_IN_SWEEP']);
/** Noise-check codes that make the noise capture unusable (INVALID, NOISE_CAPTURE_INVALID). An
 *  EMPTY noise check is not among them: the SNR is then NOT MEASURED (quality.js v3). */
export const NOISE_INVALIDATING_CODES = Object.freeze(['NO_SAMPLES', 'BAD_SAMPLE_RATE',
  'NON_FINITE']);

// ------------------------------------------------------------------------------- errors

export class MeasurementError extends Error {
  constructor(code, message, { cause = null, detail = null } = {}) {
    const known = Object.prototype.hasOwnProperty.call(MEASUREMENT_ERRORS, code);
    super(message || (known ? MEASUREMENT_ERRORS[code] : MEASUREMENT_ERRORS.INTERNAL));
    this.name = 'MeasurementError';
    this.code = known ? code : 'INTERNAL';
    this.detail = detail;
    if (cause) this.cause = cause;
  }
}

const DOM_ERROR_CODES = Object.freeze({
  NotAllowedError: 'MIC_DENIED',
  SecurityError: 'MIC_DENIED',
  PermissionDeniedError: 'MIC_DENIED',
  NotFoundError: 'NO_INPUT',
  DevicesNotFoundError: 'NO_INPUT',
  OverconstrainedError: 'NO_INPUT',
  NotReadableError: 'NO_INPUT',
  QuotaExceededError: 'STORAGE_FAILURE',
  StimulusError: 'INVALID_RECIPE',
  CalibrationError: 'INVALID_CALIBRATION',
});

/**
 * mapError(err, fallback = 'INTERNAL') → MeasurementError
 * Keeps a MeasurementError, honours an error carrying a known `code`, maps DOMException names
 * of getUserMedia/storage and the validation errors of stimulus.js/profile.js, recognises
 * allocation failures as MEMORY_LIMIT, and uses `fallback` for anything else.
 */
export function mapError(err, fallback = 'INTERNAL') {
  if (err instanceof MeasurementError) return err;
  const name = err && err.name;
  const code = err && typeof err.code === 'string' ? err.code : null;
  const message = err && err.message ? String(err.message) : '';
  const opts = { cause: err || null };
  if (code && Object.prototype.hasOwnProperty.call(MEASUREMENT_ERRORS, code))
    return new MeasurementError(code, message || undefined, opts);
  if (err instanceof StimulusError) return new MeasurementError('INVALID_RECIPE', message, opts);
  if (name && DOM_ERROR_CODES[name]) {
    const c = DOM_ERROR_CODES[name];
    return new MeasurementError(c, c === 'MIC_DENIED' ? undefined : message || undefined, opts);
  }
  if (err instanceof RangeError && /alloc|memory|buffer size|too large/i.test(message))
    return new MeasurementError('MEMORY_LIMIT', undefined, opts);
  return new MeasurementError(fallback, message || undefined, opts);
}

// ------------------------------------------------------------------------------- recipe

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Contract limits tightened (never loosened) by the caller's `limits`. */
export function effectiveLimits(limits = {}) {
  const out = {};
  for (const [k, cap] of Object.entries(CONTRACT_LIMITS)) {
    const v = limits && limits[k];
    out[k] = isNum(v) && v > 0 ? Math.min(v, cap) : cap;
  }
  return Object.freeze(out);
}

function inRange(v, [lo, hi]) {
  return isNum(v) && v >= lo && v <= hi;
}

/**
 * validateRecipe(recipe, { sampleRate, limits }) → plan
 * recipe = { stimulus: { kind: 'log-sweep', duration, level, f1, f2, fade, sampleRate? },
 *   repeats = 1, analysis: { noiseCheckS, preRollS, postRollS, gapS, phase, aggregation } }
 * `level` may be a number in (0, 1] or 'low' | 'medium' | 'high' (MEASUREMENT_LEVELS); the
 * stimulus is rendered at `sampleRate` (the device rate). Throws MeasurementError
 * INVALID_RECIPE (detail: list of problems) or MEMORY_LIMIT (raw captures above maxRawBytes,
 * or the analysis above maxAnalysisFftSize / maxAnalysisBytes; detail carries the estimate).
 * plan = { stimulusSpec, clampedTo, requestedSampleRate, repeats, timing: { preRollS,
 *   postRollS, gapS, noiseCheckS }, phase, aggregation, captureS, captureFrames, rawBytes,
 *   analysis: { fftSize, bytes } (estimateAnalysisMemory) }
 */
export function validateRecipe(recipe, { sampleRate, limits = CONTRACT_LIMITS } = {}) {
  const problems = [];
  const fail = () => new MeasurementError('INVALID_RECIPE',
    `Invalid measurement settings: ${problems.join('; ')}`, { detail: problems.slice() });
  if (!isObj(recipe)) {
    problems.push('recipe must be an object');
    throw fail();
  }
  if (!isNum(sampleRate) || sampleRate <= 0) {
    problems.push('no device sample rate');
    throw fail();
  }
  const st = recipe.stimulus;
  if (!isObj(st)) problems.push('stimulus must be an object');
  else if (st.kind !== 'log-sweep')
    problems.push('stimulus.kind must be "log-sweep" (transfer and impulse response need it)');

  const repeats = recipe.repeats === undefined ? 1 : recipe.repeats;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > limits.maxRepeats)
    problems.push(`repeats must be an integer 1-${limits.maxRepeats}`);

  const a = recipe.analysis === undefined ? {} : recipe.analysis;
  if (!isObj(a)) problems.push('analysis must be an object');
  const pick = (k) => (isObj(a) && a[k] !== undefined ? a[k] : DEFAULT_TIMING[k]);
  const timing = {
    preRollS: pick('preRollS'),
    postRollS: pick('postRollS'),
    gapS: pick('gapS'),
    noiseCheckS: pick('noiseCheckS'),
  };
  for (const k of ['preRollS', 'postRollS', 'gapS']) {
    if (!inRange(timing[k], TIMING_LIMITS[k]))
      problems.push(`analysis.${k} must be ${TIMING_LIMITS[k][0]}-${TIMING_LIMITS[k][1]} s`);
  }
  const noiseMax = Math.min(TIMING_LIMITS.noiseCheckS[1], limits.maxNoiseS);
  if (timing.noiseCheckS !== 0 && !inRange(timing.noiseCheckS,
    [TIMING_LIMITS.noiseCheckS[0], noiseMax]))
    problems.push(`analysis.noiseCheckS must be 0 (skip) or ${TIMING_LIMITS.noiseCheckS[0]}-`
      + `${noiseMax} s`);
  const phase = isObj(a) && a.phase === true;
  const aggregation = isObj(a) && a.aggregation !== undefined ? a.aggregation : 'mean';
  if (aggregation !== 'mean' && aggregation !== 'median')
    problems.push('analysis.aggregation must be "mean" or "median"');

  let stimulusSpec = null;
  let clampedTo = null;
  if (isObj(st) && st.kind === 'log-sweep') {
    let level = st.level === undefined ? DEFAULT_LEVEL : st.level;
    if (typeof level === 'string') {
      if (Object.prototype.hasOwnProperty.call(MEASUREMENT_LEVELS, level))
        level = MEASUREMENT_LEVELS[level];
      else problems.push('stimulus.level must be low, medium, high or a number in (0, 1]');
    }
    if (isNum(st.duration) && st.duration > limits.maxSweepS)
      problems.push(`stimulus.duration must be at most ${limits.maxSweepS} s`);
    try {
      ({ spec: stimulusSpec, clampedTo } = normalizeStimulus({ ...st, level, sampleRate }));
    } catch (e) {
      problems.push(`stimulus: ${e.message}`);
    }
  }
  if (stimulusSpec && problems.length === 0) {
    const captureS = timing.preRollS + stimulusSpec.duration + timing.postRollS;
    if (captureS > limits.maxCaptureS + 1e-9)
      problems.push(`pre-roll + sweep + post-roll is ${captureS.toFixed(2)} s; the capture `
        + `limit is ${limits.maxCaptureS} s`);
  }
  if (problems.length) throw fail();

  const captureS = timing.preRollS + stimulusSpec.duration + timing.postRollS;
  const captureFrames = Math.ceil(captureS * sampleRate) + 256; // quantum rounding slack
  const noiseFrames = Math.ceil(timing.noiseCheckS * sampleRate);
  const rawBytes = 4 * (repeats * captureFrames + noiseFrames);
  if (rawBytes > limits.maxRawBytes) {
    throw new MeasurementError('MEMORY_LIMIT', `${(rawBytes / 2 ** 20).toFixed(1)} MiB of raw `
      + `capture exceeds the ${(limits.maxRawBytes / 2 ** 20).toFixed(0)} MiB limit.`,
    { detail: { rawBytes, maxRawBytes: limits.maxRawBytes } });
  }
  const stimulusFrames = Math.round(stimulusSpec.duration * sampleRate);
  const est = estimateAnalysisMemory({ stimulusFrames, captureFrames, runs: repeats,
    noiseFrames });
  const maxFft = limits.maxAnalysisFftSize ?? CONTRACT_LIMITS.maxAnalysisFftSize;
  const maxBytes = limits.maxAnalysisBytes ?? CONTRACT_LIMITS.maxAnalysisBytes;
  if (est.fftSize > maxFft || est.bytes > maxBytes) {
    // Longest sweep whose analysis fits maxFft at this rate and timing:
    // round(d·sr) + ceil((pre + d + post)·sr) + 256 ≤ maxFft.
    const fixed = (timing.preRollS + timing.postRollS) * sampleRate + 258;
    const longest = Math.max(0, Math.floor(((maxFft - fixed) / (2 * sampleRate)) * 10) / 10);
    const mib = (b) => (b / 2 ** 20).toFixed(0);
    const why = est.fftSize > maxFft
      ? `a ${est.fftSize}-point analysis (the limit is ${maxFft} points; at ${sampleRate} Hz `
        + `with this pre/post-roll the sweep can be at most ${longest.toFixed(1)} s)`
      : `about ${mib(est.bytes)} MiB of analysis memory (the limit is ${mib(maxBytes)} MiB)`;
    throw new MeasurementError('MEMORY_LIMIT', `This measurement would need ${why}. Shorten `
      + 'the sweep, reduce repeats or use a lower sample rate.',
    { detail: { fftSize: est.fftSize, analysisBytes: est.bytes, maxAnalysisFftSize: maxFft,
      maxAnalysisBytes: maxBytes, longestSweepS: longest } });
  }
  return Object.freeze({
    stimulusSpec,
    clampedTo,
    requestedSampleRate: isNum(st.sampleRate) ? st.sampleRate : null,
    repeats,
    timing: Object.freeze(timing),
    phase,
    aggregation,
    captureS,
    captureFrames,
    rawBytes,
    analysis: Object.freeze({ fftSize: est.fftSize, bytes: est.bytes }),
  });
}

/**
 * planTimeline(plan) → { items: [{ phase, run, start, end }], audioS }
 * The planned audio timeline in seconds from the first capture: noise, then per run
 * [gap], pre-roll, sweep, tail. Analysis follows the audio and has no planned duration.
 */
export function planTimeline(plan) {
  const items = [];
  let t = 0;
  const add = (phase, run, d) => {
    items.push(Object.freeze({ phase, run, start: t, end: t + d }));
    t += d;
  };
  if (plan.timing.noiseCheckS > 0) add('noise', null, plan.timing.noiseCheckS);
  for (let r = 0; r < plan.repeats; r++) {
    if (r > 0 && plan.timing.gapS > 0) add('gap', r, plan.timing.gapS);
    add('pre-roll', r, plan.timing.preRollS);
    add('sweep', r, plan.stimulusSpec.duration);
    add('tail', r, plan.timing.postRollS);
  }
  return Object.freeze({ items: Object.freeze(items), audioS: t });
}

// ------------------------------------------------------------------------------- analysis helpers

function rmsPeak(x) {
  let s = 0;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    s += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = x.length ? Math.sqrt(s / x.length) : 0;
  return { rms, peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity };
}

export const NOISE_FFT = 8192;

/**
 * summarizeNoise(capture, levelCalibration) → { durationS, rms, peak, rmsDb, level, bands,
 *   checks, raw }
 * Broadband level is 20·log10(rms) re digital full scale (dB relative, dBFS-like); with a valid
 * LevelCalibration `level` also carries dB SPL (calibration/level.js), never otherwise (§31).
 * bands: one-third-octave band levels on the same reference from a Welch spectrum (Hann, 8192,
 * 50 %), when the capture holds at least one segment; band power = Σ mean-square bin power
 * (spectrum.js toneToMeanSquare: tone-scaled power / (2·ENBW) inside, / ENBW at DC and Nyquist),
 * so the bands sum to the broadband mean square.
 */
export function summarizeNoise(capture, levelCalibration = null) {
  const x = capture.samples;
  const sr = capture.sampleRate;
  const { rms, peak, rmsDb } = rmsPeak(x);
  let bands = null;
  if (x.length >= NOISE_FFT) {
    const w = welch(x, { fftSize: NOISE_FFT, overlap: 0.5, window: 'hann' });
    const ms = toneToMeanSquare(w.power, w.window);
    const centers = bandCenters('third', 20, 20000, sr);
    const power = integrateBands(ms, sr / NOISE_FFT, centers);
    bands = {
      kind: 'third',
      nominal: centers.map((b) => b.nominal),
      levelsDb: Array.from(power, (p) => (p > 0 ? 10 * Math.log10(p) : -Infinity)),
    };
  }
  return {
    durationS: x.length / sr,
    rms,
    peak,
    rmsDb,
    level: Number.isFinite(rmsDb) ? toDisplayLevel(rmsDb, levelCalibration) : null,
    bands,
    checks: checkCapture(capture),
  };
}

/** Normalized calibration input; throws MeasurementError INVALID_CALIBRATION. */
export function validateCalibration(calibration) {
  if (calibration == null) return { frequency: null, level: null };
  if (!isObj(calibration))
    throw new MeasurementError('INVALID_CALIBRATION', 'calibration must be an object');
  const frequency = calibration.frequency || null;
  const level = calibration.level || null;
  if (frequency) {
    const ok = isObj(frequency) && frequency.kind === 'frequency'
      && Array.isArray(frequency.points) && frequency.points.length > 0;
    const checked = ok ? normalizePoints(frequency.points) : null;
    if (!ok || checked.errors.length)
      throw new MeasurementError('INVALID_CALIBRATION', 'The frequency calibration profile is '
        + 'invalid.', { detail: checked ? checked.errors : null });
  }
  if (level && !isValidLevelCalibration(level))
    throw new MeasurementError('INVALID_CALIBRATION', 'The level calibration is invalid.');
  return { frequency, level };
}

/** Applied constraints that are not confirmed off (true or unknown) mean processing may run. */
export function inputProcessingMayApply(applied) {
  if (!applied) return true;
  return ['echoCancellation', 'noiseSuppression', 'autoGainControl']
    .some((k) => applied[k] !== false);
}

/**
 * inputProcessingFacts(result) → the quality.js `inputProcessing` input of a result:
 * 'test-context' for a digital test context (no microphone path), else the first capture's
 * applied constraints { echoCancellation, noiseSuppression, autoGainControl } (each true, false
 * or null when the browser did not report it), or null when none were reported at all.
 */
export function inputProcessingFacts(result) {
  if (result && result.testContext) return 'test-context';
  const applied = result && result.input && result.input.constraints
    ? result.input.constraints.applied : null;
  if (!applied || typeof applied !== 'object') return null;
  const pick = (k) => (applied[k] === true || applied[k] === false ? applied[k] : null);
  return { echoCancellation: pick('echoCancellation'), noiseSuppression: pick('noiseSuppression'),
    autoGainControl: pick('autoGainControl') };
}

/**
 * The measurement's transfer (G20 storage rule, aggregate.js): one run → that run's
 * TransferResult; repeated runs → the aggregate centre as a storable TransferResult marked
 * derivedFrom 'aggregate' (magnitudeDb = aggregateResult().centreDb bit for bit, lowest run SNR,
 * common valid range, no phase). Each run's own transfer stays in result.runs[i].transfer.
 */
function measurementTransfer(transfers, aggregate) {
  if (transfers.length === 1) return transfers[0];
  return transferFromAggregate(aggregateResult(aggregate, transfers[0].frequencies), transfers);
}

/**
 * assessMeasurement(result, { calibration, chainNotes, algorithm }) → QualityAssessment
 * The standard `assess` for createMeasurementEngine / measure(): quality.js assessQuality over a
 * COMPLETE result — every run's capture checks, the combined transfer, the aggregate, the
 * applied frequency calibration (result.calibrated.frequency, on the transfer grid) and the
 * level calibration from the context, each run's sweep window [round(lag), round(lag) + frames)
 * from its alignment, and the output-chain note (context chainNotes, else result.chainNotes).
 * For the v3 rules also the noise check (result.noise.checks; an EMPTY one makes the SNR NOT
 * MEASURED), the input processing (context inputProcessing, else inputProcessingFacts(result))
 * and the stimulus spec (to name the sweep frequency of clipped regions); v1/v2 ignore them.
 * `algorithm` selects the quality rule set (default quality.js QUALITY_ALGORITHM).
 */
export function assessMeasurement(result, ctx = {}) {
  const frames = result.stimulus && result.stimulus.frames;
  const sweepWindow = (result.runs || []).map((r) => {
    const lag = r.alignment ? r.alignment.lagSamples : null;
    return Number.isFinite(lag) && Number.isFinite(frames)
      ? [Math.round(lag), Math.round(lag) + frames] : null;
  });
  const level = ctx.calibration && ctx.calibration.level ? ctx.calibration.level : null;
  const opts = {
    capture: result.captureChecks,
    transfer: result.transfer,
    aggregate: result.aggregate,
    calibration: { frequency: result.calibrated ? result.calibrated.frequency : null, level },
    sweepWindow: sweepWindow.length ? sweepWindow : null,
    chainNotes: ctx.chainNotes !== undefined ? ctx.chainNotes : result.chainNotes ?? null,
    noiseCheck: result.noise && result.noise.checks ? result.noise.checks : null,
    inputProcessing: ctx.inputProcessing !== undefined ? ctx.inputProcessing
      : inputProcessingFacts(result),
    stimulus: result.stimulus && result.stimulus.spec ? result.stimulus.spec : null,
  };
  if (ctx.algorithm !== undefined) opts.algorithm = ctx.algorithm;
  return assessQuality(opts);
}

function irMeta(ir) {
  const { samples, ...meta } = ir;
  return { ...meta, length: samples.length };
}

function reason(code, text, extra) {
  return Object.freeze({ code, text, ...(extra || {}) });
}

const defaultMono = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() : Date.now());

function makeClock(clock) {
  if (typeof clock === 'function') return { wall: clock, mono: clock };
  return {
    wall: clock && typeof clock.wall === 'function' ? clock.wall : () => Date.now(),
    mono: clock && typeof clock.mono === 'function' ? clock.mono : defaultMono,
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------------------- engine

/**
 * createMeasurementEngine({ io, clock, onEvent, limits, assess, analyze }) → engine
 *   io        the adapter described in the header (required)
 *   clock     wall clock for timestamps and step timing: a function returning ms, or
 *             { wall(): ms since epoch, mono(): monotonic ms } (defaults: Date.now,
 *             performance.now). Never used for audio timing.
 *   onEvent   (event) => void; events: { type: 'state', from, to, info } | 'preflight' |
 *             'scheduled' | 'progress' | 'noise' | 'run' | 'analysis' | 'result' | 'error'
 *   limits    tightens CONTRACT_LIMITS (maxSweepS, maxRepeats, maxCaptureS, maxNoiseS,
 *             maxRawBytes, maxAnalysisFftSize, maxAnalysisBytes)
 *   assess    optional (result, { recipe, plan, calibration, chainNotes, inputProcessing }) →
 *             QualityAssessment (quality.js); assessMeasurement is the standard one.
 *             inputProcessing is inputProcessingFacts(result) (the applied constraints)
 *   analyze   optional (message, { now, yield, onStep, keepRaw, signal }) →
 *             Promise<AnalysisResult>: the offline analysis (analysis-task.js). Default
 *             defaultAnalyze() (analysis-runner.js): the data: URL Worker when the page ran the
 *             analysis library script, else analyzeInline (this thread, yields between steps).
 *             `signal` is an
 *             AbortSignal aborted when the measurement is aborted or fails
 *
 * engine = { state, history, limits, preflight(recipe, opts), measure(recipe, opts),
 *   abort(reason), progress(), reset(), dispose() }
 */
export function createMeasurementEngine({ io, clock, onEvent, limits, assess, analyze } = {}) {
  if (!io || typeof io.now !== 'function' || typeof io.runStimulus !== 'function'
    || typeof io.preflight !== 'function' || typeof io.cancel !== 'function')
    throw new TypeError('createMeasurementEngine needs an io adapter (see engine.js)');
  const lim = effectiveLimits(limits);
  const clk = makeClock(clock);
  const emitFn = typeof onEvent === 'function' ? onEvent : null;
  const defaultAssess = typeof assess === 'function' ? assess : null;
  const analyzeFn = typeof analyze === 'function' ? analyze : defaultAnalyze();
  let muted = false;
  let current = null; // the session (one preflight/measure sequence)
  let prepared = null; // { key, plan, report, calibration } after a successful preflight
  let disposed = false;

  const emitRaw = (ev) => {
    if (muted || !emitFn) return;
    try { emitFn(ev); } catch (e) { /* a listener must not break the measurement */ }
  };
  const machine = createMeasurementMachine({
    onChange: (entry) => emitRaw({ type: 'state', from: entry.from, to: entry.to,
      info: entry.info }),
  });
  const emit = (s, ev) => {
    if (s !== current || s.dead) return;
    emitRaw(ev);
  };

  if ('onInterrupt' in io || Object.isExtensible(io)) {
    try {
      io.onInterrupt = (info) => {
        const code = info && info.code;
        const why = (info && info.reason) || code || 'interrupted';
        if (!current || !isActiveState(machine.state)) return;
        if (!code || code === 'ABORTED') api.abort(why);
        else fail(current, new MeasurementError(code, info.message, { detail: info }));
      };
    } catch (e) { /* frozen io: interruptions arrive as rejected promises instead */ }
  }

  function newSession() {
    const s = { id: (current ? current.id : 0) + 1, dead: false, plan: null, timeline: null,
      currentAudio: null, lastOverall: 0, analysis: null, captures: [], noiseCapture: null };
    s.abortPromise = new Promise((resolve, reject) => { s.rejectAbort = reject; });
    s.abortPromise.catch(() => {});
    s.kill = (err) => {
      s.dead = true;
      s.deadError = err;
      s.rejectAbort(err);
    };
    current = s;
    muted = false;
    return s;
  }

  function guard(s, value) {
    const p = Promise.resolve(value);
    p.catch(() => {}); // a late rejection after abort is expected and handled here
    return Promise.race([p, s.abortPromise]).then((v) => {
      if (s.dead) throw s.deadError;
      return v;
    });
  }

  function go(s, to, info) {
    if (s.dead) throw s.deadError;
    machine.go(to, info);
  }

  function releaseRaw(s) {
    s.captures = [];
    s.noiseCapture = null;
  }

  function cancelIo(why) {
    try { io.cancel(why); } catch (e) { /* cancel must not throw past cleanup */ }
  }

  function fail(s, err) {
    if (!s || s.dead || s !== current) return err;
    const e = mapError(err);
    if (machine.can(S.ERROR)) machine.go(S.ERROR, { code: e.code, message: e.message });
    emit(s, { type: 'error', code: e.code, message: e.message, detail: e.detail || null });
    s.kill(e);
    muted = true;
    cancelIo(e.code);
    releaseRaw(s);
    prepared = null;
    return e;
  }

  // ---- progress (audio clock only)
  function computeProgress(s, now) {
    if (!s || !s.timeline) return null;
    const tl = s.timeline;
    const audioS = tl.audioS || 1;
    const weightAudio = 1 - ANALYSIS_PROGRESS_WEIGHT;
    let phase = null;
    let run = null;
    let phaseFraction = 0;
    let elapsed = 0;
    if (s.analysis) {
      phase = 'analysis';
      phaseFraction = s.analysis.total ? s.analysis.done / s.analysis.total : 0;
      const overall = weightAudio + ANALYSIS_PROGRESS_WEIGHT * clamp01(phaseFraction);
      s.lastOverall = Math.max(s.lastOverall, overall);
      return { phase, run, phaseFraction: clamp01(phaseFraction), overall: s.lastOverall, now };
    }
    const c = s.currentAudio;
    if (c && c.kind === 'noise') {
      phase = 'noise';
      phaseFraction = clamp01((now - c.start) / (c.end - c.start));
      elapsed = c.base + phaseFraction * (c.end - c.start);
    } else if (c && c.kind === 'run') {
      run = c.run;
      const pre = c.ss - c.cs;
      const dur = c.se - c.ss;
      const post = c.ce - c.se;
      if (now < c.cs) {
        phase = c.run > 0 ? 'gap' : 'armed';
        phaseFraction = 0;
        elapsed = c.base;
      } else if (now < c.ss) {
        phase = 'pre-roll';
        phaseFraction = clamp01((now - c.cs) / pre);
        elapsed = c.base + (now - c.cs);
      } else if (now < c.se) {
        phase = 'sweep';
        phaseFraction = clamp01((now - c.ss) / dur);
        elapsed = c.base + pre + (now - c.ss);
      } else {
        phase = 'tail';
        phaseFraction = clamp01((now - c.se) / post);
        elapsed = c.base + pre + dur + Math.min(now - c.se, post);
      }
    } else {
      phase = machine.state === S.PREFLIGHT ? 'preflight' : 'idle';
    }
    const overall = weightAudio * clamp01(elapsed / audioS);
    s.lastOverall = Math.max(s.lastOverall, overall);
    return { phase, run, phaseFraction, overall: s.lastOverall, now };
  }

  // Called from io callbacks (captured PCM arrived) and between analysis steps; never throws
  // into the io.
  function tick(s, chunk) {
    if (s !== current || s.dead) return;
    try {
      const now = io.now();
      const c = s.currentAudio;
      if (c && c.kind === 'run' && machine.state === S.ARMED && now >= c.ss)
        go(s, S.MEASURING, { run: c.run, at: now });
      const p = computeProgress(s, now);
      if (p) emit(s, { type: 'progress', ...p, capture: chunk || null });
    } catch (e) { /* progress is feedback only */ }
  }

  const plannedBase = (s, phase, run) => {
    const item = s.timeline.items.find((it) => it.phase === phase && it.run === run);
    return item ? item.start : 0;
  };

  // ---- preflight
  // A measure() after preflight() reuses its READY state only for an equal recipe and the very
  // same calibration object (its validation result is reused).
  function recipeKey(recipe) {
    try { return JSON.stringify(recipe); } catch (e) { return null; }
  }
  const samePrepared = (recipe, calibration) => !!prepared && prepared.key !== null
    && prepared.key === recipeKey(recipe) && prepared.calibration === (calibration ?? null);

  async function runPreflight(s, recipe, calibration) {
    const warnings = [];
    const blockers = [];
    const facts = await guard(s, (async () => {
      try { return await io.preflight(); }
      catch (e) {
        if (s.dead) throw e;
        const me = mapError(e);
        if (me.code === 'ABORTED') throw me;
        return { error: me };
      }
    })());
    if (facts.error) blockers.push(reason(facts.error.code, facts.error.message));

    const ctx = facts.audioContext || {};
    if (!facts.error) {
      if (ctx.available === false)
        blockers.push(reason('UNSUPPORTED', MEASUREMENT_ERRORS.UNSUPPORTED));
      else if (ctx.state === 'suspended')
        blockers.push(reason('CONTEXT_SUSPENDED', MEASUREMENT_ERRORS.CONTEXT_SUSPENDED));
      else if (ctx.state === 'closed')
        blockers.push(reason('UNSUPPORTED', 'The audio context is closed.'));
    }
    const sampleRate = isNum(facts.sampleRate) ? facts.sampleRate : io.sampleRate;
    let plan = null;
    try {
      plan = validateRecipe(recipe, { sampleRate, limits: lim });
    } catch (e) {
      const me = mapError(e, 'INVALID_RECIPE');
      blockers.push(reason(me.code, me.message, me.detail ? { detail: me.detail } : null));
    }
    let cal = { frequency: null, level: null };
    try {
      cal = validateCalibration(calibration);
    } catch (e) {
      blockers.push(reason('INVALID_CALIBRATION', e.message));
    }
    if (plan && plan.requestedSampleRate && plan.requestedSampleRate !== sampleRate)
      warnings.push(reason('SAMPLE_RATE_DIFFERS', `The recipe asks for `
        + `${plan.requestedSampleRate} Hz; the device runs at ${sampleRate} Hz and the stimulus `
        + 'is rendered at the device rate.'));
    if (plan && plan.analysis.bytes > PREFLIGHT_THRESHOLDS.analysisMemoryWarnBytes)
      warnings.push(reason('ANALYSIS_MEMORY', `The analysis will need about `
        + `${(plan.analysis.bytes / 2 ** 20).toFixed(0)} MiB of memory (${plan.analysis.fftSize}`
        + '-point FFT); on a device with little memory shorten the sweep or reduce repeats.',
      { value: plan.analysis.bytes, unit: 'bytes', detail: { fftSize: plan.analysis.fftSize } }));
    if (plan && plan.clampedTo)
      warnings.push(reason('RANGE_CLAMPED', `The sweep is limited to ${plan.clampedTo.toFixed(0)} `
        + 'Hz (0.95 × Nyquist of the device rate).', { value: plan.clampedTo, unit: 'Hz' }));

    if (facts.permission === 'denied' && !blockers.some((b) => b.code === 'MIC_DENIED'))
      blockers.push(reason('MIC_DENIED', MEASUREMENT_ERRORS.MIC_DENIED));
    const input = facts.input || null;
    if (!facts.error && input && input.ok === false && !blockers.length) {
      const me = input.error ? mapError(input.error, 'NO_INPUT')
        : new MeasurementError('NO_INPUT');
      blockers.push(reason(me.code, me.message));
    }
    const applied = input && input.constraints ? input.constraints.applied : null;
    if (input && input.ok && !facts.testContext && inputProcessingMayApply(applied))
      warnings.push(reason('INPUT_PROCESSING', INPUT_PROCESSING_NOTE));
    const lvl = facts.inputLevel;
    if (lvl && isNum(lvl.peak) && lvl.peak >= PREFLIGHT_THRESHOLDS.clipPeak)
      warnings.push(reason('INPUT_CLIPPING', 'The input reaches full scale before the '
        + 'measurement: lower ' + INPUT_GAIN_WHERE + '.', { value: lvl.peak, unit: 'peak' }));
    if (lvl && isNum(lvl.rmsDb) && lvl.rmsDb > PREFLIGHT_THRESHOLDS.noisyRmsDb)
      warnings.push(reason('NOISE_HIGH', `Background level ${lvl.rmsDb.toFixed(1)} dB relative `
        + '(dBFS-like) is high; expect a low signal-to-noise ratio.',
      { value: lvl.rmsDb, unit: 'dB relative' }));

    let chainNotes = null;
    try {
      chainNotes = normalizeChainNotes(facts.chainNotes ?? null);
    } catch (e) {
      warnings.push(reason('CHAIN_NOTES_IGNORED', `The audio adapter reported an invalid `
        + `output-chain note (${e.message}); it was ignored.`));
    }
    const chainLimit = chainNotes ? chainNotes.limiterDeviationAboveHz : null;
    if (chainLimit !== null && plan && plan.stimulusSpec.f2 > chainLimit)
      warnings.push(reason('OUTPUT_CHAIN_DEVIATION', 'In this browser the output chain is not '
        + `flat above ${chainLimit} Hz; the response there will be marked unreliable.`,
      { value: chainLimit, unit: 'Hz' }));

    const wk = facts.worklet || null;
    if (wk && wk.supported === false)
      blockers.push(reason('UNSUPPORTED_WORKLET', MEASUREMENT_ERRORS.UNSUPPORTED_WORKLET));
    else if (wk && wk.mode === 'scriptprocessor')
      warnings.push(reason('WORKLET_FALLBACK', 'AudioWorklet is unavailable; capturing with the '
        + 'deprecated ScriptProcessor (frame timing is less exact).'));

    const out = facts.output || null;
    if (out && plan) {
      const eff = plan.stimulusSpec.level * (isNum(out.gain) ? out.gain : 0);
      if (!(eff > 0))
        blockers.push(reason('OUTPUT_SILENT', 'The output level is zero: nothing would play.'));
      if (eff > PREFLIGHT_THRESHOLDS.highOutputPeak)
        warnings.push(reason('HIGH_OUTPUT', 'High output level: lower it before using '
          + 'headphones.', { value: eff, unit: 'digital peak' }));
      if (eff > PREFLIGHT_THRESHOLDS.limiterTransparentPeak)
        warnings.push(reason('LIMITER_RANGE', 'At this output level the safety limiter can '
          + 'compress high frequencies in some browsers; the measured response then includes '
          + 'it. Lower the level or the master volume.', { value: eff, unit: 'digital peak' }));
      if (out.audibleVoices > 0)
        warnings.push(reason('OTHER_AUDIO', 'Other sounds are playing; they will be stopped.'));
    }
    if (!cal.frequency)
      warnings.push(reason('UNCALIBRATED', 'No frequency calibration profile: the response '
        + 'includes the microphone and is UNCALIBRATED.', { severity: 'info' }));
    if (!cal.level)
      warnings.push(reason('LEVEL_RELATIVE', 'No level calibration: levels are dB relative '
        + '(dBFS-like), not dB SPL.', { severity: 'info' }));

    return {
      ready: blockers.length === 0,
      warnings,
      blockers,
      facts,
      plan,
      calibration: cal,
      chainNotes,
      sampleRate,
    };
  }

  function beginOrThrow({ reuseReady = false } = {}) {
    if (disposed) throw new MeasurementError('INTERNAL', 'The measurement engine is disposed.');
    const st = machine.state;
    if (isActiveState(st) && !(reuseReady && st === S.READY && current && !current.dead))
      throw new MeasurementError('BUSY');
    if (reuseReady && st === S.READY && current && !current.dead) return current;
    if (st !== S.IDLE) machine.reset();
    prepared = null;
    return newSession();
  }

  function publicReport(report) {
    return { ready: report.ready, warnings: report.warnings, blockers: report.blockers,
      facts: report.facts, sampleRate: report.sampleRate };
  }

  // ---- measurement
  async function captureRun(s, r, stimulus, notBefore) {
    const plan = s.plan;
    go(s, S.ARMED, { run: r, notBefore });
    const cap = await guard(s, io.runStimulus(stimulus, {
      preRollS: plan.timing.preRollS,
      postRollS: plan.timing.postRollS,
      notBefore,
      onScheduled: (t) => {
        if (s !== current || s.dead) return;
        const base = plannedBase(s, 'pre-roll', r);
        s.currentAudio = { kind: 'run', run: r, base, cs: t.captureStartAt,
          ss: t.stimulusStartAt, se: t.stimulusEndAt, ce: t.captureEndAt };
        s.timeline.actual.push({ phase: 'run', run: r, ...t });
        emit(s, { type: 'scheduled', run: r, ...t });
      },
      onChunk: (chunk) => tick(s, chunk),
    }));
    if (machine.state === S.ARMED) go(s, S.MEASURING, { run: r, at: io.now() });
    if (!cap || !(cap.samples instanceof Float32Array))
      throw new MeasurementError('INTERNAL', 'The capture adapter returned no samples.');
    const a = s.timeline.actual.find((x) => x.phase === 'run' && x.run === r);
    if (!a) {
      // An io that did not report its schedule: derive it from the capture itself.
      const cs = cap.startedAt;
      const ss = isNum(cap.stimulusStartAt) ? cap.stimulusStartAt : cs + plan.timing.preRollS;
      const se = ss + stimulus.samples.length / cap.sampleRate;
      s.timeline.actual.push({ phase: 'run', run: r, captureStartAt: cs, stimulusStartAt: ss,
        stimulusEndAt: se, captureEndAt: cs + cap.samples.length / cap.sampleRate });
    }
    const times = s.timeline.actual.find((x) => x.phase === 'run' && x.run === r);
    if (notBefore != null && times.captureStartAt < notBefore - 1e-6)
      throw new MeasurementError('INTERNAL', `Run ${r + 1} started before the previous capture `
        + 'ended plus the gap (overlapping captures).');
    return { cap, times };
  }

  // Run-level checks (M8): only what makes a capture unusable before alignment invalidates the
  // run here (RUN_INVALIDATING_CODES); clipping, discontinuities and dropouts that may lie
  // outside the sweep stay in `reasons` and are graded by the quality assessment against the
  // ALIGNED sweep window. `sweep` = [from, to) is where the sweep's response certainly lies.
  function runChecks(cap, sweep = null) {
    const checks = checkCapture(cap);
    const reasons = checks.reasons.slice();
    const integ = cap.integrity || null;
    if (integ && (integ.receivedFrames < integ.expectedFrames || integ.discontinuities > 0)) {
      reasons.push(reason('FRAMES_MISSING', `${integ.expectedFrames - integ.receivedFrames} `
        + `frames missing, ${integ.discontinuities} discontinuities in the capture.`));
    }
    if (checks.empty) reasons.push(reason('NO_INPUT', MEASUREMENT_ERRORS.NO_INPUT));
    const inside = sweep ? checks.dropouts.filter((d) => d.start < sweep[1] && d.end > sweep[0])
      : [];
    if (inside.length) {
      reasons.push(reason('DROPOUT_IN_SWEEP', `${inside.length} dropout(s) inside the sweep `
        + `window (samples ${sweep[0]}-${sweep[1]}): the capture lost samples of the response.`));
    }
    const invalidating = reasons.filter((r) => RUN_INVALIDATING_CODES.includes(r.code));
    return { ...checks, integrity: integ, invalid: invalidating.length > 0,
      invalidating: invalidating.map((r) => r.code), reasons };
  }

  /**
   * Capture samples where the sweep's response lies for EVERY latency the analysis accepts:
   * the stimulus starts at s0 (its scheduled offset in the capture) plus an unknown latency
   * L ∈ [0, post-roll] (a larger L puts the stimulus outside the capture, which the analysis
   * rejects), so [s0 + post-roll, s0 + frames). null when that is empty (post-roll ≥ sweep).
   */
  function certainSweepWindow(times, frames, sampleRate, postRollS) {
    if (!isNum(times.stimulusStartAt) || !isNum(times.captureStartAt) || !isNum(postRollS))
      return null;
    const s0 = Math.round((times.stimulusStartAt - times.captureStartAt) * sampleRate);
    const from = s0 + Math.round(postRollS * sampleRate);
    const to = s0 + frames;
    return to > from ? [from, to] : null;
  }

  function invalidResult(s, extra) {
    return {
      state: S.INVALID,
      reasons: extra.reasons,
      preflight: extra.preflight || null,
      runs: extra.runs || [],
      transfer: null,
      ir: null,
      aggregate: null,
      calibrated: null,
      captureChecks: extra.captureChecks || [],
      noise: extra.noise || null,
      timeline: s.timeline ? exportTimeline(s) : null,
      quality: null,
    };
  }

  function exportTimeline(s) {
    return {
      planned: s.timeline.items,
      audioS: s.timeline.audioS,
      actual: s.timeline.actual.slice(),
      analysis: s.timeline.analysis,
    };
  }

  // Offline analysis through the injected `analyze` (default defaultAnalyze(): Worker/inline):
  // one serializable message, the engine's hooks between steps (yield = abort point, onStep =
  // timing, progress and the 'analysis' event). An analyze without per-step hooks (a Worker)
  // has its result.steps reported when it resolves.
  async function analyzeRuns(s, stimulus, runs, opts) {
    const plan = s.plan;
    const spec = stimulus.spec;
    const keepRaw = opts.keepRaw === true;
    s.analysis = { done: 0, total: runs.length * 2 + 1 };
    s.timeline.analysis = { steps: [], startedAtMs: clk.wall(), totalMs: 0, longestMs: 0 };
    const t0 = clk.mono();
    const message = analysisMessage({
      stimulus: stimulus.samples, sampleRate: spec.sampleRate, f1: spec.f1, f2: spec.f2,
      captures: runs.map((run) => s.captures[run.index].samples),
      noise: s.noiseCapture ? s.noiseCapture.samples : null,
      phase: plan.phase, aggregation: plan.aggregation,
    });
    const onStep = (st) => {
      s.timeline.analysis.steps.push({ name: st.name, run: st.run, ms: st.ms });
      s.analysis.done += 1;
      emit(s, { type: 'analysis', step: st.name, run: st.run, ms: st.ms });
      tick(s, null);
      if (s.dead) throw s.deadError;
    };
    // Aborted with the session (abort(), fail()): a Worker-backed analyze terminates.
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    if (ac) s.abortPromise.catch(() => ac.abort());
    let out;
    try {
      out = await guard(s, analyzeFn(message, {
        now: clk.mono,
        yield: () => guard(s, typeof io.yield === 'function' ? io.yield() : null),
        onStep,
        keepRaw,
        signal: ac ? ac.signal : null,
      }));
    } catch (e) {
      if (s.dead) throw s.deadError;
      throw mapError(e, 'ANALYSIS_FAILURE');
    }
    if (s.timeline.analysis.steps.length === 0 && Array.isArray(out.steps)) {
      for (const st of out.steps) onStep(st);
    }
    out.alignments.forEach((a, i) => { runs[i].alignment = a; });
    if (out.invalid) return { invalid: true, reasons: out.reasons.map((x) => Object.freeze(x)) };
    const best = runs[out.best];
    runs.forEach((run, i) => {
      run.transfer = out.transfers[i];
      run.raw = keepRaw ? s.captures[run.index].samples : null;
      run.ir = null;
    });
    if (!keepRaw) for (const run of runs) s.captures[run.index] = null;
    const ir = out.ir;
    ir.run = best.index;
    best.ir = irMeta(ir);
    let transfer;
    try {
      transfer = measurementTransfer(out.transfers, out.aggregate);
    } catch (e) {
      throw mapError(e, 'ANALYSIS_FAILURE');
    }
    s.timeline.analysis.totalMs = clk.mono() - t0;
    s.timeline.analysis.longestMs = Math.max(0, ...s.timeline.analysis.steps.map((x) => x.ms));
    return { invalid: false, transfer, ir, aggregate: out.aggregate };
  }

  function applyCalibration(cal, transfer) {
    const level = cal.level ? Object.freeze(JSON.parse(JSON.stringify(cal.level))) : null;
    const out = { frequency: null, level: { ...levelLabel(cal.level), calibration: level } };
    if (cal.frequency) {
      const c = applyFrequencyCorrection(transfer.magnitudeDb, transfer.frequencies,
        cal.frequency);
      out.frequency = { ...c, name: cal.frequency.name || null };
    }
    return out;
  }

  async function doMeasure(recipe, opts) {
    const calibration = opts.calibration === undefined ? null : opts.calibration;
    // The first capture's audio-clock anchor (a Studio measurement clip's startTime).
    const startAt = isNum(opts.startAt) ? opts.startAt : null;
    const reuse = machine.state === S.READY && samePrepared(recipe, calibration)
      && current && !current.dead;
    // A structurally invalid recipe is rejected before any state change.
    validateRecipe(recipe, { sampleRate: io.sampleRate || 48000, limits: lim });
    const s = beginOrThrow({ reuseReady: reuse });
    if (!s.startedAtMs) s.startedAtMs = clk.wall();
    let report;
    try {
      if (reuse) {
        report = prepared.report;
      } else {
        go(s, S.PREFLIGHT, { recipe: true });
        report = await runPreflight(s, recipe, calibration);
        emit(s, { type: 'preflight', ...publicReport(report) });
        if (!report.ready) {
          go(s, S.INVALID, { reasons: report.blockers.map((b) => b.code) });
          cancelIo('invalid');
          return invalidResult(s, { reasons: report.blockers, preflight: publicReport(report) });
        }
      }
      const plan = report.plan;
      s.plan = plan;
      const tl = planTimeline(plan);
      s.timeline = { items: tl.items, audioS: tl.audioS, actual: [], analysis: null };
      const stimulus = renderStimulus(plan.stimulusSpec); // the ONE canonical stimulus (§206)
      const assessFn = typeof opts.assess === 'function' ? opts.assess : defaultAssess;

      // Noise floor (§31).
      let noise = null;
      if (plan.timing.noiseCheckS > 0) {
        go(s, S.NOISE_CHECK, { seconds: plan.timing.noiseCheckS });
        const ncap = await guard(s, io.captureNoise(plan.timing.noiseCheckS, {
          notBefore: startAt,
          onScheduled: (t) => {
            if (s !== current || s.dead) return;
            s.currentAudio = { kind: 'noise', base: 0, start: t.captureStartAt,
              end: t.captureEndAt };
            s.timeline.actual.push({ phase: 'noise', run: null, ...t });
            emit(s, { type: 'scheduled', run: null, phase: 'noise', ...t });
          },
          onChunk: (chunk) => tick(s, chunk),
        }));
        if (!ncap || !(ncap.samples instanceof Float32Array))
          throw new MeasurementError('INTERNAL', 'The noise capture returned no samples.');
        s.noiseCapture = ncap;
        noise = summarizeNoise(ncap, report.calibration.level);
        emit(s, { type: 'noise', rmsDb: noise.rmsDb, peak: noise.peak,
          reasons: noise.checks.reasons });
        // A clipping or broken noise capture invalidates; an EMPTY one (digital silence, a
        // gate) does not: the runs can still be valid, the SNR is then NOT MEASURED
        // (quality.js v3 reads noise.checks; transfer.js v2 derives no SNR without noise power).
        const nc = noise.checks.reasons.map((x) => x.code);
        const broken = nc.filter((c) => NOISE_INVALIDATING_CODES.includes(c));
        if (noise.checks.clipping.regions.length || broken.length) {
          const code = broken.length ? 'NOISE_CAPTURE_INVALID' : 'NOISE_CLIPPING';
          go(s, S.INVALID, { reasons: [code] });
          const r = [broken.length
            ? reason(code, `The noise capture is unusable (${broken.join(', ')}).`)
            : reason(code, 'The background alone drives the input to full '
              + 'scale: lower ' + INPUT_GAIN_WHERE + ' or the background noise.')];
          releaseRaw(s);
          cancelIo('invalid');
          return invalidResult(s, { reasons: r, preflight: publicReport(report), noise });
        }
        go(s, S.READY, { noiseRmsDb: Number.isFinite(noise.rmsDb) ? noise.rmsDb : null });
      } else if (machine.state === S.PREFLIGHT) {
        go(s, S.READY, null);
      }

      // Runs (§219): sequential, gap on the audio clock, never overlapping.
      const runs = [];
      const captureChecks = [];
      let notBefore = noise ? null : startAt;
      for (let r = 0; r < plan.repeats; r++) {
        const { cap, times } = await captureRun(s, r, stimulus, notBefore);
        s.captures[r] = cap;
        const checks = runChecks(cap, certainSweepWindow(times, stimulus.samples.length,
          cap.sampleRate, plan.timing.postRollS));
        captureChecks.push(checks);
        const run = {
          index: r,
          startedAt: cap.startedAt,
          stimulusStartAt: times.stimulusStartAt,
          captureEndAt: times.captureEndAt,
          frames: cap.samples.length,
          sampleRate: cap.sampleRate,
          checks,
          alignment: null,
          transfer: null,
          ir: null,
          raw: null,
        };
        runs.push(run);
        emit(s, { type: 'run', run: r, invalid: checks.invalid, reasons: checks.reasons });
        if (checks.invalid) {
          const why = checks.reasons.filter((x) => checks.invalidating.includes(x.code));
          go(s, S.INVALID, { run: r, reasons: why.map((x) => x.code) });
          releaseRaw(s);
          cancelIo('invalid');
          return invalidResult(s, { reasons: why.map((x) => ({ ...x, run: r })),
            preflight: publicReport(report), runs, captureChecks, noise });
        }
        notBefore = times.captureEndAt + plan.timing.gapS;
        // MEASURING → ARMED for the next repeat (captureRun takes it), or → ANALYZING.
        if (r + 1 === plan.repeats) go(s, S.ANALYZING, { runs: plan.repeats });
      }
      s.currentAudio = null;

      // Offline analysis.
      const first = s.captures[0];
      const input = { device: first.device || { label: null, id: null },
        constraints: first.constraints || { requested: null, applied: null } };
      const analysis = await analyzeRuns(s, stimulus, runs, opts);
      if (analysis.invalid) {
        go(s, S.INVALID, { reasons: analysis.reasons.map((x) => x.code) });
        releaseRaw(s);
        cancelIo('invalid');
        return invalidResult(s, { reasons: analysis.reasons, preflight: publicReport(report),
          runs, captureChecks, noise });
      }
      const calibrated = applyCalibration(report.calibration, analysis.transfer);
      if (noise && !opts.keepRaw) noise.raw = null;
      else if (noise) noise.raw = s.noiseCapture.samples;
      const notes = [];
      if (!first.testContext && inputProcessingMayApply(input.constraints.applied))
        notes.push(INPUT_PROCESSING_NOTE);
      const result = {
        state: S.COMPLETE,
        reasons: [],
        startedAtMs: s.startedAtMs,
        sampleRate: stimulus.spec.sampleRate,
        recipe: { stimulus: stimulus.spec, repeats: plan.repeats, analysis: {
          ...plan.timing, phase: plan.phase, aggregation: plan.aggregation } },
        stimulus: { spec: stimulus.spec, clampedTo: stimulus.clampedTo, frames:
          stimulus.samples.length },
        input,
        testContext: first.testContext || null,
        chainNotes: report.chainNotes || null,
        notes,
        preflight: publicReport(report),
        runs,
        transfer: analysis.transfer,
        ir: analysis.ir,
        aggregate: analysis.aggregate,
        calibrated,
        captureChecks,
        noise,
        timeline: exportTimeline(s),
        algorithms: { transfer: ALGORITHMS.transfer, ir: ALGORITHMS.ir, align: ALGORITHMS.align,
          clip: ALGORITHMS.clip, calibration: calibrated.frequency ? ALGORITHMS.calibration
            : null },
        quality: null,
      };
      releaseRaw(s);
      if (assessFn) {
        await guard(s, null);
        let q;
        try {
          q = assessFn(result, { recipe, plan, calibration: report.calibration,
            chainNotes: report.chainNotes || null, inputProcessing: inputProcessingFacts(result) });
        } catch (e) {
          throw mapError(e, 'ANALYSIS_FAILURE');
        }
        result.quality = q || null;
        if (q && q.status === 'INVALID') {
          result.state = S.INVALID;
          result.reasons = Array.isArray(q.reasons) ? q.reasons.filter((x) => x.severity
            === 'fail') : [];
          go(s, S.INVALID, { quality: 'INVALID', reasons: result.reasons.map((x) => x.code) });
          cancelIo('invalid');
          return result;
        }
      }
      s.analysis = null;
      go(s, S.COMPLETE, { runs: runs.length });
      emit(s, { type: 'result', state: S.COMPLETE });
      cancelIo('complete'); // releases the input stream and capture nodes (§111, §169)
      prepared = null;
      return result;
    } catch (e) {
      if (s.dead) throw s.deadError || e;
      const me = mapError(e);
      if (me.code === 'ABORTED') {
        api.abort(me.detail && me.detail.reason ? me.detail.reason : 'io');
        throw new MeasurementError('ABORTED');
      }
      throw fail(s, me);
    }
  }

  const api = {
    get state() { return machine.state; },
    get history() { return machine.history; },
    get limits() { return lim; },

    /**
     * preflight(recipe, { calibration }) → { ready, warnings, blockers, facts, sampleRate }
     * IDLE → PREFLIGHT → READY (ready) or INVALID (blockers). Warnings never block (§30). A
     * following measure() with the same recipe and calibration starts from READY.
     */
    async preflight(recipe, opts = {}) {
      const s = beginOrThrow();
      s.startedAtMs = clk.wall();
      try {
        go(s, S.PREFLIGHT, { recipe: true });
        const report = await runPreflight(s, recipe, opts.calibration);
        emit(s, { type: 'preflight', ...publicReport(report) });
        if (report.ready) {
          go(s, S.READY, null);
          prepared = { key: recipeKey(recipe), calibration: opts.calibration ?? null,
            plan: report.plan, report };
        } else {
          go(s, S.INVALID, { reasons: report.blockers.map((b) => b.code) });
          cancelIo('invalid');
        }
        return publicReport(report);
      } catch (e) {
        if (s.dead) throw s.deadError || e;
        throw fail(s, e);
      }
    },

    /**
     * measure(recipe, { calibration, keepRaw = false, assess, startAt }) → Promise<result>
     * startAt: audio-clock time before which the first capture is not scheduled.
     * Resolves with a COMPLETE or INVALID result; rejects with MeasurementError (code ABORTED
     * after abort(), or the mapped error code after ERROR). See the header for the shape.
     */
    measure(recipe, opts = {}) {
      return doMeasure(recipe, opts);
    },

    /** Abort from any active state; false when nothing is in progress. */
    abort(why = 'user') {
      const s = current;
      if (!s || s.dead || !isActiveState(machine.state)) return false;
      machine.abort(why);
      s.kill(new MeasurementError('ABORTED', undefined, { detail: { reason: why } }));
      muted = true;
      prepared = null;
      cancelIo(why);
      releaseRaw(s);
      return true;
    },

    /** Progress now, from io.now() against the planned timeline (null when idle). */
    progress() {
      const s = current;
      if (!s || s.dead || !isActiveState(machine.state)) return null;
      return computeProgress(s, io.now());
    },

    /** Back to IDLE from a terminal state or READY (releases the input). */
    reset() {
      if (isActiveState(machine.state) && machine.state !== S.READY) return false;
      if (machine.state === S.READY) cancelIo('reset');
      if (current) releaseRaw(current);
      prepared = null;
      machine.reset();
      return true;
    },

    /** Abort anything in progress and dispose the io. */
    dispose() {
      if (disposed) return;
      api.abort('dispose');
      disposed = true;
      try { if (typeof io.dispose === 'function') io.dispose(); } catch (e) { /* ignore */ }
    },
  };
  return api;
}
