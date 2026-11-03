// The shared synth-theme layer's XY pad (src/js/ui/synth/xy.js; plan F013 entry 12, slice S10):
// pure drawing functions, no DOM, no listener, no timer. Checked here: the layout (a square
// surface, a Ø28 puck with a crosshair notch, a horizontal fader under the pad for X and a
// vertical one beside it for Y, each knob.js's fader at controlBox, the gate LED in the corner
// between them) keeps every hit box at least 44 screen px and none overlapping at zoom 0.25 to
// 2.5; xyPosition and xyValue clamp, put 0 at the bottom (y up, as hardware) and round-trip
// exactly over a grid; xySvg draws the surface in surface tokens (never bg-gray-900), the grid
// in text-dim at the hw-texture intensity, the puck (control.pointer notch, --osc-text edge),
// the gate LED through led.js's ledSvg (data-source interpolated from the caller), the axis
// faders through knob.js's controlSvg carrying ariaAttrs; the pad is role="group" and the puck
// no second slider; idle, touched, focus and disabled; 3:1 for the graphics and 4.5:1 for the
// LED's label on the surfaces they sit on in both themes, computed from tokens.css; no literal
// colour, opacity, alpha or shadow; 12 px font floor; nothing moves.
//   node --test tests/unit/ui-synth-xy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ariaAttrs, controlBox, controlSvg, HIT_PX, toNorm } from '../../src/js/ui/synth/knob.js';
import { ledBox, ledSvg } from '../../src/js/ui/synth/led.js';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/js/ui/studio/graph-geometry.js';
import {
  TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues, intensityLiterals,
  tokenThemes, tokenHex, contrastOf,
} from './ui-synth-fixture.mjs';

const XY_URL = new URL('../../src/js/ui/synth/xy.js', import.meta.url);
const xy = await import(XY_URL.href).catch(() => ({}));
const SRC = existsSync(XY_URL) ? readFileSync(XY_URL, 'utf8') : '';
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PX = Object.freeze({ key: 'x', label: 'Pitch', type: 'integer', min: 0, max: 14, step: 1,
  default: 7 });
const PY = Object.freeze({ key: 'y', label: 'Cutoff', unit: 'Hz', type: 'number', min: 20,
  max: 20000, scale: 'log', default: 1000 });
const PARAMS = Object.freeze({ x: PX, y: PY });
const SVG = (extra = {}) => xy.xySvg({ x: 3, y: 440, gate: false, source: 'node.xy.gate',
  params: PARAMS, tokens: TOKENS, ...extra });
const ZOOMS = [ZOOM_MIN, 0.5, 1, 1.45, 2, ZOOM_MAX];

const attrOf = (el, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(el) || [])[1];
const part = (svg, attr) => (new RegExp(`<\\w+\\b[^>]*\\s${attr}=""[^>]*>`).exec(svg) || [null])[0];
const open = (svg) => /^<g\b[^>]*>/.exec(svg)?.[0] ?? '';
const rectOf = (el) => ({ x: Number(attrOf(el, 'x')), y: Number(attrOf(el, 'y')),
  width: Number(attrOf(el, 'width')), height: Number(attrOf(el, 'height')) });
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a, b, eps = 1e-9) => a.x >= b.x - eps && a.y >= b.y - eps
  && a.x + a.width <= b.x + b.width + eps && a.y + a.height <= b.y + b.height + eps;
