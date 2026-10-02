// V3.1 Studio transport (src/js/studio/transport.js): live timeline playback on the Studio
// runtime, on the real AudioEngine with a recording fake AudioContext whose clock is shared with
// the engine timers (sequencer-fake-audio.mjs createFakeAudioEnv). Spec §93-§104, §180-§185,
// §209-§213, §257.
//   node --test tests/unit/v31-studio-transport.test.mjs
//
// Times are compared EXACTLY where they are whole frames at 48 kHz (the transport anchor, clip
// starts, automation points); 1e-9 where a value is computed from a curve.
// Real rendering (clips audible at their times, the cutoff sweep in the spectrum, leaks) is
// tests/browser/v31-studio-transport.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import {
  EDGE_S, GAIN_FLOOR, STOP_LEAD_S, STOP_PAD_S, STOP_RAMP_S,
} from '../../src/js/sequencer/compiler.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { ROUTE_FLOOR, STUDIO_XFADE_S } from '../../src/js/studio/compiler.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import {
  ESCAPE_PRIORITY, SAFE_HORIZON_S, frameCeil, stopTime,
} from '../../src/js/studio/timeline-compiler.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { TRANSPORT_TEXT, createStudioTransport } from '../../src/js/studio/transport.js';
import { FakeParam, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const EPS = 1e-9;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

function setup(model = templateModel(REFERENCE_TEMPLATE_ID), opts = {}) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const claims = [];
  const measurements = [];
  const transport = createStudioTransport({
    runtime, engine, store,
    onClaimOutput: (d) => {
      claims.push(d);
      return opts.refuse ? false : undefined;
    },
    onMeasurement: (e) => measurements.push(e),
  });
  return { fx, engine, runtime, store, transport, ctx: fx.ctx, claims, measurements };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));
const isFrame = (t) => Math.abs(t * SR - Math.round(t * SR)) < 1e-6;
/** Audio time of timeline position p in pass k of a playback anchored at frame bF. */
const at = (bF, p, k = 0, loopS = 0) => (bF + Math.round(p * SR) + k * Math.round(loopS * SR))
  / SR;

/** Pattern voice carriers: oscillators created by compileSequence (not the graph's own). */
function voiceCarriers(s, type) {
  const own = new Set();
  for (const h of s.runtime.nodes.values()) {
    if (h.info && h.info.oscillator) own.add(h.info.oscillator);
  }
  return s.ctx.oscillators.filter((o) => o.type === type && !own.has(o) && o.startAt !== null)
    .sort((a, b) => a.startAt - b.startAt);
}

/** Every node reachable from `node` through connections (AudioParams are leaves). */
function reach(node, seen = new Set()) {
  if (!node || seen.has(node)) return seen;
  seen.add(node);
  for (const d of node.outputs || []) reach(d, seen);
  return seen;
}

const filterFreq = (s) => s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
const callsFrom = (param, t0) => param.calls.filter((c) => c[0] === 'cancelScheduledValues'
  ? c[1] >= t0 - EPS : c[2] >= t0 - EPS);
const near = (a, b, tol = EPS) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// ---------------------------------------------------------------- Basic Synth (§257)

