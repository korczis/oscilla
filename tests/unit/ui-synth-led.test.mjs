// The shared synth-theme layer's LED and needle meter (src/js/ui/synth/led.js; plan F013 entry
// 9, slice S9; project.visual-identity-lock v4 "Indicators bind to state" and "Measurement
// truth"): pure string renderers, no DOM, no listener, no timer. Checked here: an LED cannot be
// drawn without a real state source (a missing source and a non-boolean lit throw); data-source,
// data-lit and data-value are the caller's values, never constants; the glow is the class
// shadow-hw-led alone, only while lit, and never on text; the unlit ring holds 3:1 on surface-1
// (the bezel), surface-2 and surface-3 in both themes and every lit colour too, computed from
// tokens.css; a label is 12 screen px at any zoom; a meter refuses 'calibrated' without the
// calibration and a unit, draws no unit on a relative scale, pins an out-of-range value with
// data-pinned; nothing takes the pointer unless asked, and then through a 44 px hit; no literal
// colour, opacity, alpha or shadow in the output or the source; no animation in the source.
//   node --test tests/unit/ui-synth-led.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SYNTH_TOKEN_NAMES } from '../../src/js/ui/synth/tokens.js';
import { HIT_PX } from '../../src/js/ui/synth/knob.js';
import {
  TOKENS, colourLiterals, shapesWithoutStroke, paints, tokenValues, intensityLiterals,
  tokenThemes, tokenHex, contrastOf,
} from './ui-synth-fixture.mjs';

const LED_URL = new URL('../../src/js/ui/synth/led.js', import.meta.url);
const led = await import(LED_URL.href).catch(() => ({}));
const SRC = existsSync(LED_URL) ? readFileSync(LED_URL, 'utf8') : '';

const attrOf = (el, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(el) || [])[1];
const part = (svg, attr) => (new RegExp(`<\\w+\\b[^>]*\\s${attr}=""[^>]*>`).exec(svg) || [null])[0];
const open = (svg) => /^<g\b[^>]*>/.exec(svg)?.[0] ?? '';
const LED = (extra = {}) => led.ledSvg({ lit: true, source: 'transport.armed', tokens: TOKENS,
  ...extra });
const METER = (extra = {}) => led.meterSvg({ value: 0.5, source: 'analysis.correlation',
  scale: 'relative', tokens: TOKENS, ...extra });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('the module exists and exports ledSvg, meterSvg and their geometry', () => {
  assert.equal(typeof led.ledSvg, 'function', 'ledSvg');
  assert.equal(typeof led.meterSvg, 'function', 'meterSvg');
  assert.equal(led.LED.lens * 2, 6, 'the lens is 6 graph units across');
  assert.ok(Array.isArray(led.LED_COLOURS) && led.LED_COLOURS.includes('control.ring'));
});

// ---------------------------------------------------------------- the LED binds to state

test('an LED refuses a missing or empty source and a lit that is not a boolean', () => {
  for (const source of [undefined, null, '', '   ', 3, {}]) {
    assert.throws(() => LED({ source }), TypeError, `source ${JSON.stringify(source)}`);
  }
  for (const lit of [undefined, null, 1, 0, 'true', 'on']) {
    assert.throws(() => LED({ lit }), TypeError, `lit ${JSON.stringify(lit)}`);
  }
  assert.throws(() => led.ledSvg({ source: 's', lit: true }), TypeError, 'no tokens');
  assert.throws(() => LED({ zoom: 0 }), RangeError);
  assert.throws(() => LED({ at: { x: Number.NaN, y: 0 } }), RangeError);
});

