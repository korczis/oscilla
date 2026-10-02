import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceSequence,
  createSequence,
  addBlock,
  updateBlock,
  safeMaximum,
  normalizeModel,
} from '../../src/js/sequencer/model.js';
import {
  GAIN_FLOOR,
  EDGE_S,
  STOP_RAMP_S,
  STOP_PAD_S,
  planSequence,
  buildTimeline,
  freqAt,
  createSequenceLookup,
  automationValueAt,
  compileSequence,
  lfoShape,
  describeSequence,
} from '../../src/js/sequencer/compiler.js';
import { FakeContext, fakeTimers } from './sequencer-fake-audio.mjs';

const SR = 48000;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const assertNear = (a, b, eps, msg) => assert.ok(near(a, b, eps), `${msg ?? ''} ${a} != ${b}`);
const one = (type, params = {}, durationMs) =>
  createSequence({ blocks: [{ type, params, durationMs }] }, { sampleRate: SR });
const ofKind = (events, kind) => events.filter((e) => e.kind === kind);

test('lfoShape (V1): sine and triangle start at 0 rising, peak at a quarter cycle', () => {
  assert.equal(lfoShape('sine', 0), 0);
  assertNear(lfoShape('sine', 0.25), 1, 1e-12);
  assert.equal(lfoShape('triangle', 0), 0);
  assert.equal(lfoShape('triangle', 0.25), 1);
  assert.equal(lfoShape('triangle', 0.75), -1);
  assert.equal(lfoShape('triangle', 1.25), 1);
});

test('automationValueAt follows Web Audio set / linear / exponential semantics', () => {
  const ev = [
    { t: 0, value: 1, ramp: 'set' },
    { t: 1, value: 3, ramp: 'linear' },
    { t: 2, value: 12, ramp: 'exponential' },
    { t: 3, value: 5, ramp: 'set' },
  ];
  assert.equal(automationValueAt(ev, -1, 7), 7, 'default before the first event');
  assert.equal(automationValueAt(ev, 0, 7), 1);
  assert.equal(automationValueAt(ev, 0.5, 7), 2);
  assert.equal(automationValueAt(ev, 1, 7), 3);
  assertNear(automationValueAt(ev, 1.5, 7), 6, 1e-12);
  assert.equal(automationValueAt(ev, 2.5, 7), 12, 'set events step at their time');
  assert.equal(automationValueAt(ev, 3, 7), 5);
  assert.equal(automationValueAt(ev, 99, 7), 5);
  const same = [
    { t: 1, value: 1, ramp: 'linear' },
    { t: 1, value: 2, ramp: 'set' },
  ];
  assert.equal(automationValueAt(same, 1, 0), 2, 'equal times keep insertion order');
});

for (const sampleRate of [44100, 48000, 96000, 22050]) {
  test(`block boundaries are whole frames at ${sampleRate} Hz (no drift)`, () => {
    let m = createSequence({}, { sampleRate });
    const durations = [333.3, 17, 250, 1000 / 3, 12.345, 500, 41.7];
    const kinds = ['tone', 'sweep', 'silence', 'pulse', 'chirp', 'am', 'random'];
    durations.forEach((d, i) => {
      m = addBlock(m, kinds[i], { durationMs: d, sampleRate });
    });
    const tl = buildTimeline(m, { sampleRate });
    let cum = 0;
    tl.blocks.forEach((b, i) => {
      assert.equal(b.startFrame, Math.round((cum * sampleRate) / 1000), `block ${i} start`);
      cum += m.blocks[i].durationMs;
      assert.equal(b.endFrame, Math.round((cum * sampleRate) / 1000), `block ${i} end`);
      assertNear(b.start * sampleRate, b.startFrame, 1e-9, 'start is exactly a frame');
    });
    assertNear(tl.duration * sampleRate, tl.frames, 1e-9);
    const ev = planSequence(m, sampleRate);
    for (const b of tl.blocks) {
      const starts = ev.filter((e) => e.blockId === b.id && e.t === b.start);
      if (b.kind !== 'silence') assert.ok(starts.length > 0, `events at the boundary of ${b.id}`);
      for (const e of starts) assertNear(e.t * sampleRate, b.startFrame, 1e-9);
    }
  });
}