test('PLAY keeps the first clip when the audio clock moves during start()', () => {
  // A fresh browser context advanced two render quanta between runtime.start() choosing
  // baseTime (hooks.soon()) and the scheduler's first advance (measured in chromium: baseTime
  // 0.021333, first advance at 0.005333): the Tone clip at baseTime was skipped as late.
  const s = setup();
  // The runtime is frozen: a view of it whose start() moves the clock (only, no timers) after
  // choosing baseTime.
  const runtime = Object.create(s.runtime, { start: { value: () => {
    const r = s.runtime.start();
    s.ctx.advance(s.ctx.currentTime + (2 * 128) / SR);
    return r;
  } } });
  const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  const r = ok(transport.start());
  const b = r.baseTime;
  const bF = Math.round(b * SR);
  assert.ok(b - s.ctx.currentTime < SAFE_HORIZON_S, 'the clock is inside the safe horizon');
  assert.equal(transport.debugInfo().skippedLate, 0);
  s.fx.advance(0.2);
  const carriers = voiceCarriers(s, 'sawtooth');
  assert.deepEqual(carriers.map((o) => o.startAt), [at(bF, 0)], 'the Tone voice starts at b');
  // §212: the clip starts where its voice envelope leaves the floor — on the baseTime frame,
  // together with the graph's start ramps (routes 0 → 1, the ADSR attack).
  const env = carriers[0].outputs[0].outputs[0].gain;
  const attack = env.scheduled.findIndex((e) => e.ramp === 'linear' && e.value === 1);
  assert.deepEqual([env.scheduled[attack - 1].t, env.scheduled[attack - 1].value], [b, GAIN_FLOOR]);
  near(env.scheduled[attack].t, b + EDGE_S);
  const route = s.runtime.edges.get('edge-1').gain.gain;
  assert.deepEqual(route.calls.filter((c) => c[2] >= b).slice(0, 2).map((c) => [c[0], c[1], c[2]]),
    [['setValueAtTime', 0, b], ['linearRampToValueAtTime', 1, b + STUDIO_XFADE_S]]);
});

test('Basic Synth: Tone and Sweep clips play on the oscillator at exact audio-clock times', () => {
  const s = setup();
  const r = ok(s.transport.start());
  assert.equal(s.claims.length, 1, 'the exclusivity hook fired once');
  assert.deepEqual(s.claims[0], { owner: 'studio', position: 0 });
  assert.equal(s.runtime.state, 'running');
  const b = r.baseTime;
  const bF = Math.round(b * SR);
  assert.ok(isFrame(b), 'whole frame');
  assert.ok(b >= SAFE_HORIZON_S, 'after the engine scheduling lead');
  // The anchor is the runtime's click-free crossfade time (its routes ramp 0 → 1 there).
  const osc = s.runtime.nodes.get('osc-1');
  assert.equal(osc.info.oscillator.startAt, b);
  s.fx.advance(1.5); // the sweep clip is inside the look-ahead window now
  const carriers = voiceCarriers(s, 'sawtooth');
  assert.deepEqual(carriers.map((o) => o.startAt), [at(bF, 0), at(bF, 1)]);
  // A voice ends at startTime + its duration (a float sum) + STOP_PAD_S.
  near(carriers[0].stopAt, at(bF, 1) + STOP_PAD_S);
  near(carriers[1].stopAt, at(bF, 3) + STOP_PAD_S);
  // Tone 220 Hz, then the log sweep 220 → 880 Hz over the clip. The tone voice has ended and
  // cancelled its automation (compileSequence cleanup): what it played is FakeParam.scheduled.
  assert.deepEqual(carriers[0].frequency.events, []);
  assert.deepEqual(carriers[0].frequency.scheduled.filter((e) => e.t >= b).map((e) => [e.t, e.value,
    e.ramp]).slice(0, 1), [[at(bF, 0), 220, 'set']]);
  const sweep = carriers[1].frequency.events.filter((e) => e.t >= at(bF, 1));
  assert.deepEqual([sweep.at(-1).value, sweep.at(-1).ramp], [880, 'exponential']);
  near(sweep.at(-1).t, at(bF, 3)); // the voice's start + the block's end (a float sum)
  assert.equal(sweep[0].value, 220);
  // The oscillator is pattern-played: its free-running carrier is held at the floor...
  const level = osc.modTarget('level', 'linear').param;
  assert.deepEqual(level.calls.at(-1), ['setValueAtTime', ROUTE_FLOOR, 0]);
  assert.deepEqual(s.runtime.ownedParams(), [{ node: 'filter-1', param: 'frequency' },
    { node: 'osc-1', param: 'level' }]);
  // ...and the voices play into a pattern bus feeding the oscillator's route to the Envelope,
  // so they pass ENV → FILTER → MASTER into the engine's safety chain.
  const route = s.runtime.edges.get('edge-1').gain;
  const bus = s.ctx.of('gain').find((g) => g !== osc.outputs.audio && g.outputs.includes(route));
  assert.ok(bus, 'pattern bus');
  assert.equal(bus.gain.events[0].value, 1, 'the oscillator level');
  assert.ok(reach(carriers[1]).has(bus), 'the sounding sweep voice → pattern bus');
  // The tone voice has ended: its nodes are disconnected and out of the engine accounting.
  assert.equal(carriers[0].outputs.length, 0);
  assert.equal(s.engine.nodes.has(carriers[0]), false);
  const downstream = reach(bus);
  assert.ok(downstream.has(s.runtime.nodes.get('env-1').inputs.audio), 'through the ADSR');
  assert.ok(downstream.has(s.runtime.nodes.get('filter-1').inputs.audio), 'through the filter');
  assert.ok(downstream.has(s.engine.master), 'into the master safety chain');
  // Playhead from the audio clock (§94).
  const ph = s.transport.playhead();
  assert.ok(Math.abs(ph.position - (s.ctx.currentTime - b)) < EPS && ph.playing
    && ph.pass === 0);
  assert.deepEqual(s.transport.debugInfo().unplayed, []);
});

