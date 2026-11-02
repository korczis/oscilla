// The shared synth-theme layer's control core (src/js/ui/synth/knob.js; the control API agreed
// 2026-11-02): value mapping (lin and log, as the node registry spells them; enum and boolean as
// positions), quantize and fine, vertical drag (a fader's cap under the finger), the wheel by
// pixels with a carried rest, the pure knobKey (the control adds no key listener: K153 counts
// them; Delete, Backspace, Space and Escape are the page's), typed entry (parseValue), the value
// text on the value's own grid and the ARIA attributes, and controlSvg, the knob, fader and
// switch drawn only from tokens inside CONTROL_BOX, with a hit area of at least 44 screen px that
// always holds the drawing, and an applied marker. Every finite parameter of every registry node
// type goes through all of it. The value is a setpoint: nothing tweens.
//   node --test tests/unit/ui-synth-knob.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampValue, toNorm, fromNorm, quantize, defaultValue, dragValue, wheelValue, knobKey,
  formatValue, ariaAttrs, controlSvg, parseValue, stepOption, pixelsPerRangeFor, HIT_PX,
  CONTROL_BOX, DRAG_PX_PER_RANGE, FADER_TRAVEL, LOG_STEPS, WHEEL_NOTCH_PX, WHEEL_LINE_PX,
} from '../../src/js/ui/synth/knob.js';
import { NODE_DEFINITIONS } from '../../src/js/studio/registry.js';
import { TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues } from
  './ui-synth-fixture.mjs';

const LIN = Object.freeze({ id: 'level', label: 'Level', unit: '%', min: 0, max: 100, step: 1,
  scale: 'lin', default: 50 });
const LOG = Object.freeze({ id: 'cutoff', label: 'Cutoff', unit: 'Hz', min: 20, max: 20000,
  step: 1, scale: 'log', default: 1000 });
const FLOAT = Object.freeze({ id: 'res', label: 'Resonance', unit: '', min: 0, max: 1,
  step: 0.01, scale: 'lin', default: 0.5 });
const INT = Object.freeze({ id: 'oct', label: 'Octave', unit: 'st', min: -24, max: 24, step: 1,
  scale: 'lin', default: 0, type: 'integer' });
const TIME_LOG = Object.freeze({ id: 'f', label: 'F', unit: 'Hz', min: 20, max: 20000,
  scale: 'log', default: 1000 });
const SMOOTH = Object.freeze({ id: 'pan', label: 'Pan', unit: '', min: -1, max: 1,
  scale: 'lin', default: 0 });
const TIME = Object.freeze({ id: 'att', label: 'Attack', unit: 's', min: 0.001, max: 10,
  step: 0.001, scale: 'log', default: 0.01 });

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const key = (k, mods = {}) => ({ key: k, shiftKey: false, ...mods });

// ---------------------------------------------------------------- value mapping

test('lin: toNorm and fromNorm are inverse, and both clamp', () => {
  assert.equal(toNorm(0, LIN), 0);
  assert.equal(toNorm(100, LIN), 1);
  assert.equal(toNorm(25, LIN), 0.25);
  assert.equal(toNorm(-5, LIN), 0);
  assert.equal(toNorm(500, LIN), 1);
  assert.equal(fromNorm(0.25, LIN), 25);
  assert.equal(fromNorm(-1, LIN), 0);
  assert.equal(fromNorm(2, LIN), 100);
  for (const v of [0, 0.5, 13.37, 50, 99.99, 100]) near(fromNorm(toNorm(v, LIN), LIN), v);
  for (const v of [-1, -0.3, 0, 0.42, 1]) near(fromNorm(toNorm(v, SMOOTH), SMOOTH), v);
});

test('log: equal ratios are equal norm distances, and the round trip holds', () => {
  assert.equal(toNorm(20, LOG), 0);
  assert.equal(toNorm(20000, LOG), 1);
  near(toNorm(632.4555320336759, LOG), 0.5);
  near(fromNorm(0.5, LOG), Math.sqrt(20 * 20000));
  near(toNorm(200, LOG) - toNorm(20, LOG), toNorm(2000, LOG) - toNorm(200, LOG));
  for (const v of [20, 31.5, 440, 1000, 12345.6, 20000]) {
    near(fromNorm(toNorm(v, LOG), LOG), v, 1e-7);
  }
  for (const v of [0.001, 0.05, 1, 10]) near(fromNorm(toNorm(v, TIME), TIME), v, 1e-12);
});

test('log refuses a range that does not start above zero, with a clear Error', () => {
  for (const min of [0, -1]) {
    const p = { ...LOG, min };
    assert.throws(() => toNorm(10, p), /cutoff: a log scale needs min > 0/);
    assert.throws(() => fromNorm(0.5, p), /a log scale needs min > 0/);
    assert.throws(() => quantize(10, p), Error);
  }
  assert.throws(() => toNorm(1, { ...LIN, min: 5, max: 5 }), /max above min/);
  assert.throws(() => toNorm(1, { ...LIN, scale: 'exp' }), /scale/);
});

test('scale: lin, linear and none are linear, log is log, anything else is refused', () => {
  for (const scale of ['lin', 'linear', undefined]) {
    const p = { ...LIN, scale };
    assert.equal(toNorm(25, p), 0.25, String(scale));
    assert.equal(fromNorm(0.25, p), 25, String(scale));
    assert.equal(knobKey(key('ArrowUp'), { value: 50, param: p }), 51, String(scale));
  }
  near(toNorm(632.4555320336759, { ...LOG, scale: 'log' }), 0.5);
  for (const scale of ['exp', 'Linear', 'LOG', '', null, 1]) {
    assert.throws(() => toNorm(1, { ...LIN, scale }), /scale must be 'lin', 'linear' or 'log'/,
      String(scale));
  }
  const keyed = { key: 'level', label: 'Level', min: 0, max: 1, scale: 'exp' };
  assert.throws(() => toNorm(0.5, keyed), /^Error: level: /, 'a registry descriptor names its key');
  assert.throws(() => toNorm(0.5, { ...keyed, id: 'lvl' }), /^Error: lvl: /, 'id first');
});

