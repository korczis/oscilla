// The shared synth-theme layer's switches drawn as hardware (src/js/ui/synth/switch.js; plan F013
// entry 5, slice S5, K058): by position count a toggle lever (2), a slide selector (3-4), a
// detented rotary selector with legends around it at r >= 60 (5-8) and a rotary with a display
// window and a legend grid (9-12). The drawing is aria-hidden and takes no pointer; the caller
// keeps each option a [data-option][data-v][aria-checked] radio button placed over it from
// switchLayout's 44 px hit boxes. Checked here: the geometry inside the layout's box at zoom 1, 2
// and 3; 3:1 for the edges, lever and ticks against surface-2 and surface-3 and 4.5:1 for the
// legends, in both themes, computed from tokens.css; 12 px legends; 44 px hit boxes that never
// overlap for every enum and boolean of NODE_REGISTRY.list(); no literal intensity; the LED
// rule (data-source and data-lit interpolated from the caller), the LED drawn by led.js's ledSvg
// so a toggle's LED is the layer's LED (its bezel, its lens and, lit, its halo);
// controlSvg's switch kept, its refusal of more than four options pointing to switchSvg.
//   node --test tests/unit/ui-synth-switch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  switchSvg, switchLayout, switchOptions, switchStyle, SWITCH_STYLES, LEGEND_PX, legendWidth,
} from '../../src/js/ui/synth/switch.js';
import { CONTROL_BOX, controlSvg, HIT_PX } from '../../src/js/ui/synth/knob.js';
import { ledSvg, ledBox, LED } from '../../src/js/ui/synth/led.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { SYNTH_TOKEN_NAMES } from '../../src/js/ui/synth/tokens.js';
import {
  TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues, intensityLiterals,
  tokenThemes, tokenHex, contrastOf,
} from './ui-synth-fixture.mjs';

const SRC = readFileSync(new URL('../../src/js/ui/synth/switch.js', import.meta.url), 'utf8');

const BOOL = Object.freeze({ key: 'enabled', label: 'Enabled', type: 'boolean', default: true });
const opts = (n, long = false) => Array.from({ length: n }, (_, i) => [`o${i}`,
  long ? `Option number ${i + 1}` : `O${i + 1}`]);
const ENUM = (n, long) => Object.freeze({ key: `e${n}`, label: `E${n}`, type: 'enum',
  options: opts(n, long), default: 'o0' });
const TWO = Object.freeze({ key: 'curve', label: 'Curve', type: 'enum', default: 'log',
  options: [['log', 'Logarithmic'], ['lin', 'Linear']] });
const WAVE = Object.freeze({ key: 'waveform', label: 'Waveform', type: 'enum', default: 'sine',
  options: [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Saw'],
    ['square', 'Square']] });
const SAMPLES = [BOOL, TWO, ENUM(3), WAVE, ENUM(5), ENUM(7, true), ENUM(8), ENUM(9), ENUM(10, true),
  ENUM(12)];
const ZOOMS = [1, 2, 3];
/** The Studio graph's lowest zooms (ZOOM_MIN 0.25 in studio/graph-geometry.js, and below). */
const LOW_ZOOMS = [0.25, 0.15];

const attrOf = (el, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(el) || [])[1];
const n = (el, a) => Number(attrOf(el, a) || 0);
const part = (svg, attr) => (new RegExp(`<\\w+\\b[^>]*\\s${attr}=""[^>]*>`).exec(svg) || [null])[0];
const parts = (svg, attr) => [...svg.matchAll(new RegExp(`<\\w+\\b[^>]*\\s${attr}=""[^>]*>`, 'g'))]
  .map((m) => m[0]);
const draw = (param, extra = {}) => switchSvg({ value: param.default, param, tokens: TOKENS,
  ...extra });
const overlap = (a, b) => a.x < b.x + b.width - 1e-9 && b.x < a.x + a.width - 1e-9
  && a.y < b.y + b.height - 1e-9 && b.y < a.y + a.height - 1e-9;
/** The least distance from the origin (a dial's centre) to a rect. */
const reachOf = (r) => Math.hypot(Math.max(r.x, Math.min(0, r.x + r.width)),
  Math.max(r.y, Math.min(0, r.y + r.height)));
const inside = (r, box, eps = 1e-6) => r.x >= box.x - eps && r.y >= box.y - eps
  && r.x + r.width <= box.x + box.width + eps && r.y + r.height <= box.y + box.height + eps;

/** A legend's text box, from its anchor point and its estimated width. */
const legendBox = (lg) => ({ x: lg.anchor === 'start' ? lg.x : lg.anchor === 'end'
  ? lg.x - lg.width : lg.x - lg.width / 2, y: lg.y - lg.size / 2, width: lg.width,
height: lg.size });
/** The name of the --osc-* token a var() paint refers to. */
const tokenName = (paint) => /^var\((--osc-[\w-]+)\)$/.exec(paint)[1];

