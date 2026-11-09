// K068, the two P3 findings of the #474 pre-read (reviewer seat, 2026-11-09):
//   1. a Keys node the runtime rebuilds while a notes clip plays starts at pitch 0: the
//      transport's afterApply re-runs a replaced clocked node's steps (rebuildClock) but not the
//      notes' pitches, so the sounding note's pitch is lost until the next onset;
//   2. the Keys adapter kept its velocity steps by COUNT (the last 16) and its pitch schedule by
//      count (the last 8), so with dense ratchets scheduled ahead, a hold (STOP, an edit) at a
//      time before the kept window read a later note's pitch and velocity. They are now kept by
//      the audio clock: every step not yet past, and the last one before.
// Asserted on the real AudioEngine, runtime and transport over StudioFakeContext (one virtual
// clock), as tests/unit/studio-steps-playback.test.mjs.
//   node --test tests/unit/studio-notes-hold.test.mjs
// Fails on 5489ac34 (#474 with main merged in): (1) the rebuilt Keys node never steps to the
// sounding note; (2) the STOP hold reads note 3's pitch and note 2's velocity inside note 1.
// The prune case fails on a336fea6: the removed Keys node's last record stays (1, not 0).

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000; // the fake context's rate; every figure below reads ctx.sampleRate
const oct = (note) => (note - 69) / 12;
const n = (at, note, len, vel, extra = {}) => ({ at, note, len, vel, ...extra });
const r9 = (x) => Number(x.toFixed(9));
const ok = (r, what = '') => {
  assert.ok(r.ok, `${what}${what ? ': ' : ''}${r.reason || JSON.stringify(r.errors)}`);
  return r;
};

/** Keys -> VCO -> Envelope -> Master, the Keys Gate on the Envelope, one notes clip, PLAYing. */
function playing(notes, { lookAheadS = null, beats = 4 } = {}) {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const add = (nodeType) => ok(st.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }), nodeType).created.nodes[0];
  const keys = add('keys');
  const vco = add('vco');
  const env = add('envelope');
  const out = add('master');
  ok(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: keys, params: { glide: 0 } }), 'keys');
  const edge = (from, to, props) => ok(st.dispatch({ type: 'EDGE_ADD', from, to, props }),
    `${from.node}.${from.port}`);
  edge({ node: keys, port: 'pitch' }, { node: vco, port: 'pitch' },
    { depth: 6, polarity: 'bipolar', mapping: 'linear' });
  edge({ node: keys, port: 'gate' }, { node: env, port: 'gate' });
  edge({ node: vco, port: 'audio' }, { node: env, port: 'audio' });
  edge({ node: env, port: 'audio' }, { node: out, port: 'audio' });
  const trackId = ok(st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }), 'track')
    .created.tracks[0];
  ok(st.dispatch({ type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0, durationBeats: beats,
    payload: { notes } }), 'notes clip');
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
    lookAheadS });
  const started = ok(transport.start(), 'PLAY');
  return { st, keys, env, fx, engine, runtime, transport, base: started.baseTime };
}

/** The last value `param` was set to at or before t, as its events record it. */
const setAt = (param, t) => {
  const list = param.events.filter((e) => e.ramp === 'set' && e.t <= t + 1e-9);
  return list.length ? list[list.length - 1] : null;
};

test('K068 a Keys node the runtime rebuilds mid-note takes the sounding note\'s pitch at once',
  async () => {
    // One long note (2 beats = 1 s at 120 BPM) and a later one; the rebuild lands inside the
    // first, so the rebuilt node must sound note 60 from the horizon, not 0 until note 64.
    const rig = playing([n(0, 60, 2, 0.8), n(3, 64, 0.5, 0.8)]);
    rig.fx.advance(0.3);
    const old = rig.runtime.nodes.get(rig.keys);
    // Rebuild the Keys node in the runtime (the forced node-replace a reopened input takes),
    // then an ordinary edit, which the transport syncs and follows with afterApply.
    const model = rig.st.getModel();
    ok(rig.runtime.apply(model, { revision: rig.st.debugInfo().revision,
      replace: new Set([rig.keys]) }), 'forced rebuild');
    const fresh = rig.runtime.nodes.get(rig.keys);
    assert.notEqual(fresh, old, 'the runtime built a new Keys node');
    ok(rig.st.dispatch({ type: 'NODE_PARAM_SET', nodeId: rig.env, params: { sustain: 0.6 } }),
      'an edit while playing');
    ok(rig.transport.sync(), 'the transport follows the edit');
    const now = rig.fx.ctx.currentTime;
    const pitch = fresh.outputs.pitch.offset;
    const step = pitch.events.find((e) => e.ramp === 'set' && r9(e.value) === r9(oct(60)));
    assert.ok(step, `the rebuilt Keys node steps to note 60 (events ${JSON.stringify(
      pitch.events.map((e) => [e.ramp, r9(e.value), r9(e.t)]))})`);
    assert.ok(step.t >= now - 1e-9 && step.t < now + 0.2,
      `at the edit's horizon (${r9(step.t)} s, now ${r9(now)} s), ahead of the clock`);
    rig.fx.advance(0.2);
    assert.equal(r9(setAt(pitch, rig.fx.ctx.currentTime).value), r9(oct(60)),
      'the rebuilt node holds note 60 until note 64');
    const vel = setAt(fresh.outputs.velocity.offset, rig.fx.ctx.currentTime);
    assert.ok(vel && vel.value > 0.5, 'and its velocity');
    const p = rig.transport.stop();
    rig.fx.advance(1);
    await p;
    assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
  });

