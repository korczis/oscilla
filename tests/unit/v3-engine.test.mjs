// V3 MeasurementEngine orchestration (src/js/measurement/engine.js) with a fake io adapter:
// state flow, repeats without overlap, abort in every stage (spec §218), progress from the fake
// audio clock (§110, §217), recipe validation and limits (§174), typed errors (§112), raw
// buffer lifecycle (§173) and a known synthetic system recovered through the whole engine.
//
// The fake io simulates what capture.js does in a browser: an audio clock that advances in
// capture chunks, captures scheduled at absolute clock times with pre- and post-roll, the
// stimulus passed through a known discrete-time system (RBJ biquad or gain + delay) plus a
// fixed device latency and seeded noise. Expected values are derived analytically here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMeasurementEngine,
  validateRecipe,
  planTimeline,
  mapError,
  MeasurementError,
  CONTRACT_LIMITS,
  MEASUREMENT_LEVELS,
  INPUT_PROCESSING_NOTE,
  assessMeasurement,
} from '../../src/js/measurement/engine.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';

const SR = 48000;

// ----------------------------------------------------------------------------- systems

function rbjLowpass(f0, q, sr) {
  const w0 = (2 * Math.PI * f0) / sr;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0],
    a: [1, (-2 * c) / a0, (1 - alpha) / a0] };
}

function biquadDb({ b, a }, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const ev = (k) => [k[0] + k[1] * Math.cos(w) + k[2] * Math.cos(2 * w),
    -k[1] * Math.sin(w) - k[2] * Math.sin(2 * w)];
  const [nr, ni] = ev(b);
  const [dr, di] = ev(a);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

const biquadSystem = (coef) => (x) => {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const { b, a } = coef;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
};

const gainDelaySystem = (gain, delay) => (x) => {
  const y = new Float64Array(x.length);
  for (let i = delay; i < x.length; i++) y[i] = gain * x[i - delay];
  return y;
};

function seededNoise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

// ----------------------------------------------------------------------------- fake io

/**
 * Fake io. The clock only moves while a capture runs (chunks of chunkS); every chunk awaits a
 * microtask, so an abort issued from a hook lands between chunks like a UI event would.
 * hooks: preflight(), tick({ t, kind, run }), yield(); they may call engine.abort().
 */
function createFakeIo(opts = {}) {
  const {
    sampleRate = SR,
    system = (x) => Float64Array.from(x),
    latencySamples = 123,
    noiseAmp = 1e-5,
    chunkS = 0.05,
    leadS = 0.04,
    clipAtOne = true,
    facts = {},
    hooks = {},
    runError = null,
    noiseError = null,
  } = opts;
  let t = 1.0; // audio clock (s); a context that has been running for a while
  let epoch = 0;
  const rnd = seededNoise(7);
  const io = {
    sampleRate,
    calls: { cancel: 0, preflight: 0, noise: 0, runs: 0, dispose: 0 },
    active: { sources: 0, captures: 0 },
    maxConcurrentCaptures: 0,
    captures: [],
    windows: [],
    now: () => t,
    async preflight() {
      io.calls.preflight += 1;
      if (hooks.preflight) await hooks.preflight();
      return {
        audioContext: { available: true, state: 'running' },
        sampleRate,
        permission: 'granted',
        input: { ok: true, device: { label: null, id: null }, constraints: {
          requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        } },
        inputLevel: { peak: 0.001, rmsDb: -80 },
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' },
        ...facts,
      };
    },
    async captureNoise(seconds, { onScheduled, onChunk } = {}) {
      io.calls.noise += 1;
      if (noiseError) throw noiseError;
      const cs = t + leadS;
      const ce = cs + seconds;
      const frames = Math.round(seconds * sampleRate);
      onScheduled && onScheduled({ captureStartAt: cs, captureEndAt: ce });
      await advance(cs, ce, 'noise', null, frames, onChunk);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = noiseAmp * rnd();
      const cap = { sampleRate, samples, preRoll: 0, postRoll: 0, startedAt: cs,
        constraints: { requested: null, applied: null }, device: { label: null, id: null } };
      io.captures.push(cap);
      return cap;
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled, onChunk } = {}) {
      io.calls.runs += 1;
      const run = io.calls.runs - 1;
      const cs = Math.max(t + leadS, notBefore == null ? -Infinity : notBefore);
      const n = stimulus.samples.length;
      const ss = cs + preRollS;
      const se = ss + n / sampleRate;
      const ce = se + postRollS;
      const frames = Math.round((ce - cs) * sampleRate);
      io.windows.push({ cs, ss, se, ce });
      io.active.sources += 1;
      onScheduled && onScheduled({ captureStartAt: cs, stimulusStartAt: ss, stimulusEndAt: se,
        captureEndAt: ce });
      if (runError) {
        await advance(cs, ss + 0.2, 'run', run, frames, onChunk);
        io.active.sources -= 1;
        throw runError;
      }
      await advance(cs, ce, 'run', run, frames, onChunk);
      io.active.sources -= 1;
      const x = new Float64Array(frames);
      const off = Math.round(preRollS * sampleRate) + latencySamples;
      for (let i = 0; i < n && off + i < frames; i++) x[off + i] = stimulus.samples[i];
      const y = system(x);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let v = y[i] + noiseAmp * rnd();
        if (clipAtOne) v = Math.max(-1, Math.min(1, v));
        samples[i] = v;
      }
      const cap = { sampleRate, samples, preRoll: preRollS, postRoll: postRollS, startedAt: cs,
        stimulusStartAt: ss, constraints: { requested: { echoCancellation: false },
          applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
        device: { label: null, id: null },
        integrity: { expectedFrames: frames, receivedFrames: frames, discontinuities: 0 } };
      io.captures.push(cap);
      return cap;
    },
    cancel() {
      io.calls.cancel += 1;
      epoch += 1;
      io.active.sources = 0;
      io.active.captures = 0;
    },
    dispose() { io.calls.dispose += 1; },
    async yield() { if (hooks.yield) await hooks.yield(); },
  };

  async function advance(from, to, kind, run, frames, onChunk) {
    const my = epoch;
    io.active.captures += 1;
    io.maxConcurrentCaptures = Math.max(io.maxConcurrentCaptures, io.active.captures);
    try {
      while (t < to - 1e-12) {
        await null;
        if (epoch !== my) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' });
        t = Math.min(to, Math.max(t, from - leadS) + chunkS);
        const got = Math.max(0, Math.min(frames, Math.round((t - from) * sampleRate)));
        onChunk && onChunk({ frames: got, framesTotal: frames });
        if (hooks.tick) await hooks.tick({ t, kind, run });
      }
    } finally {
      if (epoch === my) io.active.captures -= 1;
    }
  }
  return io;
}