/** The [start, end) span of the element whose open tag carries `attr`, nested ones counted. */
function elementSpan(svg, attr) {
  const m = new RegExp(`<(\\w+)\\b[^>]*\\s${attr}[^>]*>`).exec(svg);
  if (!m || m[0].endsWith('/>')) return m ? [m.index, m.index + m[0].length] : null;
  const tag = new RegExp(`<(/?)${m[1]}\\b[^>]*?(/?)>`, 'g');
  tag.lastIndex = m.index + m[0].length;
  let depth = 1;
  for (let t = tag.exec(svg); t; t = tag.exec(svg)) {
    if (t[1]) depth -= 1;
    else if (!t[2]) depth += 1;
    if (depth === 0) return [m.index, t.index + t[0].length];
  }
  return null;
}
const slice = (svg, attr) => {
  const s = elementSpan(svg, attr);
  return s ? svg.slice(...s) : '';
};
const varName = (v) => (/^var\((--osc-[\w-]+)\)$/.exec(v || '') || [])[1];

test('the module exists and exports the layout, the mapping and the drawing', () => {
  assert.ok(existsSync(XY_URL), 'src/js/ui/synth/xy.js');
  for (const f of ['xyLayout', 'xyPosition', 'xyValue', 'xySvg']) {
    assert.equal(typeof xy[f], 'function', f);
  }
  assert.equal(xy.PUCK.r, 14, 'the puck is Ø28');
  assert.ok(Object.isFrozen(xy.PUCK) && Object.isFrozen(xy.XY), 'frozen geometry');
});

