// oscilla-21's retroactive review of src/js/synth, its P2 findings S3, S4, S5, S7, S8 and S10
// (docs/reviews/synth-retroactive-447bb27b.md on chore/synth-retroactive-review):
//   S3  a note-off was sent to the node the keys play at release, and the engine chip un-routed
//       before it released: a voice held across a route change stayed held
//   S4  the engine radio ("Engine the keys play") read a UI copy, not the model's route
//   S5  "New Synth voice" inserted the panel without the insert contract (no notice, at 0,0)
//   S7  Copy link and saved XY presets dropped every cable prop but amount-knob depths
//   S8  the keys played silently once the pad's cables broke their normals, with no reason
//   S10 amount-knob memory was a per-session Map outside the model
// The transport is the real one on the fake audio environment of the sequencer tests; the Synth
// part is the real createSynthUi with a document that answers only the view it listens on.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { SYNTH_TEXT, createSynthUi } from '../../src/js/synth/ui.js';
import { NEW_VOICE } from '../../src/js/synth/picker.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';
import { enginePickerHtml } from '../../src/js/synth/view/engines.js';
import { createXyTab } from '../../src/js/synth/view/xy-tab.js';
import { xyPresetAction } from '../../src/js/synth/view/xy-wiring.js';
import * as XY from '../../src/js/synth/xy.js';
import { panelCables, patchCable, setAmount, unpatch } from '../../src/js/synth/normals.js';
import { linkAction, linkOf } from '../../src/js/synth/link.js';
import { PRESETS } from '../../src/js/synth/presets.js';
import { decodeSynthLink, encodeSynthLink } from '../../src/js/core/url-state-synth.js';
import { normalizeStudio, serializeStudio, studioHash } from '../../src/js/studio/schema.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { gateTargets } from '../../src/js/studio/live-notes.js';

/** The Synth part on the real transport, mounted as Alpine would; `click(dataset)` is a click
 *  on an element of the view carrying those data attributes (the part's delegated listener). */
function synthRig(st = panelStore()) {
  const listeners = {};
  const view = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.document = { querySelector: (s) => (s === '[data-osc="synth-view"]' ? view : null),
    getElementById: () => null, activeElement: null };
  globalThis.window ??= { addEventListener() {}, location: { href: 'http://x/' } };
  globalThis.requestAnimationFrame = () => 0;
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const handle = Object.create(st, { subscribe: { value: () => () => {} } });
  const part = createSynthUi({ get: () => ({ handle, transport }) });
  const cmp = Object.assign(part, { workspace: 'synth', ensureAudio() {}, $watch() {},
    $nextTick() {} });
  cmp.synthInit();
  const click = (dataset) => listeners.click({ target: { closest: () => ({ dataset,
    getAttribute: () => null }) } });
  return { cmp, st, transport, fx, click, sink: cmp.synthSink() };
}

const nodeOf = (m, mid) => PANEL.resolve(m).get(mid);

// ---------------------------------------------------------------- S3: release where it sounded

test('S3: a note held across an undone route is released on the node it played', () => {
  const { cmp, st, transport, sink } = synthRig();
  const fm = nodeOf(st.getModel(), 'fm');
  assert.equal(cmp.synthPick(fm.id), true, 'the keys play FM');
  assert.equal(sink.noteOn(60, 100).ok, true);
  assert.equal(transport.liveVoices(fm.id), 1, 'FM sounds the note');
  st.undo(); // the route is undone while the key is held: the keys play KEYBOARD again
  assert.equal(st.getModel().metadata.noteTarget, undefined);
  sink.noteOff(60);
  assert.deepEqual(transport.heldNotes(), [], 'no note is held after the key is up');
});

test('S3: the engine chip releases a note held on a routed node outside the panel', () => {
  const st = panelStore();
  assert.equal(st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
    position: { x: 0, y: 1200 } }).ok, true);
  const ext = st.getModel().graph.nodes.at(-1);
  const { cmp, transport, click, sink } = synthRig(st);
  assert.equal(cmp.synthPick(ext.id), true, 'the keys play FM 2, outside the panel');
  assert.equal(sink.noteOn(62, 100).ok, true);
  assert.deepEqual(transport.heldNotes(), [62]);
  click({ engine: 'additive' }); // the Engines tab's chip: un-route, the tab chooses again
  assert.equal(st.getModel().metadata.noteTarget, undefined);
  assert.deepEqual(transport.heldNotes(), [], 'the chip released the held note first');
  sink.noteOff(62);
  assert.deepEqual(transport.heldNotes(), []);
});

