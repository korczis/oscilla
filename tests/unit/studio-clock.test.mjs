// K023 (M059): the Clock node, the Step Modulator's Trigger output and trigger event clips.
//   Clock         a new MODULATION type with one TRIGGER output and a division (1/1-1/32 of
//                 transport.tempo, nodes/common.js TEMPO_DIVISIONS, K022); its ticks are planned
//                 by the timeline compiler (clock.js clockTicks) on the grid m x T from position 0
//                 and fanned out by the transport along its TRIGGER edges: a gate of half a period
//                 on an Envelope, a clock tick on Random and the Step Modulator
//   Step trigger  the Step Modulator's TRIGGER output relays each step it takes (none after the
//                 last step of a 'once' run)
//   trigger clip  an event clip with action 'trigger' (schema.js EVENT_ACTIONS) plays: one clock
//                 tick on Random and the Step Modulator, one pulse on an Envelope (attack and
//                 decay once, then the release)
// Asserted on StudioFakeContext (tests/unit/sequencer-fake-audio.mjs): the offline render
// (offline.js renderStudioOffline, one transport start over the whole render) at 44.1 and 48 kHz,
// and the live transport on one virtual clock. A new node type and a new port leave every pinned
// hash unchanged (the pinned-hash tests still pass; the model of a document is not touched).
//   node --test tests/unit/studio-clock.test.mjs
// Fails on 49589646 (K022): the registry has no 'clock' type (NODE_ADD refused), the Step
// Modulator has no 'trigger' output, Random and the Step Modulator take no event clips, and a
// trigger event clip is listed unplayed. Namespace imports: each test fails on its own assertion.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import * as offline from '../../src/js/studio/offline.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import * as timelineView from '../../src/js/ui/studio/timeline-view.js';
import { createFakeAudioEnv, fakeOfflineCtor } from './sequencer-fake-audio.mjs';

const ADSR = { attack: 0.002, decay: 0.01, sustain: 0.5, release: 0.005 };
const QUANTUM = 128; // frames of one Web Audio render quantum
const ok = (r, what = '') => {
  assert.ok(r && r.ok, `${what}${what ? ': ' : ''}${r && (r.reason || JSON.stringify(r.errors))}`);
  return r;
};

/** An empty Studio document through the one store. -> { st, add, edge, d } */
function studio() {
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
  return { st, add, edge, d };
}

/** Oscillator -> Envelope -> Master Output: { ...studio, osc, env, out }. */
function voice() {
  const s = studio();
  const osc = s.add('oscillator', { waveform: 'sine' });
  const env = s.add('envelope', ADSR);
  const out = s.add('master');
  s.edge(osc, 'audio', env, 'audio');
  s.edge(env, 'audio', out, 'audio');
  return { ...s, osc, env, out };
}

/** An event clip on a new track targeting `target`: its id. */
function eventClip(s, target, start, duration, action) {
  const track = s.d({ type: 'TRACK_ADD', kind: 'event', target }).created.tracks[0];
  return s.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start, duration,
    payload: { action } }).created.clips[0];
}

/** Where each attack of an Envelope VCA starts: its linear ramp to 1, less Attack. */
const attacksOf = (gain) => gain.events.filter((e) => e.ramp === 'linear' && e.value === 1)
  .map((e) => e.t - ADSR.attack).sort((a, b) => a - b);

/** The transport PLAYing the store on the real engine and runtime over a fake context. */
function playing(st, { sampleRate = 48000, lookAheadS = null } = {}) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
    lookAheadS });
  const started = ok(transport.start(), 'PLAY');
  return { fx, engine, runtime, transport, base: started.baseTime };
}

const stopped = async (rig) => {
  const p = rig.transport.stop();
  rig.fx.advance(1);
  await p;
  assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
  assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0 after stop');
};

// ---------------------------------------------------------------- 1. the node

