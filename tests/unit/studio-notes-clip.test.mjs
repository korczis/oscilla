// K099 part 1 (ADR 0084): the Studio clip kind `notes`, data only. Payload
// `{ notes: [{ at, note, len, vel }] }`: at and len in beats from the clip start (at >= 0,
// len > 0, at + len within the clip's musical length), note an integer MIDI number 0-127, vel a
// number in (0, 1] (the form K149's riff toNotes() emits). A notes clip is tempo-linked, sits
// on an event track and targets only a node that plays notes (registry.js playsNotes: Keys, the
// XY pad, the voice engines). Its notes are sorted by (at, note) on normalise and a clip holds one
// note per (at, note). A note has these four fields; K068 adds ADR 0086's optional p, r and slide
// and the clip's optional grid (tests/unit/studio-steps-playback.test.mjs), any other is refused.
// STUDIO_IMPORT_LIMITS gains notesPerClip and notesPerDocument. Since K068 the transport and the
// offline render play a notes clip on a Keys node; on the XY pad or a voice engine they report it
// unplayed (code notes-unplayed) with the clip-target policy's sentence, so nothing pretends to
// play.
//
// Fails on the merge base 117c755c: CLIP_KINDS there is pattern, event and measurement, so the
// store refuses CLIP_ADD of kind notes ('Unknown clip kind "notes".'), clipRules refuses the
// kind on import, and STUDIO_IMPORT_LIMITS has no notes limits.
//
// The clip form (timeline-details.js through timeline-view.js clipFormOptions) offers a notes
// clip no Action list (the measurement actions it fell back to would be refused, an inert
// surface): it shows the notes read-only, and only the placement fields that work.
//
// Part 2 of K099 adds what this file leaves out: notes played at their frames by the timeline
// scheduler, offline equal to live, and the one handler shared by live and scheduled notes.
//   node --test tests/unit/studio-notes-clip.test.mjs
// Namespace imports, so that each test fails on its own assertion on the base.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import * as migrate from '../../src/js/studio/migrate.js';
import * as offline from '../../src/js/studio/offline.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as templates from '../../src/js/studio/templates/index.js';
import * as transportModule from '../../src/js/studio/transport.js';
import * as validate from '../../src/js/studio/validate.js';
import * as timelineView from '../../src/js/ui/studio/timeline-view.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const storeOf = (m) => actions.createStudioStore(m, { idGenerator: actions.createIdGenerator(m) });
const ok = (r) => {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
};
const note = (at, n, len = 1, vel = 0.8) => ({ at, note: n, len, vel });
/** `count` distinct notes: 128 pitches per onset, a sixteenth apart, each a sixteenth long. */
const grid = (count) => Array.from({ length: count }, (_, i) => note(Math.floor(i / 128) * 0.25,
  i % 128, 0.25, 0.5));

/** The reference template with a Keys node and an event track targeting it. */
function setup() {
  const store = storeOf(templates.templateModel(templates.REFERENCE_TEMPLATE_ID));
  const keys = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'keys', position: { x: 0, y: 0 } }))
    .created.nodes[0];
  const track = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }))
    .created.tracks[0];
  return { store, keys, track };
}

const addNotes = (track, notes, extra = {}) => ({ type: 'CLIP_ADD', trackId: track, kind: 'notes',
  startBeats: 0, durationBeats: 4, payload: { notes }, ...extra });

/** Dispatch `action`: refused, with `pattern` in the reason, model and history unchanged. */
function refused(store, action, pattern, label) {
  const model = store.getModel();
  const depth = store.debugInfo().undoDepth;
  const revision = store.getRevision();
  const r = store.dispatch(action);
  assert.equal(r.ok, false, `${label}: refused`);
  assert.match(r.reason, pattern, `${label}: the reason`);
  assert.equal(store.getModel(), model, `${label}: the model is unchanged`);
  assert.equal(store.debugInfo().undoDepth, depth, `${label}: the history is unchanged`);
  assert.equal(store.getRevision(), revision, `${label}: the revision is unchanged`);
  return r;
}

