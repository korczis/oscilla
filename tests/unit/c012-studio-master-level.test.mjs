// C012: the Studio's master level has one writer, and the status bar shows what the Studio
// plays (plan PACK 03 findings engine-sync-2 and dup-stale-4).
//
// engine-sync-2: main.js's capture-phase unlock listener calls ensureAudio() on every
// pointerdown and keydown; ensureAudio wrote engine.setMasterGain(cmp.gainLevel) each time, so a
// click while the Studio played replaced the Studio's Master Output level with the Playground's
// gain. ensureAudio now writes the level only when it builds a context.
//
// dup-stale-4: while the Studio played, the status bar said READY, its dot was off and its Gain
// readout showed the Playground level. The runtime now tells its listeners what it wrote
// ('master'), the workspace mirrors that number into cmp.studio.masterLevel, and the status bar
// reads it. isSounding and the status Play button stay the instrument's (ADR 0050).
import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import * as sequencerPanel from '../../src/js/labs/sequencer-panel.js';
import { createFakeAudioEnv, FakeContext, fakeTimers } from './sequencer-fake-audio.mjs';

/** An engine stand-in that counts every write of the master level. */
function countingEngine() {
  return {
    ctx: null, state: 'not started', sampleRate: null, running: false, mic: null, voice: null,
    writes: [],
    isSupported: () => true,
    init() {
      if (!this.ctx || this.state === 'closed') {
        this.ctx = {};
        this.state = 'running';
        this.sampleRate = 44100;
      }
      return true;
    },
    resume: () => Promise.resolve(true),
    setMasterGain(g) { this.writes.push(g); },
    play: () => null, release: () => true, stopAll() {}, updateLive: () => 'same',
    instantaneousFrequency: () => null, revokeContinuous: () => 0, stopMic() {},
    on: () => () => {},
  };
}

const TIMERS = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };

test('engine-sync-2: ensureAudio writes the master level only when it builds a context', () => {
  const engine = countingEngine();
  const app = createInstrument({ engine, env: {}, timers: TIMERS });
  assert.equal(app.ensureAudio(), true);
  assert.deepEqual(engine.writes, [app.gainLevel], 'a new context starts at the requested level');
  // A gesture on a running context (the unlock listener while the Studio plays) writes nothing:
  // the level the Studio's Master Output set stays in effect.
  assert.equal(app.ensureAudio(), true);
  assert.equal(app.ensureAudio(), true);
  assert.equal(engine.writes.length, 1, `ensureAudio rewrote the level: ${engine.writes}`);
  // A context closed from outside is rebuilt like a first start, at the requested level.
  engine.state = 'closed';
  app.gainLevel = 0.03;
  assert.equal(app.ensureAudio(), true);
  assert.deepEqual(engine.writes, [engine.writes[0], 0.03]);
});

// ---------------------------------------------------------------- runtime 'master' events

const SR = 48000;
const ENGINE_LEVEL = 0.2;
const STUDIO_LEVEL = 0.05;

function studioAudio() {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  engine.setMasterGain(ENGINE_LEVEL);
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator(templateModel(REFERENCE_TEMPLATE_ID)) });
  const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'master-1', key: 'level',
    value: STUDIO_LEVEL });
  assert.ok(r.ok, r.reason);
  const events = [];
  runtime.on((type, d) => { if (type === 'master') events.push(d); });
  return { fx, engine, runtime, store, events };
}

test('dup-stale-4: the runtime reports the master level it writes and the one it gives back',
  async () => {
    const a = studioAudio();
    assert.ok(a.runtime.apply(a.store.getModel(), { revision: a.store.getRevision() }).ok);
    assert.equal(a.events.length, 0, 'a stopped apply writes no level');
    assert.ok(a.runtime.start().ok);
    assert.equal(a.engine.gainLevel, STUDIO_LEVEL);
    assert.deepEqual(a.events.at(-1), { level: STUDIO_LEVEL, writes: a.engine.masterWrites },
      'PLAY: the level and the engine write count after the Studio wrote it');
    const done = a.runtime.stop();
    a.fx.advance(0.3);
    await done;
    assert.equal(a.engine.gainLevel, ENGINE_LEVEL);
    assert.deepEqual(a.events.at(-1), { level: null, writes: a.engine.masterWrites },
      'STOP: the Studio no longer holds the level');
  });

