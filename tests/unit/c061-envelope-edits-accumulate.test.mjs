// C061 (M090, coherent-state#live-edits-reach-the-voice): the Envelope node accumulates its live
// parameter changes. The runtime hands update() only the keys that changed (runtime.js,
// node-params: `changed[k]` for the diffed keys), so an adapter that rebuilds its ADSR from the
// creation parameters plus the latest change forgets every earlier edit: attack 1.5 s, then
// decay 0.7 s, and the next gate plays the creation attack while the Inspector says 1.5 s
// (project.no-fake-science). The handle keeps its current parameters instead: each update
// merges into them and every later gate, release and info.adsr() carry all the edits so far.
//   node --test tests/unit/c061-envelope-edits-accumulate.test.mjs
// Fail-first: on the merge base every test here fails, each on the first edit the second one
// dropped (the attack, the sustain or the release at its creation value); the runtime test
// fails the same way through NODE_PARAM_SET and runtime.apply. Nothing here passes without
// the merge.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { DEFAULT_ADSR, ENVELOPE_FLOOR } from '../../src/js/audio/envelope.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { envelope } from '../../src/js/studio/adapters/modulation.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { StudioFakeContext, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const EPS = 1e-9;
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < EPS,
  `${what}: ${actual}, expected ${expected}`);

/** The creation parameters: the registry defaults (DEFAULT_ADSR) unless overridden. */
const creation = (over = {}) => ({ attack: DEFAULT_ADSR.a, decay: DEFAULT_ADSR.d,
  sustain: DEFAULT_ADSR.s, release: DEFAULT_ADSR.r, ...over });

/** An Envelope handle built directly on the recording fake context (no engine, no graph). */
function build(params = creation()) {
  const ctx = new StudioFakeContext({ sampleRate: 48000 });
  const acct = { track: (n) => n, source: (n) => n };
  const h = envelope.create({ ctx, acct, at: 0, params });
  assert.equal(h.status, 'ready');
  return { ctx, h, params: [h.inputs.audio.gain, h.outputs.control.offset] };
}

/**
 * What one gate at t scheduled on a param, read back from the fake's call log after `from`:
 * the attack's end (the one linear ramp, to the peak), the decay's end and its sustain level
 * (the first exponential ramp) and, when the gate had a duration, the release's end (the last
 * exponential ramp, to the floor).
 */
function gateSchedule(param, from) {
  const calls = param.calls.slice(from);
  const linear = calls.filter((c) => c[0] === 'linearRampToValueAtTime');
  const exp = calls.filter((c) => c[0] === 'exponentialRampToValueAtTime');
  assert.equal(linear.length, 1, 'one attack ramp per gate');
  assert.ok(exp.length >= 1, 'a decay ramp per gate');
  const release = exp.length > 1 ? exp[exp.length - 1] : null;
  if (release) assert.equal(release[1], ENVELOPE_FLOOR, 'the release ramps to the floor');
  return { attackEnd: linear[0][2], peak: linear[0][1], decayEnd: exp[0][2],
    sustain: exp[0][1], releaseEnd: release ? release[2] : null };
}

/** Gate the handle at t (for durS seconds when given) and read what it wrote on each param. */
function gateAt({ h, params }, t, durS = null) {
  const from = params.map((p) => p.calls.length);
  h.gate(t, durS);
  return params.map((p, i) => gateSchedule(p, from[i]));
}

/** The schedule of a gate at t is the ADSR `p` (the release only when the gate had durS). */
function expectAdsr(sched, t, p, durS = null) {
  near(sched.attackEnd, t + p.attack, 'attack end');
  assert.equal(sched.peak, 1, 'peak');
  near(sched.decayEnd, t + p.attack + p.decay, 'decay end');
  near(sched.sustain, p.sustain, 'sustain level');
  if (durS != null) near(sched.releaseEnd, t + durS + p.release, 'release end');
}

const adsrOf = (p) => ({ a: p.attack, d: p.decay, s: p.sustain, r: p.release });

