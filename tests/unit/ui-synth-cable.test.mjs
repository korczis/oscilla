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
  CABLE_DASH, CABLE_HIT_PX, CABLE_MAX_SAG, CABLE_MIN_SAG, REFUSED_DASH, cableCurve, cableSvg,
  plugSvg,
} from '../../src/js/ui/synth/cable.js';
import { TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues, intensityLiterals }
  from './ui-synth-fixture.mjs';

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

test('a long cable hangs at most CABLE_MAX_SAG (60) below its chord', () => {
  assert.equal(CABLE_MAX_SAG, 60);
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
  assert.ok(sagOf(A, B, { slack: 0 }) >= CABLE_MIN_SAG - 1e-9, 'slack 0 still hangs');
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

test('the soft shadow is the shadow token at hw-shadow: wider, 1 screen px down, 3 lifted', () => {
  for (const state of STATES) {
    for (const zoom of [0.5, 1, 2, 3]) {
      const svg = draw({ state, zoom });
      const shadow = shadowOf(svg);
      const where = `${JSON.stringify(state)} at ${zoom}`;
      assert.ok(shadow.includes(`stroke="${TOKENS.cable.shadow}"`), `${where}: the shadow token`);
      assert.match(shadow, /\sclass="opacity-hw-shadow"/, `${where}: the hw-shadow intensity`);
      assert.doesNotMatch(shadow, /opacity="|filter|style=/, `${where}: no literal intensity`);
      assert.ok(width(shadow) > width(mainStroke(svg)), `${where}: wider than the stroke`);
      assert.ok(svg.indexOf('data-shadow') < svg.indexOf('data-stroke'), `${where}: under it`);
      const [dx, dy] = dropOf(shadow);
      assert.equal(dx, 0, `${where}: straight down`);
      assert.ok(Math.abs(dy * zoom - (state.dragging ? 3 : 1)) < 1e-5,
        `${where}: the offset is in screen px (${dy} graph units)`);
    }
  }
  assert.ok(dropOf(shadowOf(draw({ state: { dragging: true } })))[1]
    > dropOf(shadowOf(draw()))[1], 'dragging lifts the shadow');
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
        const main = mainStroke(draw({ type, state }));
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
  assert.equal(linecap(mainStroke(draw({ type: 'AUDIO' }))), 'round');
});

test('every dashed type keeps its own dasharray when hovered and selected', () => {
  for (const type of TYPES.filter((t) => CABLE_DASH[t] !== null)) {
    for (const state of WIDTH_STATES) {
      const main = mainStroke(draw({ type, state }));
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
  const PLUG = 7 + 1.5 / 2; // plugSvg's sleeve and half its ring
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
      assert.ok(toEnd <= 30, `${where}: at the target end (${toEnd} from it)`);
      assert.ok(toEnd < Math.hypot(c.x - from.x, c.y - from.y), `${where}: nearer the target`);
    }
  }
});

test('the sheen stripe is drawn only when asked, and takes no pointer', () => {
  const svg = draw({ sheen: true });
  const sheen = /<path data-sheen=""[^>]*>/.exec(svg)[0];
  assert.match(sheen, /pointer-events="none"/);
  assert.ok(width(sheen) < width(mainStroke(svg)));
  assert.ok(sheen.includes(`stroke="${TOKENS.cable.sheen}"`), 'the cable.sheen token');
  assert.match(sheen, /\sclass="opacity-hw-sheen"/, 'the intensity is the hw-sheen key');
  assert.doesNotMatch(sheen, /opacity="/, 'no opacity attribute');
  assert.match(sheen, /transform="translate\(-0.7 -0.7\)"/);
  const at2 = /<path data-sheen=""[^>]*>/.exec(draw({ sheen: true, zoom: 2 }))[0];
  assert.match(at2, /transform="translate\(-0.35 -0.35\)"/, 'the offset is in screen px');
  const dashed = /<path data-sheen=""[^>]*>/.exec(draw({ sheen: true, type: 'CONTROL' }))[0];
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
  assert.ok(plug.includes(`stroke="${TOKENS.cable.palette[1]}"`));
  assert.ok(/cx="12.5" cy="-4"/.test(plug));
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
