// The shared synth-theme layer's cable renderer (src/js/ui/synth/cable.js; the seam agreed with
// dev-53 on 2026-11-02): CABLE_DASH, the signal type shown by pattern and never colour alone;
// cableCurve, a hanging cable from a to b whose sag goes down and grows with distance and slack;
// cableSvg and plugSvg, markup strings drawn from tokens with the pointer on the main stroke
// only. Pure: a node drag recomputes its own edges, nothing global (W2: 600 edges).
//   node --test tests/unit/ui-synth-cable.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CABLE_DASH, CABLE_MIN_SAG, REFUSED_DASH, cableCurve, cableSvg, plugSvg,
} from '../../src/js/ui/synth/cable.js';
import { TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues } from
  './ui-synth-fixture.mjs';

const NUM = '(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)';
const CURVE = new RegExp(`^M ${NUM} ${NUM} C ${NUM} ${NUM} ${NUM} ${NUM} ${NUM} ${NUM}$`);

/** The four points of a cableCurve path. */
function points(d) {
  const m = CURVE.exec(d);
  assert.ok(m, `not M x y C x1 y1 x2 y2 x y: ${d}`);
  const n = m.slice(1).map(Number);
  return [{ x: n[0], y: n[1] }, { x: n[2], y: n[3] }, { x: n[4], y: n[5] }, { x: n[6], y: n[7] }];
}
/** The cubic at t. */
function at(d, t) {
  const [p0, p1, p2, p3] = points(d);
  const u = 1 - t;
  const f = (k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k]
    + t * t * t * p3[k];
  return { x: f('x'), y: f('y') };
}
/** How far the curve hangs below its chord's midpoint. */
const sagOf = (a, b, opts) => at(cableCurve(a, b, opts), 0.5).y - (a.y + b.y) / 2;

const A = { x: 10.125, y: 20.5 };
const B = { x: 310.75, y: 80.25 };
const STATES = [{}, { hover: true }, { selected: true }, { dragging: true }, { refused: true },
  { selected: true, hover: true, refused: true }];
const TYPES = Object.keys(CABLE_DASH);
const draw = (extra = {}) => cableSvg({ id: 'c1', from: A, to: B, type: 'AUDIO',
  colour: TOKENS.cable.palette[2], tokens: TOKENS, ...extra });
const mainStroke = (svg) => /<path data-stroke=""[^>]*>/.exec(svg)[0];
const width = (el) => Number(/stroke-width="([^"]+)"/.exec(el)[1]);

// ---------------------------------------------------------------- CABLE_DASH

test('CABLE_DASH: audio solid, control, trigger and analysis each their own pattern', () => {
  assert.deepEqual(CABLE_DASH, { AUDIO: null, CONTROL: '9 6', TRIGGER: '2 6',
    ANALYSIS: '6 3 2 3' });
  assert.ok(Object.isFrozen(CABLE_DASH));
  assert.throws(() => { CABLE_DASH.AUDIO = '1 1'; }, TypeError);
  assert.ok(!Object.values(CABLE_DASH).includes(REFUSED_DASH), 'refused is not a type pattern');
});

// ---------------------------------------------------------------- cableCurve

test('cableCurve starts exactly at a and ends exactly at b', () => {
  for (const [a, b] of [[A, B], [B, A], [{ x: 0, y: 0 }, { x: -40, y: 300 }],
    [{ x: 1e-7, y: 3.333333333 }, { x: 1234567.891, y: -0.5 }]]) {
    const [p0, , , p3] = points(cableCurve(a, b));
    assert.deepEqual(p0, { x: a.x, y: a.y });
    assert.deepEqual(p3, { x: b.x, y: b.y });
  }
});

test('the sag goes down the screen (larger y), whichever end is higher', () => {
  for (const [a, b] of [[A, B], [B, A], [{ x: 0, y: 0 }, { x: 0, y: 200 }],
    [{ x: 0, y: 200 }, { x: 300, y: 0 }]]) {
    assert.ok(sagOf(a, b) > 0, `${JSON.stringify([a, b])}`);
  }
});

test('the sag grows with horizontal distance, vertical distance and slack', () => {
  const o = { x: 0, y: 0 };
  assert.ok(sagOf(o, { x: 300, y: 0 }) > sagOf(o, { x: 100, y: 0 }), 'horizontal');
  assert.ok(sagOf(o, { x: 0, y: 300 }) > sagOf(o, { x: 0, y: 100 }), 'vertical');
  assert.ok(sagOf(o, { x: 100, y: 100 }) > sagOf(o, { x: 100, y: 0 }), 'both');
  assert.ok(sagOf(o, { x: 300, y: 0 }, { slack: 0.4 }) > sagOf(o, { x: 300, y: 0 },
    { slack: 0.2 }), 'slack');
  const s = sagOf(o, { x: 400, y: 0 }, { slack: 0.25 });
  assert.ok(Math.abs(s - 100) < 1e-6, `slack x distance: ${s}`);
});

