// G21 preparation: the offline analysis as one serializable task (measurement/analysis-task.js)
// that engine.js calls through an injected `analyze` (default analyzeInline). Checked here:
//   - runAnalysis is bit-identical to the analysis engine.js ran before the module existed
//     (replicated below from the same primitives, in the same order, with the same shared FFT
//     plan and noise spectrum), for one and three runs, with and without phase and noise;
//   - the message and the result are structured-cloneable with their transfer lists, and the
//     cloned message gives the same result (what a data: Worker would compute);
//   - analyzeInline yields before every step and never after the last, reports every step;
//   - the engine with a Worker-like analyze (clone in, runAnalysis, clone out, no per-step
//     hooks) produces the same measurement as with the default, and keeps raw PCM on keepRaw.
// All inputs are seeded (mulberry32); every assertion is exact.
import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../../src/js/audio/noise.js';
import { renderStimulus } from '../../src/js/measurement/stimulus.js';
import { align } from '../../src/js/measurement/align.js';
import {
  computeTransfer, fftPlan, nextPowerOfTwo, noiseSpectrum,
} from '../../src/js/measurement/transfer.js';
import { computeTransferAndIr } from '../../src/js/measurement/impulse-response.js';
import { aggregateRuns } from '../../src/js/measurement/aggregate.js';
import {
  ANALYSIS_RESULT, ANALYSIS_TASK, ANALYSIS_TASK_VERSION, analysisMessage,
  analysisResultTransferList, analysisSteps, analysisTransferList, analyzeInline, checkMessage,
  runAnalysis,
} from '../../src/js/measurement/analysis-task.js';
import { createMeasurementEngine } from '../../src/js/measurement/engine.js';

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

/** Stimulus × gain at `pre` + seeded noise. */
function capture(seed, { pre = 2000, post = 4000, gain = 0.5, amp = 2e-3 } = {}) {
  const y = uniform(seed, pre + N + post, amp);
  for (let i = 0; i < N; i++) y[pre + i] += gain * STIM.samples[i];
  return y;
}

const NOISE = uniform(99, 2000 + N + 4000, 2e-3);

/** The analysis of engine.js before analysis-task.js (8628438..d689631), verbatim in effect. */
function legacyAnalysis({ captures, noise, phase, aggregation }) {
  const alignments = captures.map((c) => align(STIM.samples, c, SR));
  let best = 0;
  for (let r = 0; r < captures.length; r++) {
    if (alignments[r].peakCorrelation > alignments[best].peakCorrelation) best = r;
  }
  let shared = null;
  let noiseSpec = null;
  const planFor = (captured) => {
    const size = nextPowerOfTwo(N + captured.length);
    if (!shared || shared.size !== size) shared = fftPlan(size);
    return shared;
  };
  const noiseFor = (fft) => {
    if (!noise) return null;
    if (!noiseSpec || noiseSpec.fftSize !== fft.size) {
      noiseSpec = noiseSpectrum(noise, fft.size, fft);
    }
    return noiseSpec;
  };
  const transfers = [];
  let ir = null;
  captures.forEach((captured, r) => {
    const args = { stimulus: STIM.samples, captured, sampleRate: SR, f1: SPEC.f1, f2: SPEC.f2,
      lagSamples: alignments[r].lagSamples, alignment: alignments[r], noise,
      options: { phase } };
    const fft = planFor(captured);
    if (r === best) {
      const both = computeTransferAndIr({ ...args, fft, noiseSpectrum: noiseFor(fft),
        irLagSamples: Math.max(0, alignments[r].lagSamples) });
      transfers.push(both.transfer);
      ir = both.ir;
    } else {
      transfers.push(computeTransfer({ ...args, fft, noiseSpectrum: noiseFor(fft) }));
    }
  });
  const aggregate = aggregateRuns(transfers.map((t) => t.magnitudeDb), { method: aggregation });
  return { alignments, transfers, best, ir, aggregate };
}

