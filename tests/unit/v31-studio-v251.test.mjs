// V251 audit of the Studio scheduling paths: events meant to coincide keep the order of the calls.
//   node --test tests/unit/v31-studio-v251.test.mjs
//
// The engine bug (voice.js coherentTime, #46): two events meant to coincide, computed through
// different float sums ((t0 + t) + dur against t0 + (t + dur)), differ by an ulp; a param orders
// its events by time, so a later call placed one ulp BEFORE an earlier ramp's end makes that
// ramp collapse (a release becomes a cut, a sweep holds then jumps).
//
// The Studio does compute coinciding boundaries through different sums: a gate's end is handed
// to the Envelope as start + (end - start), a pattern clip ends at startTime + its duration while
// the next clip starts at its own whole frame, STOP lands on k × (128 / sampleRate) while lanes
// sit on whole frames n / sampleRate. These tests drive the real transport on the recording fake
// context, check that such near-coincident events really occur (the hazard is exercised), and
// that none of them inverts a ramp: every Studio path that can meet another one on a param
// either re-ends in place and cancels what follows (envelope.js holdAt, adapters/ramp.js, the
// claim fades, applyAutomation with cancelFrom), or computes its times as whole frames from one
// integer sum (timeline-compiler.js audioTimeOf / passInfo, automation lanes, loop passes).
// Removing envelope.js's cancel-from-t makes the gate tests below fail with inversions.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const NEAR_S = 1e-6;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

function setup(model, { sampleRate = 48000, holdSupported = false, clock = 0 } = {}) {
  const fx = createFakeAudioEnv({ sampleRate, holdSupported });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime, engine, store });
  if (clock) fx.advance(clock);
  return { fx, engine, runtime, store, transport };
}

const timeOf = (c) => (c[0].startsWith('cancel') ? c[1] : c[2]);

/**
 * The schedule a param ends with (calls replayed, cancels applied), in the browser's order: time,
 * then insertion. Returns the pairs where a ramp called earlier sits just after an event called
 * later — the ramp that collapses.
 */
function inversions(param) {
  let ev = [];
  param.calls.forEach((c, i) => {
    if (c[0] === 'cancelScheduledValues' || c[0] === 'cancelAndHoldAtTime') {
      ev = ev.filter((e) => e.t < c[1]);
    } else ev.push({ m: c[0], t: c[2], i });
  });
  ev.sort((a, b) => a.t - b.t || a.i - b.i);
  const out = [];
  for (let j = 1; j < ev.length; j++) {
    const a = ev[j - 1];
    const b = ev[j];
    if (/Ramp/.test(b.m) && b.i < a.i && b.t > a.t && b.t - a.t < NEAR_S) out.push([a, b]);
  }
  return out;
}

/** Calls on a param whose times differ by less than NEAR_S without being equal. */
function nearPairs(param) {
  const ts = param.calls.map(timeOf).sort((a, b) => a - b);
  let n = 0;
  for (let i = 1; i < ts.length; i++) if (ts[i] !== ts[i - 1] && ts[i] - ts[i - 1] < NEAR_S) n++;
  return n;
}

const envParams = (s, id) => {
  const h = s.runtime.nodes.get(id);
  return [h.inputs.audio.gain, h.outputs.control.offset];
};

/** Back-to-back durations (ms) whose sums put boundaries where the float sums disagree. */
const DURS_MS = [110, 37, 113, 110, 61, 89, 110, 151, 43, 110, 127, 71];

function gateModel() {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const d = (a) => ok(store.dispatch(a));
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: 'env-1' }).created.tracks[0];
  let t = 0.137;
  for (let i = 0; i < 48; i++) {
    const duration = DURS_MS[i % DURS_MS.length] / 1000;
    d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: t, duration,
      payload: { action: 'gate' } });
    t += duration;
  }
  return store.getModel();
}

function sequenceTriggerModel() {
  const store = createStudioStore(null, { idGenerator: createIdGenerator() });
  const d = (a) => ok(store.dispatch(a));
  const seq = d({ type: 'NODE_ADD', nodeType: 'sequence' }).created.nodes[0];
  const env = d({ type: 'NODE_ADD', nodeType: 'envelope' }).created.nodes[0];
  const master = d({ type: 'NODE_ADD', nodeType: 'master' }).created.nodes[0];
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'audio' }, to: { node: env, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: env, port: 'audio' }, to: { node: master, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'trigger' }, to: { node: env, port: 'gate' } });
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: seq }).created.tracks[0];
  const payloads = [{ blockType: 'tone', params: { freq: 440 } },
    { blockType: 'pulse', params: { freq: 330, pulseMs: 40, pauseMs: 0 } },
    { blockType: 'sweep', params: { start: 200, end: 900, curve: 'log' } }];
  let t = 0.211;
  for (let i = 0; i < 36; i++) {
    const duration = (DURS_MS[i % DURS_MS.length] + 100) / 1000;
    d({ type: 'CLIP_ADD', trackId: track, start: t, duration, payload: payloads[i % 3] });
    t += duration;
  }
  return { model: store.getModel(), seq, env };
}

