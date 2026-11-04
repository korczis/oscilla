// The control family's one knob model and one slider model (src/js/ui/controls/; oscilla-21's
// G021-G023 in chore/plan-unified-controls, slice S): knob-model.js holds the parameter shape,
// the value mapping, keys, wheel, drag, typed entry, the value as text and ARIA, and the
// gestures (once feel.js's); slider-model.js holds a fader's travel, its press and a lever's
// positions on top of it, never a copy. Both are neutral: no hardware vocabulary (the lock v4
// HW_VOCAB, comments included), no DOM, no markup, no paint. src/js/ui/synth/knob.js is their
// hardware skin and re-exports them, so every importer keeps its names (the same functions,
// not copies); feel.js is a thin re-export. Each module carries its ui-family marker exactly
// once, and no other module declares a second model. A knob takes a size (lg, md, sm: 80, 64
// and 48 px where md is the panel's 64 px knob), md by default and byte-identical to no size,
// its hit at least 44 screen px at every zoom from ZOOM_MIN to ZOOM_MAX.
//   node --test tests/unit/ui-controls-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/js/ui/studio/graph-geometry.js';
import { TOKENS, intensityLiterals, colourLiterals } from './ui-synth-fixture.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MODEL = 'src/js/ui/controls/knob-model.js';
const SLIDER = 'src/js/ui/controls/slider-model.js';
const SKIN = 'src/js/ui/synth/knob.js';
const FEEL = 'src/js/ui/synth/feel.js';
const load = (p) => import(new URL(`../../${p}`, import.meta.url).href).catch(() => ({}));
const M = await load(MODEL);
const S = await load(SLIDER);
const K = await load(SKIN);
const F = await load(FEEL);

