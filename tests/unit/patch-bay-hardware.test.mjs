// B2 slice 3a: the patch bay's modules sit on plates (src/js/ui/patch/patch-bay.js), drawn as
// visual-identity-lock v3 allows the Synth panel surface and no further: a plate is a tonal
// gradient between two OSCILLA tokens with its label as text; no screws, rivets, nuts, plugs or
// texture; cables keep sag and a soft shadow and thicken on hover. Plates take no pointer (the
// jacks and cables do), and every shape sets its own stroke, so the legacy `svg { stroke }`
// never draws on the bay.
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

test('nothing the identity lock forbids: no screws, nuts, plugs, sheen or texture', () => {
  const plates = svg.match(/<g data-layer="plates"[^>]*>(.*?)<\/g>/s)[1];
  assert.doesNotMatch(plates, /<circle|<polygon|<image|<pattern/, 'a plate is one shape');
  assert.doesNotMatch(svg, /data-layer="plugs"|<polygon|<image|<pattern/);
  for (const c of cables) {
    const g = svg.match(new RegExp(`<g data-cable="${c.id}"[^>]*>(.*?)</g>`, 's'));
    assert.ok(g, `${c.id} drawn`);
    assert.equal((g[1].match(/<path /g) || []).length, 2, `${c.id}: a shadow and the cable`);
    assert.match(g[1], /group-hover:\[stroke-width:7\]/, `${c.id} thickens on hover`);
  }
});

test('every shape of the bay sets its own stroke', () => {
  const shapes = svg.match(/<(rect|circle|path|polygon)\b[^>]*>/g);
  assert.ok(shapes.length > 50);
  assert.deepEqual(shapes.filter((s) => !/\bstroke="/.test(s)), []);
});