test('dup-stale-4: a level set elsewhere while the Studio played is released too', async () => {
  const a = studioAudio();
  assert.ok(a.runtime.apply(a.store.getModel(), { revision: a.store.getRevision() }).ok);
  assert.ok(a.runtime.start().ok);
  const held = a.events.at(-1);
  assert.ok(held && held.level === STUDIO_LEVEL, `PLAY reported the Studio level: ${held}`);
  a.engine.setMasterGain(0.1); // the Playground's gain watcher (main.js)
  assert.notEqual(a.engine.masterWrites, held.writes, 'the write count moved past the Studio');
  const done = a.runtime.stop();
  a.fx.advance(0.3);
  await done;
  assert.equal(a.engine.gainLevel, 0.1, 'the newer level is kept (PR #119 D2)');
  assert.equal(a.events.at(-1).level, null);
});

// ---------------------------------------------------------------- status bar

function statusBar({ engine = { masterWrites: 7 } } = {}) {
  const wb = createWorkbench({ engine });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, { status: 'READY', playing: false, releasing: false, seqPlaying: false,
    gainLevel: 0.08, source: 'single', pattern: 'tone', dualFa: 440, dualFb: 441,
    metricFrequencyIdle: 440, instFreq: null, currentPattern: { label: 'Continuous tone' },
    pp: {}, studio: { playing: false, masterLevel: null, masterWrites: null } });
  return { cmp, engine };
}

test('dup-stale-4: while the Studio plays the status bar says PLAYING and shows its Master level',
  () => {
    const { cmp, engine } = statusBar();
    assert.equal(cmp.statusLabel, 'READY');
    assert.equal(cmp.statusGainText, 'Gain -21.9 dB');
    assert.equal(cmp.anySounding, false);
    cmp.studio.playing = true;
    cmp.studio.masterLevel = 0.05;
    cmp.studio.masterWrites = engine.masterWrites;
    assert.equal(cmp.statusLabel, 'PLAYING');
    assert.equal(cmp.anySounding, true, 'the status dot follows the Studio transport');
    assert.equal(cmp.statusGainText, 'Master -26.0 dB');
    assert.equal(cmp.statusPatternText, 'Studio');
    assert.equal(cmp.statusFreqText, 'studio', 'not the Playground frequency');
    // The status Play button stays the instrument's (ADR 0050): it triggers the instrument.
    assert.equal(cmp.isSounding, false);
    // A level written since (the Playground's gain, resetDefaults) supersedes the Studio's.
    engine.masterWrites += 1;
    assert.equal(cmp.statusGainText, 'Gain -21.9 dB');
    engine.masterWrites -= 1;
    cmp.studio.masterLevel = null;
    assert.equal(cmp.statusGainText, 'Gain -21.9 dB', 'no Studio level held: the Playground gain');
    cmp.studio.playing = false;
    cmp.studio.masterLevel = 0.05;
    assert.equal(cmp.statusGainText, 'Gain -21.9 dB', 'stopped: the Playground gain');
    assert.equal(cmp.statusLabel, 'READY');
  });

test('dup-stale-4: the status bar never writes the Studio level into the Playground gain', () => {
  const { cmp, engine } = statusBar();
  cmp.studio.playing = true;
  cmp.studio.masterLevel = 0.05;
  cmp.studio.masterWrites = engine.masterWrites;
  void cmp.statusGainText;
  void cmp.statusLabel;
  assert.equal(cmp.gainLevel, 0.08);
});

// ---------------------------------------------------------------- review 76e93875 (F1, F2)
//
// F1: with ensureAudio no longer writing on a running context, a voice the Playground or the
// Pattern Sequencer started over a playing Studio sounded at the Studio's Master Output level
// until the Studio's held restore (about S + 50 ms). Starting a voice now claims the Playground
// gain (claimMasterLevel), and the Studio keeps that newer level at its STOP.
// F2: resetDefaults wrote the level unconditionally: a second writer beside the gainLevel
// $watch, and with the gain already at its default nothing reactive changed, so the status bar
// went on showing the Studio's Master level after the Playground gain had replaced it.

