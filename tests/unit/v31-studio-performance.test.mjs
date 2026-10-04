// V3.1 Studio performance target (spec §145-§147, §250; plan V431): a 100-node / 200-edge
// Studio (tests/unit/fixtures/v31-large-studio.mjs, built through the store) stays responsive
// for the model operations and the compiler. The graph editor's render of the same graph in
// real browsers is tests/browser/v31-studio-workflows.cjs (check large-graph-render).
//   node --test tests/unit/v31-studio-performance.test.mjs
//
// Method: each operation runs REPEATS times after one warm-up; the MINIMUM wall time
// (performance.now) is compared with its budget. Other work on the machine only ever adds time
// to a run, so the fastest repeat is the estimate of the operation's own cost; a median measured
// contention instead and failed the release gate at a load average of 53. Budgets are what an interaction may cost: one
// 60 Hz frame (16.7 ms) for anything a single gesture commits (one dispatch with its whole-model
// validation, undo, redo, search), a few frames for whole-document work (compile, import,
// hash), and one second for building the whole fixture action by action. The measured times
// (docs/v31/performance.md) are 10-100 times below them on the development machine, so a budget
// fails only on a real regression (an accidental O(n²) per action), never on a slow CI runner.
// The numbers are printed as test diagnostics.

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { normalizeStudio, serializeStudio, studioHash } from '../../src/js/studio/schema.js';
import { importStudioFile, exportProjectFile } from '../../src/js/studio/library.js';
import { summarizeGraph } from '../../src/js/studio/a11y.js';
import { searchNodes } from '../../src/js/ui/studio/graph-search.js';
import { inspectorView } from '../../src/js/ui/studio/inspector.js';
import { compactView } from '../../src/js/ui/studio/compact.js';
import {
  LARGE_EDGES, LARGE_NODES, PERF_BUDGETS, buildLargeStudio, largeStudioActions,
} from './fixtures/v31-large-studio.mjs';

const REPEATS = 15;


function time(fn, repeats = REPEATS) {
  fn(-1); // warm-up
  const xs = [];
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    fn(i);
    xs.push(performance.now() - t0);
  }
  return Math.min(...xs);
}

const freshStore = () => {
  const m = normalizeStudio({});
  return createStudioStore(m, { idGenerator: createIdGenerator(m) });
};

test('§145 the 100-node / 200-edge fixture is valid and built by store actions', () => {
  const actions = largeStudioActions();
  assert.equal(actions.filter((a) => a.type === 'NODE_ADD').length, LARGE_NODES);
  assert.equal(actions.filter((a) => a.type === 'EDGE_ADD').length, LARGE_EDGES);
  const store = freshStore();
  assert.deepEqual(buildLargeStudio(store), { nodes: LARGE_NODES, edges: LARGE_EDGES });
  const report = validateStudioModel(store.getModel());
  assert.ok(report.ok, JSON.stringify(report.errors.slice(0, 2)));
  assert.equal(report.order.length, LARGE_NODES, 'acyclic: a full topological order');
  const plan = compileStudio(store.getModel());
  assert.ok(plan.ok, JSON.stringify(plan.errors && plan.errors.slice(0, 2)));
});

test('§145-§147 model operations, compile and views stay within their budgets', (t) => {
  const measured = {};
  measured.build = time(() => buildLargeStudio(freshStore()), 5);
  const store = freshStore();
  buildLargeStudio(store);
  const base = store.getModel();
  measured.dispatchMove = time((i) => {
    const r = store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-7',
      position: { x: 8 * (i + 2), y: 960 } });
    assert.ok(r.ok);
  });
  measured.dispatchParam = time((i) => {
    const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-12', key: 'frequency',
      value: 500 + 10 * (i + 2) });
    assert.ok(r.ok, r.reason);
  });
  measured.dispatchEdge = time(() => {
    const r = store.dispatch({ type: 'EDGE_REMOVE', edgeId: store.getModel().graph.edges.at(-1)
      .id });
    assert.ok(r.ok, r.reason);
    store.undo();
  });
  measured.undoRedo = time(() => {
    assert.ok(store.undo().ok);
    assert.ok(store.redo().ok);
  });
  const m = store.getModel();
  measured.validate = time(() => assert.ok(validateStudioModel(m).ok));
  measured.compile = time(() => assert.ok(compileStudio(m).ok));
  measured.hash = time(() => studioHash(m));
  measured.exportImport = time(() => {
    const f = exportProjectFile(m);
    const r = importStudioFile(f.text);
    assert.ok(r.ok && r.kind === 'project');
  });
  measured.summary = time(() => summarizeGraph(m));
  measured.search = time(() => searchNodes(m, 'filter 1'));
  measured.inspector = time(() => inspectorView(m, { nodes: ['filter-12'] }));
  measured.compact = time(() => compactView(m, { nodes: [] }));
  assert.ok(serializeStudio(base).length > 10000, 'a real document');
  const lines = Object.entries(measured).map(([k, v]) => `${k.padEnd(14)} ${v.toFixed(3)} ms `
    + `(budget ${PERF_BUDGETS[k].toFixed(1)})`);
  t.diagnostic(`100 nodes / 200 edges, fastest of ${REPEATS}:`);
  for (const line of lines) t.diagnostic(line);
  for (const [k, v] of Object.entries(measured)) {
    assert.ok(v <= PERF_BUDGETS[k], `${k}: ${v.toFixed(2)} ms > budget ${PERF_BUDGETS[k]} ms`);
  }
});
