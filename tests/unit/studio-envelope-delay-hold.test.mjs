// K230 (M067): the Studio envelope gets a delay stage (from the gate to the start of the attack)
// and a hold stage (at the peak, before the decay): DADSR and AHDSR. Both default to 0, where the
// envelope is exactly today's ADSR; both are new parameters on an existing type, so they are
// listed in hash epoch 3 (schema.js HASH_EPOCH_PARAMS, shared with K071/K072 and K229, D2).
// audio/envelope.js schedules them (adsrEvents: a flat 'set' for the delay, a flat 'linear' at the
// peak for the hold, each only when it is longer than 0), and every reader of the envelope's
// length reads them: a gate ending inside the delay schedules no attack and a release, one ending
// inside the hold releases from the peak, and a trigger pulse holds delay + attack + hold + decay
// (transport.js pulseS). Asserted on the pure schedule and on the real engine, runtime and
// transport over StudioFakeContext (tests/unit/sequencer-fake-audio.mjs).
//   node --test tests/unit/studio-envelope-delay-hold.test.mjs
// Fails on 0410c679 (hash epoch 3): the envelope has no delay or hold parameter, adsrEvents
// ignores them, and a trigger pulse holds attack + decay only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as env from '../../src/js/audio/envelope.js';
import * as actions from '../../src/js/studio/actions.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as transportModule from '../../src/js/studio/transport.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const r9 = (x) => Number(x.toFixed(9));
const ADSR = { a: 0.01, d: 0.05, s: 0.5, r: 0.02 };
const ok = (r, what = '') => {
  assert.ok(r && r.ok, `${what}${what ? ': ' : ''}${r && (r.reason || JSON.stringify(r.errors))}`);
  return r;
};

test('K230 the envelope declares delay and hold, 0 to 10 s, default 0, in hash epoch 3', () => {
  const def = NODE_REGISTRY.get('envelope');
  for (const key of ['delay', 'hold']) {
    const p = def.params.find((x) => x.key === key);
    assert.ok(p, `envelope.${key} is declared`);
    assert.deepEqual([p.min, p.max, p.default, p.unit], [0, 10, 0, 's'], key);
  }
  assert.deepEqual([...schema.HASH_EPOCH_PARAMS[3].envelope].sort(), ['delay', 'hold']);
});

test('K230 delay 0 and hold 0 schedule exactly today\'s ADSR', () => {
  assert.deepEqual(env.adsrEvents(1, { ...ADSR, delay: 0, hold: 0 }), [
    { kind: 'set', time: 1, value: env.ENVELOPE_FLOOR },
    { kind: 'linear', time: 1 + ADSR.a, value: 1 },
    { kind: 'exp', time: 1 + ADSR.a + ADSR.d, value: ADSR.s },
  ]);
  assert.deepEqual(env.adsrEvents(1, { ...ADSR, delay: 0, hold: 0 }), env.adsrEvents(1, ADSR));
});

test('K230 a delay moves the attack after the gate; a hold keeps the peak before the decay', () => {
  const d = env.adsrEvents(1, { ...ADSR, delay: 0.2 });
  assert.deepEqual(d.map((e) => [e.kind, r9(e.time), e.value]), [
    ['set', 1, env.ENVELOPE_FLOOR], ['set', 1.2, env.ENVELOPE_FLOOR], ['linear', r9(1.21), 1],
    ['exp', r9(1.26), ADSR.s]]);
  const h = env.adsrEvents(1, { ...ADSR, hold: 0.3 });
  assert.deepEqual(h.map((e) => [e.kind, r9(e.time), e.value]), [
    ['set', 1, env.ENVELOPE_FLOOR], ['linear', r9(1.01), 1], ['linear', r9(1.31), 1],
    ['exp', r9(1.36), ADSR.s]]);
  // the level: at the floor through the delay, at the peak through the hold
  assert.equal(env.valueAtTime(d, 1.15), env.ENVELOPE_FLOOR);
  assert.equal(env.valueAtTime(h, 1.2), 1);
});

test('K230 a gate ending in the delay schedules no attack; one ending in the hold releases from '
  + 'the peak', () => {
  const inDelay = env.releaseEvents(env.adsrEvents(1, { ...ADSR, delay: 0.2 }), 1.1, ADSR.r);
  assert.ok(!inDelay.events.some((e) => e.kind === 'linear'), 'no attack is left');
  assert.equal(inDelay.value, env.ENVELOPE_FLOOR, 'released from the floor');
  const inHold = env.releaseEvents(env.adsrEvents(1, { ...ADSR, hold: 0.3 }), 1.2, ADSR.r);
  assert.equal(inHold.value, 1, 'released from the peak');
  assert.equal(inHold.events.at(-1).kind, 'exp');
});

test('K230 a trigger pulse on the Studio envelope holds delay + attack + hold + decay, then '
  + 'releases; the attack starts after the delay', async () => {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const d = (a, what) => ok(st.dispatch(a), what || a.type);
  const add = (nodeType, params) => {
    const id = d({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }).created.nodes[0];
    if (params) d({ type: 'NODE_PARAM_SET', nodeId: id, params });
    return id;
  };
  const osc = add('oscillator', { waveform: 'sine' });
  const e = add('envelope', { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.02,
    delay: 0.1, hold: 0.2 });
  const out = add('master');
  for (const [a, ap, b, bp] of [[osc, 'audio', e, 'audio'], [e, 'audio', out, 'audio']]) {
    d({ type: 'EDGE_ADD', from: { node: a, port: ap }, to: { node: b, port: bp } });
  }
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: e }).created.tracks[0];
  d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.5, duration: 0.1,
    payload: { action: 'trigger' } });
  d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 1.9, duration: 0.1,
    payload: { action: 'gate' } }); // the timeline's length
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: st,
    lookAheadS: 3 });
  const started = ok(transport.start(), 'PLAY');
  const sr = fx.ctx.sampleRate;
  const at = (pos) => (Math.round(started.baseTime * sr) + Math.round(pos * sr)) / sr;
  const vca = runtime.nodes.get(e).inputs.audio.gain;
  const t0 = at(0.5);
  const attack = vca.events.find((x) => x.ramp === 'linear' && x.value === 1 && x.t > t0);
  assert.ok(attack, 'the trigger attacks');
  assert.equal(r9(attack.t), r9(t0 + 0.1 + 0.01), 'the attack peaks at gate + delay + attack');
  const release = vca.events.find((x) => x.ramp === 'exponential' && x.value < 0.001
    && x.t > t0);
  assert.equal(r9(release.t - 0.02), r9(t0 + 0.1 + 0.01 + 0.2 + 0.05),
    'the pulse holds delay + attack + hold + decay, then releases');
  const p = transport.stop();
  fx.advance(1);
  await p;
  assert.equal(engine.activeNodeCount, 0, 'engine node census 0 after stop');
});

test('K230 on the Synth panel EG 1 shows Delay and EG 2 Hold; the other stage is fixed at 0', () => {
  const keys = (mid) => PANEL.faceOf(mid).map((c) => c.key);
  assert.ok(keys('eg1').includes('delay') && !keys('eg1').includes('hold'), `EG 1: ${keys('eg1')}`);
  assert.ok(keys('eg2').includes('hold') && !keys('eg2').includes('delay'), `EG 2: ${keys('eg2')}`);
  assert.deepEqual(PANEL.fixedOf('eg1').map((f) => [f.key, f.value]), [['hold', 0]]);
  assert.deepEqual(PANEL.fixedOf('eg2').map((f) => [f.key, f.value]), [['delay', 0]]);
});