test('data-source and data-lit are the caller\'s values, interpolated, never constants', () => {
  for (const source of ['transport.armed', 'node.lfo1.gate', 'xy "gate" <b>&']) {
    for (const lit of [true, false]) {
      const svg = LED({ source, lit });
      const g = open(svg);
      assert.match(g, /^<g data-led=""/, 'the group is the LED');
      const want = source.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      assert.equal(attrOf(g, 'data-source'), want, 'the source, escaped');
      assert.equal(attrOf(g, 'data-lit'), String(lit));
      assert.equal((svg.match(/data-led=""/g) || []).length, 1, 'one LED');
    }
  }
  // In the source, each indicator's attributes are template slots, not literals.
  assert.match(SRC, /data-led="" data-source="\$\{/);
  assert.match(SRC, /data-lit="\$\{/);
  assert.match(SRC, /data-needle="" data-source="\$\{/);
  assert.match(SRC, /data-value="\$\{/);
  assert.doesNotMatch(SRC, /data-(?:lit|value|source)="(?!\$\{)/, 'no literal state');
});

test('lit: the chosen state token with shadow-hw-led on the lens; unlit: surface-2, text-dim ring',
  () => {
    const on = LED();
    const lens = part(on, 'data-lens');
    assert.ok(lens, 'a lens');
    assert.equal(attrOf(lens, 'fill'), TOKENS.control.ring, 'control.ring by default');
    assert.equal(attrOf(lens, 'class'), 'shadow-hw-led');
    assert.equal(Number(attrOf(lens, 'r')), 3, 'Ø6');
    for (const colour of led.LED_COLOURS) {
      const [g, r] = colour.split('.');
      assert.equal(attrOf(part(LED({ colour }), 'data-lens'), 'fill'), TOKENS[g][r], colour);
    }
    for (const colour of ['#00ff00', 'red', 'var(--osc-green)', 'cable.palette.3', 'text.label']) {
      assert.throws(() => LED({ colour }), TypeError, `${colour}: not a state token role`);
    }
    const off = LED({ lit: false });
    const dark = part(off, 'data-lens');
    assert.equal(attrOf(dark, 'fill'), TOKENS.surface.card, 'surface-2 body');
    assert.equal(attrOf(dark, 'stroke'), TOKENS.control.edge, 'text-dim ring');
    assert.equal(TOKENS.control.edge, 'var(--osc-text-dim)');
    assert.equal(TOKENS.surface.card, 'var(--osc-surface-2)');
    assert.doesNotMatch(off, /shadow-hw-led/, 'no glow while unlit');
    const bezel = part(on, 'data-bezel');
    assert.ok(bezel && Number(attrOf(bezel, 'r')) > 3, 'a bezel ring around the lens');
  });

test('the glow is never on text and never on the group that holds the label', () => {
  for (const lit of [true, false]) {
    const svg = LED({ lit, label: 'Arm' });
    assert.ok(/<text\b/.test(svg), 'a label');
    for (const t of svg.match(/<text\b[^>]*>/g)) assert.doesNotMatch(t, /shadow/, 'text glows');
    assert.doesNotMatch(open(svg), /shadow/, 'the group with the text does not glow');
    const glowing = svg.match(/<\w+\b[^>]*shadow-hw-led[^>]*>/g) || [];
    assert.equal(glowing.length, lit ? 1 : 0);
    if (lit) assert.match(glowing[0], /^<circle\b[^>]*data-lens=""/, 'only the lens');
  }
});

test('a label is 12 screen px at any zoom, in text.label, escaped; none without one', () => {
  assert.doesNotMatch(LED(), /<text\b/);
  for (const zoom of [0.5, 1, 1.45, 2, 3]) {
    const t = /<text\b[^>]*>([^<]*)<\/text>/.exec(LED({ zoom, label: 'Gate <1>' }));
    assert.ok(t, `zoom ${zoom}: a label`);
    assert.ok(near(Number(attrOf(t[0], 'font-size')) * zoom, 12, 0.01), `zoom ${zoom}: 12 px`);
    assert.equal(attrOf(t[0], 'fill'), TOKENS.text.label);
    assert.equal(attrOf(t[0], 'stroke'), 'none');
    assert.equal(t[1], 'Gate &lt;1&gt;');
  }
  const named = open(LED({ label: 'Arm', lit: false }));
  assert.equal(attrOf(named, 'role'), 'img');
  assert.equal(attrOf(named, 'aria-label'), 'Arm: off');
  assert.equal(attrOf(open(LED({ label: 'Arm' })), 'aria-label'), 'Arm: on');
  assert.equal(attrOf(open(LED()), 'aria-hidden'), 'true', 'unnamed: hidden');
});

test('an LED takes no pointer by default; interactive, a hit of 44 screen px at any zoom', () => {
  const g = open(LED());
  assert.equal(attrOf(g, 'pointer-events'), 'none');
  assert.equal(part(LED(), 'data-hit'), null, 'no hit by default');
  for (const zoom of [0.25, 1, 1.45, 3]) {
    const svg = LED({ interactive: true, zoom, at: { x: 10, y: 20 } });
    const hit = part(svg, 'data-hit');
    assert.ok(hit, `zoom ${zoom}: a hit`);
    assert.equal(attrOf(hit, 'pointer-events'), 'all');
    assert.ok(Number(attrOf(hit, 'width')) * zoom >= HIT_PX - 1e-6, 'wide enough');
    assert.ok(Number(attrOf(hit, 'height')) * zoom >= HIT_PX - 1e-6, 'tall enough');
    assert.ok(near(Number(attrOf(hit, 'x')) + Number(attrOf(hit, 'width')) / 2, 10), 'centred');
    assert.ok(near(Number(attrOf(hit, 'y')) + Number(attrOf(hit, 'height')) / 2, 20), 'centred');
    assert.match(svg, /<g pointer-events="none">/, 'the drawing takes none');
  }
});

test('the LED and the meter draw inside their box at its place', () => {
  for (const zoom of [0.5, 1, 2]) {
    for (const label of [undefined, 'Arm']) {
      const box = led.ledBox({ zoom, label });
      for (const c of LED({ zoom, label }).match(/<circle\b[^>]*>/g)) {
        const [x, y, r] = ['cx', 'cy', 'r'].map((a) => Number(attrOf(c, a)));
        assert.ok(x - r >= box.x - 1e-6 && x + r <= box.x + box.width + 1e-6, 'x inside');
        assert.ok(y - r >= box.y - 1e-6 && y + r <= box.y + box.height + 1e-6, 'y inside');
      }
    }
  }
  const lens = part(LED({ at: { x: 7, y: -4 } }), 'data-lens');
  assert.equal(Number(attrOf(lens, 'cx')), 7);
  assert.equal(Number(attrOf(lens, 'cy')), -4);
  const box = led.METER_BOX;
  for (const v of [0, 0.5, 1]) {
    const svg = METER({ value: v });
    for (const l of svg.match(/<line\b[^>]*>/g)) {
      for (const [xa, ya] of [['x1', 'y1'], ['x2', 'y2']]) {
        const [x, y] = [Number(attrOf(l, xa)), Number(attrOf(l, ya))];
        assert.ok(x >= box.x && x <= box.x + box.width && y >= box.y
          && y <= box.y + box.height, `${x},${y} inside the meter box`);
      }
    }
  }
});

// ---------------------------------------------------------------- contrast from tokens.css

test('the unlit ring and every lit colour hold 3:1 on the bezel, surface-2 and surface-3', async () => {
  const themes = await tokenThemes();
  const N = SYNTH_TOKEN_NAMES;
  const name = (role) => { const [g, r] = role.split('.'); return N[g][r]; };
  const grounds = [['bezel', N.control.cap], ['plate low', N.surface.plateLo],
    ['card', N.surface.card], ['plate high', N.surface.plateHi]];
  assert.equal(N.control.cap, '--osc-surface-1');
  assert.equal(N.surface.card, '--osc-surface-2');
  assert.equal(N.surface.plateHi, '--osc-surface-3');
  const marks = [['unlit ring', N.control.edge], ['meter scale', N.control.track],
    ['needle', N.control.pointer], ...led.LED_COLOURS.map((c) => [`lit ${c}`, name(c)])];
  for (const [theme, t] of Object.entries(themes)) {
    for (const [what, fg] of marks) {
      for (const [where, bg] of grounds) {
        const ratio = contrastOf(tokenHex(t, fg), tokenHex(t, bg));
        assert.ok(ratio >= 3, `${theme}: ${what} (${fg}) on the ${where} (${bg}) ${ratio.toFixed(2)}`);
      }
    }
    const unit = contrastOf(tokenHex(t, N.text.label), tokenHex(t, N.surface.card));
    assert.ok(unit >= 4.5, `${theme}: the meter's unit text on its face ${unit.toFixed(2)}`);
  }
});

// ---------------------------------------------------------------- the meter tells the truth

test('a meter binds data-source and data-value to the caller\'s values', () => {
  assert.throws(() => METER({ source: '' }), TypeError);
  assert.throws(() => METER({ source: undefined }), TypeError);
  for (const value of [undefined, null, Number.NaN, Infinity, '0.5']) {
    assert.throws(() => METER({ value }), TypeError, `value ${String(value)}`);
  }
  for (const [value, source] of [[0.25, 'a.b'], [0.8, 'corr "L/R"']]) {
    const g = open(METER({ value, source }));
    assert.match(g, /^<g data-needle=""/);
    assert.equal(attrOf(g, 'data-source'), source.replace(/"/g, '&quot;'));
    assert.equal(attrOf(g, 'data-value'), String(value));
    assert.equal(attrOf(g, 'data-pinned'), undefined, 'in range: not pinned');
    assert.equal(attrOf(g, 'data-scale'), 'relative');
  }
});

test('the needle follows the value; out of range it pins with data-pinned', () => {
  const tip = (v) => {
    const n = part(METER({ value: v }), 'data-needle-arm');
    return [Number(attrOf(n, 'x2')), Number(attrOf(n, 'y2'))];
  };
  const [lx] = tip(0);
  const [cx] = tip(0.5);
  const [hx] = tip(1);
  assert.ok(lx < cx && cx < hx, 'left to right');
  assert.ok(near(cx, 0, 0.01), 'the middle is up');
  assert.deepEqual(tip(-3), tip(0), 'below pins at 0');
  assert.deepEqual(tip(7), tip(1), 'above pins at 1');
  assert.equal(attrOf(open(METER({ value: -3 })), 'data-pinned'), 'low');
  assert.equal(attrOf(open(METER({ value: 7 })), 'data-pinned'), 'high');
  assert.equal(attrOf(open(METER({ value: -3 })), 'data-value'), '-3', 'the caller\'s value');
});

test('a relative scale draws no unit; a calibrated one needs the calibration and a unit', () => {
  assert.doesNotMatch(METER(), /<text\b/, 'relative: no unit');
  assert.throws(() => METER({ unit: 'dB' }), TypeError, 'a unit on a relative scale');
  assert.throws(() => METER({ scale: 'calibrated', unit: 'dB SPL' }), TypeError,
    'never dB SPL without calibration');
  assert.throws(() => METER({ scale: 'calibrated', unit: 'dB SPL', calibrated: 'yes' }), TypeError);
  assert.throws(() => METER({ scale: 'calibrated', calibrated: true }), TypeError, 'no unit');
  assert.throws(() => METER({ scale: 'calibrated', calibrated: true, unit: ' ' }), TypeError);
  assert.throws(() => METER({ scale: 'dB' }), TypeError, 'an unknown scale');
  assert.throws(() => METER({ scale: undefined }), TypeError, 'the scale is stated');
  const svg = METER({ scale: 'calibrated', calibrated: true, unit: 'dB SPL', zoom: 2 });
  assert.equal(attrOf(open(svg), 'data-scale'), 'calibrated');
  const t = /<text\b[^>]*>([^<]*)<\/text>/.exec(svg);
  assert.equal(t[1], 'dB SPL');
  assert.ok(near(Number(attrOf(t[0], 'font-size')) * 2, 12, 0.01), '12 screen px');
  assert.equal(attrOf(t[0], 'fill'), TOKENS.text.label);
});

test('a meter: arc, ticks, needle, pivot cap, no pointer unless interactive', () => {
  const svg = METER();
  for (const p of ['data-scale-arc', 'data-tick', 'data-needle-arm', 'data-pivot', 'data-face']) {
    assert.ok(part(svg, p), p);
  }
  assert.ok((svg.match(/data-tick=""/g) || []).length >= 5, 'ticks');
  assert.equal(attrOf(part(svg, 'data-needle-arm'), 'stroke'), TOKENS.control.pointer);
  assert.equal(attrOf(part(svg, 'data-scale-arc'), 'stroke'), TOKENS.control.track);
  assert.equal(attrOf(open(svg), 'pointer-events'), 'none');
  const hit = part(METER({ interactive: true, zoom: 0.5 }), 'data-hit');
  assert.ok(Number(attrOf(hit, 'width')) * 0.5 >= HIT_PX - 1e-6);
  assert.ok(Number(attrOf(hit, 'height')) * 0.5 >= HIT_PX - 1e-6);
});

// ---------------------------------------------------------------- v4: tokens, intensity, motion

test('no literal colour, opacity, alpha or shadow; every paint a token; every shape stroked', () => {
  const tokens = new Set([...tokenValues(TOKENS), 'none']);
  const outputs = [LED(), LED({ lit: false, label: 'Arm', interactive: true }),
    ...led.LED_COLOURS.map((colour) => LED({ colour })), METER(), METER({ value: 9 }),
    METER({ scale: 'calibrated', calibrated: true, unit: 'dBFS', interactive: true })];
  for (const svg of outputs) {
    assert.deepEqual(colourLiterals(svg), [], 'no colour literal');
    assert.deepEqual(intensityLiterals(svg), [], 'no intensity literal');
    assert.deepEqual(shapesWithoutStroke(svg), [], 'every shape sets its stroke');
    for (const p of paints(svg)) assert.ok(tokens.has(p), `${p} is a token`);
    for (const c of svg.match(/class="([^"]*)"/g) || []) {
      assert.match(c, /^class="shadow-hw-led"$/, `${c}: the only class is the LED glow`);
    }
  }
  assert.ok(SRC.length > 0, 'led.js exists');
  assert.deepEqual(colourLiterals(SRC.replace(/^\s*(?:\/\/|\*).*$/gm, '')), []);
  assert.deepEqual(intensityLiterals(SRC), []);
});

test('pure: no DOM, no listener, no timer, no animation in the renderer', () => {
  assert.ok(SRC.length > 0, 'led.js exists');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(?:document|window|addEventListener|setTimeout|setInterval)\b/);
  assert.doesNotMatch(code, /requestAnimationFrame|\.animate\(|<animate|transition|animate-/);
  assert.match(SRC, /prefers-reduced-motion/, 'the comment tells a host animating the needle');
});
