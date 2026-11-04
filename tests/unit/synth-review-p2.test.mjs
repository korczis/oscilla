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
import { createSynthUi } from '../../src/js/synth/ui.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

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
