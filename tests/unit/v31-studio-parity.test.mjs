// V3.1 Studio: offline/live parity, the owned-parameter adapter contract and modulation into a
// pattern-played oscillator's level (src/js/studio/offline.js, runtime.js, adapters/nodes.js,
// transport.js), on the real AudioEngine with the recording fake AudioContext
// (sequencer-fake-audio.mjs). Spec §93-§105, §175-§176, §180-§185.
//   node --test tests/unit/v31-studio-parity.test.mjs
//
// Times are compared EXACTLY: live and offline schedule the same events at the same audio times.
// Real rendering of the offline Subtractive Synth (Tone then Sweep content) is asserted by
// tests/browser/v31-studio-offline.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { ROUTE_FLOOR, STUDIO_XFADE_S } from '../../src/js/studio/compiler.js';
import { renderStudioOffline } from '../../src/js/studio/offline.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { FakeParam, StudioFakeContext, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const Q = 128 / SR;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

function setup(model = templateModel(REFERENCE_TEMPLATE_ID)) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true; // see liveAllSources
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime, engine, store });
  return { fx, engine, runtime, store, transport, ctx: fx.ctx };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));
const at = (bF, p) => (bF + Math.round(p * SR)) / SR;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
/** engine._soon at the context's current time (hooks.soon). */
const soonOf = (now) => Math.ceil((now + Math.max(0.02, 2 * Q)) / Q) * Q;

/** Every node reachable from `node` through connections (AudioParams are leaves). */
function reach(node, seen = new Set()) {
  if (!node || seen.has(node)) return seen;
  seen.add(node);
  for (const d of node.outputs || []) reach(d, seen);
  return seen;
}

// ---------------------------------------------------------------- offline / live parity

/** A fake OfflineAudioContext (offline-renderer.js render): suspended until startRendering. */
function fakeOfflineCtor(made) {
  return class extends StudioFakeContext {
    constructor({ numberOfChannels, length, sampleRate }) {
      super({ sampleRate, state: 'suspended' });
      this.numberOfChannels = numberOfChannels;
      this.length = length;
      made.push(this);
    }

    startRendering() {
      return Promise.resolve(this.createBuffer(this.numberOfChannels, this.length,
        this.sampleRate));
    }
  };
}

/**
 * Everything the Studio scheduled on a context, from node `from` on (after the engine's or the
 * renderer's own output chain): per node in creation order its kind, waveform, source start and
 * stop, and every AudioParam's resulting schedule (after cancellations). An event at the context
 * time the node was built is its initial value ('init'): a voice is built when the look-ahead
 * reaches it (live) or at once (offline), and only that moment differs.
 * The schedule is FakeParam.scheduled: a sequencer voice cancels its automation once all of its
 * sources have ended (compileSequence cleanup). A live voice that ended before the trace is read
 * has done so, while the fake offline context never renders, so the schedule compared is the
 * one written before that cleanup (the cleanup itself is asserted separately).
 */
function scheduleTrace(ctx, from) {
  return ctx.created.slice(from).map((n) => {
    const params = {};
    for (const [k, v] of Object.entries(n)) {
      if (v instanceof FakeParam) {
        params[k] = v.scheduled.map((e) => [e.ramp, e.value, e.t === n.createdAt ? 'init' : e.t,
          e.tau ?? null]);
      }
    }
    return { kind: n.kind, type: n.type ?? null, startAt: n.startAt ?? null,
      stopAt: n.stopAt ?? null, params };
  });
}

test('offline renders what the live transport plays: Subtractive Synth, exact frames',
  async () => {
    // Live: the transport with its 1 s look-ahead, advanced until every window is scheduled.
    const s = setup();
    const liveFrom = s.ctx.created.length; // after the engine's master chain
    const { baseTime: b } = ok(s.transport.start());
    s.fx.advance(2.9);
    const live = scheduleTrace(s.ctx, liveFrom);
    // Offline: the same model through renderStudioOffline, in one pass.
    const made = [];
    const r = await renderStudioOffline(templateModel(REFERENCE_TEMPLATE_ID),
      { sampleRate: SR, OfflineAudioContext: fakeOfflineCtor(made) });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(r.plan.limitations, []);
    assert.equal(r.startTime, b, 'the same anchor');
    assert.deepEqual(r.debug.transport.unplayed, []);
    const off = scheduleTrace(made[0], 2); // after the destination and the render's master
    assert.ok(off.length > 20, 'a whole graph');
    assert.deepEqual(off, live);
    // Live, the Tone voice has ended and cancelled its automation (which can no longer sound);
    // the Sweep voice still sounds at 2.9 s and keeps its schedule.
    const [toneV, sweepV] = s.ctx.oscillators.filter((o) => o.type === 'sawtooth'
      && o.stopAt !== null);
    assert.ok(toneV.endedFired && !sweepV.endedFired);
    assert.deepEqual(toneV.frequency.calls.at(-1), ['cancelScheduledValues', 0]);
    assert.deepEqual(toneV.frequency.events, []);
    assert.ok(toneV.frequency.scheduled.length > 0, 'the trace compares what was scheduled');
    assert.equal(sweepV.frequency.scheduled, sweepV.frequency.events);
    // The content: the Tone then the Sweep voice on whole frames (the graph carrier never stops),
    // the carrier held at the floor, the cutoff lane owned and scheduled.
    const bF = Math.round(b * SR);
    const voices = made[0].oscillators.filter((o) => o.type === 'sawtooth' && o.stopAt !== null);
    assert.deepEqual(voices.map((o) => o.startAt), [at(bF, 0), at(bF, 1)]);
    assert.deepEqual(r.debug.transport.claims, ['osc-1']);
    assert.deepEqual(r.debug.transport.ownedParams, [{ node: 'filter-1', param: 'frequency' },
      { node: 'osc-1', param: 'level' }]);
    assert.deepEqual(r.debug.transport.lanes.map((l) => l.laneId), ['lane-1']);
  });

