// V3.1 Studio graph view descriptors and keyboard table (src/js/ui/studio/graph-view.js,
// graph-keys.js). Spec §32-§37, §65-§77, §125, §138-§139, §143, §224. Plan V410-V412, V428.
//   node --test tests/unit/v31-studio-ui-graph-view.test.mjs
// Tolerances: none (plain data and text).

import test from 'node:test';
import assert from 'node:assert';

import {
  compiledStatus, connectableTypes, connectingText, connectionTargets, edgeView,
  firstCompatibleInput, nodeCard, nodeConnections, nodeOutputs, nodeWarnings, probeConnection,
} from '../../src/js/ui/studio/graph-view.js';
import {
  STUDIO_SHORTCUTS, isEditingTarget, resolveStudioKey,
} from '../../src/js/ui/studio/graph-keys.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { AUDIO_FEEDBACK_MESSAGE } from '../../src/js/studio/validate.js';

const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const storeOf = (m) => createStudioStore(m, { idGenerator: createIdGenerator(m) });

test('a node card is a Signal Path box with typed ports (§32, §74-§75, §143)', () => {
  const m = synth();
  const filter = m.graph.nodes.find((n) => n.id === 'filter-1');
  const card = nodeCard(m, filter, { selected: true });
  assert.equal(card.title, 'FILTER 1');
  assert.equal(card.categoryLabel, 'Processing');
  assert.equal(card.summary, 'Low-pass · 500 Hz · Q 0.707');
  assert.deepEqual(card.inputs.map((p) => [p.id, p.shape, p.param, p.connected]), [
    ['audio', 'circle', false, true], ['frequency', 'diamond', true, true],
    ['Q', 'diamond', true, false], ['gain', 'diamond', true, false]]);
  assert.deepEqual(card.outputs.map((p) => [p.id, p.shape]), [['audio', 'circle']]);
  assert.equal(card.flags.selected, true);
  assert.equal(card.ariaLabel, 'Filter 1, processing node, Low-pass · 500 Hz · Q 0.707, '
    + '2 input connections, 2 output connections, selected');
  assert.equal(card.inputs[1].ariaLabel, 'Filter 1 cutoff control input, connected to LFO 1');
  const env = nodeCard(m, m.graph.nodes.find((n) => n.id === 'env-1'));
  assert.equal(env.inputs.find((p) => p.id === 'gate').shape, 'triangle');
});

test('status flags: unconnected source, unavailable microphone, bypassed filter (§77, §171)', () => {
  const store = storeOf(synth());
  const r = store.dispatch({ type: 'NODE_ADD', nodeType: 'oscillator', position: { x: 0, y: 0 } });
  store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'enabled', value: false });
  const m = store.getModel();
  const warn = nodeWarnings(m);
  const id = r.created.nodes[0];
  assert.match(warn.get(id)[0], /does not reach Master Output/);
  const card = nodeCard(m, m.graph.nodes.find((n) => n.id === id), { warnings: warn.get(id) });
  assert.equal(card.flags.unconnected, true);
  assert.equal(card.statusLabel, 'Not connected');
  const f = nodeCard(m, m.graph.nodes.find((n) => n.id === 'filter-1'));
  assert.equal(f.flags.bypassed, true);
  assert.equal(f.statusLabel, 'Bypassed');
  const mic = store.dispatch({ type: 'NODE_ADD', nodeType: 'microphone' });
  const plan = compileStudio(store.getModel(), { engine: null });
  const status = compiledStatus(plan);
  const micCard = nodeCard(store.getModel(), store.getModel().graph.nodes.find((n) =>
    n.id === mic.created.nodes[0]), { status: status.get(mic.created.nodes[0]) });
  assert.equal(micCard.flags.error, true);
  assert.equal(micCard.statusLabel, 'Unavailable');
  assert.ok(micCard.reason);
});

test('edge views carry the cable style of the source port type (§69)', () => {
  const m = synth();
  const byId = (id) => edgeView(m, m.graph.edges.find((e) => e.id === id));
  assert.deepEqual([byId('edge-1').type, byId('edge-1').cable], ['AUDIO', 'solid']);
  assert.deepEqual([byId('edge-4').type, byId('edge-4').cable], ['CONTROL', 'dashed']);
  assert.equal(byId('edge-4').ariaLabel,
    'Connection from LFO 1 control to Filter 1 cutoff, depth 1 octave, bipolar');
  assert.equal(byId('edge-5').targetRole, 'TAP');
});

