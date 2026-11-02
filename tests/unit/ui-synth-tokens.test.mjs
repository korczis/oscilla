// The shared synth-theme layer's tokens (src/js/ui/synth/tokens.js; dev-53's layer design, the
// token API agreed 2026-11-02): synthTokens(el) reads OSCILLA's --osc-* custom properties at
// run time into one deep-frozen set of five groups, a missing value reads currentColor, and
// tokensFrom(lookup) is the same mapping without a DOM. The layer's sources carry no colour
// literal and no product name (project.visual-identity-lock v3), and no role is an intensity:
// opacity is the hw-* Tailwind keys', and the cable shadow is an opaque token (v4).
//   node --test tests/unit/ui-synth-tokens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SYNTH_TOKEN_NAMES, synthTokens, tokensFrom } from '../../src/js/ui/synth/tokens.js';
import { NAMED, intensityLiterals } from './ui-synth-fixture.mjs';

const SHAPE = {
  surface: ['plateHi', 'plateLo', 'card', 'edge'],
  text: ['label', 'value', 'dim'],
  control: ['cap', 'capHi', 'ring', 'track', 'pointer', 'focus', 'disabled'],
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
