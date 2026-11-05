// K058 with F013 W1b: every knob and switch the Synth panel draws through view/face.js is the
// synth-theme layer's control (src/js/ui/synth/knob.js controlSvg), coloured from the panel's
// tokens in the layer's roles, its ARIA N003's shape (ariaAttrs: aria-valuenow the position
// 0..1000, the value and unit in aria-valuetext) and its readout the core's formatValue. A choice
// (an enum) is ONE control since W1c (the SYN review's V8-V10): the core's switch
// (src/js/ui/synth/switch.js switchSvg at switchLayout) by its position count, a lever, a slide,
// a detented rotary or a rotary with a window, its legends silk-screened on the plate, and each
// option an invisible 44 px radio button over its legend at the layout's hit box.
//
//   node --test tests/unit/synth-face-controls.test.mjs
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { controlReason, controlValue, plateHtml } from '../../src/js/synth/view/face.js';
import {
  CHOICE_MAX_PX, choiceLayout, choiceSvg, knobModel, knobSvg, panelControlTokens,
} from '../../src/js/synth/view/knob.js';
import { CABLE_TOKENS, PANEL_TOKENS } from '../../src/js/synth/view/tokens.js';
import { ariaAttrs, controlSvg, formatValue } from '../../src/js/ui/synth/knob.js';
import { switchLayout, switchStyle } from '../../src/js/ui/synth/switch.js';
import { SYNTH_TOKEN_NAMES } from '../../src/js/ui/synth/tokens.js';
import { panelStore } from './synth-fixture.mjs';
import { contrastOf, tokenHex, tokenThemes } from './ui-synth-fixture.mjs';

// The panel's tokens as var() references, so a paint that reached the markup names its token.
const T = { ...Object.fromEntries(Object.entries(PANEL_TOKENS).map(([k, n]) => [k, `var(${n})`])),
  cables: CABLE_TOKENS.map((n) => `var(${n})`) };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const model = panelStore().getModel();
const nodes = PANEL.resolve(model);
const plates = new Map(PANEL.modules.map((m) => [m.id, plateHtml({ panel: PANEL, module: m,
  node: nodes.get(m.id), model, tokens: T })]));
const controls = PANEL.modules.flatMap((m) => PANEL.faceOf(m.id).map((c) => ({ m, c,
  cid: `${m.id}.${c.key}`, value: controlValue(c, nodes.get(m.id), model, PANEL),
  reason: controlReason(m, nodes.get(m.id), c, model, PANEL) })));
const knobs = controls.filter((x) => x.c.kind === 'knob' || x.c.kind === 'amount');
const switches = controls.filter((x) => x.c.kind === 'switch');
const toggles = controls.filter((x) => x.c.kind === 'toggle');

/** One control's markup: its wrapper up to the next control's (a control id holds a dot; the
 *  core's own `<g data-control="knob">` does not). */
function block(cid) {
  const html = plates.get(cid.split('.')[0]);
  const parts = html.split(/(?=<div [^>]*data-control="[\w-]+\.[\w-]+")/);
  const own = parts.find((p) => p.startsWith('<div') && p.includes(`data-control="${cid}"`));
  assert.ok(own, `${cid} is on its plate`);
  return own;
}
const count = (s, re) => (s.match(re) || []).length;
/** A choice's drawing takes no pointer: the core's hit rect (pointer-events="all") neutralised,
 *  so a press on it reaches nothing (review of W1b, finding 1: elementFromPoint was the rect). */
const inert = (svg) => svg.replace('pointer-events="all"', 'pointer-events="none"');
const paints = (s) => [...s.matchAll(/(?:fill|stroke|stop-color)="([^"]*)"/g)].map((x) => x[1]);

test('the census: knobs, switches, rotary selectors and toggles on the panel', () => {
  assert.ok(knobs.length > 90, `${knobs.length} knobs`);
  const by = (style) => switches.filter((x) => switchStyle(x.c.param) === style)
    .map((x) => x.cid).sort();
  assert.deepEqual(by('toggle'), ['am.mode', 'mg.shape', 'ring.mode'], 'two positions: a lever');
  assert.deepEqual(by('slide'), ['additive.shape', 'am.carrier', 'am.modulator', 'keys.priority',
    'noise.color', 'vco1.scale', 'vco2.scale', 'wavetable.bank'], 'three or four: a slide');
  assert.deepEqual(by('rotary'), ['fm.algorithm', 'vco1.waveform', 'vco2.waveform'],
    'five to eight: a detented rotary');
  assert.deepEqual(by('window'), ['xy.key', 'xy.mode'], 'nine to twelve: a rotary with a window');
  assert.deepEqual(toggles.map((x) => x.cid).sort(), ['perc.choke', 'sh.smooth']);
});