test('planSequence: sorted events; gain never 0; frequencies inside [20 Hz, safe max]', () => {
  let m = referenceSequence({ sampleRate: SR });
  for (const t of ['burst', 'siren', 'am', 'fm', 'random']) m = addBlock(m, t, { sampleRate: SR });
  const ev = planSequence(m, SR);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t >= ev[i - 1].t, 'sorted');
  for (const e of ofKind(ev, 'gain')) assert.ok(e.value >= GAIN_FLOOR, `env ${e.value}`);
  for (const e of ofKind(ev, 'am')) assert.ok(e.value > 0 && e.value <= 1);
  for (const e of ofKind(ev, 'freq')) {
    assert.ok(e.value >= 20 && e.value <= safeMaximum(SR), `freq ${e.value}`);
  }
  for (const e of ev) {
    if (e.ramp === 'exponential') assert.ok(e.value > 0);
    for (const k of ['t', 'kind', 'param', 'value', 'ramp']) assert.ok(k in e, k);
  }
  assert.equal(ev.filter((e) => e.param === 'carrier').length, 2, 'one carrier start + stop');
});

test('envelope: 2-5 ms edges, floor on every boundary, freq changes only at the floor', () => {
  let m = referenceSequence({ sampleRate: SR });
  for (const t of ['burst', 'siren', 'am', 'fm', 'random']) m = addBlock(m, t, { sampleRate: SR });
  const tl = buildTimeline(m, { sampleRate: SR });
  const ev = planSequence(m, SR);
  const env = ofKind(ev, 'gain');
  for (const b of tl.blocks) {
    assert.equal(automationValueAt(env, b.start, 1), GAIN_FLOOR, `floor at start of ${b.id}`);
    assert.equal(automationValueAt(env, b.end, 1), GAIN_FLOOR, `floor at end of ${b.id}`);
    for (const w of b.windows) {
      const up = env.find((e) => e.ramp === 'linear' && e.value === 1 && e.t > w.start);
      const edge = up.t - w.start;
      if (w.end - w.start >= 4 * EDGE_S) {
        assert.ok(edge >= 0.002 - 1e-12 && edge <= 0.005, `edge ${edge}`);
      }
      assertNear(automationValueAt(env, w.start + (w.end - w.start) / 2, 1), 1, 1e-12);
    }
  }
  // Every frequency step (set) and every modulator start/stop happens while the envelope is at
  // its floor.
  for (const e of ev) {
    const step = (e.kind === 'freq' && e.ramp === 'set') || e.kind === 'source' || e.kind === 'am';
    if (step && e.t > 0 && e.param !== 'carrier') {
      assert.ok(automationValueAt(env, e.t, 1) <= GAIN_FLOOR * (1 + 1e-9), `${e.kind} at ${e.t}`);
    }
  }
});