function sweepRecipe(over = {}) {
  return {
    stimulus: { kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000, fade: 0.01,
      ...(over.stimulus || {}) },
    repeats: over.repeats ?? 1,
    analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0.2,
      ...(over.analysis || {}) },
  };
}

function makeEngine(ioOpts = {}, engOpts = {}) {
  const events = [];
  const io = createFakeIo(ioOpts);
  const engine = createMeasurementEngine({ io, onEvent: (e) => events.push(e), ...engOpts });
  return { io, engine, events };
}

const states = (events) => events.filter((e) => e.type === 'state').map((e) => e.to);
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await null; };

// ----------------------------------------------------------------------------- flow

test('legal flow IDLE → PREFLIGHT → NOISE_CHECK → READY → ARMED → MEASURING → ANALYZING → '
  + 'COMPLETE', async () => {
  const { io, engine, events } = makeEngine();
  assert.equal(engine.state, S.IDLE);
  const result = await engine.measure(sweepRecipe());
  assert.deepEqual(states(events), [S.PREFLIGHT, S.NOISE_CHECK, S.READY, S.ARMED, S.MEASURING,
    S.ANALYZING, S.COMPLETE]);
  assert.equal(engine.state, S.COMPLETE);
  assert.equal(result.state, S.COMPLETE);
  assert.equal(result.runs.length, 1);
  assert.ok(result.transfer && result.ir && result.aggregate && result.noise);
  assert.equal(result.transfer.algorithm, 'oscilla.transfer.v2');
  assert.equal(result.ir.algorithm, 'oscilla.ir.log-sweep.v2');
  assert.equal(result.captureChecks.length, 1);
  assert.equal(result.captureChecks[0].invalid, false);
  assert.ok(io.calls.cancel >= 1, 'resources released at completion');
  assert.equal(io.active.sources + io.active.captures, 0);
  assert.equal(events.at(-1).type, 'result');
  assert.deepEqual(result.notes, [], 'applied constraints confirmed off: no processing note');
});