test('pure: imports only knob.js and led.js, no DOM, no listener, no timer, no animation', () => {
  const imports = [...SRC.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['./knob.js', './led.js']);
  assert.doesNotMatch(CODE, /\b(?:document|window|globalThis|getComputedStyle|addEventListener)\b/,
    'no DOM, no listener');
  assert.doesNotMatch(CODE, /\b(?:setTimeout|setInterval|requestAnimationFrame)\b/, 'no timer');
  assert.doesNotMatch(CODE, /<animate|\.animate\(|transition|animate-/, 'no animation');
  assert.match(SRC, /prefers-reduced-motion/, 'the header says where motion would be checked');
  assert.match(SRC, /not a (?:second|separate) (?:accessible )?slider/i,
    'the header says the puck is no second slider');
});

// ---------------------------------------------------------------- the layout

test('the layout: a square pad, the puck travel inside it, X under it, Y beside it, deep-frozen',
  () => {
    const L = xy.xyLayout();
    assert.equal(L.zoom, 1);
    assert.equal(L.size, xy.XY.size, 'the default side');
    assert.equal(L.pad.width, L.pad.height, 'square');
    assert.equal(L.pad.width, L.size);
    assert.equal(L.puck.r, 14);
    assert.ok(L.puck.notch > 0 && L.puck.notch < L.puck.r, 'the notch is inside the cap');
    // The puck, its edge stroke included, stays inside the surface's frame at every position.
    const reach = L.puck.r + L.puck.edgeW / 2;
    assert.ok(L.travel.x - reach >= L.pad.x && L.travel.y - reach >= L.pad.y);
    assert.ok(L.travel.x + L.travel.width + reach <= L.pad.x + L.pad.width);
    assert.ok(L.travel.y + L.travel.height + reach <= L.pad.y + L.pad.height);
    assert.equal(L.faders.x.orientation, 'horizontal');
    assert.equal(L.faders.y.orientation, 'vertical');
    const { pad } = L;
    assert.ok(L.faders.x.at.y > pad.y + pad.height, 'X is under the pad');
    assert.equal(L.faders.x.at.x, pad.x + pad.width / 2, 'centred under it');
    assert.ok(L.faders.y.at.x > pad.x + pad.width, 'Y is beside the pad');
    assert.equal(L.faders.y.at.y, pad.y + pad.height / 2, 'centred beside it');
    for (const axis of ['x', 'y']) {
      const f = L.faders[axis];
      const b = controlBox('fader', f.orientation);
      assert.deepEqual({ ...f.box }, { x: f.at.x + b.x, y: f.at.y + b.y, width: b.width,
        height: b.height }, `${axis}: knob.js's controlBox, placed`);
    }
    assert.ok(L.led.at.x > pad.x + pad.width && L.led.at.y > pad.y + pad.height,
      'the gate LED sits in the corner between the faders');
    const deep = (o) => Object.isFrozen(o) && Object.values(o).every((v) => typeof v !== 'object'
      || v === null || deep(v));
    assert.ok(deep(L), 'deep-frozen');
  });

test('every hit box is 44 screen px or more and none overlaps, at zoom 0.25 to 2.5', () => {
  for (const size of [xy.XY.min, xy.XY.size, 240]) {
    for (const zoom of [...ZOOMS, 0.5, 1, 2, 2.5]) {
      const L = xy.xyLayout({ size, zoom });
      const at = `size ${size} zoom ${zoom}`;
      const hits = Object.entries(L.hits);
      assert.deepEqual(hits.map(([k]) => k).sort(), ['pad', 'x', 'y'], at);
      for (const [k, h] of hits) {
        assert.ok(h.width * zoom >= HIT_PX - 1e-9 && h.height * zoom >= HIT_PX - 1e-9,
          `${at}: ${k} is ${h.width * zoom} x ${h.height * zoom} screen px`);
        assert.ok(inside(h, L.box), `${at}: ${k} inside the box`);
      }
      for (let i = 0; i < hits.length; i++) {
        for (let j = i + 1; j < hits.length; j++) {
          assert.ok(!overlap(hits[i][1], hits[j][1]), `${at}: ${hits[i][0]} / ${hits[j][0]}`);
        }
      }
      assert.deepEqual({ ...L.hits.pad }, { ...L.pad }, `${at}: the surface is the pad's hit`);
      for (const axis of ['x', 'y']) {
        assert.ok(inside(L.faders[axis].box, L.hits[axis]), `${at}: ${axis} hit holds the fader`);
      }
      const lb = ledBox({ at: L.led.at, zoom, label: xy.XY.ledLabel });
      assert.deepEqual({ ...L.led.box }, { ...lb }, `${at}: led.js's box`);
      assert.ok(inside(lb, L.box), `${at}: the LED inside the box`);
      for (const [k, h] of hits) assert.ok(!overlap(lb, h), `${at}: the LED clear of ${k}`);
      // The drawn hit rects are the layout's.
      const svg = SVG({ size, zoom });
      const drawn = [...svg.matchAll(/<rect\b[^>]*\sdata-hit=""[^>]*>/g)].map((m) => m[0]);
      assert.equal(drawn.length, 3, `${at}: three hit rects`);
      const padHit = rectOf(drawn.find((r) => /data-xy-hit="pad"/.test(r)));
      assert.deepEqual(padHit, { ...L.hits.pad }, `${at}: pad hit drawn`);
      for (const axis of ['x', 'y']) {
        const g = slice(svg, `data-xy-axis="${axis}"`);
        const r = rectOf(part(g, 'data-hit'));
        const { at: c } = L.faders[axis];
        const placed = { x: Number((c.x + r.x).toFixed(6)), y: Number((c.y + r.y).toFixed(6)),
          width: r.width, height: r.height };
        assert.deepEqual(placed, { ...L.hits[axis] }, `${at}: ${axis} hit drawn`);
      }
    }
  }
});

test('the pad grows with the 44 px rule below zoom 1 and refuses a size or zoom it cannot draw',
  () => {
    const L = xy.xyLayout({ size: xy.XY.min, zoom: ZOOM_MIN });
    assert.ok(L.size * ZOOM_MIN >= HIT_PX, 'grown to 44 screen px');
    assert.equal(xy.xyLayout({ size: 200, zoom: 1 }).size, 200, 'kept when it holds');
    for (const size of [xy.XY.min - 1, 0, -10, Number.NaN, Infinity, '160']) {
      assert.throws(() => xy.xyLayout({ size }), RangeError, `size ${size}`);
    }
    for (const zoom of [0, -1, Number.NaN, Infinity]) {
      assert.throws(() => xy.xyLayout({ zoom }), RangeError, `zoom ${zoom}`);
    }
  });

// ---------------------------------------------------------------- the mapping

test('xyPosition: 0 at the left and the bottom (y up), 1 at the right and the top, clamped', () => {
  const L = xy.xyLayout();
  const { travel: t } = L;
  const right = t.x + t.width;
  const bottom = t.y + t.height;
  assert.deepEqual(xy.xyPosition({ x: 0, y: 0, layout: L }), { px: t.x, py: bottom });
  assert.deepEqual(xy.xyPosition({ x: 1, y: 1, layout: L }), { px: right, py: t.y });
  assert.deepEqual(xy.xyPosition({ x: 0.5, y: 0.5, layout: L }),
    { px: t.x + t.width / 2, py: t.y + t.height / 2 });
  assert.deepEqual(xy.xyPosition({ x: -3, y: 9, layout: L }), { px: t.x, py: t.y }, 'clamped');
  assert.deepEqual(xy.xyPosition({ x: Infinity, y: -Infinity, layout: L }),
    { px: right, py: bottom });
  assert.deepEqual(xy.xyPosition({ x: Number.NaN, y: Number.NaN, layout: L }),
    { px: t.x, py: bottom }, 'NaN reads 0');
  assert.ok(xy.xyPosition({ x: 0, y: 0.2, layout: L }).py
    > xy.xyPosition({ x: 0, y: 0.8, layout: L }).py, 'more Y is higher on screen');
  assert.throws(() => xy.xyPosition({ x: '0.5', y: 0, layout: L }), TypeError);
  assert.throws(() => xy.xyPosition({ x: 0, y: 0 }), TypeError, 'no layout');
});

test('xyValue: the pointer in graph units back to 0..1, y up, clamped to the travel', () => {
  const L = xy.xyLayout();
  const { travel: t } = L;
  assert.deepEqual(xy.xyValue({ px: t.x, py: t.y + t.height, layout: L }), { x: 0, y: 0 });
  assert.deepEqual(xy.xyValue({ px: t.x + t.width, py: t.y, layout: L }), { x: 1, y: 1 });
  assert.deepEqual(xy.xyValue({ px: -500, py: 9000, layout: L }), { x: 0, y: 0 }, 'clamped');
  assert.deepEqual(xy.xyValue({ px: 9000, py: -500, layout: L }), { x: 1, y: 1 });
  assert.deepEqual(xy.xyValue({ px: L.pad.x, py: L.pad.y, layout: L }), { x: 0, y: 1 },
    'the frame inside the travel inset reads the end');
  assert.throws(() => xy.xyValue({ px: null, py: 0, layout: L }), TypeError);
  assert.throws(() => xy.xyValue({ px: 0, py: 0, layout: {} }), TypeError);
});

test('the mapping round-trips exactly over a grid, both ways, at every size and zoom', () => {
  let n = 0;
  for (const size of [xy.XY.min, 120, xy.XY.size, 200, 333]) {
    for (const zoom of [0.25, 0.5, 1, 1.45, 2, 2.5]) {
      const L = xy.xyLayout({ size, zoom });
      for (let i = 0; i <= 40; i++) {
        for (let j = 0; j <= 40; j += 5) {
          const v = { x: i / 40, y: j / 40 };
          const p = xy.xyPosition({ ...v, layout: L });
          assert.deepEqual(xy.xyValue({ ...p, layout: L }), v, `${size}@${zoom} ${i}/${j}`);
          n += 1;
        }
      }
      const { travel: t } = L;
      for (let px = Math.ceil(t.x); px <= t.x + t.width; px += 3) {
        for (let py = Math.ceil(t.y); py <= t.y + t.height; py += 7) {
          const v = xy.xyValue({ px, py, layout: L });
          assert.deepEqual(xy.xyPosition({ ...v, layout: L }), { px, py },
            `${size}@${zoom} (${px}, ${py})`);
          n += 1;
        }
      }
    }
  }
  assert.ok(n > 10000, `${n} round trips`);
});

// ---------------------------------------------------------------- the drawing

test('the pad is a group with a name; the puck is drawn, hidden, and is no second slider', () => {
  const svg = SVG();
  const g = open(svg);
  assert.match(g, /^<g data-xy=""/);
  assert.equal(attrOf(g, 'role'), 'group');
  assert.equal(attrOf(g, 'aria-label'), 'XY pad: X Pitch, Y Cutoff');
  assert.equal(attrOf(open(SVG({ label: 'XY "pad" <1>' })), 'aria-label'),
    'XY &quot;pad&quot; &lt;1&gt;', 'a given label, escaped');
  const pad = slice(svg, 'data-xy-pad=""');
  assert.ok(pad, 'the drawing');
  assert.equal(attrOf(open(pad), 'aria-hidden'), 'true');
  assert.equal(attrOf(open(pad), 'pointer-events'), 'none');
  assert.doesNotMatch(pad, /role=|tabindex=/, 'the puck and the surface carry no role');
  assert.equal((svg.match(/role="slider"/g) || []).length, 2, 'two sliders: the axis faders');
  assert.match(SRC, /^\/\/.*puck/im);
});

test('the surface is in surface tokens with a 3:1 frame; the grid is text-dim at hw-texture', () => {
  const svg = SVG();
  const L = xy.xyLayout();
  const s = part(svg, 'data-surface');
  assert.deepEqual(rectOf(s), { ...L.pad });
  assert.equal(attrOf(s, 'fill'), TOKENS.surface.card, 'surface-2, not bg-gray-900');
  assert.equal(attrOf(s, 'stroke'), TOKENS.control.edge, 'a 3:1 frame');
  assert.doesNotMatch(svg, /bg-gray|gray-900|class="[^"]*\bbg-/, 'no Pro background class');
  const grid = part(svg, 'data-grid');
  assert.equal(attrOf(grid, 'class'), 'opacity-hw-texture');
  assert.equal(attrOf(grid, 'stroke'), TOKENS.text.dim);
  assert.equal(attrOf(grid, 'fill'), 'none');
  // An integer axis of 15 values draws a line at each value; a number axis eight divisions.
  const lines = (d) => (d.match(/M/g) || []).length;
  assert.equal(lines(attrOf(grid, 'd')), 15 + 9);
  const g2 = part(SVG({ params: { x: PY, y: PY }, x: 100 }), 'data-grid');
  assert.equal(lines(attrOf(g2, 'd')), 9 + 9);
  const recess = part(svg, 'data-recess');
  assert.equal(attrOf(recess, 'class'), 'opacity-hw-shadow', 'the recess at hw-shadow');
});

