// B3: the riff library (src/js/studio/riffs/). Every riff is original and says so; it names a
// genre and an era, never an artist or a song; it is monophonic, inside its bars and in its
// role's range; Insert lands it in the StudioModel as one undoable batch of tempo-linked tone
// clips on an event track, refuses any other track, and toNotes gives the piano roll's payload.
//
//   node --test tests/unit/riff-library.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
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
    // The owner's library decisions (Q079-Q082): original only, MIT as the code, the method
    // recorded, symbolic only (notes, no audio).
    assert.equal(r.licence, 'MIT', `${r.id} licence`);
    assert.equal(r.author, 'OSCILLA', `${r.id} author`);
    assert.ok(lib.METHODS.includes(r.method), `${r.id} method`);
    assert.ok(Array.isArray(r.notes) && !('audio' in r), `${r.id} is symbolic`);
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

test('Insert with its voice adds Oscillator, Filter, wiring, track and clips as one step', () => {
  for (const id of [REFERENCE_TEMPLATE_ID, 'demo-song', 'subtractive-synth']) {
    const start = templateModel(id);
    const store = createStudioStore(start, { idGenerator: createIdGenerator(start) });
    const riff = lib.riffOf('mirrorball-octaves');
    const m0 = store.getModel();
    const twice = [];
    for (let k = 0; k < 2; k++) {
      const res = ex.riffVoiceAction(store.getModel(), riff, { atBeats: 4 });
      assert.ok(res.action, res.reason);
      const r = store.dispatch(res.action);
      assert.equal(r.ok, true, `${id}: ${r.reason}`);
      twice.push(res.action.steps.find((s) => s.type === 'TRACK_ADD').id);
    }
    assert.notEqual(twice[0], twice[1], 'a second insert takes free ids');
    const m = store.getModel();
    const track = m.timeline.tracks.find((t) => t.id === twice[0]);
    const osc = m.graph.nodes.find((n) => n.id === track.target);
    assert.equal(osc.type, 'oscillator');
    assert.equal(osc.params.waveform, riff.voice.waveform);
    const filter = m.graph.nodes.find((n) => m.graph.edges.some((e) => e.from.node === osc.id
      && e.to.node === n.id));
    assert.equal(filter.type, 'filter');
    assert.equal(filter.params.frequency, riff.voice.cutoff);
    const master = m.graph.nodes.find((n) => n.type === 'master');
    const reach = new Set([filter.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of m.graph.edges) {
        if (reach.has(e.from.node) && !reach.has(e.to.node)) grew = reach.add(e.to.node);
      }
    }
    assert.ok(reach.has(master.id), `${id}: the riff's filter reaches the Master Output`);
    assert.equal(m.graph.edges.filter((e) => e.to.node === master.id).length, 1);
    for (const n of m0.graph.nodes) {
      assert.ok(m.graph.nodes.some((x) => x.id === n.id), `${id}: ${n.id} kept`);
    }
    assert.equal(m.timeline.clips.filter((c) => c.trackId === track.id).length,
      riff.notes.length);
    const plan = compileStudio(m);
    assert.equal(plan.ok, true, `${id}: ${JSON.stringify(plan.errors)}`);
    store.undo();
    store.undo();
    assert.deepEqual(store.getModel().graph, m0.graph, `${id}: two Undos remove both`);
    assert.deepEqual(store.getModel().timeline, m0.timeline);
  }
});

// The riffs in the one patch library (K102): a category of studio/patch-catalog.js, listed
// with the role and the genre as tags, the style said beside the name, Insert only (a riff
// has no parameters to apply), never shown as in use, and each Insert is riffVoiceAction.
test('the patch library lists every riff as an Insert of its own voice', async () => {
  const src = await import('../../src/js/studio/riffs/source.js').catch(() => ({}));
  const cat = await import('../../src/js/studio/patch-catalog.js');
  assert.equal(typeof src.registerRiffSource, 'function');
  src.registerRiffSource();
  src.registerRiffSource(); // idempotent
  const model = templateModel('demo-song');
  const entries = cat.catalogEntries({ model }).filter((e) => e.instrument === 'riffs');
  assert.equal(entries.length, lib.RIFFS.length, 'one entry per riff, registered once');
  const view = cat.browseView(cat.catalogEntries({ model }), model, { instrument: 'riffs' });
  assert.equal(view.items.length, lib.RIFFS.length);
  for (const r of lib.RIFFS) {
    const e = view.items.find((x) => x.id === `riff-${r.id}`);
    assert.ok(e, r.id);
    assert.equal(e.name, r.title);
    assert.deepEqual(e.modes, ['insert']);
    assert.ok(e.tags.includes('riffs') && e.tags.includes(r.role) && e.tags.includes(r.genre));
    assert.ok(e.detail.startsWith(r.style) && e.detail.includes(`${r.tempo} BPM`), e.detail);
    assert.equal(e.inUse, false, `${r.id} is never "in use"`);
  }
  assert.ok(view.tags.some((t) => t.id === 'bass') && view.tags.some((t) => t.id === 'disco'));
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const e = view.items.find((x) => x.id === 'riff-mirrorball-octaves');
  const res = cat.entryAction(store.getModel(), e, 'insert');
  assert.equal(res.action.type, 'BATCH');
  assert.deepEqual(res.action,
    ex.riffVoiceAction(store.getModel(), lib.riffOf('mirrorball-octaves')).action);
  assert.equal(store.dispatch(res.action).ok, true);
  assert.match(cat.entryAction(store.getModel(), e, 'apply').reason, /cannot be loaded/);
  const bare = { ...model, graph: { ...model.graph, nodes: model.graph.nodes
    .filter((n) => n.type !== 'master'), edges: [] } };
  assert.match(cat.entryAction(bare, e, 'insert').reason, /Master Output/);
});
