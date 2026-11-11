// K226 (M067): the step-voltage sequencer node. Three rows (A, B, C) of step values share one
// step position; a CONTROL output per row (cvA, cvB, cvC) holds the current step's value, a
// TRIGGER output per step (trig1 .. trig16) fires on that step only, and a Gate TRIGGER fires
// on every step; a clock TRIGGER input steps it, a reset TRIGGER input sends it back to step 1
// (a reset at the same instant as a clock tick restarts on that tick, whichever source sends
// it). Length 8 or 16; playback forward, back and forth, or once. On the one Studio transport:
// a Clock (K023) drives it through the shared trigger fan-out (studio/trigger-fanout.js).
// Asserted on the real AudioEngine, runtime and transport over StudioFakeContext
// (tests/unit/sequencer-fake-audio.mjs).
//   node --test tests/unit/studio-step-voltage-sequencer.test.mjs
// Fails on 0f9403d8 (the T4 head): the registry has no 'step-voltage-sequencer' type, so
// NODE_ADD is refused and every test below fails on its first assertion.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const TYPE = 'step-voltage-sequencer';
const ADSR = { attack: 0.002, decay: 0.01, sustain: 0.5, release: 0.005 };
const ok = (r, what = '') => {
  assert.ok(r && r.ok, `${what}${what ? ': ' : ''}${r && (r.reason || JSON.stringify(r.errors))}`);
  return r;
};
const r9 = (x) => Number(x.toFixed(9));

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

/** Two Oscillator -> Envelope voices through a Mixer into the Master Output. */
function rig2() {
  const s = studio();
  const osc = s.add('oscillator', { waveform: 'sine' });
  const env = s.add('envelope', ADSR);
  const osc2 = s.add('oscillator', { waveform: 'sine' });
  const env2 = s.add('envelope', ADSR);
  const mix = s.add('mixer');
  const out = s.add('master');
  s.edge(osc, 'audio', env, 'audio');
  s.edge(env, 'audio', mix, 'in1');
  s.edge(osc2, 'audio', env2, 'audio');
  s.edge(env2, 'audio', mix, 'in2');
  s.edge(mix, 'audio', out, 'audio');
  return { ...s, osc, env, osc2, env2, out };
}

/** An event clip on a new track targeting `target`: its id. */
function eventClip(s, target, start, duration, action) {
  const track = s.d({ type: 'TRACK_ADD', kind: 'event', target }).created.tracks[0];
  return s.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start, duration,
    payload: { action } }).created.clips[0];
}

/** Where each attack of an Envelope VCA starts: its linear ramp to 1, less Attack. */
const attacksOf = (gain) => gain.events.filter((e) => e.ramp === 'linear' && e.value === 1)
  .map((e) => r9(e.t - ADSR.attack)).sort((a, b) => a - b);

function playing(st, { sampleRate = 48000, lookAheadS = 3 } = {}) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
    lookAheadS });
  const started = ok(transport.start(), 'PLAY');
  const sr = fx.ctx.sampleRate;
  const at = (pos) => r9((Math.round(started.baseTime * sr) + Math.round(pos * sr)) / sr);
  return { fx, engine, runtime, transport, base: started.baseTime, at };
}

const stopped = async (rig) => {
  const p = rig.transport.stop();
  rig.fx.advance(1);
  await p;
  assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
  assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0 after stop');
};

/** The values a row's output was set to from PLAY on, in time order: [[value, t]]. */
const rowSets = (rig, id, port) => rig.runtime.nodes.get(id).outputs[port].offset.events
  .filter((e) => e.t >= rig.base).map((e) => [e.value, r9(e.t)]);

