// C055: one transport clock. A looping V2 sequence and a Studio timeline play on one fake audio
// context and one AudioEngine; the timers that wake a scheduler are counted. Before, two armed
// one each (the sequencer editor's _pump on its own timers, the Studio transport's tick on the
// engine's); now the engine's one transport clock wakes both from one timer, and both still
// schedule: the loop queues its next pass and the transport keeps its timeline going. Built only
// on seams the merge base already has (the engine's timers, the panel's engine adapter, the
// editor's timers option), so it fails there by assertion, naming the two timers.
// Then one tempo: a tempo change in the Studio transport reaches an imported sequence's
// tempo-linked blocks in the same dispatch, and the import and export seam keeps tempoBpm.
//   node --test tests/unit/one-transport-clock.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { exportSequence, importSequence } from '../../src/js/studio/sequence-import.js';
import { createSequencerEditor, LOOKAHEAD_S } from '../../src/js/sequencer/editor.js';
import { referenceSequence, setTempo, updateBlock } from '../../src/js/sequencer/model.js';
import { sequencerEngine } from '../../src/js/labs/sequencer-panel.js';
import { TIMELINE_LOOKAHEAD_S } from '../../src/js/studio/timeline-compiler.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

/** Fake timers that remember each pending callback; runUntil(ms) fires the due ones in order. */
function recordingTimers() {
  let id = 0;
  let now = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms) {
      id += 1;
      pending.set(id, { fn, at: now + Math.max(0, ms) });
      return id;
    },
    clearTimeout(i) { pending.delete(i); },
    runUntil(ms) {
      now = ms;
      for (let fired = true; fired;) {
        fired = false;
        const due = [...pending].filter(([, p]) => p.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [i, p] of due.slice(0, 1)) {
          pending.delete(i);
          p.fn();
          fired = true;
        }
      }
    },
  };
}

/**
 * Which scheduler a pending timer wakes: the Studio transport's tick, the sequencer's loop pump,
 * or the one transport clock that wakes both; null for bookkeeping (a voice's cleanup).
 */
function scheduler(fn) {
  if (fn.name === 'tick') return 'transport tick';
  if (/_pump\(\)/.test(String(fn))) return 'sequencer _pump';
  if (fn.name === 'fire') return 'transport clock';
  return null;
}

const wakers = (...timers) => timers.flatMap((t) => [...t.pending.values()])
  .map((p) => scheduler(p.fn)).filter(Boolean).sort();

/** A looping sequence and its Studio import, both from the reference sequence. */
function sources() {
  const seq = { ...referenceSequence(), loop: true };
  const imp = importSequence(seq, { sampleRate: 48000 });
  return { seq, model: imp.model };
}

function rig() {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const engineTimers = recordingTimers();
  engine._timers = engineTimers; // what the transport (and the engine's clock) wake from
  const own = recordingTimers(); // the editor's own timers option
  const { seq, model } = sources();
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime: createStudioRuntime({ engine }), engine,
    store, onClaimOutput: () => true });
  const ed = createSequencerEditor({ model: seq, timers: own, engine: sequencerEngine({
    getContext: () => engine.ctx, getDestination: () => engine.ctx.destination,
    audioEngine: engine }) });
  return { fx, engine, engineTimers, own, transport, ed };
}

test('C055: one lookahead window for the sequencer loop and the Studio timeline', () => {
  assert.equal(LOOKAHEAD_S, TIMELINE_LOOKAHEAD_S);
});

test('C055: a looping sequence and a Studio timeline wake from one timer, and both play', () => {
  const r = rig();
  assert.equal(r.transport.start({ position: 0 }).ok, true, 'Studio PLAY');
  r.ed.setLoop(true);
  assert.equal(r.ed.play(), true, 'the sequence plays');
  assert.deepEqual(wakers(r.engineTimers, r.own), ['transport clock'],
    'one timer wakes every scheduler (not editor._pump and the transport each their own)');
  assert.equal(wakers(r.own).length, 0, 'the editor arms no timer of its own');
  // Run the clock forward: the loop queues its next pass and the transport keeps ticking.
  const first = r.ed.currentPassTiming();
  const passes = () => r.ed.stats().voices;
  assert.equal(passes(), 1, 'one pass scheduled at the start');
  r.fx.ctx.currentTime = first.t0 + first.duration - LOOKAHEAD_S / 2;
  r.engineTimers.runUntil((first.duration + 1) * 1000);
  assert.ok(passes() >= 2, `the shared clock woke the loop: ${passes()} passes`);
  assert.equal(r.transport.playing, true, 'and the Studio timeline still plays');
  assert.deepEqual(wakers(r.engineTimers, r.own), ['transport clock'], 'still one timer');
  r.ed.stop();
  r.transport.stop({ fast: true });
});

test('C055: a tempo change in the Studio transport reaches the imported sequence at once', () => {
  let seq = updateBlock(referenceSequence(), 'b2', { beats: 1 }); // a tempo-locked block
  seq = setTempo(seq, 120);
  const { model } = importSequence(seq, { sampleRate: 48000 });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const linked = () => store.getModel().timeline.clips.find((c) => c.musical);
  const before = linked();
  assert.ok(before, 'the tempo-locked block is a tempo-linked clip');
  assert.equal(store.getModel().transport.tempo, 120, 'the sequence\'s tempo is the transport\'s');
  const r = store.dispatch({ type: 'TRANSPORT_SET', tempo: 60 });
  assert.notEqual(r && r.ok, false, JSON.stringify(r));
  const after = linked();
  assert.equal(store.getModel().transport.tempo, 60);
  assert.ok(Math.abs(after.duration - 2 * before.duration) < 1e-9,
    `the block plays at the new tempo in the same dispatch (${before.duration} s -> `
    + `${after.duration} s)`);
  assert.equal(exportSequence(store.getModel()).sequence.tempoBpm, 60, 'and leaves at it');
});

test('C055: an imported and re-exported sequence keeps its tempoBpm (the one tempo seam)', () => {
  for (const bpm of [60, 97.5, 137, 240]) {
    const seq = setTempo(updateBlock(referenceSequence(), 'b2', { beats: 1.5 }), bpm);
    const back = exportSequence(importSequence(seq, { sampleRate: 48000 }).model).sequence;
    assert.equal(back.tempoBpm, seq.tempoBpm, `${bpm} BPM`);
  }
});
