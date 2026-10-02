// The offline analysis of one measurement as ONE serializable task (gap G21; spike
// docs/v3/spike-audioworklet-worker.md). Pure: plain data in, plain data out, no DOM, no Web
// Audio, no globals, no clock of its own (a caller may pass `now` for step timing).
//
//   message ─► align every run ─► transfer per run (one shared FFT plan and noise spectrum;
//              the best-aligned run's transfer and impulse response from ONE deconvolution)
//           ─► aggregate the run magnitudes ─► result
//
// The engine (engine.js) builds the message from its captures and calls an injected
// `analyze(message, hooks) → Promise<result>`; the default, analyzeInline, runs the steps on the
// calling thread with hooks.yield() between them (abort and the UI land between steps, as
// before). Moving the analysis into a Worker later is a build change only: a Worker bundle of
// this module (loaded from a data: URL, like the capture worklet) answers
//   onmessage = (e) => postMessage(runAnalysis(e.data), analysisResultTransferList(result))
// and the engine is created with an `analyze` that posts the message with
// analysisTransferList(message) and resolves with the reply (no per-step hooks then: the engine
// reports result.steps when the reply arrives).
//
//   AnalysisMessage = { type: ANALYSIS_TASK, version: ANALYSIS_TASK_VERSION,
//     stimulus: Float32Array, sampleRate, f1, f2, captures: Float32Array[] (one per run, run
//     order), noise: Float32Array|null (stimulus-free capture), phase: bool,
//     aggregation: 'mean'|'median' }
//   AnalysisResult = { type: ANALYSIS_RESULT, version, invalid: false, reasons: [],
//     alignments: [align() result per run], transfers: [TransferResult per run], best,
//     ir: IrResult (samples included), aggregate: aggregateRuns() result, steps }
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
  phase = false, aggregation = 'mean' } = {}) {
  const m = { type: ANALYSIS_TASK, version: ANALYSIS_TASK_VERSION, stimulus, sampleRate, f1, f2,
    captures, noise, phase, aggregation };
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
      ir = both.ir;
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
