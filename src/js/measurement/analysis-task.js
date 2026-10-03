// The offline analysis of one measurement as ONE serializable task (gap G21; spike
// docs/v3/spike-audioworklet-worker.md). Pure: plain data in, plain data out, no DOM, no Web
// Audio, no globals, no clock of its own (a caller may pass `now` for step timing).
//
//   message ─► align every run ─► transfer per run (one shared FFT plan and noise spectrum;
//              the best-aligned run's transfer and impulse response from ONE deconvolution)
//           ─► aggregate the run magnitudes ─► result
//
// The engine (engine.js) builds the message from its captures and calls an injected
// `analyze(message, hooks) → Promise<result>`. analyzeInline runs the steps on the calling
// thread with hooks.yield() between them (abort and the UI land between steps). In the built
// page the engine's default is the Worker (analysis-runner.js): analysis-worker.js, bundled by
// scripts/build-analysis-worker.mjs into a string inside dist/index.html and started from a
// data: URL, drives the same analysisSteps() generator, posts each step and then the result
// with analysisResultTransferList(result); the message goes in with
// analysisTransferList(message). Under node and in bundles without that string the default
// stays analyzeInline. Both paths compute the same numbers (tests/unit/v3-analysis-worker).
//
// Memory (gap M10): estimateAnalysisMemory() is the working-set model the engine checks before
// a measurement (engine.js validateRecipe, MEMORY_LIMIT); the stored impulse response is capped
// at IR_MAX_SAMPLES (capIrLength, recorded as ir.truncation) so a saved experiment stays inside
// the import limits (experiments/validate.js maxArray 4 000 000 elements, 32 MiB).
//
//   AnalysisMessage = { type: ANALYSIS_TASK, version: ANALYSIS_TASK_VERSION,
//     stimulus: Float32Array, sampleRate, f1, f2, captures: Float32Array[] (one per run, run
//     order), noise: Float32Array|null (stimulus-free capture), phase: bool,
//     aggregation: 'mean'|'median', irMaxSamples?: integer ≥ 1 (default IR_MAX_SAMPLES) }
//   AnalysisResult = { type: ANALYSIS_RESULT, version, invalid: false, reasons: [],
//     alignments: [align() result per run], transfers: [TransferResult per run], best,
//     ir: IrResult (samples included; truncation when capped, see capIrLength),
//     aggregate: aggregateRuns() result, steps }
//   | { type, version, invalid: true, reasons: [{ code: 'NO_ALIGNMENT'|
//     'STIMULUS_OUTSIDE_CAPTURE', text, run, value? }], alignments, transfers: null, best: null,
//     ir: null, aggregate: null, steps }
//   steps = [{ name: 'align'|'transfer'|'transfer+impulse-response'|'aggregate', run, ms }]
//     (ms null without `now`)
//
// Every value in both is structured-cloneable (typed arrays, numbers, strings, null, plain
// objects and arrays); nothing is a class instance or a function. The inline path computes
// exactly what engine.js computed before this module existed (same calls, same order, same
// shared plan and noise spectrum: tests/unit/v3-analysis-task.test.mjs checks bit identity).

import { align } from './align.js';
import { computeTransfer, fftPlan, nextPowerOfTwo, noiseSpectrum } from './transfer.js';
import { computeTransferAndIr } from './impulse-response.js';
import { aggregateRuns } from './aggregate.js';

export const ANALYSIS_TASK = 'oscilla.analysis-task';
export const ANALYSIS_RESULT = 'oscilla.analysis-result';
export const ANALYSIS_TASK_VERSION = 1;
/** Stimulus-window guard of the STIMULUS_OUTSIDE_CAPTURE check (seconds). */
export const OUTSIDE_GUARD_S = 0.005;

/**
 * Longest impulse response a result carries (samples). The causal IR is as long as the capture
 * (impulse-response.js); 2^21 samples keep ≥ 10.9 s after the IR start at 192 kHz, 21.8 s at
 * 96 kHz and 43.7 s at 48 kHz (longer than any 48 kHz capture, CONTRACT_LIMITS.maxCaptureS
 * 40 s), and a stored IR (8 MiB of Float32, 11.2 MB base64) stays far inside the import limits
 * of experiments/validate.js (4 000 000 elements per array, 32 MiB per file) next to the
 * transfer arrays.
 */
export const IR_MAX_SAMPLES = 2 ** 21;

