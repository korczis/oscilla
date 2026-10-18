// V272 final review, the transport lifecycle findings (src/js/studio/transport.js,
// timeline-compiler.js edit(), measurement-run.js, offline.js, the Envelope / Random / Step
// Modulator adapters): on the real AudioEngine with the recording fake AudioContext
// (sequencer-fake-audio.mjs createFakeAudioEnv), as tests/unit/v31-studio-transport.test.mjs.
//   node --test tests/unit/v272-transport-lifecycle.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { getSchedule, valueAtTime } from '../../src/js/audio/envelope.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioMeasurementRun } from '../../src/js/studio/measurement-run.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

/** A transport on the store's commit gate, as the Studio workspace wires it. */
function setup(model = templateModel(REFERENCE_TEMPLATE_ID), { onMeasurement = null } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  let transport = null;
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime, engine, store,
    onMeasurement: (ev) => (onMeasurement ? onMeasurement(ev) : null) });
  return { fx, engine, runtime, store, transport, ctx: fx.ctx };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));

/** A gate track on the reference template's Envelope with gate clips at `starts`. */
function gateClips(s, starts, duration) {
  dispatch(s, { type: 'TRACK_ADD', kind: 'event', target: 'env-1', name: 'Gate' });
  const trackId = s.store.getModel().timeline.tracks.at(-1).id;
  for (const start of starts) {
    dispatch(s, { type: 'CLIP_ADD', trackId, kind: 'event', start, duration,
      payload: { action: 'gate' } });
  }
  return trackId;
}

// ---------------------------------------------------------------- B1

test('V272 B1: PLAY before the previous STOP resolved keeps the new playback alive', async () => {
  const s = setup();
  gateClips(s, [0, 0.6, 1.2], 0.4);
  ok(s.transport.start());
  s.fx.advance(0.5);
  const stopping = s.transport.stop(); // not awaited: Space pressed again at once
  const mark = s.ctx.oscillators.length; // the old playback's voices are before it
  const r2 = ok(s.transport.start());
  s.fx.advance(0.02);
  const before = s.transport.debugInfo();
  assert.equal(before.voiceCount, 1, 'the new playback plays its first clip');
  assert.ok(before.gateCount >= 1, 'and gates its envelope');
  const fresh = s.ctx.oscillators.slice(mark).filter((o) => o.startAt !== null);
  assert.ok(fresh.length >= 1);
  s.fx.advance(0.3); // the old stop's fade and cleanup run
  await stopping;
  const after = s.transport.debugInfo();
  assert.equal(after.playing, true);
  assert.equal(after.voiceCount, before.voiceCount, 'the old STOP left the new voices alone');
  assert.equal(after.gateCount, before.gateCount, 'and the new gate records');
  const now = s.ctx.currentTime;
  const cut = fresh.filter((o) => o.stopAt !== null && o.stopAt <= now);
  assert.deepEqual(cut.map((o) => [o.startAt, o.stopAt]), [],
    'no source of the new playback is stopped before its clip ends');
  assert.ok(r2.baseTime > 0);
});

// ---------------------------------------------------------------- B2, B5

/** Let the measurement run's promises settle (its run() is synchronous here). */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function measureWith(edit) {
  const runs = [];
  const states = [];
  let mr = null;
  const s = setup(templateModel(MEASUREMENT_TEMPLATE_ID), { onMeasurement: (ev) => mr.hook(ev) });
  mr = createStudioMeasurementRun({
    getModel: () => s.store.getModel(), sampleRate: () => SR, now: () => s.ctx.currentTime,
    run: async (recipe, m, o) => {
      runs.push(o);
      return { ok: true, experimentId: 'x' };
    },
    stopStudio: () => s.transport.stop({ fast: true }), timers: s.fx.env,
    onChange: (v) => states.push(v.state),
  });
  // A 2 s lead-in before the measurement clips (moved last first, so none overlaps).
  for (const c of [...s.store.getModel().timeline.clips].sort((a, b) => b.start - a.start)) {
    dispatch(s, { type: 'CLIP_MOVE', clipId: c.id, start: c.start + 2 });
  }
  const r = ok(s.transport.start());
  while (mr.view.state !== 'pending' && s.ctx.currentTime < r.baseTime + 1.9) s.fx.advance(0.005);
  assert.equal(mr.view.state, 'pending', 'the hand-off is armed before the first clip');
  if (edit) edit(s);
  s.fx.advanceTo(r.baseTime + 2.5);
  await settle();
  return { runs: runs.length, states: states.join('>'), view: mr.view };
}

test('V272 B2: an edit while a Studio measurement hand-off is pending keeps the measurement',
  async () => {
    const plain = await measureWith(null);
    assert.equal(plain.runs, 1);
    const edited = await measureWith((s) => {
      const master = s.store.getModel().graph.nodes.find((n) => n.type === 'master');
      dispatch(s, { type: 'NODE_PARAM_SET', nodeId: master.id, key: 'level',
        value: master.params.level / 2 });
    });
    assert.equal(edited.runs, 1, `the measurement runs (states ${edited.states})`);
    assert.equal(edited.view.state, 'done');
  });

test('V272 B2: a measurement clip moved while its hand-off is pending re-arms it', async () => {
  const moved = await measureWith((s) => {
    const m = s.store.getModel();
    for (const c of [...m.timeline.clips].sort((a, b) => b.start - a.start)) {
      dispatch(s, { type: 'CLIP_MOVE', clipId: c.id, start: c.start + 0.1 });
    }
  });
  assert.equal(moved.runs, 1, `the rescheduled measurement runs (states ${moved.states})`);
});

/** VCA gain of the reference Envelope at position 0.85 s, gates every 0.5 s, `edit` at 0.52 s. */
function envelopeAfter(edit) {
  const s = setup();
  gateClips(s, [0, 0.5, 1.0, 1.5], 0.45);
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advanceTo(b + 0.52); // the second gate is in its attack / decay
  if (edit) edit(s);
  s.fx.advance(0.5);
  const vca = s.runtime.nodes.get('env-1').inputs.audio.gain;
  return { v: valueAtTime(getSchedule(vca), b + 0.85), s };
}

test('V272 B5: an edit that does not touch the timeline leaves the envelope contour alone', () => {
  const plain = envelopeAfter(null);
  assert.ok(Math.abs(plain.v - 0.7) < 1e-6, `sustain without an edit: ${plain.v}`);
  const edited = envelopeAfter((s) => dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1',
    key: 'Q', value: 1.2 }));
  assert.ok(Math.abs(edited.v - 0.7) < 1e-6, `the gate reaches its sustain: ${edited.v}`);
  const decided = edited.s.transport.debugInfo().decisions.map((d) => d.decision);
  assert.ok(!decided.includes('cancel'), `no item is cancelled: ${decided.join(',')}`);
});