test('K099 a notes clip on a Keys node validates, is tempo-linked and its notes are sorted', () => {
  assert.ok(schema.CLIP_KINDS.includes('notes'), 'CLIP_KINDS has notes');
  assert.ok(schema.TRACK_CLIP_KINDS.event.includes('notes'), 'an event track holds notes clips');
  assert.ok(!schema.TRACK_CLIP_KINDS.measurement.includes('notes'));
  const { store, track } = setup();
  const r = ok(store.dispatch(addNotes(track, [note(2, 67), note(0, 64), note(0, 60, 0.5, 1)])));
  const m = store.getModel();
  const clip = m.timeline.clips.find((c) => c.id === r.created.clips[0]);
  assert.deepEqual(clip.payload.notes, [note(0, 60, 0.5, 1), note(0, 64), note(2, 67)],
    'sorted by (at, note)');
  assert.deepEqual(clip.musical, { startBeats: 0, durationBeats: 4 }, 'tempo-linked by default');
  assert.equal(clip.duration, 2, '4 beats at 120 BPM');
  assert.ok(validate.validateStudioModel(m).ok);
  // normalizeStudio sorts a document's notes too.
  const doc = JSON.parse(schema.serializeStudio(m));
  doc.timeline.clips.find((c) => c.id === clip.id).payload.notes.reverse();
  assert.deepEqual(schema.normalizeStudio(doc).timeline.clips.find((c) => c.id === clip.id)
    .payload.notes, clip.payload.notes);
  // The XY pad and a voice engine play notes as well.
  for (const nodeType of ['xy-pad', 'fm-voice']) {
    const id = ok(store.dispatch({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }))
      .created.nodes[0];
    ok(store.dispatch(addNotes(track, [note(0, 60)], { target: id })));
  }
});

test('K099 a notes clip round-trips through the import pipeline and serializes identically', () => {
  const { store, track } = setup();
  const id = ok(store.dispatch(addNotes(track, [note(1, 62, 0.5, 0.25), note(0, 60)])))
    .created.clips[0];
  const m = store.getModel();
  const text = schema.serializeStudio(m);
  const imported = migrate.importStudio(text);
  assert.ok(imported.ok, JSON.stringify(imported.errors));
  assert.equal(schema.serializeStudio(imported.model), text, 'identical serialization');
  assert.equal(schema.studioHash(imported.model), schema.studioHash(m), 'identical studioHash');
  assert.ok(validate.validateStudioCommit(m).ok, 'the store may save it');
  // The notes are execution state: a velocity change changes the hash.
  const before = schema.studioHash(m);
  ok(store.dispatch({ type: 'CLIP_UPDATE', clipId: id,
    payload: { notes: [note(1, 62, 0.5, 0.3), note(0, 60)] } }));
  assert.notEqual(schema.studioHash(store.getModel()), before, 'vel is hashed');
  assert.ok(store.canUndo());
  store.undo();
  assert.equal(schema.studioHash(store.getModel()), before, 'undo restores the hash');
});

test('K099 every pinned template studioHash is unchanged', () => {
  for (const t of templates.STUDIO_TEMPLATES) {
    assert.equal(schema.studioHash(templates.templateModel(t.id)), t.studioHash, t.id);
  }
});

