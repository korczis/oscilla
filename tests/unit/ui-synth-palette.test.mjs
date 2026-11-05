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

const ROOT = new URL('../../', import.meta.url);
const TOKENS_CSS = readFileSync(new URL('src/styles/tokens.css', ROOT), 'utf8');
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
