// The Worker side of the offline analysis (gap M10; ADR 0026; docs/v3/spike-audioworklet-
// worker.md). scripts/build-analysis-worker.mjs bundles THIS file (with analysis-task.js and its
// pure dependencies) into one classic script; the build embeds that script as a string in
// dist/index.html and analysis-runner.js starts it from a data: URL, so the page still loads
// no file (rule project.single-file-deliverable).
//
// Protocol (one Worker per analysis; the main thread terminates it after the reply or on
// abort):
//   worker → main  { kind: 'ready' }                         once, when the script has loaded
//   main → worker  AnalysisMessage (analysis-task.js), captures/noise transferred
//   worker → main  { kind: 'step', step: { name, run, ms } }  after every analysis step
//   worker → main  { kind: 'result', result }                 AnalysisResult, its typed arrays
//                                                             transferred
//                | { kind: 'error', error: { name, message, code } }
// The steps are analysisSteps() of analysis-task.js, the generator analyzeInline drives on the
// main thread, so both paths compute the same numbers; step times come from the Worker's own
// performance.now().

import { analysisResultTransferList, analysisSteps } from './analysis-task.js';

export const WORKER_READY = 'ready';
export const WORKER_STEP = 'step';
export const WORKER_RESULT = 'result';
export const WORKER_ERROR = 'error';

/** A plain, cloneable description of an error (Error objects do not clone everywhere). */
export function errorRecord(err) {
  return {
    name: err && typeof err.name === 'string' ? err.name : 'Error',
    message: err && err.message ? String(err.message) : String(err),
    code: err && typeof err.code === 'string' ? err.code : null,
  };
}

/**
 * serveAnalysis(scope, { now }): install the protocol on a worker global scope (`self`) or
 * any object with onmessage/postMessage (tests). Announces { kind: 'ready' } at once. The steps
 * run back to back: the Worker has nothing else to do, and an abort terminates it.
 */
export function serveAnalysis(scope, { now = null } = {}) {
  const clock = typeof now === 'function' ? now
    : (scope.performance && typeof scope.performance.now === 'function'
      ? () => scope.performance.now() : null);
  scope.onmessage = (e) => {
    let result;
    try {
      const it = analysisSteps(e.data, { now: clock });
      for (;;) {
        const r = it.next();
        if (r.done) {
          result = r.value;
          break;
        }
        const { last, ...step } = r.value;
        scope.postMessage({ kind: WORKER_STEP, step });
      }
    } catch (err) {
      scope.postMessage({ kind: WORKER_ERROR, error: errorRecord(err) });
      return;
    }
    scope.postMessage({ kind: WORKER_RESULT, result }, analysisResultTransferList(result));
  };
  scope.postMessage({ kind: WORKER_READY });
}

// Entry: only inside a dedicated worker (no WorkerGlobalScope on a page or under node), so
// importing this module elsewhere has no effect.
/* global WorkerGlobalScope */
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined'
  && self instanceof WorkerGlobalScope) {
  serveAnalysis(self);
}
