// Opening the Synth on a fresh document inserts its panel by itself (synth/insert.js
// insertDecision): that is the app's change, not the user's, so the Studio must not then claim
// unsaved changes. Before the fix it did: a visit to #m=synth followed by a template link
// (#m=studio&st=basic-tone) was refused with "this Studio has unsaved changes" and the
// template dialog took focus (found when tests/browser/first-screen.cjs began to read every
// workspace from WORKSPACE_IDS, Synth included, 2026-11-06).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { insertAction } from '../../src/js/synth/insert.js';
import { createDirtyTracker } from '../../src/js/studio/library.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const fresh = () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
};
const insert = (store, opts = {}) => {
  const before = store.getModel();
  const r = insertAction(before, PANEL, opts);
  assert.ok(r.action, 'the panel is inserted');
  assert.ok(store.dispatch(r.action).ok);
  return { before, after: store.getModel() };
};

test('the automatic panel on a fresh document leaves the Studio clean', () => {
  const store = fresh();
  const dirty = createDirtyTracker(store.getModel());
  const { before, after } = insert(store);
  assert.equal(dirty.isDirty(after), true, 'the panel changes the document');
  assert.equal(dirty.rebaseFresh(before, after), true);
  assert.deepEqual(dirty.status(store.getModel()), { dirty: false, lastSave: null },
    'clean, and still never saved');
  store.dispatch({ type: 'METADATA_SET', notes: 'mine' });
  assert.equal(dirty.isDirty(store.getModel()), true, 'a user edit after it is unsaved');
});

test('a document the user changed or saved is never rebased', () => {
  const edited = fresh();
  const d1 = createDirtyTracker(edited.getModel());
  edited.dispatch({ type: 'METADATA_SET', notes: 'mine' });
  const e = insert(edited, { explicit: true });
  assert.equal(d1.rebaseFresh(e.before, e.after), false);
  assert.equal(d1.isDirty(edited.getModel()), true, 'the user edit stays unsaved');

  const saved = fresh();
  const d2 = createDirtyTracker(saved.getModel());
  d2.markSaved(saved.getModel(), { id: 'p-1', savedAt: '2026-11-06T00:00:00.000Z' });
  const s = insert(saved);
  assert.equal(d2.rebaseFresh(s.before, s.after), false, 'a saved project is not rewritten');
  assert.equal(d2.isDirty(saved.getModel()), true, 'its saved copy has no panel');
});

test('the Synth rebases only its automatic insertion, never the Insert button', () => {
  const src = readFileSync(new URL('../../src/js/synth/ui.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function ensurePanel('), src.indexOf('// ----', src
    .indexOf('function ensurePanel(')));
  assert.match(body, /if \(ok && !\(opts && opts\.explicit\) && tracker\) tracker\.rebaseFresh\(/);
  const ws = readFileSync(new URL('../../src/js/ui/studio/workspace.js', import.meta.url), 'utf8');
  assert.match(ws, new RegExp(String.raw`createSynthUi\(\{\s*get: \(\) => \(\{ handle: `
    + String.raw`ctx\.handle, transport: ctx\.transport, dirty: ctx\.dirty \}\)`));
});
