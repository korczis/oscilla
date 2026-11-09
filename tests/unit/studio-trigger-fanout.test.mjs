// K103 (M064): gates along TRIGGER edges from any gate or trigger output, live and scheduled, with
// one ownership rule. One fan-out (studio/trigger-fanout.js) serves the transport (pattern clips,
// Clocks, trigger clips, notes clips and gate clips on a Keys node) and the live note router
// (studio/live-notes.js, the Synth panel and the Studio keys): from any TRIGGER output (a Keys or
// XY pad Gate, a Clock, a Sequence or Step Modulator Trigger) to every TRIGGER input it reaches
// (an Envelope's Gate, a Random's or Step Modulator's Clock), through each Step Modulator's own
// Trigger relay (K023). The ownership rule: while the transport plays the timeline, a gate input
// that a clip-driven source reaches belongs to the timeline, and a live gate on it is refused
// with its reason and gates nothing there; while stopped (armed), live gates own every input.
// Asserted on the real AudioEngine, runtime and transport over StudioFakeContext
// (tests/unit/sequencer-fake-audio.mjs).
//   node --test tests/unit/studio-trigger-fanout.test.mjs
// Fails on 08cd77a2 (the T3 head): a Keys gate stops at its first hop, scheduled and live (no Step
// relay), a gate clip on a Keys node gates Envelopes only (a Random it clocks takes no tick), and a
// live gate on a timeline-owned Envelope opens it while the timeline plays, with no reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import * as liveNotes from '../../src/js/studio/live-notes.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const ADSR = { attack: 0.002, decay: 0.01, sustain: 0.5, release: 0.005 };
const ok = (r, what = '') => {
  assert.ok(r && r.ok, `${what}${what ? ': ' : ''}${r && (r.reason || JSON.stringify(r.errors))}`);
  return r;
};
const r9 = (x) => Number(x.toFixed(9));

/** Keys -> VCO -> Envelope -> Master Output through the one store: { st, d, add, edge, ids }. */
function document() {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const d = (a, what) => ok(st.dispatch(a), what || a.type);
  const add = (nodeType, params = null) => {
    const id = d({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }, nodeType)
      .created.nodes[0];
    if (params) d({ type: 'NODE_PARAM_SET', nodeId: id, params }, `${nodeType} params`);
    return id;
  };
  const edge = (from, fromPort, to, toPort, props) => d({ type: 'EDGE_ADD',
    from: { node: from, port: fromPort }, to: { node: to, port: toPort }, props },
  `${from}.${fromPort} -> ${to}.${toPort}`);
  const keys = add('keys');
  const vco = add('vco', { waveform: 'sine' });
  const env = add('envelope', ADSR);
  const out = add('master');
  edge(keys, 'pitch', vco, 'pitch', { depth: 6, polarity: 'bipolar', mapping: 'linear' });
  edge(vco, 'audio', env, 'audio');
  edge(env, 'audio', out, 'audio');
  return { st, d, add, edge, keys, vco, env, out };
}

/** The transport over the fake context; nothing started yet. */
function rigOf(st) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st });
  return { fx, engine, runtime, transport };
}

/** Record every gate the running Envelope `id` opens from now on (its handle's gate). */
function gatesOf(rig, id) {
  const h = rig.runtime.nodes.get(id);
  assert.ok(h && typeof h.gate === 'function', `envelope ${id} is running`);
  const opened = [];
  const gate = h.gate.bind(h);
  h.gate = (at, dur, ...rest) => { opened.push(at); return gate(at, dur, ...rest); };
  return opened;
}

/** When a clocked node (Random, Step Modulator) stepped since `from`: its output's step times. */
function stepTimes(rig, id, from) {
  const h = rig.runtime.nodes.get(id);
  assert.ok(h && h.info && h.info.clocked, `${id} is clocked`);
  return h.outputs.control.offset.events.filter((e) => e.ramp === 'set' && e.t >= from)
    .map((e) => r9(e.t));
}

