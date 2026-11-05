// The Synth's plates fill the column they are given, not the viewport (lane A's Pro shell, s-choices
// at 1536): with viewport breakpoints (2xl:grid-cols-4) the sidebar and the patch bay left each of
// four plates about 171 px, and VCO 1's waveform dial ran past its plate. The grid now places as
// many plates as fit at a width that holds a choice's widest dial (CHOICE_MAX_PX) and the plate's
// pads.
//   node --test tests/unit/synth-plate-grid.test.mjs
// Wiring: src/js/synth/ui.js PLATE_GRID; the browser check is tests/browser/synth.cjs s-choices.
// Fails on f7ba6fca (2xl:grid-cols-4, no auto-fill).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CHOICE_MAX_PX } from '../../src/js/synth/view/knob.js';

const SRC = readFileSync(new URL('../../src/js/synth/ui.js', import.meta.url), 'utf8');
const grid = (SRC.match(/const PLATE_GRID = '([^']+)'/) || [])[1] || '';
const PLATE_PADS_PX = 24; // the plate's px-3 on each side

test('the plate grid fills its column with plates no narrower than their widest dial', () => {
  assert.ok(grid, 'synth/ui.js defines PLATE_GRID');
  assert.doesNotMatch(grid, /\b(sm|md|lg|xl|2xl):grid-cols-/,
    'no viewport breakpoint picks the plate count');
  const m = grid.match(/grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,([\d.]+)rem\),1fr\)\)\]/);
  assert.ok(m, `auto-fill columns with a rem minimum: ${grid}`);
  assert.ok(Number(m[1]) * 16 >= CHOICE_MAX_PX + PLATE_PADS_PX,
    `${m[1]}rem holds a ${CHOICE_MAX_PX} px dial and the ${PLATE_PADS_PX} px pads`);
});