test('noise check skipped: PREFLIGHT → READY → ARMED', async () => {
  const { engine, events } = makeEngine();
  const r = await engine.measure(sweepRecipe({ analysis: { noiseCheckS: 0 } }));
  assert.equal(r.noise, null);
  assert.deepEqual(states(events).slice(0, 3), [S.PREFLIGHT, S.READY, S.ARMED]);
});

test('standalone preflight → READY, then measure() continues from READY', async () => {
  const { io, engine, events } = makeEngine();
  const recipe = sweepRecipe();
  const report = await engine.preflight(recipe);
  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.ok(report.warnings.some((w) => w.code === 'UNCALIBRATED'), 'calibration availability');
  assert.equal(engine.state, S.READY);
  await engine.measure(recipe);
  assert.equal(io.calls.preflight, 1, 'preflight not repeated');
  assert.deepEqual(states(events), [S.PREFLIGHT, S.READY, S.NOISE_CHECK, S.READY, S.ARMED,
    S.MEASURING, S.ANALYZING, S.COMPLETE]);
});

test('three repeats produce three runs and an aggregate, captures never overlap', async () => {
  const { io, engine, events } = makeEngine();
  const r = await engine.measure(sweepRecipe({ repeats: 3 }));
  assert.equal(r.state, S.COMPLETE);
  assert.equal(r.runs.length, 3);
  assert.equal(r.aggregate.runs, 3);
  // G20: the measurement's transfer is the aggregate centre, marked, storable; no phase.
  assert.equal(r.transfer.derivedFrom, 'aggregate');
  assert.equal(r.transfer.phaseDeg, null);
  assert.equal(r.transfer.phaseReason, 'AGGREGATED');
  assert.ok(r.runs.every((run) => run.transfer && run.transfer.derivedFrom === undefined));
  assert.equal(io.maxConcurrentCaptures, 1, 'one capture at a time');
  const runs = r.timeline.actual.filter((a) => a.phase === 'run');
  assert.equal(runs.length, 3);
  for (let k = 1; k < runs.length; k++) {
    assert.ok(runs[k].captureStartAt >= runs[k - 1].captureEndAt + 0.2 - 1e-9,
      `run ${k} starts after run ${k - 1} + gap`);
  }
  const st = states(events);
  assert.equal(st.filter((x) => x === S.ARMED).length, 3);
  assert.equal(st.filter((x) => x === S.MEASURING).length, 3);
  // Identical deterministic captures (same seed per run differs only by noise): tiny spread.
  assert.ok(r.aggregate.repeatabilityDb < 0.05, `repeatability ${r.aggregate.repeatabilityDb}`);
  // The representative IR keeps samples; per-run IR metadata only for that run.
  assert.ok(r.ir.samples instanceof Float32Array);
  assert.equal(r.runs.filter((x) => x.ir).length, 1);
  assert.equal(r.runs[r.ir.run].ir.length, r.ir.samples.length);
});

// ----------------------------------------------------------------------------- abort

async function abortCase(stage) {
  let engine;
  const hooks = {};
  const fire = () => engine.abort(`test-${stage}`);
  if (stage === 'preflight') hooks.preflight = async () => { fire(); };
  if (stage === 'noise') hooks.tick = ({ kind }) => { if (kind === 'noise') fire(); };
  if (stage === 'sweep' || stage === 'tail') {
    hooks.tick = () => {
      const p = engine.progress();
      if (p && p.phase === stage) fire();
    };
  }
  if (stage === 'analysis') hooks.yield = async () => { if (engine.state === S.ANALYZING) fire(); };
  const made = makeEngine({ hooks });
  engine = made.engine;
  const { io, events } = made;
  await assert.rejects(engine.measure(sweepRecipe({ repeats: 2 })), (e) => {
    assert.ok(e instanceof MeasurementError);
    assert.equal(e.code, 'ABORTED');
    return true;
  });
  const n = events.length;
  await flush(200);
  assert.equal(events.length, n, `${stage}: no events after abort`);
  const last = events.at(-1);
  assert.equal(last.type, 'state');
  assert.equal(last.to, S.ABORTED);
  assert.equal(engine.state, S.ABORTED);
  assert.ok(io.calls.cancel >= 1, `${stage}: io.cancel called`);
  assert.equal(io.active.sources, 0, `${stage}: no active source`);
  assert.equal(io.active.captures, 0, `${stage}: no active capture`);
  assert.equal(engine.progress(), null);
  assert.equal(engine.abort('again'), false, 'second abort is a no-op');
  return { events, io };
}

