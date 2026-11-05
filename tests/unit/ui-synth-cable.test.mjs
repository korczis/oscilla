// The shared synth-theme layer's cable renderer (src/js/ui/synth/cable.js; the seam agreed with
// dev-53 on 2026-11-02): a solid cord whose signal type is a pattern of heat-shrink bands near
// each plug (CABLE_BANDS, JC-6; CABLE_DASH stays the Signal Path grammar a caller may ask for),
// never colour alone; cableCurve, a hanging cable from a to b whose sag goes down and grows
// with distance and slack, and a vertical one bellies sideways (JC-14); cableSvg and plugSvg,
// markup strings drawn from tokens with the pointer on the main stroke only. Pure: a node drag
// recomputes its own edges, nothing global (W2: 600 edges).
//   node --test tests/unit/ui-synth-cable.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CABLE_DASH, CABLE_HIT_PX, CABLE_MAX_SAG, CABLE_MIN_SAG, CABLE_REACH, REFUSED_DASH, SETTLE_MS,
  cableCurve, cableDirections, cableParts, cableSag, cableSvg, plugSvg, settle,
} from '../../src/js/ui/synth/cable.js';
// S8's exports through the namespace, so the tests before them still run on a tree without them.
import * as CABLE from '../../src/js/ui/synth/cable.js';
import { SYNTH_TOKEN_NAMES, tokensFrom } from '../../src/js/ui/synth/tokens.js';
import { TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues, intensityLiterals,
  contrastOf, deltaLOf, intensityOf, overOf, tokenHex, tokenThemes } from './ui-synth-fixture.mjs';
import { PORT_VISUALS } from '../../src/js/studio/ports.js';

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
  assert.ok(sagOf(o, { x: 200, y: 0 }, { slack: 0.28 }) > sagOf(o, { x: 200, y: 0 },
    { slack: 0.2 }), 'slack');
  const s = sagOf(o, { x: 200, y: 0 }, { slack: 0.25 });
  assert.ok(Math.abs(s - 50) < 1e-6, `slack x distance: ${s}`);
});

/** The lowest point of a cableCurve path (largest y), sampled densely. */
const lowest = (d) => Math.max(...Array.from({ length: 2001 }, (_, i) => at(d, i / 2000).y));

test('a long cable hangs at most CABLE_MAX_SAG (90, S8) below its chord', () => {
  assert.equal(CABLE_MAX_SAG, 90);
  const o = { x: 0, y: 0 };
  for (const b of [{ x: 240, y: 0 }, { x: 1800, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 1200 }]) {
    for (const slack of [0.25, 0.4, 1]) {
      const s = sagOf(o, b, { slack });
      assert.ok(s <= CABLE_MAX_SAG + 1e-6, `${JSON.stringify(b)} slack ${slack}: sag ${s}`);
    }
  }
  const level = sagOf(o, { x: 1800, y: 0 });
  assert.ok(Math.abs(level - CABLE_MAX_SAG) < 1e-6, `a long level cable sags the most: ${level}`);
  assert.ok(sagOf(o, { x: 100, y: 0 }) < CABLE_MAX_SAG, 'a short one sags less');
});

test('given its viewBox, a cable never hangs below the box, however long', () => {
  const box = { x: 0, y: 0, width: 1900, height: 400 };
  const bottom = box.y + box.height;
  for (const [a, b] of [[{ x: 20, y: 380 }, { x: 1880, y: 380 }], [{ x: 20, y: 390 },
    { x: 1500, y: 300 }], [{ x: 300, y: 395 }, { x: 310, y: 395 }], [{ x: 0, y: 360 },
    { x: 1900, y: 400 }], [{ x: 40, y: 10 }, { x: 1200, y: 20 }]]) {
    const d = cableCurve(a, b, { box });
    const [p0, , , p3] = points(d);
    assert.deepEqual([p0, p3], [a, b], 'the ends do not move');
    const low = lowest(d);
    assert.ok(low <= bottom + 1e-6, `${JSON.stringify([a, b])}: lowest ${low} > ${bottom}`);
    assert.ok(sagOf(a, b, { box }) >= 0, 'and it still hangs down, or lies straight');
  }
  const free = [{ x: 40, y: 10 }, { x: 1200, y: 20 }];
  assert.equal(cableCurve(...free, { box }), cableCurve(...free), 'room enough: unchanged');
  const tight = [{ x: 20, y: 380 }, { x: 1880, y: 380 }];
  assert.ok(Math.abs(lowest(cableCurve(...tight, { box })) - bottom) < 0.01, 'it uses the room');
  const svg = draw({ from: tight[0], to: tight[1], box });
  assert.ok(svg.includes(`d="${cableCurve(...tight, { box })}"`), 'cableSvg passes the box on');
  assert.throws(() => cableCurve(A, B, { box: { x: 0, y: 0, width: 10, height: NaN } }), /box/);
});

test('the sag never falls below the minimum, and a == b stays finite', () => {
  assert.ok(CABLE_MIN_SAG > 0);
  const near = sagOf({ x: 5, y: 5 }, { x: 6, y: 5 });
  assert.ok(Math.abs(near - CABLE_MIN_SAG) < 1e-6, `${near}`);
  assert.ok(sagOf(A, B, { slack: 0 }) >= CABLE_MIN_SAG - 1e-6, 'slack 0 still hangs');
  const d = cableCurve(A, A);
  assert.doesNotMatch(d, /NaN|Infinity/);
  const [p0, , , p3] = points(d);
  assert.deepEqual(p0, A);
  assert.deepEqual(p3, A);
  assert.ok(Math.abs(sagOf(A, A) - CABLE_MIN_SAG) < 1e-6);
});

test('the curve is symmetric: reversed ends draw the same cable, lowest at the middle', () => {
  for (const [a, b] of [[A, B], [{ x: 0, y: 0 }, { x: 0, y: 200 }],
    [{ x: 0, y: 0 }, { x: 5, y: 300 }], [{ x: 40, y: 10 }, { x: 31, y: -90 }]]) {
    const [p0, p1, p2, p3] = points(cableCurve(a, b));
    const [q0, q1, q2, q3] = points(cableCurve(b, a));
    assert.deepEqual([q0, q1, q2, q3], [p3, p2, p1, p0], JSON.stringify([a, b]));
  }
  const mid = at(cableCurve({ x: 0, y: 0 }, { x: 200, y: 0 }), 0.5);
  assert.ok(Math.abs(mid.x - 100) < 1e-9);
  for (const t of [0.1, 0.3, 0.45, 0.55, 0.7, 0.9]) {
    assert.ok(at(cableCurve({ x: 0, y: 0 }, { x: 200, y: 0 }), t).y < mid.y, `t ${t}`);
  }
});

test('a near-vertical cable still hangs: it bows sideways, and the bow fades as it levels', () => {
  const bow = (a, b) => at(cableCurve(a, b), 0.5).x - (a.x + b.x) / 2;
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 0, y: 200 }], [{ x: 0, y: 0 }, { x: 5, y: 300 }],
    [{ x: 100, y: 400 }, { x: 96, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 30 }]]) {
    const d = cableCurve(a, b);
    assert.doesNotMatch(d, /NaN|Infinity/);
    assert.ok(Math.abs(bow(a, b)) >= 3, `${JSON.stringify([a, b])}: bow ${bow(a, b)}`);
    assert.ok(sagOf(a, b) > 0, 'and still down');
  }
  assert.ok(Math.abs(bow({ x: 0, y: 0 }, { x: 0, y: 200 }))
    > Math.abs(bow({ x: 0, y: 0 }, { x: 40, y: 200 })), 'less bow as the cable leans');
  assert.ok(Math.abs(bow({ x: 0, y: 0 }, { x: 200, y: 0 })) < 1e-6, 'a level cable: no bow');
  assert.ok(Math.abs(bow({ x: 0, y: 0 }, { x: 300, y: 80 })) < 1e-6, 'nor a long, shallow one');
  const [p0, , , p3] = points(cableCurve({ x: 0, y: 0 }, { x: 0, y: 200 }));
  assert.deepEqual([p0, p3], [{ x: 0, y: 0 }, { x: 0, y: 200 }], 'the ends do not move');
});

