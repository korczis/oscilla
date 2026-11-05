// The shared synth-theme layer's tokens (src/js/ui/synth/tokens.js; dev-53's layer design, the
// token API agreed 2026-11-02): synthTokens(el) reads OSCILLA's --osc-* custom properties at
// run time into one deep-frozen set of five groups, a missing value reads currentColor, and
// tokensFrom(lookup) is the same mapping without a DOM. The layer's sources carry no colour
// literal and no product name (project.visual-identity-lock v3), and no role is an intensity:
// opacity is the hw-* Tailwind keys', and the cable shadow is an opaque token (v4). The two depth
// roles (control.shade, control.highlight: --osc-hw-shade, --osc-hw-highlight; oscilla-21's
// amendment (a)-(e) of 11-04) hold their ratios in both themes and are visible, |ΔL*| >= 3,
// over every face the layer draws them on, the pairs read from what knob.js and xy.js draw.
//   node --test tests/unit/ui-synth-tokens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { SYNTH_TOKEN_NAMES, synthTokens, tokensFrom } from '../../src/js/ui/synth/tokens.js';
import { controlSvg } from '../../src/js/ui/synth/knob.js';
import { xySvg } from '../../src/js/ui/synth/xy.js';
import { switchSvg } from '../../src/js/ui/synth/switch.js';
import { knobSvg } from '../../src/js/synth/view/knob.js';
import { PANEL_TOKENS } from '../../src/js/synth/view/tokens.js';
import { NAMED, TOKENS, intensityLiterals } from './ui-synth-fixture.mjs';

const SHAPE = {
  surface: ['plateHi', 'plateLo', 'card', 'edge'],
  text: ['label', 'value', 'dim'],
  control: ['cap', 'capHi', 'ring', 'track', 'pointer', 'focus', 'disabled', 'edge', 'knurl',
    'applied', 'bezel', 'shade', 'highlight'],
  jack: ['body', 'ring', 'normal', 'refuse'],
  cable: ['palette', 'shadow', 'sheen'],
};
const tokensCss = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const names = (n = SYNTH_TOKEN_NAMES) => Object.values(n).flatMap((g) => Object.values(g)
  .flatMap((x) => (Array.isArray(x) ? x : [x])));

function assertShape(t) {
  assert.deepEqual(Object.keys(t), Object.keys(SHAPE));
  for (const [group, keys] of Object.entries(SHAPE)) {
    assert.deepEqual(Object.keys(t[group]), keys, group);
  }
  assert.equal(t.cable.palette.length, 6, 'six cable colours');
}

function assertDeepFrozen(t) {
  assert.ok(Object.isFrozen(t), 'the set');
  for (const g of Object.keys(SHAPE)) assert.ok(Object.isFrozen(t[g]), g);
  assert.ok(Object.isFrozen(t.cable.palette), 'the palette');
  assert.throws(() => { t.control.ring = 'x'; }, TypeError);
  assert.throws(() => { t.cable.palette[0] = 'x'; }, TypeError);
  assert.throws(() => { t.extra = {}; }, TypeError);
}

test('the token names have exactly the agreed groups, and every one is an --osc-* property', () => {
  assertShape(SYNTH_TOKEN_NAMES);
  assertDeepFrozen(SYNTH_TOKEN_NAMES);
  for (const name of names()) assert.match(name, /^--osc-[a-z0-9-]+$/, name);
});

test('every token the layer reads is defined by tokens.css', () => {
  for (const name of names()) assert.ok(tokensCss.includes(`${name}:`), name);
});

test('the names follow the Synth panel roles the lane file recorded', () => {
  const n = SYNTH_TOKEN_NAMES;
  assert.equal(n.surface.plateHi, '--osc-surface-3');
  assert.equal(n.surface.plateLo, '--osc-surface-1');
  assert.equal(n.control.ring, '--osc-cyan');
  assert.equal(n.control.cap, '--osc-surface-1');
  assert.equal(n.control.capHi, '--osc-surface-4');
  assert.equal(n.control.focus, '--osc-focus');
  assert.equal(n.control.track, '--osc-text-dim', 'the unlit arc and the slot can be seen');
  assert.equal(n.control.edge, '--osc-text-dim', 'the skirt edge can be seen');
  assert.equal(n.control.pointer, '--osc-text');
  assert.equal(n.control.knurl, '--osc-border', 'the knurl is decorative');
  assert.equal(n.control.applied, '--osc-purple');
  assert.equal(n.control.bezel, '--osc-border-strong', 'an LED bezel\'s ring, decorative');
  assert.equal(n.control.shade, '--osc-hw-shade', 'the depth shade (21, amendment a-e)');
  assert.equal(n.control.highlight, '--osc-hw-highlight', 'the depth highlight (21)');
  assert.equal(n.jack.refuse, '--osc-red');
  assert.equal(n.cable.shadow, '--osc-bg');
  assert.equal(n.cable.sheen, '--osc-text', 'the sheen is its own token (dev-53, 2026-11-02)');
  assert.deepEqual([...n.cable.palette], ['--osc-cyan', '--osc-red-soft', '--osc-magenta',
    '--osc-green', '--osc-purple', '--osc-blue']);
});

test('tokensFrom maps every name through the lookup, trimmed, into a deep-frozen set', () => {
  const asked = [];
  const t = tokensFrom((name) => { asked.push(name); return `  value(${name}) `; });
  assertShape(t);
  assertDeepFrozen(t);
  assert.deepEqual(asked.sort(), names().sort());
  assert.equal(t.surface.plateHi, 'value(--osc-surface-3)');
  assert.equal(t.cable.palette[5], 'value(--osc-blue)');
});

test('a missing, empty or non-string value falls back to currentColor', () => {
  for (const missing of [undefined, null, '', '   ', 0, {}]) {
    const t = tokensFrom(() => missing);
    for (const leaf of [t.surface.edge, t.control.ring, t.jack.refuse, t.cable.sheen,
      ...t.cable.palette]) {
      assert.equal(leaf, 'currentColor', String(missing));
    }
  }
  const some = tokensFrom((name) => (name === '--osc-cyan' ? 'c' : ''));
  assert.equal(some.control.ring, 'c');
  assert.equal(some.cable.palette[0], 'c');
  assert.equal(some.control.track, 'currentColor');
});

test('tokensFrom refuses a lookup that is not a function', () => {
  assert.throws(() => tokensFrom('x'), /lookup/);
});

