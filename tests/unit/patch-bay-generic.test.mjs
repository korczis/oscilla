// B2 slice 2: one patch bay for any typed ports (src/js/ui/patch/). The Synth panel is one
// source of it (synth/view/bay.js draws exactly what the generic bay draws for the panel), and a
// StudioModel is another: every node's registry ports become its jacks and every document edge
// between them a cable, read from the model and never kept beside it.
//
//   node --test tests/unit/patch-bay-generic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as bay from '../../src/js/synth/view/bay.js';
import { panelTokens } from '../../src/js/synth/view/tokens.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const pb = await import('../../src/js/ui/patch/patch-bay.js').catch(() => ({}));
const ss = await import('../../src/js/ui/patch/studio-source.js').catch(() => ({}));
const tokens = panelTokens(null);

test('the Synth bay is the generic bay over the panel', () => {
  assert.equal(typeof pb.patchSvg, 'function');
  const source = bay.panelSource(PANEL);
  assert.deepEqual(source.groups.map((g) => g.id), PANEL.modules.map((m) => m.id),
    'every module, in panel order');
  const layout = pb.patchLayout(source, 376);
  assert.equal(bay.baySvg({ panel: PANEL, layout, tokens }),
    pb.patchSvg({ source, layout, tokens }));
  const j = PANEL.jacksOf('vco1')[0];
  assert.equal(bay.jackLabel(PANEL, j, 'free'), pb.portLabel(source, j, 'free'));
});

test('a plain source lays out its groups and names its jacks', () => {
  const source = { groups: [
    { id: 'a', label: 'A', jacks: [{ key: 'a.out:out', label: 'Out', type: 'AUDIO',
      direction: 'out', module: 'a' }] },
    { id: 'b', label: 'B', jacks: [{ key: 'b.in:in', label: 'In', type: 'AUDIO',
      direction: 'in', module: 'b' }, { key: 'b.scope:out', label: 'Scope', type: 'ANALYSIS',
      direction: 'out', module: 'b' }] },
  ], nameOf: (id) => id.toUpperCase() };
  const layout = pb.patchLayout(source, 400);
  assert.equal(layout.jacks.size, 3);
  assert.equal(layout.groups.length, 2);
  const svg = pb.patchSvg({ source, layout, tokens, cables: [{ id: 'c', from: 'a.out',
    to: 'b.in', fromModule: 'a', type: 'AUDIO' }] });
  assert.match(svg, /data-cable="c"/);
  assert.match(svg, /aria-label="B Scope output, analysis"/);
  assert.match(svg, /<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill/,
    'an analysis jack is a square');
});

test('a StudioModel is a source: node ports are jacks, document edges are cables', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const source = ss.studioSource(model);
  assert.equal(source.groups.length, model.graph.nodes.length);
  for (const n of model.graph.nodes) {
    const g = source.groups.find((x) => x.id === n.id);
    const want = NODE_REGISTRY.ports(n.type, 'in').length
      + NODE_REGISTRY.ports(n.type, 'out').length;
    assert.equal(g.jacks.length, want, n.id);
  }
  const cables = ss.studioCables(model, source);
  assert.deepEqual(cables.map((c) => c.id).sort(), model.graph.edges.map((e) => e.id).sort());
  assert.ok(cables.every((c) => ['AUDIO', 'CONTROL', 'TRIGGER', 'ANALYSIS'].includes(c.type)));
  const layout = pb.patchLayout(source, 700);
  const svg = pb.patchSvg({ source, layout, tokens, cables,
    states: ss.studioStates(model, source) });
  for (const e of model.graph.edges) assert.match(svg, new RegExp(`data-cable="${e.id}"`));
  const one = ss.studioSource(model, { nodes: [model.graph.nodes[0].id] });
  assert.equal(one.groups.length, 1);
  assert.deepEqual(ss.studioCables(model, one), [], 'an edge leaving the source is not drawn');
});
