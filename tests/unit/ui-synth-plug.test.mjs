// The shared synth-theme layer's patch plug (src/js/ui/synth/plug.js, plan F013 entry 3; the
// look audit's JC-3, p2's core): the plug COVERS the socket (the announced owner default of
// 2026-11-04 21:55Z, not objected; it replaces dev-53's S6c bound of 5.3, which kept a 10.5 eye
// floating inside the ring). plugSvg draws a moulded boot seen from the front: a cap of radius
// PLUG.boot (13.5) on the jack, joined by its two tangents to a neck of radius PLUG.neck (11)
// PLUG.reach (6) along the way the cable leaves, in the cable's colour inside an outline of the
// cord's rim ink (3:1 for every palette colour in both themes); one strain-relief band on the
// neck at the hw-shadow intensity and one sheen band on the cap at hw-sheen, lit from the upper
// left whatever the direction; no tip, dot or ribs. Every mark, its lifted shadow included,
// stays within PLUG.room (19.875): inside the jack's 44 px hit square, clear of a neighbour's
// plug a jack pitch away and above the jack's label. It takes no pointer, so the jack's hit wins.
// Held, it keeps its seated size with its shadow lifted to 2.5; refused, it carries a cross on
// its cap, and the cable's own refused cross keeps clear of it (or is left out with cross: false
// or plug: 'refused', so one mark shows the refusal).
//   node --test tests/unit/ui-synth-plug.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PLUG, castInk, cordInk, plugState, plugSvg, sheenInk }
  from '../../src/js/ui/synth/plug.js';
import { cableDirections, cableParts, cableSvg, plugSvg as plugFromCable }
  from '../../src/js/ui/synth/cable.js';
import { SYNTH_TOKEN_NAMES, tokensFrom } from '../../src/js/ui/synth/tokens.js';
import { LAYER_TOKENS, TOKENS, colourLiterals, contrastOf, deltaLOf, intensityLiterals,
  intensityOf, paints, shapesWithoutStroke, tokenHex, tokenThemes, tokenValues }
  from './ui-synth-fixture.mjs';

const AT = { x: 40.5, y: -12.25 };
const COLOUR = TOKENS.cable.palette[2];
/** The jack this tree draws (src/js/ui/synth/jack.js), pinned and checked against the file
 *  below: the socket ring's radius JACK_R, its default stroke, the nut's circumradius, the hit
 *  square and the label's baseline below the centre at its 12 px size. */
const JACK = Object.freeze({ r: 13, ringWidth: 2, nutR: 17, hit: 44, label: 34, font: 12 });
/** Two seated jacks are never nearer than their 44 px hit squares allow. */
const JACK_PITCH = 44;
const JACK_URL = new URL('../../src/js/ui/synth/jack.js', import.meta.url);
const STATES = ['seated', 'held', 'refused', { held: true, refused: true }, {}];
const DIRS = [undefined, { x: 1, y: 0 }, { x: -3, y: 4 }, { x: 0, y: -1 }, { x: 0.2, y: 1 }];

const draw = (over = {}) => plugSvg({ at: AT, colour: COLOUR, tokens: TOKENS, ...over });

/** Every element of a markup string: { tag, attrs, raw }. */
function elements(svg) {
  return [...svg.matchAll(/<([a-z]+)\b([^>]*?)\/?>/g)].map(([raw, tag, body]) => ({
    tag, raw,
    attrs: Object.fromEntries([...body.matchAll(/\s([\w:-]+)="([^"]*)"/g)].map((m) => [m[1],
      m[2]])),
  }));
}
const n = (x) => Number(x);
const dist = (p, q = AT) => Math.hypot(p.x - q.x, p.y - q.y);
const one = (svg, attr) => elements(svg).find((e) => attr in e.attrs);
const unit = (v) => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

/** An SVG arc's centre and its angles (SVG implementation notes F.6.5; rx = ry, no rotation). */
function arcOf(p0, p1, r, large, sweep) {
  const h = { x: (p0.x - p1.x) / 2, y: (p0.y - p1.y) / 2 };
  const k = Math.sqrt(Math.max(0, (r * r - (h.x ** 2 + h.y ** 2)) / (h.x ** 2 + h.y ** 2)))
    * (large === sweep ? -1 : 1);
  const c = { x: k * h.y + (p0.x + p1.x) / 2, y: -k * h.x + (p0.y + p1.y) / 2 };
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  let span = Math.atan2(p1.y - c.y, p1.x - c.x) - a0;
  if (sweep && span < 0) span += 2 * Math.PI;
  if (!sweep && span > 0) span -= 2 * Math.PI;
  return { c, r, a0, span };
}
/** The pieces of a path of M, L, A and Z: each { kind, from, to, arc }. */
function pieces(d) {
  const t = d.trim().split(/\s+/);
  const out = [];
  let i = 0;
  let at;
  let start;
  while (i < t.length) {
    const cmd = t[i++];
    if (cmd === 'M') {
      at = { x: n(t[i]), y: n(t[i + 1]) };
      start = at;
      i += 2;
    } else if (cmd === 'L') {
      const to = { x: n(t[i]), y: n(t[i + 1]) };
      out.push({ kind: 'L', from: at, to });
      at = to;
      i += 2;
    } else if (cmd === 'A') {
      const [r, , , large, sweep, x, y] = t.slice(i, i + 7).map(n);
      const to = { x, y };
      out.push({ kind: 'A', from: at, to, arc: arcOf(at, to, r, large, sweep) });
      at = to;
      i += 7;
    } else if (cmd === 'Z') {
      if (dist(at, start) > 1e-9) out.push({ kind: 'L', from: at, to: start });
      at = start;
    } else {
      assert.fail(`an unexpected command ${cmd} in ${d}`);
    }
  }
  return out;
}
/** Points along a path, `per` to a piece. */
function trace(d, per = 180) {
  return pieces(d).flatMap((p) => Array.from({ length: per + 1 }, (_, k) => {
    const s = k / per;
    if (p.kind === 'L') return { x: p.from.x + (p.to.x - p.from.x) * s,
      y: p.from.y + (p.to.y - p.from.y) * s };
    const a = p.arc.a0 + p.arc.span * s;
    return { x: p.arc.c.x + p.arc.r * Math.cos(a), y: p.arc.c.y + p.arc.r * Math.sin(a) };
  }));
}
/** How far each drawn mark reaches from the plug's centre; with `shadow`, the soft shadow too,
 *  moved by its translate. */