test('clampValue holds a value to [min, max]; anything not a number reads min', () => {
  assert.equal(clampValue(-3, LIN), 0);
  assert.equal(clampValue(42.5, LIN), 42.5);
  assert.equal(clampValue(101, LIN), 100);
  assert.equal(clampValue(1, LOG), 20);
  for (const v of [undefined, null, NaN, '50', {}, [], true]) {
    assert.equal(clampValue(v, LIN), 0, String(v));
    assert.equal(clampValue(v, LOG), 20, String(v));
  }
});

test('ariaAttrs and controlSvg never carry NaN, whatever the value', () => {
  for (const v of [undefined, null, NaN, 'x', {}]) {
    const a = ariaAttrs(v, LIN);
    assert.equal(a['aria-valuenow'], 0, String(v));
    assert.equal(a['aria-valuetext'], '0 %');
    for (const kind of ['knob', 'fader', 'switch']) {
      assert.doesNotMatch(controlSvg({ kind, value: v, param: LIN, tokens: TOKENS }), /NaN/);
    }
  }
});

test('quantize snaps to the step in value space, clamps, and leaves no float noise', () => {
  assert.equal(quantize(50.4, LIN), 50);
  assert.equal(quantize(50.6, LIN), 51);
  assert.equal(quantize(-5, LIN), 0);
  assert.equal(quantize(150, LIN), 100);
  assert.equal(quantize(0.1 + 0.2, FLOAT), 0.3);
  assert.equal(quantize(0.123, FLOAT), 0.12);
  assert.equal(quantize(440.4, LOG), 440);
  assert.equal(quantize(0.30000000000000004, SMOOTH), 0.3, 'no step: only the noise goes');
  assert.equal(quantize(0.123456, SMOOTH), 0.123456);
});

test('fine quantizes to a tenth of the step, or the smallest step an integer has', () => {
  assert.equal(quantize(50.44, LIN, { fine: true }), 50.4);
  assert.equal(quantize(0.1234, FLOAT, { fine: true }), 0.123);
  assert.equal(quantize(3.4, INT, { fine: true }), 3);
  assert.equal(quantize(3.6, INT), 4);
});

test('defaultValue is the descriptor default, quantized, or min without one', () => {
  assert.equal(defaultValue(LIN), 50);
  assert.equal(defaultValue(LOG), 1000);
  assert.equal(defaultValue({ ...LIN, default: undefined }), 0);
  assert.equal(defaultValue({ ...LIN, default: 50.4 }), 50);
});

// ---------------------------------------------------------------- drag and wheel

test('drag: up increases, down decreases, over pixelsPerRange for the whole range', () => {
  assert.equal(dragValue(50, -20, LIN), 60, 'up 20 of 200 px is a tenth of the range');
  assert.equal(dragValue(50, 20, LIN), 40);
  assert.equal(dragValue(50, -100, LIN), 100);
  assert.equal(dragValue(50, -1000, LIN), 100, 'clamped');
  assert.equal(dragValue(50, 0, LIN), 50);
  assert.equal(dragValue(50, -10, LIN, { pixelsPerRange: 100 }), 60);
  assert.equal(dragValue(20, -200, LOG), 20000, 'the log range is travelled in norm space');
  near(toNorm(dragValue(632, -20, LOG), LOG) - toNorm(632, LOG), 0.1, 1e-3);
});

test('drag: fine (Shift) moves ten times less over the same distance', () => {
  const coarse = dragValue(50, -20, LIN) - 50;
  const fine = dragValue(50, -20, LIN, { fine: true }) - 50;
  near(fine, coarse / 10);
  assert.equal(dragValue(50, -20, LIN, { fine: true }), 51);
  assert.equal(dragValue(50, -4, LIN, { fine: true }), 50.2, 'fine keeps a tenth of the step');
});

test('wheel: 100 px is a notch, up one step, down one step, fine a tenth', () => {
  assert.equal(WHEEL_NOTCH_PX, 100);
  assert.equal(WHEEL_LINE_PX, 16);
  assert.deepEqual(wheelValue(50, -100, LIN), { value: 51, rest: 0 });
  assert.deepEqual(wheelValue(50, 100, LIN), { value: 49, rest: 0 });
  assert.deepEqual(wheelValue(50, -300, LIN), { value: 53, rest: 0 }, 'three notches at once');
  assert.deepEqual(wheelValue(50, 100, LIN, { fine: true }), { value: 49.9, rest: 0 });
  assert.deepEqual(wheelValue(50, 0, LIN), { value: 50, rest: 0 });
  assert.deepEqual(wheelValue(100, -100, LIN), { value: 100, rest: 0 }, 'held at max');
  assert.ok(wheelValue(1000, -100, LOG).value > 1000);
  assert.deepEqual(wheelValue(50, NaN, LIN), { value: 50, rest: 0 });
});

test('wheel: lines and pages are scaled to px, and the host keeps the rest', () => {
  assert.deepEqual(wheelValue(50, -3, LIN, { deltaMode: 1 }), { value: 50, rest: -48 },
    'three lines are 48 px: not yet a notch');
  assert.deepEqual(wheelValue(50, -7, LIN, { deltaMode: 1 }), { value: 51, rest: -12 });
  assert.deepEqual(wheelValue(50, 1, LIN, { deltaMode: 2 }), { value: 49, rest: 0 }, 'a page');
  assert.deepEqual(wheelValue(50, -60, LIN, { rest: -60 }), { value: 51, rest: -20 },
    'the rest carried in counts');
  assert.deepEqual(wheelValue(50, 30, LIN, { rest: -60 }), { value: 50, rest: -30 },
    'a reversal spends the rest first');
});

test('wheel: a trackpad\'s many small deltas move what their sum says, no more', () => {
  let state = { value: 50, rest: 0 };
  for (let i = 0; i < 40; i++) state = wheelValue(state.value, -2, LIN, { rest: state.rest });
  assert.deepEqual(state, { value: 50, rest: -80 }, '80 px: still under a notch');
  for (let i = 0; i < 60; i++) state = wheelValue(state.value, -2, LIN, { rest: state.rest });
  assert.deepEqual(state, { value: 52, rest: 0 }, '200 px: two notches');
});