test('silence holds the floor; AM base 1 - d/2 then 1; LFOs live inside their block', () => {
  const m = createSequence(
    {
      blocks: [
        { type: 'silence', durationMs: 200 },
        { type: 'am', durationMs: 400, params: { freq: 500, modFreq: 10, depth: 60 } },
        { type: 'siren', durationMs: 300, params: { min: 400, max: 800, rate: 4 } },
        { type: 'fm', durationMs: 300, params: { freq: 1000, modFreq: 7, depthHz: 100 } },
      ],
    },
    { sampleRate: SR },
  );
  const ev = planSequence(m, SR);
  const env = ofKind(ev, 'gain');
  for (const t of [0, 0.05, 0.1, 0.199]) assert.equal(automationValueAt(env, t, 1), GAIN_FLOOR);
  const am = ofKind(ev, 'am');
  assert.equal(automationValueAt(am, 0.1, 1), 1);
  assertNear(automationValueAt(am, 0.4, 1), 0.7, 1e-12);
  assert.equal(automationValueAt(am, 0.6, 1), 1);
  const src = ofKind(ev, 'source').filter((e) => e.param !== 'carrier');
  const pairs = {};
  for (const e of src) (pairs[e.key] ||= {})[e.action] = e;
  assert.deepEqual(Object.keys(pairs).sort(), ['b2:am-lfo', 'b3:siren-lfo', 'b4:fm-mod']);
  assertNear(pairs['b2:am-lfo'].start.t, 0.2, 1e-12);
  assertNear(pairs['b2:am-lfo'].stop.t, 0.6, 1e-12);
  assert.equal(pairs['b2:am-lfo'].start.depth, 0.3);
  assert.equal(pairs['b3:siren-lfo'].start.depth, 200);
  assert.equal(pairs['b3:siren-lfo'].start.value, 4);
  assert.equal(pairs['b4:fm-mod'].start.depth, 100);
  assertNear(pairs['b4:fm-mod'].stop.t, 1.2, 1e-12);
});

test('freqAt: tone, silence, outside the sequence', () => {
  const m = referenceSequence({ sampleRate: SR });
  const f = (t) => freqAt(m, t, { sampleRate: SR });
  assert.equal(f(0), 440);
  assert.equal(f(0.25), 440);
  assert.equal(f(1.1), null, 'silence');
  assert.equal(f(-0.1), null);
  assert.equal(f(2.3), null);
  assert.equal(f(NaN), null);
});

test('freqAt: sweep log / linear', () => {
  const log = one('sweep', { start: 440, end: 880, curve: 'log' }, 500);
  assertNear(freqAt(log, 0.25, { sampleRate: SR }), Math.sqrt(440 * 880), 1e-12);
  assertNear(freqAt(log, 0.125, { sampleRate: SR }), 440 * 2 ** 0.25, 1e-12);
  assertNear(freqAt(log, 0.5, { sampleRate: SR }), 880, 1e-12);
  const lin = one('sweep', { start: 440, end: 880, curve: 'linear' }, 500);
  assertNear(freqAt(lin, 0.25, { sampleRate: SR }), 660, 1e-12);
  const down = one('sweep', { start: 2000, end: 500, curve: 'log' }, 1000);
  assertNear(
    freqAt(down, 0.5, { sampleRate: SR }),
    1000,
    1e-12,
    'downward sweeps keep start → end',
  );
});

test('freqAt: chirp exponential / linear', () => {
  const ex = one('chirp', { start: 1000, end: 8000, ramp: 'exponential' }, 500);
  assertNear(freqAt(ex, 0.25, { sampleRate: SR }), 1000 * Math.sqrt(8), 1e-12);
  assertNear(freqAt(ex, 0.5 / 3, { sampleRate: SR }), 2000, 1e-9);
  const lin = one('chirp', { start: 1000, end: 8000, ramp: 'linear' }, 500);
  assertNear(freqAt(lin, 0.25, { sampleRate: SR }), 4500, 1e-12);
});

test('freqAt: siren sine / triangle (V1 lfo maths)', () => {
  const sine = one('siren', { min: 600, max: 1200, rate: 2, shape: 'sine' }, 1000);
  const fs = (t) => freqAt(sine, t, { sampleRate: SR });
  assertNear(fs(0), 900, 1e-12);
  assertNear(fs(0.125), 1200, 1e-9);
  assertNear(fs(0.375), 600, 1e-9);
  const tri = one('siren', { min: 1200, max: 600, rate: 2, shape: 'triangle' }, 1000);
  const ft = (t) => freqAt(tri, t, { sampleRate: SR });
  assertNear(ft(0), 900, 1e-12, 'min/max order does not matter');
  assertNear(ft(0.0625), 1050, 1e-9);
  assertNear(ft(0.125), 1200, 1e-9);
  assertNear(ft(0.375), 600, 1e-9);
});