test('Basic Synth: cutoff automation reaches the filter frequency AudioParam; no runtime glide',
  () => {
    const s = setup();
    const { baseTime: b } = ok(s.transport.start());
    const bF = Math.round(b * SR);
    const fp = filterFreq(s);
    // Lane: 0 s 500 Hz, 3 s 8 kHz exponential → set at the anchor, the ramp due at once (its
    // segment begins at the anchor).
    assert.deepEqual(callsFrom(fp, b), [['setValueAtTime', 500, b],
      ['exponentialRampToValueAtTime', 8000, at(bF, 3)]]);
    s.fx.advance(0.5);
    // A parameter edit while the lane owns the parameter: the runtime re-applies the node's base
    // (detune, Q) but never glides the owned cutoff.
    const biquad = s.runtime.nodes.get('filter-1').info.stage.node;
    const targets = (p) => p.calls.filter((c) => c[0] === 'setTargetAtTime').length;
    const before = { f: targets(fp), q: targets(biquad.Q), d: targets(biquad.detune) };
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 1200 });
    const synced = s.transport.sync();
    assert.ok(synced.synced && synced.applied.ok);
    assert.ok(synced.applied.ops.some((o) => o.op === 'node-params' && o.id === 'filter-1'));
    assert.equal(targets(fp), before.f, 'the owned cutoff is not glided');
    assert.ok(targets(biquad.Q) > before.q, 'the other parameters are still applied');
    assert.ok(targets(biquad.detune) > before.d);
    assert.equal(Object.prototype.hasOwnProperty.call(fp, 'setTargetAtTime'), false,
      'the AudioParam methods are restored');
    assert.equal(fp.setTargetAtTime, FakeParam.prototype.setTargetAtTime);
    // The schedule the lane wrote is untouched.
    assert.deepEqual(callsFrom(fp, b), [['setValueAtTime', 500, b],
      ['exponentialRampToValueAtTime', 8000, at(bF, 3)]]);

    // Control: without a transport the same edit glides the cutoff.
    const c = setup();
    ok(c.runtime.apply(c.store.getModel()));
    ok(c.runtime.start());
    const cf = filterFreq(c);
    const n = targets(cf);
    dispatch(c, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 1200 });
    ok(c.runtime.apply(c.store.getModel()));
    assert.equal(targets(cf), n + 1);
    assert.equal(cf.calls.at(-1)[1], 1200);
  });