test('the sag never falls below the minimum, and a == b stays finite', () => {
  assert.ok(CABLE_MIN_SAG > 0);
  const near = sagOf({ x: 5, y: 5 }, { x: 6, y: 5 });
  assert.ok(Math.abs(near - CABLE_MIN_SAG) < 1e-6, `${near}`);
  assert.ok(sagOf(A, B, { slack: 0 }) >= CABLE_MIN_SAG - 1e-9, 'slack 0 still hangs');
  const d = cableCurve(A, A);
  assert.doesNotMatch(d, /NaN|Infinity/);
  const [p0, , , p3] = points(d);
  assert.deepEqual(p0, A);
  assert.deepEqual(p3, A);
  assert.ok(Math.abs(sagOf(A, A) - CABLE_MIN_SAG) < 1e-6);
});

test('the curve is symmetric: reversed ends draw the same cable, lowest at the middle', () => {
  const [p0, p1, p2, p3] = points(cableCurve(A, B));
  const [q0, q1, q2, q3] = points(cableCurve(B, A));
  assert.deepEqual([q0, q1, q2, q3], [p3, p2, p1, p0]);
  const mid = at(cableCurve({ x: 0, y: 0 }, { x: 200, y: 0 }), 0.5);
  assert.ok(Math.abs(mid.x - 100) < 1e-9);
  for (const t of [0.1, 0.3, 0.45, 0.55, 0.7, 0.9]) {
    assert.ok(at(cableCurve({ x: 0, y: 0 }, { x: 200, y: 0 }), t).y < mid.y, `t ${t}`);
  }
});

test('cableCurve refuses a non-finite end or slack', () => {
  assert.throws(() => cableCurve({ x: NaN, y: 0 }, B), /finite/);
  assert.throws(() => cableCurve(A, { x: 0 }), /finite/);
  assert.throws(() => cableCurve(A, B, { slack: Infinity }), /slack/);
  assert.throws(() => cableCurve(A, B, { slack: -0.1 }), /slack/);
});

// ---------------------------------------------------------------- cableSvg

test('cableSvg is one <g data-cable> with a shadow, the main stroke and its hit path', () => {
  const svg = draw();
  assert.match(svg, /^<g data-cable="c1" pointer-events="none">/);
  assert.ok(svg.endsWith('</g>'));
  const d = cableCurve(A, B);
  assert.equal(svg.split(`d="${d}"`).length - 1, 3, 'shadow, hit and main share the curve');
  assert.match(svg, new RegExp(`<path data-shadow=""[^>]*stroke="${
    TOKENS.cable.shadow.replace(/[()]/g, '\\$&')}"`));
  assert.ok(mainStroke(svg).includes(`stroke="${TOKENS.cable.palette[2]}"`), 'caller colour');
  assert.ok(!svg.includes('data-sheen'), 'no sheen unless asked');
});