test('freqAt: AM keeps the carrier, FM swings by ± depth', () => {
  const am = one('am', { freq: 523, modFreq: 3, depth: 50 }, 1000);
  assert.equal(freqAt(am, 0.4, { sampleRate: SR }), 523);
  const fm = one('fm', { freq: 1000, modFreq: 5, depthHz: 50 }, 1000);
  assertNear(freqAt(fm, 0.05, { sampleRate: SR }), 1050, 1e-9);
  assertNear(freqAt(fm, 0.15, { sampleRate: SR }), 950, 1e-9);
  const lookup = createSequenceLookup(am, { sampleRate: SR });
  assertNear(lookup.ampAt(0), 0.75, 1e-12, 'V1 planAmpAt for AM');
  assertNear(lookup.ampAt(1 / 12), 1, 1e-12);
});

test('freqAt: pulse and burst are null in their gaps', () => {
  const pulse = one('pulse', { freq: 1200, pulseMs: 100, pauseMs: 100 }, 500);
  const tl = buildTimeline(pulse, { sampleRate: SR });
  assert.deepEqual(
    tl.blocks[0].steps.map((s) => [s.start, s.end]),
    [
      [0, 0.1],
      [0.2, 0.3],
      [0.4, 0.5],
    ],
  );
  const f = (t) => freqAt(pulse, t, { sampleRate: SR });
  assert.equal(f(0.05), 1200);
  assert.equal(f(0.15), null);
  assert.equal(f(0.45), 1200);
  const burst = one('burst', { freq: 2000, burstMs: 30, intervalMs: 200 }, 1000);
  const bt = buildTimeline(burst, { sampleRate: SR }).blocks[0];
  assert.equal(bt.steps.length, 5, 'onsets at 0, 0.2, 0.4, 0.6, 0.8 s');
  assertNear(bt.steps[4].start, 0.8, 1e-12);
  assert.equal(freqAt(burst, 0.81, { sampleRate: SR }), 2000);
  assert.equal(freqAt(burst, 0.85, { sampleRate: SR }), null);
  const tooShort = one('pulse', { pulseMs: 800, pauseMs: 100 }, 300);
  const ts = buildTimeline(tooShort, { sampleRate: SR }).blocks[0].steps;
  assert.equal(ts.length, 1);
  assertNear(ts[0].end, 0.3, 1e-12, 'a pulse never overruns its block');
});

test('random blocks: seeded, reproducible, log-uniform inside [min, max]', () => {
  const m = one('random', { min: 200, max: 4000, toneMs: 100, gapMs: 25, seed: 1234 }, 1000);
  const a = buildTimeline(m, { sampleRate: SR }).blocks[0].steps.map((s) => s.f);
  const b = buildTimeline(structuredClone(m), { sampleRate: SR }).blocks[0].steps.map((s) => s.f);
  assert.equal(a.length, 8, 'floor((1000 + 25) / 125) tones');
  assert.deepEqual(a, b, 'same seed, same frequencies');
  for (const f of a) assert.ok(f >= 200 && f <= 4000);
  assert.ok(new Set(a).size > 4);
  const other = updateBlock(m, 'b1', { params: { seed: 1235 } });
  const c = buildTimeline(other, { sampleRate: SR }).blocks[0].steps.map((s) => s.f);
  assert.notDeepEqual(a, c);
  const lookup = createSequenceLookup(m, { sampleRate: SR });
  assert.equal(lookup.freqAt(0.01), a[0]);
  assert.equal(lookup.freqAt(0.135), a[1]);
  assert.equal(lookup.freqAt(0.11), null);
});