/**
 * Working-set model of one analysis (estimateAnalysisMemory), bytes. Per FFT point of the
 * deconvolution size N (transfer.js, the same N as align.js's correlation):
 *   align, per run                 plan 12·N (Uint32 bit reversal + Float64 twiddles), 4 Float64
 *                                  buffers 32·N                                    = 44·N
 *   transfer + IR (one division)   shared plan 12·N, scratch 16·N, X/Y half spectra 16·N,
 *                                  |X|², ε, H 16·N, |H|² 4·N, noise and |Y|² power 8·N, the
 *                                  noise spectrum 8·N                               = 80·N
 * A step's garbage is not collected before the next step allocates, so the peak is about
 * 44·N + 80·N = 124·N for one run; repeated runs leave more uncollected garbage (node: 111 B per
 * point for one run, 143-160 B for 10). bytesPerFftPoint = 160 is that envelope, inputs count
 * twice (captures + stimulus + noise as Float32, plus the Worker's copy of the stimulus or the
 * keepRaw copy, plus the IR samples) and fixedBytes covers the heap growth of small analyses.
 * Every measured peak RSS growth (node 22, Chromium 153 and Firefox 155, inline and Worker,
 * 1-10 runs, 2^19-2^23 points; docs/v3/spike-audioworklet-worker.md "M10") was 42-87 % of the
 * estimate.
 */
export const ANALYSIS_MEMORY_MODEL = Object.freeze({
  bytesPerFftPoint: 160,
  bytesPerInputFrame: 8,
  fixedBytes: 64 * 2 ** 20,
});

/**
 * estimateAnalysisMemory({ stimulusFrames, captureFrames, runs = 1, noiseFrames = 0 })
 *   → { fftSize, bytes, model }
 * fftSize is the deconvolution and correlation size nextPowerOfTwo(stimulus + capture), bytes
 * the ANALYSIS_MEMORY_MODEL estimate of the analysis's peak memory. Pure; no allocation.
 */
export function estimateAnalysisMemory({ stimulusFrames, captureFrames, runs = 1,
  noiseFrames = 0 } = {}) {
  for (const [k, v] of Object.entries({ stimulusFrames, captureFrames, runs, noiseFrames })) {
    if (!(Number.isInteger(v) && v >= 0)) throw new RangeError(`${k} must be an integer ≥ 0`);
  }
  const fftSize = nextPowerOfTwo(stimulusFrames + captureFrames);
  const m = ANALYSIS_MEMORY_MODEL;
  const bytes = m.fixedBytes + m.bytesPerFftPoint * fftSize
    + m.bytesPerInputFrame * (stimulusFrames + runs * captureFrames + noiseFrames);
  return { fftSize, bytes, model: m };
}

/**
 * capIrLength(ir, maxSamples = IR_MAX_SAMPLES) → IrResult
 * `ir` itself when it has ≤ maxSamples samples. Otherwise a NEW IrResult holding the window
 * [shift, shift + maxSamples) of ir.samples, shift = max(0, min(peakIndex − ⌊maxSamples/2⌋,
 * length − maxSamples)): the original start is kept unless the peak lies beyond the first half
 * of the window, so at least half the window follows the peak. peakIndex, peakTimeS and
 * captureOffsetS are moved to the kept window (the absolute peak time is unchanged);
 * noiseFloorDb stays the value of the full IR (its late tail). truncation records the cut:
 * { maxSamples, fullLength, startIndex: shift } (indices of the full IR).
 */
export function capIrLength(ir, maxSamples = IR_MAX_SAMPLES) {
  if (!(Number.isInteger(maxSamples) && maxSamples >= 1))
    throw new RangeError('maxSamples must be an integer ≥ 1');
  const full = ir.samples.length;
  if (full <= maxSamples) return ir;
  const shift = Math.max(0, Math.min(ir.peakIndex - Math.floor(maxSamples / 2),
    full - maxSamples));
  const peakIndex = ir.peakIndex - shift;
  return {
    ...ir,
    samples: ir.samples.slice(shift, shift + maxSamples),
    peakIndex,
    peakTimeS: peakIndex / ir.sampleRate,
    captureOffsetS: ir.captureOffsetS + shift / ir.sampleRate,
    truncation: { maxSamples, fullLength: full, startIndex: shift },
  };
}