for (const stage of ['preflight', 'noise', 'sweep', 'tail', 'analysis']) {
  test(`abort during ${stage} → ABORTED, io.cancel, nothing active, no further events`,
    async () => {
      const { events } = await abortCase(stage);
      const st = states(events);
      const before = st.at(-2);
      const expected = { preflight: S.PREFLIGHT, noise: S.NOISE_CHECK, sweep: S.MEASURING,
        tail: S.MEASURING, analysis: S.ANALYZING }[stage];
      assert.equal(before, expected, `aborted from ${expected}`);
    });
}

test('after ABORTED a new measurement starts cleanly', async () => {
  let engine;
  let armed = true;
  const made = makeEngine({ hooks: { tick: ({ kind }) => {
    if (armed && kind === 'noise') engine.abort();
  } } });
  engine = made.engine;
  await assert.rejects(engine.measure(sweepRecipe()), (e) => e.code === 'ABORTED');
  armed = false;
  const r = await engine.measure(sweepRecipe());
  assert.equal(r.state, S.COMPLETE);
  assert.equal(engine.state, S.COMPLETE);
});

// ----------------------------------------------------------------------------- progress

test('progress is monotonic and follows the fake audio clock', async () => {
  let engine;
  const samples = [];
  const hooks = {
    tick: ({ t, kind }) => {
      const p = engine.progress();
      if (kind === 'run' && p) samples.push({ t, ...p });
    },
  };
  const made = makeEngine({ hooks, chunkS: 0.02 });
  engine = made.engine;
  const r = await engine.measure(sweepRecipe({ repeats: 2 }));
  const prog = made.events.filter((e) => e.type === 'progress');
  assert.ok(prog.length > 50, `${prog.length} progress events`);
  for (let i = 1; i < prog.length; i++) {
    assert.ok(prog[i].overall >= prog[i - 1].overall, `monotonic at ${i}`);
  }
  assert.ok(prog.at(-1).overall > 0.99, 'reaches the end');
  const phases = [...new Set(prog.map((p) => p.phase))];
  for (const ph of ['noise', 'pre-roll', 'sweep', 'tail', 'analysis']) {
    assert.ok(phases.includes(ph), `phase ${ph} reported`);
  }
  // Phase fractions are positions on the audio clock against the scheduled times.
  const w = r.timeline.actual.filter((a) => a.phase === 'run')[0];
  for (const s of samples.filter((x) => x.run === 0)) {
    if (s.t > w.stimulusStartAt && s.t < w.stimulusEndAt) {
      assert.equal(s.phase, 'sweep');
      const want = (s.t - w.stimulusStartAt) / (w.stimulusEndAt - w.stimulusStartAt);
      assert.ok(Math.abs(s.phaseFraction - want) < 1e-9);
    }
  }
  // Planned timeline: noise, pre/sweep/tail, gap, pre/sweep/tail.
  assert.deepEqual(r.timeline.planned.map((x) => x.phase), ['noise', 'pre-roll', 'sweep', 'tail',
    'gap', 'pre-roll', 'sweep', 'tail']);
  assert.ok(Math.abs(r.timeline.audioS - (0.5 + 2 * (0.25 + 1 + 0.5) + 0.2)) < 1e-9);
  assert.ok(r.timeline.analysis.steps.length >= 4);
});

// ----------------------------------------------------------------------------- recipes

