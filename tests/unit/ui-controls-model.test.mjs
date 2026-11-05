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
import { LABEL } from '../../src/js/ui/synth/label.js';
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
  'wheelValue', 'knobKey', 'gestureOf', 'dragAnchor', 'reanchorDrag', 'dragAt', 'dragTo',
  'cancelGesture'];
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
  // The model's own guards, reached by a direct importer (review of S, finding 2): the skin's
  // re-export is the slider model's, which checks the travel and the zoom before it comes here.
  const P = { key: 'level', min: 0, max: 100, step: 1, default: 50 };
  assert.throws(() => M.pixelsPerRangeFor('knob', 1, P, { travel: 10 }),
    /travel: a knob has none/, 'a knob has no travel');
  for (const zoom of [0, -1, NaN, Infinity, '1']) {
    assert.throws(() => M.pixelsPerRangeFor('knob', zoom, P),
      (e) => e instanceof RangeError && /pixelsPerRangeFor: zoom/.test(e.message), String(zoom));
  }
});

test('slider-model.js holds the fader\'s travel and press on top of the knob model', () => {
  assert.equal(S.FADER_TRAVEL, 96, 'slice B\'s travel (FS-06)');
  assert.deepEqual({ ...S.FADER_TRAVELS }, { adsr: 96, mixer: 112, output: 112, vca: 112 },
    'the per-role travel a host asks for (FS-06)');
  assert.equal(S.faderTravel('mixer'), 112);
  assert.deepEqual(S.FADER_CAP, { w: 28, h: 14 });
  assert.equal(typeof S.faderPress, 'function');
  assert.equal(typeof S.pixelsPerRangeFor, 'function');
  assert.equal(S.pixelsPerRangeFor('fader', 2), 192);
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
  for (const name of [...KNOB_MODEL_NAMES.filter((n) => !/gesture|drag(Anchor|At|To)|reanchor/i
    .test(n) && n !== 'cancelGesture' && n !== 'pixelsPerRangeFor'),
  ...Object.keys(KNOB_MODEL_CONSTANTS).filter((n) => n !== 'GESTURE_IDLE_MS')]) {
    assert.ok(name in K, `knob.js exports ${name}`);
    assert.equal(K[name], M[name], `knob.js's ${name} is knob-model's`);
  }
  for (const name of ['FADER_TRAVEL', 'FADER_TRAVELS', 'FADER_CAP', 'faderTravel',
    'pixelsPerRangeFor']) {
    assert.equal(K[name], S[name], `knob.js's ${name} is slider-model's`);
  }
  for (const name of ['gestureOf', 'dragAnchor', 'reanchorDrag', 'dragAt', 'dragTo',
    'cancelGesture', 'GESTURE_IDLE_MS']) {
    assert.equal(F[name], M[name], `feel.js's ${name} is knob-model's`);
  }
  assert.equal(F.faderPress, S.faderPress, 'feel.js\'s faderPress is slider-model\'s');
  const feel = read(FEEL).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(feel, /\bfunction\b|=>/, 'feel.js is a thin re-export: no code of its own');
});

/** A module's code: its source without its block and line comments. */
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** Which of `names` the code binds itself: a const, let, var, function or class of that name. */
const declared = (code, names) => names.filter((n) =>
  new RegExp(`\\b(?:const|let|var|function|class)\\s+${n}\\b`).test(code));

