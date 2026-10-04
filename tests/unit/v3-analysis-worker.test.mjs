// M10: the analysis in a data: URL Worker (analysis-worker.js + analysis-runner.js; the Worker
// script is the analysis library of scripts/build-analysis-worker.mjs) and the analysis memory
// accounting (analysis-task.js estimateAnalysisMemory / capIrLength, engine.js MEMORY_LIMIT and
// ANALYSIS_MEMORY). Checked:
//   - the REAL library bundle, run in a node worker_thread behind a Worker-shaped shim fed the
//     data: URL, returns results bit-identical to analyzeInline (1 and 3 runs, noise, phase),
//     transfers the captures unless keepRaw, reports every step, and is terminated after the
//     reply and on abort;
//   - the inline fallback when the Worker cannot start, before any array has moved;
//   - defaultAnalyze is analyzeInline under node (no Worker, no embedded script);
//   - the working-set estimate, the MEMORY_LIMIT preflight blocker with its estimate and the
//     ANALYSIS_MEMORY warning; the engine's abort signal;
//   - the IR length cap: recorded as ir.truncation, nothing else of the analysis changes, and a
//     capped IR is stored and re-imported byte for byte (experiments/validate.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';

import { mulberry32 } from '../../src/js/audio/noise.js';
import { renderStimulus } from '../../src/js/measurement/stimulus.js';
import {
  ANALYSIS_MEMORY_MODEL, IR_MAX_SAMPLES, analysisMessage, analyzeInline, capIrLength,
  estimateAnalysisMemory, runAnalysis,
} from '../../src/js/measurement/analysis-task.js';
import { serveAnalysis } from '../../src/js/measurement/analysis-worker.js';
import {
  ANALYSIS_LIBRARY_GLOBAL as RUNNER_GLOBAL, EMBEDDED_WORKER_SOURCE, createWorkerAnalyze,
  defaultAnalyze, workerDataUrl,
} from '../../src/js/measurement/analysis-runner.js';
import {
  CONTRACT_LIMITS, PREFLIGHT_THRESHOLDS, createMeasurementEngine, validateRecipe,
} from '../../src/js/measurement/engine.js';
import { KNOWN_ALGORITHM_IDS, ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import {
  createExperiment, createRecipe, experimentToJson, resultsFromMeasurement, withResults,
} from '../../src/js/experiments/schema.js';
import { resultHash, withResultHash } from '../../src/js/experiments/hash.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import {
  ANALYSIS_LIBRARY_GLOBAL, buildAnalysisLibrary,
} from '../../scripts/build-analysis-worker.mjs';

const SR = 8000;
const SPEC = { kind: 'log-sweep', sampleRate: SR, duration: 1, f1: 50, f2: 3000, level: 0.5,
  fade: 0.01 };
const STIM = renderStimulus(SPEC);
const N = STIM.samples.length;

function uniform(seed, n, amp) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() - 0.5) * amp;
  return out;
}
function capture(seed, { pre = 2000, post = 4000, gain = 0.5 } = {}) {
  const y = uniform(seed, pre + N + post, 2e-3);
  for (let i = 0; i < N; i++) y[pre + i] += gain * STIM.samples[i];
  return y;
}
const message = ({ runs = 1, noise = true, phase = false, irMaxSamples } = {}) =>
  analysisMessage({ stimulus: STIM.samples, sampleRate: SR, f1: SPEC.f1, f2: SPEC.f2,
    captures: Array.from({ length: runs }, (_, r) => capture(10 + r, { gain: 0.5 + 0.01 * r })),
    noise: noise ? uniform(99, 2000 + N + 4000, 2e-3) : null, phase, aggregation: 'mean',
    irMaxSamples });
const copyOf = (m) => ({ ...m, captures: m.captures.map((c) => c.slice()),
  noise: m.noise ? m.noise.slice() : null });
const stepsless = (r) => ({ ...r, steps: r.steps.map((s) => ({ ...s, ms: null })) });

// ----------------------------------------------------------------- the real Worker bundle
// The library with every export of the closure (no page bundle to narrow it down).
const WORKER = await buildAnalysisLibrary();
const PREFIX = 'data:text/javascript;charset=utf-8,';

