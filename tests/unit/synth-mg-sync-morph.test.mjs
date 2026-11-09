// K229 (M067), the node half: the LFO gets key sync and a continuous waveform morph.
//   key sync  a reset TRIGGER input (a new port, D2: no epoch): a trigger on it restarts the
//             LFO's phase at its audio time, so a Keys Gate (or a Clock) cabled into it starts
//             each note's modulation at the same phase. A reset-capable LFO plays a fresh voice
//             (its oscillators) from each reset, and its rate drives every voice through one
//             shared source, so the rate's edges and automation keep acting on every voice.
//   morph     a shape option 'morph' (a new enum option, no epoch) and a morph parameter
//             (0..1, triangle at 0, sawtooth at 0.5, square at 1, a linear crossfade between
//             neighbours; modulatable), listed in hash epoch 3 with K230's and K071/K072's
//             keys (D2). LFOs of the other shapes and without a reset edge play as before.
// Asserted on the pure crossfade and on the real engine, runtime and transport over
// StudioFakeContext (tests/unit/sequencer-fake-audio.mjs).
//   the panel the MG fixes the shape 'morph' (Morph 0 is the triangle it played) and shows the
//             Morph knob in place of the two-shape switch, its Sync divisions (free by default)
//             and Key sync: a cable switch that patches the Keys Gate into mg.reset and removes
//             it, each one history entry; a cable the user patches there reads as on.
//   node --test tests/unit/synth-mg-sync-morph.test.mjs
// Fails on c74fc6fd (K230): the LFO has no reset input, no 'morph' shape, no morph parameter.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as actions from '../../src/js/studio/actions.js';
import * as lfoMorph from '../../src/js/studio/adapters/modulation.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { patchCable, setCableSwitch, switchEdges } from '../../src/js/synth/normals.js';
import { panelStore } from './synth-fixture.mjs';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const r9 = (x) => Number(x.toFixed(9));
const ok = (r, what = '') => {
  assert.ok(r && r.ok, `${what}${what ? ': ' : ''}${r && (r.reason || JSON.stringify(r.errors))}`);
  return r;
};

function studio() {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const d = (a, what) => ok(st.dispatch(a), what || a.type);
  const add = (nodeType, params = null) => {
    const id = d({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }).created.nodes[0];
    if (params) d({ type: 'NODE_PARAM_SET', nodeId: id, params }, `${nodeType} params`);
    return id;
  };
  const edge = (from, fp, to, tp, props) => d({ type: 'EDGE_ADD', from: { node: from, port: fp },
    to: { node: to, port: tp }, props }, `${from}.${fp} -> ${to}.${tp}`);
  return { st, d, add, edge };
}

function playing(st) {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
    lookAheadS: 3 });
  const started = ok(transport.start(), 'PLAY');
  const sr = fx.ctx.sampleRate;
  const at = (pos) => r9((Math.round(started.baseTime * sr) + Math.round(pos * sr)) / sr);
  return { fx, engine, runtime, transport, at };
}

/** The value an AudioParam of the fake holds after its scheduled events (the last one). */
const held = (param) => (param.events.length ? param.events.at(-1).value : param.value);

const stopped = async (rig) => {
  const p = rig.transport.stop();
  rig.fx.advance(1);
  await p;
  assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
  assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0 after stop');
};

test('K229 the LFO has a reset TRIGGER input, a morph shape and a morph parameter in epoch 3',
  () => {
    const def = NODE_REGISTRY.get('lfo');
    assert.deepEqual(def.inputs.filter((p) => p.type === 'TRIGGER').map((p) => p.id), ['reset']);
    const shape = def.params.find((p) => p.key === 'shape');
    assert.ok(shape.options.some((o) => o[0] === 'morph'), 'a morph shape');
    const morph = def.params.find((p) => p.key === 'morph');
    assert.ok(morph, 'a morph parameter');
    assert.deepEqual([morph.min, morph.max, morph.default, morph.modulatable], [0, 1, 0, true]);
    assert.deepEqual([...schema.HASH_EPOCH_PARAMS[3].lfo], ['morph']);
  });

test('K229 the morph crossfades triangle, sawtooth and square linearly between neighbours', () => {
  const rows = [[0, [1, 0, 0]], [0.25, [0.5, 0.5, 0]], [0.5, [0, 1, 0]], [0.75, [0, 0.5, 0.5]],
    [1, [0, 0, 1]]];
  for (const [m, want] of rows) assert.deepEqual(lfoMorph.morphGains(m).map(r9), want, `m ${m}`);
  // the curves the shapers apply are those gains, over the parameter's whole range
  const curves = lfoMorph.morphCurves(5);
  assert.deepEqual([...curves[0]].map(r9), [1, 0.5, 0, 0, 0]);
  assert.deepEqual([...curves[1]].map(r9), [0, 0.5, 1, 0.5, 0]);
  assert.deepEqual([...curves[2]].map(r9), [0, 0, 0, 0.5, 1]);
});

