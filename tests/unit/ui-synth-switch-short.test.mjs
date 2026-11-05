// A choice's short printed legend (src/js/ui/synth/switch.js; dev-53's ask for the XY pad's
// Scale): an enum option's third tuple element ([value, label, short], as freezeParam keeps a
// tuple) is the legend every style measures and draws, while the option's accessible name
// (layout option.name, which the caller's radio announces) stays the full label and a window's
// frame still holds the full name. Checked here: the Scale list, with the domain's shorts
// (origin/feat/xy-scale-short's SCALE_SHORT), lays its 10 options out in 2 columns at zoom 1, each
// cell within half of the narrowest plate (234 px), and in 1 column without them; the drawn text
// is the short and the name the label in the toggle, slide, rotary and window styles, numbered
// legends included; hit boxes stay 44 px and apart at zoom 0.15..3; a short no narrower than its
// label, or not text, is refused; and without a short every drawing is byte-for-byte the one of
// f523746a (tests/unit/fixtures/switch-golden.json, every enum and boolean of the registry).
//   node --test tests/unit/ui-synth-switch-short.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { legendWidth, switchLayout, switchStyle, switchSvg } from '../../src/js/ui/synth/switch.js';
import { HIT_PX } from '../../src/js/ui/synth/knob.js';
import { choiceLayout, choiceSvg } from '../../src/js/synth/view/knob.js';
import { PANEL_TOKENS } from '../../src/js/synth/view/tokens.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { TOKENS } from './ui-synth-fixture.mjs';
import { goldenOf } from './fixtures/switch-golden.mjs';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/switch-golden.json', import.meta.url),
  'utf8'));
const PANEL = Object.fromEntries(Object.entries(PANEL_TOKENS).map(([k, n]) => [k, `var(${n})`]));
/** The narrowest plate a choice is drawn in (synth/view/knob.js CHOICE_MAX_PX). */
const PLATE_PX = 234;
const ZOOMS = [0.15, 0.25, 0.5, 1, 2, 3];

/** The domain's short legends (origin/feat/xy-scale-short 80556c90, core/music.js SCALE_SHORT). */
const SCALE_SHORT = Object.freeze({ minor: 'Nat. minor', 'major-pentatonic': 'Major pent.',
  'minor-pentatonic': 'Minor pent.' });
const LIVE_SCALE = NODE_REGISTRY.get('xy-pad').params.find((p) => p.key === 'mode');
const bare = (p) => ({ ...p, options: p.options.map((o) => [o[0], o[1]]) });
/** The XY pad's Scale as the domain declares it: the registry's own once it carries the shorts,
 *  until then the registry's options with SCALE_SHORT's third elements, as instrument.js adds
 *  them on that branch. */
const SCALE = LIVE_SCALE.options.some((o) => o.length > 2) ? LIVE_SCALE : { ...LIVE_SCALE,
  options: LIVE_SCALE.options.map((o) => (SCALE_SHORT[o[0]] ? [o[0], o[1], SCALE_SHORT[o[0]]]
    : [o[0], o[1]])) };
const SCALE_BARE = bare(SCALE);

