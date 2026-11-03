// K158: the near-duplicate guard. The shipped riffs are distinct from each other, and every
// derivative of a riff (transposed, octave-folded, rotated, time-shifted, one note re-pitched,
// one note re-timed) is refused as the same entry.
//   node --test tests/unit/riff-similarity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THRESHOLD, midiOf, nearDuplicates, noteTokens, similarity,
} from '../../scripts/riff-similarity.mjs';
import { RIFFS } from '../../src/js/studio/riffs/library.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const remap = (r, f) => ({ ...r, id: `${r.id}-derived`,
  notes: r.notes.map((n, i) => f([...n], i)) });
const DERIVE = {
  'transposed up a fourth': (r) => remap(r, (n) => [n[0], nameOf(midiOf(n[1]) + 5), n[2], n[3]]),
  'transposed down a fifth': (r) => remap(r, (n) => [n[0], nameOf(midiOf(n[1]) - 7), n[2], n[3]]),
  'one note an octave up': (r) => remap(r, (n, i) => (i === Math.min(2, r.notes.length - 1)
    ? [n[0], nameOf(midiOf(n[1]) + 12), n[2], n[3]] : n)),
  'rotated by 3 steps': (r) => remap(r, (n) => [(n[0] + 3) % (r.bars * 16), n[1], n[2], n[3]]),
  'shifted by one bar': (r) => remap(r, (n) => [(n[0] + 16) % (r.bars * 16), n[1], n[2], n[3]]),
  'one note re-pitched': (r) => remap(r, (n, i) => (i === Math.min(3, r.notes.length - 1)
    ? [n[0], nameOf(midiOf(n[1]) + 2), n[2], n[3]] : n)),
  'one note re-timed': (r) => remap(r, (n, i) => (i === Math.min(5, r.notes.length - 1)
    ? [n[0], n[1], n[2] + 1, n[3]] : n)),
  'only the tempo changed': (r) => ({ ...r, id: `${r.id}-derived`, tempo: r.tempo + 20 }),
};

test('calibration: no two shipped riffs are near-duplicates', () => {
  let max = 0;
  for (let i = 0; i < RIFFS.length; i += 1) {
    for (let j = i + 1; j < RIFFS.length; j += 1) {
      max = Math.max(max, similarity(RIFFS[i], RIFFS[j]));
    }
  }
  assert.ok(max < THRESHOLD, `the most similar distinct pair scores ${max.toFixed(3)}`);
  assert.deepEqual(nearDuplicates(RIFFS), []);
});

test('calibration: every derivative of every riff is refused as the same entry', () => {
  for (const r of RIFFS) {
    for (const [what, derive] of Object.entries(DERIVE)) {
      const s = similarity(r, derive(r));
      assert.ok(s >= THRESHOLD, `${r.id} ${what}: similarity ${s.toFixed(3)} < ${THRESHOLD}`);
    }
  }
  const [a] = RIFFS;
  const found = nearDuplicates([a, DERIVE['transposed up a fourth'](a)]);
  assert.equal(found.length, 1);
  assert.match(found[0], new RegExp(`entry ${a.id}-derived is a near-duplicate of entry ${a.id}`));
});

test('invariances: key, start and octave do not make a new riff', () => {
  const [a] = RIFFS;
  assert.equal(similarity(a, DERIVE['transposed up a fourth'](a)), 1);
  assert.equal(similarity(a, DERIVE['rotated by 3 steps'](a)), 1);
  assert.equal(similarity(a, DERIVE['one note an octave up'](a)), 1);
});

test('a riff with the same pitches in another rhythm is a different riff', () => {
  const base = { id: 'base', bars: 1,
    notes: [[0, 'A2', 2, 100], [2, 'C3', 2, 100], [4, 'E3', 2, 100], [6, 'G3', 2, 100],
      [8, 'A3', 2, 100], [10, 'G3', 2, 100], [12, 'E3', 2, 100], [14, 'C3', 2, 100]] };
  const swung = { id: 'swung', bars: 1, notes: base.notes.map(([s, p], i) => [i * 2 + (i % 2), p,
    i % 2 ? 1 : 3, 100]) };
  assert.ok(similarity(base, swung) < THRESHOLD, similarity(base, swung).toFixed(3));
});

test('tokens: interval folded to an octave, onset delta around the loop, length', () => {
  const r = { bars: 1, notes: [[0, 'A2', 2, 100], [4, 'A3', 1, 100], [8, 'C3', 3, 100]] };
  // A2 -> A3 is an octave (folded to 0); C3 back to A2 wraps: delta 16 - 8 = 8
  assert.deepEqual(noteTokens(r), ['-3|8|2', '0|4|1', '3|4|3']);
  assert.throws(() => midiOf('H2'), RangeError);
});