function reaches(svg, { shadow = false } = {}) {
  const out = [];
  for (const { tag, attrs: a } of elements(svg)) {
    if ('data-shadow' in a && !shadow) continue;
    const half = a.stroke && a.stroke !== 'none' ? n(a['stroke-width'] || 1) / 2 : 0;
    const m = /^translate\(0 ([\d.]+)\)$/.exec(a.transform || '');
    const dy = m ? n(m[1]) : 0;
    if (tag === 'line') {
      const far = Math.max(dist({ x: n(a.x1), y: n(a.y1) }), dist({ x: n(a.x2), y: n(a.y2) }));
      out.push(a['stroke-linecap'] === 'round' ? far + half : Math.hypot(far, half));
    }
    if (tag === 'path') {
      out.push(Math.max(...trace(a.d).map((p) => dist({ x: p.x, y: p.y + dy }))) + half);
    }
    if (tag === 'circle') out.push(dist({ x: n(a.cx), y: n(a.cy) + dy }) + n(a.r) + half);
  }
  return out;
}
const reach = (svg, o) => Math.max(...reaches(svg, o));
/** The boot's two circles from its outline: the cap about AT and the neck along `dir`. */
function bootOf(svg, dir = { x: 0, y: 1 }) {
  const boot = one(svg, 'data-boot').attrs;
  const ps = pieces(boot.d);
  assert.deepEqual(ps.map((p) => p.kind), ['A', 'L', 'A', 'L'], `cap, tangent, neck: ${boot.d}`);
  return { boot, cap: ps[0].arc, neck: ps[2].arc, lines: [ps[1], ps[3]], d: unit(dir) };
}

// ---------------------------------------------------------------- geometry (JC-3)

test('JC-3: the plug is a boot of a 13.5 cap and an 11 neck 6 along the cord, within its room',
  () => {
    assert.equal(PLUG.boot, 13.5, 'the cap over the socket');
    assert.equal(PLUG.neck, 11, 'the neck the cord leaves through');
    assert.equal(PLUG.reach, 6, 'the neck\'s centre, along the cord');
    assert.equal(PLUG.edge, 0.75, 'its outline: the cord\'s rim');
    assert.equal(PLUG.room, PLUG.reach + PLUG.neck + PLUG.edge / 2 + PLUG.lift.held,
      'the room: the neck\'s far edge and its lifted shadow');
    assert.equal(PLUG.room, 19.875);
    assert.ok(Object.isFrozen(PLUG) && Object.isFrozen(PLUG.lift));
    for (const dir of DIRS) {
      for (const state of STATES) {
        const svg = draw({ state, direction: dir });
        const where = JSON.stringify([state, dir]);
        const r = reach(svg);
        assert.ok(Math.abs(r - (PLUG.reach + PLUG.neck + PLUG.edge / 2)) < 1e-6,
          `${where}: the neck's far edge is the farthest mark (${r})`);
        assert.ok(reach(svg, { shadow: true }) <= PLUG.room + 1e-6, `${where}: within the room`);
      }
    }
  });

test('JC-3: the plug covers the socket, inside its hit square, clear of a neighbour and label',
  () => {
    assert.ok(PLUG.boot >= JACK.r + 0.5, 'the cap covers the socket ring\'s centre line and more');
    assert.ok(PLUG.boot - PLUG.edge / 2 > JACK.r, 'and its body covers the ring, not its outline');
    assert.ok(PLUG.room < JACK.hit / 2, 'inside the 44 px hit square of its jack');
    assert.ok(2 * PLUG.room < JACK_PITCH, 'two plugs a jack pitch apart never touch');
    assert.ok(PLUG.room < JACK.label - JACK.font, 'above the top of the label\'s 12 px line');
    const { cap } = bootOf(draw());
    assert.ok(dist(cap.c) < 1e-6, 'the cap is centred on the jack');
    assert.ok(Math.abs(cap.r - PLUG.boot) < 1e-9);
  });