test('K023 the Clock is a MODULATION type with one TRIGGER output and a tempo division', () => {
  const def = NODE_REGISTRY.get('clock');
  assert.ok(def, 'the registry has a clock type');
  assert.equal(def.category, 'MODULATION');
  assert.deepEqual(def.inputs, []);
  assert.deepEqual(def.outputs.map((p) => [p.id, p.type]), [['trigger', 'TRIGGER']]);
  const division = def.params.find((p) => p.key === 'division');
  assert.deepEqual(division.options.map((o) => o.value ?? o[0] ?? o),
    ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32']);
  assert.equal(division.default, '1/4');
  const step = NODE_REGISTRY.get('step-modulator');
  assert.ok(step.outputs.some((p) => p.id === 'trigger' && p.type === 'TRIGGER'),
    'the Step Modulator has a Trigger output');
  for (const type of ['random', 'step-modulator']) {
    assert.ok(NODE_REGISTRY.get(type).clipKinds.includes('event'), `${type} takes event clips`);
  }
});

// ---------------------------------------------------------------- 2. offline timing

for (const sampleRate of [44100, 48000]) {
  test(`K023 offline at ${sampleRate} Hz: a Clock at 1/4 of 120 BPM gates its Envelope every `
    + '0.5 s, within one render quantum', async () => {
    const s = voice();
    const clock = s.add('clock', { division: '1/4' });
    s.edge(clock, 'trigger', s.env, 'gate');
    // The timeline's length: a 0.1 s gate at 3.9 s on the same Envelope (positions 0-4 s).
    eventClip(s, s.env, 3.9, 0.1, 'gate');
    const made = [];
    const r = await offline.renderStudioOffline(s.st.getModel(),
      { sampleRate, OfflineAudioContext: fakeOfflineCtor(made) });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(r.debug.transport.unplayed, [], 'nothing unplayed');
    const ctx = made[0];
    assert.equal(ctx.sampleRate, sampleRate);
    const vca = ctx.of('gain').find((g) => attacksOf(g.gain).length >= 8);
    assert.ok(vca, 'the Envelope VCA was gated');
    const got = attacksOf(vca.gain).filter((t) => Math.abs(t - r.startTime - 3.9) > 1e-6);
    assert.equal(got.length, 8, `eight ticks in 4 s (${got.map((t) => t - r.startTime)})`);
    got.forEach((t, k) => {
      const want = r.startTime + 0.5 * k;
      assert.ok(Math.abs(t - want) <= QUANTUM / sampleRate,
        `tick ${k} at ${t - r.startTime} s, ${(t - want) * sampleRate} frames from ${0.5 * k} s`);
      assert.ok(Math.abs(t * sampleRate - Math.round(t * sampleRate)) < 1e-6, 'a whole frame');
    });
    // Each tick holds the gate for half its period: the release starts 0.25 s after the attack.
    const releases = vca.gain.events.filter((e) => e.ramp === 'exponential' && e.value < 0.001)
      .map((e) => e.t - ADSR.release).sort((a, b) => a - b);
    assert.ok(Math.abs(releases[0] - (got[0] + 0.25)) <= QUANTUM / sampleRate,
      'the first gate closes after half a period');
  });
}

// ---------------------------------------------------------------- 3. trigger clips

test('K023 a trigger clip advances a Step Modulator, a Random and an Envelope at its time; '
  + 'census 0 after stop', async () => {
    const s = voice();
    const steps = s.add('step-modulator', { steps: [1, -1, 0.5] });
    const rnd = s.add('random');
    // A Step Modulator and a Random with no clock edge: only their trigger clips clock them.
    s.edge(steps, 'control', s.osc, 'frequency', { depth: 0.1 });
    s.edge(rnd, 'control', s.osc, 'level', { depth: 0.1 });
    for (const t of [0.25, 0.75]) eventClip(s, steps, t, 0.1, 'trigger');
    eventClip(s, rnd, 0.5, 0.1, 'trigger');
    eventClip(s, s.env, 1, 0.5, 'trigger');
    const rig = playing(s.st);
    rig.fx.advance(1.3); // past every trigger, before the timeline's end (1.5 s) stops it
    const sr = rig.fx.ctx.sampleRate;
    const at = (pos) => (Math.round(rig.base * sr) + Math.round(pos * sr)) / sr;
    assert.deepEqual(rig.transport.debugInfo().unplayed, [], 'every trigger clip plays');
    const stepsH = rig.runtime.nodes.get(steps);
    assert.equal(stepsH.info.clocked, true, 'the clip makes the Step Modulator clocked');
    const stepSets = stepsH.outputs.control.offset.events.filter((e) => e.t >= rig.base)
      .map((e) => [e.value, e.t]);
    assert.deepEqual(stepSets, [[1, at(0.25)], [-1, at(0.75)]],
      'step 0 at the first trigger, step 1 at the second');
    const rndH = rig.runtime.nodes.get(rnd);
    assert.equal(rndH.info.clocked, true);
    assert.ok(rndH.outputs.control.offset.events.some((e) => e.t === at(0.5)),
      'Random takes its value at its trigger');
    const vca = rig.runtime.nodes.get(s.env).inputs.audio.gain;
    assert.deepEqual(attacksOf(vca).map((t) => Number(t.toFixed(9))),
      [Number(at(1).toFixed(9))], 'the Envelope attacks at the trigger');
    const release = vca.events.find((e) => e.ramp === 'exponential' && e.value < 0.001);
    assert.ok(Math.abs(release.t - ADSR.release - (at(1) + ADSR.attack + ADSR.decay)) < 1e-9,
      'a trigger is one pulse: attack and decay, then the release (not the clip\'s 0.5 s)');
    await stopped(rig);
  });

test('K023 the Step Modulator\'s Trigger relays each step it takes; a once run stops relaying '
  + 'after its last step', async () => {
    const s = voice();
    const clock = s.add('clock', { division: '1/8' }); // 0.25 s at 120 BPM
    const steps = s.add('step-modulator', { steps: [1, 0, -1], playback: 'once' });
    s.edge(clock, 'trigger', steps, 'clock');
    s.edge(steps, 'trigger', s.env, 'gate');
    s.edge(steps, 'control', s.osc, 'frequency', { depth: 0.1 });
    eventClip(s, s.osc, 1.9, 0.1, 'gate'); // the timeline's length (an Oscillator: unplayed)
    const rig = playing(s.st, { lookAheadS: 3 });
    const sr = rig.fx.ctx.sampleRate;
    const at = (pos) => Number(((Math.round(rig.base * sr) + Math.round(pos * sr)) / sr)
      .toFixed(9));
    const vca = rig.runtime.nodes.get(s.env).inputs.audio.gain;
    assert.deepEqual(attacksOf(vca).map((t) => Number(t.toFixed(9))), [0, 0.25, 0.5].map(at),
      'three steps, three gates; the Clock ticks on, the once run relays nothing more');
    const stepSets = rig.runtime.nodes.get(steps).outputs.control.offset.events
      .filter((e) => e.t >= rig.base).map((e) => e.value);
    assert.deepEqual(stepSets.slice(0, 4), [1, 0, -1, -1], 'the steps, then the last held');
    await stopped(rig);
  });

test('K023 a tempo change while playing moves the Clock\'s later ticks; STOP leaves census 0',
  async () => {
    const s = voice();
    const clock = s.add('clock', { division: '1/4' });
    s.edge(clock, 'trigger', s.env, 'gate');
    eventClip(s, s.osc, 7.9, 0.1, 'gate'); // the timeline's length
    const rig = playing(s.st);
    rig.fx.advance(1.1); // ticks at 0, 0.5 and 1.0 s have played; 1.5 s and later are scheduled
    s.d({ type: 'TRANSPORT_SET', tempo: 60 }, 'tempo 60');
    rig.transport.sync();
    rig.fx.advance(3);
    const vca = rig.runtime.nodes.get(s.env).inputs.audio.gain;
    const rel = attacksOf(vca).map((t) => Number((t - rig.base).toFixed(6)) + 0);
    assert.deepEqual(rel.slice(0, 3), [0, 0.5, 1], 'the ticks before the edit');
    assert.ok(rel.includes(2) && rel.includes(3) && !rel.includes(1.5) && !rel.includes(2.5),
      `at 60 BPM a quarter is 1 s: the later ticks lie on whole seconds (${rel})`);
    await stopped(rig);
  });

// ---------------------------------------------------------------- 4. the timeline UI

test('K023 the timeline offers trigger clips where they play', () => {
  const s = studio();
  const steps = s.add('step-modulator');
  const osc = s.add('oscillator');
  const track = s.d({ type: 'TRACK_ADD', kind: 'event', target: steps }).created.tracks[0];
  const add = timelineView.addClipAction(s.st.getModel(), track, 1);
  assert.ok(add.action, add.reason);
  assert.deepEqual([add.action.kind, add.action.payload], ['event', { action: 'trigger' }],
    '"add clip" on a Step Modulator track adds a trigger');
  const ids = (o) => o.map((x) => x.id);
  const node = (id) => s.st.getModel().graph.nodes.find((n) => n.id === id);
  assert.deepEqual(ids(timelineView.eventActionOptions(undefined, node(steps))), ['trigger']);
  const oscTrack = s.d({ type: 'TRACK_ADD', kind: 'event', target: osc }).created.tracks[0];
  assert.ok(timelineView.addClipAction(s.st.getModel(), oscTrack, 1).action,
    'an Oscillator track still gets a pattern clip');
});
