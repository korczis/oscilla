// The text on the on-screen keys (LXK-06, p2's look audit of the Synth): every letter and octave
// name is drawn at the 12 px floor of the layout rule, never scaled down with the key (it was
// 8 to 11 px), and a key narrower than KEY_LETTER_MIN_W keeps no letter while C keeps its name.
//
//   node --test tests/unit/keyboard-view-text.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { BLACK_OFFSET, drawKeys, keyLayout, noteAt } from '../../src/js/midi/keyboard-view.js';

/** A 2D context that records each text drawn with the font it was drawn in. */
function recorder() {
  const texts = [];
  const ctx = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '',
    textBaseline: '', clearRect() {}, fillRect() {}, strokeRect() {},
    fillText(t, x) { texts.push({ t, x, font: this.font }); } };
  return { ctx, texts };
}
const colours = { white: '#fff', black: '#000', midi: '#0f0', lit: '#00f', onLit: '#fff',
  edge: '#888', label: '#333', blackLabel: '#ccc', font: 'system-ui' };
const letters = 'awsedftgyhujkolp;\'';
const draw = (width, first = 48, last = 84) => {
  const { ctx, texts } = recorder();
  const layout = drawKeys(ctx, { first, last, width, height: 132, colours, lit: () => null,
    label: (n) => letters[n - 60] || null });
  return { layout, texts };
};
const px = (font) => Number(/(\d+)px/.exec(font)[1]);

test('every key text is drawn at 12 px, on a phone and on a desktop', () => {
  for (const width of [320, 390, 1536]) {
    const { texts } = draw(width);
    assert.ok(texts.length > 0, `${width}: text drawn`);
    for (const { t, font } of texts) assert.equal(px(font), 12, `${width}: "${t}" in ${font}`);
  }
});

test('a key narrower than the letter width keeps no letter; C keeps its octave name', () => {
  const phone = draw(390);
  const narrow = phone.layout.filter((k) => k.w < 30);
  assert.ok(narrow.length > 0, 'the phone has narrow keys');
  const lettersDrawn = phone.texts.filter(({ t }) => letters.includes(t));
  for (const { x } of lettersDrawn) {
    const k = phone.layout.find((key) => Math.abs(key.x + key.w / 2 - x) < 0.01);
    assert.ok(k && k.w >= 30, `a letter on a ${k && k.w.toFixed(1)} px key`);
  }
  assert.deepEqual(phone.texts.filter(({ t }) => /^C\d$/.test(t)).map(({ t }) => t),
    ['C3', 'C4', 'C5', 'C6']);
  const desk = draw(1536);
  assert.equal(desk.texts.filter(({ t }) => letters.includes(t)).length, letters.length,
    'on the desktop every labelled key shows its letter');
});

// LXK-18: the black keys sit off the boundary by pitch class, as on a real keybed: C# and D#
// lean apart, F# and A# outwards, G# centred; every black key still lies over its two whites
// and is hit first there.
test('the black keys sit off the boundaries by pitch class, and still hit first', () => {
  assert.deepEqual({ ...BLACK_OFFSET }, { 1: -0.1, 3: 0.1, 6: -0.15, 8: 0, 10: 0.15 });
  const layout = keyLayout(48, 84, 660, 132);
  const ww = 660 / 22;
  const of = (n) => layout.find((k) => k.note === n);
  for (const n of [61, 63, 66, 68, 70]) {
    const k = of(n);
    const boundary = of(n + 1).x; // the white key above starts at the boundary
    const centre = k.x + k.w / 2;
    assert.ok(Math.abs(centre - boundary - BLACK_OFFSET[n % 12] * ww) < 1e-9, `${n} offset`);
    assert.ok(k.x > of(n - 1).x && k.x + k.w < of(n + 1).x + ww, `${n} over its two whites`);
    assert.equal(noteAt(layout, centre, 10), n, `${n} is hit at its centre`);
  }
  assert.ok(of(61).x + of(61).w / 2 < of(62).x, 'C# leans towards C');
  assert.ok(of(70).x + of(70).w / 2 > of(71).x, 'A# leans towards B');
});