test('K068 STOP inside a dense ratchet holds that note\'s pitch and velocity, however many '
  + 'onsets were scheduled after it', async () => {
    // 3 notes x 8 ratchet onsets = 24 pitch and velocity steps, all scheduled at PLAY by a
    // look-ahead longer than the clip: more than the 16 velocity steps and the 8 pitch segments
    // the adapter once kept, so a count-trimmed record had lost note 1 before STOP.
    const notes = [n(0, 60, 1, 0.8, { r: 8 }), n(1, 72, 1, 0.5, { r: 8 }),
      n(2, 64, 1, 0.25, { r: 8 })];
    const rig = playing(notes, { lookAheadS: 3 });
    const kh = rig.runtime.nodes.get(rig.keys);
    const pitch = kh.outputs.pitch.offset;
    const velocity = kh.outputs.velocity.offset;
    const first = velocity.events.find((e) => e.ramp === 'set' && e.t >= rig.base - 1e-9
      && e.value > 0);
    assert.ok(first, 'note 1 set its velocity');
    const v1 = first.value;
    assert.equal(kh.noteState().onsets.length, 16, 'the debugInfo onset log stays 16 long');
    rig.fx.advance(0.1); // inside note 1 (0 .. 0.5 s)
    const [pc, vc] = [pitch.calls.length, velocity.calls.length];
    const p = rig.transport.stop();
    // The hold STOP writes: a cancel at t, then a step to the value the param has at t.
    const hold = (calls) => {
      const i = calls.findIndex((c) => c[0] === 'cancelScheduledValues');
      const set = calls.slice(i + 1).find((c) => c[0] === 'setValueAtTime');
      return i < 0 || !set ? null : { at: calls[i][1], value: set[1], t: set[2] };
    };
    const ph = hold(pitch.calls.slice(pc));
    const vh = hold(velocity.calls.slice(vc));
    assert.ok(ph && vh, 'STOP holds the Keys pitch and velocity');
    assert.ok(ph.t >= rig.fx.ctx.currentTime - 1e-9 && ph.t < rig.base + 0.5,
      `the hold lands inside note 1 (${r9(ph.t - rig.base)} s after PLAY)`);
    assert.equal(r9(ph.value), r9(oct(60)), `the pitch holds note 60 at ${r9(ph.t)} s`);
    assert.equal(r9(vh.value), r9(v1), 'the velocity holds note 1\'s');
    rig.fx.advance(1);
    await p;
    assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
  });

test('K068 prune keeps each present node\'s last note in one pass, and forgets a removed '
  + 'node\'s', async () => {
    // The pre-read's follow-up (P3): prune ran lastBefore once per record (O(n^2) per wake-up),
    // and the last record of a node removed from the graph stayed until clear(). Through the
    // transport: 64 ratchet onsets on one Keys node, then the node removed while playing.
    const notes = Array.from({ length: 8 }, (_, i) => n(i * 0.5, 60 + i, 0.5, 0.8, { r: 8 }));
    // A 64-beat clip (32 s) keeps the transport playing; its notes all lie in the first 2 s.
    const rig = playing(notes, { beats: 64 });
    rig.fx.advance(2.2); // past every onset
    assert.equal(rig.transport.debugInfo().noteCount, 64, 'one record per onset');
    rig.fx.advance(10.5); // every onset older than GATE_KEEP_S
    assert.equal(rig.transport.debugInfo().noteCount, 1, 'the Keys node keeps its last note');
    ok(rig.st.dispatch({ type: 'NODE_REMOVE', nodeId: rig.keys }), 'remove the Keys node');
    rig.transport.sync();
    rig.fx.advance(1); // the next wake-up prunes
    assert.ok(rig.transport.debugInfo().playing, 'still playing');
    assert.equal(rig.transport.debugInfo().noteCount, 0, 'a removed node keeps no record');
    const p = rig.transport.stop();
    rig.fx.advance(1);
    await p;
  });