test('the bow is continuous: moving an end across the vertical never jumps the cable', () => {
  // The bow: the curve's middle less the chord's (which itself moves dx / 2).
  const midX = (dx) => at(cableCurve({ x: 0, y: 0 }, { x: dx, y: 200 }), 0.5).x - dx / 2;
  let prev = midX(-1);
  let lo = prev;
  let hi = prev;
  for (let i = -99; i <= 100; i++) {
    const x = midX(i / 100);
    assert.ok(Math.abs(x - prev) < 0.1, `dx ${i / 100}: ${prev} -> ${x}`);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
    prev = x;
  }
  assert.ok(hi - lo < 1, `the bow changes ${hi - lo} over dx -1..1`);
  const raw = (dx) => at(cableCurve({ x: 0, y: 0 }, { x: dx, y: 200 }), 0.5).x;
  assert.ok(Math.abs(raw(1) - raw(-1)) <= 1 + 1e-6, 'the midpoint moves no more than the chord');
  assert.ok(Math.abs(midX(0)) >= 3, 'and a vertical cable still bows');
  for (const dx of [-0.01, 0.01]) {
    const [p0, p1, p2, p3] = points(cableCurve({ x: 0, y: 0 }, { x: dx, y: 200 }));
    const [q0, q1, q2, q3] = points(cableCurve({ x: dx, y: 200 }, { x: 0, y: 0 }));
    assert.deepEqual([q0, q1, q2, q3], [p3, p2, p1, p0], 'independent of the order of the ends');
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
  assert.equal(svg.split(`d="${d}"`).length - 1, 4,
    'shadow, hit, rim and main share the curve; the shade and the sheen run beside it (review 7)');
  assert.match(svg, new RegExp(`<path data-shadow=""[^>]*stroke="${
    TOKENS.control.shade.replace(/[()]/g, '\\$&')}"`), 'the dark depth role (review 1)');
  assert.ok(mainStroke(svg).includes(`stroke="${TOKENS.cable.palette[2]}"`), 'caller colour');
  assert.ok(!draw({ sheen: false }).includes('data-sheen'), 'no sheen when told sheen: false');
});

test('the pointer reaches the main stroke group only', () => {
  for (const state of STATES) {
    const svg = draw({ state });
    assert.equal([...svg.matchAll(/pointer-events="stroke"/g)].length, 1);
    assert.match(svg, /<g data-main="" pointer-events="stroke">(?:(?!<\/g>).)*<path data-stroke/);
    assert.doesNotMatch(svg.replace(/<g data-main="" pointer-events="stroke">.*?<\/g>/, ''),
      /pointer-events="(?!none)/, 'nothing else takes the pointer');
  }
  assert.equal(CABLE_HIT_PX, 44);
  for (const zoom of [0.5, 1, 1.45, 2, 3]) {
    const hit = /<path data-hit=""[^>]*>/.exec(draw({ zoom }))[0];
    assert.equal(width(hit), 44, `zoom ${zoom}: 44 wide`);
    assert.match(hit, /\svector-effect="non-scaling-stroke"/,
      `zoom ${zoom}: the width is in screen px, whatever the zoom`);
  }
  for (const part of ['data-stroke', 'data-shadow']) {
    assert.doesNotMatch(new RegExp(`<path ${part}=""[^>]*>`).exec(draw())[0], /vector-effect/,
      `${part} scales with the drawing`);
  }
});

test('the hit path is hidden, not transparent: it takes the stroke through visibility', () => {
  for (const state of STATES) {
    const svg = draw({ state });
    const hit = /<path data-hit=""[^>]*>/.exec(svg)[0];
    assert.match(hit, /\svisibility="hidden"/, JSON.stringify(state));
    assert.doesNotMatch(hit, /opacity/, `${JSON.stringify(state)}: no opacity on the hit path`);
    // pointer-events="stroke" ignores visibility, so the hidden path still takes the pointer:
    // it sits in the main group, whose pointer-events="stroke" it inherits.
    assert.match(svg, /<g data-main="" pointer-events="stroke"><path data-hit=""/);
    assert.doesNotMatch(hit, /pointer-events="(?!stroke)/);
  }
});

const shadowOf = (svg) => /<path data-shadow=""[^>]*>/.exec(svg)[0];
const dropOf = (el) => {
  const m = /transform="translate\(([^ ]+) ([^)]+)\)"/.exec(el);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

test('the soft shadow: the dark depth role at hw-shadow, wider, 3 screen px down, 6 lifted', () => {
  for (const state of STATES) {
    for (const zoom of [0.5, 1, 2, 3]) {
      const svg = draw({ state, zoom });
      const shadow = shadowOf(svg);
      const where = `${JSON.stringify(state)} at ${zoom}`;
      assert.ok(shadow.includes(`stroke="${TOKENS.control.shade}"`), `${where}: the depth role`);
      assert.match(shadow, /\sclass="opacity-hw-shadow"/, `${where}: the hw-shadow intensity`);
      assert.doesNotMatch(shadow, /opacity="|filter|style=/, `${where}: no literal intensity`);
      assert.ok(width(shadow) > width(mainStroke(svg)), `${where}: wider than the stroke`);
      assert.ok(svg.indexOf('data-shadow') < svg.indexOf('data-stroke'), `${where}: under it`);
      const [dx, dy] = dropOf(shadow);
      assert.equal(dx, 0, `${where}: straight down`);
      assert.ok(Math.abs(dy * zoom - (state.dragging ? 6 : 3)) < 1e-5,
        `${where}: the offset is in screen px (${dy} graph units)`);
    }
  }
  assert.ok(dropOf(shadowOf(draw({ state: { dragging: true } })))[1]
    > dropOf(shadowOf(draw()))[1], 'dragging lifts the shadow');
});

test('JC-6: every cord is solid; a caller\'s own dash still dashes it', () => {
  for (const type of TYPES) {
    const main = mainStroke(draw({ type }));
    assert.doesNotMatch(main, /stroke-dasharray/, `${type}: a solid cord`);
    assert.equal(linecap(main), 'round', `${type}: round ends`);
    if (CABLE_DASH[type] !== null) {
      assert.ok(mainStroke(draw({ type, dash: CABLE_DASH[type] })).includes(
        `stroke-dasharray="${CABLE_DASH[type]}"`), `${type}: the Signal Path grammar on request`);
    }
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
    assert.match(main, /stroke-dasharray="[^"]+"/, `${type}: a refused cable is dashed`);
  }
  assert.ok(mainStroke(draw({ state: { refused: true } })).includes(
    `stroke-dasharray="${REFUSED_DASH}"`), 'a solid type refused takes the refused dash');
  assert.notEqual(draw({ state: { dragging: true } }), draw(), 'dragging lifts the shadow');
});

const linecap = (el) => /stroke-linecap="([^"]+)"/.exec(el)[1];
const dasharray = (el) => {
  const m = /stroke-dasharray="([^"]+)"/.exec(el);
  return m ? m[1].split(/[\s,]+/).map(Number) : null;
};
const WIDTH_STATES = [{}, { hover: true }, { selected: true }, { selected: true, hover: true }];

test('dashed strokes have butt caps, so every visible gap is at least 2 graph units', () => {
  for (const type of TYPES) {
    for (const st of WIDTH_STATES) {
      for (const refused of [false, true]) {
        const state = { ...st, refused };
        for (const dash0 of [undefined, CABLE_DASH[type]]) {
        const main = mainStroke(draw({ type, state, dash: dash0 }));
        const dash = dasharray(main);
        const where = `${type} ${JSON.stringify(state)}`;
        if (dash === null) {
          assert.equal(linecap(main), 'round', `${where}: a solid stroke is round`);
          continue;
        }
        assert.equal(linecap(main), 'butt', `${where}: a dashed stroke is butt`);
        const w = width(main);
        const cap = linecap(main) === 'butt' ? 0 : w;
        const list = dash.length % 2 ? [...dash, ...dash] : dash;
        for (let i = 0; i < list.length; i += 2) {
          assert.ok(list[i] + cap > 0, `${where}: dash ${list[i]} at width ${w}`);
          assert.ok(list[i + 1] - cap >= 2, `${where}: gap ${list[i + 1]} at width ${w}`);
        }
        }
      }
    }
  }
  assert.equal(linecap(mainStroke(draw({ type: 'AUDIO' }))), 'round');
});

test('a dash a caller asks for is kept when hovered and selected', () => {
  for (const type of TYPES.filter((t) => CABLE_DASH[t] !== null)) {
    for (const state of WIDTH_STATES) {
      const main = mainStroke(draw({ type, state, dash: CABLE_DASH[type] }));
      assert.ok(main.includes(`stroke-dasharray="${CABLE_DASH[type]}"`),
        `${type} ${JSON.stringify(state)}: ${main}`);
    }
  }
});

test('a refused cable differs from a normal one by shape, not by colour alone', () => {
  const shape = (svg) => svg.replace(/\sstroke="[^"]*"/g, '').replace(/\sdata-[\w-]+="[^"]*"/g, '');
  for (const type of TYPES) {
    for (const st of [{}, { hover: true }, { selected: true }]) {
      const normal = draw({ type, state: st });
      const refused = draw({ type, state: { ...st, refused: true } });
      assert.notEqual(shape(refused), shape(normal), `${type} ${JSON.stringify(st)}: a shape`);
      assert.match(refused, /^<g data-cable="c1" data-refused=""/, type);
      assert.match(refused, /<g data-cross="" pointer-events="none"><line /, `${type}: a cross`);
      assert.doesNotMatch(normal, /data-refused|data-cross/, type);
    }
  }
  const refused = draw({ state: { refused: true } });
  const cross = /<g data-cross=""[^>]*>(.*?)<\/g>/.exec(refused);
  assert.ok(cross, 'a cross');
  const lines = [...cross[1].matchAll(
    /<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*>/g)];
  const marks = lines.filter((l) => l[0].includes(`stroke="${TOKENS.jack.refuse}"`));
  assert.equal(marks.length, 2, 'two strokes in jack.refuse');
  assert.ok(lines.filter((l) => !marks.includes(l)).every((l) => l[0].includes(
    `stroke="${TOKENS.cable.shadow}"`)), 'any underlay is the shadow token');
  for (const l of lines) {
    const [x1, y1, x2, y2] = l.slice(1).map(Number);
    assert.ok(Math.hypot(x2 - x1, y2 - y1) >= 6, 'large enough to read');
  }
});

/** The centre of the refused cross and how far its drawing reaches from it. */
function crossOf(svg) {
  const lines = [.../<g data-cross=""[^>]*>(.*?)<\/g>/.exec(svg)[1].matchAll(
    /<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*stroke-width="([^"]+)"/g)];
  const [x1, y1, x2, y2] = lines[0].slice(1, 5).map(Number);
  const c = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const reach = Math.max(...lines.map((l) => {
    const [a, b, e, f, w] = l.slice(1).map(Number);
    assert.ok(Math.abs((a + e) / 2 - c.x) < 1e-6 && Math.abs((b + f) / 2 - c.y) < 1e-6,
      'one centre');
    return Math.hypot(e - a, f - b) / 2 + w / 2;
  }));
  return { c, reach };
}

test('the refused cross sits at the target end, on the curve, clear of the plug', () => {
  const PLUG = CABLE.PLUG.room; // the most a plug reaches, seated or held, its shadow included
  for (const [from, to] of [[A, B], [B, A], [{ x: 0, y: 0 }, { x: 0, y: 200 }],
    [{ x: 0, y: 0 }, { x: 900, y: 40 }], [{ x: 50, y: 50 }, { x: 60, y: 50 }]]) {
    const svg = cableSvg({ id: 'r', from, to, type: 'CONTROL', colour: 'c', tokens: TOKENS,
      state: { refused: true } });
    const { c, reach } = crossOf(svg);
    const where = JSON.stringify([from, to]);
    const d = cableCurve(from, to);
    const samples = Array.from({ length: 40001 }, (_, i) => at(d, i / 40000));
    const onCurve = Math.min(...samples.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    assert.ok(onCurve < 0.05, `${where}: on the curve (${onCurve})`);
    const toEnd = Math.hypot(c.x - to.x, c.y - to.y);
    const farthest = Math.max(...samples.map((p) => Math.hypot(p.x - to.x, p.y - to.y)));
    if (farthest - reach >= PLUG) {
      assert.ok(toEnd - reach >= PLUG, `${where}: clear of the plug (${toEnd} - ${reach})`);
    } else {
      assert.ok(toEnd >= farthest - 0.05, `${where}: too short to clear it, so as far as it can`);
    }
    const chord = Math.hypot(to.x - from.x, to.y - from.y);
    if (chord > 100) {
      assert.ok(toEnd <= 31, `${where}: at the target end (${toEnd} from it)`);
      assert.ok(toEnd < Math.hypot(c.x - from.x, c.y - from.y), `${where}: nearer the target`);
    }
  }
});

test('the sheen stripe is drawn unless told not to (S8), and takes no pointer', () => {
  const svg = draw({ sheen: true });
  const sheen = /<path data-sheen=""[^>]*>/.exec(svg)[0];
  assert.match(sheen, /pointer-events="none"/);
  assert.ok(width(sheen) < width(mainStroke(svg)));
  assert.ok(sheen.includes(`stroke="${TOKENS.control.highlight}"`), 'the light depth role');
  assert.match(sheen, /\sclass="opacity-hw-sheen"/, 'the intensity is the hw-sheen key');
  assert.doesNotMatch(sheen, /opacity="|transform=/, 'no opacity attribute, no shift');
  const at2 = /<path data-sheen=""[^>]*>/.exec(draw({ sheen: true, zoom: 2 }))[0];
  assert.equal(/ d="([^"]+)"/.exec(at2)[1], / d="([^"]+)"/.exec(sheen)[1],
    'graph units: it scales with the cord, not the zoom');
  const dashed = /<path data-sheen=""[^>]*>/.exec(draw({ sheen: true, type: 'CONTROL',
    dash: CABLE_DASH.CONTROL }))[0];
  assert.equal(linecap(dashed), 'butt', 'a dashed sheen keeps the gaps too');
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
  assert.ok(plug.includes(`fill="${TOKENS.cable.palette[1]}"`), 'the boot: the cord colour');
  assert.match(plug, /<path data-boot="" d="M \S+ \S+ A 13\.5 13\.5 0 1 1 /, 'its cap');
  assert.doesNotMatch(plug, /pointer-events="(?!none)/);
  assert.throws(() => plugSvg({ at: { x: NaN, y: 0 }, colour: 'c', tokens: TOKENS }), /finite/);
});

// ---------------------------------------------------------------- purity and cost

test('no literal opacity, alpha or shadow in any cable, plug or cable.js itself (v4)', () => {
  for (const type of TYPES) {
    for (const state of STATES) {
      for (const sheen of [false, true]) {
        for (const zoom of [0.5, 1, 2]) {
          const svg = draw({ type, state, sheen, zoom });
          assert.deepEqual(intensityLiterals(svg), [], `${type} ${JSON.stringify(state)}`);
        }
      }
    }
  }
  assert.deepEqual(intensityLiterals(plugSvg({ at: B, colour: TOKENS.cable.palette[0],
    tokens: TOKENS })), [], 'plug');
  const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8');
  assert.deepEqual(intensityLiterals(src), [], 'cable.js source');
});

test('the intensity scan catches what it refuses', () => {
  for (const bad of ['stroke-opacity="0.35"', 'stroke-opacity="0"', 'fill-opacity=".6"',
    'opacity="1"', "flood-opacity='0.2'", 'stop-opacity="0.5"', 'style="opacity: 0.3"',
    'rgba(0, 0, 0, 0.3)', 'hsla(0 0% 0% / 0.3)', '#000', '#0a0b0c80', 'class="opacity-[0.3]"',
    'class="bg-black/50"', 'box-shadow: 0 1px 2px', 'filter: drop-shadow(0 1px 1px)',
    'class="shadow-[0_1px_2px]"', '<feDropShadow dx="0"/>']) {
    assert.notDeepEqual(intensityLiterals(bad), [], bad);
  }
  for (const ok of ['class="opacity-hw-sheen"', 'data-shadow=""', 'visibility="hidden"',
    `stroke="${TOKENS.cable.shadow}"`, 'url(#grain)', 'tokens.cable.shadow']) {
    assert.deepEqual(intensityLiterals(ok), [], ok);
  }
});

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

// ---------------------------------------------------------------- cableParts (plan S4 a)

/** An independent serialiser of a part list: the test's own, so cableSvg is checked against
 *  the records rather than against itself. */
function serialise(parts) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const kids = (key) => parts.filter((p) => p.parent === key);
  const one = (p) => {
    const attrs = Object.entries(p.attrs).map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
    const inner = kids(p.key);
    return inner.length ? `<${p.tag}${attrs}>${inner.map(one).join('')}</${p.tag}>`
      : `<${p.tag}${attrs}/>`;
  };
  return kids(null).map(one).join('');
}

const SPECS = [];
for (const type of TYPES) {
  for (const state of STATES) {
    for (const sheen of [false, true]) {
      for (const zoom of [0.5, 1, 2]) SPECS.push({ type, state, sheen, zoom });
    }
  }
}

test('cableParts: cableSvg is exactly the serialised parts, for every type, state and zoom', () => {
  assert.equal(typeof cableParts, 'function');
  const extra = [{ id: 'a"<b>&' }, { colour: undefined }, { box: { x: 0, y: 0, width: 400,
    height: 90 } }, { from: A, to: A }, { dash: '3 2', type: 'CONTROL' },
  { dash: null, type: 'TRIGGER', state: { refused: true } }, { port: 'diamond' },
  { port: { from: 'circle', to: 'triangle' } }, { dash: '5 2', type: 'MIDI' }];
  for (const s of [...SPECS, ...extra]) {
    const spec = { id: 'c1', from: A, to: B, type: 'AUDIO', colour: TOKENS.cable.palette[2],
      tokens: TOKENS, ...s };
    assert.equal(cableSvg(spec), serialise(cableParts(spec)), JSON.stringify(s));
  }
});

test('cableParts: an ordered, frozen list of { key, tag, attrs, parent }, parents first', () => {
  const parts = cableParts({ id: 'c1', from: A, to: B, type: 'CONTROL', tokens: TOKENS,
    colour: TOKENS.cable.palette[0], state: { refused: true }, sheen: true });
  assert.ok(Object.isFrozen(parts));
  const seen = new Set();
  for (const p of parts) {
    assert.deepEqual(Object.keys(p).sort(), ['attrs', 'key', 'parent', 'tag']);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.attrs), p.key);
    assert.ok(['g', 'path', 'line'].includes(p.tag), p.tag);
    assert.ok(p.parent === null || seen.has(p.parent), `${p.key}: its parent comes first`);
    assert.ok(!seen.has(p.key), `${p.key} is unique`);
    seen.add(p.key);
    for (const v of Object.values(p.attrs)) assert.equal(typeof v, 'string', `${p.key} ${v}`);
  }
  assert.equal(parts[0].parent, null);
  assert.equal(parts.filter((p) => p.parent === null).length, 1, 'one root');
  assert.deepEqual(parts.map((p) => p.key), ['cable', 'shadow', 'main', 'hit', 'edge', 'stroke',
    'shade', 'bands', 'band-from', 'band-to', 'cross',
    'cross-under-0', 'cross-under-1', 'cross-0', 'cross-1', 'sheen']);
});

test('cableParts: the keys are stable as the cable moves and changes state', () => {
  const keys = (s) => cableParts({ id: 'k', type: 'AUDIO', tokens: TOKENS, from: A, to: B,
    sheen: false, ...s }).map((p) => p.key);
  const base = keys({});
  assert.deepEqual(base, ['cable', 'shadow', 'main', 'hit', 'edge', 'stroke', 'shade', 'bands',
    'band-from', 'band-to']);
  for (const s of [{ from: B, to: A }, { state: { hover: true } }, { state: { selected: true } },
    { state: { dragging: true } }, { zoom: 3 }]) {
    assert.deepEqual(keys(s), base, JSON.stringify(s));
  }
  const refused = keys({ state: { refused: true } });
  assert.deepEqual(refused.slice(0, base.length), base, 'the cross adds parts, after the rest');
  assert.deepEqual(keys({ sheen: true }), [...base, 'sheen']);
});

/** Markup with each element's attributes in one order, so two drawings that set the same
 *  attributes in a different order (a DOM appends a new attribute last) read the same. */
const canon = (svg) => svg.replace(/<(\w+)((?: [\w:-]+="[^"]*")*)(\/?)>/g, (m, tag, attrs, end) =>
  `<${tag}${(attrs.match(/ [\w:-]+="[^"]*"/g) || []).sort().join('')}${end}>`);

/** A minimal keyed editor, as the doc tells one to work: per part, set every attribute the
 *  record carries (new or changed) and remove each one it no longer carries, attribute by
 *  attribute on the kept node; remove a part that left; insert a new part before the node of the
 *  next part of the same parent already drawn. `remove: false` is an editor that only sets. */
function keyedEditor({ remove = true } = {}) {
  const nodes = new Map();
  const root = { children: [] };
  const apply = (parts) => {
    const keep = new Set(parts.map((p) => p.key));
    for (const [key, n] of nodes) {
      if (!keep.has(key)) {
        n.up.children.splice(n.up.children.indexOf(n), 1);
        nodes.delete(key);
      }
    }
    parts.forEach((p, i) => {
      const up = p.parent === null ? root : nodes.get(p.parent);
      let n = nodes.get(p.key);
      if (!n) {
        n = { tag: p.tag, up, children: [], attrs: {} };
        const next = parts.slice(i + 1).find((q) => q.parent === p.parent && nodes.has(q.key));
        const at = next ? up.children.indexOf(nodes.get(next.key)) : up.children.length;
        up.children.splice(at, 0, n);
        nodes.set(p.key, n);
      }
      if (remove) {
        for (const k of Object.keys(n.attrs)) {
          if (!Object.hasOwn(p.attrs, k)) delete n.attrs[k]; // removeAttribute
        }
      }
      for (const [k, v] of Object.entries(p.attrs)) {
        if (n.attrs[k] !== v) n.attrs[k] = v; // setAttribute
      }
    });
  };
  const markup = (n) => {
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    return n.children.length ? `<${n.tag}${attrs}>${n.children.map(markup).join('')}</${n.tag}>`
      : `<${n.tag}${attrs}/>`;
  };
  return { apply, svg: () => root.children.map(markup).join('') };
}

/** Each state of a cable in turn through a keyed editor, against cableSvg after each. */
const EDITS = [
  [{ id: 'e', from: A, to: B, type: 'CONTROL', tokens: TOKENS, sheen: true },
    [{}, { refused: true }, { hover: true }, { refused: true, dragging: true }, {}]],
  // AUDIO is solid: refused adds stroke-dasharray to the stroke and data-refused to the cable,
  // and un-refusing must take both away again.
  [{ id: 'f', from: A, to: B, type: 'AUDIO', tokens: TOKENS, colour: TOKENS.cable.palette[1] },
    [{ refused: true }, {}, { refused: true, hover: true }, { hover: true }, { selected: true },
      {}]],
];

test('cableParts: a keyed editor that inserts a new part before the next key paints as markup',
  () => {
    const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8');
    assert.match(src, /insertBefore/, 'the doc says where a new part goes');
    assert.match(src, /removeAttribute/, 'the doc says an attribute the record left is removed');
    for (const [spec, states] of EDITS) {
      const ed = keyedEditor();
      for (const state of states) {
        ed.apply(cableParts({ ...spec, state }));
        assert.equal(canon(ed.svg()), canon(cableSvg({ ...spec, state })),
          `${spec.type} ${JSON.stringify(state)}`);
      }
    }
  });

test('cableParts: an editor that only sets attributes leaves an un-refused cable refused', () => {
  const [spec, states] = EDITS[1];
  const ed = keyedEditor({ remove: false });
  ed.apply(cableParts({ ...spec, state: states[0] }));
  ed.apply(cableParts({ ...spec, state: states[1] }));
  const svg = ed.svg();
  assert.notEqual(canon(svg), canon(cableSvg({ ...spec, state: states[1] })),
    'the editor test above would catch an editor that never removes');
  assert.match(svg, /data-refused=""/);
  assert.match(svg, /data-stroke=""[^>]*stroke-dasharray/);
});

test('cableParts: attribute values are raw strings (setAttribute), escaped only in markup', () => {
  const parts = cableParts({ id: 'a"<b>&', from: A, to: B, type: 'AUDIO', tokens: TOKENS });
  assert.equal(parts[0].attrs['data-cable'], 'a"<b>&');
  assert.match(cableSvg({ id: 'a"<b>&', from: A, to: B, type: 'AUDIO', tokens: TOKENS }),
    /^<g data-cable="a&quot;&lt;b&gt;&amp;"/);
  const stroke = parts.find((p) => p.key === 'stroke');
  assert.equal(stroke.attrs.d, cableCurve(A, B));
  assert.equal(stroke.attrs['stroke-width'], '8.5');
});

test('cableParts: the dash is an input; by default a cord is solid with its type\'s bands', () => {
  const parts = (s) => cableParts({ id: 'd', from: A, to: B, type: 'CONTROL', tokens: TOKENS,
    ...s });
  const stroke = (s) => parts(s).find((p) => p.key === 'stroke').attrs;
  assert.equal(stroke({})['stroke-dasharray'], undefined, 'the default: solid');
  assert.ok(parts({}).some((p) => p.key === 'bands'), 'with its bands');
  assert.equal(stroke({ dash: CABLE_DASH.CONTROL })['stroke-dasharray'], CABLE_DASH.CONTROL);
  for (const dash of [null, '3 2', CABLE_DASH.CONTROL]) {
    assert.ok(!parts({ dash }).some((p) => /^band/.test(p.key)),
      `${dash}: a caller's own dash is its grammar, with no bands`);
  }
  assert.equal(stroke({ dash: '3 2' })['stroke-dasharray'], '3 2');
  assert.equal(stroke({ dash: '3 2' })['stroke-linecap'], 'butt');
  assert.equal(stroke({ dash: null })['stroke-dasharray'], undefined, 'null is solid');
  assert.equal(stroke({ dash: null })['stroke-linecap'], 'round');
  assert.equal(stroke({ dash: null, state: { refused: true } })['stroke-dasharray'],
    REFUSED_DASH, 'a refused solid kind still shows by pattern');
  assert.equal(stroke({ type: 'MIDI', dash: '5 2' })['stroke-dasharray'], '5 2',
    'a kind CABLE_DASH does not know, with its dash');
  assert.throws(() => stroke({ type: 'MIDI' }), /type|dash/, 'an unknown kind needs its dash');
  for (const bad of ['', 'a b', '0 0', '-1 2', '1,,2', 3, {}, '1 NaN']) {
    assert.throws(() => stroke({ dash: bad }), /dash/, JSON.stringify(bad));
  }
  assert.equal(stroke({ dash: '4,2.5' })['stroke-dasharray'], '4,2.5', 'commas are SVG too');
});

test('cableParts: the port shape is an input, recorded on the cable for the port glyph', () => {
  const root = (port) => cableParts({ id: 'p', from: A, to: B, type: 'AUDIO', tokens: TOKENS,
    port })[0].attrs;
  assert.deepEqual(Object.keys(root(undefined)), ['data-cable', 'pointer-events'],
    'none passed: nothing added');
  assert.equal(root('diamond')['data-port-from'], 'diamond');
  assert.equal(root('diamond')['data-port-to'], 'diamond', 'one shape names both ends');
  const both = root({ from: 'circle', to: 'triangle' });
  assert.deepEqual([both['data-port-from'], both['data-port-to']], ['circle', 'triangle']);
  assert.deepEqual(Object.keys(both), ['data-cable', 'data-port-from', 'data-port-to',
    'pointer-events']);
  for (const bad of ['', 'Circle', 'a b', '"x"', 7, { from: 'circle' }, { from: 1, to: 'x' }]) {
    assert.throws(() => root(bad), /port/, JSON.stringify(bad));
  }
});

test('cableSvg draws the JC cord it drew when its look was set (pinned)', () => {
  // Pinned before cableParts existed, again by S8 (cables like cables) and again by the look
  // audit's cords (JC-6, JC-13) and by their review (11-05): the sag of slack 0.3; the 8.5-wide
  // stroke in its 10 rim, the 10.5-wide shadow in the dark depth role 6 screen px down at zoom 2
  // (dragged); the shade 0.25 of the width away from the light, beside the cord in two cubics a
  // cubic; a refused cord dashed REFUSED_DASH; CONTROL's two bands 20 to 22.5 and 24.5 to 27
  // from each plug's centre, 5.1 wide inside the cord; the cross CROSS_BACK (30.2) from the
  // target; the sheen 0.3 of the width in the light depth role, 0.22 of it toward the light.
  const svg = cableSvg({ id: 'g1', from: { x: 10, y: 20 }, to: { x: 210, y: 60 },
    type: 'CONTROL', colour: TOKENS.cable.palette[1], tokens: TOKENS,
    state: { refused: true, dragging: true }, zoom: 2, sheen: true });
  const d = 'M 10 20 C 76.666667 114.917646 143.333333 128.250979 210 60';
  const ln = (x1, y1, x2, y2, s, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" `
    + `stroke="var(--osc-${s})" stroke-width="${w}" stroke-linecap="round"/>`;
  const arms = (s, w) => ln('182.392424', '75.017492', '192.392424', '85.017492', s, w)
    + ln('182.392424', '85.017492', '192.392424', '75.017492', s, w);
  const band = (end, d1, d2) => `<path data-band="${end}" d="M ${d1} M ${d2}" fill="none" `
    + 'stroke="var(--osc-bg)" stroke-width="5.1" stroke-linecap="butt"/>';
  const shade = 'M 8.261 21.221 C 41.764 68.922 75.735 96.502 109.583 103.272 C 143.548 110.065 '
    + '177.881 95.924 211.52 61.485';
  const sheen = 'M 11.53 18.925 C 44.714 66.171 77.487 92.779 110.367 99.355 C 143.145 105.91 '
    + '175.598 92.543 208.662 58.693';
  assert.equal(svg, '<g data-cable="g1" data-refused="" pointer-events="none">'
    + `<path data-shadow="" class="opacity-hw-shadow" d="${d}" fill="none" `
    + 'stroke="var(--osc-hw-shade)" stroke-width="10.5" stroke-linecap="round" '
    + 'transform="translate(0 3)"/>'
    + `<g data-main="" pointer-events="stroke"><path data-hit="" d="${d}" fill="none" `
    + 'stroke="currentColor" visibility="hidden" stroke-width="44" '
    + 'vector-effect="non-scaling-stroke" stroke-linecap="round"/>'
    + `<path data-edge="" d="${d}" fill="none" stroke="var(--osc-bg)" stroke-width="10" `
    + 'stroke-linecap="butt" stroke-dasharray="4 4"/>'
    + `<path data-stroke="" d="${d}" fill="none" stroke="var(--osc-red)" stroke-width="8.5" `
    + 'stroke-linecap="butt" stroke-dasharray="4 4"/></g>'
    + `<path data-shade="" class="opacity-hw-shadow" d="${shade}" fill="none" `
    + 'stroke="var(--osc-bg)" stroke-width="2.125" stroke-linecap="butt" '
    + 'stroke-dasharray="4 4" pointer-events="none"/>'
    + '<g data-bands="CONTROL" pointer-events="none">'
    + band('from', '21.899109 36.075174 L 23.44734 38.039375',
      '24.696427 39.602679 L 26.271213 41.546406')
    + band('to', '195.386278 73.654271 L 193.462798 75.256833',
      '191.907239 76.519745 L 189.941326 78.073451') + '</g>'
    + `<g data-cross="" pointer-events="none">${arms('bg', '4.5')}${arms('red', '2')}</g>`
    + `<path data-sheen="" class="opacity-hw-sheen" d="${sheen}" fill="none" `
    + 'stroke="var(--osc-hw-highlight)" stroke-width="2.55" stroke-linecap="butt" '
    + 'stroke-dasharray="4 4" pointer-events="none"/></g>');
});

test('cable.js writes markup in one place only: the serialiser of the parts', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8')
    .replace(/^\s*(?:\/\/|\/?\*).*$/gm, '').split('export function plugSvg')[0];
  const literals = src.match(/['`]<(?:path|line|g)\b/g) || [];
  assert.deepEqual(literals, [], 'no cable element written as a string');
});

// ---------------------------------------------------------------- port tangents (plan S4 b)

const SEG = new RegExp(`C ${NUM} ${NUM} ${NUM} ${NUM} ${NUM} ${NUM}`, 'g');
/** The cubic segments of a path 'M x y C … [C …]', each [p0, c1, c2, p3]. */
function segments(d) {
  const m = new RegExp(`^M ${NUM} ${NUM}((?: C ${NUM} ${NUM} ${NUM} ${NUM} ${NUM} ${NUM})+)$`)
    .exec(d);
  assert.ok(m, `not M x y C … : ${d}`);
  let p0 = { x: Number(m[1]), y: Number(m[2]) };
  return [...m[3].matchAll(SEG)].map((s) => {
    const n = s.slice(1).map(Number);
    const seg = [p0, { x: n[0], y: n[1] }, { x: n[2], y: n[3] }, { x: n[4], y: n[5] }];
    [, , , p0] = seg;
    return seg;
  });
}
/** Samples of a path, n per segment, its ends included. */
function sampled(d, n = 200) {
  const out = [];
  for (const [p0, p1, p2, p3] of segments(d)) {
    for (let i = out.length ? 1 : 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const f = (k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k]
        + t * t * t * p3[k];
      out.push({ x: f('x'), y: f('y') });
    }
  }
  return out;
}
const angle = (v, w) => {
  const c = (v.x * w.x + v.y * w.y) / (Math.hypot(v.x, v.y) * Math.hypot(w.x, w.y));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
/** The direction of travel leaving the start and arriving at the end. */
function endDirections(d) {
  const s = segments(d);
  const first = s[0];
  const last = s[s.length - 1];
  const lead = [first[1], first[2], first[3]].find((p) => Math.hypot(p.x - first[0].x,
    p.y - first[0].y) > 1e-9);
  const tail = [last[2], last[1], last[0]].find((p) => Math.hypot(p.x - last[3].x,
    p.y - last[3].y) > 1e-9);
  return { leave: sub(lead, first[0]), arrive: sub(last[3], tail) };
}
const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };
const EDGE = { from: RIGHT, to: LEFT }; // an output on a right edge to an input on a left edge

test('tangents: a forward edge leaves along its source port and enters along its target', () => {
  const cases = [];
  for (const dx of [40, 120, 400, 900]) {
    for (const dy of [-300, -40, 0, 25, 300]) {
      cases.push([{ x: 100, y: 200 }, { x: 100 + dx, y: 200 + dy }, EDGE]);
    }
  }
  cases.push([{ x: 0, y: 0 }, { x: 0, y: 200 }, { from: { x: 0, y: 2 }, to: { x: 0, y: -1 } }],
    [{ x: 0, y: 0 }, { x: 300, y: 10 }, { from: { x: 3, y: 1 }, to: { x: -1, y: -2 } }],
    [{ x: 0, y: 0 }, { x: -200, y: 50 }, { from: LEFT, to: RIGHT }]);
  for (const [a, b, tangents] of cases) {
    const d = cableCurve(a, b, { tangents });
    const s = segments(d);
    assert.deepEqual([s[0][0], s[s.length - 1][3]], [a, b], 'the ends are exact');
    const { leave, arrive } = endDirections(d);
    const where = JSON.stringify([a, b, tangents]);
    assert.ok(angle(leave, tangents.from) < 1, `${where}: leaves ${angle(leave, tangents.from)}`);
    const into = { x: -tangents.to.x, y: -tangents.to.y };
    assert.ok(angle(arrive, into) < 1, `${where}: enters ${angle(arrive, into)}`);
  }
});

test('tangents: without them the cable hangs as before (the default mode)', () => {
  for (const [a, b] of [[A, B], [B, A], [{ x: 0, y: 0 }, { x: 0, y: 300 }]]) {
    assert.equal(cableCurve(a, b, { tangents: undefined }), cableCurve(a, b));
    assert.equal(segments(cableCurve(a, b)).length, 1);
  }
  for (const b of [{ x: 300, y: 0 }, { x: -300, y: 0 }]) {
    assert.equal(segments(cableCurve(A, b, { tangents: EDGE })).length, 2,
      'an edge is always two cubics, so its path keeps its shape as it moves');
  }
});

/** Whether two segments of a polyline cross (not merely touch at a shared point). */
function crosses(p, q, r, s) {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
}

/** Backward edges: the target left of a rightward source, by at least one reach, out to a
 *  feedback edge across many node columns (a column is 168 wide), where a loop whose handles
 *  stopped growing hooked back over its target plug. */
const BACKWARD = [];
for (const back of [40, 60, 150, 400, 900, 1000, 1200, 1800, 3000]) {
  for (const dy of [-400, -120, -30, 0, 15, 60, 200, 500]) {
    BACKWARD.push([{ x: 500, y: 300 }, { x: 500 - back, y: 300 + dy }]);
  }
}
for (const [back, dy] of [[1000, 0], [1200, 572], [1200, -572], [2000, 1000], [1790, 30],
  [3000, -1000], [3000, 1000]]) {
  BACKWARD.push([{ x: 500, y: 300 }, { x: 500 - back, y: 300 + dy }]);
}

test('tangents: a backward edge is a smooth loop, finite, that never crosses itself', () => {
  for (const [a, b] of BACKWARD) {
    const d = cableCurve(a, b, { tangents: EDGE });
    const where = JSON.stringify([a, b]);
    assert.doesNotMatch(d, /NaN|Infinity/, where);
    const s = segments(d);
    assert.equal(s.length, 2, `${where}: a loop of two cubics`);
    const into = sub(s[0][3], s[0][2]);
    const out = sub(s[1][1], s[1][0]);
    assert.ok(angle(into, out) < 1, `${where}: smooth where the cubics meet`);
    const { leave, arrive } = endDirections(d);
    assert.ok(angle(leave, RIGHT) < 1 && angle(arrive, RIGHT) < 1, `${where}: along the ports`);
    const pts = sampled(d, 120);
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        assert.ok(!crosses(pts[i], pts[i + 1], pts[j], pts[j + 1]), `${where}: crosses at ${i}`);
      }
    }
  }
});

/** The blend into the loop ends by CABLE_REACH plus half the target's offset across the
 *  source port (dy for a rightward one); past it the cable is the loop alone. */
const looped = ([a, b]) => a.x - b.x >= CABLE_REACH + Math.abs(b.y - a.y) / 2;
const LOOPED = [...BACKWARD.filter(looped)];
for (const dy of [-2000, -1000, -600, -400, -120, -30, 0, 15, 60, 400, 600, 1000, 2000]) {
  LOOPED.push([{ x: 500, y: 300 }, { x: 500 - CABLE_REACH - Math.abs(dy) / 2, y: 300 + dy }]);
}

test('tangents: a backward loop stays clear of both its ends', () => {
  const CLEAR = CABLE_MIN_SAG;
  assert.ok(LOOPED.length > 70, `${LOOPED.length} looped cases`);
  for (const [a, b] of LOOPED) {
    const d = cableCurve(a, b, { tangents: EDGE });
    const pts = sampled(d, 400);
    let run = 0;
    const along = pts.map((p, i) => {
      if (i) run += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      return run;
    });
    for (let i = 0; i < pts.length; i++) {
      if (along[i] < 2 * CLEAR || run - along[i] < 2 * CLEAR) continue;
      for (const end of [a, b]) {
        const gap = Math.hypot(pts[i].x - end.x, pts[i].y - end.y);
        assert.ok(gap >= CLEAR, `${JSON.stringify([a, b])}: ${gap.toFixed(2)} from an end`);
      }
    }
    const low = Math.max(...pts.map((p) => p.y));
    assert.ok(low >= Math.max(a.y, b.y) + CLEAR, 'the loop passes below both ends');
  }
});

test('tangents: reversed ends with swapped tangents draw the same cable', () => {
  for (const [a, b] of [...BACKWARD.slice(0, 12), [{ x: 0, y: 0 }, { x: 300, y: 80 }],
    [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: -20, y: 100 }]]) {
    const one = sampled(cableCurve(a, b, { tangents: EDGE }), 100);
    const two = sampled(cableCurve(b, a, { tangents: { from: LEFT, to: RIGHT } }), 100).reverse();
    for (let i = 0; i < one.length; i++) {
      assert.ok(Math.hypot(one[i].x - two[i].x, one[i].y - two[i].y) < 1e-6,
        `${JSON.stringify([a, b])} at ${i}`);
    }
  }
});

/** A rotation of v by deg degrees, mirrored first when `mirror`. */
const turn = (v, deg, mirror = false) => {
  const r = (deg * Math.PI) / 180;
  const y = mirror ? -v.y : v.y;
  return { x: v.x * Math.cos(r) - y * Math.sin(r), y: v.x * Math.sin(r) + y * Math.cos(r) };
};

test('tangents: opposite ports in any direction keep the loop clear, uncrossed, reversible', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8');
  assert.match(src, /opposite/, 'the doc limits the clearance and reversal claims to them');
  const a = { x: 200, y: -100 };
  for (const deg of [0, 37, 90, 135, 180, 251, 300]) {
    for (const mirror of [false, true]) {
      const f = turn(RIGHT, deg, mirror);
      const tangents = { from: f, to: { x: -f.x, y: -f.y } };
      for (const [back, side] of [[40, 0], [150, 120], [900, -300], [1790, 30], [3000, 1000]]) {
        const off = turn({ x: -back, y: side }, deg, mirror);
        const b = { x: a.x + off.x, y: a.y + off.y };
        const where = JSON.stringify([deg, mirror, back, side]);
        const d = cableCurve(a, b, { tangents });
        const { leave, arrive } = endDirections(d);
        assert.ok(angle(leave, f) < 1 && angle(arrive, f) < 1, `${where}: along the ports`);
        const pts = sampled(d, 120);
        let run = 0;
        const along = pts.map((p, i) => {
          if (i) run += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
          return run;
        });
        for (let i = 0; i < pts.length - 1; i++) {
          if (along[i] >= 2 * CABLE_MIN_SAG && run - along[i] >= 2 * CABLE_MIN_SAG) {
            const gap = Math.min(Math.hypot(pts[i].x - a.x, pts[i].y - a.y),
              Math.hypot(pts[i].x - b.x, pts[i].y - b.y));
            assert.ok(gap >= CABLE_MIN_SAG, `${where}: ${gap.toFixed(2)} from an end`);
          }
          for (let j = i + 2; j < pts.length - 1; j++) {
            assert.ok(!crosses(pts[i], pts[i + 1], pts[j], pts[j + 1]), `${where}: crosses`);
          }
        }
        const back2 = sampled(cableCurve(b, a, { tangents: { from: tangents.to,
          to: tangents.from } }), 120).reverse();
        for (let i = 0; i < pts.length; i++) {
          assert.ok(Math.hypot(pts[i].x - back2[i].x, pts[i].y - back2[i].y) < 1e-6,
            `${where}: reversed differs at ${i}`);
        }
      }
    }
  }
});

test('tangents: any two port directions still leave and enter along them, finite', () => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 2000; i++) {
    const a = { x: rnd() * 2000 - 1000, y: rnd() * 2000 - 1000 };
    const b = { x: rnd() * 2000 - 1000, y: rnd() * 2000 - 1000 };
    const tangents = { from: turn(RIGHT, rnd() * 360), to: turn(RIGHT, rnd() * 360) };
    const d = cableCurve(a, b, { tangents });
    const where = JSON.stringify([a, b, tangents]);
    assert.doesNotMatch(d, /NaN|Infinity/, where);
    const { leave, arrive } = endDirections(d);
    assert.ok(angle(leave, tangents.from) < 1, `${where}: leaves`);
    assert.ok(angle(arrive, { x: -tangents.to.x, y: -tangents.to.y }) < 1, `${where}: enters`);
  }
});

