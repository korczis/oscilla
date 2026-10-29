// T016 (P05, truth-table row MSR-07): the live CLIPPING item of the MEASURE quality bar says
// only what the run checks established. A run whose peak reached the rail (|x| ≥
// CLIP_THRESHOLD) without a clip region is AT RAIL (warn: brief clipping is not excluded), the
// same judgement assessQuality makes (CLIPPING_NOT_EXCLUDED) for the same capture; a run whose
// peak was not reported is NOT CHECKED; NONE means "no sample at or above 0.98 of digital full
// scale" and nothing more. The bar only reports: the quality status and reasons do not move.
//
// Fixture F1 (end to end through the real engine): a 1 s log sweep at level 0.25 through an
// identity system, with two isolated ±0.995 samples 0.4 s apart inside the sweep (no three
// rail samples within 1 ms, so oscilla.clip.v2 finds no region).

import test from 'node:test';
import assert from 'node:assert/strict';

import { CLIP_THRESHOLD } from '../../src/js/measurement/capture-checks.js';
import {
  createMeasurementEngine, assessMeasurement,
} from '../../src/js/measurement/engine.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import {
  initialQualityBar, reduceQualityBar, qualityBarView,
} from '../../src/js/measurement/views/quality-bar.js';

const SR = 48000;

const clippingOf = (st) => qualityBarView(st).items.find((i) => i.id === 'clipping');
const runEvent = (run, over = {}) => ({ type: 'run', run, invalid: false, reasons: [], ...over });
const reduceAll = (events, st = initialQualityBar()) => events.reduce(reduceQualityBar, st);

/** A synthetic capture io (the shape of tests/unit/v3-views.test.mjs createFakeIo). */
function createFakeIo({ system = (x) => x, noiseAmp = 1e-4 } = {}) {
  let t = 1;
  let epoch = 0;
  const rng = mulberry32(7);
  const rnd = () => rng() - 0.5;
  async function advance(from, to, frames, onChunk) {
    const my = epoch;
    while (t < to - 1e-12) {
      await null;
      if (epoch !== my) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' });
      t = Math.min(to, Math.max(t, from - 0.04) + 0.05);
      onChunk && onChunk({ frames: Math.max(0, Math.min(frames, Math.round((t - from) * SR))),
        framesTotal: frames });
    }
  }
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted',
        input: { ok: true, device: { label: null, id: null }, constraints: {
          requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } } },
        inputLevel: { peak: 0.001, rmsDb: -80 },
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' } };
    },
    async captureNoise(seconds, { onScheduled, onChunk } = {}) {
      const cs = t + 0.04;
      const frames = Math.round(seconds * SR);
      onScheduled && onScheduled({ captureStartAt: cs, captureEndAt: cs + seconds });
      await advance(cs, cs + seconds, frames, onChunk);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = noiseAmp * rnd();
      return { sampleRate: SR, samples, preRoll: 0, postRoll: 0, startedAt: cs,
        constraints: { requested: null, applied: null }, device: { label: null, id: null } };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled, onChunk } = {}) {
      const cs = Math.max(t + 0.04, notBefore == null ? -Infinity : notBefore);
      const n = stimulus.samples.length;
      const ss = cs + preRollS;
      const se = ss + n / SR;
      const ce = se + postRollS;
      const frames = Math.round((ce - cs) * SR);
      onScheduled && onScheduled({ captureStartAt: cs, stimulusStartAt: ss, stimulusEndAt: se,
        captureEndAt: ce });
      await advance(cs, ce, frames, onChunk);
      const x = new Float64Array(frames);
      const off = Math.round(preRollS * SR) + 123;
      for (let i = 0; i < n && off + i < frames; i++) x[off + i] = stimulus.samples[i];
      const y = system(x, off);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = Math.max(-1, Math.min(1, y[i]
        + noiseAmp * rnd()));
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt: cs,
        stimulusStartAt: ss, constraints: { requested: {}, applied: { echoCancellation: false,
          noiseSuppression: false, autoGainControl: false } }, device: { label: null, id: null },
        integrity: { expectedFrames: frames, receivedFrames: frames, discontinuities: 0 } };
    },
    cancel() { epoch += 1; },
    dispose() {},
    async yield() {},
  };
}

/** Two isolated rail samples (+0.995 and −0.995) 0.4 s apart inside the sweep. */
const twoRailSamples = (x, off) => {
  const y = Float64Array.from(x);
  y[off + Math.round(0.3 * SR)] = 0.995;
  y[off + Math.round(0.7 * SR)] = -0.995;
  return y;
};

async function measure(system, repeats = 1) {
  const events = [];
  const engine = createMeasurementEngine({ io: createFakeIo({ system }),
    onEvent: (e) => events.push(e), assess: assessMeasurement });
  const result = await engine.measure({
    stimulus: { kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000 }, repeats,
    analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0.2 } });
  return { events, result };
}

const F1 = measure(twoRailSamples);
const CLEAN = measure((x) => x);

