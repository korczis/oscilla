// V503: call and response (src/js/midi/response.js), the one bounded response mode.
//
// What it proves:
//   - determinism: the same timestamped phrase gives the identical answer, every time and from a
//     fresh recorder;
//   - the answer is the phrase at the fifth: same onsets, lengths and order, velocity x 0.8;
//   - every bound: RESPONSE_MAX_NOTES, RESPONSE_MAX_MS (late onsets dropped, lengths cut), the
//     polyphony, MIDI 127 and the 0.95 x Nyquist frequency (dropped, never moved);
//   - the phrase ends PHRASE_GAP_MS after the last key up with nothing held, asked by the caller's
//     pass with its own clock: no timer is used (setTimeout, setInterval and requestAnimationFrame
//     throw while it runs), and the module's source holds no timer, randomness, wall clock or
//     network call, and imports nothing but core/music.js.
//   node --test tests/unit/midi/response.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANSWER_INTERVAL, ANSWER_SOURCE, ANSWER_VELOCITY, PHRASE_GAP_MS, RESPONSE_MAX_MS, RESPONSE_MAX_NOTES,
  answer, createPhrase } from '../../../src/js/midi/response.js';
import { midiToFrequency } from '../../../src/js/core/music.js';

const SRC = new URL('../../../src/js/midi/response.js', import.meta.url);

/** A phrase played into a fresh recorder: [note, velocity, onMs, offMs]. */
function played(rows) {
  const p = createPhrase();
  const ev = [];
  for (const [note, vel, on, off] of rows) ev.push([on, 'on', note, vel], [off, 'off', note]);
  ev.sort((a, b) => a[0] - b[0] || (a[1] === 'off' ? -1 : 1));
  for (const [at, kind, note, vel] of ev) {
    if (kind === 'on') p.on(note, vel, at);
    else p.off(note, at);
  }
  return p;
}

const RIFF = [[60, 100, 1000, 1200], [62, 90, 1250, 1450], [64, 80, 1500, 1900],
  [67, 110, 1500, 1900]];

test('the same phrase gets the same answer, every time', () => {
  const a = answer(played(RIFF).take(), { polyphony: 8 });
  const b = answer(played(RIFF).take(), { polyphony: 8 });
  assert.deepEqual(a, b);
  assert.deepEqual(answer(played(RIFF).take(), { polyphony: 8 }), a, 'and again');
  assert.ok(a.length > 0);
});

test('the answer is the phrase at the fifth: onsets, lengths, order, velocity x 0.8', () => {
  const phrase = played(RIFF).take();
  assert.deepEqual(phrase.map((n) => [n.note, n.start, n.length]),
    [[60, 0, 200], [62, 250, 200], [64, 500, 400], [67, 500, 400]]);
  const ans = answer(phrase, { polyphony: 8 });
  assert.equal(ANSWER_INTERVAL, 7);
  assert.deepEqual(ans.map((n) => [n.note, n.start, n.length]),
    phrase.map((n) => [n.note + 7, n.start, n.length]));
  assert.deepEqual(ans.map((n) => n.velocity),
    phrase.map((n) => Math.round(n.velocity * ANSWER_VELOCITY)));
});

test('bounded: the first RESPONSE_MAX_NOTES notes, within RESPONSE_MAX_MS', () => {
  const many = Array.from({ length: 40 }, (_, i) => [48 + (i % 12), 100, i * 100, i * 100 + 50]);
  const ans = answer(played(many).take(), { polyphony: 8 });
  assert.equal(ans.length, RESPONSE_MAX_NOTES);
  const long = [[60, 100, 0, 100], [62, 100, 7900, 9900], [64, 100, 8000, 8100]];
  const cut = answer(played(long).take(), { polyphony: 8 });
  assert.deepEqual(cut.map((n) => [n.note, n.start, n.length]), [[67, 0, 100], [69, 7900, 100]],
    'the onset at the bound is dropped and the note before it is cut at the bound');
  assert.ok(cut.every((n) => n.start + n.length <= RESPONSE_MAX_MS));
});