test('the pointer reaches the main stroke group only', () => {
  for (const state of STATES) {
    const svg = draw({ state });
    assert.equal([...svg.matchAll(/pointer-events="stroke"/g)].length, 1);
    assert.match(svg, /<g data-main="" pointer-events="stroke">(?:(?!<\/g>).)*<path data-stroke/);
    assert.doesNotMatch(svg.replace(/<g data-main="" pointer-events="stroke">.*?<\/g>/, ''),
      /pointer-events="(?!none)/, 'nothing else takes the pointer');
  }
  const hit = /<path data-hit=""[^>]*>/.exec(draw())[0];
  assert.ok(width(hit) >= 20, 'a wide hit path');
  assert.equal(width(/<path data-hit=""[^>]*>/.exec(draw({ zoom: 2 }))[0]), width(hit) / 2,
    'the hit width is in screen px');
});

test('the signal type is shown by the dash pattern of the main stroke', () => {
  for (const type of TYPES) {
    const main = mainStroke(draw({ type }));
    if (CABLE_DASH[type] === null) assert.doesNotMatch(main, /stroke-dasharray/, type);
    else assert.ok(main.includes(`stroke-dasharray="${CABLE_DASH[type]}"`), type);
  }
  assert.throws(() => draw({ type: 'MIDI' }), /type/);
});

test('hover and selection thicken the stroke; refused is the refuse token and a dash', () => {
  const base = width(mainStroke(draw()));
  const hover = width(mainStroke(draw({ state: { hover: true } })));
  const selected = width(mainStroke(draw({ state: { selected: true } })));
  assert.ok(hover > base, `${hover} > ${base}`);
  assert.ok(selected > hover, `${selected} > ${hover}`);
  for (const type of TYPES) {
    const main = mainStroke(draw({ type, state: { refused: true } }));
    assert.ok(main.includes(`stroke="${TOKENS.jack.refuse}"`), type);
    assert.match(main, /stroke-dasharray="[^"]+"/, `${type}: refused is never colour alone`);
  }
  assert.ok(mainStroke(draw({ state: { refused: true } })).includes(
    `stroke-dasharray="${REFUSED_DASH}"`), 'a solid type refused takes the refused dash');
  assert.notEqual(draw({ state: { dragging: true } }), draw(), 'dragging lifts the shadow');
});

test('the sheen stripe is drawn only when asked, and takes no pointer', () => {
  const svg = draw({ sheen: true });
  const sheen = /<path data-sheen=""[^>]*>/.exec(svg)[0];
  assert.match(sheen, /pointer-events="none"/);
  assert.ok(width(sheen) < width(mainStroke(svg)));
});

test('no colour literal in any cable or plug; every paint is a token or none', () => {
  const allowed = new Set([...tokenValues(), 'none', 'currentColor']);
  for (const type of TYPES) {
    for (const state of STATES) {
      for (const sheen of [false, true]) {
        const svg = draw({ type, state, sheen });
        assert.deepEqual(colourLiterals(svg), [], `${type} ${JSON.stringify(state)}`);
        for (const p of paints(svg)) assert.ok(allowed.has(p), `paint ${p}`);
      }
    }
  }
  const plug = plugSvg({ at: B, colour: TOKENS.cable.palette[0], tokens: TOKENS });
  assert.deepEqual(colourLiterals(plug), []);
  for (const p of paints(plug)) assert.ok(allowed.has(p), `plug paint ${p}`);
});

test('every shape of a cable and a plug carries its own stroke attribute', () => {
  for (const state of STATES) {
    assert.deepEqual(shapesWithoutStroke(draw({ state, sheen: true })), [],
      JSON.stringify(state));
  }
  assert.deepEqual(shapesWithoutStroke(plugSvg({ at: A, colour: 'c', tokens: TOKENS })), []);
});

test('a cable id is escaped into its attribute; a missing colour reads currentColor', () => {
  assert.match(draw({ id: 'a"<b>&' }), /^<g data-cable="a&quot;&lt;b&gt;&amp;"/);
  assert.ok(mainStroke(draw({ colour: undefined })).includes('stroke="currentColor"'));
  assert.throws(() => cableSvg({ id: 'x', from: A, to: B, type: 'AUDIO', colour: 'c' }),
    /tokens/);
});

// ---------------------------------------------------------------- plugSvg

test('plugSvg is a seated plug at its point, with the cable colour, taking no pointer', () => {
  const plug = plugSvg({ at: { x: 12.5, y: -4 }, colour: TOKENS.cable.palette[1],
    tokens: TOKENS });
  assert.match(plug, /^<g data-plug="" pointer-events="none"/);
  assert.ok(plug.includes(`stroke="${TOKENS.cable.palette[1]}"`));
  assert.ok(/cx="12.5" cy="-4"/.test(plug));
  assert.doesNotMatch(plug, /pointer-events="(?!none)/);
  assert.throws(() => plugSvg({ at: { x: NaN, y: 0 }, colour: 'c', tokens: TOKENS }), /finite/);
});

// ---------------------------------------------------------------- purity and cost

test('cable.js is pure: no import from the Synth view, no DOM, no layout', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bimport\b[^;]*['"][^'"]*synth\/view/);
  assert.doesNotMatch(src, /document\.|window\.|addEventListener|getBoundingClientRect/);
});

test('600 cables: cableCurve plus cableSvg stay under 50 ms', (t) => {
  const edges = Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`,
    from: { x: (i * 37) % 1900, y: (i * 53) % 1100 }, to: { x: (i * 71) % 1900 + 5,
      y: (i * 29) % 1100 }, type: TYPES[i % 4], colour: TOKENS.cable.palette[i % 6] }));
  const run = () => {
    let bytes = 0;
    for (const e of edges) {
      bytes += cableCurve(e.from, e.to).length;
      bytes += cableSvg({ ...e, state: { hover: i0(e) }, tokens: TOKENS }).length;
    }
    return bytes;
  };
  const i0 = (e) => e.id === 'e0';
  run(); // warm
  const best = Math.min(...Array.from({ length: 5 }, () => {
    const t0 = performance.now();
    run();
    return performance.now() - t0;
  }));
  t.diagnostic(`600 cables: best of 5 runs ${best.toFixed(2)} ms (bound 50 ms)`);
  assert.ok(best < 50, `${best.toFixed(2)} ms`);
});