test('compile-time clamping uses the running rate: a 96 kHz model plays safely at 44.1 kHz', () => {
  const m = one('tone', { freq: 40000 }, 200);
  const hi = createSequence(
    { blocks: [{ type: 'tone', params: { freq: 40000 } }] },
    { sampleRate: 96000 },
  );
  assert.equal(hi.blocks[0].params.freq, 40000);
  const tl = buildTimeline(hi, { sampleRate: 44100 });
  assert.equal(tl.blocks[0].freq, 20947.5);
  assert.ok(tl.warnings.length >= 1);
  assert.ok(m);
});

test('FM sidebands beyond Nyquist produce a warning', () => {
  const m = one('fm', { freq: 20000, modFreq: 2000, depthHz: 2000 }, 200);
  const tl = buildTimeline(m, { sampleRate: SR });
  assert.ok(tl.warnings.some((w) => /alias/.test(w)));
});

test('describeSequence and the empty plan', () => {
  assert.equal(describeSequence(referenceSequence(), { sampleRate: SR }), '5 blocks · 2.25 s');
  assert.equal(describeSequence(createSequence()), 'Empty sequence');
  assert.deepEqual(planSequence(createSequence(), SR), []);
  assert.deepEqual(normalizeModel(undefined).model.blocks, []);
});

// ---------------------------------------------------------------- compileSequence (fake ctx)

function compileRef(opts = {}) {
  const ctx = new FakeContext({ sampleRate: SR, currentTime: 1, ...opts.ctx });
  let m = referenceSequence({ sampleRate: SR });
  for (const t of ['siren', 'am', 'fm']) m = addBlock(m, t, { durationMs: 250, sampleRate: SR });
  const tracked = [];
  const sourced = [];
  const ended = [];
  const voice = compileSequence(m, ctx, ctx.destination, 1.0101, {
    track: (n) => {
      tracked.push(n);
      return n;
    },
    source: (n) => {
      sourced.push(n);
      return n;
    },
    onEnded: (info) => ended.push(info),
    timers: opts.timers ?? null,
  });
  return { ctx, m, voice, tracked, sourced, ended };
}

test('compileSequence: t0 rounded up to a frame; sources start/stop on block boundaries', () => {
  const { ctx, voice } = compileRef();
  assertNear(voice.t0 * SR, Math.ceil(1.0101 * SR), 1e-9);
  assertNear(voice.duration, 3, 1e-12);
  const oscs = ctx.oscillators;
  assert.equal(oscs.length, 4, 'carrier + siren LFO + AM LFO + FM modulator');
  const carrier = oscs[0];
  assert.equal(carrier.startAt, voice.t0);
  assertNear(carrier.stopAt, voice.endTime + STOP_PAD_S, 1e-12);
  const tl = voice.timeline;
  for (const [i, o] of oscs.slice(1).entries()) {
    const b = tl.blocks[5 + i];
    assertNear(o.startAt, voice.t0 + b.start, 1e-12);
    assertNear(o.stopAt, voice.t0 + b.end, 1e-12);
  }
  assert.equal(voice.activeSourceCount, 4);
});

test('compileSequence: track() sees every node, source() every oscillator', () => {
  const { ctx, tracked, sourced, voice } = compileRef();
  const created = ctx.created.filter((n) => n.kind !== 'destination');
  assert.equal(tracked.length, created.length);
  assert.deepEqual(new Set(tracked), new Set(created));
  assert.deepEqual(sourced, ctx.oscillators);
  assert.equal(voice.activeNodeCount, created.length);
});

test('compileSequence: automation applied to the graph equals planSequence', () => {
  const { ctx, voice } = compileRef();
  const carrier = ctx.oscillators[0];
  const gains = ctx.created.filter((n) => n.kind === 'gain');
  const [amp, env] = gains;
  const plan = voice.events;
  const shift = (list) => list.map((e) => ({ t: voice.t0 + e.t, value: e.value, ramp: e.ramp }));
  const strip = (list) => list.filter((e) => e.t >= voice.t0);
  assert.deepEqual(strip(carrier.frequency.events), shift(ofKind(plan, 'freq')));
  assert.deepEqual(strip(env.gain.events), shift(ofKind(plan, 'gain')));
  assert.deepEqual(strip(amp.gain.events), shift(ofKind(plan, 'am')));
});