test('JC-3: the boot outline is the cap and the neck joined by their two tangents', () => {
  for (const dir of DIRS.filter(Boolean).concat([undefined])) {
    const svg = draw({ direction: dir });
    const { cap, neck, lines, d } = bootOf(svg, dir);
    const where = JSON.stringify(dir);
    assert.ok(dist(cap.c) < 1e-6 && Math.abs(cap.r - PLUG.boot) < 1e-9, `${where}: the cap`);
    const want = { x: AT.x + PLUG.reach * d.x, y: AT.y + PLUG.reach * d.y };
    assert.ok(dist(neck.c, want) < 1e-5, `${where}: the neck ${PLUG.reach} along the cord`);
    assert.ok(Math.abs(neck.r - PLUG.neck) < 1e-9, `${where}: radius ${PLUG.neck}`);
    assert.ok(Math.abs(cap.span) > Math.PI, `${where}: the cap's arc goes round the back`);
    assert.ok(Math.abs(neck.span) < Math.PI, `${where}: the neck's arc is the front`);
    for (const l of lines) {
      const v = unit({ x: l.to.x - l.from.x, y: l.to.y - l.from.y });
      for (const [p, c] of [[l.from, cap.c], [l.to, neck.c], [l.from, neck.c], [l.to, cap.c]]) {
        const r = unit({ x: p.x - c.x, y: p.y - c.y });
        const onIt = Math.abs(dist(p, c) - (c === cap.c ? PLUG.boot : PLUG.neck)) < 1e-5;
        if (onIt) assert.ok(Math.abs(v.x * r.x + v.y * r.y) < 1e-5, `${where}: a tangent`);
      }
    }
    const front = { x: AT.x + (PLUG.reach + PLUG.neck) * d.x, y: AT.y + (PLUG.reach + PLUG.neck)
      * d.y };
    const near = Math.min(...trace(one(svg, 'data-boot').attrs.d).map((p) => dist(p, front)));
    assert.ok(near < 0.01, `${where}: the outline passes the neck's front (${near})`);
  }
});

test('JC-3: the boot in the cord colour, its outline the cord\'s rim ink; no tip, dot or rib',
  () => {
    const svg = draw();
    const boot = one(svg, 'data-boot').attrs;
    assert.equal(boot.fill, COLOUR, 'the boot is the cord colour');
    assert.equal(boot.stroke, cordInk(TOKENS), 'outlined in the cord\'s rim ink');
    assert.equal(n(boot['stroke-width']), PLUG.edge);
    assert.equal(boot.class, undefined, 'opaque');
    for (const gone of ['data-sleeve', 'data-ring', 'data-rib', 'data-tip', 'data-centre',
      'data-grip']) {
      assert.equal(svg.includes(gone), false, `no ${gone}`);
    }
    const shadow = one(svg, 'data-shadow').attrs;
    assert.equal(shadow.d, boot.d, 'the shadow is the boot\'s shape');
    assert.equal(shadow.class, 'opacity-hw-shadow');
    assert.equal(shadow.fill, TOKENS.control.shade, 'the dark depth role (review 1)');
    assert.equal(shadow.stroke, 'none');
    assert.ok(svg.indexOf('data-shadow') < svg.indexOf('data-boot'), 'under the boot');
    assert.ok(draw({ colour: undefined }).includes('fill="currentColor"'), 'no colour: current');
  });

test('JC-3: one strain-relief band on the neck at hw-shadow, one sheen band on the cap', () => {
  for (const dir of DIRS) {
    const svg = draw({ direction: dir });
    const where = JSON.stringify(dir);
    const d = unit(dir || { x: 0, y: 1 });
    const neckC = { x: AT.x + PLUG.reach * d.x, y: AT.y + PLUG.reach * d.y };
    const reliefs = elements(svg).filter((e) => 'data-relief' in e.attrs);
    assert.equal(reliefs.length, 1, `${where}: one strain-relief band`);
    const relief = reliefs[0].attrs;
    assert.equal(relief.class, 'opacity-hw-shadow', 'at the hw-shadow intensity');
    assert.equal(relief.stroke, cordInk(TOKENS), 'the rim ink, dark in both themes (review 1)');
    assert.equal(relief.fill, 'none');
    const [arc] = pieces(relief.d);
    assert.ok(dist(arc.arc.c, neckC) < 1e-5, `${where}: about the neck`);
    assert.ok(arc.arc.r + n(relief['stroke-width']) / 2 <= PLUG.neck - PLUG.edge / 2 + 1e-9,
      `${where}: inside the neck's outline`);
    const mid = arc.arc.a0 + arc.arc.span / 2;
    assert.ok(Math.cos(mid) * d.x + Math.sin(mid) * d.y > 0.999, `${where}: facing the cord`);
    const sheens = elements(svg).filter((e) => 'data-sheen' in e.attrs);
    assert.equal(sheens.length, 1, `${where}: one sheen band`);
    const sheen = sheens[0].attrs;
    assert.equal(sheen.class, 'opacity-hw-sheen');
    assert.equal(sheen.stroke, TOKENS.control.highlight, 'the light depth role (review 1)');
    const [s] = pieces(sheen.d);
    assert.ok(dist(s.arc.c) < 1e-4, `${where}: about the cap`);
    assert.ok(s.arc.r + n(sheen['stroke-width']) / 2 <= PLUG.boot - PLUG.edge / 2 + 1e-9,
      `${where}: inside the cap's outline`);
    const lit = s.arc.a0 + s.arc.span / 2;
    assert.ok(Math.cos(lit) < -0.4 && Math.sin(lit) < -0.4, `${where}: lit from the upper left`);
  }
  assert.equal(one(draw({ direction: { x: 1, y: 0 } }), 'data-sheen').attrs.d,
    one(draw(), 'data-sheen').attrs.d, 'the light does not turn with the cord');
});

test('cordInk: the darker of the cable shadow and sheen, else the shadow, else currentColor',
  async () => {
    assert.equal(cordInk(TOKENS), TOKENS.cable.shadow, 'var() values cannot be read: the shadow');
    const th = await tokenThemes();
    for (const [name, theme] of Object.entries(th)) {
      const tokens = tokensFrom((x) => tokenHex(theme, x));
      const ink = cordInk(tokens);
      const darker = contrastOf(tokens.cable.shadow, '#000000')
        <= contrastOf(tokens.cable.sheen, '#000000') ? tokens.cable.shadow : tokens.cable.sheen;
      assert.equal(ink, darker, `${name}: the darker ink`);
      for (const p of tokens.cable.palette) {
        const ratio = contrastOf(p, ink);
        assert.ok(ratio >= 3, `${name} ${p}: ${ratio.toFixed(2)} on its outline ${ink}`);
      }
    }
    assert.equal(cordInk({ cable: { sheen: '#000000' } }), 'currentColor', 'no shadow: current');
  });

