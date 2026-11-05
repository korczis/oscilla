// D-PAL (project.visual-identity-lock v4, amendment of 2026-11-05; oscilla-21's approval of
// 11-04, Q071): the synth-theme layer's closed list of palette roles, each MEASURED and DERIVED
// here from tokens.css, so a value is the one its rules pick and never a taste written in. A role
// whose value a rule pins is searched (k/255 steps along a stated line of colours: a neutral grey,
// or the channels of a palette token scaled toward black, or the sRGB line between two palette
// tokens) and tokens.css must hold exactly the pick; a role no rule pins (the chassis) states the
// requirement that chose it and the test measures it. Rules, as oscilla-21 set them:
//   (a) contrast (WCAG 2.2 relative luminance): a graphic 3:1 on the face it is drawn over, text
//       4.5:1, the depth shade 1.15:1 on its face;
//   (b) visibility of a depth cue: |ΔL*| >= 3 (CIELAB, D65 white, the sRGB Y of WCAG) between a
//       face and what the cue composites over it at its intensity class (tailwind.config.cjs);
//   C6 (owner's default, announced, not objected): the cap material (knob caps, switch levers,
//       fader caps) and the chassis are theme-invariant dark; every role but the plate pair and
//       the two depth roles is theme-invariant, declared once on :root and never on light.
// The faces are the plates the panel draws today (--osc-surface-3 at the top, --osc-surface-1 at
// the foot) and the D-PAL plate pair it moves to (PF-04, dev-53), in both themes.
//   node --test tests/unit/ui-synth-palette.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TOKENS_UNRECORDED } from '../../scripts/ui-flowbite-pro-measure.mjs';
import { keyColours } from '../../src/js/midi/keyboard-view.js';
import { SYNTH_TOKEN_NAMES } from '../../src/js/ui/synth/tokens.js';

const ROOT = new URL('../../', import.meta.url);
const TOKENS_CSS = readFileSync(new URL('src/styles/tokens.css', ROOT), 'utf8');
const RULE = readFileSync(new URL('.ai/repo/rules/project/visual-identity-lock.v4.md', ROOT),
  'utf8');
const HW = createRequire(import.meta.url)('../../tailwind.config.cjs').theme.extend.opacity;
const MIN_DL = 3;

