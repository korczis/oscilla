// V272 §272 final review, automation lanes during playback (findings B3, B4, B6, B7, B8): the
// value the AudioParam actually takes, its own schedule plus every ConstantSourceNode summed into
// it, is the lane value (plus the modulation edges' constant offset, spec §103) after an edit,
// an undo, an offset change and a locate.
//   node --test tests/unit/v272-studio-automation.test.mjs
// Runs the real AudioEngine on the recording fake context (sequencer-fake-audio.mjs), with the
// store's commit gate wired to the transport as the Studio workspace does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { automateParameter, laneValueAt } from '../../src/js/studio/automation.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

function setup(model = templateModel(REFERENCE_TEMPLATE_ID), sampleRate = SR) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  let transport = null;
  // The workspace's commit gate: while playing, the transport admits the model first.
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime, engine, store });
  return { fx, runtime, store, transport, ctx: fx.ctx };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));
const lane1 = (s) => s.store.getModel().timeline.automation[0];
const param = (s, node, key) => s.runtime.nodes.get(node).modTarget(key, 'linear').param;

/** A FakeParam's own value at t (set, linear, exponential and setTargetAtTime events). */
function ownValueAt(p, t) {
  const ev = p.events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  let v = p.defaultValue;
  let t0 = 0;
  let target = null;
  const at = (x) => (target ? target.value + (v - target.value) * Math.exp(-(x - t0)
    / target.tau) : v);
  for (const e of ev) {
    if (e.t > t) {
      if (e.ramp === 'linear' || e.ramp === 'exponential') {
        const a = at(t0);
        const k = (t - t0) / (e.t - t0);
        if (e.ramp === 'linear') return a + (e.value - a) * k;
        return a * e.value > 0 ? a * (e.value / a) ** k : a;
      }
      break;
    }
    const now = at(e.t);
    if (e.ramp === 'target') {
      v = now;
      target = e;
    } else {
      v = e.value;
      target = null;
    }
    t0 = e.t;
  }
  return at(t);
}

/** What the AudioParam takes at t: its own schedule plus the constant sources summed into it. */
function actualAt(s, p, t) {
  let v = ownValueAt(p, t);
  for (const n of s.ctx.created) {
    if (n.kind !== 'constant-source' || !n.outputs.includes(p)) continue;
    if (n.startAt === null || n.startAt > t || (n.stopAt !== null && n.stopAt <= t)) continue;
    v += ownValueAt(n.offset, t);
  }
  return v;
}

const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

// ---------------------------------------------------------------- B3

for (const [label, action] of [
  ['the last point removed (flat 500 Hz)', { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1',
    pointId: 'pt-2' }],
  ['the last point moved behind the playhead', { type: 'AUTOMATION_POINT_MOVE',
    laneId: 'lane-1', pointId: 'pt-2', time: 0.5 }],
  ['the first point raised to 2000 Hz', { type: 'AUTOMATION_POINT_MOVE', laneId: 'lane-1',
    pointId: 'pt-1', value: 2000 }],
]) {
  test(`V272 B3: an edited lane continues with the new lane's value (${label})`, () => {
    const s = setup();
    ok(s.transport.start());
    s.fx.advance(1.5);
    dispatch(s, action);
    s.fx.advance(0.5);
    const want = laneValueAt(lane1(s).points, s.transport.playhead().position);
    near(actualAt(s, param(s, 'filter-1', 'frequency'), s.ctx.currentTime), want, 1e-3,
      'cutoff after the edit');
  });
}

test('V272 B3: a one-point LFO rate lane dragged while playing reaches the new value', () => {
  const s = setup();
  dispatch(s, automateParameter(s.store.getModel(), 'lfo-1', 'rate').action);
  ok(s.transport.start());
  s.fx.advance(0.5);
  const lane = s.store.getModel().timeline.automation.find((l) => l.target.param === 'rate');
  dispatch(s, { type: 'AUTOMATION_POINT_MOVE', laneId: lane.id, pointId: lane.points[0].id,
    value: 6 });
  s.fx.advance(1.0);
  near(actualAt(s, param(s, 'lfo-1', 'rate'), s.ctx.currentTime), 6, 1e-3, 'LFO rate');
});

// ---------------------------------------------------------------- B4