// "The same functions, not copies" (review of S, round 3, finding 1): `===` holds for a copied
// number, and a copy bound as an arrow or a constant passes a `function NAME` grep, so the
// modules on top of a model bind none of its exported names themselves. The one exception is
// the slider model's pixelsPerRangeFor, documented there: it answers every kind and asks the
// knob model's (imported as knobPixelsPerRange) for a knob.
test('the slider model, the skin and feel.js bind none of a model\'s names themselves', () => {
  const knobNames = Object.keys(M);
  const sliderNames = Object.keys(S);
  assert.ok(KNOB_MODEL_NAMES.every((n) => knobNames.includes(n)), 'the knob model\'s names');
  assert.ok(['FADER_TRAVEL', 'faderPress', 'switchPositions'].every((n) => sliderNames.includes(n)),
    'the slider model\'s names');
  assert.deepEqual(declared(codeOf(SLIDER), knobNames), ['pixelsPerRangeFor'],
    `${SLIDER}: a knob model name bound again`);
  for (const p of [SKIN, FEEL]) {
    assert.deepEqual(declared(codeOf(p), [...knobNames, ...sliderNames]), [],
      `${p}: a model's name bound again`);
  }
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

/** The module's header: its leading run of '//' lines, where G021 wants its markers. */
const headerOf = (src) => src.split('\n').filter((l, i, all) => all.slice(0, i + 1)
  .every((x) => /^\/\//.test(x))).join('\n');
const SWITCH = 'src/js/ui/synth/switch.js';

// G021's convention: `// ui-family: <id> model` or `// ui-family: <id> skin <name>` at the top of
// every implementing module (review of S, finding 4): knob.js draws the knob, the fader and the
// lever switch, switch.js the switch's every style, and the lever's positions are the switch
// family's model (G023 makes switch a family of its own), so each says so in its header.
test('every ui-family marker heads its module once, and there is one model each', () => {
  const want = { [MODEL]: ['knob model'], [SLIDER]: ['slider model', 'switch model'],
    [SKIN]: ['knob skin hardware', 'slider skin hardware', 'switch skin hardware'],
    [SWITCH]: ['switch skin hardware'] };
  for (const [p, names] of Object.entries(want)) {
    assert.deepEqual(markers(headerOf(read(p))), names, `${p}: its header's markers`);
  }
  assert.equal(read(MODEL).split('\n')[0], '// ui-family: knob model');
  assert.equal(read(SLIDER).split('\n')[0], '// ui-family: slider model');
  assert.equal(read(SKIN).split('\n')[0], '// ui-family: knob skin hardware');
  const census = new Map();
  for (const p of walk('src/js').filter((x) => x.endsWith('.js'))) {
    const found = markers(read(p));
    assert.equal(new Set(found).size, found.length, `${p}: a marker twice`);
    assert.deepEqual(found, markers(headerOf(read(p))), `${p}: a marker below its header`);
    for (const name of found) {
      assert.match(name, /^[a-z][\w-]* (model|skin [a-z][\w-]*)$/, `${p}: '${name}'`);
      census.set(name, [...(census.get(name) || []), p]);
    }
  }
  assert.deepEqual(census.get('knob model'), [MODEL], 'one knob model');
  assert.deepEqual(census.get('slider model'), [SLIDER], 'one slider model');
  assert.deepEqual(census.get('switch model'), [SLIDER], 'one switch model');
});

// What a skin still decides that is its family's model's, until its slice merges it (G021's
// baseline takes these over when it lands, and they only shrink): an entry whose code is gone
// fails here, so it is removed with the fix.
const MODEL_DUPLICATES = Object.freeze([
  { slice: 'G023', module: SWITCH, signature: /\bconst MAX_POSITIONS = 12;/,
    what: 'how many positions a switch has (2 to 12, by style) beside the switch model\'s '
      + 'switchPositions (2 to 4, a lever\'s)' },
]);

test('a skin\'s second definition of its model is recorded with the slice that merges it', () => {
  for (const d of MODEL_DUPLICATES) {
    assert.match(d.slice, /^G02[1-6]$/, d.what);
    assert.match(read(d.module), d.signature, `${d.module}: ${d.what} is gone; drop the entry`);
  }
  assert.match(read(SLIDER), /export function switchPositions\(/, 'the switch model counts');
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
/**
 * A knob's hit rect, graph units. Its own width is its size on screen (times the zoom) only
 * while no transform applies to it (review of S, round 3, finding 3): so the hit is the
 * control's first child, the outer group untransformed, and the rect carries none itself.
 */
const hitOf = (svg) => {
  assert.match(svg, /^<g data-control="knob"(?: data-size="(?:lg|sm)")?><rect data-hit=""/,
    'the hit is the first child of the untransformed outer group');
  assert.doesNotMatch(/^<g[^>]*><rect data-hit=""[^>]*>/.exec(svg)[0], /transform/,
    'the hit is not transformed');
  const r = /<rect data-hit="" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/
    .exec(svg);
  return { width: Number(r[3]), height: Number(r[4]) };
};
const PANEL_ZOOM = 64 / 44;
const ZOOMS = [ZOOM_MIN, 0.5, 0.75, 1, PANEL_ZOOM, 2, ZOOM_MAX];

const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];
/**
 * How far one stroked or filled shape reaches from the origin, its stroke included: a circle's
 * centre distance plus r and half its stroke; a straight segment's end corners as its cap draws
 * them (butt, SVG's default: the end ± half the width across it; round or square: the end plus
 * half the width, or the width); a join where two segments meet at most the miter limit's 4
 * half-widths past its vertex; an arc ('A rx ...') is centred on the origin, as every arc the
 * skin draws is, so it reaches rx plus half the width.
 */
function reachOf(tag, kind) {
  const paint = attr(tag, 'stroke');
  const w = paint === undefined || paint === 'none' ? 0 : Number(attr(tag, 'stroke-width') ?? 1);
  if (kind === 'circle') {
    return Math.hypot(Number(attr(tag, 'cx')), Number(attr(tag, 'cy'))) + Number(attr(tag, 'r'))
      + w / 2;
  }
  const cap = attr(tag, 'stroke-linecap') ?? 'butt';
  const ends = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [nx, ny] = [(a[1] - b[1]) / len * (w / 2), (b[0] - a[0]) / len * (w / 2)];
    return [a, b].map(([x, y]) => (cap === 'butt'
      ? Math.max(Math.hypot(x + nx, y + ny), Math.hypot(x - nx, y - ny))
      : Math.hypot(x, y) + (cap === 'round' ? w / 2 : w)));
  };
  if (kind === 'line') {
    return Math.max(...ends([Number(attr(tag, 'x1')), Number(attr(tag, 'y1'))],
      [Number(attr(tag, 'x2')), Number(attr(tag, 'y2'))]));
  }
  const t = attr(tag, 'd').match(/[MLAZ]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g);
  let r = 0;
  let pts = [];
  const flush = (closed) => {
    for (let i = 1; i < pts.length; i++) r = Math.max(r, ...ends(pts[i - 1], pts[i]));
    const joins = closed ? pts : pts.slice(1, -1);
    for (const [x, y] of joins) r = Math.max(r, Math.hypot(x, y) + 2 * w);
    pts = [];
  };
  for (let i = 0; i < t.length;) {
    const c = t[i++];
    if (c === 'M' || c === 'L') {
      if (c === 'M') flush(false);
      pts.push([Number(t[i]), Number(t[i + 1])]);
      i += 2;
    } else if (c === 'A') {
      r = Math.max(r, Number(t[i]) + w / 2);
      flush(false);
      pts.push([Number(t[i + 5]), Number(t[i + 6])]);
      i += 7;
    } else {
      assert.equal(c, 'Z', `a path command the parser knows: ${c}`);
      flush(true);
    }
  }
  flush(false);
  return r;
}

/**
 * The knob's drawing as emitted (the pointer-events="none" group): its scale, read from the
 * group's transform (1 when it has none), and the farthest any of its circles, lines and paths
 * reaches from the centre, stroke included, in the group's own units.
 */
function drawingOf(svg) {
  const g = /<g pointer-events="none"(?: transform="scale\(([^)]+)\)")?>/.exec(svg);
  assert.ok(g, 'the drawing group is emitted');
  assert.doesNotMatch(svg.slice(g.index + g[0].length), /transform=/, 'no other transform');
  const body = svg.slice(g.index + g[0].length);
  let extent = 0;
  for (const [tag, kind] of body.matchAll(/<(circle|line|path)\b[^>]*>/g)) {
    const r = reachOf(tag, kind);
    assert.ok(Number.isFinite(r), `${tag}: its extent is read`);
    extent = Math.max(extent, r);
  }
  return { scale: g[1] === undefined ? 1 : Number(g[1]), extent };
}

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
  assert.match(knob(), /<g pointer-events="none">/, 'md: the drawing is not transformed');
  for (const size of ['lg', 'sm']) {
    const svg = knob({ size });
    const { scale } = K.KNOB_SIZES[size];
    assert.match(svg, new RegExp(`<g data-control="knob" data-size="${size}">`));
    // Each size draws at its own scale (review of S, finding 1): not md's, not another's.
    assert.ok(svg.includes(`<g pointer-events="none" transform="scale(${scale})">`),
      `${size}: the drawing group carries scale(${scale})`);
    assert.equal(drawingOf(svg).scale, scale, `${size} drawn at its scale`);
  }
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
  // All that is drawn stays inside the box, read from the markup (review of S, finding 1): the
  // emitted scale times the farthest reach of every part (the ticks, the focus ring and its
  // stroke, the cast shadow and its offset), in every state that draws the most. TOL: a scale
  // tick's butt corner sits hypot(22, 0.5) - 22 = 0.006 past r 22 and each coordinate is rounded
  // to 0.01 (up to 0.007 on the radius), so a part may pass the box by under 0.02 of the
  // drawing's units (0.07 px at lg and ZOOM_MAX).
  const TOL = 0.02;
  const BIPOLAR = Object.freeze({ ...LIN, id: 'pan', min: -100, max: 100, default: 0 });
  for (const size of ['lg', 'md', 'sm']) {
    const half = K.controlBox('knob', 'vertical', { size }).width / 2;
    for (const param of [LIN, BIPOLAR]) {
      for (const state of [{ focus: true, dragging: true, hover: true }, { focus: true }]) {
        for (const zoom of [1, 2, ZOOM_MAX]) {
          const svg = K.controlSvg({ kind: 'knob', value: 70, applied: -30, param, state, zoom,
            size, tokens: TOKENS });
          const { scale, extent } = drawingOf(svg);
          const at = `${size} ${param.id} ${JSON.stringify(state)} at ${zoom}`;
          assert.ok(extent >= K.KNOB.focus + K.KNOB.focusW / 2 - 1e-9, `${at}: the ring is read`);
          assert.ok(scale * extent <= half + scale * TOL, `${at}: ${scale} × ${extent} > ${half}`);
        }
      }
    }
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
  // The tier is data for the host that mounts a sized knob: nothing renders a label at it yet
  // (review of S, round 3, finding 2). So each class is the Tailwind size of its px, md's is
  // the one label.js's LABEL prints on every panel knob today, and the JSDoc says who renders.
  const TEXT_PX = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16 };
  for (const [size, s] of Object.entries(K.KNOB_SIZES)) {
    assert.equal(TEXT_PX[s.labelClass], s.labelPx, `${size}: ${s.labelClass} is ${s.labelPx} px`);
  }
  assert.ok(LABEL.split(' ').includes(K.KNOB_SIZES.md.labelClass), 'md: label.js\'s LABEL');
  const skin = read(SKIN);
  const head = skin.slice(0, skin.indexOf('export const KNOB_SIZES'));
  assert.match(head.slice(head.lastIndexOf('/**')).replace(/\s*\n\s*\*\s?/g, ' '),
    /`labelPx` and `labelClass` are data for the host that mounts a sized knob/,
    'the JSDoc says the host renders the tier');
});

test('size: md is any kind\'s, lg and sm a knob\'s alone, and an unknown size is refused', () => {
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

// ---------------------------------------------------------------- review of S, round 4

const BIPOLAR_P = Object.freeze({ ...LIN, id: 'pan', min: -100, max: 100, default: 0 });
const SIZE_STATES = Object.freeze([{}, { hover: true }, { focus: true }, { dragging: true },
  { disabled: true }, { disabled: true, hover: true }, { disabled: true, focus: true },
  { hover: true, focus: true, dragging: true }]);
/** The drawing group's content (inside `<g pointer-events="none" ...>`), its scale ticks cut. */
const innerOf = (svg) => {
  const g = /<g pointer-events="none"(?: transform="scale\([^)]+\)")?>/.exec(svg);
  assert.ok(g, 'the drawing group is emitted');
  return svg.slice(g.index + g[0].length).replace(/<path d="[^"]*" data-ticks=""[^>]*>/, '');
};

// Finding 1: lg and sm are md's drawing scaled, in every state (a disabled sm drawing a value
// arc, a live pointer, or losing its hover cue was not caught), unipolar and bipolar, at zooms
// on both sides of the scale's threshold. Only the ticks differ (their count is the tier's).
test('size: lg and sm draw md\'s markup, scale ticks aside, in every state and at every zoom',
  () => {
    let n = 0;
    for (const param of [LIN, BIPOLAR_P]) {
      for (const state of SIZE_STATES) {
        for (const zoom of [ZOOM_MIN, 1, PANEL_ZOOM, 2, ZOOM_MAX]) {
          for (const [value, applied] of [[70, 30], [-40, 0], [0, undefined]]) {
            const at = (size) => K.controlSvg({ kind: 'knob', value, applied, param, state, zoom,
              size, tokens: TOKENS });
            const md = innerOf(at('md'));
            for (const size of ['lg', 'sm']) {
              assert.equal(innerOf(at(size)), md, `${size} ${param.id} ${JSON.stringify(state)} `
                + `${value}/${applied} at ${zoom}`);
              n += 1;
            }
          }
        }
      }
    }
    assert.ok(n >= 400, `${n} drawings compared`);
    // The comparison sees what it is meant to: the disabled drawing is the quiet one, and the
    // hover overlay is shown on an enabled hover alone.
    const svg = (state, size) => knob({ state, size, zoom: 2 });
    for (const size of ['lg', 'md', 'sm']) {
      assert.doesNotMatch(svg({ disabled: true }, size), /data-ring=""|data-applied=""/, size);
      assert.match(svg({ hover: true }, size), /data-hover="" fill="none" stroke="[^"]+"\/>/);
      assert.match(svg({ hover: true, disabled: true }, size), /data-hover=""[^>]*hidden/, size);
    }
  });

// Finding 2: each tier's ticks run from -135° to 135° in equal steps (lg every 13.5°, md 27°,
// sm 67.5°), read from the emitted segments, not only counted.
test('size: each tier\'s scale ticks sit at -135 + i·270/(n-1) degrees', () => {
  for (const size of ['lg', 'md', 'sm']) {
    const { ticks: n } = K.KNOB_SIZES[size];
    const d = /<path d="([^"]+)" data-ticks=""/.exec(knob({ size, zoom: ZOOM_MAX }))[1];
    const segs = [...d.matchAll(/M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)/g)]
      .map((m) => m.slice(1).map(Number));
    assert.equal(segs.length, n, `${size}: ${n} ticks`);
    segs.forEach(([x0, y0, x1, y1], i) => {
      const want = -135 + (i * 270) / (n - 1);
      for (const [x, y, r] of [[x0, y0, K.KNOB.tickIn], [x1, y1, K.KNOB.tickOut]]) {
        const deg = (Math.atan2(x, -y) * 180) / Math.PI;
        assert.ok(Math.abs(deg - want) < 0.05, `${size} tick ${i}: ${deg}°, not ${want}°`);
        assert.ok(Math.abs(Math.hypot(x, y) - r) < 0.02, `${size} tick ${i}: r ${r}`);
      }
    });
  }
});

// Finding 6: the exported sizes cannot be changed, the table or any tier.
test('size: KNOB_SIZES and each of its tiers are frozen', () => {
  assert.ok(Object.isFrozen(K.KNOB_SIZES), 'the table');
  for (const [size, s] of Object.entries(K.KNOB_SIZES)) assert.ok(Object.isFrozen(s), size);
});

// Finding 4: the least travel is the cap's own length, and it is accepted; under it, or not a
// finite number, is refused.
test('travel: FADER_CAP.h is the least travel, and under it or not finite is refused', () => {
  assert.equal(S.travelOf('fader', S.FADER_CAP.h), 14, 'a 14-unit fader');
  assert.equal(S.pixelsPerRangeFor('fader', 2, LIN, { travel: 14 }), 28);
  assert.equal(K.controlBox('fader', 'vertical', { travel: 14 }).height, 34);
  for (const t of [13.99, 0, -14, NaN, Infinity, -Infinity, '20', null]) {
    assert.throws(() => S.travelOf('fader', t), (e) => e instanceof RangeError
      && /travel: at least 14 graph units/.test(e.message), String(t));
  }
});

// Finding 5: a knob and a switch have no travel, so a travel equal to a fader's default is
// refused as any other is (it answered 200 and 12 where the knob model refused it).
test('travel: a knob or a switch given any travel is refused, FADER_TRAVEL too', () => {
  const ON = { key: 'on', type: 'boolean', default: false };
  for (const travel of [S.FADER_TRAVEL, 10, 65]) {
    assert.throws(() => S.pixelsPerRangeFor('knob', 1, LIN, { travel }),
      /travel: a knob has none/, `knob ${travel}`);
    assert.throws(() => M.pixelsPerRangeFor('knob', 1, LIN, { travel }),
      /travel: a knob has none/, `the knob model, ${travel}`);
    assert.throws(() => S.pixelsPerRangeFor('switch', 1, ON, { travel }),
      /travel: a switch has none/, `switch ${travel}`);
    assert.throws(() => K.controlBox('knob', 'vertical', { travel }), /travel: a knob has none/);
    assert.throws(() => K.controlSvg({ kind: 'switch', value: false, param: ON, tokens: TOKENS,
      travel }), /travel: a switch has none/);
  }
  assert.equal(S.travelOf('fader', S.FADER_TRAVEL), S.FADER_TRAVEL, 'a fader\'s own default');
  assert.equal(S.travelOf('knob', undefined), S.FADER_TRAVEL, 'no travel given: the default');
});

/**
 * The slider model and the skin loaded over a probed knob model (or slider model): a copy of
 * the three modules in a temporary directory, the model's `name` wrapped by `wrap` (a function
 * of the original, as source). What a probe changes in the model's answer must show in theirs:
 * a rule they copied instead of asking the model would not follow it.
 */
async function probed(name, wrap, { into = MODEL } = {}) {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'osc-probe-'));
  const at = (p) => join(dir, p.replace('src/js/ui/', ''));
  mkdirSync(join(dir, 'controls'));
  mkdirSync(join(dir, 'synth'));
  const abs = new URL('../../src/js/', import.meta.url).href;
  for (const p of [MODEL, SLIDER, SKIN]) {
    let src = read(p).replace(/'\.\.\/\.\.\/(core|studio)\//g, `'${abs}$1/`);
    if (p === into) {
      const fn = new RegExp(`export function ${name}\\(`);
      const cn = new RegExp(`export const ${name} =`);
      assert.ok(fn.test(src) || cn.test(src), `${p} exports ${name}`);
      src = src.replace(fn, `function ${name}__model(`).replace(cn, `const ${name}__model =`)
        + `\nexport const ${name} = (${wrap})(${name}__model);\n`;
    }
    writeFileSync(at(p), src);
  }
  const url = (p) => new URL(`file://${at(p)}`).href;
  return { S: await import(url(SLIDER)), K: await import(url(SKIN)), dir };
}
const PROBE = Object.freeze({ ...LIN, id: 'probe', probe: true });
/** A probe that prefixes the model's refusal with PROBE, so a refusal of a copy shows. */
const tagged = () => `(f) => (...a) => { try { return f(...a); } catch (e) {
  throw new Error('PROBE ' + e.message); } }`;

// Finding 3, by behaviour: a copy of the model's rule that binds none of its names (an inlined
// kind list, a clamp from param.min and param.max, a bipolar test of its own) passes a name
// check, so each rule the slider model and the skin take from the knob model is probed there,
// and their answers must follow it.
test('the slider model and the skin answer through the knob model: a probed rule shows',
  async () => {
  const { rmSync } = await import('node:fs');
  const ON = { key: 'on', type: 'boolean', default: false, probe: true };
  const cases = [
    ['kindOf', tagged(), ({ S: s }) => assert.throws(() => s.pixelsPerRangeFor('lever', 1),
      /^Error: PROBE pixelsPerRangeFor: kind/)],
    ['zoomOf', tagged(), ({ S: s, K: k }) => {
      assert.throws(() => s.pixelsPerRangeFor('fader', 0), /PROBE/);
      assert.throws(() => k.controlSvg({ kind: 'knob', value: 1, param: LIN, tokens: TOKENS,
        zoom: 0 }), /PROBE/);
    }],
    ['orientationOf', tagged(), ({ S: s, K: k }) => {
      assert.throws(() => s.faderPress({ value: 50, param: LIN, point: { x: 0, y: 0 },
        orientation: 'diagonal' }), /PROBE/);
      assert.throws(() => k.controlBox('fader', 'diagonal'), /PROBE/);
    }],
    ['pointOf', tagged(), ({ S: s }) => assert.throws(() => s.faderPress({ value: 50,
      param: LIN, point: null }), /PROBE/)],
    ['clampValue', '(f) => (v, p) => (p && p.probe && typeof v === "number" ? f(v, p) + 1 '
      + ': f(v, p))', ({ S: s, K: k }) => {
      assert.deepEqual(s.faderPress({ value: 50, param: PROBE, point: { x: 0, y: 0 } }),
        { grab: true, value: 51 }, 'the press holds the model\'s value');
      assert.equal(k.clampValue(50, PROBE), 51);
    }],
    ['toNorm', '(f) => (v, p) => (p && p.probe ? 0 : f(v, p))', ({ S: s, K: k }) => {
      assert.equal(s.faderPress({ value: 50, param: PROBE, point: { x: 0, y: 32 } }).grab, true,
        'the cap sits where the model\'s position puts it');
      const ptr = /<line data-pointer="" x1="([^"]+)" y1="([^"]+)"/.exec(k.controlSvg({
        kind: 'knob', value: 50, param: PROBE, tokens: TOKENS }));
      assert.ok(Number(ptr[1]) < 0 && Number(ptr[2]) > 0, 'the pointer at the start, -135°');
    }],
    ['knobKey', '(f) => (e, o) => (o && o.param && o.param.probe ? 42 : f(e, o))',
      ({ S: s }) => assert.deepEqual(s.faderPress({ value: 50, param: PROBE,
        point: { x: 0, y: 30 } }), { grab: false, value: 42 }, 'a page is the model\'s key')],
    ['choicesOf', '(f) => (p) => (p && p.probe ? [[0, "a"], [1, "b"], [2, "c"]] : f(p))',
      ({ S: s }) => assert.equal(s.switchPositions(ON), 3)],
    ['idOf', '(f) => (p) => (p && p.probe ? "PROBE-ID" : f(p))', ({ S: s }) => assert.throws(
      () => s.switchPositions({ ...PROBE, type: 'number' }), /^Error: PROBE-ID: a switch/)],
    ['pixelsPerRangeFor', '(f) => (k, z, p, o) => (p && p.probe ? 777 : f(k, z, p, o))',
      ({ S: s }) => assert.equal(s.pixelsPerRangeFor('knob', 1, PROBE), 777)],
    ['originOf', '(f) => (p) => (p && p.probe ? p.min : f(p))', ({ K: k }) => {
      const pan = { ...BIPOLAR_P, probe: true };
      assert.match(k.controlSvg({ kind: 'knob', value: 50, param: BIPOLAR_P, tokens: TOKENS }),
        /data-detent=""/, 'unprobed: a range across zero has its detent');
      for (const kind of ['knob', 'fader']) {
        const svg = k.controlSvg({ kind, value: 50, param: pan, tokens: TOKENS });
        assert.doesNotMatch(svg, /data-detent=""/, `${kind}: the model's origin, not its own`);
      }
      const FILL = new RegExp('<rect x="-1" y="([^"]+)" width="2" height="([^"]+)" rx="1" '
        + 'fill="[^"]+" stroke="none"');
      const fill = (p) => FILL.exec(k.controlSvg({ kind: 'fader', value: 50, param: p,
        tokens: TOKENS })).slice(1);
      assert.notDeepEqual(fill(pan), fill(BIPOLAR_P), 'the fader fills from the model\'s origin');
    }],
    ['travelOf', tagged(), ({ K: k }) => assert.throws(() => k.controlBox('fader', 'vertical',
      { travel: 3 }), /PROBE travel/), { into: SLIDER }],
    ['switchPositions', '(f) => (p) => (p && p.probe ? 3 : f(p))', ({ K: k }) => assert.equal(
      [...k.controlSvg({ kind: 'switch', value: false, param: ON, tokens: TOKENS })
        .matchAll(/data-detent=""/g)].length, 3, 'the lever\'s detents are the model\'s count'),
    { into: SLIDER }],
  ];
  for (const [name, wrap, check, opts] of cases) {
    const p = await probed(name, wrap, opts);
    try {
      check(p);
    } catch (e) {
      e.message = `${name} probed: ${e.message}`;
      throw e;
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  }
});

// The same rules by reading (finding 3): a module over a model reads no descriptor field of a
// parameter (its range, step, scale, options or default are the model's to interpret) and
// lists no kinds of its own.
test('the slider model and the skin read no descriptor field and list no kinds', () => {
  const FIELD = /\b(?:p|param|def|descriptor)\??\.(?:min|max|step|scale|options|default|type)\b/g;
  const DESTRUCTURE = /\{[^}]*\b(?:min|max|step|scale|options)\b[^}]*\}\s*=\s*(?:p|param)\b/g;
  const KIND_LIST = /\[\s*'(?:knob|fader|switch)'\s*,\s*'(?:knob|fader|switch)'/g;
  for (const p of [SLIDER, SKIN]) {
    const code = codeOf(p);
    assert.deepEqual([...code.matchAll(FIELD)].map((m) => m[0]), [], `${p}: a field read`);
    assert.deepEqual([...code.matchAll(DESTRUCTURE)].map((m) => m[0]), [], `${p}: destructured`);
    assert.deepEqual([...code.matchAll(KIND_LIST)].map((m) => m[0]), [], `${p}: a kind list`);
  }
  assert.equal(typeof M.originOf, 'function', 'the model says where a value is measured from');
  assert.equal(M.originOf(LIN), 0, 'a range from 0: its min');
  assert.equal(M.originOf({ ...LIN, min: 20, max: 80 }), 20, 'from its min');
  assert.equal(M.originOf(BIPOLAR_P), 0, 'across zero: zero');
  assert.equal(M.originOf({ ...LIN, min: -100, max: 0 }), -100, 'up to zero: its min');
  assert.equal(M.originOf({ key: 'on', type: 'boolean' }), null, 'a choice has none');
});
