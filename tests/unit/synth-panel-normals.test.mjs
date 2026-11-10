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
import {
  cableNote, jackReason, jackState, panelCables, panelEdges, patchCable, tuneNote,
} from '../../src/js/synth/normals.js';
import { cableItem } from '../../src/js/synth/view/bay.js';
import { inspectorView } from '../../src/js/ui/studio/inspector.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { canConnect, controlLine } from '../../src/js/studio/ports.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { createPatch } from '../../src/js/studio/patches.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const CUTOFF = 'lpf.frequency';
// Every normal into LPF Cutoff, read from the panel (MG, EG 2 and, since K220, pad L's X).
const CUTOFF_NORMALS = PANEL.normals.filter((n) => n.to === CUTOFF).map((n) => n.id);
/** The model ids of the cutoff's normals (the panel instance's ids). */
const CUTOFF_IDS = CUTOFF_NORMALS.map((n) => `semi-mono-1-${n}`);
const normalIds = (m, ids = CUTOFF_NORMALS) => {
  const { normals } = panelEdges(m, PANEL);
  return ids.map((id) => (normals.has(id) ? normals.get(id).id : null));
};
const depth = (st) => st.debugInfo().undoDepth;

test('a cable into the Low-pass cutoff takes its normals out in one entry; undo restores them', () => {
  const st = panelStore();
  const ids = normalIds(st.getModel());
  assert.deepEqual(ids, CUTOFF_IDS, 'MG, EG 2 and pad L\'s X normal the cutoff');
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'normalled');
  const rev = st.getRevision();
  const undo = depth(st);
  const r = st.dispatch(patchCable(st.getModel(), PANEL, 'eg1.control', CUTOFF).action);
  assert.equal(r.ok, true, r.reason);
  assert.equal(st.getRevision(), rev + 1, 'one revision');
  assert.equal(depth(st), undo + 1, 'one history entry');
  assert.deepEqual(normalIds(st.getModel()), CUTOFF_NORMALS.map(() => null), 'both normals out with the cable in');
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
  assert.deepEqual(normalIds(m), CUTOFF_NORMALS.map(() => null), 'every normal deleted');
  assert.ok(m.graph.edges.some((e) => e.id === cable), 'the cable stays');
  assert.equal(jackState(m, PANEL, CUTOFF), 'patched');
  // Reading never repairs, and a later edit elsewhere does not bring a normal back.
  assert.equal(jackState(st.getModel(), PANEL, CUTOFF), 'patched');
  const other = st.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids.get('lpf').id, key: 'Q',
    value: 2 });
  assert.equal(other.ok, true, other.reason);
  assert.deepEqual(normalIds(st.getModel()), CUTOFF_NORMALS.map(() => null), 'no normal re-added');
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
  for (const id of CUTOFF_IDS) {
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
  assert.deepEqual(normalIds(s.store.getModel()), CUTOFF_IDS);
});

// ------------------------------------------------------------- K238: the jacks say what they do
// Three jacks disagreed with the compiler (probe on a7102358, 329.yaml#R9): S&H Rate was refused
// while its Clock cable was muted, though a muted Clock does not clock the S&H; Keys pitch into
// VCO Tune moved 100 cents over a +/-6 octave source (1/72 octave per octave); and a bipolar
// LFO into VCA gain, which replaces EG 2's normal, opened the VCA with no key held.
const nodeOf = (m, mod) => PANEL.resolve(m).get(mod);
const edgeInto = (m, mod, port) => m.graph.edges.find((e) => e.to.node === nodeOf(m, mod).id
  && e.to.port === port);