test('T016: a run whose peak reached the rail without a clip region is AT RAIL, not NONE', () => {
  const c = clippingOf(reduceAll([runEvent(0, { peak: 0.995 })]));
  assert.notEqual(c.text, 'CLIPPING NONE');
  assert.equal(c.status, 'warn');
  assert.equal(c.text, 'CLIPPING AT RAIL');
  assert.match(c.detail, /brief clipping is not excluded/);
  assert.match(c.detail, /0\.995/);
  assert.match(c.detail, new RegExp(`≥ ${CLIP_THRESHOLD}`));
  // Exactly at the threshold counts as at the rail (capture-checks: |x| ≥ CLIP_THRESHOLD).
  assert.equal(clippingOf(reduceAll([runEvent(0, { peak: CLIP_THRESHOLD })])).value, 'AT RAIL');
});

test('T016: AT RAIL is kept across later clean runs; a clip region still overrides it', () => {
  const kept = reduceAll([runEvent(0, { peak: 0.995 }), runEvent(1, { peak: 0.5 }),
    runEvent(2, { peak: 0.4 })]);
  const c = clippingOf(kept);
  assert.equal(c.text, 'CLIPPING AT RAIL');
  assert.match(c.detail, /Run 1/);
  const clipped = reduceAll([runEvent(0, { peak: 0.995 }), runEvent(1, { peak: 1,
    reasons: [{ code: 'CLIPPING', text: 'clipping in 2 regions' }] }), runEvent(2,
  { peak: 0.5 })]);
  assert.equal(clippingOf(clipped).text, 'CLIPPING DETECTED');
  assert.equal(clippingOf(clipped).status, 'fail');
});

test('T016: an unknown peak is NOT CHECKED; NONE names its threshold', () => {
  const unknown = clippingOf(reduceAll([runEvent(0)]));
  assert.equal(unknown.text, 'CLIPPING NOT CHECKED');
  assert.equal(unknown.status, 'unknown');
  // A later run with a known clean peak does not turn an unchecked run into NONE.
  const mixed = clippingOf(reduceAll([runEvent(0, { peak: null }), runEvent(1, { peak: 0.5 })]));
  assert.equal(mixed.text, 'CLIPPING NOT CHECKED');
  const clean = clippingOf(reduceAll([runEvent(0, { peak: 0.5 })]));
  assert.equal(clean.text, 'CLIPPING NONE');
  assert.equal(clean.status, 'ok');
  assert.match(clean.detail, /no sample at or above 0\.98 of digital full scale/);
  assert.match(clean.detail, /peak 0\.500/);
  assert.doesNotMatch(clean.detail, /no sample at digital full scale/);
});

test('T016: the reducer never mutates the state it is given', () => {
  const st = initialQualityBar();
  const snapshot = JSON.stringify(st);
  reduceQualityBar(st, runEvent(0, { peak: 0.995 }));
  assert.equal(JSON.stringify(st), snapshot);
});

test('T016 F1: the engine carries the peak; the bar agrees with CLIPPING_NOT_EXCLUDED',
  async () => {
    const { events, result } = await F1;
    assert.equal(result.state, S.COMPLETE, JSON.stringify(result.reasons));
    const runs = events.filter((e) => e.type === 'run');
    assert.equal(runs.length, 1);
    assert.ok(runs[0].peak >= CLIP_THRESHOLD && runs[0].peak <= 1, String(runs[0].peak));
    assert.equal(runs[0].invalid, false);
    assert.deepEqual(runs[0].reasons.filter((r) => /CLIP/.test(r.code)), []);
    const c = clippingOf(reduceAll(events));
    assert.equal(c.text, 'CLIPPING AT RAIL');
    assert.equal(c.status, 'warn');
    // The assessment of the same capture says the same thing, and the bar did not change it.
    const codes = result.quality.reasons.map((r) => r.code);
    assert.ok(codes.includes('CLIPPING_NOT_EXCLUDED'), codes.join(','));
    assert.equal(result.quality.reasons.find((r) => r.code === 'CLIPPING_NOT_EXCLUDED').severity,
      'warn');
    assert.ok(!codes.includes('CLIPPING'), codes.join(','));
  });

test('T016 negative: a clean 0.25 sweep is NONE and its quality says no clipping', async () => {
  const { events, result } = await CLEAN;
  assert.equal(result.state, S.COMPLETE, JSON.stringify(result.reasons));
  const run = events.find((e) => e.type === 'run');
  assert.ok(run.peak > 0.2 && run.peak < CLIP_THRESHOLD, String(run.peak));
  assert.equal(clippingOf(reduceAll(events)).text, 'CLIPPING NONE');
  const clip = result.quality.reasons.find((r) => r.code === 'CLIPPING');
  assert.equal(clip && clip.severity, 'ok');
});

test('T016 negative: a real clip region still shows CLIPPING DETECTED', async () => {
  const { events, result } = await measure((x) => Float64Array.from(x, (v) => 8 * v));
  assert.equal(result.state, S.INVALID);
  const c = clippingOf(reduceAll(events));
  assert.equal(c.text, 'CLIPPING DETECTED');
  assert.equal(c.status, 'fail');
});
