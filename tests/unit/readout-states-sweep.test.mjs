// T003 (truth-table row GEN-04): the sweep form's Start, End and Duration fields show their own
// error where the value is typed, and a limit derived from the provisional 44.1 kHz rate (no
// AudioContext yet) is named provisional instead of reading as this device's digital limit.
//   node --test tests/unit/readout-states-sweep.test.mjs
// The browser half is the "sweep field errors" check of tests/browser/app.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createInstrument } from '../../src/js/core/instrument.js';
import { createWorkbench, SWEEP_FORM } from '../../src/js/ui/workbench.js';

const HTML = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');

/** The instrument and the workbench composed as main.js composes them (defineProperties). */
function sweepApp(sampleRate = null) {
  const app = {};
  for (const part of [createInstrument({ engine: null }), createWorkbench({})]) {
    Object.defineProperties(app, Object.getOwnPropertyDescriptors(part));
  }
  app.sampleRate = sampleRate;
  app.source = 'sweep';
  return app;
}

const field = (key) => SWEEP_FORM.find((d) => d.key === key);
const TYPED = SWEEP_FORM.filter((d) => d.type !== 'select');

test('30000 Hz before audio starts: limited to 20.95 kHz, named provisional, on the field', () => {
  const app = sweepApp(null);
  const end = field('end');
  app.setSweepField(end, '30000');
  assert.equal(app.sweep.end, 20947.5);
  const msg = app.ppError(end);
  assert.match(msg, /20\.95 kHz/);
  assert.match(msg, /provisional/);
  assert.equal(app.paramErrors['sweep-end'], msg);
});

test('30000 Hz with a 48 kHz context: limited to 22.80 kHz, not provisional', () => {
  const app = sweepApp(48000);
  const end = field('end');
  app.setSweepField(end, '30000');
  assert.equal(app.sweep.end, 22800);
  const msg = app.ppError(end);
  assert.match(msg, /22\.80 kHz/);
  assert.doesNotMatch(msg, /provisional/);
});

test('an in-range frequency and a valid duration show no error', () => {
  const app = sweepApp(null);
  app.setSweepField(field('end'), '30000');
  app.setSweepField(field('end'), '10000');
  assert.equal(app.sweep.end, 10000);
  assert.equal(app.ppError(field('end')), '');
  app.setSweepField(field('durationMs'), '4');
  assert.equal(app.sweep.durationMs, 4000);
  assert.equal(app.ppError(field('durationMs')), '');
});

test('a parse error and a duration clamp are shown on their own field', () => {
  const app = sweepApp(null);
  const start = field('start');
  const before = app.sweep.start;
  app.setSweepField(start, 'abc');
  assert.equal(app.sweep.start, before, 'an unparsable value leaves the setpoint alone');
  assert.match(app.ppError(start), /is not a frequency/);
  app.setSweepField(field('durationMs'), '99');
  assert.equal(app.sweep.durationMs, 30000);
  assert.match(app.ppError(field('durationMs')), /adjusted/);
  assert.equal(app.ppError(field('end')), '', 'one field\'s error is not another\'s');
});

test('below the 1 Hz floor the raised value says so', () => {
  const app = sweepApp(null);
  app.setSweepField(field('start'), '0.25');
  assert.equal(app.sweep.start, 1);
  assert.match(app.ppError(field('start')), /1 Hz/);
});

test('every typed SWEEP_FORM field has an error of its own', () => {
  const app = sweepApp(null);
  const keys = new Set();
  for (const d of TYPED) {
    app.setSweepField(d, 'abc');
    assert.notEqual(app.ppError(d), '', `${d.key}: an unparsable value shows an error`);
    keys.add(app.ppErrorKey(d));
  }
  assert.equal(keys.size, TYPED.length, 'no two fields share an error');
  for (const d of SWEEP_FORM.filter((x) => x.type === 'select')) assert.equal(app.ppError(d), '');
});

test('markup: the field template the sweep form renders binds an alert to each field', () => {
  const app = sweepApp(null);
  assert.deepEqual(app.ppFields, SWEEP_FORM, 'the sweep form renders through the shared template');
  const start = HTML.indexOf('id="osc-pattern-params"');
  assert.ok(start > 0);
  const params = HTML.slice(start, HTML.indexOf('</template>\n                </div>', start));
  const loop = params.match(/<template x-for="d in ppFields"[^>]*>([\s\S]*)/);
  assert.ok(loop, 'one x-for renders the pattern and the sweep fields');
  const body = loop[1];
  const alert = body.match(/<p\b[^>]*role="alert"[^>]*>/);
  assert.ok(alert, 'each field has a role=alert element');
  assert.match(alert[0], /:id="ppErrorId\(d\)"/);
  assert.match(alert[0], /x-text="ppError\(d\)"/);
  assert.match(alert[0], /x-show="ppError\(d\)"/);
  const input = body.match(/<input\b[^>]*>/);
  assert.ok(input);
  assert.match(input[0], /:aria-invalid="ppError\(d\) \? 'true' : 'false'"/);
  assert.match(input[0], /:aria-describedby="ppError\(d\) \? ppErrorId\(d\) : null"/);
  assert.equal(HTML.match(/x-for="d in SWEEP_FORM"/g), null, 'no second sweep loop without errors');
  for (const d of SWEEP_FORM) assert.equal(app.ppErrorId(d), `sw-${d.key}-error`);
});

test('pattern fields keep their ids and errors through the shared template', () => {
  const app = sweepApp(null);
  app.source = 'single';
  app.setPattern('sweepUp');
  assert.deepEqual(app.ppFields, app.currentPattern.params);
  const d = app.currentPattern.params.find((x) => x.type === 'freq');
  assert.equal(app.ppId(d), app.paramId(d));
  app.ppSet(d, 'abc');
  assert.equal(app.ppError(d), app.paramErrors[app.paramId(d)]);
  assert.notEqual(app.ppError(d), '');
});
