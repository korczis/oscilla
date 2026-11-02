// B2 slice 3a: the patch bay drawn as hardware (src/js/ui/patch/patch-bay.js). Each module is a
// plate with its cable colour as a strip along the top and two screws; each jack sits in a hex
// nut; each cable ends in a plug seated in both its jacks, in its colour, and carries a sheen.
// None of it takes a pointer (the jacks and cables under it do), and every shape sets its own
// stroke, so the legacy `svg { stroke }` never draws on the bay.
//
//   node --test tests/unit/patch-bay-hardware.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as bay from '../../src/js/synth/view/bay.js';
import { panelTokens } from '../../src/js/synth/view/tokens.js';

const tokens = { ...panelTokens(null), cables: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'] };
const layout = bay.bayLayout(PANEL, 376);
const cables = [{ id: 'k1', from: 'keys.velocity', to: 'vco2.pitch', fromModule: 'keys',
  type: 'CONTROL' }, { id: 'k2', from: 'vco1.audio', to: 'ring.carrier', fromModule: 'vco1',
  type: 'AUDIO' }];
const svg = bay.baySvg({ panel: PANEL, layout, cables, tokens });
const layer = (name) => {
  const end = '(?=<g data-layer|<text|<path data-live)';
  const m = svg.match(new RegExp(`<g data-layer="${name}"[^>]*>(.*?)</g>${end}`, 's'));
  return m ? m[0] : '';
};

test('every module is a plate with its cable colour along the top', () => {
  const order = PANEL.modules.map((m) => m.id);
  for (const g of layout.groups) {
    const plate = svg.match(new RegExp(`<g data-plate="${g.module}"[^>]*>(.*?)</g>`, 's'));
    assert.ok(plate, `${g.module} has a plate`);
    assert.match(plate[0], /pointer-events="none"/);
    const colour = tokens.cables[order.indexOf(g.module) % tokens.cables.length];
    assert.match(plate[1], new RegExp(`height="3"[^>]*fill="${colour}"`), `${g.module} strip`);
    assert.equal((plate[1].match(/<circle /g) || []).length, 2, `${g.module} screws`);
  }
});

test('every jack sits in a hex nut, and every cable ends in two plugs of its colour', () => {
  const plates = layer('plates');
  assert.equal((plates.match(/<polygon /g) || []).length, layout.jacks.size);
  const plugs = layer('plugs');
  assert.match(plugs, /^<g data-layer="plugs" pointer-events="none">/);
  for (const [i, c] of cables.entries()) {
    const colour = tokens.cables[PANEL.modules.findIndex((m) => m.id === c.fromModule)];
    for (const end of [layout.jacks.get(`${c.from}:out`), layout.jacks.get(`${c.to}:in`)]) {
      assert.match(plugs, new RegExp(`<circle cx="${end.x}" cy="${end.y}" r="8" `
        + `fill="${colour}"`), `cable ${i + 1} plug`);
    }
  }
  assert.equal((svg.match(/stroke-opacity="0.3"/g) || []).length, cables.length, 'one sheen each');
});

test('every shape of the bay sets its own stroke', () => {
  const shapes = svg.match(/<(rect|circle|path|polygon)\b[^>]*>/g);
  assert.ok(shapes.length > 50);
  assert.deepEqual(shapes.filter((s) => !/\bstroke="/.test(s)), []);
});
