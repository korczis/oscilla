// B2 slice 3a, as visual-identity-lock v4 (Q071, F013 W1) draws it: the patch bay
// (src/js/ui/patch/patch-bay.js) puts its modules on plates (a tonal gradient between two
// OSCILLA tokens, taking no pointer) and draws every jack, cable and plug through the synth-theme
// layer (ui/synth/jack.js, ui/synth/cable.js):
//   - a hexagonal nut under every jack, in a layer of its own that takes no pointer;
//   - a jack's typed ring marked data-ring (the stroke the 3:1 check reads), its 44 px hit square
//     hidden (visibility="hidden" pointer-events="all"), never a near-transparent fill;
//   - a cable with its shadow, its visible stroke (data-stroke), its hidden hit path and its sheen,
//     at the hw-shadow and hw-sheen intensities (classes), never a literal opacity;
//   - a plug on each end of every cable, above the jacks, taking no pointer;
//   - layers bottom up: plates, nuts, cables, jacks, plugs, so a tap on a jack is the jack's;
//   - every shape sets its own stroke, so the legacy `svg { stroke }` never draws on the bay.
//
//   node --test tests/unit/patch-bay-hardware.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as bay from '../../src/js/synth/view/bay.js';
import { panelTokens } from '../../src/js/synth/view/tokens.js';

const tokens = { ...panelTokens(null), plateHi: '#p1', plateLo: '#p2',
  cables: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'] };
const layout = bay.bayLayout(PANEL, 376);
const cables = [{ id: 'k1', from: 'keys.velocity', to: 'vco2.pitch', fromModule: 'keys',
  type: 'CONTROL' }, { id: 'k2', from: 'vco1.audio', to: 'ring.carrier', fromModule: 'vco1',
  type: 'AUDIO' }];
const svg = bay.baySvg({ panel: PANEL, layout, cables, tokens });
const layer = (name) => {
  const m = svg.match(new RegExp(`<g data-layer="${name}"([^>]*)>`));
  assert.ok(m, `a ${name} layer`);
  return { attrs: m[1], at: m.index };
};

test('every module sits on a plate: a tonal gradient between two tokens, taking no pointer', () => {
  const plates = svg.match(/<g data-layer="plates" pointer-events="none">(.*?)<\/g>/s);
  assert.ok(plates, 'a plates layer that takes no pointer');
  for (const g of layout.groups) {
    const plate = new RegExp(`<rect [^>]*fill="url\\(#bay-plate\\)"[^>]*data-plate="${g.module}"`);
    assert.match(plates[1], plate, `${g.module} has a plate`);
  }
  assert.match(svg, new RegExp('<linearGradient id="bay-plate"[^>]*>'
    + '<stop offset="0" stop-color="#p1"/><stop offset="1" stop-color="#p2"/>'));
});

test('a nut under every jack, a plug on each cable end, layered so a jack keeps its taps', () => {
  const order = ['plates', 'nuts', 'cables', 'jacks', 'plugs'].map((n) => layer(n));
  assert.deepEqual(order.map((l) => l.at), [...order.map((l) => l.at)].sort((a, b) => a - b));
  assert.match(layer('nuts').attrs, /pointer-events="none"/);
  assert.match(layer('plugs').attrs, /pointer-events="none"/);
  assert.equal((svg.match(/data-nut=""/g) || []).length, layout.jacks.size, 'one nut a jack');
  assert.equal((svg.match(/data-plug=""/g) || []).length, cables.length * 2, 'two plugs a cable');
});

test('a jack: its typed ring marked, its hit square hidden rather than transparent', () => {
  const jacks = svg.match(/<g role="button"[^>]*data-jack="[^"]+"[^>]*>.*?<\/g>/gs);
  assert.equal(jacks.length, layout.jacks.size);
  for (const j of jacks) {
    assert.match(j, /<rect data-hit=""[^>]*visibility="hidden" pointer-events="all"/);
    assert.equal((j.match(/data-ring=""/g) || []).length, 1, 'one ring');
  }
  assert.doesNotMatch(svg, /(?:fill|stroke)-opacity=|\sopacity="0?\.\d/,
    'no literal opacity anywhere on the bay');
});

test('a cable: shadow, visible stroke, hidden hit path and sheen, each intensity a class', () => {
  for (const c of cables) {
    const g = svg.match(new RegExp(`<g data-cable="${c.id}"[^>]*>.*?</g></g>`, 's'));
    assert.ok(g, `${c.id} drawn`);
    assert.match(g[0], /<path data-shadow="" class="opacity-hw-shadow"/);
    assert.match(g[0], /<path data-hit=""[^>]*visibility="hidden"/);
    assert.match(g[0], /<path data-stroke=""/);
    assert.match(g[0], /<path data-sheen="" class="opacity-hw-sheen"/);
  }
  const control = svg.match(/<g data-cable="k1".*?<path data-stroke=""[^>]*>/s)[0];
  assert.match(control, /stroke-dasharray="9 6"/, 'a control cable is dashed');
});

test('every shape of the bay sets its own stroke', () => {
  const shapes = svg.match(/<(rect|circle|path|polygon)\b[^>]*>/g);
  assert.ok(shapes.length > 50);
  assert.deepEqual(shapes.filter((s) => !/\bstroke="/.test(s)), []);
});