test('K238: S&H Rate is refused only while an unmuted Clock clocks it, as the compiler says', () => {
  const st = panelStore();
  const clock = edgeInto(st.getModel(), 'sh', 'trigger');
  assert.ok(clock, 'Keys Gate is normalled into the S&H Clock (n23)');
  const clocked = (m) => compileStudio(m).nodes.get(nodeOf(m, 'sh').id).clocked;
  assert.equal(clocked(st.getModel()), true);
  assert.match(jackReason(st.getModel(), PANEL, 'sh.rate'), /Rate has no effect while Clock/);
  const r = st.dispatch({ type: 'EDGE_UPDATE', edgeId: clock.id, props: { muted: true } });
  assert.equal(r.ok, true, r.reason);
  assert.equal(clocked(st.getModel()), false, 'the compiler ignores a muted Clock cable');
  assert.equal(jackReason(st.getModel(), PANEL, 'sh.rate'), null, 'so Rate is not refused');
  assert.ok(patchCable(st.getModel(), PANEL, 'mg.control', 'sh.rate').action,
    'a cable into Rate can be patched while Clock is muted');
});

test('K238: Keys pitch into VCO Tune modulates by Tune\'s span, and its text says so and '
  + 'points to Pitch', () => {
    // oscilla-43's decision: Tune is fine tuning (+/-12 semitones); Pitch tracks 1:1 (n1/n2).
    // An octave source into Tune takes Tune's whole span as its depth, and the bay and the
    // Inspector state the ratio that depth gives, both read from the same numbers here.
    const st = panelStore();
    const m = st.getModel();
    const range = PANEL.sourceRange('keys.pitch');
    const tune = NODE_REGISTRY.param('vco', 'tune');
    const step = patchCable(m, PANEL, 'keys.pitch', 'vco1.tune').action.steps
      .find((x) => x.type === 'EDGE_ADD');
    const span = tune.max - tune.min;
    assert.deepEqual(step.props, { depth: span, polarity: 'bipolar', mapping: 'linear',
      offset: 0 }, 'the depth is Tune\'s span, 2400 cents (the edge validator\'s limit)');
    // What the compiler does with it (ports.js controlLine): cents per source octave, and the
    // whole swing over the source's range.
    const { a } = controlLine(step.props, range);
    const swing = (a * (range[1] - range[0])) / 2 / 1200; // octaves, each way
    assert.equal(a, span / ((range[1] - range[0]) / 2), 'a third of an octave per octave');
    assert.equal(swing, 2);
    const text = `posune ladění až o ±${swing} oktávy přes celý rozsah zdroje; pro sledování `
      + 'výšky použij vstup Pitch';
    assert.equal(tuneNote('oct', tune, step.props), text);
    // the bay's cable row says it
    assert.equal(st.dispatch(patchCable(m, PANEL, 'keys.pitch', 'vco1.tune').action).ok, true);
    const cable = panelCables(st.getModel(), PANEL).find((c) => c.to === 'vco1.tune');
    assert.equal(cableNote(st.getModel(), PANEL, cable), text);
    const row = cableItem({ ...cable, note: cableNote(st.getModel(), PANEL, cable) }, 'patched',
      { jackName: (j) => j, item: 'i', btn: 'b' });
    assert.ok(row.includes(`keys.pitch → vco1.tune; ${text}</span>`), row);
    // and so does the Inspector's view of the edge
    const edge = st.getModel().graph.edges.find((e) => e.id === cable.id);
    const view = inspectorView(st.getModel(), { nodes: [], edges: [edge.id], clips: [] });
    assert.equal(view.note, text);
    // a half depth says half, in the same words; the Pitch normal (1:1) carries no note
    assert.match(tuneNote('oct', tune, { ...step.props, depth: 600 }), /až o ±0,5 oktávy /);
    assert.match(tuneNote('oct', tune, { ...step.props, depth: 1200, polarity: 'unipolar' }),
      /až o 1 oktávu /);
    const pitch = PANEL.normals.find((n) => n.from === 'keys.pitch' && n.to === 'vco1.pitch');
    assert.equal(controlLine({ offset: 0, ...pitch.props }, range).a, 1, 'Pitch tracks 1:1');
    assert.equal(tuneNote('oct', NODE_REGISTRY.param('vco', 'pitch'), pitch.props), null);
  });