const message = (captures, o = {}) => analysisMessage({ stimulus: STIM.samples, sampleRate: SR,
  f1: SPEC.f1, f2: SPEC.f2, captures, noise: o.noise === undefined ? NOISE : o.noise,
  phase: o.phase ?? true, aggregation: o.aggregation ?? 'mean' });

const CASES = [
  ['one run, phase, noise', [capture(1)], {}],
  ['three runs, phase, noise, mean', [capture(1), capture(2, { gain: 0.6 }), capture(3)], {}],
  ['three runs, no phase, no noise, median', [capture(4), capture(5), capture(6, { pre: 2400 })],
    { phase: false, noise: null, aggregation: 'median' }],
];

for (const [name, captures, o] of CASES) {
  test(`runAnalysis is bit-identical to the previous engine analysis: ${name}`, () => {
    const legacy = legacyAnalysis({ captures, noise: o.noise === undefined ? NOISE : o.noise,
      phase: o.phase ?? true, aggregation: o.aggregation ?? 'mean' });
    const before = captures.map((c) => Float32Array.from(c));
    const r = runAnalysis(message(captures, o));
    assert.equal(r.type, ANALYSIS_RESULT);
    assert.equal(r.version, ANALYSIS_TASK_VERSION);
    assert.equal(r.invalid, false);
    assert.deepStrictEqual(r.reasons, []);
    assert.deepStrictEqual(r.alignments, legacy.alignments);
    assert.deepStrictEqual(r.transfers, legacy.transfers);
    assert.equal(r.best, legacy.best);
    assert.deepStrictEqual(r.ir, legacy.ir);
    assert.deepStrictEqual(r.aggregate, legacy.aggregate);
    const names = r.steps.map((s) => s.name);
    assert.deepStrictEqual(names, [...captures.map(() => 'align'), ...captures.map((_, i) =>
      (i === r.best ? 'transfer+impulse-response' : 'transfer')), 'aggregate']);
    assert.ok(r.steps.every((s) => s.ms === null), 'no clock: no timing');
    captures.forEach((c, i) => assert.deepStrictEqual(c, before[i], 'inputs not mutated'));
  });
}

test('message and result are structured-cloneable with their transfer lists', () => {
  const captures = CASES[1][1];
  const reference = runAnalysis(message(captures));
  // What a Worker receives: a clone whose capture buffers were transferred (moved).
  const owned = message(captures.map((c) => c.slice()), { noise: NOISE.slice() });
  const list = analysisTransferList(owned);
  assert.equal(list.length, 4, 'three captures and the noise, the stimulus copied');
  assert.ok(!list.includes(owned.stimulus.buffer));
  const received = structuredClone(owned, { transfer: list });
  assert.equal(owned.captures[0].length, 0, 'moved, not copied');
  assert.equal(owned.stimulus.length, N, 'the stimulus stays with the sender');
  const inWorker = runAnalysis(received);
  const reply = structuredClone(inWorker, { transfer: analysisResultTransferList(inWorker) });
  assert.deepStrictEqual(reply, reference);
  assert.deepStrictEqual(analysisTransferList(message(captures), { keepRaw: true }), []);
  // One buffer shared by two captures is listed once (a duplicate would throw DataCloneError).
  const same = capture(7);
  assert.equal(analysisTransferList(message([same, same], { noise: null })).length, 1);
});

