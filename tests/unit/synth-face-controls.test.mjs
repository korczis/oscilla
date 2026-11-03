// K058 with F013 W1b: every knob and switch the Synth panel draws through view/face.js is the
// synth-theme layer's control (src/js/ui/synth/knob.js controlSvg), coloured from the panel's
// tokens in the layer's roles, its ARIA N003's shape (ariaAttrs: aria-valuenow the position
// 0..1000, the value and unit in aria-valuetext) and its readout the core's formatValue. An enum
// of more than four options is not a switch (the core refuses one): it is a rotary selector, the
// core's knob on the enum. Every option stays a radio button; the drawings are decoration.
//
//   node --test tests/unit/synth-face-controls.test.mjs
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { controlReason, controlValue, plateHtml } from '../../src/js/synth/view/face.js';
import { knobModel, knobSvg, panelControlTokens } from '../../src/js/synth/view/knob.js';
import { CABLE_TOKENS, PANEL_TOKENS } from '../../src/js/synth/view/tokens.js';
import { ariaAttrs, controlSvg, formatValue } from '../../src/js/ui/synth/knob.js';
import { SYNTH_TOKEN_NAMES } from '../../src/js/ui/synth/tokens.js';
import { panelStore } from './synth-fixture.mjs';

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
  const rotary = switches.filter((x) => x.c.param.options.length > 4).map((x) => x.cid).sort();
  assert.deepEqual(rotary, ['fm.algorithm', 'vco1.waveform', 'vco2.waveform', 'xy.key',
    'xy.mode'], 'the enums the core will not draw as a switch');
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
  for (const [role, name] of Object.entries(SYNTH_TOKEN_NAMES.control)) {
    if (role === 'applied') continue; // face.js has no applied value to mark (no engine report)
    assert.equal(ct.control[role], `var(${name})`, `control.${role}`);
  }
  assert.equal(ct.surface.edge, `var(${SYNTH_TOKEN_NAMES.surface.edge})`);
  assert.equal(ct.surface.plateHi, `var(${SYNTH_TOKEN_NAMES.surface.plateHi})`);
  assert.equal(ct.surface.plateLo, `var(${SYNTH_TOKEN_NAMES.surface.plateLo})`);
  // The skirt: the panel has no surface-2; it is the plate's top, outlined by the 3:1 edge.
  assert.equal(ct.surface.card, 'var(--osc-surface-3)');
  for (const { cid } of controls) {
    const bad = paints(block(cid)).filter((p) => !/^var\(--osc-[\w-]+\)$|^none$/.test(p));
    assert.deepEqual(bad, [], `${cid}: tokens only`);
  }
});

test('a disabled knob stays focusable, says why and draws the core\'s dashed arc', () => {
  const off = knobs.filter((x) => x.reason);
  assert.ok(off.some((x) => x.cid === 'am.depth'), 'AM depth is inactive in ring mode');
  for (const { cid } of off) {
    const b = block(cid);
    assert.ok(b.includes(`aria-disabled="true" aria-describedby="${cid}-why"`), cid);
    assert.match(b, /role="slider" tabindex="0"/);
    assert.ok(b.includes(`<span class="sr-only" id="${cid}-why">`), cid);
  }
  assert.match(block('am.depth'), /data-ring="" [^>]*stroke-dasharray="[\d.]+ [\d.]+"/);
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

test('an enum of up to four options is a switch, more a rotary selector; every option a radio',
  () => {
    for (const { cid, c, value } of switches) {
      const b = block(cid);
      const n = c.param.options.length;
      const kind = n > 4 ? 'knob' : 'switch';
      assert.equal(count(b, new RegExp(`<g data-control="${kind}">`, 'g')), 1, `${cid}: ${kind}`);
      assert.equal(count(b, /<g data-control="/g), 1, cid);
      assert.match(b, /<svg [^>]*aria-hidden="true" focusable="false"/);
      assert.doesNotMatch(b, /role="slider"/, `${cid}: never a slider`);
      assert.ok(b.includes(inert(controlSvg({ kind, value, param: c.param,
        tokens: panelControlTokens(T), zoom: kind === 'knob' ? 52 / 44 : 44 / 36 }))),
      `${cid}: the lever or the pointer sits at the value`);
      assert.equal(count(b, /role="radio" /g), n, cid);
      assert.equal(count(b, new RegExp(`data-option="${cid.replace('.', '\\.')}" data-v="`, 'g')),
        n, cid);
      assert.equal(count(b, /aria-checked="true"/g), 1, `${cid}: one position`);
      assert.ok(b.includes(`aria-checked="true" data-option="${cid}" data-v="${esc(value)}"`), cid);
      assert.match(b, /role="radiogroup" aria-labelledby="/);
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

test('a choice\'s drawing takes no pointer: a press on it reaches nothing', () => {
  for (const { cid } of [...switches, ...toggles]) {
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

test('every legend, selected or not, holds 4.5:1 text in both themes', () => {
  for (const { cid } of [...switches, ...toggles]) {
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

test('a choice stacks its drawing above its legends below sm; a rotary at every width', () => {
  // Review 2 of W1b, finding 2: beside a rotary, XY Mode's ten legends broke into a staircase.
  for (const { cid, c } of switches) {
    const row = /<div class="([^"]*)">(?=<svg )/.exec(block(cid));
    assert.ok(row, `${cid}: the drawing's row`);
    const classes = row[1].split(/\s+/);
    const rotary = c.param.options.length > 4;
    for (const k of ['flex', 'flex-col', 'items-start', 'gap-2']) {
      assert.ok(classes.includes(k), `${cid}: ${k} in ${row[1]}`);
    }
    if (rotary) {
      assert.ok(!classes.some((k) => k.startsWith('sm:') || k.startsWith('md:')
        || k.startsWith('lg:')), `${cid}: a rotary never goes beside its legends: ${row[1]}`);
    } else {
      for (const k of ['sm:flex-row', 'sm:items-center']) {
        assert.ok(classes.includes(k), `${cid}: ${k} in ${row[1]}`);
      }
    }
  }
});