test('wheel: a notch is never less than 1 % of the (norm) range', () => {
  const TINY = { ...LIN, step: 0.001 };
  assert.equal(wheelValue(50, -100, TINY).value, 51, 'not 50.001: 1 % of 0..100');
  assert.equal(wheelValue(50, -100, TINY, { fine: true }).value, 50.1, 'fine: 0.1 %');
  const up = wheelValue(1000, -100, LOG).value;
  near(toNorm(up, LOG) - toNorm(1000, LOG), 0.01, 1e-3);
  assert.equal(wheelValue(50, -100, { ...LIN, step: 5 }).value, 55, 'a big step stays a step');
  assert.equal(knobKey(key('ArrowUp'), { value: 50, param: TINY }), 50.001,
    'keys are exempt: one step per press is the precise path');
});

// ---------------------------------------------------------------- knobKey, every branch

test('knobKey: ArrowUp and ArrowRight add a step, ArrowDown and ArrowLeft take one', () => {
  assert.equal(knobKey(key('ArrowUp'), { value: 50, param: LIN }), 51);
  assert.equal(knobKey(key('ArrowRight'), { value: 50, param: LIN }), 51);
  assert.equal(knobKey(key('ArrowDown'), { value: 50, param: LIN }), 49);
  assert.equal(knobKey(key('ArrowLeft'), { value: 50, param: LIN }), 49);
  assert.equal(knobKey(key('ArrowUp'), { value: 0.5, param: FLOAT }), 0.51);
  assert.equal(knobKey(key('ArrowUp'), { value: 100, param: LIN }), 100, 'held at max');
  assert.equal(knobKey(key('ArrowDown'), { value: 0, param: LIN }), 0, 'held at min');
});

test('knobKey: Shift (or fine) is a tenth of the step, an integer its smallest step', () => {
  assert.equal(knobKey(key('ArrowUp', { shiftKey: true }), { value: 50, param: LIN }), 50.1);
  assert.equal(knobKey(key('ArrowDown'), { value: 50, param: LIN, fine: true }), 49.9);
  assert.equal(knobKey(key('ArrowLeft', { shiftKey: true }), { value: 0.5, param: FLOAT }),
    0.499);
  assert.equal(knobKey(key('ArrowUp', { shiftKey: true }), { value: 3, param: INT }), 4);
  assert.equal(knobKey(key('ArrowUp'), { value: 3, param: INT, fine: false }), 4);
});

test('knobKey: a stepless range moves 1 % per key, a tenth with Shift', () => {
  assert.equal(knobKey(key('ArrowUp'), { value: 0, param: SMOOTH }), 0.02);
  assert.equal(knobKey(key('ArrowUp', { shiftKey: true }), { value: 0, param: SMOOTH }), 0.002);
});

test('knobKey: a log range moves 1/LOG_STEPS in norm space and never stalls on its step', () => {
  assert.equal(LOG_STEPS, 200, 'kept from K058 (0.5 %), as dev-53 decided on 2026-11-02');
  const up = knobKey(key('ArrowUp'), { value: 1000, param: LOG });
  near(toNorm(up, LOG) - toNorm(1000, LOG), 0.005, 1e-3);
  const fine0 = knobKey(key('ArrowUp', { shiftKey: true }), { value: 1000, param: TIME_LOG });
  near(toNorm(fine0, TIME_LOG) - toNorm(1000, TIME_LOG), 0.0005, 1e-4);
  const fine = knobKey(key('ArrowUp', { shiftKey: true }), { value: 1000, param: LOG });
  assert.ok(fine > 1000 && fine < up, `${fine} between 1000 and ${up}`);
  assert.equal(knobKey(key('ArrowUp', { shiftKey: true }), { value: 20, param: LOG }), 20.1,
    'a fine step at the bottom of the range moves at least a tenth of the step');
  assert.ok(knobKey(key('ArrowDown'), { value: 20000, param: LOG }) < 20000);
});

test('knobKey: PageUp and PageDown move 10 steps, or 10 % of a log or stepless range', () => {
  assert.equal(knobKey(key('PageUp'), { value: 50, param: LIN }), 60);
  assert.equal(knobKey(key('PageDown'), { value: 50, param: LIN }), 40);
  assert.equal(knobKey(key('PageUp'), { value: 95, param: LIN }), 100);
  assert.equal(knobKey(key('PageUp'), { value: 0, param: SMOOTH }), 0.2);
  const up = knobKey(key('PageUp'), { value: 1000, param: LOG });
  near(toNorm(up, LOG) - toNorm(1000, LOG), 0.1, 1e-3);
  assert.ok(knobKey(key('PageDown'), { value: 1000, param: LOG }) < 1000);
});

test('knobKey: Home is min, End is max', () => {
  assert.equal(knobKey(key('Home'), { value: 50, param: LIN }), 0);
  assert.equal(knobKey(key('End'), { value: 50, param: LIN }), 100);
  assert.equal(knobKey(key('Home'), { value: 440, param: LOG }), 20);
  assert.equal(knobKey(key('End'), { value: 440, param: LOG }), 20000);
});

test('knobKey: Enter asks for a typed entry', () => {
  assert.deepEqual(knobKey(key('Enter'), { value: 50, param: LIN }), { edit: true });
});

test('knobKey never claims Delete, Backspace, Space or Escape: the page registry owns them', () => {
  for (const k of ['Delete', 'Backspace', ' ', 'Spacebar', 'Escape', 'Esc']) {
    for (const param of [LIN, LOG, ENUM, BOOL]) {
      assert.equal(knobKey(key(k), { value: defaultValue(param), param }), null,
        `${JSON.stringify(k)} on ${param.key || param.id}`);
      assert.equal(knobKey(key(k, { shiftKey: true }), { value: defaultValue(param), param }),
        null);
    }
  }
});

test('knobKey: any other key, or a key with Ctrl, Meta or Alt, is not the control\'s', () => {
  for (const k of ['a', 'Tab', 'Escape', ' ', 'F5', '+', 'Shift']) {
    assert.equal(knobKey(key(k), { value: 50, param: LIN }), null, k);
  }
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(knobKey(key('ArrowUp', { [mod]: true }), { value: 50, param: LIN }), null, mod);
  }
  assert.equal(knobKey(null, { value: 50, param: LIN }), null);
  assert.equal(knobKey({}, { value: 50, param: LIN }), null);
});

