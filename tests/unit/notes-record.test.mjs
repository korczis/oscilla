// K223 (M066): Record writes live hits into a notes clip at the audio-clock playhead, quantised
// to the clip's grid, one undoable CLIP_UPDATE per take (studio/notes-record.js). The pure half
// (quantise, takeNotes, takeAction) and the recorder on the real AudioEngine, runtime and
// transport over StudioFakeContext: the transport emits each live note with the timeline's
// playhead at its own audio time, and a take ends at disarm or at a stop.
//   node --test tests/unit/notes-record.test.mjs
// Fails on 44a1ca6a (K222): there is no studio/notes-record.js, and the transport emits no 'live'
// event. Loaded so that each test fails on its own assertion while the module is missing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const rec = await import('../../src/js/studio/notes-record.js').catch(() => ({}));

const SR = 48000;
const ok = (r, what = '') => {
  assert.ok(r && r.ok, `${what}${what ? ': ' : ''}${r && (r.reason || JSON.stringify(r.errors))}`);
  return r;
};

/** A percussion engine into the Master Output and a one-bar notes clip with a 1/16 grid. */
function kit(notes = []) {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const add = (nodeType) => ok(st.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }), nodeType).created.nodes[0];
  const perc = add('perc-voice');
  const out = add('master');
  ok(st.dispatch({ type: 'EDGE_ADD', from: { node: perc, port: 'audio' },
    to: { node: out, port: 'audio' } }), 'perc -> master');
  const trackId = ok(st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: perc }), 'track')
    .created.tracks[0];
  const clip = ok(st.dispatch({ type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0,
    durationBeats: 4, payload: { notes, grid: { stepBeats: 0.25, swing: 0, seed: 1 } } }),
  'notes clip').created.clips[0];
  return { st, perc, clip };
}

const clipOf = (st, id) => st.getModel().timeline.clips.find((c) => c.id === id);

// ---------------------------------------------------------------- the pure half

test('K223 quantise: exact, early, late and halfway hits go to the nearest step, a tie later',
  () => {
    assert.equal(typeof rec.quantise, 'function', 'notes-record.js exports quantise');
    assert.equal(rec.quantise(1.25, 0.25), 1.25, 'exact');
    assert.equal(rec.quantise(1.2, 0.25), 1.25, 'early, nearer the step');
    assert.equal(rec.quantise(1.3, 0.25), 1.25, 'late, nearer the step');
    assert.equal(rec.quantise(1.125, 0.25), 1.25, 'exactly halfway goes to the later step');
    assert.equal(rec.quantise(1.124, 0.25), 1, 'just before halfway stays on the earlier one');
  });

test('K223 a take of n hits is one CLIP_UPDATE with the n quantised notes, nothing else changed',
  () => {
    assert.equal(typeof rec.takeAction, 'function', 'notes-record.js exports takeAction');
    const { st, clip } = kit([{ at: 2, note: 64, len: 0.25, vel: 0.5 }]);
    const before = clipOf(st, clip);
    const a = rec.takeAction(st.getModel(), clip, [{ beat: 0.02, note: 60, velocity: 127 },
      { beat: 0.98, note: 62, velocity: 64 }, { beat: 3.1, note: 60, velocity: 100 }]);
    assert.equal(a.type, 'CLIP_UPDATE');
    assert.equal(a.clipId, clip);
    assert.deepEqual(a.payload.notes, [
      { at: 0, note: 60, len: 0.25, vel: 1 },
      { at: 1, note: 62, len: 0.25, vel: Number((64 / 127).toFixed(9)) },
      { at: 2, note: 64, len: 0.25, vel: 0.5 },
      { at: 3, note: 60, len: 0.25, vel: Number((100 / 127).toFixed(9)) }]);
    assert.deepEqual({ ...a.payload, notes: null }, { ...before.payload, notes: null },
      'the grid and every other field are kept');
    ok(st.dispatch(a), 'the store takes it');
  });

test('K223 a hit on a step already on keeps one note with the later velocity', () => {
  const { st, clip } = kit([{ at: 1, note: 60, len: 0.25, vel: 0.5 }]);
  const a = rec.takeAction(st.getModel(), clip, [{ beat: 1.05, note: 60, velocity: 127 },
    { beat: 0.97, note: 60, velocity: 32 }]);
  assert.deepEqual(a.payload.notes, [{ at: 1, note: 60, len: 0.25,
    vel: Number((32 / 127).toFixed(9)) }]);
});