/** The lock v4's hardware vocabulary, read from its test so the two never drift apart. */
const HW_VOCAB = (() => {
  const v4 = read('tests/unit/visual-identity-lock-v4.test.mjs');
  const at = v4.indexOf('export const HW_VOCAB = new RegExp(');
  const block = v4.slice(at, v4.indexOf(", 'i');", at));
  const parts = [...block.matchAll(/String\.raw`([^`]*)`/g)].map((m) => m[1]);
  assert.ok(parts.length >= 2, 'the v4 HW_VOCAB is read');
  return new RegExp(parts.join(''), 'gi');
})();

const KNOB_MODEL_NAMES = ['clampValue', 'toNorm', 'fromNorm', 'quantize', 'defaultValue',
  'stepOption', 'parseValue', 'formatValue', 'ariaAttrs', 'dragValue', 'pixelsPerRangeFor',
  'wheelValue', 'knobKey', 'gestureOf', 'dragAnchor', 'reanchorDrag', 'dragAt', 'cancelGesture'];
const KNOB_MODEL_CONSTANTS = { DRAG_PX_PER_RANGE: 200, FINE_DIV: 10, HIT_PX: 44, SWEEP_DEG: 270,
  LOG_STEPS: 200, WHEEL_NOTCH_PX: 100, WHEEL_LINE_PX: 100 / 3, WHEEL_STEP: 0.01,
  GESTURE_IDLE_MS: 400 };

test('knob-model.js holds the model, the input and the gestures', () => {
  for (const name of KNOB_MODEL_NAMES) {
    assert.equal(typeof M[name], 'function', `knob-model exports ${name}`);
  }
  for (const [name, value] of Object.entries(KNOB_MODEL_CONSTANTS)) {
    assert.equal(M[name], value, `knob-model exports ${name} = ${value}`);
  }
  assert.equal(M.pixelsPerRangeFor('knob', 2), 200, 'a knob turns: 200 px at any zoom');
  assert.throws(() => M.pixelsPerRangeFor('fader', 1), /slider-model/,
    'a travel kind is the slider model\'s, named by the refusal');
});

test('slider-model.js holds the fader\'s travel and press on top of the knob model', () => {
  assert.equal(S.FADER_TRAVEL, 64, 'today\'s travel (slice B moves it)');
  assert.deepEqual(S.FADER_CAP, { w: 28, h: 14 });
  assert.equal(typeof S.faderPress, 'function');
  assert.equal(typeof S.pixelsPerRangeFor, 'function');
  assert.equal(S.pixelsPerRangeFor('fader', 2), 128);
  assert.equal(S.pixelsPerRangeFor('knob', 2), M.pixelsPerRangeFor('knob', 2));
  assert.throws(() => S.travelOf('fader', 3), /travel/);
  const src = read(SLIDER).replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...src.matchAll(/\bfrom '([^']+)'/g)].map((m) => m[1]), ['./knob-model.js'],
    'the slider model imports only the knob model');
  for (const fn of ['clampValue', 'toNorm', 'quantize', 'knobKey', 'rangeOf', 'choicesOf']) {
    assert.doesNotMatch(src, new RegExp(`function ${fn}\\b`), `no copy of ${fn}`);
  }
});

test('the skin and feel.js re-export the models: the same functions, every name kept', () => {
  for (const name of [...KNOB_MODEL_NAMES.filter((n) => !/gesture|drag(Anchor|At)|reanchor/i
    .test(n) && n !== 'cancelGesture' && n !== 'pixelsPerRangeFor'),
  ...Object.keys(KNOB_MODEL_CONSTANTS).filter((n) => n !== 'GESTURE_IDLE_MS')]) {
    assert.ok(name in K, `knob.js exports ${name}`);
    assert.equal(K[name], M[name], `knob.js's ${name} is knob-model's`);
  }
  for (const name of ['FADER_TRAVEL', 'FADER_CAP', 'pixelsPerRangeFor']) {
    assert.equal(K[name], S[name], `knob.js's ${name} is slider-model's`);
  }
  for (const name of ['gestureOf', 'dragAnchor', 'reanchorDrag', 'dragAt', 'cancelGesture',
    'GESTURE_IDLE_MS']) {
    assert.equal(F[name], M[name], `feel.js's ${name} is knob-model's`);
  }
  assert.equal(F.faderPress, S.faderPress, 'feel.js\'s faderPress is slider-model\'s');
  const feel = read(FEEL).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(feel, /\bfunction\b|=>/, 'feel.js is a thin re-export: no code of its own');
});

test('the models are neutral: no hardware vocabulary, no DOM, no markup, no paint', () => {
  for (const p of [MODEL, SLIDER]) {
    const raw = read(p);
    const hw = [...raw.matchAll(HW_VOCAB)].map((m) => m[0]);
    assert.deepEqual(hw, [], `${p}: hardware vocabulary, comments included`);
    const code = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /addEventListener|document\.|window\.|getComputedStyle|setTimeout/,
      `${p}: DOM or a timer`);
    assert.doesNotMatch(code, /<\/?[a-z][\w-]*[\s>/]/i, `${p}: markup`);
    assert.doesNotMatch(code, /\bclass=|\bstyle=|\bdata-|\bosc-|\bvar\(--/,
      `${p}: a hook or paint`);
    assert.deepEqual(intensityLiterals(raw), [], `${p}: intensity`);
    assert.deepEqual(colourLiterals(code), [], `${p}: colour`);
    assert.doesNotMatch(code, /from '\.\.\/synth\//, `${p}: nothing from the hardware skin`);
  }
});

/** Every `// ui-family: <name>` marker in a source, in order. */
const markers = (src) => [...src.matchAll(/^\s*\/\/ ui-family: (.+?)\s*$/gm)].map((m) => m[1]);
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
});

test('every ui-family marker is present once per module, and there is one model each', () => {
  assert.equal(read(MODEL).split('\n')[0], '// ui-family: knob model');
  assert.equal(read(SLIDER).split('\n')[0], '// ui-family: slider model');
  assert.equal(read(SKIN).split('\n')[0], '// ui-family: knob skin hardware');
  assert.deepEqual(markers(read(SKIN)), ['knob skin hardware', 'slider skin hardware']);
  const skin = read(SKIN);
  const marker = skin.indexOf('// ui-family: slider skin hardware');
  assert.ok(marker > 0 && marker < skin.indexOf('function faderShapes'),
    'the slider skin marker heads the fader drawing');
  const census = new Map();
  for (const p of walk('src/js').filter((x) => x.endsWith('.js'))) {
    const found = markers(read(p));
    assert.equal(new Set(found).size, found.length, `${p}: a marker twice`);
    for (const name of found) census.set(name, [...(census.get(name) || []), p]);
  }
  assert.deepEqual(census.get('knob model'), [MODEL], 'one knob model');
  assert.deepEqual(census.get('slider model'), [SLIDER], 'one slider model');
});