test('synthTokens reads getComputedStyle of the element; without a DOM, currentColor', () => {
  const t0 = synthTokens(null);
  assertShape(t0);
  assert.ok(names().length > 0);
  for (const leaf of [t0.surface.plateHi, t0.text.label, ...t0.cable.palette]) {
    assert.equal(leaf, 'currentColor');
  }
  const el = { id: 'host' };
  const saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (e) => {
    assert.equal(e, el);
    return { getPropertyValue: (name) => ` css:${name}` };
  };
  try {
    const t = synthTokens(el);
    assertDeepFrozen(t);
    assert.equal(t.control.ring, 'css:--osc-cyan');
    assert.equal(t.text.value, 'css:--osc-text');
  } finally {
    if (saved === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = saved;
  }
});

// ---------------------------------------------------------------- the layer's sources

const DIR = new URL('../../src/js/ui/synth/', import.meta.url).pathname;
// The product names synth-wording.test.mjs bans on the Synth panel, and the layer's references.
const BRANDS = new RegExp(`\\b(${['arturia', 'moog', 'minimoog', 'korg', 'roland', 'buchla',
  'behringer', 'elektron', 'ableton', 'bitwig', 'native instruments', 'reaktor', 'prophet',
  'oberheim'].join('|')})\\b`, 'i');
const NAMED_VALUE = new RegExp(`(['"\`]|\\b(?:fill|stroke|stop-color)[=:]\\s*["']?)(${NAMED
  .join('|')})(['"\`;\\s])`, 'i');

test('src/js/ui/synth: no colour literal, no url() but #fragment, no product name', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
  for (const f of ['tokens.js', 'knob.js', 'cable.js']) assert.ok(files.includes(f), f);
  for (const f of files) {
    const raw = readFileSync(join(DIR, f), 'utf8');
    assert.doesNotMatch(raw, BRANDS, `${f}: a product name`);
    const code = raw.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\/?\*.*$/gm, '');
    assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b(?![-\w])/i, `${f}: hex colour`);
    assert.doesNotMatch(code, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i,
      `${f}: colour function`);
    assert.doesNotMatch(code, /url\((?!#)/i, `${f}: url() other than a fragment`);
    const named = NAMED_VALUE.exec(code);
    assert.equal(named, null, `${f}: named colour ${named && named[2]}`);
  }
});

/** The value of `name` in each theme block of tokens.css that declares it. */
function themeValues(name) {
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
}

test('no role is an intensity; the cable shadow is an opaque colour in both themes (v4)', () => {
  for (const [group, roles] of Object.entries(SYNTH_TOKEN_NAMES)) {
    for (const role of Object.keys(roles)) {
      assert.doesNotMatch(role, /opacity|alpha|blur|glow|intensity/i,
        `${group}.${role}: an intensity is a hw-* Tailwind key, not a colour token`);
    }
  }
  const shadow = themeValues(SYNTH_TOKEN_NAMES.cable.shadow);
  assert.ok(shadow.length >= 2, `${SYNTH_TOKEN_NAMES.cable.shadow} in the dark and light theme`);
  for (const value of shadow) {
    assert.match(value, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
      `the shadow underlay is opaque, so it needs no opacity of its own: ${value}`);
  }
});

test('no literal opacity, alpha or shadow in tokens.js or in the set it returns (v4)', () => {
  const src = readFileSync(new URL('../../src/js/ui/synth/tokens.js', import.meta.url), 'utf8');
  assert.deepEqual(intensityLiterals(src), [], 'tokens.js source');
  const set = tokensFrom((name) => `var(${name})`);
  assert.deepEqual(intensityLiterals(JSON.stringify(set)), [], 'the token set');
  assert.deepEqual(intensityLiterals(JSON.stringify(synthTokens(null))), [], 'with no DOM');
});

// ---------------------------------------------------------------- contrast (WCAG 2.2)

/** The theme's resolved --osc-* colours: dark (:root) and light ([data-theme="light"] over it),
 *  var() references followed. */
function themes() {
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at >= 0, `tokens.css has ${sel}`);
    const open = css.indexOf('{', at);
    return Object.fromEntries([...css.slice(open + 1, css.indexOf('}', open))
      .matchAll(/(--osc-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const dark = block(':root');
  return { dark, light: { ...dark, ...block('[data-theme="light"]') } };
}

function hexOf(theme, name) {
  let v = theme[name];
  for (let i = 0; i < 8 && /^var\(/.test(v || ''); i++) v = theme[/^var\((--[\w-]+)\)$/.exec(v)[1]];
  assert.match(v || '', /^#[0-9a-f]{6}$/i, `${name} resolves to an opaque colour: ${v}`);
  return v;
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The control roles that only decorate (WCAG 1.4.11 asks nothing of them): the cap and its
// highlight, the knurl, an LED bezel's ring (the lens tells the state; ui-synth-led.test.mjs
// holds the ring to the strongest neutral the palette has) and the two depth roles, drawn only
// at an intensity and judged below by their own ratios and visibility. Every other control role
// marks the control or its value.
const DECORATIVE = ['cap', 'capHi', 'knurl', 'bezel', 'shade', 'highlight'];
const PLATES = [SYNTH_TOKEN_NAMES.surface.plateHi, SYNTH_TOKEN_NAMES.surface.plateLo];

test('every graphic role of the knob, fader and switch holds 3:1 on the plate, text 4.5:1', () => {
  assert.deepEqual(PLATES, ['--osc-surface-3', '--osc-surface-1']);
  const graphic = Object.keys(SYNTH_TOKEN_NAMES.control).filter((r) => !DECORATIVE.includes(r));
  const want = [...graphic.map((r) => [`control.${r}`, SYNTH_TOKEN_NAMES.control[r], 3]),
    ['text.label', SYNTH_TOKEN_NAMES.text.label, 4.5],
    ['text.value', SYNTH_TOKEN_NAMES.text.value, 4.5]];
  const short = [];
  for (const [theme, t] of Object.entries(themes())) {
    for (const plate of PLATES) {
      for (const [role, name, min] of want) {
        const ratio = contrast(hexOf(t, name), hexOf(t, plate));
        if (ratio < min) short.push(`${theme} ${role} (${name}) on ${plate}: ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(short, [], 'under 3:1 for a graphic, 4.5:1 for a label or a value');
  for (const role of ['ring', 'track', 'edge', 'pointer', 'focus', 'disabled', 'applied']) {
    assert.ok(graphic.includes(role), `control.${role} is a graphic role`);
  }
});

// A part is seen against what it is drawn over, not only against the plate (review of S2,
// finding 1): the knob's applied arc lies on the skirt face (control.cap since slice A; review
// of slice A, finding 10), the pointer, lit or disabled, on the cap. The value arc over the
// unlit arc is told apart by width, not colour
// (ui-synth-knob.test.mjs), because no existing token pair holds 3:1 there in both themes.
test('every knob part holds 3:1 on the part it is drawn over, in both themes', () => {
  const N = SYNTH_TOKEN_NAMES;
  const pairs = [['control.applied on control.cap', N.control.applied, N.control.cap],
    ['control.pointer on control.cap', N.control.pointer, N.control.cap],
    ['control.disabled on control.cap', N.control.disabled, N.control.cap],
    ['control.focus on surface.plateLo', N.control.focus, N.surface.plateLo]];
  const short = [];
  for (const [theme, t] of Object.entries(themes())) {
    for (const [what, fg, bg] of pairs) {
      const ratio = contrast(hexOf(t, fg), hexOf(t, bg));
      if (ratio < 3) short.push(`${theme} ${what}: ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(short, [], 'under 3:1 against the part beneath');
});

// Slice A 8: the pointer and its skirt segment on what they are drawn over (the cap and the
// skirt, cap-coloured since slice A; a disabled knob's flattened to plateLo), the applied arc on
// the skirt, and the track on both plates, all read from what controlSvg draws, 3:1 in both
// themes. Pointer contrast was the slice's risk once the skirt took the cap's colour.
test('slice A 8: the pointer on the cap and skirt, and the track on the plates, hold 3:1', () => {
  const param = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
  const tag = (svg, flag) => new RegExp(`<\\w+\\b[^>]*\\s${flag}=""[^>]*>`).exec(svg)[0];
  const paint = (svg, flag, a) => varOf(new RegExp(`\\s${a}="([^"]*)"`).exec(tag(svg, flag))[1]);
  const short = [];
  let pairs = 0;
  for (const state of [{}, { hover: true }, { dragging: true }, { disabled: true }]) {
    const svg = controlSvg({ kind: 'knob', value: 70, applied: 30, param, tokens: TOKENS,
      state });
    // A disabled knob draws no applied mark (C1; review of slice A, finding 9).
    const want = [['data-pointer', 'data-cap'], ['data-pointer-skirt', 'data-skirt'],
      ...(state.disabled ? [] : [['data-applied', 'data-skirt']])].map(([fg, bg]) => [fg,
      paint(svg, fg, 'stroke'), bg, paint(svg, bg, 'fill')]);
    for (const plate of PLATES) {
      want.push(['data-track', paint(svg, 'data-track', 'stroke'), 'plate', plate]);
    }
    for (const [theme, t] of Object.entries(themes())) {
      for (const [fg, f, bg, b] of want) {
        pairs += 1;
        const ratio = contrast(hexOf(t, f), hexOf(t, b));
        if (ratio < 3) short.push(`${JSON.stringify(state)} ${theme} ${fg} ${f} on ${bg} ${b}: `
          + `${ratio.toFixed(2)}`);
      }
    }
  }
  assert.ok(pairs >= 38, `${pairs} pairs`);
  assert.deepEqual(short, [], 'under 3:1 on the part beneath');
});

// Slice S: a knob of every size (lg, md, sm) is the same part scaled, so each part keeps the
// paint it has at md, and the same pairs hold 3:1 in both themes at every size.
test('slice S: a knob of every size paints its parts as md does, so each pair holds 3:1', () => {
  const param = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
  const flags = ['data-pointer', 'data-pointer-skirt', 'data-cap', 'data-skirt', 'data-track',
    'data-ring', 'data-applied', 'data-ticks', 'data-focus', 'data-hover'];
  // Review of S, round 4, finding 1: the hover overlay's paint and whether it shows are md's.
  const paintsOf = (svg) => flags.map((f) => {
    const tag = new RegExp(`<\\w+\\b[^>]*\\s${f}=""[^>]*>`).exec(svg);
    assert.ok(tag, `${f} drawn`);
    return [f, (/\sstroke="([^"]*)"/.exec(tag[0]) || [])[1],
      (/\sfill="([^"]*)"/.exec(tag[0]) || [])[1],
      (/\svisibility="([^"]*)"/.exec(tag[0]) || [])[1]];
  });
  const short = [];
  for (const state of [{ focus: true }, { hover: true, focus: true }, { dragging: true,
    focus: true }, { hover: true, dragging: true, focus: true }]) {
    const at = (size) => controlSvg({ kind: 'knob', value: 70, applied: 30, param, size,
      tokens: TOKENS, state, zoom: 2 });
    const md = paintsOf(at('md'));
    for (const size of ['lg', 'sm']) {
      assert.match(at(size), new RegExp(`data-size="${size}"`), `${size} is drawn at its size`);
      assert.deepEqual(paintsOf(at(size)), md, `${size} ${JSON.stringify(state)}: md's paints`);
    }
    const p = Object.fromEntries(md.map(([f, s, fill]) => [f, { s: varOf(s), f: varOf(fill) }]));
    assert.equal(md.find(([f]) => f === 'data-hover')[3], state.hover ? undefined : 'hidden');
    const want = [['pointer', p['data-pointer'].s, p['data-cap'].f],
      ['pointer-skirt', p['data-pointer-skirt'].s, p['data-skirt'].f],
      ['applied', p['data-applied'].s, p['data-skirt'].f],
      ...PLATES.flatMap((pl) => [['track', p['data-track'].s, pl],
        ['ticks', p['data-ticks'].s, pl], ['focus', p['data-focus'].s, pl]])];
    for (const [theme, t] of Object.entries(themes())) {
      for (const [what, f, b] of want) {
        const ratio = contrast(hexOf(t, f), hexOf(t, b));
        if (ratio < 3) short.push(`${theme} ${what} ${f} on ${b}: ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(short, [], 'under 3:1 at some size');
});

/** The skirt edge's paint as controlSvg draws a knob in `state`. */
const skirtEdge = (state) => varOf(/\sstroke="([^"]*)"/.exec(/<path\b[^>]*\sdata-skirt=""[^>]*>/
  .exec(controlSvg({ kind: 'knob', value: 70, tokens: TOKENS, state, param: { key: 'level',
    unit: '%', min: 0, max: 100, step: 1, default: 50 } }))[0])[1]);

// Review of slice A, finding 1: the skirt (control.cap) is 1.00-1.21:1 on the plates and its edge
// in surface.edge 1.04-1.23:1, so the knob read as a hole in the dark plate and faded into the
// light one. The silhouette is the skirt's edge: at least 1.5:1 asked, and it holds the layer's
// 3:1 for a graphic on both plates in both themes, in every enabled state, as drawn.
test('slice A review 1: the knob\'s silhouette edge holds 3:1 on both plates, both themes', () => {
  const short = [];
  for (const state of [{}, { hover: true }, { dragging: true }, { focus: true }]) {
    const edge = skirtEdge(state);
    for (const [theme, t] of Object.entries(themes())) {
      for (const plate of PLATES) {
        const ratio = contrast(hexOf(t, edge), hexOf(t, plate));
        if (ratio < 3) short.push(`${JSON.stringify(state)} ${theme} ${edge} on ${plate}: `
          + `${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(short, [], 'the silhouette under 3:1 on a plate');
});

// Review of slice A, finding 3: a disabled skirt edged in control.disabled (3.6-4.4:1) was a
// heavy sawblade louder than any enabled knob (1.04-1.23:1 then). A disabled knob's edge is never
// more prominent than an enabled one's, on either plate, in either theme.
test('slice A review 3: a disabled knob\'s edge is no louder than an enabled one\'s', () => {
  const on = skirtEdge({});
  const off = skirtEdge({ disabled: true });
  assert.notEqual(off, SYNTH_TOKEN_NAMES.control.disabled, 'not the disabled pointer\'s role');
  const loud = [];
  for (const [theme, t] of Object.entries(themes())) {
    for (const plate of PLATES) {
      const [a, b] = [on, off].map((x) => contrast(hexOf(t, x), hexOf(t, plate)));
      if (b > a) loud.push(`${theme} on ${plate}: disabled ${b.toFixed(2)} > ${a.toFixed(2)}`);
    }
  }
  assert.deepEqual(loud, []);
});

// Review of slice A, A1 (C5, one hover language): knob, dial, lever and slide each brighten
// their part's own edge on hover, the same rule for all four: an overlay always emitted (hidden
// unless hovered, never while disabled) tracing the edge element at its width, in
// control.pointer, while the edge element keeps its idle paint. The floor, measured from
// tokens.css in both themes: the hovered edge holds 3:1 on every face either side of it, and
// on each of them more than every idle paint of that edge (the rim's stops included), so it
// brightens, unlike the faint capHi circle (1.3:1 on the cap) it replaces.
test('slice A A1: one hover language: knob, dial, lever and slide brighten the part\'s edge',
  () => {
    const N = SYNTH_TOKEN_NAMES;
    const tag = (svg, flag) => new RegExp(`<\\w+\\b[^>]*\\s${flag}=""[^>]*>`).exec(svg)?.[0];
    const at = (el, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(el) || [])[1];
    const num = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
    const bool = { key: 'on', type: 'boolean', default: false };
    const slide = { key: 'mode', type: 'enum', default: 'b', options: ['a', 'b', 'c']
      .map((v) => [v, v.toUpperCase()]) };
    const dial = { key: 'wave', type: 'enum', default: 'b', options: ['a', 'b', 'c', 'd', 'e']
      .map((v) => [v, v.toUpperCase()]) };
    const knob = (state) => controlSvg({ kind: 'knob', value: 70, param: num, tokens: TOKENS,
      state });
    const sw = (param) => (state) => switchSvg({ value: param.default, param, tokens: TOKENS,
      state });
    // Each part: how it is drawn, its edge element, the geometry the overlay traces, the faces
    // either side of the edge (its own fill, and what it stands on) and what else is drawn on
    // the edge's geometry (the lever's facets), which the overlay must also be drawn over.
    const PARTS = [['knob', knob, 'data-skirt', ['d'], [N.surface.plateHi, N.surface.plateLo]],
      ['dial', sw(dial), 'data-skirt', ['d'], [N.surface.plateHi, N.surface.plateLo]],
      ['lever', sw(bool), 'data-nut', ['d'], [N.control.knurl], ['data-facet']],
      ['slide', sw(slide), 'data-cap', ['x', 'y', 'width', 'height', 'rx'],
        [N.surface.plateHi, N.surface.plateLo, N.surface.edge]]];
    const short = [];
    const rules = new Set();
    for (const [what, draw, flag, geometry, beside, also = []] of PARTS) {
      const idle = draw({});
      const lit = draw({ hover: true });
      const edge = tag(lit, flag);
      const h = tag(lit, 'data-hover');
      assert.ok(edge && h, `${what}: the edge and its hover overlay`);
      // Review of AC, finding 1: the edge is an opaque stroke on the same geometry, so an
      // overlay drawn before it (or before the lever's facets) is covered and hover shows
      // nothing; the overlay comes after every one of them.
      for (const under of [flag, ...also]) {
        assert.ok(lit.indexOf(`${under}=""`) >= 0, `${what}: its ${under}`);
        assert.ok(lit.indexOf('data-hover=""') > lit.indexOf(`${under}=""`),
          `${what}: the hover overlay is drawn over its ${under}`);
      }
      assert.equal(at(tag(idle, 'data-hover'), 'visibility'), 'hidden', `${what}: idle, hidden`);
      assert.equal(at(tag(draw({ hover: true, disabled: true }), 'data-hover'), 'visibility'),
        'hidden', `${what}: never while disabled`);
      assert.equal(at(h, 'visibility'), undefined, `${what}: shown on hover`);
      assert.equal(tag(idle, flag), edge, `${what}: the edge itself is not swapped on hover`);
      for (const g of geometry) assert.equal(at(h, g), at(edge, g), `${what}: the edge's ${g}`);
      assert.equal(at(h, 'stroke-width'), at(edge, 'stroke-width'), `${what}: the edge's width`);
      assert.equal(at(h, 'fill'), 'none', what);
      rules.add(`${varOf(at(h, 'stroke'))} ${at(h, 'class') ?? ''}`);
      const hover = varOf(at(h, 'stroke'));
      const idlePaints = [varOf(at(edge, 'stroke'))];
      const rim = tag(lit, 'data-rim');
      if (rim) idlePaints.push(...knobStops('rim'));
      const faces = [varOf(at(edge, 'fill')), ...beside];
      for (const [theme, t] of Object.entries(themes())) {
        for (const f of faces) {
          const r = contrast(hexOf(t, hover), hexOf(t, f));
          if (r < 3) short.push(`${theme} ${what}: hover ${hover} on ${f} ${r.toFixed(2)}`);
          for (const p of idlePaints) {
            const was = contrast(hexOf(t, p), hexOf(t, f));
            if (r <= was) short.push(`${theme} ${what}: hover ${r.toFixed(2)} no brighter than `
              + `${p} ${was.toFixed(2)} on ${f}`);
          }
        }
      }
    }
    assert.deepEqual([...rules], [`${N.control.pointer} `], 'one rule: control.pointer, opaque');
    assert.deepEqual(short, []);
  });

/** The stops of the knob's gradient whose id ends in `-${which}`, as token names. */
function knobStops(which) {
  const svg = controlSvg({ kind: 'knob', value: 70, tokens: TOKENS, param: { key: 'level',
    unit: '%', min: 0, max: 100, step: 1, default: 50 } });
  const g = new RegExp(`<(?:linear|radial)Gradient\\b[^>]*\\sid="[^"]*-${which}"[^>]*>(.*?)<`
    + '/(?:linear|radial)Gradient>').exec(svg);
  assert.ok(g, `the ${which} gradient`);
  return [...g[1].matchAll(/\sstop-color="([^"]*)"/g)].map((m) => varOf(m[1]));
}

// Review of slice A, finding 8: the side wall ran capHi (top) to cap, and the light theme's capHi
// (L* 89) is darker than its cap (L* 100), so the top darkened while the cast shadow says the
// light comes from above. The side wall's lit stop (the top) is never darker than its shaded one
// (the foot) in either theme.
test('slice A review 8: the side wall is lit from above in both themes', () => {
  const [top, foot] = knobStops('side');
  for (const [theme, t] of Object.entries(themes())) {
    assert.ok(lstar(hexOf(t, top)) >= lstar(hexOf(t, foot)), `${theme}: ${top} L* `
      + `${lstar(hexOf(t, top)).toFixed(1)} under ${foot} ${lstar(hexOf(t, foot)).toFixed(1)}`);
  }
});

// Review of slice A, A7: the toothed rim is lit from above, a vertical gradient from text.label
// (top) to control.edge (foot). Both stops are the rim's paint where they meet the plate, so
// each holds the layer's 3:1 for a graphic on both plates in both themes, as drawn.
test('slice A A7: both stops of the knob\'s lit rim hold 3:1 on both plates, both themes', () => {
  const rim = knobStops('rim');
  assert.deepEqual(rim, [SYNTH_TOKEN_NAMES.text.label, SYNTH_TOKEN_NAMES.control.edge]);
  const short = [];
  for (const [theme, t] of Object.entries(themes())) {
    for (const stop of rim) {
      for (const plate of PLATES) {
        const ratio = contrast(hexOf(t, stop), hexOf(t, plate));
        if (ratio < 3) short.push(`${theme} ${stop} on ${plate}: ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(short, [], 'a rim stop under 3:1 on a plate');
});

// The rim reads lit from above by its lightness only where its top stop is the lighter: so in
// dark (--osc-text-muted L* 68 over --osc-text-dim 50); in light the muted ink is the darker
// (L* 43 over 51), and no token lighter than control.edge holds 3:1 on the light plates, so the
// light rim is lit by contrast, crisper at the top, until D-PAL's cap roles.
test('slice A A7: the rim\'s top stop is the lighter in both themes (awaits D-PAL)', {
  todo: 'D-PAL (oscilla-21, Q071): no light token lighter than control.edge holds 3:1',
}, () => {
  const [top, foot] = knobStops('rim');
  for (const [theme, t] of Object.entries(themes())) {
    assert.ok(lstar(hexOf(t, top)) > lstar(hexOf(t, foot)), theme);
  }
});

// S7 (W1b re-review): the unlit knob arc measured 1.10:1 (dark) and 1.40:1 (light) on the plate,
// because a disabled knob drew it in the knurl's --osc-border. As drawn, in every state, it is
// a token that holds 3:1 on both plates in both themes: --osc-text-dim, the strongest grey
// short of the pointer's --osc-text (which the value arc's width must stay distinct from).
test('the unlit knob arc, as controlSvg draws it in every state, holds 3:1 on both plates', () => {
  const param = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
  const short = [];
  for (const state of [{}, { focus: true }, { hover: true }, { dragging: true },
    { disabled: true }, { disabled: true, focus: true, hover: true }]) {
    const svg = controlSvg({ kind: 'knob', value: 70, param, tokens: TOKENS, state });
    const track = /<path [^>]*data-track=""[^>]*>/.exec(svg)[0];
    const name = /stroke="var\((--osc-[\w-]+)\)"/.exec(track)[1];
    for (const [theme, t] of Object.entries(themes())) {
      for (const plate of PLATES) {
        const ratio = contrast(hexOf(t, name), hexOf(t, plate));
        if (ratio < 3) short.push(`${JSON.stringify(state)} ${theme} ${name} on ${plate}: `
          + `${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(short, [], 'the unlit arc under 3:1 on a plate');
});

// ---------------------------------------------------------------- the depth roles (21, a-e)
// Amendment approved by oscilla-21 (11-04), the palette and visual-identity-lock v4 owner: two
// roles, --osc-hw-shade and --osc-hw-highlight, drawn only through the hw-shadow and hw-sheen
// classes (no hw-* key changes). (a) The shade holds 1.15:1 against the face it is drawn over.
// (b) A use is visible: |ΔL*| >= 3 between the face and the role composited over it at the
// intensity its class reads from tailwind.config.cjs. (c) The highlight holds 1.15:1 against
// surface-3, surface-4 and the bg, and 3:1 against every face it is drawn on. (d) The knob keeps
// its capHi sheen unless the highlight is visible on the cap in both themes. The pairs (role,
// intensity, face) are read from what the layer draws, never from a list written here.

/** CIELAB L* of a #rrggbb colour: sRGB to relative luminance Y (WCAG's, sRGB's D65 Y), then
 *  L* = 116 f(Y / Yn) - 16 with the D65 white Yn = 1, f(t) = cbrt(t) above (6/29)^3, else
 *  t / (3 (6/29)^2) + 4/29. */
const lstar = (hex) => {
  const y = luminance(hex);
  const d = 6 / 29;
  return 116 * (y > d ** 3 ? Math.cbrt(y) : y / (3 * d * d) + 4 / 29) - 16;
};
/** `fg` at intensity `a` over `bg`, both #rrggbb, as the browser composites it (8 bits). */
const over = (fg, bg, a) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16)
  * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
/** The L* step a use makes: the composite's L* less the face's (negative darkens). */
const deltaL = (fg, bg, a) => lstar(over(fg, bg, a)) - lstar(bg);
const HW = createRequire(import.meta.url)('../../tailwind.config.cjs').theme.extend.opacity;
const DEPTH = { [SYNTH_TOKEN_NAMES.control.shade]: 'hw-shadow',
  [SYNTH_TOKEN_NAMES.control.highlight]: 'hw-sheen' };
const varOf = (v) => (/^var\((--osc-[\w-]+)\)$/.exec(v || '') || [])[1];
const MIN_DL = 3;

/** The shape elements of a drawing in paint order, each with its attributes. */
const shapesOf = (svg) => [...svg.matchAll(/<(circle|rect|ellipse|path|line)\b([^>]*?)\/?>/g)]
  .map((m) => ({ tag: m[1], a: Object.fromEntries([...m[2].matchAll(/\s([\w:-]+)="([^"]*)"/g)]
    .map((x) => [x[1], x[2]])) }));
/** A polygon path's vertices ('M x y L x y ... Z', no curve), or null. */
function polygonOf(s) {
  const d = s.a.d || '';
  if (s.tag !== 'path' || !/^M[\s\d.,LZ-]*$/.test(d)) return null;
  const pts = [...d.matchAll(/(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => [Number(m[1]),
    Number(m[2])]);
  return pts.length >= 3 ? pts : null;
}
/** Where a use shows (review of slice C, C2): the light comes from above, so a shadow shows
 *  along its lowest edge and a highlight along its own. Points along that edge, 0.01 inside:
 *  a circle's lowest point, a rect's bottom edge, a polygon's lowest vertex or vertices; a
 *  stroked line or curve (a recess, an arc), where it starts. */
function samplesOf(s) {
  // A slide cap's shadow edge crosses its slot: over the slot (surface.edge) the dark shade does
  // not show, as no shadow shows on black, and the face is the plate under most of the edge.
  const n = (k) => Number(s.a[k]);
  // Nine points at the middles of nine equal spans, so each stands for a ninth of the edge.
  const along = (x0, x1, y) => Array.from({ length: 9 }, (_, i) => [x0 + ((x1 - x0) * (i + 0.5))
    / 9, y - 0.01]);
  if (s.tag === 'circle') return [[n('cx'), n('cy') + n('r') - 0.01]];
  if (s.tag === 'rect') {
    const rx = Number(s.a.rx || 0);
    return along(n('x') + rx, n('x') + n('width') - rx, n('y') + n('height'));
  }
  const pts = polygonOf(s);
  if (!pts) {
    const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(s.a.d || '');
    return m ? [[Number(m[1]), Number(m[2])]] : [];
  }
  const low = Math.max(...pts.map(([, y]) => y));
  const xs = pts.filter(([, y]) => Math.abs(y - low) < 1e-6).map(([x]) => x);
  return xs.length > 1 ? along(Math.min(...xs), Math.max(...xs), low) : [[xs[0], low - 0.01]];
}
function covers(s, [x, y]) {
  const n = (k) => Number(s.a[k]);
  if (s.tag === 'circle') return Math.hypot(x - n('cx'), y - n('cy')) < n('r');
  if (s.tag === 'rect') {
    return x >= n('x') && x <= n('x') + n('width') && y >= n('y') && y <= n('y') + n('height');
  }
  const pts = polygonOf(s);
  if (!pts) return false;
  let inside = false;
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
    const [xi, yi] = pts[i];
    const [xk, yk] = pts[k];
    if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) inside = !inside;
  }
  return inside;
}
/** An opaque face: a filled shape with no intensity class, shown. */
const isFace = (s) => s.a.fill && s.a.fill !== 'none' && !s.a.class
  && s.a.visibility !== 'hidden' && (s.tag === 'circle' || s.tag === 'rect' || polygonOf(s));

/** Every use of a depth role in `svg`: its role, class and the face it shows on. A use is judged
 *  where it shows (samplesOf) and no later opaque face covers it; the face is the one drawn last
 *  under it there, else `ground`, the face its host draws it on (a control on its plate, as its
 *  token set names it; slice A's cast shadow falls there), and of several along its edge the one
 *  under most of it. A use no later face leaves uncovered anywhere has no face (null). */
function depthUses(svg, where, ground) {
  const list = shapesOf(svg);
  const out = [];
  list.forEach((s, i) => {
    for (const paint of ['fill', 'stroke']) {
      const role = varOf(s.a[paint]);
      if (!DEPTH[role]) continue;
      const seen = samplesOf(s).filter((p) => !list.slice(i + 1).some((u) => isFace(u)
        && covers(u, p)));
      const faces = seen.map((p) => {
        const under = list.slice(0, i).reverse().find((u) => isFace(u) && covers(u, p));
        return under ? varOf(under.a.fill) : varOf(ground);
      });
      const count = new Map();
      for (const f of faces) count.set(f, (count.get(f) || 0) + 1);
      const face = [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      out.push({ role, paint, cls: s.a.class, face,
        part: Object.keys(s.a).find((k) => k.startsWith('data-')) || s.tag, where });
    }
  });
  return out;
}

/** What the layer draws: knob.js's three controls in every state, the Synth panel's knob
 *  (its own token set, the skirt on the plate's top) and xy.js's pad in every state. A control
 *  stands on its token set's surface.card (the panel's: the plate's top, plateHi). */
function layerUses() {
  const num = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
  const bool = { key: 'on', type: 'boolean', default: false };
  const uses = [];
  for (const state of [{}, { dragging: true }, { disabled: true }, { focus: true },
    { hover: true }]) {
    for (const [kind, param, value] of [['knob', num, 70], ['fader', num, 70],
      ['switch', bool, true]]) {
      uses.push(...depthUses(controlSvg({ kind, value, param, tokens: TOKENS, state }),
        `knob.js ${kind} ${JSON.stringify(state)}`, TOKENS.surface.card));
    }
    // A dial is the knob's face (review of slice A, finding 5): its cast shadow is judged too.
    const dial = { key: 'wave', type: 'enum', default: 'a', options: ['a', 'b', 'c', 'd', 'e']
      .map((v) => [v, v.toUpperCase()]) };
    uses.push(...depthUses(switchSvg({ value: 'b', param: dial, tokens: TOKENS, state }),
      `switch.js dial ${JSON.stringify(state)}`, TOKENS.surface.card));
    // Slice C: the toggle's lever and the slide's cap cast the depth shade too, and the lever's
    // side highlight is the depth highlight where (b) holds on it.
    const slide = { key: 'mode', type: 'enum', default: 'a', options: ['a', 'b', 'c']
      .map((v) => [v, v.toUpperCase()]) };
    for (const value of [false, true]) {
      uses.push(...depthUses(switchSvg({ value, param: bool, tokens: TOKENS, state }),
        `switch.js toggle ${value} ${JSON.stringify(state)}`, TOKENS.surface.card));
    }
    for (const value of ['a', 'c']) {
      uses.push(...depthUses(switchSvg({ value, param: slide, tokens: TOKENS, state }),
        `switch.js slide ${value} ${JSON.stringify(state)}`, TOKENS.surface.card));
    }
  }
  const panel = Object.fromEntries(Object.entries(PANEL_TOKENS).map(([k, n]) => [k, `var(${n})`]));
  for (const disabled of [false, true]) {
    uses.push(...depthUses(knobSvg({ value: 70, param: num, tokens: panel, disabled }),
      `the panel's knob${disabled ? ' disabled' : ''}`, panel.plateHi));
  }
  const params = { x: { key: 'x', label: 'X', type: 'integer', min: 0, max: 14, step: 1,
    default: 7 }, y: { key: 'y', label: 'Y', unit: 'Hz', type: 'number', min: 20, max: 20000,
    scale: 'log', default: 1000 } };
  for (const state of [{}, { touched: true }, { focus: 'pad' }, { disabled: true },
    { disabled: true, touched: true }]) {
    uses.push(...depthUses(xySvg({ x: 3, y: 440, gate: Boolean(state.touched), source: 's',
      params, tokens: TOKENS, state }), `xy.js ${JSON.stringify(state)}`));
  }
  return uses;
}
/** The distinct (role, class, face) pairs, each with where it is drawn. */
function depthPairs() {
  const pairs = new Map();
  for (const u of layerUses()) {
    const k = `${u.role} ${u.cls} ${u.face}`;
    if (!pairs.has(k)) pairs.set(k, { ...u, parts: new Set() });
    pairs.get(k).parts.add(`${u.part} (${u.where})`);
  }
  return [...pairs.values()];
}

test('the depth roles are drawn only through their intensity class, each over a face', () => {
  const uses = layerUses();
  const parts = new Set(uses.map((u) => `${u.role} ${u.part}`));
  assert.ok(uses.some((u) => u.where.startsWith('switch.js dial') && u.part === 'data-cast-shadow'),
    'a dial casts the knob\'s shadow');
  for (const style of ['toggle', 'slide']) {
    assert.ok(uses.some((u) => u.where.startsWith(`switch.js ${style}`) && u.part === 'data-shadow'
      && u.role === SYNTH_TOKEN_NAMES.control.shade), `a ${style} casts the depth shade`);
  }
  for (const want of ['--osc-hw-shade data-cast-shadow', '--osc-hw-shade data-puck-shadow',
    '--osc-hw-shade data-recess', '--osc-hw-highlight data-puck-highlight']) {
    assert.ok(parts.has(want), `drawn: ${want} (${[...parts].join(', ')})`);
  }
  // The Synth panel's knob draws the core's shadow through its own token map (PANEL_TOKENS,
  // panelControlTokens): its cast shadow (slice A) is required here on its own, filled with the
  // depth shade at hw-shadow, enabled and disabled, so a panel map that sends shade elsewhere
  // fails by name and not only through the shade's face count below.
  for (const where of ['the panel\'s knob', 'the panel\'s knob disabled']) {
    const shadow = uses.filter((u) => u.where === where && u.part === 'data-cast-shadow');
    assert.deepEqual(shadow.map((u) => `${u.role} ${u.paint} ${u.cls}`),
      [`${SYNTH_TOKEN_NAMES.control.shade} fill opacity-hw-shadow`],
      `${where}: its data-cast-shadow is filled with ${SYNTH_TOKEN_NAMES.control.shade} at `
      + `hw-shadow (PANEL_TOKENS.shade is ${PANEL_TOKENS.shade})`);
  }
  for (const u of uses) {
    assert.equal(u.cls, `opacity-${DEPTH[u.role]}`, `${u.where} ${u.part}: ${u.role} only at `
      + `${DEPTH[u.role]}, never opaque or at another intensity`);
    assert.ok(u.face, `${u.where} ${u.part}: drawn over a face`);
  }
});

test('the depth roles hold their ratios in both themes (amendment a and c)', () => {
  const N = SYNTH_TOKEN_NAMES.control;
  const pairs = depthPairs();
  const short = [];
  const lines = [];
  for (const [theme, t] of Object.entries(themes())) {
    const c = (a, b) => contrast(hexOf(t, a), hexOf(t, b));
    for (const p of pairs) {
      const min = p.role === N.shade ? 1.15 : 3;
      const r = c(p.role, p.face);
      lines.push(`${theme} ${p.role} on ${p.face}: ${r.toFixed(3)}:1 (>= ${min})`);
      if (r < min) short.push(`${theme} ${p.role} on ${p.face}: ${r.toFixed(3)} < ${min}`);
    }
    for (const bg of ['--osc-surface-3', '--osc-surface-4', '--osc-bg']) {
      const r = c(N.highlight, bg);
      lines.push(`${theme} ${N.highlight} on ${bg}: ${r.toFixed(3)}:1 (>= 1.15)`);
      if (r < 1.15) short.push(`${theme} ${N.highlight} on ${bg}: ${r.toFixed(3)} < 1.15`);
    }
  }
  console.log(lines.join('\n'));
  assert.deepEqual(short, []);
});

test('every use of a depth role is visible: |ΔL*| >= 3 at its intensity, in both themes (b)',
  () => {
    const short = [];
    const lines = [];
    for (const [theme, t] of Object.entries(themes())) {
      for (const p of depthPairs()) {
        const a = Number(HW[DEPTH[p.role]]);
        assert.ok(a > 0 && a <= 0.4, `${DEPTH[p.role]} read from tailwind.config.cjs: ${a}`);
        const dl = deltaL(hexOf(t, p.role), hexOf(t, p.face), a);
        lines.push(`${theme} ${p.role} at ${DEPTH[p.role]} ${a} on ${p.face}: ΔL* `
          + `${dl.toFixed(2)} [${[...p.parts].join('; ')}]`);
        if (Math.abs(dl) < MIN_DL) short.push(`${theme} ${p.role} on ${p.face}: ${dl.toFixed(2)}`);
        // A shade never lightens and a highlight never darkens what it is drawn on.
        assert.ok(p.role === SYNTH_TOKEN_NAMES.control.shade ? dl < 0 : dl > 0,
          `${theme} ${p.role} on ${p.face}: ΔL* ${dl.toFixed(2)} the wrong way`);
      }
    }
    console.log(lines.join('\n'));
    assert.deepEqual(short, [], `under ΔL* ${MIN_DL}`);
  });

// Review of slice A, A2: a knob or a dial stands on either plate (plateHi at a module's top,
// plateLo at its foot), so its depth is judged on both, not only on the token set's card. On
// plateHi its cast shadow holds (a) and (b) in both themes. On plateLo it cannot: the cap is
// --osc-surface-1, plateLo itself, so the body has no tone of its own there and the dark shade
// shows ΔL* -1.71 on it (K1 holds on plateHi only, until D-PAL's --osc-knob-cap).
const ON_PLATE = (plate) => {
  const num = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
  const dial = { key: 'wave', type: 'enum', default: 'a', options: ['a', 'b', 'c', 'd', 'e']
    .map((v) => [v, v.toUpperCase()]) };
  const uses = [];
  for (const state of [{}, { dragging: true }, { hover: true }, { focus: true }]) {
    uses.push(...depthUses(controlSvg({ kind: 'knob', value: 70, param: num, tokens: TOKENS,
      state }), `knob ${JSON.stringify(state)}`, `var(${plate})`));
    uses.push(...depthUses(switchSvg({ value: 'b', param: dial, tokens: TOKENS, state }),
      `dial ${JSON.stringify(state)}`, `var(${plate})`));
  }
  return uses;
};
/** What fails (a) or (b) of `uses` in either theme, and the body's tone off `plate`. */
function depthShort(uses, plate) {
  const short = [];
  const a = (role) => Number(HW[DEPTH[role]]);
  for (const [theme, t] of Object.entries(themes())) {
    for (const u of uses) {
      const dl = deltaL(hexOf(t, u.role), hexOf(t, u.face), a(u.role));
      const r = contrast(hexOf(t, u.role), hexOf(t, u.face));
      const min = u.role === SYNTH_TOKEN_NAMES.control.shade ? 1.15 : 3;
      if (Math.abs(dl) < MIN_DL || r < min) {
        short.push(`${theme} ${u.where} ${u.part} on ${u.face}: ΔL* ${dl.toFixed(2)}, `
          + `${r.toFixed(3)}:1`);
      }
    }
    const body = Math.abs(lstar(hexOf(t, SYNTH_TOKEN_NAMES.control.cap)) - lstar(hexOf(t, plate)));
    if (body < MIN_DL) short.push(`${theme} the cap's body on ${plate}: ΔL* ${body.toFixed(2)}`);
  }
  return short;
}

test('slice A A2: a knob\'s and a dial\'s depth shows on plateHi in both themes', () => {
  const plate = SYNTH_TOKEN_NAMES.surface.plateHi;
  const uses = ON_PLATE(plate);
  assert.ok(uses.filter((u) => u.face === plate).length >= 8, 'the cast shadows on the plate');
  assert.deepEqual(depthShort(uses, plate), []);
});

test('slice A A2: a knob\'s and a dial\'s depth shows on plateLo too (awaits D-PAL)', {
  todo: 'D-PAL --osc-knob-cap (oscilla-21, Q071): the cap is plateLo, and the dark shade is '
    + 'ΔL* -1.71 there',
}, () => {
  const plate = SYNTH_TOKEN_NAMES.surface.plateLo;
  assert.deepEqual(depthShort(ON_PLATE(plate), plate), []);
});

// Review of slice A, A4: C1 flattens a disabled knob's body to plateLo, and plateLo is the cap's
// own token until D-PAL, so the flattening draws nothing yet; the cue today is the missing value
// arc, the control.disabled pointer and the quiet edge (ui-synth-knob.test.mjs). Once the cap has
// a role of its own the disabled body differs from it, as C1 says.
test('slice A A4: a disabled knob\'s body differs from the enabled cap (C1; awaits D-PAL)', {
  todo: 'D-PAL --osc-knob-cap (oscilla-21): plateLo and control.cap are --osc-surface-1',
}, () => {
  const param = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
  const body = (state) => varOf(/\sfill="([^"]*)"/.exec(/<path\b[^>]*\sdata-skirt=""[^>]*>/
    .exec(controlSvg({ kind: 'knob', value: 70, param, tokens: TOKENS, state }))[0])[1]);
  for (const [theme, t] of Object.entries(themes())) {
    const dl = lstar(hexOf(t, body({ disabled: true }))) - lstar(hexOf(t, body({})));
    assert.ok(Math.abs(dl) >= MIN_DL, `${theme}: ΔL* ${dl.toFixed(2)}`);
  }
});

test('the light shade is the lightest tint of the palette\'s navy ink that passes (a) and (b)',
  () => {
    // The tint of the light theme's --osc-text (the palette's own navy) toward white, k/255: the
    // lightest k for which the shade still holds (a) and (b) on every face it is drawn over. No
    // new hue enters the palette, and the shadow stays as restrained as visibility allows.
    const { dark, light } = themes();
    const N = SYNTH_TOKEN_NAMES.control;
    const faces = [...new Set(depthPairs().filter((p) => p.role === N.shade).map((p) => p.face))];
    assert.ok(faces.length >= 2, `the shade's faces: ${faces.join(', ')}`);
    const a = Number(HW['hw-shadow']);
    const passes = (t, hex) => faces.every((f) => contrast(hex, hexOf(t, f)) >= 1.15
      && -deltaL(hex, hexOf(t, f), a) >= MIN_DL);
    const ink = hexOf(light, '--osc-text');
    let pick = null;
    for (let k = 0; k <= 255; k++) {
      const hex = `#${[1, 3, 5].map((i) => {
        const v = parseInt(ink.slice(i, i + 2), 16);
        return Math.round(v + ((255 - v) * k) / 255).toString(16).padStart(2, '0');
      }).join('')}`;
      if (passes(light, hex)) pick = hex;
    }
    assert.ok(pick, 'a tint passes');
    assert.equal(hexOf(light, N.shade), pick, `light ${N.shade} is the test's pick (tint of `
      + `${ink}, on ${faces.join(', ')})`);
    assert.ok(passes(dark, hexOf(dark, N.shade)), `dark ${N.shade} passes (a) and (b)`);
    console.log(`light ${N.shade} ${pick}: the lightest tint of ${ink} passing on ${faces}`);
  });

// Rule (d) (oscilla-21) kept the capHi sheen until the highlight shows on the cap in both
// themes. Review of slice A, A3: capHi did not show either (ΔL* +1.26 dark, -1.41 light, the
// wrong way), so the knob paints its sheen only where a token shows on the cap in both themes,
// (b) |ΔL*| >= 3 and lighter: the highlight first, else capHi, else none. Computed from
// tokens.css, so the test names the paint a palette change calls for. Today: none.
test('the knob\'s sheen is the highlight, else capHi, where it shows on the cap, else none (d)',
  () => {
    const N = SYNTH_TOKEN_NAMES.control;
    const a = Number(HW['hw-sheen']);
    const shows = (role) => Object.values(themes()).every((t) => deltaL(hexOf(t, role),
      hexOf(t, N.cap), a) >= MIN_DL);
    const want = [N.highlight, N.capHi].find(shows) ?? null;
    const svg = controlSvg({ kind: 'knob', value: 70, tokens: TOKENS,
      param: { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 } });
    const sheen = /<\w+\b[^>]*\sdata-sheen=""[^>]*>/.exec(svg);
    if (want === null) {
      assert.equal(sheen, null, 'no token shows on the cap in both themes: no sheen');
    } else {
      assert.ok(sheen, `a sheen in ${want}`);
      assert.match(sheen[0], /\sclass="opacity-hw-sheen"/);
    }
    console.log(`knob sheen: ${want ?? 'none'} (on ${N.cap})`);
  });

// The knob's sheen once D-PAL gives the cap roles a highlight that shows on it in both themes.
test('slice A A3: the knob carries a sheen visible on its cap in both themes (awaits D-PAL)', {
  todo: 'D-PAL --osc-knob-cap/-cap-hi (oscilla-21, C6): no token shows on the light cap',
}, () => {
  const svg = controlSvg({ kind: 'knob', value: 70, tokens: TOKENS,
    param: { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 } });
  assert.match(svg, /\sdata-sheen=""[^>]*class="opacity-hw-sheen"/, 'a sheen at hw-sheen');
});

// Review of slice A, A3: the side wall (cap at the top to surface.edge at the foot, at hw-sheen
// over the skirt) is judged as a depth use by rule (b): its shaded foot shows, |ΔL*| >= 3 on the
// cap, in both themes. It cannot today (ΔL* -0.32 dark, -0.74 light): the todo names D-PAL.
test('slice A A3: the side wall\'s shaded foot shows on the cap in both themes (awaits D-PAL)', {
  todo: 'D-PAL --osc-knob-cap (oscilla-21): surface.edge at hw-sheen is invisible on the cap',
}, () => {
  const [, foot] = knobStops('side');
  const a = Number(HW['hw-sheen']);
  for (const [theme, t] of Object.entries(themes())) {
    const dl = deltaL(hexOf(t, foot), hexOf(t, SYNTH_TOKEN_NAMES.control.cap), a);
    assert.ok(Math.abs(dl) >= MIN_DL, `${theme}: ΔL* ${dl.toFixed(2)}`);
  }
});

// Slice C (SW-02, SW-07): a switch's highlight follows the knob's rule (d). The toggle's lever
// and ball (control.edge, a grey metal that does not flip with the theme) carry a sheen at
// hw-sheen; it is the depth highlight where the highlight shows on that face in both themes,
// (b) |ΔL*| >= 3 and lighter, with (c) 3:1, and capHi where it does not. Computed from
// tokens.css, so a palette change moves the paint with it. Review of slice C, finding 6: the
// slide cap's capHi strip did not show in dark (ΔL* +1.26) and darkened the light cap (-1.41),
// and the highlight does not show on control.cap, so a slide carries no sheen until D-PAL.
test('a switch\'s sheen is the highlight where it shows on its face in both themes, else capHi',
  () => {
    const N = SYNTH_TOKEN_NAMES.control;
    const a = Number(HW['hw-sheen']);
    const shows = (face) => Object.values(themes()).every((t) => {
      const dl = deltaL(hexOf(t, N.highlight), hexOf(t, face), a);
      return dl >= MIN_DL && contrast(hexOf(t, N.highlight), hexOf(t, face)) >= 3;
    });
    const bool = { key: 'on', type: 'boolean', default: false };
    const slide = { key: 'mode', type: 'enum', default: 'a', options: ['a', 'b', 'c']
      .map((v) => [v, v.toUpperCase()]) };
    const lines = [];
    for (const [what, param, flag] of [['toggle', bool, 'data-lever'],
      ['slide', slide, 'data-cap']]) {
      const svg = switchSvg({ value: param.default, param, tokens: TOKENS });
      const faceEl = new RegExp(`<\\w+\\b[^>]*\\s${flag}=""[^>]*>`).exec(svg)[0];
      const face = varOf(/\sfill="([^"]*)"/.exec(faceEl)[1]);
      const want = shows(face) ? TOKENS.control.highlight : TOKENS.control.capHi;
      const sheens = [...svg.matchAll(/<\w+\b[^>]*\sdata-sheen[\w-]*=""[^>]*>/g)]
        .map((m) => m[0]);
      if (what === 'slide') {
        assert.deepEqual(sheens, [], 'the slide cap: no sheen until D-PAL\'s cap roles');
        lines.push(`slide sheen on ${face}: none (D-PAL)`);
        continue;
      }
      assert.ok(sheens.length >= 1, `${what}: a sheen`);
      for (const el of sheens) {
        assert.match(el, /\sclass="opacity-hw-sheen"/, `${what}: at hw-sheen`);
        assert.equal(/\sfill="([^"]*)"/.exec(el)[1], want, `${what}: the sheen on ${face}`);
      }
      lines.push(`${what} sheen on ${face}: ${want}`);
    }
    // As the tokens stand: the highlight shows on the grey lever, not on the cap (light white).
    assert.equal(shows(N.edge), true, 'the highlight shows on control.edge in both themes');
    assert.equal(shows(N.cap), false, 'and not on control.cap (white in the light theme)');
    console.log(lines.join('\n'));
  });
