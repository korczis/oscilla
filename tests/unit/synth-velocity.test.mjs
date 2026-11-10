// K220, review R2-K220-1 of oscilla-c3 (P1, seconded by oscilla-c1): pad R's Y is the touch's
// velocity, so velocity must be heard. The Synth panel's VELOCITY stage (a gain after the VCA,
// base 0) takes the keys' velocity through the typed normal n28 (linear, depth 1.27): velocity
// 100, the keys' default, is gain 1.00, today's level exactly; 127 is +2.08 dB at most (c1's
// bound for a linear law); 40 is audibly lower (-7.96 dB); 1 is quiet, not silent. Pad R's Y at
// 5 % and 95 % plays 6 dB or more apart. A document made before VELOCITY (its e1 from the VCA)
// plays as it did, shows no false cable and no removed module, and adding VELOCITY replaces its
// e1 in one undo entry, leaving one audio path.
// On the merge base there is no VELOCITY module: the panel's gain stage and n28 are missing.

import test from 'node:test';
import assert from 'node:assert/strict';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as xy from '../../src/js/synth/xy.js';
import { brokenByRemoval, jackState, panelCables } from '../../src/js/synth/normals.js';
import { xyVelocity } from '../../src/js/synth/view/xy-wiring.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const last = (p) => (p.events.length ? p.events[p.events.length - 1].value : p.value);
const db = (g) => 20 * Math.log10(g);

/** The default Synth document: the reference template with the panel the Synth inserts. */
function defaultStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  const r = st.dispatch(xy.xyInsertAction(st.getModel(), PANEL, { at: { x: 0, y: 600 } }));
  assert.equal(r.ok, true, r.reason);
  return st;
}

/**
 * The gain VELOCITY plays for a note at velocity v on the running default document: its base
 * plus the keys' velocity output (v / 127) times n28's gain, read from the fake engine.
 */
function velocityGain(v) {
  const st = defaultStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const t = createStudioTransport({ runtime, engine, store: st });
  assert.equal(t.arm().ok, true);
  const res = PANEL.resolve(st.getModel());
  const keys = res.get('keys').id;
  assert.equal(t.live(keys, { kind: 'on', note: 60, velocity: v }).ok, true);
  fx.advance(0.05);
  const vel = runtime.nodes.get(res.get('vel').id);
  const e = st.getModel().graph.edges.find((x) => x.from.node === keys
    && x.from.port === 'velocity' && x.to.node === res.get('vel').id);
  assert.ok(e, 'n28: keys.velocity into VELOCITY Gain');
  const eh = runtime.edges.get(e.id);
  assert.equal(eh.status, 'active');
  const out = runtime.nodes.get(keys).outputs.velocity.offset;
  const base = last(vel.modTarget('gain', 'linear').param);
  t.stop({ fast: true });
  return base + last(eh.gain.gain) * last(out);
}

test('the panel: VELOCITY is a gain after the VCA, the chain\'s head, with n28 linear at 1.27',
  () => {
    const m = PANEL.module('vel');
    assert.ok(m, 'the panel declares VELOCITY');
    assert.equal(m.node, 'gain');
    assert.equal(m.optional, true);
    const n = (id) => PANEL.normals.find((x) => x.id === id);
    assert.deepEqual([n('n27').from, n('n27').to], ['vca.audio', 'vel.audio']);
    assert.equal(n('e1').from, 'vel.audio', 'the engines\' chain starts after VELOCITY');
    assert.deepEqual([n('n28').from, n('n28').to, n('n28').props.mapping, n('n28').props.depth],
      ['keys.velocity', 'vel.gain', 'linear', 1.27]);
    const doc = defaultStore().getModel();
    const vca = PANEL.resolve(doc).get('vca').id;
    assert.deepEqual(doc.graph.edges.filter((e) => e.from.node === vca && e.from.port === 'audio')
      .map((e) => e.to.node), [PANEL.resolve(doc).get('vel').id], 'one audio path');
  });

test('velocity 100 keeps today\'s level; 127 at most +2.08 dB; 40 audibly lower; 1 not silent',
  () => {
    const g100 = velocityGain(100);
    assert.ok(Math.abs(db(g100)) <= 0.5, `v 100: ${db(g100)} dB (today's level: gain 1)`);
    assert.ok(Math.abs(g100 - 1) < 1e-9, `v 100 is gain 1.00 exactly: ${g100}`);
    const g127 = velocityGain(127);
    assert.ok(db(g127) - db(g100) <= 20 * Math.log10(127 / 100) + 1e-9,
      `v 127: ${db(g127) - db(g100)} dB over v 100`);
    const g40 = velocityGain(40);
    assert.ok(db(g100) - db(g40) >= 6, `v 40: ${db(g40) - db(g100)} dB`);
    const g1 = velocityGain(1);
    assert.ok(g1 > 0, 'velocity 1 is quiet, not silent');
  });

test('pad R\'s Y at 5 % and 95 % plays 6 dB or more apart (c3\'s measurement as the test)', () => {
  const lo = velocityGain(xyVelocity(0.05));
  const hi = velocityGain(xyVelocity(0.95));
  assert.ok(db(hi) - db(lo) >= 6, `${db(hi) - db(lo)} dB`);
});