test('analyzeInline: a yield before every step, none after the last; every step reported',
  async () => {
    const seen = [];
    let t = 0;
    const r = await analyzeInline(message(CASES[1][1]), {
      now: () => (t += 1),
      yield: async () => { seen.push('yield'); },
      onStep: (s) => seen.push(`${s.name}:${s.run}:${s.ms}`),
    });
    assert.deepStrictEqual(seen, ['yield', 'align:0:1', 'yield', 'align:1:1', 'yield',
      'align:2:1', 'yield', `${r.best === 0 ? 'transfer+impulse-response' : 'transfer'}:0:1`,
      'yield', `${r.best === 1 ? 'transfer+impulse-response' : 'transfer'}:1:1`, 'yield',
      `${r.best === 2 ? 'transfer+impulse-response' : 'transfer'}:2:1`, 'yield',
      'aggregate:null:1']);
    assert.deepStrictEqual({ ...r, steps: null }, { ...runAnalysis(message(CASES[1][1])),
      steps: null });
    assert.deepStrictEqual(r.steps.map((s) => s.ms), [1, 1, 1, 1, 1, 1, 1]);
    // A throwing hook stops the analysis there (the engine's abort).
    let steps = 0;
    await assert.rejects(analyzeInline(message(CASES[1][1]), {
      onStep: () => { steps += 1; if (steps === 2) throw new Error('aborted'); },
    }), /aborted/);
    assert.equal(steps, 2);
  });

test('invalid captures: NO_ALIGNMENT and STIMULUS_OUTSIDE_CAPTURE after all alignments',
  async () => {
    const silent = new Float32Array(2000 + N + 4000);
    const late = capture(8, { pre: 1000, post: 0 }).slice(0, 1000 + N - 400); // tail cut off
    const seen = [];
    const r = await analyzeInline(message([capture(1), silent, late]), {
      yield: async () => seen.push('yield'), onStep: (s) => seen.push(s.name) });
    assert.equal(r.invalid, true);
    assert.deepStrictEqual(r.reasons.map((x) => [x.code, x.run]),
      [['NO_ALIGNMENT', 1], ['STIMULUS_OUTSIDE_CAPTURE', 2]]);
    assert.equal(r.reasons[1].value, r.alignments[2].lagSamples);
    assert.equal(r.reasons[0].text, 'Run 2: the stimulus was not found in the capture.');
    assert.deepStrictEqual(seen, ['yield', 'align', 'yield', 'align', 'yield', 'align']);
    assert.deepStrictEqual([r.transfers, r.best, r.ir, r.aggregate], [null, null, null, null]);
    assert.equal(r.alignments.length, 3);
  });

test('checkMessage rejects malformed messages; analysisSteps validates first', () => {
  const ok = message([capture(1)]);
  assert.doesNotThrow(() => checkMessage(ok));
  assert.equal(ok.type, ANALYSIS_TASK);
  const bad = [
    [{ ...ok, type: 'x' }, TypeError], [{ ...ok, version: 2 }, TypeError],
    [{ ...ok, stimulus: Array.from(STIM.samples) }, TypeError],
    [{ ...ok, sampleRate: 0 }, RangeError], [{ ...ok, f2: 10 }, RangeError],
    [{ ...ok, captures: [] }, TypeError], [{ ...ok, captures: [new Float64Array(4)] }, TypeError],
    [{ ...ok, noise: [0] }, TypeError], [{ ...ok, phase: 1 }, TypeError],
    [{ ...ok, aggregation: 'trimmed' }, RangeError], [null, TypeError],
  ];
  for (const [m, E] of bad) {
    assert.throws(() => checkMessage(m), E);
    assert.throws(() => analysisSteps(m).next(), E);
  }
});

// ----------------------------------------------------------------------------- engine

/** Minimal io: captures are the stimulus at the pre-roll through gain 0.5 + seeded noise. */
function simpleIo() {
  let t = 1;
  let run = 0;
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: { ok: true, device: { label: null, id: null },
          constraints: { requested: null, applied: { echoCancellation: false,
            noiseSuppression: false, autoGainControl: false } } },
        inputLevel: { peak: 0.001, rmsDb: -80 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' } };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: uniform(77, Math.round(seconds * SR), 2e-3), preRoll: 0,
        postRoll: 0, startedAt, constraints: { requested: null, applied: null },
        device: { label: null, id: null } };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * SR);
      const frames = pre + stimulus.samples.length + Math.round(postRollS * SR);
      const samples = uniform(10 + run, frames, 2e-3);
      const x = stimulus.samples;
      for (let i = 0; i < x.length; i++) samples[pre + i] += 0.5 * x[i];
      run += 1;
      const startedAt = Math.max(t + 0.01, notBefore ?? -Infinity);
      t = startedAt + frames / SR;
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt,
        stimulusStartAt: startedAt + preRollS, constraints: { requested: null, applied: {
          echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
        device: { label: null, id: null } };
    },
    cancel() {},
    dispose() {},
  };
}