test('sheenInk and castInk: the depth roles, else the lighter and the darker cable ink',
  async () => {
    assert.equal(sheenInk(TOKENS), TOKENS.control.highlight);
    assert.equal(castInk(TOKENS), TOKENS.control.shade);
    const bare = { jack: TOKENS.jack, cable: TOKENS.cable, surface: TOKENS.surface };
    assert.equal(sheenInk(bare), TOKENS.cable.sheen, 'var() values cannot be read: the sheen');
    assert.equal(castInk(bare), cordInk(bare));
    const th = await tokenThemes();
    for (const [name, theme] of Object.entries(th)) {
      const t = tokensFrom((x) => tokenHex(theme, x));
      const b = { jack: t.jack, cable: t.cable, surface: t.surface };
      const lighter = contrastOf(t.cable.shadow, '#000000') > contrastOf(t.cable.sheen, '#000000')
        ? t.cable.shadow : t.cable.sheen;
      assert.equal(sheenInk(b), lighter, `${name}: the lighter ink`);
      assert.equal(castInk(b), cordInk(b), `${name}: the darker ink`);
    }
    assert.equal(sheenInk({ cable: {} }), 'currentColor');
    assert.equal(castInk({}), 'currentColor');
  });

test('the boot turns to the way the cable leaves; down by default', () => {
  for (const [dir, want] of [[undefined, { x: 0, y: 1 }], [{ x: 1, y: 0 }, { x: 1, y: 0 }],
    [{ x: -3, y: 4 }, { x: -0.6, y: 0.8 }]]) {
    const { neck } = bootOf(draw({ direction: dir }), dir);
    const v = unit({ x: neck.c.x - AT.x, y: neck.c.y - AT.y });
    assert.ok(Math.abs(v.x - want.x) < 1e-5 && Math.abs(v.y - want.y) < 1e-5,
      `${JSON.stringify(dir)}: the neck lies along ${JSON.stringify(want)}`);
  }
  assert.equal(draw({ direction: { x: 0, y: 1 } }), draw(), 'down is the default');
  for (const bad of [{ x: 0, y: 0 }, { x: NaN, y: 1 }, 'down', null]) {
    assert.throws(() => draw({ direction: bad }), TypeError, JSON.stringify(bad));
  }
});

test('cableDirections: each end\'s leaving direction, along the ports with tangents', () => {
  const a = { x: 10, y: 20 };
  const b = { x: 210, y: 60 };
  const { from, to } = cableDirections(a, b);
  for (const v of [from, to]) assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9, 'a unit');
  assert.ok(from.x > 0 && from.y > 0, 'from a, rightward and down into the sag');
  assert.ok(to.x < 0 && to.y > 0, 'from b, leftward and down into the sag');
  const d = /C (\S+) (\S+)/.exec(cableSvg({ id: 'q', from: a, to: b, type: 'AUDIO',
    colour: 'c', tokens: TOKENS }).match(/ d="([^"]*)"/)[1]);
  const c1 = { x: n(d[1]) - a.x, y: n(d[2]) - a.y };
  const l = Math.hypot(c1.x, c1.y);
  assert.ok(Math.abs(from.x - c1.x / l) < 1e-6 && Math.abs(from.y - c1.y / l) < 1e-6,
    'toward the first control point');
  const t = cableDirections(a, b, { tangents: { from: { x: 2, y: 0 }, to: { x: 0, y: -5 } } });
  assert.ok(Math.abs(t.from.x - 1) < 1e-6 && Math.abs(t.from.y) < 1e-6, 'out along the source');
  assert.ok(Math.abs(t.to.x) < 1e-6 && Math.abs(t.to.y + 1) < 1e-6, 'out along the target port');
  const same = cableDirections(a, a);
  assert.ok([same.from, same.to].every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)));
  assert.throws(() => cableDirections({ x: NaN, y: 0 }, b), TypeError);
});

// ---------------------------------------------------------------- states

test('seated, held and refused: held keeps its size, with its shadow lifted to 2.5', () => {
  const seated = draw();
  assert.match(seated, /^<g data-plug="" pointer-events="none">/);
  assert.equal(draw({ state: 'seated' }), seated);
  assert.equal(draw({ state: {} }), seated);
  assert.match(one(seated, 'data-shadow').attrs.transform, /^translate\(0 1\)$/);
  const held = draw({ state: 'held' });
  assert.match(held, /^<g data-plug="" pointer-events="none" data-held="">/);
  assert.equal(PLUG.held, 1, 'held does not scale: it keeps the seated footprint');
  assert.equal(one(held, 'data-boot').attrs.d, one(seated, 'data-boot').attrs.d,
    'drawn at the pointer, its seated size');
  assert.match(one(held, 'data-shadow').attrs.transform, /^translate\(0 2.5\)$/,
    'lifted to 2.5');
  assert.equal(PLUG.lift.held, 2.5);
  const refused = draw({ state: 'refused' });
  assert.match(refused, /^<g data-plug="" pointer-events="none" data-refused="">/);
  assert.equal(seated.includes('data-cross'), false, 'no cross unless refused');
  const lines = elements(refused).filter((e) => e.tag === 'line');
  assert.equal(lines.length, 4, 'two arms over two underlay arms');
  assert.deepEqual(lines.map((l) => l.attrs.stroke), [TOKENS.cable.shadow, TOKENS.cable.shadow,
    TOKENS.jack.refuse, TOKENS.jack.refuse], 'red over its shadow');
  for (const l of lines) {
    const len = Math.hypot(n(l.attrs.x2) - n(l.attrs.x1), n(l.attrs.y2) - n(l.attrs.y1));
    assert.ok(len >= 8, `an arm large enough to read on the cap (${len})`);
  }
  const both = draw({ state: { held: true, refused: true } });
  assert.match(both, /^<g data-plug="" pointer-events="none" data-held="" data-refused="">/);
  for (const bad of ['lifted', 3, { held: 'yes' }, [], ['held'], { hold: true },
    { held: true, dragging: true }]) {
    assert.throws(() => draw({ state: bad }), RangeError, JSON.stringify(bad));
  }
});