// ---------------------------------------------------------------- S4: the radio reads the route

test('S4: keys routed to a panel engine: the Engines tab checks and shows that engine', () => {
  const { cmp, st } = synthRig();
  const fm = nodeOf(st.getModel(), 'fm');
  assert.equal(cmp.synthPick(fm.id), true);
  cmp.synthTab('engines');
  const d = cmp.synthDebug();
  assert.equal(d.played, fm.id, 'the keys play FM');
  assert.equal(d.engine, 'fm', 'the radio checks (and the plate shows) the engine the keys play');
});

test('S4: keys routed outside the engines: no engine is checked, and the tab says why', () => {
  const st = panelStore();
  assert.equal(st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
    position: { x: 0, y: 1200 } }).ok, true);
  const ext = st.getModel().graph.nodes.at(-1);
  const { cmp } = synthRig(st);
  assert.equal(cmp.synthPick(ext.id), true);
  cmp.synthTab('engines');
  assert.equal(cmp.synthDebug().engine, null, 'no engine of the tab plays');
  const ids = PANEL.modulesOf('engines').map((m) => m.id);
  const html = enginePickerHtml({ panel: PANEL, ids, on: null,
    resolved: PANEL.resolve(st.getModel()) });
  assert.equal(/aria-checked="true"/.test(html), false);
  assert.ok(html.includes('data-osc="synth.engine-elsewhere"'), 'the notice carries its hook');
});

test('S4: an engine preset clears the route in its own BATCH; undo gives the route back', () => {
  const st = panelStore();
  assert.equal(st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
    position: { x: 0, y: 1200 } }).ok, true);
  const ext = st.getModel().graph.nodes.at(-1);
  const { cmp } = synthRig(st);
  assert.equal(cmp.synthPick(ext.id), true);
  const depth = st.debugInfo().undoDepth;
  assert.equal(cmp.synthPreset('fm-bell'), true);
  assert.equal(st.debugInfo().undoDepth, depth + 1, 'one history entry');
  assert.equal(st.getModel().metadata.noteTarget, undefined, 'the route is cleared');
  const d = cmp.synthDebug();
  assert.equal(d.engine, 'fm');
  assert.equal(d.played, nodeOf(st.getModel(), 'fm').id, 'the keys play the preset\'s engine');
  st.undo();
  assert.equal(st.getModel().metadata.noteTarget, ext.id);
});

// ---------------------------------------------------------------- S5: New Synth voice = Insert

test('S5: New Synth voice inserts as Insert does: below the user\'s nodes, with the notice', () => {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  assert.equal(st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
    position: { x: 0, y: 900 } }).ok, true); // a changed document: no insert by itself
  const ext = st.getModel().graph.nodes.at(-1);
  assert.equal(st.dispatch({ type: 'METADATA_SET', noteTarget: ext.id }).ok, true);
  const cuts = PANEL.cutsOf(st.getModel());
  assert.ok(cuts.length, 'the document\'s own chain feeds Master Output');
  const names = [...new Set(cuts.map((e) => st.getModel().graph.nodes
    .find((n) => n.id === e.from.node).metadata.name))].join(', ');
  const top = Math.max(...st.getModel().graph.nodes.map((n) => n.position.y));
  const before = new Set(st.getModel().graph.nodes.map((n) => n.id));
  const { cmp } = synthRig(st);
  const depth = st.debugInfo().undoDepth;
  assert.equal(cmp.synthPick(NEW_VOICE), true);
  assert.equal(st.debugInfo().undoDepth, depth + 1, 'one history entry');
  assert.deepEqual(cmp.synth.notice, { text: SYNTH_TEXT.took(names) },
    'the insert alert names the feed it took (K246)');
  assert.notEqual(cmp.synth.status, SYNTH_TEXT.took(names), 'the status line does not repeat it');
  const added = st.getModel().graph.nodes.filter((n) => !before.has(n.id));
  assert.ok(added.length > 10 && added.every((n) => n.position.y > top),
    'the panel is placed below the user\'s nodes');
  assert.equal(st.getModel().metadata.noteTarget, undefined, 'the route is cleared');
  assert.equal(cmp.synthDebug().played, nodeOf(st.getModel(), 'keys').id,
    'the keys play the new voice');
});