// Slice A condensed five JSDoc blocks to fit knob.js under the 40 000-byte cap; the model has the
// room, so each is whole again (its words as they were before 6ba63c68).
test('the JSDoc slice A condensed is whole again in the model', () => {
  const src = read(MODEL);
  const doc = (fn) => {
    const at = src.indexOf(`export function ${fn}(`);
    assert.ok(at > 0, `${fn} is defined in the model`);
    const open = src.lastIndexOf('/**', at);
    return src.slice(open, at).replace(/\s*\n\s*\*\s?/g, ' ');
  };
  assert.match(doc('wheelValue'), /so a 3-line detent is one[^]*Arrow keys are exempt/);
  assert.match(doc('knobKey'), /Enter \{ edit: true \} on a number \(typed entry, parseValue\)/);
  assert.match(doc('parseValue'), /\(440, 2\.5 kHz, 1k, 250 ms, \+12 st, -6 dB\)/);
  assert.match(doc('formatValue'), /so a fine move shows \(50\.1 %\)/);
  assert.match(doc('ariaAttrs'), /true beyond the range \(only the position clamps\)/);
});

// ---------------------------------------------------------------- a knob takes a size

const LIN = Object.freeze({ id: 'level', label: 'Level', unit: '%', min: 0, max: 100, step: 1,
  scale: 'lin', default: 50 });
const knob = (opts = {}) => K.controlSvg({ kind: 'knob', value: 70, applied: 30, param: LIN,
  tokens: TOKENS, ...opts });
const hitOf = (svg) => {
  const r = /<rect data-hit="" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/
    .exec(svg);
  return { width: Number(r[3]), height: Number(r[4]) };
};
const PANEL_ZOOM = 64 / 44;
const ZOOMS = [ZOOM_MIN, 0.5, 0.75, 1, PANEL_ZOOM, 2, ZOOM_MAX];

test('size: lg, md and sm are 80, 64 and 48 px across where md is the panel\'s 64 px knob', () => {
  assert.deepEqual(Object.keys(K.KNOB_SIZES), ['lg', 'md', 'sm']);
  const md = K.controlBox('knob');
  assert.equal(K.controlBox('knob', 'vertical', { size: 'md' }), md, 'md is today\'s box');
  for (const [size, px] of [['lg', 80], ['md', 64], ['sm', 48]]) {
    const b = K.controlBox('knob', 'vertical', { size });
    assert.equal(K.KNOB_SIZES[size].px, px);
    assert.equal(b.width * PANEL_ZOOM, px, `${size}: ${px} px at the panel's scale`);
    assert.equal(b.width, b.height);
    assert.equal(b.x, -b.width / 2);
    assert.ok(Object.isFrozen(b));
  }
});

