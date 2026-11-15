// E018: the edges between automation lanes and the runtime's parameter bases.
//   - #197 R-7: a detune that a detune lane owns spends the frequency's log-edge headroom by
//     the lane's peak alone, not by the static detune the lane overrides (computeBases).
//   - docs/v31/review-v272.md follow-up: a released lane-owned parameter holds at the
//     transport's hold time before the runtime's base glide starts (runtime.setOwnedParams
//     releaseAt), so no base glide is scheduled inside the release's ~20 ms window.
//   node --test tests/unit/studio-automation-edges.test.mjs
// Runs the real AudioEngine on the recording fake context (sequencer-fake-audio.mjs), with the
// store's commit gate wired to the transport as the Studio workspace does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { safeHorizon } from '../../src/js/studio/timeline-compiler.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

function setup(model, sampleRate) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  let transport = null;
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime, engine, store });
  return { fx, runtime, store, transport, ctx: fx.ctx };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));

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

function withOsc(params) {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  return { ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === 'osc-1'
    ? { ...n, params: { ...n.params, ...params } } : n)) } };
}

// ---------------------------------------------------------------- R-7 (review of #197)

// Oscillator at 12 kHz, static detune +1200 ct, a detune lane at 0 ct and a log LFO->frequency
// edge with offset 0.1 octave (120 ct constant): the lane overrides the static detune, so the
// frequency's headroom (964.6 ct at 44.1 kHz, 1111 ct at 48 kHz) is spent by the lane's 0 ct
// and the edge plays its 120 ct constant, unlimited.
for (const rate of [44100, 48000]) {
  test(`E018 R-7: a lane-owned detune leaves the log edge its headroom (${rate} Hz)`, () => {
    const s = setup(withOsc({ frequency: 12000, detune: 1200 }), rate);
    dispatch(s, { type: 'EDGE_ADD', from: { node: 'lfo-1', port: 'control' },
      to: { node: 'osc-1', port: 'frequency' },
      props: { mapping: 'log', polarity: 'bipolar', depth: 0.1, offset: 0.1 } });
    const edge = s.store.getModel().graph.edges.find((e) => e.to.node === 'osc-1'
      && e.to.port === 'frequency');
    dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
      time: 0, value: 0, curve: 'step' });
    const r = ok(s.transport.start());
    s.fx.advanceTo(r.baseTime + 0.5);
    const ceiling = 1200 * Math.log2((rate / 2) * 0.95 / 12000);
    assert.ok(240 <= ceiling, `the edge's 120 ct and its 120 ct swing fit ${ceiling} ct`);
    near(s.runtime.baseOffset('osc-1', 'detune'), 120, 1e-6, 'the edge\'s constant');
    const osc = s.runtime.nodes.get('osc-1').info.oscillator;
    near(actualAt(s, osc.detune, s.ctx.currentTime), 120, 1e-6, 'lane 0 ct + the edge\'s 120 ct');
    assert.ok(!s.runtime.debugInfo().limitedEdges.includes(edge.id),
      `${edge.id} is not limited: ${s.runtime.debugInfo().limitedEdges}`);
  });
}

// ---------------------------------------------------------------- the release window

/** Every setTargetAtTime added to `p` since call index n0, as [value, time]. */
const glidesSince = (p, n0) => p.calls.slice(n0).filter((c) => c[0] === 'setTargetAtTime')
  .map((c) => [c[1], c[2]]);

/** Remove every point of the lane on node.param but the last (the lane stays). */
function trimLane(s, node, param) {
  const lane = s.store.getModel().timeline.automation
    .find((l) => l.target.node === node && l.target.param === param);
  for (const pt of lane.points.slice(1)) {
    dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', laneId: lane.id, pointId: pt.id });
  }
  return { laneId: lane.id, pointId: lane.points[0].id };
}

for (const rate of [44100, 48000]) {
  test(`E018: a released filter-frequency lane glides only from the hold (${rate} Hz)`, () => {
    const s = setup(templateModel(REFERENCE_TEMPLATE_ID), rate);
    ok(s.transport.start());
    s.fx.advance(1.0);
    const p = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
    const last = trimLane(s, 'filter-1', 'frequency');
    const n0 = p.calls.length;
    const hold = safeHorizon(s.ctx.currentTime, rate);
    dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', ...last }); // the lane is gone
    const glides = glidesSince(p, n0);
    assert.ok(glides.length > 0, 'the released parameter glides back to its base');
    for (const [v, t] of glides) {
      assert.ok(t >= hold - 1e-12, `a glide to ${v} at ${t} s precedes the hold at ${hold} s`);
    }
    s.fx.advance(0.5);
    const base = s.store.getModel().graph.nodes.find((n) => n.id === 'filter-1').params.frequency;
    near(actualAt(s, p, s.ctx.currentTime), base, 1e-2, 'the base after the glide');
  });

  test(`E018: a released detune lane glides only from the hold (${rate} Hz)`, () => {
    const s = setup(withOsc({ detune: 300 }), rate);
    dispatch(s, { type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
      time: 0, value: -500, curve: 'step' });
    ok(s.transport.start());
    s.fx.advance(1.0);
    const osc = s.runtime.nodes.get('osc-1').info.oscillator;
    const last = trimLane(s, 'osc-1', 'detune');
    const n0 = osc.detune.calls.length;
    const hold = safeHorizon(s.ctx.currentTime, rate);
    dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', ...last }); // the lane is gone
    for (const [v, t] of glidesSince(osc.detune, n0)) {
      assert.ok(t >= hold - 1e-12, `a glide to ${v} at ${t} s precedes the hold at ${hold} s`);
    }
    near(actualAt(s, osc.detune, hold - 1e-6), -500, 1e-6, 'the lane value until the hold');
    s.fx.advance(0.5);
    near(actualAt(s, osc.detune, s.ctx.currentTime), 300, 1e-2, 'the static detune after it');
  });
}

