// V634 (intent ui-current, criterion phone-whole): the Studio on a phone. What can be judged
// without a browser is judged here; tests/browser/layout.cjs judges the rendered page.
//
// - The on-screen keys show as many whole octaves as keep every white key a 44 px target under
//   a coarse pointer (one octave at 390 px, never none), and a fine pointer keeps two below
//   560 px and three above; visibleRange gives one octave starting at the A key's octave.
// - The keys carry the computer keys' letters only where a fine pointer, and so a keyboard, is
//   likely: a phone's keys show their notes alone.
// - The type tokens under 12 px are 12 px on a phone (390 px) and keep their measured values on
//   the reference viewport (1536 px), so the visual reference does not move.
//
//   node --test tests/unit/phone-whole.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { keysInput, keysOctaves, TOUCH_KEY_MIN } from '../../src/js/midi/keyboard-ui.js';
import { visibleRange } from '../../src/js/midi/keyboard.js';

test('a coarse pointer gets whole octaves whose white keys are 44 px targets', () => {
  assert.equal(TOUCH_KEY_MIN, 44);
  for (const [width, octaves] of [[320, 1], [390, 1], [430, 1], [659, 1], [660, 2], [704, 2], [1012, 3], [1536, 3]]) {
    const n = keysOctaves(width, { coarse: true });
    assert.equal(n, octaves, `${width} px`);
    assert.ok(width / (7 * n + 1) >= TOUCH_KEY_MIN || n === 1, `${width} px: ${n} octave(s) under 44 px`);
  }
  assert.equal(keysOctaves(0, { coarse: true }), 1, 'never no keys');
});

test('a fine pointer keeps two octaves below 560 px and three above', () => {
  assert.equal(keysOctaves(390), 2);
  assert.equal(keysOctaves(559), 2);
  assert.equal(keysOctaves(560), 3);
  assert.equal(keysOctaves(1536, { coarse: false }), 3);
});

test('one octave starts at the octave of the A key', () => {
  assert.deepEqual(visibleRange(60, 1), { first: 60, last: 72 });
  assert.deepEqual(visibleRange(60, 2), { first: 60, last: 84 });
  assert.deepEqual(visibleRange(60, 3), { first: 48, last: 84 });
  assert.deepEqual(visibleRange(127, 1), { first: 115, last: 127 });
});

test('the keys are lettered only where a fine pointer is attached', () => {
  const win = (matches) => ({ matchMedia: (q) => ({ matches: Boolean(matches[q]) }) });
  assert.deepEqual(keysInput(win({ '(pointer: coarse)': true })), { coarse: true, lettered: false });
  assert.deepEqual(keysInput(win({ '(pointer: coarse)': true, '(any-pointer: fine)': true })),
    { coarse: true, lettered: true }, 'a tablet with a keyboard and a trackpad');
  assert.deepEqual(keysInput(win({})), { coarse: false, lettered: true });
  assert.deepEqual(keysInput(undefined), { coarse: false, lettered: true });
});

/** A token's px at a viewport `width`: plain px, or clamp(min, calc(a - b vw), max). */
function tokenPx(css, name, width) {
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(m, `${name} is declared`);
  const v = m[1].trim();
  const px = v.match(/^([\d.]+)px$/);
  if (px) return Number(px[1]);
  const c = v.match(/^clamp\(([\d.]+)px,\s*calc\(([\d.]+)px\s*-\s*([\d.]+)vw\),\s*([\d.]+)px\)$/);
  assert.ok(c, `${name}: ${v} is px or the clamp form`);
  const [lo, a, b, hi] = c.slice(1).map(Number);
  return Math.min(hi, Math.max(lo, a - (b * width) / 100));
}

test('no type token is under 12 px on a phone, and the reference viewport keeps its values', () => {
  const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
  const measured = { '--osc-fs-2xs': 10, '--osc-fs-xs': 10.5, '--osc-fs-sm': 11.5, '--osc-fs-tab': 10.6,
    '--osc-fs-control': 11 };
  for (const [name, ref] of Object.entries(measured)) {
    assert.ok(tokenPx(css, name, 390) >= 12, `${name} at 390 px`);
    assert.ok(tokenPx(css, name, 480) >= 12 - 1e-9, `${name} at 480 px`);
    assert.ok(Math.abs(tokenPx(css, name, 1536) - ref) < 1e-9, `${name} at 1536 px is ${ref} px`);
    assert.ok(Math.abs(tokenPx(css, name, 1280) - ref) < 1e-9, `${name} at 1280 px is ${ref} px`);
  }
});
