// Studio cable re-route and replace (plan K008; spec §33, §46, §50, §65; rules typed-ports,
// no-silent-feedback): a cable dropped on an occupied single input replaces the cable there, a
// cable picked up at its input end is re-routed where it is dropped or deleted on empty canvas,
// each as one history entry (EDGE_REMOVE then EDGE_ADD). A drop the validator refuses (type,
// feedback cycle) leaves the model, history, revision and runtime unchanged, with its sentence.
//   src/js/ui/studio/graph-view.js probeRewire, connectionTargets(..., { rewire, detach })
//   src/js/ui/studio/graph-gestures.js rewireCable
//   node --test tests/unit/studio-graph-rewire.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  connectionTargets, probeConnection, probeRewire,
} from '../../src/js/ui/studio/graph-view.js';
import { bodyTarget, rewireCable } from '../../src/js/ui/studio/graph-gestures.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { AUDIO_FEEDBACK_MESSAGE } from '../../src/js/studio/validate.js';

// The Subtractive Synth: osc-1 -edge-1-> env-1 -edge-2-> filter-1 -edge-3-> master-1,
// lfo-1 -edge-4-> filter-1.frequency, filter-1 -edge-5-> spectrum-1.
const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const at = (node, port) => ({ node, port });

function storeWithGate(m = synth()) {
  const calls = [];
  const store = createStudioStore(m, { idGenerator: createIdGenerator(m),
    gate: (next, info) => { calls.push(info.reason); return null; } });
  return { store, calls };
}

const edgeKey = (e) => `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`;
const keys = (m) => m.graph.edges.map(edgeKey).sort();

test('K008 an occupied single input is refused by EDGE_ADD but replaceable by a drop', () => {
  const m = synth();
  const plain = probeConnection(m, at('osc-1', 'audio'), at('filter-1', 'audio'));
  assert.equal(plain.allowed, false);
  const r = probeRewire(m, at('osc-1', 'audio'), at('filter-1', 'audio'));
  assert.equal(r.allowed, true);
  assert.deepEqual(r.replaces, ['edge-2']);
  assert.deepEqual(r.remove, ['edge-2']);
  assert.equal(r.same, false);
  // A free or multiple input replaces nothing.
  const free = probeRewire(m, at('lfo-1', 'control'), at('filter-1', 'Q'));
  assert.equal(free.allowed, true);
  assert.deepEqual(free.replaces, []);
});

test('K008 a picked-up cable is judged without itself; dropped back it is unchanged', () => {
  const m = synth();
  const back = probeRewire(m, at('env-1', 'audio'), at('filter-1', 'audio'), { detach: 'edge-2' });
  assert.equal(back.allowed, true);
  assert.equal(back.same, true);
  assert.deepEqual(back.remove, []);
  // edge-4 (LFO -> cutoff) moved to Q: the old edge goes, nothing is replaced.
  const q = probeRewire(m, at('lfo-1', 'control'), at('filter-1', 'Q'), { detach: 'edge-4' });
  assert.equal(q.allowed, true);
  assert.deepEqual(q.remove, ['edge-4']);
  // edge-5 (Filter -> Spectrum) moved onto the occupied Master input: both old edges go.
  const mv = probeRewire(m, at('filter-1', 'audio'), at('master-1', 'audio'), { detach: 'edge-5' });
  assert.equal(mv.allowed, false, 'filter-1 is already connected to master-1');
  assert.match(mv.reason, /^Connection rejected/);
  const env = probeRewire(m, at('osc-1', 'audio'), at('filter-1', 'audio'), { detach: 'edge-1' });
  assert.equal(env.allowed, true);
  assert.deepEqual(env.remove, ['edge-1', 'edge-2']);
});

test('K008 a type mismatch or a feedback loop is refused with the validator sentence', () => {
  const m = synth();
  const type = probeRewire(m, at('lfo-1', 'control'), at('master-1', 'audio'),
    { detach: 'edge-4' });
  assert.equal(type.allowed, false);
  assert.match(type.reason,
    /^Connection rejected: Control output cannot connect to an audio input/);
  assert.deepEqual(type.remove, []);
  // Filter -> Envelope (occupied by the Oscillator): replacing edge-1 would close
  // env -> filter -> env, an instantaneous audio loop.
  const loop = probeRewire(m, at('filter-1', 'audio'), at('env-1', 'audio'));
  assert.equal(loop.allowed, false);
  assert.ok(loop.reason.startsWith(AUDIO_FEEDBACK_MESSAGE), loop.reason);
});

test('K008 connectionTargets judges replacements only when asked (drag), never for tap', () => {
  const m = synth();
  const find = (list) => list.find((t) => t.node === 'filter-1' && t.port === 'audio');
  const tap = find(connectionTargets(m, at('osc-1', 'audio')));
  assert.equal(tap.allowed, false);
  const drag = find(connectionTargets(m, at('osc-1', 'audio'), undefined, { rewire: true }));
  assert.equal(drag.allowed, true);
  assert.deepEqual(drag.replaces, ['edge-2']);
  const moved = connectionTargets(m, at('env-1', 'audio'), undefined, { rewire: true,
    detach: 'edge-2' });
  assert.equal(find(moved).same, true);
});

