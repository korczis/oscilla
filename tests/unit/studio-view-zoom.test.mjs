// K170 (coherent-state#views-describe-what-sounds): the Studio model's graph zoom is the zoom the
// graph editor shows, from load (src/js/ui/studio/graph-fit.js, the editor's fit mode).
//   node --test tests/unit/studio-view-zoom.test.mjs
// Before K170 a fresh Studio's model read zoom 1 while the editor showed its fitted zoom (0.74
// at 1536 x 1024): the editor committed its first fit VIEW_COMMIT_MS later, and a fitted view
// was never fitted again when the viewport changed size (the docked keys show only while the
// Studio is armed, M086). Here the real store, dirty tracker, studioHash and file import judge
// the fit controller the editor runs (graph-editor.js wires its fits, Frame All, its
// ResizeObserver and every view change through it; the last tests hold that wiring).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createViewFit, isUnframedView } from '../../src/js/ui/studio/graph-fit.js';
import {
  NODE_WIDTH, ZOOM_STEP, boundsOf, fitView, normalizeView, zoomAt,
} from '../../src/js/ui/studio/graph-geometry.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { DEFAULT_VIEW, studioHash } from '../../src/js/studio/schema.js';
import {
  createDirtyTracker, exportProjectFile, importStudioFile,
} from '../../src/js/studio/library.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const ROOT = new URL('../../', import.meta.url);
const NODE_H = 80;
// The graph viewport at 1536 x 1024 without and with the docked keys (measured on chromium).
const DESKTOP = Object.freeze({ w: 952, h: 377 });
const DOCKED = Object.freeze({ w: 952, h: 289 });

/** An editor's worth of fit: the real store, a viewport size the test sets, the shown view. */
function harness(model = templateModel(REFERENCE_TEMPLATE_ID)) {
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const shown = { view: normalizeView(store.getModel().view.graph), applies: 0 };
  const vp = { size: { ...DESKTOP } };
  const fit = createViewFit({ store, size: () => vp.size,
    bounds: () => boundsOf(store.getModel().graph.nodes.map((n) => ({ x: n.position.x,
      y: n.position.y, w: NODE_WIDTH, h: NODE_H }))),
    apply: (v) => { shown.view = v; shown.applies++; } });
  const dirty = createDirtyTracker(store.getModel());
  const facts = () => ({ hash: studioHash(store.getModel()),
    undo: store.debugInfo().undoDepth, revision: store.getRevision(),
    dirty: dirty.isDirty(store.getModel()) });
  return { store, shown, vp, fit, dirty, facts, graph: () => store.getModel().view.graph };
}

const sameView = (a, b, what) => assert.deepEqual({ panX: a.panX, panY: a.panY, zoom: a.zoom },
  { panX: b.panX, panY: b.panY, zoom: b.zoom }, what);

test('first fit: the model holds the zoom the editor applies; hash, undo, revision, dirty kept',
  () => {
    const t = harness();
    const before = t.facts();
    assert.ok(isUnframedView(t.graph()), 'a template opens with the default view');
    const v = t.fit.open();
    assert.ok(v, 'the fit applies at once when the viewport has a size');
    assert.notEqual(t.shown.view.zoom, 1, 'the fitted zoom is not the default 1');
    sameView(t.graph(), t.shown.view, 'model view == applied view right after the first fit');
    assert.deepEqual(t.facts(), before, 'presentation only: no hash, undo, revision or dirty');
    assert.equal(t.fit.fitted(), true);
  });

test('a hidden viewport waits in fit mode and fits, committing, on its first size', () => {
  const t = harness();
  t.vp.size = { w: 0, h: 0 };
  assert.equal(t.fit.open(), null);
  assert.equal(t.graph().zoom, 1, 'nothing applied: model and editor both still show 1');
  assert.equal(t.shown.view.zoom, 1);
  t.vp.size = { ...DESKTOP };
  assert.ok(t.fit.resize());
  sameView(t.graph(), t.shown.view, 'model == applied after the first size');
});

test('a resize in fit mode fits again (the docked keys), and Frame All after it is the same view',
  () => {
    const t = harness();
    t.fit.open();
    const open = t.shown.view;
    const before = t.facts();
    t.vp.size = { ...DOCKED };
    const v = t.fit.resize();
    assert.ok(v, 'still fitted: the new size is fitted');
    assert.ok(v.zoom < open.zoom, `a shorter viewport fits smaller: ${v.zoom} < ${open.zoom}`);
    sameView(t.graph(), t.shown.view, 'model == applied after the re-fit');
    const expected = normalizeView(fitView(boundsOf(t.store.getModel().graph.nodes.map((n) => ({
      x: n.position.x, y: n.position.y, w: NODE_WIDTH, h: NODE_H }))), DOCKED));
    sameView(t.shown.view, expected, 'the re-fit is the fit of the new size');
    assert.deepEqual(t.facts(), before, 'a re-fit is presentation only');
    const n = t.shown.applies;
    t.fit.frame();
    sameView(t.shown.view, expected, 'Frame All at that size changes nothing');
    assert.equal(t.shown.applies, n + 1);
  });

