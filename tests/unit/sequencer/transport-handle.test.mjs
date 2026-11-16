// V508, V510: the Sequencer's transport as MIDI reaches it (src/js/sequencer/transport-handle.js),
// on a fake editor. What it proves: play, stop and loop act through the panel and are false while
// it is not mounted; anchor() is null while stopped, the run's grid from its first pass while the
// tempo holds, and a new segment at the pass that plays a new tempo, with the song tick it starts
// on; an edit waiting for the next pass keeps the sounding pass's tempo.
//   node --test tests/unit/sequencer/transport-handle.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSequencerTransport } from '../../../src/js/sequencer/transport-handle.js';

function fakeLabs() {
  const ed = { playing: false, model: { tempoBpm: 120, loop: false }, pass: null, current: true,
    run: null, calls: [],
    play() { this.calls.push('play'); }, stop() { this.calls.push('stop'); },
    setLoop(on) { this.model = { ...this.model, loop: on }; },
    loopSchedule() { return { t0: this.run }; },
    currentPassTiming() { return this.pass; },
    currentPassState() { return { current: this.current }; } };
  const labs = { sequencer: { editor: ed, renders: 0, render() { this.renders += 1; } } };
  return { labs, ed };
}

test('play, stop and loop go through the panel; false while it is not mounted', () => {
  const none = createSequencerTransport({});
  assert.equal(none.play(), false);
  assert.equal(none.stop(), false);
  assert.equal(none.loop(), false);
  assert.equal(none.anchor(), null);
  const { labs, ed } = fakeLabs();
  const t = createSequencerTransport(labs);
  assert.equal(t.play(), true);
  assert.equal(t.stop(), true);
  assert.equal(t.loop(), true);
  assert.equal(ed.model.loop, true);
  assert.deepEqual(ed.calls, ['play', 'stop']);
  assert.equal(labs.sequencer.renders, 2);
});

test('anchor: the run from its first pass, a new segment at the pass of a new tempo', () => {
  const { labs, ed } = fakeLabs();
  const t = createSequencerTransport(labs);
  assert.equal(t.anchor(), null, 'stopped');
  Object.assign(ed, { playing: true, run: 1.0, pass: { t0: 1.0, duration: 2.0 } });
  assert.deepEqual(t.anchor(), { run: 1.0, origin: 1.0, tempo: 120, tick0: 0, fromStart: true });
  // An edit to 90 BPM waits for the next pass: the sounding pass keeps 120.
  ed.model = { ...ed.model, tempoBpm: 90 };
  ed.current = false;
  assert.equal(t.anchor().tempo, 120);
  ed.pass = { t0: 3.0, duration: 2.0 };
  ed.current = true;
  assert.deepEqual(t.anchor(), { run: 1.0, origin: 3.0, tempo: 90, tick0: 96, fromStart: true },
    'two seconds at 120 BPM are 96 ticks');
  ed.pass = { t0: 5.0, duration: 2.0 };
  assert.equal(t.anchor().origin, 3.0, 'the same tempo keeps the segment');
  ed.playing = false;
  assert.equal(t.anchor(), null);
  Object.assign(ed, { playing: true, run: 9.0, pass: { t0: 9.0, duration: 2.0 } });
  assert.deepEqual(t.anchor(), { run: 9.0, origin: 9.0, tempo: 90, tick0: 0, fromStart: true },
    'a new run starts over');
});