test('K238: a bipolar source into VCA gain is refused; an envelope there leaves it closed at rest',
  () => {
    const m = panelStore().getModel();
    const reason = 'VCA: bipolární zdroj by otevřel VCA bez stisknuté klávesy. Do zesílení '
      + 'patří unipolární zdroj, například obálka.';
    for (const from of ['mg.control', 'sh.control']) {
      assert.ok(PANEL.sourceRange(from)[0] < 0, `${from} is bipolar`);
      assert.deepEqual(patchCable(m, PANEL, from, 'vca.gain'), { reason }, from);
      assert.equal(jackReason(m, PANEL, 'vca.gain', from), reason);
    }
    // A unipolar envelope is allowed, and at rest (the source at 0) it adds nothing to the
    // VCA's base gain of 0: closed until a key opens the envelope.
    const r = patchCable(m, PANEL, 'eg1.control', 'vca.gain');
    assert.ok(r.action, r.reason);
    const props = r.action.steps.find((x) => x.type === 'EDGE_ADD').props;
    const [lo] = PANEL.sourceRange('eg1.control');
    const { a, b } = controlLine(props, PANEL.sourceRange('eg1.control'));
    assert.equal(lo, 0);
    assert.equal(nodeOf(m, 'vca').params.gain + a * lo + b, 0, 'the VCA rests closed');
    // without a source named the jack itself has no refusal (the hint of an unpatched jack)
    assert.equal(jackReason(m, PANEL, 'vca.gain'), null);
  });

test('K238: a bipolar source into VELOCITY gain is the gated tremolo: silent with no key, '
  + 'tremolo with one', () => {
    // VELOCITY sits after the VCA (n27 vca.audio -> vel.audio; the compiler ranks it later), so
    // the closed VCA keeps it silent with no key whatever drives its gain.
    const st = panelStore();
    const m = st.getModel();
    const id = (mod) => nodeOf(m, mod).id;
    const order = compileStudio(m).order;
    assert.ok(m.graph.edges.some((e) => e.from.node === id('vca') && e.to.node === id('vel')
      && e.to.port === 'audio'), 'the VCA feeds VELOCITY');
    assert.ok(order.indexOf(id('vca')) < order.indexOf(id('vel')), 'VELOCITY is downstream');
    assert.equal(jackReason(m, PANEL, 'vel.gain', 'mg.control'), null);
    const r = patchCable(m, PANEL, 'mg.control', 'vel.gain');
    assert.ok(r.action, r.reason);
    assert.equal(st.dispatch(r.action).ok, true);
    // The voice's level is the VCA's gain times VELOCITY's (two gain stages in series), each its
    // base plus its cables (ports.js controlLine over each source's range).
    const level = (edge, mod, v) => {
      const { a, b } = controlLine(edge.props, PANEL.sourceRange(edge.from));
      return nodeOf(st.getModel(), mod).params.gain + a * v + b;
    };
    const vcaEdge = { props: PANEL.normals.find((n) => n.to === 'vca.gain').props,
      from: 'eg2.control' };
    const lfo = { props: st.getModel().graph.edges.find((e) => e.to.node === id('vel')
      && e.to.port === 'gain').props, from: 'mg.control' };
    const swing = [-1, -0.5, 0, 0.5, 1];
    // no key: EG 2 at rest (0), the VCA closed, the voice silent at every LFO value
    assert.deepEqual(swing.map((v) => Math.abs(level(vcaEdge, 'vca', 0) * level(lfo, 'vel', v))),
      swing.map(() => 0));
    // a key held: EG 2 at its sustain, the voice's level follows the LFO (tremolo)
    const held = level(vcaEdge, 'vca', PANEL.module('eg2').init.sustain);
    const voice = swing.map((v) => Math.abs(held * level(lfo, 'vel', v)));
    assert.ok(held > 0, 'the VCA is open');
    assert.ok(Math.max(...voice) > Math.min(...voice), `the level moves: ${voice.join(', ')}`);
    // the VCA itself still refuses a bipolar source: it would sound with no key
    assert.match(jackReason(st.getModel(), PANEL, 'vca.gain', 'mg.control'),
      /bipolární zdroj by otevřel VCA bez stisknuté klávesy/);
  });