test('V272 B4: a lane restored by undo starts from the value the param has, no step', () => {
  const s = setup();
  ok(s.transport.start());
  s.fx.advance(1.0);
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1', pointId: 'pt-2' });
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1', pointId: 'pt-1' });
  s.fx.advance(0.5); // the released cutoff glides back to its base (500 Hz)
  const p = param(s, 'filter-1', 'frequency');
  const t = s.ctx.currentTime;
  const before = actualAt(s, p, t + 0.02);
  const n0 = p.calls.length;
  ok(s.store.undo()); // the lane returns with its one point (500 Hz)
  const after = actualAt(s, p, t + 0.02);
  for (const c of p.calls.slice(n0)) {
    if (c[0] !== 'setValueAtTime') continue;
    near(c[1], actualAt(s, p, c[2] - 1e-7), 1e-2, `setValueAtTime at ${c[2]} is no step`);
  }
  near(after, before, 1e-2, 'unchanged before the horizon');
  s.fx.advance(0.1);
  near(actualAt(s, p, s.ctx.currentTime), 500, 1e-3, 'the restored lane');
});

test('V272 B4: a lane restored while its release glide runs starts from the glide', () => {
  const s = setup();
  ok(s.transport.start());
  s.fx.advance(1.0);
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1', pointId: 'pt-2' });
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1', pointId: 'pt-1' });
  s.fx.advance(0.03); // the cutoff is still on its way back to 500 Hz
  const p = param(s, 'filter-1', 'frequency');
  const n0 = p.calls.length;
  ok(s.store.undo());
  const sets = p.calls.slice(n0).filter((c) => c[0] === 'setValueAtTime');
  assert.ok(sets.length, 'the restored lane is anchored');
  for (const c of sets) {
    near(c[1], actualAt(s, p, c[2] - 1e-7), 1e-2, `setValueAtTime at ${c[2]} is no step`);
  }
  s.fx.advance(0.2);
  near(actualAt(s, p, s.ctx.currentTime), 500, 1e-3, 'the restored lane');
});

test('V272 B4: a lane restored with its node (undo of a delete) plays the lane value', () => {
  const s = setup();
  ok(s.transport.start());
  s.fx.advance(1.0);
  dispatch(s, { type: 'NODE_REMOVE', nodeIds: ['filter-1'] });
  s.fx.advance(0.3);
  ok(s.store.undo());
  s.fx.advance(0.2);
  const want = laneValueAt(lane1(s).points, s.transport.playhead().position);
  near(actualAt(s, param(s, 'filter-1', 'frequency'), s.ctx.currentTime), want, 1e-3,
    'the restored node\'s cutoff');
});

// ---------------------------------------------------------------- B6, B7

/** Basic Synth whose LFO → cutoff edge is linear and unipolar: a constant offset of depth / 2. */
function linearEdge(s, offset) {
  dispatch(s, { type: 'EDGE_UPDATE', edgeId: 'edge-4', props: { mapping: 'linear',
    polarity: 'unipolar', depth: 200, offset } });
}

test('V272 B6: a changed edge offset reaches a lane that is already scheduled', () => {
  const s = setup();
  linearEdge(s, 0);
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advance(0.5);
  dispatch(s, { type: 'EDGE_UPDATE', edgeId: 'edge-4', props: { offset: 3000 } });
  assert.equal(s.runtime.baseOffset('filter-1', 'frequency'), 3100);
  s.fx.advance(1.0);
  const p = param(s, 'filter-1', 'frequency');
  near(actualAt(s, p, b + 2.0), laneValueAt(lane1(s).points, 2.0) + 3100, 1e-3,
    'cutoff base at position 2.0 s');
});

test('V272 B7: an exponential lane plus a constant offset is the lane plus the offset',
  async () => {
  const s = setup();
  linearEdge(s, 3000);
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advance(0.3);
  const p = param(s, 'filter-1', 'frequency');
  const off = s.runtime.baseOffset('filter-1', 'frequency');
  assert.equal(off, 3100);
  for (const pos of [0.5, 1.5, 2.5]) {
    const want = laneValueAt(lane1(s).points, pos) + off;
    const cents = 1200 * Math.log2(actualAt(s, p, b + pos) / want);
    assert.ok(Math.abs(cents) < 1, `position ${pos} s: ${cents.toFixed(2)} cents off`);
  }
  // Whatever carries the offset leaves with the graph: STOP leaves no node and no source.
  const done = s.transport.stop();
  s.fx.advance(1);
  const c = await done;
  assert.deepEqual([c.nodes, c.sources], [0, 0]);
  for (const n of s.ctx.created) {
    if (n.kind !== 'constant-source' || !n.outputs.includes(p)) continue;
    assert.fail('an offset source is still connected after STOP');
  }
});

