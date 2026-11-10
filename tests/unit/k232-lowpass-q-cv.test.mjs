// K232: a low- or high-pass filter's Q as a dB-aware CV target. The biquad's Q is in dB for those
// types (audio/filters.js nodeQ: 20 * log10(Q)), and the Q knob is log-scaled, so a log cable
// (octaves of Q) is exactly linear in the node's dB: DB_PER_OCTAVE_Q (6.02 dB) per octave. A
// linear cable stays refused (it would be mis-scaled). The log cables' sum is held at or below
// the top of the knob's soft range (30), single biquad and 24 dB cascade alike, and a base above
// it is never lowered (review of oscilla-c1 on the design, condition 1). The Synth panel shows
// its filters' Peak jacks and pad L's Y is normalled to the LPF peak.
// On the merge base modTarget('Q', 'log') refuses with filterQ and the jacks are hidden.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as actions from '../../src/js/studio/actions.js';
import * as schema from '../../src/js/studio/schema.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as filters from '../../src/js/audio/filters.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { CLIP_TARGET_TEXT } from '../../src/js/studio/clip-targets.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { cableProps, jackState, patchCable } from '../../src/js/synth/normals.js';
import { xyTargets } from '../../src/js/synth/xy.js';
import { panelStore } from './synth-fixture.mjs';

const DB_OCT = 20 * Math.log10(2);
const CEILING = 30; // nodes/processing.js: the Q knob's soft-range top
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)),
  `${what}: ${a} vs ${b}`);
const last = (p) => (p.events.length ? p.events[p.events.length - 1].value : p.value);

/** A Studio with an XY pad (Y: a unipolar CONTROL source) cabled into a filter's Q. */
function doc({ type = 'lowpass', slope = '12', Q = 1, depth = 2, mapping = 'log' } = {}) {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const add = (nodeType) => st.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }).created.nodes[0];
  const pad = add('xy-pad');
  const f = add('filter');
  for (const [key, value] of Object.entries({ type, slope, Q })) {
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: f, key, value }).ok, true, key);
  }
  const r = st.dispatch({ type: 'EDGE_ADD', from: { node: pad, port: 'y' },
    to: { node: f, port: 'Q' }, props: { depth, mapping, polarity: 'unipolar' } });
  assert.equal(r.ok, true, r.reason);
  return { model: st.getModel(), pad, f, edge: r.created.edges[0] };
}

/** The document running on the fake engine: the filter's Q target and the cable's gain. */
function run(d) {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  assert.equal(runtime.apply(d.model).ok, true);
  assert.equal(runtime.start().ok, true);
  fx.advance(0.2);
  const h = runtime.nodes.get(d.f);
  const t = h.modTarget('Q', 'log');
  const eh = runtime.edges.get(d.edge);
  return { h, t, eh, base: t.param ? last(t.param) : null,
    gain: eh && eh.gain ? last(eh.gain.gain) : null };
}

test('a log cable into a low- or high-pass Q targets the dB param at 6.02 dB per octave; a '
  + 'linear one is refused', () => {
  assert.equal(typeof filters.DB_PER_OCTAVE_Q, 'number', 'audio/filters.js DB_PER_OCTAVE_Q');
  near(filters.DB_PER_OCTAVE_Q, DB_OCT, 'DB_PER_OCTAVE_Q');
  for (const type of ['lowpass', 'highpass']) {
    for (const slope of ['12', '24']) {
      const r = run(doc({ type, slope }));
      assert.ok(r.t && r.t.param, `${type} ${slope}: a Q target (${r.t && r.t.reason})`);
      near(r.t.scale, DB_OCT, `${type} ${slope}: scale`);
      assert.deepEqual(r.h.modTarget('Q', 'linear'), { reason: CLIP_TARGET_TEXT.filterQ },
        `${type} ${slope}: a linear Q cable stays refused`);
      assert.equal(r.eh.status, 'active', `${type} ${slope}: the cable plays`);
    }
  }
  // Other types keep their linear Q (and refuse a log one, as before).
  const bp = run(doc({ type: 'bandpass', mapping: 'linear', depth: 0.5 }));
  assert.ok(bp.h.modTarget('Q', 'linear').param);
  assert.ok(bp.h.modTarget('Q', 'log').reason);
});

test('the CV between its ends gives the knob\'s dB at each end: nodeQ(Q) and nodeQ(Q x 2^depth)',
  () => {
    for (const slope of ['12', '24']) {
      const r = run(doc({ Q: 1, depth: 2, slope }));
      near(r.base, filters.nodeQ('lowpass', 1), `${slope}: CV 0 plays the knob's Q 1`);
      near(r.base + r.gain * 1, filters.nodeQ('lowpass', 4), `${slope}: CV 1 plays Q 4`);
      const h = run(doc({ type: 'highpass', Q: 0.7, depth: 1, slope }));
      near(h.base + h.gain, filters.nodeQ('highpass', 1.4), `${slope}: the high-pass alike`);
    }
  });

