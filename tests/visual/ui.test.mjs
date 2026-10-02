// Pure-function tests for the visual shell (node --test tests/visual/ui.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, sliderFill, createOscillaUi } from '../../src/js/ui/app.js';
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