test('Basic Synth: loop passes repeat the clips and the lane on whole frames without drift', () => {
  const s = setup();
  dispatch(s, { type: 'LOOP_SET', enabled: true, start: 0, end: 3 });
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(4.5);
  const live45 = [s.engine.activeNodeCount, s.engine.activeSourceCount];
  s.fx.advance(3); // the same phase of the next pass
  assert.deepEqual([s.engine.activeNodeCount, s.engine.activeSourceCount], live45,
    'no growth from pass to pass');
  s.fx.advance(4.6);
  const starts = voiceCarriers(s, 'sawtooth').map((o) => o.startAt);
  const expected = [];
  for (let k = 0; k <= 3; k++) expected.push(at(bF, 0, k, 3), at(bF, 1, k, 3));
  assert.deepEqual(starts.slice(0, expected.length), expected);
  for (const t of starts) assert.ok(isFrame(t), `${t} is a whole frame`);
  // Every pass anchors the lane at its start and ramps to the exact value at the loop end.
  const fp = filterFreq(s);
  for (let k = 0; k <= 3; k++) {
    const t0 = at(bF, 0, k, 3);
    assert.ok(fp.calls.some((c) => c[0] === 'setValueAtTime' && c[1] === 500 && c[2] === t0),
      `pass ${k} anchored`);
    assert.ok(fp.calls.some((c) => c[0] === 'exponentialRampToValueAtTime' && c[1] === 8000
      && c[2] === at(bF, 0, k + 1, 3)), `pass ${k} ramps to the boundary`);
  }
  const ph = s.transport.playhead();
  assert.equal(ph.pass, Math.floor((s.ctx.currentTime - b) / 3));
  assert.ok(s.transport.debugInfo().loop, 'looping');
  assert.equal(s.transport.debugInfo().skippedLate, 0);
});

test('Basic Synth: an edit during playback reschedules from the safe horizon', () => {
  const s = setup();
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.6); // the Tone clip sounds; the Sweep clip is scheduled, not started
  const [tone, sweep] = voiceCarriers(s, 'sawtooth');
  assert.equal(sweep.startAt, at(bF, 1));
  const now = s.ctx.currentTime;
  const horizon = frameCeil(now + SAFE_HORIZON_S, SR);
  const fp = filterFreq(s);
  const mark = fp.calls.length;
  dispatch(s, { type: 'CLIP_MOVE', clipId: 'clip-2', start: 1.25 });
  dispatch(s, { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.8 });
  dispatch(s, { type: 'AUTOMATION_POINT_MOVE', laneId: 'lane-1', pointId: 'pt-2', value: 4000 });
  const r = s.transport.sync();
  assert.equal(r.plan.horizon, horizon);
  const decided = Object.fromEntries(r.plan.decisions.map((d) => [d.clipId, d.decision]));
  assert.deepEqual(decided, { 'clip-1': 'retime-end', 'clip-2': 'cancel' });
  // The scheduled sweep voice is discarded unheard, the moved clip is rebuilt after the horizon.
  assert.equal(sweep.stopAt, 0);
  const moved = voiceCarriers(s, 'sawtooth').filter((o) => o !== tone && o !== sweep);
  assert.deepEqual(moved.map((o) => o.startAt), [at(bF, 1.25)]);
  assert.ok(moved[0].startAt >= horizon);
  // The sounding tone is shortened: released at its new end (a compatible live edit).
  near(tone.stopAt, at(bF, 0.8) + STOP_RAMP_S + STOP_PAD_S);
  // The lane holds its exact value at the horizon and continues to the edited point.
  const tail = fp.calls.slice(mark);
  assert.deepEqual(tail[0], ['cancelScheduledValues', horizon]);
  const held = 500 * (8000 / 500) ** ((horizon - b) / (at(bF, 3) - b));
  assert.equal(tail[1][0], 'exponentialRampToValueAtTime');
  assert.ok(Math.abs(tail[1][1] - held) < 1e-6 && tail[1][2] === horizon);
  assert.deepEqual(tail[2].slice(0, 1).concat(tail[2][2]), ['setValueAtTime', horizon]);
  assert.deepEqual(tail.at(-1), ['exponentialRampToValueAtTime', 4000, at(bF, 3)]);
  // A graph edit during playback (a node added) is applied; playback continues.
  s.fx.advance(0.1);
  const gain = dispatch(s, { type: 'NODE_ADD', nodeType: 'gain', position: { x: 0, y: 0 } })
    .created.nodes[0];
  assert.ok(gain);
  const g = s.transport.sync();
  assert.ok(g.applied.ok);
  assert.ok(s.transport.playing);
});

