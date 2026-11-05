// The shared synth-theme layer's tokens (src/js/ui/synth/tokens.js; dev-53's layer design, the
// token API agreed 2026-11-02): synthTokens(el) reads OSCILLA's --osc-* custom properties at
// run time into one deep-frozen set of five groups, a missing value reads currentColor, and
// tokensFrom(lookup) is the same mapping without a DOM. The layer's sources carry no colour
// literal and no product name (project.visual-identity-lock v3), and no role is an intensity:
// opacity is the hw-* Tailwind keys', and the cable shadow is an opaque token (v4). The two depth
// roles (control.shade, control.highlight: --osc-hw-shade, --osc-hw-highlight; oscilla-21's
// amendment (a)-(e) of 11-04) hold their ratios in both themes and are visible, |ΔL*| >= 3,
// over every face the layer draws them on, the pairs read from what knob.js and xy.js draw.
// D-PAL (v4 amendment of 2026-11-05): the set also carries the closed list's roles (the D-PAL
// plates, the cap material and its ink, the LED, the chassis, the display glass, wood and keys;
// their values are derived in ui-synth-palette.test.mjs), and the knob, dial, lever and slide,
// and the fader cap draw the cap material in both themes (C6), so the A-review's D-PAL todos are
// tests now; a token set from before D-PAL (the panel's adapter) draws as it did.
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
import { NAMED, PRE_DPAL_TOKENS, TOKENS, intensityLiterals } from './ui-synth-fixture.mjs';

