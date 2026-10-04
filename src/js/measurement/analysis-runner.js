// Where the offline analysis runs (gap M10; ADR 0026). engine.js calls an `analyze(message,
// hooks) → Promise<AnalysisResult>`; this module picks the default:
//
//   defaultAnalyze()  the Worker (createWorkerAnalyze) when the page ran the analysis library
//                     script (EMBEDDED_WORKER_SOURCE, scripts/build-analysis-worker.mjs) and
//                     the platform has Worker; analyzeInline otherwise (node unit tests, test
//                     bundles without the library, a browser without Worker).
//
// One copy of the analysis (ADR 0026, resolution note of 2026-10-04): the build bundles the
// analysis modules once, into the classic <script data-analysis> that runs before the app and
// assigns the global ANALYSIS_LIBRARY_GLOBAL = { modules, source }. In dist the app's imports
// of those modules (analyzeInline, analysisTransferList, ... below) resolve to that global, and
// `source` is the text of that same script element. The Worker is started from a data: URL of
// it, never from a path, so dist/index.html stays the only file (rule
// project.single-file-deliverable; the spike loaded data: Workers from file:// and http in
// Chromium, Firefox and WebKit), and the inline fallback and the Worker run the very same code.
// One Worker per analysis: it is terminated when the result arrives, when the analysis fails
// and when the engine aborts (hooks.signal), which also returns all of the Worker's memory at
// once.
//
// Transfers: the message is posted with analysisTransferList(message, { keepRaw }) (captures
// and the noise capture move to the Worker unless the caller keeps raw PCM; the stimulus is
// copied), the result comes back with its typed arrays transferred. Structured cloning copies
// numbers bit for bit, so the result equals runAnalysis(message) exactly.
//
// Fallback: the message is posted only after the Worker reported { kind: 'ready' }. A Worker
// that cannot be constructed or fails before that (a CSP without data: workers, a broken
// platform) leaves every array untouched and the analysis runs inline instead; its reason is
// in analyze.lastFallback. A failure after the post rejects (the captures have moved).

import { analysisTransferList, analyzeInline } from './analysis-task.js';
import { WORKER_ERROR, WORKER_READY, WORKER_RESULT, WORKER_STEP } from './analysis-worker.js';

/** The global the analysis library script assigns (scripts/build-analysis-worker.mjs). */
export const ANALYSIS_LIBRARY_GLOBAL = '__oscillaAnalysis';

/**
 * The Worker script: the text of the analysis library script the page ran, or null (node,
 * test bundles without the library). Read once, when this module is evaluated.
 */
export const EMBEDDED_WORKER_SOURCE = (() => {
  const lib = globalThis[ANALYSIS_LIBRARY_GLOBAL];
  return lib && typeof lib.source === 'string' && lib.source !== '' ? lib.source : null;
})();

/** data: URL of a classic Worker script (the literal prefix is what verify-dist checks). */
export function workerDataUrl(source) {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

function errorFrom(record) {
  const r = record || {};
  const Ctor = r.name === 'RangeError' ? RangeError : r.name === 'TypeError' ? TypeError : Error;
  const err = new Ctor(r.message || 'analysis worker failed');
  if (r.code) err.code = r.code;
  return err;
}

function abortError() {
  const err = new Error('analysis aborted');
  err.name = 'AbortError';
  err.code = 'ABORTED';
  return err;
}

/**
 * createWorkerAnalyze({ source, WorkerCtor, fallback = analyzeInline }) → analyze
 * analyze(message, { onStep, keepRaw, signal, now, yield }) → Promise<AnalysisResult>
 *   onStep  called with { name, run, ms } for every step the Worker reports (a throw stops the
 *           analysis and terminates the Worker)
 *   signal  optional AbortSignal: abort terminates the Worker and rejects (code ABORTED)
 *   now, yield are used by the inline fallback only.
 * analyze.lastFallback is null, or the reason of the last inline fallback.
 */
export function createWorkerAnalyze({ source, WorkerCtor, fallback = analyzeInline } = {}) {
  if (typeof source !== 'string' || source === '')
    throw new TypeError('createWorkerAnalyze needs the worker source');
  if (typeof WorkerCtor !== 'function') throw new TypeError('createWorkerAnalyze needs Worker');
  let url = null;
  const analyze = (message, hooks = {}) => new Promise((resolve, reject) => {
    const { onStep = null, keepRaw = false, signal = null } = hooks;
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    let worker = null;
    let posted = false;
    let settled = false;
    const finish = () => {
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try { worker.terminate(); } catch (e) { /* already gone */ }
      }
    };
    const fail = (err) => {
      if (settled) return;
      finish();
      reject(err);
    };
    const runInline = (why) => {
      if (settled) return;
      finish();
      analyze.lastFallback = why;
      Promise.resolve().then(() => fallback(message, hooks)).then(resolve, reject);
    };
    function onAbort() { fail(abortError()); }
    if (signal) signal.addEventListener('abort', onAbort);
    try {
      if (url === null) url = workerDataUrl(source);
      worker = new WorkerCtor(url);
    } catch (e) {
      runInline(`Worker could not be started: ${e && e.message ? e.message : e}`);
      return;
    }
    worker.onerror = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const why = (e && e.message) || 'analysis worker error';
      if (!posted) runInline(`Worker failed before the analysis: ${why}`);
      else fail(new Error(why));
    };
    worker.onmessageerror = () => fail(new Error('analysis worker reply could not be read'));
    worker.onmessage = (e) => {
      if (settled) return;
      const d = e.data || {};
      if (d.kind === WORKER_READY && !posted) {
        posted = true;
        analyze.lastFallback = null;
        try {
          worker.postMessage(message, analysisTransferList(message, { keepRaw }));
        } catch (err) {
          fail(err);
        }
      } else if (d.kind === WORKER_STEP) {
        try {
          if (onStep) onStep(d.step);
        } catch (err) {
          fail(err);
        }
      } else if (d.kind === WORKER_RESULT) {
        finish();
        resolve(d.result);
      } else if (d.kind === WORKER_ERROR) {
        fail(errorFrom(d.error));
      }
    };
  });
  analyze.lastFallback = null;
  analyze.mode = 'worker';
  return analyze;
}

/**
 * defaultAnalyze({ source, WorkerCtor }) → analyze: the Worker when a source and a Worker
 * constructor exist (defaults: the analysis library's script text and globalThis.Worker), else
 * analyzeInline.
 */
export function defaultAnalyze({ source = EMBEDDED_WORKER_SOURCE,
  WorkerCtor = typeof globalThis.Worker === 'function' ? globalThis.Worker : null } = {}) {
  if (typeof source === 'string' && source !== '' && typeof WorkerCtor === 'function')
    return createWorkerAnalyze({ source, WorkerCtor });
  return analyzeInline;
}
