// The text on the on-screen keys (LXK-06, p2's look audit of the Synth): every letter and octave
// name is drawn at the 12 px floor of the layout rule, never scaled down with the key (it was
// 8 to 11 px), and a key narrower than KEY_LETTER_MIN_W keeps no letter while C keeps its name.
//
//   node --test tests/unit/keyboard-view-text.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { drawKeys } from '../../src/js/midi/keyboard-view.js';

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