const ROW_A = [1, 0.5, 0, -0.5, -1, 0.25, 0.75, -0.25, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const ROW_B = ROW_A.map((v) => -v);
const ROW_C = ROW_A.map((_, i) => i / 16);

// ---------------------------------------------------------------- 1. the node type

test('K226 the step-voltage sequencer is a MODULATION type: clock and reset in, three CV rows, '
  + 'a gate and sixteen step triggers out', () => {
  const def = NODE_REGISTRY.get(TYPE);
  assert.ok(def, `the registry has ${TYPE}`);
  assert.equal(def.category, 'MODULATION');
  assert.deepEqual(def.inputs.filter((p) => p.type === 'TRIGGER').map((p) => p.id),
    ['clock', 'reset'], 'its TRIGGER inputs (rate adds its own modulation input)');
  const outs = def.outputs.map((p) => [p.id, p.type]);
  assert.deepEqual(outs.slice(0, 4), [['cvA', 'CONTROL'], ['cvB', 'CONTROL'],
    ['cvC', 'CONTROL'], ['gate', 'TRIGGER']]);
  assert.deepEqual(outs.slice(4), Array.from({ length: 16 }, (_, i) => [`trig${i + 1}`,
    'TRIGGER']));
  const param = (key) => def.params.find((p) => p.key === key);
  for (const id of ['rowA', 'rowB', 'rowC']) {
    assert.equal(param(id).type, 'list', `${id} is a list of step values`);
    assert.equal(param(id).default.length, 16, `${id} holds 16 steps`);
  }
  assert.deepEqual(param('length').options.map((o) => o[0]), ['8', '16']);
  assert.deepEqual(param('playback').options.map((o) => o[0]), ['forward', 'pingpong', 'once']);
  assert.ok(param('rate'), 'a rate steps it without a clock cable');
});

test('K226 its ports connect by type: cvA into a pitch, a step trigger into an Envelope gate; '
  + 'a TRIGGER into an AUDIO input is refused', () => {
  const s = studio();
  const svs = s.add(TYPE);
  const osc = s.add('oscillator');
  const env = s.add('envelope');
  s.edge(svs, 'cvA', osc, 'frequency', { depth: 0.1 });
  s.edge(svs, 'trig3', env, 'gate');
  const bad = s.st.dispatch({ type: 'EDGE_ADD', from: { node: svs, port: 'trig1' },
    to: { node: env, port: 'audio' } });
  assert.equal(bad.ok, false, 'a TRIGGER output into an AUDIO input is refused');
  assert.ok(String(bad.reason || JSON.stringify(bad.errors)).length > 0, 'with its reason');
});

// ---------------------------------------------------------------- 2. on the one transport

test('K226 a Clock steps the three rows together; Gate fires every step, trig3 on step 3 only',
  async () => {
    const s = rig2();
    const clock = s.add('clock', { division: '1/8' }); // 0.25 s at 120 BPM
    const svs = s.add(TYPE, { rowA: ROW_A, rowB: ROW_B, rowC: ROW_C, length: '8' });
    s.edge(clock, 'trigger', svs, 'clock');
    s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
    s.edge(svs, 'cvB', s.osc, 'level', { depth: 0.1 });
    s.edge(svs, 'cvC', s.osc2, 'level', { depth: 0.1 });
    s.edge(svs, 'gate', s.env, 'gate');
    s.edge(svs, 'trig3', s.env2, 'gate');
    eventClip(s, s.osc, 2.9, 0.1, 'gate'); // the timeline's length (an Oscillator: unplayed)
    const rig = playing(s.st);
    const ticks = Array.from({ length: 12 }, (_, k) => rig.at(k * 0.25)); // 0 .. 2.75 s
    const h = rig.runtime.nodes.get(svs);
    assert.equal(h.info.clocked, true, 'a clock edge makes it clocked');
    const step = (k) => k % 8;
    for (const [port, row] of [['cvA', ROW_A], ['cvB', ROW_B], ['cvC', ROW_C]]) {
      assert.deepEqual(rowSets(rig, svs, port).slice(0, 12),
        ticks.map((t, k) => [Math.fround(row[step(k)]), t]),
        `${port}: one value per tick, the rows sharing one position, step 9 back to step 1`);
    }
    assert.deepEqual(attacksOf(rig.runtime.nodes.get(s.env).inputs.audio.gain).slice(0, 12),
      ticks, 'Gate fires on every step');
    assert.deepEqual(attacksOf(rig.runtime.nodes.get(s.env2).inputs.audio.gain),
      [ticks[2], ticks[10]], 'trig3 fires on step 3 of each pass of 8 only');
    await stopped(rig);
  });

test('K226 length 8 leaves trig9 .. trig16 silent; length 16 fires trig9 on step 9',
  async () => {
    for (const [length, want] of [['8', []], ['16', [8]]]) {
      const s = rig2();
      const clock = s.add('clock', { division: '1/8' });
      const svs = s.add(TYPE, { length });
      s.edge(clock, 'trigger', svs, 'clock');
      s.edge(svs, 'trig9', s.env2, 'gate');
      eventClip(s, s.osc, 3.9, 0.1, 'gate'); // 16 ticks
      const rig = playing(s.st, { lookAheadS: 4 });
      assert.deepEqual(attacksOf(rig.runtime.nodes.get(s.env2).inputs.audio.gain),
        want.map((k) => rig.at(k * 0.25)), `length ${length}`);
      await stopped(rig);
    }
  });

test('K226 back and forth plays 1..L..2 and again; once stops relaying after the last step and '
  + 'holds it', async () => {
    const cases = [
      ['pingpong', [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1]],
      ['once', [0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7]],
    ];
    for (const [playback, order] of cases) {
      const s = rig2();
      const clock = s.add('clock', { division: '1/8' });
      const svs = s.add(TYPE, { rowA: ROW_A, length: '8', playback });
      s.edge(clock, 'trigger', svs, 'clock');
      s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
      s.edge(svs, 'gate', s.env, 'gate');
      eventClip(s, s.osc, 3.9, 0.1, 'gate');
      const rig = playing(s.st, { lookAheadS: 4 });
      assert.deepEqual(rowSets(rig, svs, 'cvA').slice(0, 16).map(([v]) => v),
        order.map((i) => Math.fround(ROW_A[i])), `${playback}: the step order`);
      const gates = attacksOf(rig.runtime.nodes.get(s.env).inputs.audio.gain);
      assert.equal(gates.length, playback === 'once' ? 8 : 16,
        `${playback}: Gate fires on every step it takes`);
      await stopped(rig);
    }
  });

// ---------------------------------------------------------------- 3. reset

test('K226 a reset sends it back to step 1 at the next step boundary, and a reset at the same '
  + 'instant as a clock tick restarts on that tick', async () => {
    // One Clock (1/8) steps it; a second Clock (1/2, every 1 s) resets it: the reset coincides
    // with every fourth tick, so the rows play steps 1-4 and start again, whichever item the
    // transport takes first at that instant.
    for (const order of ['reset-clock-first', 'step-clock-first']) {
      const s = rig2();
      const make = () => s.add('clock', { division: '1/8' });
      const makeReset = () => s.add('clock', { division: '1/2' });
      const [clock, resetClock] = order === 'reset-clock-first' ? (() => {
        const r = makeReset();
        return [make(), r];
      })() : [make(), makeReset()];
      const svs = s.add(TYPE, { rowA: ROW_A, length: '8' });
      s.edge(clock, 'trigger', svs, 'clock');
      s.edge(resetClock, 'trigger', svs, 'reset');
      s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
      s.edge(svs, 'trig1', s.env2, 'gate');
      eventClip(s, s.osc, 2.9, 0.1, 'gate');
      const rig = playing(s.st);
      assert.deepEqual(rowSets(rig, svs, 'cvA').slice(0, 12).map(([v]) => v),
        [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3].map((i) => Math.fround(ROW_A[i])), order);
      assert.deepEqual(attacksOf(rig.runtime.nodes.get(s.env2).inputs.audio.gain),
        [0, 1, 2].map(rig.at), `${order}: trig1 fires on each restart`);
      await stopped(rig);
    }
    // One Clock into both clock and reset: every tick is a restart, so it stays on step 1.
    const s = rig2();
    const clock = s.add('clock', { division: '1/8' });
    const svs = s.add(TYPE, { rowA: ROW_A, length: '8' });
    s.edge(clock, 'trigger', svs, 'clock');
    s.edge(clock, 'trigger', svs, 'reset');
    s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
    eventClip(s, s.osc, 0.9, 0.1, 'gate');
    const rig = playing(s.st);
    assert.deepEqual(rowSets(rig, svs, 'cvA').slice(0, 4).map(([v]) => v),
      [0, 0, 0, 0].map((i) => Math.fround(ROW_A[i])), 'one source on both: step 1 each tick');
    await stopped(rig);
  });

test('K226 a trigger event clip clocks it as a clock edge does', async () => {
  const s = rig2();
  const svs = s.add(TYPE, { rowA: ROW_A });
  s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
  for (const t of [0.25, 0.75]) eventClip(s, svs, t, 0.1, 'trigger');
  eventClip(s, s.osc, 1.4, 0.1, 'gate'); // the timeline's length (an Oscillator: unplayed)
  const rig = playing(s.st);
  rig.fx.advance(1.3);
  const unplayed = rig.transport.debugInfo().unplayed;
  assert.equal(unplayed.length, 1, 'every trigger clip plays (the Oscillator gate is the length)');
  assert.deepEqual(rowSets(rig, svs, 'cvA'), [[Math.fround(ROW_A[0]), rig.at(0.25)],
    [Math.fround(ROW_A[1]), rig.at(0.75)]]);
  await stopped(rig);
});

// ---------------------------------------------------------------- 4. roles and skips (amended)

test('K226 a role per row: pitch in semitones, octave, velocity 0..1, CV as it is', async () => {
  const def = NODE_REGISTRY.get(TYPE);
  for (const key of ['roleA', 'roleB', 'roleC']) {
    assert.deepEqual(def.params.find((p) => p.key === key).options.map((o) => o[0]),
      ['cv', 'pitch', 'octave', 'gateLength', 'velocity'], `${key} options`);
  }
  const s = rig2();
  const clock = s.add('clock', { division: '1/8' });
  const row = [0.29, -0.6, 1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const svs = s.add(TYPE, { rowA: row, rowB: row, rowC: row, length: '8',
    roleA: 'pitch', roleB: 'octave', roleC: 'velocity' });
  s.edge(clock, 'trigger', svs, 'clock');
  s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
  s.edge(svs, 'cvB', s.osc, 'level', { depth: 0.1 });
  s.edge(svs, 'cvC', s.osc2, 'level', { depth: 0.1 });
  eventClip(s, s.osc, 1.9, 0.1, 'gate');
  const rig = playing(s.st);
  const values = (port) => rowSets(rig, svs, port).slice(0, 4).map(([v]) => r9(v));
  assert.deepEqual(values('cvA'), [3 / 12, -7 / 12, 1, -1].map(r9),
    'pitch: each step rounded to a twelfth (a semitone under a 1-octave-per-unit pitch edge)');
  assert.deepEqual(values('cvB'), [0, -1, 1, -1].map(r9),
    'octave: each step rounded to a whole unit (an octave at depth 1)');
  assert.deepEqual(values('cvC'), [0.645, 0.2, 1, 0].map(r9),
    'velocity: -1..1 carried as 0..1');
  await stopped(rig);
});

test('K226 a gate-length row sets how long each step\'s Gate holds: half a period, or legato',
  async () => {
    const s = rig2();
    const clock = s.add('clock', { division: '1/8' }); // a step period of 0.25 s
    // gate length 0 .. 1 of the period: -1 -> 0 (the shortest gate), 0 -> 0.5, 1 -> 1 (legato)
    const row = [0, 1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const svs = s.add(TYPE, { rowA: row, length: '8', roleA: 'gateLength' });
    s.edge(clock, 'trigger', svs, 'clock');
    s.edge(svs, 'gate', s.env, 'gate');
    eventClip(s, s.osc, 1.9, 0.1, 'gate');
    const rig = playing(s.st);
    const vca = rig.runtime.nodes.get(s.env).inputs.audio.gain;
    const releases = vca.events.filter((e) => e.ramp === 'exponential' && e.value < 0.001)
      .map((e) => r9(e.t - ADSR.release));
    // step 1 holds 0.125 s (half the period); step 2 holds the whole period (legato, its gate
    // meets step 3's, one union); step 3 holds the shortest gate the transport keeps.
    assert.ok(releases.includes(rig.at(0.125)), `step 1 releases at 0.125 s (${releases})`);
    assert.ok(!releases.some((t) => t > rig.at(0.3) && t < rig.at(0.5)),
      'step 2 is legato: no release before step 3');
    await stopped(rig);
  });

test('K226 a skipped step is passed over and its trigger stays silent; all skipped plays none',
  async () => {
    const s = rig2();
    const clock = s.add('clock', { division: '1/8' });
    const skip = Array(16).fill(0);
    skip[1] = 1; // step 2
    const svs = s.add(TYPE, { rowA: ROW_A, length: '8', skip });
    s.edge(clock, 'trigger', svs, 'clock');
    s.edge(svs, 'cvA', s.osc, 'frequency', { depth: 0.1 });
    s.edge(svs, 'trig2', s.env2, 'gate');
    eventClip(s, s.osc, 1.9, 0.1, 'gate');
    const rig = playing(s.st);
    assert.deepEqual(rowSets(rig, svs, 'cvA').slice(0, 8).map(([v]) => v),
      [0, 2, 3, 4, 5, 6, 7, 0].map((i) => Math.fround(ROW_A[i])), 'step 2 is passed over');
    assert.deepEqual(attacksOf(rig.runtime.nodes.get(s.env2).inputs.audio.gain), [],
      'trig2 never fires');
    await stopped(rig);
    const t = rig2();
    const c2 = t.add('clock', { division: '1/8' });
    const all = t.add(TYPE, { length: '8', skip: Array(16).fill(1) });
    t.edge(c2, 'trigger', all, 'clock');
    t.edge(all, 'gate', t.env, 'gate');
    eventClip(t, t.osc, 0.9, 0.1, 'gate');
    const rig2b = playing(t.st);
    assert.deepEqual(attacksOf(rig2b.runtime.nodes.get(t.env).inputs.audio.gain), [],
      'every step skipped: no Gate');
    await stopped(rig2b);
  });

// ---------------------------------------------------------------- 5. live: keys and the Step

/** Keys -> VCO -> Envelope -> Master, Keys Gate -> the sequencer's clock: { s, keys, svs, ... } */
function armedDoc(params = {}) {
  const s = studio();
  const keys = s.add('keys');
  const vco = s.add('vco', { waveform: 'sine' });
  const env = s.add('envelope', ADSR);
  const env2 = s.add('envelope', ADSR);
  const mix = s.add('mixer');
  const out = s.add('master');
  s.edge(keys, 'pitch', vco, 'pitch', { depth: 6, polarity: 'bipolar', mapping: 'linear' });
  s.edge(vco, 'audio', env, 'audio');
  s.edge(vco, 'audio', env2, 'audio');
  s.edge(env, 'audio', mix, 'in1');
  s.edge(env2, 'audio', mix, 'in2');
  s.edge(mix, 'audio', out, 'audio');
  const svs = s.add(TYPE, { rowA: ROW_A, length: '8', ...params });
  s.edge(keys, 'gate', svs, 'clock');
  s.edge(svs, 'cvA', vco, 'pitch', { depth: 0.1 });
  s.edge(svs, 'gate', env, 'gate');
  s.edge(svs, 'trig2', env2, 'gate');
  return { ...s, keys, vco, env, env2, svs };
}

function armed(st) {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st });
  return { fx, engine, runtime, transport };
}

test('K226 live (armed): a key\'s Gate steps it; trig2 opens only on step 2; the Step button '
  + 'takes one step and holds its Gate for MANUAL_STEP_S', async () => {
    const doc = armedDoc();
    const rig = armed(doc.st);
    ok(rig.transport.arm(), 'arm');
    const g1 = [];
    const g2 = [];
    for (const [id, list] of [[doc.env, g1], [doc.env2, g2]]) {
      const h = rig.runtime.nodes.get(id);
      const gate = h.gate.bind(h);
      h.gate = (at, dur, ...rest) => { list.push(at); return gate(at, dur, ...rest); };
    }
    for (const note of [60, 62]) {
      ok(rig.transport.live(doc.keys, { kind: 'on', note, velocity: 100 }), `on ${note}`);
      rig.fx.advance(0.05);
      ok(rig.transport.live(doc.keys, { kind: 'off', note }), `off ${note}`);
      rig.fx.advance(0.05);
    }
    assert.equal(g1.length, 2, 'the sequencer\'s Gate opens on each step a key takes');
    assert.equal(g2.length, 1, 'trig2 opens on step 2 only');
    const r = ok(rig.transport.step(doc.svs), 'the Step button');
    assert.equal(r.step, 2, 'the manual step plays step 3 (0-based 2)');
    assert.equal(g1.length, 3, 'its Gate opens');
    await stopped(rig);
  });

test('K226 a Step press while stopped arms the transport and takes step 1 (oscilla-c3, '
  + '2026-11-11)', async () => {
    const doc = armedDoc();
    const rig = armed(doc.st);
    assert.equal(rig.transport.playing, false, 'stopped');
    const r = ok(rig.transport.step(doc.svs), 'the Step button while stopped');
    assert.equal(rig.transport.armed, true, 'the press armed the live model (K104)');
    assert.equal(r.step, 0, 'the first press takes step 1 (0-based 0)');
    const sets = rig.runtime.nodes.get(doc.svs).outputs.cvA.offset.events;
    assert.ok(sets.length > 0, 'row A\'s output was set');
    assert.equal(sets[sets.length - 1].value, Math.fround(ROW_A[0]),
      'row A holds step 1\'s value');
    const r2 = ok(rig.transport.step(doc.svs), 'a second press');
    assert.equal(r2.step, 1, 'steps on to step 2');
    await stopped(rig);
  });

test('K226 the Step button is refused while the timeline\'s Clock owns its '
  + 'clock input', async () => {
  // A Clock drives the clock input while the timeline plays: the timeline owns it.
  const s = rig2();
  const clock = s.add('clock', { division: '1/8' });
  const svs = s.add(TYPE, { length: '8' });
  s.edge(clock, 'trigger', svs, 'clock');
  s.edge(svs, 'gate', s.env, 'gate');
  eventClip(s, s.osc, 0.9, 0.1, 'gate');
  const play = playing(s.st);
  const r = play.transport.step(svs);
  assert.equal(r.ok, false, 'while the timeline plays its Clock owns the sequencer');
  assert.equal(r.code, 'timeline-owned');
  assert.ok(String(r.reason).length > 10, 'with its reason');
  await stopped(play);
});