// ---------------------------------------------------------------- owned parameters

test('owned parameters: no AudioParam method is ever reassigned', async () => {
  const names = ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
    'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime'];
  const reassigned = [];
  const saved = new Map();
  for (const m of names) {
    const desc = Object.getOwnPropertyDescriptor(FakeParam.prototype, m);
    saved.set(m, desc);
    const fn = desc ? desc.value : undefined;
    Object.defineProperty(FakeParam.prototype, m, {
      configurable: true,
      get() { return fn; },
      set(v) {
        reassigned.push(m);
        Object.defineProperty(this, m, { value: v, writable: true, configurable: true });
      },
    });
  }
  try {
    const s = setup();
    ok(s.transport.start());
    s.fx.advance(0.5);
    // Edits on nodes with owned parameters: the cutoff and Q under the lane, the
    // pattern-played oscillator's level and frequency.
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 1200 });
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'Q', value: 2 });
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'level', value: 0.5 });
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 330 });
    const level = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
    const fp = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
    const marks = [level.calls.length, fp.calls.length];
    ok(s.transport.sync().applied);
    assert.deepEqual(reassigned, [], 'no method was shadowed to skip the owned parameters');
    assert.equal(level.calls.length, marks[0], 'the owned carrier level is not written');
    assert.equal(fp.calls.length, marks[1], 'the owned cutoff is not written');
    s.fx.advance(0.2);
    // The bypass would re-glide the owned cutoff (createFilterStage.update cannot skip it): the
    // node is rebuilt (rebuildWhenOwned) and the lane continues on the new biquad.
    const old = s.runtime.nodes.get('filter-1');
    const mark = fp.calls.length;
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'enabled', value: false });
    const r = s.transport.sync();
    assert.ok(r.applied.ops.some((o) => o.op === 'node-replace' && o.id === 'filter-1'));
    assert.notEqual(s.runtime.nodes.get('filter-1'), old);
    assert.equal(fp.calls.slice(mark).filter((c) => c[0] === 'setTargetAtTime').length, 0,
      'the old cutoff is never glided');
    const nf = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
    assert.equal(nf.calls.at(-1)[0], 'exponentialRampToValueAtTime', 'the lane continues');
    assert.ok(s.transport.debugInfo().decisions.some((d) => d.key === 'lane-1'
      && d.decision === 'rebind'));
    s.fx.advance(0.5);
    const done = s.transport.stop();
    s.fx.advance(0.5);
    await done;
    assert.deepEqual(reassigned, []);
    assert.deepEqual(s.runtime.debugInfo().warnings, []);
  } finally {
    for (const [m, desc] of saved) {
      if (desc) Object.defineProperty(FakeParam.prototype, m, desc);
      else delete FakeParam.prototype[m];
    }
  }
});

test('owned parameters: without an owner the filter bypass stays a live update', () => {
  const s = setup();
  ok(s.runtime.apply(s.store.getModel()));
  ok(s.runtime.start());
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'enabled', value: false });
  const r = ok(s.runtime.apply(s.store.getModel()));
  assert.deepEqual(r.ops, [{ op: 'node-params', id: 'filter-1', keys: ['enabled'] }]);
});

// ---------------------------------------------------------------- modulation into a pattern level

/** The Basic Synth plus an LFO → osc-1 level edge (linear, unipolar). */
function levelModModel({ clips = true } = {}) {
  const base = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(base, { idGenerator: createIdGenerator(base) });
  const d = (a) => ok(store.dispatch(a));
  const lfo = d({ type: 'NODE_ADD', nodeType: 'lfo', position: { x: 0, y: 400 } })
    .created.nodes[0];
  const edge = d({ type: 'EDGE_ADD', from: { node: lfo, port: 'control' },
    to: { node: 'osc-1', port: 'level' },
    props: { depth: 0.25, polarity: 'unipolar', mapping: 'linear' } }).created.edges[0];
  if (!clips) {
    d({ type: 'CLIP_REMOVE', clipId: 'clip-1' });
    d({ type: 'CLIP_REMOVE', clipId: 'clip-2' });
  }
  return { model: store.getModel(), edge };
}