test('tangents: sag and box belong to the hanging mode, refused beside tangents', () => {
  const box = { x: 0, y: 0, width: 800, height: 400 };
  for (const [opts, rx] of [[{ sag: -5 }, /sag/], [{ sag: 10 }, /sag/], [{ sag: 0 }, /sag/],
    [{ box }, /box/], [{ box, sag: 3 }, /sag|box/]]) {
    assert.throws(() => cableCurve(A, B, { tangents: EDGE, ...opts }), rx, JSON.stringify(opts));
    assert.throws(() => cableParts({ id: 't', from: A, to: B, type: 'AUDIO', tokens: TOKENS,
      tangents: EDGE, ...opts }), rx, `cableParts ${JSON.stringify(opts)}`);
  }
  for (const none of [{ sag: undefined }, { box: undefined }, { box: null }]) {
    assert.equal(cableCurve(A, B, { tangents: EDGE, ...none }), cableCurve(A, B,
      { tangents: EDGE }), JSON.stringify(none));
  }
});

test('tangents: moving the target across the source never jumps the cable', () => {
  // The blend into the loop must cover a gap that grows with how far above or below the target
  // is: a 0.5 step moves no point more than 1.5 (3 graph units per unit of drag) at any height.
  const a = { x: 500, y: 300 };
  for (const dy of [-2000, -1000, -600, -400, -200, -20, 0, 40, 300, 400, 600, 1000, 2000]) {
    let prev = null;
    for (let x = 700; x >= -700; x -= 0.5) {
      const pts = sampled(cableCurve(a, { x, y: 300 + dy }, { tangents: EDGE }), 40);
      if (prev) {
        const jump = Math.max(...pts.map((p, i) => Math.hypot(p.x - prev[i].x, p.y - prev[i].y)));
        assert.ok(jump <= 1.5, `dy ${dy}, x ${x}: a 0.5 step moves the cable ${jump.toFixed(2)}`);
      }
      prev = pts;
    }
  }
});