const attrOf = (el, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(el) || [])[1];
/** The drawn legends of a switchSvg, by option index, their text unescaped. */
const drawnLegends = (svg) => [...svg.matchAll(/<text data-legend=""[^>]*>([^<]*)<\/text>/g)]
  .map((m) => [Number(attrOf(m[0], 'data-index')), m[1].replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')]);
const overlap = (a, b) => a.x < b.x + b.width - 1e-9 && b.x < a.x + a.width - 1e-9
  && a.y < b.y + b.height - 1e-9 && b.y < a.y + a.height - 1e-9;
const textBox = (lg) => {
  const x = lg.anchor === 'start' ? lg.x : (lg.anchor === 'end' ? lg.x - lg.width
    : lg.x - lg.width / 2);
  return { x, y: lg.y - lg.size / 2, width: lg.width, height: lg.size };
};
const inside = (r, b, eps = 1e-6) => r.x >= b.x - eps && r.y >= b.y - eps
  && r.x + r.width <= b.x + b.width + eps && r.y + r.height <= b.y + b.height + eps;
/** A window grid's columns: the cells of its first row. */
const columns = (L) => L.options.filter((o) => o.hit.y === L.options[0].hit.y).length;
const widestCell = (L) => Math.max(...L.options.map((o) => o.hit.width));

/** One parameter per style, each option with a short legend but the last (which keeps its
 *  label), so a mix of both is drawn. */
const withShorts = (key, labels) => Object.freeze({ key, label: key, type: 'enum',
  default: 'o0', options: labels.map(([label, short], i) => (short ? [`o${i}`, label, short]
    : [`o${i}`, label])) });
const STYLED = [
  withShorts('toggle', [['Logarithmic', 'Log'], ['Linear']]),
  withShorts('slide', [['Sine wave', 'Sine'], ['Triangle wave', 'Tri'], ['Sawtooth']]),
  withShorts('slide4', [['Lowpass filter', 'LP'], ['Highpass filter', 'HP'],
    ['Bandpass filter', 'BP'], ['Notch']]),
  withShorts('rotary', [['First position', '1st'], ['Second position', '2nd'],
    ['Third position', '3rd'], ['Fourth position', '4th'], ['Fifth']]),
  withShorts('rotary8', Array.from({ length: 8 }, (_, i) => (i < 7 ? [`Algorithm ${i + 1}`,
    `Alg ${i + 1}`] : ['Eight']))),
  SCALE,
];

test('the Scale list, with the domain\'s shorts, lays out in 2 columns at zoom 1; '
  + 'without them in 1', () => {
  assert.equal(switchStyle(SCALE), 'window');
  for (const opts of [{}, { numbers: false }]) {
    const short = switchLayout(SCALE, { zoom: 1, ...opts });
    const full = switchLayout(SCALE_BARE, { zoom: 1, ...opts });
    assert.equal(columns(short), 2, 'with shorts: 2 columns');
    assert.ok(widestCell(short) <= PLATE_PX / 2, `with shorts the widest cell ${widestCell(short)}`
      + ` <= ${PLATE_PX / 2}`);
    assert.equal(columns(full), 1, 'without: 1 column (the behaviour of f523746a)');
    assert.ok(widestCell(full) > PLATE_PX / 2, `without, the widest cell ${widestCell(full)}`);
    // The frame holds the selected option's full name, so it is the same with or without.
    assert.deepEqual(short.window, full.window, 'the window frame is untouched');
    assert.ok(short.window.width >= legendWidth('Minor pentatonic') + 20,
      'the frame holds the longest full name');
    assert.ok(short.box.width <= PLATE_PX, `with shorts the choice fits the plate (${
      short.box.width})`);
  }
  // The panel's choice (dev-53's view) takes the core's layout as it is.
  const L = choiceLayout(SCALE);
  assert.equal(columns(L), 2);
  assert.ok(L.box.width <= PLATE_PX && widestCell(L) <= PLATE_PX / 2);
  assert.equal(columns(choiceLayout(SCALE_BARE)), 1);
});

test('every style draws the short and names the option by its full label', () => {
  for (const p of STYLED) {
    const style = switchStyle(p);
    const dial = style === 'rotary' || style === 'window';
    for (const numberLegends of dial ? [false, true] : [false]) {
      const L = switchLayout(p, { numberLegends, numbers: dial ? true : undefined });
      const nth = (text, i) => (numberLegends ? `${i + 1} · ${text}` : text);
      L.options.forEach((o, i) => {
        const [, label, short] = p.options[i];
        assert.equal(o.label, label, `${p.key} ${i}: label`);
        assert.equal(o.name, nth(label, i), `${p.key} ${i}: the accessible name is the label`);
        assert.equal(o.legend.text, nth(short ?? label, i), `${p.key} ${i}: the legend prints`);
        assert.equal(o.legend.width, legendWidth(o.legend.text, o.legend.size),
          `${p.key} ${i}: measured as printed`);
      });
      for (const value of p.options.map((o) => o[0])) {
        for (const state of [{}, { focus: true }, { hover: true }, { disabled: true }]) {
          const svg = switchSvg({ value, param: p, tokens: TOKENS, state, numberLegends,
            numbers: dial ? true : undefined });
          assert.deepEqual(drawnLegends(svg), L.options.map((o) => [o.index, o.legend.text]),
            `${p.key} at ${value}: the short is drawn`);
          for (const [i, text] of drawnLegends(svg)) {
            if (p.options[i][2]) assert.ok(!text.includes(p.options[i][1]), `${p.key} ${i}`);
          }
          // The drawing names nothing: it is aria-hidden, the caller's radio carries the name.
          assert.match(svg, /^<g data-control="switch"[^>]* aria-hidden="true"/);
          assert.doesNotMatch(svg, /<title|aria-label|\stitle=/, p.key);
        }
      }
    }
  }
  // The panel's window keeps printing the selected option's full name in its frame.
  const svg = choiceSvg({ value: 'minor-pentatonic', param: SCALE, tokens: PANEL });
  assert.match(svg, /<text data-window-text=""[^>]*>Minor pentatonic<\/text>/);
});

test('with shorts, every hit box is 44 px, holds its legend and none overlaps, at zoom '
  + '0.15..3', () => {
  for (const p of STYLED) {
    for (const zoom of ZOOMS) {
      const L = switchLayout(p, { zoom });
      const where = `${p.key} at zoom ${zoom}`;
      for (const o of L.options) {
        assert.ok(o.hit.width * zoom >= HIT_PX - 1e-6 && o.hit.height * zoom >= HIT_PX - 1e-6,
          `${where}: ${o.index}'s hit box is 44 px`);
        if (L.style !== 'toggle') assert.ok(inside(textBox(o.legend), o.hit), `${where}: holds`);
        assert.ok(inside(o.hit, L.box), `${where}: inside the box`);
      }
      L.options.forEach((a, i) => L.options.slice(i + 1).forEach((b) => assert.ok(
        !overlap(a.hit, b.hit), `${where}: ${a.index} and ${b.index} apart`)));
    }
  }
});

test('a short legend no narrower than its label, or not text, is refused', () => {
  const one = (third) => ({ key: 'shape', type: 'enum', default: 'a',
    options: [['a', 'Sine', third], ['b', 'Square']] });
  for (const third of ['Sinewave', 'Sine', 'WWWW']) {
    for (const call of [() => switchLayout(one(third)), () => switchStyle(one(third)),
      () => switchSvg({ value: 'a', param: one(third), tokens: TOKENS })]) {
      assert.throws(call, (e) => e instanceof Error && /shape: option a's short legend "/
        .test(e.message) && /is not narrower than its label "Sine"/.test(e.message), third);
    }
  }
  for (const third of ['', '  ', 3, true, {}]) {
    assert.throws(() => switchLayout(one(third)), (e) => e instanceof TypeError
      && /shape: option a's short legend is non-empty text/.test(e.message), String(third));
  }
  // No short (two elements, or an undefined third) is the label, as before.
  for (const third of [undefined, null]) {
    assert.equal(switchLayout(one(third)).options[0].legend.text, 'Sine');
  }
  assert.equal(switchLayout(one('Sin')).options[0].legend.text, 'Sin');
});

test('without a short, every drawing of every registry enum and boolean is f523746a\'s, '
  + 'byte for byte', () => {
  assert.equal(GOLDEN.recordedAt, 'f523746a');
  const lines = GOLDEN.params.map((e) => {
    const param = Object.freeze({ key: e.key, label: e.label, type: e.type, default: e.default,
      ...(e.options ? { options: e.options } : {}) });
    assert.equal(goldenOf(param), e.sha256, `${e.node}.${e.key}`);
    return `${e.node}.${e.key}:${e.sha256}`;
  });
  assert.equal(createHash('sha256').update(lines.join('\n')).digest('hex'), GOLDEN.all);
  // Every enum and boolean of the registry is recorded, or carries a short (drawn above).
  const recorded = new Set(GOLDEN.params.map((e) => `${e.node}.${e.key}`));
  for (const def of NODE_REGISTRY.list()) {
    for (const p of def.params) {
      if (p.type !== 'enum' && p.type !== 'boolean') continue;
      if (p.type === 'enum' && p.options.some((o) => o.length > 2)) continue;
      if (recorded.has(`${def.type}.${p.key}`)) {
        const e = GOLDEN.params.find((x) => `${x.node}.${x.key}` === `${def.type}.${p.key}`);
        if (JSON.stringify(e.options ?? null) === JSON.stringify(p.options ?? null)) {
          assert.equal(goldenOf(p), e.sha256, `${def.type}.${p.key}, the registry's own`);
        }
      }
    }
  }
});