test('V272 B7: a lane with an offset removed while playing leaves the base + offset', () => {
  // The offset source glides out with the lane while the param glides to base + offset: the
  // sum is the runtime's base, the offset counted once.
  const s = setup();
  linearEdge(s, 3000);
  ok(s.transport.start());
  s.fx.advance(1.0);
  const p = param(s, 'filter-1', 'frequency');
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1', pointId: 'pt-2' });
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: 'lane-1', pointId: 'pt-1' });
  s.fx.advance(0.5);
  near(actualAt(s, p, s.ctx.currentTime), 500 + 3100, 1e-3, 'the base the runtime owns again');
});

test('V272 B4/B7: a lane added while playing on a parameter with an offset starts there', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const s = setup({ ...m, timeline: { ...m.timeline, automation: [] } });
  linearEdge(s, 3000);
  ok(s.transport.start());
  s.fx.advance(0.5);
  const p = param(s, 'filter-1', 'frequency');
  const t = s.ctx.currentTime;
  const n0 = p.calls.length;
  dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'filter-1', param: 'frequency' },
    time: 0, value: 2000, curve: 'linear' });
  const h = p.calls.slice(n0).find((c) => c[0] === 'setValueAtTime')[2];
  assert.ok(h > t, 'anchored after now');
  near(actualAt(s, p, h), actualAt(s, p, h - 1e-7), 1e-2, 'no step where the lane starts');
  near(actualAt(s, p, h), 500 + 3100, 1e-2, 'from the base the runtime gave it');
  s.fx.advance(0.3);
  near(actualAt(s, p, s.ctx.currentTime), 2000 + 3100, 1e-3, 'the lane plus the offset');
});

// ---------------------------------------------------------------- B8

test('V272 B8: locate while playing leaves no stale lane events for a rebuilt node', () => {
  const s = setup();
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advance(2.5);
  s.transport.locate(0);
  s.fx.advance(0.2);
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'enabled', value: false });
  const rb = s.transport.debugInfo().decisions.find((x) => x.decision === 'rebind');
  assert.ok(rb, 'the lane was rebound to the rebuilt filter');
  const p = param(s, 'filter-1', 'frequency');
  const pos = s.transport.playhead().position + (rb.at - s.ctx.currentTime);
  const set = p.calls.find((c) => c[0] === 'setValueAtTime' && c[2] === rb.at);
  assert.ok(set, 'anchored at the horizon');
  near(set[1], laneValueAt(lane1(s).points, pos), 1e-3, 'anchor = the lane at the horizon');
  const oldEnd = b + 3;
  assert.ok(!p.calls.some((c) => c[0] !== 'cancelScheduledValues' && Math.abs(c[2] - oldEnd)
    < 1e-6), 'nothing from the playback before the locate');
  s.fx.advance(0.5);
  near(actualAt(s, p, s.ctx.currentTime), laneValueAt(lane1(s).points,
    s.transport.playhead().position), 1e-3, 'the lane after the locate');
});

// ---------------------------------------------------------------- A7 (detune lane)