test('tangents: a small move of the target, any way, any ports, moves the cable little', () => {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const a = { x: 0, y: 0 };
  const H = 0.05;
  for (let i = 0; i < 4000; i++) {
    const from = turn(RIGHT, rnd() * 360);
    const opposite = i % 2 === 0;
    const tangents = { from, to: opposite ? { x: -from.x, y: -from.y } : turn(RIGHT, rnd() * 360) };
    // Half of them in the blend, behind the source by 0..600 and 2000 to either side.
    const off = i % 4 < 2 ? { x: -rnd() * 600, y: rnd() * 4000 - 2000 }
      : { x: rnd() * 3000 - 1500, y: rnd() * 3000 - 1500 };
    const b = i % 4 < 2 ? { x: from.x * off.x - from.y * off.y, y: from.y * off.x + from.x * off.y }
      : off;
    const th = rnd() * 2 * Math.PI;
    const b2 = { x: b.x + H * Math.cos(th), y: b.y + H * Math.sin(th) };
    const one = sampled(cableCurve(a, b, { tangents }), 40);
    const two = sampled(cableCurve(a, b2, { tangents }), 40);
    const move = Math.max(...one.map((p, k) => Math.hypot(p.x - two[k].x, p.y - two[k].y))) / H;
    assert.ok(move <= (opposite ? 3 : 3.5), `${JSON.stringify([b, tangents])}: ${move.toFixed(2)}`);
  }
});

test('tangents: coincident ends stay finite; a missing or zero tangent is refused', () => {
  const d = cableCurve(A, A, { tangents: EDGE });
  assert.doesNotMatch(d, /NaN|Infinity/);
  for (const bad of [{}, { from: RIGHT }, { from: RIGHT, to: { x: 0, y: 0 } },
    { from: { x: NaN, y: 1 }, to: LEFT }, { from: RIGHT, to: { x: 1 } }, null, 'right']) {
    assert.throws(() => cableCurve(A, B, { tangents: bad }), /tangent/, JSON.stringify(bad));
  }
});