// ---------------------------------------------------------------- S8: a silent keyboard says why

const keysEnvelopes = (m) => gateTargets(m, nodeOf(m, 'keys').id).envelopes.length;
/** The pad's Gate into both EG gates, taken explicitly: under K183 no built-in XY preset patches
 *  the pad's Pitch or Gate (review F3: XY lead cables Y alone and the keyboard's normals keep
 *  sounding), so the fixture cables what silences the keys itself, one BATCH. */
const XY_GATES = [['xy.gate', 'eg1.gate'], ['xy.gate', 'eg2.gate']];
const takeGates = (st) => st.dispatch(XY.xyCablesAction(st.getModel(), PANEL, XY_GATES).action);

test('S8: after an XY preset and Panel Init, a key says why the keys sound nothing', () => {
  const { cmp, st, sink, transport } = synthRig();
  assert.equal(cmp.synthPreset('xy-lead'), true);
  // K183's default preset cables Y alone: both EG gates stay the keyboard's and a key sounds.
  assert.equal(keysEnvelopes(st.getModel()), 2, 'XY lead leaves both EG gates to the keyboard');
  assert.equal(sink.noteOn(60, 100).ok, true, 'a key sounds on the default preset');
  assert.deepEqual(transport.heldNotes(), [60], 'the keys hold their note');
  assert.equal(cmp.synth.status, SYNTH_TEXT.plays(PANEL.title),
    'the status says what plays, not why nothing sounds');
  sink.noteOff(60);
  assert.equal(takeGates(st).ok, true, 'the pad\'s Gate taken into EG 1 and EG 2 explicitly');
  cmp.synthTab('panel');
  assert.equal(cmp.synthPreset('init'), true);
  assert.equal(keysEnvelopes(st.getModel()), 0, 'the pad\'s cables took both EG gates');
  sink.noteOn(60, 100);
  assert.match(cmp.synth.status,
    /The keys sound nothing: the XY pad's cables into EG 1 Gate and EG 2 Gate/);
  sink.noteOff(60);
});

test('S8: the Panel tab shows the reason with Unpatch the pad, one BATCH that restores the keys',
  () => {
    const st = panelStore();
    const said = [];
    const XYTAB = createXyTab({ panel: PANEL, get: () => ({ handle: st }), host: () => null,
      nodes: () => PANEL.resolve(st.getModel()), model: () => st.getModel(),
      dispatch: (a) => st.dispatch(a), say: (t) => said.push(t), jackName: String,
      tab: () => 'panel', showTab() {}, BTN: 'btn', cmp: () => null });
    assert.equal(XYTAB.html(), '', 'a playing keyboard: no notice');
    assert.equal(st.dispatch(xyPresetAction(st.getModel(), PANEL, 'xy-lead').action).ok, true);
    assert.equal(keysEnvelopes(st.getModel()), 2, 'K183: XY lead cables Y alone');
    assert.equal(XYTAB.html(), '', 'the keys still play after the default preset: no notice');
    assert.equal(takeGates(st).ok, true, 'the pad\'s Gate taken into both EG gates explicitly');
    const html = XYTAB.html();
    assert.match(html, /data-osc="synth.keys-silent"/);
    assert.match(html, /data-xy-unpatch=""[^>]*>Unpatch the pad</);
    const depth = st.debugInfo().undoDepth;
    const a = XY.xyUnpatchAction(st.getModel(), PANEL);
    assert.equal(a.action.type, 'BATCH');
    assert.equal(st.dispatch(a.action).ok, true);
    assert.equal(st.debugInfo().undoDepth, depth + 1, 'one history entry');
    assert.equal(keysEnvelopes(st.getModel()), 2, 'the keyboard gates both envelopes again');
    assert.deepEqual(panelCables(st.getModel(), PANEL).filter((c) => c.fromModule === 'xy'), []);
    assert.equal(XYTAB.html(), '');
  });

// ---------------------------------------------------------------- S10: the knob memory is the model's

const amountOf = (key) => PANEL.amounts.find((a) => a.key === key);
const lpfFrom = (m, mid) => m.graph.edges.filter((e) => e.from.node === nodeOf(m, mid).id
  && e.to.node === nodeOf(m, 'lpf').id && e.to.port === 'frequency');
/** The document as saved and opened again: a new store, a new Synth part, no page memory. */
const reopened = (m) => createStudioStore(normalizeStudio(JSON.parse(serializeStudio(m))),
  { idGenerator: createIdGenerator() });

test('S10: a knob a cable broke comes back at its setting after a reload (the model holds it)',
  () => {
    const st = panelStore();
    assert.equal(st.dispatch(setAmount(st.getModel(), PANEL, amountOf('lpf-eg2'), 3.5)).ok, true);
    const { cmp } = synthRig(st);
    // MG into LPF cutoff breaks the n21 and n22 normals, the EG 2 amount's only edge among them.
    assert.equal(st.dispatch(patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency')
      .action).ok, true);
    assert.deepEqual(lpfFrom(st.getModel(), 'eg2'), []);
    assert.equal(st.getModel().metadata.synthAmounts['lpf-eg2'], 3.5,
      'the BATCH that removed the knob\'s last edge kept its depth in the model');
    assert.ok(cmp.synthDebug().present);
    const again = reopened(st.getModel()); // a reload: the page's state is gone
    const rig = synthRig(again);
    const cable = panelCables(again.getModel(), PANEL).find((c) => c.to === 'lpf.frequency');
    rig.click({ removeCable: cable.id });
    assert.deepEqual(lpfFrom(again.getModel(), 'eg2').map((e) => e.props.depth), [3.5],
      'the normal comes back at the knob\'s setting, not its declared depth');
  });

test('S10: the depth is presentation state: saved and validated, outside studioHash', () => {
  const st = panelStore();
  const hash = studioHash(st.getModel());
  assert.equal(st.dispatch({ type: 'METADATA_SET', synthAmounts: { 'lpf-eg2': 3.5 } }).ok, true);
  assert.deepEqual(st.getModel().metadata.synthAmounts, { 'lpf-eg2': 3.5 });
  assert.equal(studioHash(st.getModel()), hash, 'no edge carries it: the hash is unchanged');
  assert.equal(st.dispatch({ type: 'METADATA_SET', synthAmounts: { 'lpf-mg': 1 } }).ok, true);
  assert.deepEqual(st.getModel().metadata.synthAmounts, { 'lpf-eg2': 3.5, 'lpf-mg': 1 },
    'METADATA_SET merges');
  const saved = normalizeStudio(JSON.parse(serializeStudio(st.getModel())));
  assert.deepEqual(saved.metadata.synthAmounts, { 'lpf-eg2': 3.5, 'lpf-mg': 1 },
    'the saved document keeps it');
  assert.equal(validateStudioModel(saved).ok, true);
  const bad = { ...saved, metadata: { ...saved.metadata, synthAmounts: { 'lpf-eg2': 'x' } } };
  assert.equal(validateStudioModel(bad).ok, false, 'a non-number depth is refused');
  st.undo();
  assert.deepEqual(st.getModel().metadata.synthAmounts, { 'lpf-eg2': 3.5 }, 'undoable');
});

test('S10: a link carries a broken knob\'s depth; the receiver brings it back at that depth', () => {
  const sender = panelStore();
  assert.equal(sender.dispatch(setAmount(sender.getModel(), PANEL, amountOf('lpf-eg2'), 3.5)).ok,
    true);
  assert.equal(sender.dispatch(patchCable(sender.getModel(), PANEL, 'mg.control',
    'lpf.frequency').action).ok, true);
  const link = decodeSynthLink(encodeSynthLink(linkOf(sender.getModel(), PANEL, 'init')), PANEL,
    PRESETS);
  assert.equal(link.ok, true, link.reason);
  const receiver = panelStore();
  assert.equal(receiver.dispatch(linkAction(receiver.getModel(), PANEL, link.link)).ok, true);
  assert.equal(receiver.getModel().metadata.synthAmounts['lpf-eg2'], 3.5);
  const cable = panelCables(receiver.getModel(), PANEL).find((c) => c.to === 'lpf.frequency');
  assert.equal(receiver.dispatch(unpatch(receiver.getModel(), PANEL, cable.id).action).ok, true);
  assert.deepEqual(lpfFrom(receiver.getModel(), 'eg2').map((e) => e.props.depth), [3.5]);
});

// ---------------------------------------------------------------- S7: links carry cable props

const edgeById = (m, id) => m.graph.edges.find((e) => e.id === id);
const cableInto = (m, to) => panelCables(m, PANEL).find((c) => c.to === to);
const CONTROL = ['muted', 'depth', 'polarity', 'mapping', 'offset'];
const propsOf = (m, to) => Object.fromEntries(CONTROL.map((k) => [k,
  edgeById(m, cableInto(m, to).id).props[k]]));

test('S7: Copy link carries a cable\'s edited props; the receiver gets the same cable', () => {
  const sender = panelStore();
  assert.equal(sender.dispatch(patchCable(sender.getModel(), PANEL, 'mg.control',
    'lpf.frequency').action).ok, true);
  const plain = linkOf(sender.getModel(), PANEL, 'init');
  assert.deepEqual(plain.cables, [['mg.control', 'lpf.frequency']],
    'an unedited cable carries no props');
  const id = cableInto(sender.getModel(), 'lpf.frequency').id;
  assert.equal(sender.dispatch({ type: 'EDGE_UPDATE', edgeId: id,
    props: { polarity: 'unipolar', offset: 0.25, muted: true } }).ok, true); // the Inspector
  const hash = encodeSynthLink(linkOf(sender.getModel(), PANEL, 'init'));
  const link = decodeSynthLink(hash, PANEL, PRESETS);
  assert.equal(link.ok, true, link.reason);
  const receiver = panelStore();
  assert.equal(receiver.dispatch(linkAction(receiver.getModel(), PANEL, link.link)).ok, true);
  assert.deepEqual(propsOf(receiver.getModel(), 'lpf.frequency'),
    propsOf(sender.getModel(), 'lpf.frequency'), hash);
});

test('S7: a saved XY preset keeps the Y range of its edge (depth and offset)', () => {
  const st = panelStore();
  assert.equal(st.dispatch(xyPresetAction(st.getModel(), PANEL, 'xy-lead').action).ok, true);
  const y = panelCables(st.getModel(), PANEL).find((c) => c.from === 'xy.y');
  assert.equal(st.dispatch({ type: 'EDGE_UPDATE', edgeId: y.id,
    props: { depth: 0.5, offset: 0.1 } }).ok, true);
  const patch = XY.xyPatchOf(st.getModel(), PANEL, { name: 'Tuned Y' });
  const fresh = panelStore();
  assert.equal(fresh.dispatch(XY.xyPatchAction(fresh.getModel(), PANEL, patch).action).ok, true);
  assert.deepEqual(propsOf(fresh.getModel(), y.to), propsOf(st.getModel(), y.to));
});

test('S7: cable props in a link are strict; a link without them decodes as before', () => {
  const dec = (yc) => decodeSynthLink(`m=synth&yc=${encodeURIComponent(yc)}`, PANEL, PRESETS);
  assert.deepEqual(dec('mg.control>lpf.frequency').link.cables,
    [['mg.control', 'lpf.frequency']]);
  assert.deepEqual(dec('mg.control>lpf.frequency@offset:0.25;polarity:unipolar').link.cables,
    [['mg.control', 'lpf.frequency', { offset: 0.25, polarity: 'unipolar' }]]);
  for (const bad of ['mg.control>lpf.frequency@', 'mg.control>lpf.frequency@colour:1',
    'mg.control>lpf.frequency@depth:x', 'mg.control>lpf.frequency@muted:1',
    'mg.control>lpf.frequency@polarity:sideways', 'mg.control>lpf.frequency@depth:1;depth:2',
    'mg.control>lpf.frequency@depth:1@depth:2', 'mg.control>lpf.frequency@mapping:log;depth:99',
    'vco1.audio>mix.in2@depth:1']) {
    const r = dec(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, /^Odkaz Synthu odmítnut: /, bad);
  }
});