test('F1: a Playground voice started over a playing Studio has the Playground gain at once',
  async () => {
    const a = studioAudio();
    const app = createInstrument({ engine: a.engine, env: {}, timers: TIMERS });
    app.gainLevel = ENGINE_LEVEL; // the gainLevel $watch keeps the engine in step (main.js)
    assert.ok(a.runtime.apply(a.store.getModel(), { revision: a.store.getRevision() }).ok);
    assert.ok(a.runtime.start().ok);
    assert.equal(a.engine.gainLevel, STUDIO_LEVEL, 'the Studio holds the master stage');
    // The voice itself is the engine's (freeze, engine-v1port); this is the level it starts at.
    a.engine.play = () => ({});
    assert.equal(app.play('trigger'), true);
    assert.equal(a.engine.gainLevel, ENGINE_LEVEL,
      'the onset plays the Playground gain, not the Studio Master Output level');
    // The playing $watch then stops the Studio (workspace.js): the newer level is kept, at once.
    const done = a.runtime.stop();
    a.fx.advance(0.3);
    await done;
    assert.equal(a.engine.gainLevel, ENGINE_LEVEL);
    assert.equal(a.engine._masterHeldUntil, null,
      'no restore held until after the Studio fade: the level was the Playground\'s already');
    const last = a.events.at(-1);
    assert.ok(last && last.level === null, `the Studio no longer holds the level: ${last}`);
  });

test('F1: the Pattern Sequencer claims the Playground gain when, and only when, it starts', () => {
  assert.equal(typeof sequencerPanel.sequencerEngine, 'function',
    'labs/sequencer-panel.js exports the editor engine adapter it mounts');
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  let claims = 0;
  const engine = sequencerPanel.sequencerEngine({ getContext: () => ctx,
    getDestination: () => ctx.destination, claimOutput: () => { claims += 1; } });
  const ed = createSequencerEditor({ engine, timers: fakeTimers() });
  assert.equal(ed.play(), true, ed.error);
  assert.equal(claims, 1, 'a started sequence claims the output level');
  ed.stop();
  ed.clear();
  assert.equal(ed.model.blocks.length, 0);
  assert.equal(ed.play(), false, 'an empty sequence does not start');
  assert.equal(claims, 1, 'a refused PLAY leaves the level alone (the Studio may still play)');
});

function resetRig() {
  const engine = countingEngine();
  const app = createInstrument({ engine, env: {}, timers: TIMERS });
  const wb = createWorkbench({ engine });
  for (const k of ['studioPlaying', 'studioMasterLevel', 'statusGainText', 'gainDb',
    'gainDbText']) {
    const d = Object.getOwnPropertyDescriptor(wb, k);
    assert.ok(d, `the status bar has ${k}`);
    Object.defineProperty(app, k, d);
  }
  assert.equal(app.ensureAudio(), true);
  app.studio = { playing: true, masterLevel: STUDIO_LEVEL, masterWrites: null };
  return { engine, app };
}

test('F2: Reset instrument with the gain already at its default gives the output that gain and '
  + 'ends the Studio readout', () => {
  const { engine, app } = resetRig();
  const gain = app.gainLevel;
  assert.equal(app.statusGainText, 'Master -26.0 dB', 'the Studio holds the level');
  const before = engine.writes.length;
  app.resetDefaults();
  assert.equal(app.gainLevel, gain, 'the default gain is unchanged: no gainLevel $watch fires');
  assert.deepEqual(engine.writes.slice(before), [gain], 'one write, of the restored gain');
  assert.equal(app.studio.masterLevel, null,
    'the reactive Studio level is cleared, so the status bar is re-read');
  assert.equal(app.statusGainText, 'Gain -21.9 dB');
});

test('F2: Reset instrument with a changed gain leaves the write to the gainLevel $watch', () => {
  const { engine, app } = resetRig();
  app.gainLevel = 0.03;
  const before = engine.writes.length;
  app.resetDefaults();
  assert.notEqual(app.gainLevel, 0.03, 'the gain changed back to its default');
  assert.equal(engine.writes.length, before,
    `resetDefaults wrote the level itself (${engine.writes.slice(before)}): the gainLevel $watch `
      + 'in main.js is its one writer');
});