test('Basic Synth: a rebuilt node keeps its lane and its pattern clips (node-replace)', () => {
  const s = setup();
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.6);
  const oldFilter = s.runtime.nodes.get('filter-1');
  const oldOsc = s.runtime.nodes.get('osc-1');
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'type', value: 'highpass' });
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'waveform', value: 'square' });
  const now = s.ctx.currentTime;
  const horizon = frameCeil(now + SAFE_HORIZON_S, SR);
  const r = s.transport.sync();
  assert.deepEqual(r.applied.ops.filter((o) => o.op === 'node-replace').map((o) => o.id).sort(),
    ['filter-1', 'osc-1']);
  // The new filter's cutoff continues the lane from the horizon with its exact value there.
  const fp = filterFreq(s);
  assert.notEqual(s.runtime.nodes.get('filter-1'), oldFilter);
  const lane = fp.calls.filter((c) => c[0] !== 'setTargetAtTime' && (c[2] ?? c[1]) >= horizon);
  const held = 500 * (8000 / 500) ** ((horizon - b) / (at(bF, 3) - b));
  assert.equal(lane[0][0], 'cancelScheduledValues');
  assert.equal(lane[1][0], 'setValueAtTime');
  assert.ok(Math.abs(lane[1][1] - held) < 1e-6 && lane[1][2] === horizon);
  assert.deepEqual(lane.at(-1), ['exponentialRampToValueAtTime', 8000, at(bF, 3)]);
  // The new oscillator is claimed at once (built silent), the scheduled Sweep clip is rebuilt on
  // it with the new waveform; the old one fades with the runtime's crossfade.
  const osc = s.runtime.nodes.get('osc-1');
  assert.notEqual(osc, oldOsc);
  assert.deepEqual(osc.modTarget('level', 'linear').param.calls.at(-1),
    ['setValueAtTime', ROUTE_FLOOR, now]);
  const square = voiceCarriers(s, 'square');
  assert.deepEqual(square.map((o) => o.startAt), [at(bF, 1)]);
  const route = s.runtime.edges.get('edge-1').gain;
  assert.ok(reach(square[0]).has(route), 'into the new route');
  assert.ok(r.plan.decisions.some((d) => d.clipId === 'clip-2' && d.decision === 'cancel'));
  assert.ok(s.transport.debugInfo().decisions.some((d) => d.clipId === 'clip-1'
    && d.reason === 'node-replaced'));
});

test('Basic Synth: STOP releases everything, holds automation, leaves the model; no leaks',
  async () => {
    const s = setup();
    const { baseTime: b } = ok(s.transport.start());
    const bF = Math.round(b * SR);
    s.fx.advance(1.5); // inside the sweep clip
    const revision = s.store.getRevision();
    const model = s.store.getModel();
    const fp = filterFreq(s);
    const sweep = voiceCarriers(s, 'sawtooth')[1];
    const now = s.ctx.currentTime;
    const atStop = stopTime(now, SR);
    const mark = fp.calls.length;
    const done = s.transport.stop();
    assert.equal(s.transport.playing, false);
    // Sounding voices are released at the STOP time: the engine's release time (hooks.soon), on
    // a render quantum; the voice's output gain is faded over STOP_RAMP_S and its frequency
    // schedule is not edited while it sounds.
    assert.equal(atStop, s.engine._soon(s.ctx));
    assert.ok(atStop >= now + STOP_LEAD_S);
    const sweepCalls = sweep.frequency.calls.length;
    assert.equal(sweep.stopAt, atStop + STOP_RAMP_S + STOP_PAD_S);
    assert.equal(sweep.frequency.calls.length, sweepCalls);
    const voiceOut = [...reach(sweep)].find((n) => n.kind === 'gain'
      && n.gain.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[2] === atStop
        + STOP_RAMP_S));
    assert.ok(voiceOut, 'the voice output fades from the STOP time');
    assert.deepEqual(voiceOut.gain.events.slice(-2).map((e) => [e.ramp, e.value, e.t]),
      [['set', 1, atStop], ['linear', GAIN_FLOOR, atStop + STOP_RAMP_S]]);
    // Every lane is held at its exact value at the STOP time.
    const held = 500 * (8000 / 500) ** ((atStop - b) / (at(bF, 3) - b));
    const tail = fp.calls.slice(mark);
    assert.deepEqual(tail[0], ['cancelScheduledValues', atStop]);
    assert.ok(Math.abs(tail.at(-1)[1] - held) < 1e-6);
    assert.deepEqual([tail.at(-1)[0], tail.at(-1)[2]], ['setValueAtTime', atStop]);
    s.fx.advance(0.5);
    const counts = await done;
    assert.deepEqual([counts.nodes, counts.sources, counts.engineNodes, counts.engineSources,
      counts.voices], [0, 0, 0, 0, 0]);
    const d = s.runtime.debugInfo();
    assert.equal(d.runtimeSourceCount, 0);
    assert.equal(d.runtimeNodeCount, 0);
    assert.equal(s.ctx.liveAllSources, 0, 'every source of the context has ended');
    assert.equal(s.fx.timers.size, 0, 'no timer left behind');
    assert.deepEqual(d.ownedParams, [], 'the runtime owns its parameters again');
    // The model is untouched; the playhead returns to where playback started (§184).
    assert.equal(s.store.getRevision(), revision);
    assert.equal(s.store.getModel(), model);
    assert.deepEqual(s.transport.playhead(), { position: 0, pass: 0, playing: false });
    // PLAY → STOP → PLAY repeats without growth.
    for (let i = 0; i < 3; i++) {
      ok(s.transport.start());
      s.fx.advance(1.2);
      const p = s.transport.stop();
      s.fx.advance(0.5);
      const c = await p;
      assert.deepEqual([c.engineNodes, c.engineSources], [0, 0]);
    }
    assert.equal(s.ctx.liveAllSources, 0);
  });

