// The shared synth-theme layer's LED and needle meter (src/js/ui/synth/led.js; plan F013 entry
// 9, slice S9; project.visual-identity-lock v4 "Indicators bind to state" and "Measurement
// truth"): pure string renderers, no DOM, no listener, no timer. Checked here: an LED cannot be
// drawn without a real state source (a missing source and a non-boolean lit throw); data-source,
// data-lit and data-value are the caller's values, never constants; the glow is an SVG halo (a
// circle in the lens's token, at most 6 px past it, at the hw-sheen intensity by class), only
// while lit, inside the LED and never on text; the bezel is told from the plate in both themes
// (its ring the strongest neutral the palette has); the unlit ring holds 3:1 on the bezel,
// surface-1, surface-2 and surface-3 in both themes and every lit colour too, computed from
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
import { ZOOM_MAX } from '../../src/js/ui/studio/graph-geometry.js';
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
/** The zooms the graph allows, its ZOOM_MAX included (graph-geometry.js). */
const ZOOMS = [0.5, 1, 1.5, 2, ZOOM_MAX];
/** The [start, end) span of the element whose open tag carries `attr`, from its open tag to the
 *  close tag that matches it (nested elements of its name counted), or null. */
function elementSpan(svg, attr) {
  const m = new RegExp(`<(\\w+)\\b[^>]*\\s${attr}=""[^>]*>`).exec(svg);
  if (!m || m[0].endsWith('/>')) return m ? [m.index, m.index + m[0].length] : null;
  const tag = new RegExp(`<(/?)${m[1]}\\b[^>]*?(/?)>`, 'g');
  tag.lastIndex = m.index + m[0].length;
  let depth = 1;
  for (let t = tag.exec(svg); t; t = tag.exec(svg)) {
    if (t[1]) depth -= 1;
    else if (!t[2]) depth += 1;
    if (depth === 0) return [m.index, t.index + t[0].length];
  }
  return null;
}
/** Whether `part` lies inside the element that carries `attr`. */
const within = (svg, attr, inner) => {
  const span = elementSpan(svg, attr);
  const i = svg.indexOf(inner);
  return Boolean(span) && i > span[0] && i + inner.length <= span[1];
};