test('probeConnection agrees with the store: type, multiplicity, feedback (§33, §39, §65)', () => {
  const m = synth();
  const ok = probeConnection(m, { node: 'lfo-1', port: 'control' }, { node: 'osc-1',
    port: 'frequency' });
  assert.deepEqual(ok, { allowed: true, reason: null, signalType: 'CONTROL' });
  const type = probeConnection(m, { node: 'osc-1', port: 'audio' }, { node: 'filter-1',
    port: 'frequency' });
  assert.equal(type.allowed, false);
  assert.equal(type.reason, 'Connection rejected: Audio output cannot connect to a control '
    + 'input. Modulate parameters from an LFO, Envelope, Random or Step Modulator.');
  const busy = probeConnection(m, { node: 'osc-1', port: 'audio' }, { node: 'filter-1',
    port: 'audio' });
  assert.equal(busy.allowed, false);
  assert.match(busy.reason, /^Connection rejected/);
  // The store refuses exactly what the probe refused.
  const store = storeOf(m);
  const r = store.dispatch({ type: 'EDGE_ADD', from: { node: 'osc-1', port: 'audio' },
    to: { node: 'filter-1', port: 'audio' } });
  assert.equal(r.ok, false);
  // Feedback: Mixer → Gain → Mixer is an instantaneous audio loop.
  const s2 = storeOf(m);
  const mix = s2.dispatch({ type: 'NODE_ADD', nodeType: 'mixer' }).created.nodes[0];
  const gain = s2.dispatch({ type: 'NODE_ADD', nodeType: 'gain' }).created.nodes[0];
  s2.dispatch({ type: 'EDGE_ADD', from: { node: mix, port: 'audio' }, to: { node: gain,
    port: 'audio' } });
  const loop = probeConnection(s2.getModel(), { node: gain, port: 'audio' }, { node: mix,
    port: 'in1' });
  assert.equal(loop.allowed, false);
  assert.ok(loop.reason.startsWith(AUDIO_FEEDBACK_MESSAGE), loop.reason);
  const sr = s2.dispatch({ type: 'EDGE_ADD', from: { node: gain, port: 'audio' },
    to: { node: mix, port: 'in1' } });
  assert.equal(sr.ok, false);
  assert.ok(sr.reason.startsWith(AUDIO_FEEDBACK_MESSAGE));
  assert.equal(probeConnection(m, { node: 'nope', port: 'audio' }, { node: 'osc-1',
    port: 'frequency' }).allowed, false);
});

test('connection targets list every other input with its verdict (§139)', () => {
  const m = synth();
  const from = { node: 'lfo-1', port: 'control' };
  const t = connectionTargets(m, from);
  assert.ok(!t.some((x) => x.node === 'lfo-1'));
  const allowed = t.filter((x) => x.allowed).map((x) => x.label);
  assert.ok(allowed.includes('Oscillator 1 / Frequency control'));
  assert.ok(allowed.includes('Filter 1 / Q control'));
  // Filter 1 cutoff takes several modulators, but not the same one twice.
  const dup = t.find((x) => x.node === 'filter-1' && x.port === 'frequency');
  assert.equal(dup.allowed, false);
  assert.equal(dup.reason, 'Connection rejected: LFO 1 is already connected to Filter 1 there.');
  const audio = t.find((x) => x.node === 'master-1' && x.port === 'audio');
  assert.equal(audio.allowed, false);
  assert.match(audio.reason, /Control output cannot connect to an audio input/);
  assert.equal(connectingText(m, from), 'Connecting from LFO 1 / Control');
  assert.deepEqual(nodeOutputs(m, 'filter-1').map((o) => o.text), ['Filter 1 / Audio audio output']);
  assert.equal(nodeConnections(m, 'filter-1').length, 4);
});

test('create-node-from-cable offers only types that accept the cable (§66)', () => {
  const m = synth();
  const types = connectableTypes(m, { node: 'osc-1', port: 'audio' });
  assert.ok(types.includes('filter'));
  assert.ok(types.includes('spectrum'));
  assert.ok(!types.includes('master'), 'one Master Output already exists');
  assert.ok(!types.includes('oscillator'));
  const ctl = connectableTypes(m, { node: 'lfo-1', port: 'control' });
  assert.ok(ctl.includes('oscillator') && !ctl.includes('spectrum'));
  const def = NODE_REGISTRY.get('filter');
  assert.equal(firstCompatibleInput(def, NODE_REGISTRY.port('lfo', 'control', 'out')).id,
    'frequency');
});

test('the shortcut table resolves keys without taking Tab or typing (§64, §125, §224)', () => {
  const k = (key, mods = {}) => resolveStudioKey({ key, ...mods });
  assert.deepEqual(k('Delete'), { id: 'delete' });
  assert.deepEqual(k('Backspace'), { id: 'delete' });
  assert.deepEqual(k('z', { ctrlKey: true }), { id: 'undo' });
  assert.deepEqual(k('Z', { metaKey: true, shiftKey: true }), { id: 'redo' });
  assert.deepEqual(k('y', { ctrlKey: true }), { id: 'redo' });
  assert.deepEqual(k('d', { metaKey: true }), { id: 'duplicate' });
  assert.deepEqual(k('c', { ctrlKey: true }), { id: 'copy' });
  assert.deepEqual(k('v', { ctrlKey: true }), { id: 'paste' });
  assert.deepEqual(k(' '), { id: 'play-toggle' });
  assert.deepEqual(k('Escape'), { id: 'escape' });
  assert.deepEqual(k('f'), { id: 'frame-selection' });
  assert.deepEqual(k('a'), { id: 'frame-all' });
  assert.deepEqual(k('n'), { id: 'quick-add' });
  assert.deepEqual(k('c'), { id: 'connect' });
  assert.deepEqual(k('ArrowUp', { shiftKey: true }), { id: 'nudge', key: 'ArrowUp', large: true });
  assert.equal(k('Tab'), null);
  assert.equal(k('r', { ctrlKey: true }), null, 'browser reload stays the browser’s');
  assert.equal(k('f', { altKey: true }), null);
  for (const s of STUDIO_SHORTCUTS) assert.ok(s.id && s.keys && s.text);
  assert.ok(isEditingTarget({ tagName: 'INPUT', type: 'text' }));
  assert.ok(isEditingTarget({ tagName: 'TEXTAREA' }));
  assert.ok(!isEditingTarget({ tagName: 'INPUT', type: 'range' }));
  assert.ok(!isEditingTarget({ tagName: 'DIV' }));
  assert.ok(!isEditingTarget(null));
});