test('K223 a hit past the clip\'s end on a loop pass is wrapped into the clip, never written '
  + 'beyond it', () => {
    const { st, clip } = kit();
    const a = rec.takeAction(st.getModel(), clip, [{ beat: 4.26, note: 60, velocity: 100 },
      { beat: 3.9, note: 62, velocity: 100 }]);
    assert.deepEqual(a.payload.notes.map((n) => [n.at, n.note]), [[0, 62], [0.25, 60]],
      'beat 4.26 wraps to 0.25; 3.9 rounds to 4, the clip\'s end, and wraps to its first step');
    assert.ok(a.payload.notes.every((n) => n.at < 4), 'nothing at or after the clip\'s length');
  });

test('K223 a take with no hit makes no action', () => {
  const { st, clip } = kit();
  assert.equal(rec.takeAction(st.getModel(), clip, []), null);
});

// ---------------------------------------------------------------- the recorder

function rigOf(st) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st });
  return { fx, engine, runtime, transport };
}

test('K223 Record while stopped is armed and writes nothing; a take while playing is one history '
  + 'entry that one undo removes', async () => {
    assert.equal(typeof rec.recorderOf, 'function', 'notes-record.js exports recorderOf');
    const { st, perc, clip } = kit();
    const rig = rigOf(st);
    const r = rec.recorderOf(rig.transport, st);
    assert.equal(rec.recorderOf(rig.transport, st), r, 'one recorder per transport');
    r.arm(clip);
    assert.equal(r.armed, true);
    // Armed but stopped: the keys play (K104), the timeline does not, nothing is recorded.
    ok(rig.transport.arm(), 'arm the keys');
    ok(rig.transport.live(perc, { kind: 'on', note: 60, velocity: 100 }), 'a hit while stopped');
    assert.equal(r.pending, 0, 'a hit while the timeline is stopped is not recorded');
    const depth0 = st.debugInfo().undoDepth;
    // Play: three hits at known audio times within the bar.
    const { baseTime } = ok(rig.transport.start(), 'PLAY');
    const at = (beat) => baseTime + beat * 0.5; // 120 BPM
    for (const [beat, note, velocity] of [[0.02, 60, 127], [1.1, 62, 100], [2.49, 64, 80]]) {
      ok(rig.transport.live(perc, { kind: 'on', note, velocity, at: at(beat) }), `hit ${beat}`);
      ok(rig.transport.live(perc, { kind: 'off', note, at: at(beat) + 0.05 }), `off ${beat}`);
    }
    assert.equal(r.pending, 3, 'three hits in the take');
    assert.equal(st.debugInfo().undoDepth, depth0, 'nothing is written during the take');
    // Stop ends the take: one CLIP_UPDATE, one history entry.
    const p = rig.transport.stop();
    rig.fx.advance(1);
    await p;
    assert.equal(st.debugInfo().undoDepth, depth0 + 1, 'the take is one history entry');
    assert.deepEqual(clipOf(st, clip).payload.notes.map((n) => [n.at, n.note, n.len]),
      [[0, 60, 0.25], [1, 62, 0.25], [2.5, 64, 0.25]], 'quantised to the 1/16 grid, one step');
    assert.equal(r.pending, 0);
    assert.equal(r.armed, true, 'Record stays armed for the next take');
    ok(st.undo(), 'undo');
    assert.deepEqual(clipOf(st, clip).payload.notes, [], 'one undo removes the whole take');
    // A take with no hit: no history entry.
    const depth1 = st.debugInfo().undoDepth;
    assert.equal(r.disarm(), null, 'disarm with no hit dispatches nothing');
    assert.equal(r.armed, false);
    assert.equal(st.debugInfo().undoDepth, depth1, 'no history entry');
  });

test('K223 the transport emits each live note with the timeline\'s playhead at its time', () => {
  const { st, perc } = kit();
  const rig = rigOf(st);
  const seen = [];
  rig.transport.on((type, d) => { if (type === 'live') seen.push(d); });
  const { baseTime } = ok(rig.transport.start(), 'PLAY');
  ok(rig.transport.live(perc, { kind: 'on', note: 60, velocity: 90, at: baseTime + 0.75 }), 'hit');
  assert.equal(seen.length, 1, 'one live event');
  assert.equal(seen[0].id, perc);
  assert.equal(seen[0].ev.note, 60);
  assert.ok(seen[0].ph && seen[0].ph.playing, 'with the timeline playhead');
  assert.ok(Math.abs(seen[0].ph.position - 0.75) < 1e-6, 'at the note\'s own time');
  rig.transport.stop({ fast: true });
});
