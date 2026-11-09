// K222 (ADR 0086 decisions 5 and 6): a notes clip plays on the percussion engine. A drum lane is
// a note number of the engine's key map, so the engine takes the clip's notes as it takes the
// keys' (note-on and note-off on its voice pool), on the audio clock, live and offline; an edit
// while playing is heard from its horizon on and Stop releases every voice (census 0).

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import { CLIP_TARGET_TEXT, clipTarget } from '../../src/js/studio/clip-targets.js';
import { createNotePlayer } from '../../src/js/studio/note-player.js';
import * as offline from '../../src/js/studio/offline.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000; // the fake context's rate; the checks read currentTime, never a frame count
const n = (at, note, len = 0.25, vel = 0.8) => ({ at, note, len, vel });
const ok = (r, what = '') => {
  assert.ok(r.ok, `${what}${what ? ': ' : ''}${r.reason || JSON.stringify(r.errors)}`);
  return r;
};

/** A percussion engine into the Master Output, a notes clip on its event track. */
function kit(notes, { beats = 4 } = {}) {
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
    durationBeats: beats, payload: { notes } }), 'notes clip').created.clips[0];
  return { st, perc, clip };
}

test('K222 the percussion engine plays a notes clip (engine-notes); other engines hold it',
  () => {
  const { st, perc, clip } = kit([n(0, 36)]);
  const m = st.getModel();
  const node = m.graph.nodes.find((x) => x.id === perc);
  const v = clipTarget(node, { kind: 'notes' }, NODE_REGISTRY);
  assert.deepEqual([v.holds, v.plays, v.how], [true, true, 'engine-notes']);
  const c = m.timeline.clips.find((x) => x.id === clip);
  assert.equal(transportModule.clipPlayReason(m, c), null, 'the transport plays it');
  // Another voice engine still holds a notes clip and says where notes clips play.
  const fm = { id: 'fm-1', type: 'fm-voice', params: {}, metadata: { name: 'FM engine' } };
  const held = clipTarget(fm, { kind: 'notes' }, NODE_REGISTRY);
  assert.deepEqual([held.holds, held.plays], [true, false]);
  assert.equal(held.reason, CLIP_TARGET_TEXT.notesUnplayed('FM engine'));
  assert.match(held.reason, /Keys/);
  assert.match(held.reason, /perkus/);
});

test('K222 the offline render plays the clip on the percussion engine, as live', () => {
  const { st, clip } = kit([n(0, 36), n(1, 38)]);
  const plan = offline.planOfflineRender(st.getModel());
  const row = plan.clips.find((c) => c.id === clip);
  assert.deepEqual([row.kind, row.rendered, row.reason], ['notes', true, null]);
  const node = plan.nodes.find((x) => x.type === 'perc-voice');
  assert.equal(node.role, 'rendered');
});

test('K222 PLAY sounds the clip\'s hits on the engine\'s voices; STOP leaves no voice', () => {
  const { st, perc } = kit([n(0, 36), n(0, 42), n(1, 38)]);
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
    lookAheadS: 3 });
  const started = ok(transport.start(), 'PLAY');
  const h = runtime.nodes.get(perc);
  assert.ok(h && typeof h.noteOn === 'function', 'the engine\'s runtime handle');
  // A kick and a closed hat at beat 0, a snare at beat 1 (0.5 s at 120 BPM).
  fx.advanceTo(started.baseTime + 0.01);
  assert.equal(h.info.voices(fx.ctx.currentTime), 2, 'two voices sound at beat 0');
  fx.advanceTo(started.baseTime + 0.51);
  assert.ok(h.info.voices(fx.ctx.currentTime) >= 1, 'the snare sounds at beat 1');
  assert.deepEqual(transport.debugInfo().unplayed, [], 'nothing unplayed');
  transport.stop({ fast: true });
  fx.advance(1);
  assert.equal(h.info.voices(fx.ctx.currentTime), 0, 'STOP leaves no voice');
  assert.equal(engine.activeSourceCount, 0, 'the engine source census is 0 after stop');
});

test('K222 the note player: engine notes on and off, an edit replays from its horizon', () => {
  const calls = [];
  const handle = {
    noteOn: (t, note, vel) => { calls.push(['on', t, note, vel]); return { slot: 0 }; },
    noteOff: (t, note) => { calls.push(['off', t, note]); return true; },
    allOff: (t, fast) => { calls.push(['all', t, fast]); return 0; },
    cancelFrom: (t) => { calls.push(['cancel', t]); return 0; },
  };
  const node = { id: 'perc-1', type: 'perc-voice', params: {}, metadata: { name: 'Bicí' } };
  const model = { graph: { nodes: [node], edges: [] }, timeline: { clips: [] } };
  const played = [];
  const player = createNotePlayer({ getModel: () => model, ready: () => handle,
    gate: () => assert.fail('an engine note opens no Envelope gate'),
    clock: () => assert.fail('nor a clock'), played: (it, code) => played.push(code),
    warn: () => {} });
  const item = (key, startTime, endTime, note) => ({ key, target: 'perc-1', clipId: 'c',
    startTime, endTime, note, velocity: 101, gate: true, slide: false });
  player.play(item('a', 1, 1.1, 36));
  player.play(item('b', 2, 2.1, 38));
  assert.deepEqual(played, [null, null]);
  assert.deepEqual(calls, [['on', 1, 36, 101], ['off', 1.1, 36], ['on', 2, 38, 101],
    ['off', 2.1, 38]]);
  // An edit at horizon 1.5: the voices scheduled from there are dropped (one sounding rings
  // on, C1-K222-5) and the notes still due struck again.
  calls.length = 0;
  player.rebuild('perc-1', 1.5);
  assert.deepEqual(calls, [['cancel', 1.5], ['on', 2, 38, 101], ['off', 2.1, 38]]);
  // A cancelled note is not replayed; STOP (cancel, then rebuild at the stop) releases all.
  calls.length = 0;
  const touched = new Set();
  player.cancel('b', touched);
  assert.deepEqual([...touched], ['perc-1']);
  player.rebuild('perc-1', 1.6, true);
  assert.deepEqual(calls, [['all', 1.6, true]], 'STOP releases every voice (allOff)');
  const all = new Set();
  player.touch(all);
  assert.deepEqual([...all], ['perc-1'], 'its node is touched by STOP');
});