/** Where the Envelope's VCA attacks since `from` (its linear ramp to 1, less Attack). */
function attacksOf(rig, id, from) {
  return rig.runtime.nodes.get(id).inputs.audio.gain.events
    .filter((e) => e.ramp === 'linear' && e.value === 1 && e.t >= from)
    .map((e) => r9(e.t - ADSR.attack));
}

const stopped = async (rig) => {
  const p = rig.transport.stop();
  rig.fx.advance(1);
  await p;
  assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
};

// ---------------------------------------------------------------- scheduled

test('K103 scheduled: a notes clip\'s Keys gate clocks a Step Modulator whose Trigger gates the '
  + 'Envelope, at each onset\'s frame', async () => {
    const doc = document();
    const steps = doc.add('step-modulator', { steps: [0.5, -0.5] });
    doc.edge(doc.keys, 'gate', steps, 'clock');
    doc.edge(steps, 'trigger', doc.env, 'gate');
    const track = doc.d({ type: 'TRACK_ADD', kind: 'event', target: doc.keys }).created.tracks[0];
    doc.d({ type: 'CLIP_ADD', trackId: track, kind: 'notes', startBeats: 0, durationBeats: 4,
      payload: { notes: [{ at: 0, note: 60, len: 0.5, vel: 0.8 },
        { at: 1, note: 64, len: 0.5, vel: 0.8 }] } });
    const rig = rigOf(doc.st);
    const { baseTime } = ok(rig.transport.start(), 'PLAY');
    const at = (beats) => r9((Math.round(baseTime * SR) + Math.round(beats * 0.5 * SR)) / SR);
    rig.fx.advance(1.2);
    assert.deepEqual(attacksOf(rig, doc.env, baseTime), [at(0), at(1)],
      'the Envelope attacks at each note, via the Step');
    const stepSets = rig.runtime.nodes.get(steps).outputs.control.offset.events
      .filter((e) => e.t >= baseTime).map((e) => [e.value, r9(e.t)]);
    assert.deepEqual(stepSets, [[0.5, at(0)], [-0.5, at(1)]], 'and the Step steps there');
    await stopped(rig);
  });

test('K103 scheduled: a gate clip on a Keys node clocks a Random its Gate reaches, as it gates '
  + 'an Envelope', async () => {
    const doc = document();
    const rnd = doc.add('random');
    doc.edge(doc.keys, 'gate', doc.env, 'gate');
    doc.edge(doc.keys, 'gate', rnd, 'trigger');
    const track = doc.d({ type: 'TRACK_ADD', kind: 'event', target: doc.keys }).created.tracks[0];
    doc.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.5, duration: 0.25,
      payload: { action: 'gate' } });
    const rig = rigOf(doc.st);
    const { baseTime } = ok(rig.transport.start(), 'PLAY');
    rig.fx.advance(0.7);
    const t = r9((Math.round(baseTime * SR) + Math.round(0.5 * SR)) / SR);
    assert.deepEqual(stepTimes(rig, rnd, baseTime), [t], 'the Random steps at the clip start');
    assert.deepEqual(attacksOf(rig, doc.env, baseTime), [t], 'the Envelope opens there too');
    await stopped(rig);
  });

test('K103 scheduled: a Clock edge steps a Random; a muted TRIGGER edge gates and clocks '
  + 'nothing', async () => {
    const doc = document();
    const clock = doc.add('clock', { division: '1/4' });
    const rnd = doc.add('random');
    doc.edge(clock, 'trigger', rnd, 'trigger');
    doc.edge(clock, 'trigger', doc.env, 'gate', { muted: true });
    const track = doc.d({ type: 'TRACK_ADD', kind: 'event', target: doc.env }).created.tracks[0];
    doc.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 1.9, duration: 0.05,
      payload: { action: 'gate' } }); // the timeline's length
    const rig = rigOf(doc.st);
    const { baseTime } = ok(rig.transport.start(), 'PLAY');
    rig.fx.advance(1.2);
    const t = (s) => r9((Math.round(baseTime * SR) + Math.round(s * SR)) / SR);
    assert.deepEqual(stepTimes(rig, rnd, baseTime).slice(0, 3), [t(0), t(0.5), t(1)],
      'the Random steps on each Clock tick');
    assert.deepEqual(attacksOf(rig, doc.env, baseTime), [t(1.9)],
      'the muted Clock edge gates nothing: only the gate clip that sets the length opens it');
    await stopped(rig);
  });