test('bounded: polyphony, MIDI 127 and the frequency ceiling drop a note, never move it', () => {
  const chord = [[60, 100, 0, 500], [64, 100, 0, 500], [67, 100, 0, 500], [72, 100, 0, 500]];
  assert.equal(answer(played(chord).take(), { polyphony: 3 }).length, 3);
  assert.equal(answer(played(chord).take(), { polyphony: 8 }).length, 4);
  const high = [[121, 100, 0, 100], [118, 100, 200, 300]];
  assert.deepEqual(answer(played(high).take(), { polyphony: 8 }).map((n) => n.note), [125]);
  const ceiling = midiToFrequency(84); // C6 + 7 = G6 lies above it, A5 + 7 = E6 below
  const ans = answer(played([[81, 100, 0, 100], [84, 100, 200, 300]]).take(),
    { polyphony: 8, maxFrequency: ceiling });
  assert.deepEqual(ans.map((n) => n.note), [88].filter((n) => midiToFrequency(n) < ceiling));
});

test('the phrase ends PHRASE_GAP_MS after the last key up, on the caller\'s clock, no timer', () => {
  const timers = ['setTimeout', 'setInterval', 'requestAnimationFrame'];
  const saved = timers.map((k) => globalThis[k]);
  for (const k of timers) globalThis[k] = () => { throw new Error(`${k} used`); };
  try {
    const p = createPhrase();
    assert.equal(p.ended(10_000), false, 'nothing played');
    p.on(60, 100, 0);
    assert.equal(p.ended(10_000), false, 'a key is held');
    p.off(60, 300);
    assert.equal(p.ended(300 + PHRASE_GAP_MS - 1), false);
    assert.equal(p.ended(300 + PHRASE_GAP_MS), true);
    p.on(62, 100, 950); // a new note before the pass asked: the phrase goes on
    assert.equal(p.ended(950 + PHRASE_GAP_MS), false, 'held');
    p.off(62, 1000);
    assert.equal(p.ended(1000 + PHRASE_GAP_MS), true);
    assert.deepEqual(p.take().map((n) => n.note), [60, 62]);
    assert.equal(p.ended(100_000), false, 'taken: empty again');
  } finally {
    timers.forEach((k, i) => { globalThis[k] = saved[i]; });
  }
});

test('the module holds no timer, randomness, wall clock or network, and imports only music.js', () => {
  const src = readFileSync(SRC, 'utf8').replace(/\/\/.*$/gm, '');
  for (const bad of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'Math.random',
    'Date.now', 'performance.now', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'Worker',
    'import(']) {
    assert.equal(src.includes(bad), false, `no ${bad}`);
  }
  const imports = [...src.matchAll(/^\s*import[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../core/music.js']);
});

test('a re-press ends the note it repeats; a key up of an unheld note changes nothing', () => {
  const p = createPhrase();
  p.on(60, 100, 0);
  p.on(60, 90, 100);
  assert.equal(p.off(61, 150), false);
  p.off(60, 200);
  assert.deepEqual(p.take().map((n) => [n.note, n.start, n.length]), [[60, 0, 100], [60, 100, 100]]);
});

test('A1: an answer fed back in is never heard as the next call', () => {
  const ans = answer(played(RIFF).take(), { polyphony: 8 });
  const p = createPhrase();
  for (const n of ans) {
    assert.equal(p.on(n.note, n.velocity, 5000 + n.start, ANSWER_SOURCE), false);
    assert.equal(p.off(n.note, 5000 + n.start + n.length, ANSWER_SOURCE), false);
  }
  assert.equal(p.ended(100_000), false, 'no phrase: nothing to answer');
  assert.deepEqual(answer(p.take(), { polyphony: 8 }), []);
});

test('A3: the phrase ends at its last key up with no key held', () => {
  const p = played(RIFF);
  assert.equal(p.endsAt(), 1900);
  const q = createPhrase();
  q.on(60, 100, 0);
  assert.equal(q.endsAt(), null, 'a key is held');
});