// ---------------------------------------------------------------- text and ARIA

test('formatValue shows the unit through the units module\'s texts', () => {
  assert.equal(formatValue(50, LIN), '50 %');
  assert.equal(formatValue(440, LOG), '440 Hz');
  assert.equal(formatValue(2500, LOG), '2.5 kHz');
  assert.equal(formatValue(0.25, TIME), '250 ms');
  assert.equal(formatValue(2, TIME), '2 s');
  assert.equal(formatValue(0.5, FLOAT), '0.50', 'no unit: the step\'s decimals');
  assert.equal(formatValue(-12, INT), '-12 st');
  assert.equal(formatValue(-6, { ...LIN, unit: 'dB', min: -60, max: 0, step: 0.1 }), '-6.0 dB');
  assert.equal(formatValue(NaN, LIN), '—');
});

test('formatValue: the unit table, signed where a sign is the meaning', () => {
  assert.equal(formatValue(12, INT), '+12 st');
  assert.equal(formatValue(0, INT), '0 st');
  const CENTS = { key: 'detune', unit: 'cents', min: -1200, max: 1200, step: 1 };
  assert.equal(formatValue(5, CENTS), '+5 ct');
  assert.equal(formatValue(-5, CENTS), '-5 ct');
  const OCT = { key: 'pitch', unit: 'oct', min: -10, max: 10, step: 0.01 };
  assert.equal(formatValue(0.5, OCT), '+0.50 oct');
  assert.equal(formatValue(-1, OCT), '-1.00 oct');
  const DB = { key: 'min', unit: 'dB', min: -200, max: 0, step: 1 };
  assert.equal(formatValue(-120, DB), '-120.0 dB', 'dB at 1 decimal');
  assert.equal(formatValue(1, { key: 'd', unit: '×', min: 0.25, max: 4, step: 0.01,
    scale: 'log' }), '1.00 ×', 'any other unit follows the number');
});

test('formatValue follows the value\'s own grid, so a fine move shows', () => {
  const PW = { key: 'width', label: 'Pulse width', unit: '%', min: 5, max: 95, step: 1 };
  const up = knobKey(key('ArrowUp', { shiftKey: true }), { value: 50, param: PW });
  assert.equal(up, 50.1);
  assert.equal(formatValue(up, PW), '50.1 %');
  assert.equal(ariaAttrs(up, PW)['aria-valuetext'], '50.1 %');
  assert.equal(formatValue(50, PW), '50 %', 'a whole step shows no decimals');
  assert.equal(formatValue(50.123456, PW), '50.1 %', 'capped at the fine step\'s decimals');
  assert.equal(formatValue(0.505, FLOAT), '0.505');
  assert.equal(formatValue(-6.05, { ...LIN, unit: 'dB', min: -60, max: 0, step: 0.1 }),
    '-6.05 dB');
  const f = knobKey(key('ArrowUp', { shiftKey: true }), { value: 1000, param: TIME_LOG });
  assert.notEqual(formatValue(f, TIME_LOG), formatValue(1000, TIME_LOG),
    `a stepless log fine move shows: ${formatValue(f, TIME_LOG)}`);
  const t = knobKey(key('ArrowUp', { shiftKey: true }), { value: 0.25, param: TIME });
  assert.notEqual(formatValue(t, TIME), formatValue(0.25, TIME),
    `a fine time move shows: ${formatValue(t, TIME)}`);
  assert.equal(formatValue(0.1 + 0.2, FLOAT), '0.30', 'float noise is not a grid');
});

test('ariaAttrs is a slider with its range, value and text with the unit', () => {
  assert.deepEqual(ariaAttrs(440, LOG), { role: 'slider', 'aria-valuemin': 20,
    'aria-valuemax': 20000, 'aria-valuenow': 440, 'aria-valuetext': '440 Hz' });
  assert.equal(ariaAttrs(500, LIN)['aria-valuenow'], 100, 'the value is clamped');
  assert.equal(ariaAttrs(50, LIN, (v) => `${v}`)['aria-valuetext'], '50 %',
    'a format without the unit gets it');
  assert.equal(ariaAttrs(50, LIN, (v) => `${v} %`)['aria-valuetext'], '50 %');
  assert.equal(ariaAttrs(0.5, FLOAT, (v) => `${v * 100} percent`)['aria-valuetext'],
    '50 percent');
});

test('ariaAttrs: the unit is checked as a suffix, never as a substring', () => {
  const S = { key: 't', unit: 's', min: 0.001, max: 5, step: 0.001, scale: 'log' };
  assert.equal(ariaAttrs(1, S, () => 'fast')['aria-valuetext'], 'fast s');
  assert.equal(ariaAttrs(1, S, () => '1 s')['aria-valuetext'], '1 s');
  assert.equal(ariaAttrs(1, S, () => '1s')['aria-valuetext'], '1s');
  assert.equal(ariaAttrs(0.25, S, () => '250 ms')['aria-valuetext'], '250 ms',
    'a prefixed unit is the unit');
  assert.equal(ariaAttrs(2500, LOG, () => '2.5 kHz')['aria-valuetext'], '2.5 kHz');
  assert.equal(ariaAttrs(50, LIN, () => '% 50')['aria-valuetext'], '% 50 %');
  assert.equal(ariaAttrs(12, INT)['aria-valuetext'], '+12 st');
  assert.equal(ariaAttrs(5, { key: 'c', unit: 'cents', min: -100, max: 100, step: 1 })[
    'aria-valuetext'], '+5 ct', 'the table\'s own text is not suffixed again');
});

// ---------------------------------------------------------------- typed entry (Enter)

