// K222: the Drums view's pure half (src/js/synth/drums.js) on the step-grid model (W008). The six
// default rows are note numbers of the percussion engine's key map (ADR 0086 decision 5), named
// in Czech; toggling step i of a row builds one CLIP_UPDATE that gains or loses exactly the note
// at i x stepBeats with that row's note number; a voice change rewrites only that lane's notes in
// one CLIP_UPDATE. Negative cases: a voice another row holds (refused, model unchanged); an
// off-grid note (shown as off-grid, never moved); Space (the transport's).

import test from 'node:test';
import assert from 'node:assert/strict';

import * as actions from '../../src/js/studio/actions.js';
import { NEW_STEP_GRID } from '../../src/js/studio/notes-grid.js';
import * as schema from '../../src/js/studio/schema.js';
import { PERC_KEYMAP, percNote } from '../../src/js/synth/perc-recipes.js';
import { DRUM_ROWS, DRUM_TEXT, DRUM_VOICES, drumClipOf, lanesOf, namesOf, newDrumClip, rowsOf,
  voiceChange } from '../../src/js/synth/drums.js';
import { createStepGrid } from '../../src/js/ui/kinds/step-grid-model.js';

const SB = NEW_STEP_GRID.stepBeats;
const ok = (r) => {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
};

/** A store with the percussion engine and the Drums view's clip made by newDrumClip. */
function kit() {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const perc = ok(st.dispatch({ type: 'NODE_ADD', nodeType: 'perc-voice',
    position: { x: 0, y: 0 } })).created.nodes[0];
  const depth = st.debugInfo().undoDepth;
  ok(st.dispatch(newDrumClip(st.getModel(), perc)));
  assert.equal(st.debugInfo().undoDepth, depth + 1, 'the clip is one history entry');
  return { st, perc, clip: () => drumClipOf(st.getModel(), perc) };
}

test('the six default rows are key-map notes of the engine, named in Czech', () => {
  assert.deepEqual([...DRUM_ROWS], ['kick', 'snare', 'clap', 'hatClosed', 'hatOpen', 'tomMid']);
  const lanes = lanesOf(DRUM_ROWS);
  assert.deepEqual(lanes, [60, 62, 61, 66, 70, 65]);
  // Each lane is the key map's note of its voice, untransposed.
  lanes.forEach((note, i) => {
    assert.equal(PERC_KEYMAP[note % 12], DRUM_ROWS[i], `${note}`);
    assert.equal(percNote(note).voice.id, DRUM_ROWS[i]);
    assert.equal(percNote(note).octaveSt, 0);
  });
  assert.deepEqual(namesOf(DRUM_ROWS), ['Kopák', 'Virbl', 'Tlesk', 'Hi-hat zavřený',
    'Hi-hat otevřený', 'Tom střední']);
  for (const v of DRUM_VOICES) assert.equal(PERC_KEYMAP[v.note % 12], v.voice, v.voice);
});

test('a new Drums clip: a track on the engine, an empty one-bar notes clip that plays', () => {
  const { st, clip } = kit();
  const c = clip();
  assert.ok(c, 'drumClipOf finds it');
  assert.deepEqual([c.kind, c.musical.durationBeats, c.payload.notes.length], ['notes', 4, 0]);
  const track = st.getModel().timeline.tracks.find((t) => t.id === c.trackId);
  assert.equal(track.name, 'Bicí');
});