test('invalid recipes are rejected before any state change', async () => {
  const { engine, events } = makeEngine();
  const bad = [
    { stimulus: { kind: 'white', duration: 1 } },
    sweepRecipe({ repeats: 11 }),
    sweepRecipe({ repeats: 0 }),
    sweepRecipe({ stimulus: { duration: 31 } }),
    sweepRecipe({ stimulus: { level: 2 } }),
    sweepRecipe({ stimulus: { level: 'loud' } }),
    sweepRecipe({ stimulus: { f1: 500, f2: 100 } }),
    sweepRecipe({ stimulus: { duration: 30 }, analysis: { preRollS: 5, postRollS: 10 } }),
    sweepRecipe({ analysis: { gapS: -1 } }),
    sweepRecipe({ analysis: { noiseCheckS: 0.1 } }),
    sweepRecipe({ analysis: { aggregation: 'max' } }),
    null,
  ];
  for (const recipe of bad) {
    await assert.rejects(engine.measure(recipe), (e) => e.code === 'INVALID_RECIPE',
      JSON.stringify(recipe));
  }
  assert.equal(engine.state, S.IDLE);
  assert.equal(events.length, 0);
});

test('limits: contract caps cannot be loosened; memory limit; named levels', () => {
  const e = createMeasurementEngine({ io: createFakeIo(), limits: { maxRepeats: 50,
    maxCaptureS: 20 } });
  assert.equal(e.limits.maxRepeats, CONTRACT_LIMITS.maxRepeats);
  assert.equal(e.limits.maxCaptureS, 20);
  assert.throws(() => validateRecipe(sweepRecipe({ stimulus: { duration: 10 }, repeats: 10 }), {
    sampleRate: SR, limits: { ...CONTRACT_LIMITS, maxRawBytes: 1e6 } }),
  (err) => err.code === 'MEMORY_LIMIT');
  const plan = validateRecipe(sweepRecipe({ stimulus: { level: 'low' } }), { sampleRate: SR });
  assert.equal(plan.stimulusSpec.level, MEASUREMENT_LEVELS.low);
  assert.equal(plan.stimulusSpec.sampleRate, SR, 'rendered at the device rate');
  const p96 = validateRecipe(sweepRecipe({ stimulus: { f2: 30000 } }), { sampleRate: SR });
  assert.equal(p96.clampedTo, 22800, 'Nyquist clamp reported');
  const tl = planTimeline(plan);
  assert.equal(tl.items[0].phase, 'noise');
});

// ----------------------------------------------------------------------------- errors

test('mapError: typed codes from DOM names, codes and validation errors', () => {
  assert.equal(mapError({ name: 'NotAllowedError' }).code, 'MIC_DENIED');
  assert.equal(mapError({ name: 'SecurityError' }).code, 'MIC_DENIED');
  assert.equal(mapError({ name: 'NotFoundError' }).code, 'NO_INPUT');
  assert.equal(mapError({ name: 'OverconstrainedError' }).code, 'NO_INPUT');
  assert.equal(mapError({ name: 'QuotaExceededError' }).code, 'STORAGE_FAILURE');
  assert.equal(mapError({ code: 'CAPTURE_TIMEOUT', message: 'x' }).code, 'CAPTURE_TIMEOUT');
  assert.equal(mapError({ code: 'UNSUPPORTED_WORKLET' }).code, 'UNSUPPORTED_WORKLET');
  assert.equal(mapError(new RangeError('Array buffer allocation failed')).code, 'MEMORY_LIMIT');
  assert.equal(mapError(new Error('boom'), 'ANALYSIS_FAILURE').code, 'ANALYSIS_FAILURE');
  assert.equal(mapError(new Error('boom')).code, 'INTERNAL');
  const m = new MeasurementError('MIC_DISCONNECTED');
  assert.equal(mapError(m), m);
  assert.ok(m.message.length > 10);
});