test('plugState refuses every object that is not a plain record of held and refused', () => {
  const hidden = { held: true };
  Object.defineProperty(hidden, 'hold', { value: true, enumerable: false });
  class State { constructor() { this.held = true; } }
  for (const [what, bad] of [['a date', new Date(0)], ['a map', new Map([['held', true]])],
    ['an inherited key', Object.create({ hold: true })], ['a hidden key', hidden],
    ['a symbol key', { [Symbol('held')]: true }], ['a class instance', new State()],
    ['a function', () => {}], ['NaN', NaN], ['a symbol', Symbol('held')],
    ['a bigint', 1n], ['true', true]]) {
    assert.throws(() => plugState(bad), RangeError, what);
  }
  assert.throws(() => plugState(NaN), /not NaN\.$/, 'NaN named as NaN, not null');
  assert.throws(() => plugState(Symbol('x')), /not Symbol\(x\)\.$/);
  const bare = Object.assign(Object.create(null), { held: true });
  assert.deepEqual({ ...plugState(bare) }, { held: true, refused: false }, 'a null prototype');
  assert.throws(() => plugState({ hold: true }), /^RangeError: plugSvg: state must be /);
});

test('plugSvg({ at, colour, tokens }) works as before, from cable.js as from plug.js', () => {
  assert.equal(plugFromCable, plugSvg);
  const svg = plugFromCable({ at: { x: 12.5, y: -4 }, colour: TOKENS.cable.palette[1],
    tokens: TOKENS });
  assert.ok(/^M \S+ \S+ A 13\.5 13\.5 /.test(one(svg, 'data-boot').attrs.d));
  assert.ok(svg.includes(`fill="${TOKENS.cable.palette[1]}"`));
  assert.throws(() => plugSvg({ at: { x: 0, y: NaN }, colour: 'c', tokens: TOKENS }), /finite/);
  assert.throws(() => plugSvg({ at: AT, colour: 'c' }), /tokens/);
  assert.ok(draw({ colour: 'a"<b>' }).includes('fill="a&quot;&lt;b&gt;"'), 'escaped');
});

test('a panel\'s narrower token set draws from its own roles, never currentColor', () => {
  // The patch bay's adapter (layerTokens) passes { jack, cable, surface: { edge } }.
  for (const state of STATES) {
    for (const dir of DIRS) {
      const svg = plugSvg({ at: AT, colour: COLOUR, tokens: LAYER_TOKENS, state, direction: dir });
      const allowed = new Set(tokenValues(LAYER_TOKENS));
      for (const p of paints(svg)) {
        assert.ok(p !== 'currentColor' && (p === 'none' || allowed.has(p)),
          `${JSON.stringify([state, dir])}: paint ${p}`);
      }
    }
  }
});

test('the pinned jack is the jack this tree draws, where it carries jack.js', async (t) => {
  if (!existsSync(JACK_URL)) {
    t.skip('jack.js is not on this branch');
    return;
  }
  const jack = await import(JACK_URL.href);
  assert.equal(jack.JACK_R, JACK.r, 'JACK_R');
  assert.equal(jack.JACK_HIT, JACK.hit, 'JACK_HIT');
  const svg = jack.jackSvg({ key: 'k', x: 0, y: 0, shape: 'circle', label: 'l', ring: 'r',
    inner: 'i', text: 't', textSize: JACK.font, tokens: {} });
  const ring = /data-ring="" [^>]*stroke-width="([\d.]+)"/.exec(svg);
  assert.equal(n(ring[1]), JACK.ringWidth, 'the default ring stroke');
  assert.match(svg, new RegExp(`<text x="0" y="${JACK.label}" font-size="${JACK.font}"`),
    'the label\'s baseline and size');
  const nut = jack.nutSvg({ x: 0, y: 0, tokens: {} });
  const pts = [...nut.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.hypot(n(m[1]), n(m[2])));
  for (const d of pts) assert.ok(Math.abs(d - JACK.nutR) < 0.01, `NUT_R ${d}`);
});

// ---------------------------------------------------------------- rules

test('no pointer events: the plug never takes the jack\'s hit', () => {
  for (const state of STATES) {
    for (const dir of DIRS) {
      const svg = draw({ state, direction: dir });
      assert.match(svg, /^<g data-plug="" pointer-events="none"/);
      assert.doesNotMatch(svg, /pointer-events="(?!none")/);
      assert.doesNotMatch(svg, /visibility=|tabindex|role=/, 'nothing to hit or focus');
    }
  }
});