test('toggling step i of a row gains or loses exactly that note, one CLIP_UPDATE each', () => {
  const { st, clip } = kit();
  const rows = DRUM_ROWS;
  const actionsSent = [];
  const grid = createStepGrid({ mode: 'notes', lanes: lanesOf(rows), clipId: clip().id,
    payload: clip().payload, steps: 16, stepBeats: SB, pageSteps: 16,
    commit: (a) => {
      actionsSent.push(a);
      const r = st.dispatch(a);
      grid.set({ payload: clip().payload });
      return r.ok ? true : { refused: r.reason };
    } });
  // The snare row (lane 1), step 5: Down, then Right x4, Enter.
  grid.key('ArrowDown');
  for (let i = 0; i < 4; i += 1) grid.key('ArrowRight');
  grid.key('Enter');
  assert.equal(actionsSent.length, 1);
  assert.equal(actionsSent[0].type, 'CLIP_UPDATE');
  assert.deepEqual(clip().payload.notes.map((n) => [n.at, n.note]), [[4 * SB, 62]]);
  // A kick on step 1 leaves the snare as it is.
  grid.key('ArrowUp');
  for (let i = 0; i < 4; i += 1) grid.key('ArrowLeft');
  grid.key('Enter');
  assert.deepEqual(clip().payload.notes.map((n) => [n.at, n.note]), [[0, 60], [4 * SB, 62]]);
  // Enter again takes the kick off; the snare stays.
  grid.key('Enter');
  assert.deepEqual(clip().payload.notes.map((n) => [n.at, n.note]), [[4 * SB, 62]]);
  assert.equal(actionsSent.length, 3);
});

test('a voice change rewrites only that lane\'s notes in one CLIP_UPDATE', () => {
  const { st, clip } = kit();
  const notes = [{ at: 0, note: 60, len: SB, vel: 0.7 }, { at: SB, note: 62, len: SB, vel: 0.7 },
    { at: 2 * SB, note: 60, len: SB, vel: 0.9 }];
  ok(st.dispatch({ type: 'CLIP_UPDATE', clipId: clip().id, payload: { notes } }));
  const r = voiceChange(clip(), DRUM_ROWS, 0, 'tomLow');
  assert.deepEqual(r.rows, ['tomLow', 'snare', 'clap', 'hatClosed', 'hatOpen', 'tomMid']);
  const depth = st.debugInfo().undoDepth;
  ok(st.dispatch(r.action));
  assert.equal(st.debugInfo().undoDepth, depth + 1);
  assert.deepEqual(clip().payload.notes.map((n) => [n.at, n.note, n.vel]),
    [[0, 64, 0.7], [SB, 62, 0.7], [2 * SB, 64, 0.9]]);
});

test('negative: a voice another row holds is refused, the model unchanged', () => {
  const { st, clip } = kit();
  const before = JSON.stringify(st.getModel());
  const r = voiceChange(clip(), DRUM_ROWS, 0, 'snare');
  assert.deepEqual(r, { refused: DRUM_TEXT.taken('Virbl') });
  assert.equal(r.refused, 'Virbl už má jiná řada; každý zvuk sady hraje jedna řada.');
  assert.equal(JSON.stringify(st.getModel()), before);
});

test('negative: an off-grid note is shown as off-grid and never moved', () => {
  const { st, clip } = kit();
  const off = { at: 0.3, note: 60, len: SB, vel: 0.7 };
  ok(st.dispatch({ type: 'CLIP_UPDATE', clipId: clip().id, payload: { notes: [off] } }));
  const sent = [];
  const grid = createStepGrid({ mode: 'notes', lanes: lanesOf(DRUM_ROWS), clipId: clip().id,
    payload: clip().payload, steps: 16, stepBeats: SB, pageSteps: 16,
    commit: (a) => { sent.push(a); st.dispatch(a); grid.set({ payload: clip().payload });
      return true; } });
  assert.deepEqual(grid.state().offGrid.map((o) => [o.lane, o.at]), [[0, 0.3]]);
  grid.key('Enter'); // the kick on step 1
  assert.deepEqual(clip().payload.notes.map((n) => [n.at, n.note]), [[0, 60], [0.3, 60]]);
  // rowsOf never hides a note: a drum voice outside the default rows gets its own row.
  const extra = { ...clip(), payload: { notes: [{ at: 0, note: 64, len: SB, vel: 0.7 }] } };
  assert.deepEqual(rowsOf(extra).slice(-1), ['tomLow']);
});

test('negative: Space builds nothing in the Drums grid (the transport\'s)', () => {
  const { clip } = kit();
  const sent = [];
  const grid = createStepGrid({ mode: 'notes', lanes: lanesOf(DRUM_ROWS), clipId: clip().id,
    payload: clip().payload, commit: (a) => { sent.push(a); return true; } });
  assert.equal(grid.key('Space'), false);
  assert.equal(sent.length, 0);
});
