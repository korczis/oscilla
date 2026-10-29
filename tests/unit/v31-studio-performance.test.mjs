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
// (docs/v31/performance.md) are about 8 (build) to several hundred times below them on a quiet
// development machine, so a budget fails on a real regression (an accidental O(n²) per action),
// not on a slower CI runner. Under heavy load the headroom shrinks: build measured 281 ms of its
// 1000 at a load of 60 (2026-10-28), about 3.5 times.
// The numbers are printed as test diagnostics.
//
// Under a heavy load (40-90 on the shared Mac, 2026-10-28) even the fastest of 15 can land over
// a budget, and the test then passed on a re-run: a flake that taught "re-run until green",
// which would hide a real regression too. So an operation over its budget is re-measured in
// further batches of REPEATS, keeping the running minimum, until it is within budget or the
// named wall-clock deadline REMEASURE_DEADLINE_MS passes (a condition poll with a deadline, in
// the spirit of project.bounded-test-timing; no sleep). A real regression is over budget at
// every minimum and still fails, with the minimum, the batch count and the load in the message.
// All operations together share TOTAL_DEADLINE_MS (60 s): on a runner where everything is slow,
// 13 operations at 20 s each would take 4.5 minutes and outlast fail-first's 180 s per-file
// timeout, which would then report a timeout instead of the budget. This narrows the load flake,
// it does not remove it: when the load starves the CPU (the minimum itself is over budget at a
// load near 90), more batches do not help, and the failure says the load it ran at.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
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
export const REMEASURE_DEADLINE_MS = 20_000;
export const TOTAL_DEADLINE_MS = 60_000;

/**
 * The re-measure deadline of each next operation: REMEASURE_DEADLINE_MS, or less once the
 * operations measured so far have used up most of the shared `totalMs`; never below 0 (one
 * batch, no re-measure).
 */
export function deadlines({ totalMs = TOTAL_DEADLINE_MS, perOpMs = REMEASURE_DEADLINE_MS,
  now = () => performance.now() } = {}) {
  const end = now() + totalMs;
  return () => Math.max(0, Math.min(perOpMs, end - now()));
}

/**
 * The fastest run of `fn` after one warm-up: batches of `repeats`, repeated while the running
 * minimum is over `budget` and less than `deadlineMs` of `now()` has passed since the start.
 * `fn(i)` gets a run index that keeps counting across batches.
 * @returns {{ min: number, batches: number, ok: boolean }}
 */