test('K229 key sync: each trigger on reset starts the LFO afresh at its time; the rate still '
  + 'drives it; census 0 after stop', async () => {
    const s = studio();
    const clock = s.add('clock', { division: '1/4' }); // every 0.5 s at 120 BPM
    const lfo = s.add('lfo', { shape: 'sine', rate: 3 });
    const osc = s.add('oscillator', { waveform: 'sine' });
    const out = s.add('master');
    s.edge(clock, 'trigger', lfo, 'reset');
    s.edge(lfo, 'control', osc, 'frequency', { depth: 0.1 });
    s.edge(osc, 'audio', out, 'audio');
    const env = s.add('envelope');
    const track = s.d({ type: 'TRACK_ADD', kind: 'event', target: env }).created.tracks[0];
    s.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 1.9, duration: 0.1,
      payload: { action: 'gate' } }); // the timeline's length
    const rig = playing(s.st);
    const h = rig.runtime.nodes.get(lfo);
    assert.equal(typeof h.clock, 'function', 'a reset edge makes the LFO reset-capable');
    const starts = h.info.voices().map((v) => r9(v.start));
    assert.deepEqual(starts.slice(-4), [0, 0.5, 1, 1.5].map(rig.at),
      'a fresh voice from each reset (the first at the start of play)');
    // one shared rate source drives every voice: its offset holds the rate
    assert.equal(held(h.info.rate.offset), 3);
    await stopped(rig);
  });

test('K229 a morph LFO sums the three shapes through gains the morph drives', async () => {
  const s = studio();
  const lfo = s.add('lfo', { shape: 'morph', morph: 0.25, rate: 2 });
  const osc = s.add('oscillator', { waveform: 'sine' });
  const out = s.add('master');
  s.edge(lfo, 'control', osc, 'frequency', { depth: 0.1 });
  s.edge(osc, 'audio', out, 'audio');
  const env = s.add('envelope');
  const track = s.d({ type: 'TRACK_ADD', kind: 'event', target: env }).created.tracks[0];
  s.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.9, duration: 0.1,
    payload: { action: 'gate' } });
  const rig = playing(s.st);
  const h = rig.runtime.nodes.get(lfo);
  const v = h.info.voices();
  assert.equal(v.length, 1, 'one voice without a reset');
  assert.deepEqual(v[0].types, ['triangle', 'sawtooth', 'square']);
  assert.equal(held(h.info.morph.offset), 0.25, 'the morph source holds the parameter');
  await stopped(rig);
});

test('K229 an LFO of another shape and without a reset edge plays its one oscillator as before',
  async () => {
    const s = studio();
    const lfo = s.add('lfo', { shape: 'triangle', rate: 4 });
    const osc = s.add('oscillator', { waveform: 'sine' });
    const out = s.add('master');
    s.edge(lfo, 'control', osc, 'frequency', { depth: 0.1 });
    s.edge(osc, 'audio', out, 'audio');
    const env = s.add('envelope');
    const track = s.d({ type: 'TRACK_ADD', kind: 'event', target: env }).created.tracks[0];
    s.d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.9, duration: 0.1,
      payload: { action: 'gate' } });
    const rig = playing(s.st);
    const h = rig.runtime.nodes.get(lfo);
    assert.ok(h.info.oscillator, 'the one oscillator, as before');
    assert.equal(h.info.oscillator.type, 'triangle');
    assert.equal(typeof h.clock, 'undefined', 'no reset: not clocked');
    await stopped(rig);
  });

// ---------------------------------------------------------------- the panel

test('K229 the panel MG: Morph in place of the shape switch, Sync unfixed, Key sync on its face',
  () => {
    const face = PANEL.faceOf('mg').map((c) => `${c.key}:${c.kind}`);
    assert.deepEqual(face, ['rate:knob', 'sync:switch', 'morph:knob', 'keysync:cable']);
    assert.deepEqual(PANEL.fixedOf('mg').map((f) => [f.key, f.value]),
      [['depth', 1], ['shape', 'morph']]);
    const sync = PANEL.faceOf('mg').find((c) => c.key === 'sync');
    assert.deepEqual(sync.param.options.map((o) => o[0]),
      NODE_REGISTRY.param('lfo', 'sync').options.map((o) => o[0]), 'every division');
    assert.equal(sync.initial, 'off', 'free by default');
    assert.equal(PANEL.faceOf('mg').find((c) => c.key === 'morph').initial, 0,
      'Morph 0: the triangle the MG played');
    assert.deepEqual(PANEL.jacksOf('mg').map((j) => j.id),
      ['mg.reset', 'mg.rate', 'mg.morph', 'mg.control']);
  });

test('K229 Key sync patches the Keys Gate into mg.reset and removes it, each one history entry; '
  + 'undo restores the model', () => {
    const st = panelStore();
    const sw = PANEL.cableSwitches.find((x) => x.id === 'keysync');
    const before = st.getModel();
    assert.equal(switchEdges(before, PANEL, sw).length, 0, 'off by default');
    const depth = () => st.debugInfo().undoDepth;
    const d0 = depth();
    const on = setCableSwitch(before, PANEL, sw, true);
    assert.equal(on.action.type, 'BATCH');
    ok(st.dispatch(on.action), 'Key sync on');
    assert.equal(depth(), d0 + 1, 'one history entry');
    const [e] = switchEdges(st.getModel(), PANEL, sw);
    assert.ok(e, 'the Keys Gate into mg.reset');
    assert.equal(setCableSwitch(st.getModel(), PANEL, sw, true).action, undefined,
      'on again changes nothing');
    ok(st.dispatch(setCableSwitch(st.getModel(), PANEL, sw, false).action), 'Key sync off');
    assert.equal(depth(), d0 + 2, 'off is one history entry');
    assert.equal(switchEdges(st.getModel(), PANEL, sw).length, 0);
    ok(st.undo(), 'undo off');
    ok(st.undo(), 'undo on');
    assert.equal(schema.serializeStudio(st.getModel()), schema.serializeStudio(before),
      'undo restores the model exactly');
    // A cable the user patches from the Keys Gate into mg.reset reads as on.
    ok(st.dispatch(patchCable(st.getModel(), PANEL, 'keys.gate', 'mg.reset').action), 'cable');
    assert.equal(switchEdges(st.getModel(), PANEL, sw).length, 1, 'the switch reads on');
  });
