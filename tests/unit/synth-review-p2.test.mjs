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
import { panelCables } from '../../src/js/synth/normals.js';
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
  assert.match(html, /data-osc="synth.engine-elsewhere"/);
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
  assert.equal(cmp.synth.status, SYNTH_TEXT.took(names), 'the notice names the feed it took');
  const added = st.getModel().graph.nodes.filter((n) => !before.has(n.id));
  assert.ok(added.length > 10 && added.every((n) => n.position.y > top),
    'the panel is placed below the user\'s nodes');
  assert.equal(st.getModel().metadata.noteTarget, undefined, 'the route is cleared');
  assert.equal(cmp.synthDebug().played, nodeOf(st.getModel(), 'keys').id,
    'the keys play the new voice');
});

// ---------------------------------------------------------------- S8: a silent keyboard says why

const keysEnvelopes = (m) => gateTargets(m, nodeOf(m, 'keys').id).envelopes.length;

test('S8: after an XY preset and Panel Init, a key says why the keys sound nothing', () => {
  const { cmp, st, sink } = synthRig();
  assert.equal(cmp.synthPreset('xy-lead'), true);
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
