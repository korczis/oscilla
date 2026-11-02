// The shared synth-theme layer's control core (src/js/ui/synth/knob.js; the control API agreed
// 2026-11-02): value mapping (lin and log), quantize and fine, vertical drag, wheel, the pure
// knobKey (the control adds no key listener: K153 counts them), the value text and ARIA
// attributes, and controlSvg, the knob, fader and switch drawn only from tokens with a hit area
// of 44 screen px at any zoom. The value is a setpoint: nothing tweens.
//   node --test tests/unit/ui-synth-knob.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampValue, toNorm, fromNorm, quantize, defaultValue, dragValue, wheelValue, knobKey,
  formatValue, ariaAttrs, controlSvg, HIT_PX,
} from '../../src/js/ui/synth/knob.js';
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

test('clampValue holds a value to [min, max]', () => {
  assert.equal(clampValue(-3, LIN), 0);
  assert.equal(clampValue(42.5, LIN), 42.5);
  assert.equal(clampValue(101, LIN), 100);
  assert.equal(clampValue(1, LOG), 20);
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

test('wheel: a notch up is one step up, a notch down one step down, fine a tenth', () => {
  assert.equal(wheelValue(50, -100, LIN), 51);
  assert.equal(wheelValue(50, 100, LIN), 49);
  assert.equal(wheelValue(50, -3, LIN), 51, 'a notch is a notch, whatever the delta');
  assert.equal(wheelValue(50, 100, LIN, { fine: true }), 49.9);
  assert.equal(wheelValue(50, 0, LIN), 50);
  assert.equal(wheelValue(100, -100, LIN), 100);
  assert.ok(wheelValue(1000, -100, LOG) > 1000);
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

test('knobKey: a log range moves in norm space and never stalls on its step', () => {
  const up = knobKey(key('ArrowUp'), { value: 1000, param: LOG });
  near(toNorm(up, LOG) - toNorm(1000, LOG), 0.01, 1e-3);
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

test('knobKey: Delete and Backspace return the default, as a double-click does', () => {
  assert.equal(knobKey(key('Delete'), { value: 12, param: LIN }), 50);
  assert.equal(knobKey(key('Backspace'), { value: 12, param: LIN }), 50);
  assert.equal(knobKey(key('Delete'), { value: 12, param: LIN }), defaultValue(LIN));
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

test('the hit area is 44 screen px at any zoom: 88, 44 and 22 graph units', () => {
  assert.equal(HIT_PX, 44);
  for (const kind of KINDS) {
    for (const [zoom, size] of [[0.5, 88], [1, 44], [2, 22]]) {
      const [x, y, w, h] = hitOf(draw(kind, { zoom }));
      assert.deepEqual([w, h], [size, size], `${kind} at ${zoom}`);
      assert.deepEqual([x, y], [-size / 2, -size / 2], `${kind} at ${zoom}: centred`);
    }
    assert.deepEqual(hitOf(draw(kind)).slice(2), [44, 44], `${kind}: zoom 1 by default`);
  }
  for (const zoom of [0, -1, NaN, Infinity]) assert.throws(() => draw('knob', { zoom }), /zoom/);
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
});
