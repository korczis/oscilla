// K058: the knob's value model (src/js/synth/view/knob.js): value to angle, the log domain,
// 200 px for the full range and Shift for a tenth, the keys, typed values with units, refusals
// with the registry's reason, formatting and enum stepping. No tween: a value is a setpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAG_FULL_PX, knobModel, knobSvg, stepOption } from '../../src/js/synth/view/knob.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';

const cutoff = PANEL.module('lpf').params.find((p) => p.key === 'frequency');
const tune = PANEL.module('vco1').params.find((p) => p.key === 'tune');
const wave = PANEL.module('vco1').params.find((p) => p.key === 'waveform');

test('angle spans -135 to +135 degrees; a log range maps in octaves', () => {
  const m = knobModel(cutoff);
  assert.equal(m.angle(10), -135);
  assert.equal(m.angle(20000), 135);
  assert.ok(Math.abs(m.angle(Math.sqrt(10 * 20000))) < 1e-9, 'the geometric middle is up');
  assert.equal(knobModel(tune).angle(0), 0);
});

test('a drag of 200 px covers the range; Shift a tenth of it', () => {
  const m = knobModel(tune);
  assert.equal(m.drag(-1200, -DRAG_FULL_PX), 1200);
  assert.equal(m.drag(0, -DRAG_FULL_PX / 2, true), 120);
  assert.equal(m.drag(0, 10_000), -1200, 'clamped');
});

test('keys: arrows step, Shift a tenth, PageUp 10 % of the range, Home and End', () => {
  const m = knobModel(tune);
  assert.equal(m.key(0, 'ArrowUp'), 1);
  assert.equal(m.key(0, 'ArrowLeft'), -1);
  assert.equal(m.key(0, 'PageUp'), 240);
  assert.equal(m.key(0, 'Home'), -1200);
  assert.equal(m.key(0, 'End'), 1200);
  assert.equal(m.key(0, ' '), null, 'Space is never taken (ADR 0050)');
  const c = knobModel(cutoff);
  assert.ok(c.key(1000, 'ArrowUp') > 1000 && c.key(1000, 'ArrowUp', true) < c.key(1000, 'ArrowUp'));
});

test('typed values: 1.2k, 1200 Hz, -3; out of range refused with the registry reason', () => {
  const c = knobModel(cutoff);
  assert.deepEqual(c.parse('1.2k'), { ok: true, value: 1200 });
  assert.deepEqual(c.parse('1200 Hz'), { ok: true, value: 1200 });
  assert.deepEqual(knobModel(tune).parse('-3'), { ok: true, value: -3 });
  assert.match(c.parse('40k').reason, /Cutoff must be between 10 and 20000/);
  assert.equal(c.parse('loud').ok, false);
  const att = PANEL.module('eg2').params.find((p) => p.key === 'attack');
  assert.equal(knobModel(att).parse('350 ms').value, 0.35);
});

test('format with units; switches step their options; the drawing is a function of value', () => {
  assert.equal(knobModel(cutoff).format(1200), '1.20 kHz');
  assert.equal(knobModel(tune).format(-12), '-12 ct');
  assert.equal(knobModel(tune).format(702), '+702 ct');
  assert.equal(stepOption(wave, 'sawtooth', 1), 'square');
  assert.equal(stepOption(wave, 'triangle', -1), 'triangle');
  const t = new Proxy({}, { get: () => 'currentColor' });
  assert.equal(knobSvg({ uid: 'a', value: 5, param: tune, tokens: t }),
    knobSvg({ uid: 'a', value: 5, param: tune, tokens: t }), 'no state, no tween');
});