test('a document made before VELOCITY: no false cable, no removed module; adding it replaces its '
  + 'e1 in one undo entry, one audio path', () => {
  const st = defaultStore();
  const res = PANEL.resolve(st.getModel());
  const vca = res.get('vca').id;
  const additive = res.get('additive').id;
  // A pre-K220 document: no VELOCITY, and e1 (its id) from the VCA into the chain.
  assert.equal(st.dispatch({ type: 'NODE_REMOVE', nodeId: res.get('vel').id }).ok, true);
  const r = st.dispatch({ type: 'EDGE_ADD', id: `${PANEL.instance}-e1`,
    from: { node: vca, port: 'audio' }, to: { node: additive, port: 'thru' } });
  assert.equal(r.ok, true, r.reason);
  const old = st.getModel();
  assert.deepEqual(panelCables(old, PANEL), [], 'the older e1 is the normal, not a user cable');
  assert.deepEqual(brokenByRemoval(old, PANEL), [], 'no module reads as removed');
  assert.equal(jackState(old, PANEL, 'additive.thru'), 'normalled');
  // Přidat VELOCITY: the Synth's own path (synth/ui.js restoreModule -> panel.restoreAction),
  // one undo entry named as the button is (review R2-K220-4); the panel's insert does the same.
  const depth = st.debugInfo().undoDepth;
  const ins = PANEL.restoreAction(old, 'vel');
  assert.equal(ins.label, 'Přidat VELOCITY');
  assert.equal(PANEL.restoreAction(old, 'eg2').label, 'Obnovit EG 2', 'a removed module');
  assert.equal(PANEL.instantiate(old).steps.filter((x) => x.type === 'EDGE_REMOVE').length, 1,
    'the panel\'s insert replaces the older e1 too');
  assert.equal(st.dispatch(ins).ok, true);
  assert.equal(st.debugInfo().undoDepth, depth + 1);
  const now = st.getModel();
  const vel = PANEL.resolve(now).get('vel').id;
  assert.deepEqual(now.graph.edges.filter((e) => e.from.node === vca && e.from.port === 'audio')
    .map((e) => e.to.node), [vel], 'the VCA feeds VELOCITY only: one audio path');
  const e1 = now.graph.edges.find((e) => e.id === `${PANEL.instance}-e1`);
  assert.deepEqual([e1.from.node, e1.to.node], [vel, additive], 'e1 as declared');
  assert.equal(jackState(now, PANEL, 'vel.gain'), 'normalled', 'n28 added');
});

test('review C1-K220-2: a velocity change under a sounding note glides in, never a step on '
  + 'VELOCITY\'s path', async () => {
  const instrument = await import('../../src/js/studio/adapters/instrument.js');
  assert.ok(instrument.VELOCITY_TAU_S > 0 && instrument.VELOCITY_TAU_S <= 0.005,
    'adapters/instrument.js VELOCITY_TAU_S: a few ms');
  const st = defaultStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const t = createStudioTransport({ runtime, engine, store: st });
  assert.equal(t.arm().ok, true);
  const keys = PANEL.resolve(st.getModel()).get('keys').id;
  const out = runtime.nodes.get(keys).outputs.velocity.offset;
  assert.equal(t.live(keys, { kind: 'on', note: 60, velocity: 100 }).ok, true);
  fx.advance(0.2); // the note sounds through the VCA and VELOCITY
  const n0 = out.events.length;
  assert.equal(t.live(keys, { kind: 'on', note: 64, velocity: 40 }).ok, true); // legato
  const added = out.events.slice(n0);
  assert.ok(added.length > 0, 'the second note writes its velocity');
  assert.deepEqual(added.filter((e) => e.ramp === 'set'), [], 'no step under the sounding note');
  const g = added.find((e) => e.ramp === 'target');
  assert.ok(g && Math.abs(g.value - 40 / 127) < 1e-12 && g.tau === instrument.VELOCITY_TAU_S,
    JSON.stringify(added));
  t.stop({ fast: true });
});

test('review R2-K220-5: a Keys gate clip (K060), which plays no note, sounds at today\'s level: '
  + 'the velocity rests at 100, and a gate after a note returns to it', async () => {
  const instrument = await import('../../src/js/studio/adapters/instrument.js');
  assert.ok(Math.abs(instrument.KEYS_REST_VELOCITY - 100 / 127) < 1e-12,
    'adapters/instrument.js KEYS_REST_VELOCITY: the keys\' default, 100');
  const st = defaultStore();
  const res = PANEL.resolve(st.getModel());
  const keys = res.get('keys').id;
  const track = st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }).created.tracks[0];
  assert.ok(st.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.5,
    duration: 1, payload: { action: 'gate' } }).ok);
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const t = createStudioTransport({ runtime, engine, store: st });
  const vel = () => runtime.nodes.get(res.get('vel').id);
  // Before any note: the velocity output starts at rest, so VELOCITY is gain 1.00.
  assert.equal(t.arm().ok, true);
  const out = runtime.nodes.get(keys).outputs.velocity.offset;
  const e = st.getModel().graph.edges.find((x) => x.from.node === keys
    && x.from.port === 'velocity');
  const gain = (v) => last(vel().modTarget('gain', 'linear').param)
    + last(runtime.edges.get(e.id).gain.gain) * v;
  assert.ok(Math.abs(gain(out.events[0].value) - 1) < 1e-9,
    `at rest VELOCITY is gain 1.00: ${gain(out.events[0].value)}`);
  // A note at 40, then the gate clip: its velocity glides back to rest at the clip's start.
  assert.equal(t.live(keys, { kind: 'on', note: 60, velocity: 40 }).ok, true);
  assert.equal(t.live(keys, { kind: 'off', note: 60 }).ok, true);
  t.stop({ fast: true });
  fx.advance(0.5);
  assert.equal(t.start().ok, true);
  fx.advance(0.4);
  const g = runtime.nodes.get(keys).outputs.velocity.offset.events.filter((x) => x.ramp === 'target')
    .at(-1);
  assert.ok(g && Math.abs(gain(g.value) - 1) < 1e-9, `the gate clip plays at gain 1.00: ${
    JSON.stringify(g)}`);
  t.stop({ fast: true });
  fx.advance(0.5);
});