test('every knob is the core\'s knob, with N003 ARIA and the core\'s value text', () => {
  for (const { cid, c, value, reason } of knobs) {
    const b = block(cid);
    const a = ariaAttrs(value, c.param);
    assert.equal(a['aria-valuemax'], 1000);
    assert.ok(b.includes(`role="slider" tabindex="0" data-knob="${cid}"`), cid);
    assert.ok(b.includes(`aria-valuemin="0" aria-valuemax="1000" aria-valuenow="`
      + `${a['aria-valuenow']}" aria-valuetext="${esc(a['aria-valuetext'])}"`), cid);
    assert.equal(count(b, /<g data-control="knob">/g), 1, `${cid}: one core knob`);
    assert.ok(b.includes(`data-value="${cid}">${esc(knobModel(c.param).format(value))}`
      + '</output>'), `${cid}: the readout is the one updateKnob writes`);
    assert.ok(formatValue(value, c.param).startsWith(knobModel(c.param).format(value)),
      `${cid}: the readout is formatValue, at most without its unit`);
    // The panel redraws a knob in place through knobSvg (synth/ui.js updateKnob): the same SVG.
    assert.ok(b.includes(knobSvg({ uid: cid, value, param: c.param, tokens: T,
      disabled: !!reason })), `${cid}: the face and the redraw agree`);
  }
});

test('a knob is drawn at 64 px from its 44-unit box, the scale ticks shown', () => {
  const svg = knobSvg({ uid: 'lpf.frequency', value: 1200, param: knobs.find((x) => x.cid
    === 'lpf.frequency').c.param, tokens: T });
  assert.match(svg, /^<svg viewBox="-22 -22 44 44" width="64" height="64" aria-hidden="true" /);
  assert.match(svg, /focusable="false"/);
  assert.match(svg, /data-ticks=""/, 'zoom 64/44 is past the core\'s tick zoom');
  assert.equal(svg, knobSvg({ uid: 'lpf.frequency', value: 1200, param: knobs.find((x) => x.cid
    === 'lpf.frequency').c.param, tokens: T }), 'a setpoint: the same value, the same drawing');
});