test('preflight blockers → INVALID: mic denied, suspended context, no worklet, silent output',
  async () => {
    const cases = [
      [{ permission: 'denied' }, 'MIC_DENIED'],
      [{ audioContext: { available: true, state: 'suspended' } }, 'CONTEXT_SUSPENDED'],
      [{ audioContext: { available: false, state: null } }, 'UNSUPPORTED'],
      [{ worklet: { supported: false, mode: null } }, 'UNSUPPORTED_WORKLET'],
      [{ output: { gain: 0, maxGain: 0.25, audibleVoices: 0 } }, 'OUTPUT_SILENT'],
      [{ input: { ok: false, error: { name: 'NotFoundError' } } }, 'NO_INPUT'],
    ];
    for (const [facts, code] of cases) {
      const { engine, io } = makeEngine({ facts });
      const r = await engine.measure(sweepRecipe());
      assert.equal(r.state, S.INVALID, code);
      assert.ok(r.reasons.some((x) => x.code === code), `${code}: ${JSON.stringify(r.reasons)}`);
      assert.equal(engine.state, S.INVALID);
      assert.equal(io.calls.runs, 0);
    }
    // io.preflight throwing a getUserMedia error is a blocker, not a crash.
    const { engine } = makeEngine({ hooks: { preflight: async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    } } });
    const r = await engine.measure(sweepRecipe());
    assert.equal(r.reasons[0].code, 'MIC_DENIED');
  });

test('preflight warnings do not block: clipping, noise, processing, high output, fallback',
  async () => {
    const { engine } = makeEngine({ facts: {
      inputLevel: { peak: 0.99, rmsDb: -20 },
      input: { ok: true, device: { label: null, id: null },
        constraints: { requested: {}, applied: { echoCancellation: null } } },
      output: { gain: 0.25, maxGain: 0.25, audibleVoices: 1 },
      worklet: { supported: true, mode: 'scriptprocessor' },
    } });
    const rep = await engine.preflight(sweepRecipe({ stimulus: { level: 1, f2: 24000 } }));
    assert.equal(rep.ready, true);
    const codes = rep.warnings.map((w) => w.code);
    for (const c of ['INPUT_CLIPPING', 'NOISE_HIGH', 'INPUT_PROCESSING', 'HIGH_OUTPUT',
      'LIMITER_RANGE',
      'OTHER_AUDIO', 'WORKLET_FALLBACK', 'RANGE_CLAMPED', 'UNCALIBRATED', 'LEVEL_RELATIVE']) {
      assert.ok(codes.includes(c), `warning ${c}`);
    }
  });

test('a run failure maps to a typed ERROR; onInterrupt maps a disconnect', async () => {
  const err = Object.assign(new Error('track ended'), { code: 'MIC_DISCONNECTED' });
  const { engine, events, io } = makeEngine({ runError: err });
  await assert.rejects(engine.measure(sweepRecipe()), (e) => e.code === 'MIC_DISCONNECTED');
  assert.equal(engine.state, S.ERROR);
  assert.ok(events.some((e) => e.type === 'error' && e.code === 'MIC_DISCONNECTED'));
  assert.ok(io.calls.cancel >= 1);

  let io2 = null;
  const m2 = makeEngine({ hooks: { tick: ({ kind }) => {
    if (kind === 'run') io2.onInterrupt({ code: 'MIC_DISCONNECTED', reason: 'ended' });
  } } });
  io2 = m2.io;
  await assert.rejects(m2.engine.measure(sweepRecipe()), (e) => e.code === 'MIC_DISCONNECTED');
  assert.equal(m2.engine.state, S.ERROR);
  assert.equal(io2.active.captures, 0);

  const m3 = makeEngine({ noiseError: Object.assign(new Error('t'), { code: 'CAPTURE_TIMEOUT' }) });
  await assert.rejects(m3.engine.measure(sweepRecipe()), (e) => e.code === 'CAPTURE_TIMEOUT');
});

test('invalid calibration is a blocker; analysis failure in assess → ANALYSIS_FAILURE',
  async () => {
    const { engine } = makeEngine();
    const r = await engine.measure(sweepRecipe(), { calibration: { frequency: { kind: 'frequency',
      points: [[100, 'x']] } } });
    assert.equal(r.state, S.INVALID);
    assert.equal(r.reasons[0].code, 'INVALID_CALIBRATION');
    const r2 = await engine.measure(sweepRecipe(), { calibration: { level: { kind: 'level' } } });
    assert.equal(r2.reasons[0].code, 'INVALID_CALIBRATION');
    await assert.rejects(engine.measure(sweepRecipe(), { assess: () => { throw new Error('q'); } }),
      (e) => e.code === 'ANALYSIS_FAILURE');
    assert.equal(engine.state, S.ERROR);
  });

