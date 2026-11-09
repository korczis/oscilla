// K212 (K061 criteria 1 and 2): normalling on the inserted Synth panel itself, the cases the
// other synth-* tests leave out. The design's 'N12 Low-pass cutoff' is numbered differently in the
// shipped table (n21 MG and n22 EG 2 into lpf.frequency), so the cases name the jack.
//   - a cable into the Low-pass cutoff removes both its normals in the same history entry (one
//     revision, one undo step) and its undo restores them with their ids
//   - a cable of the wrong type is refused with canConnect's sentence, the normals as they were
//   - deleting a normal while a cable occupies its jack leaves the cable and the jack patched and
//     never re-adds the normal
//   - PATCH_INSERT of a patch whose nodes carry metadata.panel drops it
//   - while the transport plays, a panel BATCH over a normal calls transport.admit exactly once,
//     and a panel BATCH whose second step is refused leaves model, history and runtime unchanged
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { jackState, panelEdges, patchCable } from '../../src/js/synth/normals.js';
import { canConnect } from '../../src/js/studio/ports.js';
import { createPatch } from '../../src/js/studio/patches.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const CUTOFF = 'lpf.frequency';
const CUTOFF_NORMALS = ['n21', 'n22'];
const normalIds = (m, ids = CUTOFF_NORMALS) => {
  const { normals } = panelEdges(m, PANEL);
  return ids.map((id) => (normals.has(id) ? normals.get(id).id : null));
};
const depth = (st) => st.debugInfo().undoDepth;

test('a cable into the Low-pass cutoff takes its normals out in one entry; undo restores them', () => {
  const st = panelStore();
  const ids = normalIds(st.getModel());
  assert.deepEqual(ids, ['semi-mono-1-n21', 'semi-mono-1-n22'], 'MG and EG 2 normal the cutoff');
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'normalled');
  const rev = st.getRevision();
  const undo = depth(st);
  const r = st.dispatch(patchCable(st.getModel(), PANEL, 'eg1.control', CUTOFF).action);
  assert.equal(r.ok, true, r.reason);
  assert.equal(st.getRevision(), rev + 1, 'one revision');
  assert.equal(depth(st), undo + 1, 'one history entry');
  assert.deepEqual(normalIds(st.getModel()), [null, null], 'both normals out with the cable in');
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'patched');
  assert.equal(st.undo().ok, true);
  assert.deepEqual(normalIds(st.getModel()), ids, 'one undo step restores both with their ids');
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'normalled');
  assert.equal(depth(st), undo);
});

test('a cable of the wrong type is refused with canConnect\'s sentence; the normals stay', () => {
  const cases = [
    ['noise.audio', CUTOFF, 'AUDIO', 'CONTROL'],
    ['keys.gate', CUTOFF, 'TRIGGER', 'CONTROL'],
    ['vco1.audio', 'eg1.gate', 'AUDIO', 'TRIGGER'],
    ['eg1.control', 'mix.in1', 'CONTROL', 'AUDIO'],
  ];
  for (const [from, to, outType, inType] of cases) {
    const st = panelStore();
    const before = st.getModel();
    const rev = st.getRevision();
    const want = canConnect({ direction: 'out', type: outType }, { direction: 'in', type: inType });
    assert.equal(want.allowed, false, `${outType} into ${inType} is a type mismatch`);
    const r = st.dispatch(patchCable(before, PANEL, from, to).action);
    assert.equal(r.ok, false, `${from} > ${to}`);
    assert.ok(r.reason.includes(want.reason), `${from} > ${to}: ${r.reason}`);
    assert.equal(st.getModel(), before, 'the model as it was');
    assert.equal(st.getRevision(), rev);
    assert.equal(jackState(st.getModel(), PANEL, to), jackState(before, PANEL, to));
  }
});

test('deleting a normal while a cable occupies its jack keeps the cable and never re-adds it', () => {
  const st = panelStore();
  const ids = PANEL.resolve(st.getModel());
  // A cable made in the Studio beside the live normals (not through the panel): the jack is fed
  // by both, so each normal is still there to delete.
  const add = st.dispatch({ type: 'EDGE_ADD', from: { node: ids.get('eg1').id, port: 'control' },
    to: { node: ids.get('lpf').id, port: 'frequency' },
    props: { depth: 1, mapping: 'log', polarity: 'unipolar' } });
  assert.equal(add.ok, true, add.reason);
  const cable = add.created.edges[0];
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'mixed');
  for (const id of normalIds(st.getModel())) {
    const r = st.dispatch({ type: 'EDGE_REMOVE', edgeIds: [id] });
    assert.equal(r.ok, true, r.reason);
  }
  const m = st.getModel();
  assert.deepEqual(normalIds(m), [null, null], 'both normals deleted');
  assert.ok(m.graph.edges.some((e) => e.id === cable), 'the cable stays');
  assert.equal(jackState(m, PANEL, CUTOFF), 'patched');
  // Reading never repairs, and a later edit elsewhere does not bring a normal back.
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'patched');
  const other = st.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids.get('lpf').id, key: 'Q',
    value: 2 });
  assert.equal(other.ok, true, other.reason);
  assert.deepEqual(normalIds(st.getModel()), [null, null], 'no normal re-added');
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'patched');
});

