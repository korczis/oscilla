// K225: the Studio's patch library (studio/patch-catalog.js, the one library of the Synth and the
// Studio) inserts the Synth panel. A panel preset entry offers Insert where the document has no
// panel: one BATCH, one history entry, the panel as the Synth's own Insert builds it (insert.js
// insertAction, its metadata.panel tags) with the preset's values; with the panel present Insert
// is refused with a sentence and Apply still sets the panel's values.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { registerSynthSources } from '../../src/js/synth/library.js';
import { SYNTH_TEXT, insertAction } from '../../src/js/synth/insert.js';
import { presetOf } from '../../src/js/synth/presets.js';
import { PANEL_PRESENT_TEXT, catalogEntries, entryAction }
  from '../../src/js/studio/patch-catalog.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel } from '../../src/js/studio/templates/index.js';

registerSynthSources();

/** A changed document without the panel: its own chain feeds Master Output. */
function withoutPanel() {
  const m = templateModel('basic-tone');
  const st = createStudioStore(m, { idGenerator: createIdGenerator(m) });
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency',
    value: 330 }).ok, true);
  assert.equal(PANEL.resolve(st.getModel()).get('vco1'), null, 'no panel yet');
  return st;
}
const entry = (st, id) => catalogEntries({ model: st.getModel() }).find((e) => e.id === id);
const valuesOn = (m, p) => Object.entries(p.values).map(([k, v]) => {
  const [mid, key] = k.split('.');
  const n = PANEL.resolve(m).get(mid);
  return [k, n ? n.params[key] : undefined, v];
});

test('a panel preset offers Insert, and Insert puts the panel in with its values, one entry', () => {
  const st = withoutPanel();
  const e = entry(st, 'synth-bass');
  assert.ok(e.modes.includes('insert'), 'the library offers Insert for a panel preset');
  const r = entryAction(st.getModel(), e, 'insert');
  assert.ok(r.action, r.reason);
  assert.equal(r.action.type, 'BATCH');
  assert.equal(r.text, SYNTH_TEXT.took('Oscillator 1'), 'it names the feed it takes');
  const depth = st.debugInfo().undoDepth;
  const rev = st.getRevision();
  const done = st.dispatch(r.action);
  assert.equal(done.ok, true, done.reason);
  assert.equal(st.debugInfo().undoDepth, depth + 1, 'one history entry');
  assert.equal(st.getRevision(), rev + 1, 'one revision');
  const m = st.getModel();
  for (const [k, got, want] of valuesOn(m, presetOf('bass'))) assert.equal(got, want, k);
  // The panel as the Synth's own Insert builds it: the same modules, tagged the same way.
  const own = createStudioStore(withoutPanel().getModel(), { idGenerator: createIdGenerator() });
  assert.equal(own.dispatch(insertAction(own.getModel(), PANEL, { explicit: true }).action).ok,
    true);
  const tags = (model) => model.graph.nodes.filter((n) => n.metadata.panel)
    .map((n) => `${n.id}:${n.metadata.panel.id}/${n.metadata.panel.module}`).sort();
  assert.deepEqual(tags(m), tags(own.getModel()));
  assert.ok(tags(m).length > 10, 'every module carries metadata.panel');
  // Undo takes it all back in one step.
  st.undo();
  assert.equal(PANEL.resolve(st.getModel()).get('vco1'), null);
});

test('with the panel present Insert is refused with a sentence; Apply still sets the values', () => {
  const st = withoutPanel();
  assert.equal(st.dispatch(entryAction(st.getModel(), entry(st, 'synth-init'), 'insert').action)
    .ok, true);
  const before = st.getModel();
  const r = entryAction(before, entry(st, 'synth-bass'), 'insert');
  assert.equal(r.action, undefined);
  assert.equal(r.reason, PANEL_PRESENT_TEXT);
  assert.equal(st.getModel(), before, 'nothing changed');
  const a = entryAction(before, entry(st, 'synth-bass'), 'apply');
  assert.ok(a.action, a.reason);
  assert.equal(st.dispatch(a.action).ok, true);
  for (const [k, got, want] of valuesOn(st.getModel(), presetOf('bass'))) {
    assert.equal(got, want, k);
  }
});

test('an engine preset still inserts its engine node, not the panel', () => {
  const st = withoutPanel();
  const e = catalogEntries({ model: st.getModel() }).find((x) => x.tags.includes('engine'));
  const r = entryAction(st.getModel(), e, 'insert');
  assert.equal(r.action.type, 'PATCH_INSERT');
  assert.equal(st.dispatch(r.action).ok, true);
  assert.equal(PANEL.resolve(st.getModel()).get('vco1'), null, 'no panel came with it');
});