test('tangents: cableParts draws the port-tangent curve, and its cross sits on it', () => {
  const [a, b] = BACKWARD[3];
  const spec = { id: 't', from: a, to: b, type: 'AUDIO', tokens: TOKENS, tangents: EDGE,
    state: { refused: true } };
  const parts = cableParts(spec);
  const d = cableCurve(a, b, { tangents: EDGE });
  for (const key of ['shadow', 'hit', 'stroke']) {
    assert.equal(parts.find((p) => p.key === key).attrs.d, d, key);
  }
  assert.equal(cableSvg(spec), serialise(parts));
  const arm = parts.find((p) => p.key === 'cross-0').attrs;
  const c = { x: (Number(arm.x1) + Number(arm.x2)) / 2, y: (Number(arm.y1) + Number(arm.y2)) / 2 };
  const near = Math.min(...sampled(d, 400).map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  assert.ok(near < 0.5, `the cross is on the loop (${near})`);
  const toEnd = Math.hypot(c.x - b.x, c.y - b.y);
  assert.ok(toEnd > 10 && toEnd < 31, `at the target end (${toEnd})`);
});

test('tangents: within the blend into the loop, the cable folds only near its ends', () => {
  // The blend lasts CABLE_REACH, or longer for a target far above or below (its ramp grows
  // with the gap it covers): out to CABLE_REACH plus half the height, crossing nowhere but
  // within CABLE_REACH of an end, along both ports.
  assert.equal(CABLE_REACH, 40);
  const a = { x: 0, y: 0 };
  for (const dy of [-2000, -1000, -520, -360, -60, -10, 0, 10, 60, 360, 520, 1000, 2000]) {
    const span = CABLE_REACH + Math.abs(dy) / 2;
    for (let i = 0; i < 24; i++) {
      const back = 1 + ((span - 1) * i) / 24;
      const b = { x: -back, y: dy };
      const d = cableCurve(a, b, { tangents: EDGE });
      assert.doesNotMatch(d, /NaN|Infinity/);
      const { leave, arrive } = endDirections(d);
      assert.ok(angle(leave, RIGHT) < 1 && angle(arrive, RIGHT) < 1, `${back} ${dy}: ports`);
      const pts = sampled(d, 100);
      for (let j = 0; j < pts.length - 1; j++) {
        for (let k = j + 2; k < pts.length - 1; k++) {
          if (!crosses(pts[j], pts[j + 1], pts[k], pts[k + 1])) continue;
          const near = Math.min(Math.hypot(pts[j].x - a.x, pts[j].y - a.y),
            Math.hypot(pts[j].x - b.x, pts[j].y - b.y));
          assert.ok(near < CABLE_REACH, `${back} ${dy}: a fold ${near.toFixed(1)} from the ends`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------- settle (plan S4 c)

const L0 = { x: 100, y: 100 };
const L1 = { x: 340, y: 100 };
/** Runs settle frame by frame from `state` with fixed ends; the trajectory and the time. */
function run(state, ends, dts, opts) {
  const out = [];
  let s = state;
  let t = 0;
  for (const dt of dts) {
    s = settle(s, ends, dt, opts);
    t += dt;
    out.push({ t, ...s });
    if (s.settled) break;
  }
  return out;
}
const frames = (dt, ms = 2000) => Array.from({ length: Math.ceil(ms / dt) }, () => dt);

test('cableSag is the sag cableCurve hangs, and cableCurve draws a sag it is given', () => {
  for (const [a, b, o] of [[L0, L1, {}], [A, B, { slack: 0.1 }], [{ x: 0, y: 380 },
    { x: 1800, y: 380 }, { box: { x: 0, y: 0, width: 1900, height: 400 } }], [A, A, {}]]) {
    const s = cableSag(a, b, o);
    assert.ok(Math.abs(sagOf(a, b, o) - s) < 1e-5, `${s} vs ${sagOf(a, b, o)}`);
    assert.equal(cableCurve(a, b, { ...o, sag: s }), cableCurve(a, b, o));
  }
  assert.ok(Math.abs(sagOf(L0, L1, { sag: 7 }) - 7) < 1e-5, 'below the minimum, as told');
  assert.ok(Math.abs(sagOf(L0, L1, { sag: 0 })) < 1e-9, 'a taut cable');
  const box = { x: 0, y: 0, width: 400, height: 120 };
  assert.ok(lowest(cableCurve(L0, L1, { box, sag: 500 })) <= 120 + 1e-6, 'the box still wins');
  for (const bad of [-1, NaN, Infinity, '3']) {
    assert.throws(() => cableCurve(L0, L1, { sag: bad }), /sag/, String(bad));
  }
});

test('settle: a dropped cable falls to its rest, overshoots at most once, within 400 ms', () => {
  assert.equal(SETTLE_MS, 400);
  const ends = { from: L0, to: L1 };
  const rest = cableSag(L0, L1);
  for (const dt of [1000 / 60, 1000 / 120, 1000 / 30, 7]) {
    for (const sag of [0, rest / 2, rest + 30, CABLE_MAX_SAG + CABLE_MIN_SAG]) {
      const path = run({ from: L0, to: L1, sag }, ends, frames(dt));
      const end = path[path.length - 1];
      const where = `dt ${dt.toFixed(2)}, from sag ${sag}`;
      assert.ok(end.settled, `${where}: settles`);
      assert.ok(end.t <= SETTLE_MS + dt, `${where}: within 400 ms (${end.t.toFixed(1)})`);
      assert.equal(end.sag, rest, `${where}: exactly at rest`);
      assert.equal(end.velocity, 0);
      const side = Math.sign(sag - rest);
      const far = path.map((p) => (p.sag - rest) * -side);
      const peaks = [];
      for (let i = 1; i < far.length - 1; i++) {
        if (far[i] > 0.5 && far[i] >= far[i - 1] && far[i] >= far[i + 1]) peaks.push(far[i]);
      }
      assert.ok(peaks.length <= 1, `${where}: overshoots ${peaks.length} times`);
      if (sag === 0) assert.equal(peaks.length, 1, `${where}: a long drop swings past once`);
      const back = path.map((p) => (p.sag - rest) * side);
      const crossed = far.findIndex((x) => x > 0);
      if (crossed >= 0) {
        assert.ok(Math.max(...back.slice(crossed)) <= 0.5, `${where}: no second swing`);
      }
      if (sag !== rest) assert.ok(path.length > 2, `${where}: it moves, over frames`);
    }
  }
});

test('settle: a moved end swings the cable (its middle lags), then it settles', () => {
  const near = { x: 180, y: 100 };
  const rest0 = cableSag(L0, near);
  assert.equal(rest0, 24, 'slack 0.3 of 80');
  const still = { from: L0, to: near, sag: rest0, velocity: 0 };
  const up = { from: { x: 100, y: 70 }, to: { x: 180, y: 70 } };
  const first = settle(still, up, 1000 / 60);
  assert.ok(first.sag > rest0 + 20, `lifting both ends 30 leaves the middle low (${first.sag})`);
  assert.ok(!first.settled);
  assert.deepEqual([first.from, first.to], [up.from, up.to], 'the state carries the new ends');
  const path = run(first, up, frames(1000 / 60));
  assert.ok(path[path.length - 1].settled);
  assert.ok(path[path.length - 1].t <= SETTLE_MS, `${path[path.length - 1].t}`);
  const far = { from: L0, to: { x: 900, y: 100 } };
  assert.ok(Math.abs(settle(still, { from: L0, to: near }, 0).sag - rest0) < 1e-9, 'still');
  const longer = settle(still, far, 16);
  assert.equal(longer.rest, cableSag(L0, far.to), 'the rest follows the new ends');
  assert.ok(Math.abs(longer.sag - longer.rest) > 1, 'and the cable moves toward it');
});

test('settle: the sag stays in [0, the room under the box], whatever the move', () => {
  const box = { x: 0, y: 0, width: 600, height: 160 };
  let s = { from: L0, to: L1, sag: 30 };
  const moves = [{ x: 100, y: 10 }, { x: 100, y: 150 }, { x: 100, y: -200 }, { x: 100, y: 100 }];
  for (const m of moves) {
    for (let i = 0; i < 30; i++) {
      s = settle(s, { from: m, to: L1 }, 16, { box });
      assert.ok(s.sag >= 0, `${s.sag}`);
      const low = lowest(cableCurve(m, L1, { box, sag: s.sag }));
      assert.ok(low <= 160 + 1e-6, `below the box: ${low}`);
      assert.ok(Number.isFinite(s.velocity));
    }
  }
});

test('settle: reduced motion lands at the rest at once', () => {
  const rest = cableSag(L0, L1);
  for (const sag of [0, rest + 40]) {
    const s = settle({ from: L0, to: L1, sag, velocity: 300 }, { from: L0, to: L1 }, 16,
      { reducedMotion: true });
    assert.deepEqual({ sag: s.sag, velocity: s.velocity, settled: s.settled },
      { sag: rest, velocity: 0, settled: true });
  }
  const moved = settle({ from: L0, to: L1, sag: rest }, { from: { x: 0, y: 0 }, to: L1 }, 0,
    { reducedMotion: true });
  assert.equal(moved.sag, cableSag({ x: 0, y: 0 }, L1));
});

test('settle: frame-rate independent, pure, and refuses what it cannot step', () => {
  const ends = { from: L0, to: L1 };
  const start = { from: L0, to: L1, sag: 0 };
  const a = run(start, ends, frames(10, 100));
  const b = run(start, ends, frames(5, 100));
  assert.ok(Math.abs(a[a.length - 1].sag - b[b.length - 1].sag) < 1e-6, 'same at 100 ms');
  const frozen = { from: L0, to: L1, sag: 3, velocity: 1 };
  const s = settle(frozen, ends, 16);
  assert.deepEqual(frozen, { from: L0, to: L1, sag: 3, velocity: 1 }, 'the input is untouched');
  assert.ok(Object.isFrozen(s));
  const none = settle(undefined, ends, 16);
  assert.equal(none.sag, cableSag(L0, L1), 'no previous frame: at rest');
  assert.ok(none.settled);
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => settle(start, ends, dt), /dt/);
  assert.throws(() => settle(start, { from: L0 }, 16), /finite/);
  assert.throws(() => settle({ from: L0, to: L1, sag: NaN }, ends, 16), /sag/);
});

test('cable.js schedules no frame and reads no media query: settle stays pure (v4 motion)', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.animate\(|<animate(?:Transform|Motion)?\b|requestAnimationFrame\(/);
  assert.doesNotMatch(src.replace(/^\s*(?:\/\/|\/?\*).*$/gm, ''),
    /matchMedia|setTimeout|setInterval/);
});

// ---------------------------------------------------------------- cables like cables (plan S8)
// The SYN review of the W1 look (V1, V2): the cables were thin uniform strokes with little sag,
// the plugs had to be composed by hand, and the cables crossed the labels. S8 gives the cable a
// weight against the jack, a darker rim and its sheen by default, a deeper hang, its two plugs on
// request and a pure helper that lifts a cable off a label.

/** dev-53's socket ring radius (jack.js JACK_R on origin/feat/synth-w1-adoption 0482138d; this
 *  branch does not carry the file, so it is pinned here and checked below where the tree does). */
const JACK_R = 13;
const JACK_URL = new URL('../../src/js/ui/synth/jack.js', import.meta.url);
const part = (spec, key) => cableParts({ id: 's8', from: A, to: B, type: 'AUDIO',
  colour: TOKENS.cable.palette[0], tokens: TOKENS, ...spec }).find((p) => p.key === key);
const outer = (spec) => Number(part(spec, 'edge').attrs['stroke-width']);
/** The synth token set as a theme of tokens.css resolves it: real colours, not var(). */
const themed = (theme) => tokensFrom((name) => tokenHex(theme, name));

test('S8 weight: the cable is CABLE_WIDTH wide in a CABLE_EDGE rim, scaled to the jack ring',
  async () => {
    assert.equal(CABLE.CABLE_WIDTH, 8.5, 'the stroke at rest (JC-13)');
    assert.equal(CABLE.CABLE_EDGE, 0.75, 'the rim on each side');
    const rest = CABLE.CABLE_WIDTH + 2 * CABLE.CABLE_EDGE;
    const ratio = rest / (2 * JACK_R);
    assert.ok(ratio > 0.38 && ratio < 0.39, `10 of the ring's 26: ${ratio.toFixed(3)}`);
    assert.ok(rest / JACK_R > 0.55, 'over half the ring radius: it reads as a cord, not a line');
    for (const state of WIDTH_STATES) {
      const w = Number(part({ state }, 'stroke').attrs['stroke-width']);
      assert.equal(outer({ state }), w + 2 * CABLE.CABLE_EDGE, `${JSON.stringify(state)}: rim`);
      assert.ok(outer({ state }) < 2 * (CABLE.PLUG.neck - CABLE.PLUG.edge),
        `${JSON.stringify(state)}: narrower than its plug's neck (${outer({ state })} < 20.5)`);
    }
    assert.equal(Number(part({}, 'stroke').attrs['stroke-width']), CABLE.CABLE_WIDTH);
    assert.ok(Number(part({ state: { hover: true } }, 'stroke').attrs['stroke-width'])
      > CABLE.CABLE_WIDTH, 'hover still thickens');
    if (existsSync(JACK_URL)) {
      const jack = await import(JACK_URL.href);
      assert.equal(jack.JACK_R, JACK_R, 'the pinned ring is the one this tree draws');
    }
  });

test('S8 rim: a darker edge under the stroke, dashed as the stroke, in the darker ink',
  async () => {
  const keys = cableParts({ id: 'k', from: A, to: B, type: 'AUDIO', tokens: TOKENS })
    .map((p) => p.key);
  assert.deepEqual(keys.slice(0, 6), ['cable', 'shadow', 'main', 'hit', 'edge', 'stroke']);
  for (const type of TYPES) {
    for (const state of STATES) {
      const e = part({ type, state }, 'edge').attrs;
      const s = part({ type, state }, 'stroke').attrs;
      const where = `${type} ${JSON.stringify(state)}`;
      assert.equal(e.d, s.d, `${where}: the same curve`);
      assert.equal(e['stroke-dasharray'], s['stroke-dasharray'], `${where}: the gaps stay open`);
      assert.equal(e['stroke-linecap'], s['stroke-linecap'], `${where}: the same caps`);
      assert.equal(e.fill, 'none');
      assert.equal(e.class, undefined, `${where}: opaque, not an intensity`);
      assert.ok(Number(part({ type, state }, 'shadow').attrs['stroke-width'])
        > Number(e['stroke-width']), `${where}: the soft shadow is wider still`);
    }
  }
  assert.equal(part({}, 'edge').attrs.stroke, TOKENS.cable.shadow,
    'a value it cannot read as a colour (var()) takes the shadow');
  const th = await tokenThemes();
  for (const [name, theme] of Object.entries(th)) {
    const tokens = themed(theme);
    const ink = part({ tokens }, 'edge').attrs.stroke;
    assert.equal(ink, name === 'dark' ? tokens.cable.shadow : tokens.cable.sheen,
      `${name}: the darker of shadow and sheen`);
    for (const colour of tokens.cable.palette) {
      assert.equal(contrastOf(colour, '#000000') > contrastOf(ink, '#000000'), true,
        `${name} ${colour}: the rim is darker than the cable`);
      assert.ok(contrastOf(colour, ink) >= 3, `${name} ${colour} on its rim ${ink}: `
        + `${contrastOf(colour, ink).toFixed(2)}`);
      for (const plate of [tokens.surface.plateHi, tokens.surface.plateLo]) {
        const best = Math.max(contrastOf(ink, plate), contrastOf(colour, plate));
        assert.ok(best >= 3, `${name} ${colour} on ${plate}: the cable shows (${best.toFixed(2)})`);
      }
    }
  }
});

test('S8 sheen: a cable carries its sheen unless told not to', () => {
  assert.match(draw(), /<path data-sheen="" class="opacity-hw-sheen"/, 'on by default');
  assert.doesNotMatch(draw({ sheen: false }), /data-sheen/, 'sheen: false leaves it out');
  const sheen = /<path data-sheen=""[^>]*>/.exec(draw())[0];
  assert.ok(width(sheen) < width(mainStroke(draw())), 'a stripe along the stroke');
});

test('S8 sag: a horizontal 300-unit cable hangs 90 (0.3 of its span), bounded as before', () => {
  assert.equal(CABLE.CABLE_SLACK, 0.3);
  assert.equal(CABLE_MIN_SAG, 20);
  assert.equal(CABLE_MAX_SAG, 90);
  const o = { x: 0, y: 0 };
  const s300 = sagOf(o, { x: 300, y: 0 });
  assert.ok(Math.abs(s300 - 90) < 1e-6, `300 units sag ${s300}`);
  assert.ok(Math.abs(sagOf(o, { x: 200, y: 0 }) - 60) < 1e-6, '200 units sag 60');
  assert.ok(Math.abs(sagOf(o, { x: 44, y: 0 }) - 20) < 1e-6, 'one jack pitch: the minimum 20');
  assert.ok(sagOf(o, { x: 2000, y: 0 }) <= CABLE_MAX_SAG + 1e-6, 'never past CABLE_MAX_SAG');
  const box = { x: 0, y: -50, width: 400, height: 100 };
  assert.ok(lowest(cableCurve(o, { x: 300, y: 0 }, { box })) <= 50 + 1e-6, 'the box still wins');
  // The deeper hang still settles in time: the largest drops, 0 to 90 and 110 to 20.
  for (const [to, sag] of [[{ x: 300, y: 0 }, 0], [{ x: 44, y: 0 }, CABLE_MAX_SAG
    + CABLE_MIN_SAG]]) {
    for (const dt of [1000 / 30, 1000 / 60, 1000 / 144]) {
      const path = run({ from: o, to, sag }, { from: o, to }, frames(dt));
      const end = path[path.length - 1];
      assert.ok(end.settled && end.t <= SETTLE_MS + dt, `${sag} to ${end.rest} at dt ${
        dt.toFixed(1)}: rests by ${end.t.toFixed(1)} ms`);
    }
  }
});

/** The plugs of a cable's markup, each { at, rib, raw }: its centre, its middle rib's midpoint
 *  and its markup (up to the next plug). */
const BOOT_D = new RegExp('<path data-boot="" d="M (\\S+) (\\S+) A \\S+ \\S+ 0 1 1 (\\S+) (\\S+) '
  + 'L (\\S+) (\\S+) A \\S+ \\S+ 0 0 1 (\\S+) (\\S+) Z"');
function plugsOf(svg) {
  const { boot, neck, reach } = CABLE.PLUG;
  const cos = (boot - neck) / reach;
  return svg.split('<g data-plug=').slice(1).map((body) => {
    // The boot: M P1 A boot … P2 L Q2 A neck … Q1 Z. The tangent points' midpoints lie on the
    // axis, boot·cos and reach + neck·cos from the centre (cos = (boot - neck) / reach).
    const m = BOOT_D.exec(body);
    const [p1x, p1y, p2x, p2y, q2x, q2y, q1x, q1y] = m.slice(1).map(Number);
    const pm = { x: (p1x + p2x) / 2, y: (p1y + p2y) / 2 };
    const qm = { x: (q1x + q2x) / 2, y: (q1y + q2y) / 2 };
    const l = Math.hypot(qm.x - pm.x, qm.y - pm.y);
    const d = { x: (qm.x - pm.x) / l, y: (qm.y - pm.y) / l };
    const at = { x: pm.x - boot * cos * d.x, y: pm.y - boot * cos * d.y };
    return { at, rib: { x: at.x + d.x, y: at.y + d.y }, raw: body };
  });
}

test('S8 plugs: cableSvg({ plugs: true }) draws both plugs, each boot along the cable', () => {
  assert.doesNotMatch(draw(), /data-plug/, 'none unless asked');
  const ends = [[A, B, {}], [B, A, {}], [{ x: 0, y: 0 }, { x: 0, y: 200 }, {}],
    [{ x: 0, y: 0 }, { x: 300, y: 10 },
      { tangents: { from: { x: 1, y: 0 }, to: { x: -1, y: 0 } } }],
    [{ x: 0, y: 100 }, { x: 400, y: 100 }, { box: { x: 0, y: 0, width: 400, height: 120 } }]];
  for (const [from, to, how] of ends) {
    const svg = draw({ from, to, ...how, plugs: true });
    assert.match(svg, /^<g data-cable="c1"[^>]*>.*<\/g>$/, 'one cable group still');
    const plugs = plugsOf(svg);
    assert.equal(plugs.length, 2, 'two plugs');
    plugs.forEach((p, i) => assert.ok(Math.hypot(p.at.x - [from, to][i].x, p.at.y
      - [from, to][i].y) < 1e-4, 'at the source, then the target'));
    const dirs = cableDirections(from, to, how);
    for (const [p, d] of [[plugs[0], dirs.from], [plugs[1], dirs.to]]) {
      const v = { x: p.rib.x - p.at.x, y: p.rib.y - p.at.y };
      const l = Math.hypot(v.x, v.y);
      assert.ok(Math.abs(v.x / l - d.x) < 1e-3 && Math.abs(v.y / l - d.y) < 1e-3,
        `${JSON.stringify([from, to, how])}: the boot points the way the cable leaves`);
      assert.ok(p.raw.includes(`fill="${TOKENS.cable.palette[2]}"`), 'in the cable colour');
    }
    assert.ok(svg.lastIndexOf('data-plug') > svg.indexOf('data-stroke'), 'over the cable');
  }
  const refused = draw({ state: { refused: true }, plug: 'refused', plugs: true });
  const [src, dst] = plugsOf(refused);
  assert.doesNotMatch(src.raw, /data-refused/, 'the source plug is seated');
  assert.match(dst.raw, /data-refused/, 'the target plug takes `plug`');
  assert.equal((refused.match(/data-cross=""/g) || []).length, 1, 'one refusal, one cross');
  for (const bad of [1, 'yes', null]) {
    assert.throws(() => draw({ plugs: bad }), /cableSvg: plugs/, String(bad));
  }
});

/** Whether a cable from a to b, drawn as cableCurve draws it with `how`, passes within `r` of
 *  the rectangle: the test's own dense sampling, not the module's. */
function touches(a, b, how, rect, r) {
  const d = cableCurve(a, b, how);
  for (let i = 0; i <= 4000; i++) {
    const p = at(d, i / 4000);
    const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.width));
    const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.height));
    if (Math.hypot(dx, dy) < r) return true;
  }
  return false;
}
/** Half the cord's width at rest in its rim, as clearLabels judges it by default (JC-13: 5). */
const HALF = (CABLE.CABLE_WIDTH + 2 * CABLE.CABLE_EDGE) / 2;

test('S8 labels: clearLabels raises the slack until the cable clears a label it would cross',
  () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const label = { x: 80, y: 50, width: 40, height: 8 };
    assert.ok(touches(a, b, {}, label, HALF), 'at rest the cable crosses the label');
    const r = CABLE.clearLabels(a, b, [label]);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.crossed));
    assert.equal(r.clear, true);
    assert.deepEqual(r.crossed, []);
    assert.ok(r.slack > CABLE.CABLE_SLACK, `more slack: ${r.slack}`);
    assert.ok(r.sag > cableSag(a, b) && r.sag <= CABLE_MAX_SAG, `a deeper hang: ${r.sag}`);
    assert.ok(Math.abs(cableSag(a, b, { slack: r.slack }) - r.sag) < 1e-6, 'the slack draws it');
    assert.ok(!touches(a, b, { slack: r.slack }, label, HALF), 'and that cable clears the label');
    assert.ok(touches(a, b, { slack: (r.sag - 1.5) / 200 }, label, HALF),
      'the least sag that clears, within a step');
    const free = CABLE.clearLabels(a, b, [{ x: 80, y: 120, width: 40, height: 8 }]);
    assert.deepEqual({ ...free, crossed: [...free.crossed] }, { slack: CABLE.CABLE_SLACK,
      sag: cableSag(a, b), clear: true, crossed: [] }, 'clear already: the slack as given');
    assert.deepEqual(CABLE.clearLabels(a, b, []).clear, true, 'no labels');
  });

