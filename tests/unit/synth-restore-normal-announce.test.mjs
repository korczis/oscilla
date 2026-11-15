// K214: Restore normal on the Synth panel says what it did. A normal deleted in the Studio leaves
// its jack open with Restore normal (synth/ui.js); pressing it restores the normal as one history
// entry, and the restored normal is announced in the polite live region (assertive false), as
// Cable removed and Break normal are. Before the fix the restore was silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { createSynthUi } from '../../src/js/synth/ui.js';
import { jackState, panelEdges } from '../../src/js/synth/normals.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

/** The real Synth part on the real transport; `click(dataset)` is a click in its view. */
function rig() {
  const st = panelStore();
  const listeners = {};
  const view = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.document = { querySelector: (s) => (s === '[data-osc="synth-view"]' ? view : null),
    getElementById: () => null, activeElement: null };
  globalThis.window ??= { addEventListener() {}, location: { href: 'http://x/' } };
  globalThis.requestAnimationFrame = () => 0;
  const fx = createFakeAudioEnv({ sampleRate: 44100 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const handle = Object.create(st, { subscribe: { value: () => () => {} } });
  const said = [];
  const part = createSynthUi({ get: () => ({ handle, transport }),
    announce: (text, opts = {}) => said.push({ text, assertive: !!opts.assertive }) });
  const cmp = Object.assign(part, { workspace: 'synth', ensureAudio() {}, $watch() {},
    $nextTick() {} });
  cmp.synthInit();
  const click = (dataset) => listeners.click({ target: { closest: () => ({ dataset,
    getAttribute: () => null }) } });
  return { st, cmp, said, click };
}

test('Restore normal restores the jack in one entry and says so in the polite region', () => {
  const r = rig();
  const n = panelEdges(r.st.getModel(), PANEL).normals.get('n2');
  assert.equal(r.st.dispatch({ type: 'EDGE_REMOVE', edgeIds: [n.id] }).ok, true);
  assert.equal(jackState(r.st.getModel(), PANEL, 'vco2.pitch'), 'open');
  const depth = r.st.debugInfo().undoDepth;
  r.said.length = 0;
  r.click({ restoreNormal: 'vco2.pitch' });
  assert.equal(jackState(r.st.getModel(), PANEL, 'vco2.pitch'), 'normalled');
  assert.equal(panelEdges(r.st.getModel(), PANEL).normals.get('n2').id, n.id, 'with its id');
  assert.equal(r.st.debugInfo().undoDepth, depth + 1, 'one history entry');
  assert.equal(r.said.length, 1, `one announcement: ${JSON.stringify(r.said)}`);
  assert.equal(r.said[0].assertive, false, 'in the polite live region');
  assert.match(r.said[0].text, /obnoven/);
  assert.match(r.said[0].text, /VCO 2/i, 'it names the jack');
  assert.equal(r.cmp.synth.status, r.said[0].text, 'the view shows the same sentence');
});