// ---------------------------------------------------------------- live

test('K103 live (armed, stopped): a key\'s Gate clocks a Step Modulator, whose Trigger gates the '
  + 'Envelope; a once run stops relaying after its last step', async () => {
    const doc = document();
    const steps = doc.add('step-modulator', { steps: [1, -1], playback: 'once' });
    doc.edge(doc.keys, 'gate', steps, 'clock');
    doc.edge(steps, 'trigger', doc.env, 'gate');
    const rig = rigOf(doc.st);
    ok(rig.transport.arm(), 'arm');
    const opened = gatesOf(rig, doc.env);
    for (const note of [60, 62, 64]) {
      ok(rig.transport.live(doc.keys, { kind: 'on', note, velocity: 100 }), `on ${note}`);
      ok(rig.transport.live(doc.keys, { kind: 'off', note }), `off ${note}`);
      rig.fx.advance(0.2);
    }
    assert.equal(opened.length, 2, 'two steps, two gates; the third key takes no step');
    await stopped(rig);
  });

test('K103 one ownership rule: while the timeline plays, a live gate on an input a clip-driven '
  + 'source reaches is refused with its reason; while armed, live gates own it', async () => {
    const doc = document();
    // The Envelope takes the Keys Gate by cable and gate clips from its own track: while the
    // timeline plays, its clips drive that Gate (a clip-driven source reaches it).
    doc.edge(doc.keys, 'gate', doc.env, 'gate');
    const track = doc.d({ type: 'TRACK_ADD', kind: 'event', target: doc.env }).created.tracks[0];
    doc.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 3.9, duration: 0.05,
      payload: { action: 'gate' } });
    // Armed (stopped): the live gate owns the Envelope.
    const rig = rigOf(doc.st);
    ok(rig.transport.arm(), 'arm');
    let opened = gatesOf(rig, doc.env);
    const free = ok(rig.transport.live(doc.keys, { kind: 'on', note: 60, velocity: 100 }), 'on');
    assert.equal(free.owned, undefined, 'nothing refused while armed');
    assert.equal(opened.length, 1, 'the key gates the Envelope while the timeline is stopped');
    ok(rig.transport.live(doc.keys, { kind: 'off', note: 60 }), 'off');
    // PLAY: the Envelope's gate clips drive its Gate, so the timeline owns it.
    ok(rig.transport.start(), 'PLAY');
    rig.fx.advance(0.1);
    opened = gatesOf(rig, doc.env);
    const at = rig.fx.ctx.currentTime + 0.3;
    const r = rig.transport.live(doc.keys, { kind: 'on', note: 62, velocity: 100, at });
    assert.equal(r.ok, true, 'the note itself plays (its pitch moves)');
    assert.ok(r.owned, 'the gate is refused');
    assert.equal(r.owned.code, 'timeline-owned');
    assert.equal(r.owned.reason, liveNotes.LIVE_NOTES_TEXT.timelineOwned('Envelope 1'));
    assert.ok(!opened.includes(at), 'and gates nothing on the Envelope the timeline owns');
    ok(rig.transport.live(doc.keys, { kind: 'off', note: 62 }), 'off');
    await stopped(rig);
  });

test('K103 a trigger into a node without a trigger input is refused by canConnect', () => {
  const doc = document();
  const r = doc.st.dispatch({ type: 'EDGE_ADD', from: { node: doc.keys, port: 'gate' },
    to: { node: doc.out, port: 'audio' } });
  assert.equal(r.ok, false, 'a Gate into the Master Output is refused');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'with the validator\'s sentence');
});
