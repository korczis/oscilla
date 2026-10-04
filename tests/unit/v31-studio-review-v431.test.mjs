// V3.1 Studio review findings fixed in the model layer (plan V431; docs/v31/review-v431.md).
// Each test reproduces a finding on the code before its fix:
//   A2 / X6  undo, redo and a cancelled gesture rolled the view (pan, zoom, timeline scale) back
//   X7       a cancelled gesture destroyed the redo stack
//   A4 / X9  the store let a function or a prototype-setting key into the canonical model, which
//            then could not be saved, hashed or recorded
//   A4       an event clip with an unknown action was accepted
//   A3 / X5  recipeFromStudio silently replaced out-of-range measurement clips by engine defaults
//            and ran a 5 s sweep under a 2 s stimulus clip
//   A7       two models with the same studioHash gave different recipes (first clip in array order)
//   node --test tests/unit/v31-studio-review-v431.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { recipeFromStudio } from '../../src/js/studio/provenance.js';
import {
  copyPlain, normalizeStudio, serializeStudio, studioHash,
} from '../../src/js/studio/schema.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const SR = 48000;

function storeOf(model) {
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

const synth = () => storeOf(templateModel('subtractive-synth'));
const measurement = () => storeOf(templateModel(MEASUREMENT_TEMPLATE_ID));

// ---------------------------------------------------------------- view is not undoable

test('A2/X6 undo and redo restore the document and keep the current view', () => {
  const store = synth();
  const node = store.getModel().graph.nodes[0];
  assert.ok(store.dispatch({ type: 'NODE_MOVE', nodeId: node.id,
    position: { x: node.position.x + 40, y: node.position.y } }).ok);
  const view = { graph: { panX: 500, panY: -300, zoom: 2 },
    timeline: { pxPerSecond: 400, scrollX: 120 } };
  assert.ok(store.dispatch({ type: 'VIEW_SET', view }).ok);
  assert.ok(store.undo().ok);
  assert.deepEqual(store.getModel().graph.nodes[0].position, node.position, 'document undone');
  assert.deepEqual(store.getModel().view, view, 'view kept by undo');
  assert.ok(store.redo().ok);
  assert.equal(store.getModel().graph.nodes[0].position.x, node.position.x + 40);
  assert.deepEqual(store.getModel().view, view, 'view kept by redo');
  // A cancelled gesture returns the document to its start, not the view.
  store.beginGesture('Move');
  store.dispatch({ type: 'NODE_MOVE', nodeId: node.id, position: { x: -200, y: -200 } });
  const zoomed = { graph: { panX: 10, panY: 20, zoom: 3 } };
  store.dispatch({ type: 'VIEW_SET', view: zoomed });
  assert.ok(store.cancelGesture());
  assert.equal(store.getModel().graph.nodes[0].position.x, node.position.x + 40);
  assert.deepEqual(store.getModel().view.graph, zoomed.graph, 'view kept by cancel');
  // Undo with an unchanged view still restores the exact snapshot (structural sharing).
  const s2 = synth();
  const before = s2.getModel();
  s2.dispatch({ type: 'NODE_MOVE', nodeId: node.id, position: { x: 0, y: 0 } });
  s2.undo();
  assert.equal(s2.getModel(), before);
});

test('X7 a cancelled gesture leaves the redo stack intact; a committed one clears it', () => {
  const store = synth();
  const id = store.getModel().graph.nodes[0].id;
  store.dispatch({ type: 'NODE_MOVE', nodeId: id, position: { x: 8, y: 8 } });
  store.undo();
  assert.ok(store.canRedo());
  store.beginGesture('Move');
  store.dispatch({ type: 'NODE_MOVE', nodeId: id, position: { x: 16, y: 16 } });
  assert.equal(store.canRedo(), false, 'the first change inside a gesture clears redo (§51)');
  store.cancelGesture();
  assert.ok(store.canRedo(), 'cancelled: nothing was edited, redo is back');
  assert.ok(store.redo().ok);
  assert.deepEqual(store.getModel().graph.nodes[0].position, { x: 8, y: 8 });
  store.undo();
  store.beginGesture('Move');
  store.dispatch({ type: 'NODE_MOVE', nodeId: id, position: { x: 24, y: 24 } });
  store.endGesture();
  assert.equal(store.canRedo(), false, 'committed: a new edit after undo clears redo');
});

// ---------------------------------------------------------------- plain data only

test('A4 the store refuses a function in a clip payload; the model stays saveable', () => {
  const store = measurement();
  const before = store.getModel();
  const r = store.dispatch({ type: 'CLIP_ADD', trackId: 'track-1', kind: 'measurement',
    start: 9, duration: 1, payload: { action: 'tail', cb: () => 42 } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /function is not plain data/);
  assert.equal(store.getModel(), before);
  assert.doesNotThrow(() => serializeStudio(store.getModel()));
  assert.doesNotThrow(() => studioHash(store.getModel()));
});

test('X9 PASTE with a "__proto__" key in edge props is refused, not merged as a prototype', () => {
  const store = synth();
  const before = store.getModel();
  const clipboard = JSON.parse('{"kind":"oscilla-studio-clipboard","v":1,"nodes":['
    + '{"id":"a","type":"lfo","position":{"x":0,"y":0},"params":{},"metadata":{"name":"L"}},'
    + '{"id":"b","type":"gain","position":{"x":0,"y":0},"params":{},"metadata":{"name":"G"}}],'
    + '"edges":[{"id":"e","from":{"node":"a","port":"control"},"to":{"node":"b","port":"gain"},'
    + '"props":{"__proto__":{"depth":0.9,"offset":1.5,"polarity":"unipolar"}}}]}');
  const r = store.dispatch({ type: 'PASTE', clipboard });
  assert.equal(r.ok, false, 'refused');
  assert.equal(store.getModel(), before);
  assert.doesNotThrow(() => serializeStudio(store.getModel()));
});

test('A4 an event clip action outside gate / trigger is refused by the store', () => {
  const store = synth();
  const t = store.dispatch({ type: 'TRACK_ADD', kind: 'event' });
  assert.ok(t.ok, t.reason);
  const trackId = t.created.tracks[0];
  const bad = store.dispatch({ type: 'CLIP_ADD', trackId, kind: 'event', start: 0, duration: 1,
    payload: { action: 'explode' } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /event clip action must be one of gate, trigger/);
  for (const action of ['gate', 'trigger']) {
    const ok = store.dispatch({ type: 'CLIP_ADD', trackId, kind: 'event', start: 2, duration: 1,
      payload: { action } });
    assert.ok(ok.ok, `${action}: ${ok.reason}`);
  }
});

// ---------------------------------------------------------------- the recipe is what is shown

/** The measurement template with one clip's duration set, bypassing the store's validation. */
function unvalidated(clipId, duration) {
  const doc = copyPlain(templateModel(MEASUREMENT_TEMPLATE_ID));
  doc.timeline.clips.find((c) => c.id === clipId).duration = duration;
  return normalizeStudio(doc);
}

test('A3/X5 a timing clip outside the engine limits refuses the recipe; no silent default', () => {
  // Since V431 #24 the store refuses these clips too; a model that never passed the store
  // (built in code) still cannot give a recipe with engine defaults.
  const r = recipeFromStudio(unvalidated('clip-2', 8), { sampleRate: SR });
  assert.equal(r.ok, false);
  assert.match(r.reason, /pre-roll clip lasts 8 s; the measurement engine accepts 0\.05-5 s/);
  assert.match(recipeFromStudio(unvalidated('clip-4', 0.05), { sampleRate: SR }).reason,
    /tail clip/);
  // In range: the clip's own duration, as before.
  const fine = measurement();
  fine.dispatch({ type: 'CLIP_RESIZE', clipId: 'clip-2', duration: 2 });
  assert.equal(recipeFromStudio(fine.getModel(), { sampleRate: SR }).recipe.analysis.preRollS, 2);
});

test('X5 a stimulus clip shorter than its Sweep refuses the recipe', () => {
  const store = measurement();
  assert.ok(store.dispatch({ type: 'CLIP_RESIZE', clipId: 'clip-3', duration: 2 }).ok);
  const r = recipeFromStudio(store.getModel(), { sampleRate: SR });
  assert.equal(r.ok, false);
  assert.match(r.reason, /stimulus clip \(2 s\) is shorter than .* \(5 s\)/);
  assert.equal(recipeFromStudio(measurement().getModel(), { sampleRate: SR }).ok, true,
    'the template (stimulus clip = sweep duration) still derives');
});

test('A7 the same studioHash cannot give two recipes: duplicate timing clips are refused', () => {
  const store = measurement();
  assert.ok(store.dispatch({ type: 'CLIP_ADD', trackId: 'track-2', kind: 'measurement',
    start: 8.5, duration: 2, payload: { action: 'pre-roll' } }).ok);
  const a = store.getModel();
  const doc = copyPlain(a);
  doc.timeline.clips.reverse();
  const b = normalizeStudio(doc);
  assert.equal(studioHash(a), studioHash(b), 'array order is not part of the setup');
  for (const m of [a, b]) {
    const r = recipeFromStudio(m, { sampleRate: SR });
    assert.equal(r.ok, false);
    assert.match(r.reason, /More than one pre-roll clip/);
  }
});
