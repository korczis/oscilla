// The shared synth-theme layer's patch plug (src/js/ui/synth/plug.js, plan F013 entry 3, slice
// S6; p2's core): plugSvg draws a sleeve of diameter 14 that fits inside a jack nut of 22 across
// flats, a boot ring 3 wide in the cable's colour (3:1 on the jack body in both themes), a grip
// collar of three ribs turned to the way the cable leaves, a tip and a centre, and a highlight at
// the hw-sheen intensity; it takes no pointer, so the jack's hit wins. Held, it is 1.1 times as
// large with its shadow lifted to 3; refused, it carries a cross inside its own sleeve, and the
// cable's own refused cross never overlaps it (or is left out with cross: false, so one mark
// shows the refusal).
//   node --test tests/unit/ui-synth-plug.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUG, plugSvg } from '../../src/js/ui/synth/plug.js';
import { cableDirections, cableSvg, plugSvg as plugFromCable }
  from '../../src/js/ui/synth/cable.js';
import { TOKENS, colourLiterals, contrastOf, intensityLiterals, paints, shapesWithoutStroke,
  tokenHex, tokenThemes, tokenValues } from './ui-synth-fixture.mjs';

const AT = { x: 40.5, y: -12.25 };
const COLOUR = TOKENS.cable.palette[2];
/** Half the nut's across-flats width: the radius of the circle the hex nut holds. */
const NUT_INNER = 22 / 2;
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
const dist = (x, y) => Math.hypot(x - AT.x, y - AT.y);

/** How far each drawn mark reaches from the plug's centre (the soft shadow apart). */
function reaches(svg) {
  const out = [];
  for (const { tag, attrs: a } of elements(svg)) {
    if ('data-shadow' in a) continue;
    const half = a.stroke && a.stroke !== 'none' ? n(a['stroke-width'] || 1) / 2 : 0;
    if (tag === 'circle') out.push(dist(n(a.cx), n(a.cy)) + n(a.r) + half);
    if (tag === 'line') {
      const far = Math.max(dist(n(a.x1), n(a.y1)), dist(n(a.x2), n(a.y2)));
      out.push(a['stroke-linecap'] === 'round' ? far + half : Math.hypot(far, half));
    }
    if (tag === 'path') {
      const m = /^M (\S+) (\S+) A (\S+) \S+ 0 0 1 (\S+) (\S+)$/.exec(a.d);
      assert.ok(m, `an arc: ${a.d}`);
      out.push(n(m[3]) + half);
    }
  }
  return out;
}
const reach = (svg) => Math.max(...reaches(svg));
const one = (svg, attr) => elements(svg).find((e) => attr in e.attrs);

// ---------------------------------------------------------------- geometry

test('the plug fits inside the jack nut, seated and held, within the room the cable keeps', () => {
  assert.equal(PLUG.sleeve * 2, 14, 'a sleeve of diameter 14');
  assert.ok(PLUG.room < NUT_INNER, 'inside a nut of 22 across flats');
  for (const dir of DIRS) {
    for (const state of STATES) {
      const svg = draw({ state, direction: dir });
      const held = typeof state === 'string' ? state === 'held' : Boolean(state.held);
      const r = reach(svg);
      assert.ok(r <= PLUG.sleeve * (held ? PLUG.held : 1) + 1e-6,
        `${JSON.stringify([state, dir])}: within its sleeve (${r})`);
      assert.ok(r <= PLUG.room, `within the room the cable's cross keeps clear (${r})`);
    }
  }
});

