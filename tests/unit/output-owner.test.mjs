// C013: the output owner the views follow, and the Spectrum's requested frequency
// (src/js/visualization/output-owner.js). Pure functions; main.js wires them.
//   node --test tests/unit/output-owner.test.mjs

import test from 'node:test';
import assert from 'node:assert';

import {
  OUTPUT_OWNERS, OUTPUT_OWNER_NAMES, assertOutputOwner, outputOwnerOf, requestedFrequencyFor,
} from '../../src/js/visualization/output-owner.js';

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