test('E018: a parameter claimed again inside the release window is owned again', () => {
  const s = setup(templateModel(REFERENCE_TEMPLATE_ID), 48000);
  ok(s.transport.start());
  s.fx.advance(1.0);
  const last = trimLane(s, 'filter-1', 'frequency');
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', ...last }); // the lane is gone
  ok(s.store.undo());
  assert.ok(s.runtime.ownedParams().some((o) => o.node === 'filter-1'
    && o.param === 'frequency'), 'the lane owns the cutoff again');
  s.fx.advance(0.5);
  const p = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
  assert.ok(Number.isFinite(actualAt(s, p, s.ctx.currentTime)), 'the cutoff has a value');
});

// ---------------------------------------------------------------- C065: an edit in the window

/** The cutoff's lane removed while playing; returns the param and the node's base then. */
function removedCutoffLane(s) {
  ok(s.transport.start());
  s.fx.advance(1.0);
  const p = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
  const last = trimLane(s, 'filter-1', 'frequency');
  dispatch(s, { type: 'AUTOMATION_POINT_REMOVE', ...last }); // the lane is gone
  const base = s.store.getModel().graph.nodes.find((n) => n.id === 'filter-1').params.frequency;
  return { p, base };
}

const setCutoff = (s, hz) => dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1',
  params: { frequency: hz } });

for (const rate of [44100, 48000]) {
  test(`C065: a base edit 5 ms after a lane is removed is the value played (${rate} Hz)`, () => {
    const s = setup(templateModel(REFERENCE_TEMPLATE_ID), rate);
    const { p, base } = removedCutoffLane(s);
    assert.equal(base, 500, 'the template cutoff the release glides back to');
    s.fx.advance(0.005); // inside the release window (one edit horizon)
    setCutoff(s, 2000);
    s.fx.advance(0.5);
    near(actualAt(s, p, s.ctx.currentTime), 2000, 1e-2, 'the edited base, never the old 500');
    const last = p.calls.filter((c) => c[0] === 'setTargetAtTime').at(-1);
    near(last[1], 2000, 1e-9, 'the last scheduled target is the edited base');
  });
}

test('C065: undo and redo of a base edit inside the window end on the base the model holds',
  () => {
    const s = setup(templateModel(REFERENCE_TEMPLATE_ID), 48000);
    const { p, base } = removedCutoffLane(s);
    // All three inside the window: the edit, its undo and its redo each re-aim the glide.
    setCutoff(s, 2000);
    ok(s.store.undo()); // back to the base the lane was removed with
    const mid = s.ctx.currentTime + 0.02;
    ok(s.store.redo());
    s.fx.advance(0.5);
    near(actualAt(s, p, s.ctx.currentTime), 2000, 1e-2, 'redo: the edited base is played');
    assert.ok(Number.isFinite(actualAt(s, p, mid)), 'the cutoff has a value throughout');
    // An undo inside a new window ends on the base the model holds after it.
    const again = setup(templateModel(REFERENCE_TEMPLATE_ID), 48000);
    const r = removedCutoffLane(again);
    setCutoff(again, 2000);
    ok(again.store.undo());
    again.fx.advance(0.5);
    near(actualAt(again, r.p, again.ctx.currentTime), base, 1e-2, 'undo: the model\'s base');
  });

test('C065: an edit to another parameter inside the window does not re-aim the cutoff', () => {
  const s = setup(templateModel(REFERENCE_TEMPLATE_ID), 48000);
  const { p, base } = removedCutoffLane(s);
  const n0 = p.calls.length;
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', params: { Q: 2 } });
  assert.deepEqual(glidesSince(p, n0), [], 'no new glide on the cutoff');
  s.fx.advance(0.5);
  near(actualAt(s, p, s.ctx.currentTime), base, 1e-2, 'the cutoff ends on its unchanged base');
});

test('C1-C065-1: an edge offset changed with the base inside the window is the offset played',
  () => {
    // The LFO -> cutoff edge as a linear one with a 300 Hz constant offset, from the start.
    const m = templateModel(REFERENCE_TEMPLATE_ID);
    const edges = m.graph.edges.map((e) => (e.id === 'edge-4'
      ? { ...e, props: { ...e.props, mapping: 'linear', offset: 300, depth: 0.1 } } : e));
    const s = setup({ ...m, graph: { ...m.graph, edges } }, 48000);
    const { p } = removedCutoffLane(s);
    near(s.runtime.baseOffset('filter-1', 'frequency'), 300, 1e-9, 'the edge offset at removal');
    // Inside the window: the edge's offset to 600 and the base to 2000.
    dispatch(s, { type: 'EDGE_UPDATE', edgeId: 'edge-4', props: { offset: 600 } });
    setCutoff(s, 2000);
    s.fx.advance(0.5);
    near(actualAt(s, p, s.ctx.currentTime), 2600, 1e-2, 'the base plus the live offset');
  });