for (const rate of [44100, 48000]) {
  test(`V272 A7: a +1200 ct detune lane on a 12 kHz oscillator stays below 0.95 x Nyquist (${
    rate} Hz)`, () => {
    const m = templateModel(REFERENCE_TEMPLATE_ID);
    const s = setup({ ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === 'osc-1'
      ? { ...n, params: { ...n.params, frequency: 12000 } } : n)) } }, rate);
    dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
      time: 0, value: 1200, curve: 'step' });
    ok(s.transport.start());
    s.fx.advance(0.5);
    const osc = s.runtime.nodes.get('osc-1').info.oscillator;
    const cap = (s.ctx.sampleRate / 2) * 0.95;
    const t = s.ctx.currentTime;
    const f = ownValueAt(osc.frequency, t) * 2 ** (actualAt(s, osc.detune, t) / 1200);
    assert.ok(f <= cap * (1 + 1e-9), `${f.toFixed(1)} Hz requested, safe maximum ${cap} Hz`);
    near(f, cap, 1e-6 * cap, 'the lane is bounded at the safe maximum, not below it');
    const lane = s.transport.debugInfo().lanes.find((l) => l.target.param === 'detune');
    assert.equal(lane.limited, true, 'the bounded lane is reported');
    assert.deepEqual(s.transport.debugInfo().limitedLanes.map((l) => [l.node, l.param]),
      [['osc-1', 'detune']]);
  });
}

test('V272 A7: a detune lane follows its bound when the frequency is raised while playing',
  () => {
  const s = setup();
  dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
    time: 0, value: 1200, curve: 'step' });
  ok(s.transport.start());
  s.fx.advance(0.5);
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 12000 });
  s.fx.advance(0.5);
  const osc = s.runtime.nodes.get('osc-1').info.oscillator;
  const cap = (s.ctx.sampleRate / 2) * 0.95;
  const t = s.ctx.currentTime;
  const f = ownValueAt(osc.frequency, t) * 2 ** (actualAt(s, osc.detune, t) / 1200);
  assert.ok(f <= cap * (1 + 1e-6), `${f.toFixed(1)} Hz requested, safe maximum ${cap} Hz`);
});

test('V272 A7: a changed log-edge offset reaches a detune lane while it plays', () => {
  const s = setup();
  dispatch(s, { type: 'EDGE_ADD', from: { node: 'lfo-1', port: 'control' },
    to: { node: 'osc-1', port: 'frequency' },
    props: { mapping: 'log', polarity: 'bipolar', depth: 0.1, offset: 0 } });
  dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
    time: 0, value: 0, curve: 'step' });
  ok(s.transport.start());
  s.fx.advance(0.5);
  const edge = s.store.getModel().graph.edges.find((e) => e.to.node === 'osc-1'
    && e.to.port === 'frequency');
  dispatch(s, { type: 'EDGE_UPDATE', edgeId: edge.id, props: { offset: 0.5 } });
  assert.equal(s.runtime.baseOffset('osc-1', 'detune'), 600);
  s.fx.advance(0.5);
  const osc = s.runtime.nodes.get('osc-1').info.oscillator;
  near(actualAt(s, osc.detune, s.ctx.currentTime), 600, 1e-6, 'lane 0 ct + the edge\'s 600 ct');
});

// ---------------------------------------------------------------- R-1 (review of #197)

// The static detune the compiler lowers to fit the headroom (computeBases `clamped`) is not an
// edge offset: a detune lane overrides that static value, so it plays its own values, each
// inside its own ceiling.
for (const rate of [44100, 48000]) {
  test(`V272 R-1: a clamped static detune does not shift a detune lane (${rate} Hz)`, () => {
    const m = templateModel(REFERENCE_TEMPLATE_ID);
    const s = setup({ ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === 'osc-1'
      ? { ...n, params: { ...n.params, frequency: 12000, detune: 1200 } } : n)) } }, rate);
    dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
      time: 0, value: 0, curve: 'step' });
    dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
      time: 1, value: 500, curve: 'step' });
    dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
      time: 2, value: -600, curve: 'step' });
    const r = ok(s.transport.start());
    const osc = s.runtime.nodes.get('osc-1').info.oscillator;
    const ceiling = 1200 * Math.log2((rate / 2) * 0.95 / 12000);
    for (const [at, want] of [[0.5, 0], [1.5, 500], [2.5, -600]]) {
      s.fx.advanceTo(r.baseTime + at);
      assert.ok(want <= ceiling, `${want} ct is within its ceiling ${ceiling.toFixed(1)} ct`);
      near(actualAt(s, osc.detune, s.ctx.currentTime), want, 1e-6, `detune at ${at} s`);
    }
    assert.equal(s.runtime.baseOffset('osc-1', 'detune'), 0, 'no edge, no offset');
    assert.deepEqual(s.transport.debugInfo().limitedLanes, [], 'no lane value is bounded');
  });
}
