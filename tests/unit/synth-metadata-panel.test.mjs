// K061: metadata.panel { id, module } is presentation: kept by normalize and the import check,
// excluded from studioHash, dropped by PASTE and DUPLICATE (a copied module is a free node),
// and a malformed one is refused with its sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copySubgraph, createIdGenerator, createStudioStore,
} from '../../src/js/studio/actions.js';
import { normalizeStudio, studioHash, PANEL_REF_MESSAGE } from '../../src/js/studio/schema.js';
import { validateStudioImport } from '../../src/js/studio/validate.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';

const fresh = () => createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
  { idGenerator: createIdGenerator() });
const PANEL = { id: 'semi-mono-1', module: 'vco1' };

test('NODE_ADD keeps metadata.panel; normalize keeps it; studioHash ignores it', () => {
  const st = fresh();
  const plain = st.getModel();
  assert.equal(st.dispatch({ type: 'NODE_ADD', nodeType: 'vco', id: 'v-1', panel: PANEL }).ok,
    true);
  const m = st.getModel();
  const n = m.graph.nodes.find((x) => x.id === 'v-1');
  assert.deepEqual(n.metadata.panel, PANEL);
  const again = normalizeStudio(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(again.graph.nodes.find((x) => x.id === 'v-1').metadata.panel, PANEL);
  const untagged = { ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((x) => (x.id === 'v-1'
    ? { ...x, metadata: { name: x.metadata.name } } : x)) } };
  assert.equal(studioHash(m), studioHash(untagged));
  assert.notEqual(studioHash(m), studioHash(plain));
});

test('the import check allows a well-formed panel and refuses a malformed one', () => {
  const st = fresh();
  st.dispatch({ type: 'NODE_ADD', nodeType: 'vco', id: 'v-1', panel: PANEL });
  const doc = JSON.parse(JSON.stringify(st.getModel()));
  assert.equal(validateStudioImport(doc).ok, true);
  doc.graph.nodes.find((x) => x.id === 'v-1').metadata.panel = { id: 'X Y', module: 1 };
  const r = validateStudioImport(doc);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes(PANEL_REF_MESSAGE)
    || (e.detail || '').includes('metadata.panel')), JSON.stringify(r.errors.slice(0, 2)));
  assert.equal(fresh().dispatch({ type: 'NODE_ADD', nodeType: 'vco', panel: { id: 1 } }).reason,
    PANEL_REF_MESSAGE);
});

test('PASTE and DUPLICATE drop the panel tag', () => {
  const st = fresh();
  st.dispatch({ type: 'NODE_ADD', nodeType: 'vco', id: 'v-1', panel: PANEL });
  const p = st.dispatch({ type: 'PASTE', clipboard: copySubgraph(st.getModel(), ['v-1']) });
  assert.equal(p.ok, true, p.reason);
  const d = st.dispatch({ type: 'DUPLICATE', nodeIds: ['v-1'] });
  assert.equal(d.ok, true, d.reason);
  const copies = [...p.created.nodes, ...d.created.nodes]
    .map((id) => st.getModel().graph.nodes.find((x) => x.id === id));
  for (const c of copies) assert.equal(c.metadata.panel, undefined);
});
