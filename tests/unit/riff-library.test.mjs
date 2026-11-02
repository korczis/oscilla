// B3: the riff library (src/js/studio/riffs/). Every riff is original and says so; it names a
// genre and an era, never an artist or a song; it is monophonic, inside its bars and in its
// role's range; Insert lands it in the StudioModel as one undoable batch of tempo-linked tone
// clips on an event track, refuses any other track, and toNotes gives the piano roll's payload.
//
//   node --test tests/unit/riff-library.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { midiOf, noteHz } from '../../src/js/studio/templates/demo-song-score.js';
import sweep from '../../src/js/studio/templates/sweep-sequence.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const lib = await import('../../src/js/studio/riffs/library.js').catch(() => ({}));
const ex = await import('../../src/js/studio/riffs/expand.js').catch(() => ({}));

/** MIDI ranges a role is written in: a bass from A0 to E3, a lead from C3 to C7, an arp from C2. */
const RANGE = { bass: [21, 52], lead: [48, 96], arp: [36, 96] };

test('the library holds original riffs, each named by a genre and an era', () => {
  assert.ok(Array.isArray(lib.RIFFS) && lib.RIFFS.length >= 12, 'at least 12 riffs');
  const ids = new Set();
  for (const r of lib.RIFFS) {
    assert.ok(!ids.has(r.id), `${r.id} is unique`);
    ids.add(r.id);
    assert.equal(r.origin, 'original', r.id);
    assert.equal(r.style, `Original, in the style of ${r.genre} (${r.era})`, r.id);
    assert.ok(r.title && r.genre && r.era && r.key, r.id);
    assert.ok(lib.ROLES.includes(r.role), `${r.id} role`);
    assert.ok(r.tempo >= 60 && r.tempo <= 180, `${r.id} tempo`);
    assert.ok([1, 2, 4].includes(r.bars), `${r.id} bars`);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.notes), `${r.id} is frozen`);
  }
  assert.ok(new Set(lib.RIFFS.map((r) => r.genre)).size >= 12, 'twelve genres or more');
});

test('every riff is monophonic, inside its bars and in its role\'s range', () => {
  for (const r of lib.RIFFS) {
    let end = 0;
    for (const [step, pitch, len, vel] of r.notes) {
      assert.ok(Number.isInteger(step) && step >= end, `${r.id}: step ${step} overlaps`);
      assert.ok(Number.isInteger(len) && len >= 1, `${r.id}: length at ${step}`);
      assert.ok(step + len <= r.bars * lib.BAR_STEPS, `${r.id}: ${step} runs past its bars`);
      assert.ok(vel >= 1 && vel <= 127, `${r.id}: velocity at ${step}`);
      const m = midiOf(pitch);
      assert.ok(m >= RANGE[r.role][0] && m <= RANGE[r.role][1], `${r.id}: ${pitch} out of range`);
      end = step + len;
    }
    assert.ok(r.notes.length >= 4, `${r.id} has a figure`);
  }
});

test('Insert lands a riff as one undoable batch of tempo-linked tone clips', () => {
  const store = createStudioStore(sweep.model, { idGenerator: createIdGenerator() });
  const riff = lib.riffOf('silver-squelch');
  const res = ex.riffAction(store.getModel(), riff, { trackId: 'track-1', atBeats: 8 });
  assert.ok(res.action, res.reason);
  const before = store.getModel().timeline.clips.length;
  assert.equal(store.dispatch(res.action).ok, true);
  const m = store.getModel();
  const added = m.timeline.clips.slice(before);
  assert.equal(added.length, riff.notes.length);
  const spb = 60 / m.transport.tempo;
  riff.notes.forEach(([step, pitch, len], i) => {
    const c = added[i];
    assert.equal(c.kind, 'pattern');
    assert.equal(c.trackId, 'track-1');
    assert.equal(c.payload.blockType, 'tone');
    assert.equal(c.payload.params.freq, noteHz(midiOf(pitch)));
    assert.deepEqual(c.musical, { startBeats: 8 + step / 4, durationBeats: len / 4 });
    assert.ok(Math.abs(c.start - (8 + step / 4) * spb) < 1e-6);
  });
  assert.equal(store.undoLabel(), `Insert riff ${riff.title}`);
  store.undo();
  assert.equal(store.getModel().timeline.clips.length, before, 'one Undo removes the riff');
});

test('Insert refuses a missing track, a track of another kind and a negative start', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const riff = lib.RIFFS[0];
  assert.match(ex.riffAction(m, riff, { trackId: 'nope' }).reason, /event track/);
  const other = m.timeline.tracks.find((t) => t.kind !== 'event');
  if (other) {
    assert.match(ex.riffAction(m, riff, { trackId: other.id }).reason, /goes on an event track/);
  }
  assert.match(ex.riffAction(sweep.model, riff, { trackId: 'track-1', atBeats: -1 }).reason,
    /0 or later/);
});

test('toNotes gives the piano roll payload: beats, MIDI numbers, velocity 0..1', () => {
  const riff = lib.riffOf('undertow');
  const { notes } = ex.toNotes(riff);
  assert.equal(notes.length, riff.notes.length);
  assert.deepEqual(notes[0], { at: 0, note: midiOf('D1'), len: 3, vel: Math.round(112 / 127
    * 1e6) / 1e6 });
  assert.ok(notes.every((n) => n.at + n.len <= ex.riffBeats(riff) && n.vel > 0 && n.vel <= 1));
});