export function measure(fn, budget, { repeats = REPEATS, deadlineMs = REMEASURE_DEADLINE_MS,
  now = () => performance.now() } = {}) {
  const start = now();
  fn(-1); // warm-up
  let min = Infinity;
  let batches = 0;
  let i = 0;
  do {
    for (let r = 0; r < repeats; r++, i++) {
      const t0 = now();
      fn(i);
      min = Math.min(min, now() - t0);
    }
    batches += 1;
  } while (min > budget && now() - start < deadlineMs);
  return { min, batches, ok: min <= budget };
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
  const next = deadlines();
  const time = (k, fn, repeats) => {
    measured[k] = measure(fn, PERF_BUDGETS[k], { repeats, deadlineMs: next() });
  };
  time('build', () => buildLargeStudio(freshStore()), 5);
  const store = freshStore();
  buildLargeStudio(store);
  const base = store.getModel();
  time('dispatchMove', (i) => {
    const r = store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-7',
      position: { x: 8 * ((i % 1000) + 2), y: 960 } });
    assert.ok(r.ok);
  });
  time('dispatchParam', (i) => {
    const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-12', key: 'frequency',
      value: 500 + 10 * ((i % 100) + 2) });
    assert.ok(r.ok, r.reason);
  });
  time('dispatchEdge', () => {
    const r = store.dispatch({ type: 'EDGE_REMOVE', edgeId: store.getModel().graph.edges.at(-1)
      .id });
    assert.ok(r.ok, r.reason);
    store.undo();
  });
  time('undoRedo', () => {
    assert.ok(store.undo().ok);
    assert.ok(store.redo().ok);
  });
  const m = store.getModel();
  time('validate', () => assert.ok(validateStudioModel(m).ok));
  time('compile', () => assert.ok(compileStudio(m).ok));
  time('hash', () => studioHash(m));
  time('exportImport', () => {
    const f = exportProjectFile(m);
    const r = importStudioFile(f.text);
    assert.ok(r.ok && r.kind === 'project');
  });
  time('summary', () => summarizeGraph(m));
  time('search', () => searchNodes(m, 'filter 1'));
  time('inspector', () => inspectorView(m, { nodes: ['filter-12'] }));
  time('compact', () => compactView(m, { nodes: [] }));
  assert.ok(serializeStudio(base).length > 10000, 'a real document');
  const load = os.loadavg()[0].toFixed(1);
  const lines = Object.entries(measured).map(([k, v]) => `${k.padEnd(14)} ${v.min.toFixed(3)} ms `
    + `(budget ${PERF_BUDGETS[k].toFixed(1)}, ${v.batches} batch(es))`);
  t.diagnostic(`100 nodes / 200 edges, fastest of ${REPEATS} per batch, load ${load}:`);
  for (const line of lines) t.diagnostic(line);
  for (const [k, v] of Object.entries(measured)) {
    assert.ok(v.ok, `${k}: ${v.min.toFixed(2)} ms > budget ${PERF_BUDGETS[k]} ms, the fastest of`
      + ` ${v.batches} batch(es) within ${REMEASURE_DEADLINE_MS} ms (all operations within`
      + ` ${TOTAL_DEADLINE_MS} ms), at load ${load}`);
  }
});

// The re-measure on a fake clock: `now` is the only time source, and each fake operation
// advances it by what it "costs".
function fakeClock() {
  let ms = 0;
  return { now: () => ms, spend: (d) => { ms += d; } };
}

test('§145-§147 re-measure: an operation always over budget fails after the deadline', () => {
  const c = fakeClock();
  const r = measure(() => c.spend(2), 1, { deadlineMs: 300, now: c.now });
  assert.equal(r.ok, false);
  assert.equal(r.min, 2);
  assert.ok(c.now() >= 300, `ran until the deadline (${c.now()} ms)`);
  assert.equal(r.batches, 10, '15 runs of 2 ms per batch: 30 ms a batch, 300 ms deadline');
});

test('§145-§147 re-measure: slow on the first batch and fast on the second passes', () => {
  const c = fakeClock();
  let calls = 0;
  const r = measure(() => { calls += 1; c.spend(calls <= 16 ? 2 : 0.5); }, 1,
    { deadlineMs: 20_000, now: c.now });
  assert.deepEqual(r, { min: 0.5, batches: 2, ok: true });
});

test('§145-§147 re-measure: the deadline is wall-clock time, not a number of batches', () => {
  for (const [deadlineMs, batches] of [[60, 2], [600, 20]]) {
    const c = fakeClock();
    const r = measure(() => c.spend(2), 1, { deadlineMs, now: c.now });
    assert.equal(r.batches, batches, `deadline ${deadlineMs} ms`);
  }
  const c = fakeClock();
  const r = measure(() => c.spend(0.5), 1, { deadlineMs: 0, now: c.now });
  assert.deepEqual(r, { min: 0.5, batches: 1, ok: true }, 'within budget: one batch, no wait');
});

test('§145-§147 re-measure: all operations share one total deadline', () => {
  const c = fakeClock();
  const next = deadlines({ totalMs: 300, perOpMs: 200, now: c.now });
  const over = () => measure(() => c.spend(2), 1, { deadlineMs: next(), now: c.now });
  const first = over();
  assert.equal(first.batches, 7, '200 ms per operation: 7 batches of 30 ms');
  const second = over();
  assert.equal(second.batches, 3, 'the 90 ms left of the 300 ms total: 3 batches');
  const third = over();
  assert.equal(third.batches, 1, 'nothing left: one batch, no re-measure');
  assert.equal(next(), 0);
});