test('sleeve, boot ring, grip collar, tip, centre and highlight, each from its token', () => {
  const svg = draw();
  const sleeve = one(svg, 'data-sleeve').attrs;
  assert.equal(n(sleeve.r), 7);
  assert.equal(sleeve.fill, TOKENS.surface.plateHi, 'the sleeve is surface-3');
  const ring = one(svg, 'data-ring').attrs;
  assert.equal(ring.stroke, COLOUR, 'the boot ring is the cable colour');
  assert.equal(n(ring['stroke-width']), 3, 'and 3 wide');
  assert.equal(ring.fill, 'none');
  assert.equal(n(ring.r) + n(ring['stroke-width']) / 2, n(sleeve.r),
    'its outer edge is the sleeve\'s, so it borders the jack body');
  const ribs = elements(svg).filter((e) => 'data-rib' in e.attrs);
  assert.equal(ribs.length, 3, 'three ribs');
  for (const r of ribs) assert.equal(r.attrs.stroke, TOKENS.control.knurl, 'in --osc-border');
  assert.equal(one(svg, 'data-tip').attrs.stroke, TOKENS.surface.edge, 'the tip is --osc-bg');
  assert.equal(one(svg, 'data-centre').attrs.fill, TOKENS.surface.edge, 'the centre too');
  const sheen = one(svg, 'data-sheen').attrs;
  assert.equal(sheen.class, 'opacity-hw-sheen', 'the highlight is the hw-sheen intensity');
  assert.equal(sheen.stroke, TOKENS.cable.sheen);
  const shadow = one(svg, 'data-shadow').attrs;
  assert.equal(shadow.class, 'opacity-hw-shadow');
  assert.equal(shadow.fill, TOKENS.cable.shadow);
  assert.equal(TOKENS.surface.plateHi, 'var(--osc-surface-3)');
  assert.equal(TOKENS.control.knurl, 'var(--osc-border)');
  assert.equal(TOKENS.surface.edge, 'var(--osc-bg)');
});

test('the boot ring holds 3:1 on the jack body for every cable colour, both themes', async () => {
  const themes = await tokenThemes();
  const palette = ['--osc-cyan', '--osc-red-soft', '--osc-magenta', '--osc-green',
    '--osc-purple', '--osc-blue'];
  assert.deepEqual(TOKENS.cable.palette, palette.map((p) => `var(${p})`));
  assert.equal(TOKENS.jack.body, 'var(--osc-surface-0)');
  for (const [name, theme] of Object.entries(themes)) {
    for (const p of palette) {
      const ratio = contrastOf(tokenHex(theme, p), tokenHex(theme, '--osc-surface-0'));
      assert.ok(ratio >= 3, `${name} ${p}: ${ratio.toFixed(2)} on the jack body`);
    }
  }
});