test('K222 Add clip on a percussion track makes an empty one-bar notes clip that plays',
  async () => {
  const timelineView = await import('../../src/js/ui/studio/timeline-view.js');
  const { st } = kit([]);
  const m = st.getModel();
  const track = m.timeline.tracks.find((t) => m.graph.nodes.find((x) => x.id === t.target
    && x.type === 'perc-voice'));
  const res = timelineView.addClipAction(m, track.id, 4);
  assert.equal(res.reason, undefined);
  assert.deepEqual(res.action, { type: 'CLIP_ADD', trackId: track.id, kind: 'notes',
    startBeats: 8, durationBeats: 4, payload: { notes: [] } });
  const id = ok(st.dispatch(res.action), 'add clip').created.clips[0];
  const clip = st.getModel().timeline.clips.find((c) => c.id === id);
  assert.equal(transportModule.clipPlayReason(st.getModel(), clip), null);
});

test('C1-K222-5: an edit while playing leaves ringing hits and strikes due ones once',
  () => {
    // A kick at beat 2.5 (1.25 s at 120 BPM) rings to 1.75 s; a snare is due at beat 3
    // (1.5 s), on a slot of its own (the pool assigns slots when a hit is scheduled).
    const { st, perc, clip } = kit([n(2.5, 60), n(3, 62)]);
    const fx = createFakeAudioEnv({ sampleRate: SR });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init(), 'engine.init');
    if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
    const runtime = createStudioRuntime({ engine });
    const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
      lookAheadS: 3 });
    const base = ok(transport.start(), 'PLAY').baseTime;
    const h = runtime.nodes.get(perc);
    fx.advanceTo(base + 1.3);
    const kick = () => h.info.hits().filter((x) => x.note === 60);
    assert.equal(kick().length, 1, 'the kick was struck');
    assert.equal(kick()[0].released, null, 'and rings at 1.3 s');
    // An edit while playing: a step added at beat 3.25 (1.625 s), past the horizon, while the
    // kick still holds its slot (a slot is reused from its voice's end, at scheduling).
    const notes = st.getModel().timeline.clips.find((c) => c.id === clip).payload.notes;
    ok(st.dispatch({ type: 'CLIP_UPDATE', clipId: clip, payload: { notes: [...notes,
      n(3.25, 61)] } }), 'an edit while playing');
    ok(transport.sync(), 'the transport follows the edit');
    fx.advanceTo(base + 1.35);
    assert.equal(kick().length, 1, 'the kick still rings after the edit (an allOff cut it)');
    assert.equal(kick()[0].released, null, 'unreleased');
    assert.ok(kick()[0].end > fx.ctx.currentTime, 'its decay is not cut');
    // The snare due at 1.5 s: exactly one voice will sound it (a dropped one is released
    // before its onset), and the added clap at 1.625 s is struck once too.
    const due = (note) => h.info.hits().filter((x) => x.note === note && x.end > x.start);
    assert.equal(due(62).length, 1, 'the snare sounds once, not twice');
    assert.equal(due(61).length, 1, 'the added step is struck');
    transport.stop({ fast: true });
  });

test('C1-K222-5: an edit drops a scheduled hit that a later hit displaced from its slot, so no '
  + 'hit sounds twice', () => {
    // Two kicks on one slot: the second (beat 3.75, 1.875 s) is scheduled after the first one
    // (beat 2.5) has ended, so the pool gives it the same slot and it displaces the first from
    // the host's slot map at PLAY, before either has started. An edit before both must drop
    // both scheduled voices, the displaced one included, before it strikes them again.
    const { st, perc, clip } = kit([n(2.5, 60), n(3, 62), n(3.75, 60)]);
    const fx = createFakeAudioEnv({ sampleRate: SR });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init(), 'engine.init');
    if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
    const runtime = createStudioRuntime({ engine });
    const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
      lookAheadS: 3 });
    const base = ok(transport.start(), 'PLAY').baseTime;
    const h = runtime.nodes.get(perc);
    fx.advanceTo(base + 0.5);
    const notes = st.getModel().timeline.clips.find((c) => c.id === clip).payload.notes;
    ok(st.dispatch({ type: 'CLIP_UPDATE', clipId: clip, payload: { notes: [...notes,
      n(3.5, 61)] } }), 'an edit before every hit');
    ok(transport.sync(), 'the transport follows the edit');
    // A voice sounds iff its end lies after its onset (a cancelled one ends before it starts;
    // `released` is also set on a voice a later one displaced, without cutting it).
    const sounding = (note, beat) => h.info.hits().filter((x) => x.note === note
      && x.end > x.start && Math.abs(x.start - (base + beat * 0.5)) < 0.01);
    assert.equal(sounding(60, 2.5).length, 1, 'the first kick sounds once');
    assert.equal(sounding(62, 3).length, 1, 'the snare sounds once');
    assert.equal(sounding(60, 3.75).length, 1, 'the second kick sounds once');
    assert.equal(sounding(61, 3.5).length, 1, 'the added clap is struck');
    transport.stop({ fast: true });
  });