test('modulation into a pattern-played oscillator level reaches the pattern bus (voices)', () => {
  const { model, edge } = levelModModel();
  const s = setup(model);
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advance(0.2);
  const osc = s.runtime.nodes.get('osc-1');
  const carrierLevel = osc.modTarget('level', 'linear').param;
  const eh = s.runtime.edges.get(edge);
  assert.equal(eh.toPort, 'level');
  // The depth gain no longer feeds the held carrier's level directly...
  assert.equal(eh.gain.outputs.includes(carrierLevel), false);
  const [toCarrier, toBus] = eh.gain.outputs;
  assert.deepEqual(toCarrier.outputs, [carrierLevel]);
  assert.equal(toCarrier.gain.value, 0, 'the carrier path is closed (built silent)');
  // ...it reaches the pattern bus gain, which the voices play through.
  const route = s.runtime.edges.get('edge-1').gain;
  const bus = s.ctx.of('gain').find((g) => g !== osc.outputs.audio && g.outputs.includes(route));
  assert.deepEqual(toBus.outputs, [bus.gain]);
  assert.equal(toBus.gain.value, 1);
  const tone = s.ctx.oscillators.find((o) => o.type === 'sawtooth' && o.startAt === b
    && o !== osc.info.oscillator);
  assert.ok(reach(tone).has(bus), 'the Tone voice plays into the modulated bus');
  // The bus base is level + the edges' constant part, as the runtime gives the carrier; the
  // carrier stays at the floor (owned, never re-applied).
  const offset = s.runtime.baseOffset('osc-1', 'level');
  assert.equal(bus.gain.events[0].value, 1 + offset);
  assert.deepEqual(carrierLevel.calls.at(-1), ['setValueAtTime', ROUTE_FLOOR, 0]);
  // A depth edit acts on the edge gain (the runtime's route ramp), still into the bus.
  dispatch(s, { type: 'EDGE_UPDATE', edgeId: edge, props: { depth: 0.5 } });
  ok(s.transport.sync().applied);
  assert.deepEqual(eh.gain.outputs, [toCarrier, toBus]);
  assert.deepEqual(carrierLevel.calls.at(-1), ['setValueAtTime', ROUTE_FLOOR, 0]);
});

test('modulation into a level: claiming a sounding oscillator and releasing it crossfade',
  () => {
    const { model, edge } = levelModModel({ clips: false });
    const s = setup(model);
    ok(s.transport.start());
    s.fx.advance(0.3);
    const eh = s.runtime.edges.get(edge);
    const carrierLevel = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
    assert.deepEqual(eh.gain.outputs, [carrierLevel], 'not pattern-played: on the carrier');
    // A pattern clip arrives during playback: the carrier fades to the floor and the
    // modulation's carrier path fades with it, over the same crossfade.
    const soon = soonOf(s.ctx.currentTime);
    dispatch(s, { type: 'CLIP_ADD', trackId: 'track-1', start: 1, duration: 0.5,
      payload: { blockType: 'tone', params: { freq: 330 } } });
    ok(s.transport.sync().applied);
    const [toCarrier, toBus] = eh.gain.outputs;
    assert.deepEqual(toCarrier.outputs, [carrierLevel]);
    assert.equal(toBus.outputs.length, 1);
    const ramps = (p) => p.calls.filter((c) => c[0] === 'linearRampToValueAtTime');
    assert.deepEqual(ramps(toCarrier.gain), [['linearRampToValueAtTime', 0,
      soon + STUDIO_XFADE_S]]);
    assert.deepEqual(ramps(carrierLevel).at(-1), ['linearRampToValueAtTime', ROUTE_FLOOR,
      soon + STUDIO_XFADE_S]);
    // The clip goes away: the carrier path opens again with the carrier's own fade-in.
    s.fx.advance(0.3);
    const back = soonOf(s.ctx.currentTime);
    dispatch(s, { type: 'CLIP_REMOVE', clipId: s.store.getModel().timeline.clips[0].id });
    ok(s.transport.sync().applied);
    assert.deepEqual(ramps(toCarrier.gain).at(-1), ['linearRampToValueAtTime', 1,
      back + STUDIO_XFADE_S]);
    const up = ramps(carrierLevel).at(-1);
    assert.equal(up[1], 1 + s.runtime.baseOffset('osc-1', 'level'));
    near(up[2], back + STUDIO_XFADE_S);
  });