test('parseValue reads a typed number with an optional unit, as K058 did', () => {
  assert.deepEqual(parseValue('440', LOG), { ok: true, value: 440 });
  assert.deepEqual(parseValue(' 2.5 kHz ', LOG), { ok: true, value: 2500 });
  assert.deepEqual(parseValue('1k', LOG), { ok: true, value: 1000 });
  assert.deepEqual(parseValue('250 ms', TIME), { ok: true, value: 0.25 });
  assert.deepEqual(parseValue('2 s', TIME), { ok: true, value: 2 });
  assert.deepEqual(parseValue('+12 st', INT), { ok: true, value: 12 });
  assert.deepEqual(parseValue('3.4', INT), { ok: true, value: 3 }, 'an integer rounds');
  assert.deepEqual(parseValue('-6.5 dB', { key: 'g', label: 'Gain', type: 'number', unit: 'dB',
    min: -40, max: 40, step: 0.1 }), { ok: true, value: -6.5 });
  assert.deepEqual(parseValue('+5 ct', { key: 'c', label: 'Detune', type: 'number',
    unit: 'cents', min: -1200, max: 1200, step: 1 }), { ok: true, value: 5 });
  assert.deepEqual(parseValue('50 %', LIN), { ok: true, value: 50 });
  assert.deepEqual(parseValue('1e3', LOG), { ok: true, value: 1000 });
});

test('parseValue refuses what the parameter would refuse, with a reason', () => {
  const no = (r) => {
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
    return r;
  };
  assert.match(no(parseValue('abc', LIN)).reason, /not a number/);
  assert.match(no(parseValue('', LIN)).reason, /not a number/);
  assert.match(no(parseValue('150', LIN)).reason, /^Level must be between 0 and 100/);
  assert.match(no(parseValue('5 Hz', LIN)).reason, /unit/i, 'another parameter\'s unit');
  assert.match(no(parseValue('3 furlongs', LOG)).reason, /unit/i);
  assert.match(no(parseValue('10', LOG)).reason, /between 20 and 20000/);
  assert.match(no(parseValue('Infinity', LIN)).reason, /not a number/);
});

// ---------------------------------------------------------------- enum and boolean

const ENUM = Object.freeze({ key: 'waveform', label: 'Waveform', type: 'enum',
  options: [['sine', 'Sine'], ['square', 'Square'], ['sawtooth', 'Saw'], ['triangle', 'Tri']],
  default: 'sine' });
const BOOL = Object.freeze({ key: 'enabled', label: 'Enabled', type: 'boolean', default: true });

test('enum and boolean: positions in order, stepOption, text and typed entry', () => {
  assert.equal(toNorm('sine', ENUM), 0);
  assert.equal(toNorm('triangle', ENUM), 1);
  near(toNorm('square', ENUM), 1 / 3);
  assert.equal(fromNorm(0.4, ENUM), 'square');
  assert.equal(clampValue('nope', ENUM), 'sine', 'an unknown value reads the default');
  assert.equal(stepOption(ENUM, 'sine', 1), 'square');
  assert.equal(stepOption(ENUM, 'triangle', 1), 'triangle', 'clamped');
  assert.equal(stepOption(ENUM, 'sine', -1), 'sine');
  assert.equal(stepOption(ENUM, 'nope', 1), 'square', 'unknown starts at the first');
  assert.equal(stepOption(BOOL, false, 1), true);
  assert.equal(formatValue('sawtooth', ENUM), 'Saw');
  assert.equal(formatValue(true, BOOL), 'On');
  assert.equal(formatValue(false, BOOL), 'Off');
  assert.equal(toNorm(true, BOOL), 1);
  assert.equal(defaultValue(ENUM), 'sine');
  assert.equal(defaultValue(BOOL), true);
  assert.deepEqual(parseValue('saw', ENUM), { ok: true, value: 'sawtooth' });
  assert.deepEqual(parseValue('Square', ENUM), { ok: true, value: 'square' });
  assert.deepEqual(parseValue('off', BOOL), { ok: true, value: false });
  assert.equal(parseValue('noise', ENUM).ok, false);
});

test('enum and boolean: keys step the options, the wheel a notch per option', () => {
  const k = (name, value, param) => knobKey(key(name), { value, param });
  assert.equal(k('ArrowUp', 'sine', ENUM), 'square');
  assert.equal(k('ArrowRight', 'sine', ENUM), 'square');
  assert.equal(k('ArrowDown', 'square', ENUM), 'sine');
  assert.equal(k('PageUp', 'sine', ENUM), 'square');
  assert.equal(k('Home', 'sawtooth', ENUM), 'sine');
  assert.equal(k('End', 'sine', ENUM), 'triangle');
  assert.equal(k('Enter', 'sine', ENUM), null, 'no typed entry for a choice');
  assert.equal(k('ArrowUp', false, BOOL), true);
  assert.equal(k('Enter', false, BOOL), true, 'Enter toggles a boolean');
  assert.equal(k('Enter', true, BOOL), false);
  assert.deepEqual(wheelValue('sine', -100, ENUM), { value: 'square', rest: 0 });
  assert.deepEqual(wheelValue('sine', -50, ENUM), { value: 'sine', rest: -50 });
  assert.equal(dragValue('sine', -DRAG_PX_PER_RANGE, ENUM), 'triangle');
});

test('enum and boolean ARIA: a slider of labelled positions, a switch that is checked', () => {
  assert.deepEqual(ariaAttrs('sawtooth', ENUM), { role: 'slider', 'aria-valuemin': 0,
    'aria-valuemax': 3, 'aria-valuenow': 2, 'aria-valuetext': 'Saw' });
  assert.deepEqual(ariaAttrs(true, BOOL), { role: 'switch', 'aria-checked': 'true',
    'aria-valuetext': 'On' });
  assert.deepEqual(ariaAttrs('x', BOOL)['aria-checked'], 'true', 'the default');
});

// ---------------------------------------------------------------- controlSvg

const KINDS = ['knob', 'fader', 'switch'];
const SWITCH = Object.freeze({ id: 'sync', label: 'Sync', unit: '', min: 0, max: 1, step: 1,
  scale: 'lin', default: 0 });
const paramOf = (kind) => (kind === 'switch' ? SWITCH : LIN);
const draw = (kind, extra = {}) => controlSvg({ kind, value: kind === 'switch' ? 1 : 70,
  param: paramOf(kind), tokens: TOKENS, ...extra });
const hitOf = (svg) => {
  const m = /<rect data-hit="" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/.exec(svg);
  assert.ok(m, svg);
  return m.slice(1).map(Number);
};

