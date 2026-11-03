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
  CABLE_DASH, CABLE_HIT_PX, CABLE_MAX_SAG, CABLE_MIN_SAG, CABLE_REACH, REFUSED_DASH, SETTLE_MS,
  cableCurve, cableParts, cableSag, cableSvg, plugSvg, settle,
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
  assert.deepEqual(parts.map((p) => p.key), ['cable', 'shadow', 'main', 'hit', 'stroke', 'cross',
    'cross-under-0', 'cross-under-1', 'cross-0', 'cross-1', 'sheen']);
});

test('cableParts: the keys are stable as the cable moves and changes state', () => {
  const keys = (s) => cableParts({ id: 'k', type: 'AUDIO', tokens: TOKENS, from: A, to: B, ...s })
    .map((p) => p.key);
  const base = keys({});
  assert.deepEqual(base, ['cable', 'shadow', 'main', 'hit', 'stroke']);
  for (const s of [{ from: B, to: A }, { state: { hover: true } }, { state: { selected: true } },
    { state: { dragging: true } }, { zoom: 3 }]) {
    assert.deepEqual(keys(s), base, JSON.stringify(s));
  }
  const refused = keys({ state: { refused: true } });
  assert.deepEqual(refused.slice(0, base.length), base, 'the cross adds parts, after the rest');
  assert.deepEqual(keys({ sheen: true }), [...base, 'sheen']);
});

test('cableParts: a keyed editor that inserts a new part before the next key paints as markup',
  () => {
    const src = readFileSync(new URL('../../src/js/ui/synth/cable.js', import.meta.url), 'utf8');
    assert.match(src, /insertBefore/, 'the doc says where a new part goes');
    // A minimal keyed editor, as the doc tells one to work: set attributes in place, remove
    // what left, insert a new part before the node of the next part of the same parent.
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
          n = { tag: p.tag, up, children: [] };
          const next = parts.slice(i + 1).find((q) => q.parent === p.parent && nodes.has(q.key));
          const at = next ? up.children.indexOf(nodes.get(next.key)) : up.children.length;
          up.children.splice(at, 0, n);
          nodes.set(p.key, n);
        }
        n.attrs = p.attrs;
      });
    };
    const markup = (n) => {
      const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
      return n.children.length ? `<${n.tag}${attrs}>${n.children.map(markup).join('')}</${n.tag}>`
        : `<${n.tag}${attrs}/>`;
    };
    const spec = { id: 'e', from: A, to: B, type: 'CONTROL', tokens: TOKENS, sheen: true };
    for (const state of [{}, { refused: true }, { hover: true }, { refused: true, dragging: true },
      {}]) {
      apply(cableParts({ ...spec, state }));
      assert.equal(root.children.map(markup).join(''), cableSvg({ ...spec, state }),
        JSON.stringify(state));
    }
  });

test('cableParts: attribute values are raw strings (setAttribute), escaped only in markup', () => {
  const parts = cableParts({ id: 'a"<b>&', from: A, to: B, type: 'AUDIO', tokens: TOKENS });
  assert.equal(parts[0].attrs['data-cable'], 'a"<b>&');
  assert.match(cableSvg({ id: 'a"<b>&', from: A, to: B, type: 'AUDIO', tokens: TOKENS }),
    /^<g data-cable="a&quot;&lt;b&gt;&amp;"/);
  const stroke = parts.find((p) => p.key === 'stroke');
  assert.equal(stroke.attrs.d, cableCurve(A, B));
  assert.equal(stroke.attrs['stroke-width'], '4.5');
});