test('condition 1: base Q at the top plus full CV never exceeds the knob\'s soft-range top, single '
  + 'biquad and cascade; a base above it is not lowered', () => {
  const top = filters.nodeQ('lowpass', CEILING);
  for (const slope of ['12', '24']) {
    const r = run(doc({ Q: 20, depth: 2, slope }));
    near(r.base, filters.nodeQ('lowpass', 20), `${slope}: the base as the knob says`);
    assert.ok(r.base + r.gain <= top + 1e-9, `${slope}: ${r.base + r.gain} dB over ${top}`);
    near(r.base + r.gain, top, `${slope}: the CV's room is used to the ceiling`);
    const over = run(doc({ Q: 50, depth: 2, slope }));
    near(over.base, filters.nodeQ('lowpass', 50), `${slope}: a base above it plays as typed`);
    assert.equal(over.gain, 0, `${slope}: the CV adds nothing upward there`);
  }
});

test('the Synth panel: LPF and HPF show Peak, the pad targets list them, pad L\'s Y drives LPF '
  + 'Peak and a cable still replaces that normal', () => {
  for (const mod of ['lpf', 'hpf']) {
    assert.ok(PANEL.jacksOf(mod).some((j) => j.port === 'Q' && j.direction === 'in'),
      `${mod} shows its Q jack`);
    assert.ok(!PANEL.jacksOf(mod).some((j) => j.port === 'gain'), `${mod} hides gain`);
  }
  const ids = xyTargets(PANEL).map((t) => t.id);
  assert.ok(ids.includes('lpf.Q') && ids.includes('hpf.Q'), ids.join());
  const n26 = PANEL.normals.find((n) => n.id === 'n26');
  assert.deepEqual([n26.from, n26.to, n26.props.mapping, n26.props.depth],
    ['xyl.y', 'lpf.Q', 'log', 2]);
  const st = panelStore();
  const m = st.getModel();
  assert.equal(jackState(m, PANEL, 'lpf.Q'), 'normalled');
  assert.equal(cableProps(m, PANEL, 'mg.control', 'lpf.Q').mapping, 'log',
    'a new cable into Peak is log');
  const r = patchCable(m, PANEL, 'eg2.control', 'lpf.Q');
  assert.ok(r.action, r.reason);
  assert.equal(st.dispatch(r.action).ok, true);
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.Q'), 'patched');
});

// ---------------------------------------------------------------- lanes (review condition 2)

test('a Q lane on a low- or high-pass plays on the biquad\'s dB Q: each point mapped, an '
  + 'exponential segment a linear ramp in dB', async () => {
  const { laneMap, clipTarget } = await import('../../src/js/studio/clip-targets.js');
  const { createStudioTransport } = await import('../../src/js/studio/transport.js');
  const { NODE_REGISTRY } = await import('../../src/js/studio/registry.js');
  const qDef = NODE_REGISTRY.param('filter', 'Q');
  assert.equal(qDef.lane, 'db-of-q', 'the mapping is declared on the parameter definition');
  assert.equal(laneMap(qDef, { type: 'bandpass' }), null, 'other types play Q as it is');
  near(laneMap(qDef, { type: 'lowpass' })(4), filters.nodeQ('lowpass', 4), 'laneMap is nodeQ');
  for (const [type, slope] of [['lowpass', '12'], ['highpass', '24']]) {
    const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
      graph: { nodes: [], edges: [] } });
    const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
    const f = st.dispatch({ type: 'NODE_ADD', nodeType: 'filter', position: { x: 0, y: 0 } })
      .created.nodes[0];
    for (const [key, value] of Object.entries({ type, slope, Q: 1 })) {
      assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: f, key, value }).ok, true);
    }
    const node = st.getModel().graph.nodes.find((n) => n.id === f);
    assert.equal(clipTarget(node, { kind: 'automation', param: 'Q' }).plays, true,
      `${type}: the policy plays a Q lane`);
    for (const [time, value, curve] of [[0, 1, 'linear'], [1, 4, 'exponential']]) {
      assert.equal(st.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: f, param: 'Q' },
        time, value, curve }).ok, true);
    }
    const fx = createFakeAudioEnv({ sampleRate: 48000 });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init());
    const runtime = createStudioRuntime({ engine });
    const t = createStudioTransport({ runtime, engine, store: st });
    assert.equal(t.start().ok, true);
    fx.advance(0.1);
    const q = runtime.nodes.get(f).modTarget('Q', 'log').param;
    const vals = q.events.map((e) => [e.ramp, Math.round(e.value * 1e6) / 1e6]);
    const db4 = Math.round(filters.nodeQ(type, 4) * 1e6) / 1e6;
    assert.ok(vals.some(([ramp, v]) => ramp === 'linear' && v === db4),
      `${type} ${slope}: the point at Q 4 arrives as ${db4} dB on a linear ramp: ${
        JSON.stringify(vals)}`);
    assert.ok(!vals.some(([, v]) => v === 4), `${type}: no unmapped Q value reaches the node`);
    assert.ok(runtime.ownedParams().some((o) => o.node === f && o.param === 'Q'),
      `${type}: the lane owns Q, so the base does not write it`);
    t.stop({ fast: true });
    fx.advance(0.5);
  }
  // A shelf still ignores Q: its lane stays refused.
  const shelf = { id: 'x', type: 'filter', params: { type: 'lowshelf' }, metadata: { name: 'x' } };
  assert.equal(clipTarget(shelf, { kind: 'automation', param: 'Q' }).plays, false);
});