test('CONTROL_BOX: each kind\'s extent, centred on the origin, frozen', () => {
  assert.deepEqual(Object.keys(CONTROL_BOX), KINDS);
  assert.deepEqual({ ...CONTROL_BOX.knob }, { x: -22, y: -22, width: 44, height: 44 });
  assert.equal(CONTROL_BOX.fader.width, 44);
  assert.ok(CONTROL_BOX.fader.height >= FADER_TRAVEL + 8, 'the fader holds its travel');
  assert.equal(CONTROL_BOX.switch.width, 34);
  for (const kind of KINDS) {
    const b = CONTROL_BOX[kind];
    assert.ok(Object.isFrozen(b), kind);
    assert.equal(b.x, -b.width / 2, kind);
    assert.equal(b.y, -b.height / 2, kind);
  }
  assert.ok(Object.isFrozen(CONTROL_BOX));
});

test('the hit area is at least 44 screen px at any zoom, and never smaller than the box', () => {
  assert.equal(HIT_PX, 44);
  for (const kind of KINDS) {
    const box = CONTROL_BOX[kind];
    for (const zoom of [0.5, 1, 1.5, 2, 3]) {
      const [x, y, w, h] = hitOf(draw(kind, { zoom }));
      assert.equal(w, Math.max(HIT_PX / zoom, box.width), `${kind} at ${zoom}: width`);
      assert.equal(h, Math.max(HIT_PX / zoom, box.height), `${kind} at ${zoom}: height`);
      assert.ok(w * zoom >= HIT_PX - 1e-9 && h * zoom >= HIT_PX - 1e-9, `${kind} ${zoom}`);
      assert.deepEqual([x, y], [-w / 2, -h / 2], `${kind} at ${zoom}: centred`);
    }
    assert.deepEqual(hitOf(draw(kind, { zoom: 0.5 })).slice(2, 3), [88], `${kind} at 0.5`);
  }
  for (const zoom of [0, -1, NaN, Infinity]) assert.throws(() => draw('knob', { zoom }), /zoom/);
});

/** The drawn extent of every shape in the drawing group: [x0, y0, x1, y1], strokes included. */
function drawingBox(svg) {
  const inner = /<g pointer-events="none">(.*)<\/g><\/g>$/.exec(svg)[1];
  const n = (el, a) => Number((new RegExp(`\\s${a}="([^"]+)"`).exec(el) || [])[1] || 0);
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x0, y0, x1, y1) => {
    box = [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1),
      Math.max(box[3], y1)];
  };
  for (const [el, tag] of inner.matchAll(/<(\w+)\b[^>]*>/g)) {
    const sw = /stroke="none"/.test(el) ? 0 : n(el, 'stroke-width') / 2;
    if (tag === 'circle') {
      const r = n(el, 'r') + sw;
      grow(n(el, 'cx') - r, n(el, 'cy') - r, n(el, 'cx') + r, n(el, 'cy') + r);
    } else if (tag === 'ellipse') {
      grow(n(el, 'cx') - n(el, 'rx') - sw, n(el, 'cy') - n(el, 'ry') - sw,
        n(el, 'cx') + n(el, 'rx') + sw, n(el, 'cy') + n(el, 'ry') + sw);
    } else if (tag === 'rect') {
      grow(n(el, 'x') - sw, n(el, 'y') - sw, n(el, 'x') + n(el, 'width') + sw,
        n(el, 'y') + n(el, 'height') + sw);
    } else if (tag === 'line') {
      grow(Math.min(n(el, 'x1'), n(el, 'x2')) - sw, Math.min(n(el, 'y1'), n(el, 'y2')) - sw,
        Math.max(n(el, 'x1'), n(el, 'x2')) + sw, Math.max(n(el, 'y1'), n(el, 'y2')) + sw);
    } else if (tag === 'path') {
      const arc = /\bA ([\d.]+) /.exec(el);
      assert.ok(arc, `a path the box check knows: ${el}`);
      const r = Number(arc[1]) + sw;
      grow(-r, -r, r, r);
    }
  }
  return box;
}

test('at zoom 2 and 3 the hit still holds the whole drawing, in every state', () => {
  const states = [{}, { focus: true }, { dragging: true }, { focus: true, dragging: true }];
  for (const kind of KINDS) {
    const param = paramOf(kind);
    for (const zoom of [1, 2, 3]) {
      for (const state of states) {
        for (const value of [param.min, param.max, (param.min + param.max) / 2]) {
          for (const applied of [undefined, param.min, param.max]) {
            const svg = controlSvg({ kind, value, applied, param, tokens: TOKENS, zoom, state });
            const [hx, hy, hw, hh] = hitOf(svg);
            const [x0, y0, x1, y1] = drawingBox(svg);
            const where = `${kind} zoom ${zoom} ${JSON.stringify(state)} v ${value} a ${applied}`;
            assert.ok(x0 >= hx - 1e-9 && y0 >= hy - 1e-9 && x1 <= hx + hw + 1e-9
              && y1 <= hy + hh + 1e-9, `${where}: hit ${[hx, hy, hw, hh]} drawing ${
              [x0, y0, x1, y1]}`);
            const b = CONTROL_BOX[kind];
            assert.ok(x0 >= b.x && y0 >= b.y && x1 <= b.x + b.width && y1 <= b.y + b.height,
              `${where}: inside CONTROL_BOX`);
          }
        }
      }
    }
  }
  const sw = controlSvg({ kind: 'switch', value: 'triangle', applied: 'sine', param: ENUM,
    tokens: TOKENS, state: { focus: true } });
  const [x0, y0, x1, y1] = drawingBox(sw);
  const b = CONTROL_BOX.switch;
  assert.ok(x0 >= b.x && y0 >= b.y && x1 <= b.x + b.width && y1 <= b.y + b.height, 'enum switch');
});

test('only the hit rect takes the pointer; the drawing does not', () => {
  for (const kind of KINDS) {
    const svg = draw(kind);
    assert.match(svg, /^<g data-control="\w+">/);
    assert.ok(svg.endsWith('</g>'));
    assert.equal([...svg.matchAll(/pointer-events="all"/g)].length, 1, kind);
    assert.match(svg, /<rect data-hit=""[^>]*pointer-events="all"/);
    assert.match(svg, /<g pointer-events="none">/);
  }
});