test('cableParts: the dash is an input; CABLE_DASH is only its default', () => {
  const stroke = (s) => cableParts({ id: 'd', from: A, to: B, type: 'CONTROL', tokens: TOKENS,
    ...s }).find((p) => p.key === 'stroke').attrs;
  assert.equal(stroke({})['stroke-dasharray'], CABLE_DASH.CONTROL, 'the default');
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

test('cableSvg with no new input draws what it drew before cableParts (pinned)', () => {
  const svg = cableSvg({ id: 'g1', from: { x: 10, y: 20 }, to: { x: 210, y: 60 },
    type: 'CONTROL', colour: TOKENS.cable.palette[1], tokens: TOKENS,
    state: { refused: true, dragging: true }, zoom: 2, sheen: true });
  const d = 'M 10 20 C 76.666667 101.32026 143.333333 114.653594 210 60';
  const ln = (x1, y1, x2, y2, s, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" `
    + `stroke="var(--osc-${s})" stroke-width="${w}" stroke-linecap="round"/>`;
  const arms = (s, w) => ln('190.514998', '65.805009', '200.514998', '75.805009', s, w)
    + ln('190.514998', '75.805009', '200.514998', '65.805009', s, w);
  assert.equal(svg, '<g data-cable="g1" data-refused="" pointer-events="none">'
    + `<path data-shadow="" class="opacity-hw-shadow" d="${d}" fill="none" `
    + 'stroke="var(--osc-bg)" stroke-width="7.5" stroke-linecap="round" '
    + 'transform="translate(0 1.5)"/>'
    + `<g data-main="" pointer-events="stroke"><path data-hit="" d="${d}" fill="none" `
    + 'stroke="currentColor" visibility="hidden" stroke-width="44" '
    + 'vector-effect="non-scaling-stroke" stroke-linecap="round"/>'
    + `<path data-stroke="" d="${d}" fill="none" stroke="var(--osc-red)" stroke-width="4.5" `
    + 'stroke-linecap="butt" stroke-dasharray="9 6"/></g>'
    + `<g data-cross="" pointer-events="none">${arms('bg', '4.5')}${arms('red', '2')}</g>`
    + `<path data-sheen="" class="opacity-hw-sheen" d="${d}" fill="none" `
    + 'stroke="var(--osc-text)" stroke-width="1.35" stroke-linecap="butt" '
    + 'stroke-dasharray="9 6" transform="translate(-0.35 -0.35)" pointer-events="none"/></g>');
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

test('tangents: a backward loop stays clear of both its ends', () => {
  const CLEAR = CABLE_MIN_SAG;
  for (const [a, b] of BACKWARD) {
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
  const a = { x: 500, y: 300 };
  for (const dy of [-200, -20, 0, 40, 300]) {
    let prev = null;
    for (let x = 700; x >= 300; x -= 0.5) {
      const pts = sampled(cableCurve(a, { x, y: 300 + dy }, { tangents: EDGE }), 40);
      if (prev) {
        const jump = Math.max(...pts.map((p, i) => Math.hypot(p.x - prev[i].x, p.y - prev[i].y)));
        assert.ok(jump < 4, `dy ${dy}, x ${x}: a 0.5 step moves the cable ${jump.toFixed(2)}`);
      }
      prev = pts;
    }
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
  assert.ok(toEnd > 10 && toEnd < 30, `at the target end (${toEnd})`);
});

test('tangents: less than one reach behind, the cable folds only near its ends', () => {
  assert.equal(CABLE_REACH, 40);
  const a = { x: 0, y: 0 };
  for (let back = 1; back < CABLE_REACH; back += 3) {
    for (const dy of [-520, -360, -60, -10, 0, 10, 60, 360, 520]) {
      const b = { x: -back, y: dy };
      const d = cableCurve(a, b, { tangents: EDGE });
      assert.doesNotMatch(d, /NaN|Infinity/);
      const { leave, arrive } = endDirections(d);
      assert.ok(angle(leave, RIGHT) < 1 && angle(arrive, RIGHT) < 1, `${back} ${dy}: ports`);
      const pts = sampled(d, 100);
      for (let i = 0; i < pts.length - 1; i++) {
        for (let j = i + 2; j < pts.length - 1; j++) {
          if (!crosses(pts[i], pts[i + 1], pts[j], pts[j + 1])) continue;
          const near = Math.min(Math.hypot(pts[i].x - a.x, pts[i].y - a.y),
            Math.hypot(pts[i].x - b.x, pts[i].y - b.y));
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
  assert.equal(rest0, 20);
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