test('the timeline ends by itself: the transport stops and releases the Studio output',
  async () => {
    const s = setup();
    const events = [];
    s.transport.on((type, detail) => events.push([type, detail && detail.reason]));
    ok(s.transport.start({ position: 2 }));
    s.fx.advance(2);
    assert.equal(s.transport.playing, false);
    assert.ok(events.some(([t]) => t === 'ended'));
    s.fx.advance(0.5);
    const c = await s.transport.stop();
    assert.deepEqual([c.engineNodes, c.engineSources], [0, 0]);
    assert.equal(s.transport.playhead().position, 2, 'back at the play start');
  });

// ---------------------------------------------------------------- exclusivity, Escape, RETURN

test('exclusivity: onClaimOutput fires before PLAY and can refuse it', () => {
  const s = setup(undefined, { refuse: true });
  const r = s.transport.start();
  assert.equal(r.ok, false);
  assert.equal(r.reason, TRANSPORT_TEXT.claimRefused);
  assert.equal(s.claims.length, 1);
  assert.equal(s.runtime.state, 'idle');
  assert.equal(s.engine.activeNodeCount, 0, 'nothing was built');
  const t = setup();
  ok(t.transport.start());
  ok(t.transport.start()); // already playing: no second claim
  assert.equal(t.claims.length, 1);
});

test('Escape: transient UI first, then stop-audio (fast); RETURN relocates to 0', async () => {
  const s = setup();
  ok(s.transport.start({ position: 1 }));
  assert.deepEqual(ESCAPE_PRIORITY, ['cancel-gesture', 'close-popup', 'cancel-selection-mode',
    'stop-audio']);
  assert.equal(s.transport.escape({ gesture: true, popup: true }), 'cancel-gesture');
  assert.equal(s.transport.escape({ popup: true }), 'close-popup');
  assert.equal(s.transport.escape({ selectionMode: true }), 'cancel-selection-mode');
  assert.equal(s.transport.playing, true, 'transient UI does not stop audio');
  s.fx.advance(0.3);
  const ph = s.transport.returnToStart();
  assert.equal(s.transport.playing, true);
  assert.ok(ph.position < 0.05, 'relocated to the start');
  const b = s.transport.debugInfo().baseTime;
  s.fx.advance(0.5);
  const tone = voiceCarriers(s, 'sawtooth').filter((o) => o.startAt >= b);
  assert.equal(tone[0].startAt, b, 'the Tone clip plays again from 0');
  assert.equal(s.transport.escape({}), 'stop-audio');
  assert.equal(s.transport.playing, false);
  assert.equal(s.transport.escape({}), null, 'nothing left to stop');
  s.fx.advance(0.3);
  const c = await s.transport.stop();
  assert.deepEqual([c.engineNodes, c.engineSources], [0, 0]);
});