test('the puck: Ø28 cap, --osc-text edge, control.pointer crosshair notch, where the value is',
  () => {
    const L = xy.xyLayout();
    for (const [vx, vy] of [[0, 20], [14, 20000], [3, 440], [7, 1000], [-5, 1e6]]) {
      const svg = SVG({ x: vx, y: vy });
      const cap = part(svg, 'data-puck-cap');
      const want = xy.xyPosition({ x: toNorm(vx, PX), y: toNorm(vy, PY), layout: L });
      assert.equal(Number(attrOf(cap, 'cx')), Number(want.px.toFixed(2)), `cx at ${vx}`);
      assert.equal(Number(attrOf(cap, 'cy')), Number(want.py.toFixed(2)), `cy at ${vy}`);
      assert.equal(Number(attrOf(cap, 'r')), 14);
      assert.equal(attrOf(cap, 'fill'), TOKENS.control.cap);
      assert.equal(attrOf(cap, 'stroke'), 'var(--osc-text)', 'the --osc-text edge');
      const notch = part(svg, 'data-notch');
      assert.equal(attrOf(notch, 'stroke'), TOKENS.control.pointer);
      const d = attrOf(notch, 'd');
      assert.equal((d.match(/M/g) || []).length, 2, 'a crosshair: two strokes');
      const nums = d.match(/-?[\d.]+/g).map(Number);
      const cx = Number(attrOf(cap, 'cx'));
      const cy = Number(attrOf(cap, 'cy'));
      const far = Math.max(...nums.map((v, i) => Math.abs(v - (i % 2 ? cy : cx))));
      assert.ok(far < 14 && far >= 4, `the notch inside the cap (${far})`);
    }
    const shade = part(SVG(), 'data-puck-shadow');
    assert.equal(attrOf(shade, 'class'), 'opacity-hw-shadow');
    assert.equal(attrOf(part(SVG(), 'data-puck-sheen'), 'class'), 'opacity-hw-sheen');
  });

