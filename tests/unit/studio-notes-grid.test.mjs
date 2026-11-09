// NOTES_GRID_SET (plan issue W008, ADR 0086 decision 2): a notes clip's grid changes in one
// undo entry; `keep` leaves every note where it is, `map` scales at and len by the new over
// the old stepBeats and is refused when a note would leave the clip, `refuse` applies only when
// every note sits on the new grid. A refusal leaves model, history and revision unchanged;
// undo and redo restore the exact serialized model.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as actions from '../../src/js/studio/actions.js';
import { GRID_SET_MODES, NEW_STEP_GRID, NOTES_GRID_TEXT, gridSet }
  from '../../src/js/studio/notes-grid.js';
import * as templates from '../../src/js/studio/templates/index.js';
import { NEW_GRID } from '../../src/js/ui/kinds/step-grid-model.js';

const storeOf = (m) => actions.createStudioStore(m, { idGenerator: actions.createIdGenerator(m) });
const ok = (r) => {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
};
const note = (at, n, len = 0.25, vel = 0.7) => ({ at, note: n, len, vel });

function setup(notes, grid) {
  const store = storeOf(templates.templateModel(templates.REFERENCE_TEMPLATE_ID));
  const keys = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'keys', position: { x: 0, y: 0 } }))
    .created.nodes[0];
  const track = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }))
    .created.tracks[0];
  const clip = ok(store.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'notes',
    startBeats: 0, durationBeats: 4, payload: { notes, ...(grid ? { grid } : {}) } }))
    .created.clips[0];
  return { store, clip };
}
const clipOf = (store, id) => store.getModel().timeline.clips.find((c) => c.id === id);

function refused(store, action, pattern) {
  const model = JSON.stringify(store.getModel());
  const depth = store.debugInfo().undoDepth;
  const revision = store.getRevision();
  const r = store.dispatch(action);
  assert.equal(r.ok, false);
  assert.match(r.reason, pattern);
  assert.equal(JSON.stringify(store.getModel()), model);
  assert.equal(store.debugInfo().undoDepth, depth);
  assert.equal(store.getRevision(), revision);
}

test('NOTES_GRID_SET is an exported Studio action type with three modes', () => {
  assert.ok(actions.ACTION_TYPES.includes('NOTES_GRID_SET'));
  assert.deepEqual([...GRID_SET_MODES], ['keep', 'map', 'refuse']);
  // One constant for a new step clip, shared by the Studio and the step-grid model.
  assert.deepEqual({ ...NEW_STEP_GRID }, { steps: 16, stepBeats: 0.25 });
  assert.equal(NEW_GRID, NEW_STEP_GRID);
});

test('keep: the grid changes in one undo entry and no note moves', () => {
  const notes = [note(0, 36), note(0.5, 38)];
  const { store, clip } = setup(notes);
  const before = JSON.stringify(store.getModel());
  const depth = store.debugInfo().undoDepth;
  ok(store.dispatch({ type: 'NOTES_GRID_SET', clipId: clip, grid: { stepBeats: 0.375 },
    mode: 'keep' }));
  const c = clipOf(store, clip);
  assert.deepEqual(c.payload.grid, { stepBeats: 0.375, swing: 0, seed: 0 });
  assert.deepEqual(c.payload.notes, notes);
  assert.equal(store.debugInfo().undoDepth, depth + 1);
  const after = JSON.stringify(store.getModel());
  store.undo();
  assert.equal(JSON.stringify(store.getModel()), before);
  store.redo();
  assert.equal(JSON.stringify(store.getModel()), after);
});

test('map: at and len scale by new over old stepBeats; refused when a note leaves the clip', () => {
  const { store, clip } = setup([note(0, 36), note(1, 38)], { stepBeats: 0.25, swing: 0,
    seed: 7 });
  ok(store.dispatch({ type: 'NOTES_GRID_SET', clipId: clip, grid: { stepBeats: 0.5 },
    mode: 'map' }));
  const c = clipOf(store, clip);
  assert.deepEqual(c.payload.notes, [note(0, 36, 0.5), note(2, 38, 0.5)]);
  assert.equal(c.payload.grid.seed, 7);
  // Doubling again would end the second note at 4.5 beats, past the 4-beat clip.
  refused(store, { type: 'NOTES_GRID_SET', clipId: clip, grid: { stepBeats: 1 }, mode: 'map' },
    /Přepočet mřížky by posunul konec noty 2 na dobu 5, za konec klipu v době 4/);
});

test('refuse: applies only when every note sits on the new grid', () => {
  const { store, clip } = setup([note(0, 36), note(0.75, 38)]);
  refused(store, { type: 'NOTES_GRID_SET', clipId: clip, grid: { stepBeats: 0.5 },
    mode: 'refuse' }, /^Nota 2 v době 0.75 by na nové mřížce nebyla na kroku/);
  ok(store.dispatch({ type: 'NOTES_GRID_SET', clipId: clip, grid: { stepBeats: 0.125 },
    mode: 'refuse' }));
  assert.equal(clipOf(store, clip).payload.grid.stepBeats, 0.125);
});

test('swing and seed change in any mode; bad fields and modes are refused', () => {
  const { store, clip } = setup([note(0, 36)]);
  ok(store.dispatch({ type: 'NOTES_GRID_SET', clipId: clip, grid: { swing: 0.5, seed: 42 } }));
  assert.deepEqual(clipOf(store, clip).payload.grid, { stepBeats: 0.25, swing: 0.5, seed: 42 });
  refused(store, { type: 'NOTES_GRID_SET', clipId: clip, grid: { swing: 0.9 } },
    /swing mřížky musí být zlomek stepBeats od 0 do 0.75/);
  refused(store, { type: 'NOTES_GRID_SET', clipId: clip, grid: { steps: 32 } },
    /„steps“ mezi ně nepatří/);
  refused(store, { type: 'NOTES_GRID_SET', clipId: clip, grid: { seed: 1 }, mode: 'snap' },
    /^Změna mřížky má režim keep, map, refuse\.$/);
  // The same grid again changes nothing and adds no undo entry.
  const depth = store.debugInfo().undoDepth;
  ok(store.dispatch({ type: 'NOTES_GRID_SET', clipId: clip, grid: { seed: 42 } }));
  assert.equal(store.debugInfo().undoDepth, depth);
});

test('a clip that is not a notes clip has no grid', () => {
  assert.deepEqual(gridSet({ kind: 'pattern', payload: {} }, { seed: 1 }),
    { refused: NOTES_GRID_TEXT.kind });
});
