// K207 (K059 criteria 1 and 9): the Contour node type, a gate-driven attack, hold and release
// control with invert (src/js/studio/nodes/instrument.js, adapters/instrument.js), patched into
// a VCO's pitch. On the recording fake context: a gate at t ramps the contour's ConstantSource
// linearly to 1 over Attack; the release starts when the gate ends, but never before the attack
// and Hold have passed, and falls to the envelope floor over Release, every time on the audio
// clock; Invert outputs 1 - x; a Keys gate reaches it as it reaches an Envelope; the census is
// 0 after stop. Negative: a time outside its range and an AUDIO edge into the Gate are refused.
//   node --test tests/unit/synth-vco-contour.test.mjs
// Fail-first: the merge base has no contour type (the word is only an alias of the Envelope),
// so every test here fails there.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { ENVELOPE_FLOOR } from '../../src/js/audio/envelope.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { canConnect } from '../../src/js/studio/ports.js';
import { NODE_REGISTRY, validateNodeDefinition } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { triggerHop } from '../../src/js/studio/trigger-fanout.js';
import { StudioFakeContext, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const EPS = 1e-9;
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < EPS,
  `${what}: ${actual}, expected ${expected}`);
const P = (over = {}) => ({ ...Object.fromEntries(NODE_REGISTRY.get('contour').params
  .map((p) => [p.key, p.default])), ...over });

/** A contour handle on the recording fake context, with a census of what it tracked. */
function build(params = P()) {
  const ctx = new StudioFakeContext({ sampleRate: 48000 });
  const tracked = new Set();
  const sources = new Set();
  const acct = { track: (n) => { tracked.add(n); return n; },
    source: (n) => { sources.add(n); return n; } };
  const h = NODE_ADAPTERS.contour.create({ ctx, acct, at: 0, params, gated: true });
  return { ctx, h, tracked, sources, offset: h.info.contour.offset };
}
const after = (param, from) => param.calls.slice(from);
const ramps = (calls, kind) => calls.filter((c) => c[0] === kind);

test('contour is a registry type with an adapter of its key, found by a search for contour', () => {
  const def = NODE_REGISTRY.get('contour');
  assert.ok(def, 'the contour type exists');
  assert.deepEqual(validateNodeDefinition(def), []);
  assert.equal(NODE_ADAPTERS.contour.compiler, def.compiler);
  assert.deepEqual(NODE_REGISTRY.ports('contour', 'in').map((p) => [p.id, p.type]),
    [['gate', 'TRIGGER']]);
  assert.deepEqual(NODE_REGISTRY.ports('contour', 'out').map((p) => [p.id, p.type]),
    [['control', 'CONTROL']]);
  assert.deepEqual(def.params.map((p) => p.key), ['attack', 'hold', 'release', 'invert']);
  assert.equal(NODE_REGISTRY.search('contour')[0].type, 'contour', 'the quick add lists it first');
});

test('a gate at t: a linear ramp to 1 over Attack, the release after the gate ends', () => {
  const s = build(P({ attack: 0.2, hold: 0, release: 0.5 }));
  const from = s.offset.calls.length;
  s.h.gate(1, null);
  const lin = ramps(after(s.offset, from), 'linearRampToValueAtTime');
  assert.equal(lin.length, 1, 'one attack ramp');
  assert.equal(lin[0][1], 1, 'to 1');
  near(lin[0][2], 1.2, 'the attack ends at t + Attack');
  assert.equal(ramps(after(s.offset, from), 'exponentialRampToValueAtTime')
    .filter((c) => c[1] === ENVELOPE_FLOOR).length, 0, 'no release while the gate is open');
  const r0 = s.offset.calls.length;
  s.h.release(2);
  const rel = ramps(after(s.offset, r0), 'exponentialRampToValueAtTime');
  assert.equal(rel.length, 1, 'one release ramp');
  assert.equal(rel[0][1], ENVELOPE_FLOOR, 'to the envelope floor');
  near(rel[0][2], 2.5, 'the release ends at the gate end + Release');
});

test('Hold: a gate shorter than Attack + Hold releases only once they have passed', () => {
  const s = build(P({ attack: 0.1, hold: 0.4, release: 0.3 }));
  s.h.gate(1, null);
  const r0 = s.offset.calls.length;
  s.h.release(1.05); // a tap: the gate ends inside the attack
  const rel = ramps(after(s.offset, r0), 'exponentialRampToValueAtTime');
  near(rel.at(-1)[2], 1 + 0.1 + 0.4 + 0.3, 'released at t + Attack + Hold, over Release');
  // gate(t, durS), the timeline's form, follows the same rule
  const g0 = s.offset.calls.length;
  s.h.gate(3, 1);
  near(ramps(after(s.offset, g0), 'exponentialRampToValueAtTime').at(-1)[2], 3 + 1 + 0.3,
    'a longer gate releases at its end');
});