test('no colour literal in any control, in any state; every paint is a token or none', () => {
  const allowed = new Set([...tokenValues(), 'none']);
  for (const kind of KINDS) {
    for (const state of [{}, { focus: true }, { disabled: true }, { dragging: true },
      { focus: true, dragging: true }]) {
      for (const value of [paramOf(kind).min, paramOf(kind).max, 0.5]) {
        const svg = controlSvg({ kind, value, param: paramOf(kind), tokens: TOKENS, state });
        assert.deepEqual(colourLiterals(svg), [], `${kind} ${JSON.stringify(state)}`);
        for (const p of paints(svg)) assert.ok(allowed.has(p), `${kind}: paint ${p}`);
      }
    }
  }
});

test('every shape carries its own stroke attribute', () => {
  for (const kind of KINDS) {
    for (const state of [{}, { focus: true }, { disabled: true }, { dragging: true }]) {
      const svg = draw(kind, { state });
      assert.ok(/<(path|circle|rect|line)\b/.test(svg), kind);
      assert.deepEqual(shapesWithoutStroke(svg), [], `${kind} ${JSON.stringify(state)}`);
    }
  }
});

test('knob: a cap with one highlight, the value ring in control.ring, a pointer', () => {
  const t = TOKENS.control;
  const svg = draw('knob');
  assert.ok(svg.includes(`fill="${t.cap}"`), 'cap');
  assert.equal([...svg.matchAll(new RegExp(`fill="${t.capHi.replace(/[()]/g, '\\$&')}"`, 'g'))]
    .length, 1, 'one highlight');
  assert.ok(svg.includes(`stroke="${t.ring}"`), 'value ring');
  assert.ok(svg.includes(`stroke="${t.track}"`), 'track');
  assert.ok(svg.includes(`stroke="${t.pointer}"`), 'pointer');
  assert.notEqual(draw('knob', { value: 0 }), draw('knob', { value: 100 }), 'the pointer moves');
  const off = draw('knob', { state: { disabled: true } });
  assert.ok(!off.includes(`stroke="${t.ring}"`) && off.includes(`stroke="${t.disabled}"`));
  assert.ok(draw('knob', { state: { focus: true } }).includes(`stroke="${t.focus}"`));
  assert.ok(!svg.includes(`stroke="${t.focus}"`), 'no focus ring unless focused');
});

test('knob: a range across zero draws its value arc from zero', () => {
  const bi = { ...LIN, min: -50, max: 50, default: 0 };
  const ring = (svg) => [...svg.matchAll(/<path d="([^"]+)"[^>]*data-ring=""/g)].map((m) => m[1]);
  assert.deepEqual(ring(controlSvg({ kind: 'knob', value: 0, param: bi, tokens: TOKENS })), [],
    'no value arc at zero');
  assert.equal(ring(controlSvg({ kind: 'knob', value: 25, param: bi, tokens: TOKENS })).length, 1);
});

test('fader: the cap tracks the pointer one to one at any zoom', () => {
  assert.ok(FADER_TRAVEL >= 64, `travel ${FADER_TRAVEL}`);
  assert.equal(pixelsPerRangeFor('knob'), DRAG_PX_PER_RANGE);
  assert.equal(pixelsPerRangeFor('knob', 3), DRAG_PX_PER_RANGE, 'a knob is not a distance');
  assert.equal(pixelsPerRangeFor('fader'), FADER_TRAVEL);
  assert.equal(pixelsPerRangeFor('fader', 2), FADER_TRAVEL * 2);
  assert.throws(() => pixelsPerRangeFor('dial'), /kind/);
  assert.throws(() => pixelsPerRangeFor('fader', 0), /zoom/);
  const P = { key: 'x', min: 0, max: 1, default: 0.5 };
  const capY = (v) => {
    const r = /<rect data-cap="" x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"/
      .exec(controlSvg({ kind: 'fader', value: v, param: P, tokens: TOKENS }));
    return Number(r[1]) + Number(r[2]) / 2;
  };
  for (const zoom of [0.5, 1, 2]) {
    for (const dy of [-10, 7, -12.8, 15]) { // inside half the travel at zoom 0.5
      const v = dragValue(0.5, dy, P, { pixelsPerRange: pixelsPerRangeFor('fader', zoom) });
      near((capY(v) - capY(0.5)) * zoom, dy, 0.03);
    }
  }
  const S = { key: 'x', min: 0, max: 1, step: 1 };
  assert.equal(dragValue(0, -pixelsPerRangeFor('switch', 1, S) * 0.6, S, {
    pixelsPerRange: pixelsPerRangeFor('switch', 1, S) }), 1, 'a switch flips under the finger');
  assert.ok(pixelsPerRangeFor('switch', 1, S) < 30);
});

test('fader: a track and a cap whose position follows the value; switch: two positions', () => {
  const capY = (svg) => Number(/<rect data-cap="" x="[^"]+" y="([^"]+)"/.exec(svg)[1]);
  const lo = controlSvg({ kind: 'fader', value: 0, param: LIN, tokens: TOKENS });
  const hi = controlSvg({ kind: 'fader', value: 100, param: LIN, tokens: TOKENS });
  assert.ok(capY(hi) < capY(lo), 'up is more');
  assert.ok(lo.includes(`stroke="${TOKENS.control.track}"`) || lo.includes(
    `fill="${TOKENS.control.track}"`), 'track');
  const off = controlSvg({ kind: 'switch', value: 0, param: SWITCH, tokens: TOKENS });
  const on = controlSvg({ kind: 'switch', value: 1, param: SWITCH, tokens: TOKENS });
  assert.ok(capY(on) < capY(off), 'on is up');
  assert.equal(controlSvg({ kind: 'switch', value: 0.4, param: SWITCH, tokens: TOKENS }), off);
});

test('switch: an enum draws one position per option, a boolean two', () => {
  const capY = (svg) => Number(/<rect data-cap="" x="[^"]+" y="([^"]+)"/.exec(svg)[1]);
  const ys = ENUM.options.map(([v]) => capY(controlSvg({ kind: 'switch', value: v, param: ENUM,
    tokens: TOKENS })));
  assert.equal(new Set(ys).size, 4, `four positions: ${ys}`);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1], 'each option further up');
  const ticks = (svg) => (svg.match(/data-detent=""/g) || []).length;
  assert.equal(ticks(controlSvg({ kind: 'switch', value: 'sine', param: ENUM, tokens: TOKENS })),
    4, 'a detent per option');
  const off = controlSvg({ kind: 'switch', value: false, param: BOOL, tokens: TOKENS });
  const on = controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: TOKENS });
  assert.ok(capY(on) < capY(off), 'on is up');
  assert.equal(ticks(on), 0, 'two positions need no detents');
  for (const kind of KINDS) {
    assert.doesNotMatch(controlSvg({ kind, value: 'square', param: ENUM, tokens: TOKENS }),
      /NaN/, kind);
  }
});