test('size: md is the default, and an md knob is byte-identical to one without a size', () => {
  for (const state of [{}, { focus: true }, { dragging: true }, { hover: true },
    { disabled: true }]) {
    for (const zoom of ZOOMS) {
      assert.equal(knob({ state, zoom, size: 'md' }), knob({ state, zoom }),
        `${JSON.stringify(state)} at ${zoom}`);
    }
  }
  assert.doesNotMatch(knob(), /data-size|scale\(/, 'md draws as today');
  assert.match(knob({ size: 'sm' }), /<g data-control="knob" data-size="sm">/);
  assert.match(knob({ size: 'lg' }), /<g pointer-events="none" transform="scale\(1\.25\)">/);
});

test('size: every tier\'s hit is at least 44 screen px at every zoom and holds its drawing', () => {
  for (const size of ['lg', 'md', 'sm']) {
    const box = K.controlBox('knob', 'vertical', { size });
    for (const zoom of ZOOMS) {
      const hit = hitOf(knob({ size, zoom }));
      assert.ok(hit.width * zoom >= 44 - 1e-9 && hit.height * zoom >= 44 - 1e-9,
        `${size} at ${zoom}: ${hit.width * zoom} px`);
      assert.ok(hit.width >= box.width && hit.height >= box.height, `${size} at ${zoom}: box`);
    }
  }
  // The outermost part (the focus ring's outer edge, r 22 in md units) stays inside the box.
  for (const size of ['lg', 'sm']) {
    const { scale } = K.KNOB_SIZES[size];
    const half = K.controlBox('knob', 'vertical', { size }).width / 2;
    assert.ok((K.KNOB.focus + K.KNOB.focusW / 2) * scale <= half + 1e-9, size);
  }
});

test('size: scale ticks per tier, and drawn by the size on screen, not the zoom alone', () => {
  const ticks = (svg) => {
    const m = /<path d="([^"]+)" data-ticks=""/.exec(svg);
    return m ? m[1].split('M ').length - 1 : 0;
  };
  assert.deepEqual(Object.fromEntries(['lg', 'md', 'sm'].map((s) => [s, K.KNOB_SIZES[s].ticks])),
    { lg: 21, md: 11, sm: 5 });
  for (const size of ['lg', 'md', 'sm']) {
    const { scale, ticks: n } = K.KNOB_SIZES[size];
    for (const zoom of ZOOMS) {
      const shown = zoom * scale >= K.KNOB.tickZoom - 1e-9;
      assert.equal(ticks(knob({ size, zoom })), shown ? n : 0, `${size} at ${zoom}`);
    }
  }
  assert.equal(ticks(knob({ size: 'lg', zoom: 1 })), 21, 'an 80 px knob has its scale at zoom 1');
  assert.equal(ticks(knob({ size: 'sm', zoom: PANEL_ZOOM })), 0, 'a 48 px knob has none');
});

test('size: label sizes per tier, never under 12 px', () => {
  assert.deepEqual(Object.fromEntries(['lg', 'md', 'sm'].map((s) => [s,
    [K.KNOB_SIZES[s].labelPx, K.KNOB_SIZES[s].labelClass]])),
  { lg: [14, 'text-sm'], md: [12, 'text-xs'], sm: [12, 'text-xs'] });
  for (const s of Object.values(K.KNOB_SIZES)) assert.ok(s.labelPx >= 12);
});

test('size: a fader or a switch has none, and an unknown size is refused', () => {
  for (const kind of ['fader', 'switch']) {
    const param = kind === 'switch' ? { key: 'on', type: 'boolean', default: false } : LIN;
    assert.throws(() => K.controlBox(kind, 'vertical', { size: 'sm' }),
      new RegExp(`size: a ${kind} has none`));
    assert.throws(() => K.controlSvg({ kind, value: LIN.min, param, tokens: TOKENS, size: 'lg' }),
      /size/);
    assert.equal(K.controlBox(kind, 'vertical', { size: 'md' }), K.controlBox(kind));
  }
  for (const size of ['xl', 'MD', 1, null]) {
    assert.throws(() => K.controlBox('knob', 'vertical', { size }), /size/, String(size));
  }
});

test('size: every registry number draws at every size inside its hit, from tokens only', () => {
  let n = 0;
  for (const def of NODE_REGISTRY.list()) {
    for (const p of Object.values(def.params || {})) {
      if (!(Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min)) continue;
      if (p.type === 'enum' || p.type === 'boolean') continue;
      for (const size of ['lg', 'sm']) {
        const svg = K.controlSvg({ kind: 'knob', value: p.default ?? p.min, param: p,
          tokens: TOKENS, size, zoom: 1 });
        assert.match(svg, new RegExp(`data-size="${size}"`), `${p.key} ${size}: drawn at it`);
        assert.deepEqual(intensityLiterals(svg), [], `${p.key} ${size}`);
        assert.deepEqual(colourLiterals(svg), [], `${p.key} ${size}`);
        n += 1;
      }
    }
  }
  assert.ok(n > 20, `${n} knobs drawn`);
});