test('no literal intensity, no colour literal, every shape strokes, every paint a token', () => {
  const allowed = new Set([...tokenValues(), 'none', 'currentColor']);
  for (const state of STATES) {
    for (const dir of DIRS) {
      const svg = draw({ state, direction: dir });
      assert.deepEqual(intensityLiterals(svg), [], JSON.stringify(state));
      assert.deepEqual(colourLiterals(svg), []);
      assert.deepEqual(shapesWithoutStroke(svg), []);
      for (const p of paints(svg)) assert.ok(allowed.has(p), `paint ${p}`);
    }
  }
  const src = readFileSync(new URL('../../src/js/ui/synth/plug.js', import.meta.url), 'utf8');
  assert.deepEqual(intensityLiterals(src), [], 'plug.js source');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /<animate|\.animate\(|requestAnimationFrame|transition|setTimeout/,
    'no motion');
  assert.doesNotMatch(code, /addEventListener|(?<![\w.])(?:document|window)\./, 'no listener');
  assert.deepEqual([...src.matchAll(/^import .* from '([^']+)';$/gm)], [], 'imports nothing');
});

// ---------------------------------------------------------------- the refused cross rule

/** The centre and reach of a cable's refused cross, or null. */
function cableCross(svg) {
  const g = /<g data-cross=""[^>]*>(.*?)<\/g>/.exec(svg);
  if (!g) return null;
  const ls = elements(g[1]).map((e) => e.attrs);
  const c = { x: (n(ls[0].x1) + n(ls[0].x2)) / 2, y: (n(ls[0].y1) + n(ls[0].y2)) / 2 };
  const r = Math.max(...ls.map((a) => Math.hypot(n(a.x1) - c.x, n(a.y1) - c.y)
    + n(a['stroke-width']) / 2));
  return { c, r };
}

/** Points along a cable's stroke path (M then cubics), `per` samples a cubic. */
function samples(svg, per = 256) {
  const d = /data-stroke=""[^>]* d="([^"]*)"/.exec(svg)?.[1]
    ?? / d="([^"]*)"[^>]*data-stroke=""/.exec(svg)[1];
  const nums = d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
  const pts = [];
  let p0 = { x: nums[0], y: nums[1] };
  for (let i = 2; i + 5 < nums.length + 1; i += 6) {
    const [c1x, c1y, c2x, c2y, ex, ey] = nums.slice(i, i + 6);
    for (let k = 0; k <= per; k++) {
      const t = k / per;
      const u = 1 - t;
      const f = (a, b, c, e) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c
        + t * t * t * e;
      pts.push({ x: f(p0.x, c1x, c2x, ex), y: f(p0.y, c1y, c2y, ey) });
    }
    p0 = { x: ex, y: ey };
  }
  return pts;
}
/** cable.js's CROSS_BACK: PLUG.room, the cross's reach (arm 5 × √2, half its underlay), 1. */
const CROSS_BACK = PLUG.room + 5 * Math.SQRT2 + 4.5 / 2 + 1;
const FROM = { x: 3, y: 7 };
/** The ends at `len` from FROM in 24 directions, each hanging and with opposite ports facing
 *  8 ways: every shape a cable between two jacks takes. */
function* cablesAt(len) {
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI) / 12;
    const to = { x: FROM.x + len * Math.cos(a), y: FROM.y + len * Math.sin(a) };
    yield { from: FROM, to, how: {} };
    for (let j = 0; j < 8; j++) {
      const b = (j * Math.PI) / 4;
      const t = { x: Math.cos(b), y: Math.sin(b) };
      yield { from: FROM, to, how: { tangents: { from: t, to: { x: -t.x, y: -t.y } } } };
    }
  }
}
const refusedCable = (from, to, over = {}) => cableSvg({ id: 'r', from, to, type: 'CONTROL',
  colour: COLOUR, tokens: TOKENS, state: { refused: true, dragging: true }, ...over });

test('the refused cross: the plug\'s on its cap; the cable\'s clear of the plugs', () => {
  for (const state of ['refused', { held: true, refused: true }]) {
    const svg = draw({ state });
    const cross = /<g data-cross=""[^>]*>(.*?)<\/g>/.exec(svg)[1];
    const r = Math.max(...reaches(cross));
    assert.ok(r <= PLUG.boot - PLUG.edge / 2, `the plug's cross stays on its cap (${r})`);
  }
  // The plug covers its socket (JC-3), so two plugs a jack pitch (44) apart leave about 4 between
  // their rooms: the cable's cross clears both plugs only for ends 2 × CROSS_BACK (60.4) or more
  // apart, in every direction, hanging or along facing ports; nearer, it clears the target plug
  // and may meet the source plug, which is drawn over it (the bay's plug layer).
  assert.ok(2 * CROSS_BACK > JACK_PITCH && 2 * CROSS_BACK < 61, `2 x CROSS_BACK ${2 * CROSS_BACK}`);
  for (const len of [61, 64, 88, 200, 300]) {
    for (const { from, to, how } of cablesAt(len)) {
      const { c, r } = cableCross(refusedCable(from, to, how));
      for (const end of [from, to]) {
        const gap = Math.hypot(c.x - end.x, c.y - end.y) - r;
        assert.ok(gap >= PLUG.room, `${len} ${JSON.stringify([to, how])}: the cable's cross ${gap} `
          + `from a plug, whose room is ${PLUG.room}`);
      }
    }
  }
  for (const len of [JACK_PITCH, 50, 56]) {
    for (const { from, to, how } of cablesAt(len)) {
      const svg = refusedCable(from, to, how);
      const { c, r } = cableCross(svg);
      const far = Math.max(...samples(svg).map((p) => Math.hypot(p.x - to.x, p.y - to.y)));
      const gap = Math.hypot(c.x - to.x, c.y - to.y) - r;
      if (far >= CROSS_BACK) {
        assert.ok(gap >= PLUG.room, `${len} ${JSON.stringify([to, how])}: clear of the target `
          + `plug (${gap})`);
      }
    }
  }
  for (const [from, to] of [[{ x: 0, y: 0 }, AT], [{ x: 300, y: 40 }, AT],
    [{ x: 40, y: -200 }, AT], [{ x: 40.5, y: 200 }, AT]]) {
    const { c, r } = cableCross(refusedCable(from, to));
    const gap = Math.hypot(c.x - to.x, c.y - to.y) - r;
    for (const state of ['refused', { held: true, refused: true }]) {
      const plug = draw({ state, direction: cableDirections(from, to).to });
      assert.ok(gap >= reach(plug), `${JSON.stringify(from)}: ${gap} from a plug reaching `
        + `${reach(plug)}`);
    }
  }
});