test('K099 bad notes are refused with their reason, model and history unchanged', () => {
  const { store, track } = setup();
  const cases = [
    ['note 128', [note(0, 128)], /note must be an integer MIDI note number from 0 to 127/],
    ['note -1', [note(0, -1)], /note must be an integer MIDI note number from 0 to 127/],
    ['note 1.5', [note(0, 1.5)], /note must be an integer MIDI note number/],
    ['note 60.5', [note(0, 60.5)], /note must be an integer MIDI note number/],
    ['vel 0', [note(0, 60, 1, 0)], /vel must be a number above 0 and at most 1/],
    ['vel 1.2', [note(0, 60, 1, 1.2)], /vel must be a number above 0 and at most 1/],
    ['len 0', [note(0, 60, 0)], /len must be a number of beats above 0/],
    ['at -1', [note(-1, 60)], /at must be a number of beats from the clip start, 0 or more/],
    ['past the clip end', [note(3.5, 60, 1)],
      /ends at beat 4\.5, after the end of the clip at beat 4/],
    ['unknown field q', [{ ...note(0, 60), q: 0.5 }], /unknown field "q"; a note is .* with an /],
    ['duplicate (at, note)', [note(0, 60), note(0, 60, 2)], /repeats note 60 at beat 0/],
  ];
  for (const [label, notes, pattern] of cases) {
    refused(store, addNotes(track, notes), pattern, label);
  }
  refused(store, { ...addNotes(track, [note(0, 60)]), payload: { notes: [note(0, 60)],
    steps: 16 } }, /payload holds its notes and an optional grid; "steps"/,
  'unknown payload field');
  refused(store, addNotes(track, [note(0, 60)], { timeBase: 'absolute', start: 0, duration: 2,
    startBeats: undefined, durationBeats: undefined }), /must be tempo-linked/, 'absolute clip');
  // The same rules hold for an edit of an existing clip.
  const id = ok(store.dispatch(addNotes(track, [note(0, 60)]))).created.clips[0];
  refused(store, { type: 'CLIP_UPDATE', clipId: id, payload: { notes: [note(0, 128)] } },
    /note must be an integer/, 'CLIP_UPDATE note 128');
  refused(store, { type: 'CLIP_RESIZE', clipId: id, duration: 0.25 }, /after the end of the clip/,
    'a resize that cuts a note');
  refused(store, { type: 'CLIP_SET_TIME_BASE', clipId: id, timeBase: 'absolute' },
    /must be tempo-linked/, 'unlink from tempo');
});

test('K099 a notes clip targets only a node that plays notes, on an event track', () => {
  const { store, track } = setup();
  refused(store, addNotes(track, [note(0, 60)], { target: 'filter-1' }),
    /^A notes clip needs a target that plays notes .*; a Filter node does not play notes\.$/,
    'a Filter target');
  refused(store, addNotes(track, [note(0, 60)], { target: 'osc-1' }),
    /; an Oscillator node does not play notes\.$/,
    'an Oscillator target');
  const oscTrack = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: 'osc-1' }))
    .created.tracks[0];
  refused(store, addNotes(oscTrack, [note(0, 60)]), /does not play notes/,
    'an Oscillator track target');
  const mt = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'measurement' })).created.tracks[0];
  refused(store, addNotes(mt, [note(0, 60)]), /^A notes clip cannot go on a measurement track\.$/,
    'a measurement track');
  // The import refuses the same with the same sentence.
  const m = store.getModel();
  const doc = JSON.parse(schema.serializeStudio(m));
  doc.timeline.clips.push({ id: 'clip-notes-x', trackId: track, kind: 'notes', start: 0,
    duration: 2, target: 'filter-1', musical: { startBeats: 0, durationBeats: 4 },
    payload: { notes: [note(0, 60)] } });
  const r = migrate.importStudio(JSON.stringify(doc));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /a Filter node does not play notes/);
});

test('K099 the import limits: notesPerClip and notesPerDocument', () => {
  const L = validate.STUDIO_IMPORT_LIMITS;
  assert.equal(L.notesPerClip, 4096);
  assert.equal(L.notesPerDocument, 65536);
  const { store, track } = setup();
  // A clip at the limit is kept; one note more is refused, with the limit in the reason.
  ok(store.dispatch(addNotes(track, grid(L.notesPerClip), { durationBeats: 16 })));
  refused(store, addNotes(track, grid(L.notesPerClip + 1), { durationBeats: 16 }),
    /more than 4096 notes in one clip \(import limit\)/, 'over notesPerClip');
  // The import refuses a clip over the limit before it normalizes anything.
  const doc = JSON.parse(schema.serializeStudio(store.getModel()));
  const big = doc.timeline.clips.at(-1);
  big.payload.notes = grid(L.notesPerClip + 1);
  const r = migrate.importStudio(JSON.stringify(doc));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'limit-exceeded');
  assert.match(r.errors[0].message, /more than 4096 notes in one clip/);
});

