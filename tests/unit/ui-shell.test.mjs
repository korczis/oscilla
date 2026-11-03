// Pure-function tests for the visual shell (node --test tests/unit/ui-shell.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTheme, sliderFill, createOscillaUi, keepInScrollerView,
} from '../../src/js/ui/app.js';
import { buildLut, hexToRgb, LUT_POSITIONS } from '../../src/js/ui/theme.js';

test('theme defaults to dark', () => {
  assert.equal(resolveTheme(null), 'dark');
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('neon'), 'dark');
});

test('sliderFill maps value into 0..100%', () => {
  assert.equal(sliderFill({ min: '0', max: '1000', value: '963' }), '96.30%');
  assert.equal(sliderFill({ min: '-1', max: '1', value: '0' }), '50.00%');
  assert.equal(sliderFill({ min: '0', max: '0', value: '0' }), '0%');
  assert.equal(sliderFill({ min: '0', max: '10', value: '20' }), '100.00%');
});

test('component state: tabs restore only known values', () => {
  assert.equal(createOscillaUi({ storedAnalysisTab: 'spectrum' }).tabs.analysis, 'spectrum');
  assert.equal(createOscillaUi({ storedAnalysisTab: 'bogus' }).tabs.analysis, 'waveform');
});

test('LUT: endpoints equal the first/last stop', () => {
  const stops = [{ pos: 0, rgb: [0, 0, 0] }, { pos: 1, rgb: [255, 128, 0] }];
  const lut = buildLut(stops, 3);
  assert.deepEqual([...lut.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...lut.slice(8, 12)], [255, 128, 0, 255]);
  assert.deepEqual(hexToRgb('#faee97'), [250, 238, 151]);
  assert.equal(LUT_POSITIONS.length, 18);
});

// WCAG 2.4.11: a control reached with Tab that is only partly inside its scrolling box is
// brought fully into it (the nav strip; the compact Studio's chips since the Synth voice).
test('keepInScrollerView scrolls a partly hidden control fully into its box, and only then', () => {
  const box = (left, right, scrollWidth, clientWidth) => ({ scrollLeft: 0, scrollWidth, clientWidth,
    getBoundingClientRect: () => ({ left, right }) });
  const el = (left, right) => ({ getBoundingClientRect: () => ({ left, right }) });
  const b = box(22, 746, 1100, 724);
  keepInScrollerView(el(711, 782), b); // the chip CI found partly off-screen at 768 px
  assert.equal(b.scrollLeft, 782 - (746 - 8), 'right edge brought inside, with the 8 px pad');
  const c = box(22, 746, 1100, 724);
  c.scrollLeft = 100;
  keepInScrollerView(el(10, 60), c);
  assert.equal(c.scrollLeft, 100 - (22 + 8 - 10), 'left edge brought inside');
  const d = box(22, 746, 1100, 724);
  keepInScrollerView(el(100, 200), d);
  assert.equal(d.scrollLeft, 0, 'a control already inside moves nothing');
  const e = box(22, 746, 700, 724);
  keepInScrollerView(el(711, 782), e);
  assert.equal(e.scrollLeft, 0, 'a box that does not scroll is left alone');
  assert.doesNotThrow(() => keepInScrollerView(null, b));
});