test('the gate LED is led.js\'s, bound to the caller\'s gate and source, at the layout\'s place',
  () => {
    for (const zoom of [0.5, 1, 2.5]) {
      for (const gate of [true, false]) {
        for (const source of ['node.xy.gate', 'xy "gate" <b>&']) {
          const L = xy.xyLayout({ zoom });
          const svg = SVG({ gate, source, zoom });
          const want = ledSvg({ at: L.led.at, lit: gate, source, tokens: TOKENS, zoom,
            label: xy.XY.ledLabel });
          assert.ok(svg.includes(want), `ledSvg's own markup (gate ${gate}, zoom ${zoom})`);
          assert.equal((svg.match(/data-led=""/g) || []).length, 1, 'one LED');
        }
      }
    }
    assert.match(CODE, /ledSvg\(\{[^}]*\bsource\b/, 'the source is passed through');
    assert.match(CODE, /lit: gate\b/, 'lit is the gate');
    for (const gate of [undefined, 1, 'true', null]) {
      assert.throws(() => SVG({ gate }), TypeError, `gate ${gate}`);
    }
    for (const source of [undefined, '', '  ']) {
      assert.throws(() => SVG({ source }), TypeError, `source ${source}`);
    }
  });

test('the axis faders are knob.js\'s, turned per axis, and carry ariaAttrs as sliders', () => {
  const format = { x: (v) => `degree ${v + 1}`, y: (v) => `${Math.round(v)} Hz` };
  for (const zoom of [0.5, 1, 2]) {
    const L = xy.xyLayout({ zoom });
    for (const [vx, vy] of [[3, 440], [0, 20], [14, 20000], [99, 5]]) {
      const svg = SVG({ x: vx, y: vy, zoom, format });
      for (const [axis, value, param] of [['x', vx, PX], ['y', vy, PY]]) {
        const g = slice(svg, `data-xy-axis="${axis}"`);
        const head = open(g);
        const f = L.faders[axis];
        assert.equal(attrOf(head, 'transform'), `translate(${f.at.x} ${f.at.y})`);
        assert.ok(g.includes(controlSvg({ kind: 'fader', value, param, tokens: TOKENS, zoom,
          state: {}, orientation: f.orientation })), `${axis}: controlSvg's fader`);
        const aria = ariaAttrs(value, param, format[axis]);
        for (const [k, v] of Object.entries(aria)) {
          assert.equal(attrOf(head, k), String(v), `${axis} ${k}`);
        }
        assert.equal(attrOf(head, 'aria-orientation'), f.orientation);
        assert.equal(attrOf(head, 'tabindex'), '0');
        assert.equal(attrOf(head, 'aria-label'), `${axis.toUpperCase()}: ${param.label}`);
        assert.equal(attrOf(head, 'aria-valuenow'),
          String(Math.round(toNorm(value, param) * 1000)), 'N003: the 0..1000 position');
      }
    }
  }
});

test('states: idle, touched, focus on one part, disabled', () => {
  const idle = SVG();
  assert.doesNotMatch(idle, /data-focus=""/, 'idle: no focus ring');
  assert.doesNotMatch(idle, /data-touched/);
  const L = xy.xyLayout();
  const dy = (svg) => Number(attrOf(part(svg, 'data-puck-shadow'), 'cy'))
    - Number(attrOf(part(svg, 'data-puck-cap'), 'cy'));
  assert.equal(dy(idle), xy.PUCK.shadowDy);
  const touched = SVG({ gate: true, state: { touched: true } });
  assert.match(open(slice(touched, 'data-xy-pad=""')), /data-touched=""/);
  assert.equal(dy(touched), xy.PUCK.touchedDy, 'the puck pressed: its shadow lifts');
  assert.equal(attrOf(open(slice(touched, 'data-led=""')), 'data-lit'), 'true', 'gate lit');
  // Focus rings only the focused part, in control.focus, 2 wide.
  const pf = SVG({ state: { focus: 'pad' } });
  const ring = part(slice(pf, 'data-xy-pad=""'), 'data-focus');
  assert.equal(attrOf(ring, 'stroke'), TOKENS.control.focus);
  assert.equal(Number(attrOf(ring, 'stroke-width')), 2);
  const r = rectOf(ring);
  assert.ok(r.x < L.pad.x && r.x + r.width > L.pad.x + L.pad.width, 'around the surface');
  assert.ok(r.x - 1 >= L.box.x && r.y - 1 >= L.box.y, 'its stroke inside the box');
  assert.equal((pf.match(/data-focus=""/g) || []).length, 1, 'one ring');
  for (const axis of ['x', 'y']) {
    const svg = SVG({ state: { focus: axis } });
    assert.equal((svg.match(/data-focus=""/g) || []).length, 1, `${axis}: one ring`);
    const g = slice(svg, `data-xy-axis="${axis}"`);
    const f = L.faders[axis];
    assert.ok(g.includes(controlSvg({ kind: 'fader', value: axis === 'x' ? 3 : 440,
      param: PARAMS[axis], tokens: TOKENS, state: { focus: true },
      orientation: f.orientation })), `${axis}: the fader's own ring`);
  }
  for (const focus of ['puck', 'z', 1, true]) {
    assert.throws(() => SVG({ state: { focus } }), TypeError, `focus ${focus}`);
  }
  const off = SVG({ state: { disabled: true } });
  assert.equal(attrOf(open(off), 'aria-disabled'), 'true');
  for (const axis of ['x', 'y']) {
    assert.equal(attrOf(open(slice(off, `data-xy-axis="${axis}"`)), 'aria-disabled'), 'true');
  }
  assert.equal(attrOf(part(off, 'data-notch'), 'stroke'), TOKENS.control.disabled);
  assert.ok(off.includes(controlSvg({ kind: 'fader', value: 3, param: PX, tokens: TOKENS,
    state: { disabled: true }, orientation: 'horizontal' })), 'the faders disabled');
  assert.doesNotMatch(off, /opacity-50|opacity="/, 'disabled by token, never by an opacity');
  assert.doesNotMatch(idle, /aria-disabled/);
  assert.throws(() => SVG({ state: { hover: true } }), TypeError, 'an unknown state key');
});

test('refusals: tokens, params, an axis that is not a number, a bad zoom', () => {
  assert.throws(() => SVG({ tokens: undefined }), TypeError);
  assert.throws(() => SVG({ tokens: { surface: TOKENS.surface } }), TypeError);
  assert.throws(() => SVG({ params: undefined }), TypeError);
  assert.throws(() => SVG({ params: { x: PX } }), TypeError);
  const e = { key: 'w', label: 'W', type: 'enum', options: [['a', 'A'], ['b', 'B']], default: 'a' };
  assert.throws(() => SVG({ params: { x: e, y: PY }, x: 'a' }), TypeError, 'an enum axis');
  assert.throws(() => SVG({ zoom: 0 }), RangeError);
});

// ---------------------------------------------------------------- v4

test('contrast from tokens.css in both themes: 3:1 for every graphic, 4.5:1 for the label',
  async () => {
    const themes = await tokenThemes();
    const svg = SVG({ gate: true, state: { focus: 'pad' } });
    const off = SVG({ state: { disabled: true } });
    const name = (svgText, attr, paint) => varName(attrOf(part(svgText, attr), paint));
    const surface = name(svg, 'data-surface', 'fill');
    const cap = name(svg, 'data-puck-cap', 'fill');
    const plates = ['--osc-surface-3', '--osc-surface-1'];
    const checks = [
      // [what, foreground token, the backgrounds it sits on, the minimum]
      ['the puck edge', name(svg, 'data-puck-cap', 'stroke'), [surface, cap], 3],
      ['the notch', name(svg, 'data-notch', 'stroke'), [cap], 3],
      ['the disabled notch', name(off, 'data-notch', 'stroke'), [cap], 3],
      ['the frame', name(svg, 'data-surface', 'stroke'), [surface, ...plates], 3],
      ['the guides', name(svg, 'data-guide', 'stroke'), [surface], 3],
      ['the focus ring', name(svg, 'data-focus', 'stroke'), [surface, ...plates], 3],
      ['the gate LED label', varName(attrOf(/<text\b[^>]*>/.exec(slice(svg, 'data-led=""'))[0],
        'fill')), plates, 4.5],
    ];
    assert.equal(surface, '--osc-surface-2');
    assert.equal(name(svg, 'data-puck-cap', 'stroke'), '--osc-text');
    const lines = [];
    for (const theme of ['dark', 'light']) {
      for (const [what, fg, bgs, min] of checks) {
        assert.ok(fg, `${what}: a token`);
        for (const bg of bgs) {
          const c = contrastOf(tokenHex(themes[theme], fg), tokenHex(themes[theme], bg));
          lines.push(`${theme} ${what} ${fg} on ${bg}: ${c.toFixed(2)}`);
          assert.ok(c >= min, `${theme}: ${what} ${fg} on ${bg} is ${c.toFixed(2)}:1 < ${min}`);
        }
      }
    }
    console.log(lines.join('\n'));
  });

test('no literal colour, opacity, alpha or shadow; every paint a token; 12 px font floor', () => {
  const tokens = new Set([...tokenValues(), 'none']);
  for (const zoom of [0.25, 0.5, 1, 1.45, 2, 2.5]) {
    for (const extra of [{}, { gate: true, state: { touched: true, focus: 'pad' } },
      { state: { disabled: true, focus: 'x' } }, { state: { focus: 'y' } }]) {
      const svg = SVG({ zoom, ...extra });
      const at = `zoom ${zoom} ${JSON.stringify(extra)}`;
      assert.deepEqual(colourLiterals(svg), [], at);
      assert.deepEqual(intensityLiterals(svg), [], at);
      assert.deepEqual(shapesWithoutStroke(svg), [], `${at}: every shape sets its stroke`);
      for (const p of paints(svg)) assert.ok(tokens.has(p), `${at}: paint ${p}`);
      for (const [, cls] of svg.matchAll(/\sclass="([^"]*)"/g)) {
        assert.match(cls, /^opacity-hw-(?:sheen|shadow|texture)$/, `${at}: class ${cls}`);
      }
      for (const [, size] of svg.matchAll(/\sfont-size="([^"]*)"/g)) {
        assert.ok(Number(size) * zoom >= 12 - 0.01, `${at}: ${size} at zoom ${zoom}`);
      }
      assert.doesNotMatch(svg, /<animate|transition|style=/, at);
    }
  }
  assert.deepEqual(intensityLiterals(CODE), [], 'the source');
  assert.doesNotMatch(CODE, /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i, 'no colour in the source');
});