for (const holdSupported of [false, true]) {
  const how = holdSupported ? 'cancelAndHoldAtTime' : 'the hold emulation';
  test(`back-to-back gate clips: no gate lands before the previous release (${how})`, () => {
    let near = 0;
    for (const sampleRate of [44100, 48000]) {
      for (let k = 0; k < 16; k++) {
        const clock = k * 0.0173;
        const s = setup(gateModel(), { sampleRate, holdSupported, clock });
        ok(s.transport.start());
        const params = envParams(s, 'env-1');
        s.fx.advance(5);
        s.transport.stop();
        s.fx.advance(1);
        for (const p of params) {
          near += nearPairs(p);
          assert.deepEqual(inversions(p), [], `${sampleRate} Hz, clock ${clock}`);
        }
      }
    }
    assert.ok(near > 0, 'gate ends and the next gate starts do differ by an ulp');
  });

  test(`back-to-back pattern clips gate their Envelope without an inversion (${how})`, () => {
    let near = 0;
    for (const sampleRate of [44100, 48000]) {
      for (const clock of [0, 0.5173]) {
        const { model, env } = sequenceTriggerModel();
        const s = setup(model, { sampleRate, holdSupported, clock });
        ok(s.transport.start());
        const params = envParams(s, env);
        s.fx.advance(6);
        s.transport.stop();
        s.fx.advance(1);
        for (const p of params) {
          near += nearPairs(p);
          assert.deepEqual(inversions(p), [], `${sampleRate} Hz, clock ${clock}`);
        }
        // Every pattern voice's own params: one sum (start + t) per event, in time order.
        for (const o of s.fx.ctx.created) {
          for (const k of ['gain', 'frequency']) {
            if (o[k] && o[k].calls) assert.deepEqual(inversions(o[k]), [], `voice ${o.kind}.${k}`);
          }
        }
      }
    }
    assert.ok(near > 0, 'a clip end (startTime + duration) and the next start differ by an ulp');
  });
}

test('loop passes: the boundary ramp of a pass and the next anchor are the same float', () => {
  for (const sampleRate of [44100, 48000]) {
    const model = templateModel(REFERENCE_TEMPLATE_ID);
    const s = setup(model, { sampleRate, clock: 0.2309 });
    ok(s.store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0.173, end: 1.391 }));
    ok(s.transport.start());
    s.fx.advance(12); // ten passes
    const fp = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
    assert.deepEqual(inversions(fp), []);
    assert.equal(nearPairs(fp), 0, 'lane events are whole frames from one integer sum');
    const ramps = fp.calls.filter((c) => c[0] === 'exponentialRampToValueAtTime').map((c) => c[2]);
    const anchors = new Set(fp.calls.filter((c) => c[0] === 'setValueAtTime').map((c) => c[2]));
    const ends = ramps.filter((t) => anchors.has(t));
    assert.ok(ends.length >= 8,
      `each pass end is the next pass anchor, bit for bit (${ends.length})`);
  }
});

test('two paths on one param: a level lane and the pattern claim fades keep their order', () => {
  // osc-1 level is driven by its automation lane (applyAutomation, whole frames) AND, each time
  // a pattern clip starts or stops playing the oscillator, by the claim fades (claimOscillator /
  // releaseClaim at hooks.soon(), a render-quantum multiple) and the lane's rebind at the safe
  // horizon — three time representations on the same AudioParam.
  for (const holdSupported of [false, true]) {
    const model = templateModel(REFERENCE_TEMPLATE_ID);
    const st = createStudioStore(model, { idGenerator: createIdGenerator(model) });
    ok(st.dispatch({ type: 'CLIP_REMOVE', clipId: 'clip-1' }));
    ok(st.dispatch({ type: 'CLIP_REMOVE', clipId: 'clip-2' }));
    let t = 0;
    for (let i = 0; i < 16; i++) {
      t += DURS_MS[i % DURS_MS.length] / 400;
      ok(st.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'level' },
        time: t, value: (i % 5) / 5, curve: i % 2 ? 'step' : 'linear' }));
    }
    const s = setup(st.getModel(), { holdSupported, clock: 0.4441 });
    ok(s.transport.start());
    const level = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
    let clipId = null;
    for (let k = 0; k < 8; k++) {
      s.fx.advance(0.37 + k * 0.11);
      if (clipId) {
        ok(s.store.dispatch({ type: 'CLIP_REMOVE', clipId }));
        clipId = null;
      } else {
        clipId = ok(s.store.dispatch({ type: 'CLIP_ADD', trackId: 'track-1', start: 0,
          duration: 8, payload: { blockType: 'tone', params: { freq: 330 } } })).created.clips[0];
      }
      s.transport.sync();
    }
    s.transport.stop();
    s.fx.advance(1);
    const methods = new Set(level.calls.map((c) => c[0]));
    assert.ok(methods.has('linearRampToValueAtTime') && methods.has('cancelScheduledValues'),
      'the lane and the claim fades both reached the AudioParam');
    assert.ok(level.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1e-4),
      'the claim faded the carrier level');
    assert.deepEqual(inversions(level), [], `level.gain (hold ${holdSupported})`);
  }
});

test('two paths on one param: gates and the STOP rebuild on the Envelope keep their order', () => {
  // Gate clips (transport addGate → envelope.gate) and STOP (scheduler.stop → rebuildEnvelope:
  // hold / release at k × 128 / sampleRate) meet on the same VCA gain and contour offset.
  let near = 0;
  for (const holdSupported of [false, true]) {
    for (let k = 0; k < 40; k++) {
      const s = setup(gateModel(), { holdSupported, clock: 0.1 + k * 0.0371 });
      ok(s.transport.start());
      const params = envParams(s, 'env-1');
      s.fx.advance(0.5 + k * 0.0913);
      s.transport.stop();
      s.fx.advance(1);
      for (const p of params) {
        near += nearPairs(p);
        assert.deepEqual(inversions(p), [], `stop ${k} (hold ${holdSupported})`);
      }
    }
  }
  assert.ok(near > 0, 'the hazard is exercised');
});