test('natural end: ended events release every node and call onEnded once', () => {
  const { ctx, voice, ended } = compileRef();
  ctx.advance(voice.endTime);
  assert.equal(voice.ended, false, 'the carrier stops after the pad');
  ctx.advance(voice.endTime + STOP_PAD_S);
  assert.equal(voice.ended, true);
  assert.equal(voice.activeSourceCount, 0);
  assert.equal(voice.activeNodeCount, 0);
  assert.ok(ctx.created.filter((n) => n.kind !== 'destination').every((n) => n.disconnected));
  assert.deepEqual(ended, [{ stopped: false }]);
  assert.equal(ctx.liveSources, 0);
  assert.equal(voice.stop(), false, 'stop after the end is a no-op');
});

test('stop(at) without cancelAndHoldAtTime holds the exact value mid-ramp (Firefox path)', () => {
  const { ctx, voice, ended } = compileRef();
  const env = ctx.created.filter((n) => n.kind === 'gain')[1];
  const carrier = ctx.oscillators[0];
  // In the middle of the sweep block's attack edge, and mid-sweep for the frequency.
  const at = voice.t0 + 0.5 + EDGE_S / 2;
  const envBefore = automationValueAt(env.gain.events, at, 1);
  const envEarlier = automationValueAt(env.gain.events, at - 0.0005, 1);
  const fBefore = automationValueAt(carrier.frequency.events, at, 440);
  assert.ok(envBefore > 0.4 && envBefore < 0.6, `mid-edge ${envBefore}`);
  ctx.currentTime = at - 0.001;
  assert.equal(voice.stop(at), true);
  assert.equal(voice.stop(at), false, 'a second stop is a no-op');
  // Same value at `at` afterwards: no snap to the previous event (no click).
  assertNear(automationValueAt(env.gain.events, at, 1), envBefore, 1e-12);
  assertNear(automationValueAt(env.gain.events, at - 0.0005, 1), envEarlier, 1e-12);
  assertNear(automationValueAt(carrier.frequency.events, at, 440), fBefore, 1e-12);
  // The held value is pinned with setValueAtTime and nothing is scheduled after it.
  const last = env.gain.events[env.gain.events.length - 1];
  assert.deepEqual(last, { t: at, value: envBefore, ramp: 'set' });
  assert.ok(env.gain.calls.some((c) => c[0] === 'cancelScheduledValues'));
  // The curve before `at` is unchanged: the in-progress ramp is re-ended at `at`.
  assertNear(
    automationValueAt(env.gain.events, at - EDGE_S / 4, 1),
    (1 - GAIN_FLOOR) * 0.25 + GAIN_FLOOR,
    1e-9,
  );
  // The output fades to the floor, never to 0.
  const out = ctx.created.filter((n) => n.kind === 'gain')[2];
  assert.deepEqual(out.gain.events, [
    { t: at, value: 1, ramp: 'set' },
    { t: at + STOP_RAMP_S, value: GAIN_FLOOR, ramp: 'linear' },
  ]);
  // Every running or future source stops after the fade; none is extended.
  const stopAt = at + STOP_RAMP_S + STOP_PAD_S;
  for (const o of ctx.oscillators) assert.ok(o.stopAt <= stopAt + 1e-12, `${o.stopAt}`);
  assertNear(ctx.oscillators[0].stopAt, stopAt, 1e-12);
  ctx.advance(stopAt);
  assert.equal(voice.ended, true);
  assert.equal(ctx.liveSources, 0);
  assert.equal(voice.activeNodeCount, 0);
  assert.deepEqual(ended, [{ stopped: true }]);
});