test('S8 labels: clearLabels reports the crossings more sag cannot clear', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  const under = { x: -10, y: 10, width: 20, height: 10 };
  const lifted = { x: 80, y: 50, width: 40, height: 8 };
  const far = { x: 500, y: 500, width: 10, height: 10 };
  const one = CABLE.clearLabels(a, b, [under], { slack: 0.31 });
  assert.deepEqual({ ...one, crossed: [...one.crossed] }, { slack: 0.31, sag: cableSag(a, b,
    { slack: 0.31 }), clear: false, crossed: [0] }, 'its own jack\'s label, right under it');
  const many = CABLE.clearLabels(a, b, [far, under, lifted]);
  assert.equal(many.clear, false);
  assert.deepEqual([...many.crossed], [1], 'only the label still crossed, by index (S8 fix)');
  assert.ok(many.slack > CABLE.CABLE_SLACK, `raised off the label it can clear: ${many.slack}`);
  assert.ok(Math.abs(cableSag(a, b, { slack: many.slack }) - many.sag) < 1e-6, 'its slack');
  assert.ok(!touches(a, b, { slack: many.slack }, lifted, HALF), 'the lifted label is clear');
  const box = { x: 0, y: -100, width: 300, height: 162 };
  assert.ok(cableSag(a, b, { box }) >= 60, 'room for the rest sag');
  const boxed = CABLE.clearLabels(a, b, [lifted], { box });
  assert.equal(boxed.clear, false, 'the box leaves no room to clear it');
  assert.deepEqual([...boxed.crossed], [0]);
  const roomy = CABLE.clearLabels(a, b, [lifted], { box: { ...box, height: 300 } });
  assert.equal(roomy.clear, true, 'with room it clears');
  assert.ok(lowest(cableCurve(a, b, { slack: roomy.slack, box: { ...box, height: 300 } }))
    <= 200 + 1e-6);
});

test('S8 fix: clearLabels clears what it can when another label cannot be cleared', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  // The review's input: a label under the cable's own jack and one in the middle.
  const own = { x: -10, y: 2, width: 20, height: 6 };
  const mid = { x: 95, y: 55, width: 10, height: 10 };
  const alone = CABLE.clearLabels(a, b, [mid]);
  assert.equal(alone.clear, true);
  const both = CABLE.clearLabels(a, b, [own, mid]);
  assert.deepEqual([...both.crossed], [0], 'only its own jack\'s label is reported');
  assert.equal(both.clear, false, 'clear means nothing crossed');
  assert.equal(both.sag, alone.sag, 'raised as far as the middle label alone asks');
  assert.ok(!touches(a, b, { slack: both.slack }, mid, HALF), 'the middle label is clear');
  // Modelled on the bay: a label printed under each end's jack, and a module title below the
  // middle that a deeper hang clears (W1b prints a jack's label 25 to 37 below the jack).
  const ends = [{ x: -23, y: 25, width: 46, height: 12 }, { x: 177, y: 25, width: 46,
    height: 12 }];
  const title = { x: 70, y: 52, width: 60, height: 12 };
  const bay = CABLE.clearLabels(a, b, [ends[0], title, ends[1]]);
  assert.deepEqual([...bay.crossed], [0, 2], 'the end labels stay reported, the title does not');
  assert.ok(bay.sag > cableSag(a, b), `a deeper hang: ${bay.sag}`);
  assert.ok(!touches(a, b, { slack: bay.slack }, title, HALF), 'the title is clear');
  // `skip` names the cable's own jacks' labels: they are not judged and not reported.
  const skipped = CABLE.clearLabels(a, b, [ends[0], title, ends[1]], { skip: [0, 2] });
  assert.deepEqual({ ...skipped, crossed: [...skipped.crossed] }, { ...bay, clear: true,
    crossed: [] }, 'the same hang, and nothing crossed that was judged');
  // The fewest crossed wins and the least sag on a tie: a label nothing clears keeps the rest.
  const stuck = CABLE.clearLabels(a, b, [{ x: 0, y: 0, width: 200, height: 200 }]);
  assert.equal(stuck.slack, CABLE.CABLE_SLACK, 'no sag crosses fewer: the slack as given');
  for (const bad of [[3], [-1], [0.5], 'x', [null]]) {
    assert.throws(() => CABLE.clearLabels(a, b, [title], { skip: bad }), /clearLabels: skip/,
      JSON.stringify(bad));
  }
});

test('S8 fix: an error from clearLabels or cableSvg names the function called', () => {
  const b = { x: 200, y: 0 };
  assert.throws(() => CABLE.clearLabels(null, b, []), /^TypeError: clearLabels: a and b need/);
  assert.throws(() => cableSvg({ id: 'c', from: null, to: b, type: 'AUDIO', tokens: TOKENS,
    plugs: true }), /^TypeError: cableSvg: a and b need/);
  assert.throws(() => cableSvg({ id: 'c', from: null, to: b, type: 'AUDIO', tokens: TOKENS }),
    /^TypeError: cableSvg: a and b need/);
});

test('S8 fix: clearLabels on a bay of 200 labels stays under a millisecond a cable', (t) => {
  // A bay-like panel: 20 columns of 10 jacks, each with its label printed under it.
  const labels = [];
  const jacks = [];
  for (let c = 0; c < 20; c++) {
    for (let r = 0; r < 10; r++) {
      const j = { x: 30 + c * 60, y: 30 + r * 70 };
      jacks.push(j);
      labels.push({ x: j.x - 23, y: j.y + 25, width: 46, height: 12 });
    }
  }
  const pairs = Array.from({ length: 200 }, (_, i) => [jacks[(i * 37) % 200],
    jacks[(i * 71 + 13) % 200]]).filter(([p, q]) => p !== q);
  pairs.push([{ x: 0, y: 0 }, { x: 600, y: 0 }]);
  const box = { x: 0, y: 0, width: 1260, height: 760 };
  const run = () => {
    const t0 = performance.now();
    for (const [p, q] of pairs) CABLE.clearLabels(p, q, labels, { box });
    return (performance.now() - t0) / pairs.length;
  };
  run();
  const best = Math.min(...Array.from({ length: 5 }, run));
  t.diagnostic(`clearLabels: best of 5 runs ${best.toFixed(3)} ms a cable (bound 1 ms)`);
  assert.ok(best < 1, `${best.toFixed(3)} ms a cable`);
});

test('S8 labels: clearLabels is pure and refuses what it cannot judge', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  const labels = [{ x: 80, y: 50, width: 40, height: 8 }];
  const copy = JSON.parse(JSON.stringify(labels));
  CABLE.clearLabels(a, b, labels);
  assert.deepEqual(labels, copy, 'the labels untouched');
  assert.deepEqual(CABLE.clearLabels(a, b, labels), CABLE.clearLabels(a, b, labels));
  const same = CABLE.clearLabels(a, a, [{ x: -5, y: 0, width: 10, height: 30 }]);
  assert.equal(same.clear, false, 'coincident ends cannot be raised: reported');
  for (const bad of [[{ x: 0, y: 0, width: -1, height: 2 }], [{ x: NaN, y: 0, width: 1,
    height: 1 }], [null], 'labels', undefined]) {
    assert.throws(() => CABLE.clearLabels(a, b, bad), /clearLabels: label/, JSON.stringify(bad));
  }
  assert.throws(() => CABLE.clearLabels({ x: NaN, y: 0 }, b, []), /finite/);
  assert.throws(() => CABLE.clearLabels(a, b, [], { slack: -1 }), /slack/);
  assert.throws(() => CABLE.clearLabels(a, b, [], { width: 0 }), /width/);
  assert.throws(() => CABLE.clearLabels(a, b, [], { tangents: { from: { x: 1, y: 0 },
    to: { x: -1, y: 0 } } }), /hanging/);
});

test('S8: no literal opacity, alpha, shadow or colour in a cable with its rim and plugs (v4)',
  async () => {
    const th = await tokenThemes();
    const allowed = new Set([...tokenValues(), 'none', 'currentColor']);
    for (const type of TYPES) {
      for (const state of STATES) {
        const svg = draw({ type, state, plugs: true, plug: state.refused ? 'refused' : undefined });
        assert.deepEqual(intensityLiterals(svg), [], `${type} ${JSON.stringify(state)}`);
        assert.deepEqual(colourLiterals(svg), [], `${type} ${JSON.stringify(state)}`);
        for (const p of paints(svg)) assert.ok(allowed.has(p), `paint ${p}`);
      }
    }
    for (const theme of Object.values(th)) {
      const tokens = themed(theme);
      const values = new Set([...tokenValues(tokens), 'none', 'currentColor']);
      for (const p of paints(draw({ tokens, colour: tokens.cable.palette[3], plugs: true }))) {
        assert.ok(values.has(p), `themed paint ${p} is a token value`);
      }
    }
    const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8');
    assert.deepEqual(intensityLiterals(src), [], 'cable.js source');
    assert.deepEqual(colourLiterals(src.replace(/="[^"]*"/g, '')), [], 'no colour in cable.js');
  });

test('S8: 600 cables with their rims, sheens and plugs still render under 50 ms', (t) => {
  const edges = Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`,
    from: { x: (i * 37) % 1900, y: (i * 53) % 1100 }, to: { x: (i * 71) % 1900 + 5,
      y: (i * 29) % 1100 }, type: TYPES[i % 4], colour: TOKENS.cable.palette[i % 6] }));
  const run1 = () => edges.reduce((n, e) => n + cableSvg({ ...e, tokens: TOKENS, plugs: true })
    .length, 0);
  run1();
  // Best of 9: the least a run takes is the code's cost; a busier host only lengthens the rest.
  const best = Math.min(...Array.from({ length: 9 }, () => {
    const t0 = performance.now();
    run1();
    return performance.now() - t0;
  }));
  t.diagnostic(`600 cables with plugs: best of 9 runs ${best.toFixed(2)} ms (bound 50 ms)`);
  assert.ok(best < 50, `${best.toFixed(2)} ms`);
});

// ---------------------------------------------------------------- cords like cords (JC-6, 13, 14)
// The look audit's jacks, cables and plugs rows, under the announced owner defaults of
// 2026-11-04 21:55Z (not objected): cords are solid with a type band, never dashed (JC-6); a
// cord has a weight, a shade and a sheen that read (JC-13); a vertical run hangs with a belly,
// never as a straight elastic line (JC-14).

const BANDS = { AUDIO: [6], CONTROL: [2.5, 2, 2.5], TRIGGER: [1.25, 1.5, 1.25, 1.5, 1.25],
  ANALYSIS: [4, 1.5, 1.5] };
/** The bands of a cable's parts, by end, each a subpath M p L q of the end's path:
 *  { from: [[p, q, attrs]], to: [...] }. */
function bandsOf(parts) {
  const out = { from: [], to: [] };
  for (const p of parts.filter((x) => /^band-/.test(x.key))) {
    const a = p.attrs;
    assert.match(a.d, new RegExp(`^M ${NUM} ${NUM} L ${NUM} ${NUM}(?: M ${NUM} ${NUM} L ${NUM} `
      + `${NUM})*$`), `${p.key}: subpaths M p L q`);
    for (const m of a.d.matchAll(/M (\S+) (\S+) L (\S+) (\S+)/g)) {
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      out[p.key.split('-')[1]].push([{ x: x1, y: y1 }, { x: x2, y: y2 }, a]);
    }
  }
  return out;
}
const cordParts = (spec = {}) => cableParts({ id: 'j', from: A, to: B, type: 'AUDIO',
  colour: TOKENS.cable.palette[0], tokens: TOKENS, ...spec });

test('JC-6: CABLE_BANDS, a band pattern per signal type, told apart by count and length', () => {
  assert.deepEqual(CABLE.CABLE_BANDS, BANDS);
  assert.ok(Object.isFrozen(CABLE.CABLE_BANDS));
  assert.ok(Object.values(CABLE.CABLE_BANDS).every(Object.isFrozen));
  assert.deepEqual(Object.keys(CABLE.CABLE_BANDS), Object.keys(CABLE_DASH), 'every signal type');
  const signature = (bands) => bands.filter((_, i) => i % 2 === 0);
  for (const [type, pattern] of Object.entries(BANDS)) {
    assert.equal(pattern.length % 2, 1, `${type}: starts and ends with a band`);
    signature(pattern).forEach((w) => assert.ok(w >= 1.25, `${type}: a band ${w} reads`));
    pattern.filter((_, i) => i % 2).forEach((g) => assert.ok(g >= 1.5, `${type}: gap ${g}`));
  }
  // Never colour alone: two types differ by the number of bands, or by their lengths' ratio.
  const types = Object.keys(BANDS);
  for (const a of types) {
    for (const b of types.filter((t) => t > a)) {
      const [x, y] = [signature(BANDS[a]), signature(BANDS[b])];
      const ratio = (s) => Math.max(...s) / Math.min(...s);
      assert.ok(x.length !== y.length || Math.abs(ratio(x) - ratio(y)) >= 1.5,
        `${a} and ${b} differ by shape`);
    }
  }
  assert.equal(CABLE.CABLE_BAND_AT, 20);
  assert.ok(CABLE.CABLE_BAND_AT >= CABLE.PLUG.room, 'the bands start past a held plug\'s room');
});

test('JC-6: the bands sit on the cord near each plug, at their pattern\'s distances', () => {
  for (const type of TYPES) {
    for (const state of STATES) {
      for (const [from, to] of [[A, B], [B, A], [{ x: 0, y: 0 }, { x: 0, y: 200 }],
        [{ x: 0, y: 0 }, { x: 64, y: 0 }]]) {
        const parts = cordParts({ type, state, from, to });
        const where = `${type} ${JSON.stringify(state)} ${JSON.stringify([from, to])}`;
        const group = parts.find((p) => p.key === 'bands');
        assert.equal(group.tag, 'g');
        assert.equal(group.parent, 'cable');
        assert.equal(group.attrs['data-bands'], type, `${where}: the type, named`);
        assert.equal(group.attrs['pointer-events'], 'none');
        for (const end of ['from', 'to']) {
          assert.equal(parts.find((p) => p.key === `band-${end}`).attrs['data-band'], end);
        }
        const stroke = parts.find((p) => p.key === 'stroke').attrs;
        const edge = parts.find((p) => p.key === 'edge').attrs;
        const d = stroke.d;
        const samples = Array.from({ length: 8001 }, (_, i) => at(d, i / 8000));
        const onCurve = (p) => Math.min(...samples.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
        const bands = bandsOf(parts);
        const offsets = [];
        BANDS[type].reduce((s, len, i) => {
          if (i % 2 === 0) offsets.push([s, s + len]);
          return s + len;
        }, CABLE.CABLE_BAND_AT);
        for (const [end, centre] of [['from', from], ['to', to]]) {
          assert.equal(bands[end].length, offsets.length, `${where}: one subpath a band, ${end}`);
          bands[end].forEach(([p, q, a], i) => {
            assert.ok(onCurve(p) < 0.05 && onCurve(q) < 0.05, `${where}: on the cord`);
            const r = [p, q].map((x) => Math.hypot(x.x - centre.x, x.y - centre.y));
            assert.ok(Math.abs(r[0] - offsets[i][0]) < 1e-3 && Math.abs(r[1] - offsets[i][1])
              < 1e-3, `${where} ${end} ${i}: ${r} from the plug, not ${offsets[i]}`);
            assert.equal(a.stroke, edge.stroke, `${where}: the rim's ink`);
            assert.ok(Math.abs(Number(a['stroke-width']) - 0.6 * Number(stroke['stroke-width']))
              < 1e-6, `${where}: 0.6 of the stroke, inside the cord (review 2)`);
            assert.equal(a['stroke-linecap'], 'butt');
            assert.equal(a.class, undefined, 'opaque');
          });
        }
      }
    }
  }
});

