// U115 pass 7b: the Measure workspace's state words stay English as data (the live quality
// bar's items and values, the quality statuses, the UNAVAILABLE words, the result views' badges)
// and the page shows them through measurement/views/display.js in Czech. Derived from the view
// models: every word the bar, the panel and the views produce is shown without an English state
// word; whole words only, longest first (the lesson of C3-590-1); the page reads them through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MEASURE_WORDS, measureShown } from '../../src/js/measurement/views/display.js';
import { LOOPBACK_LABEL } from '../../src/js/measurement/capture.js';
import {
  initialQualityBar, qualityBarView, qualityPanel, QUALITY_BAR_ITEMS,
} from '../../src/js/measurement/views/quality-bar.js';
import {
  QUALITY_STATUS_PRESENTATION, UNAVAILABLE,
} from '../../src/js/measurement/views/common.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ENGLISH = new RegExp(`(?<![\\wÀ-ž-])(?:${Object.keys(MEASURE_WORDS)
  .sort((a, b) => b.length - a.length).map(escape).join('|')}|(?:UN)?CALIBRATED)(?![\\wÀ-ž-])`);

test('every Measure state word has a Czech form, and the form is not English', () => {
  for (const [en, cs] of Object.entries(MEASURE_WORDS)) {
    assert.equal(measureShown(en), cs, en);
    assert.doesNotMatch(cs, ENGLISH, cs);
  }
  for (const w of Object.values(UNAVAILABLE)) assert.doesNotMatch(measureShown(w), ENGLISH, w);
  for (const p of Object.values(QUALITY_STATUS_PRESENTATION)) {
    assert.doesNotMatch(measureShown(p.text), ENGLISH, p.text);
  }
});

test('the live bar as shown: every item and value of the initial bar, in Czech', () => {
  const bar = qualityBarView(initialQualityBar());
  assert.deepEqual(bar.items.map((i) => i.id), QUALITY_BAR_ITEMS);
  const shown = bar.items.map((i) => measureShown(i.text));
  assert.deepEqual(shown, ['VSTUP NEZNÁMO', 'ŠUM NEZMĚŘENO', 'OŘEZ ZATÍM NEKONTROLOVÁNO',
    'SIGNÁL NEZMĚŘENO', 'ZÁZNAM NEČINNÝ']);
  for (const s of shown) assert.doesNotMatch(s, ENGLISH, s);
  // The data stays English: the views' tests and the page's state read these.
  assert.equal(bar.items[0].text, 'INPUT UNKNOWN');
  assert.equal(qualityPanel(null).statusText, 'NOT ASSESSED');
  assert.equal(measureShown(qualityPanel(null).statusText), 'NEPOSOUZENO');
});

test('whole words only, longest first, in either order (C3-590-1)', () => {
  assert.equal(measureShown('NOT CHECKED YET'), 'ZATÍM NEKONTROLOVÁNO');
  assert.equal(measureShown('CLIPPING NOT CHECKED · CLIPPING NOT CHECKED YET'),
    'OŘEZ NEKONTROLOVÁNO · OŘEZ ZATÍM NEKONTROLOVÁNO');
  assert.equal(measureShown('NOISE CHECK SNAPSHOT · NOISE'), 'SNÍMEK KONTROLY ŠUMU · ŠUM');
  assert.equal(measureShown('INPUTS'), 'INPUTS', 'never inside a longer word');
  assert.equal(measureShown('INVALID_CALIBRATION'), 'INVALID_CALIBRATION', 'nor inside a code');
  assert.equal(measureShown('CAPTURE 63 %'), 'ZÁZNAM 63 %');
  // TEST CONTEXT: the loopback's stored label whole, and the name in any other stored label.
  assert.equal(measureShown(LOOPBACK_LABEL), MEASURE_WORDS[LOOPBACK_LABEL]);
  assert.match(measureShown('TEST CONTEXT: synthetic (unit test)'), /^TESTOVACÍ KONTEXT: /);
  // Calibration states first, through calibrationShown: no half-Czech state survives.
  assert.equal(measureShown('UNCALIBRATED (frequency)'), 'NEKALIBROVÁNO (frekvence)');
  assert.equal(measureShown('Hraje'), 'Hraje');
  assert.equal(measureShown(''), '');
  assert.equal(measureShown(null), null);
});

test('the page reads the bar, the status, the badges and the result titles through it', () => {
  const html = readFileSync(`${ROOT}src/index.html`, 'utf8');
  for (const re of [
    /x-text="calibrationShown\(measureShown\(it\.text\)\)"/,
    /:title="calibrationShown\(measureShown\(it\.detail\)\) \|\| ''"/,
    /x-text="measureShown\(meas\.quality\.statusText\)"/,
    /x-text="calibrationShown\(measureShown\(mt\.text\)\)"/,
    /x-text="measureShown\(meas\.shownTitle \|\| 'NOT MEASURED'\)"/,
    /x-text="measureShown\(meas\.rta \? meas\.rta\.mode : 'NOT MEASURED'\)"/,
    /x-text="measureShown\(meas\.testContext\) \|\|/,
  ]) assert.match(html, re);
  assert.equal(html.match(/x-text="calibrationShown\(measureShown\(b\)\)"/g).length, 3,
    'the response, IR and RTA badges');
});