test('Invert outputs 1 - x: a bias of 1 and the contour subtracted from it', () => {
  const plain = build(P({ invert: false }));
  assert.equal(plain.h.outputRange.control[0], 0);
  assert.equal(plain.h.outputRange.control[1], 1);
  assert.equal(plain.h.info.bias, null, 'no bias without Invert');
  const inv = build(P({ invert: true }));
  assert.equal(inv.h.info.sign.gain.calls.find((c) => c[0] === 'setValueAtTime')[1], -1);
  assert.equal(inv.h.info.bias.offset.calls.find((c) => c[0] === 'setValueAtTime')[1], 1);
  assert.ok(NODE_ADAPTERS.contour.structural.includes('invert'),
    'Invert rebuilds the node (crossfaded), never a step on a running output');
});

test('a gated contour is built closed: nothing opens before its owner\'s first gate', () => {
  const s = build();
  const lin = ramps(s.offset.calls, 'linearRampToValueAtTime');
  assert.equal(lin.length, 0, 'no attack at creation');
});

test('stop ends every source at the stop time; the handle tracked each node it built', () => {
  const s = build(P({ invert: true }));
  s.h.stop(2);
  assert.equal(s.sources.size, 2, 'the contour and its bias');
  for (const src of s.sources) {
    assert.ok(s.tracked.has(src), 'every source is tracked');
    assert.equal(src.stopAt, 2, 'stopped at the stop time');
  }
});

test('a time outside its range is refused, model and history unchanged; an AUDIO edge into the '
  + 'Gate is refused', () => {
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const id = store.dispatch({ type: 'NODE_ADD', nodeType: 'contour', position: { x: 0, y: 0 } })
    .created.nodes[0];
  for (const [key, value] of [['attack', 0], ['attack', 11], ['hold', -1], ['hold', 11],
    ['release', 0], ['release', 11]]) {
    const before = store.getModel();
    const rev = store.getRevision();
    const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, key, value });
    assert.equal(r.ok, false, `${key} ${value} refused`);
    assert.ok(r.reason, `${key} ${value} says why`);
    assert.equal(store.getModel(), before, 'model unchanged');
    assert.equal(store.getRevision(), rev, 'history unchanged');
  }
  const audioOut = NODE_REGISTRY.ports('vco', 'out')[0];
  const gate = NODE_REGISTRY.ports('contour', 'in').find((p) => p.id === 'gate');
  const c = canConnect(audioOut, gate, { sourceNodeId: 'vco-1', targetNodeId: id });
  assert.equal(c.allowed, false);
  assert.equal(c.code, 'type-mismatch');
  assert.ok(c.reason);
});

/** A Keys gate into a contour, the contour into a VCO's pitch, the VCO into the Master Output. */
function keysContourVco() {
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const ok = (r) => {
    assert.ok(r.ok, r.reason);
    return r;
  };
  const add = (nodeType) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } })).created.nodes[0];
  const keys = add('keys');
  const contour = add('contour');
  const vco = add('vco');
  const master = add('master');
  const edge = (a, ap, b, bp) => ok(store.dispatch({ type: 'EDGE_ADD', from: { node: a, port: ap },
    to: { node: b, port: bp } }));
  edge(keys, 'gate', contour, 'gate');
  edge(contour, 'control', vco, 'pitch');
  edge(vco, 'audio', master, 'audio');
  return { store, keys, contour, vco };
}

test('a Keys gate reaches the contour as it reaches an Envelope (the one fan-out)', () => {
  const { store, keys, contour } = keysContourVco();
  assert.deepEqual(triggerHop(store.getModel(), keys).envelopes, [contour]);
});

test('through the runtime: a contour into a VCO pitch gates on the audio clock and the census is '
  + '0 after stop', async () => {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const { store, contour } = keysContourVco();
  assert.equal(runtime.apply(store.getModel()).ok, true, 'apply');
  assert.equal(runtime.start().ok, true, 'start');
  const h = runtime.nodes.get(contour);
  assert.ok(h && h.status === 'ready', h && h.reason);
  const offset = h.info.contour.offset;
  const from = offset.calls.length;
  const t = fx.ctx.currentTime + 0.5;
  h.gate(t, null);
  near(ramps(after(offset, from), 'linearRampToValueAtTime')[0][2],
    t + NODE_REGISTRY.param('contour', 'attack').default, 'the attack on the audio clock');
  const done = runtime.stop();
  fx.advance(1);
  const c = await done;
  assert.equal(c.nodes, 0, 'no tracked node left');
  assert.equal(c.sources, 0, 'no source left');
});