/**
 * A Worker-shaped class running the data: URL's script in a node worker_thread with a
 * WorkerGlobalScope stand-in, so the bundled entry starts exactly as in a browser.
 */
function shimWorkerClass(log) {
  return class ShimWorker {
    constructor(url) {
      assert.ok(url.startsWith(PREFIX), 'started from a data: URL');
      const code = decodeURIComponent(url.slice(PREFIX.length));
      const boot = `const { parentPort } = require('node:worker_threads');
globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
const scope = Object.create(globalThis.WorkerGlobalScope.prototype);
scope.performance = performance;
scope.postMessage = (d, t) => parentPort.postMessage(d, t);
globalThis.self = scope;
parentPort.on('message', (data) => { if (scope.onmessage) scope.onmessage({ data }); });
${code}`;
      this.onmessage = null;
      this.onerror = null;
      this.terminated = false;
      this.w = new NodeWorker(boot, { eval: true });
      this.w.on('message', (data) => { if (this.onmessage) this.onmessage({ data }); });
      this.w.on('error', (e) => { if (this.onerror) this.onerror(e); });
      this.exited = new Promise((resolve) => this.w.on('exit', resolve));
      log.push(this);
    }
    postMessage(data, transfer) { this.w.postMessage(data, transfer); }
    terminate() {
      this.terminated = true;
      this.w.terminate();
    }
  };
}

