// The shared synth-theme layer's control core (src/js/ui/synth/knob.js; the control API agreed
// 2026-11-02): value mapping (lin and log, as the node registry spells them; enum and boolean as
// positions), quantize and fine, vertical drag (a fader's cap under the finger), the wheel by
// pixels with a carried rest, the pure knobKey (the control adds no key listener: K153 counts
// them; Delete, Backspace, Space and Escape are the page's), typed entry (parseValue), the value
// text on the value's own grid and the ARIA attributes, and controlSvg, the knob, fader and
// switch drawn only from tokens inside CONTROL_BOX, with a hit area of at least 44 screen px that
// always holds the drawing, and an applied marker. Every finite parameter of every registry node
// type goes through all of it. The value is a setpoint: nothing tweens. The feel (plan S3,
// src/js/ui/synth/feel.js): Shift mid-drag re-anchors, so nothing jumps; one gesture per held
// key, wheel burst (400 ms idle) or drag, so one undo entry; Escape restores the start; a wheel
// notch of 1 % (Shift 0.1 %); a horizontal fader, a 28 x 14 cap, a slot press a page toward it.
//   node --test tests/unit/ui-synth-knob.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampValue, toNorm, fromNorm, quantize, defaultValue, dragValue, wheelValue, knobKey,
  formatValue, ariaAttrs, controlSvg, parseValue, stepOption, pixelsPerRangeFor, HIT_PX,
  CONTROL_BOX, DRAG_PX_PER_RANGE, FADER_TRAVEL, LOG_STEPS, WHEEL_NOTCH_PX, WHEEL_LINE_PX,
} from '../../src/js/ui/synth/knob.js';
import * as KNOB_CORE from '../../src/js/ui/synth/knob.js';
import * as FEEL from '../../src/js/ui/synth/feel.js';
import { NODE_DEFINITIONS } from '../../src/js/studio/registry.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues, intensityLiterals }
  from './ui-synth-fixture.mjs';

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
    for (const kind of ['knob', 'fader']) {
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
  assert.equal(quantize(440.44, TIME_LOG), 440.4, 'a stepless log range: four significant digits');
  assert.equal(quantize(12345.6, TIME_LOG), 12350);
  // S7: a stepped log range is never finer than its step (K058's relative grid only where it is
  // coarser), so a drag readout never shows more decimals than the step.
  assert.equal(quantize(440.44, LOG), 440, 'a stepped log range keeps its step');
  assert.equal(quantize(12345.6, LOG), 12350, 'and the relative grid where that is coarser');
  assert.equal(quantize(0.0012345, TIME), 0.001, 'the bottom of a stepped log range: its step');
  assert.equal(quantize(0.0012345, TIME, { fine: true }), 0.0012, 'fine: a tenth of it');
  assert.equal(quantize(2.34567, TIME), 2.346);
  assert.equal(quantize(0.99312, { key: 'd', unit: '×', min: 0.25, max: 4, step: 0.01,
    scale: 'log' }), 0.99, 'the registry\'s Decay (×): two decimals, not 0.9931');
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
  near(WHEEL_LINE_PX, 100 / 3, 1e-12);
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
  assert.deepEqual(wheelValue(50, -3, LIN, { deltaMode: 1 }), { value: 51, rest: 0 },
    'one three-line detent is exactly one notch');
  assert.deepEqual(wheelValue(50, 6, LIN, { deltaMode: 1 }), { value: 48, rest: 0 },
    'six lines are two notches');
  let r = { value: 50, rest: 0 };
  for (let i = 0; i < 5; i++) r = wheelValue(r.value, -0.1, LIN, { deltaMode: 1, rest: r.rest });
  assert.equal(r.value, 50, 'fractional lines move nothing yet');
  near(r.rest, -50 / 3, 1e-6);
  r = { value: 50, rest: 0 };
  for (let i = 0; i < 8; i++) r = wheelValue(r.value, 0.375, LIN, { deltaMode: 1, rest: r.rest });
  assert.deepEqual(r, { value: 49, rest: 0 }, 'eight 0.375-line events are one step');
  r = { value: 50, rest: 0 };
  for (let i = 0; i < 3; i++) r = wheelValue(r.value, -1, LIN, { deltaMode: 1, rest: r.rest });
  assert.deepEqual(r, { value: 51, rest: 0 }, 'three single lines are one notch');
  r = { value: 50, rest: 0 };
  for (let i = 0; i < 30; i++) r = wheelValue(r.value, -0.1, LIN, { deltaMode: 1, rest: r.rest });
  assert.equal(r.value, 51, 'thirty tenths of a line are one notch');
  near(r.rest, 0, 1e-6);
  assert.deepEqual(wheelValue(50, 1, LIN, { deltaMode: 2 }), { value: 49, rest: 0 }, 'a page');
  assert.deepEqual(wheelValue(50, -60, LIN, { rest: -60 }), { value: 51, rest: -20 },
    'the rest carried in counts');
  assert.deepEqual(wheelValue(50, 30, LIN, { rest: -60 }), { value: 50, rest: 30 },
    'a reversal drops the rest: no lag when the hand turns back');
  assert.deepEqual(wheelValue(50, 90, LIN, { rest: -60 }), { value: 50, rest: 90 });
  assert.deepEqual(wheelValue(50, 100, LIN, { rest: -60 }), { value: 49, rest: 0 });
});

test('wheel: under a notch the value comes back unchanged, never quantized', () => {
  const PW = { key: 'width', label: 'Pulse width', unit: '%', min: 5, max: 95, step: 1 };
  assert.deepEqual(wheelValue(50.1, 1, PW), { value: 50.1, rest: 1 });
  assert.deepEqual(wheelValue(0.505, -1, FLOAT), { value: 0.505, rest: -1 });
  assert.deepEqual(wheelValue(120, 1, LIN), { value: 100, rest: 1 }, 'only clamped');
});

test('wheel: at an end stop the rest is dropped, so the first notch back moves', () => {
  const PW = { key: 'width', label: 'Pulse width', unit: '%', min: 5, max: 95, step: 1 };
  const atMax = wheelValue(95, -250, PW);
  assert.deepEqual(atMax, { value: 95, rest: 0 });
  assert.deepEqual(wheelValue(atMax.value, 100, PW, { rest: atMax.rest }), { value: 94, rest: 0 });
  assert.deepEqual(wheelValue(94.5, -250, PW), { value: 95, rest: 0 }, 'reaching the stop');
  assert.deepEqual(wheelValue(5, 150, PW), { value: 5, rest: 0 }, 'held at min');
  assert.deepEqual(wheelValue(95, -40, PW), { value: 95, rest: 0 }, 'under a notch, held');
  assert.deepEqual(wheelValue('triangle', -250, ENUM), { value: 'triangle', rest: 0 });
});

test('wheel: a trackpad\'s many small deltas move what their sum says, no more', () => {
  let state = { value: 50, rest: 0 };
  for (let i = 0; i < 40; i++) state = wheelValue(state.value, -2, LIN, { rest: state.rest });
  assert.deepEqual(state, { value: 50, rest: -80 }, '80 px: still under a notch');
  for (let i = 0; i < 60; i++) state = wheelValue(state.value, -2, LIN, { rest: state.rest });
  assert.deepEqual(state, { value: 52, rest: 0 }, '200 px: two notches');
  let j = { value: 50, rest: 0 };
  for (let i = 0; i < 40; i++) j = wheelValue(j.value, -2, LIN, { rest: j.rest });
  j = wheelValue(j.value, 0.5, LIN, { rest: j.rest });
  assert.deepEqual(j, { value: 50, rest: -79.5 }, 'a jitter under 4 px back only subtracts');
  assert.deepEqual(wheelValue(50, 4, LIN, { rest: -80 }), { value: 50, rest: 4 },
    'a turn of 4 px or more drops the rest');
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
  const SEED = { key: 'seed', label: 'Seed', type: 'integer', min: 0, max: 4294967295, step: 1 };
  assert.equal(wheelValue(1, -100, SEED).value, 2, 'an identifier-sized integer range: one step');
  assert.equal(wheelValue(1, -300, SEED).value, 4);
  const SMALL = { key: 'n', type: 'integer', min: 0, max: 5000, step: 1 };
  assert.equal(wheelValue(0, -100, SMALL).value, 50, 'a smaller integer range keeps the floor');
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
  assert.equal(knobKey(key('ArrowUp', { shiftKey: true }), { value: 20, param: TIME_LOG }),
    20.069, 'a fine step at the bottom of a stepless log range is relative');
  assert.equal(knobKey(key('ArrowUp', { shiftKey: true }), { value: 20, param: LOG }), 20.1,
    'a stepped one moves a tenth of its step, never finer (S7)');
  assert.ok(knobKey(key('ArrowDown'), { value: 20000, param: LOG }) < 20000);
});

test('knobKey: PageUp and PageDown never stall on a coarse grid', () => {
  const SMALL = { key: 'n', type: 'integer', min: -2, max: 2, step: 1 };
  assert.equal(knobKey(key('PageUp'), { value: 1, param: SMALL }), 2);
  assert.equal(knobKey(key('PageDown'), { value: -1, param: SMALL }), -2);
  const HALF = { key: 'h', min: 0, max: 1, step: 0.5 };
  assert.equal(knobKey(key('PageUp'), { value: 0, param: HALF }), 0.5);
  assert.equal(knobKey(key('PageUp'), { value: 1, param: HALF }), 1, 'held at max');
});

test('knobKey: PageUp and PageDown move 10 % of the (norm) range, on the grid', () => {
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
  assert.equal(formatValue(-120, DB), '-120 dB', 'a 1 dB step shows no decimal (S7)');
  assert.equal(formatValue(3, { key: 'span', unit: 'oct', min: 1, max: 4, step: 1 }), '+3 oct',
    'a whole-octave step shows none either');
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
  const CENTS = { key: 'c', unit: 'cents', min: -1200, max: 1200, step: 1 };
  for (const v of [-0.04, 0.04, -0.0001, 1e-9]) {
    assert.equal(formatValue(v, CENTS), '0 ct', `${v}: a value that rounds to zero is 0`);
  }
  assert.equal(formatValue(-0.004, { ...LIN, unit: 'dB', min: -60, max: 0, step: 0.1 }),
    '0.0 dB', 'as zero itself shows');
  assert.equal(formatValue(-0.0004, FLOAT), '0.00');
});