test('capture checks: clipping is graded by quality, severe clipping ends INVALID', async () => {
  // Review M8: CLIPPING is not a run-level invalidation; every run is captured and the quality
  // assessment grades it (CLIPPING_SEVERE invalidates there).
  const { engine, events } = makeEngine({ system: gainDelaySystem(8, 0) });
  const r = await engine.measure(sweepRecipe({ repeats: 3 }), { assess: assessMeasurement });
  assert.equal(r.state, S.INVALID);
  assert.ok(r.reasons.some((x) => x.code === 'CLIPPING_SEVERE'), JSON.stringify(r.reasons));
  assert.equal(r.runs.length, 3, 'all runs captured');
  assert.ok(r.captureChecks.every((c) => c.reasons.some((x) => x.code === 'CLIPPING')
    && c.invalid === false));
  assert.ok(states(events).includes(S.INVALID));
  // Without an assessment the clipped result is COMPLETE, its checks keep the reason.
  const plain = await makeEngine({ system: gainDelaySystem(8, 0) }).engine
    .measure(sweepRecipe());
  assert.equal(plain.state, S.COMPLETE);
  assert.ok(plain.captureChecks[0].reasons.some((x) => x.code === 'CLIPPING'));
});

test('a silent capture ends INVALID with NO_INPUT', async () => {
  const { engine } = makeEngine({ system: (x) => new Float64Array(x.length), noiseAmp: 0 });
  const r = await engine.measure(sweepRecipe({ analysis: { noiseCheckS: 0 } }));
  assert.equal(r.state, S.INVALID);
  assert.ok(r.reasons.some((x) => x.code === 'NO_INPUT'));
});

test('assess is called with the result; an INVALID assessment ends INVALID', async () => {
  const { engine } = makeEngine();
  let seen = null;
  const r = await engine.measure(sweepRecipe(), { assess: (res) => {
    seen = res;
    return { algorithm: 'oscilla.confidence.v1', status: 'GOOD', reasons: [], metrics: {} };
  } });
  assert.equal(seen.state, S.COMPLETE);
  assert.equal(r.quality.status, 'GOOD');
  const r2 = await engine.measure(sweepRecipe(), { assess: () => ({ status: 'INVALID',
    reasons: [{ code: 'SNR', severity: 'fail', text: 'low' }] }) });
  assert.equal(r2.state, S.INVALID);
  assert.equal(engine.state, S.INVALID);
  assert.equal(r2.reasons[0].code, 'SNR');
});

test('processing note when applied constraints are unknown', async () => {
  const io = createFakeIo();
  const orig = io.runStimulus;
  io.runStimulus = async (...a) => {
    const c = await orig(...a);
    c.constraints = { requested: {}, applied: null };
    return c;
  };
  const engine = createMeasurementEngine({ io });
  const r = await engine.measure(sweepRecipe());
  assert.deepEqual(r.notes, [INPUT_PROCESSING_NOTE]);
});

// ----------------------------------------------------------------------------- raw buffers

function findRefs(root, targets) {
  const seen = new Set();
  let hits = 0;
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (targets.has(v)) { hits += 1; return; }
    if (ArrayBuffer.isView(v)) return;
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(root);
  return hits;
}

test('raw capture buffers are dropped unless keepRaw', async () => {
  const a = makeEngine();
  const r = await a.engine.measure(sweepRecipe({ repeats: 2 }));
  const raw = new Set(a.io.captures.map((c) => c.samples));
  assert.equal(raw.size, 3, 'noise + 2 runs captured');
  assert.equal(findRefs(r, raw), 0, 'no raw buffer referenced by the result');
  assert.ok(r.runs.every((x) => x.raw === null));
  assert.equal(r.noise.raw, null);

  const b = makeEngine();
  const rk = await b.engine.measure(sweepRecipe({ repeats: 2 }), { keepRaw: true });
  b.io.captures.forEach((c, i) => {
    if (i === 0) assert.equal(rk.noise.raw, c.samples);
    else assert.equal(rk.runs[i - 1].raw, c.samples);
  });
});

// ----------------------------------------------------------------------------- known systems