test('PATCH_INSERT of a patch whose nodes carry metadata.panel drops it', () => {
  const st = panelStore();
  const ids = PANEL.resolve(st.getModel());
  const nodes = ['vco1', 'lpf', 'vca'].map((mid) => ids.get(mid).id);
  const patch = createPatch(st.getModel(), nodes, { name: 'Panel voice' });
  // Whatever createPatch keeps, the inserted patch carries the tag on every node.
  const tagged = { ...patch, graph: { ...patch.graph, nodes: patch.graph.nodes.map((n) => ({
    ...n, metadata: { ...n.metadata, panel: { id: 'semi-mono-1', module: 'vco1' } } })) } };
  assert.ok(tagged.graph.nodes.every((n) => n.metadata.panel), 'the patch carries the tag');
  const r = st.dispatch({ type: 'PATCH_INSERT', patch: tagged });
  assert.equal(r.ok, true, r.reason);
  const created = st.getModel().graph.nodes.filter((n) => r.created.nodes.includes(n.id));
  assert.equal(created.length, nodes.length);
  for (const n of created) {
    assert.equal(n.metadata.panel, undefined, `${n.id} carries no panel tag`);
  }
  assert.equal(PANEL.resolve(st.getModel()).get('vco1').id, ids.get('vco1').id,
    'the panel still resolves to its own modules');
});

/** The panel's document on the real runtime and transport, the store's gate counted. */
function playing() {
  const fx = createFakeAudioEnv({ sampleRate: 44100 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const model = panelStore().getModel();
  const admits = [];
  let transport = null;
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => {
      admits.push(info);
      return transport.admit(next, info);
    } });
  transport = createStudioTransport({ runtime, engine, store });
  const r = transport.start({ position: 0 });
  assert.equal(r.ok, true, r.reason);
  fx.advance(0.1);
  return { fx, runtime, store, transport, admits };
}

const runtimeShape = (rt) => ({
  nodes: [...rt.nodes.keys()].sort(),
  edges: [...rt.edges.keys()].sort(),
  revision: rt.debugInfo().revision,
});

test('while the transport plays, a panel BATCH over a normal is admitted exactly once', () => {
  const s = playing();
  const r = s.store.dispatch(patchCable(s.store.getModel(), PANEL, 'eg1.control', CUTOFF).action);
  assert.equal(r.ok, true, r.reason);
  assert.equal(s.admits.length, 1, 'one transport.admit for the whole batch');
  assert.equal(s.transport.playing, true);
  const cable = panelEdges(s.store.getModel(), PANEL).cables[0];
  assert.ok(s.runtime.edges.has(cable.id), 'the running graph has the cable');
  for (const id of ['semi-mono-1-n21', 'semi-mono-1-n22']) {
    assert.equal(s.runtime.edges.has(id), false, `${id} left the running graph`);
  }
});

test('a panel BATCH whose second step is refused leaves model, history and runtime unchanged', () => {
  const s = playing();
  const before = s.store.getModel();
  const rev = s.store.getRevision();
  const undo = depth(s.store);
  const shape = runtimeShape(s.runtime);
  const action = patchCable(before, PANEL, 'noise.audio', CUTOFF).action;
  assert.equal(action.steps[0].type, 'EDGE_REMOVE', 'the first step takes the normals out');
  assert.equal(action.steps[1].type, 'EDGE_ADD', 'the second adds the wrong-type cable');
  const r = s.store.dispatch(action);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Audio output cannot connect to a control input/);
  assert.equal(s.store.getModel(), before, 'the model');
  assert.equal(s.store.getRevision(), rev);
  assert.equal(depth(s.store), undo, 'the history');
  assert.equal(s.admits.length, 0, 'the running graph was never asked');
  assert.deepEqual(runtimeShape(s.runtime), shape, 'the runtime');
  assert.deepEqual(normalIds(s.store.getModel()), ['semi-mono-1-n21', 'semi-mono-1-n22']);
});