// ---------------------------------------------------------------- other clip kinds

test('Sequence target: voices play into the Sequence bus; its TRIGGER gates the Envelope', () => {
  const store = createStudioStore(null, { idGenerator: createIdGenerator() });
  const d = (a) => ok(store.dispatch(a));
  const seq = d({ type: 'NODE_ADD', nodeType: 'sequence' }).created.nodes[0];
  const env = d({ type: 'NODE_ADD', nodeType: 'envelope' }).created.nodes[0];
  const master = d({ type: 'NODE_ADD', nodeType: 'master' }).created.nodes[0];
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'audio' }, to: { node: env, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: env, port: 'audio' }, to: { node: master, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'trigger' }, to: { node: env, port: 'gate' } });
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: seq }).created.tracks[0];
  d({ type: 'CLIP_ADD', trackId: track, start: 0.5, duration: 1,
    payload: { blockType: 'tone', params: { freq: 440 } } });
  const s = setup(store.getModel());
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.2);
  const [carrier] = voiceCarriers(s, 'sine');
  assert.equal(carrier.startAt, at(bF, 0.5));
  const h = s.runtime.nodes.get(seq);
  assert.ok(reach(carrier).has(h.info.destination), 'into the Sequence bus');
  // The Envelope is owned by the timeline: closed at PLAY, gated at the clip start.
  const vca = s.runtime.nodes.get(env).inputs.audio.gain;
  const setAt = vca.calls.filter((c) => c[2] === at(bF, 0.5));
  assert.ok(setAt.some((c) => c[0] === 'setValueAtTime'), 'gate on at the clip start');
  assert.ok(vca.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1
    && Math.abs(c[2] - (at(bF, 0.5) + 0.01)) < EPS), 'attack');
  assert.ok(vca.calls.some((c) => c[0] === 'exponentialRampToValueAtTime'
    && c[2] > at(bF, 1.5) - EPS), 'released after the clip');
  assert.deepEqual(s.transport.debugInfo().gatedEnvelopes, [env]);
});

test('gate event clips gate their Envelope; unsupported clips are listed with a reason', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const d = (a) => ok(store.dispatch(a));
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: 'env-1' }).created.tracks[0];
  d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.25, duration: 0.5,
    payload: { action: 'gate' } });
  const trig = d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.5, duration: 0.1,
    payload: { action: 'trigger' } }).created.clips[0];
  const s = setup(store.getModel());
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  const vca = s.runtime.nodes.get('env-1').inputs.audio.gain;
  assert.ok(vca.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1
    && Math.abs(c[2] - (at(bF, 0.25) + 0.01)) < EPS), 'gate at 0.25 s');
  assert.ok(vca.calls.some((c) => c[0] === 'exponentialRampToValueAtTime'
    && Math.abs(c[2] - (at(bF, 0.75) + 0.2)) < EPS), 'released at 0.75 s over R');
  assert.deepEqual(s.transport.debugInfo().unplayed, [{ id: trig,
    reason: TRANSPORT_TEXT.eventTarget('Envelope 1') }]);
});

test('measurement clips are handed to the measurement callback as plain data', async () => {
  const s = setup(templateModel(MEASUREMENT_TEMPLATE_ID));
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(1.2);
  const scheduled = s.measurements.filter((e) => e.type === 'schedule');
  assert.deepEqual(scheduled.map((e) => [e.clipId, e.action, e.startTime]), [
    ['clip-1', 'noise-check', at(bF, 0)],
    ['clip-2', 'pre-roll', at(bF, 1)],
    ['clip-6', 'capture', at(bF, 1)],
    ['clip-3', 'stimulus', at(bF, 1.5)],
  ]);
  for (const e of scheduled) {
    assert.deepEqual(JSON.parse(JSON.stringify(e)), e, 'plain, serializable data');
  }
  assert.equal(scheduled.find((e) => e.clipId === 'clip-1').target, 'mic-1');
  const done = s.transport.stop();
  assert.deepEqual(s.measurements.at(-1).type, 'stop');
  s.fx.advance(0.5);
  await done;
});
