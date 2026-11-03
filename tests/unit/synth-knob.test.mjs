// K058: the knob's value model (src/js/synth/view/knob.js, since F013 W1b an adapter onto the
// synth-theme core src/js/ui/synth/knob.js): value to angle, the log domain, 200 px for the full
// range and Shift for a tenth, the keys, typed values with units, refusals with the registry's
// reason, formatting and enum stepping, each the core's. No tween: a value is a setpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAG_FULL_PX, knobModel, knobSvg, stepOption } from '../../src/js/synth/view/knob.js';
import * as core from '../../src/js/ui/synth/knob.js';
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
  assert.equal(knobModel(cutoff).format(1200), '1.2 kHz');
  assert.equal(knobModel(tune).format(-12), '-12 ct');
  assert.equal(knobModel(tune).format(702), '+702 ct');
  assert.equal(stepOption(wave, 'sawtooth', 1), 'square');
  assert.equal(stepOption(wave, 'triangle', -1), 'triangle');
  const t = new Proxy({}, { get: () => 'currentColor' });
  assert.equal(knobSvg({ uid: 'a', value: 5, param: tune, tokens: t }),
    knobSvg({ uid: 'a', value: 5, param: tune, tokens: t }), 'no state, no tween');
});

/** The units a knob's readout writes (review 2 of W1b, finding 1): short and physical. */
const READOUT_UNITS = new Set(['', 'Hz', 's', 'dB', 'cents', 'st', 'oct', '%', '×']);

test('a readout shows only a short physical unit; aria-valuetext keeps every unit', () => {
  const level = PANEL.module('out').params.find((p) => p.key === 'level');
  assert.equal(level.unit, 'logical gain');
  assert.equal(knobModel(level).format(0.08), '0.080');
  assert.equal(knobModel(level).text(0.08), '0.080 logical gain');
  const tilt = PANEL.module('additive').params.find((p) => p.key === 'tilt');
  assert.equal(knobModel(tilt).format(-12), '-12.0');
  assert.equal(knobModel(tilt).text(-12), '-12.0 dB/oct');
  assert.equal(knobModel(cutoff).format(20000), '20 kHz', 'a physical unit stays');
});

test('the model is the core\'s: text, typed entry, drag, keys and the drawing (F013 W1b)', () => {
  const numbers = PANEL.modules.flatMap((m) => PANEL.faceOf(m.id)).map((c) => c.param)
    .filter((p) => p && (p.type === 'number' || p.type === 'integer'));
  assert.ok(numbers.length > 90);
  assert.equal(DRAG_FULL_PX, core.DRAG_PX_PER_RANGE);
  for (const p of numbers) {
    const m = knobModel(p);
    const mid = core.fromNorm(0.37, p);
    for (const v of [p.min, p.max, mid]) {
      assert.equal(m.text(v), core.formatValue(v, p), `${p.key} aria text`);
      // The readout drops a unit that is not short and physical; the text keeps every unit.
      const unit = ` ${p.unit}`;
      assert.equal(m.format(v), READOUT_UNITS.has(p.unit || '') ? core.formatValue(v, p)
        : core.formatValue(v, p).replace(new RegExp(`${unit.replace(/[/]/g, '\\/')}$`), ''),
      `${p.key} readout`);
      assert.deepEqual(m.parse(m.format(v)), m.parse(m.text(v)), `${p.key}: the typed entry `
        + 'the readout fills reads the same value');
      assert.equal(m.norm(v), core.toNorm(v, p), `${p.key} norm`);
      for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
        for (const shiftKey of [false, true]) {
          assert.equal(m.key(v, key, shiftKey), core.knobKey({ key, shiftKey },
            { value: v, param: p }), `${p.key} ${key}`);
        }
      }
      assert.equal(m.key(v, 'Enter'), null, 'Enter is the panel\'s typed entry, not a value');
      assert.equal(m.drag(v, -37, true), core.dragValue(v, -37, p, { fine: true }));
      assert.deepEqual(m.parse(core.formatValue(v, p)), core.parseValue(core.formatValue(v, p), p));
    }
    assert.equal(m.value(0.37), core.quantize(mid, p), `${p.key} value`);
  }
  assert.equal(stepOption, core.stepOption);
  const t = new Proxy({}, { get: () => 'currentColor' });
  assert.match(knobSvg({ uid: 'a', value: 5, param: tune, tokens: t }),
    /^<svg [^>]*><g data-control="knob">/);
});