const AGGREGATIONS = ['mean', 'median'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function reason(code, text, extra) {
  return { code, text, ...(extra || {}) };
}

/**
 * analysisMessage({ stimulus, sampleRate, f1, f2, captures, noise, phase, aggregation })
 *   → AnalysisMessage (validated; the arrays are referenced, not copied)
 */
export function analysisMessage({ stimulus, sampleRate, f1, f2, captures, noise = null,
  phase = false, aggregation = 'mean', irMaxSamples } = {}) {
  const m = { type: ANALYSIS_TASK, version: ANALYSIS_TASK_VERSION, stimulus, sampleRate, f1, f2,
    captures, noise, phase, aggregation };
  if (irMaxSamples !== undefined) m.irMaxSamples = irMaxSamples;
  checkMessage(m);
  return m;
}

/** Throws TypeError/RangeError when `m` is not a valid AnalysisMessage. */
export function checkMessage(m) {
  if (!m || typeof m !== 'object') throw new TypeError('analysis message must be an object');
  if (m.type !== ANALYSIS_TASK || m.version !== ANALYSIS_TASK_VERSION)
    throw new TypeError(`not an ${ANALYSIS_TASK} v${ANALYSIS_TASK_VERSION} message`);
  if (!(m.stimulus instanceof Float32Array) || m.stimulus.length === 0)
    throw new TypeError('message.stimulus must be a non-empty Float32Array');
  if (!isNum(m.sampleRate) || m.sampleRate <= 0)
    throw new RangeError('message.sampleRate must be a positive number');
  if (!isNum(m.f1) || !isNum(m.f2) || !(m.f1 > 0 && m.f2 > m.f1))
    throw new RangeError('message.f1 and f2 must satisfy 0 < f1 < f2');
  if (!Array.isArray(m.captures) || m.captures.length === 0
    || !m.captures.every((c) => c instanceof Float32Array))
    throw new TypeError('message.captures must be a non-empty array of Float32Array');
  if (m.noise !== null && !(m.noise instanceof Float32Array))
    throw new TypeError('message.noise must be a Float32Array or null');
  if (typeof m.phase !== 'boolean') throw new TypeError('message.phase must be a boolean');
  if (!AGGREGATIONS.includes(m.aggregation))
    throw new RangeError('message.aggregation must be "mean" or "median"');
  if (m.irMaxSamples !== undefined
    && !(Number.isInteger(m.irMaxSamples) && m.irMaxSamples >= 1))
    throw new RangeError('message.irMaxSamples must be an integer ≥ 1');
}

/**
 * analysisSteps(message, { now }) — generator: runs one analysis step per next() and yields
 * { name, run, ms, last } after it (`last`: no step follows; the next next() returns the
 * AnalysisResult without computing anything). runAnalysis and analyzeInline drive it.
 */
export function* analysisSteps(message, { now = null } = {}) {
  checkMessage(message);
  const m = message;
  const sr = m.sampleRate;
  const n = m.stimulus.length;
  const runs = m.captures.length;
  const steps = [];
  const time = typeof now === 'function' ? now : null;
  const record = (name, run, t0, last) => {
    const s = { name, run, ms: time ? time() - t0 : null };
    steps.push(s);
    return { ...s, last };
  };
  const done = (fields) => ({ type: ANALYSIS_RESULT, version: ANALYSIS_TASK_VERSION, ...fields,
    steps: steps.slice() });

  // 1. Alignment of every run; a run whose stimulus is missing or outside the capture makes the
  // whole analysis invalid (no transfer is computed from it).
  const alignments = [];
  const reasons = [];
  const guard = Math.round(OUTSIDE_GUARD_S * sr);
  for (let r = 0; r < runs; r++) {
    const t0 = time ? time() : 0;
    const a = align(m.stimulus, m.captures[r], sr);
    alignments.push(a);
    const lag = a.lagSamples;
    const capLen = m.captures[r].length;
    if (lag === null)
      reasons.push(reason('NO_ALIGNMENT', `Run ${r + 1}: the stimulus was not found `
        + 'in the capture.', { run: r }));
    else if (lag < -guard || lag + n > capLen + guard)
      reasons.push(reason('STIMULUS_OUTSIDE_CAPTURE', `Run ${r + 1}: the stimulus `
        + 'is not fully inside the capture window.', { run: r, value: lag }));
    yield record('align', r, t0, r === runs - 1 && reasons.length > 0);
  }
  if (reasons.length) {
    return done({ invalid: true, reasons, alignments, transfers: null, best: null, ir: null,
      aggregate: null });
  }

  // 2. Representative run: the best stimulus match (first on ties).
  let best = 0;
  for (let r = 1; r < runs; r++) {
    if (alignments[r].peakCorrelation > alignments[best].peakCorrelation) best = r;
  }
  // One FFT plan for every run of equal capture length and the noise capture's spectrum once
  // per FFT size; the representative run's transfer and IR from one spectral division.
  let shared = null;
  let noiseSpec = null;
  const planFor = (captured) => {
    const size = nextPowerOfTwo(n + captured.length);
    if (!shared || shared.size !== size) shared = fftPlan(size);
    return shared;
  };
  const noiseFor = (fft) => {
    if (!m.noise) return null;
    if (!noiseSpec || noiseSpec.fftSize !== fft.size)
      noiseSpec = noiseSpectrum(m.noise, fft.size, fft);
    return noiseSpec;
  };
  const transfers = new Array(runs).fill(null);
  let ir = null;
  for (let r = 0; r < runs; r++) {
    const captured = m.captures[r];
    const args = {
      stimulus: m.stimulus, captured, sampleRate: sr, f1: m.f1, f2: m.f2,
      lagSamples: alignments[r].lagSamples, alignment: alignments[r], noise: m.noise,
      options: { phase: m.phase },
    };
    const t0 = time ? time() : 0;
    if (r === best) {
      const fft = planFor(captured);
      const both = computeTransferAndIr({ ...args, fft, noiseSpectrum: noiseFor(fft),
        irLagSamples: Math.max(0, alignments[r].lagSamples) });
      transfers[r] = both.transfer;
      ir = capIrLength(both.ir, m.irMaxSamples === undefined ? IR_MAX_SAMPLES
        : m.irMaxSamples);
      yield record('transfer+impulse-response', r, t0, false);
    } else {
      const fft = planFor(captured);
      transfers[r] = computeTransfer({ ...args, fft, noiseSpectrum: noiseFor(fft) });
      yield record('transfer', r, t0, false);
    }
  }

  // 3. Aggregate of the run magnitudes on their common grid.
  const t0 = time ? time() : 0;
  const aggregate = aggregateRuns(transfers.map((t) => t.magnitudeDb),
    { method: m.aggregation });
  yield record('aggregate', null, t0, true);
  return done({ invalid: false, reasons: [], alignments, transfers, best, ir, aggregate });
}

/** runAnalysis(message, { now }) → AnalysisResult: the single serializable entry. */
export function runAnalysis(message, { now = null } = {}) {
  const it = analysisSteps(message, { now });
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * analyzeInline(message, { now, yield, onStep }) → Promise<AnalysisResult>
 * The default `analyze` of the engine: awaits hooks.yield() before every step, runs it on this
 * thread and calls hooks.onStep({ name, run, ms }) after it. A throwing hook stops the analysis
 * (the engine's abort). The result is runAnalysis(message, { now }).
 */
export async function analyzeInline(message, { now = null, yield: pause = null,
  onStep = null } = {}) {
  const it = analysisSteps(message, { now });
  for (;;) {
    if (pause) await pause();
    const r = it.next();
    if (r.done) return r.value;
    const { last, ...step } = r.value;
    if (onStep) onStep(step);
    if (last) return it.next().value;
  }
}

function buffersOf(arrays) {
  const out = new Set();
  for (const a of arrays) if (a && ArrayBuffer.isView(a)) out.add(a.buffer);
  return [...out];
}

/**
 * Buffers a Worker post may transfer with the message: the captures and the noise capture
 * (the engine releases them after the analysis); none with keepRaw (the caller keeps the
 * raw PCM). The stimulus is copied (the engine keeps its rendered stimulus).
 */
export function analysisTransferList(message, { keepRaw = false } = {}) {
  if (keepRaw) return [];
  return buffersOf([...message.captures, message.noise]);
}

/** Buffers of the result's typed arrays (transfers, IR samples, aggregate) for the reply. */
export function analysisResultTransferList(result) {
  const arrays = [];
  const push = (o) => {
    if (!o) return;
    for (const v of Object.values(o)) if (ArrayBuffer.isView(v)) arrays.push(v);
  };
  for (const t of result.transfers || []) push(t);
  push(result.ir);
  push(result.aggregate);
  return buffersOf(arrays);
}
