// C013: the output owner the views follow, and the Spectrum's requested frequency
// (src/js/visualization/output-owner.js). Pure functions; main.js wires them.
// C002 (findings coupling-1, -2, -3): one output owner at a time, decided by one table that the
// engine.play wrapper and the sequencer's claimOutput share (src/js/ui/output-owner.js).
//   node --test tests/unit/output-owner.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_OWNERS, OUTPUT_OWNER_NAMES, assertOutputOwner, outputOwnerOf, requestedFrequencyFor,
} from '../../src/js/visualization/output-owner.js';
import { createOutputOwner, OUTPUT_REFUSAL, OUTPUT_YIELDS } from '../../src/js/ui/output-owner.js';

test('outputOwnerOf: the instrument first, then the sequencer, then the Studio, else null', () => {
  assert.strictEqual(outputOwnerOf({}), null);
  assert.strictEqual(outputOwnerOf(), null);
  assert.strictEqual(outputOwnerOf({ instrument: true }), 'instrument');
  assert.strictEqual(outputOwnerOf({ sequencer: true }), 'sequencer');
  assert.strictEqual(outputOwnerOf({ studio: true }), 'studio');
  assert.strictEqual(outputOwnerOf({ instrument: true, sequencer: true, studio: true }),
    'instrument');
  assert.strictEqual(outputOwnerOf({ sequencer: true, studio: true }), 'sequencer');
});

test('assertOutputOwner accepts the named owners and null, and refuses anything else', () => {
  for (const o of [...OUTPUT_OWNERS, null]) assert.strictEqual(assertOutputOwner(o), o);
  for (const bad of [undefined, '', 'Studio', 'mic', true, 1, {}]) {
    assert.throws(() => assertOutputOwner(bad), TypeError);
  }
  assert.strictEqual(OUTPUT_OWNER_NAMES.studio, 'Studio');
  assert.strictEqual(OUTPUT_OWNER_NAMES.sequencer, 'sequencer');
});

test('requestedFrequencyFor follows the sequence while only the sequencer plays', () => {
  // instrument at 250 Hz, not played; the sequence's block 0 requests 440 Hz
  assert.strictEqual(requestedFrequencyFor(false, 250, true, 440), 440);
  // a silence or a gap in the sequence hides the marker (and its level chip)
  assert.strictEqual(requestedFrequencyFor(false, 250, true, null), null);
  // the instrument playing keeps its own frequency, even with a sequence running
  assert.strictEqual(requestedFrequencyFor(true, 250, true, 440), 250);
  // nothing plays: the instrument's idle frequency, as before C013
  assert.strictEqual(requestedFrequencyFor(false, 250, false, null), 250);
  assert.strictEqual(requestedFrequencyFor(false, 0, false, null), null);
});

// ---------------------------------------------------------------- C002 (#305)

function setup({ measuring = false, playing = false, studio = false, seq = false } = {}) {
  const log = [];
  const editor = { playing: seq, stop() { log.push('seq.stop'); this.playing = false; } };
  const cmp = {
    playing, seqPlaying: seq, alerts: [], studio,
    measureOwnsOutput: () => measuring,
    notify(kind, title, text) { this.alerts.push({ kind, title, text }); },
    stopNow() { log.push('instrument.stopNow'); },
    studioOwnsOutput() { return this.studio; },
    studioStop() { log.push('studio.stop'); this.studio = false; },
  };
  let changes = 0;
  const owner = createOutputOwner({ app: () => cmp, sequencer: () => editor,
    changed: () => { changes += 1; } });
  return { owner, cmp, editor, log, changes: () => changes };
}

const tick = () => new Promise((r) => queueMicrotask(r));

test('C002: a measurement refuses every claim with one notice and stops nothing', () => {
  for (const who of ['instrument', 'sequencer']) {
    const { owner, cmp, log } = setup({ measuring: true, playing: true, seq: true });
    assert.equal(owner.claimOutput(who), OUTPUT_REFUSAL);
    assert.deepEqual(log, [], `${who}: nothing is stopped by a refused claim`);
    assert.deepEqual(cmp.alerts.map((a) => a.title), ['Measurement in progress']);
    assert.equal(cmp.alerts[0].text, OUTPUT_REFUSAL);
  }
});

test('C002: the sequencer takes the output from instrument and Studio at once', async () => {
  const { owner, cmp, log, changes } = setup({ playing: true, studio: true });
  assert.equal(owner.claimOutput('sequencer'), true);
  assert.deepEqual(log, ['instrument.stopNow', 'studio.stop']);
  assert.equal(cmp.seqPlaying, true, 'set in the action, not by the 150 ms poll');
  await tick();
  assert.equal(changes(), 1, 'the adapter listeners hear of it');
});

test('C002: an instrument voice stops a playing sequence from its live state', async () => {
  // seqPlaying (the polled copy) still false: the live editor state decides.
  const { owner, cmp, editor, log } = setup();
  editor.playing = true;
  assert.equal(owner.claimOutput('instrument'), true);
  assert.deepEqual(log, ['seq.stop']);
  assert.equal(editor.playing, false);
  assert.equal(cmp.seqPlaying, false);
});

test('C002: stopPlayback (MEASURE, Studio PLAY) reads the live sequencer, not the copy', () => {
  const { owner, editor, cmp, log } = setup({ playing: true, studio: true });
  editor.playing = true; // started inside the poll window: cmp.seqPlaying still false
  owner.stopPlayback(cmp);
  assert.deepEqual(log, ['seq.stop', 'instrument.stopNow', 'studio.stop']);
  assert.equal(cmp.seqPlaying, false);
  assert.deepEqual(OUTPUT_YIELDS.measure, ['sequencer', 'instrument', 'studio']);
});

test('C002: no component yet grants the claim; an unknown owner is a programming error', () => {
  const owner = createOutputOwner({ app: () => null, sequencer: () => null });
  assert.equal(owner.claimOutput('sequencer'), true);
  assert.equal(owner.sequencerPlaying(), false);
  const { owner: o } = setup();
  assert.throws(() => o.claimOutput('radio'), /unknown owner radio/);
});

test('C002: stopSequence reads the live state; it clears only a set copy', async () => {
  const { owner, cmp, editor, log, changes } = setup();
  assert.equal(owner.stopSequence(cmp), false, 'nothing playing: nothing to stop');
  editor.playing = true;
  assert.equal(owner.stopSequence(cmp), true);
  assert.deepEqual(log, ['seq.stop']);
  await tick();
  assert.equal(changes(), 0, 'the copy was already false');
});