test('a cable shorter than a jack pitch: its cross on its point farthest from the target', () => {
  // Too short to set the cross clear of the target plug, the cable takes its point farthest
  // from the target, so the cross may meet a plug here (a held plug can be anywhere under the
  // pointer). A held refused plug is drawn with plug: 'refused' passed to the cable, which then
  // draws no cross at any length, so the two never meet.
  for (const len of [5, 10, 15, 20, 30]) {
    for (const { from, to, how } of cablesAt(len)) {
      const svg = refusedCable(from, to, how);
      const { c } = cableCross(svg);
      const far = Math.max(...samples(svg).map((p) => Math.hypot(p.x - to.x, p.y - to.y)));
      const at = Math.hypot(c.x - to.x, c.y - to.y);
      assert.ok(at <= far + 1e-3, `${len}: the cross lies on the cable`);
      assert.ok(at >= Math.min(far, CROSS_BACK) - 0.5, `${len} ${JSON.stringify([to, how])}: `
        + `${at} from the target, the farthest the cable reaches being ${far}`);
      assert.equal(cableCross(refusedCable(from, to, { ...how, plug: 'refused' })), null,
        `${len}: told its target plug is refused, the cable draws no cross`);
    }
  }
});

test('one cross per refusal: told the target plug\'s state, the cable leaves its cross to it',
  () => {
    const spec = { id: 'r', from: { x: 0, y: 0 }, to: AT, type: 'AUDIO', colour: COLOUR,
      tokens: TOKENS, state: { refused: true } };
    const count = (svg) => (svg.match(/data-cross=""/g) || []).length;
    // The default path: a refused cable with no plug state draws its own cross, the one mark.
    assert.equal(count(cableSvg(spec)), 1, 'a refused cable alone: its own cross');
    for (const plug of ['refused', { refused: true }, { held: true, refused: true }]) {
      const cable = cableSvg({ ...spec, plug });
      assert.equal(cableCross(cable), null, `${JSON.stringify(plug)}: no cross on the cable`);
      assert.match(cable, /^<g data-cable="r" data-refused=""/, 'still marked refused');
      assert.match(cable, /stroke-dasharray="4 4"/, 'and still dashed, a shape not a colour');
      assert.equal(cable, cableSvg({ ...spec, cross: false }), 'as cross: false draws it');
      assert.equal(count(cable + draw({ state: plug })), 1, 'one cross for one refusal');
      assert.throws(() => cableSvg({ ...spec, plug, cross: true }), RangeError,
        'a cross asked for beside a refused plug: two marks refused');
    }
    for (const plug of ['seated', 'held', {}, { held: true }]) {
      assert.equal(cableSvg({ ...spec, plug }), cableSvg(spec), `${JSON.stringify(plug)}: the `
        + 'cable keeps its cross, the plug draws none');
      assert.equal(count(draw({ state: plug })), 0);
    }
    for (const bad of ['lifted', [], { hold: true }, 3]) {
      assert.throws(() => cableSvg({ ...spec, plug: bad }), RangeError, JSON.stringify(bad));
      assert.throws(() => cableSvg({ ...spec, plug: bad }), /^RangeError: cableSvg: plug must be /,
        'the message names the plug option, not the cable\'s state');
      assert.throws(() => cableParts({ ...spec, plug: bad }), /^RangeError: cableParts: plug /);
    }
    // A cable that is not refused draws no cross, so cross: true beside a refused plug marks
    // nothing twice: it is drawn as the same cable told nothing.
    const fine = { ...spec, state: {} };
    assert.equal(cableSvg({ ...fine, plug: 'refused', cross: true }), cableSvg(fine));
    assert.equal(cableSvg({ ...fine, plug: 'refused' }), cableSvg(fine));
  });

test('cross: false leaves the cable\'s cross out, so one cross shows', () => {
  const spec = { id: 'r', from: { x: 0, y: 0 }, to: AT, type: 'AUDIO', colour: COLOUR,
    tokens: TOKENS, state: { refused: true } };
  const off = cableSvg({ ...spec, cross: false });
  assert.equal(cableCross(off), null, 'no cross on the cable');
  assert.match(off, /^<g data-cable="r" data-refused=""/, 'still marked refused');
  assert.match(off, /stroke-dasharray="4 4"/, 'and still dashed, a shape and not a colour');
  assert.equal(cableSvg({ ...spec, cross: true }), cableSvg(spec), 'true is the default');
  const marks = (off + draw({ state: 'refused' })).match(/data-cross=""/g);
  assert.equal(marks.length, 1, 'one cross for one refusal');
  assert.throws(() => cableSvg({ ...spec, cross: 'no' }), TypeError);
});

// ---------------------------------------------------------------- review of cords and plugs
// The adversarial review of 7c5d567f (11-05): the plug's relief and sheen were lit upside down
// in the light theme (1), a plug hid its jack's pending and compatible ring (4), and the
// geometry its mutants changed unseen (8).