/** Every shape's drawn extent, strokes included: [x0, y0, x1, y1] (text: its anchor point). */
function extents(svg) {
  const out = [];
  for (const [el, tag] of svg.matchAll(/<(rect|circle|ellipse|line|path|text)\b[^>]*>/g)) {
    const sw = n(el, 'stroke-width') / 2;
    if (tag === 'rect') {
      out.push([n(el, 'x') - sw, n(el, 'y') - sw, n(el, 'x') + n(el, 'width') + sw,
        n(el, 'y') + n(el, 'height') + sw]);
    } else if (tag === 'circle' || tag === 'ellipse') {
      const rx = tag === 'circle' ? n(el, 'r') : n(el, 'rx');
      const ry = tag === 'circle' ? n(el, 'r') : n(el, 'ry');
      out.push([n(el, 'cx') - rx - sw, n(el, 'cy') - ry - sw, n(el, 'cx') + rx + sw,
        n(el, 'cy') + ry + sw]);
    } else if (tag === 'line') {
      // A round cap reaches sw past an end; a butt end's corners lie within sw of it.
      out.push([Math.min(n(el, 'x1'), n(el, 'x2')) - sw, Math.min(n(el, 'y1'), n(el, 'y2')) - sw,
        Math.max(n(el, 'x1'), n(el, 'x2')) + sw, Math.max(n(el, 'y1'), n(el, 'y2')) + sw]);
    } else if (tag === 'path') {
      const xs = (attrOf(el, 'd').match(/-?[\d.]+/g) || []).map(Number);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        out.push([xs[i] - sw, xs[i + 1] - sw, xs[i] + sw, xs[i + 1] + sw]);
      }
    } else {
      out.push([n(el, 'x'), n(el, 'y'), n(el, 'x'), n(el, 'y')]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the style

test('the style follows the position count: toggle 2, slide 3-4, rotary 5-8, window 9-12', () => {
  assert.deepEqual(Object.keys(SWITCH_STYLES), ['toggle', 'slide', 'rotary', 'window']);
  assert.ok(Object.isFrozen(SWITCH_STYLES));
  assert.equal(switchStyle(BOOL), 'toggle');
  assert.equal(switchStyle(TWO), 'toggle');
  for (const k of [3, 4]) assert.equal(switchStyle(ENUM(k)), 'slide', String(k));
  for (const k of [5, 6, 7, 8]) assert.equal(switchStyle(ENUM(k)), 'rotary', String(k));
  for (const k of [9, 10, 11, 12]) assert.equal(switchStyle(ENUM(k)), 'window', String(k));
  assert.throws(() => switchStyle(ENUM(13)), /at most 12 positions/);
  assert.throws(() => switchStyle(ENUM(1)), /at least two options/);
  assert.throws(() => switchStyle({ key: 'x', type: 'enum', options: [] }), /at least one option/);
  for (const p of [{ key: 'f', min: 0, max: 1 }, null, undefined]) {
    assert.throws(() => switchStyle(p), /enum or a boolean/);
    assert.throws(() => switchSvg({ value: 0, param: p, tokens: TOKENS }), /enum or a boolean/);
  }
  assert.throws(() => switchSvg({ value: true, param: BOOL }), /synth tokens/);
  for (const zoom of [0, -1, NaN, Infinity]) {
    assert.throws(() => switchLayout(BOOL, { zoom }), /zoom/);
    assert.throws(() => draw(BOOL, { zoom }), /zoom/);
  }
});

test('the drawing is aria-hidden, takes no pointer and is never a slider', () => {
  for (const p of SAMPLES) {
    const svg = draw(p, { state: { focus: true, hover: true } });
    assert.match(svg, new RegExp(`^<g data-control="switch" data-style="${switchStyle(p)}" `
      + 'aria-hidden="true" pointer-events="none"'), p.key);
    assert.doesNotMatch(svg, /\brole=|aria-value|tabindex|data-hit/, p.key);
    assert.ok(svg.endsWith('</g>'));
  }
});

// ---------------------------------------------------------------- toggle

test('toggle: an 18 x 30 r4 housing in surface-2, a 3:1 edge, an 8 x 14 lever at the legend', () => {
  for (const p of [BOOL, TWO]) {
    const L = switchLayout(p);
    for (const [i, [v]] of (p.type === 'boolean' ? [[false], [true]] : p.options).entries()) {
      const svg = draw(p, { value: v });
      const h = part(svg, 'data-housing');
      assert.deepEqual(['x', 'y', 'width', 'height', 'rx'].map((a) => n(h, a)), [-9, -15, 18, 30, 4]);
      assert.equal(attrOf(h, 'fill'), TOKENS.surface.card, 'surface-2');
      assert.equal(attrOf(h, 'stroke'), TOKENS.control.edge, 'the 3:1 edge');
      const lever = part(svg, 'data-lever');
      assert.equal(n(lever, 'width'), 8);
      assert.equal(n(lever, 'height'), 14);
      assert.equal(attrOf(lever, 'fill'), TOKENS.control.pointer, 'the lever in text');
      const mid = n(lever, 'y') + 7;
      const legend = L.options[i].legend;
      assert.ok(Math.sign(mid) === Math.sign(legend.y), `${p.key} ${v}: the lever points at it`);
      const sel = parts(svg, 'data-legend').find((t) => attrOf(t, 'data-index') === String(i));
      assert.equal(attrOf(sel, 'fill'), TOKENS.text.value, 'the selected legend is lit');
      assert.equal(attrOf(sel, 'font-weight'), '600');
    }
    assert.ok(L.options[1].legend.y < 0 && L.options[0].legend.y > 0, 'the second option is up');
  }
});

// ---------------------------------------------------------------- slide

test('slide: a slot 4 wide, a 16 x 12 cap at the selected index, a detent per position', () => {
  for (const p of [ENUM(3), WAVE]) {
    const L = switchLayout(p);
    const ys = L.options.map((o) => o.legend.y);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1], 'each option further up');
    for (const [i, [v]] of p.options.entries()) {
      const svg = draw(p, { value: v });
      assert.equal(n(part(svg, 'data-slot'), 'width'), 4);
      const cap = part(svg, 'data-cap');
      assert.deepEqual([n(cap, 'width'), n(cap, 'height')], [16, 12]);
      assert.ok(Math.abs(n(cap, 'y') + 6 - ys[i]) < 0.01, `${p.key} ${v}: the cap at its legend`);
      assert.equal(attrOf(cap, 'stroke'), TOKENS.control.edge, 'the cap edge holds 3:1');
      assert.equal(parts(svg, 'data-detent').length, p.options.length);
    }
  }
});

// ---------------------------------------------------------------- rotary

test('rotary: a knob face whose pointer points at the selected legend, legends at r >= 60', () => {
  for (const p of [ENUM(5), ENUM(7, true), ENUM(8)]) {
    const L = switchLayout(p);
    assert.equal(L.style, 'rotary');
    assert.ok(L.radius >= 60, `r ${L.radius}`);
    for (const o of L.options) {
      const at = Math.hypot(o.legend.x, o.legend.y);
      assert.ok(at >= 60 - 0.01, `${p.key} ${o.value}: the legend at r ${at}`);
    }
    for (const [i, [v]] of p.options.entries()) {
      const svg = draw(p, { value: v });
      const ptr = part(svg, 'data-pointer');
      const deg = (x, y) => (Math.atan2(x, -y) * 180) / Math.PI;
      const tip = deg(n(ptr, 'x2'), n(ptr, 'y2'));
      const lg = deg(L.options[i].legend.x, L.options[i].legend.y);
      assert.ok(Math.abs(tip - lg) < 1, `${p.key} ${v}: the pointer at ${tip}°, its legend ${lg}°`);
      assert.equal(parts(svg, 'data-detent').length, p.options.length, 'a detent per position');
      const lit = parts(svg, 'data-detent').filter((d) => attrOf(d, 'stroke')
        === TOKENS.control.ring);
      assert.equal(lit.length, 1, 'the selected detent is lit');
      assert.ok(part(svg, 'data-skirt') && part(svg, 'data-cap'), 'the knob face');
    }
  }
});

// ---------------------------------------------------------------- window

test('window: the dial, a display-window frame for the caller\'s text, a legend grid below', () => {
  for (const p of [ENUM(10, true), ENUM(12)]) {
    const L = switchLayout(p);
    assert.equal(L.style, 'window');
    const svg = draw(p, { value: p.options[4][0] });
    const w = part(svg, 'data-window');
    assert.deepEqual(['x', 'y', 'width', 'height'].map((a) => n(w, a)),
      ['x', 'y', 'width', 'height'].map((a) => L.window[a]));
    assert.equal(attrOf(w, 'fill'), TOKENS.surface.edge, 'a recessed window');
    assert.ok(L.window.y + L.window.height < 0, 'above the dial');
    assert.ok(L.window.height * 1 >= LEGEND_PX + 8, 'the caller\'s 12 px text fits');
    const longest = Math.max(...L.options.map((o) => o.legend.width));
    assert.ok(L.window.width >= longest, 'the longest name fits');
    for (const o of L.options) {
      assert.ok(o.hit.y > 0, 'the grid lies below the dial');
      assert.ok(!(o.legend.x >= L.window.x && o.legend.x <= L.window.x + L.window.width
        && o.legend.y >= L.window.y && o.legend.y <= L.window.y + L.window.height),
      'no legend is drawn in the window: its text is the caller\'s');
    }
    assert.equal(parts(svg, 'data-selected').length, 1, 'the selected cell is marked');
    assert.equal(attrOf(part(svg, 'data-selected'), 'stroke'), TOKENS.control.ring);
    assert.ok(part(svg, 'data-pointer'));
  }
});

// ---------------------------------------------------------------- a dial is a knob (W1c review)

const DIALS = [ENUM(5), ENUM(6), ENUM(7, true), ENUM(8), ENUM(9), ENUM(10, true), ENUM(12)];
/** The knob widths a caller draws beside a switch, graph units: the core's own (44), the Synth
 *  panel's 64 px knob, and a smaller one. */
const KNOB_WIDTHS = [undefined, 64, 30];
const radialsOf = (el) => [...attrOf(el, 'd').matchAll(/M (\S+) (\S+) L (\S+) (\S+)/g)]
  .map((m) => m.slice(1).map(Number)).map(([x0, y0, x1, y1]) => [Math.hypot(x0, y0),
    Math.hypot(x1, y1), (Math.atan2(x1, -y1) * 180) / Math.PI]);
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

// Review of W1c, finding 4: the selector's skirt was r 17 at 1:1 beside 64 px knobs, about half
// their size, and its knurl a dashed ring the panel added. A dial is now the knob's face at the
// size of the knob beside it: the knob's skirt (r 16 of its 44 box), its 24-ridge knurl from
// r 14.5 to 16 in control.knurl, its cap, all scaled by knob / CONTROL_BOX.knob.width, and its
// detents end inside that knob's box.
test('a dial is the knob\'s face at the knob\'s size: skirt, knurl, cap, detents in its box',
  () => {
  // The knob's own face, as controlSvg draws it: what a dial at the default knob width repeats.
  const KNOB_P = { key: 'k', type: 'number', min: 0, max: 1, default: 0.5 };
  const knobFace = controlSvg({ kind: 'knob', value: 0.5, param: KNOB_P, tokens: TOKENS });
  const dialFace = draw(ENUM(5));
  for (const [attr, keys] of [['data-skirt', ['r', 'stroke-width']], ['data-cap', ['r']],
    ['data-knurl', ['d', 'stroke-width', 'stroke']]]) {
    for (const a of keys) {
      assert.equal(attrOf(part(dialFace, attr), a), attrOf(part(knobFace, attr), a),
        `the dial's ${attr} ${a} is the knob's`);
    }
  }
  for (const p of DIALS) {
    for (const knob of KNOB_WIDTHS) {
      const k = (knob ?? CONTROL_BOX.knob.width) / CONTROL_BOX.knob.width;
      const where = `${p.key} beside a ${knob ?? 44} knob`;
      const svg = draw(p, { knob });
      near(n(part(svg, 'data-skirt'), 'r'), 16 * k, 0.01, `${where}: the knob's skirt`);
      near(n(part(svg, 'data-skirt'), 'stroke-width'), 1.5 * k, 0.01, `${where}: its edge`);
      near(n(part(svg, 'data-cap'), 'r'), 12 * k, 0.01, `${where}: the knob's cap`);
      const knurl = part(svg, 'data-knurl');
      assert.ok(knurl, `${where}: a knurl of the core's own`);
      assert.equal(attrOf(knurl, 'stroke'), TOKENS.control.knurl, `${where}: the knurl role`);
      near(n(knurl, 'stroke-width'), k, 0.01, `${where}: a knob ridge's width`);
      const ridges = radialsOf(knurl);
      assert.equal(ridges.length, 24, `${where}: the knob's 24 ridges`);
      for (const [i, [r0, r1, a]] of ridges.entries()) {
        near(r0, 14.5 * k, 0.02, `${where}: ridge ${i} from`);
        near(r1, 16 * k, 0.02, `${where}: ridge ${i} to`);
        const want = ((i * 15 + 180) % 360) - 180;
        near(((a + 540) % 360) - 180, want, 0.1, `${where}: ridge ${i} evenly spaced`);
      }
      for (const d of parts(svg, 'data-detent')) {
        const r = Math.max(Math.hypot(n(d, 'x1'), n(d, 'y1')), Math.hypot(n(d, 'x2'), n(d, 'y2')));
        assert.ok(r > 16 * k, `${where}: a detent outside the skirt`);
        assert.ok(r <= (CONTROL_BOX.knob.width / 2) * k + 1e-6, `${where}: inside the knob's box`);
      }
      const L = switchLayout(p, { knob });
      assert.equal(L.knob, knob ?? CONTROL_BOX.knob.width, `${where}: layout.knob`);
      assert.ok(L.dial && L.dial.extent >= (CONTROL_BOX.knob.width / 2) * k, `${where}: extent`);
    }
  }
  for (const bad of [0, -1, NaN, Infinity, '64']) {
    assert.throws(() => switchLayout(ENUM(5), { knob: bad }), /knob/, String(bad));
  }
  // A toggle and a slide have no dial: the knob width changes nothing there.
  for (const p of [BOOL, TWO, ENUM(3), WAVE]) {
    assert.deepEqual(switchLayout(p, { knob: 64 }).options, switchLayout(p).options, p.key);
    assert.equal(switchLayout(p).dial, null, p.key);
  }
});

const numeralBox = (m) => ({ x: m.x - m.width / 2, y: m.y - m.size / 2, width: m.width,
  height: m.size });

// Review of W1c, finding 3: a packed dial's 7 or 12 detents carried no mark, so nothing tied the
// pointer to a legend. A dial of NUMBERED_MIN (7) or more detents numbers them, 1 to n, each
// numeral at its detent's angle outside the ticks, 12 px on screen, apart from every other and
// from every hit box; the selected one is lit as its legend is.
test('a dial of 7 or more detents numbers them 1..n at each detent, apart, 12 px, lit', () => {
  for (const p of DIALS) {
    for (const zoom of [1, 2, 0.25]) {
      for (const knob of KNOB_WIDTHS) {
        const where = `${p.key} at ${zoom} beside ${knob ?? 44}`;
        const L = switchLayout(p, { zoom, knob });
        const numbered = p.options.length >= 7;
        const sel = 2;
        const svg = draw(p, { zoom, knob, value: p.options[sel][0] });
        const texts = parts(svg, 'data-number');
        if (!numbered) {
          assert.ok(L.options.every((o) => o.number === null && o.numeral === null), where);
          assert.equal(texts.length, 0, `${where}: no numerals under 7 detents`);
          continue;
        }
        const detents = parts(svg, 'data-detent');
        const tickOut = Math.max(...detents.map((d) => Math.hypot(n(d, 'x2'), n(d, 'y2'))));
        for (const o of L.options) {
          assert.equal(o.number, o.index + 1, `${where}: option ${o.index}'s number`);
          const m = o.numeral;
          assert.ok(m.size * zoom >= LEGEND_PX - 1e-9, `${where}: ${m.size * zoom} px`);
          const dx = n(detents[o.index], 'x2');
          const dy = n(detents[o.index], 'y2');
          near((Math.atan2(m.x, -m.y) * 180) / Math.PI, (Math.atan2(dx, -dy) * 180) / Math.PI, 1,
            `${where}: numeral ${o.number} at its detent`);
          const b = numeralBox(m);
          assert.ok(reachOf(b) > tickOut, `${where}: numeral ${o.number} clear of the ticks`);
          assert.ok(inside(b, L.box), `${where}: numeral ${o.number} inside the box`);
          for (const q of L.options) {
            if (q !== o) {
              assert.ok(!overlap(b, numeralBox(q.numeral)), `${where}: ${o.number} on ${q.number}`);
            }
            assert.ok(!overlap(b, q.hit), `${where}: numeral ${o.number} in ${q.value}'s box`);
          }
        }
        assert.equal(texts.length, p.options.length, `${where}: a numeral per detent`);
        for (const t of texts) {
          const i = Number(attrOf(t, 'data-index'));
          const m = L.options[i].numeral;
          assert.equal(/>([^<]*)</.exec(t + svg.slice(svg.indexOf(t) + t.length))[1],
            String(i + 1), `${where}: the numeral's text`);
          assert.deepEqual([n(t, 'x'), n(t, 'y'), n(t, 'font-size')], [m.x, m.y, m.size], where);
          assert.equal(attrOf(t, 'text-anchor'), 'middle');
          assert.equal(attrOf(t, 'stroke'), 'none');
          assert.equal(attrOf(t, 'fill'), i === sel ? TOKENS.text.value : TOKENS.text.label,
            `${where}: numeral ${i + 1}`);
          assert.equal(attrOf(t, 'font-weight'), i === sel ? '600' : '400');
        }
        for (const t of parts(draw(p, { zoom, knob, state: { disabled: true } }), 'data-number')) {
          assert.equal(attrOf(t, 'fill'), TOKENS.text.dim, `${where}: dimmed while disabled`);
        }
      }
    }
  }
});

// A caller decides where numerals help: `numbers` false keeps a dial unnumbered (a window
// already names the selection, and a grid too wide for "n · label" keeps its labels), true
// numbers a dial of any count, and left out it is the count rule (NUMBERED_MIN).
test('numbers: false keeps a dial unnumbered, true numbers any dial, unset is from 7', () => {
  for (const p of [ENUM(5), ENUM(7, true), ENUM(10, true), ENUM(12)]) {
    const off = switchLayout(p, { numbers: false, numberLegends: true, knob: 64 });
    assert.ok(off.options.every((o) => o.number === null && o.numeral === null), p.key);
    assert.deepEqual(off.options.map((o) => o.legend.text), p.options.map((o) => o[1]),
      `${p.key}: no number to prefix`);
    assert.equal(parts(draw(p, { numbers: false }), 'data-number').length, 0, p.key);
    assert.deepEqual(off.dial.extent, switchLayout(ENUM(5), { knob: 64 }).dial.extent,
      `${p.key}: an unnumbered dial is the knob's size alone`);
    const on = switchLayout(p, { numbers: true });
    assert.deepEqual(on.options.map((o) => o.number), p.options.map((o, i) => i + 1), p.key);
    assert.equal(parts(draw(p, { numbers: true }), 'data-number').length, p.options.length);
    const auto = switchLayout(p);
    assert.equal(auto.options[0].number, p.options.length >= 7 ? 1 : null, `${p.key}: auto`);
  }
  for (const p of [BOOL, ENUM(3)]) {
    assert.ok(switchLayout(p, { numbers: true }).options.every((o) => o.number === null),
      `${p.key}: a toggle or a slide has no detent to number`);
  }
  for (const bad of [1, 'yes', null]) {
    assert.throws(() => switchLayout(ENUM(7), { numbers: bad }), /numbers/, String(bad));
  }
});

// The caller's half of finding 3: a legend grid printed as an algorithm chart, each legend
// prefixed with its detent's number ("1 · 2 → 1"), its width and hit box laid out for that text.
test('numberLegends prefixes a numbered dial\'s legends "n · label" and fits their boxes', () => {
  const FM = Object.freeze({ key: 'algorithm', type: 'enum', default: 'a1', options: [
    ['a1', '2 → 1'], ['a2', '1 + 2'], ['a3', '3 → 2 → 1'], ['a4', '(2 + 3) → 1'],
    ['a5', '3 → (1 + 2)'], ['a6', '1 + 2 + 3'], ['a7', '3 → 2, 1']] });
  for (const p of [FM, ENUM(7, true), ENUM(9), ENUM(12)]) {
    for (const zoom of [1, 0.25]) {
      const plain = switchLayout(p, { zoom });
      const L = switchLayout(p, { zoom, numberLegends: true, knob: 64 });
      for (const [i, o] of L.options.entries()) {
        const text = `${i + 1} · ${p.options[i][1]}`;
        assert.equal(o.legend.text, text, `${p.key}: option ${i}'s legend`);
        assert.equal(o.label, p.options[i][1], `${p.key}: the label stays the option's own`);
        assert.equal(o.legend.width, legendWidth(text, o.legend.size), `${p.key}: its width`);
        assert.ok(inside(legendBox(o.legend), o.hit), `${p.key} at ${zoom}: inside its hit box`);
        assert.equal(plain.options[i].legend.text, p.options[i][1], `${p.key}: unprefixed`);
      }
      const svg = switchSvg({ value: p.default, param: p, tokens: TOKENS, zoom,
        numberLegends: true, knob: 64 });
      const drawn = [...svg.matchAll(/<text data-legend="" data-index="(\d+)"[^>]*>([^<]*)</g)]
        .map((m) => [Number(m[1]), m[2]]);
      assert.deepEqual(drawn, L.options.map((o) => [o.index, o.legend.text.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')]), `${p.key}: the drawn legends`);
    }
  }
  // Under 7 detents there is no number to print: the legends stay the labels.
  const five = switchLayout(ENUM(5), { numberLegends: true });
  assert.deepEqual(five.options.map((o) => o.legend.text), ENUM(5).options.map((o) => o[1]));
});

// ---------------------------------------------------------------- geometry

test('every part lies inside switchLayout\'s box at zoom 1, 2 and 3, with every state', () => {
  const states = [{}, { hover: true, focus: true }, { dragging: true, disabled: true },
    { focus: { option: 'o0' }, hover: { option: 'o1' } }, { hover: { option: false } }];
  for (const p of SAMPLES) {
    for (const zoom of ZOOMS) {
      for (const [state, extra] of states.flatMap((s) => [[s, {}],
        [s, { knob: 64, numberLegends: true }]])) {
        const led = switchStyle(p) === 'toggle' ? { source: 'node.enabled', lit: true } : null;
        const L = switchLayout(p, { zoom, led: Boolean(led), ...extra });
        const svg = draw(p, { zoom, state, led, ...extra });
        const b = L.box;
        for (const [x0, y0, x1, y1] of extents(svg)) {
          assert.ok(x0 >= b.x - 1e-6 && y0 >= b.y - 1e-6 && x1 <= b.x + b.width + 1e-6
            && y1 <= b.y + b.height + 1e-6, `${p.key} zoom ${zoom} ${JSON.stringify(state)}: `
            + `[${x0}, ${y0}, ${x1}, ${y1}] outside ${JSON.stringify(b)}`);
        }
        for (const o of L.options) {
          assert.ok(inside(o.hit, b), `${p.key} ${zoom}: the hit box`);
          const tx = o.legend.anchor === 'start' ? o.legend.x : o.legend.anchor === 'end'
            ? o.legend.x - o.legend.width : o.legend.x - o.legend.width / 2;
          const text = { x: tx, y: o.legend.y - o.legend.size / 2, width: o.legend.width,
            height: o.legend.size };
          assert.ok(inside(text, o.hit), `${p.key} ${zoom} ${o.value}: the legend in its hit box`);
        }
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
      }
    }
  }
});

test('legends are 12 px on screen at every zoom, in the label token, the selected one lit', () => {
  assert.equal(LEGEND_PX, 12);
  for (const p of SAMPLES) {
    for (const zoom of [0.5, ...ZOOMS]) {
      const svg = draw(p, { zoom });
      const texts = parts(svg, 'data-legend');
      const L = switchLayout(p, { zoom });
      assert.equal(texts.length, L.options.length, `${p.key}: one legend each`);
      for (const t of texts) {
        assert.ok(n(t, 'font-size') * zoom >= LEGEND_PX - 1e-9, `${p.key} at ${zoom}`);
        // The drawn legend is the laid-out one: its size, and so the box its hit box holds.
        const lg = L.options[Number(attrOf(t, 'data-index'))].legend;
        assert.equal(n(t, 'font-size'), lg.size, `${p.key} at ${zoom}: the layout's size`);
        assert.equal(lg.size, L.legendPx, `${p.key} at ${zoom}: layout.legendPx`);
        assert.deepEqual([n(t, 'x'), n(t, 'y'), attrOf(t, 'text-anchor')],
          [lg.x + 0, lg.y + 0, lg.anchor], `${p.key} at ${zoom}: the layout's place`);
        assert.equal(attrOf(t, 'stroke'), 'none', 'a legend sets its own stroke');
        assert.ok([TOKENS.text.label, TOKENS.text.value].includes(attrOf(t, 'fill')));
      }
    }
    const off = draw(p, { state: { disabled: true } });
    for (const t of parts(off, 'data-legend')) assert.equal(attrOf(t, 'fill'), TOKENS.text.dim);
    assert.equal(parts(draw(p, { legends: false }), 'data-legend').length, 0, 'the caller\'s');
  }
});

// ---------------------------------------------------------------- the registry

/** Every enum and boolean parameter of every node type the registry lists. */
const REGISTRY_CHOICES = NODE_REGISTRY.list().flatMap((def) => def.params
  .filter((p) => p.type === 'enum' || p.type === 'boolean')
  .map((p) => ({ where: `${def.type}.${p.key}`, p })));

test('every registry enum and boolean: 44 px hit boxes that never overlap, inside the box', () => {
  assert.ok(REGISTRY_CHOICES.length > 30, `${REGISTRY_CHOICES.length} parameters`);
  const styles = new Set();
  for (const { where, p } of REGISTRY_CHOICES) {
    styles.add(switchStyle(p));
    for (const zoom of [...ZOOMS, 1.45, ...LOW_ZOOMS]) {
      const L = switchLayout(p, { zoom });
      const hits = switchOptions(p, { zoom }).map((o) => o.hit);
      assert.equal(hits.length, p.type === 'boolean' ? 2 : p.options.length, where);
      for (const [i, h] of hits.entries()) {
        assert.ok(h.width * zoom >= HIT_PX - 1e-9 && h.height * zoom >= HIT_PX - 1e-9,
          `${where} at ${zoom}: option ${i} is ${h.width * zoom} x ${h.height * zoom} px`);
        assert.ok(inside(h, L.box), `${where} at ${zoom}: option ${i} inside the box`);
        for (let j = i + 1; j < hits.length; j++) {
          assert.ok(!overlap(h, hits[j]), `${where} at ${zoom}: options ${i} and ${j} overlap`);
        }
      }
      if (L.style === 'rotary' || L.style === 'window') {
        for (const [i, h] of hits.entries()) {
          const dx = Math.max(h.x, Math.min(0, h.x + h.width));
          const dy = Math.max(h.y, Math.min(0, h.y + h.height));
          assert.ok(Math.hypot(dx, dy) > 23, `${where} at ${zoom}: option ${i} covers the dial`);
        }
      }
      const svg = switchSvg({ value: p.default, param: p, tokens: TOKENS, zoom,
        state: { focus: true } });
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, where);
      assert.deepEqual(colourLiterals(svg), [], where);
      assert.deepEqual(shapesWithoutStroke(svg), [], `${where}: every shape sets its stroke`);
      const known = new Set(tokenValues());
      for (const paint of paints(svg)) {
        assert.ok(paint === 'none' || known.has(paint), `${where}: ${paint} is not a token`);
      }
    }
  }
  assert.deepEqual([...styles].sort(), ['rotary', 'slide', 'toggle', 'window'],
    'the registry needs every style');
});

test('F1: every registry enum and boolean lays out at the Studio graph\'s zooms, 0.15 to 3', () => {
  for (const { where, p } of REGISTRY_CHOICES) {
    for (const zoom of [0.15, 0.2, 0.25, 0.3, 0.35, 0.5, 0.75, 1, 1.45, 2, 3]) {
      const L = switchLayout(p, { zoom });
      const svg = switchSvg({ value: p.default, param: p, tokens: TOKENS, zoom,
        state: { focus: true, hover: true } });
      const b = L.box;
      if (L.style === 'window' && zoom < 1) {
        const cols = (layout) => new Set(layout.options.map((o) => o.legend.x)).size;
        assert.equal(cols(L), cols(switchLayout(p)), `${where} at ${zoom}: the zoom 1 grid`);
      }
      for (const [x0, y0, x1, y1] of extents(svg)) {
        assert.ok(x0 >= b.x - 1e-6 && y0 >= b.y - 1e-6 && x1 <= b.x + b.width + 1e-6
          && y1 <= b.y + b.height + 1e-6, `${where} at ${zoom}: [${x0}, ${y0}, ${x1}, ${y1}] `
          + `outside ${JSON.stringify(b)}`);
      }
      for (const o of L.options) {
        assert.ok(inside(legendBox(o.legend), o.hit), `${where} at ${zoom}: ${o.value}'s legend`);
        for (const q of L.options) {
          if (q !== o) {
            assert.ok(!overlap(legendBox(o.legend), q.hit),
              `${where} at ${zoom}: ${o.value}'s legend in ${q.value}'s box`);
          }
        }
      }
    }
  }
});

test('F1: only a rotary that cannot be laid out is refused, and the refusal names the zoom', () => {
  const wide = Object.freeze({ key: 'wide', type: 'enum', default: 'o0',
    options: Array.from({ length: 8 }, (_, i) => [`o${i}`, `${'W'.repeat(60)}${i}`]) });
  for (const zoom of [1, 0.25, 0.15]) {
    assert.throws(() => switchLayout(wide, { zoom }),
      new RegExp(`^Error: wide: at zoom ${zoom}, .*rotary selector`), String(zoom));
  }
  for (const zoom of [0.15, 0.25, 1]) {
    assert.equal(switchLayout(ENUM(8, true), { zoom }).style, 'rotary', 'a long one still fits');
  }
});

test('switchOptions is switchLayout\'s options: frozen, one per option, value and label', () => {
  const L = switchLayout(WAVE, { zoom: 2 });
  assert.deepEqual(switchOptions(WAVE, { zoom: 2 }), L.options);
  assert.ok(Object.isFrozen(L) && Object.isFrozen(L.options) && Object.isFrozen(L.box));
  assert.ok(L.options.every((o) => Object.isFrozen(o) && Object.isFrozen(o.hit)));
  assert.deepEqual(L.options.map((o) => [o.index, o.value, o.label]),
    WAVE.options.map(([v, label], i) => [i, v, label]));
  assert.deepEqual(switchOptions(BOOL).map((o) => [o.value, o.label]), [[false, 'Off'],
    [true, 'On']]);
});

// ---------------------------------------------------------------- contrast

test('edges, lever, ticks and LED hold 3:1 on surface-2 and surface-3, legends 4.5:1', async () => {
  const N = SYNTH_TOKEN_NAMES;
  const grounds = ['--osc-surface-2', '--osc-surface-3'];
  assert.deepEqual([N.surface.card, N.surface.plateHi], grounds);
  const graphic = [['edge', N.control.edge], ['lever', N.control.pointer],
    ['detent', N.control.track], ['selected detent', N.control.ring],
    ['focus', N.control.focus], ['LED lit', N.control.ring], ['LED ring', N.control.edge]];
  const text = [['legend', N.text.label], ['selected legend', N.text.value]];
  const short = [];
  for (const [theme, t] of Object.entries(await tokenThemes())) {
    for (const ground of grounds) {
      for (const [what, name, min] of [...graphic.map((g) => [...g, 3]),
        ...text.map((g) => [...g, 4.5])]) {
        const ratio = contrastOf(tokenHex(t, name), tokenHex(t, ground));
        if (ratio < min) short.push(`${theme} ${what} (${name}) on ${ground}: ${ratio.toFixed(2)}`);
      }
    }
    const lever = contrastOf(tokenHex(t, N.control.pointer), tokenHex(t, N.surface.card));
    assert.ok(lever >= 3, `${theme}: the lever on its housing ${lever.toFixed(2)}`);
  }
  assert.deepEqual(short, []);
  // The parts are drawn in those roles.
  const svg = draw(BOOL, { led: { source: 'x', lit: false } });
  assert.equal(attrOf(part(svg, 'data-housing'), 'stroke'), TOKENS.control.edge);
  assert.equal(attrOf(part(svg, 'data-lever'), 'fill'), TOKENS.control.pointer);
  assert.equal(attrOf(part(svg, 'data-lens'), 'stroke'), TOKENS.control.edge);
  for (const d of parts(draw(WAVE), 'data-detent')) {
    assert.ok([TOKENS.control.track, TOKENS.control.ring].includes(attrOf(d, 'stroke')));
  }
});

test('the window frame and the toggle\'s bushing are control.edge, 3:1 on what they sit on',
  async () => {
    const themes = await tokenThemes();
    const ratio = (t, a, b) => contrastOf(tokenHex(t, tokenName(a)), tokenHex(t, tokenName(b)));
    for (const p of [BOOL, TWO]) {
      const svg = draw(p);
      const bushing = part(svg, 'data-bushing');
      assert.equal(attrOf(bushing, 'stroke'), TOKENS.control.edge, `${p.key}: the bushing edge`);
      const housing = attrOf(part(svg, 'data-housing'), 'fill');
      for (const [theme, t] of Object.entries(themes)) {
        const r = ratio(t, attrOf(bushing, 'stroke'), housing);
        assert.ok(r >= 3, `${theme} ${p.key}: the bushing edge on its housing ${r.toFixed(2)}`);
      }
    }
    for (const p of [ENUM(9), ENUM(10, true), ENUM(12)]) {
      for (const state of [{}, { hover: true }, { disabled: true }]) {
        const frame = part(draw(p, { state }), 'data-window');
        assert.equal(attrOf(frame, 'stroke'), TOKENS.control.edge, `${p.key}: the window edge`);
        for (const [theme, t] of Object.entries(themes)) {
          for (const ground of [TOKENS.surface.card, TOKENS.surface.plateHi]) {
            const r = ratio(t, attrOf(frame, 'stroke'), ground);
            assert.ok(r >= 3, `${theme} ${p.key}: the window edge on ${ground} ${r.toFixed(2)}`);
          }
        }
      }
    }
  });

test('a rotary\'s leader lines run from the dial and end before every legend\'s text', () => {
  const rotaries = [ENUM(5), ENUM(7, true), ENUM(8), ...REGISTRY_CHOICES
    .filter(({ p }) => switchStyle(p) === 'rotary').map(({ p }) => p)];
  for (const p of rotaries) {
    for (const zoom of [...ZOOMS, ...LOW_ZOOMS]) {
      const L = switchLayout(p, { zoom });
      const leaders = parts(draw(p, { zoom }), 'data-leader');
      assert.equal(leaders.length, L.options.length, `${p.key}: a leader per position`);
      for (const [i, el] of leaders.entries()) {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => n(el, a));
        const half = n(el, 'stroke-width') / 2;
        assert.ok(Math.hypot(x1, y1) < Math.hypot(x2, y2), `${p.key}: leader ${i} runs outward`);
        for (let k = 0; k <= 64; k++) {
          const x = x1 + ((x2 - x1) * k) / 64;
          const y = y1 + ((y2 - y1) * k) / 64;
          for (const o of L.options) {
            const t = legendBox(o.legend);
            assert.ok(!(x + half > t.x && x - half < t.x + t.width && y + half > t.y
              && y - half < t.y + t.height), `${p.key} at ${zoom}: leader ${i} enters `
              + `${o.value}'s legend at (${x.toFixed(2)}, ${y.toFixed(2)})`);
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------- states

test('states: hover lights the edge and the hovered legend, focus rings the option, disabled', () => {
  for (const p of SAMPLES) {
    const L = switchLayout(p);
    const plain = draw(p);
    assert.doesNotMatch(plain, /data-focus/);
    const edgeOf = (svg) => attrOf(part(svg, 'data-housing') || part(svg, 'data-slot')
      || part(svg, 'data-skirt'), 'stroke');
    assert.equal(edgeOf(plain), TOKENS.control.edge, p.key);
    assert.equal(edgeOf(draw(p, { state: { hover: true } })), TOKENS.control.pointer, p.key);
    const other = L.options.find((o) => o.value !== p.default);
    const hov = draw(p, { state: { hover: { option: other.value } } });
    const t = parts(hov, 'data-legend').find((x) => attrOf(x, 'data-index')
      === String(other.index));
    assert.equal(attrOf(t, 'fill'), TOKENS.text.value, `${p.key}: the hovered legend`);
    const foc = part(draw(p, { state: { focus: { option: other.value } } }), 'data-focus');
    assert.deepEqual(['x', 'y', 'width', 'height'].map((a) => n(foc, a)),
      [other.hit.x + 1, other.hit.y + 1, other.hit.width - 2, other.hit.height - 2].map((x) =>
        Number(x.toFixed(2))), `${p.key}: the focus ring around the focused option`);
    assert.equal(attrOf(foc, 'stroke'), TOKENS.control.focus);
    assert.equal(n(foc, 'stroke-width'), 2);
    const sel = L.options.find((o) => o.value === p.default);
    const own = part(draw(p, { state: { focus: true } }), 'data-focus');
    assert.equal(n(own, 'x'), Number((sel.hit.x + 1).toFixed(2)), 'focus true: the selected one');
    const off = draw(p, { state: { disabled: true } });
    assert.match(off, /^<g [^>]*data-disabled=""/);
    const ind = part(off, 'data-lever') || part(off, 'data-grip') || part(off, 'data-pointer');
    assert.equal(attrOf(ind, attrOf(ind, 'fill') === 'none' || /<line/.test(ind) ? 'stroke'
      : 'fill'), TOKENS.control.disabled, `${p.key}: the indicator dims`);
  }
});

test('dragging lifts the shadow; the shadow and the sheen are the hw-* classes', () => {
  for (const p of [BOOL, WAVE, ENUM(5), ENUM(12)]) {
    const sh = (svg) => part(svg, 'data-shadow');
    const at = (el) => n(el, 'y') + n(el, 'cy');
    assert.ok(at(sh(draw(p, { state: { dragging: true } }))) > at(sh(draw(p))), p.key);
    assert.equal(attrOf(sh(draw(p)), 'class'), 'opacity-hw-shadow');
    assert.equal(attrOf(sh(draw(p)), 'fill'), TOKENS.surface.edge);
  }
  assert.match(draw(ENUM(5)), /<ellipse class="opacity-hw-sheen"/, 'the dial cap\'s highlight');
});

// ---------------------------------------------------------------- v4: intensity, LED, motion

test('no literal opacity, alpha or shadow in any output or in switch.js (v4)', () => {
  assert.deepEqual(intensityLiterals(SRC), [], 'switch.js');
  for (const p of SAMPLES) {
    for (const state of [{}, { hover: true, focus: true, dragging: true }, { disabled: true }]) {
      const led = switchStyle(p) === 'toggle' ? { source: 's', lit: true } : null;
      const svg = draw(p, { state, led });
      assert.deepEqual(intensityLiterals(svg), [], `${p.key} ${JSON.stringify(state)}`);
      assert.deepEqual(colourLiterals(svg), [], p.key);
      for (const cls of svg.matchAll(/\sclass="([^"]*)"/g)) {
        assert.match(cls[1], /^opacity-hw-(?:sheen|shadow)$/, cls[1]);
      }
    }
  }
});

test('the LED: data-source and data-lit from the caller, the glow only its halo', () => {
  for (const lit of [true, false]) {
    const svg = draw(BOOL, { led: { source: 'filter.enabled "x"', lit } });
    const led = part(svg, 'data-led');
    assert.ok(led, 'an LED');
    assert.equal(attrOf(led, 'data-source'), 'filter.enabled &quot;x&quot;', 'escaped');
    assert.equal(attrOf(led, 'data-lit'), String(lit));
    const lens = part(svg, 'data-lens');
    assert.equal(attrOf(lens, 'fill'), lit ? TOKENS.control.ring : TOKENS.surface.card);
    assert.equal(n(lens, 'r'), 3, 'Ø6');
    assert.equal(parts(svg, 'data-halo').length, lit ? 1 : 0, 'the glow only when lit');
    if (lit) assert.equal(attrOf(part(svg, 'data-halo'), 'class'), 'opacity-hw-sheen');
    assert.equal(parts(svg, 'data-led').length, 1);
  }
  assert.doesNotMatch(draw(BOOL), /data-led/, 'no LED unless the caller binds one');
  assert.notEqual(switchLayout(BOOL, { led: true }).led, null);
  assert.equal(switchLayout(BOOL).led, null);
  for (const bad of [{ lit: true }, { source: '', lit: true }, { source: 'x' },
    { source: 'x', lit: 'yes' }, { source: 7, lit: false }]) {
    assert.throws(() => draw(BOOL, { led: bad }), /LED/, JSON.stringify(bad));
  }
  assert.throws(() => draw(WAVE, { led: { source: 'x', lit: true } }), /LED.*toggle/);
  // The source binds both, as v4's unboundIndicators reads them: no literal state anywhere.
  // switch.js draws no LED of its own: it passes the caller's { source, lit } to ledSvg, whose
  // source binds both (ui-synth-led.test.mjs and v4's unboundIndicators read it).
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /(?<=\s)data-led(?![\w-])/, 'no data-led markup of its own');
  assert.match(code, /ledSvg\(\{[^}]*\bsource: led\.source\b[^}]*\blit: led\.lit\b/,
    'the caller\'s state, passed through');
  assert.doesNotMatch(code, /box-shadow|drop-shadow|feDropShadow|text-shadow/, 'no other glow');
});

test('a toggle\'s LED is led.js\'s LED: the same bezel, lens and halo, at the layout\'s place',
  () => {
    for (const zoom of [1, 2]) {
      for (const lit of [true, false]) {
        const L = switchLayout(BOOL, { zoom, led: true });
        const svg = draw(BOOL, { zoom, led: { source: 'node.enabled', lit } });
        const want = ledSvg({ at: { x: L.led.cx, y: L.led.cy }, lit, source: 'node.enabled',
          tokens: TOKENS });
        assert.ok(svg.includes(want), `zoom ${zoom} lit ${lit}: ledSvg's markup, whole`);
        assert.equal(parts(svg, 'data-bezel').length, 1, 'a bezel');
        assert.equal(parts(svg, 'data-lens').length, 1, 'a lens');
        assert.match(want, /^<g data-led=""/, 'data-led is the LED\'s group');
        const housing = part(svg, 'data-housing');
        const right = n(housing, 'x') + n(housing, 'width') + n(housing, 'stroke-width') / 2;
        const box = ledBox({ at: { x: L.led.cx, y: L.led.cy } });
        assert.ok(L.led.cx - LED.bezel - LED.bezelW / 2 >= right + 2,
          'the bezel clears the housing');
        assert.ok(box.x + box.width <= L.box.x + L.box.width + 1e-6, 'the halo in the box');
      }
    }
  });

test('a setpoint: no animation, no listener, no document; it imports only the layer', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /<animate|\.animate\(|requestAnimationFrame|transition|setTimeout/);
  assert.doesNotMatch(code, /addEventListener|(?<![\w.])(?:document|window)\.|getComputedStyle/);
  const imports = [...SRC.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./knob.js', './legend.js', './led.js']);
});

// ---------------------------------------------------------------- controlSvg, kept

test('controlSvg({ kind: switch }) still draws; its refusal past four points to switchSvg', () => {
  assert.ok(controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: TOKENS }));
  assert.ok(controlSvg({ kind: 'switch', value: 'square', param: WAVE, tokens: TOKENS }));
  assert.throws(() => controlSvg({ kind: 'switch', value: 'o0', param: ENUM(5), tokens: TOKENS }),
    /at most 4 positions.*switchSvg draws it as a rotary selector.*knob/);
  assert.ok(switchSvg({ value: 'o0', param: ENUM(5), tokens: TOKENS }), 'which it does');
});