test('C061: update({attack: 1.5}) then update({decay: 0.7}): the next gate ramps the attack '
  + 'over 1.5 s and the decay over 0.7 s', () => {
  const s = build();
  const w = {};
  s.h.update({ attack: 1.5 }, new Set(), w);
  s.h.update({ decay: 0.7 }, new Set(), w);
  assert.deepEqual(w, { attack: 'next-gate', decay: 'next-gate' }, 'each edit reported');
  const edited = creation({ attack: 1.5, decay: 0.7 });
  assert.deepEqual(s.h.info.adsr(), adsrOf(edited), 'info.adsr() holds both edits');
  const t = 2;
  const [gain, contour] = gateAt(s, t);
  expectAdsr(gain, t, edited);
  expectAdsr(contour, t, edited);
});

test('C061: sustain and release hold across further updates, and an update of one key leaves '
  + 'every other edited key as last set', () => {
  const s = build();
  s.h.update({ sustain: 0.4 }, new Set(), null);
  s.h.update({ release: 1.2 }, new Set(), null);
  s.h.update({ attack: 0.3 }, new Set(), null);
  s.h.update({ decay: 0.05 }, new Set(), null);
  const edited = { attack: 0.3, decay: 0.05, sustain: 0.4, release: 1.2 };
  assert.deepEqual(s.h.info.adsr(), adsrOf(edited), 'info.adsr() holds all four edits');
  for (const sched of gateAt(s, 1, 0.5)) expectAdsr(sched, 1, edited, 0.5);
  // release(t) on its own uses the edited release as well.
  gateAt(s, 4);
  const from = s.params.map((p) => p.calls.length);
  s.h.release(4.5);
  s.params.forEach((p, i) => {
    const exp = p.calls.slice(from[i]).filter((c) => c[0] === 'exponentialRampToValueAtTime');
    assert.equal(exp.length, 1, 'one release ramp');
    assert.equal(exp[0][1], ENVELOPE_FLOOR, 'to the floor');
    near(exp[0][2], 4.5 + edited.release, 'release end');
  });
});

test('C061: a third edit of the first key replaces it and keeps the second', () => {
  const s = build();
  s.h.update({ attack: 1.5 }, new Set(), null);
  s.h.update({ decay: 0.7 }, new Set(), null);
  s.h.update({ attack: 0.25 }, new Set(), null);
  const once = creation({ attack: 0.25, decay: 0.7 });
  assert.deepEqual(s.h.info.adsr(), adsrOf(once));
  for (const sched of gateAt(s, 3)) expectAdsr(sched, 3, once);
  s.h.update({ attack: 2, sustain: 0.1 }, new Set(), null); // two keys in one update
  const twice = creation({ attack: 2, decay: 0.7, sustain: 0.1 });
  assert.deepEqual(s.h.info.adsr(), adsrOf(twice));
  for (const sched of gateAt(s, 10)) expectAdsr(sched, 10, twice);
});

test('C061: through the runtime, two NODE_PARAM_SET edits of an Envelope both reach its next '
  + 'gate', () => {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const ok = (r) => {
    assert.ok(r.ok, r.reason);
    return r;
  };
  const add = (nodeType) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } })).created.nodes[0];
  const osc = add('oscillator');
  const env = add('envelope');
  const master = add('master');
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: osc, port: 'audio' },
    to: { node: env, port: 'audio' } }));
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: env, port: 'audio' },
    to: { node: master, port: 'audio' } }));
  assert.equal(runtime.apply(store.getModel()).ok, true, 'first apply');
  // While stopped the runtime only stores the plan; start() builds the graph.
  assert.equal(runtime.start().ok, true, 'start');
  const set = (key, value) => {
    ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: env, key, value }));
    assert.equal(runtime.apply(store.getModel()).ok, true, `apply after ${key}`);
  };
  set('attack', 1.5); // the runtime passes update() only { attack }
  set('decay', 0.7); // ... and then only { decay }
  const h = runtime.nodes.get(env);
  assert.ok(h && h.status === 'ready', 'the Envelope handle is live');
  const edited = creation({ attack: 1.5, decay: 0.7 });
  assert.deepEqual(h.info.adsr(), adsrOf(edited), 'the handle holds both edits');
  const gain = h.inputs.audio.gain;
  const from = gain.calls.length;
  const t = fx.ctx.currentTime + 1;
  h.gate(t, null); // what the transport and live notes call on a gate
  expectAdsr(gateSchedule(gain, from), t, edited);
});
