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
import { createRequire } from 'node:module';
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
/** The hw-* intensities the classes stand for (tailwind.config.cjs), for composite contrast. */
const HW = createRequire(import.meta.url)('../../tailwind.config.cjs').theme.extend.opacity;
/** `fg` at intensity `a` over `bg`, both #rrggbb, as the browser composites it. */
const over = (fg, bg, a) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16)
  * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
/** A fader's cap centre in the pad's graph units, from its drawn markup (rotate(90) for X). */
function capCentre(svg, axis) {
  const g = slice(svg, `data-xy-axis="${axis}"`);
  const [, tx, ty] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(open(g)).map(Number);
  const c = part(g, 'data-cap');
  const along = Number(attrOf(c, 'y')) + Number(attrOf(c, 'height')) / 2;
  return axis === 'x' ? { x: tx - along, y: ty } : { x: tx, y: ty + along };
}

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
      const b = controlBox('fader', f.orientation, { travel: f.travel });
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

test('the surface is in surface tokens, a 3:1 frame; the grid is text-dim at hw-texture', () => {
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
          state: {}, orientation: f.orientation, travel: f.travel })), `${axis}: controlSvg's`);
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
  assert.equal(dy(idle), xy.PUCK.shadow.dy);
  const touched = SVG({ gate: true, state: { touched: true } });
  assert.match(open(slice(touched, 'data-xy-pad=""')), /data-touched=""/);
  assert.equal(dy(touched), xy.PUCK.shadow.dy, 'the shadow stays: the face sinks instead');
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
      orientation: f.orientation, travel: f.travel })), `${axis}: the fader's own ring`);
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
    state: { disabled: true }, orientation: 'horizontal', travel: L.faders.x.travel })),
  'the faders disabled');
  // F013 S10 review: disabled dims the puck's edge and the frame, by token and dash.
  assert.equal(attrOf(part(off, 'data-puck-cap'), 'stroke'), TOKENS.control.disabled,
    'the puck edge in control.disabled');
  assert.equal(attrOf(part(idle, 'data-puck-cap'), 'stroke'), TOKENS.text.value);
  const frame = part(off, 'data-surface');
  assert.equal(attrOf(frame, 'stroke'), TOKENS.control.disabled, 'the frame in control.disabled');
  assert.ok(attrOf(frame, 'stroke-dasharray'), 'the frame dashed, as a disabled knob arc');
  assert.equal(attrOf(part(idle, 'data-surface'), 'stroke-dasharray'), undefined, 'idle solid');
  assert.equal(attrOf(part(off, 'data-puck-face'), 'fill'), TOKENS.control.cap,
    'the face goes blank');
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
    const face = name(svg, 'data-puck-face', 'fill');
    const offFace = name(off, 'data-puck-face', 'fill');
    const pressed = SVG({ gate: true, state: { touched: true } });
    const plates = ['--osc-surface-3', '--osc-surface-1'];
    const checks = [
      // [what, foreground token, the backgrounds it sits on, the minimum]
      // The edge and the ring lie on the skirt's rim, between the skirt and the surface.
      ['the puck edge', name(svg, 'data-puck-cap', 'stroke'), [surface, cap], 3],
      ['the pressed rim', name(pressed, 'data-puck-cap', 'stroke'), [surface, cap], 3],
      ['the notch', name(svg, 'data-notch', 'stroke'), [face], 3],
      ['the disabled notch', name(off, 'data-notch', 'stroke'), [offFace], 3],
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

// ---------------------------------------------------------------- F013 S10 review

test('the puck is a raised cap in both themes: a face 1.3:1 on the surface, the strongest shadow',
  async () => {
    const themes = await tokenThemes();
    const svg = SVG();
    const name = (attr, paint, s = svg) => varName(attrOf(part(s, attr), paint));
    const surface = name('data-surface', 'fill');
    const skirt = name('data-puck-cap', 'fill');
    const face = name('data-puck-face', 'fill');
    const shadow = name('data-puck-shadow', 'fill');
    assert.equal(attrOf(part(svg, 'data-puck-face'), 'stroke'), 'none');
    assert.ok(Number(attrOf(part(svg, 'data-puck-face'), 'r')) < xy.PUCK.r, 'a face in a skirt');
    const roles = [...new Set(tokenValues().map(varName).filter(Boolean))];
    const lines = [];
    for (const theme of ['dark', 'light']) {
      const hex = (n) => tokenHex(themes[theme], n);
      const bg = hex(surface);
      const c = (a, b) => contrastOf(hex(a), hex(b));
      lines.push(`${theme}: face ${face} on ${surface} ${c(face, surface).toFixed(2)}, on the `
        + `skirt ${skirt} ${c(face, skirt).toFixed(2)}; skirt on ${surface} `
        + `${c(skirt, surface).toFixed(2)}`);
      assert.ok(c(face, surface) >= 1.3, `${theme}: the face ${c(face, surface).toFixed(2)}:1`);
      assert.ok(c(face, skirt) >= 1.3, `${theme}: the face on its skirt`);
      // The shadow: drawn at hw-shadow, so its composite on the surface is what shows. It is the
      // strongest role that darkens the surface in both themes (a shadow never lightens).
      const comp = (n, t = theme) => contrastOf(over(tokenHex(themes[t], n),
        tokenHex(themes[t], surface), Number(HW['hw-shadow'])), tokenHex(themes[t], surface));
      const darker = (n) => ['dark', 'light'].every((t) => lum(tokenHex(themes[t], n))
        < lum(tokenHex(themes[t], surface)));
      assert.ok(darker(shadow), `${shadow} darkens the surface in both themes`);
      const best = Math.max(...roles.filter(darker).map((n) => comp(n)));
      assert.equal(comp(shadow), best, `${theme}: the strongest legal shadow`);
      lines.push(`${theme}: shadow ${shadow} at hw-shadow ${HW['hw-shadow']} on ${surface} `
        + `${comp(shadow).toFixed(3)} (opaque ${c(shadow, surface).toFixed(2)}); `
        + `the roles darker in both themes: ${roles.filter(darker).join(', ')}`);
      assert.ok(bg);
    }
    console.log(lines.join('\n'));
  });

// ---------------------------------------------------------------- F013 S10 review round 2

const capOf = (s) => part(s, 'data-puck-cap');
const faceR = (s) => Number(attrOf(part(s, 'data-puck-face'), 'r'));
/** The notch's half arm: its farthest point from the cap's centre along an axis. */
const notchArm = (s) => {
  const cx = Number(attrOf(capOf(s), 'cx'));
  const cy = Number(attrOf(capOf(s), 'cy'));
  const nums = attrOf(part(s, 'data-notch'), 'd').match(/-?[\d.]+/g).map(Number);
  return Math.max(...nums.map((v, i) => Math.abs(v - (i % 2 ? cy : cx))));
};
/** A role with no hue: its channels within 0x30 of each other in both themes. */
const neutralIn = (themes) => (n) => ['dark', 'light'].every((t) => {
  const h = tokenHex(themes[t], n);
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(...ch) - Math.min(...ch) <= 0x30;
});

test('touched reads pressed by geometry: the face sinks, more skirt shows, the rim stays',
  () => {
    for (let i = 50; i <= 250; i++) {
      const zoom = i / 100;
      const at = `zoom ${zoom}`;
      const idle = SVG({ zoom });
      const down = SVG({ zoom, gate: true, state: { touched: true } });
      const step = faceR(idle) - faceR(down);
      assert.equal(faceR(idle), xy.PUCK.face, `${at}: the idle face`);
      assert.ok(step >= 1.5 - 1e-9, `${at}: the face sinks ${step} graph units`);
      assert.ok(step * zoom >= 1.5 - 1e-9, `${at}: the face sinks ${step * zoom} screen px`);
      // The cap keeps its size, so the skirt's annulus grows by what the face gives up.
      const R = Number(attrOf(capOf(idle), 'r'));
      assert.equal(Number(attrOf(capOf(down), 'r')), R, `${at}: the cap keeps its size`);
      const skirt = (s) => Math.PI * (R ** 2 - faceR(s) ** 2);
      assert.ok(skirt(down) > skirt(idle), `${at}: more skirt shows`);
      // The rim is the same in both states: text.value, never cyan (the gate LED shows the gate).
      for (const k of ['stroke', 'stroke-width']) {
        assert.equal(attrOf(capOf(down), k), attrOf(capOf(idle), k), `${at}: the rim's ${k}`);
      }
      assert.equal(attrOf(capOf(down), 'stroke'), TOKENS.text.value);
      // The notch shortens with the face and stays on it.
      assert.ok(notchArm(down) < notchArm(idle), `${at}: the notch shortens`);
      assert.ok(Math.abs(notchArm(down) / faceR(down) - notchArm(idle) / faceR(idle)) <= 0.01,
        `${at}: in proportion to the face`);
      assert.ok(notchArm(down) < faceR(down), `${at}: the notch on the face`);
      // No pressed-shadow geometry: the shadow cannot be seen, so it does not move.
      assert.equal(part(down, 'data-puck-shadow'), part(idle, 'data-puck-shadow'), at);
    }
    // At zoom 1 the face goes from Ø20 to Ø17; far out it never sinks past half of itself.
    assert.equal(faceR(SVG({ gate: true, state: { touched: true } })), 8.5);
    for (const zoom of [0.25, 0.1, 0.01]) {
      const r = faceR(SVG({ zoom, gate: true, state: { touched: true } }));
      assert.ok(r >= xy.PUCK.face / 2 && r < xy.PUCK.face, `zoom ${zoom}: face ${r}`);
    }
    for (const state of [{ touched: true }, { touched: true, focus: 'pad' }, {}]) {
      const pad = slice(SVG({ gate: true, state }), 'data-xy-pad=""');
      assert.ok(!pad.includes(TOKENS.control.ring), `${JSON.stringify(state)}: no cyan on the pad`);
    }
    assert.equal(xy.PUCK.pressed, undefined, 'no pressed shadow');
    assert.equal(xy.PUCK.ringW, undefined, 'no pressed ring');
    const room = xy.XY.inset - xy.XY.frameW / 2;
    assert.ok(xy.PUCK.shadow.r + xy.PUCK.shadow.dy <= room, 'the shadow inside the frame');
    assert.ok(xy.PUCK.r + xy.PUCK.edgeW / 2 <= room, 'the rim inside the frame');
  });

test('no sheen on the puck in any state: the relief is skirt, face and rim', async () => {
  for (const zoom of [0.25, 0.5, 1, 2.5]) {
    for (const extra of [{}, { gate: true, state: { touched: true } },
      { state: { disabled: true } }, { gate: true, state: { disabled: true, touched: true } },
      { state: { focus: 'pad' } }]) {
      const pad = slice(SVG({ zoom, ...extra }), 'data-xy-pad=""');
      const at = `zoom ${zoom} ${JSON.stringify(extra)}`;
      assert.ok(pad.includes('data-puck-face'), `${at}: the puck is drawn`);
      assert.doesNotMatch(pad, /sheen|<ellipse/, `${at}: no sheen`);
    }
  }
  assert.equal(xy.PUCK.sheen, undefined);
  assert.doesNotMatch(CODE, /sheen/i, 'the code draws none');
  // The header says why, and the reason holds in tokens.css.
  assert.match(SRC, /no neutral role is lighter than the face in both themes/);
  assert.match(SRC, /the palette is locked/);
  assert.match(SRC, /relief comes from the skirt, the face and the rim/);
  const themes = await tokenThemes();
  const roles = [...new Set(tokenValues().map(varName).filter(Boolean))];
  const neutral = roles.filter(neutralIn(themes));
  assert.ok(neutral.includes('--osc-text') && neutral.includes('--osc-surface-1'), 'sanity');
  const face = varName(attrOf(part(SVG(), 'data-puck-face'), 'fill'));
  const lighter = neutral.filter((n) => ['dark', 'light'].every((t) => lum(tokenHex(themes[t], n))
    > lum(tokenHex(themes[t], face))));
  assert.deepEqual(lighter, [], 'no neutral role lighter than the face in both themes');
});

test('the face token: of the control roles, the one neutral under --osc-text at 1.3:1',
  async () => {
    const themes = await tokenThemes();
    const face = varName(attrOf(part(SVG(), 'data-puck-face'), 'fill'));
    const surface = varName(TOKENS.surface.card);
    const control = [...new Set(Object.values(TOKENS.control).map(varName))];
    const reach = control.filter(neutralIn(themes)).filter((n) => n !== '--osc-text')
      .filter((n) => ['dark', 'light'].every((t) => contrastOf(tokenHex(themes[t], n),
        tokenHex(themes[t], surface)) >= 1.3));
    assert.deepEqual(reach, [face]);
    assert.match(SRC, /of the control roles/);
    assert.doesNotMatch(SRC, /of the layer's neutral roles the only one/);
  });

test('the pad takes the keyboard: a focusable application surface; the gate read from its LED',
  () => {
    const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp',
      'PageDown', 'Enter', 'Escape'];
    for (const gate of [false, true]) {
      const svg = SVG({ gate });
      const h = /<rect\b[^>]*\sdata-xy-hit="pad"[^>]*>/.exec(svg)[0];
      assert.equal(attrOf(h, 'tabindex'), '0');
      assert.equal(attrOf(h, 'role'), 'application');
      assert.equal(attrOf(h, 'aria-roledescription'), 'XY pad');
      assert.equal(attrOf(h, 'aria-label'), 'XY pad: X Pitch, Y Cutoff');
      assert.equal(attrOf(h, 'aria-pressed'), undefined,
        'ARIA 1.2: aria-pressed is not allowed on role="application" (axe aria-allowed-attr)');
      assert.equal(attrOf(h, 'data-gate'), String(gate), 'the gate, for hosts');
      assert.equal(attrOf(h, 'aria-disabled'), undefined);
      const keys = attrOf(h, 'aria-keyshortcuts').split(' ');
      for (const k of KEYS) assert.ok(keys.includes(k), `aria-keyshortcuts names ${k}`);
      assert.deepEqual([...keys].sort(), [...KEYS].sort(), 'and no other');
      // The gate's accessible state: the labelled LED, outside the hidden drawing.
      const led = open(slice(svg, 'data-led=""'));
      assert.equal(attrOf(led, 'role'), 'img');
      assert.equal(attrOf(led, 'aria-label'), `Gate: ${gate ? 'on' : 'off'}`);
      assert.equal(attrOf(led, 'aria-hidden'), undefined);
      assert.ok(!slice(svg, 'data-xy-pad=""').includes('data-led'), 'not under aria-hidden');
    }
    assert.doesNotMatch(SVG({ gate: true, state: { touched: true } }), /aria-pressed/);
    const off = /<rect\b[^>]*\sdata-xy-hit="pad"[^>]*>/.exec(SVG({ state: { disabled: true } }))[0];
    assert.equal(attrOf(off, 'tabindex'), '-1', 'out of the tab order while disabled');
    assert.equal(attrOf(off, 'aria-disabled'), 'true');
    assert.equal(attrOf(/<rect\b[^>]*\sdata-xy-hit="pad"[^>]*>/.exec(SVG({ label: 'A "b"' }))[0],
      'aria-label'), 'A &quot;b&quot;');
    // The host owns the keys, as src/js/ui/kinds/xy-pad.js does; the core adds no listener.
    assert.match(SRC, /arrows? move the puck/i);
    assert.match(SRC, /Enter held opens the gate/);
    assert.match(SRC, /Escape ends the gesture/);
    assert.match(SRC, /xy-pad\.js/);
    assert.doesNotMatch(SRC, /aria-pressed the gate/);
    assert.doesNotMatch(CODE, /\b(?:addEventListener|onkey\w*|keydown|keyup)\b/);
  });

test('the box comment credits the 0.02 rounding, not the box formula', () => {
  assert.doesNotMatch(SRC, /box from the rounded edges themselves/);
  assert.match(SRC, /up\(\) rounds/);
});

test('every hit holds 44 screen px at every zoom 0.25 to 2.5 (step 0.01), inside the box', () => {
  for (const size of [xy.XY.min, xy.XY.size, 240]) {
    for (let i = 25; i <= 250; i++) {
      const zoom = i / 100;
      const L = xy.xyLayout({ size, zoom });
      const at = `size ${size} zoom ${zoom}`;
      const hits = Object.entries(L.hits);
      for (const [k, h] of hits) {
        assert.ok(h.width * zoom >= HIT_PX - 1e-9 && h.height * zoom >= HIT_PX - 1e-9,
          `${at}: ${k} is ${h.width * zoom} x ${h.height * zoom} screen px`);
        assert.ok(inside(h, L.box), `${at}: ${k} inside the box`);
      }
      for (let a = 0; a < hits.length; a++) {
        for (let b = a + 1; b < hits.length; b++) {
          assert.ok(!overlap(hits[a][1], hits[b][1]), `${at}: ${hits[a][0]} / ${hits[b][0]}`);
        }
      }
      assert.ok(inside(L.led.box, L.box), `${at}: the LED inside the box`);
      const svg = SVG({ size, zoom });
      for (const axis of ['x', 'y']) {
        const r = rectOf(part(slice(svg, `data-xy-axis="${axis}"`), 'data-hit'));
        const { at: c } = L.faders[axis];
        const drawn = { x: c.x + r.x, y: c.y + r.y, width: r.width, height: r.height };
        assert.ok(r.width * zoom >= HIT_PX - 1e-9 && r.height * zoom >= HIT_PX - 1e-9,
          `${at}: ${axis}'s drawn hit`);
        assert.ok(inside(drawn, L.box, 1e-9), `${at}: ${axis}'s drawn hit inside the box`);
      }
    }
  }
});

test('the mapping holds off the grid: 1e-11 of a position, 1e-9 graph units of a point', () => {
  const irrational = [1 / Math.PI, Math.SQRT2 - 1, 1 / Math.E, (Math.sqrt(5) - 1) / 2,
    Math.SQRT1_2, Math.PI / 4, Math.log(2), 0.1 + 0.2 - 0.3 + 1 / 3];
  let n = 0;
  for (const size of [xy.XY.min, xy.XY.size, 333]) {
    for (const zoom of [0.25, 0.73, 1, 2.5]) {
      const L = xy.xyLayout({ size, zoom });
      const { travel: t } = L;
      for (const a of irrational) {
        for (const b of irrational) {
          const v = xy.xyValue({ ...xy.xyPosition({ x: a, y: b, layout: L }), layout: L });
          assert.ok(Math.abs(v.x - a) <= 1e-11 && Math.abs(v.y - b) <= 1e-11,
            `${size}@${zoom} (${a}, ${b}) -> (${v.x}, ${v.y})`);
          const p = { px: t.x + a * t.width, py: t.y + b * t.height };
          const q = xy.xyPosition({ ...xy.xyValue({ ...p, layout: L }), layout: L });
          assert.ok(Math.abs(q.px - p.px) <= 1e-9 && Math.abs(q.py - p.py) <= 1e-9,
            `${size}@${zoom} (${p.px}, ${p.py}) -> (${q.px}, ${q.py})`);
          n += 1;
        }
      }
    }
  }
  assert.ok(n > 700, `${n} trips`);
  assert.match(SRC, /exact for grid values/);
  assert.match(SRC, /1e-11/);
  assert.match(SRC, /1e-9 graph units/);
  assert.doesNotMatch(SRC, /round-trip exactly \(/, 'no blanket exactness claim');
});

test('each axis fader travels as far as the puck, its cap beside or under the puck centre', () => {
  const vals = { x: [0, 3, 7, 14, -2, 99], y: [20, 100, 440, 1000, 20000, 1] };
  for (const size of [xy.XY.min, xy.XY.size, 240]) {
    for (const zoom of [0.25, 0.51, 1, 1.45, 2.5]) {
      const L = xy.xyLayout({ size, zoom });
      assert.equal(L.faders.x.travel, L.travel.width, `${size}@${zoom}: X's travel`);
      assert.equal(L.faders.y.travel, L.travel.height, `${size}@${zoom}: Y's travel`);
      for (let i = 0; i < vals.x.length; i++) {
        const svg = SVG({ size, zoom, x: vals.x[i], y: vals.y[i] });
        const puck = part(svg, 'data-puck-cap');
        const cx = Number(attrOf(puck, 'cx'));
        const cy = Number(attrOf(puck, 'cy'));
        const fx = capCentre(svg, 'x');
        const fy = capCentre(svg, 'y');
        const at = `${size}@${zoom} (${vals.x[i]}, ${vals.y[i]})`;
        assert.ok(Math.abs(fx.x - cx) <= 0.011, `${at}: X cap ${fx.x} under the puck ${cx}`);
        assert.ok(Math.abs(fy.y - cy) <= 0.011, `${at}: Y cap ${fy.y} beside the puck ${cy}`);
      }
    }
  }
});

test('xy.js and this test keep to 100 columns', () => {
  const own = readFileSync(new URL(import.meta.url), 'utf8');
  for (const [file, text] of [['xy.js', SRC], ['the test', own]]) {
    const long = text.split('\n').map((l, i) => [i + 1, l.length]).filter(([, n]) => n > 100);
    assert.deepEqual(long, [], `${file}: lines over 100 columns`);
  }
});