test('K008 replace is one history entry: EDGE_REMOVE then EDGE_ADD; undo restores it', () => {
  const { store } = storeWithGate();
  const before = store.getModel();
  const depth = store.debugInfo().undoDepth;
  const r = rewireCable(store, { from: at('osc-1', 'audio'), to: at('filter-1', 'audio') });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.match(r.text,
    /^Connected Oscillator 1 to Filter 1, replacing the connection from Envelope 1$/);
  const m = store.getModel();
  assert.ok(!m.graph.edges.some((e) => e.id === 'edge-2'));
  assert.ok(keys(m).includes('osc-1.audio>filter-1.audio'));
  assert.equal(store.debugInfo().undoDepth, depth + 1);
  assert.equal(store.debugInfo().lastAction.label, 'Replace the connection into Filter 1');
  store.undo();
  assert.deepEqual(store.getModel().graph, before.graph);
});

test('K008 re-route moves the picked-up cable as one entry and keeps its settings', () => {
  const m0 = synth();
  const { store } = storeWithGate(m0);
  const filter2 = store.dispatch({ type: 'NODE_ADD', nodeType: 'filter', position: { x: 0,
    y: 520 } }).created.nodes[0];
  const depth = store.debugInfo().undoDepth;
  const old = store.getModel().graph.edges.find((e) => e.id === 'edge-4');
  const r = rewireCable(store, { from: at('lfo-1', 'control'), to: at(filter2, 'frequency'),
    detach: 'edge-4' });
  assert.equal(r.ok, true);
  const m = store.getModel();
  assert.ok(!m.graph.edges.some((e) => e.id === 'edge-4'));
  const moved = m.graph.edges.find((e) => e.from.node === 'lfo-1' && e.to.node === filter2);
  assert.ok(moved);
  assert.deepEqual(moved.props, old.props, 'the same parameter keeps depth, mapping, polarity');
  assert.equal(store.debugInfo().undoDepth, depth + 1);
  assert.equal(store.debugInfo().lastAction.label, `Reconnect LFO 1 to Filter 2`);
  // Onto another parameter the props are the target's defaults.
  const q = rewireCable(store, { from: at('lfo-1', 'control'), to: at(filter2, 'Q'),
    detach: moved.id });
  assert.equal(q.ok, true);
  const toQ = store.getModel().graph.edges.find((e) => e.to.node === filter2 && e.to.port === 'Q');
  assert.notDeepEqual(toQ.props, old.props);
});

