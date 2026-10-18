// V272 final review, the transport lifecycle findings (src/js/studio/transport.js,
// timeline-compiler.js edit(), measurement-run.js, offline.js, the Envelope / Random / Step
// Modulator adapters): on the real AudioEngine with the recording fake AudioContext
// (sequencer-fake-audio.mjs createFakeAudioEnv), as tests/unit/v31-studio-transport.test.mjs.
//   node --test tests/unit/v272-transport-lifecycle.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
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
  const r2 = ok(s.transport.start());
  const t2 = s.ctx.currentTime;
  s.fx.advance(0.02);
  const before = s.transport.debugInfo();
  assert.equal(before.voiceCount, 1, 'the new playback plays its first clip');
  assert.ok(before.gateCount >= 1, 'and gates its envelope');
  const fresh = s.ctx.oscillators.filter((o) => o.createdAt >= t2 && o.startAt !== null);
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