test('the controls take the panel\'s tokens in the layer\'s roles', () => {
  const ct = panelControlTokens(T);
  // D-PAL's control roles (the cap material, its ink, the LED: v4 amendment of 2026-11-05) are
  // dev-53's to map into PANEL_TOKENS and panelControlTokens; until then the core draws the
  // panel as before (ui-synth-tokens.test.mjs, the f523746a golden). Once the adapter carries
  // one, it leaves this list (a mapped role fails here until it does).
  const DPAL_PENDING = ['knobCap', 'knobCapHi', 'capInk', 'led'];
  for (const [role, name] of Object.entries(SYNTH_TOKEN_NAMES.control)) {
    if (role === 'applied') continue; // face.js has no applied value to mark (no engine report)
    if (DPAL_PENDING.includes(role)) {
      assert.equal(ct.control[role], undefined, `control.${role}: mapped, so drop it from `
        + 'DPAL_PENDING');
      continue;
    }
    assert.equal(ct.control[role], `var(${name})`, `control.${role}`);
  }
  assert.equal(ct.surface.edge, `var(${SYNTH_TOKEN_NAMES.surface.edge})`);
  assert.equal(ct.surface.plateHi, `var(${SYNTH_TOKEN_NAMES.surface.plateHi})`);
  assert.equal(ct.surface.plateLo, `var(${SYNTH_TOKEN_NAMES.surface.plateLo})`);
  // The skirt: the panel has no surface-2; it is the plate's top, outlined by the 3:1 edge.
  assert.equal(ct.surface.card, 'var(--osc-surface-3)');
  // A choice's legends: the layer's text roles, read by the panel's own tokens.
  for (const [role, name] of Object.entries(SYNTH_TOKEN_NAMES.text)) {
    assert.equal(ct.text[role], `var(${name})`, `text.${role}`);
  }
  for (const { cid } of controls) {
    // A url(#id) paint is a gradient of token stops the same block defines (the knob, slice A).
    const b = block(cid);
    const bad = paints(b).filter((p) => !/^var\(--osc-[\w-]+\)$|^none$/.test(p)
      && !(/^url\(#([^)]+)\)$/.test(p) && b.includes(` id="${/^url\(#([^)]+)\)$/.exec(p)[1]}"`)));
    assert.deepEqual(bad, [], `${cid}: tokens only`);
  }
});

test('a disabled knob stays focusable, says why and draws the core\'s track only (C1)', () => {
  const off = knobs.filter((x) => x.reason);
  assert.ok(off.some((x) => x.cid === 'am.depth'), 'AM depth is inactive in ring mode');
  for (const { cid } of off) {
    const b = block(cid);
    assert.ok(b.includes(`aria-disabled="true" aria-describedby="${cid}-why"`), cid);
    assert.match(b, /role="slider" tabindex="0"/);
    assert.ok(b.includes(`<span class="sr-only" id="${cid}-why">`), cid);
  }
  // The core's one disabled language (C1, co-signed by p2 and dev-53): no value arc, the track
  // only, a flat body; an enabled knob keeps its value arc.
  for (const { cid } of off) {
    const knob = /<g data-control="knob">.*?<\/g><\/g>/.exec(block(cid))[0];
    assert.doesNotMatch(knob, /data-ring=""/, `${cid}: no value arc`);
    assert.match(knob, /data-track=""/, `${cid}: the track`);
    assert.doesNotMatch(knob, /stroke-dasharray|data-sheen=""/, cid);
  }
  assert.match(block('lpf.frequency'), /data-ring=""/);
  assert.doesNotMatch(block('lpf.frequency'), /stroke-dasharray/);
});

test('one focus ring: the core\'s, shown only on keyboard focus', () => {
  for (const { cid } of knobs) {
    const b = block(cid);
    const slider = /<div role="slider"[^>]*>/.exec(b)[0];
    assert.match(slider, /class="group /, `${cid}: the slider is the focus group`);
    assert.doesNotMatch(slider, /focus-visible:ring/, `${cid}: no second ring`);
    // Hidden by visibility, the layer's idiom, never by an opacity (review of W1b, finding 9).
    assert.equal(count(b, /<circle data-focus="" class="invisible group-focus-visible:visible"/g),
      1, cid);
    assert.doesNotMatch(b, /opacity-0|group-focus-visible:opacity/, cid);
  }
});

const num = (x) => Number(Number(x).toFixed(2));
/** A choice's one drawing: its root svg, the core's switch group and its radio overlays. */
function choiceParts(cid) {
  const b = block(cid);
  const svg = /<svg [^>]*>/.exec(b);
  assert.ok(svg, `${cid}: an svg`);
  const RADIO_RE = new RegExp(String.raw`<foreignObject x="([-\d.]+)" y="([-\d.]+)" `
    + String.raw`width="([\d.]+)" height="([\d.]+)">(<button [^>]*>)([\s\S]*?)<\/button>`
    + '</foreignObject>', 'g');
  const radios = [...b.matchAll(RADIO_RE)]
    .map((m) => ({ x: +m[1], y: +m[2], width: +m[3], height: +m[4], tag: m[5], inner: m[6] }));
  return { b, svg: svg[0], radios };
}

test('a choice is ONE control: the core\'s switch at its value, by its position count (V8)', () => {
  for (const { cid, c, value, reason } of switches) {
    const { b, svg } = choiceParts(cid);
    const L = choiceLayout(c.param);
    assert.equal(count(b, /<svg /g), 1, `${cid}: one drawing`);
    assert.equal(count(b, /<g data-control="/g), 1, `${cid}: one control`);
    assert.equal(count(b, new RegExp(`<g data-control="switch" data-style="${L.style}" `
      + 'aria-hidden="true" pointer-events="none"', 'g')), 1, `${cid}: the core's ${L.style}`);
    assert.ok(b.includes(choiceSvg({ value, param: c.param, tokens: T, disabled: !!reason })),
      `${cid}: the drawing is choiceSvg's, the lever, cap or pointer at the value`);
    // Drawn at zoom 1: one graph unit is one CSS px, so the legends are 12 px on screen.
    const box = L.box;
    assert.ok(svg.includes(`viewBox="${box.x} ${box.y} ${box.width} ${box.height}" `
      + `width="${box.width}" height="${box.height}"`), `${cid}: ${svg}`);
    assert.match(svg, /role="radiogroup" aria-labelledby="/, `${cid}: the drawing is the group`);
    assert.doesNotMatch(b, /role="slider"/, `${cid}: never a slider`);
    // No separate segmented group any more (V8).
    assert.doesNotMatch(b, /first:rounded-l-lg|bg-primary-600|-ml-px/, `${cid}: no segments`);
  }
});

test('its legends are silk-screened panel text at the layout\'s positions, 12 px', () => {
  for (const { cid, c, value } of switches) {
    const { b } = choiceParts(cid);
    const L = choiceLayout(c.param);
    const texts = [...b.matchAll(new RegExp(String.raw`<text data-legend="" data-index="(\d+)" `
      + String.raw`x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)"[^>]*fill="([^"]+)"[^>]*>`
      + '([^<]*)</text>', 'g'))];
    assert.equal(texts.length, L.options.length, `${cid}: a legend per option`);
    for (const [, i, x, y, size, fill, label] of texts) {
      const o = L.options[Number(i)];
      assert.equal(num(x), num(o.legend.x), `${cid} ${label} x`);
      assert.equal(num(y), num(o.legend.y), `${cid} ${label} y`);
      assert.equal(Number(size), 12, `${cid} ${label}: 12 px`);
      assert.equal(label, String(o.legend.text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'), cid);
      assert.equal(fill, o.value === value ? 'var(--osc-text)' : 'var(--osc-text-muted)',
        `${cid} ${label}: the plate's text tokens`);
    }
  }
});

test('every legend reads 4.5:1 on the plate, top and bottom, in both themes', async () => {
  const themes = await tokenThemes();
  const ct = panelControlTokens(Object.fromEntries(Object.entries(PANEL_TOKENS)
    .map(([k, n]) => [k, n])));
  for (const [name, theme] of Object.entries(themes)) {
    for (const plate of [ct.surface.plateHi, ct.surface.plateLo]) {
      for (const role of ['label', 'value']) {
        const r = contrastOf(tokenHex(theme, ct.text[role]), tokenHex(theme, plate));
        assert.ok(r >= 4.5, `${name} text.${role} ${ct.text[role]} on ${plate}: ${r.toFixed(2)}`);
      }
    }
    // A window's name: the value text on the window's frame.
    const r = contrastOf(tokenHex(theme, ct.text.value), tokenHex(theme, ct.surface.edge));
    assert.ok(r >= 4.5, `${name} the window's name: ${r.toFixed(2)}`);
  }
});

test('each option is an invisible 44 px radio over its legend at the layout\'s hit box', () => {
  for (const { cid, c, value, reason } of switches) {
    const { radios } = choiceParts(cid);
    const L = choiceLayout(c.param);
    assert.equal(radios.length, L.options.length, `${cid}: a radio per option`);
    L.options.forEach((o) => {
      const r = radios.find((x) => x.tag.includes(` data-v="${esc(o.value)}" `));
      assert.deepEqual([r.x, r.y, r.width, r.height].map(num),
        [o.hit.x, o.hit.y, o.hit.width, o.hit.height].map(num), `${cid} ${o.label}: its hit box`);
      assert.ok(r.width >= 44 && r.height >= 44, `${cid} ${o.label}: 44 px`);
      const t = { x: o.legend.anchor === 'start' ? o.legend.x : o.legend.anchor === 'end'
        ? o.legend.x - o.legend.width : o.legend.x - o.legend.width / 2,
      y: o.legend.y - o.legend.size / 2 };
      assert.ok(t.x >= r.x - 0.01 && t.x + o.legend.width <= r.x + r.width + 0.01
        && t.y >= r.y - 0.01 && t.y + o.legend.size <= r.y + r.height + 0.01,
      `${cid} ${o.label}: the radio covers its legend`);
      assert.ok(r.tag.startsWith('<button type="button" role="radio" '
        + `aria-checked="${o.value === value}" data-option="${cid}" data-v="${esc(o.value)}" `),
      `${cid}: ${r.tag}`);
      // Invisible: no paint of its own; its name is the legend's text, read by a screen reader.
      const cls = /class="([^"]*)"/.exec(r.tag)[1].split(/\s+/);
      for (const k of ['bg-transparent', 'border-0', 'h-full', 'w-full', 'text-xs',
        'focus-visible:ring-2', 'focus-visible:ring-inset']) {
        assert.ok(cls.includes(k), `${cid}: ${k}`);
      }
      assert.ok(cls.includes(reason ? 'cursor-not-allowed' : 'cursor-pointer'), cid);
      assert.ok(!cls.some((k) => /^(?:dark:)?(?:bg|text)-(?!transparent|xs)/.test(k)),
        `${cid}: no visible fill or text colour: ${cls.join(' ')}`);
      assert.equal(r.inner, `<span class="sr-only">${esc(o.legend.text)}</span>`, cid);
    });
    for (let i = 0; i < radios.length; i++) {
      for (let j = i + 1; j < radios.length; j++) {
        const [a, q] = [radios[i], radios[j]];
        assert.ok(!(a.x < q.x + q.width - 0.01 && q.x < a.x + a.width - 0.01
          && a.y < q.y + q.height - 0.01 && q.y < a.y + a.height - 0.01),
        `${cid}: options ${i} and ${j} overlap`);
      }
    }
    assert.equal(radios.filter((r) => r.tag.includes('aria-checked="true"')).length, 1, cid);
  }
});

/** A choice's block with its parameter set to `v` (every other parameter of the node kept). */
function blockAt(cid, v) {
  const [mid, key] = cid.split('.');
  const m = PANEL.modules.find((x) => x.id === mid);
  const node = nodes.get(mid);
  const html = plateHtml({ panel: PANEL, module: m, node: { ...node, params: { ...node.params,
    [key]: v } }, model, tokens: T });
  const own = html.split(/(?=<div [^>]*data-control="[\w-]+\.[\w-]+")/)
    .find((p) => p.startsWith('<div') && p.includes(`data-control="${cid}"`));
  assert.ok(own, `${cid} at ${v}`);
  return own;
}
const radiosOf = (b) => [...b.matchAll(new RegExp(String.raw`<foreignObject x="([-\d.]+)" `
  + String.raw`y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)">(<button [^>]*>)`, 'g'))]
  .map((m) => ({ y: +m[2], height: +m[4], tag: m[5], v: /data-v="([^"]*)"/.exec(m[5])[1],
    tabindex: (/\stabindex="(-?\d+)"/.exec(m[5]) || [])[1] ?? null,
    checked: m[5].includes('aria-checked="true"') }));
const SEG_RE = /M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/g;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Review of W1c, finding 1: a lever's and a slide's radios ran bottom to top in the DOM (option
// 0 is drawn at the bottom), so Tab and a screen reader met the bottom legend first. They run in
// the drawn order now, top to bottom; a dial's run clockwise (a packed grid, row by row), its
// option order.
test('a lever\'s and a slide\'s radios run top to bottom in the DOM, as drawn', () => {
  const styles = new Set();
  for (const { cid, c } of switches) {
    const L = choiceLayout(c.param);
    styles.add(L.style);
    const radios = radiosOf(block(cid));
    const ys = radios.map((r) => r.y);
    if (L.style === 'toggle' || L.style === 'slide') {
      for (let i = 1; i < ys.length; i++) {
        assert.ok(ys[i] > ys[i - 1], `${cid}: radio ${i} (${radios[i].v}) at y ${ys[i]} is `
          + `drawn below radio ${i - 1} (${radios[i - 1].v}) at y ${ys[i - 1]}`);
      }
    } else {
      assert.deepEqual(radios.map((r) => r.v), L.options.map((o) => esc(o.value)),
        `${cid}: a dial's radios in its option order`);
    }
  }
  assert.ok(styles.has('toggle') && styles.has('slide'), [...styles].join(' '));
});

// Review of W1c, finding 2: every radio was a tab stop (XY KEY had 12). A radio group is one:
// the checked radio has tabindex 0, every other -1 (choiceKey moves focus to the newly checked
// one), at every value of every choice.
test('roving tabindex: the checked radio is the group\'s one tab stop, at every value', () => {
  for (const { cid, c } of switches) {
    for (const [v] of c.param.options) {
      const radios = radiosOf(blockAt(cid, v));
      assert.ok(radios.every((r) => r.tabindex !== null), `${cid} at ${v}: each sets tabindex`);
      const stops = radios.filter((r) => r.tabindex === '0');
      assert.equal(stops.length, 1, `${cid} at ${v}: one tab stop`);
      assert.ok(stops[0].checked && stops[0].v === esc(v), `${cid} at ${v}: the checked one`);
      assert.ok(radios.filter((r) => r !== stops[0]).every((r) => r.tabindex === '-1'),
        `${cid} at ${v}: every other radio -1`);
    }
  }
});

// Review of W1c, finding 3: FM's algorithm (7) and the XY key (12) are packed dials whose
// detents carried no mark. The core numbers a dial's detents from 7 (switchLayout number,
// numeral); the panel prints a packed grid as an algorithm chart, each legend "n · label", and
// a radio's name is the legend it covers (label in name).
test('a packed dial numbers its detents and prints its legend grid as "n · label"', () => {
  const packed = switches.filter(({ c }) => choiceLayout(c.param).packed);
  assert.deepEqual(packed.map((x) => x.cid).sort(), ['fm.algorithm', 'xy.key']);
  for (const { cid, c } of packed) {
    const L = choiceLayout(c.param);
    const b = block(cid);
    const nums = [...b.matchAll(new RegExp('<text data-number="" data-index="(\\d+)" '
      + String.raw`x="([-\d.]+)" y="([-\d.]+)"[^>]*>(\d+)</text>`, 'g'))];
    assert.equal(nums.length, c.param.options.length, `${cid}: a numeral per detent`);
    for (const [, i, x, y, text] of nums) {
      assert.equal(text, String(Number(i) + 1), `${cid}: detent ${i} reads ${text}`);
      assert.deepEqual([num(x), num(y)], [L.options[i].numeral.x, L.options[i].numeral.y]);
    }
    const legends = [...b.matchAll(
      /<text data-legend="" data-index="(\d+)"[^>]*>([^<]*)<\/text>/g)];
    assert.equal(legends.length, c.param.options.length, cid);
    for (const [, i, text] of legends) {
      const want = `${Number(i) + 1} · ${c.param.options[i][1]}`;
      assert.equal(text, want.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'), `${cid}: legend ${i}`);
      assert.equal(L.options[i].legend.text, want, `${cid}: the layout's text`);
    }
    for (const r of radiosOf(b)) {
      const o = L.options.find((x) => esc(x.value) === r.v);
      const inner = new RegExp(`data-v="${reEsc(r.v)}"[^>]*><span class="sr-only">([^<]*)`
        + '</span>').exec(b);
      assert.equal(inner[1], esc(o.legend.text), `${cid} ${o.value}: its name is its legend`);
    }
    // No numeral lies in a cell: the grid starts below the numbered dial.
    for (const o of L.options) {
      const m = o.numeral;
      for (const q of L.options) {
        assert.ok(m.y + m.size / 2 <= q.hit.y + 0.01 || m.x + m.width / 2 <= q.hit.x
          || m.x - m.width / 2 >= q.hit.x + q.hit.width, `${cid}: numeral ${o.number} in a cell`);
      }
    }
  }
});

// Numerals go only where a grid prints the numbers: a dial whose legends lie round it or in the
// core's window grid (the XY scale: its 10 names do not fit two 117 px columns as "n · label",
// and its window names the selection) keeps its detents unnumbered.
test('an unpacked dial carries no numerals: nothing on the plate would print the number', () => {
  const unpacked = switches.filter(({ c }) => {
    const s = switchStyle(c.param);
    return (s === 'rotary' || s === 'window') && !choiceLayout(c.param).packed;
  });
  assert.ok(unpacked.some((x) => x.cid === 'xy.mode'), unpacked.map((x) => x.cid).join(' '));
  for (const { cid, c } of unpacked) {
    assert.equal(count(block(cid), /data-number=""/g), 0, `${cid}: no numeral`);
    assert.ok(choiceLayout(c.param).options.every((o) => o.number === null
      && o.legend.text === o.label), `${cid}: its legends are its labels`);
  }
});

// Review of W1c, finding 4: the WAVE dial's skirt was r 17 (34 px) beside the 64 px knobs, and
// its knurl a dashed ring the panel drew on it. Review of slice A, finding 5: the dial then kept
// the old face beside the redrawn knob. A dial is the core's knob face itself at the panel's
// knob size: the knob's toothed skirt, scaled by 64/44, no knurl and no overlay of the panel's.
test('a rotary selector is knob-sized: the knob\'s own face on screen', () => {
  const knob = knobSvg({ value: 0.5, param: { key: 'k', type: 'number', min: 0, max: 1,
    default: 0.5 }, tokens: T });
  const z = 64 / 44;
  const skirt = (s) => /<path d="([^"]+)" data-skirt=""/.exec(s)[1];
  let dials = 0;
  for (const { cid, c } of switches) {
    const style = switchStyle(c.param);
    if (style !== 'rotary' && style !== 'window') continue;
    dials += 1;
    const b = block(cid);
    // The choice is drawn at 1:1: its face group's scale is the knob's on-screen size.
    const face = /<g data-face="" transform="scale\(([\d.]+)\)">/.exec(b);
    assert.ok(face, `${cid}: the knob's face`);
    assert.ok(Math.abs(Number(face[1]) - z) < 1e-3, `${cid}: scale ${face[1]}, a knob's ${z}`);
    assert.equal(skirt(b), skirt(knob), `${cid}: the knob's toothed skirt`);
    assert.doesNotMatch(b, /data-knurl=""|data-ridges=""/, `${cid}: no knurl of its own`);
  }
  assert.ok(dials >= 4, `${dials} dials`);
});

// Review of slice A, finding 6: knobSvg drops the uid face.js and ui.js pass, so the core names
// each knob's gradients after its parameter and the semi-mono plates repeat them (knob-level-side
// x8, knob-decay x8 ...): invalid markup whose url(#) paints bind to the first copy. dev-53's
// knobSvg (src/js/synth/view/knob.js) forwards uid to controlSvg, and the dials' host passes
// switchSvg its uid; then every gradient id on the panel is unique.
test('every gradient id across the panel\'s plates is unique', {
  todo: 'dev-53: knobSvg forwards uid to controlSvg, the dial host passes switchSvg its uid' },
() => {
  const ids = [...plates.values()].flatMap((h) => [...h.matchAll(
    /<(?:linear|radial)Gradient\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(ids.length > 0, 'the plates draw gradients');
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  assert.deepEqual([...seen].filter(([, k]) => k > 1), [], 'duplicated gradient ids');
});

test('no legend group wraps: the legends sit round the control (V9)', () => {
  for (const { cid } of switches) {
    const { b } = choiceParts(cid);
    assert.doesNotMatch(b, /flex-wrap|sm:flex-row|flex-row/, `${cid}: nothing to wrap`);
    assert.doesNotMatch(b, /role="radiogroup"[^>]*class="[^"]*flex/, cid);
  }
  // Every choice fits the narrowest plate (a 2xl column, 234 px inside a 258 px card at 1536;
  // 248 at 320), so no plate spans two columns and none cuts a legend off (review of W1c, 1).
  for (const m of PANEL.modules) {
    assert.doesNotMatch(/^<section [^>]*>/.exec(plates.get(m.id))[0], /col-span/, m.id);
  }
});

test('every choice fits the narrowest plate: a wide dial packs its legends below it', () => {
  assert.equal(CHOICE_MAX_PX, 234);
  const packed = [];
  for (const { cid, c } of switches) {
    // The core's at the panel's knob size (a dial is the 64 px knob's face), unnumbered.
    const core = switchLayout(c.param, { knob: 64, numbers: false });
    const L = choiceLayout(c.param);
    assert.ok(L.box.width <= CHOICE_MAX_PX, `${cid}: ${L.box.width} px`);
    if (core.box.width <= CHOICE_MAX_PX) {
      assert.deepEqual(L, core, `${cid}: the core's own layout where it fits`);
      continue;
    }
    packed.push(cid);
    assert.equal(L.packed, true, cid);
    assert.equal(L.style, core.style, `${cid}: still the core's ${core.style}`);
    assert.equal(L.radius, null, `${cid}: no ring, so no leaders`);
    // A packed dial is the core's numbered one: a window keeps that layout's frame.
    const numbered = switchLayout(c.param, { knob: 64, numberLegends: true });
    assert.deepEqual(L.window, numbered.window, `${cid}: a window keeps its frame`);
    assert.ok(Object.isFrozen(L) && Object.isFrozen(L.options[0].hit), cid);
    const top = L.options[0].hit.y;
    assert.ok(top >= L.dial.extent, `${cid}: the grid is below the dial and its numerals`);
    const b = block(cid);
    assert.equal(count(b, /data-leader=""/g), 0, `${cid}: no leader points at a ring`);
    assert.equal(count(b, /data-selected=""/g), 1, `${cid}: the selected legend's bar`);
    L.options.forEach((o, i) => {
      assert.equal(o.value, core.options[i].value, cid);
      assert.equal(o.legend.anchor, 'middle', cid);
      assert.ok(o.hit.width >= 44 && o.hit.height >= 44, `${cid} ${o.label}: 44 px`);
      // A pad each side: the core's 6 where the grid fits with it, never under 2.
      assert.ok(o.legend.width + 4 <= o.hit.width + 0.01, `${cid} ${o.label}: fits its cell`);
      assert.ok(o.hit.x >= L.box.x - 0.01 && o.hit.x + o.hit.width <= L.box.x + L.box.width
        + 0.01 && o.hit.y + o.hit.height <= L.box.y + L.box.height + 0.01, `${cid}: in its box`);
    });
  }
  assert.deepEqual(packed.sort(), ['fm.algorithm', 'xy.key'],
    'the two wider than a column: FM\'s algorithm and the XY key');
});

test('a rotary has the knob\'s toothed skirt and its detents (V10)', () => {
  for (const { cid, c } of switches) {
    const { b } = choiceParts(cid);
    const style = switchStyle(c.param);
    const skirt = /<path d="[^"]*" data-skirt="" fill="([^"]*)" stroke="([^"]*)"/.exec(b);
    if (style !== 'rotary' && style !== 'window') {
      assert.equal(skirt, null, `${cid}: a ${style} has no skirt`);
      continue;
    }
    // The knob's skirt (review of slice A, finding 5): the cap's body, the silhouette edge.
    assert.ok(skirt, `${cid}: the toothed skirt`);
    assert.equal(skirt[1], panelControlTokens(T).control.cap, `${cid}: the cap's body`);
    assert.equal(skirt[2], panelControlTokens(T).control.edge, `${cid}: the silhouette edge`);
    assert.ok(b.indexOf('data-skirt=""') < b.indexOf('data-cap=""'), `${cid}: under the cap`);
    assert.equal(count(b, /data-detent=""/g), c.param.options.length, `${cid}: a detent each`);
  }
});

test('a window shows the selected option\'s name in its frame', () => {
  for (const { cid, c, value } of switches.filter((x) => switchStyle(x.c.param) === 'window')) {
    const L = choiceLayout(c.param);
    const w = L.window;
    const name = c.param.options.find((o) => o[0] === value)[1];
    const m = new RegExp(String.raw`<text data-window-text="" x="([-\d.]+)" y="([-\d.]+)" `
      + 'font-size="12" text-anchor="middle" dominant-baseline="central" font-weight="600" '
      + String.raw`fill="var\(--osc-text\)"[^>]*>([^<]*)</text>`).exec(block(cid));
    assert.ok(m, cid);
    assert.equal(num(m[1]), num(w.x + w.width / 2), cid);
    assert.equal(num(m[2]), num(w.y + w.height / 2), cid);
    assert.equal(m[3], esc(name), cid);
  }
});

test('a toggle is a lever beside its On/Off button', () => {
  for (const { cid, c, value, reason } of toggles) {
    const b = block(cid);
    assert.equal(count(b, /<g data-control="switch">/g), 1, cid);
    assert.ok(b.includes(inert(controlSvg({ kind: 'switch', value, param: c.param,
      tokens: panelControlTokens(T), zoom: 44 / 36, state: { disabled: !!reason } }))), cid);
    assert.ok(b.includes(`aria-pressed="${!!value}" data-toggle="${cid}"`), cid);
  }
});

test('a choice\'s drawing takes no pointer: a press reaches only an option', () => {
  for (const { cid } of switches) {
    const g = /<g data-control="switch"[\s\S]*?<\/g>(?=<foreignObject|<text data-window|<\/svg>)/
      .exec(block(cid));
    assert.ok(g, cid);
    assert.match(g[0], /^<g [^>]*pointer-events="none"/, cid);
    assert.doesNotMatch(g[0], /pointer-events="(?!none")/, `${cid}: no shape takes the pointer`);
    assert.doesNotMatch(g[0], /<button|tabindex/, `${cid}: the drawing holds no target`);
  }
  for (const { cid } of toggles) {
    const svg = /<svg [^>]*>[\s\S]*?<\/svg>/.exec(block(cid))[0];
    assert.match(svg, /^<svg [^>]*class="pointer-events-none /, cid);
    assert.doesNotMatch(svg, /pointer-events="(?!none")/, `${cid}: no shape takes the pointer`);
    assert.match(svg, /<rect data-hit="" [^>]*pointer-events="none"/, `${cid}: the hit rect`);
  }
  for (const { cid } of knobs) {
    assert.match(block(cid), /<rect data-hit="" [^>]*pointer-events="all"/,
      `${cid}: a knob's hit rect still takes the press its slider handles`);
  }
});

// WCAG contrast of two #rrggbb colours.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const TW = createRequire(import.meta.url)('tailwindcss/colors');
const PALETTE = { ...TW, primary: TW.blue };
/** The colour a utility of `kind` (bg, text) gives in a theme: the dark: one wins in dark. */
function utility(classes, kind, dark) {
  const pick = (pre) => classes.map((k) => new RegExp(`^${pre}${kind}-([a-z]+)(?:-(\\d+))?$`)
    .exec(k)).find((m) => m && PALETTE[m[1]] && (!m[2] || PALETTE[m[1]][m[2]]));
  const m = (dark && pick('dark:')) || pick('');
  assert.ok(m, `a ${kind} colour in ${classes.join(' ')}`);
  const hex = m[2] ? PALETTE[m[1]][m[2]] : PALETTE[m[1]];
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
}

test('a toggle\'s On/Off button holds 4.5:1 text in both themes', () => {
  for (const { cid } of toggles) {
    const b = block(cid);
    const legends = [...b.matchAll(/<button [^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)];
    assert.ok(legends.length > 0, cid);
    for (const [, cls, label] of legends) {
      const classes = cls.split(/\s+/);
      for (const dark of [false, true]) {
        const r = ratio(utility(classes, 'bg', dark), utility(classes, 'text', dark));
        assert.ok(r >= 4.5, `${cid} ${label} ${dark ? 'dark' : 'light'}: ${r.toFixed(2)}:1`);
      }
    }
  }
});

test('a knob readout is one line: a short physical unit, never over 10 characters', () => {
  // Review 2 of W1b, finding 1: 'logical gain' wrapped Output Level's readout to three lines.
  for (const { cid, c, value } of knobs) {
    const out = /<output class="([^"]*)" data-value="[^"]*">([^<]*)<\/output>/.exec(block(cid));
    assert.ok(out, `${cid}: a readout`);
    assert.ok(out[1].split(/\s+/).includes('whitespace-nowrap'), `${cid}: ${out[1]}`);
    const p = c.param;
    const values = [value, p.default, p.min, p.max].filter((v) => Number.isFinite(v));
    assert.ok(values.length >= 3, `${cid}: the default and both extremes`);
    for (const v of values) {
      const text = knobModel(p).format(v);
      assert.ok(text.length <= 10, `${cid} at ${v}: "${text}" is ${text.length} characters`);
      assert.ok(text.trim().split(/\s+/).length <= 2, `${cid} at ${v}: "${text}" is one unit`);
    }
  }
  const level = /<div role="slider"[^>]*>/.exec(block('out.level'))[0];
  assert.match(level, /aria-valuetext="[\d.]+ logical gain"/, 'the unit stays in the text');
  assert.match(block('out.level'), /data-value="out\.level">[\d.]+<\/output>/);
});
