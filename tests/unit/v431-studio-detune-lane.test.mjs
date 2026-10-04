// V431 review X2/X8: an Oscillator's detune AudioParam also carries the constant cents of
// log-mapped frequency modulation. A detune lane owns that param, so it must schedule those
// cents too; when the lane is removed during playback the param glides back to base + offset,
// not to the bare base (the oscillator was left an octave off).
//   node --test tests/unit/v431-studio-detune-lane.test.mjs

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

function setup() {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime, engine, store });
  return { fx, runtime, store, transport };
}

test('X2/X8: a detune lane keeps the log offset, and removing it restores base + offset', () => {
  const s = setup();
  // LFO → oscillator frequency, log, bipolar ±1 octave around a constant +1 octave offset:
  // the oscillator's detune carries 1200 constant cents.
  ok(s.store.dispatch({ type: 'EDGE_ADD', from: { node: 'lfo-1', port: 'control' },
    to: { node: 'osc-1', port: 'frequency' },
    props: { mapping: 'log', polarity: 'bipolar', depth: 1, offset: 1 } }));
  ok(s.store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: 'osc-1', param: 'detune' },
    time: 0, value: 0, curve: 'step' }));
  ok(s.transport.start());
  assert.equal(s.runtime.baseOffset('osc-1', 'detune'), 1200,
    'the detune owner schedules the log edges\' constant cents');
  const detune = s.runtime.nodes.get('osc-1').info.oscillator.detune;
  const scheduled = detune.calls.filter((c) => c[0] === 'setValueAtTime').map((c) => c[1]);
  assert.ok(scheduled.includes(1200), `lane at 0 cents + 1200: ${JSON.stringify(scheduled)}`);
  assert.ok(!scheduled.includes(0), 'the log offset is never dropped while the lane plays');

  s.fx.advance(0.5);
  const lane = s.store.getModel().timeline.automation.find((l) => l.target.param === 'detune');
  ok(s.store.dispatch({ type: 'AUTOMATION_POINT_REMOVE', laneId: lane.id,
    pointId: lane.points[0].id }));
  ok(s.transport.sync());
  const glide = detune.calls.filter((c) => c[0] === 'setTargetAtTime').at(-1);
  assert.equal(glide[1], 1200, 'the released detune glides back to base + offset, not to 0');
  s.transport.stop();
});