test('the module exists and exports ledSvg, meterSvg and their geometry', () => {
  assert.equal(typeof led.ledSvg, 'function', 'ledSvg');
  assert.equal(typeof led.meterSvg, 'function', 'meterSvg');
  assert.equal(led.LED.lens * 2, 6, 'the lens is 6 graph units across');
  // LXK-10 (D-PAL): a plain lit LED is the emission colour, --osc-hw-led; the ring is no LED
  // colour (dark blue in light, it read as off); applied and refuse keep the state they encode.
  assert.ok(Array.isArray(led.LED_COLOURS));
  assert.deepEqual([...led.LED_COLOURS], ['control.led', 'control.applied', 'jack.refuse']);
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

test('lit: the chosen state token on the lens, under its halo; unlit: surface-2, text-dim ring',
  () => {
    const on = LED();
    const lens = part(on, 'data-lens');
    assert.ok(lens, 'a lens');
    assert.equal(attrOf(lens, 'fill'), TOKENS.control.led, 'control.led by default (LXK-10)');
    assert.equal(attrOf(lens, 'class'), undefined, 'a box-shadow class paints no SVG element');
    assert.equal(Number(attrOf(lens, 'r')), 3, 'Ø6');
    for (const colour of led.LED_COLOURS) {
      const [g, r] = colour.split('.');
      assert.equal(attrOf(part(LED({ colour }), 'data-lens'), 'fill'), TOKENS[g][r], colour);
    }
    for (const colour of ['#00ff00', 'red', 'var(--osc-green)', 'cable.palette.3', 'text.label']) {
      assert.throws(() => LED({ colour }), TypeError, `${colour}: not a state token role`);
    }
    assert.equal(attrOf(lens, 'stroke'), TOKENS.surface.edge, 'lit: seated in surface.edge');
    const off = LED({ lit: false });
    const dark = part(off, 'data-lens');
    assert.equal(attrOf(dark, 'fill'), TOKENS.surface.card, 'surface-2 body');
    assert.equal(attrOf(dark, 'stroke'), TOKENS.control.edge, 'text-dim ring');
    assert.equal(TOKENS.control.edge, 'var(--osc-text-dim)');
    assert.equal(TOKENS.surface.card, 'var(--osc-surface-2)');
    assert.doesNotMatch(off, /shadow-hw-led|data-halo/, 'no glow while unlit');
    const bezel = part(on, 'data-bezel');
    assert.ok(bezel && Number(attrOf(bezel, 'r')) > 3, 'a bezel ring around the lens');
  });

test('a lit LED glows by an SVG halo: one circle behind the lens, its token, <= 6 px past it',
  () => {
    for (const zoom of ZOOMS) {
      for (const colour of led.LED_COLOURS) {
        for (const extra of [{}, { label: 'Arm' }, { interactive: true }]) {
          const svg = LED({ colour, zoom, ...extra });
          const where = `${colour} zoom ${zoom} ${JSON.stringify(extra)}`;
          const halos = svg.match(/<\w+\b[^>]*\sdata-halo=""[^>]*>/g) || [];
          assert.equal(halos.length, 1, `${where}: one halo`);
          const [halo] = halos;
          const lens = part(svg, 'data-lens');
          assert.match(halo, /^<circle\b/, `${where}: a circle`);
          // Screen px: the halo's reach past the lens, scaled by the zoom, as the eye sees it.
          const reach = (Number(attrOf(halo, 'r')) - Number(attrOf(lens, 'r'))) * zoom;
          assert.ok(reach > 0 && reach <= 6, `${where}: ${reach} screen px past the lens, (0, 6]`);
          assert.ok(near(reach, Math.min(led.LED.halo * zoom, led.HALO_PX), 0.01),
            `${where}: LED.halo graph units, never past HALO_PX screen px`);
          assert.ok(reach <= led.HALO_PX + 1e-9, `${where}: ${reach} screen px, not past HALO_PX`);
          assert.equal(attrOf(halo, 'cx'), attrOf(lens, 'cx'), `${where}: centred on the lens`);
          assert.equal(attrOf(halo, 'cy'), attrOf(lens, 'cy'), `${where}: centred on the lens`);
          assert.equal(attrOf(halo, 'class'), 'opacity-hw-sheen', `${where}: the hw-sheen key`);
          assert.equal(attrOf(halo, 'fill'), attrOf(lens, 'fill'), `${where}: the lens's colour`);
          assert.match(attrOf(halo, 'fill'), /^var\(--osc-[\w-]+\)$/, `${where}: a token`);
          assert.equal(attrOf(halo, 'stroke'), 'none');
          assert.equal(attrOf(halo, 'aria-hidden'), 'true', `${where}: aria-hidden`);
          assert.equal(attrOf(halo, 'pointer-events'), 'none', `${where}: takes no pointer`);
          assert.ok(svg.indexOf(halo) < svg.indexOf(lens), `${where}: behind the lens`);
          assert.ok(svg.indexOf(part(svg, 'data-bezel')) < svg.indexOf(halo),
            `${where}: over the bezel, which a lit LED lights`);
          // Inside the data-led element: between its own <g> and the </g> that closes it.
          assert.ok(within(svg, 'data-led', halo), `${where}: inside data-led`);
          assert.doesNotMatch(svg, /\s(?:fill-|stroke-|flood-|stop-)?opacity=/,
            `${where}: no literal opacity attribute`);
        }
      }
      assert.doesNotMatch(LED({ lit: false, zoom }), /data-halo/, 'unlit: no halo');
    }
  });

test('within() reads the data-led element\'s own span, so a halo moved out of it is caught', () => {
  const svg = LED({ zoom: 1 });
  const halo = part(svg, 'data-halo');
  assert.ok(within(svg, 'data-led', halo), 'the drawn halo is inside');
  // Moved out: after the LED's group, inside an outer group that closes later.
  const out = `<g data-outer="">${svg.replace(halo, '')}${halo}</g>`;
  assert.ok(!within(out, 'data-led', halo), 'after the LED\'s </g>');
  assert.ok(!within(`${halo}${svg.replace(halo, '')}`, 'data-led', halo), 'before its <g>');
  const nested = `<g data-led="" a=""><g>x</g>${halo}</g>`;
  assert.ok(within(nested, 'data-led', halo), 'a nested </g> does not close it');
  assert.ok(!within(`<g data-led="" a=""><g>x</g></g>${halo}`, 'data-led', halo), 'nested, out');
});

test('the glow is never on text and never on the group that holds the label', () => {
  for (const lit of [true, false]) {
    const svg = LED({ lit, label: 'Arm' });
    assert.ok(/<text\b/.test(svg), 'a label');
    for (const t of svg.match(/<text\b[^>]*>/g)) {
      assert.doesNotMatch(t, /shadow|class=/, 'text glows');
    }
    assert.doesNotMatch(open(svg), /shadow|class=/, 'the group with the text does not glow');
    const glowing = svg.match(/<\w+\b[^>]*\sclass="[^"]*"[^>]*>/g) || [];
    assert.equal(glowing.length, lit ? 1 : 0);
    if (lit) assert.match(glowing[0], /^<circle\b[^>]*data-halo=""/, 'only the halo');
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
  for (const zoom of ZOOMS) {
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
  // A lit lens sits in its seat (a surface.edge ring), so its colour meets the seat, not the
  // bezel's body: light --osc-red is 2.94:1 on the surface-4 body and 3.33:1 on the seat.
  const grounds = [['bezel', N.control.capHi], ['plate low', N.surface.plateLo],
    ['card', N.surface.card], ['plate high', N.surface.plateHi],
    ['D-PAL plate high', N.plate.hi], ['D-PAL plate low', N.plate.lo]];
  const seat = ['seat', N.surface.edge];
  assert.equal(N.control.capHi, '--osc-surface-4');
  assert.equal(N.surface.plateLo, '--osc-surface-1');
  assert.equal(N.surface.card, '--osc-surface-2');
  assert.equal(N.surface.plateHi, '--osc-surface-3');
  assert.equal(N.surface.edge, '--osc-bg');
  const marks = [['unlit ring', N.control.edge, grounds], ['meter scale', N.control.track, grounds],
    ['needle', N.control.pointer, grounds],
    ...led.LED_COLOURS.map((c) => [`lit ${c}`, name(c), [seat, ...grounds.slice(1)]])];
  for (const [theme, t] of Object.entries(themes)) {
    for (const [what, fg, on] of marks) {
      for (const [where, bg] of on) {
        const ratio = contrastOf(tokenHex(t, fg), tokenHex(t, bg));
        assert.ok(ratio >= 3, `${theme}: ${what} (${fg}) on the ${where} (${bg}) ${ratio.toFixed(2)}`);
      }
    }
    // The unit is drawn below the face, on the host's plate: surface-1, -2 or -3.
    for (const [where, bg] of grounds.slice(1)) {
      const unit = contrastOf(tokenHex(t, N.text.label), tokenHex(t, bg));
      assert.ok(unit >= 4.5, `${theme}: the meter's unit text (${N.text.label}) on the ${where} `
        + `(${bg}) ${unit.toFixed(2)}`);
    }
  }
  // As drawn: the unit's text sits below the face, outside it.
  const svg = METER({ scale: 'calibrated', calibrated: true, unit: 'dB SPL' });
  const face = part(svg, 'data-face');
  const t = /<text\b[^>]*>/.exec(svg)[0];
  assert.ok(Number(attrOf(t, 'y')) - 12 >= Number(attrOf(face, 'y'))
    + Number(attrOf(face, 'height')), 'the unit is below the face, on the plate');
  assert.equal(attrOf(t, 'fill'), TOKENS.text.label);
});

// The strongest neutral (border, surface or page) the palette has against the plate surfaces
// in both themes, a token the bezel may use; the marking tokens (text-*) are the lens's.
const NEUTRALS = ['--osc-border', '--osc-border-strong', '--osc-border-soft', '--osc-bg',
  '--osc-surface-0', '--osc-surface-1', '--osc-surface-2', '--osc-surface-3', '--osc-surface-4'];
/** Measured from tokens.css (dark, the weakest theme): --osc-border-strong on surface-1, -2, -3
 *  is 1.30, 1.20 and 1.10; light 1.61, 1.43 and 1.33. No neutral reaches 1.3 on surface-3 in
 *  dark (the palette's best is 1.10), so the bezel's ring is that best, and 1.3 where it can. */
const BEZEL_RING_MIN = 1.1;

test('the bezel is told from the plate: a surface-4 body, a border-strong ring, both themes',
  async () => {
    const themes = await tokenThemes();
    const N = SYNTH_TOKEN_NAMES;
    assert.equal(N.control.bezel, '--osc-border-strong', 'a dedicated bezel role');
    for (const lit of [true, false]) {
      const bezel = part(LED({ lit }), 'data-bezel');
      assert.equal(attrOf(bezel, 'fill'), TOKENS.control.capHi, 'the body is control.capHi');
      assert.equal(attrOf(bezel, 'stroke'), TOKENS.control.bezel, 'the ring is control.bezel');
    }
    const plates = [N.surface.plateLo, N.surface.card, N.surface.plateHi];
    const worst = (fg) => Math.min(...Object.values(themes).flatMap((t) => plates
      .map((bg) => contrastOf(tokenHex(t, fg), tokenHex(t, bg)))));
    const ring = worst(N.control.bezel);
    const best = Math.max(...NEUTRALS.map(worst));
    assert.ok(ring >= best - 1e-9,
      `the ring ${ring.toFixed(2)} is the best neutral, ${best.toFixed(2)}`);
    assert.ok(ring >= BEZEL_RING_MIN, `the ring ${ring.toFixed(2)} >= ${BEZEL_RING_MIN}`);
    // 1.3:1 on every plate but the two dark ones no neutral ring reaches it on, stated.
    const short = [];
    for (const [theme, t] of Object.entries(themes)) {
      for (const bg of plates) {
        const r = contrastOf(tokenHex(t, N.control.bezel), tokenHex(t, bg));
        if (r < 1.3) short.push(`${theme} ${bg} ${r.toFixed(2)}`);
      }
      const body = tokenHex(t, N.control.capHi);
      assert.notEqual(body, tokenHex(t, N.surface.plateLo), `${theme}: the body is not surface-1`);
      assert.ok(contrastOf(body, tokenHex(t, N.surface.plateLo)) >= 1.3,
        `${theme}: the body on surface-1`);
    }
    assert.deepEqual(short, ['dark --osc-surface-2 1.20', 'dark --osc-surface-3 1.10']);
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
      assert.match(c, /^class="opacity-hw-sheen"$/, `${c}: the only class is the halo's`);
    }
  }
  assert.ok(SRC.length > 0, 'led.js exists');
  assert.deepEqual(colourLiterals(SRC.replace(/^\s*(?:\/\/|\*).*$/gm, '')), []);
  assert.deepEqual(intensityLiterals(SRC), []);
});

test('the header says an interactive indicator\'s host supplies its role, focus and value', () => {
  const header = SRC.slice(0, SRC.indexOf('import '));
  assert.match(header, /interactive[\s\S]*host supplies[\s\S]*role[\s\S]*focus ring[\s\S]*value/,
    'the switch.js contract, stated');
  assert.match(header, /switch\.js/, 'naming the contract it matches');
});

test('pure: no DOM, no listener, no timer, no animation in the renderer', () => {
  assert.ok(SRC.length > 0, 'led.js exists');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(?:document|window|addEventListener|setTimeout|setInterval)\b/);
  assert.doesNotMatch(code, /requestAnimationFrame|\.animate\(|<animate|transition|animate-/);
  assert.match(SRC, /prefers-reduced-motion/, 'the comment tells a host animating the needle');
});
