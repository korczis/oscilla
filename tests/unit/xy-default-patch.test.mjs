// K183 (option B): the XY pad sounds on first touch in the default Synth document. The pad is
// one more note input of K178's one Keys source, so the default document needs no Pitch or Gate
// cable: the keyboard's normals stay intact and a computer key and a pad touch both sound. Y is
// an ordinary, typed model cable xy.y -> lpf.frequency that the Synth's insertion adds
// (synth/xy.js xyInsertAction, the insert path of synth/ui.js ensurePanel and the picker's New
// Synth voice), visible in the panel's cable list and removable; as a performance output it
// adds to LPF Cutoff's EG 2 and MG normals rather than replacing them (synth/normals.js), and
// removing it leaves the pad playing pitch only.
//
//   node --test tests/unit/xy-default-patch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as xy from '../../src/js/synth/xy.js';
import {
  jackState, panelCables, panelEdges, patchCable, unpatch,
} from '../../src/js/synth/normals.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { canConnect, validateEdgeProps } from '../../src/js/studio/ports.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { KEY_ROUTES } from '../../src/js/midi/routes.js';
import { createMidiNotes } from '../../src/js/midi/notes.js';
import { createSynthNotes } from '../../src/js/synth/notes-sink.js';
import { SYNTH_TEXT } from '../../src/js/synth/insert.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const KEYS_NORMALS = ['n1', 'n2', 'n3', 'n4']; // Keys pitch into both VCOs, gate into both EGs
const LPF_NORMALS = ['n21', 'n22']; // MG and EG 2 into LPF Cutoff

/** The default Synth document: the reference template with the panel the Synth inserts. */
function defaultStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  assert.equal(typeof xy.xyInsertAction, 'function', 'synth/xy.js exports xyInsertAction');
  const a = xy.xyInsertAction(st.getModel(), PANEL, { at: { x: 0, y: 600 } });
  assert.equal(a.type, 'BATCH', 'one BATCH: one undo entry');
  const r = st.dispatch(a);
  assert.equal(r.ok, true, r.reason);
  return st;
}
const ids = (model) => {
  const res = PANEL.resolve(model);
  return (mid) => res.get(mid).id;
};
const live = (model, list) => {
  const { normals } = panelEdges(model, PANEL);
  return list.filter((n) => normals.has(n));
};

test('the default Synth document holds the Y route as a typed model cable xy.y -> LPF Cutoff',
  () => {
    const st = defaultStore();
    const m = st.getModel();
    const id = ids(m);
    const edges = m.graph.edges.filter((e) => e.from.node === id('xy'));
    assert.equal(edges.length, 1, 'one cable leaves the pad');
    const [e] = edges;
    assert.deepEqual([e.from.port, e.to.node, e.to.port], ['y', id('lpf'), 'frequency']);
    // project.typed-ports: the registry's own ports allow it, and its props validate.
    const out = NODE_REGISTRY.port('xy-pad', 'y', 'out');
    const inp = NODE_REGISTRY.port('filter', 'frequency', 'in');
    const v = canConnect(out, inp, { sourceNodeId: e.from.node, targetNodeId: e.to.node });
    assert.equal(v.allowed, true, v.reason);
    assert.equal(v.signalType, 'CONTROL');
    const checked = validateEdgeProps(e.props, v.signalType, inp,
      NODE_REGISTRY.param('filter', 'frequency'));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    // A cable, not a normal: listed in the panel's cables (drawn, removable, linked).
    assert.deepEqual(panelCables(m, PANEL).map((c) => [c.from, c.to]),
      [['xy.y', xy.XY_DEFAULT_Y]]);
    assert.equal(xy.xyTarget(m, PANEL), 'lpf.frequency');
    assert.equal(xy.XY_DEFAULT_Y, 'lpf.frequency');
    // No Pitch or Gate cable is needed: the keyboard's normals stay intact.
    assert.equal(xy.xyPatched(m, PANEL), false);
    assert.deepEqual(live(m, KEYS_NORMALS), KEYS_NORMALS);
    // A performance output adds: LPF Cutoff keeps its MG and EG 2 normals (and amount knobs).
    assert.deepEqual(live(m, LPF_NORMALS), LPF_NORMALS);
    assert.equal(jackState(m, PANEL, 'lpf.frequency'), 'normalled');
  });