test('K008 a cable dropped on empty canvas is deleted, one entry', () => {
  const { store } = storeWithGate();
  const depth = store.debugInfo().undoDepth;
  const r = rewireCable(store, { from: at('lfo-1', 'control'), to: null, detach: 'edge-4' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Disconnected LFO 1 from Filter 1');
  assert.ok(!store.getModel().graph.edges.some((e) => e.id === 'edge-4'));
  assert.equal(store.debugInfo().undoDepth, depth + 1);
});

test('K008 a refused drop leaves model, history, revision and runtime unchanged', () => {
  for (const [what, args] of [
    ['type', { from: at('lfo-1', 'control'), to: at('master-1', 'audio'), detach: 'edge-4' }],
    ['feedback', { from: at('filter-1', 'audio'), to: at('env-1', 'audio') }],
  ]) {
    const { store, calls } = storeWithGate();
    const m = store.getModel();
    const info = store.debugInfo();
    const r = rewireCable(store, args);
    assert.equal(r.ok, false, what);
    assert.match(r.text, /^Connection rejected/, what);
    assert.equal(store.getModel(), m, `${what}: same model object`);
    assert.equal(store.getRevision(), info.revision, what);
    assert.equal(store.debugInfo().undoDepth, info.undoDepth, what);
    assert.equal(store.debugInfo().inGesture, false, what);
    assert.deepEqual(calls, [], `${what}: the runtime gate was never asked`);
  }
});

test('K008 a cable dropped back on its own input changes nothing', () => {
  const { store, calls } = storeWithGate();
  const m = store.getModel();
  const r = rewireCable(store, { from: at('env-1', 'audio'), to: at('filter-1', 'audio'),
    detach: 'edge-2' });
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
  assert.equal(r.text, 'Connection unchanged');
  assert.equal(store.getModel(), m);
  assert.deepEqual(calls, []);
});

test('K008 a store refusal after the probe rolls the whole gesture back', () => {
  const m = synth();
  let refuse = false;
  const store = createStudioStore(m, { idGenerator: createIdGenerator(m),
    gate: (next, info) => (refuse && info.action && info.action.type === 'EDGE_ADD'
      ? { ok: false, reason: 'The running graph refused it.', phase: 'prepare' } : null) });
  refuse = true;
  const depth = store.debugInfo().undoDepth;
  const r = rewireCable(store, { from: at('osc-1', 'audio'), to: at('filter-1', 'audio') });
  assert.equal(r.ok, false);
  assert.match(r.text, /running graph refused it/);
  assert.deepEqual(keys(store.getModel()), keys(m));
  assert.equal(store.debugInfo().undoDepth, depth);
  assert.equal(store.debugInfo().inGesture, false);
});

test('K008 a muted cable stays muted wherever it is moved; settings only to the same parameter',
  () => {
    // edge-3 (Filter -> Master) muted, moved to the Spectrum input (edge-5 removed first).
    const { store } = storeWithGate();
    store.dispatch({ type: 'EDGE_UPDATE', edgeId: 'edge-3', props: { muted: true } });
    store.dispatch({ type: 'EDGE_REMOVE', edgeIds: ['edge-5'] });
    const r = rewireCable(store, { from: at('filter-1', 'audio'), to: at('spectrum-1', 'audio'),
      detach: 'edge-3' });
    assert.equal(r.ok, true, r.text);
    const moved = store.getModel().graph.edges.find((e) => e.to.node === 'spectrum-1');
    assert.equal(moved.props.muted, true, 'the move did not make the signal audible');
    // The muted LFO -> cutoff cable moved to Q: still muted, Q's own default depth.
    const s2 = storeWithGate().store;
    const set = s2.dispatch({ type: 'EDGE_UPDATE', edgeId: 'edge-4',
      props: { muted: true, depth: 3 } }).ok;
    assert.equal(set, true);
    const plain = probeRewire(s2.getModel(), at('lfo-1', 'control'), at('filter-1', 'Q'));
    assert.equal(plain.allowed, true);
    assert.equal(rewireCable(s2, { from: at('lfo-1', 'control'), to: at('filter-1', 'Q'),
      detach: 'edge-4' }).ok, true);
    const q = s2.getModel().graph.edges.find((e) => e.to.port === 'Q');
    assert.equal(q.props.muted, true);
    assert.notEqual(q.props.depth, 3, 'depth is the cutoff\'s, not carried to Q');
    // An unmuted cable moved elsewhere is unmuted.
    const s3 = storeWithGate().store;
    rewireCable(s3, { from: at('lfo-1', 'control'), to: at('filter-1', 'Q'), detach: 'edge-4' });
    assert.equal(s3.getModel().graph.edges.find((e) => e.to.port === 'Q').props.muted, false);
  });

test('K008 a cable dropped on a node body takes a free input before replacing one', () => {
  const m0 = synth();
  const { store } = storeWithGate(m0);
  const add = (nodeType, y) => store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y } }).created.nodes[0];
  const mixer = add('mixer', 600);
  const osc2 = add('oscillator', 800);
  const filter2 = add('filter', 1000);
  store.dispatch({ type: 'EDGE_ADD', from: at('osc-1', 'audio'), to: at(mixer, 'in1') });
  const m = store.getModel();
  const t = bodyTarget(connectionTargets(m, at(osc2, 'audio'), undefined, { rewire: true }),
    mixer);
  assert.equal(t.port, 'in2', 'the free input, not Oscillator 1\'s');
  assert.deepEqual(t.replaces, []);
  // A node whose only signal input is taken: the drop replaces it, as a drop on the port does.
  store.dispatch({ type: 'EDGE_ADD', from: at('osc-1', 'audio'), to: at(filter2, 'audio') });
  const f = bodyTarget(connectionTargets(store.getModel(), at(osc2, 'audio'), undefined,
    { rewire: true }), filter2);
  assert.equal(f.port, 'audio');
  assert.equal(f.replaces.length, 1);
  // No compatible input: the first refusal, for its reason.
  const no = bodyTarget(connectionTargets(store.getModel(), at('lfo-1', 'control'), undefined,
    { rewire: true }), 'master-1');
  assert.equal(no.allowed, false);
  assert.equal(bodyTarget([], 'master-1'), null);
});

test('K008 a removal the store cannot roll back is reported, not called a refusal', () => {
  const m = synth();
  const store = createStudioStore(m, { idGenerator: createIdGenerator(m),
    gate: (next, info) => (info.reason === 'cancel' || (info.action
      && info.action.type === 'EDGE_ADD')
      ? { ok: false, reason: 'The running graph refused it.', phase: 'prepare' } : null) });
  const depth = store.debugInfo().undoDepth;
  const r = rewireCable(store, { from: at('osc-1', 'audio'), to: at('filter-1', 'audio') });
  assert.equal(r.ok, false);
  assert.equal(r.changed, true);
  assert.match(r.text, /running graph refused it\. The cable was removed and not put back: /);
  assert.equal(store.debugInfo().undoDepth, depth + 1, 'the removal is one undo entry');
  assert.equal(store.debugInfo().inGesture, false);
});
