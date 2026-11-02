// Review of #332, finding V4 (fixed on #329): the first Arm with no key held must not sound.
// The Keys-gated envelopes are built in the runtime's transaction at t0 = hooks.soon(); the
// transport owns them only after the apply returns. When the main thread stalls inside that
// apply (measured in the browser: connect() blocking), the audio clock passes t0 + attack before
// the transport runs, so an envelope built open has rendered its attack and is then released
// from its full level (about 120 ms at the held level, 6 of 6 stalled runs). The runtime now
// builds an envelope its owner gates closed (setOwnedParams `gated`), whatever the clock does.
// The stall is a fake clock that jumps on connect(), between t0 and the transport's release.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { ENVELOPE_FLOOR, valueAtTime } from '../../src/js/audio/envelope.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const STALL_S = 0.25; // longer than the panel EGs' attack and decay: the attack has rendered

const KINDS = { set: 'set', linear: 'linear', exponential: 'exp' };
/** The fake param's schedule as envelope.js events (time order, call order within a time). */
const eventsOf = (param) => param.events.map((e, i) => ({ ...e, i }))
  .filter((e) => KINDS[e.ramp]).sort((a, b) => a.t - b.t || a.i - b.i)
  .map((e) => ({ kind: KINDS[e.ramp], time: e.t, value: e.value }));
/** The highest value the param takes from t0 on: a schedule of ramps peaks at an event. */
function peakFrom(param, t0) {
  const ev = eventsOf(param);
  let top = valueAtTime(ev, t0, ENVELOPE_FLOOR);
  for (const e of ev) if (e.time >= t0) top = Math.max(top, valueAtTime(ev, e.time, 0));
  return top;
}

/** Arm the panel's live model on the fake engine; `stallS` jumps the clock on connect(). */
function armWith({ stallS, holdSupported }) {
  const fx = createFakeAudioEnv({ sampleRate: 48000, holdSupported });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const st = panelStore();
  const model = st.getModel();
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime, engine, store });
  const ctx = fx.ctx;
  let proto = Object.getPrototypeOf(ctx.destination);
  while (proto && !Object.hasOwn(proto, 'connect')) proto = Object.getPrototypeOf(proto);
  const connect = proto.connect;
  let stalled = false;
  let t0 = null;
  const built = ctx.created.length;
  proto.connect = function stallingConnect(...a) {
    // The first connect after the transaction built its nodes: the main thread stalls here.
    if (!stalled && stallS > 0 && ctx.created.length > built) {
      stalled = true;
      t0 = ctx.currentTime;
      ctx.currentTime += stallS;
    }
    return connect.apply(this, a);
  };
  let r;
  try {
    r = transport.arm();
  } finally {
    proto.connect = connect;
  }
  assert.equal(r.ok, true, r.reason);
  if (stallS > 0) assert.equal(stalled, true, 'the stall happened inside the apply');
  const ids = PANEL.resolve(model);
  const egs = ['eg1', 'eg2'].map((k) => ids.get(k).id);
  return { fx, runtime, transport, egs, keys: ids.get('keys').id, t0: t0 ?? ctx.currentTime };
}

for (const holdSupported of [true, false]) {
  const how = holdSupported ? 'cancelAndHoldAtTime' : 'the Firefox hold emulation';
  test(`V4: a stalled first Arm with no key held leaves every Keys-gated envelope closed (${how})`,
    () => {
      const s = armWith({ stallS: STALL_S, holdSupported });
      assert.deepEqual(new Set(s.transport.debugInfo().gatedEnvelopes), new Set(s.egs));
      for (const id of s.egs) {
        const h = s.runtime.nodes.get(id);
        const vca = h.inputs.audio.gain;
        const contour = h.outputs.control && h.outputs.control.offset;
        assert.ok(peakFrom(vca, 0) <= ENVELOPE_FLOOR * (1 + 1e-9),
          `${id}: the VCA gain opened to ${peakFrom(vca, 0)} with no key held (the attack ran `
          + `during the stall and the release started from it)`);
        if (contour) {
          assert.ok(peakFrom(contour, 0) <= ENVELOPE_FLOOR * (1 + 1e-9),
            `${id}: the contour opened to ${peakFrom(contour, 0)} with no key held`);
        }
      }
    });
}

test('V4: unstalled, the first Arm is closed too, and a key still opens the envelopes', () => {
  const s = armWith({ stallS: 0, holdSupported: true });
  for (const id of s.egs) {
    assert.ok(peakFrom(s.runtime.nodes.get(id).inputs.audio.gain, 0)
      <= ENVELOPE_FLOOR * (1 + 1e-9), `${id} closed at arm`);
  }
  s.fx.advance(0.1);
  const at = s.fx.ctx.currentTime + 0.05;
  const r = s.transport.live(s.keys, { kind: 'on', note: 60, velocity: 100, at });
  assert.equal(r.ok, true, r.reason);
  for (const id of s.egs) {
    assert.ok(peakFrom(s.runtime.nodes.get(id).inputs.audio.gain, at) > 0.5,
      `${id}: the key gates the envelope open`);
  }
});

test('V4: the runtime builds an envelope closed only while its owner says it gates it', () => {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const model = panelStore().getModel();
  const eg = PANEL.resolve(model).get('eg1').id;
  for (const gated of [[eg], []]) {
    const runtime = createStudioRuntime({ engine });
    runtime.setOwnedParams([], { gated });
    assert.equal(runtime.apply(model, { revision: 1 }).ok, true);
    assert.equal(runtime.start().ok, true);
    const peak = peakFrom(runtime.nodes.get(eg).inputs.audio.gain, 0);
    if (gated.length) assert.ok(peak <= ENVELOPE_FLOOR * (1 + 1e-9), `gated: ${peak}`);
    else assert.ok(peak > 0.5, `not gated: the envelope opens at the graph's start (${peak})`);
    runtime.stop({ fast: true });
    fx.advance(0.5);
  }
});