test('a zoom gesture leaves fit mode and commits as today; a resize then keeps the zoom', () => {
  const t = harness();
  t.fit.open();
  const before = t.facts();
  // What the editor does for the Zoom in button (setView then its commit, VIEW_COMMIT_MS later).
  t.fit.leave();
  const zoomed = normalizeView(zoomAt(t.shown.view, ZOOM_STEP, DESKTOP.w / 2, DESKTOP.h / 2));
  t.shown.view = zoomed;
  const r = t.store.dispatch({ type: 'VIEW_SET', view: { graph: { ...zoomed } } });
  assert.equal(r.ok, true);
  sameView(t.graph(), zoomed, 'the gesture commits its view');
  assert.deepEqual(t.facts(), before, 'a gesture view is presentation only too');
  assert.equal(t.fit.fitted(), false, 'a gesture leaves fit mode');
  const applies = t.shown.applies;
  t.vp.size = { ...DOCKED };
  assert.equal(t.fit.resize(), null, 'no re-fit after a gesture');
  t.vp.size = { w: 348, h: 458 };
  assert.equal(t.fit.resize(), null);
  assert.equal(t.shown.applies, applies, 'the editor was not asked to show another view');
  sameView(t.graph(), zoomed, 'the zoom the user chose survives the resizes');
  t.fit.frame();
  assert.equal(t.fit.fitted(), true, 'Frame All enters fit mode again');
  sameView(t.graph(), t.shown.view, 'model == applied after Frame All');
});

test('negative: a saved document with an explicit zoom opens at that zoom, not refitted', () => {
  const saved = { panX: 12, panY: -40, zoom: 1.6 };
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const t = harness({ ...m, view: { ...m.view, graph: saved } });
  const before = t.facts();
  const model = t.store.getModel();
  assert.equal(t.fit.open(), null, 'no fit');
  assert.equal(t.fit.fitted(), false);
  sameView(t.shown.view, saved, 'the editor shows the saved view');
  assert.equal(t.store.getModel(), model, 'the model is untouched');
  t.vp.size = { ...DOCKED };
  assert.equal(t.fit.resize(), null, 'a resize keeps a saved zoom');
  sameView(t.graph(), saved, 'still the saved view');
  assert.deepEqual(t.facts(), before);
});

test('negative: a document saved before the change loads with its hash and bytes unchanged', () => {
  // Saved by the base: the template after its committed fit, and one saved before any fit.
  const tpl = templateModel(REFERENCE_TEMPLATE_ID);
  const hash = studioHash(tpl);
  const fitted = { panX: 160.88715953307394, panY: -86.91050583657588, zoom: 0.7431906614785992 };
  for (const [what, view] of [['explicit', fitted], ['default', DEFAULT_VIEW.graph]]) {
    const text = exportProjectFile({ ...tpl, view: { ...tpl.view, graph: view } }).text;
    const r = importStudioFile(text);
    assert.equal(r.ok, true, what);
    assert.deepEqual(Object.keys(r.model.view.graph).sort(), ['panX', 'panY', 'zoom'],
      `${what}: no field added to the saved view`);
    assert.equal(studioHash(r.model), hash, `${what}: the loaded hash is the saved one`);
    const t = harness(r.model);
    t.fit.open();
    assert.equal(studioHash(t.store.getModel()), hash, `${what}: hash unchanged after open`);
    if (what === 'explicit') {
      assert.equal(exportProjectFile(t.store.getModel()).text, text,
        'explicit: it saves again byte for byte');
    } else {
      sameView(t.graph(), t.shown.view, 'default: opened fitted, model == applied');
    }
  }
});

test('mutation: a fit that is applied but not committed is caught', () => {
  const t = harness();
  const lazy = createViewFit({ store: { getModel: () => t.store.getModel(), dispatch: () => {} },
    size: () => DESKTOP, bounds: () => ({ x: 0, y: 0, w: 1200, h: 600 }),
    apply: (v) => { t.shown.view = v; } });
  lazy.open();
  assert.notEqual(t.graph().zoom, t.shown.view.zoom, 'without the commit the two disagree');
});

test('the editor runs its fits, resizes and view changes through graph-fit.js', () => {
  const src = readFileSync(new URL('src/js/ui/studio/graph-editor.js', ROOT), 'utf8');
  assert.match(src, /import \{ createViewFit \} from '\.\/graph-fit\.js';/);
  assert.match(src, /function frameAll\(\) \{\s*fit\.frame\(\);/, 'Frame All enters fit mode');
  assert.match(src, /new ResizeObserver\(\(\) => \{\s*measureSize\(\);\s*fit\.resize\(\);/,
    'the viewport observer re-fits a fitted view');
  assert.match(src, /function setView\(v, commit = true\) \{\s*fit\.leave\(\);/,
    'a view change leaves fit mode');
  assert.match(src, /setLocalView: \(v\) => \{ fit\.leave\(\);/, 'so does a gesture');
  assert.doesNotMatch(src, /framedOnce/, 'no first-fit path outside fit mode');
  const doc = readFileSync(new URL('src/js/ui/studio/workspace/document.js', ROOT), 'utf8');
  assert.match(doc, /ctx\.editor\.openView\(\)/, 'an opened document goes through openView');
  assert.doesNotMatch(doc, /editor\.frameAll\(\)/, 'and is not framed regardless of its view');
});