test('the Synth inserts the panel through xyInsertAction, on every insert path', () => {
  const code = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const p of ['src/js/synth/ui.js', 'src/js/synth/picker.js']) {
    assert.match(code(p), /xyInsertAction\(/, `${p} inserts with the Y cable`);
    assert.doesNotMatch(code(p), /panel\.instantiate\(/, `${p}: no bare instantiate`);
  }
  // The pad already there (a reused panel): its cables are the user's, none is added.
  const st = defaultStore();
  assert.equal(st.dispatch(xy.xyTargetAction(st.getModel(), PANEL, null).action).ok, true);
  const again = xy.xyInsertAction(st.getModel(), PANEL);
  assert.ok(!again.steps.some((s) => s.type === 'EDGE_ADD' && s.from
    && s.from.node === ids(st.getModel())('xy')), 'no Y cable re-added over the user\'s choice');
});

test('the pad\'s notes reach the voice through the one Keys source, last-note priority; a '
  + 'computer key sounds beside it', () => {
  assert.equal(KEY_ROUTES.synth.plays, 'synthSink', 'the Synth\'s keys play the Synth sink');
  const st = defaultStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const t = createStudioTransport({ runtime: createStudioRuntime({ engine }), engine, store: st });
  const nodes = () => PANEL.resolve(st.getModel());
  const said = [];
  const sink = createSynthNotes({ get: () => ({ transport: t, handle: st }), transport: () => t,
    ensurePanel: () => true, cmp: () => null, say: (x) => said.push(x),
    played: () => nodes().get('keys'), playedModule: () => 'keys', present: () => true, nodes,
    panel: PANEL, ENGINE_IDS: [], syncArmed: () => {} });
  const notes = createMidiNotes({ engine: null, route: () => sink });
  const key = notes.noteOn(60, 100, 'kbd-key'); // the computer key arms the Synth
  assert.equal(key.ok, true, 'a computer key sounds: its normals are intact');
  assert.equal(said.at(-1), SYNTH_TEXT.plays(`the ${PANEL.title}`),
    'the status says what the keys and the pad play, named from the routed node (S6)');
  const pad = notes.noteOn(63, 100, 'kbd-xy'); // the pad's touch
  assert.equal(pad.ok, true);
  assert.equal(pad.top, 63, 'last-note priority: the pad\'s note sounds');
  const moved = notes.legato(63, 67, 'kbd-xy'); // into another cell
  assert.equal(moved.top, 67);
  assert.equal(moved.retrigger, false, 'a legato: no new gate');
  assert.deepEqual([...t.heldNotes()].sort(), [60, 67]);
  notes.noteOff(67, 'kbd-xy');
  assert.deepEqual(t.heldNotes(), [60], 'the key\'s note returns');
  notes.noteOn(65, 100, 'kbd-xy');
  assert.equal(notes.releaseInput('xy'), 1, 'the xy input releases on its own (held-notes)');
  assert.deepEqual(t.heldNotes(), [60], 'the keys\' own note stays');
  notes.noteOff(60, 'kbd-key');
  assert.deepEqual(t.heldNotes(), []);
  t.stop({ fast: true });
  fx.advance(1);
});

test('removing the Y cable leaves the pad playing pitch only; the normals are as they were', () => {
  const st = defaultStore();
  const m = st.getModel();
  const cable = panelCables(m, PANEL).find((c) => c.from === 'xy.y');
  const r = unpatch(m, PANEL, cable.id);
  assert.ok(r.action, r.reason);
  assert.equal(st.dispatch(r.action).ok, true);
  const after = st.getModel();
  assert.equal(xy.xyTarget(after, PANEL), null, 'Y drives nothing');
  assert.equal(after.graph.edges.filter((e) => e.from.node === ids(after)('xy')).length, 0);
  assert.deepEqual(live(after, [...KEYS_NORMALS, ...LPF_NORMALS]),
    [...KEYS_NORMALS, ...LPF_NORMALS], 'the keys and the filter keep every normal');
  st.undo();
  assert.equal(xy.xyTarget(st.getModel(), PANEL), 'lpf.frequency', 'Undo gives it back');
});

test('a performance cable adds; any other cable still replaces the normals, and removing it '
  + 'restores them beside the Y cable', () => {
  const st = defaultStore();
  // Y into HPF Cutoff: its MG and EG 2 normals stay.
  const y = patchCable(st.getModel(), PANEL, 'xy.y', 'hpf.frequency');
  assert.ok(y.action, y.reason);
  assert.ok(!y.action.steps.some((s) => s.type === 'EDGE_REMOVE'), 'Y breaks no normal');
  assert.equal(st.dispatch(y.action).ok, true);
  assert.deepEqual(live(st.getModel(), ['n19', 'n20']), ['n19', 'n20']);
  // MG into LPF Cutoff (the jacks of a normal): a cable that replaces n21 and n22.
  const mg = patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency');
  assert.deepEqual(mg.action.steps[0].type, 'EDGE_REMOVE');
  assert.equal(st.dispatch(mg.action).ok, true);
  assert.deepEqual(live(st.getModel(), LPF_NORMALS), []);
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
  const id = panelCables(st.getModel(), PANEL).find((c) => c.from === 'mg.control').id;
  assert.equal(st.dispatch(unpatch(st.getModel(), PANEL, id).action).ok, true);
  assert.deepEqual(live(st.getModel(), LPF_NORMALS), LPF_NORMALS,
    'removing the last replacing cable restores the normals, the Y cable staying');
  assert.equal(xy.xyTarget(st.getModel(), PANEL) !== null, true);
  // The pad's Pitch is no performance output: a cable from it replaces the Keys normal.
  const pitch = patchCable(st.getModel(), PANEL, 'xy.pitch', 'vco1.pitch');
  assert.equal(pitch.action.steps[0].type, 'EDGE_REMOVE');
  assert.deepEqual(PANEL.module('xy').adds, ['x', 'y']);
});