test('the grip collar turns to the way the cable leaves; down by default', () => {
  const mid = (svg) => {
    const ribs = elements(svg).filter((e) => 'data-rib' in e.attrs);
    const a = ribs[1].attrs;
    return { x: (n(a.x1) + n(a.x2)) / 2 - AT.x, y: (n(a.y1) + n(a.y2)) / 2 - AT.y };
  };
  for (const [dir, want] of [[undefined, { x: 0, y: 1 }], [{ x: 1, y: 0 }, { x: 1, y: 0 }],
    [{ x: -3, y: 4 }, { x: -0.6, y: 0.8 }]]) {
    const m = mid(draw({ direction: dir }));
    const len = Math.hypot(m.x, m.y);
    assert.ok(Math.abs(m.x / len - want.x) < 1e-5 && Math.abs(m.y / len - want.y) < 1e-5,
      `${JSON.stringify(dir)}: the middle rib lies along ${JSON.stringify(want)}`);
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

test('seated, held and refused: held is 1.1 times as large with its shadow lifted to 3', () => {
  const seated = draw();
  assert.match(seated, /^<g data-plug="" pointer-events="none">/);
  assert.equal(draw({ state: 'seated' }), seated);
  assert.equal(draw({ state: {} }), seated);
  assert.match(one(seated, 'data-shadow').attrs.transform, /^translate\(0 1\)$/);
  const held = draw({ state: 'held' });
  assert.match(held, /^<g data-plug="" pointer-events="none" data-held="">/);
  assert.ok(Math.abs(n(one(held, 'data-sleeve').attrs.r) - 7 * PLUG.held) < 1e-9);
  assert.equal(PLUG.held, 1.1);
  assert.equal(one(held, 'data-sleeve').attrs.cx, String(AT.x), 'drawn at the pointer');
  assert.match(one(held, 'data-shadow').attrs.transform, /^translate\(0 3\)$/, 'lifted to 3');
  assert.equal(PLUG.lift.held, 3);
  const refused = draw({ state: 'refused' });
  assert.match(refused, /^<g data-plug="" pointer-events="none" data-refused="">/);
  assert.equal(seated.includes('data-cross'), false, 'no cross unless refused');
  const lines = elements(refused).filter((e) => e.tag === 'line' && !('data-rib' in e.attrs));
  assert.equal(lines.length, 4, 'two arms over two underlay arms');
  assert.deepEqual(lines.map((l) => l.attrs.stroke), [TOKENS.cable.shadow, TOKENS.cable.shadow,
    TOKENS.jack.refuse, TOKENS.jack.refuse], 'red over its shadow');
  const both = draw({ state: { held: true, refused: true } });
  assert.match(both, /^<g data-plug="" pointer-events="none" data-held="" data-refused="">/);
  for (const bad of ['lifted', 3, { held: 'yes' }]) {
    assert.throws(() => draw({ state: bad }), RangeError, JSON.stringify(bad));
  }
});

test('plugSvg({ at, colour, tokens }) works as before, from cable.js as from plug.js', () => {
  assert.equal(plugFromCable, plugSvg);
  const svg = plugFromCable({ at: { x: 12.5, y: -4 }, colour: TOKENS.cable.palette[1],
    tokens: TOKENS });
  assert.ok(/cx="12.5" cy="-4"/.test(svg));
  assert.ok(svg.includes(`stroke="${TOKENS.cable.palette[1]}"`));
  assert.ok(draw({ colour: undefined }).includes('stroke="currentColor"'), 'no colour: current');
  assert.throws(() => plugSvg({ at: { x: 0, y: NaN }, colour: 'c', tokens: TOKENS }), /finite/);
  assert.throws(() => plugSvg({ at: AT, colour: 'c' }), /tokens/);
  assert.ok(draw({ colour: 'a"<b>' }).includes('stroke="a&quot;&lt;b&gt;"'), 'escaped');
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

test('the refused cross: inside the plug, and the cable\'s never overlaps it', () => {
  for (const state of ['refused', { held: true, refused: true }]) {
    const svg = draw({ state });
    const cross = /<g data-cross=""[^>]*>(.*?)<\/g>/.exec(svg)[1];
    const r = Math.max(...reaches(cross));
    const k = typeof state === 'object' ? PLUG.held : 1;
    assert.ok(r <= PLUG.sleeve * k, `the plug's cross stays on its sleeve (${r})`);
  }
  for (const [from, to] of [[{ x: 0, y: 0 }, AT], [{ x: 300, y: 40 }, AT],
    [{ x: 40, y: -200 }, AT], [{ x: 40.5, y: 200 }, AT]]) {
    const svg = cableSvg({ id: 'r', from, to, type: 'CONTROL', colour: COLOUR, tokens: TOKENS,
      state: { refused: true, dragging: true } });
    const { c, r } = cableCross(svg);
    const gap = Math.hypot(c.x - to.x, c.y - to.y) - r;
    for (const state of ['refused', { held: true, refused: true }]) {
      const plug = draw({ state, direction: cableDirections(from, to).to });
      assert.ok(gap >= reach(plug), `${JSON.stringify(from)}: the cable's cross ${gap} from the `
        + `plug, which reaches ${reach(plug)}`);
    }
    assert.ok(gap >= PLUG.room, 'clear of the whole room');
  }
});

test('cross: false leaves the cable\'s cross to the refused plug, so one cross shows', () => {
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