test('applied: a second, thin marker in control.pointer where the applied value differs', () => {
  const t = TOKENS.control;
  for (const kind of KINDS) {
    const param = paramOf(kind);
    const plain = controlSvg({ kind, value: param.max, param, tokens: TOKENS });
    const same = controlSvg({ kind, value: param.max, applied: param.max, param, tokens: TOKENS });
    const split = controlSvg({ kind, value: param.max, applied: param.min, param,
      tokens: TOKENS });
    assert.equal(same, plain, `${kind}: no marker when applied equals the value`);
    assert.doesNotMatch(plain, /data-applied/);
    const m = /<line data-applied=""[^>]*>/.exec(split);
    assert.ok(m, `${kind}: a marker`);
    assert.ok(m[0].includes(`stroke="${t.pointer}"`), `${kind}: in control.pointer`);
    const others = /<line (?!data-applied)[^>]*stroke-width="([^"]+)"/g;
    const pointerW = Math.max(...[...split.matchAll(others)].map((x) => Number(x[1])));
    assert.ok(Number(/stroke-width="([^"]+)"/.exec(m[0])[1]) < pointerW, `${kind}: thinner`);
    const other = controlSvg({ kind, value: param.max, applied: (param.min + param.max) / 2,
      param, tokens: TOKENS });
    if (kind !== 'switch') {
      assert.notEqual(/<line data-applied=""[^>]*>/.exec(other)[0], m[0], `${kind}: it moves`);
    }
  }
});

// ---------------------------------------------------------------- the node registry

/** Every finite number or integer parameter of every registry node type. */
const REGISTRY_NUMBERS = NODE_DEFINITIONS.flatMap((def) => def.params
  .filter((p) => (p.type === 'number' || p.type === 'integer') && Number.isFinite(p.min)
    && Number.isFinite(p.max))
  .map((p) => ({ where: `${def.type}.${p.key}`, p })));
const REGISTRY_CHOICES = NODE_DEFINITIONS.flatMap((def) => def.params
  .filter((p) => p.type === 'enum' || p.type === 'boolean')
  .map((p) => ({ where: `${def.type}.${p.key}`, p })));

test('every finite numeric parameter of every registry node type works the whole control', () => {
  assert.ok(REGISTRY_NUMBERS.length > 50, `${REGISTRY_NUMBERS.length} parameters`);
  assert.ok(REGISTRY_NUMBERS.some(({ p }) => p.scale === 'linear'), 'the registry says linear');
  for (const { where, p } of REGISTRY_NUMBERS) {
    const v = p.default;
    near(fromNorm(toNorm(v, p), p), v, Math.abs(v) * 1e-9 + 1e-9);
    assert.ok(Number.isFinite(fromNorm(0.5, p)), where);
    for (const k of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      for (const shiftKey of [false, true]) {
        const next = knobKey(key(k, { shiftKey }), { value: v, param: p });
        assert.ok(Number.isFinite(next) && next >= p.min && next <= p.max, `${where} ${k}`);
      }
    }
    assert.deepEqual(knobKey(key('Enter'), { value: v, param: p }), { edit: true }, where);
    assert.ok(Number.isFinite(dragValue(v, -13, p)), where);
    assert.ok(Number.isFinite(wheelValue(v, -100, p).value), where);
    const text = formatValue(v, p);
    assert.ok(text && text !== '—' && !/NaN|undefined/.test(text), `${where}: ${text}`);
    const back = parseValue(text, p);
    assert.ok(back.ok, `${where}: "${text}" reads back (${back.reason})`);
    near(back.value, v, Math.abs(v) * 0.01 + 1e-9);
    const aria = ariaAttrs(v, p);
    assert.equal(aria['aria-valuenow'], v, where);
    for (const kind of KINDS) {
      const svg = controlSvg({ kind, value: v, applied: p.min, param: p, tokens: TOKENS,
        state: { focus: true } });
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${where} ${kind}`);
      assert.deepEqual(colourLiterals(svg), [], `${where} ${kind}`);
    }
  }
});

test('every enum and boolean parameter of the registry works the switch and the knob', () => {
  assert.ok(REGISTRY_CHOICES.length > 10, `${REGISTRY_CHOICES.length} parameters`);
  for (const { where, p } of REGISTRY_CHOICES) {
    const v = p.default;
    assert.equal(clampValue(v, p), v, where);
    assert.equal(fromNorm(toNorm(v, p), p), v, where);
    const up = knobKey(key('ArrowUp'), { value: v, param: p });
    assert.ok(up !== null && up !== undefined, where);
    assert.equal(parseValue(formatValue(v, p), p).value, v, `${where}: ${formatValue(v, p)}`);
    for (const kind of KINDS) {
      const svg = controlSvg({ kind, value: v, param: p, tokens: TOKENS });
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${where} ${kind}`);
    }
  }
});

test('a control is a setpoint: the same input draws the same markup, with no animation', () => {
  for (const kind of KINDS) {
    const a = draw(kind, { state: { dragging: true } });
    assert.equal(a, draw(kind, { state: { dragging: true } }));
    assert.doesNotMatch(a, /<animate|<set\b|transition|style=/);
  }
  assert.throws(() => controlSvg({ kind: 'dial', value: 1, param: LIN, tokens: TOKENS }),
    /kind/);
  assert.throws(() => controlSvg({ kind: 'knob', value: 1, param: LIN }), /tokens/);
});

test('knob.js is a pure core: no DOM, no listener, no document', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/knob.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /addEventListener|document\.|window\.|getComputedStyle/);
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/synth\//, 'nothing from src/js/synth');
  assert.doesNotMatch(src, /\bosc-|data-osc|style=/, 'no osc-* class, data-osc hook or style');
});