test('ariaAttrs is N003\'s controlAttrs shape: position 0..1000, text with value and unit', () => {
  assert.deepEqual(ariaAttrs(440, LOG), { role: 'slider', 'aria-valuemin': 0,
    'aria-valuemax': 1000, 'aria-valuenow': Math.round(toNorm(440, LOG) * 1000),
    'aria-valuetext': '440 Hz' });
  assert.equal(ariaAttrs(440, LOG)['aria-valuenow'], 447, 'a log range steps in its log domain');
  assert.equal(ariaAttrs(25, LIN)['aria-valuenow'], 250);
  assert.equal(ariaAttrs(0, LIN)['aria-valuenow'], 0);
  assert.equal(ariaAttrs(100, LIN)['aria-valuenow'], 1000);
  const out = ariaAttrs(500, LIN);
  assert.equal(out['aria-valuenow'], 1000, 'beyond the range the position clamps');
  assert.equal(out['aria-valuetext'], '500 %', 'but the text stays truthful');
  assert.equal(ariaAttrs(-5, LIN)['aria-valuetext'], '-5 %');
  assert.equal(ariaAttrs(-5, LIN)['aria-valuenow'], 0);
  const steps = new Set();
  for (let i = 0; i < 40; i++) {
    steps.add(ariaAttrs(knobKey(key('ArrowUp'), { value: 20 * 1.2 ** i, param: LOG }), LOG)[
      'aria-valuenow']);
  }
  assert.ok(steps.size > 30, 'positions are distinct along a log range');
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
  const CENTS = { key: 'c', unit: 'cents', min: -100, max: 100, step: 1 };
  assert.equal(ariaAttrs(5, CENTS)['aria-valuetext'], '+5 ct',
    'the table\'s own text is not suffixed again');
  assert.equal(ariaAttrs(5, CENTS, () => '+5 ct')['aria-valuetext'], '+5 ct',
    'ct is the spelling of cents');
  assert.equal(ariaAttrs(5, CENTS, () => '+5 cents')['aria-valuetext'], '+5 cents');
  assert.equal(ariaAttrs(5, CENTS, () => '+5')['aria-valuetext'], '+5 ct', 'appended as ct');
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

test('parseValue: a decimal comma, a Unicode minus, a spaced thousands', () => {
  const Q = { key: 'Q', label: 'Q', type: 'number', min: 0.0001, max: 1000, scale: 'log' };
  assert.deepEqual(parseValue('1,5', Q), { ok: true, value: 1.5 });
  assert.deepEqual(parseValue('0,707', Q), { ok: true, value: 0.707 });
  const PW = { key: 'width', label: 'Pulse width', type: 'number', unit: '%', min: 5, max: 95,
    step: 1 };
  assert.deepEqual(parseValue('50,5 %', PW), { ok: true, value: 50.5 });
  const GAIN = { key: 'g', label: 'Gain', type: 'number', unit: 'dB', min: -40, max: 40,
    step: 0.1 };
  assert.deepEqual(parseValue('\u22126 dB', GAIN), { ok: true, value: -6 });
  assert.deepEqual(parseValue('\u22126,5', GAIN), { ok: true, value: -6.5 });
  assert.deepEqual(parseValue('1 000', LOG), { ok: true, value: 1000 });
  assert.deepEqual(parseValue('12\u2009000 Hz', LOG), { ok: true, value: 12000 });
  assert.deepEqual(parseValue('1\u202f500', LOG), { ok: true, value: 1500 });
  assert.equal(parseValue('1,000.5', LOG).ok, false, 'a comma with a dot is not a decimal comma');
  assert.equal(parseValue('1,000,000', LOG).ok, false);
  assert.equal(parseValue('12 5', LOG).ok, false, 'a space is a separator only before three');
});

test('parseValue: a comma before exactly three digits is ambiguous, and refused', () => {
  const ATT = { key: 'attack', label: 'Attack', type: 'number', unit: 's', min: 0.001, max: 10,
    step: 0.001 };
  for (const [text, p] of [['1,000', LOG], ['1,000 Hz', LOG], ['1,000 ms', ATT],
    ['12,345', LOG]]) {
    const r = parseValue(text, p);
    assert.equal(r.ok, false, text);
    assert.match(r.reason, /is ambiguous: write \d+ or [\d.]+/, text);
  }
  assert.equal(parseValue('1,000', LOG).reason, '"1,000" is ambiguous: write 1000 or 1.0.');
  const Q = { key: 'Q', label: 'Q', type: 'number', min: 0.0001, max: 1000, scale: 'log' };
  assert.deepEqual(parseValue('1,5', Q), { ok: true, value: 1.5 });
  assert.deepEqual(parseValue('0,707', Q), { ok: true, value: 0.707 }, 'a leading 0 is a decimal');
  assert.deepEqual(parseValue('2,5 ms', ATT), { ok: true, value: 0.0025 });
  assert.match(parseValue('1234,567', Q).reason, /between/,
    'four digits before the comma are no grouping: a decimal, out of range for Q');
  const WIDE = { key: 'w', label: 'W', type: 'number', min: 0, max: 5000, step: 0.001 };
  assert.deepEqual(parseValue('1234,567', WIDE), { ok: true, value: 1234.567 });
});

test('parseValue: a dash or minus leads a negative; spaced groups must be groups of three', () => {
  const GAIN = { key: 'g', label: 'Gain', type: 'number', unit: 'dB', min: -40, max: 40,
    step: 0.1 };
  assert.deepEqual(parseValue('\u20136 dB', GAIN), { ok: true, value: -6 }, 'an en dash');
  assert.deepEqual(parseValue('\u22126 dB', GAIN), { ok: true, value: -6 }, 'a minus sign');
  const SEED = { key: 'seed', label: 'Seed', type: 'integer', min: 0, max: 4294967295, step: 1 };
  assert.deepEqual(parseValue('4 294 967 295', SEED), { ok: true, value: 4294967295 });
  assert.deepEqual(parseValue('10\u2009000\u2009000', SEED), { ok: true, value: 10000000 });
  for (const text of ['1 00', '1 0000', '12 34', '1234 567', '1 000 00']) {
    const r = parseValue(text, SEED);
    assert.equal(r.ok, false, text);
    assert.match(r.reason, /malformed/, text);
  }
  assert.equal(parseValue('440 100', LOG).ok, false, '440100 Hz is out of range');
});

test('parseValue stores what the readout shows', () => {
  const PW = { key: 'width', label: 'Pulse width', type: 'number', unit: '%', min: 5, max: 95,
    step: 1 };
  assert.deepEqual(parseValue('50.37', PW), { ok: true, value: 50.4 });
  assert.equal(formatValue(parseValue('50.37', PW).value, PW), '50.4 %');
  const HZ = { key: 'f', label: 'Frequency', type: 'number', unit: 'Hz', min: 1, max: 182400,
    scale: 'log' };
  for (const text of ['440.4', '440.43', '12345.678', '0.5 kHz', '1.23456 kHz']) {
    const r = parseValue(text, HZ);
    assert.ok(r.ok, text);
    const shown = formatValue(r.value, HZ);
    assert.equal(parseValue(shown, HZ).value, r.value, `${text}: stored ${r.value}, shown ${
      shown}`);
  }
  assert.equal(formatValue(parseValue('440.4', HZ).value, HZ), '440.4 Hz');
  for (const { where, p } of REGISTRY_NUMBERS) {
    for (const t of [0.13, 0.5, 0.77]) {
      const r = parseValue(String(fromNorm(t, p)), p);
      assert.ok(r.ok, where);
      assert.equal(parseValue(formatValue(r.value, p), p).value, r.value,
        `${where}: ${r.value} shows ${formatValue(r.value, p)}`);
    }
  }
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
  for (const [t, v] of [['1', true], ['0', false], ['true', true], ['FALSE', false]]) {
    assert.deepEqual(parseValue(t, BOOL), { ok: true, value: v }, t);
  }
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

test('enum and boolean ARIA: the position of the option index, the label as text', () => {
  assert.deepEqual(ariaAttrs('sawtooth', ENUM), { role: 'slider', 'aria-valuemin': 0,
    'aria-valuemax': 1000, 'aria-valuenow': 667, 'aria-valuetext': 'Saw' });
  assert.equal(ariaAttrs('sine', ENUM)['aria-valuenow'], 0);
  assert.equal(ariaAttrs('triangle', ENUM)['aria-valuenow'], 1000);
  assert.deepEqual(ariaAttrs(true, BOOL), { role: 'slider', 'aria-valuemin': 0,
    'aria-valuemax': 1000, 'aria-valuenow': 1000, 'aria-valuetext': 'On' });
  assert.equal(ariaAttrs(false, BOOL)['aria-valuenow'], 0);
  assert.equal(ariaAttrs('x', BOOL)['aria-valuenow'], 1000, 'the default');
  const FFT = { key: 'fftSize', label: 'Window', type: 'enum', unit: 'samples', default: 8192,
    options: [[2048, '2048'], [8192, '8192']] };
  assert.equal(ariaAttrs(8192, FFT)['aria-valuetext'], '8192 samples',
    'an enum label gets its unit');
  const SR = { key: 'sr', label: 'Rate', type: 'enum', unit: 'Hz', default: 48000,
    options: [[44100, '44.1 kHz'], [48000, '48 kHz']] };
  assert.equal(ariaAttrs(48000, SR)['aria-valuetext'], '48 kHz', 'a label with its unit keeps it');
  assert.equal(ariaAttrs('sine', ENUM)['aria-valuetext'], 'Sine', 'no unit, no suffix');
});

// ---------------------------------------------------------------- controlSvg

const KINDS = ['knob', 'fader', 'switch'];
const SWITCH = Object.freeze({ key: 'range', label: 'Range', type: 'enum',
  options: [['lo', 'Lo'], ['mid', 'Mid'], ['hi', 'Hi']], default: 'lo' });
const paramOf = (kind) => (kind === 'switch' ? SWITCH : LIN);
/** The lowest, highest and a middle value of each kind's test parameter. */
const ends = (kind) => (kind === 'switch' ? { lo: 'lo', hi: 'hi', mid: 'mid' }
  : { lo: LIN.min, hi: LIN.max, mid: (LIN.min + LIN.max) / 2 });
const draw = (kind, extra = {}) => controlSvg({ kind, value: kind === 'switch' ? 'hi' : 70,
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
  // A straight stroke: a round cap is a disc of the stroke at each end; the default (butt)
  // stops at the end points, so its corners are the ends moved across the stroke.
  const segment = (x1, y1, x2, y2, sw, el) => {
    if (/stroke-linecap="round"/.test(el)) {
      grow(Math.min(x1, x2) - sw, Math.min(y1, y2) - sw, Math.max(x1, x2) + sw,
        Math.max(y1, y2) + sw);
      return;
    }
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const [nx, ny] = [(-(y2 - y1) / len) * sw, ((x2 - x1) / len) * sw];
    for (const [x, y] of [[x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny]]) grow(x, y, x, y);
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
      segment(n(el, 'x1'), n(el, 'y1'), n(el, 'x2'), n(el, 'y2'), sw, el);
    } else if (tag === 'path') {
      const arc = /\bA ([\d.]+) /.exec(el);
      const lines = [...el.matchAll(/M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/g)];
      const polygon = /\sd="M [^"MA]* Z"/.test(el);
      assert.ok(arc || lines.length, `a path the box check knows: ${el}`);
      if (polygon) {
        for (const [, x, y] of el.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)) {
          grow(Number(x) - sw, Number(y) - sw, Number(x) + sw, Number(y) + sw);
        }
        continue;
      }
      if (arc) {
        const r = Number(arc[1]) + sw;
        grow(-r, -r, r, r);
      }
      for (const m of lines) segment(...m.slice(1, 5).map(Number), sw, el);
    }
  }
  return box;
}

test('at zoom 2 and 3 the hit still holds the whole drawing, in every state', () => {
  const states = [{}, { focus: true }, { dragging: true }, { focus: true, dragging: true },
    { hover: true, disabled: true, focus: true }];
  for (const kind of KINDS) {
    const param = paramOf(kind);
    const e = ends(kind);
    for (const zoom of [1, 1.25, 2, 3]) {
      for (const state of states) {
        for (const value of [e.lo, e.hi, e.mid]) {
          for (const applied of [undefined, e.lo, e.hi]) {
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
      for (const value of Object.values(ends(kind))) {
        const svg = controlSvg({ kind, value, param: paramOf(kind), tokens: TOKENS, state });
        assert.deepEqual(colourLiterals(svg), [], `${kind} ${JSON.stringify(state)}`);
        for (const p of paints(svg)) {
          const frag = /^url\(#([^)]+)\)$/.exec(p);
          assert.ok(allowed.has(p) || (frag && svg.includes(` id="${frag[1]}"`)),
            `${kind}: paint ${p}`);
        }
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

// Review of slice A, A3: the cap's sheen (capHi to cap at hw-sheen) showed ΔL* +1.26 in dark and
// darkened the light cap (-1.41), and the highlight does not show on the light cap: no token
// paints a visible sheen there in both themes (rule b), so the knob draws none until D-PAL's
// --osc-knob-cap-hi (the todo in ui-synth-tokens.test.mjs).
test('knob: a cap with no sheen (A3), the value ring in control.ring, a pointer', () => {
  const t = TOKENS.control;
  const svg = draw('knob');
  assert.ok(svg.includes(`fill="${t.cap}"`), 'cap');
  assert.equal([...svg.matchAll(/\sdata-sheen=""/g)].length, 0, 'no sheen until D-PAL');
  assert.ok(svg.includes(`stroke="${t.ring}"`), 'value ring');
  assert.ok(svg.includes(`stroke="${t.track}"`), 'track');
  assert.ok(svg.includes(`stroke="${t.pointer}"`), 'pointer');
  assert.notEqual(draw('knob', { value: 0 }), draw('knob', { value: 100 }), 'the pointer moves');
  const off = draw('knob', { state: { disabled: true } });
  assert.ok(!off.includes(`stroke="${t.ring}"`) && off.includes(`stroke="${t.disabled}"`));
  assert.ok(draw('knob', { state: { focus: true } }).includes(`stroke="${t.focus}"`));
  assert.ok(!svg.includes(`stroke="${t.focus}"`), 'no focus ring unless focused');
});

test('knob: the side wall reads the hw-sheen key, not an opacity of its own; no sheen (A3)',
  () => {
    for (const state of [{}, { focus: true }, { dragging: true }, { hover: true }]) {
      const svg = draw('knob', { state });
      assert.equal(part(svg, 'data-sheen'), null, `${JSON.stringify(state)}: no sheen`);
      for (const flag of ['data-side']) {
        const hi = part(svg, flag);
        assert.ok(hi, `${JSON.stringify(state)}: ${flag}`);
        assert.match(hi, /\sclass="opacity-hw-sheen"/, `${JSON.stringify(state)} ${flag}`);
        assert.match(hi, /\sfill="url\(#[^)]+\)"/, `${flag}: a gradient of token stops`);
        assert.doesNotMatch(hi, /opacity="/, `${JSON.stringify(state)}: no opacity attribute`);
      }
    }
  });

test('no literal opacity, alpha or shadow in any control, in any state, or in knob.js (v4)', () => {
  for (const kind of KINDS) {
    for (const state of [{}, { focus: true }, { disabled: true }, { dragging: true },
      { focus: true, dragging: true }]) {
      for (const zoom of [0.5, 1, 3]) {
        for (const value of Object.values(ends(kind))) {
          const svg = controlSvg({ kind, value, applied: ends(kind).mid, param: paramOf(kind),
            tokens: TOKENS, state, zoom });
          assert.deepEqual(intensityLiterals(svg), [], `${kind} ${JSON.stringify(state)}`);
        }
      }
    }
  }
  const src = readFileSync(new URL('../../src/js/ui/synth/knob.js', import.meta.url), 'utf8');
  assert.deepEqual(intensityLiterals(src), [], 'knob.js source');
});

test('knob: a range across zero draws its value arc from zero', () => {
  const bi = { ...LIN, min: -50, max: 50, default: 0 };
  const ring = (svg) => [...svg.matchAll(/<path d="([^"]+)"[^>]*data-ring=""/g)].map((m) => m[1]);
  assert.deepEqual(ring(controlSvg({ kind: 'knob', value: 0, param: bi, tokens: TOKENS })), [],
    'no value arc at zero');
  assert.equal(ring(controlSvg({ kind: 'knob', value: 25, param: bi, tokens: TOKENS })).length, 1);
});

// ---------------------------------------------------------------- the knob's hardware geometry

/** The first element carrying `attr` (a data-* flag), or null. */
const part = (svg, attr) => (new RegExp(`<\\w+\\b[^>]*\\s${attr}=""[^>]*>`).exec(svg) || [null])[0];
const attrOf = (e, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(e) || [])[1];
const numOf = (e, a) => Number(attrOf(e, a));
/** Degrees, 0 up, clockwise (as the knob draws them). */
const angleAt = (x, y) => (Math.atan2(x, -y) * 180) / Math.PI;
/** An arc path's radius and the angles of its two ends. */
function arcOf(e) {
  const m = /M (\S+) (\S+) A (\S+) \S+ 0 [01] 1 (\S+) (\S+)/.exec(attrOf(e, 'd'));
  assert.ok(m, `an arc: ${e}`);
  const [x0, y0, r, x1, y1] = m.slice(1).map(Number);
  near(Math.hypot(x0, y0), r, 0.02);
  near(Math.hypot(x1, y1), r, 0.02);
  return { r, from: angleAt(x0, y0), to: angleAt(x1, y1) };
}
/** Every 'M x y L x y' of a path as [inner radius, outer radius, angle]; each one is radial. */
const radials = (e) => [...attrOf(e, 'd').matchAll(/M (\S+) (\S+) L (\S+) (\S+)/g)]
  .map((m) => m.slice(1).map(Number)).map(([x0, y0, x1, y1]) => {
    near(angleAt(x0, y0), angleAt(x1, y1), 0.1);
    return [Math.hypot(x0, y0), Math.hypot(x1, y1), angleAt(x1, y1)];
  });
const knobAngle = (v, p = LIN) => -135 + 270 * toNorm(v, p);
/** Every vertex of a polygon path ('M x y L x y ... Z') as [x, y]. */
const vertices = (e) => [...attrOf(e, 'd').matchAll(/[ML] (\S+) (\S+)/g)]
  .map((m) => [Number(m[1]), Number(m[2])]);

// ---------------------------------------------------------------- slice A: a solid part
// Plan F013 look audit, slice A (K1, K2, K3, K12, K13, K6-core): the knob is a moulded part on the
// plate, not a printed bullseye. Assertions 2, 4, 5 and 7 are the cast-shadow, pointer, teeth and
// hover tests below; 8 is in ui-synth-tokens.test.mjs.

test('slice A 1: the skirt is filled with the cap token, never the card or the plate', () => {
  for (const state of [{}, { hover: true }, { dragging: true }, { focus: true }]) {
    const skirt = part(draw('knob', { state }), 'data-skirt');
    assert.equal(attrOf(skirt, 'fill'), TOKENS.control.cap, JSON.stringify(state));
    for (const not of [TOKENS.surface.card, TOKENS.surface.plateHi]) {
      assert.notEqual(attrOf(skirt, 'fill'), not);
    }
  }
});

// Review of slice A, A3 and A7: the sheen's radial gradient is gone (no visible sheen, rule b);
// the side wall's linear gradient stays and the toothed rim is stroked with a second, vertical
// one, text.label at the top to control.edge at the foot.
test('slice A 3: a side-wall and a rim linear gradient, ids from uid, no stop-opacity, no sheen',
  () => {
    const t = TOKENS.control;
    const gradients = (svg) => [...svg.matchAll(/<(linear|radial)Gradient\b[^>]*\sid="([^"]+)"/g)]
      .map((m) => ({ kind: m[1], id: m[2] }));
    const a = draw('knob', { uid: 'osc1.cutoff' });
    const b = draw('knob', { uid: 'osc2.cutoff' });
    for (const [svg, uid] of [[a, 'osc1.cutoff'], [b, 'osc2.cutoff']]) {
      const g = gradients(svg);
      assert.deepEqual(g.map((x) => x.kind), ['linear', 'linear'], `${uid}: side wall and rim`);
      for (const { id } of g) assert.ok(id.includes(uid), `${id} names ${uid}`);
      const side = g.find((x) => x.id.endsWith('-side'));
      const rim = g.find((x) => x.id.endsWith('-rim'));
      assert.ok(side && rim, `${uid}: ${g.map((x) => x.id)}`);
      assert.ok(part(svg, 'data-side').includes(`fill="url(#${side.id})"`),
        'the side wall paints its gradient');
      assert.ok(part(svg, 'data-rim').includes(`stroke="url(#${rim.id})"`),
        'the rim strokes its gradient');
      assert.equal(part(svg, 'data-sheen'), null, `${uid}: no sheen (A3)`);
      const stops = [...svg.matchAll(/<stop\b[^>]*>/g)].map((m) => m[0]);
      assert.equal(stops.length, 4, 'two stops each');
      for (const st of stops) {
        assert.doesNotMatch(st, /opacity/, `no stop-opacity: ${st}`);
        assert.ok([t.cap, t.edge, TOKENS.text.label, TOKENS.surface.edge]
          .includes(attrOf(st, 'stop-color')), `a token stop: ${st}`);
      }
      assert.doesNotMatch(svg, /stop-opacity|fill-opacity|\sopacity=|<radialGradient/);
    }
    const ids = [...(a + b).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `no duplicate id: ${ids}`);
    // Without a uid the ids come from the parameter's id, so the markup stays a setpoint.
    const plain = draw('knob');
    assert.equal(plain, draw('knob'));
    for (const { id } of gradients(plain)) assert.ok(id.includes(LIN.id), id);
    const other = controlSvg({ kind: 'knob', value: 70, param: { ...LIN, id: 'drive' },
      tokens: TOKENS });
    assert.ok(gradients(other).every(({ id }) => id.includes('drive')));
    assert.notEqual(gradients(other)[0].id, gradients(plain)[0].id);
  });

test('slice A 6: the value arc\'s outer edge plus a 0.5 gap is inside the ticks (r 20.75)', () => {
  for (const zoom of [1.25, 2]) {
    const svg = draw('knob', { zoom });
    const ring = part(svg, 'data-ring');
    const tickIn = Math.min(...radials(part(svg, 'data-ticks')).map(([r0]) => r0));
    near(tickIn, 20.75, 0.02);
    assert.ok(arcOf(ring).r + numOf(ring, 'stroke-width') / 2 + 0.5 <= tickIn + 1e-9,
      `${arcOf(ring).r} + ${numOf(ring, 'stroke-width') / 2} + 0.5 > ${tickIn}`);
  }
});

test('knob: the unlit arc (1.25) and the value arc (2.5) are r 18.5, over 270°; skirt Ø32',
  () => {
  const t = TOKENS.control;
  for (const state of [{}, { dragging: true }]) {
    for (const zoom of [1, 3]) {
      const svg = draw('knob', { state, zoom });
      const track = part(svg, 'data-track');
      const a = arcOf(track);
      assert.equal(a.r, 18.5);
      near(a.from, -135, 0.05);
      near(a.to, 135, 0.05);
      assert.equal(attrOf(track, 'stroke'), t.track);
      assert.equal(numOf(track, 'stroke-width'), 1.25);
      const ring = part(svg, 'data-ring');
      const v = arcOf(ring);
      assert.equal(v.r, 18.5);
      near(v.from, -135, 0.05);
      near(v.to, knobAngle(70), 0.05);
      assert.equal(attrOf(ring, 'stroke'), t.ring);
      assert.equal(numOf(ring, 'stroke-width'), 2.5, `${JSON.stringify(state)}: never thicker`);
      const skirt = part(svg, 'data-skirt');
      assert.match(skirt, /^<path /);
      near(Math.max(...vertices(skirt).map(([x, y]) => Math.hypot(x, y))), 16, 0.02);
      // Review of slice A, finding 1: surface.edge held 1.04-1.23:1 on the plates, so the body had
      // no silhouette; the edge is control.edge (3:1 on both plates, ui-synth-tokens.test.mjs).
      assert.equal(attrOf(skirt, 'stroke'), t.edge, 'the silhouette edge in control.edge');
      assert.equal(numOf(skirt, 'stroke-width'), 1);
      const cap = part(svg, 'data-cap');
      assert.match(cap, /^<circle /);
      assert.equal(numOf(cap, 'r'), 12, 'Ø24');
      assert.equal(attrOf(cap, 'fill'), t.cap);
    }
  }
});

// Slice A (K3): the skirt is one closed toothed outline and the dashed 24-stroke knurl ring that
// made four concentric rings a bullseye is gone. Review of slice A, finding 2: 40 teeth 0.6 deep
// were 0.87 px at the panel's 64 px, an anti-aliased fuzz; 30 teeth from r 16 to r 14.8 are
// 1.75 px deep and 4.9 px apart there, ridges a moulded part shows.
test('knob: the skirt is one closed path of 30 teeth, r 16 and 14.8 alternating; no knurl', () => {
  for (const state of [{}, { disabled: true }, { hover: true }]) {
    const svg = draw('knob', { state });
    const skirt = part(svg, 'data-skirt');
    assert.match(attrOf(skirt, 'd'), /^M [^MZ]+ Z$/, 'one closed path');
    const r = vertices(skirt).map(([x, y]) => Math.hypot(x, y));
    assert.equal(r.length, 60, '30 teeth: 60 vertices');
    r.forEach((ri, i) => near(ri, i % 2 ? 14.8 : 16, 0.02));
    const deg = vertices(skirt).map(([x, y]) => angleAt(x, y));
    deg.forEach((d, i) => near(((d - deg[0] + 720) % 360), i * 6, 0.15));
    assert.equal(part(svg, 'data-knurl'), null, `${JSON.stringify(state)}: no knurl layer`);
    if (!state.disabled) {
      assert.ok(!svg.includes(`stroke="${TOKENS.control.knurl}"`), 'nothing in --osc-border');
    }
  }
});

// Review of slice A, finding 2: a tooth reads as a ridge only when it is deep and wide enough on
// screen at the panel's 64 px knob (zoom 64/44): at least 1.5 px deep, at least 3 px apart, and
// 24 to 30 of them (a coarse moulded knurl, not a sawblade).
test('knob: the teeth are at least 1.5 px deep and 3 px apart on the panel\'s 64 px knob', () => {
  const { teeth, skirt, toothIn } = KNOB_CORE.KNOB;
  const z = 64 / 44;
  assert.ok(teeth >= 24 && teeth <= 30, `${teeth} teeth`);
  assert.ok(skirt - toothIn >= 1.2 - 1e-9, `${skirt - toothIn} units deep`);
  assert.ok((skirt - toothIn) * z >= 1.5, `${((skirt - toothIn) * z).toFixed(2)} px deep`);
  assert.ok(((2 * Math.PI * skirt) / teeth) * z >= 3, 'a pitch of at least 3 px');
  const r = vertices(part(draw('knob'), 'data-skirt')).map(([x, y]) => Math.hypot(x, y));
  assert.ok((Math.max(...r) - Math.min(...r)) * z >= 1.5, 'as drawn');
});

// Slice A (K2): a butt-ended pointer from r 5 to r 12 on the cap, continued on the skirt by a
// second segment from r 12.5 to r 16 at the same angle, as a moulded line, not a clock hand.
test('knob: the pointer runs r 5 to 12, 2 wide and butt, and on the skirt r 12.5 to 16', () => {
  const t = TOKENS.control;
  for (const value of [0, 25, 50, 100]) {
    const svg = draw('knob', { value });
    const ptr = part(svg, 'data-pointer');
    assert.match(ptr, /^<line /);
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => numOf(ptr, a));
    near(Math.hypot(x1, y1), 5, 0.02);
    near(Math.hypot(x2, y2), 12, 0.02);
    near(angleAt(x2, y2), knobAngle(value), 0.1);
    assert.equal(attrOf(ptr, 'stroke'), t.pointer);
    assert.equal(numOf(ptr, 'stroke-width'), 2);
    assert.equal(attrOf(ptr, 'stroke-linecap'), 'butt');
    const sk = part(svg, 'data-pointer-skirt');
    assert.ok(sk, `v ${value}: a pointer segment on the skirt`);
    const [s1, t1, s2, t2] = ['x1', 'y1', 'x2', 'y2'].map((a) => numOf(sk, a));
    near(Math.hypot(s1, t1), 12.5, 0.02);
    near(Math.hypot(s2, t2), 16, 0.02);
    near(angleAt(s2, t2), knobAngle(value), 0.1);
    assert.equal(numOf(sk, 'stroke-width'), 1.5);
    assert.equal(attrOf(sk, 'stroke'), t.pointer);
    assert.equal(attrOf(sk, 'stroke-linecap'), 'butt');
  }
});

// Slice A (K6-core): the hover overlay is always emitted, as the panel's focus ring is, hidden
// by visibility unless hovered, so a host can reveal it with group-hover. Review of slice A, A1
// (C5, one hover language for knob, dial, lever and slide): the faint capHi circle at the teeth's
// root is gone; hover brightens the part's own edge, the toothed outline itself at the edge's
// width (1, not the 1.5 star of finding 4), in control.pointer (measured in
// ui-synth-tokens.test.mjs), over the skirt and its rim and under both pointer segments.
test('knob: hover brightens the toothed edge itself in control.pointer, always emitted (A1)',
  () => {
    const t = TOKENS.control;
    for (const state of [{}, { focus: true }, { dragging: true }, { hover: true },
      { disabled: true }, { disabled: true, hover: true }]) {
      const svg = draw('knob', { state });
      const where = JSON.stringify(state);
      const h = part(svg, 'data-hover');
      const skirt = part(svg, 'data-skirt');
      assert.ok(h, `${where}: the overlay`);
      assert.match(h, /^<path /, `${where}: the toothed outline, not a circle`);
      assert.equal(attrOf(h, 'd'), attrOf(skirt, 'd'), `${where}: the skirt's own edge`);
      assert.equal(numOf(h, 'stroke-width'), numOf(skirt, 'stroke-width'), `${where}: its width`);
      assert.equal(attrOf(h, 'fill'), 'none');
      assert.equal(attrOf(h, 'stroke'), t.pointer, `${where}: the edge brightens to the pointer`);
      assert.equal(attrOf(skirt, 'stroke'), state.disabled ? t.knurl : t.edge,
        `${where}: the overlay brightens, the edge itself is not swapped`);
      const shown = state.hover && !state.disabled;
      assert.equal(attrOf(h, 'visibility'), shown ? undefined : 'hidden', where);
      assert.ok(svg.indexOf(h) > svg.indexOf(skirt), `${where}: over the skirt`);
      const rim = part(svg, 'data-rim');
      if (rim) assert.ok(svg.indexOf(h) > svg.indexOf(rim), `${where}: over the rim`);
      for (const flag of ['data-pointer', 'data-pointer-skirt']) {
        assert.ok(svg.indexOf(h) < svg.indexOf(part(svg, flag)), `${where}: under ${flag}`);
      }
    }
  });

// Review of slice A, A7: the rim is lit from above. The toothed outline is stroked over its
// control.edge silhouette with a vertical gradient (objectBoundingBox, top to foot) from
// text.label (--osc-text-muted) at the top to control.edge at the foot, both 3:1 on both plates
// in both themes (ui-synth-tokens.test.mjs), its id from the uid, no stop-opacity; a disabled
// knob keeps its quiet edge and draws no rim.
test('knob: the toothed rim is a vertical gradient, text.label at the top to control.edge (A7)',
  () => {
    for (const uid of ['osc1.cutoff', 'a b)c']) {
      for (const state of [{}, { hover: true }, { dragging: true }, { focus: true }]) {
        const svg = draw('knob', { uid, state });
        const where = `${uid} ${JSON.stringify(state)}`;
        const rim = part(svg, 'data-rim');
        const skirt = part(svg, 'data-skirt');
        assert.ok(rim && rim.startsWith('<path '), `${where}: the rim`);
        assert.equal(attrOf(rim, 'd'), attrOf(skirt, 'd'), `${where}: on the toothed outline`);
        assert.equal(attrOf(rim, 'fill'), 'none', where);
        assert.equal(numOf(rim, 'stroke-width'), numOf(skirt, 'stroke-width'), where);
        assert.equal(attrOf(rim, 'class'), undefined, `${where}: opaque, no intensity`);
        const id = /^url\(#([^)]+)\)$/.exec(attrOf(rim, 'stroke'))[1];
        assert.ok(id.endsWith('-rim') && id.includes(uid.replace(/[^\w.:-]/g, '_')), id);
        const g = new RegExp(`<linearGradient\\b[^>]*\\sid="${id}"[^>]*>(.*?)</linearGradient>`)
          .exec(svg);
        assert.ok(g, `${where}: the rim's gradient`);
        const head = /<linearGradient\b[^>]*>/.exec(g[0])[0];
        assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((k) => numOf(head, k)), [0, 0, 0, 1],
          `${where}: vertical, top to foot`);
        const stops = [...g[1].matchAll(/<stop\b[^>]*>/g)].map((m) => m[0]);
        assert.deepEqual(stops.map((x) => [numOf(x, 'offset'), attrOf(x, 'stop-color')]),
          [[0, TOKENS.text.label], [1, TOKENS.control.edge]], `${where}: lit top, edge foot`);
        for (const x of stops) assert.doesNotMatch(x, /opacity/, where);
        assert.ok(svg.indexOf(rim) > svg.indexOf(part(svg, 'data-side')),
          `${where}: over the wall`);
        assert.ok(svg.indexOf(rim) < svg.indexOf(part(svg, 'data-cap')), `${where}: under the cap`);
      }
    }
    assert.equal(part(draw('knob', { state: { disabled: true } }), 'data-rim'), null,
      'disabled: the quiet edge, no rim');
  });

// Review of slice A, finding 7: the uid is sanitised to an id's characters, so a uid with a
// space, a ')' or a '#' still names a gradient every url(#...) paint resolves.
test('knob: a uid with a space, \')\' or \'#\' still names ids every url(#) resolves', () => {
  for (const uid of ['a b)c#d', 'osc 1(cutoff)', '#x"y<z>']) {
    const svg = draw('knob', { uid });
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 2, `${uid}: the gradients`);
    for (const id of ids) assert.match(id, /^[\w.:-]+$/, `${uid}: an id's characters: ${id}`);
    const refs = [...svg.matchAll(/url\(#([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2, `${uid}: the paints`);
    for (const r of refs) assert.ok(ids.includes(r), `${uid}: url(#${r}) resolves`);
  }
});

// Slice A (K1, K6-core): the knob casts a shadow on the plate, r = skirt + 0.5 offset down and
// right, before (under) the skirt, in the depth shade at hw-shadow (the depth roles of 21's
// amendment, ui-synth-tokens.test.mjs); a drag lifts it to shadowDragDy. The cap casts none
// on the skirt: cap and skirt are one moulded body.
test('knob: a cast shadow at hw-shadow in control.shade, offset down-right, under the skirt',
  () => {
  const rest = part(draw('knob'), 'data-cast-shadow');
  for (const [state, drag] of [[{}, false], [{ dragging: true }, true], [{ focus: true }, false],
    [{ disabled: true }, false]]) {
    const svg = draw('knob', { state });
    const sh = part(svg, 'data-cast-shadow');
    assert.ok(sh, JSON.stringify(state));
    assert.match(sh, /^<circle /);
    assert.match(sh, /\sclass="opacity-hw-shadow"/);
    assert.doesNotMatch(sh, /opacity="/);
    assert.equal(attrOf(sh, 'fill'), TOKENS.control.shade, 'the depth shade (21, amendment a-e)');
    assert.equal(attrOf(sh, 'stroke'), 'none');
    assert.equal(numOf(sh, 'r'), 16.5, 'skirt + 0.5');
    assert.ok(numOf(sh, 'cx') > 0 && numOf(sh, 'cy') > 0, 'down and to the right');
    assert.ok(svg.indexOf(sh) < svg.indexOf(part(svg, 'data-skirt')), 'under the skirt');
    assert.equal(part(svg, 'data-shadow'), null, 'no cap shadow on the skirt');
    if (drag) assert.ok(numOf(sh, 'cy') > numOf(rest, 'cy'), 'a drag moves it further');
    else assert.equal(sh, rest, `${JSON.stringify(state)}: at rest`);
  }
  assert.equal(numOf(part(draw('knob', { state: { dragging: true } }), 'data-cast-shadow'), 'cy'),
    KNOB_CORE.KNOB.shadowDragDy, 'the drag offset is shadowDragDy');
});

test('knob: 11 scale ticks from r 20.75 to 22, only at zoom 1.25 or more', () => {
  for (const zoom of [0.5, 1, 1.2]) assert.equal(part(draw('knob', { zoom }), 'data-ticks'), null);
  for (const zoom of [1.25, 2, 3]) {
    const ticks = part(draw('knob', { zoom }), 'data-ticks');
    assert.ok(ticks, `zoom ${zoom}`);
    assert.equal(attrOf(ticks, 'stroke'), TOKENS.control.track);
    assert.doesNotMatch(ticks, /stroke-linecap="round"/, 'butt ends stay inside the box');
    const r = radials(ticks);
    assert.equal(r.length, 11);
    r.forEach(([r0, r1, deg], i) => {
      near(r0, 20.75, 0.02);
      near(r1, 22, 0.02);
      near(deg, -135 + i * 27, 0.1);
    });
  }
});

test('knob: the focus ring is r 21, 2 wide (2 CSS px at zoom 1), inside the 44 box', () => {
  const f = part(draw('knob', { state: { focus: true } }), 'data-focus');
  assert.match(f, /^<circle /);
  assert.equal(numOf(f, 'r'), 21);
  assert.ok(numOf(f, 'stroke-width') >= 2, 'at least 2 CSS px at zoom 1, and thicker zoomed in');
  assert.equal(attrOf(f, 'stroke'), TOKENS.control.focus);
  assert.ok(numOf(f, 'r') + numOf(f, 'stroke-width') / 2 <= 22);
  assert.equal(part(draw('knob'), 'data-focus'), null);
});

test('knob: a range across zero starts its arc at 12 o\'clock, with a detent tick there', () => {
  const t = TOKENS.control;
  const bi = { ...LIN, min: -50, max: 50, default: 0 };
  for (const [value, from, to] of [[25, 0, 67.5], [-25, -67.5, 0], [50, 0, 135]]) {
    const svg = controlSvg({ kind: 'knob', value, param: bi, tokens: TOKENS });
    const a = arcOf(part(svg, 'data-ring'));
    near(a.from, from, 0.05);
    near(a.to, to, 0.05);
  }
  for (const value of [0, 25]) {
    const d = part(controlSvg({ kind: 'knob', value, param: bi, tokens: TOKENS }), 'data-detent');
    assert.match(d, /^<line /);
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => numOf(d, k));
    near(Math.hypot(x1, y1), 20.75, 0.02);
    near(Math.hypot(x2, y2), 21.75, 0.02, 'its butt corners stay inside r 22 at any angle');
    near(angleAt(x2, y2), 0, 0.05);
    assert.equal(attrOf(d, 'stroke'), t.track);
  }
  assert.equal(part(draw('knob'), 'data-detent'), null, 'a range from min has no detent');
  // additive-voice.tilt [-12, 6]: zero sits at 45°, and the arc and the detent start there.
  const tilt = { ...LIN, min: -12, max: 6, default: 0 };
  const ts = controlSvg({ kind: 'knob', value: 6, param: tilt, tokens: TOKENS });
  const ta = arcOf(part(ts, 'data-ring'));
  near(ta.from, 45, 0.05);
  near(ta.to, 135, 0.05);
  const td = part(ts, 'data-detent');
  near(angleAt(numOf(td, 'x2'), numOf(td, 'y2')), 45, 0.05);
});

test('knob: the applied value is an arc at r 13.5 in control.applied, from the origin', () => {
  const t = TOKENS.control;
  const ap = (value, applied, param = LIN) => part(controlSvg({ kind: 'knob', value, applied,
    param, tokens: TOKENS }), 'data-applied');
  const a = ap(70, 30);
  assert.match(a, /^<path /);
  assert.equal(attrOf(a, 'stroke'), t.applied);
  assert.ok(numOf(a, 'stroke-width') < 2.5, 'thinner than the pointer');
  const arc = arcOf(a);
  assert.equal(arc.r, 13.5);
  near(arc.from, -135, 0.05);
  near(arc.to, knobAngle(30), 0.05);
  const atOrigin = arcOf(ap(70, 0));
  assert.ok(atOrigin.to - atOrigin.from >= 4, `still seen at the origin: ${atOrigin.from}..${
    atOrigin.to}`);
  near((atOrigin.from + atOrigin.to) / 2, -135, 0.05);
  const bi = { ...LIN, min: -50, max: 50, default: 0 };
  const b = arcOf(ap(25, -25, bi));
  near(b.from, -67.5, 0.05);
  near(b.to, 0, 0.05);
  assert.equal(ap(70, 70), null, 'none when the engine applies the value');
});

// The value arc (control.ring) and the unlit arc (control.track) lie on each other, and no
// existing token pair holds 3:1 between them and the plates in both themes (cyan on text-dim is
// 1.02:1 in the light theme), so the lit arc is told from the unlit one by width: the track is
// at most half the value arc and lies wholly under it (review of S2, finding 1).
test('knob: the lit arc is told from the unlit arc by width: the track is half or less', () => {
  for (const state of [{}, { focus: true }, { dragging: true }, { hover: true }]) {
    for (const zoom of [1, 2, 3]) {
      for (const value of [10, 70, 100]) {
        const svg = draw('knob', { state, zoom, value });
        const where = `${JSON.stringify(state)} zoom ${zoom} v ${value}`;
        const track = part(svg, 'data-track');
        const ring = part(svg, 'data-ring');
        const [tw, rw] = [numOf(track, 'stroke-width'), numOf(ring, 'stroke-width')];
        assert.ok(tw * 2 <= rw, `${where}: track ${tw} is not half of the value arc ${rw}`);
        const [tr, rr] = [arcOf(track).r, arcOf(ring).r];
        assert.ok(tr - tw / 2 >= rr - rw / 2 && tr + tw / 2 <= rr + rw / 2,
          `${where}: the track band lies under the value arc`);
        assert.ok(svg.indexOf(track) < svg.indexOf(ring), `${where}: the value arc on top`);
      }
    }
  }
});

// The applied arc sits on the skirt face (the cap's colour since slice A), between the cap's
// outline and the teeth, so no part of it lies on the skirt edge (review of S2, finding 2).
test('knob: the applied arc lies on the skirt face, clear of the cap, the teeth and the edge',
  () => {
    for (const zoom of [1, 2, 3]) {
      for (const [value, applied] of [[70, 30], [70, 0], [10, 100]]) {
        const svg = controlSvg({ kind: 'knob', value, applied, param: LIN, tokens: TOKENS,
          zoom });
        const a = part(svg, 'data-applied');
        const [r, w] = [arcOf(a).r, numOf(a, 'stroke-width')];
        const cap = part(svg, 'data-cap');
        const capOut = numOf(cap, 'r') + numOf(cap, 'stroke-width') / 2;
        const skirt = part(svg, 'data-skirt');
        const toothIn = Math.min(...vertices(skirt).map(([x, y]) => Math.hypot(x, y)));
        const edgeIn = toothIn - numOf(skirt, 'stroke-width') / 2;
        const where = `zoom ${zoom} v ${value} a ${applied}: r ${r} w ${w}`;
        assert.ok(r - w / 2 >= capOut, `${where}: clear of the cap (${capOut})`);
        assert.ok(r + w / 2 <= edgeIn, `${where}: clear of the teeth and edge (${edgeIn})`);
        assert.equal(attrOf(skirt, 'fill'), TOKENS.control.cap, 'drawn over the skirt face');
        assert.ok(svg.indexOf(skirt) < svg.indexOf(a), `${where}: over the skirt`);
        assert.ok(svg.indexOf(a) < svg.indexOf(cap), `${where}: under the cap`);
      }
    }
  });

// C1 (one disabled language, co-signed by p2 and dev-53): a disabled knob draws no value mark,
// the track only (review of slice A, finding 9: no applied arc either); its cap and skirt
// flattened to plateLo (no side wall, no sheen); its pointer in control.disabled. Review of
// slice A, finding 3: an edge in control.disabled made the disabled knob louder than an enabled
// one, so its edge is the quiet control.knurl. The absent value mark is a shape cue, so S7 holds
// without colour alone.
test('knob: disabled (C1) is the track only, a flat plateLo body, pointer disabled, edge quiet',
  () => {
    const t = TOKENS.control;
    const BIP = { ...LIN, min: -50, max: 50, default: 0 };
    for (const p of [LIN, BIP, LOG]) {
      for (let i = 0; i <= 20; i++) {
        const value = fromNorm(i / 20, p);
        for (const state of [{ disabled: true }, { disabled: true, focus: true, hover: true,
          dragging: true }]) {
          const applied = fromNorm(1 - i / 20, p);
          const off = controlSvg({ kind: 'knob', value, applied, param: p, tokens: TOKENS,
            state });
          const where = `${p.id} n ${i / 20} ${JSON.stringify(state)}`;
          assert.equal(part(off, 'data-ring'), null, `${where}: no value arc`);
          assert.equal(part(off, 'data-applied'), null, `${where}: no applied mark`);
          assert.ok(!off.includes(`stroke="${t.applied}"`), `${where}: nothing in applied`);
          assert.ok(part(off, 'data-track'), `${where}: the track`);
          assert.doesNotMatch(off, /stroke-dasharray/, `${where}: no dashes`);
          assert.ok(!off.includes(`stroke="${t.ring}"`), where);
          for (const flag of ['data-skirt', 'data-cap']) {
            assert.equal(attrOf(part(off, flag), 'fill'), TOKENS.surface.plateLo,
              `${where} ${flag}`);
          }
          assert.equal(part(off, 'data-side'), null, `${where}: flat, no side wall`);
          assert.equal(part(off, 'data-sheen'), null, `${where}: flat, no sheen`);
          assert.equal(part(off, 'data-rim'), null, `${where}: no lit rim`);
          assert.equal(attrOf(part(off, 'data-skirt'), 'stroke'), t.knurl, `${where}: quiet edge`);
          for (const flag of ['data-pointer', 'data-pointer-skirt']) {
            assert.equal(attrOf(part(off, flag), 'stroke'), t.disabled, `${where} ${flag}`);
          }
        }
      }
    }
    assert.ok(part(draw('knob'), 'data-ring'), 'an enabled knob keeps its value arc');
    assert.ok(part(controlSvg({ kind: 'knob', value: 70, applied: 30, param: LIN, tokens: TOKENS }),
      'data-applied'), 'and its applied mark');
  });

// C1 rewrote S7's comment in knob.js: no dashed disabled arc remains, and the comment says the
// disabled language (the absent value mark is the cue, not colour alone).
test('knob.js: no disabledDash; the S7 comment states the one disabled language (C1)', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/knob.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /disabledDash|DASH_W|stroke-dasharray/);
  const c1 = /\/\/[^\n]*\bC1\b[^]*?(?=\n(?!\s*\/\/))/.exec(src);
  assert.ok(c1, 'a comment naming C1');
  // Review of slice A, A4: plateLo is the cap's own token until D-PAL, so the comment says what
  // the cue is today (no value arc, the dim pointer, the quiet edge) and what waits on D-PAL.
  for (const words of ['no value arc', 'track only', 'plateLo', 'control.disabled', 'S7',
    'D-PAL', 'the cue today']) {
    assert.ok(c1[0].replace(/\s*\/\/\s*/g, ' ').includes(words), `the C1 comment says ${words}`);
  }
});

// S7 (W1b re-review): the unlit arc took the knurl's tone while disabled, 1.10:1 (dark) and
// 1.40:1 (light) on the plate; it is control.track (--osc-text-dim, 3:1 on both plates in both
// themes, ui-synth-tokens.test.mjs) in every state, and the dashes are told from it by width.
test('knob: the unlit arc is control.track in every state, disabled too (S7)', () => {
  for (const state of [{}, { focus: true }, { dragging: true }, { hover: true },
    { disabled: true }, { disabled: true, focus: true, hover: true }]) {
    for (const value of [0, 10, 70, 100]) {
      const track = part(draw('knob', { state, value }), 'data-track');
      assert.equal(attrOf(track, 'stroke'), TOKENS.control.track,
        `${JSON.stringify(state)} v ${value}: never the knurl's faint tone`);
    }
  }
});

test('fader and switch: the slot and the body are outlined in control.track (3:1)', () => {
  const t = TOKENS;
  const slot = /<g pointer-events="none"><rect [^>]*>/.exec(draw('fader'))[0];
  assert.equal(attrOf(slot, 'stroke'), t.control.track);
  assert.equal(attrOf(slot, 'fill'), t.surface.edge);
  const body = /<g pointer-events="none"><rect [^>]*>/.exec(draw('switch'))[0];
  assert.equal(attrOf(body, 'stroke'), t.control.track);
  assert.equal(attrOf(body, 'fill'), t.surface.edge);
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
  const ppr = pixelsPerRangeFor('switch', 1, BOOL);
  assert.equal(dragValue(false, -ppr * 0.6, BOOL, { pixelsPerRange: ppr }), true,
    'a switch flips under the finger');
  assert.ok(ppr < 30);
});

test('fader: a track and a cap whose position follows the value; switch: two positions', () => {
  const capY = (svg) => Number(/<rect data-cap="" x="[^"]+" y="([^"]+)"/.exec(svg)[1]);
  const lo = controlSvg({ kind: 'fader', value: 0, param: LIN, tokens: TOKENS });
  const hi = controlSvg({ kind: 'fader', value: 100, param: LIN, tokens: TOKENS });
  assert.ok(capY(hi) < capY(lo), 'up is more');
  assert.ok(lo.includes(`stroke="${TOKENS.control.track}"`) || lo.includes(
    `fill="${TOKENS.control.track}"`), 'track');
  const off = controlSvg({ kind: 'switch', value: false, param: BOOL, tokens: TOKENS });
  const on = controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: TOKENS });
  assert.ok(capY(on) < capY(off), 'on is up');
});

/** The fader's value fill: the one rect with no stroke. */
const FILL = new RegExp('<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)" rx="[^"]+" '
  + 'fill="([^"]+)" stroke="none"/>');

test('fader: a range across zero fills from zero, as the knob\'s arc does', () => {
  const BI = { key: 'tune', label: 'Tune', unit: 'st', min: -24, max: 24, step: 1 };
  const fill = (v) => {
    const m = FILL.exec(controlSvg({ kind: 'fader', value: v, param: BI, tokens: TOKENS }));
    return m ? [Number(m[1]), Number(m[1]) + Number(m[2])] : null;
  };
  assert.equal(fill(0), null, 'no fill at zero');
  const yOf = (v) => FADER_TRAVEL / 2 - FADER_TRAVEL * toNorm(v, BI);
  const up = fill(12);
  near(up[0], yOf(12), 0.01);
  near(up[1], yOf(0), 0.01);
  const down = fill(-12);
  near(down[0], yOf(0), 0.01);
  near(down[1], yOf(-12), 0.01);
  const uni = FILL.exec(controlSvg({ kind: 'fader', value: 50, param: LIN, tokens: TOKENS }));
  near(Number(uni[1]) + Number(uni[2]), FADER_TRAVEL / 2 + 2, 0.01, 'a range from min fills up');
});

test('a switch is for an enum of up to four options or a boolean; a number is refused', () => {
  for (const param of [LIN, LOG, INT, { key: 'x', min: 0, max: 1, step: 1 }]) {
    assert.throws(() => controlSvg({ kind: 'switch', value: param.min, param, tokens: TOKENS }),
      /switch.*enum or a boolean/);
    assert.throws(() => pixelsPerRangeFor('switch', 1, param), /switch.*enum or a boolean/);
  }
  const FIVE = { key: 'f', label: 'Five', type: 'enum', default: 0,
    options: [[0, 'a'], [1, 'b'], [2, 'c'], [3, 'd'], [4, 'e']] };
  assert.throws(() => controlSvg({ kind: 'switch', value: 0, param: FIVE, tokens: TOKENS }),
    /at most 4 positions.*knob/);
  assert.throws(() => pixelsPerRangeFor('switch', 1, FIVE), /at most 4 positions/);
  assert.doesNotMatch(controlSvg({ kind: 'knob', value: 3, param: FIVE, tokens: TOKENS }), /NaN/,
    'a knob draws it as a rotary selector');
  assert.ok(controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: TOKENS }));
  assert.ok(controlSvg({ kind: 'switch', value: 'square', param: ENUM, tokens: TOKENS }));
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

test('applied: a second, thin marker where the applied value differs (knob: an arc)', () => {
  const t = TOKENS.control;
  const MARK = /<(?:line|path)\b[^>]*\sdata-applied=""[^>]*>/;
  for (const kind of KINDS) {
    const param = paramOf(kind);
    const e = ends(kind);
    const plain = controlSvg({ kind, value: e.hi, param, tokens: TOKENS });
    const same = controlSvg({ kind, value: e.hi, applied: e.hi, param, tokens: TOKENS });
    const split = controlSvg({ kind, value: e.hi, applied: e.lo, param, tokens: TOKENS });
    assert.equal(same, plain, `${kind}: no marker when applied equals the value`);
    assert.doesNotMatch(plain, /data-applied/);
    const m = MARK.exec(split);
    assert.ok(m, `${kind}: a marker`);
    const paint = kind === 'knob' ? t.applied : t.pointer;
    assert.ok(m[0].includes(`stroke="${paint}"`), `${kind}: in ${paint}`);
    const others = /<line (?!data-applied)[^>]*stroke-width="([^"]+)"/g;
    const pointerW = Math.max(...[...split.matchAll(others)].map((x) => Number(x[1])));
    assert.ok(Number(/stroke-width="([^"]+)"/.exec(m[0])[1]) < pointerW, `${kind}: thinner`);
    const other = controlSvg({ kind, value: e.hi, applied: e.mid, param, tokens: TOKENS });
    assert.notEqual(MARK.exec(other)[0], m[0], `${kind}: it moves`);
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
    assert.equal(aria['aria-valuenow'], Math.round(toNorm(v, p) * 1000), where);
    assert.equal(aria['aria-valuetext'], formatValue(v, p), where);
    for (const kind of ['knob', 'fader']) {
      const svg = controlSvg({ kind, value: v, applied: p.min, param: p, tokens: TOKENS,
        state: { focus: true } });
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${where} ${kind}`);
      assert.deepEqual(colourLiterals(svg), [], `${where} ${kind}`);
    }
    assert.throws(() => controlSvg({ kind: 'switch', value: v, param: p, tokens: TOKENS }),
      /switch/, `${where}: a number is not a switch`);
  }
});

/** The decimals of a grid quantum (0.01: 2, 1e-7: 7, 0.25: 2, 10: 0). */
function gridDecimals(q) {
  for (let d = 0; d < 15; d++) {
    const x = q * 10 ** d;
    if (Math.round(x) >= 1 && Math.abs(x - Math.round(x)) < 1e-9 * x) return d;
  }
  return 15;
}
/** A readout's decimals in the parameter's own unit: '9.958 kHz' of Hz is 0, '1.2 ms' of s 4,
 *  '-80.0 dB' 1; a whole number's trailing zeros are its magnitude ('990 ms' of s is 2), and
 *  zero has none. */
function readoutDecimals(text) {
  const m = /^[+-]?(\d+)(?:\.(\d+))?(?:\s+(\S.*))?$/.exec(text);
  assert.ok(m, `a number readout: "${text}"`);
  const shift = { kHz: -3, ms: 3 }[m[3]] || 0;
  if (!m[2] && Number(m[1]) === 0) return 0;
  const whole = m[2] ? 0 : /0*$/.exec(m[1])[0].length;
  return (m[2] ? m[2].length : 0) - whole + shift;
}
/** The decimals a value's step implies: the step's (an integer's 1), on a stepless log range
 *  K058's grid there (four significant digits); fine one more. */
function stepImplies(v, p, fine) {
  const step = p.step > 0 ? p.step : (p.type === 'integer' ? 1 : 0);
  const g = step || 10 ** (Math.floor(Math.log10(Math.abs(v))) - 3);
  return gridDecimals(g) + (fine ? 1 : 0);
}

// S7 (W1b re-review): drag readouts were long (0.9931 × on a 0.01 step, 1.235 ms on a 1 ms one,
// -80.0 dB on a 1 dB one). During a drag, coarse or fine, from anywhere on the range, a
// readout has at most the decimals the step implies, fine one more.
test('every registry parameter: a drag readout has at most the decimals its step implies', () => {
  assert.ok(REGISTRY_NUMBERS.every(({ p }) => p.step > 0 || p.type === 'integer'
    || p.scale === 'log'), 'every registry number is stepped or log');
  const long = [];
  for (const { where, p } of REGISTRY_NUMBERS) {
    const starts = [p.default, ...[0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((n) => fromNorm(n, p))]
      .map((v) => quantize(v, p));
    let worst = null;
    for (const start of starts) {
      for (let dy = -240; dy <= 240; dy += 1.5) {
        for (const fine of [false, true]) {
          const v = dragValue(start, dy, p, { fine });
          const text = formatValue(v, p);
          const over = readoutDecimals(text) - stepImplies(v, p, fine);
          if (over > 0 && (!worst || over > worst.over)) worst = { over, text, fine };
        }
      }
    }
    if (worst) long.push(`${where} (step ${p.step}): "${worst.text}"${worst.fine ? ' fine' : ''}`);
  }
  assert.deepEqual(long, [], 'readouts with more decimals than the step needs');
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
    const positions = p.type === 'boolean' ? 2 : p.options.length;
    for (const kind of KINDS) {
      if (kind === 'switch' && positions > 4) {
        assert.throws(() => controlSvg({ kind, value: v, param: p, tokens: TOKENS }), /knob/);
        continue;
      }
      const svg = controlSvg({ kind, value: v, param: p, tokens: TOKENS });
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${where} ${kind}`);
    }
  }
});

// ---------------------------------------------------------------- K058's checks, on the core

const cutoff = PANEL.module('lpf').params.find((p) => p.key === 'frequency');
const tune = PANEL.module('vco1').params.find((p) => p.key === 'tune');
const wave = PANEL.module('vco1').params.find((p) => p.key === 'waveform');

test('K058\'s checks hold on the core (tests/unit/synth-knob.test.mjs, same parameters)', () => {
  const angle = (v, p) => -135 + 270 * toNorm(v, p);
  assert.equal(angle(10, cutoff), -135);
  assert.equal(angle(20000, cutoff), 135);
  assert.ok(Math.abs(angle(Math.sqrt(10 * 20000), cutoff)) < 1e-9, 'the geometric middle is up');
  assert.equal(angle(0, tune), 0);
  assert.equal(dragValue(-1200, -DRAG_PX_PER_RANGE, tune), 1200);
  assert.equal(dragValue(0, -DRAG_PX_PER_RANGE / 2, tune, { fine: true }), 120);
  assert.equal(dragValue(0, 10_000, tune), -1200, 'clamped');
  const k = (name, v, p, shiftKey = false) => knobKey(key(name, { shiftKey }),
    { value: v, param: p });
  assert.equal(k('ArrowUp', 0, tune), 1);
  assert.equal(k('ArrowLeft', 0, tune), -1);
  assert.equal(k('PageUp', 0, tune), 240, 'PageUp is 10 % of the range, as K058 states');
  assert.equal(k('PageDown', 0, tune), -240);
  assert.equal(k('Home', 0, tune), -1200);
  assert.equal(k('End', 0, tune), 1200);
  assert.equal(k(' ', 0, tune), null, 'Space is never taken (ADR 0050)');
  assert.ok(k('ArrowUp', 1000, cutoff) > 1000
    && k('ArrowUp', 1000, cutoff, true) < k('ArrowUp', 1000, cutoff));
  assert.deepEqual(parseValue('1.2k', cutoff), { ok: true, value: 1200 });
  assert.deepEqual(parseValue('1200 Hz', cutoff), { ok: true, value: 1200 });
  assert.deepEqual(parseValue('-3', tune), { ok: true, value: -3 });
  assert.match(parseValue('40k', cutoff).reason, /Cutoff must be between 10 and 20000/);
  assert.equal(parseValue('loud', cutoff).ok, false);
  const att = PANEL.module('eg2').params.find((p) => p.key === 'attack');
  assert.equal(parseValue('350 ms', att).value, 0.35);
  assert.equal(formatValue(-12, tune), '-12 ct');
  assert.equal(formatValue(702, tune), '+702 ct');
  assert.equal(stepOption(wave, 'sawtooth', 1), 'square');
  assert.equal(stepOption(wave, 'triangle', -1), 'triangle');
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

// ---------------------------------------------------------------- feel (plan S3)
// Read through the namespaces, so a name the core lacks fails its own test and no other.
const CORE = { ...KNOB_CORE, ...FEEL };

const kd = (k, t, repeat = false) => ({ type: 'keydown', key: k, timeStamp: t, repeat });
const ku = (k, t) => ({ type: 'keyup', key: k, timeStamp: t });
const wh = (t) => ({ type: 'wheel', timeStamp: t });

test('drag: changing Shift mid-drag re-anchors at the current value, so nothing jumps', () => {
  let a = CORE.dragAnchor(50, { x: 0, y: 100 });
  assert.ok(Object.isFrozen(a));
  let v = CORE.dragAt(a, { x: 0, y: 80 }, LIN);
  assert.equal(v, 60, 'up 20 of 200 px is a tenth of the range');
  assert.equal(CORE.reanchorDrag(a, { value: v, x: 0, y: 80, fine: false }), a,
    'the same anchor while Shift stays as it was');
  a = CORE.reanchorDrag(a, { value: v, x: 0, y: 80, fine: true });
  assert.equal(CORE.dragAt(a, { x: 0, y: 80 }, LIN), 60, 'pressing Shift moves nothing');
  v = CORE.dragAt(a, { x: 0, y: 60 }, LIN);
  assert.equal(v, 61, 'fine from where Shift was pressed: up 20 px is 1 %, not back to 51');
  a = CORE.reanchorDrag(a, { value: v, x: 0, y: 60, fine: false });
  assert.equal(CORE.dragAt(a, { x: 0, y: 60 }, LIN), 61, 'releasing Shift moves nothing');
  assert.equal(CORE.dragAt(a, { x: 0, y: 40 }, LIN), 71, 'coarse again from there');
  // A fine value, then coarse: the coarse grid never moves the value against the hand.
  const f = CORE.dragAnchor(50.3, { x: 0, y: 0 });
  assert.ok(CORE.dragAt(f, { x: 0, y: -0.2 }, LIN) >= 50.3, 'up never lowers it');
  assert.ok(CORE.dragAt(f, { x: 0, y: 0.2 }, LIN) <= 50.3, 'down never raises it');
  assert.equal(CORE.dragAt(f, { x: 0, y: -1 }, LIN), 51);
  assert.throws(() => CORE.dragAt(a, { x: 0, y: 0 }, LIN, { pixelsPerRange: 0 }),
    /pixelsPerRange/);
});

test('drag: a sweep with Shift pressed and released moves with the hand, never back', () => {
  for (const p of [LIN, LOG, SMOOTH, TIME]) {
    let value = defaultValue(p);
    let fine = false;
    let a = CORE.dragAnchor(value, { x: 0, y: 0 }, { fine });
    for (let i = 1; i <= 120; i++) {
      const y = -i * 0.75;
      if (i % 7 === 0) {
        fine = !fine;
        a = CORE.reanchorDrag(a, { value, x: 0, y, fine });
      }
      const next = CORE.dragAt(a, { x: 0, y }, p);
      const step = toNorm(next, p) - toNorm(value, p);
      assert.ok(step >= -1e-12, `${p.id ?? p.key} event ${i}: moved back by ${step}`);
      assert.ok(step <= 0.75 / DRAG_PX_PER_RANGE + 0.02, `${p.id ?? p.key} ${i}: jumped ${step}`);
      value = next;
    }
  }
});

test('drag: a horizontal fader follows x, right is more, and ignores y', () => {
  const ppr = pixelsPerRangeFor('fader', 2);
  const a = CORE.dragAnchor(50, { x: 10, y: 5 }, { orientation: 'horizontal',
    kind: 'fader' });
  near(CORE.dragAt(a, { x: 10 + ppr / 4, y: 30 }, LIN, { pixelsPerRange: ppr }), 75);
  near(CORE.dragAt(a, { x: 10 - ppr / 4, y: -30 }, LIN, { pixelsPerRange: ppr }), 25);
  assert.equal(CORE.dragAt(a, { x: 10, y: 99 }, LIN, { pixelsPerRange: ppr }), 50);
  const b = CORE.reanchorDrag(a, { value: 50, x: 10, y: 5, fine: true });
  assert.equal(b.orientation, 'horizontal', 'a re-anchor keeps the orientation');
  assert.throws(() => CORE.dragAnchor(50, { x: 0, y: 0 }, { orientation: 'diagonal' }),
    /orientation/);
});

test('gestureOf: a held arrow run is one gesture, from its first keydown to its keyup', () => {
  assert.equal(CORE.GESTURE_IDLE_MS, 400);
  let r = CORE.gestureOf(kd('ArrowUp', 0), null, { value: 50 });
  assert.equal(r.begin.kind, 'keys');
  assert.equal(r.begin.from, 50, 'the value at the start, for an undo entry or Escape');
  assert.equal(r.end, null);
  assert.equal(r.cancel, false);
  let g = r.gesture;
  assert.equal(g, r.begin);
  assert.ok(Object.isFrozen(g));
  let begins = 1;
  let endsN = 0;
  for (let t = 30; t < 3000; t += 30) {
    r = CORE.gestureOf(kd('ArrowUp', t, true), g, { value: 50 + t / 30 });
    begins += r.begin ? 1 : 0;
    endsN += r.end ? 1 : 0;
    g = r.gesture;
  }
  assert.deepEqual([begins, endsN], [1, 0], 'a long hold is still one gesture');
  assert.equal(g.from, 50);
  assert.equal(CORE.gestureOf(ku('Shift', 3000), g).gesture, g, 'another key\'s keyup');
  r = CORE.gestureOf(ku('ArrowUp', 3000), g);
  assert.equal(r.end.from, 50);
  assert.equal(r.end.kind, 'keys');
  assert.deepEqual([r.begin, r.gesture, r.cancel], [null, null, false]);
  for (const k of ['PageUp', 'PageDown', 'Home', 'End', 'ArrowLeft']) {
    assert.equal(CORE.gestureOf(kd(k, 0), null, { value: 1 }).begin.key, k, `${k} runs too`);
  }
  const other = CORE.gestureOf(kd('ArrowDown', 10), g, { value: 60 });
  assert.equal(other.end, g, 'another arrow ends the run');
  assert.equal(other.begin.from, 60, 'and begins its own');
  for (const k of ['Enter', 'Delete', 'a', ' ']) {
    assert.deepEqual(CORE.gestureOf(kd(k, 0), null, { value: 1 }),
      { begin: null, end: null, cancel: false, gesture: null }, `${k} is no gesture`);
  }
  assert.equal(CORE.gestureOf(kd('ArrowUp', 0, false), null, { value: 1 }).begin.kind, 'keys');
  assert.equal(CORE.gestureOf({ type: 'blur', timeStamp: 1 }, g).end, g,
    'a lost focus ends a run whose keyup will never come');
});

test('gestureOf: a wheel burst is one gesture until 400 ms pass without a notch', () => {
  let r = CORE.gestureOf(wh(0), null, { value: 50 });
  assert.equal(r.begin.kind, 'wheel');
  let g = r.gesture;
  for (let t = 100; t <= 2000; t += 390) {
    r = CORE.gestureOf(wh(t), g, { value: 70 });
    assert.deepEqual([r.begin, r.end], [null, null], `${t}: still the burst`);
    g = r.gesture;
  }
  assert.equal(g.from, 50);
  assert.equal(CORE.gestureOf({ type: 'idle', timeStamp: g.at + 399 }, g).gesture, g);
  r = CORE.gestureOf({ type: 'idle', timeStamp: g.at + 400 }, g);
  assert.deepEqual([r.end, r.gesture, r.begin], [g, null, null], 'the host\'s timer ends it');
  r = CORE.gestureOf(wh(g.at + 400), g, { value: 80 });
  assert.equal(r.end, g, 'a notch after the idle ends the old burst');
  assert.equal(r.begin.from, 80, 'and begins a new one');
  r = CORE.gestureOf(kd('ArrowUp', g.at + 10), g, { value: 81 });
  assert.deepEqual([r.end, r.begin.kind], [g, 'keys'], 'a key ends the burst');
  assert.equal(CORE.gestureOf({ type: 'idle', timeStamp: 5 }, null).gesture, null);
});

test('gestureOf: a drag is one gesture from pointerdown to pointerup, owning the control', () => {
  let r = CORE.gestureOf({ type: 'pointerdown', timeStamp: 0 }, null, { value: 20 });
  assert.equal(r.begin.kind, 'drag');
  const g = r.gesture;
  for (const e of [{ type: 'pointermove', timeStamp: 5 }, wh(10), kd('ArrowUp', 20),
    { type: 'idle', timeStamp: 5000 }, { type: 'blur', timeStamp: 5001 }]) {
    r = CORE.gestureOf(e, g, { value: 33 });
    assert.deepEqual([r.begin, r.end], [null, null], `${e.type} inside a drag`);
    assert.equal(r.gesture.kind, 'drag');
    assert.equal(r.gesture.from, 20);
  }
  for (const type of ['pointerup', 'pointercancel']) {
    r = CORE.gestureOf({ type, timeStamp: 6000 }, g);
    assert.deepEqual([r.end, r.gesture, r.cancel], [g, null, false], type);
  }
  const live = CORE.gestureOf(wh(0), null, { value: 1 }).gesture;
  r = CORE.gestureOf({ type: 'pointerdown', timeStamp: 50 }, live, { value: 2 });
  assert.deepEqual([r.end, r.begin.kind, r.begin.from], [live, 'drag', 2]);
});

test('Escape cancels a gesture: the value captured at its start comes back', () => {
  const host = (events, start) => {
    let g = null;
    let value = start;
    const undo = [];
    // As a host does: the gesture first (it captures the value before the change), then the
    // change the event makes (`v`), then the undo entry when a gesture ends.
    for (const [e, v] of events) {
      const r = CORE.gestureOf(e, g, { value });
      if (r.end && r.cancel) value = CORE.cancelGesture(r.end);
      else if (r.end) undo.push([r.end.from, value]);
      if (v !== undefined) value = v;
      g = r.gesture;
    }
    return { value, undo };
  };
  const esc = (t) => kd('Escape', t);
  assert.deepEqual(host([[{ type: 'pointerdown', timeStamp: 0 }], [{ type: 'pointermove',
    timeStamp: 5 }, 80], [esc(9)]], 50), { value: 50, undo: [] }, 'a drag');
  assert.deepEqual(host([[wh(0), 51], [wh(50), 52], [esc(60)]], 50), { value: 50, undo: [] },
    'a wheel burst');
  assert.deepEqual(host([[kd('ArrowUp', 0), 51], [kd('ArrowUp', 30, true), 52], [esc(40)]], 50),
    { value: 50, undo: [] }, 'a held arrow');
  const r = CORE.gestureOf(esc(0), null, { value: 7 });
  assert.deepEqual(r, { begin: null, end: null, cancel: false, gesture: null },
    'no gesture: Escape stays the page\'s');
  assert.equal(CORE.cancelGesture(null), null);
  const g = CORE.gestureOf(wh(0), null, { value: 3 }).gesture;
  assert.equal(CORE.cancelGesture(g), 3);
  assert.equal(CORE.gestureOf(esc(1), g).cancel, true);
  // One undo entry per gesture: a drag, a burst, a held run, a page key.
  const all = host([[{ type: 'pointerdown', timeStamp: 0 }], [{ type: 'pointermove',
    timeStamp: 1 }, 60], [{ type: 'pointerup', timeStamp: 2 }], [wh(10), 61], [wh(20), 62],
  [{ type: 'idle', timeStamp: 420 }], [kd('ArrowUp', 500), 63], [kd('ArrowUp', 530, true), 64],
  [ku('ArrowUp', 560)], [kd('PageUp', 600), 74], [ku('PageUp', 610)]], 50);
  assert.deepEqual(all.undo, [[50, 60], [60, 62], [62, 64], [64, 74]]);
});

test('wheel: a notch is 1 % of the (norm) range, Shift 0.1 %, keeping the carried rest', () => {
  assert.equal(CORE.WHEEL_STEP, 0.01);
  const TINY = { ...LIN, step: 0.001 };
  for (const p of [TINY, SMOOTH, FLOAT, LOG, TIME_LOG, TIME]) {
    const v0 = fromNorm(0.5, p);
    for (const [fine, want] of [[false, 0.01], [true, 0.001]]) {
      // A stepped log range's grid is its step (S7), so a notch lands within one grid unit.
      const unit = p.scale === 'log' && p.step
        ? toNorm(v0 + p.step / (fine ? 10 : 1), p) - toNorm(v0, p) : 0;
      const eps = Math.max(want / 20, unit);
      const up = wheelValue(v0, -WHEEL_NOTCH_PX, p, { fine }).value;
      near(toNorm(up, p) - toNorm(v0, p), want, eps);
      const down = wheelValue(v0, WHEEL_NOTCH_PX, p, { fine }).value;
      near(toNorm(v0, p) - toNorm(down, p), want, eps);
      const half = wheelValue(v0, -WHEEL_NOTCH_PX / 2, p, { fine });
      assert.equal(half.value, v0, 'half a notch moves nothing yet');
      const whole = wheelValue(half.value, -WHEEL_NOTCH_PX / 2, p, { fine, rest: half.rest });
      assert.equal(whole.value, up, 'two halves are one notch');
    }
  }
});

test('fader: the cap is 28 × 14 with three grip lines, its edge in control.edge', () => {
  assert.deepEqual({ ...CORE.FADER_CAP }, { w: 28, h: 14 });
  assert.ok(Object.isFrozen(CORE.FADER_CAP));
  const t = TOKENS.control;
  for (const [state, edge] of [[{}, t.edge], [{ dragging: true }, t.pointer]]) {
    const svg = controlSvg({ kind: 'fader', value: 70, param: LIN, tokens: TOKENS, state });
    const cap = part(svg, 'data-cap');
    assert.deepEqual([numOf(cap, 'width'), numOf(cap, 'height')], [28, 14]);
    assert.equal(attrOf(cap, 'stroke'), edge);
    const [cx, cy] = [numOf(cap, 'x') + 14, numOf(cap, 'y') + 7];
    const grips = [...svg.matchAll(/<line data-grip="[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.equal(grips.length, 3);
    for (const g of grips) {
      assert.equal(numOf(g, 'y1'), numOf(g, 'y2'), 'across the travel');
      assert.ok(Math.abs(numOf(g, 'y1') - cy) < 7 && numOf(g, 'x1') >= cx - 14
        && numOf(g, 'x2') <= cx + 14, 'inside the cap');
    }
    const centre = grips.find((g) => numOf(g, 'y1') === cy);
    assert.ok(centre, 'one grip on the value');
    assert.equal(attrOf(centre, 'stroke'), t.pointer);
    for (const g of grips.filter((x) => x !== centre)) assert.equal(attrOf(g, 'stroke'), t.edge);
  }
  const off = controlSvg({ kind: 'fader', value: 70, param: LIN, tokens: TOKENS,
    state: { disabled: true } });
  assert.match(off, new RegExp(`<line data-grip="centre"[^>]*stroke="${
    t.disabled.replace(/[()]/g, '\\$&')}"`));
});

test('fader: a horizontal orientation is the same fader turned, more to the right', () => {
  const at = (value, orientation, extra = {}) => controlSvg({ kind: 'fader', value,
    param: LIN, tokens: TOKENS, orientation, ...extra });
  const inner = (svg) => /<g pointer-events="none"[^>]*>(.*)<\/g><\/g>$/.exec(svg)[1];
  assert.equal(at(70, 'vertical'), at(70, undefined), 'vertical is the default');
  assert.deepEqual(CORE.controlBox('fader'), CONTROL_BOX.fader);
  const box = CORE.controlBox('fader', 'horizontal');
  assert.deepEqual({ ...box }, { x: CONTROL_BOX.fader.y, y: CONTROL_BOX.fader.x,
    width: CONTROL_BOX.fader.height, height: CONTROL_BOX.fader.width });
  assert.ok(Object.isFrozen(box));
  for (const zoom of [0.5, 1, 2]) {
    for (const state of [{}, { focus: true }, { dragging: true, focus: true }]) {
      const h = at(70, 'horizontal', { zoom, state, applied: 10 });
      assert.match(h, /<g pointer-events="none" transform="rotate\(90\)">/);
      assert.equal(inner(h), inner(at(70, 'vertical', { zoom, state, applied: 10 })),
        'the same parts');
      const [x, y, w, hh] = hitOf(h);
      assert.deepEqual([w, hh], [Math.max(HIT_PX / zoom, box.width),
        Math.max(HIT_PX / zoom, box.height)]);
      assert.deepEqual([x, y], [-w / 2, -hh / 2]);
    }
  }
  // rotate(90) takes (x, y) to (-y, x): the cap at the top (max) lands on the right.
  const capAlong = (v) => {
    const c = part(at(v, 'horizontal'), 'data-cap');
    return -(numOf(c, 'y') + numOf(c, 'height') / 2);
  };
  near(capAlong(100), FADER_TRAVEL / 2, 0.01);
  near(capAlong(0), -FADER_TRAVEL / 2, 0.01);
  assert.throws(() => at(70, 'diagonal'), /orientation/);
  for (const kind of ['knob', 'switch']) {
    assert.throws(() => controlSvg({ kind, value: kind === 'switch' ? 'hi' : 1,
      param: paramOf(kind), tokens: TOKENS, orientation: 'horizontal' }), /orientation/);
    assert.throws(() => CORE.controlBox(kind, 'horizontal'), /orientation/);
  }
});

test('fader: a press on the cap grabs it where it is; on the slot, a page toward the press', () => {
  for (const orientation of ['vertical', 'horizontal']) {
    // A point along the travel, `d` graph units toward more, `c` across it.
    const pt = (d, c = 0) => (orientation === 'vertical' ? { x: c, y: -d } : { x: d, y: c });
    const press = (value, d, c, param = LIN) => CORE.faderPress({ value, param,
      point: pt(d, c), orientation });
    const cap = (v) => FADER_TRAVEL * toNorm(v, LIN) - FADER_TRAVEL / 2;
    for (const v of [0, 50, 70, 100]) {
      for (const [d, c] of [[0, 0], [6.9, 0], [-6.9, 13], [3, -20]]) {
        assert.deepEqual(press(v, cap(v) + d, c), { grab: true, value: v },
          `${orientation} v ${v}: on the cap (${d}, ${c})`);
      }
    }
    assert.deepEqual(press(50, cap(50) + 20, 0), { grab: false, value: 60 }, 'a page up');
    assert.deepEqual(press(50, cap(50) - 7.5, 5), { grab: false, value: 40 }, 'a page down');
    assert.deepEqual(press(100, 31, 0), { grab: true, value: 100 });
    assert.deepEqual(press(95, 40, 0), { grab: false, value: 100 }, 'held at the end');
    assert.deepEqual(press(true, 30, 0, BOOL), { grab: true, value: true });
    assert.deepEqual(press(false, 30, 0, BOOL), { grab: false, value: true }, 'one option');
    // The grab is relative: the anchor at the press, and the value moves only with the hand.
    const ppr = pixelsPerRangeFor('fader', 1);
    const a = CORE.dragAnchor(70, pt(cap(70) + 5, 4), { orientation, kind: 'fader' });
    assert.equal(CORE.dragAt(a, pt(cap(70) + 5, 4), LIN, { pixelsPerRange: ppr }), 70,
      'grabbed off centre, it does not jump to the pointer');
    near(CORE.dragAt(a, pt(cap(70) + 5 + 6.4, 4), LIN, { pixelsPerRange: ppr }), 80, 1e-9);
  }
  assert.throws(() => CORE.faderPress({ value: 1, param: LIN, point: { x: NaN, y: 0 } }),
    /point/);
});

// Slice S moved the feel into the neutral models (src/js/ui/controls/): feel.js re-exports them,
// so its importers keep their names; ui-controls-model.test.mjs proves they are the same functions.
test('feel.js is a pure re-export: no DOM, no listener, only the two models imported', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/feel.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /addEventListener|document\.|window\.|getComputedStyle|setTimeout/);
  assert.deepEqual([...src.matchAll(/\bfrom '([^']+)'/g)].map((m) => m[1]),
    ['../controls/knob-model.js', '../controls/slider-model.js']);
  assert.deepEqual(intensityLiterals(src), []);
  assert.deepEqual(colourLiterals(src), []);
  const knob = readFileSync(new URL('../../src/js/ui/synth/knob.js', import.meta.url), 'utf8');
  assert.doesNotMatch(knob, /from '\.\/feel\.js'/, 'one way: knob.js never imports feel.js');
});

// ---------------------------------------------------------------- feel, review of S3
test('gestureOf: an idle tick or a notch without a time is refused, never an endless burst', () => {
  const g = CORE.gestureOf(wh(0), null, { value: 50 }).gesture;
  for (const e of [{ type: 'idle' }, { type: 'idle', timeStamp: NaN }, { type: 'wheel' }]) {
    assert.throws(() => CORE.gestureOf(e, g, { value: 50 }), /timeStamp/, JSON.stringify(e));
  }
  assert.throws(() => CORE.gestureOf({ type: 'wheel' }, null, { value: 50 }), /timeStamp/);
  assert.equal(CORE.gestureOf({ type: 'idle', timeStamp: 400 }, g).end, g);
});

test('gestureOf: a gesture begins only from a value, so Escape never restores undefined', () => {
  for (const value of [undefined, null, NaN, Infinity, {}, '']) {
    for (const e of [{ type: 'pointerdown', timeStamp: 0 }, wh(0), kd('ArrowUp', 0)]) {
      assert.throws(() => CORE.gestureOf(e, null, { value }), /value/,
        `${e.type} from ${String(value)}`);
    }
  }
  assert.throws(() => CORE.gestureOf(wh(0), null), /value/, 'no options at all');
  assert.equal(CORE.gestureOf(wh(0), null, { value: 'sine' }).begin.from, 'sine', 'an enum');
  assert.equal(CORE.gestureOf(wh(0), null, { value: false }).begin.from, false, 'a boolean');
  assert.equal(CORE.gestureOf(wh(0), null, { value: 0 }).begin.from, 0);
});

test('gestureOf: a press inside a live drag ends it and begins another (a lost pointerup)', () => {
  const g = CORE.gestureOf({ type: 'pointerdown', timeStamp: 0 }, null, { value: 20 }).gesture;
  const r = CORE.gestureOf({ type: 'pointerdown', timeStamp: 900 }, g, { value: 35 });
  assert.equal(r.end, g, 'the old drag is one entry of its own');
  assert.deepEqual([r.begin.kind, r.begin.from, r.gesture, r.cancel], ['drag', 35, r.begin,
    false], 'the new drag starts from the value now, not the first press');
  const lost = CORE.gestureOf({ type: 'lostpointercapture', timeStamp: 5 }, g);
  assert.deepEqual([lost.end, lost.gesture, lost.cancel], [g, null, false],
    'a lost capture ends the drag as pointercancel does');
  assert.deepEqual(CORE.gestureOf({ type: 'lostpointercapture', timeStamp: 6 }, null),
    { begin: null, end: null, cancel: false, gesture: null }, 'after pointerup: nothing');
});

test('gestureOf: a fresh press of the same key after a lost keyup is a new gesture', () => {
  const g = CORE.gestureOf(kd('ArrowUp', 0), null, { value: 50 }).gesture;
  const r = CORE.gestureOf(kd('ArrowUp', 5000, false), g, { value: 58 });
  assert.equal(r.end, g, 'the old run ends');
  assert.deepEqual([r.begin.kind, r.begin.key, r.begin.from], ['keys', 'ArrowUp', 58]);
  const held = CORE.gestureOf(kd('ArrowUp', 30, true), g, { value: 51 });
  assert.deepEqual([held.begin, held.end, held.gesture.from], [null, null, 50], 'a repeat');
});

test('dragAnchor: a horizontal drag is a fader\'s alone; the anchor knows its kind', () => {
  for (const kind of ['knob', 'switch']) {
    assert.throws(() => CORE.dragAnchor(50, { x: 0, y: 0 }, { kind, orientation: 'horizontal' }),
      /orientation/, kind);
    assert.equal(CORE.dragAnchor(50, { x: 0, y: 0 }, { kind }).kind, kind);
  }
  assert.throws(() => CORE.dragAnchor(50, { x: 0, y: 0 }, { orientation: 'horizontal' }),
    /orientation/, 'the kind defaults to a knob, so a turned drag names its fader');
  assert.throws(() => CORE.dragAnchor(50, { x: 0, y: 0 }, { kind: 'slider' }), /kind/);
  const a = CORE.dragAnchor(50, { x: 0, y: 0 }, { kind: 'fader', orientation: 'horizontal' });
  const b = CORE.reanchorDrag(a, { value: 50, x: 0, y: 0, fine: true });
  assert.deepEqual([b.kind, b.orientation], ['fader', 'horizontal'], 'a re-anchor keeps both');
});

test('wheel: on every registry range a notch moves at least 1 % (Shift 0.1 %)', () => {
  const short = [];
  for (const { where, p } of REGISTRY_NUMBERS) {
    const identifier = p.type === 'integer' && (p.max - p.min) / (p.step || 1) > 1e4;
    if (identifier) continue;
    for (const fine of [false, true]) {
      const floor = CORE.WHEEL_STEP / (fine ? 10 : 1);
      for (let i = 1; i < 40; i++) {
        const v0 = quantize(fromNorm(i / 40, p), p, { fine });
        for (const [dy, dir] of [[-WHEEL_NOTCH_PX, 1], [WHEEL_NOTCH_PX, -1]]) {
          const v = wheelValue(v0, dy, p, { fine }).value;
          const moved = (toNorm(v, p) - toNorm(v0, p)) * dir;
          const atEnd = toNorm(v, p) === (dir > 0 ? 1 : 0);
          if (!atEnd && moved < floor - 1e-9) short.push(`${where} ${fine ? 'fine' : ''} ${v0}`);
        }
      }
    }
  }
  assert.deepEqual(short.slice(0, 8), [], `${short.length} notches under the floor`);
});

// F013 S10 review: a hit rounded to 0.01 can fall under 44 screen px (86.27 at zoom 0.51 is
// 43.9977 px), so every side is rounded up to the next 0.02 graph units, at every zoom.
test('every hit holds 44 screen px at every zoom 0.25 to 2.5 (step 0.01), rounded up', () => {
  const cases = [['knob'], ['fader', 'vertical'], ['fader', 'horizontal'], ['switch'],
    ['fader', 'vertical', 128], ['fader', 'horizontal', 128], ['fader', 'vertical', 100.5]];
  for (const [kind, orientation = 'vertical', travel] of cases) {
    const box = CORE.controlBox(kind, orientation, travel === undefined ? {} : { travel });
    for (let i = 25; i <= 250; i++) {
      const zoom = i / 100;
      const at = `${kind} ${orientation} ${travel ?? ''} at ${zoom}`;
      const [x, y, w, h] = hitOf(draw(kind, { zoom, orientation, travel }));
      assert.ok(w * zoom >= HIT_PX - 1e-9 && h * zoom >= HIT_PX - 1e-9,
        `${at}: ${w * zoom} x ${h * zoom} screen px`);
      for (const [side, least] of [[w, Math.max(HIT_PX / zoom, box.width)],
        [h, Math.max(HIT_PX / zoom, box.height)]]) {
        assert.ok(side >= least - 1e-9 && side < least + 0.02 + 1e-9, `${at}: ${side} ~ ${least}`);
        assert.equal(Math.round(side * 50) / 50, side, `${at}: on the 0.02 grid`);
      }
      assert.deepEqual([x, y], [-w / 2, -h / 2], `${at}: centred`);
    }
  }
});

test('fader: an optional travel (default FADER_TRAVEL, unchanged) sizes its box, cap and drag',
  () => {
    assert.equal(CORE.controlBox('fader'), CONTROL_BOX.fader, 'the default is the constant');
    assert.equal(CORE.controlBox('fader', 'vertical', { travel: FADER_TRAVEL }),
      CONTROL_BOX.fader);
    assert.equal(CORE.controlBox('fader', 'horizontal', {}),
      CORE.controlBox('fader', 'horizontal'));
    const b = CORE.controlBox('fader', 'vertical', { travel: 128 });
    assert.deepEqual({ ...b }, { x: -22, y: -74, width: 44, height: 148 });
    assert.ok(Object.isFrozen(b));
    assert.deepEqual({ ...CORE.controlBox('fader', 'horizontal', { travel: 128 }) },
      { x: -74, y: -22, width: 148, height: 44 }, 'turned');
    for (const travel of [0, -5, 10, Number.NaN, Infinity, '128']) {
      assert.throws(() => CORE.controlBox('fader', 'vertical', { travel }), RangeError,
        `travel ${travel}`);
    }
    assert.throws(() => CORE.controlBox('knob', 'vertical', { travel: 128 }), /travel/);
    assert.equal(draw('fader', { travel: FADER_TRAVEL }), draw('fader'), 'default unchanged');
    assert.throws(() => draw('knob', { travel: 128 }), /travel/);
    const capAt = (v, travel, orientation = 'vertical') => {
      const c = part(controlSvg({ kind: 'fader', value: v, param: LIN, tokens: TOKENS, travel,
        orientation }), 'data-cap');
      return numOf(c, 'y') + numOf(c, 'height') / 2;
    };
    for (const travel of [64, 100.5, 128, 144]) {
      near(capAt(LIN.max, travel), -travel / 2, 0.005);
      near(capAt(LIN.min, travel), travel / 2, 0.005);
      near(capAt(70, travel), travel / 2 - travel * 0.7, 0.005);
      // The horizontal fader is these parts turned (the orientation test above).
      for (const orientation of ['vertical']) {
        for (const state of [{}, { focus: true }, { dragging: true }]) {
          const svg = controlSvg({ kind: 'fader', value: 70, applied: 10, param: LIN,
            tokens: TOKENS, travel, orientation, state });
          const [x0, y0, x1, y1] = drawingBox(svg);
          const bx = CORE.controlBox('fader', 'vertical', { travel });
          assert.ok(x0 >= bx.x - 1e-9 && y0 >= bx.y - 1e-9 && x1 <= bx.x + bx.width + 1e-9
            && y1 <= bx.y + bx.height + 1e-9, `travel ${travel} ${orientation}: inside the box`);
        }
      }
    }
    assert.equal(pixelsPerRangeFor('fader', 2), FADER_TRAVEL * 2, 'default unchanged');
    assert.equal(pixelsPerRangeFor('fader', 2, undefined, { travel: 128 }), 256);
    // F013 S10 round 2: a travel on a knob or a switch is refused by both, as controlBox does.
    for (const kind of ['knob', 'switch']) {
      const param = kind === 'switch' ? BOOL : undefined;
      assert.throws(() => CORE.controlBox(kind, 'vertical', { travel: 128 }),
        new RegExp(`travel: a ${kind} has none`), `controlBox ${kind}`);
      assert.throws(() => pixelsPerRangeFor(kind, 2, param, { travel: 128 }),
        new RegExp(`travel: a ${kind} has none`), `pixelsPerRangeFor ${kind}`);
      assert.ok(pixelsPerRangeFor(kind, 2, param) > 0, `${kind} without a travel`);
    }
    // A press reads the same travel: on the cap at 70 % of 128, and a page toward the slot.
    const press = (point, travel) => CORE.faderPress({ value: 70, param: LIN, point, travel });
    assert.deepEqual(press({ x: 0, y: -(128 * 0.7 - 64) }, 128), { grab: true, value: 70 });
    assert.deepEqual(press({ x: 0, y: -(64 * 0.7 - 32) }, 128), { grab: false, value: 60 });
    assert.deepEqual(press({ x: 0, y: -(64 * 0.7 - 32) }), { grab: true, value: 70 },
      'the default travel unchanged');
  });