test('JC-6: the band ink holds 3:1 on every cord colour, both themes', async () => {
  const th = await tokenThemes();
  for (const [name, theme] of Object.entries(th)) {
    const tokens = themed(theme);
    for (const colour of tokens.cable.palette) {
      const [, , a] = bandsOf(cordParts({ tokens, colour })).from[0];
      const ratio = contrastOf(colour, a.stroke);
      assert.ok(ratio >= 3, `${name} ${colour}: band ${a.stroke} ${ratio.toFixed(2)}`);
    }
  }
});

test('JC-6: with the colours taken away, every signal type still draws differently', () => {
  const shape = (svg) => svg.replace(/\s(?:stroke|fill)="[^"]*"/g, '')
    .replace(/\sdata-bands="[^"]*"/g, '');
  const seen = new Map();
  for (const type of TYPES) {
    const svg = shape(draw({ type, colour: 'x' }));
    for (const [other, s] of seen) assert.notEqual(svg, s, `${type} looks like ${other}`);
    seen.set(type, svg);
  }
});

test('JC-6: the bands are part of the cord: same keys as it moves, under the cross and sheen',
  () => {
    const keys = (s) => cordParts({ type: 'TRIGGER', ...s }).map((p) => p.key);
    const base = keys({});
    for (const s of [{ from: B, to: A }, { state: { hover: true } }, { state: { dragging: true } },
      { zoom: 2.5 }, { state: { selected: true } }]) {
      assert.deepEqual(keys(s), base, JSON.stringify(s));
    }
    const refused = keys({ state: { refused: true } });
    assert.ok(refused.indexOf('band-to') < refused.indexOf('cross'), 'the cross is drawn over');
    assert.ok(base.indexOf('band-to') < base.indexOf('sheen'), 'the sheen runs over the bands');
    assert.ok(base.indexOf('stroke') < base.indexOf('bands'), 'over the cord');
    const svg = draw({ type: 'TRIGGER' });
    assert.match(svg, /<g data-bands="TRIGGER" pointer-events="none">(?:<path [^>]*\/>){2}<\/g>/);
    assert.equal((svg.match(/<g data-bands[^>]*>.*?<\/g>/)[0].match(/M /g) || []).length, 6,
      'three bands at each end');
    assert.equal(svg, CABLE.partsSvg(cordParts({ type: 'TRIGGER', colour: TOKENS.cable.palette[2],
      id: 'c1' })), 'cableSvg serialises them as every other part');
  });

test('JC-6: a short or coincident cord keeps finite bands', () => {
  for (const [from, to] of [[A, A], [A, { x: A.x + 3, y: A.y }], [A, { x: A.x, y: A.y + 30 }]]) {
    const bands = bandsOf(cordParts({ type: 'ANALYSIS', from, to }));
    for (const [p, q] of [...bands.from, ...bands.to]) {
      assert.ok([p.x, p.y, q.x, q.y].every(Number.isFinite), JSON.stringify([from, to]));
    }
  }
});

// ---------------------------------------------------------------- the cords amendment (11-05)
// Rule v4's amendment of 2026-11-05 (cords), af's YES and conditions of 07:5xZ: a cord is solid
// and its type the band pattern CABLE_BANDS near each plug; a Studio edge may keep CABLE_DASH;
// both are notations of PORT_VISUALS' one type. (a) the drawn bands are checked against the
// exported table, not a copy of it or a markup string; (b) the bands' ink is measured on every
// cord colour, as composited on every plate a cord crosses, in both themes.

/** The plates a cord is drawn over: the card, today's two plates and D-PAL's two (PF-04). */
const CORD_PLATES = Object.freeze([['card', '--osc-surface-2'], ['plateHi', '--osc-surface-3'],
  ['plateLo', '--osc-surface-1'], ['plate.hi', '--osc-plate-hi'], ['plate.lo', '--osc-plate-lo']]);
const plateOf = (tokens, key) => (key.startsWith('plate.') ? tokens.plate[key.slice(6)]
  : tokens.surface[key]);

test('cords amendment: one type, two notations, both keyed by PORT_VISUALS, and the rule says so',
  () => {
    const types = Object.keys(PORT_VISUALS);
    assert.deepEqual(Object.keys(CABLE.CABLE_BANDS), types, 'CABLE_BANDS: every type, no other');
    assert.deepEqual(Object.keys(CABLE_DASH), types, 'CABLE_DASH: every type, no other');
    for (const type of types) {
      assert.equal(CABLE_DASH[type] === null, PORT_VISUALS[type].cable === 'solid',
        `${type}: the Signal Path dash is solid exactly where PORT_VISUALS says so`);
    }
    const rule = readFileSync(new URL('../../.ai/repo/rules/project/visual-identity-lock.v4.md',
      import.meta.url), 'utf8');
    const at = rule.indexOf('# Amendment of 2026-11-05 (cords)');
    assert.ok(at >= 0, 'the rule carries the cords amendment');
    const end = rule.indexOf('\n# ', at + 1);
    const section = rule.slice(at, end < 0 ? undefined : end).replace(/\s+/g, ' ');
    for (const phrase of ['a patch cord is solid', 'the band pattern CABLE_BANDS near each plug',
      'AUDIO one, CONTROL two, TRIGGER three short, ANALYSIS a long and a short',
      'never colour alone', 'the Signal Path dash (CABLE_DASH)',
      'both are notations of PORT_VISUALS\' one type']) {
      assert.ok(section.includes(phrase), `the amendment states: ${phrase}`);
    }
    assert.doesNotMatch(rule.replace(/\s+/g, ' '), /cords? (?:are|is) dashed by (?:its )?type/i,
      'no statement left that cords are dashed by type');
  });

test('cords amendment (a): every type draws the pattern the exported CABLE_BANDS states', () => {
  const table = CABLE.CABLE_BANDS;
  for (const [type, pattern] of Object.entries(table)) {
    const count = Math.ceil(pattern.length / 2);
    for (const state of STATES) {
      for (const [from, to] of [[A, B], [B, A], [{ x: 0, y: 0 }, { x: 0, y: 200 }]]) {
        const parts = cordParts({ type, state, from, to });
        const where = `${type} ${JSON.stringify(state)} ${JSON.stringify([from, to])}`;
        assert.equal(parts.find((p) => p.key === 'bands').attrs['data-bands'], type, where);
        const bands = bandsOf(parts);
        for (const [end, centre] of [['from', from], ['to', to]]) {
          const spans = bands[end].map(([p, q]) => [p, q].map((x) => Math.hypot(x.x - centre.x,
            x.y - centre.y)));
          assert.equal(spans.length, count, `${where} ${end}: ${count} band(s), as the table says`);
          let s = CABLE.CABLE_BAND_AT;
          spans.forEach(([r0, r1], i) => {
            if (i > 0) s += pattern[2 * i - 1];
            assert.ok(Math.abs(r0 - s) < 1e-3, `${where} ${end} band ${i}: starts ${r0}, not ${s}`);
            assert.ok(Math.abs(r1 - r0 - pattern[2 * i]) < 1e-3,
              `${where} ${end} band ${i}: ${r1 - r0} long, the table says ${pattern[2 * i]}`);
            s += pattern[2 * i];
          });
        }
      }
    }
  }
});

test('cords amendment (b): the bands hold 3:1 on every cord colour, on every plate, both themes',
  async (t) => {
    const th = await tokenThemes();
    for (const [key, name] of CORD_PLATES) {
      const k = key.startsWith('plate.') ? SYNTH_TOKEN_NAMES.plate[key.slice(6)]
        : SYNTH_TOKEN_NAMES.surface[key];
      assert.equal(k, name, `${key} is ${name}`);
    }
    const short = [];
    let min = { ratio: Infinity, where: '' };
    for (const [name, theme] of Object.entries(th)) {
      const tokens = themed(theme);
      tokens.cable.palette.forEach((colour, i) => {
        for (const type of Object.keys(CABLE.CABLE_BANDS)) {
          const parts = cordParts({ tokens, colour, type });
          const cord = parts.find((p) => p.key === 'stroke').attrs;
          const bands = parts.filter((p) => /^band-/.test(p.key)).map((p) => p.attrs);
          assert.equal(cord.stroke, colour, 'the cord is drawn in its colour');
          assert.equal(bands.length, 2, 'a band path at each end');
          for (const [plate, plateName] of CORD_PLATES) {
            // As the browser paints them: the cord over the plate, the band over the cord, each
            // at the intensity its class reads (none: opaque).
            const ground = overOf(cord.stroke, plateOf(tokens, plate), intensityOf(cord.class));
            for (const band of bands) {
              const ratio = contrastOf(overOf(band.stroke, ground, intensityOf(band.class)),
                ground);
              const where = `${name} ${SYNTH_TOKEN_NAMES.cable.palette[i]} ${type} on ${plateName}`;
              if (ratio < min.ratio) min = { ratio, where };
              if (ratio < 3) short.push(`${where}: ${ratio.toFixed(2)}`);
            }
          }
        }
      });
    }
    t.diagnostic(`the least band contrast: ${min.ratio.toFixed(2)} (${min.where})`);
    assert.deepEqual(short, [], 'bands under 3:1 on their cord');
  });

// Beyond af's (b), measured while proving it (11-05): the shade (cordInk at hw-shadow, under the
// bands) and the sheen (over them) cross a band's lower and upper side, so a band also meets
// the shaded cord and, under the sheen, the sheened cord. There the ratio falls under 3:1:
// shaded 2.15 (light --osc-purple) to 5.71, sheened 2.82 (light --osc-purple) to 8.68. The
// remedy (the shade's or sheen's lane, or BAND_CORE) is a design call for the rule's owner.
test('cords amendment: a band holds 3:1 where the shade and the sheen cross it', {
  todo: 'measured under 3:1 on 7 of 12 cord colours shaded and 3 of 12 sheened; a call for af',
}, async () => {
  const th = await tokenThemes();
  const short = [];
  for (const [name, theme] of Object.entries(th)) {
    const tokens = themed(theme);
    tokens.cable.palette.forEach((colour, i) => {
      const parts = cordParts({ tokens, colour, type: 'CONTROL' });
      const a = (key) => parts.find((p) => p.key === key).attrs;
      const [band, shade, sheen] = [a('band-from'), a('shade'), a('sheen')];
      const lit = (x) => overOf(sheen.stroke, x, intensityOf(sheen.class));
      const banded = overOf(band.stroke, colour, intensityOf(band.class));
      const where = `${name} ${SYNTH_TOKEN_NAMES.cable.palette[i]}`;
      const shaded = contrastOf(banded, overOf(shade.stroke, colour, intensityOf(shade.class)));
      const sheened = contrastOf(lit(banded), lit(colour));
      if (shaded < 3) short.push(`${where} shaded ${shaded.toFixed(2)}`);
      if (sheened < 3) short.push(`${where} sheened ${sheened.toFixed(2)}`);
    });
  }
  assert.deepEqual(short, []);
});

test('JC-13: a cord 8.5 wide (9.5 hovered, 11 selected) in its rim', () => {
  const w = (state) => Number(cordParts({ state }).find((p) => p.key === 'stroke')
    .attrs['stroke-width']);
  assert.equal(CABLE.CABLE_WIDTH, 8.5);
  assert.equal(w({}), 8.5);
  assert.equal(w({ hover: true }), 9.5);
  assert.equal(w({ selected: true }), 11);
  assert.equal(w({ selected: true, hover: true }), 11);
});

test('JC-13: a shade 0.25 of the width from the light and a sheen 0.22 toward it, in the cord',
  () => {
    for (const state of [{}, { hover: true }, { selected: true }, { refused: true }]) {
      for (const zoom of [1, 2]) {
        const parts = cordParts({ state, zoom });
        const stroke = parts.find((p) => p.key === 'stroke').attrs;
        const w = Number(stroke['stroke-width']);
        const shade = parts.find((p) => p.key === 'shade');
        const sheen = parts.find((p) => p.key === 'sheen').attrs;
        const where = `${JSON.stringify(state)} at ${zoom}`;
        assert.equal(shade.parent, 'cable', `${where}: outside the pointer's group`);
        const keys = parts.map((p) => p.key);
        assert.equal(keys.indexOf('shade'), keys.indexOf('stroke') + 1, `${where}: on the stroke`);
        const s = shade.attrs;
        assert.equal(s.class, 'opacity-hw-shadow', `${where}: the hw-shadow intensity`);
        assert.equal(s.stroke, parts.find((p) => p.key === 'edge').attrs.stroke, 'the rim ink');
        assert.equal(sheen.stroke, TOKENS.control.highlight, 'the light depth role');
        assert.equal(s['pointer-events'], 'none');
        assert.equal(s['stroke-dasharray'], stroke['stroke-dasharray'], `${where}: as dashed`);
        assert.ok(Math.abs(Number(s['stroke-width']) - 0.25 * w) < 1e-6, `${where}: 0.25 w wide`);
        assert.ok(Math.abs(Number(sheen['stroke-width']) - 0.3 * w) < 1e-6, `${where}: 0.3 w`);
        // Mid-cord, each lies its offset from the stroke (beside it, review 7).
        const cord = cubicSamples(stroke.d, 400);
        const midOff = (d) => {
          const ps = cubicSamples(d, 64);
          return nearest(ps[ps.length >> 1], cord);
        };
        assert.ok(Math.abs(midOff(s.d) - 0.25 * w) < 0.02, `${where}: shade ${midOff(s.d)}`);
        assert.ok(Math.abs(midOff(sheen.d) - 0.22 * w) < 0.02,
          `${where}: sheen ${midOff(sheen.d)}`);
      }
    }
  });