const SHAPE = {
  surface: ['plateHi', 'plateLo', 'card', 'edge', 'chassis', 'lcd'],
  text: ['label', 'value', 'dim'],
  control: ['cap', 'capHi', 'ring', 'track', 'pointer', 'focus', 'disabled', 'edge', 'knurl',
    'applied', 'bezel', 'shade', 'highlight', 'knobCap', 'knobCapHi', 'capInk', 'led'],
  jack: ['body', 'ring', 'normal', 'refuse'],
  cable: ['palette', 'shadow', 'sheen'],
  plate: ['hi', 'lo'],
  wood: ['hi', 'lo'],
  key: ['white', 'black', 'gap'],
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
  // D-PAL (v4 amendment of 2026-11-05): the closed list's roles, each in its group.
  assert.deepEqual({ ...n.plate }, { hi: '--osc-plate-hi', lo: '--osc-plate-lo' }, 'PF-04');
  assert.equal(n.control.knobCap, '--osc-knob-cap', 'C6: the cap material');
  assert.equal(n.control.knobCapHi, '--osc-knob-cap-hi', 'C6: its lit tone');
  assert.equal(n.control.capInk, '--osc-text-on-accent', 'the ink on the cap: one value, light');
  assert.equal(n.control.led, '--osc-hw-led', 'LXK-10');
  assert.equal(n.surface.chassis, '--osc-chassis', 'PF-14');
  assert.equal(n.surface.lcd, '--osc-hw-lcd', 'LXK-11');
  assert.deepEqual({ ...n.wood }, { hi: '--osc-wood-hi', lo: '--osc-wood-lo' }, 'PF-02');
  assert.deepEqual({ ...n.key }, { white: '--osc-hw-key-white', black: '--osc-hw-key-black',
    gap: '--osc-hw-key-gap' }, 'LXK-02, LXK-07');
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
// The cap material (C6) is a body, decorative too: its silhouette is control.edge. The cap ink
// is drawn only on the cap material, so it is judged there (the next test), not on a plate.
const DECORATIVE = ['cap', 'capHi', 'knurl', 'bezel', 'shade', 'highlight', 'knobCap',
  'knobCapHi'];
const ON_CAP = ['capInk'];
const PLATES = [SYNTH_TOKEN_NAMES.surface.plateHi, SYNTH_TOKEN_NAMES.surface.plateLo];
/** Today's plates and D-PAL's, which the panel's plates move to (PF-04). */
const ALL_PLATES = [...PLATES, SYNTH_TOKEN_NAMES.plate?.hi, SYNTH_TOKEN_NAMES.plate?.lo];
/** The cap material's two tones (C6). */
const CAP_MATERIAL = [SYNTH_TOKEN_NAMES.control.knobCap, SYNTH_TOKEN_NAMES.control.knobCapHi];

test('every graphic role of the knob, fader and switch holds 3:1 on the plate, text 4.5:1', () => {
  assert.deepEqual(PLATES, ['--osc-surface-3', '--osc-surface-1']);
  const graphic = Object.keys(SYNTH_TOKEN_NAMES.control).filter((r) => !DECORATIVE.includes(r)
    && !ON_CAP.includes(r));
  const want = [...graphic.map((r) => [`control.${r}`, SYNTH_TOKEN_NAMES.control[r], 3]),
    ['text.label', SYNTH_TOKEN_NAMES.text.label, 4.5],
    ['text.value', SYNTH_TOKEN_NAMES.text.value, 4.5]];
  const short = [];
  for (const [theme, t] of Object.entries(themes())) {
    for (const plate of ALL_PLATES) {
      for (const [role, name, min] of want) {
        const ratio = contrast(hexOf(t, name), hexOf(t, plate));
        if (ratio < min) short.push(`${theme} ${role} (${name}) on ${plate}: ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(short, [], 'under 3:1 for a graphic, 4.5:1 for a label or a value');
  for (const role of ['ring', 'track', 'edge', 'pointer', 'focus', 'disabled', 'applied',
    'led']) {
    assert.ok(graphic.includes(role), `control.${role} is a graphic role`);
  }
});

// A part is seen against what it is drawn over, not only against the plate (review of S2,
// finding 1): the knob's applied arc lies on the skirt face (control.cap since slice A; review
// of slice A, finding 10), the pointer, lit or disabled, on the cap. The value arc over the
// unlit arc is told apart by width, not colour
// (ui-synth-knob.test.mjs), because no existing token pair holds 3:1 there in both themes.
// D-PAL (C6): the skirt and cap are the cap material, its lit tone on the side wall's top; the
// pointer and the index lines are the cap ink on both; a disabled knob's body is plateLo (C1).
test('every knob part holds 3:1 on the part it is drawn over, in both themes', () => {
  const N = SYNTH_TOKEN_NAMES;
  const pairs = [...CAP_MATERIAL.flatMap((m) => [[`control.applied on ${m}`, N.control.applied, m],
    [`control.capInk on ${m}`, N.control.capInk, m], [`control.edge on ${m}`, N.control.edge, m]]),
    ['control.disabled on surface.plateLo', N.control.disabled, N.surface.plateLo],
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
      // Review of AC round 2, finding 3: the overlay's corners are the edge's too (the nut's
      // round joins: a miter would poke past the hex at its corners).
      for (const a of ['stroke-width', 'stroke-linejoin', 'stroke-linecap']) {
        assert.equal(at(h, a), at(edge, a), `${what}: the edge's ${a}`);
      }
      assert.equal(at(h, 'fill'), 'none', what);
      rules.add(`${varOf(at(h, 'stroke'))} ${at(h, 'class') ?? ''}`);
      const hover = varOf(at(h, 'stroke'));
      const idlePaints = [varOf(at(edge, 'stroke'))];
      const rim = tag(lit, 'data-rim');
      if (rim) idlePaints.push(...knobStops('rim'));
      // C6: against its own body, the cap material, no single opaque paint can brighten a
      // mid-grey edge both against a black body and against a white plate (in light the edge
      // is 4.63:1 on the cap and 4.39:1 on the plate: a hover paint must be lighter for the one
      // and darker for the other), so a cap-material part is judged against what it stands on,
      // where its silhouette is read; every other edge on both faces, as before.
      const body = varOf(at(edge, 'fill'));
      const faces = [...(CAP_MATERIAL.includes(body) ? [] : [body]), ...beside];
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
test('slice A A7: the rim\'s top stop is the lighter in both themes (awaits a role)', {
  todo: 'no light token lighter than control.edge holds 3:1 on the light plates, and D-PAL\'s '
    + 'closed list holds none (a mid grey would be a new role, by an amendment of v4)',
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
// plateHi its cast shadow holds (a) and (b) in both themes. On today's dark plateLo
// (--osc-surface-1, L* 4.78) no shade at hw-shadow can show: black at 0.3 is ΔL* -1.71 there
// (-2.2 even at the bound 0.4), whatever the cap; that is why D-PAL's plate foot,
// --osc-plate-lo, is the first step from it on which the shade shows (ui-synth-palette), and
// the cap material (C6) gives the body its own tone on every plate.
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
    const body = Math.abs(lstar(hexOf(t, SYNTH_TOKEN_NAMES.control.knobCap))
      - lstar(hexOf(t, plate)));
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

test('slice A A2 (D-PAL): a knob\'s and a dial\'s depth shows on both D-PAL plates', () => {
  for (const plate of [SYNTH_TOKEN_NAMES.plate.hi, SYNTH_TOKEN_NAMES.plate.lo]) {
    const uses = ON_PLATE(plate);
    assert.ok(uses.filter((u) => u.face === plate).length >= 8, `the cast shadows on ${plate}`);
    assert.deepEqual(depthShort(uses, plate), [], plate);
  }
});

test('slice A A2: on today\'s dark plateLo no shade can show; the body\'s own tone does', () => {
  const { dark } = themes();
  const plate = hexOf(dark, SYNTH_TOKEN_NAMES.surface.plateLo);
  const shade = hexOf(dark, SYNTH_TOKEN_NAMES.control.shade);
  for (const a of [Number(HW['hw-shadow']), 0.4]) {
    assert.ok(deltaL(shade, plate, a) > -MIN_DL, `measured: ΔL* ${deltaL(shade, plate, a)
      .toFixed(2)} at ${a}`);
  }
  for (const [theme, t] of Object.entries(themes())) {
    const body = Math.abs(lstar(hexOf(t, SYNTH_TOKEN_NAMES.control.knobCap))
      - lstar(hexOf(t, SYNTH_TOKEN_NAMES.surface.plateLo)));
    assert.ok(body >= MIN_DL, `${theme}: the cap's body on plateLo ΔL* ${body.toFixed(2)}`);
  }
});

// Review of slice A, A4: C1 flattens a disabled knob's body to plateLo, and plateLo is the cap's
// own token until D-PAL, so the flattening draws nothing yet; the cue today is the missing value
// arc, the control.disabled pointer and the quiet edge (ui-synth-knob.test.mjs). Once the cap has
// a role of its own the disabled body differs from it, as C1 says.
test('slice A A4: a disabled knob\'s body differs from the enabled cap (C1, D-PAL)', () => {
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
// tokens.css, so the test names the paint a palette change calls for. Since D-PAL (C6) the cap
// is the dark cap material and the highlight shows on it in both themes.
test('the knob\'s sheen is the highlight, else capHi, where it shows on the cap, else none (d)',
  () => {
    const N = SYNTH_TOKEN_NAMES.control;
    const a = Number(HW['hw-sheen']);
    const shows = (role) => Object.values(themes()).every((t) => deltaL(hexOf(t, role),
      hexOf(t, N.knobCap), a) >= MIN_DL);
    const want = [N.highlight, N.knobCapHi].find(shows) ?? null;
    assert.equal(want, N.highlight, 'the highlight shows on the cap material');
    const svg = controlSvg({ kind: 'knob', value: 70, tokens: TOKENS,
      param: { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 } });
    const sheen = /<\w+\b[^>]*\sdata-sheen=""[^>]*>/.exec(svg);
    if (want === null) {
      assert.equal(sheen, null, 'no token shows on the cap in both themes: no sheen');
    } else {
      assert.ok(sheen, `a sheen in ${want}`);
      assert.match(sheen[0], /\sclass="opacity-hw-sheen"/);
      assert.deepEqual(knobStops('sheen'), [want, N.knobCap], 'K12: the highlight to the cap');
    }
    console.log(`knob sheen: ${want ?? 'none'} (on ${N.knobCap})`);
  });

// The knob's sheen now that D-PAL's cap material shows the highlight in both themes (K12): a
// radial gradient from the highlight at its focus to the cap, over the cap, at hw-sheen; at the
// focus (b) ΔL* >= 3 and (c) 3:1 on the cap, in both themes.
test('slice A A3 (D-PAL): the knob carries a sheen visible on its cap in both themes', () => {
  const svg = controlSvg({ kind: 'knob', value: 70, tokens: TOKENS,
    param: { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 } });
  assert.match(svg, /\sdata-sheen=""[^>]*class="opacity-hw-sheen"/, 'a sheen at hw-sheen');
  const [focus, rim] = knobStops('sheen');
  const a = Number(HW['hw-sheen']);
  for (const [theme, t] of Object.entries(themes())) {
    const dl = deltaL(hexOf(t, focus), hexOf(t, rim), a);
    assert.ok(dl >= MIN_DL, `${theme}: the sheen's focus ΔL* ${dl.toFixed(2)}`);
    assert.ok(contrast(hexOf(t, focus), hexOf(t, rim)) >= 3, `${theme}: (c)`);
  }
});

// Review of slice A, A3: the side wall (cap at the top to surface.edge at the foot, at hw-sheen
// over the skirt) did not show: ΔL* -0.32 dark, -0.74 light on the cap. With D-PAL's cap
// material (C6) the wall is the material's own opaque gradient, its lit tone (knobCapHi) at the
// top to the cap at the foot, no intensity class; the shading reads by (b): the top is ΔL* >= 3
// over the foot in both themes, so the wall shows lit from above.
test('slice A A3 (D-PAL): the side wall is the cap material lit from above, visible (b)', () => {
  const N = SYNTH_TOKEN_NAMES.control;
  assert.deepEqual(knobStops('side'), [N.knobCapHi, N.knobCap]);
  const side = /<path\b[^>]*\sdata-side=""[^>]*>/.exec(controlSvg({ kind: 'knob', value: 70,
    tokens: TOKENS, param: { key: 'level', unit: '%', min: 0, max: 100, step: 1,
      default: 50 } }))[0];
  assert.doesNotMatch(side, /\sclass=/, 'the material itself: opaque, no intensity');
  for (const [theme, t] of Object.entries(themes())) {
    const dl = lstar(hexOf(t, N.knobCapHi)) - lstar(hexOf(t, N.knobCap));
    assert.ok(dl >= MIN_DL, `${theme}: ΔL* ${dl.toFixed(2)}`);
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
      assert.ok(sheens.length >= 1, `${what}: a sheen`);
      for (const el of sheens) {
        assert.match(el, /\sclass="opacity-hw-sheen"/, `${what}: at hw-sheen`);
        assert.equal(/\sfill="([^"]*)"/.exec(el)[1], want, `${what}: the sheen on ${face}`);
      }
      lines.push(`${what} sheen on ${face}: ${want}`);
    }
    // As the tokens stand: the highlight shows on the grey lever and, since D-PAL (C6), on the
    // slide's cap material; not on control.cap (white in the light theme).
    assert.equal(shows(N.edge), true, 'the highlight shows on control.edge in both themes');
    assert.equal(shows(N.knobCap), true, 'and on the cap material (C6)');
    assert.equal(shows(N.cap), false, 'not on control.cap (white in the light theme)');
    console.log(lines.join('\n'));
  });

// ---------------------------------------------------------------- D-PAL: the core's consumption

const NUM = { key: 'level', unit: '%', min: 0, max: 100, step: 1, default: 50 };
const BOOL = { key: 'on', type: 'boolean', default: false };
const SLIDE3 = { key: 'mode', type: 'enum', default: 'a', options: ['a', 'b', 'c']
  .map((v) => [v, v.toUpperCase()]) };
const DIAL5 = { key: 'wave', type: 'enum', default: 'a', options: ['a', 'b', 'c', 'd', 'e']
  .map((v) => [v, v.toUpperCase()]) };
const tagOf = (svg, flag) => new RegExp(`<\\w+\\b[^>]*\\s${flag}=""[^>]*>`).exec(svg)?.[0];
const attr = (el, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(el || '') || [])[1];

// C6 (owner's default, oscilla-21's D-PAL): a cap is a material and does not flip with the
// theme: the knob's skirt and cap, a dial's (the knob's face), the controlSvg switch's lever, the
// slide's cap and the fader's cap are the cap material in every enabled state, and the ink on
// them (the pointer, its skirt segment, the index lines, the fader's centre grip) is the cap ink.
test('C6: every cap is the cap material and its ink the cap ink, in every enabled state', () => {
  const c = TOKENS.control;
  for (const state of [{}, { hover: true }, { focus: true }, { dragging: true }]) {
    const where = JSON.stringify(state);
    const knob = controlSvg({ kind: 'knob', value: 70, param: NUM, tokens: TOKENS, state });
    const dial = switchSvg({ value: 'b', param: DIAL5, tokens: TOKENS, state });
    for (const [what, svg] of [['knob', knob], ['dial', dial]]) {
      for (const flag of ['data-skirt', 'data-cap']) {
        assert.equal(attr(tagOf(svg, flag), 'fill'), c.knobCap, `${what} ${where} ${flag}`);
      }
      for (const flag of ['data-pointer', 'data-pointer-skirt']) {
        assert.equal(attr(tagOf(svg, flag), 'stroke'), c.capInk, `${what} ${where} ${flag}`);
      }
    }
    const fader = controlSvg({ kind: 'fader', value: 70, param: NUM, tokens: TOKENS, state });
    assert.equal(attr(tagOf(fader, 'data-cap'), 'fill'), c.knobCap, `fader ${where}`);
    assert.equal(attr(/<line data-grip="centre"[^>]*>/.exec(fader)[0], 'stroke'), c.capInk,
      `fader ${where}: the centre grip`);
    const lever = controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: TOKENS, state });
    assert.equal(attr(tagOf(lever, 'data-cap'), 'fill'), c.knobCap, `switch lever ${where}`);
    assert.equal(attr(tagOf(lever, 'data-index'), 'stroke'), c.capInk, `switch lever ${where}`);
    const slide = switchSvg({ value: 'b', param: SLIDE3, tokens: TOKENS, state });
    assert.equal(attr(tagOf(slide, 'data-cap'), 'fill'), c.knobCap, `slide ${where}`);
    const grips = [...slide.matchAll(/<line data-grip=""[^>]*>/g)].map((m) => m[0]);
    assert.equal(attr(grips[1], 'stroke'), c.capInk, `slide ${where}: the index on the cap`);
    // Past the cap's edge the index runs on the plate, so there it is control.pointer.
    const tip = tagOf(slide, 'data-index-tip');
    assert.equal(attr(tip, 'stroke'), c.pointer, `slide ${where}: the index past the cap`);
    assert.equal(Number(attr(tip, 'x2')), Number(attr(grips[1], 'x2')), 'the same end');
    assert.ok(Number(attr(tip, 'x1')) >= 7 + 0.75, 'from outside the cap\'s stroke');
  }
});

// The cap material is one value in both themes (C6, by construction: tokens.css declares it on
// :root only), and every ink drawn on it holds 3:1 there as drawn, in every enabled state (an
// inactive control asks no contrast, WCAG 1.4.11; its quiet ridges are C1's disabled language).
test('C6: the inks drawn on every cap hold 3:1 on the cap material in both themes', () => {
  const short = [];
  const pairs = [];
  for (const state of [{}, { hover: true }, { dragging: true }, { focus: true }]) {
    const svgs = [controlSvg({ kind: 'knob', value: 70, applied: 30, param: NUM, tokens: TOKENS,
      state }), switchSvg({ value: 'b', param: DIAL5, tokens: TOKENS, state }),
    controlSvg({ kind: 'fader', value: 70, param: NUM, tokens: TOKENS, state }),
    controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: TOKENS, state }),
    switchSvg({ value: 'b', param: SLIDE3, tokens: TOKENS, state })];
    for (const svg of svgs) {
      const cap = varOf(attr(tagOf(svg, 'data-cap'), 'fill'));
      if (!CAP_MATERIAL.includes(cap)) continue;
      for (const flag of ['data-pointer', 'data-pointer-skirt', 'data-grip', 'data-index']) {
        for (const m of svg.matchAll(new RegExp(`<line\\b[^>]*\\s${flag}="[^"]*"[^>]*>`, 'g'))) {
          pairs.push([varOf(attr(m[0], 'stroke')), cap]);
        }
      }
    }
  }
  assert.ok(pairs.length >= 40, `${pairs.length} pairs`);
  for (const [theme, t] of Object.entries(themes())) {
    for (const [ink, cap] of pairs) {
      const r = contrast(hexOf(t, ink), hexOf(t, cap));
      if (r < 3) short.push(`${theme} ${ink} on ${cap}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual([...new Set(short)], []);
});

// A token set from before D-PAL (the Synth panel's adapter, panelControlTokens, until dev-53
// maps the cap material and the LED): the layer draws exactly as it did, so the panel's pixels
// do not move before its owner adopts the roles (Train 7 re-accepts once).
test('a token set without the D-PAL roles draws the caps as before (the panel, until dev-53)',
  () => {
  const c = PRE_DPAL_TOKENS.control;
  const knob = controlSvg({ kind: 'knob', value: 70, param: NUM, tokens: PRE_DPAL_TOKENS });
  assert.equal(attr(tagOf(knob, 'data-skirt'), 'fill'), c.cap);
  assert.equal(attr(tagOf(knob, 'data-cap'), 'fill'), c.cap);
  assert.equal(attr(tagOf(knob, 'data-cap'), 'stroke'), PRE_DPAL_TOKENS.surface.edge);
  assert.equal(attr(tagOf(knob, 'data-pointer'), 'stroke'), c.pointer);
  assert.match(tagOf(knob, 'data-side'), /\sclass="opacity-hw-sheen"/, 'the side wall at sheen');
  assert.equal(tagOf(knob, 'data-sheen'), undefined, 'no sheen');
  const fader = controlSvg({ kind: 'fader', value: 70, param: NUM, tokens: PRE_DPAL_TOKENS });
  assert.equal(attr(tagOf(fader, 'data-cap'), 'fill'), c.cap);
  assert.equal(attr(/<line data-grip="centre"[^>]*>/.exec(fader)[0], 'stroke'), c.pointer);
  const lever = controlSvg({ kind: 'switch', value: true, param: BOOL, tokens: PRE_DPAL_TOKENS });
  assert.equal(attr(tagOf(lever, 'data-cap'), 'stroke'), PRE_DPAL_TOKENS.surface.edge);
  const slide = switchSvg({ value: 'b', param: SLIDE3, tokens: PRE_DPAL_TOKENS });
  assert.equal(attr(tagOf(slide, 'data-cap'), 'fill'), c.cap);
  assert.equal(tagOf(slide, 'data-index-tip'), undefined, 'one index line, as before');
  assert.equal(tagOf(slide, 'data-sheen'), undefined, 'no sheen, as before');
  const led = switchSvg({ value: true, param: BOOL, tokens: PRE_DPAL_TOKENS,
    led: { source: 's', lit: true } });
  assert.equal(attr(tagOf(led, 'data-lens'), 'fill'), c.ring, 'a lit LED in the ring, as before');
});
