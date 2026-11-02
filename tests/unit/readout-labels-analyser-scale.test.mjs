// T005: the analyser scale is named where a reader meets it. About states the levels are
// relative, dBFS-like and uncalibrated (ADR 0017), never bare "dBFS"; README and the glossary
// say in one line that a full-scale sine reads near -13.6 dB on the analyser scale and that the
// MEASURE scales differ (docs/v3/algorithms.md). The figure is tied to the peak detector's
// correction, so the prose cannot drift from the code that defines it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SINE_DBFS_CORRECTION_DB } from '../../src/js/analysis/peak-detector.js';
import { SPECTRUM_Y_LABEL } from '../../src/js/charts/spectrum-chart.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const html = read('src/index.html');
const aboutView = html.slice(html.indexOf('id="osc-view-about"'), html.indexOf('</main>'));

/** The <dd> of the About "Levels" row. */
function aboutLevels() {
  const m = aboutView.match(/<dt>Levels<\/dt>\s*<dd>([^<]*)<\/dd>/);
  assert.ok(m, 'About has a Levels row');
  return m[1].replace(/\s+/g, ' ').trim();
}

/** The analyser-scale offset written as a reader sees it: one decimal, either minus sign. */
const OFFSET = SINE_DBFS_CORRECTION_DB.toFixed(1);
const offsetPattern = new RegExp(`[-−]${OFFSET.replace('.', '\\.')}\\s?dB`);

/** The paragraph or list item of a Markdown document that states the offset, or null. */
function offsetStatement(markdown) {
  return markdown.split(/\n\s*\n/).find((block) => offsetPattern.test(block)) ?? null;
}

test('the correction the docs quote is the Blackman one-sided coherent gain (13.6 dB)', () => {
  assert.equal(OFFSET, '13.6');
});

test('About names the levels dBFS-like and uncalibrated, never bare dBFS', () => {
  const levels = aboutLevels();
  assert.match(levels, /dBFS-like/);
  assert.match(levels, /uncalibrated/);
  assert.doesNotMatch(levels, /Relative \(dBFS\)/);
  assert.doesNotMatch(levels, /\bdBFS\b(?!-like)/, 'no bare dBFS');
});

test('About keeps dB SPL bound to a level calibration in MEASURE', () => {
  assert.match(aboutLevels(), /dB SPL only with a level calibration in MEASURE/);
});

for (const path of ['README.md', 'docs/GLOSSARY.md']) {
  test(`${path} states the analyser scale offset and that the MEASURE scales differ`, () => {
    const block = offsetStatement(read(path));
    assert.ok(block, `${path} states a full-scale sine near -${OFFSET} dB`);
    assert.match(block, /full-scale sine/);
    assert.match(block, /analyser/i);
    assert.match(block, /dBFS-like/);
    assert.match(block, /docs\/v3\/algorithms\.md/, 'points to where the MEASURE scales are');
    assert.doesNotMatch(block, /dB SPL(?! only| exactly| appears only)/, 'no unconditional SPL');
  });
}

test('the single-mode spectrum caption stays as ADR 0017 chose it', () => {
  assert.equal(SPECTRUM_Y_LABEL, 'RELATIVE LEVEL (dBFS-like, uncalibrated)');
  assert.match(html, /aria-label="Live spectrum, relative level \(dBFS-like analyser level\)"/);
});