// ---------------------------------------------------------------- colour science

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (hex) => channels(hex).map((c) => linear(c / 255));
/** WCAG 2.2 relative luminance (sRGB Y, D65). */
const luminance = (hex) => {
  const [r, g, b] = lin(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const fLab = (t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
/** CIELAB of a #rrggbb colour, D65 white (Xn 0.95047, Yn 1, Zn 1.08883). */
function lab(hex) {
  const [r, g, b] = lin(hex);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return { L: 116 * fLab(y) - 16, a: 500 * (fLab(x) - fLab(y)), b: 200 * (fLab(y) - fLab(z)) };
}
const lstar = (hex) => lab(hex).L;
/** `fg` at intensity `a` over `bg`, as the browser composites it (8 bits a channel). */
const over = (fg, bg, a) => hexOf(channels(fg).map((c, i) => c * a + channels(bg)[i] * (1 - a)));
const deltaL = (fg, bg, a) => lstar(over(fg, bg, a)) - lstar(bg);
/** The lines a search walks, k = 0..255. */
const grey = (k) => hexOf([k, k, k]);
const shadeOf = (hex, k) => hexOf(channels(hex).map((c) => (c * k) / 255));
const mixOf = (from, to, k) => hexOf(channels(from).map((c, i) => c + ((channels(to)[i] - c) * k)
  / 255));
/** The last k (0..255) of `line` for which `ok` holds, or the first when `first`. */
function search(line, ok, { first = false } = {}) {
  let pick = null;
  for (let k = 0; k <= 255; k++) {
    const c = line(k);
    if (ok(c)) {
      pick = c;
      if (first) break;
    }
  }
  return pick;
}

// ---------------------------------------------------------------- tokens.css, both themes

function blockOf(css, sel) {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, `tokens.css has ${sel}`);
  const open = css.indexOf('{', at);
  return Object.fromEntries([...css.slice(open + 1, css.indexOf('}', open))
    .matchAll(/(--osc-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const CSS = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const DARK_BLOCK = blockOf(CSS, ':root');
const LIGHT_BLOCK = blockOf(CSS, '[data-theme="light"]');
const THEMES = { dark: DARK_BLOCK, light: { ...DARK_BLOCK, ...LIGHT_BLOCK } };
function tok(theme, name) {
  let v = THEMES[theme][name];
  for (let i = 0; i < 8 && /^var\(/.test(v || ''); i++) {
    v = THEMES[theme][/^var\((--[\w-]+)\)$/.exec(v)[1]];
  }
  assert.match(v || '', /^#[0-9a-f]{6}$/i, `${theme} ${name} is an opaque colour: ${v}`);
  return v.toLowerCase();
}
const BOTH = Object.keys(THEMES);
const every = (fn) => BOTH.every(fn);

// ---------------------------------------------------------------- the closed list

/** The closed list (oscilla-21, 11-04): the roles, and whether each is per theme. */
const ROLES = [
  ['--osc-wood-hi', 'invariant'], ['--osc-wood-lo', 'invariant'],
  ['--osc-plate-hi', 'theme'], ['--osc-plate-lo', 'theme'],
  ['--osc-chassis', 'invariant'],
  ['--osc-hw-key-white', 'invariant'], ['--osc-hw-key-black', 'invariant'],
  ['--osc-hw-key-gap', 'invariant'],
  ['--osc-hw-led', 'invariant'], ['--osc-hw-lcd', 'invariant'],
  ['--osc-knob-cap', 'invariant'], ['--osc-knob-cap-hi', 'invariant'],
  ['--osc-hw-shade', 'theme'], ['--osc-hw-highlight', 'theme'],
];

const PLATES_NOW = ['--osc-surface-3', '--osc-surface-1'];
const PLATES_DPAL = ['--osc-plate-hi', '--osc-plate-lo'];
/** Every plate face a synth part may stand on, today's and D-PAL's (per theme, deduplicated). */
const plateFaces = (theme) => [...new Set([...PLATES_NOW, ...PLATES_DPAL].map((n) => tok(theme,
  n)))];
/** The inks drawn on the cap material: the pointer and index ink, the applied arc (on the
 *  skirt), the grips and ridges (control.edge). */
const CAP_INKS = ['--osc-text-on-accent', '--osc-purple', '--osc-text-dim'];
const capInksHold = (c) => every((th) => CAP_INKS.every((i) => contrast(tok(th, i), c) >= 3));
const offEveryPlate = (c, extra = []) => every((th) => [...plateFaces(th), ...extra.map((n) => tok(
  th, n))].every((f) => Math.abs(lstar(c) - lstar(f)) >= MIN_DL));

// The derivations, each a function of tokens.css; the values tokens.css must hold.
function derive() {
  const out = {};
  // Plates (PF-04): per theme, the lighter of today's two plate surfaces at the top; the foot on
  // the sRGB line from the darker toward the top, the first step on which the depth shade shows,
  // (a) 1.15:1 and (b) ΔL* <= -3 at hw-shadow, with the top still ΔL* >= 3 lighter (lit from
  // above).
  const shadow = Number(HW['hw-shadow']);
  for (const th of BOTH) {
    const [hi, low] = PLATES_NOW.map((n) => tok(th, n)).sort((x, y) => lstar(y) - lstar(x));
    const shade = tok(th, '--osc-hw-shade');
    out[`${th} --osc-plate-hi`] = hi;
    out[`${th} --osc-plate-lo`] = search((k) => mixOf(low, hi, k), (c) => contrast(shade, c) >= 1.15
      && deltaL(shade, c, shadow) <= -MIN_DL && lstar(hi) - lstar(c) >= MIN_DL, { first: true });
  }
  // The cap material (C6, K11): the lightest neutral whose every ink holds 3:1 on it in both
  // themes, whose body shows on every plate (|ΔL*| >= 3, A2) and above which a lit tone exists.
  const hiOf = (cap) => search(grey, (c) => capInksHold(c) && lstar(c) - lstar(cap) >= MIN_DL);
  const cap = search(grey, (c) => capInksHold(c) && offEveryPlate(c) && hiOf(c) !== null);
  out['--osc-knob-cap'] = cap;
  // Its lit tone (the skirt's side wall at the top): the lightest neutral ΔL* >= 3 above the cap
  // on which every ink still holds 3:1.
  out['--osc-knob-cap-hi'] = hiOf(cap);
  // Keys (LXK-02, LXK-07): the white key the lightest neutral that shows on every plate; the
  // black key the cap material itself (one black plastic, 4.5:1 on white, so each prints the
  // other's legend); the gap the lightest neutral 3:1 on the white key and ΔL* >= 3 off black.
  const white = search(grey, (c) => offEveryPlate(c));
  out['--osc-hw-key-white'] = white;
  out['--osc-hw-key-black'] = cap;
  out['--osc-hw-key-gap'] = search(grey, (c) => contrast(c, white) >= 3
    && Math.abs(lstar(c) - lstar(cap)) >= MIN_DL);
  // The LED (LXK-10): the brightest shade of the palette's own red (--osc-red, one value in both
  // themes) that holds 3:1 on the bezel body (control.capHi), its seat (surface.edge), the card
  // and every plate, in both themes.
  const ledGrounds = (th) => [tok(th, '--osc-surface-4'), tok(th, '--osc-bg'),
    tok(th, '--osc-surface-2'), ...plateFaces(th)];
  out['--osc-hw-led'] = search((k) => shadeOf(tok('dark', '--osc-red'), k), (c) => every((th) =>
    ledGrounds(th).every((g) => contrast(c, g) >= 3)));
  // The display glass (LXK-11): the lightest shade of the dark theme's chart inset
  // (--osc-surface-0, OSCILLA's own display colour) recessed ΔL* >= 3 below every plate in both
  // themes, on which the reading ink (--osc-text-on-accent) holds 7:1.
  out['--osc-hw-lcd'] = search((k) => shadeOf(tok('dark', '--osc-surface-0'), k), (c) => every(
    (th) => plateFaces(th).every((f) => lstar(f) - lstar(c) >= MIN_DL))
    && every((th) => contrast(tok(th, '--osc-text-on-accent'), c) >= 7));
  // The chassis (PF-14): seams and rails are unlit gaps, so black; its requirement is measured
  // below (|ΔL*| >= 3 off every plate and the card in both themes).
  out['--osc-chassis'] = '#000000';
  // Wood (PF-02, LXK-19): the palette's own warm hue (--osc-orange, one value in both themes)
  // darkened: the foot of the grain the darkest shade that holds 3:1 on the chassis (the cheek
  // and its rail read as two parts), the top the first shade ΔL* >= 3 above it (the grain shows,
  // no more).
  const orange = tok('dark', '--osc-orange');
  const lo = search((k) => shadeOf(orange, k), (c) => contrast(c, out['--osc-chassis']) >= 3,
    { first: true });
  out['--osc-wood-lo'] = lo;
  out['--osc-wood-hi'] = search((k) => shadeOf(orange, k), (c) => lstar(c) - lstar(lo) >= MIN_DL,
    { first: true });
  return out;
}
let picked = null;
/** The derived values, once (a test that needs them fails on its own if tokens.css lacks one). */
const PICK = () => (picked ??= derive());

const valueIn = (theme, name) => tok(theme, name);

test('the closed list is the fourteen roles oscilla-21 named, and the ratchet exempts exactly them',
  () => {
    assert.equal(ROLES.length, 14);
    assert.deepEqual([...TOKENS_UNRECORDED['src/styles/tokens.css']], ROLES.map(([n]) => n),
      'scripts/ui-flowbite-pro-measure.mjs exempts the closed list, no more and no less');
    assert.deepEqual(Object.keys(TOKENS_UNRECORDED), ['src/styles/tokens.css']);
  });

test('every role is declared as an opaque colour; per-theme roles in both blocks, the rest once',
  () => {
    for (const [name, kind] of ROLES) {
      assert.match(DARK_BLOCK[name] || '', /^#[0-9a-f]{6}$/i, `${name} on :root, opaque hex`);
      if (kind === 'theme') {
        assert.match(LIGHT_BLOCK[name] || '', /^#[0-9a-f]{6}$/i, `${name} on light, opaque hex`);
      } else {
        // Theme-invariant by construction: the light block never redeclares it (C6).
        assert.equal(LIGHT_BLOCK[name], undefined, `${name} is theme-invariant: not on light`);
        assert.equal(valueIn('dark', name), valueIn('light', name), `${name} one value`);
      }
    }
    for (const name of ['--osc-text-on-accent', '--osc-red', '--osc-orange']) {
      assert.equal(LIGHT_BLOCK[name], undefined, `${name}, a derivation's source, is one value`);
    }
  });

test('C6: the cap material and the chassis are one dark value in both themes', () => {
  for (const name of ['--osc-knob-cap', '--osc-knob-cap-hi', '--osc-chassis']) {
    assert.equal(valueIn('dark', name), valueIn('light', name), name);
    assert.ok(lstar(valueIn('dark', name)) < 20, `${name} is dark: L* ${lstar(valueIn('dark',
      name)).toFixed(2)}`);
  }
});

test('every role pinned by a rule holds exactly its derived value', () => {
  const short = [];
  for (const [key, want] of Object.entries(PICK())) {
    assert.ok(want, `${key}: the rule finds a value`);
    const [theme, name] = key.includes(' ') ? key.split(' ') : [null, key];
    for (const th of theme ? [theme] : BOTH) {
      const have = valueIn(th, name);
      if (have !== want) short.push(`${th} ${name}: tokens.css ${have}, derived ${want}`);
    }
  }
  assert.deepEqual(short, []);
});

test('the plates (PF-04): lighter at the top in both themes, and the shade shows on both', () => {
  const shadow = Number(HW['hw-shadow']);
  for (const th of BOTH) {
    const hi = valueIn(th, '--osc-plate-hi');
    const lo = valueIn(th, '--osc-plate-lo');
    assert.ok(lstar(hi) - lstar(lo) >= MIN_DL, `${th}: top L* ${lstar(hi).toFixed(2)} over foot `
      + `${lstar(lo).toFixed(2)}`);
    const shade = valueIn(th, '--osc-hw-shade');
    for (const face of [hi, lo]) {
      assert.ok(contrast(shade, face) >= 1.15, `${th} (a) the shade on ${face}`);
      assert.ok(deltaL(shade, face, shadow) <= -MIN_DL, `${th} (b) the shade on ${face}: ΔL* `
        + `${deltaL(shade, face, shadow).toFixed(2)}`);
    }
    // Every graphic and text role of the layer that stands on a plate holds on both.
    for (const [ink, min] of [['--osc-text-dim', 3], ['--osc-cyan', 3], ['--osc-focus', 3],
      ['--osc-purple', 3], ['--osc-text', 4.5], ['--osc-text-muted', 4.5]]) {
      for (const face of [hi, lo]) {
        assert.ok(contrast(valueIn(th, ink), face) >= min, `${th} ${ink} on ${face}: `
          + `${contrast(valueIn(th, ink), face).toFixed(2)} < ${min}`);
      }
    }
  }
});

test('the cap material (C6, K11): its inks hold 3:1, its body shows on every plate, it is lit',
  () => {
  const cap = valueIn('dark', '--osc-knob-cap');
  const hi = valueIn('dark', '--osc-knob-cap-hi');
  assert.ok(capInksHold(cap), 'every ink 3:1 on the cap');
  assert.ok(capInksHold(hi), 'every ink 3:1 on its lit tone');
  assert.ok(offEveryPlate(cap), 'the body shows on every plate (A2)');
  assert.ok(lstar(hi) - lstar(cap) >= MIN_DL, '(b) the lit tone shows on the cap');
  // The knob's sheen (K12, rule d): the depth highlight at hw-sheen shows on the cap in both
  // themes, (b) lighter by ΔL* >= 3 and (c) 3:1.
  const sheen = Number(HW['hw-sheen']);
  for (const th of BOTH) {
    const h = valueIn(th, '--osc-hw-highlight');
    assert.ok(deltaL(h, cap, sheen) >= MIN_DL, `${th}: the sheen ΔL* ${deltaL(h, cap, sheen)}`);
    assert.ok(contrast(h, cap) >= 3, `${th}: (c) the highlight on the cap`);
  }
});

test('the chassis (PF-14): a black seam shows off every plate and the card in both themes', () => {
  assert.ok(offEveryPlate(valueIn('dark', '--osc-chassis'), ['--osc-surface-2']));
});

test('the keys (LXK-02, LXK-07): white and black 4.5:1, the gap 3:1 on white, both on plates',
  () => {
  const w = valueIn('dark', '--osc-hw-key-white');
  const b = valueIn('dark', '--osc-hw-key-black');
  const g = valueIn('dark', '--osc-hw-key-gap');
  assert.ok(contrast(w, b) >= 4.5, 'white and black print each other\'s legend');
  assert.ok(contrast(g, w) >= 3, 'the gap shows between white keys');
  assert.ok(Math.abs(lstar(g) - lstar(b)) >= MIN_DL, 'a black key reads over the gap');
  assert.ok(offEveryPlate(w) && offEveryPlate(b), 'the keybed shows on every plate');
});

test('the LED (LXK-10): 3:1 on the bezel, its seat, the card and every plate, both themes', () => {
  const led = valueIn('dark', '--osc-hw-led');
  for (const th of BOTH) {
    for (const g of ['--osc-surface-4', '--osc-bg', '--osc-surface-2', ...PLATES_NOW,
      ...PLATES_DPAL]) {
      assert.ok(contrast(led, valueIn(th, g)) >= 3, `${th} on ${g}: `
        + `${contrast(led, valueIn(th, g)).toFixed(2)}`);
    }
  }
});

test('the display glass (LXK-11): recessed below every plate, its reading 7:1', () => {
  const lcd = valueIn('dark', '--osc-hw-lcd');
  for (const th of BOTH) {
    for (const f of plateFaces(th)) assert.ok(lstar(f) - lstar(lcd) >= MIN_DL, `${th} on ${f}`);
    assert.ok(contrast(valueIn(th, '--osc-text-on-accent'), lcd) >= 7, th);
  }
});

test('wood (PF-02): reads as wood in both themes, its grain shows, its cheek off the rail', () => {
  const lo = valueIn('dark', '--osc-wood-lo');
  const hi = valueIn('dark', '--osc-wood-hi');
  assert.ok(contrast(lo, valueIn('dark', '--osc-chassis')) >= 3, 'the cheek off its rail');
  assert.ok(lstar(hi) - lstar(lo) >= MIN_DL, 'the grain shows');
  // Wood, measured in CIELAB: a warm brown, hue 55-80 degrees, chroma 15 or more, L* 25-55
  // (neither black nor tan); one value in both themes, so it reads as wood on either.
  for (const c of [lo, hi]) {
    const { L, a, b } = lab(c);
    const hue = (Math.atan2(b, a) * 180) / Math.PI;
    assert.ok(hue >= 55 && hue <= 80, `${c}: hue ${hue.toFixed(1)}`);
    assert.ok(Math.hypot(a, b) >= 15, `${c}: chroma ${Math.hypot(a, b).toFixed(1)}`);
    assert.ok(L >= 25 && L <= 55, `${c}: L* ${L.toFixed(1)}`);
  }
  assert.ok(offEveryPlate(lo, ['--osc-surface-2']) && offEveryPlate(hi, ['--osc-surface-2']),
    'the cheek shows beside every plate and the card');
});

// ---------------------------------------------------------------- review of D-PAL (11-05)

// Finding 1: the text says what the derivation does. The lit tone is not "3 L* above" the cap:
// it is the lightest grey at least 3 L* above it on which every ink still holds 3:1, so it lands
// where the light purple stops it, and the text states the measured lift.
test('the rule and tokens.css state the cap\'s lit tone as the derivation picks it', () => {
  const lift = (lstar(valueIn('dark', '--osc-knob-cap-hi'))
    - lstar(valueIn('dark', '--osc-knob-cap'))).toFixed(2);
  const at = RULE.indexOf('# Amendment of 2026-11-05 (D-PAL)');
  const amendment = RULE.slice(at, RULE.indexOf('\n# ', at + 1));
  const comment = /\/\*(?:(?!\*\/)[\s\S])*The cap material[\s\S]*?\*\//.exec(TOKENS_CSS)?.[0] || '';
  for (const [where, text] of [['tokens.css', comment], ['the rule\'s amendment', amendment]]) {
    const flat = text.replace(/\s+/g, ' ');
    assert.doesNotMatch(flat, /lit tone 3 L\* above/, `${where}: not "3 L* above"`);
    const from = flat.indexOf('lit tone');
    assert.ok(from >= 0, `${where} states the lit tone`);
    const says = flat.slice(from, from + 240);
    assert.match(says, /the lightest grey at least 3 L\* above/, `${where}: the search`);
    assert.match(says, /every ink still holds 3:1/, `${where}: its stop`);
    assert.match(says, new RegExp(`(?:ΔL\\*|dL\\*) \\+${lift.replace('.', '\\.')}`),
      `${where}: the measured lift, +${lift}`);
  }
});

/** A token's value in a theme, `var()` resolved, or '' (no assertion: keyboard-view reads fonts
 *  through the same lookup). */
function resolved(theme, name) {
  let v = THEMES[theme][name];
  for (let i = 0; i < 8 && /^var\(/.test(v || ''); i++) {
    v = THEMES[theme][/^var\((--[\w-]+)\)$/.exec(v)[1]];
  }
  return v || '';
}
const KEY_INKS = ['lit', 'midi', 'label', 'blackLabel', 'onLit', 'edge'];
/** What src/js/midi/keyboard-view.js draws on the keys today, read through its own keyColours
 *  from tokens.css in each theme. */
function keyboardInks(theme) {
  const had = Object.hasOwn(globalThis, 'getComputedStyle');
  const was = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => resolved(theme, n) });
  try {
    const c = keyColours({}, { documentElement: { dataset: theme === 'light'
      ? { theme: 'light' } : {} } });
    return Object.fromEntries(KEY_INKS.map((r) => [r, c[r].toLowerCase()]));
  } finally {
    if (had) globalThis.getComputedStyle = was;
    else delete globalThis.getComputedStyle;
  }
}
/** The keys' rules for what is drawn on them, in each theme: a held key's fill (lit, midi) is a
 *  state graphic, 3:1 on the key it replaces, white or black (WCAG 1.4.11); a legend 4.5:1 on its
 *  key (label on the white key, blackLabel on the black); a held key's legend (onLit) 4.5:1 on
 *  each fill; the outline between keys (edge) the gap's rule, 3:1 on white and ΔL* >= 3 off
 *  black. `inks(theme)` -> { lit, midi, label, blackLabel, onLit, edge }. */
function keyShortfalls(inks) {
  const short = [];
  for (const th of BOTH) {
    const k = inks(th);
    const white = valueIn(th, '--osc-hw-key-white');
    const black = valueIn(th, '--osc-hw-key-black');
    const need = (what, fg, bg, on, min) => {
      const r = contrast(fg, bg);
      if (r < min) short.push(`${th} ${what} ${fg} on ${on}: ${r.toFixed(2)} < ${min}`);
    };
    for (const s of ['lit', 'midi']) {
      need(s, k[s], white, 'the white key', 3);
      need(s, k[s], black, 'the black key', 3);
      need('onLit', k.onLit, k[s], `the ${s} fill`, 4.5);
    }
    need('label', k.label, white, 'the white key', 4.5);
    need('blackLabel', k.blackLabel, black, 'the black key', 4.5);
    need('edge', k.edge, white, 'the white key', 3);
    if (Math.abs(lstar(k.edge) - lstar(black)) < MIN_DL) {
      short.push(`${th} edge ${k.edge} off the black key: ΔL* `
        + `${(lstar(k.edge) - lstar(black)).toFixed(2)}`);
    }
  }
  return short;
}

// Finding 2: the keys were derived without the colours the keyboard draws on them. Measured on
// the D-PAL keys, keyboard-view's colours of today fall short where listed (the held keys' legends
// on their fills fall short today too, on today's keys); dev-53's LXK-02 change
// (the keys take key.white, key.black and key.gap) must bring the map below with it, and each
// entry leaves this list as that change fixes it (a fix not recorded fails here, as DPAL_PENDING).
const KEYS_PENDING = [
  'dark onLit #ffffff on the lit fill: 4.04 < 4.5',
  'dark midi #34db7b on the white key: 1.68 < 3',
  'dark onLit #ffffff on the midi fill: 1.82 < 4.5',
  'light onLit #ffffff on the midi fill: 3.28 < 4.5',
];
test('the keys (LXK-02): what the keyboard draws on them, measured on the D-PAL keys', () => {
  assert.deepEqual(keyShortfalls(keyboardInks), KEYS_PENDING,
    'dev-53 (LXK-02): the keys inherit these shortfalls; the map below carries none');
});

test('the keys cannot carry today\'s dark MIDI fill; the map dev-53 takes carries every ink',
  () => {
  // While a fill of today falls short on the white key (KEYS_PENDING): with the fills in the white
  // key's derivation, what the search finds is no white key, as it fails the keys' own rule,
  // 4.5:1 against the black key. So the fill changes, not the key.
  if (KEYS_PENDING.some((e) => / (?:lit|midi) #\w+ on the white key/.test(e))) {
    const fills = BOTH.flatMap((th) => [keyboardInks(th).lit, keyboardInks(th).midi]);
    const w = search(grey, (c) => offEveryPlate(c) && fills.every((f) => contrast(f, c) >= 3));
    assert.ok(w === null || contrast(w, valueIn('dark', '--osc-hw-key-black')) < 4.5,
      `a white key that carries every fill of today: ${w}`);
  }
  // The map for LXK-02 (the handover to dev-53): existing palette roles, no shortfall in
  // either theme. The fills are the palette's fill roles (white text on them, tokens.css), the
  // legends each key's opposite (the keys print each other's legend), the outline the gap.
  const MAP = { lit: '--osc-blue-fill', midi: '--osc-green-deep', label: '--osc-hw-key-black',
    blackLabel: '--osc-hw-key-white', onLit: '--osc-text-on-accent', edge: '--osc-hw-key-gap' };
  assert.deepEqual(keyShortfalls((th) => Object.fromEntries(Object.entries(MAP)
    .map(([r, n]) => [r, valueIn(th, n)]))), []);
});

// Finding 3: the panel's plates move to plate.* in dev-53's change (PF-04). The layer's LED bezel
// stands on a plate (led.js; ui-synth-led.test.mjs, which reads surface.plateLo and so measures
// whichever plate the layer names): its ring control.bezel at 1.1:1 on every plate (the
// palette's best neutral on the dark plates) and its body control.capHi at 1.3:1 on the foot.
// Measured on the D-PAL pair, the move must bring what is listed with it.
const PLATE_MOVE_PENDING = [
  'dark control.capHi (--osc-surface-4) on --osc-plate-lo: 1.29 < 1.3',
  'light control.capHi (--osc-surface-4) on --osc-plate-lo: 1.09 < 1.3',
];
test('the plate move (PF-04): the LED bezel on the D-PAL pair, and what the move must bring',
  () => {
  const N = SYNTH_TOKEN_NAMES.control;
  const short = [];
  const need = (th, role, plate, min) => {
    const r = contrast(valueIn(th, N[role]), valueIn(th, plate));
    if (r < min) {
      short.push(`${th} control.${role} (${N[role]}) on ${plate}: ${r.toFixed(2)} < ${min}`);
    }
  };
  for (const th of BOTH) {
    for (const plate of PLATES_DPAL) need(th, 'bezel', plate, 1.1);
    need(th, 'capHi', '--osc-plate-lo', 1.3);
  }
  assert.deepEqual(short, PLATE_MOVE_PENDING, 'dev-53 (PF-04): the plate move inherits these; '
    + 'each leaves this list as the move fixes it');
  // The foot cannot absorb it: on the foot's line no step both lets the shade show (the plate
  // derivation's rule) and holds the bezel body at 1.3:1, in either theme, so the body's role
  // (or its 1.3:1) changes with the move, not the plate.
  const shadow = Number(HW['hw-shadow']);
  for (const th of BOTH) {
    const [hi, low] = PLATES_NOW.map((n) => valueIn(th, n)).sort((x, y) => lstar(y) - lstar(x));
    const shade = valueIn(th, '--osc-hw-shade');
    const both = search((k) => mixOf(low, hi, k), (c) => contrast(shade, c) >= 1.15
      && deltaL(shade, c, shadow) <= -MIN_DL && lstar(hi) - lstar(c) >= MIN_DL
      && contrast(valueIn(th, N.capHi), c) >= 1.3);
    assert.equal(both, null, `${th}: no foot satisfies both`);
  }
});

test('the measured table of every role (printed for the review)', () => {
  const lines = [];
  for (const [name, kind] of ROLES) {
    for (const th of kind === 'theme' ? BOTH : ['dark']) {
      const v = valueIn(th, name);
      const { L, a, b } = lab(v);
      lines.push(`${kind === 'theme' ? th : 'both'} ${name} ${v} L* ${L.toFixed(2)} a* `
        + `${a.toFixed(1)} b* ${b.toFixed(1)} Y ${luminance(v).toFixed(4)}`);
    }
  }
  console.log(lines.join('\n'));
  assert.equal(lines.length, 18);
});