test('review 1: the relief darkens and the sheen lightens the boot, both themes (b)', async () => {
  const th = await tokenThemes();
  const short = [];
  for (const [name, theme] of Object.entries(th)) {
    const tokens = tokensFrom((x) => tokenHex(theme, x));
    tokens.cable.palette.forEach((colour, i) => {
      const svg = plugSvg({ at: AT, colour, tokens });
      const relief = one(svg, 'data-relief').attrs;
      const sheen = one(svg, 'data-sheen').attrs;
      const where = `${name} ${SYNTH_TOKEN_NAMES.cable.palette[i]}`;
      const dark = deltaLOf(relief.stroke, colour, intensityOf(relief.class));
      assert.ok(dark <= -3, `${where}: the relief ${relief.stroke} ΔL* ${dark.toFixed(2)}`);
      const light = deltaLOf(sheen.stroke, colour, intensityOf(sheen.class));
      assert.ok(light > 0, `${where}: the sheen lightens, ΔL* ${light.toFixed(2)}`);
      if (light < 3) short.push(`${where} ${light.toFixed(2)}`);
      const sh = one(svg, 'data-shadow').attrs;
      for (const face of ['card', 'plateHi']) {
        const dl = deltaLOf(sh.fill, tokens.surface[face], intensityOf(sh.class));
        assert.ok(dl <= -3, `${where}: the shadow on ${face} ΔL* ${dl.toFixed(2)}`);
      }
      assert.equal(one(svg, 'data-boot').attrs.stroke, cordInk(tokens), `${where}: the outline`);
    });
  }
  // The cord's measured shortfall (ui-synth-cable): oscilla-21's hw-sheen.
  assert.deepEqual(short, ['dark --osc-green 1.94'], 'the sheens under ΔL* 3');
});

test('review 4: a plug carries its jack\'s state ring round its boot, inside its room', () => {
  const RING = 'var(--osc-focus)';
  for (const state of STATES) {
    for (const dir of DIRS) {
      const where = JSON.stringify([state, dir]);
      const svg = draw({ state, direction: dir, ring: RING });
      const halo = one(svg, 'data-halo');
      assert.ok(halo, `${where}: a halo`);
      const boot = one(svg, 'data-boot').attrs;
      assert.equal(halo.attrs.d, boot.d, `${where}: round the boot's own outline`);
      assert.equal(halo.attrs.stroke, RING);
      assert.equal(halo.attrs.fill, 'none');
      assert.equal(halo.attrs.class, undefined, `${where}: opaque, as the jack's ring`);
      const shows = (n(halo.attrs['stroke-width']) - PLUG.edge) / 2;
      assert.ok(shows >= 2, `${where}: ${shows} of it shows outside the outline, all round`);
      const order = ['data-shadow', 'data-halo', 'data-boot'].map((k) => svg.indexOf(k));
      assert.deepEqual([...order].sort((x, y) => x - y), order, `${where}: under the boot`);
      assert.ok(reach(svg, { shadow: true }) <= PLUG.room + 1e-6, `${where}: within the room`);
      assert.equal(draw({ state, direction: dir }).includes('data-halo'), false, 'none untold');
    }
  }
  for (const bad of ['', 3, {}]) {
    assert.throws(() => draw({ ring: bad }), TypeError, JSON.stringify(bad));
  }
});

test('review 8: the relief, the sheen and the cross are where the plug says', () => {
  for (const dir of DIRS) {
    const where = JSON.stringify(dir);
    const d = unit(dir || { x: 0, y: 1 });
    const svg = draw({ direction: dir, state: 'refused' });
    const relief = one(svg, 'data-relief').attrs;
    const [r] = pieces(relief.d);
    assert.ok(Math.abs(r.arc.r - 8.5) < 1e-6, `${where}: the relief's radius ${r.arc.r}`);
    assert.ok(Math.abs(Math.abs(r.arc.span) - 1.8) < 1e-4, `${where}: ±0.9 rad`);
    assert.equal(n(relief['stroke-width']), 2);
    const lead = Math.atan2(d.y, d.x);
    const mid = r.arc.a0 + r.arc.span / 2;
    assert.ok(Math.cos(mid - lead) > 1 - 1e-9, `${where}: centred on the cord`);
    const sheen = one(svg, 'data-sheen').attrs;
    const [s] = pieces(sheen.d);
    assert.ok(Math.abs(s.arc.r - 10.5) < 1e-6, `${where}: the sheen's radius ${s.arc.r}`);
    const deg = (a) => ((a * 180) / Math.PI + 360) % 360;
    assert.ok(Math.abs(deg(s.arc.a0) - 200) < 1e-3, `${where}: from 200° (${deg(s.arc.a0)})`);
    assert.ok(Math.abs(deg(s.arc.a0 + s.arc.span) - 260) < 1e-3, `${where}: to 260°`);
    assert.equal(n(sheen['stroke-width']), 1.5);
    const lines = elements(svg).filter((e) => e.tag === 'line');
    for (const l of lines) {
      const len = Math.hypot(n(l.attrs.x2) - n(l.attrs.x1), n(l.attrs.y2) - n(l.attrs.y1));
      assert.ok(Math.abs(len - 8 * Math.SQRT2) < 1e-4, `${where}: an arm of 4 each way (${len})`);
    }
    assert.deepEqual(lines.map((l) => n(l.attrs['stroke-width'])), [3, 3, 2, 2]);
  }
});

test('review 8: the boot\'s outline is the cord\'s rim ink, which is not the shadow in light',
  async () => {
    const th = await tokenThemes();
    const tokens = tokensFrom((x) => tokenHex(th.light, x));
    assert.notEqual(cordInk(tokens), tokens.cable.shadow, 'light: the rim ink is the text');
    const svg = plugSvg({ at: AT, colour: tokens.cable.palette[0], tokens });
    assert.equal(one(svg, 'data-boot').attrs.stroke, cordInk(tokens));
  });