test('JC-13: the soft shadow drops 3 screen px at rest, 6 lifted, 2 wider than the stroke', () => {
  for (const zoom of [1, 2]) {
    for (const state of [{}, { dragging: true }, { selected: true }]) {
      const parts = cordParts({ state, zoom });
      const sh = parts.find((p) => p.key === 'shadow').attrs;
      const w = Number(parts.find((p) => p.key === 'stroke').attrs['stroke-width']);
      assert.equal(Number(sh['stroke-width']), w + 2, JSON.stringify(state));
      const [, dy] = dropOf(` transform="${sh.transform}"`);
      assert.ok(Math.abs(dy * zoom - (state.dragging ? 6 : 3)) < 1e-6, `${dy} at ${zoom}`);
    }
  }
});

test('JC-14: CABLE_BOW 0.5; a vertical run bellies sideways at least CABLE_MIN_SAG', () => {
  assert.equal(CABLE.CABLE_BOW, 0.5);
  const bow = (a, b) => at(cableCurve(a, b), 0.5).x - (a.x + b.x) / 2;
  const o = { x: 0, y: 0 };
  // The belly at the middle: CABLE_BOW of min(sag, rise), never under CABLE_MIN_SAG for a rise of
  // twice that or more (half the rise below it), fading as the cord leans to |dx| = sag.
  assert.ok(Math.abs(bow(o, { x: 0, y: 300 }) - 45) < 1e-4, `300: ${bow(o, { x: 0, y: 300 })}`);
  assert.ok(Math.abs(bow(o, { x: 0, y: 200 }) - 30) < 1e-4, `200: ${bow(o, { x: 0, y: 200 })}`);
  assert.ok(Math.abs(bow(o, { x: 0, y: 44 }) - CABLE_MIN_SAG) < 1e-4, 'a jack pitch: 20');
  assert.ok(Math.abs(bow(o, { x: 0, y: 30 }) - 15) < 1e-4, 'a short rise: half of it');
  for (const rise of [40, 44, 88, 150, 300, 600, 1100]) {
    for (const [a, b] of [[o, { x: 0, y: rise }], [{ x: 0, y: rise }, o]]) {
      assert.ok(bow(a, b) >= CABLE_MIN_SAG - 1e-6, `${rise}: belly ${bow(a, b)}`);
      const d = cableCurve(a, b);
      const [p0, , , p3] = points(d);
      assert.deepEqual([p0, p3], [a, b], `${rise}: the ends stay on the plug centres`);
      // Never a straight elastic line: the cord strays from its chord by the belly or more.
      const off = Math.max(...Array.from({ length: 401 }, (_, i) => Math.abs(at(d, i / 400).x)));
      assert.ok(off >= CABLE_MIN_SAG - 1e-6, `${rise}: strays ${off} from the chord`);
    }
  }
  assert.equal(bow(o, o), 0, 'coincident ends: a droop, no belly');
  assert.ok(Math.abs(bow(o, { x: 200, y: 0 })) < 1e-6, 'a level cord: none');
  assert.ok(bow(o, { x: 10, y: 300 }) < bow(o, { x: 0, y: 300 }), 'less as it leans');
});

// ---------------------------------------------------------------- review of cords and plugs
// The adversarial review of 7c5d567f (11-05): the light theme's lighting was upside down and the
// cues did not show (1), the bands read as cuts in the dark theme (2), a long vertical cord in
// the rightmost column left the bay (3), the shade and sheen collapsed on 45° stretches (7), and
// the gaps its mutants found (8). Each cue is measured by rule (b) of oscilla-21's amendment,
// |ΔL*| >= 3 at the intensity its class reads.

const CORD_FACES = ['card', 'plateHi'];
/** The points of a path of M and C commands, `per` samples a cubic. */
function cubicSamples(d, per = 64) {
  const nums = d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
  assert.match(d, /^M \S+ \S+(?: C(?: \S+){6})+$/, `M then cubics: ${d}`);
  const out = [];
  let p0 = { x: nums[0], y: nums[1] };
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [c1, c2, p3] = [0, 2, 4].map((k) => ({ x: nums[i + k], y: nums[i + k + 1] }));
    for (let k = out.length ? 1 : 0; k <= per; k++) {
      const t = k / per;
      const u = 1 - t;
      const f = (key) => u * u * u * p0[key] + 3 * u * u * t * c1[key] + 3 * u * t * t * c2[key]
        + t * t * t * p3[key];
      out.push({ x: f('x'), y: f('y') });
    }
    p0 = p3;
  }
  return out;
}
const nearest = (p, qs) => Math.min(...qs.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));

test('review 1: the shade darkens and the sheen lightens every cord colour, both themes (b)',
  async () => {
    const th = await tokenThemes();
    const short = [];
    for (const [name, theme] of Object.entries(th)) {
      const tokens = themed(theme);
      tokens.cable.palette.forEach((colour, i) => {
        const parts = cordParts({ tokens, colour });
        const shade = parts.find((p) => p.key === 'shade').attrs;
        const sheen = parts.find((p) => p.key === 'sheen').attrs;
        const where = `${name} ${SYNTH_TOKEN_NAMES.cable.palette[i]}`;
        const dark = deltaLOf(shade.stroke, colour, intensityOf(shade.class));
        assert.ok(dark <= -3, `${where}: the shade ${shade.stroke} ΔL* ${dark.toFixed(2)}`);
        const light = deltaLOf(sheen.stroke, colour, intensityOf(sheen.class));
        assert.ok(light > 0, `${where}: the sheen ${sheen.stroke} lightens, ΔL* `
          + `${light.toFixed(2)}`);
        if (light < 3) short.push(`${where} ${light.toFixed(2)}`);
      });
    }
    // Measured: white at hw-sheen (0.12) lifts the dark theme's green (L* 77.8) by 1.94 only;
    // no token is lighter. Raising hw-sheen (a key of every sheen) is oscilla-21's call.
    assert.deepEqual(short, ['dark --osc-green 1.94'], 'the sheens under ΔL* 3');
  });

test('review 1: the soft shadow darkens the bay card and the plate under it, both themes (b)',
  async () => {
    const th = await tokenThemes();
    for (const [name, theme] of Object.entries(th)) {
      const tokens = themed(theme);
      const sh = cordParts({ tokens, colour: tokens.cable.palette[0] })
        .find((p) => p.key === 'shadow').attrs;
      for (const face of CORD_FACES) {
        const dl = deltaLOf(sh.stroke, tokens.surface[face], intensityOf(sh.class));
        assert.ok(dl <= -3, `${name} on ${face} ${tokens.surface[face]}: ΔL* ${dl.toFixed(2)}`);
      }
      for (const face of ['hi', 'lo']) {
        const dl = deltaLOf(sh.stroke, tokens.plate[face], intensityOf(sh.class));
        assert.ok(dl <= -3, `${name} on plate.${face}: ΔL* ${dl.toFixed(2)}`);
      }
    }
  });

test('review 1: the bay\'s token set (layerTokens of the panel\'s) lights the cord the same way',
  async () => {
    const { PANEL_TOKENS, CABLE_TOKENS } = await import('../../src/js/synth/view/tokens.js');
    const { layerTokens } = await import('../../src/js/ui/synth/jack.js');
    const th = await tokenThemes();
    for (const [name, theme] of Object.entries(th)) {
      const panel = Object.fromEntries(Object.entries(PANEL_TOKENS)
        .map(([k, v]) => [k, tokenHex(theme, v)]));
      panel.cables = CABLE_TOKENS.map((v) => tokenHex(theme, v));
      const full = themed(theme);
      const of = (tokens) => Object.fromEntries(cordParts({ tokens, colour: panel.cables[1] })
        .filter((p) => ['shadow', 'shade', 'sheen'].includes(p.key))
        .map((p) => [p.key, p.attrs.stroke]));
      assert.deepEqual(of(layerTokens(panel)), of(full), `${name}: the bay draws as the layer`);
    }
  });

test('review 1: a token set without the depth roles still lights the cord the right way',
  async () => {
    const th = await tokenThemes();
    for (const [name, theme] of Object.entries(th)) {
      const full = themed(theme);
      const tokens = { jack: full.jack, cable: full.cable, surface: { edge: full.surface.edge } };
      tokens.cable.palette.forEach((colour) => {
        const parts = cordParts({ tokens, colour });
        const paint = (k) => parts.find((p) => p.key === k).attrs;
        const shade = paint('shade');
        const sheen = paint('sheen');
        assert.ok(deltaLOf(shade.stroke, colour, intensityOf(shade.class)) < 0, `${name} shade`);
        assert.ok(deltaLOf(sheen.stroke, colour, intensityOf(sheen.class)) > 0, `${name} sheen`);
        const sh = paint('shadow');
        assert.ok(deltaLOf(sh.stroke, full.surface.card, intensityOf(sh.class)) < 0,
          `${name} shadow`);
      });
    }
  });

test('review 2: a band lies inside the cord, its colour on both sides, so it never reads as a cut',
  () => {
    for (const type of TYPES) {
      for (const state of [{}, { hover: true }, { selected: true }, { refused: true }]) {
        const parts = cordParts({ type, state });
        const w = Number(parts.find((p) => p.key === 'stroke').attrs['stroke-width']);
        for (const end of ['from', 'to']) {
          const band = Number(parts.find((p) => p.key === `band-${end}`).attrs['stroke-width']);
          const where = `${type} ${JSON.stringify(state)} ${end}`;
          assert.ok((w - band) / 2 >= 1.5, `${where}: the cord's colour shows ${(w - band) / 2} `
            + 'beside the band');
          assert.ok(band >= w / 2, `${where}: the band ${band} still reads across the cord ${w}`);
        }
      }
    }
  });

test('review 3: a long vertical cord in the rightmost column stays inside its box', () => {
  const box = { x: 0, y: 0, width: 390, height: 900 };
  const right = box.x + box.width;
  for (const x of [356, 350, 383 - 34, 370]) {
    for (const rise of [44, 120, 248, 310, 500, 800]) {
      for (const lean of [0, -6, 6]) {
        const ends = [{ x, y: 40 }, { x: x + lean, y: 40 + rise }];
        for (const [from, to] of [ends, [...ends].reverse()]) {
          for (const state of [{}, { selected: true }, { dragging: true }]) {
            const parts = cordParts({ from, to, box, state });
            const half = Math.max(...['edge', 'shadow'].map((k) => Number(parts
              .find((p) => p.key === k).attrs['stroke-width']) / 2));
            const d = parts.find((p) => p.key === 'stroke').attrs.d;
            const far = Math.max(...cubicSamples(d, 400).map((p) => p.x)) + half;
            assert.ok(far <= right + 1e-6, `${JSON.stringify([from, to, state])}: reaches ${far}`);
          }
        }
      }
    }
  }
  // It still bellies where the box leaves it room, and the bound moves it smoothly.
  const reachAt = (x) => Math.max(...cubicSamples(cableCurve({ x, y: 40 }, { x, y: 350 },
    { box }), 400).map((p) => p.x)) - x;
  assert.ok(reachAt(200) >= CABLE_MIN_SAG, 'room on the right: the full belly');
  let last = reachAt(300);
  for (let x = 300.5; x <= 383; x += 0.5) {
    const r = reachAt(x);
    assert.ok(Math.abs(r - last) < 1.5, `no jump at ${x}: ${last} to ${r}`);
    last = r;
  }
});

test('review 7: the shade and the sheen run beside the cord on every stretch, 45° ones included',
  () => {
    const CASES = [{ from: A, to: B }, { from: { x: 0, y: 0 }, to: { x: 300, y: 300 } },
      { from: { x: 300, y: 300 }, to: { x: 0, y: 0 } },
      { from: { x: 0, y: 0 }, to: { x: 0, y: 300 } },
      { from: { x: 0, y: 0 }, to: { x: 300, y: 0 } },
      { from: { x: 0, y: 300 }, to: { x: 300, y: 0 } },
      { from: { x: 0, y: 0 }, to: { x: 300, y: 100 }, tangents: { from: { x: 1, y: 0 },
        to: { x: -1, y: 0 } } },
      { from: { x: 300, y: 0 }, to: { x: 0, y: 100 }, tangents: { from: { x: 1, y: 0 },
        to: { x: -1, y: 0 } } }];
    for (const c of CASES) {
      for (const state of [{}, { selected: true }]) {
        const parts = cordParts({ ...c, state });
        const where = `${JSON.stringify(c)} ${JSON.stringify(state)}`;
        const a = (k) => parts.find((p) => p.key === k).attrs;
        const w = Number(a('stroke')['stroke-width']);
        const cord = cubicSamples(a('stroke').d, 256);
        // As drawn: a stripe's translate, if any, moves its points.
        const drawn = (k) => {
          const [dx, dy] = dropOf(` transform="${a(k).transform}"`);
          return cubicSamples(a(k).d, 64).map((p) => ({ x: p.x + dx, y: p.y + dy }));
        };
        const shade = drawn('shade');
        const sheen = drawn('sheen');
        const apart = Math.min(...sheen.map((p) => nearest(p, shade)));
        assert.ok(apart >= 0.3 * w, `${where}: shade and sheen ${apart.toFixed(2)} apart`);
        for (const k of ['shade', 'sheen']) {
          const half = Number(a(k)['stroke-width']) / 2;
          for (const p of k === 'shade' ? shade : sheen) {
            assert.ok(nearest(p, cord) + half <= w / 2 + 1e-6, `${where}: the ${k} inside`);
          }
        }
      }
    }
    // Lit from above and the left: the sheen on the upper side of a level cord, on the left of a
    // vertical one; the shade on the other.
    const mid = (k, from, to) => {
      const ps = cubicSamples(cordParts({ from, to }).find((p) => p.key === k).attrs.d, 64);
      return ps[Math.floor(ps.length / 2)];
    };
    const level = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
    assert.ok(mid('sheen', ...level).y < mid('stroke', ...level).y, 'level: the sheen above');
    assert.ok(mid('shade', ...level).y > mid('stroke', ...level).y, 'level: the shade below');
    const plumb = [{ x: 0, y: 0 }, { x: 0, y: 300 }];
    assert.ok(mid('sheen', ...plumb).x < mid('stroke', ...plumb).x, 'vertical: the sheen left');
    assert.ok(mid('shade', ...plumb).x > mid('stroke', ...plumb).x, 'vertical: the shade right');
  });

test('review 8: the belly fades to nothing at |dx| = sag, with no jump', () => {
  const bow = (a, b) => at(cableCurve(a, b), 0.5).x - (a.x + b.x) / 2;
  for (const rise of [60, 100, 300, 600]) {
    // The lean at which |dx| equals the sag it hangs at (bisection: the sag grows with dx).
    let lo = 0;
    let hi = 400;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (m < cableSag({ x: 0, y: 0 }, { x: m, y: rise })) lo = m;
      else hi = m;
    }
    const before = bow({ x: 0, y: 0 }, { x: lo - 1e-3, y: rise });
    const after = bow({ x: 0, y: 0 }, { x: hi + 1e-3, y: rise });
    assert.ok(Math.abs(before) < 0.01, `${rise}: ${before} just before |dx| = sag`);
    assert.ok(Math.abs(after) < 1e-5, `${rise}: none past it (${after})`);
  }
});