test('known biquad recovered through the engine (magnitude within 0.05 dB, 50 Hz-10 kHz)',
  async () => {
    const coef = rbjLowpass(1000, Math.SQRT1_2, SR);
    const { engine } = makeEngine({ system: biquadSystem(coef), latencySamples: 237 });
    const r = await engine.measure(sweepRecipe({ analysis: { noiseCheckS: 0.5 } }));
    assert.equal(r.state, S.COMPLETE);
    const { frequencies, magnitudeDb } = r.transfer;
    let worst = 0;
    let count = 0;
    for (let i = 0; i < frequencies.length; i++) {
      const f = frequencies[i];
      if (f < 50 || f > 10000) continue;
      const d = Math.abs(magnitudeDb[i] - biquadDb(coef, f, SR));
      worst = Math.max(worst, d);
      count += 1;
    }
    assert.ok(count > 300, `${count} grid points`);
    // Tolerance: regularization bias ≤ 0.004 dB in band (transfer.js), 1/48-octave power
    // averaging of a smooth 2nd-order response < 0.01 dB, seeded noise at −100 dBFS against a
    // ≥ −40 dB response gives < 0.02 dB; 0.05 dB bounds their sum.
    assert.ok(worst < 0.05, `worst deviation ${worst.toFixed(4)} dB`);
    assert.ok(r.transfer.snrDb, 'SNR from the noise check');
    // Alignment: stimulus at pre-roll + device latency, plus the low-pass group delay that
    // moves the correlation peak later: √2 / (2π·1 kHz) = 0.225 ms = 10.8 samples at DC for a
    // 2nd-order Butterworth, less above the cutoff.
    const lag = r.runs[0].alignment.lagSamples;
    const want = 0.25 * SR + 237;
    assert.ok(lag >= want && lag <= want + 11, `lag ${lag} vs ${want} + group delay`);
  });

test('known gain + delay recovered exactly: −6.02 dB, lag = pre-roll + latency + delay; '
  + 'calibration correction applied separately', async () => {
  const profile = createFrequencyProfile({ name: 'flat +2', points: [[10, 2], [30000, 2]] });
  const level = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -30, createdAt: '2026-10-02T00:00:00Z' });
  const { engine } = makeEngine({ system: gainDelaySystem(0.5, 100), latencySamples: 50 });
  const r = await engine.measure(sweepRecipe({ repeats: 2, analysis: { phase: true } }),
    { calibration: { frequency: profile, level } });
  assert.equal(r.state, S.COMPLETE);
  const { frequencies, magnitudeDb } = r.transfer;
  const g = 20 * Math.log10(0.5);
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] < 50 || frequencies[i] > 15000) continue;
    assert.ok(Math.abs(magnitudeDb[i] - g) < 0.02, `${frequencies[i]} Hz: ${magnitudeDb[i]}`);
  }
  for (const run of r.runs) {
    assert.ok(Math.abs(run.alignment.lagSamples - (0.25 * SR + 150)) < 0.5);
    assert.ok(run.transfer.phaseDeg, 'phase per run when requested');
  }
  const corr = r.calibrated.frequency.correctedDb;
  for (let i = 0; i < corr.length; i++) assert.ok(Math.abs(corr[i] - (magnitudeDb[i] - 2)) < 1e-9);
  assert.equal(r.calibrated.level.unit, 'dB SPL');
  assert.equal(r.noise.level.unit, 'dB SPL');
  assert.equal(r.algorithms.calibration, 'oscilla.calibration.log-interp.v1');
  // IR: peak at the aligned start (delay included), time relative to the capture offset.
  const abs = r.ir.captureOffsetS + r.ir.peakTimeS;
  assert.ok(Math.abs(abs - (0.25 * SR + 150) / SR) < 2 / SR, `IR peak at ${abs}`);
});

test('dispose aborts and disposes the io', async () => {
  let engine;
  const made = makeEngine({ hooks: { tick: () => engine.dispose() } });
  engine = made.engine;
  await assert.rejects(engine.measure(sweepRecipe()), (e) => e.code === 'ABORTED');
  assert.equal(made.io.calls.dispose, 1);
  await assert.rejects(engine.measure(sweepRecipe()));
});