test('K099 a Studio over notesPerDocument is refused by the store and the import', () => {
  const L = validate.STUDIO_IMPORT_LIMITS;
  const { store, track } = setup();
  const per = L.notesPerClip;
  const full = L.notesPerDocument / per; // 16 full clips: exactly the limit
  const doc = JSON.parse(schema.serializeStudio(store.getModel()));
  for (let i = 0; i < full; i += 1) {
    doc.timeline.clips.push({ id: `clip-full-${i}`, trackId: track, kind: 'notes', start: i * 4,
      duration: 4, target: null, musical: { startBeats: i * 8, durationBeats: 8 },
      payload: { notes: grid(per) } });
  }
  const atLimit = migrate.importStudio(JSON.stringify(doc));
  assert.ok(atLimit.ok, JSON.stringify(atLimit.errors));
  const s = storeOf(atLimit.model);
  refused(s, addNotes(track, [note(0, 60)]), /more than 65536 notes in one Studio \(import limit\)/,
    'over notesPerDocument');
  doc.timeline.clips.push({ id: 'clip-over', trackId: track, kind: 'notes', start: 0, duration: 2,
    target: null, musical: { startBeats: 0, durationBeats: 4 },
    payload: { notes: [note(0, 60)] } });
  const over = migrate.importStudio(JSON.stringify(doc));
  assert.equal(over.ok, false);
  assert.equal(over.errors[0].code, 'limit-exceeded');
  assert.match(over.errors[0].message, /more than 65536 notes in one Studio/);
});

test('K099 a notes clip plays on a Keys node; on an XY pad it is reported kept, not played', () => {
  const { store, track } = setup();
  const onKeys = ok(store.dispatch(addNotes(track, [note(0, 60)]))).created.clips[0];
  const keysClip = store.getModel().timeline.clips.find((c) => c.id === onKeys);
  assert.equal(transportModule.clipPlayReason(store.getModel(), keysClip), null, 'Keys plays it');
  const pad = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'xy-pad', position: { x: 0, y: 0 } }))
    .created.nodes[0];
  const padTrack = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: pad }))
    .created.tracks[0];
  const id = ok(store.dispatch(addNotes(padTrack, [note(0, 60)]))).created.clips[0];
  const m = store.getModel();
  const clip = m.timeline.clips.find((c) => c.id === id);
  const why = transportModule.clipPlayReason(m, clip);
  assert.match(why, /^Notes clips play on a Keys node; this clip on .+ is kept but not played\.$/);
  const plan = offline.planOfflineRender(m);
  const row = plan.clips.find((c) => c.id === id);
  assert.deepEqual([row.kind, row.rendered, row.reason], ['notes', false, why]);
  assert.ok(plan.limitations.includes(`Clip ${id}: ${why}`), 'a stated limitation');
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store });
  ok(transport.start());
  const un = transport.debugInfo().unplayed.find((u) => u.id === id);
  assert.deepEqual(un && [un.code, un.reason], ['notes-unplayed', why], 'debugInfo().unplayed');
  transport.stop({ fast: true });
});

test('K099 the clip form shows a notes clip read-only, with no Action list', () => {
  const { store, track, keys } = setup();
  const id = ok(store.dispatch(addNotes(track, [note(0, 60), note(1, 62)]))).created.clips[0];
  const m = store.getModel();
  const clip = m.timeline.clips.find((c) => c.id === id);
  const o = timelineView.clipFormOptions(m, clip);
  assert.deepEqual(o.actions, [], 'no Action choices for a notes clip');
  assert.equal(o.notes, 'Notes clip · 2 notes. The notes play on a Keys node; editing them '
    + 'arrives with the piano roll.');
  assert.equal(o.notes, timelineView.NOTES_CLIP_TEXT.line(2));
  assert.deepEqual(o.tracks.map((t) => t.id), [track], 'its own track; it plays on no other');
  assert.deepEqual(o.targets.map((t) => t.id), ['', keys], 'the Keys node, where it plays (K068)');
  assert.deepEqual(timelineView.clipText(clip), { label: 'Notes', detail: '2 notes' });
  // Every other kind keeps its choices and has no notes line.
  const pattern = m.timeline.clips.find((c) => c.kind === 'pattern');
  const po = timelineView.clipFormOptions(m, pattern);
  assert.ok(po.actions.length > 0);
  assert.equal(po.notes, null);
  // The placement fields still work: a move by start is one undoable dispatch.
  ok(store.dispatch({ type: 'CLIP_MOVE', clipId: id, start: 1 }));
  const moved = store.getModel().timeline.clips.find((c) => c.id === id);
  assert.deepEqual([moved.start, moved.musical.startBeats], [1, 2], 'moved, relinked to beats');
});
