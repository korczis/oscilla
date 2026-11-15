// U103 (found by E054's axe pass, 2026-11-09): the Pro text link (PRO.link, src/js/ui/pro-classes.js)
// meets WCAG AA 4.5:1 on every surface it sits on, in both themes. Its dark text was primary-500,
// 3.99:1 on a dark card (gray-800), which axe flagged on the Learn tool links in chromium, firefox
// and webkit. The colours are read from the classes and the Tailwind palette the build uses
// (tailwind.config.cjs: primary is the blue scale), never retyped.
//   node --test tests/unit/u103-link-contrast.test.mjs
// Fail-first: on the merge base PRO.link is dark:text-primary-500, 3.99:1 on gray-800.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { PRO } from '../../src/js/ui/pro-classes.js';
import { contrastOf } from './ui-synth-fixture.mjs';

const require = createRequire(import.meta.url);
const colors = require('tailwindcss/colors');
const PALETTE = { primary: colors.blue, gray: colors.gray, white: { DEFAULT: '#ffffff' } };

/** The colour a utility like `dark:text-primary-400` or `bg-white` names, as #rrggbb. */
function colourOf(classes, prefix) {
  const m = new RegExp(`(?:^|\\s)${prefix}-(primary|gray|white)(?:-(\\d{2,3}))?(?=\\s|$)`)
    .exec(classes);
  assert.ok(m, `no ${prefix}-* colour in "${classes}"`);
  return m[1] === 'white' ? '#ffffff' : PALETTE[m[1]][m[2]];
}

// The surfaces a Pro link sits on: a Pro card, and the page itself (gray-900 dark, white light).
const SURFACES = {
  light: [['card', colourOf(PRO.card, 'bg')], ['page', '#ffffff']],
  dark: [['card', colourOf(PRO.card, 'dark:bg')], ['page', colors.gray[900]]],
};

test('PRO.link meets 4.5:1 on a Pro card and on the page, in the dark theme', () => {
  const text = colourOf(PRO.link, 'dark:text');
  for (const [where, bg] of SURFACES.dark) {
    const ratio = contrastOf(text, bg);
    assert.ok(ratio >= 4.5, `dark ${where}: ${text} on ${bg} is ${ratio.toFixed(2)}:1, under 4.5`);
  }
});

test('PRO.link meets 4.5:1 on a Pro card and on the page, in the light theme', () => {
  const text = colourOf(PRO.link, 'text');
  for (const [where, bg] of SURFACES.light) {
    const ratio = contrastOf(text, bg);
    assert.ok(ratio >= 4.5, `light ${where}: ${text} on ${bg} is ${ratio.toFixed(2)}:1, under 4.5`);
  }
});

test('the measure is the one axe reported: primary-500 on gray-800 is under AA', () => {
  assert.ok(Math.abs(contrastOf(colors.blue[500], colors.gray[800]) - 3.99) < 0.01);
});