const RECIPE = { stimulus: { kind: 'log-sweep', duration: 1, level: 0.5, f1: 50, f2: 3000,
  fade: 0.01 }, repeats: 3, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0, phase: true } };

/** A Worker stand-in: clone in (captures moved), runAnalysis, clone out; no per-step hooks. */
function workerLike(calls) {
  return async (msg, { keepRaw }) => {
    calls.push({ keepRaw, transferred: analysisTransferList(msg, { keepRaw }).length });
    const received = structuredClone(msg, { transfer: analysisTransferList(msg, { keepRaw }) });
    const r = runAnalysis(received);
    return structuredClone(r, { transfer: analysisResultTransferList(r) });
  };
}

const stable = (r) => ({ ...r, startedAtMs: null, timeline: { ...r.timeline,
  analysis: { ...r.timeline.analysis, startedAtMs: null, totalMs: null, longestMs: null,
    steps: r.timeline.analysis.steps.map((s) => ({ ...s, ms: null })) } } });

test('engine: an injected Worker-like analyze gives the same measurement as the default',
  async () => {
    const clock = { wall: () => 0, mono: () => 0 };
    const inline = await createMeasurementEngine({ io: simpleIo(), clock }).measure(RECIPE);
    const calls = [];
    const events = [];
    const worker = await createMeasurementEngine({ io: simpleIo(), clock,
      analyze: workerLike(calls), onEvent: (e) => { if (e.type === 'analysis') events.push(e); } })
      .measure(RECIPE);
    assert.equal(inline.state, 'COMPLETE');
    assert.deepStrictEqual(stable(worker), stable(inline));
    assert.deepStrictEqual(calls, [{ keepRaw: false, transferred: 4 }]);
    // Steps reported when the reply arrives, in order, as 'analysis' events too.
    assert.deepStrictEqual(worker.timeline.analysis.steps.map((s) => s.name),
      inline.timeline.analysis.steps.map((s) => s.name));
    assert.equal(events.length, 7);
    // keepRaw: nothing is transferred and the raw PCM comes back intact.
    const calls2 = [];
    const raw = await createMeasurementEngine({ io: simpleIo(), clock,
      analyze: workerLike(calls2) }).measure(RECIPE, { keepRaw: true });
    assert.deepStrictEqual(calls2, [{ keepRaw: true, transferred: 0 }]);
    assert.ok(raw.runs.every((r) => r.raw instanceof Float32Array && r.raw.length > N));
  });

test('engine: the default analysis equals runAnalysis of the engine message', async () => {
  let captured = null;
  const r = await createMeasurementEngine({ io: simpleIo(), analyze: async (msg, hooks) => {
    captured = { msg, copy: { ...msg, captures: msg.captures.map((c) => c.slice()),
      noise: msg.noise.slice() } };
    return analyzeInline(msg, hooks);
  } }).measure(RECIPE);
  const ref = runAnalysis(captured.copy);
  assert.deepStrictEqual(r.runs.map((x) => x.alignment), ref.alignments);
  assert.deepStrictEqual(r.runs.map((x) => x.transfer), ref.transfers);
  assert.deepStrictEqual(r.aggregate, ref.aggregate);
  assert.deepStrictEqual({ ...r.ir, run: undefined }, { ...ref.ir, run: undefined });
  assert.equal(r.ir.run, ref.best);
  assert.equal(captured.msg.phase, true);
  assert.equal(captured.msg.aggregation, 'mean');
});