test('build: the Worker bundle is one classic script of src/ modules only', () => {
  assert.ok(WORKER.code.length > 5000);
  assert.ok(WORKER.inputs.every((i) => i.startsWith('src/js/')), WORKER.inputs.join(', '));
  assert.ok(WORKER.inputs.includes('src/js/measurement/analysis-worker.js'));
  assert.ok(!/\bimportScripts\b|\bfetch\s*\(|\bimport\s*\(/.test(WORKER.code));
  assert.ok(workerDataUrl('x').startsWith(PREFIX));
  // The runner reads the global the library assigns; under node there is none.
  assert.equal(RUNNER_GLOBAL, ANALYSIS_LIBRARY_GLOBAL);
  assert.ok(WORKER.code.includes(`globalThis.${ANALYSIS_LIBRARY_GLOBAL}=`));
  assert.equal(EMBEDDED_WORKER_SOURCE, null);
});

for (const [name, opts] of [['1 run, noise', { runs: 1 }],
  ['3 runs, noise, phase', { runs: 3, phase: true }], ['2 runs, no noise', { runs: 2,
    noise: false }]]) {
  test(`Worker result is bit-identical to analyzeInline: ${name}`, async () => {
    const m = message(opts);
    const ref = await analyzeInline(copyOf(m));
    const log = [];
    const analyze = createWorkerAnalyze({ source: WORKER.code, WorkerCtor: shimWorkerClass(log) });
    const steps = [];
    const res = await analyze(m, { onStep: (s) => steps.push(s) });
    assert.deepStrictEqual(stepsless(res), stepsless(ref));
    assert.deepStrictEqual(steps.map((s) => [s.name, s.run]), ref.steps.map((s) => [s.name,
      s.run]));
    assert.ok(steps.every((s) => typeof s.ms === 'number'), 'Worker step times');
    // Captures and noise moved to the Worker (detached here); the stimulus was copied.
    assert.ok(m.captures.every((c) => c.length === 0));
    if (m.noise) assert.equal(m.noise.length, 0);
    assert.equal(m.stimulus.length, N);
    assert.equal(log.length, 1);
    assert.equal(log[0].terminated, true, 'terminated after the reply');
    await log[0].exited;
    assert.equal(analyze.lastFallback, null);
  });
}

test('Worker with keepRaw: nothing is transferred, the result is the same', async () => {
  const m = message({ runs: 2 });
  const ref = runAnalysis(copyOf(m));
  const log = [];
  const res = await createWorkerAnalyze({ source: WORKER.code,
    WorkerCtor: shimWorkerClass(log) })(m, { keepRaw: true });
  assert.deepStrictEqual(stepsless(res), stepsless(ref));
  assert.ok(m.captures.every((c) => c.length > N));
  await log[0].exited;
});

test('Worker abort: the signal terminates the Worker and rejects with ABORTED', async () => {
  const m = message({ runs: 3 });
  const log = [];
  const ac = new AbortController();
  const p = createWorkerAnalyze({ source: WORKER.code, WorkerCtor: shimWorkerClass(log) })(m, {
    signal: ac.signal, onStep: () => ac.abort() });
  await assert.rejects(p, (e) => e.code === 'ABORTED');
  assert.equal(log[0].terminated, true);
  await log[0].exited;
  // A throwing onStep (the engine after its own abort) stops the Worker too.
  const log2 = [];
  const q = createWorkerAnalyze({ source: WORKER.code, WorkerCtor: shimWorkerClass(log2) })(
    message({ runs: 2 }), { onStep: () => { throw new Error('dead session'); } });
  await assert.rejects(q, /dead session/);
  assert.equal(log2[0].terminated, true);
  await log2[0].exited;
});

test('Worker errors: an analysis error is rethrown with its class; RangeError stays one',
  async () => {
    const log = [];
    const bad = { ...message(), f1: 0 }; // rejected by checkMessage inside the Worker
    const p = createWorkerAnalyze({ source: WORKER.code, WorkerCtor: shimWorkerClass(log) })(bad);
    await assert.rejects(p, (e) => e instanceof RangeError && /f1 and f2/.test(e.message));
    await log[0].exited;
  });

test('fallback: no Worker start, or a failure before ready, runs inline with intact arrays',
  async () => {
    const m = message({ runs: 2 });
    const ref = runAnalysis(copyOf(m));
    const throwing = class { constructor() { throw new Error('CSP blocks data: workers'); } };
    const a1 = createWorkerAnalyze({ source: WORKER.code, WorkerCtor: throwing });
    assert.deepStrictEqual(stepsless(await a1(m)), stepsless(ref));
    assert.match(a1.lastFallback, /CSP/);
    const failing = class {
      constructor() { setTimeout(() => this.onerror({ message: 'script error' }), 0); }
      postMessage() { throw new Error('never posted'); }
      terminate() { this.terminated = true; }
    };
    const m2 = message({ runs: 2 });
    const a2 = createWorkerAnalyze({ source: WORKER.code, WorkerCtor: failing });
    const yields = [];
    const res = await a2(m2, { yield: async () => { yields.push(1); } });
    assert.deepStrictEqual(stepsless(res), stepsless(ref));
    assert.ok(yields.length > 0, 'the inline fallback got the hooks');
    assert.match(a2.lastFallback, /before the analysis: script error/);
    assert.ok(m2.captures.every((c) => c.length > N));
  });

test('defaultAnalyze: inline under node and without an embedded script', () => {
  assert.equal(defaultAnalyze(), analyzeInline);
  assert.equal(defaultAnalyze({ source: null, WorkerCtor: class {} }), analyzeInline);
  assert.equal(defaultAnalyze({ source: 'x', WorkerCtor: class {} }).mode, 'worker');
});

test('serveAnalysis: ready, one message per step, then the result (fake scope)', () => {
  const posted = [];
  const scope = { postMessage: (d, t) => posted.push({ d, t }) };
  serveAnalysis(scope, { now: () => 0 });
  assert.deepStrictEqual(posted[0].d, { kind: 'ready' });
  const m = message({ runs: 2 });
  scope.onmessage({ data: copyOf(m) });
  const kinds = posted.slice(1).map((p) => p.d.kind);
  assert.deepStrictEqual(kinds, ['step', 'step', 'step', 'step', 'step', 'result']);
  const res = posted.at(-1);
  assert.deepStrictEqual(res.d.result, runAnalysis(copyOf(m), { now: () => 0 }));
  assert.ok(res.t.length > 0, 'result arrays are transferred');
  scope.onmessage({ data: { type: 'nope' } });
  assert.equal(posted.at(-1).d.kind, 'error');
  assert.equal(posted.at(-1).d.error.name, 'TypeError');
});

// ----------------------------------------------------------------- memory accounting
test('estimateAnalysisMemory: FFT size and the documented model', () => {
  const e = estimateAnalysisMemory({ stimulusFrames: 1000, captureFrames: 3000, runs: 2,
    noiseFrames: 500 });
  assert.equal(e.fftSize, 4096);
  const m = ANALYSIS_MEMORY_MODEL;
  assert.equal(e.bytes, m.fixedBytes + m.bytesPerFftPoint * 4096
    + m.bytesPerInputFrame * (1000 + 2 * 3000 + 500));
  assert.throws(() => estimateAnalysisMemory({ stimulusFrames: 1.5, captureFrames: 1 }),
    RangeError);
  // The largest 48 kHz recipe stays inside the contract; 96 kHz × 30 s does not.
  const at = (sr, d, runs = 1) => estimateAnalysisMemory({ stimulusFrames: Math.round(d * sr),
    captureFrames: Math.ceil((d + 2) * sr) + 256, runs, noiseFrames: sr });
  assert.equal(at(48000, 30).fftSize, 2 ** 22);
  assert.ok(at(48000, 30, 10).bytes <= CONTRACT_LIMITS.maxAnalysisBytes);
  assert.equal(at(96000, 30).fftSize, 2 ** 23);
  assert.ok(at(48000, 10).bytes < PREFLIGHT_THRESHOLDS.analysisMemoryWarnBytes);
  assert.ok(at(48000, 30).bytes > PREFLIGHT_THRESHOLDS.analysisMemoryWarnBytes);
});

const bigRecipe = (duration, o = {}) => ({ stimulus: { kind: 'log-sweep', duration, level: 0.25,
  f1: 20, f2: 20000, fade: 0.01 }, repeats: o.repeats || 1, analysis: { noiseCheckS: 1 } });

test('validateRecipe: MEMORY_LIMIT with the estimate when the analysis exceeds the budget',
  () => {
    const ok = validateRecipe(bigRecipe(30), { sampleRate: 48000,
      limits: CONTRACT_LIMITS });
    assert.equal(ok.analysis.fftSize, 2 ** 22);
    assert.ok(ok.analysis.bytes > 0);
    const err = (() => {
      try {
        validateRecipe(bigRecipe(30), { sampleRate: 96000, limits: CONTRACT_LIMITS });
      } catch (e) { return e; }
      return null;
    })();
    assert.equal(err && err.code, 'MEMORY_LIMIT');
    assert.equal(err.detail.fftSize, 2 ** 23);
    assert.equal(err.detail.maxAnalysisFftSize, 2 ** 22);
    assert.ok(err.detail.analysisBytes > 2 ** 30);
    assert.match(err.message, /8388608-point analysis.*at most 20\.\d s/);
    // The suggested longest sweep is accepted, 0.1 s more is not.
    const longest = err.detail.longestSweepS;
    assert.equal(validateRecipe(bigRecipe(longest), { sampleRate: 96000,
      limits: CONTRACT_LIMITS }).analysis.fftSize, 2 ** 22);
    assert.throws(() => validateRecipe(bigRecipe(longest + 0.1), { sampleRate: 96000,
      limits: CONTRACT_LIMITS }), (e) => e.code === 'MEMORY_LIMIT');
    // A tightened byte budget blocks on bytes.
    assert.throws(() => validateRecipe(bigRecipe(10), { sampleRate: 48000,
      limits: { ...CONTRACT_LIMITS, maxAnalysisBytes: 2 ** 28 } }),
    (e) => e.code === 'MEMORY_LIMIT' && /MiB of analysis memory/.test(e.message));
  });

function simpleIo({ sampleRate = SR } = {}) {
  let t = 1;
  let run = 0;
  return {
    sampleRate,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate,
        permission: 'granted', input: { ok: true, device: { label: null, id: null },
          constraints: { requested: null, applied: { echoCancellation: false,
            noiseSuppression: false, autoGainControl: false } } },
        inputLevel: { peak: 0.001, rmsDb: -80 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' } };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate, samples: uniform(77, Math.round(seconds * sampleRate), 2e-3),
        preRoll: 0, postRoll: 0, startedAt, constraints: { requested: null, applied: null },
        device: { label: null, id: null } };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * sampleRate);
      const frames = pre + stimulus.samples.length + Math.round(postRollS * sampleRate);
      const samples = uniform(10 + run, frames, 2e-3);
      const x = stimulus.samples;
      for (let i = 0; i < x.length; i++) samples[pre + i] += 0.5 * x[i];
      run += 1;
      const startedAt = Math.max(t + 0.01, notBefore ?? -Infinity);
      t = startedAt + frames / sampleRate;
      return { sampleRate, samples, preRoll: preRollS, postRoll: postRollS, startedAt,
        stimulusStartAt: startedAt + preRollS, constraints: { requested: null, applied: {
          echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
        device: { label: null, id: null } };
    },
    cancel() {},
    dispose() {},
  };
}

test('preflight: ANALYSIS_MEMORY warning above the threshold, MEMORY_LIMIT blocker above the '
  + 'budget', async () => {
  const io = simpleIo({ sampleRate: 48000 });
  const warn = await createMeasurementEngine({ io }).preflight(bigRecipe(30));
  assert.equal(warn.ready, true);
  const w = warn.warnings.find((x) => x.code === 'ANALYSIS_MEMORY');
  assert.ok(w && w.value > PREFLIGHT_THRESHOLDS.analysisMemoryWarnBytes, JSON.stringify(w));
  assert.equal(w.detail.fftSize, 2 ** 22);
  const quiet = await createMeasurementEngine({ io: simpleIo({ sampleRate: 48000 }) })
    .preflight(bigRecipe(5));
  assert.ok(!quiet.warnings.some((x) => x.code === 'ANALYSIS_MEMORY'));
  const blocked = await createMeasurementEngine({ io: simpleIo({ sampleRate: 96000 }) })
    .preflight(bigRecipe(30));
  assert.equal(blocked.ready, false);
  const b = blocked.blockers.find((x) => x.code === 'MEMORY_LIMIT');
  assert.ok(b && b.detail.fftSize === 2 ** 23, JSON.stringify(blocked.blockers));
  // limits tighten the FFT cap.
  const tight = await createMeasurementEngine({ io: simpleIo({ sampleRate: 48000 }),
    limits: { maxAnalysisFftSize: 2 ** 20 } }).preflight(bigRecipe(10));
  assert.equal(tight.ready, false);
});

const RECIPE = { stimulus: { kind: 'log-sweep', duration: 1, level: 0.5, f1: 50, f2: 3000,
  fade: 0.01 }, repeats: 2, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0 } };

test('engine: analyze gets an AbortSignal that abort() fires', async () => {
  let seen = null;
  let release;
  const engine = createMeasurementEngine({ io: simpleIo(), analyze: (msg, hooks) => {
    seen = hooks.signal;
    return new Promise((resolve) => { release = resolve; });
  } });
  const p = engine.measure(RECIPE);
  for (let i = 0; i < 200 && !seen; i++) await new Promise((r) => setImmediate(r));
  assert.ok(seen && seen.aborted === false);
  assert.equal(engine.abort('user'), true);
  await assert.rejects(p, (e) => e.code === 'ABORTED');
  assert.equal(seen.aborted, true);
  release(null);
});

test('engine with the real Worker bundle equals the inline engine', async () => {
  const clock = { wall: () => 0, mono: () => 0 };
  const inline = await createMeasurementEngine({ io: simpleIo(), clock }).measure(RECIPE);
  const log = [];
  const worker = await createMeasurementEngine({ io: simpleIo(), clock,
    analyze: createWorkerAnalyze({ source: WORKER.code, WorkerCtor: shimWorkerClass(log) }) })
    .measure(RECIPE);
  const stable = (r) => ({ ...r, startedAtMs: null, timeline: { ...r.timeline,
    analysis: { ...r.timeline.analysis, startedAtMs: null, totalMs: null, longestMs: null,
      steps: r.timeline.analysis.steps.map((s) => ({ ...s, ms: null })) } } });
  assert.equal(inline.state, 'COMPLETE');
  assert.deepStrictEqual(stable(worker), stable(inline));
  await log[0].exited;
});

// ----------------------------------------------------------------- IR length cap
test('capIrLength: untouched below the cap; a window around the peak with truncation above',
  () => {
    const ir = { algorithm: ALGORITHMS.ir, method: 'spectral', sampleRate: 1000,
      samples: Float32Array.from({ length: 100 }, (_, i) => (i === 30 ? 1 : 0.01 * i)),
      peakIndex: 30, peakTimeS: 0.03, captureOffsetS: 0.5, noiseFloorDb: -40, window: null,
      fftSize: 256 };
    assert.equal(capIrLength(ir, 100), ir);
    const c = capIrLength(ir, 40);
    assert.deepStrictEqual(c.truncation, { maxSamples: 40, fullLength: 100, startIndex: 10 });
    assert.deepStrictEqual(c.samples, ir.samples.slice(10, 50));
    assert.equal(c.samples[c.peakIndex], 1);
    assert.equal(c.captureOffsetS + c.peakTimeS, ir.captureOffsetS + ir.peakTimeS);
    assert.equal(c.noiseFloorDb, ir.noiseFloorDb);
    assert.equal(ir.samples.length, 100, 'the input is not modified');
    const head = capIrLength(ir, 70); // peak in the first half: the start is kept
    assert.equal(head.truncation.startIndex, 0);
    assert.equal(head.peakIndex, 30);
    const late = capIrLength({ ...ir, peakIndex: 95 }, 20); // window ends at the IR end
    assert.equal(late.truncation.startIndex, 80);
    assert.equal(IR_MAX_SAMPLES, 2 ** 21);
  });

test('runAnalysis: a capped IR changes nothing else; it stores and re-imports byte for byte',
  async () => {
    const full = runAnalysis(message({ runs: 2 }));
    const capped = runAnalysis(message({ runs: 2, irMaxSamples: 4000 }));
    assert.deepStrictEqual(capped.transfers, full.transfers);
    assert.deepStrictEqual(capped.aggregate, full.aggregate);
    assert.equal(full.ir.truncation, undefined);
    assert.deepStrictEqual(capped.ir.truncation, { maxSamples: 4000,
      fullLength: full.ir.samples.length, startIndex: 0 });
    assert.deepStrictEqual(capped.ir.samples, full.ir.samples.slice(0, 4000));

    // Through the engine (inline) into a stored experiment and back.
    const engine = createMeasurementEngine({ io: simpleIo(), analyze: (msg, hooks) =>
      analyzeInline({ ...msg, irMaxSamples: 4000 }, hooks) });
    const result = await engine.measure({ ...RECIPE, repeats: 1 });
    assert.equal(result.ir.truncation.maxSamples, 4000);
    const e0 = createExperiment({
      recipe: createRecipe({ stimulus: result.recipe.stimulus, repeats: 1,
        analysis: result.recipe.analysis }),
      now: '2026-10-02T10:00:00.000Z', id: 'm10-ir', sampleRate: SR,
      algorithms: { transfer: ALGORITHMS.transfer, ir: ALGORITHMS.ir } });
    const e1 = withResults(e0, { results: resultsFromMeasurement(result) });
    const e = withResultHash(e1, resultHash(e1));
    const json = experimentToJson(e);
    const v = validateExperiment(json, { knownAlgorithms: KNOWN_ALGORITHM_IDS });
    assert.ok(v.ok, JSON.stringify(v.errors));
    assert.deepStrictEqual(v.experiment.results.ir.truncation, result.ir.truncation);
    assert.equal(experimentToJson(v.experiment), json, 'byte-identical re-export');
    // A truncation that does not describe the stored samples is rejected.
    const bad = JSON.parse(json);
    bad.provenance.resultHash = null;
    bad.results.ir.truncation.maxSamples = 3999;
    const vb = validateExperiment(bad, { knownAlgorithms: KNOWN_ALGORITHM_IDS });
    assert.equal(vb.ok, false);
    assert.ok(vb.errors.some((x) => x.path === 'results.ir.truncation.maxSamples'));
  });