test('stop() uses cancelAndHoldAtTime where the browser has it', () => {
  const { ctx, voice } = compileRef({ ctx: { holdSupported: true } });
  const env = ctx.created.filter((n) => n.kind === 'gain')[1];
  voice.stop(voice.t0 + 0.2);
  assert.ok(env.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime'));
  assert.ok(!env.gain.calls.some((c) => c[0] === 'cancelScheduledValues'));
});

test('stop() defaults to two render quanta ahead on a realtime context', () => {
  const { ctx, voice } = compileRef();
  ctx.currentTime = voice.t0 + 0.3;
  voice.stop();
  const out = ctx.created.filter((n) => n.kind === 'gain')[2];
  assertNear(out.gain.events[0].t, voice.t0 + 0.3 + 256 / SR, 1e-12);
});

test('stop before t0 cancels a queued voice: nothing plays, everything is released', () => {
  const { ctx, voice } = compileRef();
  voice.stop(1.0);
  const stopAt = 1.0 + STOP_RAMP_S + STOP_PAD_S;
  for (const o of ctx.oscillators) assert.ok(o.stopAt <= stopAt + 1e-12, `${o.stopAt}`);
  assert.ok(
    ctx.oscillators.slice(1).every((o) => o.stopAt < o.startAt),
    'LFOs never start',
  );
  ctx.advance(1.1);
  assert.equal(voice.ended, true);
  assert.equal(voice.activeNodeCount, 0);
});

test('stop on a suspended realtime context releases immediately (V1)', () => {
  const { ctx, voice, ended } = compileRef({ ctx: { state: 'suspended' } });
  assert.equal(voice.stop(voice.t0 + 0.1), true);
  assert.equal(voice.ended, true);
  assert.equal(voice.activeNodeCount, 0);
  assert.deepEqual(ended, [{ stopped: true }]);
  assert.ok(ctx.created.every((n) => n.kind === 'destination' || n.disconnected));
});

test('timer fallback releases a voice whose ended events never arrive', () => {
  const timers = fakeTimers();
  const { ctx, voice } = compileRef({ timers });
  ctx.currentTime = voice.endTime + 1; // clock moved on, but no ended events fired
  timers.runUntil(10000);
  assert.equal(voice.ended, true);
  assert.equal(voice.activeNodeCount, 0);
  assert.equal(timers.size, 0);
});

test('dispose() releases everything at once', () => {
  const { ctx, voice } = compileRef();
  voice.dispose();
  assert.equal(voice.ended, true);
  assert.equal(voice.activeNodeCount, 0);
  assert.ok(ctx.created.every((n) => n.kind === 'destination' || n.disconnected));
});

test('an empty sequence compiles to an already-ended voice with no nodes', () => {
  const ctx = new FakeContext({ sampleRate: SR });
  const voice = compileSequence(createSequence(), ctx, ctx.destination, 0, { timers: null });
  assert.equal(voice.ended, true);
  assert.equal(ctx.created.length, 1);
  assert.equal(voice.stop(), false);
});

test('voice.freqAt / blockIndexAt read the audio clock relative to t0', () => {
  const { voice } = compileRef();
  assert.equal(voice.freqAt(voice.t0 + 0.1), 440);
  assertNear(voice.freqAt(voice.t0 + 0.75), Math.sqrt(440 * 880), 1e-9);
  assert.equal(voice.blockIndexAt(voice.t0 + 1.1), 2);
  assert.equal(voice.blockIndexAt(voice.t0 - 1), -1);
});

test('a siren with min = max schedules no LFO and holds its frequency', () => {
  const m = one('siren', { min: 700, max: 700, rate: 3 }, 400);
  const ev = planSequence(m, SR);
  assert.equal(ev.filter((e) => e.param === 'siren-lfo').length, 0);
  assert.equal(freqAt(m, 0.123, { sampleRate: SR }), 700);
});
